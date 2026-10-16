/**
 * THE SCHEDULE VALIDATOR `checkScheduleRules` — pure, total over its contract, deterministic in its
 * output order (Scheduling Phase 2, spec §6.5, plan "The validator ↔ mockup invariants map", Task 3).
 *
 * It runs on every generated, regenerated and edited schedule and in the tests; a GENERATED schedule
 * that fails it is a bug. It checks the mockup v17 `checkInvariants` (a)–(i), verified against the
 * source — (a) person overlap, (b) head count before / after the trim, (c) the minimum shift (flex
 * exception inert), (d) allowed roles and "manager on Prep/Dishwasher" as TWO codes with the call-out
 * exemption as an inert branch, (e) the OPEN–CLOSE window, (f)/(g) the Closing Manager's role and
 * setting and the leader open/close setting, (h) a secondary filled without its primary, per slot,
 * (i) manager cover outside the preferred list unless marked last resort — plus the structural checks,
 * the spec's rules (MoD, salaried minimums, the manager floor, work types, the untouchable day) and the
 * warnings. Every gap-class deficit must be DECLARED and CERTIFIED (r2 P1-1): a declared gap passes
 * only when `checkCertificate` verifies the certificate for its cause against the revision's own
 * validation context — never the live inputs (r3 P2-4); coverage and certificates read `need(p, q)`
 * from the context's stored need grid (r4), never recompute it.
 *
 * THE HISTORICAL CONTRACT (r2 P1-3): a day marked `inherited` is NOT re-judged — its recorded problems
 * return as-is, labelled inherited, whatever happened to the person or the position since. Cross-day
 * totals (overtime, the floor, the soft range, the budget) COUNT inherited hours but attribute a
 * problem only to a built day.
 */
import { getRoleLevel, type RoleCode } from "@/lib/roles";
import {
  checklistFits, isLineRole, positionLimit, primaryOf, type LeaderSetting, type ScheduleStructure, type StructurePosition,
} from "./structure-shared";
import { canonicalJson, type DayContext, type RuleContext, type RulePerson } from "./context-shared";
import type { ScheduleErrorCode } from "./errors-shared";

// ─── The schedule shape ──────────────────────────────────────────────────────

/** The Manager-on-duty lane's pseudo position. */
export const MOD = "mod";
/** The reason key that marks the call-out last resort (rule d's exemption; Phase 2 never emits it). */
export const CALLOUT_LAST_RESORT = "schedule.reason.callout_last_resort";

export interface Segment { positionId: string; startQ: number; endQ: number; lastResort?: boolean; coverFor?: string; reasonKey?: string }
export interface Shift { userId: string; date: string; startQ: number; endQ: number; segments: Segment[]; closingManager: boolean; flex: boolean; pinned: boolean }

export type GapCode = "coverage_gap" | "mod_missing" | "closing_manager_missing";
export type GapCause = "budget" | "floor_limit" | "eligibility" | "availability" | "capacity" | "structure" | "unresolved_search";
/** The fixed order in which a deficit takes the FIRST proven cause that certifies (generator step 9a.6). */
export const PROVEN_CAUSE_ORDER = ["structure", "eligibility", "capacity", "availability", "floor_limit", "budget"] as const;

/** The bounded repair search's limits (generator step 9a), stored in every `unresolved_search` certificate. */
export const REPAIR_LIMITS = { REPAIR_MAX_STEPS: 200, maxDonors: 8, maxChainDepth: 3 } as const;

export interface BudgetCertificate { budgetedDates: string[]; budgetHours: number; usedHours: number; essentialHours: number; hoursNeeded: number }
export interface FloorLimitCertificate { managerIds: string[]; floorHoursUsed: Record<string, number>; limitH: number }
export interface EligibilityCertificate { positionId: string | null; eligibleCount: 0 }
export interface AvailabilityCertificate { eligibleIds: string[]; unavailableIds: string[] }
export interface CapacityCertificate { fromQ: number; toQ: number; positionIds: string[]; requiredHeads: number; peopleIds: string[]; people: number; shortBy: number }
/**
 * The configuration itself makes the need impossible. A position window shorter than the minimum shift is
 * NOT one of them (Astra chunk A P2-4): the minimum applies to the whole SHIFT, and a short window is
 * filled as a segment of a multi-position shift.
 */
export type StructureRule = "primary_window_closed" | "no_mod_member" | "no_closing_role";
export interface StructureCertificate { rule: StructureRule; detail: Record<string, string | number> }
export interface UnresolvedSearchCertificate {
  searched: { steps: number; donorsTried: number; chainDepth: number };
  limits: { REPAIR_MAX_STEPS: number; maxDonors: number; maxChainDepth: number };
  candidateIds: string[];
}

interface GapBase { code: GapCode; date: string; positionId: string | null; fromQ: number; toQ: number }
export type DeclaredGap = GapBase & (
  | { cause: "budget"; certificate: BudgetCertificate }
  | { cause: "floor_limit"; certificate: FloorLimitCertificate }
  | { cause: "eligibility"; certificate: EligibilityCertificate }
  | { cause: "availability"; certificate: AvailabilityCertificate }
  | { cause: "capacity"; certificate: CapacityCertificate }
  | { cause: "structure"; certificate: StructureCertificate }
  | { cause: "unresolved_search"; certificate: UnresolvedSearchCertificate }
);
export type GapCertificate = DeclaredGap["certificate"];
/** A deficit to prove: a gap without its cause yet. */
export type GapSubject = GapBase;

export type RuleSeverity = "error" | "gap" | "warning";

/** THE SEVERITY TABLE — the plan's map, one row per code. */
export const RULE_CODES = {
  person_overlap: "error",
  position_over_headcount: "error",
  shift_below_minimum: "error",
  role_not_allowed: "error",
  manager_on_boh: "error",
  segment_outside_window: "error",
  closing_manager_role: "error",
  leader_setting: "error",
  closing_manager_setting: "error",
  /** Astra chunk A P1: the Closing Manager flag on a shift that does not cover service close → everyone out. */
  closing_manager_not_closing: "error",
  secondary_without_primary: "error",
  cover_outside_preferences: "error",
  segments_malformed: "error",
  unknown_person: "error",
  not_member: "error",
  salaried_minimum: "error",
  manager_floor_exceeded: "error",
  work_type_not_allowed: "error",
  untouchable_day: "error",
  /** A deficit with no declared gap. */
  undeclared_gap: "error",
  /** A declared gap whose certificate does not verify. */
  uncertified_gap: "error",
  mod_missing: "gap",
  closing_manager_missing: "gap",
  coverage_gap: "gap",
  overtime: "warning",
  over_budget: "warning",
  soft_range: "warning",
  outside_assumed_availability: "warning",
  checklist_past_max: "warning",
  flex_used: "warning",
  pairing_unmet: "warning",
} as const satisfies Record<string, RuleSeverity>;
export type RuleCode = keyof typeof RULE_CODES;

export interface RuleProblem {
  code: RuleCode;
  severity: RuleSeverity;
  day: string;
  userId?: string;
  positionId?: string;
  q?: number;
  params: Record<string, string | number | boolean | null>;
  inherited: boolean;
}

export interface DayRecord { date: string; originRevisionId: string | null; structureVersionId: string; inherited: boolean; problems: RuleProblem[] }
export interface WeekSchedule { locationId: string; weekStart: string; shifts: Shift[]; gaps: DeclaredGap[]; days: DayRecord[] }

// ─── People rules ────────────────────────────────────────────────────────────

const LEADER_ROLES: readonly RoleCode[] = ["key_holder", "shift_lead", "agm", "gm", "moo", "owner"];

/** Managers (MoD-eligible, rule d / i) = shift lead and up (§5.7). */
export function isManagerRole(role: RoleCode): boolean {
  return getRoleLevel(role) >= 5;
}

export function leaderSettingOf(p: RulePerson, s: ScheduleStructure): LeaderSetting {
  return p.leaderSetting ?? s.leadership.leaderDefaults[p.role] ?? "mix";
}

/** The mockup's work-type rule: Management anything; Prep/Dishwasher BOH; Prep BOH or FOH; the line FOH. */
export function workTypeAllows(p: RulePerson, pos: StructurePosition): boolean {
  if (p.workType === "management") return true;
  if (pos.role === "prep_dish") return p.workType === "boh" || p.alsoAllowed.includes("boh");
  if (pos.role === "prep") return p.workType === "boh" || p.workType === "foh" || p.alsoAllowed.includes("boh");
  return p.workType === "foh" || p.alsoAllowed.includes("foh");
}

/** May this person be placed on this position at all (role, Prep/Dishwasher never for a manager, work type)? */
export function eligibleForPosition(p: RulePerson, pos: StructurePosition | undefined): boolean {
  if (!pos || !p.activeMember || p.presenceOnly) return false;
  if (!pos.allowedRoles.includes(p.role)) return false;
  if (pos.role === "prep_dish" && isManagerRole(p.role)) return false;
  return workTypeAllows(p, pos);
}

function eligibleFor(p: RulePerson, code: GapCode, positionId: string | null, s: ScheduleStructure): boolean {
  if (!p.activeMember || p.presenceOnly) return false;
  if (code === "mod_missing") return isManagerRole(p.role);
  if (code === "closing_manager_missing") return s.leadership.closingRoles.includes(p.role) && leaderSettingOf(p, s) !== "opens";
  return positionId !== null && eligibleForPosition(p, s.positions[positionId]);
}

/** Available over [fromQ, toQ) on `date`: no information = available; null = not that day. */
export function availableOn(p: RulePerson, date: string, fromQ: number, toQ: number): boolean {
  const w = p.availability[date];
  if (w === undefined) return true;
  if (w === null) return false;
  return fromQ >= w.fromQ && toQ <= w.toQ;
}

const sortIds = (a: string[]) => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && sortIds([...a]).every((x, i) => x === sortIds([...b])[i]);
const isHourly = (p: RulePerson) => !p.salaried && !p.presenceOnly;
const segLenQ = (g: Segment) => g.endQ - g.startQ;

// ─── Coverage over a schedule (pure helpers shared by the checks and the certificates) ──

function shiftsOn(s: WeekSchedule, date: string): Shift[] {
  return s.shifts.filter((x) => x.date === date);
}

/** The shop day of a built date: [prep start, scheduled out). */
const shopWindow = (day: DayContext) => ({ fromQ: day.structure.shopDay.prepStartQ, toQ: day.scheduledOutQ });

/** Is a Closing Manager required on this date? When any line position needs a head in the closing window. */
function closingManagerRequired(day: DayContext): boolean {
  const { serviceCloseQ } = day.structure.shopDay;
  for (const [id, arr] of Object.entries(day.need.positions)) {
    const pos = day.structure.positions[id];
    if (!pos || !isLineRole(pos.role)) continue;
    for (let q = serviceCloseQ; q < day.scheduledOutQ; q++) if ((arr[q] ?? 0) > 0) return true;
  }
  return false;
}

/** Does this shift cover the whole closing window (service close → everyone out)? The Closing Manager's shift must. */
export function coversClosingWindow(sh: Pick<Shift, "startQ" | "endQ">, day: Pick<DayContext, "structure" | "scheduledOutQ">): boolean {
  return sh.startQ <= day.structure.shopDay.serviceCloseQ && sh.endQ >= day.scheduledOutQ;
}

/** May this person carry the Closing Manager role at all (an allowed closing role whose setting is not opens-only)? */
export function closingManagerEligible(p: RulePerson, s: ScheduleStructure): boolean {
  return p.activeMember && !p.presenceOnly && s.leadership.closingRoles.includes(p.role) && leaderSettingOf(p, s) !== "opens";
}

/**
 * One date's coverage, computed once: heads per position per quarter, managers on the clock, and the
 * quarters an ELIGIBLE flagged Closing Manager is actually on the clock (Astra chunk A P1: the flag on a
 * shift that leaves before closing covers nothing).
 */
interface DayCoverage { byPosition: Map<string, number[]>; managers: number[]; closingManagerAt: Uint8Array; closingRequired: boolean }

function dayCoverage(shifts: readonly Shift[], day: DayContext, ctx: RuleContext): DayCoverage {
  const byPosition = new Map<string, number[]>();
  const managers = new Array<number>(96).fill(0);
  const closingManagerAt = new Uint8Array(96);
  for (const sh of shifts) {
    const p = ctx.people[sh.userId];
    const onClock = new Set<number>();
    for (const g of sh.segments) {
      let arr = byPosition.get(g.positionId);
      if (!arr) { arr = new Array<number>(96).fill(0); byPosition.set(g.positionId, arr); }
      for (let q = Math.max(0, g.startQ); q < Math.min(96, g.endQ); q++) { arr[q]!++; onClock.add(q); }
    }
    if (p && isManagerRole(p.role)) for (const q of onClock) managers[q]!++;
    if (sh.closingManager && p && closingManagerEligible(p, day.structure)) for (const q of onClock) closingManagerAt[q] = 1;
  }
  return { byPosition, managers, closingManagerAt, closingRequired: closingManagerRequired(day) };
}

/** The heads still uncovered at q for one gap kind. */
function uncoveredFrom(cov: DayCoverage, code: GapCode, positionId: string | null, day: DayContext, q: number): number {
  if (code === "coverage_gap") {
    const need = positionId ? day.need.positions[positionId]?.[q] ?? 0 : 0;
    return Math.max(0, need - (positionId ? cov.byPosition.get(positionId)?.[q] ?? 0 : 0));
  }
  if (code === "mod_missing") {
    const w = shopWindow(day);
    if (!day.structure.leadership.modRequired || q < w.fromQ || q >= w.toQ) return 0;
    return (cov.managers[q] ?? 0) === 0 ? 1 : 0;
  }
  if (!cov.closingRequired || q < day.structure.shopDay.serviceCloseQ || q >= day.scheduledOutQ) return 0;
  return cov.closingManagerAt[q] ? 0 : 1;
}

/** Non-mod ("floor") hours of a person over the whole week, inherited days included. */
function floorHours(s: WeekSchedule, userId: string): number {
  let q = 0;
  for (const sh of s.shifts) if (sh.userId === userId) for (const g of sh.segments) if (g.positionId !== MOD) q += segLenQ(g);
  return q / 4;
}

/** The leader open / close setting allows a shift spanning [fromQ, toQ)? (opens: ends before service close; closes: starts at or after service start) */
export function leaderSettingAllows(p: RulePerson, s: ScheduleStructure, fromQ: number, toQ: number): boolean {
  if (!LEADER_ROLES.includes(p.role)) return true;
  const setting = leaderSettingOf(p, s);
  if (setting === "opens") return toQ < s.shopDay.serviceCloseQ;
  if (setting === "closes") return fromQ >= s.shopDay.serviceStartQ;
  return true;
}

/**
 * Astra chunk A P1 (floor_limit): an hourly person with a shift that day is still FREE for a window when
 * that shift can be EXTENDED over it — no overlap with the window, the merged span inside the shop day,
 * their availability and their leader setting, and room (under the head limit) on the gap's position over
 * any quarters bridging the shift and the window. A window INSIDE the shift (they are on another position
 * then) is not an extension: that is the repair search's business.
 */
export function shiftExtendsOver(
  p: RulePerson, sh: Pick<Shift, "startQ" | "endQ">, day: DayContext, date: string, fromQ: number, toQ: number,
  roomAt: (q: number) => boolean,
): boolean {
  if (sh.endQ > fromQ && sh.startQ < toQ) return false;
  const spanFrom = Math.min(sh.startQ, fromQ);
  const spanTo = Math.max(sh.endQ, toQ);
  const shop = shopWindow(day);
  if (spanFrom < shop.fromQ || spanTo > shop.toQ) return false;
  if (!availableOn(p, date, spanFrom, spanTo) || !leaderSettingAllows(p, day.structure, spanFrom, spanTo)) return false;
  const [bridgeFrom, bridgeTo] = sh.endQ <= fromQ ? [sh.endQ, fromQ] : [toQ, sh.startQ];
  for (let q = bridgeFrom; q < bridgeTo; q++) if (!roomAt(q)) return false;
  return true;
}

/**
 * Is the person free for a cover over [fromQ, toQ) on `date`? Hourly: no shift that day, OR a shift that
 * day that extends over the window (above). Salaried: no floor segment then.
 */
function freeFor(p: RulePerson, s: WeekSchedule, date: string, fromQ: number, toQ: number, day: DayContext, positionId: string | null): boolean {
  const own = s.shifts.filter((sh) => sh.date === date && sh.userId === p.userId);
  if (!isHourly(p)) return !own.some((sh) => sh.segments.some((g) => g.positionId !== MOD && g.startQ < toQ && g.endQ > fromQ));
  if (own.length === 0) return true;
  const pos = positionId ? day.structure.positions[positionId] : undefined;
  const occupied = (q: number) => shiftsOn(s, date).reduce((n, sh) => n + (sh.segments.some((g) => g.positionId === positionId && g.startQ <= q && g.endQ > q) ? 1 : 0), 0);
  const roomAt = (q: number) => (pos ? occupied(q) < positionLimit(pos, q) : true);
  return own.some((sh) => shiftExtendsOver(p, sh, day, date, fromQ, toQ, roomAt));
}

// ─── Budget arithmetic (r3 per-DATE budgets) ─────────────────────────────────

function budgetFacts(s: WeekSchedule, ctx: RuleContext) {
  const budgetedDates = ctx.dates.filter((d) => ctx.budgetByDate[d] !== null && ctx.budgetByDate[d] !== undefined).sort();
  const budgetHours = budgetedDates.reduce((n, d) => n + (ctx.budgetByDate[d] ?? 0), 0);
  let usedQ = 0;
  let essentialQ = 0;
  const lastHourlyDate: string[] = [];
  for (const sh of s.shifts) {
    const p = ctx.people[sh.userId];
    if (!p || !isHourly(p) || !budgetedDates.includes(sh.date)) continue;
    const len = sh.endQ - sh.startQ;
    usedQ += len;
    lastHourlyDate.push(sh.date);
    const cw = ctx.closingWindowByDate[sh.date];
    // The closing crew is ESSENTIAL: a block working the closing window counts whole (the mockup's `essential`).
    if (cw && sh.segments.some((g) => g.positionId !== MOD && g.startQ < cw.toQ && g.endQ > cw.fromQ)) essentialQ += len;
  }
  return { budgetedDates, budgetHours, usedHours: usedQ / 4, essentialHours: essentialQ / 4, datesWithHourly: lastHourlyDate };
}

/**
 * May budget excuse this deficit at all? Never for the MoD or the Closing Manager, and never for a coverage
 * deficit that intersects the closing window: its fill is a shift working the closing window, which the
 * essential-hours rule exempts from the budget (Astra chunk A P1).
 */
function budgetMayExcuse(g: GapSubject, ctx: RuleContext): boolean {
  if (g.code !== "coverage_gap") return false;
  const cw = ctx.closingWindowByDate[g.date];
  return !cw || g.toQ <= cw.fromQ || g.fromQ >= cw.toQ;
}

// ─── Structure infeasibility (the `structure` cause) ─────────────────────────

function structureRules(st: ScheduleStructure, g: GapSubject, roster: readonly RulePerson[]): Array<{ rule: StructureRule; detail: Record<string, string | number> }> {
  const out: Array<{ rule: StructureRule; detail: Record<string, string | number> }> = [];
  if (g.code === "coverage_gap" && g.positionId) {
    const primary = primaryOf(st, g.positionId);
    const pp = primary && primary !== g.positionId ? st.positions[primary] : undefined;
    if (pp && g.toQ > g.fromQ) {
      let closed = true;
      for (let q = g.fromQ; q < g.toQ; q++) if (positionLimit(pp, q) > 0) { closed = false; break; }
      if (closed) out.push({ rule: "primary_window_closed", detail: { positionId: g.positionId, primaryId: primary! } });
    }
  }
  if (g.code === "mod_missing" && !roster.some((p) => p.activeMember && !p.presenceOnly && isManagerRole(p.role))) {
    out.push({ rule: "no_mod_member", detail: {} });
  }
  if (g.code === "closing_manager_missing" && !roster.some((p) => eligibleFor(p, "closing_manager_missing", null, st))) {
    out.push({ rule: "no_closing_role", detail: {} });
  }
  return out;
}

/**
 * The configuration itself makes the need impossible: a priority secondary needed while its primary's
 * window is closed; the MoD required with no SL+ member (needs `roster`); a Closing Manager with no
 * member able to close. (A short position window is NOT infeasible: Astra chunk A P2-4.)
 */
export function structureInfeasible(structure: ScheduleStructure, date: string, g: GapSubject, roster: readonly RulePerson[] = []): boolean {
  void date;
  return structureRules(structure, g, roster).length > 0;
}

// ─── Capacity (the r3 counting bound) ────────────────────────────────────────

function capacityFor(S: readonly string[], g: GapSubject, s: WeekSchedule, day: DayContext, ctx: RuleContext): CapacityCertificate | null {
  const shifts = shiftsOn(s, g.date);
  const st = day.structure;
  let required = Infinity;
  const people = new Set<string>();
  for (let q = g.fromQ; q < g.toQ; q++) {
    let need = 0;
    for (const p of S) need += day.need.positions[p]?.[q] ?? 0;
    required = Math.min(required, need);
    for (const person of Object.values(ctx.people)) {
      const eligible = S.some((p) => eligibleForPosition(person, st.positions[p])) && availableOn(person, g.date, q, q + 1);
      // Anyone actually standing on S at q counts too (a presence pin, a manager cover).
      const placed = shifts.some((sh) => sh.userId === person.userId && sh.segments.some((x) => S.includes(x.positionId) && x.startQ <= q && x.endQ > q));
      if (eligible || placed) people.add(person.userId);
    }
  }
  if (!Number.isFinite(required)) return null;
  const peopleIds = sortIds([...people]);
  return { fromQ: g.fromQ, toQ: g.toQ, positionIds: sortIds([...S]), requiredHeads: required, peopleIds, people: peopleIds.length, shortBy: required - peopleIds.length };
}

function subsetsContaining(all: readonly string[], must: string, maxSize: number): string[][] {
  const rest = all.filter((x) => x !== must);
  const out: string[][] = [];
  const pick = (start: number, acc: string[], size: number) => {
    if (acc.length === size) { out.push(sortIds([must, ...acc])); return; }
    for (let i = start; i < rest.length; i++) pick(i + 1, [...acc, rest[i]!], size);
  };
  for (let size = 0; size < maxSize; size++) pick(0, [], size);
  return out;
}

/**
 * The Hall-type counting bound for a coverage deficit: over the subsets S of the positions needing
 * heads in the window that contain the gap's position (sizes 1–4, then the whole set, canonical order),
 * the S with the largest `shortBy = min_q Σ need(S, q) − |N(S)|`, where N(S) = the members eligible for
 * at least one position of S and available at some quarter of the window (plus anyone placed on S).
 * At least `shortBy` heads of S are uncovered at every quarter in EVERY allocation. Null when no S is short.
 */
export function capacityBound(g: Pick<GapSubject, "date" | "positionId" | "fromQ" | "toQ">, s: WeekSchedule, ctx: RuleContext): CapacityCertificate | null {
  const day = ctx.days[g.date];
  if (!day || !g.positionId || g.toQ <= g.fromQ) return null;
  const subject: GapSubject = { code: "coverage_gap", ...g };
  const needing = Object.keys(day.need.positions).filter((p) => {
    for (let q = g.fromQ; q < g.toQ; q++) if ((day.need.positions[p]?.[q] ?? 0) > 0) return true;
    return false;
  }).sort();
  if (!needing.includes(g.positionId)) return null;
  const candidates = subsetsContaining(needing, g.positionId, 4);
  if (needing.length > 4) candidates.push(needing);
  let best: CapacityCertificate | null = null;
  for (const S of candidates) {
    const c = capacityFor(S, subject, s, day, ctx);
    if (c && c.shortBy >= 1 && (!best || c.shortBy > best.shortBy)) best = c;
  }
  return best;
}

// ─── Certificates ────────────────────────────────────────────────────────────

function hoursNeededFor(g: GapSubject, s: WeekSchedule, day: DayContext, ctx: RuleContext): number {
  const cov = dayCoverage(shiftsOn(s, g.date), day, ctx);
  let q4 = 0;
  for (let q = g.fromQ; q < g.toQ; q++) q4 += uncoveredFrom(cov, g.code, g.positionId, day, q);
  return q4 / 4;
}

function eligibleMembers(g: GapSubject, day: DayContext, ctx: RuleContext): RulePerson[] {
  return Object.values(ctx.people).filter((p) => eligibleFor(p, g.code, g.positionId, day.structure))
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

function verify(g: DeclaredGap, s: WeekSchedule, ctx: RuleContext, depth: number): boolean {
  const day = ctx.days[g.date];
  if (!day || g.toQ <= g.fromQ) return false;
  const st = day.structure;
  switch (g.cause) {
    case "budget": {
      // Astra chunk A P1: essential coverage is budget-exempt and can never be excused by budget — the MoD,
      // the Closing Manager, and any coverage deficit whose fill would work the closing window.
      if (!budgetMayExcuse(g, ctx)) return false;
      const c = g.certificate;
      const f = budgetFacts(s, ctx);
      if (!f.budgetedDates.includes(g.date) || !sameIds(c.budgetedDates, f.budgetedDates)) return false;
      if (c.budgetHours !== f.budgetHours || c.usedHours !== f.usedHours || c.essentialHours !== f.essentialHours) return false;
      const needed = hoursNeededFor(g, s, day, ctx);
      if (c.hoursNeeded !== needed || needed <= 0) return false;
      return c.usedHours - c.essentialHours + c.hoursNeeded > c.budgetHours;
    }
    case "floor_limit": {
      if (g.code !== "coverage_gap") return false;
      const c = g.certificate;
      if (c.limitH !== st.limits.managerFloorH) return false;
      const free = eligibleMembers(g, day, ctx).filter((p) => availableOn(p, g.date, g.fromQ, g.toQ) && freeFor(p, s, g.date, g.fromQ, g.toQ, day, g.positionId));
      if (free.length === 0 || free.some(isHourly)) return false;
      if (!sameIds(c.managerIds, free.map((p) => p.userId))) return false;
      const windowH = (g.toQ - g.fromQ) / 4;
      return free.every((p) => c.floorHoursUsed[p.userId] === floorHours(s, p.userId) && floorHours(s, p.userId) + windowH > c.limitH);
    }
    case "eligibility": {
      const c = g.certificate;
      return c.eligibleCount === 0 && c.positionId === g.positionId && eligibleMembers(g, day, ctx).length === 0;
    }
    case "availability": {
      const c = g.certificate;
      const e = eligibleMembers(g, day, ctx).map((p) => p.userId);
      if (e.length === 0 || !sameIds(c.eligibleIds, e) || !sameIds(c.unavailableIds, e)) return false;
      for (const id of e) {
        const p = ctx.people[id]!;
        for (let q = g.fromQ; q < g.toQ; q++) if (availableOn(p, g.date, q, q + 1)) return false;
      }
      return true;
    }
    case "capacity": {
      if (g.code !== "coverage_gap" || !g.positionId) return false;
      const c = g.certificate;
      // Astra chunk A P2-5: a repeated id would manufacture a shortage; reject before recomputing the bound.
      if (new Set(c.positionIds).size !== c.positionIds.length || new Set(c.peopleIds).size !== c.peopleIds.length) return false;
      if (!c.positionIds.includes(g.positionId) || c.fromQ !== g.fromQ || c.toQ !== g.toQ) return false;
      const re = capacityFor(c.positionIds, g, s, day, ctx);
      if (!re || canonicalJson(re) !== canonicalJson({ ...c, positionIds: sortIds([...c.positionIds]), peopleIds: sortIds([...c.peopleIds]) })) return false;
      if (c.shortBy < 1) return false;
      const cov = dayCoverage(shiftsOn(s, g.date), day, ctx);
      for (let q = g.fromQ; q < g.toQ; q++) {
        let uncovered = 0;
        for (const p of c.positionIds) uncovered += uncoveredFrom(cov, "coverage_gap", p, day, q);
        if (uncovered > c.shortBy) return false; // the excess needs another cause
      }
      return true;
    }
    case "structure": {
      const found = structureRules(st, g, Object.values(ctx.people)).map((r) => r.rule);
      return found.includes(g.certificate.rule);
    }
    case "unresolved_search": {
      const c = g.certificate;
      const L = REPAIR_LIMITS;
      if (c.limits.REPAIR_MAX_STEPS !== L.REPAIR_MAX_STEPS || c.limits.maxDonors !== L.maxDonors || c.limits.maxChainDepth !== L.maxChainDepth) return false;
      const { steps, donorsTried, chainDepth } = c.searched;
      for (const n of [steps, donorsTried, chainDepth]) if (!Number.isInteger(n) || n < 0) return false;
      if (steps > L.REPAIR_MAX_STEPS || chainDepth > L.maxChainDepth) return false;
      const hitLimit = steps === L.REPAIR_MAX_STEPS || chainDepth === L.maxChainDepth;
      if (!hitLimit || !Array.isArray(c.candidateIds) || c.candidateIds.some((x) => typeof x !== "string")) return false;
      // Honest only when no PROVEN cause certifies the same deficit.
      return depth > 0 || proveGap(g, s, ctx) === null;
    }
  }
}

/** Does the certificate verify for its cause, against THIS schedule and THIS (snapshot) context? */
export function checkCertificate(g: DeclaredGap, s: WeekSchedule, ctx: RuleContext): boolean {
  return verify(g, s, ctx, 0);
}

/**
 * The FIRST proven cause that certifies a deficit, in the fixed order (structure, eligibility,
 * capacity, availability, floor_limit, budget), with its certificate; null when none does (the deficit
 * is then only ever `unresolved_search`). Used by the generator's declare step and by the
 * `unresolved_search` honesty check.
 */
export function proveGap(subject: GapSubject, s: WeekSchedule, ctx: RuleContext): { cause: Exclude<GapCause, "unresolved_search">; certificate: GapCertificate } | null {
  const day = ctx.days[subject.date];
  if (!day || subject.toQ <= subject.fromQ) return null;
  const tryCert = (g: DeclaredGap) => (verify(g, s, ctx, 1) ? { cause: g.cause as Exclude<GapCause, "unresolved_search">, certificate: g.certificate } : null);
  const rules = structureRules(day.structure, subject, Object.values(ctx.people));
  if (rules[0]) return tryCert({ ...subject, cause: "structure", certificate: rules[0] });
  const eligible = eligibleMembers(subject, day, ctx);
  if (eligible.length === 0) return tryCert({ ...subject, cause: "eligibility", certificate: { positionId: subject.positionId, eligibleCount: 0 } });
  if (subject.code === "coverage_gap") {
    const cap = capacityBound(subject, s, ctx);
    const got = cap ? tryCert({ ...subject, cause: "capacity", certificate: cap }) : null;
    if (got) return got;
  }
  const ids = eligible.map((p) => p.userId);
  const av = tryCert({ ...subject, cause: "availability", certificate: { eligibleIds: ids, unavailableIds: ids } });
  if (av) return av;
  if (subject.code === "coverage_gap") {
    const free = eligible.filter((p) => availableOn(p, subject.date, subject.fromQ, subject.toQ) && freeFor(p, s, subject.date, subject.fromQ, subject.toQ, day, subject.positionId));
    const fl = tryCert({ ...subject, cause: "floor_limit", certificate: {
      managerIds: free.map((p) => p.userId), floorHoursUsed: Object.fromEntries(free.map((p) => [p.userId, floorHours(s, p.userId)])), limitH: day.structure.limits.managerFloorH,
    } });
    if (fl) return fl;
  }
  if (!budgetMayExcuse(subject, ctx)) return null;
  const f = budgetFacts(s, ctx);
  return tryCert({ ...subject, cause: "budget", certificate: {
    budgetedDates: f.budgetedDates, budgetHours: f.budgetHours, usedHours: f.usedHours, essentialHours: f.essentialHours, hoursNeeded: hoursNeededFor(subject, s, day, ctx),
  } });
}

// ─── The validator ───────────────────────────────────────────────────────────

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function problemOrder(a: RuleProblem, b: RuleProblem): number {
  return cmp(a.day, b.day) || cmp(a.code, b.code) || cmp(a.userId ?? "", b.userId ?? "") || (a.q ?? -1) - (b.q ?? -1)
    || cmp(a.positionId ?? "", b.positionId ?? "");
}

function malformed(sh: Shift): boolean {
  const segs = sh.segments;
  if (!Array.isArray(segs) || segs.length === 0) return true;
  if (!Number.isInteger(sh.startQ) || !Number.isInteger(sh.endQ) || sh.startQ < 0 || sh.endQ > 96 || sh.startQ >= sh.endQ) return true;
  if (segs[0]!.startQ !== sh.startQ || segs[segs.length - 1]!.endQ !== sh.endQ) return true;
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i]!;
    if (!Number.isInteger(g.startQ) || !Number.isInteger(g.endQ) || g.startQ >= g.endQ) return true;
    if (i > 0 && segs[i - 1]!.endQ !== g.startQ) return true;
  }
  return false;
}

function runsOf(qs: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const q of qs) {
    const last = out[out.length - 1];
    if (last && last[1] === q) last[1] = q + 1;
    else out.push([q, q + 1]);
  }
  return out;
}

/**
 * Validate a week against its context. Built days (not `inherited`) need a `ctx.days` entry; a built
 * day without one is a caller bug and throws. Problems come back sorted by (day, code, user, q).
 */
export function checkScheduleRules(s: WeekSchedule, ctx: RuleContext): RuleProblem[] {
  const out: RuleProblem[] = [];
  const push = (code: RuleCode, day: string, extra: Partial<Omit<RuleProblem, "code" | "severity" | "day" | "inherited">> = {}) => {
    const p: RuleProblem = { code, severity: RULE_CODES[code], day, params: {}, inherited: false };
    if (extra.userId !== undefined) p.userId = extra.userId;
    if (extra.positionId !== undefined) p.positionId = extra.positionId;
    if (extra.q !== undefined) p.q = extra.q;
    if (extra.params) p.params = extra.params;
    out.push(p);
  };

  const inherited = new Set(s.days.filter((d) => d.inherited).map((d) => d.date));
  for (const d of s.days) if (d.inherited) for (const p of d.problems) out.push({ ...p, inherited: true });

  const built = [...new Set([...Object.keys(ctx.days), ...s.shifts.map((x) => x.date)])].filter((d) => !inherited.has(d)).sort();
  for (const d of built) if (!ctx.days[d]) throw new Error(`checkScheduleRules: no validation context for built day ${d}`);

  for (const date of built) {
    const day = ctx.days[date]!;
    const st = day.structure;
    const { serviceStartQ, serviceCloseQ, prepStartQ } = st.shopDay;
    const shifts = shiftsOn(s, date);
    const personSlot = new Map<string, Uint8Array>();
    const occupancy = new Map<string, Int32Array>();
    const occ = (positionId: string, q: number) => occupancy.get(positionId)?.[q] ?? 0;

    for (const sh of shifts) {
      const p = ctx.people[sh.userId];
      if (!p) { push("unknown_person", date, { userId: sh.userId, q: sh.startQ }); continue; }
      const u = sh.userId;
      if (!p.activeMember) push("not_member", date, { userId: u, q: sh.startQ });
      if (malformed(sh)) push("segments_malformed", date, { userId: u, q: sh.startQ });
      const flexDay = sh.flex && p.flexDates.includes(date) && st.limits.flexUsesPer2w > 0;
      const minQ = flexDay ? st.limits.flexMinimumQ : st.limits.minimumShiftQ;
      if (sh.endQ - sh.startQ < minQ) push("shift_below_minimum", date, { userId: u, q: sh.startQ, params: { minutes: (sh.endQ - sh.startQ) * 15, minimumMinutes: minQ * 15 } });
      if (sh.flex) push("flex_used", date, { userId: u, q: sh.startQ });
      const setting = leaderSettingOf(p, st);
      if (LEADER_ROLES.includes(p.role)
        && ((setting === "opens" && sh.endQ >= serviceCloseQ) || (setting === "closes" && sh.startQ < serviceStartQ))) {
        push("leader_setting", date, { userId: u, q: sh.startQ, params: { setting } });
      }
      if (sh.closingManager) {
        const canClose = st.leadership.closingRoles.includes(p.role);
        if (!canClose || setting === "opens") push("closing_manager_setting", date, { userId: u, q: sh.startQ, params: { setting } });
        if (!canClose) push("closing_manager_role", date, { userId: u, q: sh.startQ, params: { role: p.role } });
        if (!coversClosingWindow(sh, day)) {
          push("closing_manager_not_closing", date, { userId: u, q: sh.startQ, params: { serviceCloseQ, scheduledOutQ: day.scheduledOutQ } });
        }
      }
      if (p.untouchableDates.includes(date)) push("untouchable_day", date, { userId: u, q: sh.startQ });
      if (!availableOn(p, date, sh.startQ, sh.endQ)) {
        const w = p.availability[date];
        push("outside_assumed_availability", date, { userId: u, q: sh.startQ, params: { fromQ: w ? w.fromQ : null, toQ: w ? w.toQ : null, source: w ? w.source : null } });
      }
      const manager = isManagerRole(p.role);
      let slots = personSlot.get(u);
      if (!slots) { slots = new Uint8Array(96); personSlot.set(u, slots); }
      for (const g of sh.segments) {
        let counts = g.positionId === MOD ? null : occupancy.get(g.positionId);
        if (g.positionId !== MOD && !counts) { counts = new Int32Array(96); occupancy.set(g.positionId, counts); }
        for (let q = Math.max(0, g.startQ); q < Math.min(96, g.endQ); q++) {
          if (slots[q]) push("person_overlap", date, { userId: u, q });
          else slots[q] = 1;
          if (counts) counts[q]!++;
        }
        if (g.positionId === MOD) continue;
        const pos = st.positions[g.positionId];
        if (!pos || g.startQ < pos.openQ || g.endQ > pos.closeQ) push("segment_outside_window", date, { userId: u, positionId: g.positionId, q: g.startQ });
        const callout = !!g.coverFor && g.reasonKey === CALLOUT_LAST_RESORT;
        if (!pos?.allowedRoles.includes(p.role) && !(pos?.role === "prep_dish" && manager && callout)) {
          push("role_not_allowed", date, { userId: u, positionId: g.positionId, q: g.startQ, params: { role: p.role } });
        }
        if (pos?.role === "prep_dish" && manager && !callout) push("manager_on_boh", date, { userId: u, positionId: g.positionId, q: g.startQ });
        if (manager && !p.coverPositions.includes(g.positionId) && !g.lastResort) {
          push("cover_outside_preferences", date, { userId: u, positionId: g.positionId, q: g.startQ });
        }
        if (pos && !workTypeAllows(p, pos)) push("work_type_not_allowed", date, { userId: u, positionId: g.positionId, q: g.startQ, params: { workType: p.workType } });
      }
    }

    // (b) head count per slot.
    for (const [positionId, counts] of occupancy) {
      const pos = st.positions[positionId];
      if (!pos) continue;
      for (let q = 0; q < 96; q++) {
        const count = counts[q]!;
        const limit = q < pos.trimQ ? pos.headsBefore : pos.headsAfter;
        if (count > limit) push("position_over_headcount", date, { positionId, q, params: { count, limit } });
      }
    }
    // (h) a secondary filled without its primary, per slot from prep start to scheduled out.
    for (const pair of st.priority) {
      const secondary = pair.pair[0] === pair.primary ? pair.pair[1] : pair.pair[0];
      for (let q = prepStartQ; q < day.scheduledOutQ; q++) {
        if (occ(secondary, q) > 0 && occ(pair.primary, q) === 0) {
          push("secondary_without_primary", date, { positionId: secondary, q, params: { primary: pair.primary } });
        }
      }
    }
    if (!checklistFits(st, day.closingMinutes)) push("checklist_past_max", date, { params: { closingMinutes: day.closingMinutes } });

    // Salaried minimums, per built day.
    const byPerson = new Map<string, number>();
    for (const sh of shifts) byPerson.set(sh.userId, (byPerson.get(sh.userId) ?? 0) + (sh.endQ - sh.startQ));
    for (const [u, q] of byPerson) {
      const p = ctx.people[u];
      if (!p?.salaried) continue;
      const roleMinQ = p.role === "gm" ? st.limits.gmMinimumH * 4 : p.role === "agm" ? st.limits.agmMinimumH * 4 : 0;
      const minQ = Math.max(st.limits.minimumShiftQ, roleMinQ);
      if (q < minQ) push("salaried_minimum", date, { userId: u, params: { minutes: q * 15, minimumMinutes: minQ * 15 } });
    }

    // Pairing (a soft preference, r2 P1-2): a newer person on the line with no strong partner on the line then.
    for (const sh of shifts) {
      const p = ctx.people[sh.userId];
      if (!p) continue;
      for (const g of sh.segments) {
        const pos = st.positions[g.positionId];
        if (!pos || !isLineRole(pos.role) || !p.newerPositions.includes(g.positionId)) continue;
        const partnered = shifts.some((o) => o.userId !== sh.userId && o.segments.some((x) => {
          const xp = st.positions[x.positionId];
          return !!xp && isLineRole(xp.role) && x.startQ < g.endQ && x.endQ > g.startQ && (ctx.people[o.userId]?.strongPositions.includes(x.positionId) ?? false);
        }));
        if (!partnered) push("pairing_unmet", date, { userId: sh.userId, positionId: g.positionId, q: g.startQ });
      }
    }

    // Gap-class deficits: declared and certified, or an error.
    const cov = dayCoverage(shifts, day, ctx);
    const certified = new Map<DeclaredGap, boolean>();
    const kinds: Array<{ code: GapCode; positionId: string | null }> = [
      ...Object.keys(day.need.positions).sort().map((positionId) => ({ code: "coverage_gap" as const, positionId })),
      { code: "mod_missing", positionId: null },
      { code: "closing_manager_missing", positionId: null },
    ];
    for (const k of kinds) {
      const gaps = s.gaps.filter((g) => g.date === date && g.code === k.code && g.positionId === k.positionId);
      const hit = new Set<DeclaredGap>();
      const undeclared: number[] = [];
      for (let q = 0; q < 96; q++) {
        if (uncoveredFrom(cov, k.code, k.positionId, day, q) === 0) continue;
        const g = gaps.find((x) => x.fromQ <= q && q < x.toQ);
        if (g) hit.add(g);
        else undeclared.push(q);
      }
      for (const g of [...hit].sort((a, b) => a.fromQ - b.fromQ)) {
        if (!certified.has(g)) certified.set(g, checkCertificate(g, s, ctx));
        const params = { cause: g.cause, fromQ: g.fromQ, toQ: g.toQ };
        if (certified.get(g)) push(k.code, date, { ...(k.positionId ? { positionId: k.positionId } : {}), q: g.fromQ, params: { ...params, proven: g.cause !== "unresolved_search" } });
        else push("uncertified_gap", date, { ...(k.positionId ? { positionId: k.positionId } : {}), q: g.fromQ, params: { gap: k.code, ...params } });
      }
      for (const [fromQ, toQ] of runsOf(undeclared)) {
        push("undeclared_gap", date, { ...(k.positionId ? { positionId: k.positionId } : {}), q: fromQ, params: { gap: k.code, fromQ, toQ } });
      }
    }
  }

  // Weekly totals: COUNT inherited hours, attribute only to a built day (the person's last built day there).
  const builtSet = new Set(built);
  const people = [...new Set(s.shifts.map((x) => x.userId))].sort();
  for (const u of people) {
    const p = ctx.people[u];
    if (!p) continue;
    const mine = s.shifts.filter((x) => x.userId === u);
    const builtDays = [...new Set(mine.filter((x) => builtSet.has(x.date)).map((x) => x.date))].sort();
    const last = builtDays[builtDays.length - 1];
    if (!last) continue;
    const st = ctx.days[last]!.structure;
    const hours = mine.reduce((n, x) => n + (x.endQ - x.startQ), 0) / 4;
    if (hours > st.limits.overtimeH) push("overtime", last, { userId: u, params: { hours, limit: st.limits.overtimeH } });
    if (isHourly(p) && ((p.softMaxH !== null && hours > p.softMaxH) || (p.softMinH !== null && hours < p.softMinH))) {
      push("soft_range", last, { userId: u, params: { hours, min: p.softMinH, max: p.softMaxH } });
    }
    if (p.salaried) {
      const floor = floorHours(s, u);
      const floorDays = [...new Set(mine.filter((x) => builtSet.has(x.date) && x.segments.some((g) => g.positionId !== MOD)).map((x) => x.date))].sort();
      const at = floorDays[floorDays.length - 1];
      if (at && floor > st.limits.managerFloorH) push("manager_floor_exceeded", at, { userId: u, params: { hours: floor, limit: st.limits.managerFloorH } });
    }
  }
  const f = budgetFacts(s, ctx);
  const nonEssential = f.usedHours - f.essentialHours;
  const budgetDay = [...new Set(f.datesWithHourly.filter((d) => builtSet.has(d)))].sort().pop();
  if (f.budgetedDates.length > 0 && budgetDay && nonEssential > f.budgetHours) {
    push("over_budget", budgetDay, { params: { hours: nonEssential, budget: f.budgetHours } });
  }

  const keyed = out.map((p) => ({ p, params: canonicalJson(p.params) }));
  keyed.sort((a, b) => problemOrder(a.p, b.p) || cmp(a.params, b.params));
  return keyed.map((k) => k.p);
}

/**
 * Approve's refusal, pure (r4 P1): `unresolved_gaps` while ANY `unresolved_search` gap exists in the
 * week — inherited or not (the inherited-error exemption never covers an unresolved gap); else
 * `rules_failing` while a NEW error-class problem exists (inherited errors do not block, J18).
 */
export function approvalRefusal(s: WeekSchedule, problems: readonly RuleProblem[]): Extract<ScheduleErrorCode, "unresolved_gaps" | "rules_failing"> | null {
  if (s.gaps.some((g) => g.cause === "unresolved_search")) return "unresolved_gaps";
  if (problems.some((p) => p.severity === "error" && !p.inherited)) return "rules_failing";
  return null;
}
