import { crewBlockAttempts } from "../crew-block-attempts-shared";
/** Whole crew blocks first, stations second. No station-generator repair or fill passes. */
import { canonicalJson, assertContextFits, type DayContext, type RuleContext, type RulePerson } from "../context-shared";
import type { CrewShiftMeta } from "../crew-contracts-shared";
import { crewCandidateHoursEvidence, crewOpenGroups, crewRequired, crewStationShorts, shiftCountsAsMod } from "../crew-gap-verifier-shared";
import { ScheduleError } from "../errors-shared";
import { buildDayNeed } from "../need-shared";
import { compareCodePoint as cmp } from "../order-shared";
import { skillOf, type SchedPerson } from "../people-input-shared";
import { positionRankOf } from "../position-rank-shared";
import { reason, shiftKey, type BoardNote, type ReasonIndex, type ReasonKey, type ShiftReasons } from "../reasons-shared";
import {
  MOD, SALARIED_FLEX_REASON, CATERING_MANAGER_COVER, REPAIR_LIMITS,
  atDayCap, checkScheduleRules, crewEarliestModStart, closingManagerEligible, coversClosingWindow, floorHours,
  generatorRefuses, legalHoldPath, maxDaysPerWeek, modCountsOn,
  neverGenerated, proveGap, salariedWeek, type DeclaredGap, type GapSubject, type Segment, type Shift, type WeekSchedule,
} from "../rules-shared";
import { isSecondary, lineOrder, shiftTypesOf, type ShiftType } from "../structure-shared";
import { teamStrength } from "../strength-shared";
import { weekDays } from "../time-shared";
import type { GeneratorInput, GeneratorOutput } from "./build-shared";

export const CREW_GENERATOR_VERSION = "crew.1";
const order = (a: Shift, b: Shift) => cmp(a.date, b.date) || cmp(a.userId, b.userId) || a.startQ - b.startQ;
const key = (s: Shift) => shiftKey(s.date, s.userId, s.startQ);
const hours = (s: Shift) => (s.endQ - s.startQ) / 4;
type Source = CrewShiftMeta["source"];
interface Block { shift: Shift; type: ShiftType; source: Source; flexFromQ: number }
const unassigned = (a: number, z: number): Segment => ({ positionId: MOD, startQ: a, endQ: z, reasonKey: "schedule.reason.crew_unassigned" });

/** Inputs are copied, including all unordered nested evidence, before any allocation. */
export function buildCrewWeek(raw: GeneratorInput): GeneratorOutput {
  return buildCrewWeekAttempt(raw, false);
}

function buildCrewWeekAttempt(raw: GeneratorInput, prioritizeUsualBudget: boolean): GeneratorOutput {
  const input = structuredClone(raw);
  input.people.sort((a, b) => cmp(a.userId, b.userId));
  input.days.sort((a, b) => cmp(a.date, b.date));
  input.pins.sort((a, b) => cmp(a.date, b.date) || cmp(a.userId, b.userId) || a.startQ - b.startQ || cmp(a.id, b.id));
  const st = input.structure;
  const types = shiftTypesOf(st); // Configuration order is intentional, unlike roster input order.
  const dates = weekDays(input.weekStart);
  const buildDays = input.days.filter((d) => dates.includes(d.date) && d.date >= input.today);
  const built = new Set(buildDays.map((d) => d.date));
  const roster = Object.fromEntries(input.people.map((p) => [p.userId, p]));
  const people: Record<string, RulePerson> = {};
  for (const p of input.people) {
    people[p.userId] = {
      userId: p.userId, role: p.role, activeMember: p.activeMember, workType: p.workType,
      alsoAllowed: [...p.alsoAllowed].sort(cmp), leaderSetting: p.leaderSetting, coverPositions: p.coverPositions,
      salaried: p.salaried, presenceOnly: p.presenceOnly, softMinH: p.softMinH, softMaxH: p.softMaxH,
      availability: p.availability, workModes: p.workModes, usualShift: p.usualShift,
      flexDates: [...p.flexDates].sort(cmp), untouchableDates: [...p.untouchableDates].sort(cmp),
      newerPositions: [...p.newerPositions].sort(cmp), strongPositions: [...p.strongPositions].sort(cmp),
    };
  }
  const ctx: RuleContext = { version: 1, locationId: input.locationId, weekStart: input.weekStart,
    today: input.today, dates, days: {}, people, budgetByDate: {}, closingWindowByDate: {} };
  const notes: BoardNote[] = [];
  const reasons: ReasonIndex = {};
  const fixed = new Set<string>();
  const blocked = new Set<string>();
  const blocks = new Map<string, Block>();
  let usualBudgetRefused = false;
  const schedule: WeekSchedule = { locationId: input.locationId, weekStart: input.weekStart, shifts: [], days: [], gaps: [] };
  const note = (date: string, userId: string | null, why: string, typeId: string | null = null) => {
    notes.push({ code: why === "usual_over_cap" ? "usual_over_cap" : why === "budget" ? "budget_stopped" : why === "usual_type_deleted" ? "usual_type_deleted" : "crew_block_skipped", date, userId,
      positionId: null, params: { reason: why, typeId } });
  };
  for (const date of dates) {
    ctx.budgetByDate[date] = input.budgetByDate[date] ?? null;
    const d = buildDays.find((x) => x.date === date);
    ctx.closingWindowByDate[date] = d ? { fromQ: st.shopDay.serviceCloseQ, toQ: d.scheduledOutQ }
      : input.head?.closingWindowByDate[date] ?? { fromQ: st.shopDay.serviceCloseQ, toQ: st.shopDay.serviceCloseQ };
    if (!d) {
      const prior = input.head?.days.find((x) => x.date === date);
      schedule.days.push(prior ? { ...prior, inherited: true, problems: prior.problems.map((p) => ({ ...p, inherited: true })) }
        : { date, originRevisionId: null, structureVersionId: input.structureVersionId, inherited: true, problems: [] });
      for (const sh of input.head?.shifts.filter((x) => x.date === date) ?? []) {
        schedule.shifts.push(sh); fixed.add(key(sh));
        const r = input.head?.reasons?.[key(sh)];
        if (r != null) reasons[key(sh)] = r as ShiftReasons;
      }
      schedule.gaps.push(...input.head?.gaps.filter((x) => x.date === date) ?? []);
      // Preserve original context when supplied; inherited day records prevent rejudgment.
      const old = input.crew?.headContext?.days[date];
      if (old) ctx.days[date] = structuredClone(old);
      continue;
    }
    d.catering.sort((a, b) => cmp(a.id, b.id));
    const { need } = buildDayNeed({ structure: st, ...d });
    const overrides = structuredClone(input.crew?.manualOverridesByDate?.[date]
      ?? input.crew?.headContext?.days[date]?.crew?.manualOverrides ?? []);
    overrides.sort((a, b) => cmp(canonicalJson(a), canonicalJson(b)));
    ctx.days[date] = { structureVersionId: input.structureVersionId, structure: st, dayType: d.dayType,
      closingMinutes: d.closingMinutes, scheduledOutQ: d.scheduledOutQ, need,
      inputs: { demandKind: d.demandKind, hourlyCents: d.hourlyCents, dayCents: d.dayCents,
        dayTypeSource: d.dayTypeSource, overrideId: d.overrideId, cateringEvents: d.catering },
      crew: { version: 1, shifts: [], manualOverrides: overrides, notes: [] } };
    schedule.days.push({ date, originRevisionId: null, structureVersionId: input.structureVersionId, inherited: false, problems: [] });
  }
  const addMeta = (sh: Shift, typeId: string | null, source: Source) => ctx.days[sh.date]!.crew!.shifts.push({ userId: sh.userId, startQ: sh.startQ, typeId, source });
  const typeForPin = (sh: Shift) => types.map((t) => ({ t, overlap: Math.max(0, Math.min(sh.endQ, t.toQ) - Math.max(sh.startQ, t.fromQ)) }))
    .filter(({ t, overlap }) => overlap >= t.minLengthQ).sort((a, b) => b.overlap - a.overlap || cmp(a.t.id, b.t.id))[0]?.t.id ?? null;
  const typeForFixed = (sh: Shift) => {
    const old = input.crew?.headContext?.days[sh.date]?.crew?.shifts.find((m) => m.userId === sh.userId && m.startQ === sh.startQ);
    if (old && types.some((t) => t.id === old.typeId)) return old.typeId;
    const usual = roster[sh.userId]?.usualShift?.value;
    const match = types.find((t) => t.id === usual?.typeId);
    return match?.id ?? types.find((t) => sh.startQ === t.fromQ && sh.endQ === t.toQ)?.id ?? null;
  };
  // A. Every manual replacement/deletion and every pin is reserved for the entire week first.
  for (const d of buildDays) {
    for (const edit of ctx.days[d.date]!.crew!.manualOverrides) {
      blocked.add(`${edit.original.date}|${edit.original.userId}`);
      if (edit.replacement) {
        const sh = structuredClone(edit.replacement);
        if (sh.date !== d.date || edit.original.date !== d.date) throw new ScheduleError("invalid_payload");
        const person = roster[sh.userId];
        if (!person?.activeMember || person.untouchableDates.includes(sh.date) || person.workModes?.[sh.date] === "off") {
          note(sh.date, sh.userId, "manual_person_unavailable"); continue;
        }
        blocked.add(`${sh.date}|${sh.userId}`);
        schedule.shifts.push(sh); fixed.add(key(sh)); addMeta(sh, typeForFixed(sh), "manual");
        const prior = input.head?.reasons?.[key(sh)];
        if (prior != null) reasons[key(sh)] = structuredClone(prior) as ShiftReasons;
      }
    }
  }
  for (const pin of input.pins.filter((p) => built.has(p.date))) {
    if (blocked.has(`${pin.date}|${pin.userId}`)) { note(pin.date, pin.userId, "pin_blocked_by_manual"); continue; }
    const sh: Shift = { userId: pin.userId, date: pin.date, startQ: pin.startQ, endQ: pin.endQ,
      segments: [unassigned(pin.startQ, pin.endQ)], closingManager: false, flex: false, pinned: true };
    const p = roster[pin.userId];
    const pos = pin.kind === "added" && p ? pin.positions.find((id) => {
      for (let q = pin.startQ; q < pin.endQ; q++) if (!legalHoldPath(p, id, ctx.days[pin.date]!, pin.date, q)) return false;
      return true;
    }) : undefined;
    if (pos && p) sh.segments = [segment(p, pos, pin.startQ, pin.endQ, ctx.days[pin.date]!)];
    schedule.shifts.push(sh); fixed.add(key(sh)); addMeta(sh, typeForPin(sh), "pin");
    const r = reason(pin.kind === "presence" ? "presence_pin" : "added_pin", { pinId: pin.id });
    reasons[key(sh)] = { shift: [r], segments: [[r]], alternates: [] };
  }
  schedule.shifts.sort(order);
  const totalH = (id: string) => schedule.shifts.filter((s) => s.userId === id).reduce((n, s) => n + hours(s), 0);
  const budgetedDates = dates.filter((d) => ctx.budgetByDate[d] !== null);
  const budgetHours = budgetedDates.reduce((n, d) => n + ctx.budgetByDate[d]!, 0);
  const essential = (sh: Shift) => {
    const cw = ctx.closingWindowByDate[sh.date];
    return !!cw && sh.segments.some((g) => g.positionId !== MOD && g.startQ < cw.toQ && g.endQ > cw.fromQ);
  };
  const chargedHours = () => schedule.shifts.reduce((n, sh) => n + (budgetedDates.includes(sh.date)
    && roster[sh.userId] && !roster[sh.userId]!.salaried && !roster[sh.userId]!.presenceOnly && !essential(sh) ? hours(sh) : 0), 0);
  function candidate(p: SchedPerson, t: ShiftType, date: string, source: Source, holes: readonly number[] = [], required: readonly number[] = [], shorten = false, budgetRefused: ReadonlySet<string> = new Set()): { block?: Block; rejection?: string } {
    const fail = (rejection: string) => ({ rejection });
    const day = ctx.days[date]!;
    if (!p.activeMember || neverGenerated(p)) return fail("position");
    if (p.workModes?.[date] === "off") return fail("off");
    if (p.untouchableDates.includes(date)) return fail("time_off");
    if (blocked.has(`${date}|${p.userId}`) || schedule.shifts.some((s) => s.date === date && s.userId === p.userId)) return fail("already_scheduled");
    if (p.availability[date] === null) return fail("unavailable");
    if (atDayCap(p, schedule, date, maxDaysPerWeek(st))) return fail("day_limit");
    let flexFromQ = 0;
    const replay = crewBlockAttempts(p, t, date, day, source, (a, z) => {
      const h = (z - a) / 4;
      if (h > st.limits.maxShiftH) return "maximum_length";
      if (!p.salaried && source !== "usual" && p.softMaxH !== null && totalH(p.userId) + h > p.softMaxH) return "soft_max";
      if (!p.salaried && source !== "usual" && totalH(p.userId) + h > st.limits.overtimeH) return "overtime";
      flexFromQ = z;
      if (p.salaried) {
        const w = salariedWeek(schedule, p.userId);
        const extra = Math.max(0, h - Math.max(0, st.limits.salariedTargetWeekH - w.baseH));
        if ((extra > 0 && source !== "fill") || extra + w.flexH > st.limits.salariedFlexH
          || w.totalH + h > st.limits.salariedTargetWeekH + st.limits.salariedFlexH) { return "manager_limit"; }
        flexFromQ = z - extra * 4;
      }
      if (budgetRefused.has(`${a}|${z}`)) return "budget";
      return null;
    }, { holes, required, shorten });
    const match = replay.match;
    if (!match) return fail(replay.rejection);
    const [startQ, endQ] = match;
    return { block: { shift: { userId: p.userId, date, startQ, endQ, segments: [unassigned(startQ, endQ)],
      closingManager: false, flex: false, pinned: false }, type: t, source, flexFromQ } };
  }
  let lastPlaceHoursRefused = false;
  function place(block: Block, why: ReasonKey): boolean {
    lastPlaceHoursRefused = false;
    const sh = block.shift;
    // Candidate checks are incremental. Station feasibility is guaranteed by the legal matching;
    // run the complete validator only after the day allocations are complete.
    const chargedBefore = chargedHours();
    // Until the raw hourly total reaches the cap, no allocation can make the budget
    // infeasible. Likewise no salaried floor ledger exists before a salaried placement.
    const rawCharge = schedule.shifts.reduce((n, s) => n + (budgetedDates.includes(s.date) && roster[s.userId] && !roster[s.userId]!.salaried && !roster[s.userId]!.presenceOnly ? hours(s) : 0), 0)
      + (budgetedDates.includes(sh.date) && !roster[sh.userId]!.salaried && !roster[sh.userId]!.presenceOnly ? hours(sh) : 0);
    const needsAssignment = (budgetedDates.length > 0 && rawCharge > budgetHours)
      || roster[sh.userId]!.salaried || schedule.shifts.some((s) => roster[s.userId]?.salaried);
    // Assignment replaces generated segment arrays; retain the old arrays for rollback.
    const saved = needsAssignment ? schedule.shifts.map((s) => ({ ...s })) : [];
    schedule.shifts.push(sh); blocks.set(key(sh), block); addMeta(sh, block.type.id, block.source);
    if (needsAssignment) assignStations(sh.date);
    // Budget belongs to the complete allocation. Distinguish a new block's charge
    // from a previously exempt shift losing its closing assignment.
    const ownCharge = budgetedDates.includes(sh.date) && !roster[sh.userId]!.salaried && !roster[sh.userId]!.presenceOnly && !essential(sh) ? hours(sh) : 0;
    const chargedAfter = chargedHours();
    const budgetRefused = budgetedDates.length > 0 && chargedAfter > budgetHours && chargedAfter > chargedBefore;
    const managerRefused = input.people.some((p) => {
      if (!p.salaried) return false;
      const before = salariedWeek({ shifts: saved }, p.userId), after = salariedWeek(schedule, p.userId);
      return (after.baseH > st.limits.salariedTargetWeekH && after.baseH > before.baseH)
        || (after.flexH > st.limits.salariedFlexH && after.flexH > before.flexH);
    });
    if (budgetRefused || managerRefused) {
      lastPlaceHoursRefused = budgetRefused && !managerRefused;
      if (budgetRefused && block.source === "usual") {
        usualBudgetRefused = true;
        note(sh.date, sh.userId, "usual_over_cap", block.type.id);
      }
      schedule.shifts = saved; blocks.delete(key(sh));
      ctx.days[sh.date]!.crew!.shifts = ctx.days[sh.date]!.crew!.shifts.filter((m) => !(m.userId === sh.userId && m.startQ === sh.startQ));
      note(sh.date, sh.userId, budgetRefused ? ownCharge > 0 ? "budget" : "budget_displaced_essential" : "manager_limit", block.type.id); return false;
    }
    reasons[key(sh)] = { shift: [reason(why, { typeId: block.type.id })], segments: [], alternates: [] };
    return true;
  }
  function preservesMod(block: Block): boolean {
    if (!st.leadership.modRequired) return true;
    const sh = block.shift, day = ctx.days[sh.date]!, p = roster[sh.userId]!;
    const holes = modHoles(sh.date);
    if (!holes.some((q) => modCountsOn(p, day, q))) return true;
    const covers = (b: Block, q: number) => b.type.countsTowardMod && b.shift.startQ <= q && q < b.shift.endQ
      && modCountsOn(roster[b.shift.userId]!, day, q);
    const possible = (person: SchedPerson, q: number) => types.some((t) => {
      const b = candidate(person, t, sh.date, "fill", [q]).block;
      return b && covers(b, q);
    });
    const exclusive = holes.filter((q) => possible(p, q)
      && !input.people.some((other) => other.userId !== p.userId && possible(other, q)));
    const covered = exclusive.filter((q) => covers(block, q));
    // Incomparable morning/evening blocks cannot reserve each other forever.
    // Reserve only when another block for this person covers a strict superset.
    for (const t of types) {
      const alternative = candidate(p, t, sh.date, "fill", exclusive, covered).block;
      if (alternative && covered.every((q) => covers(alternative, q))
        && exclusive.filter((q) => covers(alternative, q)).length > covered.length) return false;
    }
    return true;
  }
  // B. Usual shifts retain their end, with availability-clipped starts, even above the type headcount.
  for (const d of buildDays) for (const p of input.people) {
    if (p.usualShift?.deletedTypeId) note(d.date, p.userId, "usual_type_deleted", p.usualShift.deletedTypeId);
  }
  const dayPriority = { weekend: 0, busy: 0, normal: 1, slow: 2 };
  const fillDays = [...buildDays].sort((a, b) => dayPriority[a.dayType] - dayPriority[b.dayType]
    || (b.dayCents ?? 0) - (a.dayCents ?? 0) || cmp(a.date, b.date));
  const usualDays = fillDays;
  for (const d of usualDays) for (const p of input.people.filter((p) => !p.salaried).sort((a, b) => prioritizeUsualBudget ? cmp(b.userId, a.userId) : cmp(a.userId, b.userId))) {
    if (p.workModes?.[d.date] !== "works" || !p.usualShift?.value) continue;
    const t = types.find((t) => t.id === p.usualShift!.value!.typeId);
    if (!t) { note(d.date, p.userId, "usual_type_deleted", p.usualShift.value.typeId); continue; }
    const c = candidate(p, t, d.date, "usual");
    if (c.block && preservesMod(c.block)) place(c.block, "crew_usual");
    else note(d.date, p.userId, c.rejection === "day_limit" || c.rejection === "manager_limit" ? "usual_over_cap" : c.rejection ?? "mod_reserved", t.id);
  }
  // An ample budget must not change day-cap choices or scarce-role reservations.
  // Restart only after an actual usual block was refused by the allocation's budget.
  if (usualBudgetRefused && !prioritizeUsualBudget) return buildCrewWeekAttempt(raw, true);
  function modHoles(date: string) {
    const day = ctx.days[date]!;
    if (!st.leadership.modRequired) return [] as number[];
    return Array.from({ length: day.scheduledOutQ - st.shopDay.prepStartQ }, (_, i) => st.shopDay.prepStartQ + i)
      .filter((q) => !schedule.shifts.some((sh) => sh.date === date && sh.startQ <= q && q < sh.endQ
        && roster[sh.userId] && shiftCountsAsMod(sh, roster[sh.userId]!, day, q)));
  }
  // C. Scarce MoD dates first, then highest demand: target exhaustion cannot simply drop Friday.
  const managerDays = [...buildDays].sort((a, b) => {
    const count = (date: string) => input.people.filter((p) => types.some((t) => t.countsTowardMod
      && modCountsOn(p, ctx.days[date]!, st.shopDay.prepStartQ) && !!candidate(p, t, date, "salaried").block)).length;
    return count(a.date) - count(b.date) || (b.dayCents ?? 0) - (a.dayCents ?? 0) || cmp(a.date, b.date);
  });
  for (const d of managerDays) for (const p of input.people.filter((p) => p.salaried && p.workModes?.[d.date] !== "if_needed")) {
    const own = types.find((t) => t.id === p.usualShift?.value?.typeId);
    const holes = modHoles(d.date);
    const choices = (own ? [own] : types).map((t) => ({ t, c: candidate(p, t, d.date, "salaried", holes) }))
      .sort((a, b) => {
        const score = (c: typeof a.c) => c.block ? holes.filter((q) => c.block!.type.countsTowardMod
          && c.block!.shift.startQ <= q && q < c.block!.shift.endQ && modCountsOn(p, ctx.days[d.date]!, q)).length : -1;
        return score(b.c) - score(a.c) || (a.c.block?.shift.startQ ?? 96) - (b.c.block?.shift.startQ ?? 96) || cmp(a.t.id, b.t.id);
      });
    let placed = false;
    let rejection = "no_fit";
    for (const { c } of choices) {
      if (!c.block) {
        if (!c.rejection) throw new Error("Crew candidate missing rejection");
        rejection = c.rejection; continue;
      }
      if (!preservesMod(c.block)) { rejection = "mod_reserved"; continue; }
      if (place(c.block, "salaried_minimum")) { placed = true; break; }
      // place records its precise allocation failure itself.
      rejection = "";
    }
    if (!placed && choices.length && rejection) note(d.date, p.userId, own && rejection === "manager_limit" ? "usual_over_cap" : rejection, own?.id ?? null);
  }
  // Reserve whole legal leadership blocks before seat fill. This is the MoD lookahead: a headcount
  // choice cannot consume the only remaining leader on a type that cannot cover the leadership hole.
  for (const d of managerDays) {
    while (modHoles(d.date).length) {
      const holes = modHoles(d.date);
      const candidates = input.people.flatMap((p) => types.flatMap((t) => {
        const c = candidate(p, t, d.date, "fill", holes).block;
        if (!c || !t.countsTowardMod) return [];
        const gain = holes.filter((q) => c.shift.startQ <= q && q < c.shift.endQ && modCountsOn(p, ctx.days[d.date]!, q)).length;
        return gain ? [{ block: c, gain }] : [];
      })).sort((a, b) => b.gain - a.gain || a.block.shift.startQ - b.block.shift.startQ || cmp(a.block.type.id, b.block.type.id)
        || Number(roster[a.block.shift.userId]!.salaried) - Number(roster[b.block.shift.userId]!.salaried) || cmp(a.block.shift.userId, b.block.shift.userId));
      if (!candidates.some((c) => preservesMod(c.block) && place(c.block, "mod_cover"))) break;
    }
  }
  // D/E. Target includes the catering increment once per qualifying date, by configured type ID.
  // Fill busiest days first without changing usual shifts or the prior MoD reservations.
  for (const d of fillDays) for (const t of types) {
    const count = () => ctx.days[d.date]!.crew!.shifts.filter((m) => m.typeId === t.id).length;
    const rank = (p: SchedPerson) => Math.min(2, ...t.stations.map((id) => positionRankOf(p, id)));
    const deficit = (p: SchedPerson) => Math.max(0, Math.max(p.softMinH ?? 0, p.fullTime ? p.fullTimeMinH ?? 0 : 0) - totalH(p.userId));
    const skill = (p: SchedPerson) => Math.max(0, ...t.stations.map((id) => skillOf(input.skills, p, id, st.positions[id]).value));
    const tier = (p: SchedPerson) => p.salaried ? 2 : p.workModes?.[d.date] === "if_needed" && p.usualShift?.value?.typeId === t.id ? 0 : 1;
    const candidates = [...input.people].sort((a, b) => tier(a) - tier(b) || rank(a) - rank(b) || deficit(b) - deficit(a) || skill(b) - skill(a) || cmp(a.userId, b.userId));
    for (const p of candidates) {
      if (count() >= crewRequired(t, ctx.days[d.date]!)) break;
      // A refused Step-1 usual must not be smuggled back as a trimmed fill.
      const canShorten = !p.salaried && !(p.workModes?.[d.date] === "works" && p.usualShift?.value?.typeId === t.id);
      const budgetRefused = new Set<string>();
      while (true) {
        const c = candidate(p, t, d.date, "fill", [], [], canShorten, budgetRefused);
        if (!c.block || !preservesMod(c.block)) break;
        if (place(c.block, p.salaried ? "manager_cover" : "crew_fill") || !canShorten || !lastPlaceHoursRefused) break;
        // Budget is allocation-dependent: each trial uses the normal transactional rollback.
        budgetRefused.add(`${c.block.shift.startQ}|${c.block.shift.endQ}`);
      }
    }
  }
  assignStations();
  for (const d of buildDays) {
    const sh = schedule.shifts.filter((s) => s.date === d.date && !fixed.has(key(s)) && closingManagerEligible(roster[s.userId]!, st)
      && coversClosingWindow(s, ctx.days[d.date]!)).sort((a, b) => (input.skills.closeScoreByUser[b.userId] ?? 0) - (input.skills.closeScoreByUser[a.userId] ?? 0) || order(a, b))[0];
    if (sh && !schedule.shifts.some((s) => s.date === d.date && s.closingManager)) sh.closingManager = true;
  }
  schedule.shifts.sort(order);
  const unresolved = () => ({ searched: { steps: 0, donorsTried: 0, chainDepth: 0 }, limits: { ...REPAIR_LIMITS }, candidateIds: input.people.filter((p) => p.activeMember && !neverGenerated(p)).map((p) => p.userId) });
  for (const d of buildDays) {
    const day = ctx.days[d.date]!;
    day.crew!.shifts.sort((a, b) => cmp(a.userId, b.userId) || a.startQ - b.startQ);
    for (const group of crewOpenGroups(d.date, schedule, ctx)) {
      for (const item of group.items) for (const rejected of item.rejected) {
        const type = types.find((t) => t.id === item.typeId)!;
        for (const e of crewCandidateHoursEvidence(people[rejected.userId]!, type, d.date, schedule, ctx)) {
          notes.push({ code: "crew_block_skipped", date: d.date, userId: rejected.userId, positionId: null,
            params: { reason: e.code, typeId: type.id, hours: e.hours, limit: e.limit, minLengthQ: e.minLengthQ } });
        }
      }
      const base = { code: "open_shift" as const, date: d.date, positionId: null, fromQ: group.fromQ, toQ: group.toQ };
      schedule.gaps.push(group.items.every((i) => i.rejected.every((p) => p.codes.length))
        ? { ...base, cause: "crew_shortfall", certificate: { kind: "open_shifts", items: group.items } }
        : { ...base, cause: "unresolved_search", certificate: unresolved() });
    }
    for (const id of Object.keys(day.need.positions).sort(cmp)) for (const run of crewStationShorts(d.date, id, schedule, ctx)) {
      schedule.gaps.push({ code: "coverage_gap", cause: "crew_shortfall", date: d.date, positionId: id, ...run });
    }
  }
  // The validator identifies real MoD/closing deficits; unresolved is honest when no crew proof exists.
  for (const p of checkScheduleRules(schedule, ctx)) if (!p.inherited && p.code === "undeclared_gap"
    && (p.params.gap === "mod_missing" || p.params.gap === "closing_manager_missing")) {
    const subject: GapSubject = { code: p.params.gap, date: p.day, positionId: null, fromQ: Number(p.params.fromQ), toQ: Number(p.params.toQ) };
    const earliestQ = crewEarliestModStart(st, input.people);
    if (subject.code === "mod_missing" && subject.fromQ < earliestQ) {
      const early = { ...subject, toQ: Math.min(subject.toQ, earliestQ) };
      const proof = proveGap(early, schedule, ctx);
      if (proof) {
        schedule.gaps.push({ ...early, ...proof } as DeclaredGap);
        notes.push({ code: "crew_mod_start_mismatch", date: subject.date, userId: null, positionId: null, params: { earliestQ } });
        subject.fromQ = early.toQ;
        if (subject.fromQ >= subject.toQ) continue;
      }
    }
    const proof = proveGap(subject, schedule, ctx);
    schedule.gaps.push(proof ? { ...subject, ...proof } as DeclaredGap : { ...subject, cause: "unresolved_search", certificate: unresolved() });
  }
  schedule.gaps.sort((a, b) => cmp(a.date, b.date) || cmp(a.code, b.code) || cmp(a.positionId ?? "", b.positionId ?? "") || a.fromQ - b.fromQ);
  const problems = checkScheduleRules(schedule, ctx);
  // Fixed-input errors are surfaced faithfully. No generated block is allowed to introduce a hard error.
  const hard = problems.filter((p) => !p.inherited && generatorRefuses(p));
  if (hard.length) {
    const fixedContext = structuredClone(ctx);
    const fixedShifts = schedule.shifts.filter((s) => fixed.has(key(s)));
    for (const date of built) fixedContext.days[date]!.crew!.shifts = fixedContext.days[date]!.crew!.shifts.filter((m) => fixedShifts.some((s) => s.date === date && s.userId === m.userId && s.startQ === m.startQ));
    const fixedProblems = checkScheduleRules({ ...schedule, shifts: fixedShifts, gaps: [] }, fixedContext);
    const introduced = hard.filter((p) => !fixedProblems.some((f) => f.code === p.code && f.day === p.day && f.userId === p.userId && f.positionId === p.positionId && f.q === p.q));
    if (introduced.length) throw new ScheduleError("generator_invalid_output", { params: { problems: canonicalJson(introduced) } });
  }
  for (const p of input.people) if (!p.salaried && totalH(p.userId) > st.limits.overtimeH) {
    const date = schedule.shifts.filter((s) => s.userId === p.userId && built.has(s.date)).map((s) => s.date).sort(cmp).pop();
    if (date) notes.push({ code: "overtime_used", date, userId: p.userId, positionId: null, params: { hours: totalH(p.userId), limit: st.limits.overtimeH } });
  }
  for (const sh of schedule.shifts.filter((s) => built.has(s.date))) {
    const entry = reasons[key(sh)];
    if (!fixed.has(key(sh)) || !entry) reasons[key(sh)] = {
      shift: entry?.shift ?? [reason("added_pin")],
      segments: sh.segments.map((g) => [reason(g.positionId === MOD ? "crew_unassigned" : g.reasonKey === SALARIED_FLEX_REASON ? "salaried_flex" : g.lastResort ? "manager_cover_last_resort" : "strongest_on_position", { positionId: g.positionId })]), alternates: [],
    };
  }
  const budgetedHourly = schedule.shifts.filter((s) => budgetedDates.includes(s.date) && roster[s.userId] && !roster[s.userId]!.salaried && !roster[s.userId]!.presenceOnly);
  const essentialPastBudget = Math.max(0, Math.min(budgetedHourly.filter(essential).reduce((n, s) => n + hours(s), 0), budgetedHourly.reduce((n, s) => n + hours(s), 0) - budgetHours));
  if (essentialPastBudget > 0) notes.push({ code: "essential_past_budget", date: null, userId: null, positionId: null, params: { hours: essentialPastBudget, budgetHours } });
  for (const p of input.people) if (!p.salaried && p.softMaxH !== null && totalH(p.userId) > p.softMaxH) {
    const date = schedule.shifts.filter((s) => s.userId === p.userId && built.has(s.date)).map((s) => s.date).sort(cmp).pop();
    if (date) notes.push({ code: "over_soft_max", date, userId: p.userId, positionId: null, params: { hours: totalH(p.userId), limit: p.softMaxH } });
  }
  const aggregated = new Map<string, BoardNote>();
  for (const n of notes) {
    const k = canonicalJson([n.date, n.code, n.params.reason ?? null, n.params.typeId ?? null, n.params.minLengthQ === undefined ? null : [n.userId, n.params.hours, n.params.limit, n.params.minLengthQ]]);
    const old = aggregated.get(k);
    const ids = [...new Set([...(old?.params.userIds as string[] | undefined ?? []), ...(n.userId ? [n.userId] : [])])].sort(cmp);
    aggregated.set(k, { ...(old ?? n), userId: ids.length === 1 ? ids[0]! : null, params: { ...(old ?? n).params, count: ids.length || 1, userIds: ids } });
  }
  const uniqueNotes = [...aggregated.values()].sort((a, b) => cmp(canonicalJson(a), canonicalJson(b)));
  for (const d of schedule.days) if (!d.inherited) { d.problems = problems.filter((p) => p.day === d.date); ctx.days[d.date]!.crew!.notes = uniqueNotes.filter((n) => n.date === d.date); }
  assertContextFits(ctx);
  const hourlyHoursByDate: Record<string, number> = {};
  let hourlyHours = 0, essentialHours = 0, salariedCoverHours = 0;
  let hourlyCostCents: number | null = 0;
  for (const sh of schedule.shifts) {
    const p = roster[sh.userId]; if (!p) continue;
    if (p.salaried) salariedCoverHours += sh.segments.filter((g) => g.positionId !== MOD).reduce((n, g) => n + (g.endQ - g.startQ) / 4, 0);
    else if (!p.presenceOnly) {
      hourlyHours += hours(sh); hourlyHoursByDate[sh.date] = (hourlyHoursByDate[sh.date] ?? 0) + hours(sh);
      if (essential(sh)) essentialHours += hours(sh);
      if (hourlyCostCents !== null) hourlyCostCents = p.wageCents === null ? null : hourlyCostCents + Math.round(p.wageCents * hours(sh));
    }
  }
  const strength = Object.fromEntries(buildDays.map((d) => [d.date, teamStrength(schedule.shifts, d.date, ctx.people, st, input.skills, d.dayType, d.scheduledOutQ)]));
  // Canonical object keys make ordinary JSON.stringify, not just canonicalJson, permutation invariant.
  return JSON.parse(canonicalJson({ version: CREW_GENERATOR_VERSION, shifts: schedule.shifts, days: schedule.days, gaps: schedule.gaps, reasons, notes: uniqueNotes,
    stats: { hourlyHours, hourlyHoursByDate, essentialHours, salariedCoverHours, hourlyCostCents, budgetedDates, budgetHours,
      repair: { steps: 0, donorsTried: 0, chainDepth: 0, accepted: 0, provenEarly: 0 }, shifts: schedule.shifts.length, gaps: schedule.gaps.length },
    problems, context: ctx, strength })) as GeneratorOutput;

  /** F. Deterministic augmenting matching of ON-CLOCK people only, with minimum assignment holds. */
  function assignStations(fromDate?: string) {
    const reassign = (sh: Shift) => !fixed.has(key(sh)) && (!fromDate || cmp(sh.date, fromDate) >= 0);
    // Rebuild generated segments only. Fixed evidence is never relabelled.
    for (const sh of schedule.shifts) if (reassign(sh)) sh.segments = [];
    const managers = input.people.filter((p) => p.salaried);
    const retained = schedule.shifts.filter((s) => !reassign(s));
    const fixedShifts = schedule.shifts.filter((s) => fixed.has(key(s)));
    const floorUsed = new Map(managers.map((p) => [p.userId, floorHours({ shifts: retained }, p.userId) * 4]));
    const flexUsed = new Map(managers.map((p) => [p.userId, salariedWeek({ shifts: fixedShifts }, p.userId).flexH * 4]));
    const reservedFlex = new Map(managers.map((p) => [p.userId, (flexUsed.get(p.userId) ?? 0)
      + [...blocks.values()].filter((b) => b.shift.userId === p.userId).reduce((n, b) => n + b.shift.endQ - b.flexFromQ, 0)]));
    const floorFlex = new Map<string, number>();
    for (const sh of schedule.shifts.filter((s) => !fixed.has(key(s)) && !reassign(s))) {
      const b = blocks.get(key(sh)); if (!b) continue;
      const extra = sh.segments.filter((g) => g.reasonKey === SALARIED_FLEX_REASON).reduce((n, g) => n + Math.max(0, Math.min(g.endQ, b.flexFromQ) - g.startQ), 0);
      floorFlex.set(sh.userId, (floorFlex.get(sh.userId) ?? 0) + extra);
    }
    const line = lineOrder(st);
    const boh = Object.keys(st.positions).filter((id) => !line.includes(id))
      .sort((a, b) => Number(isSecondary(st, a)) - Number(isSecondary(st, b)) || cmp(a, b));
    const positionOrder = [...line, ...boh];
    for (const d of buildDays.filter((d) => !fromDate || cmp(d.date, fromDate) >= 0)) {
      const day = ctx.days[d.date]!;
      const shifts = schedule.shifts.filter((sh) => sh.date === d.date).sort(order);
      for (let q = 0; q < 96; q++) {
        const on = shifts.filter((sh) => sh.startQ <= q && q < sh.endQ);
        const mobile = on.filter((sh) => !fixed.has(key(sh)));
        const assigned = new Map<string, Shift[]>();
        const owners = new Map<string, string>();
        const held = new Set<string>();
        const occupancy = (id: string) => (assigned.get(id)?.length ?? 0) + on.filter((sh) => fixed.has(key(sh)) && sh.segments.some((g) => g.positionId === id && g.startQ <= q && q < g.endQ)).length;
        const capacity = (id: string) => { const p = st.positions[id]!; return q < p.trimQ ? p.headsBefore : p.headsAfter; };
        const primary = (id: string) => st.priority.find((p) => p.pair.includes(id) && p.primary !== id)?.primary;
        const can = (sh: Shift, id: string) => {
          const p = roster[sh.userId]!; const b = blocks.get(key(sh))!;
          if (!legalHoldPath(p, id, day, d.date, q)) return false;
          const last = sh.segments[sh.segments.length - 1];
          const holdQ = last?.positionId === id ? 1 : st.limits.segmentMinQ;
          if (p.salaried) {
            // Reserve the ENTIRE new station hold before taking its first quarter. Otherwise
            // exhausting the floor/flex allowance mid-hold manufactures a one-quarter switch.
            const baseNeeded = Math.max(0, Math.min(q + holdQ, b.flexFromQ) - q);
            const floorRoom = Math.max(0, st.limits.managerFloorH * 4 - (floorUsed.get(p.userId) ?? 0));
            const flexRoom = Math.max(0, st.limits.salariedFlexH * 4 - (reservedFlex.get(p.userId) ?? 0) - (floorFlex.get(p.userId) ?? 0));
            if (baseNeeded > floorRoom + flexRoom) return false;
          }
          // A new assignment needs an entire legal segment; paid remainder stays unassigned.
          if (last?.positionId !== id) for (let k = q; k < q + st.limits.segmentMinQ; k++) {
            if (k >= sh.endQ || !legalHoldPath(p, id, day, d.date, k)) return false;
            const pos = st.positions[id]!;
            if ((k < pos.trimQ ? pos.headsBefore : pos.headsAfter) === 0) return false;
          }
          return true;
        };
        const put = (sh: Shift, id: string) => {
          const old = owners.get(key(sh));
          if (old) assigned.set(old, assigned.get(old)!.filter((x) => x !== sh));
          owners.set(key(sh), id); assigned.set(id, [...assigned.get(id) ?? [], sh]);
        };
        // Locked segments retain their seat before any new matching. Hard capacity/window rules win.
        for (const sh of mobile) {
          const last = sh.segments[sh.segments.length - 1];
          if (last && last.positionId !== MOD && q - last.startQ < st.limits.segmentMinQ && can(sh, last.positionId)
            && occupancy(last.positionId) < capacity(last.positionId)) { put(sh, last.positionId); held.add(key(sh)); }
        }
        // Seed all legal continuing assignments, not only minimum holds. Augmenting paths
        // may move them when coverage needs it, but equal alternatives never cause churn.
        for (const sh of mobile) {
          const last = sh.segments[sh.segments.length - 1];
          if (!owners.has(key(sh)) && last && last.positionId !== MOD && can(sh, last.positionId)
            && occupancy(last.positionId) < Math.min(capacity(last.positionId), day.need.positions[last.positionId]?.[q] ?? 0)) put(sh, last.positionId);
        }
        const rank = (sh: Shift, id: string) => positionRankOf(roster[sh.userId]!, id);
        function fill(id: string, seen: Set<string>): boolean {
          const candidates = mobile.filter((sh) => !held.has(key(sh)) && !seen.has(key(sh)) && can(sh, id))
            .sort((a, b) => rank(a, id) - rank(b, id)
              || skillOf(input.skills, roster[b.userId]!, id, st.positions[id]).value - skillOf(input.skills, roster[a.userId]!, id, st.positions[id]).value
              || Number(b.segments[b.segments.length - 1]?.positionId === id) - Number(a.segments[a.segments.length - 1]?.positionId === id) || cmp(a.userId, b.userId));
          for (const sh of candidates) {
            const old = owners.get(key(sh));
            if (old === id) continue;
            seen.add(key(sh));
            if (!old || fill(old, seen)) { put(sh, id); return true; }
          }
          return false;
        }
        for (const id of positionOrder) {
          const pri = primary(id);
          if (pri && occupancy(pri) === 0) continue;
          const target = Math.min(capacity(id), day.need.positions[id]?.[q] ?? 0);
          while (occupancy(id) < target && fill(id, new Set())) { /* one extra legal on-clock holder */ }
        }
        for (const sh of mobile) {
          const p = roster[sh.userId]!; const b = blocks.get(key(sh))!;
          let id = owners.get(key(sh)) ?? MOD;
          const pri = primary(id); if (pri && occupancy(pri) === 0) id = MOD;
          let g = id === MOD ? unassigned(q, q + 1) : segment(p, id, q, q + 1, day);
          if (p.salaried) {
            const flex = q >= b.flexFromQ || (id !== MOD && (floorUsed.get(p.userId) ?? 0) >= st.limits.managerFloorH * 4);
            if (flex) {
              g = { ...g, reasonKey: SALARIED_FLEX_REASON };
              flexUsed.set(p.userId, (flexUsed.get(p.userId) ?? 0) + 1);
              if (q < b.flexFromQ) floorFlex.set(p.userId, (floorFlex.get(p.userId) ?? 0) + 1);
            }
            else if (id !== MOD) floorUsed.set(p.userId, (floorUsed.get(p.userId) ?? 0) + 1);
          }
          const prev = sh.segments[sh.segments.length - 1];
          if (prev && prev.positionId === g.positionId && prev.reasonKey === g.reasonKey && prev.lastResort === g.lastResort && prev.endQ === q) prev.endQ++;
          else sh.segments.push(g);
        }
      }
    }
  }
}

function segment(p: RulePerson, id: string, startQ: number, endQ: number, day: DayContext): Segment {
  const path = legalHoldPath(p, id, day, "", startQ);
  return { positionId: id, startQ, endQ, ...(path !== "eligible" ? { lastResort: true } : {}),
    ...(path === "catering_cover" ? { reasonKey: CATERING_MANAGER_COVER } : {}) };
}
