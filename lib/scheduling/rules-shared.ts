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
  checklistFits, isLineRole, positionLimit, primaryOf, secondaryOf, type LeaderSetting, type ScheduleStructure, type StructurePosition,
} from "./structure-shared";
import { canonicalJson, type DayContext, type RuleContext, type RulePerson } from "./context-shared";
import type { ScheduleErrorCode } from "./errors-shared";

// ─── The schedule shape ──────────────────────────────────────────────────────

/** The Manager-on-duty lane's pseudo position. */
export const MOD = "mod";
/** The reason key that marks the call-out last resort (rule d's exemption; Phase 2 never emits it). */
export const CALLOUT_LAST_RESORT = "schedule.reason.callout_last_resort";
/**
 * Juan 2026-10-16 (decision 4): the segment marker of a salaried manager's FLEX quarters — a zero-hourly-cost fill (staying
 * longer, or covering a station from the MoD lane in place of hourly hours). Flex quarters are outside the BASE week
 * (`limits.salariedTargetWeekH`, station time `limits.managerFloorH`) and inside the flex pool (`limits.salariedFlexH`).
 */
export const SALARIED_FLEX_REASON = "schedule.reason.salaried_flex";
/**
 * Juan 2026-10-16 (decision 8): the segment marker of a catering manager covering a station — ONLY as a last resort
 * (`lastResort: true`), never on Prep/Dishwasher, and never inside a booked catering window (`cateringWindows`).
 */
export const CATERING_MANAGER_COVER = "schedule.reason.catering_manager_cover";

export interface Segment { positionId: string; startQ: number; endQ: number; lastResort?: boolean; coverFor?: string; reasonKey?: string }
export interface Shift { userId: string; date: string; startQ: number; endQ: number; segments: Segment[]; closingManager: boolean; flex: boolean; pinned: boolean }

export type GapCode = "coverage_gap" | "mod_missing" | "closing_manager_missing";
export type GapCause = "budget_limited" | "floor_limit" | "eligibility" | "availability" | "capacity" | "structure" | "unresolved_search";
/** The fixed order in which a deficit takes the FIRST proven cause that certifies (generator step 9a.6). */
export const PROVEN_CAUSE_ORDER = ["structure", "eligibility", "capacity", "availability", "floor_limit", "budget_limited"] as const;

/** The bounded repair search's limits (generator step 9a), stored in every `unresolved_search` certificate. */
export const REPAIR_LIMITS = { REPAIR_MAX_STEPS: 200, maxDonors: 8, maxChainDepth: 3 } as const;

/**
 * CC chunk D DESIGN RULING (2026-10-16): a budget gap claims only what it can verify — the remaining hourly budget on the
 * budgeted dates (`remainingHours` = budget − (used − essential)) is below `fillHours`, the cheapest legal fill the
 * deterministic search FOUND (`cheapestFill`), whose steps are the `witness`. Never a minimality claim.
 */
export interface BudgetLimitedCertificate {
  budgetedDates: string[]; budgetHours: number; usedHours: number; essentialHours: number; remainingHours: number; fillHours: number; witness: FillStep[];
}
/**
 * CC chunk H4 (2026-10-17, Astra H3 P1 — the CONSERVATIVE floor_limit, the end of the proof loop): `floor_limit` no longer
 * claims "no legal flex block exists" (enumerating every legal shape is combinatorial and failed twice). It claims only a
 * SIMPLE, CHECKABLE precondition: NO active hourly person ELIGIBLE for the position is AVAILABLE at ANY quarter of the window
 * (CC chunk H6, Astra H5 P1 — the final simplification of the hourly side: their current shifts, `freeFor` and
 * `shiftExtendsOver` are ignored entirely; an eligible, available person, even one on another position just then, may reach
 * the gap by an extension, a swap or a reassignment, so no certificate), and EVERY salaried manager the flex search considers
 * (`flexSearchManagers`) is excluded — CC chunk H7 (Astra H6 P1, the closing rule of the salaried side): a manager ELIGIBLE for
 * the position and ON SHIFT (any segment, station or MoD) at ANY quarter of the window is NEVER excluded (`on_shift_eligible`:
 * relabels and swaps among people already on shift can never be proven impossible cheaply — the AGM takes the Register, the GM
 * steps onto Expo), whatever their flex or day; a manager NOT on shift during the window is excluded by the FIRST of
 *   (a) `flex_exhausted` — the flex is spent (used ≥ `salariedFlexH`, or the week total ≥ target + flex);
 *   (b) `ineligible` — not eligible for the position and never the manager on duty over the window;
 *   (c) `unavailable` — unavailable at every quarter of [fromQ − maxShiftQ, toQ + maxShiftQ) that date;
 *   (d) `day_at_max` — their shifts that day already reach `maxShiftH`.
 * (The H4 MoD-relabel guard is subsumed: a manager on the MoD lane over the window is on shift.)
 * Any manager excluded by none → no `floor_limit` (the generator keeps filling; what stays is `unresolved_search`, which blocks
 * Approve). The certificate binds the limits and, per manager, the condition, their flex and floor hours; the verifier recomputes
 * all of it on the current inputs (stale / forged → refused).
 */
export type FloorExclusion = "flex_exhausted" | "ineligible" | "unavailable" | "day_at_max";
/** CC chunk H7: what `floorExclusionOf` says about a manager — an exclusion, or the reason there can be NO certificate. */
export type FloorManagerStatus = FloorExclusion | "on_shift_eligible";
export const FLOOR_EXCLUSIONS: readonly FloorExclusion[] = ["flex_exhausted", "ineligible", "unavailable", "day_at_max"];
export const FLOOR_MANAGER_STATUSES: readonly FloorManagerStatus[] = [...FLOOR_EXCLUSIONS, "on_shift_eligible"];
export interface FloorLimitCertificate {
  limitH: number; targetWeekH: number; salariedFlexH: number; maxShiftH: number;
  /** CC chunk H6: every active hourly person eligible for the position (id order) → why they are out: available at NO quarter of the window. */
  hourlyExcluded: Record<string, "unavailable">;
  /**
   * EVERY salaried manager considered → the first condition that excludes them. The vocabulary (TS / SQL twins) also names
   * `on_shift_eligible` (CC chunk H7), but a manager with that status means NO certificate, so a verifying certificate never
   * carries it: the verifier recomputes and demands byte equality.
   */
  excludedBy: Record<string, FloorManagerStatus>;
  flexHoursUsed: Record<string, number>;
  floorHoursUsed: Record<string, number>;
}
export interface EligibilityCertificate { positionId: string | null; eligibleCount: 0 }
export interface AvailabilityCertificate { eligibleIds: string[]; unavailableIds: string[] }
export interface CapacityCertificate { fromQ: number; toQ: number; positionIds: string[]; requiredHeads: number; peopleIds: string[]; people: number; shortBy: number }
/**
 * The configuration itself makes the need impossible. A position window shorter than the minimum shift is
 * NOT one of them (Astra chunk A P2-4): the minimum applies to the whole SHIFT, and a short window is
 * filled as a segment of a multi-position shift.
 *
 * `max_shift` (CC chunk C ruling 2, with Astra's condition): the shop's daily maximum ALONE makes part of a need run
 * uncoverable — a counting bound over the eligible people and their availability, each capped at the daily maximum
 * (see `capOnlyBound`). Its detail carries every number and is recomputed exactly; an overlong window alone is not
 * proof.
 */
export type StructureRule = "primary_window_closed" | "no_mod_member" | "no_closing_role" | "max_shift";
export interface StructureCertificate { rule: StructureRule; detail: Record<string, string | number | string[]> }
export interface UnresolvedSearchCertificate {
  searched: { steps: number; donorsTried: number; chainDepth: number };
  limits: { REPAIR_MAX_STEPS: number; maxDonors: number; maxChainDepth: number };
  candidateIds: string[];
}

interface GapBase { code: GapCode; date: string; positionId: string | null; fromQ: number; toQ: number }
export type DeclaredGap = GapBase & (
  | { cause: "budget_limited"; certificate: BudgetLimitedCertificate }
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
  /** CC chunk B ruling 3: a shift longer than the shop's daily maximum (`limits.maxShiftH`, default 10.5 h). HARD. */
  shift_over_maximum: "error",
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
  /** Station time past `limits.managerFloorH`. An ERROR on a generated week; a WARNING on a manager-edited one (CC addendum A). */
  manager_floor_exceeded: "error",
  work_type_not_allowed: "error",
  untouchable_day: "error",
  /**
   * Juan 2026-10-16 (decision 4): a salaried manager's BASE week (station + MoD, flex quarters aside) over the target (40 h).
   * CC addendum A: the 40 h is a TARGET, not a wall — a WARNING, never blocking Approve (a hand-scheduled 48 h week is
   * real practice). The GENERATOR still treats it as hard (`GENERATOR_HARD_WARNINGS`).
   */
  salaried_base_over_target: "warning",
  /** Juan 2026-10-16 (decision 4): a salaried week over target + flex, or more flex quarters than the flex allows. A WARNING (addendum A); hard for the generator. */
  salaried_over_flex: "warning",
  /** Juan 2026-10-16 (decision 8): a catering manager's station cover inside a booked catering window. */
  catering_cover_in_catering_window: "error",
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

/**
 * CC addendum A (2026-10-16): the salaried week checks are warnings for a person editing a week, but the GENERATOR keeps the
 * rule — its guard, its fill legality and its final invariant treat these codes exactly like errors, so a generated week is
 * never over the 40 h target nor past the flex.
 */
export const GENERATOR_HARD_WARNINGS: ReadonlySet<RuleCode> = new Set<RuleCode>(["salaried_base_over_target", "salaried_over_flex"]);
/** Does the generator refuse this problem (an error, or a salaried-week warning it keeps hard)? */
export const generatorRefuses = (p: Pick<RuleProblem, "code" | "severity">): boolean => p.severity === "error" || GENERATOR_HARD_WARNINGS.has(p.code);

/** Options of one validation run. `managerEdited`: the week carries a manager's hand edit (addendum A: the station floor then warns). */
export interface RuleCheckOptions { managerEdited?: boolean }

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

/**
 * Does this person COUNT as the manager on duty at quarter q? Shift lead and up always; a key holder only
 * when the shop's setting "KH may be manager on duty after <time>" is ON and q is at or after that time
 * (CC 2026-10-16; default OFF). Pinned MoO / Owner presence counts like any manager.
 */
export function modCountsAt(p: Pick<RulePerson, "role">, s: ScheduleStructure, q: number): boolean {
  if (isManagerRole(p.role)) return true;
  const after = s.leadership.keyHolderModAfterQ;
  return p.role === "key_holder" && after !== null && q >= after;
}

/**
 * CC addendum B3 (2026-10-16): the manager on duty on a built DATE — `modCountsAt`, except that a (pinned) catering manager
 * counts only OUTSIDE that date's booked catering windows (`cateringWindows`): inside one they are doing catering.
 */
export function modCountsOn(p: Pick<RulePerson, "role">, day: Pick<DayContext, "structure" | "inputs">, q: number): boolean {
  if (!modCountsAt(p, day.structure, q)) return false;
  return p.role !== "catering_mgr" || !cateringWindows(day).some(([a, z]) => q >= a && q < z);
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

/**
 * Juan 2026-10-16 (decision 8): the catering manager is ON the roster but the generator never plans them: their own shifts
 * come only from a manager pin or the presence settings, and a station sees them only as the last-resort cover outside the
 * booked catering windows (`CATERING_MANAGER_COVER`). So they are never "eligible" for a placement, a fill or a proof.
 */
export function neverGenerated(p: Pick<RulePerson, "role" | "presenceOnly">): boolean {
  // CC addendum B2 (2026-10-16): a prep manager's MoD shifts are NEVER generated either (CO has no prep manager) — pins /
  // presence only.
  return p.presenceOnly || p.role === "catering_mgr" || p.role === "prep_mgr";
}

/** May this person be placed on this position at all (role, Prep/Dishwasher never for a manager, work type)? */
export function eligibleForPosition(p: RulePerson, pos: StructurePosition | undefined): boolean {
  if (!pos || !p.activeMember || neverGenerated(p)) return false;
  if (!pos.allowedRoles.includes(p.role)) return false;
  if (pos.role === "prep_dish" && isManagerRole(p.role)) return false;
  return workTypeAllows(p, pos);
}

/** May this member be placed to fill a deficit of this kind (for MoD: from the window's first quarter on)? */
export function eligibleFor(p: RulePerson, code: GapCode, positionId: string | null, s: ScheduleStructure, fromQ: number): boolean {
  if (!p.activeMember || neverGenerated(p)) return false;
  if (code === "mod_missing") return modCountsAt(p, s, fromQ);
  if (code === "closing_manager_missing") return s.leadership.closingRoles.includes(p.role) && leaderSettingOf(p, s) !== "opens";
  return positionId !== null && eligibleForPosition(p, s.positions[positionId]);
}

/**
 * Astra chunk B P1-2: eligibility can CHANGE inside a window (a key holder counts as the MoD only from the shop's
 * "KH may be MoD after" time). An impossibility proof must hold at EVERY quarter, so a member is "eligible for the
 * window" when they are eligible at ANY quarter of it; availability is then judged at the quarters they count.
 */
export function eligibleInWindow(p: RulePerson, code: GapCode, positionId: string | null, s: ScheduleStructure, fromQ: number, toQ: number): boolean {
  for (let q = fromQ; q < Math.max(toQ, fromQ + 1); q++) if (eligibleFor(p, code, positionId, s, q)) return true;
  return false;
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
    if (p) for (const q of onClock) if (modCountsOn(p, day, q)) managers[q]!++;
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

export const isFlexSegment = (g: Pick<Segment, "reasonKey">) => g.reasonKey === SALARIED_FLEX_REASON;

/**
 * BASE non-mod ("floor", station) hours of a person over the whole week, inherited days included — flex quarters aside
 * (Juan 2026-10-16, decision 4: station time passes `managerFloorH` only through flex).
 */
export function floorHours(s: Pick<WeekSchedule, "shifts">, userId: string): number {
  let q = 0;
  for (const sh of s.shifts) if (sh.userId === userId) for (const g of sh.segments) if (g.positionId !== MOD && !isFlexSegment(g)) q += segLenQ(g);
  return q / 4;
}

/** A salaried week, in hours: total (station + MoD), flex (marked quarters) and base (total − flex). Inherited days included. */
export function salariedWeek(s: Pick<WeekSchedule, "shifts">, userId: string): { totalH: number; flexH: number; baseH: number } {
  let total = 0;
  let flex = 0;
  for (const sh of s.shifts) {
    if (sh.userId !== userId) continue;
    total += sh.endQ - sh.startQ;
    for (const g of sh.segments) if (isFlexSegment(g)) flex += segLenQ(g);
  }
  return { totalH: total / 4, flexH: flex / 4, baseH: (total - flex) / 4 };
}

/** The quarters of BASE station time a salaried manager has left under `managerFloorH` this week. */
export function baseFloorRoomQ(s: Pick<WeekSchedule, "shifts">, userId: string, st: ScheduleStructure): number {
  return Math.max(0, Math.round(st.limits.managerFloorH * 4) - Math.round(floorHours(s, userId) * 4));
}

/**
 * A salaried manager's MoD relabel over [fromQ, toQ) as segments: the first `baseRoomQ` quarters are BASE station time
 * (unmarked), the rest FLEX (`SALARIED_FLEX_REASON`) — decision 4: station time passes the floor only through flex.
 * Astra chunk H P2-1: a relabel KEEPS each quarter's flex classification — when the host segment is already FLEX
 * (`hostFlex`, e.g. a stay-longer MoD hour), the whole relabel stays flex and uses no base room.
 */
export function splitSalariedRelabel(fromQ: number, toQ: number, baseRoomQ: number, hostFlex = false): Array<{ startQ: number; endQ: number; flex: boolean }> {
  if (hostFlex) return toQ > fromQ ? [{ startQ: fromQ, endQ: toQ, flex: true }] : [];
  const mid = Math.min(toQ, fromQ + Math.max(0, baseRoomQ));
  const out: Array<{ startQ: number; endQ: number; flex: boolean }> = [];
  if (mid > fromQ) out.push({ startQ: fromQ, endQ: mid, flex: false });
  if (toQ > mid) out.push({ startQ: mid, endQ: toQ, flex: true });
  return out;
}

/** The quarters of flex a salaried manager has left this week (decision 4). */
export function flexLeftQ(s: Pick<WeekSchedule, "shifts">, userId: string, st: ScheduleStructure): number {
  return Math.max(0, Math.round(st.limits.salariedFlexH * 4) - Math.round(salariedWeek(s, userId).flexH * 4));
}

/**
 * The BOOKED catering windows of a built date (decision 8), from the booked-catering input: [event − lead, event) for an
 * event with a time, else the structure's default catering window — every booked event, whatever its headcount.
 */
export function cateringWindows(day: Pick<DayContext, "structure" | "inputs">): Array<[number, number]> {
  const c = day.structure.catering;
  return [...day.inputs.cateringEvents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((ev): [number, number] =>
    ev.eventQ === null ? [c.defaultStartQ, c.defaultEndQ] : [Math.max(0, ev.eventQ - c.leadMinutes / 15), ev.eventQ]);
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
 * day that extends over the window (above). Salaried: no BASE floor segment then (flex time is discretionary cover and does
 * not make them busy here). CC chunk H6: `floor_limit` no longer uses this at all — hourly people are judged by eligibility
 * and availability only (`floorLimitCertificate`), salaried managers by the four conservative conditions of
 * `floorExclusionOf`; it stays for the fills' bookkeeping.
 */
function freeFor(p: RulePerson, s: WeekSchedule, date: string, fromQ: number, toQ: number, day: DayContext, positionId: string | null): boolean {
  const own = s.shifts.filter((sh) => sh.date === date && sh.userId === p.userId);
  if (!isHourly(p)) return !own.some((sh) => sh.segments.some((g) => g.positionId !== MOD && !isFlexSegment(g) && g.startQ < toQ && g.endQ > fromQ));
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

function structureRules(st: ScheduleStructure, g: GapSubject, roster: readonly RulePerson[]): StructureCertificate[] {
  const out: StructureCertificate[] = [];
  if (g.code === "coverage_gap" && g.positionId) {
    const primary = primaryOf(st, g.positionId);
    const pp = primary && primary !== g.positionId ? st.positions[primary] : undefined;
    if (pp && g.toQ > g.fromQ) {
      let closed = true;
      for (let q = g.fromQ; q < g.toQ; q++) if (positionLimit(pp, q) > 0) { closed = false; break; }
      if (closed) out.push({ rule: "primary_window_closed", detail: { positionId: g.positionId, primaryId: primary! } });
    }
  }
  if (g.code === "mod_missing" && !roster.some((p) => eligibleInWindow(p, "mod_missing", null, st, g.fromQ, g.toQ))) {
    out.push({ rule: "no_mod_member", detail: {} });
  }
  if (g.code === "closing_manager_missing" && !roster.some((p) => eligibleFor(p, "closing_manager_missing", null, st, g.fromQ))) {
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

// ─── The cap-only bound (CC chunk C ruling 2: the `max_shift` structure rule) ────────

/**
 * Does the shop's daily maximum ALONE leave part of this deficit's need run uncoverable? A counting bound, sound in
 * EVERY allocation because the validator caps a person's working time per DATE (`shift_over_maximum`):
 * - the run = the maximal contiguous quarters around the deficit where the need is >= 1 (coverage: the position's
 *   need; MoD: the shop day when the MoD is required); it must be longer than one shift can be (runQ > maxShiftQ);
 * - the people = every member who counts at some quarter of the run (eligible at that quarter AND available, or
 *   already standing there), each contributing at most min(maxShiftQ, their counting quarters);
 * - only the cap: at every quarter the need <= the people who count there (else it is a capacity / availability
 *   shortage, another cause), so the uncapped total covers the requirement and the capped one does not:
 *   shortQ = requiredQ - coverableQ >= 1;
 * - no excess: the head-quarters actually uncovered over the run are <= shortQ (more needs another cause).
 * Null otherwise. Closing Manager deficits never qualify (one shift must span the closing window).
 */
export function capOnlyBound(g: GapSubject, s: WeekSchedule, ctx: RuleContext): StructureCertificate | null {
  const day = ctx.days[g.date];
  if (!day || g.toQ <= g.fromQ || g.code === "closing_manager_missing") return null;
  if (g.code === "coverage_gap" && !g.positionId) return null;
  const st = day.structure;
  const maxQ = Math.round(st.limits.maxShiftH * 4);
  const shop = shopWindow(day);
  const needAt = (q: number): number => {
    if (q < 0 || q >= 96) return 0;
    if (g.code === "coverage_gap") return day.need.positions[g.positionId!]?.[q] ?? 0;
    return st.leadership.modRequired && q >= shop.fromQ && q < shop.toQ ? 1 : 0;
  };
  if (needAt(g.fromQ) < 1) return null;
  let a = g.fromQ;
  while (needAt(a - 1) >= 1) a--;
  let z = g.fromQ;
  while (needAt(z) >= 1) z++;
  if (g.toQ > z || z - a <= maxQ) return null;
  const shifts = shiftsOn(s, g.date);
  const placedAt = (p: RulePerson, q: number) => shifts.some((sh) => sh.userId === p.userId && (g.code === "coverage_gap"
    ? sh.segments.some((x) => x.positionId === g.positionId && x.startQ <= q && x.endQ > q)
    : sh.segments.some((x) => x.startQ <= q && x.endQ > q) && modCountsOn(p, day, q)));
  const countsAt = (p: RulePerson, q: number) => (eligibleFor(p, g.code, g.positionId, st, q) && availableOn(p, g.date, q, q + 1)) || placedAt(p, q);
  const people = Object.values(ctx.people).sort((x, y) => (x.userId < y.userId ? -1 : x.userId > y.userId ? 1 : 0));
  const avail = new Map<string, number>();
  let requiredQ = 0;
  for (let q = a; q < z; q++) {
    const need = needAt(q);
    requiredQ += need;
    let here = 0;
    for (const p of people) if (countsAt(p, q)) { here++; avail.set(p.userId, (avail.get(p.userId) ?? 0) + 1); }
    if (here < need) return null; // a per-quarter shortage is not the cap's
  }
  const peopleIds = [...avail.keys()].sort();
  const availableQ = peopleIds.reduce((n, id) => n + avail.get(id)!, 0);
  const coverableQ = peopleIds.reduce((n, id) => n + Math.min(maxQ, avail.get(id)!), 0);
  const shortQ = requiredQ - coverableQ;
  if (availableQ < requiredQ || shortQ < 1) return null;
  const cov = dayCoverage(shifts, day, ctx);
  let uncovered = 0;
  for (let q = a; q < z; q++) uncovered += uncoveredFrom(cov, g.code, g.positionId, day, q);
  if (uncovered > shortQ) return null;
  return { rule: "max_shift", detail: {
    positionId: g.code === "coverage_gap" ? g.positionId! : MOD, runFromQ: a, runToQ: z, runQ: z - a, maxShiftQ: maxQ,
    requiredQ, peopleIds, availableQ, coverableQ, shortQ,
  } };
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

/** At no quarter of the window are more heads of S uncovered than the bound proves (else the excess needs another cause). */
function excessFits(c: CapacityCertificate, g: GapSubject, s: WeekSchedule, day: DayContext, ctx: RuleContext): boolean {
  const cov = dayCoverage(shiftsOn(s, g.date), day, ctx);
  for (let q = g.fromQ; q < g.toQ; q++) {
    let uncovered = 0;
    for (const p of c.positionIds) uncovered += uncoveredFrom(cov, "coverage_gap", p, day, q);
    if (uncovered > c.shortBy) return false;
  }
  return true;
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
 * CC chunk B ruling 1: only a subset whose certificate VERIFIES competes (no quarter leaves more of S uncovered
 * than the bound proves), so the bound returned is the strongest proof it supports and never one
 * `checkCertificate` would refuse; ties keep the first in canonical order.
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
    if (c && c.shortBy >= 1 && (!best || c.shortBy > best.shortBy) && excessFits(c, subject, s, day, ctx)) best = c;
  }
  return best;
}

// ─── Certificates ────────────────────────────────────────────────────────────

/** The uncovered head-hours of a deficit against THIS schedule. */
function uncoveredHoursFor(g: GapSubject, s: WeekSchedule, day: DayContext, ctx: RuleContext): number {
  const cov = dayCoverage(shiftsOn(s, g.date), day, ctx);
  let q4 = 0;
  for (let q = g.fromQ; q < g.toQ; q++) q4 += uncoveredFrom(cov, g.code, g.positionId, day, q);
  return q4 / 4;
}

/**
 * A run a salaried manager can take at ZERO hourly cost: by relabelling their MoD segment (Astra chunk B P1-1), or —
 * CC chunk D ruling 2 — by STAYING LONGER (`extend`: their shift grows after its end or before its start).
 */
export interface ZeroCostCover { userId: string; fromQ: number; toQ: number; extend?: "after" | "before" }

/**
 * Every legal zero-hourly-cost fill of a coverage deficit: the quarters of the window that a SALARIED manager's MoD
 * segment spans, where the position still needs a head, has room under its limit, and (for a priority secondary)
 * its primary is staffed — capped by what is left of the manager's weekly floor limit. Relabelling there adds no
 * error (the manager stays on the clock, so the MoD lane is unchanged; outside the preferred list the segment is a
 * last resort). The generator carves exactly these before it declares a gap, and a budget certificate is refused
 * while any exists.
 */
export function zeroCostCovers(g: Pick<GapSubject, "date" | "positionId" | "fromQ" | "toQ">, s: WeekSchedule, ctx: RuleContext): ZeroCostCover[] {
  const day = ctx.days[g.date];
  if (!day || !g.positionId) return [];
  const st = day.structure;
  const pos = st.positions[g.positionId];
  if (!pos) return [];
  const target = g.positionId;
  const shifts = shiftsOn(s, g.date);
  const cov = dayCoverage(shifts, day, ctx);
  const occ = (id: string, q: number) => cov.byPosition.get(id)?.[q] ?? 0;
  const primary = primaryOf(st, target);
  const needsPrimary = primary !== null && primary !== target;
  const ok = (q: number) => uncoveredFrom(cov, "coverage_gap", target, day, q) > 0 && occ(target, q) < positionLimit(pos, q)
    && (!needsPrimary || occ(primary!, q) > 0);
  const out: ZeroCostCover[] = [];
  const ordered = [...shifts].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : a.startQ - b.startQ));
  for (const sh of ordered) {
    const p = ctx.people[sh.userId];
    if (!p || !p.salaried || !p.activeMember || p.presenceOnly || !eligibleForPosition(p, pos)) continue;
    // Juan 2026-10-16 (decisions 4 + 5): the MoD relabel adds no time — it takes what is left of the BASE station limit
    // first, then the FLEX pool; staying longer adds time, so it draws from the FLEX pool only.
    let floorRoomQ = baseFloorRoomQ(s, p.userId, st);
    let flexQ = flexLeftQ(s, p.userId, st);
    for (const seg of sh.segments) {
      if (seg.positionId !== MOD) continue;
      // Astra chunk H P2-1: relabelling a FLEX MoD segment stays flex — it uses neither the base room nor more flex.
      const free = isFlexSegment(seg);
      let q = Math.max(g.fromQ, seg.startQ);
      const end = Math.min(g.toQ, seg.endQ);
      while (q < end && (free || floorRoomQ + flexQ > 0)) {
        if (!ok(q)) { q++; continue; }
        let z = q + 1;
        while (z < end && ok(z) && (free || z - q < floorRoomQ + flexQ)) z++;
        out.push({ userId: p.userId, fromQ: q, toQ: z });
        if (!free) {
          const base = Math.min(floorRoomQ, z - q);
          floorRoomQ -= base;
          flexQ -= z - q - base;
        }
        q = z;
      }
    }
    const leftQ = flexQ;
    // CC chunk D rulings 1 + 2: a salaried manager STAYING LONGER is a zero-hourly-cost fill too — their shift extended
    // straight into the window (after its end, or before its start), within the shop's daily maximum (their whole day),
    // the weekly floor limit (what is left of it), their availability and leader setting over the merged span, never
    // into another of their shifts, never a pinned shift or an untouchable day; only while the shop allows it.
    if (!st.limits.salariedStayLonger || sh.pinned || p.untouchableDates.includes(g.date) || leftQ <= 0) continue;
    const mine = shifts.filter((x) => x.userId === p.userId);
    let roomQ = Math.min(leftQ, Math.round(st.limits.maxShiftH * 4) - mine.reduce((n, x) => n + (x.endQ - x.startQ), 0));
    const free = (q: number) => !mine.some((x) => x.startQ <= q && x.endQ > q);
    const legal = (from: number, to: number) => availableOn(p, g.date, from, to) && leaderSettingAllows(p, st, from, to);
    if (roomQ > 0 && sh.endQ >= g.fromQ && sh.endQ < g.toQ) {
      let z = sh.endQ;
      while (z < g.toQ && z - sh.endQ < roomQ && ok(z) && free(z) && legal(sh.startQ, z + 1)) z++;
      if (z > sh.endQ) { out.push({ userId: p.userId, fromQ: sh.endQ, toQ: z, extend: "after" }); roomQ -= z - sh.endQ; }
    }
    if (roomQ > 0 && sh.startQ > g.fromQ && sh.startQ <= g.toQ) {
      let a = sh.startQ;
      while (a > g.fromQ && sh.startQ - a < roomQ && ok(a - 1) && free(a - 1) && legal(a - 1, sh.endQ)) a--;
      if (a < sh.startQ) out.push({ userId: p.userId, fromQ: a, toQ: sh.startQ, extend: "before" });
    }
  }
  return out;
}

/**
 * THE CHEAPEST LEGAL FILL FOUND (CC chunk D DESIGN RULING, 2026-10-16 — ends the budget soundness loop). A budget gap
 * no longer claims minimality: `budget_limited` certifies only "the remaining hourly budget R h < W h, the cheapest legal
 * fill this DETERMINISTIC search FOUND", with the witness attached. The verifier re-runs the same search and compares
 * the witness exactly; if W ≤ R it is not a budget gap at all (the generator takes that fill instead).
 *
 * The search, for ONE more head on `positionId` over [fromQ, toQ):
 *   (0) a zero-hourly-cost fill (`zeroCostCovers`: a salaried MoD relabel or a salaried manager staying longer) → 0;
 *   for every eligible, active hourly member in id order:
 *   (1) a spare segment: they stand on an OVER-covered position over the whole window → relabel, 0;
 *   (2) an extension of one of their unpinned shifts over the window (`shiftExtendsOver`, the daily maximum on their
 *       whole day): the added quarters, 0 when the shift works the closing window (essential, budget-exempt);
 *   (3) a new block of max(window, minimum shift) containing the window with a LEGAL PLACEMENT WITNESS (Astra chunk C
 *       P1): its hours (0 if it works the closing window);
 *   (4) a REASSIGNMENT (depth 1, at most REPAIR_LIMITS.maxDonors donors): their segment on another position spanning
 *       the window moves here, and that position is refilled over the quarters it then lacks by (0)–(3) of SOMEONE
 *       ELSE — the refill's hours;
 *   and for a priority SECONDARY whose primary is unstaffed anywhere the fill adds time, a PAIRED fill of the primary
 *   over those quarters by someone else ((0)–(3)), its hours added (Astra chunk D P1: two staffed shifts each extended
 *   to noon = 2 h).
 * The cheapest plan wins; ties keep the first in that canonical order. A fill that works the closing window costs no
 * budget hour (the essential rule). Pure and deterministic.
 */
export type FillStep =
  | { kind: "relabel"; userId: string; shiftStartQ: number; fromPositionId: string; positionId: string; fromQ: number; toQ: number }
  | { kind: "extend"; userId: string; shiftStartQ: number; positionId: string; fromQ: number; toQ: number; hours: number }
  | { kind: "new_block"; userId: string; positionId: string; fromQ: number; toQ: number; hours: number };
export interface FillPlan { hours: number; steps: FillStep[] }

interface FillOpts { exclude: readonly string[]; depth: number; staffOnly: boolean }

function addPlan(a: FillPlan, b: FillPlan): FillPlan {
  return { hours: a.hours + b.hours, steps: [...a.steps, ...b.steps] };
}

/** Astra chunk E P1-1: a nested search (a refill, a paired primary) offers at most this many alternatives, cheapest first. */
const NESTED_ALTERNATIVES = 4;
/** Stable cheapest-first order (ties keep the canonical generation order). */
const byHours = (plans: readonly FillPlan[]): FillPlan[] => plans.map((plan, i) => ({ plan, i })).sort((a, b) => a.plan.hours - b.plan.hours || a.i - b.i).map((x) => x.plan);

/**
 * Every candidate fill for one more head on `positionId` over [fromQ, toQ), in the canonical generation order (see
 * `cheapestFill`). A candidate is a SEARCH result only: each nested part (a refill, a paired primary) was found against
 * the unchanged schedule, so a combination may conflict — `fillIsLegal` judges the applied whole (Astra chunk E P1-1).
 */
function fillCandidates(positionId: string, fromQ: number, toQ: number, date: string, s: WeekSchedule, day: DayContext, ctx: RuleContext, o: FillOpts): FillPlan[] {
  const st = day.structure;
  const pos = st.positions[positionId];
  if (!pos || fromQ >= toQ) return [];
  const shifts = shiftsOn(s, date);
  const cov = dayCoverage(shifts, day, ctx);
  const occ = (id: string, q: number) => cov.byPosition.get(id)?.[q] ?? 0;
  const cw = ctx.closingWindowByDate[date];
  const works = (a: number, z: number) => !!cw && a < cw.toQ && z > cw.fromQ;
  const maxQ = Math.round(st.limits.maxShiftH * 4);
  const primary = primaryOf(st, positionId);
  const needsPrimary = primary !== null && primary !== positionId;
  const sorted = Object.values(ctx.people).sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const usable = (p: RulePerson, ps: StructurePosition | undefined) =>
    !o.exclude.includes(p.userId) && isHourly(p) && p.activeMember && eligibleForPosition(p, ps) && !p.untouchableDates.includes(date);
  const dayQ = (userId: string) => shifts.filter((x) => x.userId === userId).reduce((n, x) => n + (x.endQ - x.startQ), 0);
  const nested = (plans: FillPlan[]) => byHours(plans).slice(0, NESTED_ALTERNATIVES);
  /** The primary's PAIRED fills over the quarters of [a, z) where it is unstaffed (rule h), by someone other than `who`. */
  const paired = (a: number, z: number, who: string): FillPlan[] => {
    if (!needsPrimary) return [{ hours: 0, steps: [] }];
    const open: number[] = [];
    for (let q = a; q < z; q++) if (occ(primary!, q) === 0) open.push(q);
    if (open.length === 0) return [{ hours: 0, steps: [] }];
    return nested(fillCandidates(primary!, open[0]!, open[open.length - 1]! + 1, date, s, day, ctx, { exclude: [...o.exclude, who], depth: o.depth + 1, staffOnly: true }));
  };
  const out: FillPlan[] = [];
  const withPairs = (base: FillPlan, pairs: readonly FillPlan[]) => { for (const pr of pairs) out.push(addPlan(base, pr)); };

  // (0) zero hourly cost: a salaried MoD relabel or a salaried manager staying longer — first in the order.
  if (!o.staffOnly || [...Array(toQ - fromQ).keys()].some((i) => (day.need.positions[positionId]?.[fromQ + i] ?? 0) > occ(positionId, fromQ + i))) {
    for (const c of zeroCostCovers({ date, positionId, fromQ, toQ }, s, ctx).filter((x) => !o.exclude.includes(x.userId))) {
      const sh = shifts.find((x) => x.userId === c.userId && (c.extend === "after" ? x.endQ === c.fromQ : c.extend === "before" ? x.startQ === c.toQ : x.startQ <= c.fromQ && x.endQ >= c.toQ));
      if (!sh) continue;
      out.push({ hours: 0, steps: [c.extend
        ? { kind: "extend", userId: c.userId, shiftStartQ: sh.startQ, positionId, fromQ: c.fromQ, toQ: c.toQ, hours: 0 }
        : { kind: "relabel", userId: c.userId, shiftStartQ: sh.startQ, fromPositionId: MOD, positionId, fromQ: c.fromQ, toQ: c.toQ }] });
    }
  }
  const roomAt = (q: number) => occ(positionId, q) < positionLimit(pos, q);
  const blockQ = Math.max(toQ - fromQ, st.limits.minimumShiftQ);
  let donors = 0;
  for (const p of sorted) {
    if (!usable(p, pos)) continue;
    const own = shifts.filter((x) => x.userId === p.userId).sort((a, b) => a.startQ - b.startQ);
    for (const sh of own) {
      if (sh.pinned) continue;
      // (1) a spare segment on an over-covered position spanning the window, and (4) a reassignment.
      for (const g of sh.segments) {
        if (g.positionId === MOD || g.positionId === positionId || g.startQ > fromQ || g.endQ < toQ) continue;
        const lack: number[] = [];
        const sec = secondaryOf(st, g.positionId);
        for (let q = fromQ; q < toQ; q++) {
          // The position loses a head: refill where it falls below its need, or where it is a primary left empty
          // beside its staffed secondary (rule h).
          if (occ(g.positionId, q) - 1 < (day.need.positions[g.positionId]?.[q] ?? 0) || (!!sec && occ(g.positionId, q) === 1 && occ(sec, q) > 0)) lack.push(q);
        }
        const pairs = paired(fromQ, toQ, p.userId);
        if (pairs.length === 0) continue;
        const move: FillPlan = { hours: 0, steps: [{ kind: "relabel", userId: p.userId, shiftStartQ: sh.startQ, fromPositionId: g.positionId, positionId, fromQ, toQ }] };
        if (lack.length === 0) { withPairs(move, pairs); continue; }
        if (o.depth > 0 || donors >= REPAIR_LIMITS.maxDonors) continue;
        donors++;
        const refills = nested(fillCandidates(g.positionId, lack[0]!, lack[lack.length - 1]! + 1, date, s, day, ctx, { exclude: [...o.exclude, p.userId], depth: o.depth + 1, staffOnly: false }));
        for (const rf of refills) withPairs(addPlan(move, rf), pairs);
      }
      // (2) an extension of this shift over the window.
      const span = Math.max(sh.endQ, toQ) - Math.min(sh.startQ, fromQ);
      if (sh.endQ > fromQ && sh.startQ < toQ) continue;
      if (dayQ(p.userId) - (sh.endQ - sh.startQ) + span > maxQ || !shiftExtendsOver(p, sh, day, date, fromQ, toQ, roomAt)) continue;
      const [a, z] = sh.endQ <= fromQ ? [sh.endQ, toQ] : [fromQ, sh.startQ];
      const essential = works(Math.min(sh.startQ, a), Math.max(sh.endQ, z));
      const hours = essential ? 0 : (z - a) / 4;
      withPairs({ hours, steps: [{ kind: "extend", userId: p.userId, shiftStartQ: sh.startQ, positionId, fromQ: a, toQ: z, hours }] }, paired(a, z, p.userId));
    }
    // (3) a new block containing the window, with a legal placement witness.
    if (blockQ > maxQ || dayQ(p.userId) + blockQ > maxQ) continue;
    for (let a = Math.max(0, toQ - blockQ); a <= fromQ && a + blockQ <= 96; a++) {
      const z = a + blockQ;
      if (own.some((x) => x.startQ < z && x.endQ > a)) continue;
      if (!availableOn(p, date, a, z) || !leaderSettingAllows(p, st, a, z)) continue;
      let room = true;
      for (let q = a; q < z && room; q++) room = roomAt(q);
      if (!room) continue;
      const pairs = paired(a, z, p.userId);
      if (pairs.length === 0) continue;
      const hours = works(a, z) ? 0 : blockQ / 4;
      withPairs({ hours, steps: [{ kind: "new_block", userId: p.userId, positionId, fromQ: a, toQ: z, hours }] }, pairs);
      break;
    }
  }
  return out;
}

/**
 * Apply a fill's steps to a COPY of the schedule (the generator's `applyFill` mutation, on plain shifts): a relabel
 * splits its host segment, an extension adds an adjacent segment, a new block adds a shift. Null when any step cannot
 * apply (no such shift, a pinned shift, no host segment, a non-adjacent extension).
 */
export function applyFillSteps(s: WeekSchedule, date: string, steps: readonly FillStep[], salariedRoom: ReadonlyMap<string, number> = new Map()): WeekSchedule | null {
  const shifts = s.shifts.map((x) => ({ ...x, segments: x.segments.map((g) => ({ ...g })) }));
  const room = new Map(salariedRoom);
  for (const st of steps) {
    if (st.kind === "new_block") {
      shifts.push({ userId: st.userId, date, startQ: st.fromQ, endQ: st.toQ, segments: [{ positionId: st.positionId, startQ: st.fromQ, endQ: st.toQ }], closingManager: false, flex: false, pinned: false });
      continue;
    }
    const sh = shifts.find((x) => x.date === date && x.userId === st.userId && x.startQ === st.shiftStartQ);
    if (!sh || sh.pinned) return null;
    // Decision 4: a salaried manager's extension is FLEX; their relabel takes the base station room first, then flex.
    const salaried = room.has(st.userId);
    const flex = salaried ? { reasonKey: SALARIED_FLEX_REASON } : {};
    if (st.kind === "extend") {
      const seg: Segment = { positionId: st.positionId, startQ: st.fromQ, endQ: st.toQ, ...flex };
      if (st.fromQ === sh.endQ) sh.segments = [...sh.segments, seg];
      else if (st.toQ === sh.startQ) sh.segments = [seg, ...sh.segments];
      else return null;
      sh.startQ = Math.min(sh.startQ, st.fromQ);
      sh.endQ = Math.max(sh.endQ, st.toQ);
      continue;
    }
    const host = sh.segments.find((g) => g.positionId === st.fromPositionId && g.startQ <= st.fromQ && g.endQ >= st.toQ);
    if (!host || st.fromQ >= st.toQ) return null;
    const parts: Segment[] = [];
    for (const g of sh.segments) {
      if (g !== host) { parts.push(g); continue; }
      if (g.startQ < st.fromQ) parts.push({ ...g, endQ: st.fromQ });
      if (salaried) {
        for (const part of splitSalariedRelabel(st.fromQ, st.toQ, room.get(st.userId)!, isFlexSegment(g))) {
          parts.push({ positionId: st.positionId, startQ: part.startQ, endQ: part.endQ, ...(part.flex ? flex : {}) });
          if (!part.flex) room.set(st.userId, room.get(st.userId)! - (part.endQ - part.startQ));
        }
      } else parts.push({ positionId: st.positionId, startQ: st.fromQ, endQ: st.toQ });
      if (st.toQ < g.endQ) parts.push({ ...g, startQ: st.toQ });
    }
    sh.segments = parts;
  }
  return { ...s, shifts };
}

/** Error-class problems a fill must never add (gap bookkeeping excluded: these checks run with no declared gaps). */
const FILL_EXEMPT = new Set<string>(["undeclared_gap", "uncertified_gap"]);
function fillProblemCounts(problems: readonly RuleProblem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of problems) {
    if (FILL_EXEMPT.has(p.code)) continue;
    // Errors (and the salaried-week warnings the generator keeps hard — addendum A), and the availability warning (a fill
    // must respect availability — Astra chunk E P1-1).
    if (!generatorRefuses(p) && p.code !== "outside_assumed_availability") continue;
    const k = `${p.code}|${p.userId ?? ""}|${p.positionId ?? ""}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function uncoveredHeadQuarters(shifts: readonly Shift[], day: DayContext, ctx: RuleContext): number {
  const cov = dayCoverage(shifts, day, ctx);
  let n = 0;
  for (const [id, need] of Object.entries(day.need.positions)) for (let q = 0; q < 96; q++) n += Math.max(0, (need[q] ?? 0) - (cov.byPosition.get(id)?.[q] ?? 0));
  return n;
}

/**
 * ASTRA CHUNK E P1-1 — a witness is legal only when the WHOLE combined fill applies cleanly. The plan is applied to a
 * COPY, then judged: every step applies; the validator (that date, under its context) shows no NEW error-class problem
 * — no overlap / double-booking, no shift over the daily maximum, no role, window, leader-setting or priority breach —
 * and no new outside-availability; no salaried manager passes the weekly floor limit; the target position gains a head
 * at every quarter of the window; and the day's uncovered head-quarters strictly fall (a reassignment's refill really
 * refills). Re-finding the same plan is not proof; this is.
 */
export function fillIsLegal(g: Pick<GapSubject, "date" | "positionId" | "fromQ" | "toQ">, s: WeekSchedule, ctx: RuleContext, plan: FillPlan): boolean {
  const day = ctx.days[g.date];
  if (!day || !g.positionId || plan.steps.length === 0) return false;
  const room = new Map(plan.steps.map((x) => x.userId).filter((id) => ctx.people[id]?.salaried).map((id) => [id, baseFloorRoomQ(s, id, day.structure)] as const));
  const applied = applyFillSteps(s, g.date, plan.steps, room);
  if (!applied) return false;
  const dayCtx: RuleContext = { ...ctx, days: { [g.date]: day } };
  const only = (w: WeekSchedule): WeekSchedule => ({ ...w, shifts: shiftsOn(w, g.date), gaps: [], days: [] });
  const before = fillProblemCounts(checkScheduleRules(only(s), dayCtx));
  const after = fillProblemCounts(checkScheduleRules(only(applied), dayCtx));
  for (const [k, n] of after) if (n > (before.get(k) ?? 0)) return false;
  const limitH = day.structure.limits.managerFloorH;
  for (const id of new Set(plan.steps.map((x) => x.userId))) {
    if (ctx.people[id]?.salaried && floorHours(applied, id) > limitH && floorHours(applied, id) > floorHours(s, id)) return false;
    // Decision 4: a salaried fill is flex; it never passes the flex pool.
    if (ctx.people[id]?.salaried && salariedWeek(applied, id).flexH > day.structure.limits.salariedFlexH && salariedWeek(applied, id).flexH > salariedWeek(s, id).flexH) return false;
  }
  const covB = dayCoverage(shiftsOn(s, g.date), day, ctx);
  const covA = dayCoverage(shiftsOn(applied, g.date), day, ctx);
  for (let q = g.fromQ; q < g.toQ; q++) {
    if ((covA.byPosition.get(g.positionId)?.[q] ?? 0) < (covB.byPosition.get(g.positionId)?.[q] ?? 0) + 1) return false;
  }
  return uncoveredHeadQuarters(shiftsOn(applied, g.date), day, ctx) < uncoveredHeadQuarters(shiftsOn(s, g.date), day, ctx);
}

/**
 * The cheapest LEGAL fill found for one more head on a coverage deficit: the candidates cheapest first (ties in the
 * canonical order), the first whose applied whole passes `fillIsLegal` (Astra chunk E P1-1). Null when none is legal —
 * the deficit is then never `budget_limited` (it ends `unresolved_search` unless another cause proves it).
 */
export function cheapestFill(g: Pick<GapSubject, "date" | "positionId" | "fromQ" | "toQ">, s: WeekSchedule, ctx: RuleContext): FillPlan | null {
  const day = ctx.days[g.date];
  if (!day || !g.positionId) return null;
  for (const plan of byHours(fillCandidates(g.positionId, g.fromQ, g.toQ, g.date, s, day, ctx, { exclude: [], depth: 0, staffOnly: false }))) {
    if (fillIsLegal(g, s, ctx, plan)) return plan;
  }
  return null;
}

// ─── CC chunk H2: the salaried FLEX BLOCK (a new block covering an otherwise-uncovered window) ───────

/**
 * CC chunk H2 (2026-10-16, from Juan: "the 5–10 hour flex is used to keep labor hours down"): the LAST-RESORT fill. A salaried
 * manager may take a NEW block (or, when they already work that day, an extension of it) that covers an otherwise-UNCOVERED
 * window — zero hourly cost. Every quarter of it is FLEX (`SALARIED_FLEX_REASON`); the reason is `salaried_flex_cover`.
 */
export interface FlexBlock {
  userId: string;
  kind: "new_block" | "extend";
  /** The extended shift's start (`extend`); null for a new block. */
  shiftStartQ: number | null;
  fromQ: number;
  toQ: number;
  /** The added quarters: a station on the manager's cover list where it lacks a head, else the MoD lane where the MoD is missing. */
  segments: Array<{ positionId: string; startQ: number; endQ: number }>;
  /** The uncovered head-quarters (station heads + MoD quarters) it fills. */
  gain: number;
}

/** The uncovered head-quarters of a day: every position's missing heads plus the quarters without a manager on duty. */
function uncoveredDayQ(shifts: readonly Shift[], day: DayContext, ctx: RuleContext): number {
  const cov = dayCoverage(shifts, day, ctx);
  let n = uncoveredHeadQuarters(shifts, day, ctx);
  for (let q = 0; q < 96; q++) n += uncoveredFrom(cov, "mod_missing", null, day, q);
  return n;
}

/** The block applied to a COPY of the schedule (every added segment marked FLEX); null when its shift is gone or pinned. */
export function applyFlexBlock(s: WeekSchedule, date: string, blk: FlexBlock): WeekSchedule | null {
  const shifts = s.shifts.map((x) => ({ ...x, segments: x.segments.map((g) => ({ ...g })) }));
  const segs: Segment[] = blk.segments.map((g) => ({ ...g, reasonKey: SALARIED_FLEX_REASON }));
  if (blk.kind === "new_block") {
    shifts.push({ userId: blk.userId, date, startQ: blk.fromQ, endQ: blk.toQ, segments: segs, closingManager: false, flex: false, pinned: false });
  } else {
    const sh = shifts.find((x) => x.date === date && x.userId === blk.userId && x.startQ === blk.shiftStartQ);
    if (!sh || sh.pinned) return null;
    if (blk.fromQ === sh.endQ) sh.segments = [...sh.segments, ...segs];
    else if (blk.toQ === sh.startQ) sh.segments = [...segs, ...sh.segments];
    else return null;
    sh.startQ = Math.min(sh.startQ, blk.fromQ);
    sh.endQ = Math.max(sh.endQ, blk.toQ);
  }
  return { ...s, shifts };
}

/**
 * A flex block is legal when, applied to a copy: the validator (that date, under its context) shows no NEW problem the generator
 * refuses (overlap, the daily maximum, availability, leader setting, the cover list, roles, head limits, priority, the 4 h
 * minimum — never the GM / AGM 8 h minimum, a flex-only day is a cover); the manager's week stays inside the flex
 * (`limits.salariedFlexH`, total ≤ target + flex, base unchanged); and the day's uncovered head-quarters strictly fall.
 */
function flexBlockIsLegal(blk: FlexBlock, date: string, s: WeekSchedule, ctx: RuleContext, base: FlexLegalityBase = flexLegalityBase(s, date, ctx)): boolean {
  const day = ctx.days[date]!;
  const st = day.structure;
  const applied = applyFlexBlock(s, date, blk);
  if (!applied) return false;
  const after = fillProblemCounts(checkScheduleRules(base.only(applied), base.dayCtx));
  for (const [k, n] of after) if (n > (base.before.get(k) ?? 0)) return false;
  const w0 = salariedWeek(s, blk.userId);
  const w1 = salariedWeek(applied, blk.userId);
  if (w1.flexH > st.limits.salariedFlexH || w1.totalH > st.limits.salariedTargetWeekH + st.limits.salariedFlexH || w1.baseH !== w0.baseH) return false;
  return uncoveredDayQ(shiftsOn(applied, date), day, ctx) < base.uncovered;
}

/** The schedule AS IT STANDS on `date`, judged once: the problem counts and the uncovered head-quarters every candidate is measured against. */
interface FlexLegalityBase { dayCtx: RuleContext; only: (w: WeekSchedule) => WeekSchedule; before: Map<string, number>; uncovered: number }
function flexLegalityBase(s: WeekSchedule, date: string, ctx: RuleContext): FlexLegalityBase {
  const day = ctx.days[date]!;
  const dayCtx: RuleContext = { ...ctx, days: { [date]: day } };
  const only = (w: WeekSchedule): WeekSchedule => ({ ...w, shifts: shiftsOn(w, date), gaps: [], days: [] });
  return { dayCtx, only, before: fillProblemCounts(checkScheduleRules(only(s), dayCtx)), uncovered: uncoveredDayQ(shiftsOn(s, date), day, ctx) };
}

/** The salaried managers the flex search considers on `date`: active, never `neverGenerated`, not on an untouchable day; id order. */
export function flexSearchManagers(date: string, ctx: RuleContext): RulePerson[] {
  return Object.values(ctx.people).filter((p) => p.salaried && p.activeMember && !neverGenerated(p) && !p.untouchableDates.includes(date))
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

/**
 * Every LEGAL flex block on `date` (CC chunk H2), salaried managers in id order. For each manager with flex left (`flexLeftQ`),
 * active, never `neverGenerated`, not on an untouchable day, each quarter of the shop day is labelled with what they could
 * fill there, among the stations of their COVER LIST that lack a head (eligible, inside its window, room under its limit, a
 * priority secondary only beside its staffed primary): one that NO hourly member could cover then first (the flex goes where
 * only a manager can), else the station they are already filling, else the first of the list; else the MoD lane where the
 * manager on duty is missing. Then:
 *   - NO shift that day → a NEW block: the run's window of the greatest value (each quarter: a head filled, the MoD filled,
 *     and a manager-only station; earliest on a tie), at most the flex left and the
 *     daily maximum, inside their availability and leader setting, and at least the 4 h shift minimum — a shorter need never
 *     stands alone (the GM / AGM 8 h minimum does not apply: it is a cover, not a scheduled day);
 *   - a shift that day (and the shop allows staying longer, the shift unpinned) → an EXTENSION straight into labelled quarters
 *     after its end or before its start, within the flex left and the daily maximum (their whole day), never into another
 *     shift, inside their availability and leader setting over the merged span.
 * Each candidate must pass `flexBlockIsLegal`. It only ever fills quarters that lack a head or a manager: it never replaces
 * anyone (an hourly person is never displaced). Pure and deterministic.
 */
export function salariedFlexBlocks(date: string, s: WeekSchedule, ctx: RuleContext): FlexBlock[] {
  const day = ctx.days[date];
  if (!day) return [];
  const st = day.structure;
  const shifts = shiftsOn(s, date);
  const cov = dayCoverage(shifts, day, ctx);
  const shop = shopWindow(day);
  const maxQ = Math.round(st.limits.maxShiftH * 4);
  const minQ = st.limits.minimumShiftQ;
  const occ = (id: string, q: number) => cov.byPosition.get(id)?.[q] ?? 0;
  const stationOk = (p: RulePerson, id: string, q: number): boolean => {
    const pos = st.positions[id];
    if (!pos || !eligibleForPosition(p, pos) || q < pos.openQ || q >= pos.closeQ) return false;
    if (uncoveredFrom(cov, "coverage_gap", id, day, q) <= 0 || occ(id, q) >= positionLimit(pos, q)) return false;
    const primary = primaryOf(st, id);
    return primary === null || primary === id || occ(primary, q) > 0;
  };
  const modOk = (p: RulePerson, q: number) => uncoveredFrom(cov, "mod_missing", null, day, q) > 0 && modCountsOn(p, day, q);
  /** No hourly member could stand on this station at q (eligible, available, not untouchable): only a manager can cover it. */
  const hourly = Object.values(ctx.people).filter((x) => isHourly(x) && x.activeMember && !neverGenerated(x) && !x.untouchableDates.includes(date));
  const managersOnly = (id: string, q: number) => !hourly.some((x) => eligibleForPosition(x, st.positions[id]) && availableOn(x, date, q, q + 1));
  const out: FlexBlock[] = [];
  const base = flexLegalityBase(s, date, ctx);
  for (const p of flexSearchManagers(date, ctx)) {
    const flexQ = flexLeftQ(s, p.userId, st);
    if (flexQ <= 0) continue;
    const label: Array<string | null> = new Array<string | null>(96).fill(null);
    let prev: string | null = null;
    // The label: a station ONLY a manager could cover first (the flex goes where nobody hourly could go), then the station
    // already being filled, then the cover list in order, then the MoD lane. Its value weighs the block windows below.
    const value: number[] = new Array<number>(96).fill(0);
    for (let q = shop.fromQ; q < shop.toQ; q++) {
      const ok = p.coverPositions.filter((id) => stationOk(p, id, q));
      const only = ok.find((id) => managersOnly(id, q));
      const keep: boolean = prev !== null && prev !== MOD && ok.includes(prev) && (!only || managersOnly(prev, q));
      const l: string | null = keep ? prev : only ?? ok[0] ?? (modOk(p, q) ? MOD : null);
      label[q] = l;
      value[q] = l === null ? 0 : (l !== MOD ? 1 : 0) + (modOk(p, q) ? 1 : 0) + (l !== MOD && managersOnly(l, q) ? 1 : 0);
      prev = l;
    }
    const valueOf = (a: number, z: number) => { let v = 0; for (let q = a; q < z; q++) v += value[q]!; return v; };
    const mine = shifts.filter((x) => x.userId === p.userId).sort((a, b) => a.startQ - b.startQ);
    const cands: Array<Pick<FlexBlock, "kind" | "shiftStartQ" | "fromQ" | "toQ">> = [];
    if (mine.length === 0) {
      const cap = Math.min(flexQ, maxQ);
      let q = shop.fromQ;
      while (cap >= minQ && q < shop.toQ) {
        if (!label[q]) { q++; continue; }
        let r = q;
        while (r < shop.toQ && label[r]) r++;
        // The legal window (≥ the shift minimum, ≤ the flex left and the daily maximum) of the greatest value; ties → earliest.
        let best: [number, number] | null = null;
        for (let a = q; a + minQ <= r; a++) {
          let z = Math.min(r, a + cap);
          while (z - a >= minQ && !(availableOn(p, date, a, z) && leaderSettingAllows(p, st, a, z))) z--;
          if (z - a >= minQ && (!best || valueOf(a, z) > valueOf(best[0], best[1]))) best = [a, z];
        }
        if (best) cands.push({ kind: "new_block", shiftStartQ: null, fromQ: best[0], toQ: best[1] });
        q = r;
      }
    } else if (st.limits.salariedStayLonger) {
      const room = Math.min(flexQ, maxQ - mine.reduce((n, x) => n + (x.endQ - x.startQ), 0));
      const free = (q: number) => !mine.some((x) => x.startQ <= q && x.endQ > q);
      const legal = (a: number, z: number) => availableOn(p, date, a, z) && leaderSettingAllows(p, st, a, z);
      for (const sh of mine) {
        if (sh.pinned || room <= 0) continue;
        let z = sh.endQ;
        while (z < shop.toQ && z - sh.endQ < room && label[z] && free(z) && legal(sh.startQ, z + 1)) z++;
        if (z > sh.endQ) cands.push({ kind: "extend", shiftStartQ: sh.startQ, fromQ: sh.endQ, toQ: z });
        let a = sh.startQ;
        while (a > shop.fromQ && sh.startQ - a < room && label[a - 1] && free(a - 1) && legal(a - 1, sh.endQ)) a--;
        if (a < sh.startQ) cands.push({ kind: "extend", shiftStartQ: sh.startQ, fromQ: a, toQ: sh.startQ });
      }
    }
    for (const c of cands) {
      const segments: FlexBlock["segments"] = [];
      let gain = 0;
      for (let q = c.fromQ; q < c.toQ; q++) {
        const l = label[q]!;
        const last = segments[segments.length - 1];
        if (last && last.positionId === l) last.endQ = q + 1;
        else segments.push({ positionId: l, startQ: q, endQ: q + 1 });
        gain += (l !== MOD ? 1 : 0) + (modOk(p, q) ? 1 : 0);
      }
      const blk: FlexBlock = { userId: p.userId, ...c, segments, gain };
      if (flexBlockIsLegal(blk, date, s, ctx, base)) out.push(blk);
    }
  }
  return out;
}

/**
 * CC chunk H3 (2026-10-16, Astra H2 P1 — "search exhaustion is not proof"): the TARGET-DIRECTED reach. FILL and PROOF are
 * separate: `salariedFlexBlocks` is the generator's PREFERRED fill (greedy labels, the best window); this asks, for ONE
 * coverage deficit (position, date, window), whether ANY legal flex block by ANY salaried manager reaches it, on the
 * schedule AS IT STANDS (a manager already on another station over those quarters is genuinely busy: `person_overlap`).
 * For every salaried manager the flex search considers (`flexSearchManagers`) with flex left, eligible for the position
 * and with it on their cover list, in id order:
 *   (a) NO shift that day → a NEW block ON THAT POSITION over every window [a, z) that overlaps the deficit, with
 *       minimumShiftQ ≤ z − a ≤ min(flex left, the daily maximum, the week room under target + flex), every quarter
 *       inside the position's window and the shop day, under the head limit, inside their availability, the leader
 *       setting over the window — in the order: most of the deficit covered, then the shortest, then the earliest;
 *   (b) a shift that day (the shop allows staying longer, the shift unpinned) → an EXTENSION of it ONTO THAT POSITION,
 *       after its end or before its start, quarter by quarter up to the same bounds, as far as it still reaches the deficit.
 * Each candidate goes through the REAL `flexBlockIsLegal` on a copy; the first that passes is returned. Then, as insurance
 * beyond that scope, the preferred fill's own blocks overlapping the deficit. Null = no legal block OF THESE SHAPES reaches
 * the deficit — and nothing more: since CC chunk H4 this is a FILL HELPER ONLY (`coverWithTargetFlexBlock` takes what it
 * finds); it certifies nothing and no verifier re-runs it (a legal mixed-position block it cannot see may exist — Astra H3 P1).
 * `floor_limit` is `floorLimitCertificate`'s conservative precondition instead. The enumeration is bounded: at most
 * (shop day) × (daily maximum) windows per manager, with the quarter-local rules pre-filtered (each implied by legality,
 * so no legal candidate is dropped). Pure and deterministic.
 */
export function flexBlockReaching(g: Pick<GapSubject, "code" | "date" | "positionId" | "fromQ" | "toQ">, s: WeekSchedule, ctx: RuleContext): FlexBlock | null {
  if (g.code !== "coverage_gap" || !g.positionId) return null;
  const day = ctx.days[g.date];
  if (!day || g.toQ <= g.fromQ) return null;
  const st = day.structure;
  const target = g.positionId;
  const pos = st.positions[target];
  if (!pos) return null;
  const date = g.date;
  const shifts = shiftsOn(s, date);
  const cov = dayCoverage(shifts, day, ctx);
  const shop = shopWindow(day);
  const maxQ = Math.round(st.limits.maxShiftH * 4);
  const minQ = st.limits.minimumShiftQ;
  const lo = Math.max(shop.fromQ, pos.openQ);
  const hi = Math.min(shop.toQ, pos.closeQ);
  const occ = (q: number) => cov.byPosition.get(target)?.[q] ?? 0;
  const base = flexLegalityBase(s, date, ctx);
  type Cand = Pick<FlexBlock, "kind" | "shiftStartQ" | "fromQ" | "toQ">;
  const overlap = (c: Cand) => Math.max(0, Math.min(c.toQ, g.toQ) - Math.max(c.fromQ, g.fromQ));
  for (const p of flexSearchManagers(date, ctx)) {
    if (!eligibleForPosition(p, pos) || !p.coverPositions.includes(target)) continue;
    const flexQ = flexLeftQ(s, p.userId, st);
    if (flexQ <= 0) continue;
    const weekRoomQ = Math.round((st.limits.salariedTargetWeekH + st.limits.salariedFlexH) * 4) - Math.round(salariedWeek(s, p.userId).totalH * 4);
    const mine = shifts.filter((x) => x.userId === p.userId).sort((a, b) => a.startQ - b.startQ);
    const placeable = (q: number) => q >= lo && q < hi && occ(q) < positionLimit(pos, q) && availableOn(p, date, q, q + 1) && !mine.some((x) => x.startQ <= q && x.endQ > q);
    const cands: Cand[] = [];
    if (mine.length === 0) {
      const cap = Math.min(flexQ, maxQ, weekRoomQ);
      for (let a = Math.max(lo, g.fromQ - cap + 1); cap >= minQ && a < Math.min(hi, g.toQ); a++) {
        if (!placeable(a)) continue;
        let run = a;
        while (run < hi && run - a < cap && placeable(run)) run++;
        for (let z = Math.max(a + minQ, g.fromQ + 1); z <= run; z++) if (leaderSettingAllows(p, st, a, z)) cands.push({ kind: "new_block", shiftStartQ: null, fromQ: a, toQ: z });
      }
    } else if (st.limits.salariedStayLonger) {
      const room = Math.min(flexQ, maxQ - mine.reduce((n, x) => n + (x.endQ - x.startQ), 0), weekRoomQ);
      for (const sh of mine) {
        if (sh.pinned || room <= 0) continue;
        for (let z = sh.endQ; sh.endQ < g.toQ && z < hi && z - sh.endQ < room && placeable(z);) {
          z++;
          if (z > g.fromQ && leaderSettingAllows(p, st, sh.startQ, z)) cands.push({ kind: "extend", shiftStartQ: sh.startQ, fromQ: sh.endQ, toQ: z });
        }
        for (let a = sh.startQ; sh.startQ > g.fromQ && a > lo && sh.startQ - a < room && placeable(a - 1);) {
          a--;
          if (a < g.toQ && leaderSettingAllows(p, st, a, sh.endQ)) cands.push({ kind: "extend", shiftStartQ: sh.startQ, fromQ: a, toQ: sh.startQ });
        }
      }
    }
    // The order the fill takes them in: most of the deficit covered, then the shortest, then the earliest. (The proof needs any one.)
    cands.sort((x, y) => overlap(y) - overlap(x) || (x.toQ - x.fromQ) - (y.toQ - y.fromQ) || x.fromQ - y.fromQ);
    for (const c of cands) {
      let gain = 0;
      for (let q = c.fromQ; q < c.toQ; q++) gain += uncoveredFrom(cov, "coverage_gap", target, day, q) > 0 ? 1 : 0;
      const blk: FlexBlock = { userId: p.userId, ...c, segments: [{ positionId: target, startQ: c.fromQ, endQ: c.toQ }], gain };
      if (flexBlockIsLegal(blk, date, s, ctx, base)) return blk;
    }
  }
  return salariedFlexBlocks(date, s, ctx).find((b) => b.segments.some((x) => x.positionId === target && x.startQ < g.toQ && x.endQ > g.fromQ)) ?? null;
}

/** The budget's remaining hourly hours on the budgeted dates: budget − (used − essential). */
function remainingOf(f: ReturnType<typeof budgetFacts>): number {
  return f.budgetHours - (f.usedHours - f.essentialHours);
}


function eligibleMembers(g: GapSubject, day: DayContext, ctx: RuleContext): RulePerson[] {
  return Object.values(ctx.people).filter((p) => eligibleInWindow(p, g.code, g.positionId, day.structure, g.fromQ, g.toQ))
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

// ─── CC chunk H4: the CONSERVATIVE floor_limit ─────────────────────────────────

/**
 * A salaried manager's status for a coverage deficit on `date` over [fromQ, toQ) — see `FloorLimitCertificate`:
 * `on_shift_eligible` (CC chunk H7: eligible for the position and on shift at some quarter of the window — never excluded, so
 * NO certificate), else the FIRST of the four conservative exclusions, else null (off shift, with flex, could stand there, around,
 * the day with room: whether a legal block really exists is then the fills' business, never a proof's). Null and
 * `on_shift_eligible` both mean "no certificate"; the status says why.
 */
export function floorExclusionOf(p: RulePerson, g: Pick<GapSubject, "date" | "positionId" | "fromQ" | "toQ">, s: WeekSchedule, ctx: RuleContext): FloorManagerStatus | null {
  const day = ctx.days[g.date];
  if (!day || !g.positionId) return null;
  const st = day.structure;
  const maxQ = Math.round(st.limits.maxShiftH * 4);
  const own = shiftsOn(s, g.date).filter((sh) => sh.userId === p.userId);
  const eligible = eligibleForPosition(p, st.positions[g.positionId]);
  // CC chunk H7 (Astra H6 P1): eligible and ON SHIFT (any segment — a station, the MoD lane, flex) at ANY quarter of the window →
  // never excluded. Relabels and swaps among people already on shift (the AGM takes the Register so the GM can step onto Expo)
  // add no time and no hourly hour, and cannot be proven impossible cheaply. This subsumes the H4 MoD-relabel guard.
  if (eligible && own.some((sh) => sh.startQ < g.toQ && sh.endQ > g.fromQ)) return "on_shift_eligible";
  const flexQ = flexLeftQ(s, p.userId, st);
  // (a) flex exhausted: no flex left, or the week total already at target + flex (a new block or an extension is flex only).
  const wk = salariedWeek(s, p.userId);
  if (flexQ <= 0 || wk.totalH >= st.limits.salariedTargetWeekH + st.limits.salariedFlexH) return "flex_exhausted";
  // (b) ineligible for the position and never the manager on duty over the window.
  let modAny = false;
  for (let q = g.fromQ; q < g.toQ; q++) if (modCountsOn(p, day, q)) { modAny = true; break; }
  if (!eligible && !modAny) return "ineligible";
  // (c) unavailable at every quarter of [fromQ − maxShiftQ, toQ + maxShiftQ) that date.
  let availableAny = false;
  for (let q = Math.max(0, g.fromQ - maxQ); q < Math.min(96, g.toQ + maxQ); q++) if (availableOn(p, g.date, q, q + 1)) { availableAny = true; break; }
  if (!availableAny) return "unavailable";
  // (d) their day already sits at the daily maximum.
  if (own.reduce((n, sh) => n + (sh.endQ - sh.startQ), 0) >= maxQ) return "day_at_max";
  return null;
}

/**
 * The conservative floor_limit certificate of a coverage deficit, or null when it is not one: no active hourly person
 * eligible for the position and available at ANY quarter of the window (CC chunk H6 — shifts ignored), at least one salaried
 * manager considered, and EVERY one of them excluded (`floorExclusionOf`). Deterministic; the verifier recomputes it and
 * demands byte equality, so the limits, each manager's condition and their flex / floor hours are all bound.
 */
export function floorLimitCertificate(g: Pick<GapSubject, "code" | "date" | "positionId" | "fromQ" | "toQ">, s: WeekSchedule, ctx: RuleContext): FloorLimitCertificate | null {
  const day = ctx.days[g.date];
  if (!day || g.code !== "coverage_gap" || !g.positionId || g.toQ <= g.fromQ) return null;
  const st = day.structure;
  const subject: GapSubject = { code: "coverage_gap", date: g.date, positionId: g.positionId, fromQ: g.fromQ, toQ: g.toQ };
  // CC chunk H6 (Astra H5 P1): an active hourly person ELIGIBLE for the position and AVAILABLE at ANY quarter of the window
  // means no certificate — whatever they are doing just then (an extension, a swap or a reassignment may reach the gap; no
  // shift reasoning in the proof). Judged quarter by quarter, never over the whole window.
  const hourly = eligibleMembers(subject, day, ctx).filter((p) => isHourly(p) && p.activeMember);
  for (const p of hourly) {
    for (let q = g.fromQ; q < g.toQ; q++) if (eligibleFor(p, "coverage_gap", g.positionId, st, q) && availableOn(p, g.date, q, q + 1)) return null;
  }
  const managers = flexSearchManagers(g.date, ctx);
  if (managers.length === 0) return null;
  const excludedBy: Record<string, FloorManagerStatus> = {};
  for (const p of managers) {
    const why = floorExclusionOf(p, g, s, ctx);
    if (!why || why === "on_shift_eligible") return null;
    excludedBy[p.userId] = why;
  }
  return {
    limitH: st.limits.managerFloorH, targetWeekH: st.limits.salariedTargetWeekH, salariedFlexH: st.limits.salariedFlexH, maxShiftH: st.limits.maxShiftH,
    hourlyExcluded: Object.fromEntries(hourly.map((p) => [p.userId, "unavailable" as const])),
    excludedBy,
    flexHoursUsed: Object.fromEntries(managers.map((p) => [p.userId, salariedWeek(s, p.userId).flexH])),
    floorHoursUsed: Object.fromEntries(managers.map((p) => [p.userId, floorHours(s, p.userId)])),
  };
}

function verify(g: DeclaredGap, s: WeekSchedule, ctx: RuleContext, depth: number): boolean {
  const day = ctx.days[g.date];
  if (!day || g.toQ <= g.fromQ) return false;
  const st = day.structure;
  switch (g.cause) {
    case "budget_limited": {
      // Astra chunk A P1: essential coverage is budget-exempt and can never be excused by budget — the MoD,
      // the Closing Manager, and any coverage deficit whose fill would work the closing window.
      if (!budgetMayExcuse(g, ctx)) return false;
      const c = g.certificate;
      const f = budgetFacts(s, ctx);
      if (!f.budgetedDates.includes(g.date) || !sameIds(c.budgetedDates, f.budgetedDates)) return false;
      if (c.budgetHours !== f.budgetHours || c.usedHours !== f.usedHours || c.essentialHours !== f.essentialHours || c.remainingHours !== remainingOf(f)) return false;
      // The design ruling: the SAME deterministic search, re-run; the witness must be exactly what it found, and cost more than is left.
      const plan = cheapestFill(g, s, ctx);
      if (!plan || c.fillHours !== plan.hours || canonicalJson(c.witness) !== canonicalJson(plan.steps)) return false;
      // Astra chunk E P1-1: re-finding is not proof — the witness itself, applied to a copy, must validate.
      if (!fillIsLegal(g, s, ctx, { hours: c.fillHours, steps: c.witness })) return false;
      // A zero-hourly-cost fill is never a budget gap, even when the budget is already overspent (R < 0).
      return plan.hours > 0 && plan.hours > c.remainingHours;
    }
    case "floor_limit": {
      // CC chunk H4: the SAME deterministic precondition, recomputed on the current inputs; the certificate must be exactly it.
      const re = floorLimitCertificate(g, s, ctx);
      return re !== null && canonicalJson(re) === canonicalJson(g.certificate);
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
        // Only the quarters at which the person COUNTS need them unavailable (Astra chunk B P1-2).
        for (let q = g.fromQ; q < g.toQ; q++) if (eligibleFor(p, g.code, g.positionId, st, q) && availableOn(p, g.date, q, q + 1)) return false;
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
      return excessFits(c, g, s, day, ctx); // the excess needs another cause
    }
    case "structure": {
      if (g.certificate.rule === "max_shift") {
        const re = capOnlyBound(g, s, ctx);
        return !!re && canonicalJson(re) === canonicalJson(g.certificate);
      }
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
    const floor = floorLimitCertificate(subject, s, ctx);
    const fl = floor ? tryCert({ ...subject, cause: "floor_limit", certificate: floor }) : null;
    if (fl) return fl;
  }
  if (budgetMayExcuse(subject, ctx)) {
    const f = budgetFacts(s, ctx);
    const plan = f.budgetedDates.includes(subject.date) ? cheapestFill(subject, s, ctx) : null;
    const bud = plan === null ? null : tryCert({ ...subject, cause: "budget_limited", certificate: {
      budgetedDates: f.budgetedDates, budgetHours: f.budgetHours, usedHours: f.usedHours, essentialHours: f.essentialHours,
      remainingHours: remainingOf(f), fillHours: plan.hours, witness: plan.steps,
    } });
    if (bud) return bud;
  }
  // CC chunk C ruling 2: last, the cap-only counting bound (it only ever converts what would otherwise be unresolved).
  const cap = capOnlyBound(subject, s, ctx);
  return cap ? tryCert({ ...subject, cause: "structure", certificate: cap }) : null;
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
export function checkScheduleRules(s: WeekSchedule, ctx: RuleContext, opts: RuleCheckOptions = {}): RuleProblem[] {
  const out: RuleProblem[] = [];
  const push = (code: RuleCode, day: string, extra: Partial<Omit<RuleProblem, "code" | "severity" | "day" | "inherited">> = {}) => {
    // CC addendum A: on a manager-edited week the station floor (32 h) WARNS; a generated week keeps it an error.
    const severity: RuleSeverity = code === "manager_floor_exceeded" && opts.managerEdited ? "warning" : RULE_CODES[code];
    const p: RuleProblem = { code, severity, day, params: {}, inherited: false };
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
      // CC chunk C ruling 2: the daily maximum is per person per DATE (a split day cannot dodge it); one problem, at
      // the person's first shift of the day, carrying the day's total. With one shift a day it reads exactly as before.
      const maxQ = Math.round(st.limits.maxShiftH * 4);
      const mineToday = shifts.filter((x) => x.userId === u);
      const dayQ = mineToday.reduce((n, x) => n + (x.endQ - x.startQ), 0);
      if (dayQ > maxQ && mineToday.every((x) => x.startQ >= sh.startQ)) push("shift_over_maximum", date, { userId: u, q: sh.startQ, params: { minutes: dayQ * 15, maximumMinutes: maxQ * 15 } });
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
        // Decision 8: a catering manager may cover a station (never Prep/Dishwasher) as a marked last resort.
        const cateringCover = p.role === "catering_mgr" && !!g.lastResort && g.reasonKey === CATERING_MANAGER_COVER && !!pos && pos.role !== "prep_dish";
        if (!pos?.allowedRoles.includes(p.role) && !(pos?.role === "prep_dish" && manager && callout) && !cateringCover) {
          push("role_not_allowed", date, { userId: u, positionId: g.positionId, q: g.startQ, params: { role: p.role } });
        }
        if (cateringCover && cateringWindows(day).some(([a, z]) => g.startQ < z && g.endQ > a)) {
          push("catering_cover_in_catering_window", date, { userId: u, positionId: g.positionId, q: g.startQ });
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
    const flexOnly = new Map<string, boolean>();
    for (const sh of shifts) {
      byPerson.set(sh.userId, (byPerson.get(sh.userId) ?? 0) + (sh.endQ - sh.startQ));
      flexOnly.set(sh.userId, (flexOnly.get(sh.userId) ?? true) && sh.segments.every(isFlexSegment));
    }
    for (const [u, q] of byPerson) {
      const p = ctx.people[u];
      if (!p?.salaried) continue;
      // CC chunk H2: a day whose every quarter is FLEX (`SALARIED_FLEX_REASON`) is a COVER, not a scheduled day — the GM /
      // AGM daily minimum does not apply to it; the shift minimum (4 h) still does. Unmarked, it is a scheduled day.
      const roleMinQ = flexOnly.get(u) ? 0 : p.role === "gm" ? st.limits.gmMinimumH * 4 : p.role === "agm" ? st.limits.agmMinimumH * 4 : 0;
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
    // Decision 4: a salaried week is governed by its target + flex (below), never the hourly overtime warning.
    if (!p.salaried && hours > st.limits.overtimeH) push("overtime", last, { userId: u, params: { hours, limit: st.limits.overtimeH } });
    if (isHourly(p) && ((p.softMaxH !== null && hours > p.softMaxH) || (p.softMinH !== null && hours < p.softMinH))) {
      push("soft_range", last, { userId: u, params: { hours, min: p.softMinH, max: p.softMaxH } });
    }
    if (p.salaried) {
      const floor = floorHours(s, u);
      const floorDays = [...new Set(mine.filter((x) => builtSet.has(x.date) && x.segments.some((g) => g.positionId !== MOD)).map((x) => x.date))].sort();
      const at = floorDays[floorDays.length - 1];
      if (at && floor > st.limits.managerFloorH) push("manager_floor_exceeded", at, { userId: u, params: { hours: floor, limit: st.limits.managerFloorH } });
      // Juan 2026-10-16 (decision 4): the BASE week ≤ the target; flex only on top, within the flex.
      const w = salariedWeek(s, u);
      const target = st.limits.salariedTargetWeekH;
      if (w.baseH > target) push("salaried_base_over_target", last, { userId: u, params: { hours: w.baseH, limit: target } });
      if (w.flexH > st.limits.salariedFlexH || w.totalH > target + st.limits.salariedFlexH) {
        push("salaried_over_flex", last, { userId: u, params: { hours: w.totalH, flexHours: w.flexH, flexLimit: st.limits.salariedFlexH, limit: target } });
      }
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
