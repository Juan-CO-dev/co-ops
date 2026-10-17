/**
 * ASSIGNMENT — the generator's working state and every placement primitive (Scheduling Phase 2, Task 7;
 * plan "The generator" steps 2–10).
 *
 * The rule that makes everything else safe: EVERY mutation of a day goes through `guarded`, which applies
 * it to a copy, runs the real validator over that day (with the week's other shifts for the weekly totals)
 * and keeps the change only when it adds NO error-class problem. Valid input therefore never produces an
 * error-class problem by construction; the final `checkScheduleRules` in `buildWeek` is an invariant, not
 * a hope. Gap-class problems are expected while building and are judged by the repair pass.
 *
 * Primitives, in the mockup's order: `planBlock` (a deficit run extended to the minimum shift inside the
 * position's window, then into the next needed position — a multi-position segment), `rankCandidates`
 * (skill-weighted with guardrails: the busiest windows by skill, elsewhere most-under-soft-min first;
 * overtime skipped unless nobody else fits; full-timers below their minimum pulled forward; the pairing
 * tie-break; ties to the lower userId), `fillRun` (insert a free person, or extend their own shift that
 * day, else a salaried manager's cover carved out of their MoD block within the floor limit), the priority
 * relabel, the Closing Manager, and the MoD lane fill. Determinism: no Date, no random, every iteration
 * over sorted arrays, ids compared with `<`.
 */
import type { DayContext, RuleContext, RulePerson } from "../context-shared";
import { closeScore, skillOf, type SchedPerson, type SkillLookup } from "../people-input-shared";
import { noteOrder, reason, type BoardNote, type Reason } from "../reasons-shared";
import type { FillPlan, FillStep } from "../rules-shared";
import {
  CATERING_MANAGER_COVER, MOD, REPAIR_LIMITS, SALARIED_FLEX_REASON, atDayCap, availableOn, maxDaysPerWeek, baseFloorRoomQ, cateringWindows, splitSalariedRelabel, checkScheduleRules, closingManagerEligible, coversClosingWindow, eligibleForPosition,
  flexLeftQ, generatorRefuses, isFlexSegment, isManagerRole, leaderSettingAllows, modCountsAt, modCountsOn, neverGenerated, salariedFlexBlocks, flexBlockReaching, shiftExtendsOver, zeroCostCovers,
  type DayRecord, type FlexBlock, type RuleProblem, type Segment, type Shift,
} from "../rules-shared";
import { isLineRole, isSecondary, positionLimit, primaryOf, type ScheduleStructure } from "../structure-shared";
import { Q_PER_DAY } from "../time-shared";
import type { Template } from "./templates-shared";

// ─── State ───────────────────────────────────────────────────────────────────

export interface GSegment extends Segment { reasons: Reason[] }
export type ShiftOrigin = "pin" | "salaried" | "hourly" | "inherited";
export interface GShift extends Omit<Shift, "segments"> { segments: GSegment[]; reasons: Reason[]; origin: ShiftOrigin }

/** The week being built: the built days' shifts (mutable) and the inherited shifts (fixed). */
export interface WeekState { built: Record<string, GShift[]>; inherited: Shift[] }

export interface BuildCtx {
  ctx: RuleContext;
  structure: ScheduleStructure;
  people: Record<string, SchedPerson>;
  lookup: SkillLookup;
  budgetedDates: string[];
  budgetHours: number;
  /** Top-quartile demand quarters per built date (plus the closing window): the "busiest windows". */
  busiest: Record<string, Set<number>>;
  notes: BoardNote[];
  /** Pins that may be carved for cover: shift key → the positions the pin allows ("any" = every eligible). */
  pinCover: Record<string, string[] | "any">;
  /**
   * CC chunk H9 (spec §5.1, two days off): per hourly person, the built dates chosen as their OFF days (`chooseOffDays`) — a fill
   * gives them a NEW shift there only when nobody else fits (`RELAX_TIERS`); the 5-date cap itself is hard everywhere (the
   * validator's `max_days_per_week`, kept hard by the generator).
   */
  offPreferred?: Record<string, ReadonlySet<string>>;
  /**
   * CC chunk H11: the week's repair counters (`newCounters`), shared from the start of the build so the partition backtrack
   * (`splitRun`) counts its RETRIES against the same `REPAIR_MAX_STEPS` budget. Absent = no backtracking budget tracked.
   */
  counters?: { steps: number };
}

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const sortIds = (ids: readonly string[]) => [...ids].sort(cmp);
export const shiftOrder = (a: Shift, b: Shift) => cmp(a.date, b.date) || cmp(a.userId, b.userId) || a.startQ - b.startQ;

export function cloneShift(s: GShift): GShift {
  return { ...s, segments: s.segments.map((g) => ({ ...g, reasons: [...g.reasons] })), reasons: [...s.reasons] };
}

export function toShift(s: GShift): Shift {
  return {
    userId: s.userId, date: s.date, startQ: s.startQ, endQ: s.endQ, closingManager: s.closingManager, flex: s.flex, pinned: s.pinned,
    segments: s.segments.map((g) => {
      const seg: Segment = { positionId: g.positionId, startQ: g.startQ, endQ: g.endQ };
      if (g.lastResort) seg.lastResort = true;
      if (g.coverFor) seg.coverFor = g.coverFor;
      if (g.reasonKey) seg.reasonKey = g.reasonKey;
      return seg;
    }),
  };
}

export function allShifts(week: WeekState): Shift[] {
  const out: Shift[] = [...week.inherited];
  for (const date of Object.keys(week.built).sort()) for (const s of week.built[date]!) out.push(toShift(s));
  return out;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export function occupancy(shifts: readonly GShift[], positionId: string, q: number): number {
  let n = 0;
  for (const s of shifts) for (const g of s.segments) if (g.positionId === positionId && g.startQ <= q && g.endQ > q) n++;
  return n;
}

export function needAt(day: DayContext, positionId: string, q: number): number {
  return day.need.positions[positionId]?.[q] ?? 0;
}

export function deficitAt(shifts: readonly GShift[], day: DayContext, positionId: string, q: number): number {
  return Math.max(0, needAt(day, positionId, q) - occupancy(shifts, positionId, q));
}

export function roomAt(shifts: readonly GShift[], day: DayContext, positionId: string, q: number): boolean {
  const pos = day.structure.positions[positionId];
  return !!pos && q < day.scheduledOutQ && occupancy(shifts, positionId, q) < positionLimit(pos, q);
}

export function weekQuarters(week: WeekState, userId: string): number {
  let n = 0;
  for (const s of allShifts(week)) if (s.userId === userId) n += s.endQ - s.startQ;
  return n;
}

/** BASE station quarters of the week (flex quarters aside — Juan 2026-10-16, decision 4). */
export function floorQuarters(week: WeekState, userId: string): number {
  let n = 0;
  for (const s of allShifts(week)) if (s.userId === userId) for (const g of s.segments) if (g.positionId !== MOD && !isFlexSegment(g)) n += g.endQ - g.startQ;
  return n;
}

/** BASE quarters of the week (station + MoD, flex quarters aside) — the salaried week target's left-hand side (decision 4). */
export function baseWeekQuarters(week: WeekState, userId: string): number {
  let n = 0;
  for (const s of allShifts(week)) {
    if (s.userId !== userId) continue;
    n += s.endQ - s.startQ;
    for (const g of s.segments) if (isFlexSegment(g)) n -= g.endQ - g.startQ;
  }
  return n;
}

/** The flex quarters a salaried manager has left this week (decision 4: every zero-hourly-cost fill draws from them). */
export function flexLeft(b: BuildCtx, week: WeekState, userId: string): number {
  return flexLeftQ({ shifts: allShifts(week) }, userId, b.structure);
}

const isHourly = (p: RulePerson) => !p.salaried && !p.presenceOnly;

/** Non-essential hourly hours on the budgeted dates (the budget stop's left-hand side). */
export function budgetUsedHours(b: BuildCtx, week: WeekState): number {
  let used = 0;
  for (const s of allShifts(week)) {
    const p = b.people[s.userId];
    if (!p || !isHourly(p) || !b.budgetedDates.includes(s.date)) continue;
    const cw = b.ctx.closingWindowByDate[s.date];
    const essential = !!cw && s.segments.some((g) => g.positionId !== MOD && g.startQ < cw.toQ && g.endQ > cw.fromQ);
    if (!essential) used += (s.endQ - s.startQ) / 4;
  }
  return used;
}

/** Does a block over [fromQ, toQ) on `date` work the closing window (and so count as essential)? */
export function worksClosingWindow(b: BuildCtx, date: string, fromQ: number, toQ: number): boolean {
  const cw = b.ctx.closingWindowByDate[date];
  return !!cw && fromQ < cw.toQ && toQ > cw.fromQ;
}

/** Is a MoD on the clock at q (SL+ always; a KH only when the shop's setting allows it from that time)? */
export function modOnClockAt(b: BuildCtx, shifts: readonly GShift[], q: number): boolean {
  for (const s of shifts) {
    const p = b.people[s.userId];
    // CC addendum B3: a (pinned) catering manager counts only outside the date's booked catering windows.
    const day = b.ctx.days[s.date];
    if (p && s.startQ <= q && s.endQ > q && (day ? modCountsOn(p, day, q) : modCountsAt(p, b.structure, q))) return true;
  }
  return false;
}

/** The eligible flagged Closing Manager on the clock at q? */
export function closingManagerAt(b: BuildCtx, shifts: readonly GShift[], q: number): boolean {
  return shifts.some((s) => s.closingManager && s.startQ <= q && s.endQ > q && !!b.people[s.userId] && closingManagerEligible(b.people[s.userId]!, b.structure));
}

export function closingRequired(day: DayContext): boolean {
  for (const [id, arr] of Object.entries(day.need.positions)) {
    const pos = day.structure.positions[id];
    if (!pos || !isLineRole(pos.role)) continue;
    for (let q = day.structure.shopDay.serviceCloseQ; q < day.scheduledOutQ; q++) if ((arr[q] ?? 0) > 0) return true;
  }
  return false;
}

/** Uncovered heads of a day: coverage (heads × quarters), MoD quarters, Closing Manager quarters — and the essential part. */
export function uncoveredTotals(b: BuildCtx, date: string, shifts: readonly GShift[]): { total: number; essential: number } {
  const day = b.ctx.days[date]!;
  const { prepStartQ, serviceCloseQ } = day.structure.shopDay;
  const out = day.scheduledOutQ;
  let total = 0;
  let essential = 0;
  for (const id of Object.keys(day.need.positions).sort()) {
    for (let q = 0; q < Q_PER_DAY; q++) {
      const d = deficitAt(shifts, day, id, q);
      total += d;
      if (q >= serviceCloseQ && q < out) essential += d;
    }
  }
  if (day.structure.leadership.modRequired) for (let q = prepStartQ; q < out; q++) if (!modOnClockAt(b, shifts, q)) { total++; essential++; }
  if (closingRequired(day)) for (let q = serviceCloseQ; q < out; q++) if (!closingManagerAt(b, shifts, q)) { total++; essential++; }
  return { total, essential };
}

// ─── The guard ───────────────────────────────────────────────────────────────

const GAP_DISCIPLINE: ReadonlySet<string> = new Set(["undeclared_gap", "uncertified_gap"]);

/**
 * Error-class problems of ONE built day given the week (weekly totals see every shift); gap discipline excluded. CC addendum A:
 * the salaried-week WARNINGS (over the 40 h target, past the flex) count here too — the generator keeps them hard.
 */
export function dayErrors(b: BuildCtx, week: WeekState, date: string, shifts: readonly GShift[]): string[] {
  const others: Shift[] = [...week.inherited];
  for (const d of Object.keys(week.built)) if (d !== date) for (const s of week.built[d]!) others.push(toShift(s));
  const days: DayRecord[] = b.ctx.dates.filter((d) => d !== date).map((d) => ({ date: d, originRevisionId: null, structureVersionId: b.ctx.days[date]!.structureVersionId, inherited: true, problems: [] }));
  const ctx: RuleContext = { ...b.ctx, days: { [date]: b.ctx.days[date]! } };
  const problems = checkScheduleRules({ locationId: b.ctx.locationId, weekStart: b.ctx.weekStart, shifts: [...others, ...shifts.map(toShift)], gaps: [], days }, ctx);
  return problems.filter((p) => generatorRefuses(p) && !GAP_DISCIPLINE.has(p.code) && !p.inherited).map(problemKey).sort();
}

function problemKey(p: RuleProblem): string {
  return `${p.code}|${p.userId ?? ""}|${p.positionId ?? ""}|${p.q ?? ""}`;
}

/**
 * Apply `mutate` to a COPY of the day's shifts; keep it only when it adds no error-class problem (and,
 * when `check` is given, when `check` approves the result). Returns whether it was kept.
 */
export function guarded(b: BuildCtx, week: WeekState, date: string, mutate: (shifts: GShift[]) => boolean, check?: (next: GShift[]) => boolean): boolean {
  const before = week.built[date]!;
  const next = before.map(cloneShift);
  if (!mutate(next)) return false;
  if (check && !check(next)) return false;
  const was = new Set(dayErrors(b, week, date, before));
  const now = dayErrors(b, week, date, next);
  if (now.some((k) => !was.has(k))) return false;
  week.built[date] = next;
  return true;
}

// ─── Block planning: the minimum shift, extension, the next needed position ──

export interface PlannedSegment { positionId: string; startQ: number; endQ: number; kind: "core" | "extended" | "next_position" }
export interface BlockPlan { segments: PlannedSegment[]; startQ: number; endQ: number }

/**
 * A block for a deficit run on `positionId`: the run itself, extended to `minimumShiftQ` first inside the
 * position's window where the head limit has room (forward, then backward), then into the NEXT needed
 * position (a position with a deficit, else room, at the block's edge) — a multi-position segment. Null
 * when the minimum cannot be reached; the deficit is then the repair search's and the certificates'.
 */
export function planBlock(shifts: readonly GShift[], day: DayContext, positionId: string, fromQ: number, toQ: number, minQ: number, order: readonly string[]): BlockPlan | null {
  const s = day.structure;
  const pos = s.positions[positionId];
  if (!pos) return null;
  const lo = Math.max(s.shopDay.prepStartQ, 0);
  const hi = Math.min(day.scheduledOutQ, Q_PER_DAY);
  let a = fromQ;
  let z = toQ;
  while (z - a < minQ && z < hi && z < pos.closeQ && roomAt(shifts, day, positionId, z)) z++;
  while (z - a < minQ && a > lo && a > pos.openQ && roomAt(shifts, day, positionId, a - 1)) a--;
  const segments: PlannedSegment[] = [];
  if (a < fromQ) segments.push({ positionId, startQ: a, endQ: fromQ, kind: "extended" });
  segments.push({ positionId, startQ: fromQ, endQ: toQ, kind: "core" });
  if (z > toQ) segments.push({ positionId, startQ: toQ, endQ: z, kind: "extended" });
  if (z - a >= minQ) return { segments, startQ: a, endQ: z };
  // Into the next needed position: forward first (a deficit at z, else room at z), then backward.
  const pick = (q: number, prefer: "deficit" | "room") => order.find((id) => id !== positionId && (prefer === "deficit" ? deficitAt(shifts, day, id, q) > 0 : roomAt(shifts, day, id, q)));
  for (const prefer of ["deficit", "room"] as const) {
    if (z - a >= minQ) break;
    const next = z < hi ? pick(z, prefer) : undefined;
    if (next) {
      let e = z;
      while (e - a < minQ && e < hi && (prefer === "deficit" ? deficitAt(shifts, day, next, e) > 0 || roomAt(shifts, day, next, e) : roomAt(shifts, day, next, e))) e++;
      if (e > z) { segments.push({ positionId: next, startQ: z, endQ: e, kind: "next_position" }); z = e; }
    }
    if (z - a >= minQ) break;
    const prev = a > lo ? pick(a - 1, prefer) : undefined;
    if (prev) {
      let st = a;
      while (z - st < minQ && st > lo && (prefer === "deficit" ? deficitAt(shifts, day, prev, st - 1) > 0 || roomAt(shifts, day, prev, st - 1) : roomAt(shifts, day, prev, st - 1))) st--;
      if (st < a) { segments.unshift({ positionId: prev, startQ: st, endQ: a, kind: "next_position" }); a = st; }
    }
  }
  return z - a >= minQ ? { segments, startQ: a, endQ: z } : null;
}

// ─── Candidates ──────────────────────────────────────────────────────────────

export interface Candidate { person: SchedPerson; own: GShift | null; skill: number; key: Array<number | string> }

export interface CandidateOpts {
  date: string;
  plan: BlockPlan;
  /** The position the deficit is on (the one the skill and the pairing are judged on). */
  positionId: string | null;
  closingLead: boolean;
  /** Allow a candidate whose week would exceed the overtime threshold (the last resort). */
  allowOvertime: boolean;
  /**
   * CC chunk H9 (spec §6.2 "each person's soft range is respected"): allow a candidate whose week would pass their SOFT MAX.
   * Unset = `allowOvertime` (an overtime tier allows it too). The fills try it only after nobody fits within it.
   */
  allowSoftMax?: boolean;
  /**
   * CC chunk H9 (spec §5.1): `false` = never a NEW shift on one of the person's chosen off days (`BuildCtx.offPreferred`). The main
   * fills pass false first and relax it only when nobody else fits; every other caller leaves it unset (allowed).
   */
  allowOffDay?: boolean;
  /** CC chunk H11: people the partition backtrack has already tried for this part (skipped here). */
  exclude?: ReadonlySet<string>;
  /** MoD blocks: the candidate must count as the manager on duty from `modFromQ` (the hole's first quarter; default the plan's). */
  mod: boolean;
  modFromQ?: number;
  /** Only people whose OWN shift that day is adjacent to the plan (an extension; the plan may be under the minimum). */
  extensionOnly?: boolean;
}

/** A strong person on a LINE position overlapping the window on this day? (the pairing tie-break) */
export function strongPartnerOnLine(b: BuildCtx, shifts: readonly GShift[], fromQ: number, toQ: number, except: string): boolean {
  for (const s of shifts) {
    if (s.userId === except) continue;
    const p = b.people[s.userId];
    if (!p) continue;
    for (const g of s.segments) {
      const pos = b.structure.positions[g.positionId];
      if (pos && isLineRole(pos.role) && g.startQ < toQ && g.endQ > fromQ && p.strongPositions.includes(g.positionId)) return true;
    }
  }
  return false;
}

/** Can this person's existing shift that day be extended by the plan (adjacent, no overlap)? */
function extendsOwn(own: GShift, plan: BlockPlan): boolean {
  return plan.startQ === own.endQ || plan.endQ === own.startQ;
}

/**
 * Eligible hourly candidates for a planned block, ranked. Eligibility: an active hourly member, allowed on
 * every planned position (role, work type, never a manager on Prep/Dishwasher), available over the whole
 * span, their leader setting allows it, no untouchable day, a Closing Manager-eligible closer for the
 * `closingLead`, free that day or extendable from their own adjacent shift, and not over the overtime
 * threshold unless `allowOvertime`.
 */
export function rankCandidates(b: BuildCtx, week: WeekState, shifts: readonly GShift[], o: CandidateOpts): Candidate[] {
  const s = b.structure;
  const busiest = o.plan.segments.some((g) => { for (let q = g.startQ; q < g.endQ; q++) if (b.busiest[o.date]?.has(q)) return true; return false; })
    || worksClosingWindow(b, o.date, o.plan.startQ, o.plan.endQ);
  const out: Candidate[] = [];
  const all = allShifts({ built: { ...week.built, [o.date]: shifts as GShift[] }, inherited: week.inherited });
  for (const userId of Object.keys(b.people).sort(cmp)) {
    const p = b.people[userId]!;
    if (!isHourly(p) || neverGenerated(p) || !p.activeMember || p.untouchableDates.includes(o.date)) continue;
    if (o.exclude?.has(userId)) continue;
    const own = shifts.find((x) => x.userId === userId) ?? null;
    if (own && (own.pinned || !extendsOwn(own, o.plan))) continue;
    if (o.extensionOnly && !own) continue;
    if (o.mod ? !modCountsAt(p, s, o.modFromQ ?? o.plan.startQ) : !o.plan.segments.every((g) => eligibleForPosition(p, s.positions[g.positionId]))) continue;
    if (o.closingLead && !closingManagerEligible(p, s)) continue;
    // CC chunk H9 (spec §5.1): two days off — never a new date past the cap (hard), and in the main fill never a chosen off day.
    if (!own && atDayCap(p, { shifts: all }, o.date, maxDaysPerWeek(s))) continue;
    if (!own && o.allowOffDay === false && b.offPreferred?.[userId]?.has(o.date) && !all.some((x) => x.userId === userId && x.date === o.date)) continue;
    const fromQ = own ? Math.min(own.startQ, o.plan.startQ) : o.plan.startQ;
    const toQ = own ? Math.max(own.endQ, o.plan.endQ) : o.plan.endQ;
    // CC chunk B ruling 3: the daily maximum is HARD — a placement that would make the shift longer is never a candidate.
    if (toQ - fromQ > maxShiftQ(s)) continue;
    const w = p.availability[o.date];
    if (w === null || (w && (fromQ < w.fromQ || toQ > w.toQ))) continue;
    if (!leaderSettingAllows(p, s, fromQ, toQ)) continue;
    const planQ = o.plan.endQ - o.plan.startQ;
    const hours = (weekQuarters(week, userId) + planQ) / 4;
    if (hours > s.limits.overtimeH && !o.allowOvertime) continue;
    if (p.softMaxH !== null && hours > p.softMaxH && !(o.allowSoftMax ?? o.allowOvertime)) continue;
    const skill = o.positionId ? skillOf(b.lookup, p, o.positionId, s.positions[o.positionId]).value : 0;
    const underSoftMin = p.softMinH === null ? 0 : Math.max(0, p.softMinH - weekQuarters(week, userId) / 4);
    const fullTimerFirst = p.fullTime && p.fullTimeMinH !== null && weekQuarters(week, userId) / 4 < p.fullTimeMinH ? 0 : 1;
    const newer = !!o.positionId && p.newerPositions.includes(o.positionId);
    const pairing = newer ? (strongPartnerOnLine(b, shifts, o.plan.startQ, o.plan.endQ, userId) ? -1 : 1) : 0;
    out.push({ person: p, own, skill, key: [fullTimerFirst, busiest ? 0 : -underSoftMin, -skill, pairing, userId] });
  }
  out.sort((x, y) => {
    for (let i = 0; i < x.key.length; i++) {
      const a = x.key[i]!;
      const c = y.key[i]!;
      if (a === c) continue;
      return typeof a === "number" && typeof c === "number" ? a - c : cmp(String(a), String(c));
    }
    return 0;
  });
  return out;
}

// ─── Placement ───────────────────────────────────────────────────────────────

export interface PlaceOpts { date: string; plan: BlockPlan; sourceReason: Reason; closingLead: boolean; extraReasons?: Reason[] }

function segmentsOf(plan: BlockPlan, source: Reason, positionId: string | null, people: Record<string, SchedPerson>, userId: string): GSegment[] {
  void people;
  void userId;
  return plan.segments.map((g) => {
    const reasons: Reason[] = [];
    if (g.kind === "core") reasons.push(source);
    else if (g.kind === "extended") reasons.push(reason("extended_to_minimum", { positionId: g.positionId, fromQ: g.startQ, toQ: g.endQ }));
    else reasons.push(reason("next_position", { positionId: g.positionId, fromQ: g.startQ, toQ: g.endQ, after: positionId }));
    return { positionId: g.positionId, startQ: g.startQ, endQ: g.endQ, reasons };
  });
}

/** Place a candidate on a plan (a new shift, or an extension of their own adjacent shift) into `shifts`. */
export function applyPlacement(shifts: GShift[], c: Candidate, o: PlaceOpts, people: Record<string, SchedPerson>, positionId: string | null): void {
  const segs = segmentsOf(o.plan, o.sourceReason, positionId, people, c.person.userId);
  const reasons = [o.sourceReason, ...(o.extraReasons ?? [])];
  const idx = c.own ? shifts.findIndex((x) => x.userId === c.person.userId) : -1;
  if (idx >= 0) {
    const own = shifts[idx]!;
    const merged: GShift = { ...own, startQ: Math.min(own.startQ, o.plan.startQ), endQ: Math.max(own.endQ, o.plan.endQ), reasons: [...own.reasons, ...reasons] };
    merged.segments = o.plan.startQ >= own.endQ ? [...own.segments, ...segs] : [...segs, ...own.segments];
    shifts[idx] = merged;
  } else {
    shifts.push({ userId: c.person.userId, date: o.date, startQ: o.plan.startQ, endQ: o.plan.endQ, segments: segs, closingManager: false, flex: false, pinned: false, reasons, origin: "hourly" });
  }
}

/** The ranking reason for a chosen candidate (why this person). */
export function whyChosen(b: BuildCtx, shifts: readonly GShift[], c: Candidate, o: CandidateOpts): Reason[] {
  const out: Reason[] = [];
  if (c.key[0] === 0) out.push(reason("full_timer_minimum", { userId: c.person.userId }));
  if (c.key[1] === 0 && o.positionId) out.push(reason("strongest_on_position", { userId: c.person.userId, positionId: o.positionId, skill: c.skill }));
  else if (typeof c.key[1] === "number" && c.key[1] < 0) out.push(reason("under_soft_min", { userId: c.person.userId, hoursUnder: -c.key[1] }));
  if (c.key[3] === -1) out.push(reason("beside_strong", { userId: c.person.userId, positionId: o.positionId }));
  if (c.key[3] === 1) out.push(reason("strongest_on_position", { userId: c.person.userId, positionId: o.positionId, skill: c.skill }));
  void b;
  void shifts;
  return out;
}

/**
 * Fill one deficit run [fromQ, toQ) on a position: plan the block, rank the hourly candidates (two passes:
 * within overtime, then overtime as a last resort), place the first the guard accepts; else a salaried
 * manager's cover (never for the closing lead). Returns what happened.
 */
export function fillRun(
  b: BuildCtx, week: WeekState, date: string, positionId: string, fromQ: number, toQ: number, t: Pick<Template, "source" | "essential" | "closingLead">,
  order: readonly string[], opts: { allowCover: boolean; budgetStop: boolean; tiers?: readonly RelaxTier[]; splitDepth?: number; exclude?: ReadonlySet<string> },
): "placed" | "covered" | "budget" | "none" {
  // CC chunk B ruling 3: a run longer than the daily maximum is split into the fewest near-equal parts that each fit
  // (the earlier parts one quarter longer), filled in order — two people hold a 13.75 h Prep/Dishwasher day.
  const maxQ = maxShiftQ(b.structure);
  if (toQ - fromQ > maxQ) {
    const parts = Math.ceil((toQ - fromQ) / maxQ);
    const base = Math.floor((toQ - fromQ) / parts);
    const extra = (toQ - fromQ) % parts;
    const results: Array<"placed" | "covered" | "budget" | "none"> = [];
    let a = fromQ;
    for (let i = 0; i < parts; i++) {
      const z = a + base + (i < extra ? 1 : 0);
      results.push(fillRun(b, week, date, positionId, a, z, { ...t, closingLead: t.closingLead && z === toQ }, order, opts));
      a = z;
    }
    if (results.includes("budget")) return "budget";
    if (results.includes("none")) return "none";
    return results.includes("placed") ? "placed" : "covered";
  }
  const day = b.ctx.days[date]!;
  const budgeted = opts.budgetStop && !t.essential && b.budgetedDates.includes(date);
  const source = sourceReason(t.source, positionId, fromQ, toQ);
  let budgetBlocked = false;
  // Two plans, in order: the bare run as an EXTENSION of someone's adjacent shift (their shift already meets the
  // minimum), then a full block reaching the minimum (free people, or an extension when the run is long enough).
  const corePlan: BlockPlan = { startQ: fromQ, endQ: toQ, segments: [{ positionId, startQ: fromQ, endQ: toQ, kind: "core" }] };
  const fullPlan = planBlock(week.built[date]!, day, positionId, fromQ, toQ, b.structure.limits.minimumShiftQ, order);
  const plans: Array<{ plan: BlockPlan; extensionOnly: boolean }> = [];
  if (toQ - fromQ < b.structure.limits.minimumShiftQ) plans.push({ plan: corePlan, extensionOnly: true });
  if (fullPlan) plans.push({ plan: fullPlan, extensionOnly: false });
  // CC chunk H9: the TIERS are the outer loop (a later tier only after nobody fits the earlier one on EITHER plan or a split).
  for (const tier of opts.tiers ?? RELAX_TIERS) {
    const { allowOvertime, allowOffDay, allowSoftMax } = tier;
    for (const { plan, extensionOnly } of plans) {
      const o: CandidateOpts = { date, plan, positionId, closingLead: t.closingLead, allowOvertime, allowOffDay, allowSoftMax, mod: false, extensionOnly, exclude: opts.exclude };
      const ranked = rankCandidates(b, week, week.built[date]!, o);
      for (const c of ranked.slice(0, 6)) {
        const why = whyChosen(b, week.built[date]!, c, o);
        // CC chunk H9: named overtime only when THIS placement takes the week past the threshold (a tier allows it; it is not a claim).
        const overtime = allowOvertime && (weekQuarters(week, c.person.userId) + plan.endQ - plan.startQ) / 4 > b.structure.limits.overtimeH;
        if (overtime) why.push(reason("overtime_last_resort", { userId: c.person.userId }));
        const place = (shifts: GShift[]) => { applyPlacement(shifts, c, { date, plan, sourceReason: source, closingLead: t.closingLead, extraReasons: why }, b.people, positionId); return true; };
        // The budget stop, judged on the validator's own accounting AFTER this placement (a whole shift working the
        // closing window is essential; everything else counts): non-essential hourly hours on the budgeted dates ≤ budget.
        if (budgeted && !worksClosingWindow(b, date, plan.startQ, plan.endQ)) {
          const next = week.built[date]!.map(cloneShift);
          place(next);
          if (budgetUsedHours(b, { built: { ...week.built, [date]: next }, inherited: week.inherited }) > b.budgetHours) { budgetBlocked = true; continue; }
        }
        const ok = guarded(b, week, date, place);
        if (ok) {
          if (overtime) b.notes.push({ code: "overtime_used", date, userId: c.person.userId, positionId, params: {} });
          if (c.key[3] === 1) b.notes.push({ code: "pairing_unmet", date, userId: c.person.userId, positionId, params: { fromQ: plan.startQ, toQ: plan.endQ } });
          return "placed";
        }
      }
  }
    // CC chunk H9 (spec §6.2): nobody at this tier holds the WHOLE run — two people may hold its parts (an opener and a closer)
    // before any later tier passes someone's soft max or overtime. Each part is at least the minimum shift.
    if (!budgetBlocked && (opts.splitDepth ?? 0) < 2 && toQ - fromQ >= 2 * b.structure.limits.minimumShiftQ
      && splitRun(b, week, date, positionId, fromQ, toQ, t, order, { budgetStop: opts.budgetStop, tier, splitDepth: (opts.splitDepth ?? 0) + 1, exclude: opts.exclude })) return "placed";
  }
  if (budgetBlocked) {
    // Astra chunk B P1-1: a salaried manager's MoD block costs no hourly money — take it before the budget stops the fill.
    // (A salaried manager STAYING LONGER is taken later, in takeZeroCostFills, once the hourly fill has settled — CC chunk D ruling 2.)
    // Juan 2026-10-16 (decision 4): the base plan's cover (within the floor limit) first, then a FLEX carve.
    if (opts.allowCover && !t.closingLead && (coverWithManager(b, week, date, positionId, fromQ, toQ) || carveZeroCostCovers(b, week, date, positionId, fromQ, toQ, { extend: false }))) return "covered";
    // Astra chunk B ruling (the budget search): extending an ESSENTIAL shift (it works the closing window) costs no
    // non-essential hour either — the budget certificate refuses while such an extension is legal, so take it.
    if (extendEssentialShift(b, week, date, positionId, fromQ, toQ)) return "placed";
    if (relabelSpareSegment(b, week, date, positionId, fromQ, toQ)) return "placed";
    b.notes.push({ code: "budget_stopped", date, userId: null, positionId, params: { fromQ, toQ, budgetHours: b.budgetHours } });
    return "budget";
  }
  if (opts.allowCover && !t.closingLead && coverWithManager(b, week, date, positionId, fromQ, toQ)) return "covered";
  return "none";
}

/**
 * The candidate tiers, in order; a later tier is tried only when NO candidate of the earlier one was placed. CC chunk H9 (spec
 * §5.1, §6.2 "each person's soft range is respected", "Overtime is avoided"): first nobody on one of their chosen off days and
 * nobody past their soft max or overtime; then an off day; then past a soft max (never overtime); overtime is the LAST resort
 * (a warning with its cost, `overtime_used`). `buildWeek` runs each tier over EVERY date before the next (so an early date
 * never spends a later date's people); the repair's insertions take all tiers in order.
 */
export interface RelaxTier { allowOvertime: boolean; allowOffDay: boolean; allowSoftMax: boolean }
export const RELAX_TIERS: readonly RelaxTier[] = [
  { allowOvertime: false, allowOffDay: false, allowSoftMax: false },
  { allowOvertime: false, allowOffDay: true, allowSoftMax: false },
  { allowOvertime: false, allowOffDay: true, allowSoftMax: true },
  { allowOvertime: true, allowOffDay: true, allowSoftMax: true },
];

/**
 * CC chunk H9 (spec §6.2): a run nobody at this tier can hold whole, as TWO blocks, each filled at the SAME tier, no manager cover;
 * the part ending at the run's end keeps the closing lead.
 * CC chunk H10 (P2 ruling, Astra H9 P2): the split points are the middle, the edges of the hourly people's availability windows,
 * AND the hour-budget boundaries — each eligible candidate's remaining room to their soft max and to `overtimeH`, measured from
 * either end of the run (a 10-hour run with people at 6 h and 4 h of room splits at 6 / 4). Every point that leaves both parts at
 * least the minimum shift is tried for a COMPLETE partition first (both parts filled, no deficit left on the run; anything else
 * is rolled back), nearest the middle first; only then, as before, the three nearest points for a PARTIAL fill (what is left
 * stays a deficit for the later tiers and the repair). True when anything was placed.
 */
/** CC chunk H11: first-part picks tried per split point before the next point (bounded; retries count as repair steps). */
export const SPLIT_BACKTRACK_N = 4;
const canonicalShiftKey = (x: GShift) => JSON.stringify([x.startQ, x.endQ, x.segments.map((g) => [g.positionId, g.startQ, g.endQ])]);

function splitRun(
  b: BuildCtx, week: WeekState, date: string, positionId: string, fromQ: number, toQ: number, t: Pick<Template, "source" | "essential" | "closingLead">,
  order: readonly string[], o: { budgetStop: boolean; tier: RelaxTier; splitDepth: number; exclude?: ReadonlySet<string> },
): boolean {
  const minQ = b.structure.limits.minimumShiftQ;
  const mid = fromQ + Math.floor((toQ - fromQ) / 2);
  const pos = b.structure.positions[positionId];
  const day = b.ctx.days[date]!;
  const points = new Set<number>([mid]);
  for (const userId of Object.keys(b.people).sort(cmp)) {
    const p = b.people[userId]!;
    const w = p.availability[date];
    if (w) for (const q of [w.fromQ, w.toQ]) points.add(q);
    if (!isHourly(p) || neverGenerated(p) || !p.activeMember || !eligibleForPosition(p, pos)) continue;
    const used = weekQuarters(week, userId);
    for (const capH of [p.softMaxH, b.structure.limits.overtimeH]) {
      if (capH === null) continue;
      const room = Math.round(capH * 4) - used;
      if (room > 0) { points.add(fromQ + room); points.add(toQ - room); }
    }
  }
  const valid = [...points].filter((q) => q - fromQ >= minQ && toQ - q >= minQ).sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid) || x - y);
  const opts = { allowCover: false, budgetStop: o.budgetStop, tiers: [o.tier], splitDepth: o.splitDepth, exclude: o.exclude };
  const fillParts = (q: number, firstExclude: ReadonlySet<string> | undefined = o.exclude) => {
    const first = fillRun(b, week, date, positionId, fromQ, q, { ...t, closingLead: false }, order, { ...opts, exclude: firstExclude }) === "placed";
    const second = fillRun(b, week, date, positionId, q, toQ, t, order, opts) === "placed";
    return first || second;
  };
  const complete = () => {
    for (let x = fromQ; x < toQ; x++) if (deficitAt(week.built[date]!, day, positionId, x) > 0) return false;
    return true;
  };
  // Pass 1 — a COMPLETE non-exceeding partition (the tier keeps every placement within its limits). CC chunk H11: at each point
  // the FIRST part's candidates are backtracked jointly with the second — when the first part's pick leaves the second part
  // unfillable, the first part is retried without that person (the ranking stays the order), up to SPLIT_BACKTRACK_N picks per
  // point; each retry is one step of the week's repair budget.
  for (const q of valid) {
    const tried = new Set<string>(o.exclude ?? []);
    for (let attempt = 0; attempt < SPLIT_BACKTRACK_N; attempt++) {
      if (attempt > 0) {
        if (b.counters && b.counters.steps >= REPAIR_LIMITS.REPAIR_MAX_STEPS) break;
        if (b.counters) b.counters.steps++;
      }
      const saved = week.built[date]!.map(cloneShift);
      const notes = b.notes.length;
      fillParts(q, tried);
      if (complete()) return true;
      // Who took (part of) the first part this time: everyone whose shifts that date changed.
      const before = new Map(saved.map((x) => [x.userId, canonicalShiftKey(x)]));
      const changed = week.built[date]!.filter((x) => before.get(x.userId) !== canonicalShiftKey(x)).map((x) => x.userId).filter((u) => !tried.has(u));
      week.built[date] = saved;
      b.notes.length = notes;
      if (changed.length === 0) break; // nobody new could take the first part: no further pair at this point
      // A retry can only help when the SECOND part is fillable with the first part left open (the first pick took its person);
      // when it is not, no first-part choice completes this point — move on without spending the budget.
      const secondAlone = fillRun(b, week, date, positionId, q, toQ, t, order, opts) === "placed";
      week.built[date] = saved.map(cloneShift);
      b.notes.length = notes;
      if (!secondAlone) break;
      for (const u of changed) tried.add(u);
    }
  }
  // Pass 2 — the H9 behaviour: a partial fill at one of the three points nearest the middle.
  for (const q of valid.slice(0, 3)) if (fillParts(q)) return true;
  return false;
}

export function sourceReason(source: Template["source"], positionId: string, fromQ: number, toQ: number): Reason {
  const key = source === "closing_crew" ? "closing_crew" : source === "boh_crew" ? "boh_crew" : source === "catering" ? "catering_prep" : "wave_arrival";
  return reason(key, { positionId, fromQ, toQ });
}

/** The daily maximum shift in quarters (CC chunk B ruling 3; `limits.maxShiftH`, default 10.5 h per CC chunk C ruling 2). */
export function maxShiftQ(s: ScheduleStructure): number {
  return Math.round(s.limits.maxShiftH * 4);
}

// ─── Manager cover ───────────────────────────────────────────────────────────

/**
 * Cover a deficit run from a MoD block on the clock: a salaried manager (or a presence pin that lists the
 * position) whose MoD segment spans the run, within `managerFloorH` for the week, allowed on the position
 * (never Prep/Dishwasher), ordered by their preferred cover list (in the list first, by rank), then skill;
 * outside the list only as a last resort (`lastResort: true`, the reason says so). The segment is carved
 * out of the MoD block.
 */
export function coverWithManager(b: BuildCtx, week: WeekState, date: string, positionId: string, fromQ: number, toQ: number): boolean {
  const s = b.structure;
  const pos = s.positions[positionId];
  if (!pos) return false;
  const shifts = week.built[date]!;
  const lenQ = toQ - fromQ;
  const candidates = shifts.filter((sh) => {
    const p = b.people[sh.userId];
    if (!p || !eligibleForPosition(p, pos)) return false;
    const covers = sh.segments.some((g) => g.positionId === MOD && g.startQ <= fromQ && g.endQ >= toQ);
    if (!covers) return false;
    if (sh.pinned) {
      const allowed = b.pinCover[`${sh.date}|${sh.userId}|${sh.startQ}`];
      if (!allowed || (allowed !== "any" && !allowed.includes(positionId))) return false;
      return true;
    }
    return p.salaried && (floorQuarters(week, sh.userId) + lenQ) / 4 <= s.limits.managerFloorH;
  }).map((sh) => {
    const p = b.people[sh.userId]!;
    const rank = p.coverPositions.indexOf(positionId);
    return { sh, p, rank, skill: skillOf(b.lookup, p, positionId, pos).value };
  }).sort((x, y) => Number(x.rank < 0) - Number(y.rank < 0) || x.rank - y.rank || y.skill - x.skill || cmp(x.p.userId, y.p.userId));
  for (const c of candidates) {
    const lastResort = c.rank < 0;
    const ok = guarded(b, week, date, (next) => {
      const sh = next.find((x) => x.userId === c.p.userId)!;
      const parts: GSegment[] = [];
      for (const g of sh.segments) {
        if (g.positionId !== MOD || g.endQ <= fromQ || g.startQ >= toQ) { parts.push(g); continue; }
        if (g.startQ < fromQ) parts.push({ ...g, endQ: fromQ });
        const r = lastResort ? reason("manager_cover_last_resort", { positionId, fromQ, toQ }) : reason("manager_cover", { positionId, fromQ, toQ, rank: c.rank + 1 });
        // Astra chunk H P2-1: a relabel keeps the host's flex classification.
        parts.push({ positionId, startQ: fromQ, endQ: toQ, reasons: [r], ...(lastResort ? { lastResort: true } : {}), ...(isFlexSegment(g) ? { reasonKey: SALARIED_FLEX_REASON } : {}) });
        if (toQ < g.endQ) parts.push({ ...g, startQ: toQ });
      }
      sh.segments = parts;
      sh.reasons = [...sh.reasons, lastResort ? reason("manager_cover_last_resort", { positionId, fromQ, toQ }) : reason("manager_cover", { positionId, fromQ, toQ, rank: c.rank + 1 })];
      return true;
    });
    if (ok) return true;
  }
  return false;
}

/**
 * Astra chunk B P1-1: carve every legal ZERO-hourly-cost fill of a coverage run out of salaried managers' MoD blocks
 * (`zeroCostCovers` — the same predicate the budget certificate refuses on), guarded, until none is left. Returns
 * true when the run has no deficit left.
 */
export function carveZeroCostCovers(b: BuildCtx, week: WeekState, date: string, positionId: string, fromQ: number, toQ: number, opts: { extend: boolean } = { extend: true }): boolean {
  const day = b.ctx.days[date]!;
  for (let round = 0; round < 8; round++) {
    const schedule = { locationId: b.ctx.locationId, weekStart: b.ctx.weekStart, shifts: allShifts(week), gaps: [], days: [] };
    const covers = zeroCostCovers({ date, positionId, fromQ, toQ }, schedule, b.ctx);
    let progress = false;
    for (const c of covers) {
      if (c.extend && !opts.extend) continue;
      const p = b.people[c.userId];
      if (!p) continue;
      const rank = p.coverPositions.indexOf(positionId);
      const lastResort = rank < 0;
      const r = c.extend ? reason("salaried_extension", { positionId, fromQ: c.fromQ, toQ: c.toQ, userId: c.userId, lastResort })
        : lastResort ? reason("manager_cover_last_resort", { positionId, fromQ: c.fromQ, toQ: c.toQ }) : reason("manager_cover", { positionId, fromQ: c.fromQ, toQ: c.toQ, rank: rank + 1 });
      // Juan 2026-10-16 (decisions 4 + 5): a zero-hourly-cost fill is FLEX time — the segment says so, and so does its reason.
      const flexWhy = reason("salaried_flex", { positionId, fromQ: c.fromQ, toQ: c.toQ, userId: c.userId });
      if (c.extend) {
        // CC chunk D rulings 1 + 2: the manager STAYS LONGER — the shift grows by a segment on the position.
        const ok = guarded(b, week, date, (next) => {
          const sh = next.find((x) => x.userId === c.userId && (c.extend === "after" ? x.endQ === c.fromQ : x.startQ === c.toQ));
          if (!sh || sh.pinned) return false;
          const seg: GSegment = { positionId, startQ: c.fromQ, endQ: c.toQ, reasons: [r, flexWhy], reasonKey: SALARIED_FLEX_REASON, ...(lastResort ? { lastResort: true } : {}) };
          sh.segments = c.extend === "after" ? [...sh.segments, seg] : [seg, ...sh.segments];
          sh.startQ = Math.min(sh.startQ, c.fromQ);
          sh.endQ = Math.max(sh.endQ, c.toQ);
          sh.reasons = [...sh.reasons, r];
          return true;
        });
        if (ok) progress = true;
        continue;
      }
      const ok = guarded(b, week, date, (next) => {
        const sh = next.find((x) => x.userId === c.userId && x.segments.some((g) => g.positionId === MOD && g.startQ <= c.fromQ && g.endQ >= c.toQ));
        if (!sh) return false;
        const parts: GSegment[] = [];
        for (const g of sh.segments) {
          if (g.positionId !== MOD || g.endQ <= c.fromQ || g.startQ >= c.toQ) { parts.push(g); continue; }
          if (g.startQ < c.fromQ) parts.push({ ...g, endQ: c.fromQ });
          // Decision 4: the base station room first (unmarked), then FLEX (marked).
          for (const part of splitSalariedRelabel(c.fromQ, c.toQ, baseFloorRoomQ({ shifts: allShifts(week) }, c.userId, b.structure), isFlexSegment(g))) {
            parts.push({ positionId, startQ: part.startQ, endQ: part.endQ, reasons: part.flex ? [r, flexWhy] : [r], ...(part.flex ? { reasonKey: SALARIED_FLEX_REASON } : {}), ...(lastResort ? { lastResort: true } : {}) });
          }
          if (c.toQ < g.endQ) parts.push({ ...g, startQ: c.toQ });
        }
        sh.segments = parts;
        sh.reasons = [...sh.reasons, r];
        return true;
      });
      if (ok) progress = true;
    }
    if (!progress) break;
  }
  for (let q = fromQ; q < toQ; q++) if (deficitAt(week.built[date]!, day, positionId, q) > 0) return false;
  return true;
}

/**
 * Extend an hourly person's ESSENTIAL shift (one working the closing window, whole-shift essential) over
 * [fromQ, toQ) on `positionId`, bridging to it on the same position — exactly the extensions the budget search counts
 * at zero non-essential cost (`shiftExtendsOver`: no overlap, inside the shop day, availability, leader setting,
 * room on the position over the bridge; not pinned; within the daily maximum). The smallest bridge first, then
 * userId. Guarded.
 */
export function extendEssentialShift(b: BuildCtx, week: WeekState, date: string, positionId: string, fromQ: number, toQ: number): boolean {
  const day = b.ctx.days[date]!;
  const s = b.structure;
  const pos = s.positions[positionId];
  const cw = b.ctx.closingWindowByDate[date];
  if (!pos || !cw) return false;
  const shifts = week.built[date]!;
  const primary = primaryOf(s, positionId);
  const needsPrimary = primary !== null && primary !== positionId;
  const room = (q: number) => occupancy(shifts, positionId, q) < positionLimit(pos, q) && (!needsPrimary || occupancy(shifts, primary!, q) > 0);
  if (needsPrimary) for (let q = fromQ; q < toQ; q++) if (occupancy(shifts, primary!, q) === 0) return false;
  const options = shifts.filter((sh) => {
    const p = b.people[sh.userId];
    if (!p || p.salaried || p.presenceOnly || !p.activeMember || sh.pinned || p.untouchableDates.includes(date) || !eligibleForPosition(p, pos)) return false;
    if (!sh.segments.some((g) => g.positionId !== MOD && g.startQ < cw.toQ && g.endQ > cw.fromQ)) return false;
    if (Math.max(sh.endQ, toQ) - Math.min(sh.startQ, fromQ) > maxShiftQ(s)) return false;
    return shiftExtendsOver(p, sh, day, date, fromQ, toQ, room);
  }).map((sh) => ({ sh, bridge: sh.endQ <= fromQ ? fromQ - sh.endQ : sh.startQ - toQ }))
    .sort((x, y) => x.bridge - y.bridge || cmp(x.sh.userId, y.sh.userId));
  for (const { sh } of options) {
    const before = sh.endQ <= fromQ;
    const a = before ? sh.endQ : fromQ;
    const z = before ? toQ : sh.startQ;
    const r = reason("essential_extension", { positionId, fromQ, toQ, userId: sh.userId });
    const ok = guarded(b, week, date, (next) => {
      const mine = next.find((x) => x.userId === sh.userId && x.startQ === sh.startQ);
      if (!mine) return false;
      const seg: GSegment = { positionId, startQ: a, endQ: z, reasons: [r] };
      mine.segments = before ? [...mine.segments, seg] : [seg, ...mine.segments];
      mine.startQ = Math.min(mine.startQ, a);
      mine.endQ = Math.max(mine.endQ, z);
      mine.reasons = [...mine.reasons, r];
      return true;
    });
    if (ok) return true;
  }
  return false;
}

/**
 * A zero-cost REASSIGNMENT: relabel part of an hourly person's segment onto `positionId` over [fromQ, toQ) where
 * their own position is over-covered there (occupancy − 1 ≥ need) — the repair's relabel, without its step budget,
 * because the budget search counts it as free and the budget certificate refuses while it exists. Guarded; the day's
 * uncovered total must fall and essential coverage never does.
 */
export function relabelSpareSegment(b: BuildCtx, week: WeekState, date: string, positionId: string, fromQ: number, toQ: number): boolean {
  const day = b.ctx.days[date]!;
  const pos = b.structure.positions[positionId];
  if (!pos) return false;
  const shifts = week.built[date]!;
  const baseline = uncoveredTotals(b, date, shifts);
  for (const sh of [...shifts].sort(shiftOrder)) {
    const p = b.people[sh.userId];
    if (!p || p.salaried || p.presenceOnly || sh.pinned || !eligibleForPosition(p, pos)) continue;
    for (const g of sh.segments) {
      if (g.positionId === positionId || g.positionId === MOD) continue;
      const from = Math.max(g.startQ, fromQ);
      const to = Math.min(g.endQ, toQ);
      if (to <= from) continue;
      let spare = true;
      for (let q = from; q < to; q++) if (occupancy(shifts, g.positionId, q) - 1 < needAt(day, g.positionId, q)) { spare = false; break; }
      if (!spare) continue;
      const ok = guarded(b, week, date, (next) => {
        const mine = next.find((x) => x.userId === sh.userId && x.startQ === sh.startQ);
        if (!mine) return false;
        const parts: GSegment[] = [];
        for (const seg of mine.segments) {
          if (!(seg.startQ === g.startQ && seg.positionId === g.positionId)) { parts.push(seg); continue; }
          if (seg.startQ < from) parts.push({ ...seg, endQ: from });
          parts.push({ positionId, startQ: from, endQ: to, reasons: [reason("repair_relabelled", { positionId, fromPositionId: g.positionId, fromQ: from, toQ: to })] });
          if (to < seg.endQ) parts.push({ ...seg, startQ: to });
        }
        mine.segments = parts;
        return true;
      }, (next) => { const after = uncoveredTotals(b, date, next); return after.total < baseline.total && after.essential <= baseline.essential; });
      if (ok) return true;
    }
  }
  return false;
}

/**
 * Before any gap is declared: take every legal ZERO-non-essential-cost fill the budget certificate counts as free —
 * salaried MoD cover, a spare-segment reassignment, and (on a budgeted date) an essential closer's extension — so a budget proof is never
 * refused by a fill the generator could have made, and a free fill never sits beside a hole. Bounded (each step
 * strictly lowers the uncovered total).
 */
export function takeZeroCostFills(b: BuildCtx, week: WeekState, date: string, deficits: () => Array<{ code: string; positionId: string | null; fromQ: number; toQ: number }>): void {
  // An essential closer's extension is free only in the BUDGET's accounting (it still costs wages): take it only on a
  // budgeted date, where the certificate counts it. Salaried cover and a spare reassignment add no paid hour anywhere.
  const budgeted = b.budgetedDates.includes(date);
  for (let round = 0; round < 32; round++) {
    let progress = false;
    for (const d of deficits()) {
      if (d.code !== "coverage_gap" || !d.positionId) continue;
      const before = uncoveredTotals(b, date, week.built[date]!).total;
      carveZeroCostCovers(b, week, date, d.positionId, d.fromQ, d.toQ);
      if (uncoveredTotals(b, date, week.built[date]!).total < before) { progress = true; break; }
      if (relabelSpareSegment(b, week, date, d.positionId, d.fromQ, d.toQ) || (budgeted && extendEssentialShift(b, week, date, d.positionId, d.fromQ, d.toQ))) { progress = true; break; }
    }
    if (!progress) return;
  }
}

/**
 * CC chunk C ruling 2: when a deficit sits right beside someone's shift and only the DAILY MAXIMUM stops the whole
 * extension, extend that shift as far as the cap allows toward it (the part nearest the shift), so what remains is
 * exactly what the cap leaves — the remainder the `max_shift` counting bound can then certify. Every condition a
 * placement has: an active, non-presence, unpinned person, eligible at every added quarter (the MoD from the KH time
 * when that applies), inside their availability and leader setting over the merged span, room under the head limit
 * (a secondary only where its primary is staffed), never an untouchable day, the budget stop on a budgeted date for a
 * non-essential shift; guarded, and kept only when the day's uncovered total strictly falls and essential coverage
 * never does.
 */
export function extendToCap(b: BuildCtx, week: WeekState, date: string, d: { code: string; positionId: string | null; fromQ: number; toQ: number }): boolean {
  if (d.code !== "coverage_gap" && d.code !== "mod_missing") return false;
  if (d.code === "coverage_gap" && !d.positionId) return false;
  const day = b.ctx.days[date]!;
  const s = b.structure;
  const capQ = maxShiftQ(s);
  const shifts = week.built[date]!;
  const pos = d.positionId ? s.positions[d.positionId] : undefined;
  const primary = d.positionId ? primaryOf(s, d.positionId) : null;
  const needsPrimary = !!d.positionId && primary !== null && primary !== d.positionId;
  const baseline = uncoveredTotals(b, date, shifts);
  for (const sh of [...shifts].sort(shiftOrder)) {
    const p = b.people[sh.userId];
    if (!p || !p.activeMember || p.presenceOnly || sh.pinned || p.untouchableDates.includes(date)) continue;
    // CC chunk D ruling 1: a salaried manager is extended only while the shop allows it (default ON).
    if (p.salaried && !s.limits.salariedStayLonger) continue;
    const forward = sh.endQ === d.fromQ;
    if (!forward && sh.startQ !== d.toQ) continue;
    const dayQ = shifts.filter((x) => x.userId === sh.userId).reduce((n, x) => n + (x.endQ - x.startQ), 0);
    const room = capQ - dayQ;
    // Juan 2026-10-16 (decision 5): a salaried manager STAYING LONGER as the manager on duty has no other fill (the MoD lane
    // fill places hourly managers) — so it is taken whole here, up to the cap and what is left of their FLEX.
    const salariedMod = p.salaried && d.code === "mod_missing";
    const take = salariedMod ? Math.min(room, d.toQ - d.fromQ, flexLeft(b, week, sh.userId)) : room;
    if (room <= 0 || take <= 0 || (!salariedMod && room >= d.toQ - d.fromQ)) continue; // else only where the cap binds (a whole extension is the fill's business)
    const a = forward ? sh.endQ : d.toQ - take;
    const z = forward ? sh.endQ + take : d.toQ;
    const spanFrom = Math.min(sh.startQ, a);
    const spanTo = Math.max(sh.endQ, z);
    if (!availableOn(p, date, spanFrom, spanTo) || !leaderSettingAllows(p, s, spanFrom, spanTo)) continue;
    let ok = true;
    for (let q = a; q < z && ok; q++) {
      if (d.code === "mod_missing") ok = modCountsAt(p, s, q);
      else ok = eligibleForPosition(p, pos) && occupancy(shifts, d.positionId!, q) < positionLimit(pos!, q) && (!needsPrimary || occupancy(shifts, primary!, q) > 0);
    }
    if (!ok) continue;
    // Juan 2026-10-16 (decision 5): a salaried manager staying longer draws from the FLEX pool (never the base week).
    if (p.salaried && flexLeft(b, week, sh.userId) < z - a) continue;
    const r = p.salaried
      ? reason("salaried_extension", { positionId: d.positionId ?? MOD, fromQ: a, toQ: z, userId: sh.userId, maxShiftQ: capQ })
      : reason("extended_to_cap", { positionId: d.positionId ?? MOD, fromQ: a, toQ: z, userId: sh.userId, maxShiftQ: capQ });
    const mutate = (next: GShift[]) => {
      const mine = next.find((x) => x.userId === sh.userId && x.startQ === sh.startQ);
      if (!mine) return false;
      // A manager outside their preferred cover list takes the position only as a last resort (the reason says so).
      const outside = !!d.positionId && isManagerRole(p.role) && !p.coverPositions.includes(d.positionId);
      const seg: GSegment = { positionId: d.positionId ?? MOD, startQ: a, endQ: z, reasons: [r], ...(outside ? { lastResort: true } : {}), ...(p.salaried ? { reasonKey: SALARIED_FLEX_REASON } : {}) };
      mine.segments = forward ? [...mine.segments, seg] : [seg, ...mine.segments];
      mine.startQ = Math.min(mine.startQ, a);
      mine.endQ = Math.max(mine.endQ, z);
      mine.reasons = [...mine.reasons, r];
      return true;
    };
    if (b.budgetedDates.includes(date) && isHourly(p) && !worksClosingWindow(b, date, spanFrom, spanTo)) {
      const next = shifts.map(cloneShift);
      mutate(next);
      if (budgetUsedHours(b, { built: { ...week.built, [date]: next }, inherited: week.inherited }) > b.budgetHours) continue;
    }
    if (guarded(b, week, date, mutate, (next) => { const after = uncoveredTotals(b, date, next); return after.total < baseline.total && after.essential <= baseline.essential; })) return true;
  }
  return false;
}

/**
 * CC chunk D DESIGN RULING: apply a fill the budget search FOUND (`cheapestFill`'s witness — relabels, extensions, new
 * blocks, a paired primary, a reassignment's refill) to one built day, guarded: it lands only when every step applies,
 * no new rule error appears, the budget still holds, and the day's uncovered total strictly falls. When the found fill
 * fits what is left of the budget the deficit is NOT a budget gap — so the generator takes it.
 */
export function applyFill(b: BuildCtx, week: WeekState, date: string, plan: FillPlan): boolean {
  const before = uncoveredTotals(b, date, week.built[date]!);
  const label = (userId: string, positionId: string) => {
    const p = b.people[userId];
    return !!p && positionId !== MOD && isManagerRole(p.role) && !p.coverPositions.includes(positionId);
  };
  const why = (st: FillStep): Reason => {
    const p = b.people[st.userId];
    if (p?.salaried) return st.kind === "extend" ? reason("salaried_extension", { positionId: st.positionId, fromQ: st.fromQ, toQ: st.toQ, userId: st.userId, lastResort: label(st.userId, st.positionId) })
      : reason("manager_cover", { positionId: st.positionId, fromQ: st.fromQ, toQ: st.toQ, rank: Math.max(0, p.coverPositions.indexOf(st.positionId)) + 1 });
    return reason("budget_fill", { positionId: st.positionId, fromQ: st.fromQ, toQ: st.toQ, kind: st.kind, hours: "hours" in st ? st.hours : 0 });
  };
  return guarded(b, week, date, (next) => {
    for (const st of plan.steps) {
      const r = why(st);
      // Decision 4: a salaried manager's step is a zero-hourly-cost fill — flex time.
      const salaried = !!b.people[st.userId]?.salaried && st.kind !== "new_block";
      const last = { ...(label(st.userId, st.positionId) ? { lastResort: true } : {}), ...(salaried && st.kind === "extend" ? { reasonKey: SALARIED_FLEX_REASON } : {}) };
      if (st.kind === "new_block") {
        next.push({ userId: st.userId, date, startQ: st.fromQ, endQ: st.toQ, segments: [{ positionId: st.positionId, startQ: st.fromQ, endQ: st.toQ, reasons: [r], ...last }],
          closingManager: false, flex: false, pinned: false, reasons: [r], origin: "hourly" });
        continue;
      }
      const sh = next.find((x) => x.userId === st.userId && x.startQ === st.shiftStartQ);
      if (!sh || sh.pinned) return false;
      if (st.kind === "extend") {
        const seg: GSegment = { positionId: st.positionId, startQ: st.fromQ, endQ: st.toQ, reasons: [r], ...last };
        if (st.fromQ === sh.endQ) sh.segments = [...sh.segments, seg];
        else if (st.toQ === sh.startQ) sh.segments = [seg, ...sh.segments];
        else return false;
        sh.startQ = Math.min(sh.startQ, st.fromQ);
        sh.endQ = Math.max(sh.endQ, st.toQ);
      } else {
        const host = sh.segments.find((g) => g.positionId === st.fromPositionId && g.startQ <= st.fromQ && g.endQ >= st.toQ);
        if (!host) return false;
        const parts: GSegment[] = [];
        const room = salaried ? baseFloorRoomQ({ shifts: [...allShifts({ built: { ...week.built, [date]: next }, inherited: week.inherited })] }, st.userId, b.structure) : Infinity;
        for (const g of sh.segments) {
          if (g !== host) { parts.push(g); continue; }
          if (g.startQ < st.fromQ) parts.push({ ...g, endQ: st.fromQ });
          // Decision 4: a salaried relabel takes the base station room first, then FLEX.
          for (const part of splitSalariedRelabel(st.fromQ, st.toQ, room, salaried && isFlexSegment(g))) {
            parts.push({ positionId: st.positionId, startQ: part.startQ, endQ: part.endQ, reasons: [r], ...last, ...(part.flex ? { reasonKey: SALARIED_FLEX_REASON } : {}) });
          }
          if (st.toQ < g.endQ) parts.push({ ...g, startQ: st.toQ });
        }
        sh.segments = parts;
      }
      sh.reasons = [...sh.reasons, r];
    }
    return true;
  }, (next) => {
    if (b.budgetedDates.includes(date) && budgetUsedHours(b, { built: { ...week.built, [date]: next }, inherited: week.inherited }) > b.budgetHours) return false;
    const after = uncoveredTotals(b, date, next);
    return after.total < before.total && after.essential <= before.essential;
  });
}

/**
 * Juan 2026-10-16 (decision 8): the CATERING MANAGER as the LAST-RESORT cover of a station — never Prep/Dishwasher, never
 * a primary planned for them: only the quarters of their own (pinned) shift's MoD time that fall OUTSIDE every booked
 * catering window (`cateringWindows`, from the booked-catering input), carved onto the position as a last resort with the
 * reason `catering_manager_cover` (`CATERING_MANAGER_COVER` on the segment). Guarded; kept only when the day's uncovered
 * total strictly falls. Runs after every other fill, before any gap is declared.
 */
export function coverWithCateringManager(b: BuildCtx, week: WeekState, date: string, positionId: string, fromQ: number, toQ: number): boolean {
  const day = b.ctx.days[date]!;
  const pos = b.structure.positions[positionId];
  if (!pos || pos.role === "prep_dish") return false;
  const windows = cateringWindows(day);
  const inWindow = (q: number) => windows.some(([a, z]) => q >= a && q < z);
  const primary = primaryOf(b.structure, positionId);
  const needsPrimary = primary !== null && primary !== positionId;
  for (const sh of [...week.built[date]!].sort(shiftOrder)) {
    const p = b.people[sh.userId];
    if (!p || p.role !== "catering_mgr" || !p.activeMember) continue;
    // Astra chunk H P2-2: the pin's position allowlist binds, exactly as in `coverWithManager` (no positions = any).
    if (sh.pinned) {
      const allowed = b.pinCover[`${sh.date}|${sh.userId}|${sh.startQ}`];
      if (!allowed || (allowed !== "any" && !allowed.includes(positionId))) continue;
    }
    for (const g of sh.segments) {
      if (g.positionId !== MOD) continue;
      const shifts = week.built[date]!;
      const ok = (q: number) => !inWindow(q) && deficitAt(shifts, day, positionId, q) > 0 && occupancy(shifts, positionId, q) < positionLimit(pos, q)
        && (!needsPrimary || occupancy(shifts, primary!, q) > 0) && q >= pos.openQ && q < pos.closeQ;
      let a = Math.max(fromQ, g.startQ);
      const end = Math.min(toQ, g.endQ);
      while (a < end && !ok(a)) a++;
      if (a >= end) continue;
      let z = a + 1;
      while (z < end && ok(z)) z++;
      const r = reason("catering_manager_cover", { positionId, fromQ: a, toQ: z, userId: sh.userId });
      const before = uncoveredTotals(b, date, shifts);
      const done = guarded(b, week, date, (next) => {
        const mine = next.find((x) => x.userId === sh.userId && x.startQ === sh.startQ);
        if (!mine) return false;
        const parts: GSegment[] = [];
        for (const seg of mine.segments) {
          if (seg.positionId !== MOD || seg.endQ <= a || seg.startQ >= z) { parts.push(seg); continue; }
          if (seg.startQ < a) parts.push({ ...seg, endQ: a });
          parts.push({ positionId, startQ: a, endQ: z, reasons: [r], lastResort: true, reasonKey: CATERING_MANAGER_COVER });
          if (z < seg.endQ) parts.push({ ...seg, startQ: z });
        }
        mine.segments = parts;
        mine.reasons = [...mine.reasons, r];
        return true;
      }, (next) => uncoveredTotals(b, date, next).total < before.total);
      if (done) return true;
    }
  }
  return false;
}

/**
 * CC chunk H2 (2026-10-16): the LAST-RESORT fill, after every hourly fill, the zero-cost extensions / relabels and the catering
 * manager's cover, before any gap is declared — a salaried manager COVERS an otherwise-uncovered window on a FLEX block
 * (`salariedFlexBlocks`: a new block ≥ 4 h, or an extension of their day; inside the remaining flex, the daily maximum,
 * availability, leader setting, cover list or the MoD lane; never over anyone). The block that fills the most uncovered
 * head-quarters wins (ties: the canonical order). Every quarter carries `SALARIED_FLEX_REASON` and the reason
 * `salaried_flex_cover`. Guarded; kept only when the day's uncovered total strictly falls and essential coverage never does.
 */
export function coverWithFlexBlock(b: BuildCtx, week: WeekState, date: string): boolean {
  const s = { locationId: b.ctx.locationId, weekStart: b.ctx.weekStart, shifts: allShifts(week), gaps: [], days: [] };
  const blocks = salariedFlexBlocks(date, s, b.ctx).map((blk, i) => ({ blk, i })).sort((x, y) => y.blk.gain - x.blk.gain || x.i - y.i).map((x) => x.blk);
  for (const blk of blocks) if (placeFlexBlock(b, week, date, blk)) return true;
  return false;
}

/**
 * CC chunk H3 (2026-10-16, Astra H2 P1): FILL and PROOF agree — after the preferred flex fill has nothing left, every remaining
 * coverage deficit is put to the TARGET-DIRECTED reach (`flexBlockReaching`: any legal block ON THAT POSITION by any salaried
 * manager, judged on the schedule as it stands). A block it finds does not conflict by construction (the real legality on
 * the real state), so the generator TAKES it; a deficit no block reaches is what `floor_limit` then certifies. Returns
 * whether a block was placed.
 */
export function coverWithTargetFlexBlock(b: BuildCtx, week: WeekState, date: string, d: { code: string; positionId: string | null; fromQ: number; toQ: number }): boolean {
  if (d.code !== "coverage_gap" || !d.positionId) return false;
  const s = { locationId: b.ctx.locationId, weekStart: b.ctx.weekStart, shifts: allShifts(week), gaps: [], days: [] };
  const blk = flexBlockReaching({ code: "coverage_gap", date, positionId: d.positionId, fromQ: d.fromQ, toQ: d.toQ }, s, b.ctx);
  return blk !== null && placeFlexBlock(b, week, date, blk);
}

/** One flex block (new or an extension) placed on the day, guarded; kept only when the uncovered total strictly falls and essential coverage never does. */
function placeFlexBlock(b: BuildCtx, week: WeekState, date: string, blk: FlexBlock): boolean {
  const before = uncoveredTotals(b, date, week.built[date]!);
  const r = reason("salaried_flex_cover", { userId: blk.userId, fromQ: blk.fromQ, toQ: blk.toQ, kind: blk.kind });
  const segs: GSegment[] = blk.segments.map((g) => ({ ...g, reasons: [reason("salaried_flex_cover", { userId: blk.userId, positionId: g.positionId, fromQ: g.startQ, toQ: g.endQ })], reasonKey: SALARIED_FLEX_REASON }));
  return guarded(b, week, date, (next) => {
    if (blk.kind === "new_block") {
      next.push({ userId: blk.userId, date, startQ: blk.fromQ, endQ: blk.toQ, segments: segs, closingManager: false, flex: false, pinned: false, reasons: [r], origin: "salaried" });
      return true;
    }
    const sh = next.find((x) => x.userId === blk.userId && x.startQ === blk.shiftStartQ);
    if (!sh || sh.pinned) return false;
    if (blk.fromQ === sh.endQ) sh.segments = [...sh.segments, ...segs];
    else if (blk.toQ === sh.startQ) sh.segments = [...segs, ...sh.segments];
    else return false;
    sh.startQ = Math.min(sh.startQ, blk.fromQ);
    sh.endQ = Math.max(sh.endQ, blk.toQ);
    sh.reasons = [...sh.reasons, r];
    return true;
  }, (next) => { const after = uncoveredTotals(b, date, next); return after.total < before.total && after.essential <= before.essential; });
}

// ─── Priority enforcement (the mockup's enforcePriority) ─────────────────────

/** Wherever a secondary is filled without its primary, relabel the secondary segment to the primary when allowed and open. */
export function enforcePriority(b: BuildCtx, week: WeekState, date: string): void {
  const day = b.ctx.days[date]!;
  const s = b.structure;
  for (const pair of s.priority) {
    const secondary = pair.pair[0] === pair.primary ? pair.pair[1] : pair.pair[0];
    const primaryPos = s.positions[pair.primary];
    if (!primaryPos) continue;
    for (const sh of [...week.built[date]!].sort(shiftOrder)) {
      const p = b.people[sh.userId];
      if (!p || !eligibleForPosition(p, primaryPos)) continue;
      for (const g of sh.segments) {
        if (g.positionId !== secondary) continue;
        let q = g.startQ;
        while (q < g.endQ) {
          const shifts = week.built[date]!;
          const bad = (x: number) => occupancy(shifts, pair.primary, x) === 0 && roomAt(shifts, day, pair.primary, x);
          if (!bad(q)) { q++; continue; }
          let stop = q + 1;
          while (stop < g.endQ && bad(stop)) stop++;
          const [from, to] = [q, stop];
          guarded(b, week, date, (next) => {
            const mine = next.find((x) => x.userId === sh.userId)!;
            const parts: GSegment[] = [];
            for (const seg of mine.segments) {
              if (seg.positionId !== secondary || seg.endQ <= from || seg.startQ >= to) { parts.push(seg); continue; }
              if (seg.startQ < from) parts.push({ ...seg, endQ: from });
              parts.push({ positionId: pair.primary, startQ: from, endQ: to, reasons: [reason("priority_cover", { positionId: pair.primary, secondary, fromQ: from, toQ: to })], ...(isFlexSegment(seg) ? { reasonKey: SALARIED_FLEX_REASON } : {}) });
              if (to < seg.endQ) parts.push({ ...seg, startQ: to });
            }
            mine.segments = parts;
            return true;
          });
          q = stop;
        }
      }
    }
  }
}

// ─── The Closing Manager ─────────────────────────────────────────────────────

/**
 * Among the closers whose shift covers service close → scheduled out on a line position, in an allowed
 * closing role whose setting allows closing: the highest `closeOnTime` mean, else role rank, then userId.
 * Flags exactly one; clears any other flag.
 */
export function assignClosingManager(b: BuildCtx, week: WeekState, date: string): void {
  const day = b.ctx.days[date]!;
  if (!closingRequired(day)) return;
  const s = b.structure;
  const { serviceCloseQ } = s.shopDay;
  const shifts = week.built[date]!;
  const eligible = shifts.filter((sh) => {
    const p = b.people[sh.userId];
    return !!p && closingManagerEligible(p, s) && coversClosingWindow(sh, day)
      && sh.segments.some((g) => { const pos = s.positions[g.positionId]; return !!pos && isLineRole(pos.role) && g.startQ < day.scheduledOutQ && g.endQ > serviceCloseQ; });
  }).sort((x, y) => {
    const cx = closeScore(b.lookup, x.userId) ?? -1;
    const cy = closeScore(b.lookup, y.userId) ?? -1;
    return cy - cx || roleRank(b, y.userId) - roleRank(b, x.userId) || cmp(x.userId, y.userId);
  });
  const chosen = eligible[0]?.userId ?? null;
  if (!chosen && !shifts.some((x) => x.closingManager)) return;
  guarded(b, week, date, (next) => {
    for (const sh of next) {
      const flag = sh.userId === chosen;
      if (flag && !sh.closingManager) sh.reasons = [...sh.reasons, reason("closing_manager", { userId: sh.userId, closeScore: closeScore(b.lookup, sh.userId) })];
      sh.closingManager = flag;
    }
    return true;
  });
}

function roleRank(b: BuildCtx, userId: string): number {
  const role = b.people[userId]?.role;
  return role === "owner" ? 5 : role === "moo" ? 4 : role === "gm" ? 3 : role === "agm" ? 2 : role === "shift_lead" ? 1 : 0;
}

// ─── The MoD lane fill ───────────────────────────────────────────────────────

/** Quarters of the shop day with no manager on duty, as runs. */
export function modHoles(b: BuildCtx, date: string, shifts: readonly GShift[]): Array<[number, number]> {
  const day = b.ctx.days[date]!;
  if (!day.structure.leadership.modRequired) return [];
  const out: Array<[number, number]> = [];
  // Astra chunk B P1-2: a hole never spans an eligibility boundary (KH may be MoD from `keyHolderModAfterQ`).
  const boundary = day.structure.leadership.keyHolderModAfterQ;
  for (let q = day.structure.shopDay.prepStartQ; q < day.scheduledOutQ; q++) {
    if (modOnClockAt(b, shifts, q)) continue;
    const last = out[out.length - 1];
    if (last && last[1] === q && q !== boundary) last[1] = q + 1;
    else out.push([q, q + 1]);
  }
  return out;
}

/**
 * Fill a MoD hole with an eligible hourly manager (SL+, or a KH after the shop's setting time) on a `mod`
 * block reaching the minimum shift inside the shop day; their own adjacent shift may extend instead.
 */
export function fillModHole(b: BuildCtx, week: WeekState, date: string, fromQ: number, toQ: number, tiers: readonly RelaxTier[] = RELAX_TIERS): boolean {
  const day = b.ctx.days[date]!;
  const minQ = b.structure.limits.minimumShiftQ;
  const lo = day.structure.shopDay.prepStartQ;
  const hi = day.scheduledOutQ;
  let a = fromQ;
  let z = toQ;
  while (z - a < minQ && z < hi) z++;
  while (z - a < minQ && a > lo) a--;
  if (z - a < minQ) return false;
  const plan: BlockPlan = { startQ: a, endQ: z, segments: [{ positionId: MOD, startQ: a, endQ: z, kind: "core" }] };
  for (const { allowOvertime, allowOffDay, allowSoftMax } of tiers) {
    const o: CandidateOpts = { date, plan, positionId: null, closingLead: false, allowOvertime, allowOffDay, allowSoftMax, mod: true, modFromQ: fromQ };
    const ranked = rankCandidates(b, week, week.built[date]!, o);
    for (const c of ranked.slice(0, 6)) {
      const r = reason("mod_cover", { fromQ, toQ, userId: c.person.userId });
      const ok = guarded(b, week, date, (shifts) => {
        const overtime = allowOvertime && (weekQuarters(week, c.person.userId) + plan.endQ - plan.startQ) / 4 > b.structure.limits.overtimeH;
        applyPlacement(shifts, c, { date, plan, sourceReason: r, closingLead: false, extraReasons: overtime ? [reason("overtime_last_resort", { userId: c.person.userId })] : [] }, b.people, null);
        return true;
      }, (next) => modHoles(b, date, next).reduce((n, [f, t]) => n + (t - f), 0) < modHoles(b, date, week.built[date]!).reduce((n, [f, t]) => n + (t - f), 0));
      if (ok) return true;
    }
  }
  return false;
}

// ─── Merge + canonical form ──────────────────────────────────────────────────

/** Merge adjacent same-position segments within each shift and sort everything canonically. */
export function canonicalDay(shifts: GShift[]): GShift[] {
  const out = shifts.map(cloneShift);
  for (const sh of out) {
    sh.segments.sort((a, b) => a.startQ - b.startQ);
    const merged: GSegment[] = [];
    for (const g of sh.segments) {
      const prev = merged[merged.length - 1];
      if (prev && prev.positionId === g.positionId && prev.endQ === g.startQ && !!prev.lastResort === !!g.lastResort && prev.coverFor === g.coverFor && prev.reasonKey === g.reasonKey) {
        prev.endQ = g.endQ;
        prev.reasons = [...prev.reasons, ...g.reasons];
      } else merged.push({ ...g });
    }
    sh.segments = merged;
    sh.startQ = merged[0]!.startQ;
    sh.endQ = merged[merged.length - 1]!.endQ;
  }
  return out.sort(shiftOrder);
}

export function sortNotes(notes: BoardNote[]): BoardNote[] {
  const seen = new Set<string>();
  const out: BoardNote[] = [];
  for (const n of [...notes].sort(noteOrder)) {
    const key = JSON.stringify([n.code, n.date, n.userId, n.positionId, n.params]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

export { isSecondary, primaryOf };
