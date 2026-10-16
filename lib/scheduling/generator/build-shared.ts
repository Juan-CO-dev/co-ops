/**
 * `buildWeek` — THE GENERATOR (Scheduling Phase 2, Task 7; plan "The generator" steps 1–11), pure.
 *
 * Same input ⇒ byte-identical output, and any permutation of the input arrays ⇒ the same output: every
 * array is canonicalised on entry, every iteration runs over sorted keys, no Date, no random, no locale.
 *
 *  1. The historical-preservation contract: days before `today`, and days outside the build range, are
 *     copied from the head UNCHANGED (shifts, day record, gaps), marked inherited, never re-judged.
 *  2. Pins first: presence / added blocks become fixed shifts.
 *  3. Salaried on the clock: each GM / AGM not off gets a MoD block (role minimum, leader anchor).
 *  3a/4. The need: chunk A's `buildDayNeed` per built day (the curve → shape, the need grid).
 *  5–7. Templates in the mockup's order; assignment per deficit run (skill-weighted, guardrails, the 4 h
 *     minimum by extension or a multi-position segment, the budget stop, manager cover within the floor).
 *  8. Priority enforcement.  9. The Closing Manager.  10. The MoD lane.
 *  9a. The bounded repair search before any non-proven gap is declared.
 * 11. Merge, canonicalise, declare every remaining deficit with the FIRST proven cause (structure,
 *     eligibility, capacity, availability, floor_limit, budget) else `unresolved_search` with the search
 *     counters — then `checkScheduleRules` as an INVARIANT: valid input never throws; a NEW error-class
 *     problem or a certificate that fails to verify is a programmer error (`generator_invalid_output`).
 */
import { canonicalJson, type DayContext, type DayInputs, type RuleContext, type RulePerson } from "../context-shared";
import { ScheduleError } from "../errors-shared";
import { buildDayNeed, type NeedCatering } from "../need-shared";
import type { SchedPerson, SkillLookup } from "../people-input-shared";
import { reason, shiftKey, type BoardNote, type ReasonIndex, type ShiftReasons } from "../reasons-shared";
import {
  MOD, PROVEN_CAUSE_ORDER, REPAIR_LIMITS, checkScheduleRules, eligibleFor, proveGap, type DayRecord, type DeclaredGap, type GapSubject, type RuleProblem, type Shift,
} from "../rules-shared";
import { availableOn, eligibleForPosition, isManagerRole, leaderSettingAllows } from "../rules-shared";
import { scheduledOut, type CrewType, type ScheduleStructure } from "../structure-shared";
import { skillOf } from "../people-input-shared";
import { teamStrength, type WindowStrength } from "../strength-shared";
import { weekDays } from "../time-shared";
import {
  allShifts, assignClosingManager, canonicalDay, cmp, deficitAt, enforcePriority, extendToCap, fillRun, guarded, modHoles, fillModHole, shiftOrder, sortNotes, takeZeroCostFills, toShift,
  type BuildCtx, type GShift, type WeekState,
} from "./assign-shared";
import { deficitsOf, newCounters, repairDay, type RepairCounters } from "./repair-shared";
import { salariedBlocks, templatesFor, templateOrder } from "./templates-shared";

/** Bumped whenever a golden changes; stored on the revision. */
export const GENERATOR_VERSION = "p2.1";

// ─── Input / output ──────────────────────────────────────────────────────────

export interface BuildDayInput {
  date: string;
  dayType: CrewType;
  dayTypeSource: DayInputs["dayTypeSource"];
  overrideId: string | null;
  closingMinutes: number;
  scheduledOutQ: number;
  demandKind: "ok" | "no_history";
  hourlyCents: number[] | null;
  dayCents: number | null;
  catering: NeedCatering[];
}

export interface Pin { id: string; date: string; userId: string; startQ: number; endQ: number; positions: string[]; kind: "presence" | "added" }

export interface HeadSnapshot {
  revisionId: string;
  shifts: Shift[];
  days: DayRecord[];
  gaps: DeclaredGap[];
  closingWindowByDate: Record<string, { fromQ: number; toQ: number }>;
}

export interface GeneratorInput {
  locationId: string;
  weekStart: string;
  today: string;
  days: BuildDayInput[];
  structure: ScheduleStructure;
  structureVersionId: string;
  people: SchedPerson[];
  skills: SkillLookup;
  pins: Pin[];
  budgetByDate: Record<string, number | null>;
  head: HeadSnapshot | null;
}

export interface GeneratorStats {
  hourlyHours: number;
  hourlyHoursByDate: Record<string, number>;
  essentialHours: number;
  salariedCoverHours: number;
  hourlyCostCents: number | null;
  budgetedDates: string[];
  budgetHours: number;
  repair: RepairCounters;
  shifts: number;
  gaps: number;
}

export interface GeneratorOutput {
  version: string;
  shifts: Shift[];
  days: DayRecord[];
  gaps: DeclaredGap[];
  reasons: ReasonIndex;
  notes: BoardNote[];
  stats: GeneratorStats;
  problems: RuleProblem[];
  context: RuleContext;
  strength: Record<string, WindowStrength[]>;
}

// ─── Canonical input ─────────────────────────────────────────────────────────

function toRulePerson(p: SchedPerson): RulePerson {
  return {
    userId: p.userId, role: p.role, activeMember: p.activeMember, workType: p.workType, alsoAllowed: [...p.alsoAllowed].sort(), leaderSetting: p.leaderSetting,
    coverPositions: [...p.coverPositions], salaried: p.salaried, presenceOnly: p.presenceOnly, softMinH: p.softMinH, softMaxH: p.softMaxH,
    availability: Object.fromEntries(Object.keys(p.availability).sort().map((d) => [d, p.availability[d] ?? null])),
    flexDates: [...p.flexDates].sort(), untouchableDates: [...p.untouchableDates].sort(), newerPositions: [...p.newerPositions].sort(), strongPositions: [...p.strongPositions].sort(),
  };
}

function canonicalInput(input: GeneratorInput): GeneratorInput {
  return {
    ...input,
    days: [...input.days].sort((a, b) => cmp(a.date, b.date)).map((d) => ({ ...d, catering: [...d.catering].sort((a, b) => cmp(a.id, b.id)) })),
    people: [...input.people].sort((a, b) => cmp(a.userId, b.userId)),
    pins: [...input.pins].sort((a, b) => cmp(a.date, b.date) || cmp(a.userId, b.userId) || a.startQ - b.startQ || cmp(a.id, b.id)),
  };
}

/** Top-quartile demand quarters of a day (by the hour's cents over the open hours), plus the closing window. */
function busiestQuarters(day: BuildDayInput, s: ScheduleStructure): Set<number> {
  const out = new Set<number>();
  for (let q = s.shopDay.serviceCloseQ; q < day.scheduledOutQ; q++) out.add(q);
  if (day.demandKind !== "ok" || !day.hourlyCents) return out;
  const open: number[] = [];
  for (let h = Math.floor(s.shopDay.serviceStartQ / 4); h < Math.ceil(s.shopDay.serviceCloseQ / 4); h++) open.push(day.hourlyCents[h] ?? 0);
  if (open.length === 0) return out;
  const sorted = [...open].sort((a, b) => a - b);
  const p75 = sorted[Math.max(0, Math.ceil(0.75 * sorted.length) - 1)]!;
  if (p75 <= 0) return out;
  for (let h = Math.floor(s.shopDay.serviceStartQ / 4); h < Math.ceil(s.shopDay.serviceCloseQ / 4); h++) {
    if ((day.hourlyCents[h] ?? 0) >= p75) for (let q = h * 4; q < h * 4 + 4; q++) if (q >= s.shopDay.serviceStartQ && q < s.shopDay.serviceCloseQ) out.add(q);
  }
  return out;
}

// ─── buildWeek ───────────────────────────────────────────────────────────────

export function buildWeek(raw: GeneratorInput): GeneratorOutput {
  const input = canonicalInput(raw);
  const s = input.structure;
  const dates = weekDays(input.weekStart);
  const notes: BoardNote[] = [];
  const buildDays = input.days.filter((d) => dates.includes(d.date) && d.date >= input.today);
  const builtDates = buildDays.map((d) => d.date);
  const people: Record<string, SchedPerson> = Object.fromEntries(input.people.map((p) => [p.userId, p]));

  // 1. Inherited days: copied from the head unchanged (or empty), never re-judged.
  const inheritedShifts: Shift[] = [];
  const inheritedDays: DayRecord[] = [];
  const inheritedGaps: DeclaredGap[] = [];
  for (const date of dates) {
    if (builtDates.includes(date)) continue;
    const head = input.head;
    const rec = head?.days.find((d) => d.date === date);
    inheritedDays.push(rec ? { ...rec, inherited: true, problems: rec.problems.map((p) => ({ ...p, inherited: true })) } : { date, originRevisionId: null, structureVersionId: input.structureVersionId, inherited: true, problems: [] });
    if (head) {
      inheritedShifts.push(...head.shifts.filter((x) => x.date === date).map((x) => structuredClone(x)));
      inheritedGaps.push(...head.gaps.filter((g) => g.date === date).map((g) => structuredClone(g)));
    }
  }

  // 3a/4. The need per built day → the rule context (the snapshot the revision stores).
  const days: Record<string, DayContext> = {};
  const closingWindowByDate: Record<string, { fromQ: number; toQ: number }> = {};
  for (const d of buildDays) {
    const { need, shape } = buildDayNeed({ structure: s, dayType: d.dayType, scheduledOutQ: d.scheduledOutQ, hourlyCents: d.hourlyCents, demandKind: d.demandKind, catering: d.catering });
    days[d.date] = {
      structureVersionId: input.structureVersionId, structure: s, dayType: d.dayType, closingMinutes: d.closingMinutes, scheduledOutQ: d.scheduledOutQ, need,
      inputs: { demandKind: d.demandKind, hourlyCents: d.hourlyCents, dayCents: d.dayCents, dayTypeSource: d.dayTypeSource, overrideId: d.overrideId, cateringEvents: d.catering.map((c) => ({ id: c.id, headcount: c.headcount, eventQ: c.eventQ })) },
    };
    closingWindowByDate[d.date] = { fromQ: s.shopDay.serviceCloseQ, toQ: d.scheduledOutQ };
    if (shape.note !== "normal") notes.push({ code: shape.note, date: d.date, userId: null, positionId: null, params: { targetHours: shape.targetHours, lineHours: shape.lineHours } });
    if (shape.rushMoved) notes.push({ code: "rush_moved", date: d.date, userId: null, positionId: null, params: { rushQ: shape.rushQ, configuredQ: s.crews[d.dayType].waves.rush.atQ } });
    if (d.demandKind === "no_history") notes.push({ code: "no_history", date: d.date, userId: null, positionId: null, params: {} });
  }
  for (const date of dates) {
    if (closingWindowByDate[date]) continue;
    closingWindowByDate[date] = input.head?.closingWindowByDate[date] ?? { fromQ: s.shopDay.serviceCloseQ, toQ: scheduledOut(s, s.limits.closingMinutesOverride ?? 45) };
  }
  const budgetByDate: Record<string, number | null> = Object.fromEntries(dates.map((d) => [d, input.budgetByDate[d] ?? null]));
  const budgetedDates = dates.filter((d) => budgetByDate[d] !== null);
  for (const d of builtDates) if (budgetByDate[d] === null) notes.push({ code: "unbudgeted_date", date: d, userId: null, positionId: null, params: {} });
  const ctx: RuleContext = {
    version: 1, locationId: input.locationId, weekStart: input.weekStart, today: input.today, dates, days, budgetByDate, closingWindowByDate,
    people: Object.fromEntries(input.people.map((p) => [p.userId, toRulePerson(p)])),
  };
  const busiest: Record<string, Set<number>> = Object.fromEntries(buildDays.map((d) => [d.date, busiestQuarters(d, s)]));
  const b: BuildCtx = {
    ctx, structure: s, people, lookup: input.skills, budgetedDates, budgetHours: budgetedDates.reduce((n, d) => n + (budgetByDate[d] ?? 0), 0), busiest, notes, pinCover: {},
  };
  const week: WeekState = { built: Object.fromEntries(builtDates.map((d) => [d, [] as GShift[]])), inherited: inheritedShifts };
  const order = templateOrder(s);

  for (const date of builtDates) {
    const day = days[date]!;
    // 2. Pins first: fixed blocks; a pin that breaks a rule on its own is dropped and reported.
    for (const pin of input.pins.filter((p) => p.date === date)) {
      const p = people[pin.userId];
      if (!p || pin.endQ <= pin.startQ) continue;
      const first = pin.positions.find((id) => !!s.positions[id] && eligibleForPosition(p, s.positions[id]!));
      const positionId = pin.kind === "presence" || !first ? MOD : first;
      const r = reason(pin.kind === "presence" ? "presence_pin" : "added_pin", { pinId: pin.id, userId: pin.userId, fromQ: pin.startQ, toQ: pin.endQ });
      const kept = guarded(b, week, date, (shifts) => {
        if (shifts.some((x) => x.userId === pin.userId)) return false;
        shifts.push({ userId: pin.userId, date, startQ: pin.startQ, endQ: pin.endQ, segments: [{ positionId, startQ: pin.startQ, endQ: pin.endQ, reasons: [r] }], closingManager: false, flex: false, pinned: true, reasons: [r], origin: "pin" });
        return true;
      });
      if (kept) { if (positionId === MOD && (isManagerRole(p.role) || p.presenceOnly)) b.pinCover[shiftKey(date, pin.userId, pin.startQ)] = pin.positions.length ? pin.positions : "any"; }
      else notes.push({ code: "salaried_block_skipped", date, userId: pin.userId, positionId: null, params: { pinId: pin.id, reason: "pin_conflict" } });
    }
    // 3. Salaried on the clock.
    const { blocks, skipped } = salariedBlocks(input.people, s, date, day.scheduledOutQ);
    for (const blk of blocks) {
      const r = reason("salaried_minimum", { userId: blk.userId, fromQ: blk.startQ, toQ: blk.endQ });
      const kept = guarded(b, week, date, (shifts) => {
        if (shifts.some((x) => x.userId === blk.userId)) return false;
        shifts.push({ userId: blk.userId, date, startQ: blk.startQ, endQ: blk.endQ, segments: [{ positionId: MOD, startQ: blk.startQ, endQ: blk.endQ, reasons: [r] }], closingManager: false, flex: false, pinned: false, reasons: [r], origin: "salaried" });
        return true;
      });
      if (!kept) notes.push({ code: "salaried_block_skipped", date, userId: blk.userId, positionId: null, params: { reason: "conflict" } });
    }
    for (const sk of skipped) notes.push({ code: "salaried_block_skipped", date, userId: sk.userId, positionId: null, params: { reason: sk.reason } });
    // 5–7. Templates and assignment.
    for (const t of templatesFor(day.need, s)) {
      let q = t.fromQ;
      while (q < t.toQ) {
        const shifts = week.built[date]!;
        const primary = s.priority.find((x) => x.pair.includes(t.positionId) && x.primary !== t.positionId)?.primary ?? null;
        const open = (x: number) => deficitAt(shifts, day, t.positionId, x) > 0 && (!primary || shifts.some((sh) => sh.segments.some((g) => g.positionId === primary && g.startQ <= x && g.endQ > x)));
        if (!open(q)) { q++; continue; }
        let stop = q + 1;
        while (stop < t.toQ && open(stop)) stop++;
        fillRun(b, week, date, t.positionId, q, stop, t, order, { allowCover: true, budgetStop: true });
        q = stop;
      }
    }
    // 8–10. Priority, the Closing Manager, the MoD lane.
    enforcePriority(b, week, date);
    assignClosingManager(b, week, date);
    for (const [fromQ, toQ] of modHoles(b, date, week.built[date]!)) fillModHole(b, week, date, fromQ, toQ);
  }

  // 9a. The bounded repair search, per day in order (one cap for the week).
  const counters = newCounters();
  for (const date of builtDates) {
    repairDay(b, week, date, counters);
    enforcePriority(b, week, date);
    assignClosingManager(b, week, date);
  }
  // Astra chunk B P1-1 + the hoursNeeded ruling: before any gap is declared, every legal zero-non-essential-cost fill
  // is taken (salaried MoD cover, a spare reassignment, an essential closer's extension) — a budget certificate is
  // refused while one exists, and a free fill should never sit beside a hole.
  for (const date of builtDates) {
    takeZeroCostFills(b, week, date, () => deficitsOf(b, date, week.built[date]!));
    enforcePriority(b, week, date);
    assignClosingManager(b, week, date);
  }

  // CC chunk C ruling 2: where only the daily maximum stops a shift reaching a deficit that NO proven cause certifies
  // (it would be declared unresolved_search), extend that shift up to the cap, so the remainder is exactly the cap's
  // (the `max_shift` counting bound certifies it). A deficit already proven (budget, availability, …) is left as it
  // is. Bounded: each step lowers the uncovered total.
  const unproven = (date: string, d: { code: GapSubject["code"]; positionId: string | null; fromQ: number; toQ: number }) => {
    const probe = { locationId: input.locationId, weekStart: input.weekStart, shifts: [...inheritedShifts, ...allShifts({ built: week.built, inherited: [] })], gaps: [] as DeclaredGap[], days: inheritedDays };
    return proveGap({ code: d.code, date, positionId: d.positionId, fromQ: d.fromQ, toQ: d.toQ }, probe, ctx) === null;
  };
  for (const date of builtDates) {
    for (let round = 0; round < 32; round++) {
      if (!deficitsOf(b, date, week.built[date]!).some((d) => unproven(date, d) && extendToCap(b, week, date, d))) break;
    }
    enforcePriority(b, week, date);
    assignClosingManager(b, week, date);
  }

  // 11. Merge, canonicalise, declare, verify.
  for (const date of builtDates) week.built[date] = canonicalDay(week.built[date]!);
  const builtShifts = allShifts({ built: week.built, inherited: [] });
  const shifts = [...inheritedShifts, ...builtShifts].sort(shiftOrder);
  const gaps: DeclaredGap[] = [...inheritedGaps];
  const schedule = { locationId: input.locationId, weekStart: input.weekStart, shifts, gaps: [] as DeclaredGap[], days: inheritedDays };
  for (const date of builtDates) {
    for (const d of deficitsOf(b, date, week.built[date]!)) {
      const subject: GapSubject = { code: d.code, date, positionId: d.positionId, fromQ: d.fromQ, toQ: d.toQ };
      const proof = proveGap(subject, schedule, ctx);
      if (proof) gaps.push({ ...subject, cause: proof.cause, certificate: proof.certificate } as DeclaredGap);
      else {
        const day = days[date]!;
        const candidateIds = Object.values(ctx.people).filter((p) => eligibleFor(p, d.code, d.positionId, s, d.fromQ)).map((p) => p.userId).sort();
        gaps.push({
          ...subject, cause: "unresolved_search",
          certificate: {
            searched: { steps: counters.steps, donorsTried: counters.donorsTried, chainDepth: counters.steps >= REPAIR_LIMITS.REPAIR_MAX_STEPS ? counters.chainDepth : REPAIR_LIMITS.maxChainDepth },
            limits: { ...REPAIR_LIMITS }, candidateIds,
          },
        });
        void day;
      }
    }
  }
  gaps.sort((a, b2) => cmp(a.date, b2.date) || cmp(a.code, b2.code) || cmp(a.positionId ?? "", b2.positionId ?? "") || a.fromQ - b2.fromQ);
  const problems = checkScheduleRules({ ...schedule, gaps }, ctx);
  const invalid = problems.filter((p) => !p.inherited && p.severity === "error");
  if (invalid.length > 0) {
    throw new ScheduleError("generator_invalid_output", { params: { count: invalid.length, first: canonicalJson(invalid[0]) } });
  }
  const dayRecords: DayRecord[] = dates.map((date) => {
    const inh = inheritedDays.find((d) => d.date === date);
    if (inh) return inh;
    return { date, originRevisionId: null, structureVersionId: input.structureVersionId, inherited: false, problems: problems.filter((p) => p.day === date) };
  });

  // Reasons, alternates, strength, stats.
  const reasons: ReasonIndex = {};
  for (const date of builtDates) {
    for (const sh of week.built[date]!) {
      // Astra chunk B P3: the same eligibility a placement needs — the whole shift inside their availability, no
      // untouchable day, their leader setting, the daily maximum (the shift is already within it), every segment.
      const alternates = Object.values(people).filter((p) => p.userId !== sh.userId && !p.salaried && !p.presenceOnly && p.activeMember
        && !week.built[date]!.some((x) => x.userId === p.userId) && availableOn(p, date, sh.startQ, sh.endQ)
        && !p.untouchableDates.includes(date) && leaderSettingAllows(p, s, sh.startQ, sh.endQ)
        && sh.segments.every((g) => g.positionId === MOD ? isManagerRole(p.role) : eligibleForPosition(p, s.positions[g.positionId])))
        .map((p) => ({ userId: p.userId, skill: Math.round(Math.max(...sh.segments.filter((g) => g.positionId !== MOD).map((g) => skillOf(input.skills, p, g.positionId, s.positions[g.positionId]).value), 0) * 1000) / 1000 }))
        .sort((x, y) => y.skill - x.skill || cmp(x.userId, y.userId)).slice(0, 3);
      const entry: ShiftReasons = { shift: sh.reasons, segments: sh.segments.map((g) => g.reasons), alternates };
      reasons[shiftKey(date, sh.userId, sh.startQ)] = entry;
    }
  }
  for (const sh of inheritedShifts) reasons[shiftKey(sh.date, sh.userId, sh.startQ)] = { shift: [reason("inherited", {})], segments: sh.segments.map(() => []), alternates: [] };
  const strength: Record<string, WindowStrength[]> = {};
  for (const d of buildDays) strength[d.date] = teamStrength(builtShifts, d.date, ctx.people, s, input.skills, d.dayType, d.scheduledOutQ);
  // Pairing notes come from the validator's warnings too (the final word).
  for (const p of problems) if (p.code === "pairing_unmet" && !p.inherited) notes.push({ code: "pairing_unmet", date: p.day, userId: p.userId ?? null, positionId: p.positionId ?? null, params: { q: p.q ?? null } });

  const hourlyHoursByDate: Record<string, number> = {};
  let hourlyHours = 0;
  let essentialHours = 0;
  let salariedCoverHours = 0;
  let cost: number | null = 0;
  for (const sh of shifts) {
    const p = people[sh.userId];
    if (!p) continue;
    const h = (sh.endQ - sh.startQ) / 4;
    if (!p.salaried && !p.presenceOnly) {
      hourlyHours += h;
      hourlyHoursByDate[sh.date] = (hourlyHoursByDate[sh.date] ?? 0) + h;
      const cw = closingWindowByDate[sh.date];
      if (cw && sh.segments.some((g) => g.positionId !== MOD && g.startQ < cw.toQ && g.endQ > cw.fromQ)) essentialHours += h;
      if (cost !== null) cost = p.wageCents === null ? null : cost + Math.round(p.wageCents * h);
    } else if (p.salaried) {
      salariedCoverHours += sh.segments.filter((g) => g.positionId !== MOD).reduce((n, g) => n + (g.endQ - g.startQ), 0) / 4;
    }
  }
  // CC chunk C ruling 3: essential closer hours are EXEMPT from the budget cap (never refused for budget) but COUNTED in
  // every total; when they carry the budgeted dates past the budget the board names it: "essential hours past budget: X h".
  if (budgetedDates.length > 0) {
    let usedB = 0;
    let essB = 0;
    for (const sh of shifts) {
      const p = people[sh.userId];
      if (!p || p.salaried || p.presenceOnly || !budgetedDates.includes(sh.date)) continue;
      const h = (sh.endQ - sh.startQ) / 4;
      usedB += h;
      const cw = closingWindowByDate[sh.date];
      if (cw && sh.segments.some((g) => g.positionId !== MOD && g.startQ < cw.toQ && g.endQ > cw.fromQ)) essB += h;
    }
    const past = Math.max(0, Math.min(essB, usedB - b.budgetHours));
    if (past > 0) notes.push({ code: "essential_past_budget", date: null, userId: null, positionId: null, params: { hours: past, budgetHours: b.budgetHours } });
  }
  const stats: GeneratorStats = {
    hourlyHours, hourlyHoursByDate: Object.fromEntries(Object.keys(hourlyHoursByDate).sort().map((k) => [k, hourlyHoursByDate[k]!])), essentialHours, salariedCoverHours,
    hourlyCostCents: cost, budgetedDates, budgetHours: b.budgetHours, repair: counters, shifts: shifts.length, gaps: gaps.length,
  };
  return { version: GENERATOR_VERSION, shifts, days: dayRecords, gaps, reasons: sortKeys(reasons), notes: sortNotes(notes), stats, problems, context: ctx, strength };
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]!]));
}

/** The gap causes in their fixed order, re-exported for the goldens' assertions. */
export { PROVEN_CAUSE_ORDER };
export { toShift };
