import { compareCodePoint } from "./order-shared";
import { validCrewGapCertificateShape } from "./shapes-shared";
import { canonicalJson, type DayContext, type RuleContext, type RulePerson } from "./context-shared";
import type { CrewGapCertificate, CrewRejectionCode, OpenShiftItem } from "./crew-contracts-shared";
import { scheduleEngine, shiftTypesOf, type ShiftType } from "./structure-shared";
import { atDayCap, leaderSettingOf, legalHoldPath, modCountsOn, neverGenerated, type DeclaredGap, type Shift, type WeekSchedule } from "./rules-shared";

/** Type flags restrict the existing role/time rule; they can never grant MoD authority. */
export function shiftCountsAsMod(shift: Shift, person: RulePerson, day: DayContext, q: number): boolean {
  if (!modCountsOn(person, day, q)) return false;
  if (scheduleEngine(day.structure) !== "crew") return true;
  if (q < shift.startQ || q >= shift.endQ) return false;
  const matches = day.crew?.shifts.filter((m) => m.userId === shift.userId && m.startQ === shift.startQ) ?? [];
  if (matches.length !== 1) return false;
  const meta = matches[0]!;
  // Untyped on-clock time has no affirmative type permission, even for a pinned manager.
  if (meta.typeId === null) return false;
  return shiftTypesOf(day.structure).find((t) => t.id === meta.typeId)?.countsTowardMod === true;
}

/** Candidates are the complete active, auto-schedulable roster, not a caller-supplied shortlist. */
export function crewCandidates(day: DayContext, ctx: RuleContext): RulePerson[] {
  return Object.values(ctx.people).filter((p) => p.activeMember && !neverGenerated(p))
    .sort((a, b) => compareCodePoint(a.userId, b.userId));
}

/** Conservative fixed-crew exclusions. Unknown policy/search failures deliberately have no proof. */
export function crewCandidateRejections(p: RulePerson, type: ShiftType, date: string, s: WeekSchedule, ctx: RuleContext): CrewRejectionCode[] {
  const day = ctx.days[date]!;
  const st = day.structure;
  const codes: CrewRejectionCode[] = [];
  if (p.workModes?.[date] === "off") codes.push("off");
  if (p.untouchableDates.includes(date)) codes.push("time_off");
  const av = p.availability[date];
  if (av === null) codes.push("unavailable");
  if (s.shifts.some((sh) => sh.userId === p.userId && sh.date === date)) codes.push("already_scheduled");
  // Consider the widest possible legal block, including a person's own usual times. This refuses
  // to certify an opening merely because the standard block fails while their own block fits.
  const usual = p.usualShift?.value;
  const own = usual?.typeId === type.id ? usual : null;
  const from = Math.max(st.shopDay.prepStartQ, av?.fromQ ?? 0, Math.min(type.fromQ - type.startFlexQ, own?.fromQ ?? type.fromQ));
  const to = Math.min(day.scheduledOutQ, av?.toQ ?? 96, Math.max(type.toQ, own?.toQ ?? type.toQ));
  const minimum = Math.max(type.minLengthQ, st.limits.minimumShiftQ,
    p.salaried ? (p.role === "gm" ? st.limits.gmMinimumH * 4 : p.role === "agm" ? st.limits.agmMinimumH * 4 : 0) : 0);
  if (av !== null && to <= from) codes.push("unavailable");
  if (av !== null && to - from < minimum) codes.push("minimum_length");
  if (minimum > st.limits.maxShiftH * 4) codes.push("maximum_length");
  const setting = leaderSettingOf(p, st);
  if ((setting === "opens" && from + minimum >= st.shopDay.serviceCloseQ)
    || (setting === "closes" && to - Math.max(from, st.shopDay.serviceStartQ) < minimum)) codes.push("leader_setting");
  let canHold = false;
  for (let q = from; q < to && !canHold; q++) {
    canHold = (type.countsTowardMod && modCountsOn(p, day, q))
      || Object.keys(st.positions).some((id) => legalHoldPath(p, id, day, date, q) !== null);
  }
  if (!canHold && to > from && av !== null && !p.untouchableDates.includes(date)) codes.push("position");
  if (atDayCap(p, s, date)) codes.push("day_limit");
  const hours = s.shifts.filter((sh) => sh.userId === p.userId).reduce((n, sh) => n + sh.endQ - sh.startQ, 0) / 4;
  if (!p.salaried && p.softMaxH !== null && hours + minimum / 4 > p.softMaxH) codes.push("soft_max");
  if (p.salaried && hours + minimum / 4 > st.limits.salariedTargetWeekH + st.limits.salariedFlexH) codes.push("manager_limit");
  return codes.sort();
}

export function crewRequired(type: ShiftType, day: DayContext): number {
  const extra = day.structure.catering.crewShift;
  return type.headcount[day.dayType] + (extra?.enabled && extra.typeId === type.id
    && day.inputs.cateringEvents.some((e) => e.headcount >= day.structure.catering.minHeadcount) ? extra.extraHeads : 0);
}

/** Every open type, even one without a provable rejection. The latter MUST stay unresolved. */
export function crewOpenItems(date: string, s: WeekSchedule, ctx: RuleContext): OpenShiftItem[] {
  const day = ctx.days[date];
  if (!day?.crew || scheduleEngine(day.structure) !== "crew") return [];
  return shiftTypesOf(day.structure).flatMap((type) => {
    const placed = day.crew!.shifts.filter((m) => m.typeId === type.id && s.shifts.some((sh) => sh.date === date && sh.userId === m.userId && sh.startQ === m.startQ)).length;
    const required = crewRequired(type, day);
    if (placed >= required) return [];
    return [{ typeId: type.id, fromQ: type.fromQ, toQ: type.toQ, required, placed, missing: required - placed,
      rejected: crewCandidates(day, ctx).map((p) => ({ userId: p.userId, codes: crewCandidateRejections(p, type, date, s, ctx) })) }];
  }).sort((a, b) => a.fromQ - b.fromQ || compareCodePoint(a.typeId, b.typeId));
}

export function crewOpenGroups(date: string, s: WeekSchedule, ctx: RuleContext): Array<{ fromQ: number; toQ: number; items: OpenShiftItem[] }> {
  const groups: Array<{ fromQ: number; toQ: number; items: OpenShiftItem[] }> = [];
  for (const item of crewOpenItems(date, s, ctx)) {
    const last = groups[groups.length - 1];
    if (last?.fromQ === item.fromQ) { last.items.push(item); last.toQ = Math.max(last.toQ, item.toQ); }
    else groups.push({ fromQ: item.fromQ, toQ: item.toQ, items: [item] });
  }
  return groups;
}

type StationEvidence = Extract<CrewGapCertificate, { kind: "station_short" }>;
export function crewStationShorts(date: string, positionId: string, s: WeekSchedule, ctx: RuleContext): Array<{ fromQ: number; toQ: number; certificate: StationEvidence }> {
  const day = ctx.days[date];
  if (!day?.crew || scheduleEngine(day.structure) !== "crew" || !day.structure.positions[positionId]) return [];
  const shifts = s.shifts.filter((sh) => sh.date === date);
  const result: Array<{ fromQ: number; toQ: number; certificate: StationEvidence }> = [];
  for (let q = 0; q < 96; q++) {
    const required = day.need.positions[positionId]?.[q] ?? 0;
    const onClock = shifts.filter((sh) => sh.startQ <= q && q < sh.endQ);
    const assigned = new Set(onClock.filter((sh) => sh.segments.some((seg) => seg.positionId === positionId && seg.startQ <= q && q < seg.endQ)).map((sh) => sh.userId)).size;
    if (required <= assigned) continue;
    const certificate: StationEvidence = { kind: "station_short", required, assigned, onShiftUserIds: [...new Set(onClock.map((sh) => sh.userId))].sort(compareCodePoint) };
    const last = result[result.length - 1];
    if (last && last.toQ === q && canonicalJson(last.certificate) === canonicalJson(certificate)) last.toQ++;
    else result.push({ fromQ: q, toQ: q + 1, certificate });
  }
  return result;
}

export function verifyCrewGap(g: DeclaredGap, s: WeekSchedule, ctx: RuleContext): boolean {
  const day = ctx.days[g.date];
  if (g.cause !== "crew_shortfall" || day?.crew?.version !== 1 || scheduleEngine(day.structure) !== "crew") return false;
  if (!validCrewGapCertificateShape(g.certificate)) return false;
  const real = s.shifts.filter((sh) => sh.date === g.date);
  const metas = day.crew.shifts;
  if (metas.length !== real.length || metas.some((m) => real.filter((sh) => sh.userId === m.userId && sh.startQ === m.startQ).length !== 1)
    || real.some((sh) => metas.filter((m) => m.userId === sh.userId && m.startQ === sh.startQ).length !== 1)) return false;
  const c = g.certificate;
  if (g.code === "coverage_gap" && g.positionId !== null && c.kind === "station_short") {
    return crewStationShorts(g.date, g.positionId, s, ctx).some((run) => run.fromQ === g.fromQ && run.toQ === g.toQ && canonicalJson(run.certificate) === canonicalJson(c));
  }
  if (g.code !== "open_shift" || g.positionId !== null || c.kind !== "open_shifts") return false;
  const group = crewOpenGroups(g.date, s, ctx).find((x) => x.fromQ === g.fromQ && x.toQ === g.toQ);
  return !!group && group.items.every((item) => item.rejected.every((p) => p.codes.length > 0))
    && canonicalJson(group.items) === canonicalJson(c.items);
}
