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
  MOD, PROVEN_CAUSE_ORDER, REPAIR_LIMITS, checkScheduleRules, cheapestFill, closingManagerEligible, eligibleFor, proveGap, type DayRecord, type DeclaredGap, type GapSubject, type RuleProblem, type Shift,
} from "../rules-shared";
import { atDayCap, availableOn, eligibleForPosition, generatorRefuses, isManagerRole, leaderSettingAllows, maxDaysPerWeek, modCountsOn, neverGenerated, workedDates } from "../rules-shared";
import { scheduledOut, type CrewType, type ScheduleStructure } from "../structure-shared";
import { skillOf } from "../people-input-shared";
import { teamStrength, type WindowStrength } from "../strength-shared";
import { isoDowOf, weekDays } from "../time-shared";
import {
  RELAX_TIERS, allShifts, applyFill, assignClosingManager, baseWeekQuarters, budgetUsedHours, canonicalDay, cmp, coverWithCateringManager, coverWithFlexBlock, coverWithTargetFlexBlock, deficitAt, enforcePriority, extendToCap, fillRun, guarded, modHoles, fillModHole, shiftOrder, sortNotes, takeZeroCostFills, toShift,
  type BuildCtx, type GShift, type RelaxTier, type WeekState,
} from "./assign-shared";
import { deficitsOf, newCounters, repairDay, type RepairCounters } from "./repair-shared";
import { salariedBlocks, templatesFor, templateOrder } from "./templates-shared";

/** Bumped whenever a golden changes; stored on the revision. */
export const GENERATOR_VERSION = "p2.19";

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
  /**
   * Astra chunk D P2: the head's STORED reasons per shift (`date|user|start`). A carried shift keeps them exactly (SQL
   * binds them); "inherited" is the day record's flag, never a relabelled reason. Absent = the shift had none.
   */
  reasons?: Readonly<Record<string, unknown>>;
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
    ...(p.usualShift ? { usualShift: p.usualShift, workModes: p.workModes } : {}),
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

  // 2. Pins first: fixed blocks; a pin that breaks a rule on its own is dropped and reported. Astra chunk H P2-3: EVERY built
  // date's pins are placed before any generated block, so a future pin's hours are RESERVED against the salaried week target,
  // the floor and the flex (every later check sees them) — an earlier generated day can never crowd a pin out.
  for (const date of builtDates) {
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
  }

  // CC chunk H9 (spec §5.1, two days off): each hourly person's OFF days among the built dates, chosen once, after the pins.
  b.offPreferred = chooseOffDays(input.people, builtDates, allShifts(week), days, buildDays, s);
  // CC chunk H11: one repair budget for the week, from the first fill on (the partition backtrack counts its retries here).
  const counters = newCounters();
  b.counters = counters;

  // CC addendum B1 (2026-10-16): when a salaried manager's planned base blocks (after the pins, which are fixed first) would
  // pass the week target, they drop the LOWEST-demand day(s) by forecast (`dayCents`; a tie drops the later day) — never
  // simply the last days by iteration order. Leadership coverage must still hold: a day where nobody else could be the
  // manager on duty (an SL+, a KH from the shop's KH time, a pinned manager, another salaried manager's kept block) is
  // dropped only after every day where someone could.
  const weekTargetDrop = new Set<string>();
  {
    const targetQ = Math.round(s.limits.salariedTargetWeekH * 4);
    const planned = new Map<string, Array<{ date: string; startQ: number; endQ: number }>>();
    for (const date of builtDates) {
      for (const blk of salariedBlocks(input.people, s, date, days[date]!.scheduledOutQ).blocks) {
        if (week.built[date]!.some((x) => x.userId === blk.userId)) continue; // a pin holds that day
        planned.set(blk.userId, [...(planned.get(blk.userId) ?? []), { date, startQ: blk.startQ, endQ: blk.endQ }]);
      }
    }
    const cents = (date: string) => buildDays.find((d) => d.date === date)?.dayCents ?? 0;
    const holdsWithout = (userId: string, date: string): boolean => {
      const day = days[date]!;
      if (!s.leadership.modRequired) return true;
      for (let q = s.shopDay.prepStartQ; q < day.scheduledOutQ; q++) {
        const someone = input.people.some((p) => {
          if (p.userId === userId || !p.activeMember || !modCountsOn(p, day, q)) return false;
          if (week.built[date]!.some((x) => x.userId === p.userId && x.startQ <= q && x.endQ > q)) return true; // pinned there
          if (neverGenerated(p) || p.untouchableDates.includes(date)) return false;
          if (p.salaried) return !weekTargetDrop.has(`${p.userId}|${date}`) && (planned.get(p.userId) ?? []).some((x) => x.date === date && x.startQ <= q && x.endQ > q);
          return availableOn(p, date, q, q + 1);
        });
        if (!someone) return false;
      }
      return true;
    };
    for (const userId of [...planned.keys()].sort()) {
      const mine = planned.get(userId)!;
      let total = baseWeekQuarters(week, userId) + mine.reduce((n, x) => n + (x.endQ - x.startQ), 0);
      if (total <= targetQ) continue;
      const order = mine.map((x) => ({ ...x, holds: holdsWithout(userId, x.date) }))
        .sort((a, b2) => Number(!a.holds) - Number(!b2.holds) || cents(a.date) - cents(b2.date) || cmp(b2.date, a.date));
      for (const x of order) {
        if (total <= targetQ) break;
        weekTargetDrop.add(`${userId}|${x.date}`);
        total -= x.endQ - x.startQ;
      }
    }
  }

  for (const date of builtDates) {
    const day = days[date]!;
    // 3. Salaried on the clock.
    const { blocks, skipped } = salariedBlocks(input.people, s, date, day.scheduledOutQ);
    for (const blk of blocks) {
      // Juan 2026-10-16 (decision 4): the BASE plan never takes a salaried manager past the week target (40 h) — the days
      // dropped are chosen above (addendum B1); the running check stays as the invariant.
      if (weekTargetDrop.has(`${blk.userId}|${date}`) || (baseWeekQuarters(week, blk.userId) + blk.endQ - blk.startQ) / 4 > s.limits.salariedTargetWeekH) {
        notes.push({ code: "salaried_block_skipped", date, userId: blk.userId, positionId: null, params: { reason: "week_target", limitH: s.limits.salariedTargetWeekH } });
        continue;
      }
      const r = reason("salaried_minimum", { userId: blk.userId, fromQ: blk.startQ, toQ: blk.endQ });
      const kept = guarded(b, week, date, (shifts) => {
        if (shifts.some((x) => x.userId === blk.userId)) return false;
        shifts.push({ userId: blk.userId, date, startQ: blk.startQ, endQ: blk.endQ, segments: [{ positionId: MOD, startQ: blk.startQ, endQ: blk.endQ, reasons: [r] }], closingManager: false, flex: false, pinned: false, reasons: [r], origin: "salaried" });
        return true;
      });
      if (!kept) notes.push({ code: "salaried_block_skipped", date, userId: blk.userId, positionId: null, params: { reason: "conflict" } });
    }
    for (const sk of skipped) notes.push({ code: "salaried_block_skipped", date, userId: sk.userId, positionId: null, params: { reason: sk.reason } });
    // 5–7. Templates and assignment — CC chunk H9: the FIRST tier only (nobody on a chosen off day, no overtime).
    fillTemplates(date, [RELAX_TIERS[0]!], false);
  }
  // CC chunk H9 (spec §5.1, "Overtime is avoided"): each later tier runs over EVERY date before the next, so an early date never
  // spends a later date's people (a chosen off day, then overtime as the last resort — with manager cover after it, as before).
  for (let i = 1; i < RELAX_TIERS.length; i++) {
    for (const date of builtDates) fillTemplates(date, [RELAX_TIERS[i]!], i === RELAX_TIERS.length - 1);
  }

  /** Templates and assignment for one built date at the given tiers, then priority, the Closing Manager and the MoD lane. */
  function fillTemplates(date: string, tiers: readonly RelaxTier[], allowCover: boolean): void {
    const day = days[date]!;
    for (const t of templatesFor(day.need, s)) {
      let q = t.fromQ;
      while (q < t.toQ) {
        const shifts = week.built[date]!;
        const primary = s.priority.find((x) => x.pair.includes(t.positionId) && x.primary !== t.positionId)?.primary ?? null;
        const open = (x: number) => deficitAt(shifts, day, t.positionId, x) > 0 && (!primary || shifts.some((sh) => sh.segments.some((g) => g.positionId === primary && g.startQ <= x && g.endQ > x)));
        if (!open(q)) { q++; continue; }
        let stop = q + 1;
        while (stop < t.toQ && open(stop)) stop++;
        fillRun(b, week, date, t.positionId, q, stop, t, order, { allowCover, budgetStop: true, tiers });
        q = stop;
      }
    }
    // 8–10. Priority, the Closing Manager, the MoD lane.
    enforcePriority(b, week, date);
    assignClosingManager(b, week, date);
    for (const [fromQ, toQ] of modHoles(b, date, week.built[date]!)) fillModHole(b, week, date, fromQ, toQ, tiers);
  }

  // 9a. The bounded repair search, per day in order (one cap for the week; the counters started with the fill — CC chunk H11).
  // Juan 2026-10-20: from here on the build CLOSES GAPS — the position rank yields (BuildCtx.closingGaps).
  b.closingGaps = true;
  for (const date of builtDates) {
    repairDay(b, week, date, counters);
    enforcePriority(b, week, date);
    assignClosingManager(b, week, date);
  }
  // Astra chunk B P1-1 + the budget-search ruling: before any gap is declared, every legal zero-non-essential-cost fill
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

  // CC chunk D DESIGN RULING: on a budgeted date, a coverage deficit whose cheapest legal fill FOUND fits what is left
  // of the budget is not a budget gap — take that fill (relabels, extensions incl. a paired primary, a reassignment's
  // refill, a new block). Bounded: each accepted fill lowers the day's uncovered total.
  for (const date of builtDates) {
    if (!budgetedDates.includes(date)) continue;
    const cw = closingWindowByDate[date];
    for (let round = 0; round < 32; round++) {
      let progress = false;
      for (const d of deficitsOf(b, date, week.built[date]!)) {
        if (d.code !== "coverage_gap" || !d.positionId || (cw && d.fromQ < cw.toQ && d.toQ > cw.fromQ)) continue;
        const probe = { locationId: input.locationId, weekStart: input.weekStart, shifts: [...inheritedShifts, ...allShifts({ built: week.built, inherited: [] })], gaps: [] as DeclaredGap[], days: inheritedDays };
        const plan = cheapestFill({ date, positionId: d.positionId, fromQ: d.fromQ, toQ: d.toQ }, probe, ctx);
        if (!plan || (plan.hours > 0 && plan.hours > b.budgetHours - budgetUsedHours(b, week))) continue;
        if (applyFill(b, week, date, plan)) { progress = true; break; }
      }
      if (!progress) break;
    }
    enforcePriority(b, week, date);
    assignClosingManager(b, week, date);
  }

  // Juan 2026-10-16 (decision 8): the LAST resort — a catering manager on a pinned shift covers a station outside the booked
  // catering windows. Bounded: each accepted cover lowers the day's uncovered total.
  for (const date of builtDates) {
    for (let round = 0; round < 32; round++) {
      if (!deficitsOf(b, date, week.built[date]!).some((d) => d.code === "coverage_gap" && !!d.positionId && coverWithCateringManager(b, week, date, d.positionId, d.fromQ, d.toQ))) break;
    }
    enforcePriority(b, week, date);
    assignClosingManager(b, week, date);
  }

  // CC chunk H2 (2026-10-16): after EVERY other fill (hourly, zero-cost, the catering manager), before any gap is declared —
  // a salaried manager covers an otherwise-uncovered window on a FLEX block (no hourly cost). Bounded: each accepted block
  // lowers the day's uncovered total. CC chunk H3: each round tries the PREFERRED fill first, then the TARGET-DIRECTED reach
  // for every remaining coverage deficit (the same search the floor_limit proof re-runs), so a deficit the generator leaves
  // is one no legal flex block reaches.
  for (const date of builtDates) {
    for (let round = 0; round < 32; round++) {
      if (coverWithFlexBlock(b, week, date)) continue;
      if (!deficitsOf(b, date, week.built[date]!).some((d) => coverWithTargetFlexBlock(b, week, date, d))) break;
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
  // CC addendum A: the generator never outputs an over-target or past-flex salaried week either (warnings for a person, hard here).
  const invalid = problems.filter((p) => !p.inherited && generatorRefuses(p));
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
        && !p.untouchableDates.includes(date) && leaderSettingAllows(p, s, sh.startQ, sh.endQ) && !atDayCap(p, { shifts }, date, maxDaysPerWeek(s))
        && sh.segments.every((g) => g.positionId === MOD ? isManagerRole(p.role) : eligibleForPosition(p, s.positions[g.positionId])))
        .map((p) => ({ userId: p.userId, skill: Math.round(Math.max(...sh.segments.filter((g) => g.positionId !== MOD).map((g) => skillOf(input.skills, p, g.positionId, s.positions[g.positionId]).value), 0) * 1000) / 1000 }))
        .sort((x, y) => y.skill - x.skill || cmp(x.userId, y.userId)).slice(0, 3);
      const entry: ShiftReasons = { shift: sh.reasons, segments: sh.segments.map((g) => g.reasons), alternates };
      reasons[shiftKey(date, sh.userId, sh.startQ)] = entry;
    }
  }
  // Astra chunk D P2: a carried shift keeps its ORIGINAL reasons (bound in SQL); "inherited" is the day's flag.
  for (const sh of inheritedShifts) {
    const k = shiftKey(sh.date, sh.userId, sh.startQ);
    const stored = input.head?.reasons?.[k];
    if (stored !== undefined && stored !== null) reasons[k] = structuredClone(stored) as ShiftReasons;
  }
  const strength: Record<string, WindowStrength[]> = {};
  for (const d of buildDays) strength[d.date] = teamStrength(builtShifts, d.date, ctx.people, s, input.skills, d.dayType, d.scheduledOutQ);
  // CC chunk H9: `overtime_used` names a week that ENDS past the threshold — a later repair move (a donor leaving a block) can take
  // the hours away again, and a note about overtime nobody works would be a false claim.
  const weekHoursOf = (userId: string) => shifts.filter((x) => x.userId === userId).reduce((n, x) => n + (x.endQ - x.startQ), 0) / 4;
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i]!;
    if (n.code === "overtime_used" && n.userId && weekHoursOf(n.userId) <= s.limits.overtimeH) notes.splice(i, 1);
  }
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

/**
 * CC chunk H9 (2026-10-17, spec §5.1 "two days off"): the OFF days of every active hourly person the generator places. A person
 * whose open dates (built, available, not untouchable, no shift yet) exceed what the cap leaves (`maxDaysPerWeek` − the
 * dates they already work: inherited days and pins) gets exactly that many off days, picked in this order:
 *   1. their LOWEST-OBSERVED weekdays from Toast punches (`observedDowShare`; a weekday without evidence counts as 1);
 *   1b. for a person who can carry a ROLE rule (the Closing Manager; the manager on duty, Shift Lead and up), the dates where
 *      MORE such people are still open, so the role is never left with nobody on one date;
 *   2. the LOWEST-DEMAND dates — the date's required head-quarters (the need grid) per person still open that date, so off days
 *      spread instead of piling onto one date;
 *   3. the date's forecast (`dayCents`, none = 0), then a per-person rotation of the weekday (deterministic, spreads ties).
 * People go in id order; every input is canonical, so the result is permutation-invariant.
 */
function chooseOffDays(
  people: readonly SchedPerson[], builtDates: readonly string[], shifts: readonly Shift[], days: Record<string, DayContext>, buildDays: readonly BuildDayInput[], s: ScheduleStructure,
): Record<string, ReadonlySet<string>> {
  const limit = maxDaysPerWeek(s);
  const needQ: Record<string, number> = {};
  for (const d of builtDates) needQ[d] = Object.values(days[d]!.need.positions).reduce((n, arr) => n + arr.reduce((a, x) => a + x, 0), 0);
  const cents = (d: string) => buildDays.find((x) => x.date === d)?.dayCents ?? 0;
  const eligible = people.filter((p) => !p.salaried && !p.presenceOnly && p.activeMember && !neverGenerated(p));
  const openOf = (p: SchedPerson) => {
    const worked = workedDates({ shifts }, p.userId);
    return { worked, open: builtDates.filter((d) => !worked.has(d) && p.availability[d] !== null && !p.untouchableDates.includes(d)) };
  };
  const openCount: Record<string, number> = Object.fromEntries(builtDates.map((d) => [d, 0]));
  const cmOpen: Record<string, number> = Object.fromEntries(builtDates.map((d) => [d, 0]));
  const modOpen: Record<string, number> = Object.fromEntries(builtDates.map((d) => [d, 0]));
  const isCm = (p: SchedPerson) => closingManagerEligible(p, s);
  const isMod = (p: SchedPerson) => isManagerRole(p.role);
  for (const p of eligible) for (const d of openOf(p).open) { openCount[d]!++; if (isCm(p)) cmOpen[d]!++; if (isMod(p)) modOpen[d]!++; }
  const out: Record<string, ReadonlySet<string>> = {};
  eligible.forEach((p, idx) => {
    const { worked, open } = openOf(p);
    const k = open.length - Math.max(0, limit - worked.size);
    if (k <= 0) return;
    const dowOf = (d: string) => builtDates.indexOf(d);
    const share = (d: string) => p.observedDowShare?.[isoDowOf(d)] ?? 1;
    const ranked = [...open].sort((a, z) => share(a) - share(z)
      || (isCm(p) ? cmOpen[z]! - cmOpen[a]! : 0) || (isMod(p) ? modOpen[z]! - modOpen[a]! : 0)
      || needQ[a]! / Math.max(1, openCount[a]!) - needQ[z]! / Math.max(1, openCount[z]!)
      || cents(a) - cents(z)
      || (dowOf(a) + idx) % 7 - (dowOf(z) + idx) % 7 || cmp(a, z));
    const off = new Set(ranked.slice(0, k));
    for (const d of off) {
      openCount[d] = Math.max(0, openCount[d]! - 1);
      if (isCm(p)) cmOpen[d] = Math.max(0, cmOpen[d]! - 1);
      if (isMod(p)) modOpen[d] = Math.max(0, modOpen[d]! - 1);
    }
    out[p.userId] = off;
  });
  // Manager-set If needed days are fallback days regardless of how many dates are available.
  for (const p of people) {
    if (p.offPreferredDates?.length) out[p.userId] = new Set([...(out[p.userId] ?? []), ...p.offPreferredDates.filter((d) => builtDates.includes(d))]);
  }
  return out;
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]!]));
}

/** The gap causes in their fixed order, re-exported for the goldens' assertions. */
export { PROVEN_CAUSE_ORDER };
export { toShift };
