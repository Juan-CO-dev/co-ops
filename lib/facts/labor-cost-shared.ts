/** Item 2 PR 2c: THE two-view labor pricer, pure (labor plan r6 §3 P0, P2 #3). SQL (0338
 * fact_labor_cost) returns per (week, shop) only COMPONENTS and flags; the views, percentages, targets
 * and tones are worked out here, in one tested place. Juan 2026-11-16:
 *   pure_hourly  = hourly straight time + overtime premium                      (target 18%)
 *   fully_loaded = pure_hourly + salaried fixed cost + burden (taxes/benefits)  (target <= 28%)
 *   burden       = burden % x (pure_hourly + salaried), per shop, its own % (12% default = `estimated`)
 * Null rules: an unknown salary makes fully_loaded (and its burden) null and leaves pure_hourly valid;
 * unknown sales make every % null; unknown HOURS (an open punch, a missing / incomplete day, an unbuilt
 * week: fix r1 P1; a PENDING day: fix r3) make every % null and its tone 'none'. Never one blended stored number.
 * Fix r3 rule: a day inside its settle window has no ledger evidence by definition (evidence = a finished
 * time_punches run started >= the settle time after the day ended), and a sync that failed or ran inside the
 * window is indistinguishable from one that captured everything, so its hours (zero or not) are provisional:
 * shown as numbers, never a % or a tone. A zero is definitive only once the day is COVERED. */
import type { RoleCode } from "@/lib/roles";
import { laborTone, type LaborTone } from "@/lib/scheduling/board-shared";
import { LABOR_TARGET_HOURLY_PCT, LABOR_TARGET_LOADED_PCT } from "./labor-config-shared";

export interface LaborCostRow {
  week_start: string; location_id: string;
  hourly_straight_cents: number; ot_premium_cents: number;
  /** 0340: `incomplete` = no estimate and the week's wage-derived salary has a payroll-shop gap (cents NULL) */
  salaried_cents: number | null; salary_basis: "estimate" | "wages" | "incomplete" | "unknown";
  burden_pct: number; burden_basis: "estimated" | "payroll";
  /** hourly minutes priced at the shop estimate (no wage, or Q5 = dc_minimum) */
  estimated_rate_minutes: number;
  hourly_minutes: number; ot_minutes: number; salaried_minutes: number;
  ot_state: "assessed" | "lower_bound" | "week_open" | "unbuilt";
  range_days: number;
  days_covered: number; days_pending: number; days_fallback: number; days_incomplete: number; days_missing: number;
  /** unclosed punches on the range's days, counted once per day they could span (fix r2 P1: open punch-DAYS; their worked hours are unknown) */
  open_punches: number;
  /** 0340, returned whatever the basis (an estimate included): salaried accounts placed at this shop, the
   * week's unplaced accounts (the same number on every shop), accounts assigned here with no salary in 7shifts */
  salaried_people: number; salary_unplaced_people: number; salary_missing_wage_people: number;
  /** 0345 (fact_labor_cost_planned only): the range's days whose population is the PLAN (a schedule), not the facts.
   * Absent / 0 = a row of facts only (every public fact_labor_cost row). */
  days_planned?: number;
  /** 0345: the salary came from the plan's allocation (no stored row for the week, no estimate) */
  salary_projected?: boolean;
  /** 0345: the row's days reach its payroll week's first planned date, so its overtime is (in part) the plan's
   * count, even on a row of retained fact days only (replacing Wednesday moves Thursday's overtime) */
  ot_planned?: boolean;
}

/** PROJECTED READINESS (board two views PR 1, CC's ruling on Astra r4 P1): what a row holding planned days may
 * show is decided by whether the PLAN's inputs are complete, separately from the actual-generation gate (a
 * future week has no stored generation and never will until it is worked). The loader states the facts; this
 * module judges them. A retained ACTUAL day inside the same row keeps the actual rules. */
export interface LaborProjectionInputs {
  /** every planned day of this payroll week at this shop has its schedule loaded (the adjacent board week's
   * head included when the week's Sunday is not settled): the 40 h counter saw the whole week */
  weekScheduleComplete: boolean;
  /** the week's RETAINED fact days passed the actual gate (currentWeekCoverage `ready`); true when none is retained */
  retainedFactsReady: boolean;
  /** the shared counter reproduced the stored overtime of the week's stored rows; true when none is retained */
  otRecountMatches: boolean;
  /** scheduled hourly people in the range with no wage at all (the first-known-wage fallback already applied) */
  wageUnknownPeople: number;
  /** Fix r1 (P2-1): the week's STORED labor_week_salaried row, if this shop has one, belongs to the week's CURRENT
   * generation (currentWeekCoverage `ready`). True when nothing is stored (the plan's fresh allocation is used).
   * False = the source moved since that row was built (a payroll-shop reassignment, a salary change): the row SQL
   * returns is the OLD allocation, and it must never price a projection. */
  storedSalaryCurrent: boolean;
}
export type ProjectionGap = "schedule_incomplete" | "actuals_rebuilding" | "ot_not_assessed" | "wage_unknown" | "salary_rebuilding";
export interface LaborProjection {
  /** the projected overtime (minutes and premium) is the whole payroll week's count */
  overtimeKnown: boolean;
  /** every projected hourly minute has a wage: the projected $ are real */
  moneyKnown: boolean;
  /** the salary SQL returned may be shown: it is the shop's estimate, the plan's fresh allocation, or a stored row
   * of the current generation. False withholds the salary, its burden and fully loaded (`salary_rebuilding`);
   * pure hourly does not depend on the allocation and keeps its number. */
  salaryCurrent: boolean;
  gaps: ProjectionGap[];
}
/** No stated inputs = nothing known (fail closed). A missing input withholds the figure that needs it, by name.
 * `salaryBasis` = the row's own: the shop's ESTIMATE is a setting, not a stored generation, so it is always current. */
export function laborProjectionReadiness(inputs: LaborProjectionInputs | undefined, salaryBasis?: LaborCostRow["salary_basis"]): LaborProjection {
  const estimate = salaryBasis === "estimate";
  if (!inputs) return { overtimeKnown: false, moneyKnown: false, salaryCurrent: estimate, gaps: estimate ? ["schedule_incomplete"] : ["schedule_incomplete", "salary_rebuilding"] };
  const gaps: ProjectionGap[] = [];
  if (!inputs.weekScheduleComplete) gaps.push("schedule_incomplete");
  if (!inputs.retainedFactsReady) gaps.push("actuals_rebuilding");
  if (!inputs.otRecountMatches) gaps.push("ot_not_assessed");
  const overtimeKnown = gaps.length === 0;
  const moneyKnown = !(inputs.wageUnknownPeople > 0);
  if (!moneyKnown) gaps.push("wage_unknown");
  const salaryCurrent = estimate || inputs.storedSalaryCurrent === true;
  if (!salaryCurrent) gaps.push("salary_rebuilding");
  return { overtimeKnown, moneyKnown, salaryCurrent, gaps };
}

export interface LaborWeekView {
  weekStart: string;
  hourlyStraightCents: number; otPremiumCents: number; pureHourlyCents: number;
  salariedCents: number | null; burdenCents: number | null; fullyLoadedCents: number | null;
  salaryUnknown: boolean; burdenEstimated: boolean; rateEstimated: boolean;
  /** `projected` / `not_assessed` only on a view holding planned days (never a stored state) */
  otState: LaborCostRow["ot_state"] | "projected" | "not_assessed"; coverageComplete: boolean;
  /** false = some worked hours are unknown (open punch, missing / incomplete / pending day, unbuilt week): no % is definitive */
  hoursKnown: boolean; openPunches: number;
  /** 0340: some shop's wage-derived salary is incomplete (a payroll-shop gap, no estimate) */
  salaryIncomplete: boolean;
  /** 0340: payroll-shop gaps behind the week (the unplaced once, missing wages per shop), shown even beside an estimate */
  salaryGaps: number;
  /** 0345: the view holds planned days (a schedule priced by the facts' own body), and how many */
  projected: boolean; daysPlanned: number;
  /** null on a view that leans on no plan; else what the plan is complete enough to say (every shop's, the worst
   * wins). Non-null with `projected` false = retained fact days whose OVERTIME is the plan's count. */
  projection: LaborProjection | null;
  /** the salary of some shop came from the plan's allocation, not a stored week */
  salaryProjected: boolean;
}

/** A fact_labor_cost row as returned by PostgREST or pg: bigint / numeric may arrive as strings, dates
 * as Date objects. Never coerces an unknown salary to 0. */
export function toLaborCostRow(r: Record<string, unknown>): LaborCostRow {
  const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  const n = (v: unknown) => Number(v);
  return {
    week_start: ymd(r.week_start), location_id: String(r.location_id), hourly_straight_cents: n(r.hourly_straight_cents), ot_premium_cents: n(r.ot_premium_cents),
    salaried_cents: r.salaried_cents === null || r.salaried_cents === undefined ? null : n(r.salaried_cents),
    salary_basis: r.salary_basis as LaborCostRow["salary_basis"], burden_pct: n(r.burden_pct), burden_basis: r.burden_basis as LaborCostRow["burden_basis"],
    estimated_rate_minutes: n(r.estimated_rate_minutes), hourly_minutes: n(r.hourly_minutes), ot_minutes: n(r.ot_minutes), salaried_minutes: n(r.salaried_minutes),
    ot_state: r.ot_state as LaborCostRow["ot_state"], range_days: n(r.range_days), days_covered: n(r.days_covered), days_pending: n(r.days_pending),
    days_fallback: n(r.days_fallback), days_incomplete: n(r.days_incomplete), days_missing: n(r.days_missing),
    open_punches: n(r.open_punches),
    // A database before 0340 returns no gap columns: read as 0 (its basis is never `incomplete`).
    salaried_people: n(r.salaried_people ?? 0), salary_unplaced_people: n(r.salary_unplaced_people ?? 0),
    salary_missing_wage_people: n(r.salary_missing_wage_people ?? 0),
    // The public fact_labor_cost (and a database before 0345) returns neither: a row of facts only.
    days_planned: n(r.days_planned ?? 0), salary_projected: r.salary_projected === true, ot_planned: r.ot_planned === true,
  };
}

const OT_RANK: Record<LaborWeekView["otState"], number> = { assessed: 0, projected: 1, lower_bound: 2, week_open: 3, unbuilt: 4, not_assessed: 5 };
const planned = (r: LaborCostRow) => Number(r.days_planned ?? 0);
/** The row leans on a plan: it holds planned days, or its overtime is the plan's count. */
const leansOnPlan = (r: LaborCostRow) => planned(r) > 0 || r.ot_planned === true;
const badDays = (r: LaborCostRow) => Number(r.days_missing) + Number(r.days_incomplete) + Number(r.days_pending) + Number(r.open_punches);
/** A row's hours: facts only = the actual rule, unchanged. With planned days, the planned part is the plan's
 * own minutes, and the RETAINED actual days (if any) still need a built week and no unknown day. */
function rowHoursKnown(r: LaborCostRow): boolean {
  if (planned(r) === 0) return r.ot_state !== "unbuilt" && badDays(r) === 0;
  return badDays(r) === 0 && (Number(r.range_days) - planned(r) <= 0 || r.ot_state !== "unbuilt");
}

/** Rows of one or more shops, summed per week (each shop's burden on its own pay). `projectionFor` states the
 * plan's inputs for a row holding planned days (0345); it is never asked about a row of facts only. */
export function laborWeekViews(rows: readonly LaborCostRow[], projectionFor?: (row: LaborCostRow) => LaborProjectionInputs | undefined): LaborWeekView[] {
  const byWeek = new Map<string, LaborCostRow[]>();
  for (const r of rows) (byWeek.get(r.week_start) ?? byWeek.set(r.week_start, []).get(r.week_start)!).push(r);
  return [...byWeek.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([weekStart, rs]) => {
    const straight = rs.reduce((s, r) => s + Number(r.hourly_straight_cents), 0);
    const premium = rs.reduce((s, r) => s + Number(r.ot_premium_cents), 0);
    const readiness = rs.filter(leansOnPlan).map((r) => laborProjectionReadiness(projectionFor?.(r), r.salary_basis));
    // Fix r1 (P2-1): a stored salary of a stale generation is unknown, like a missing one (never the old number).
    const salaryUnknown = rs.some((r) => r.salaried_cents === null) || readiness.some((x) => !x.salaryCurrent);
    const salaried = salaryUnknown ? null : rs.reduce((s, r) => s + Number(r.salaried_cents), 0);
    const burden = salaryUnknown ? null : rs.reduce((s, r) =>
      s + Math.round((Number(r.burden_pct) / 100) * (Number(r.hourly_straight_cents) + Number(r.ot_premium_cents) + Number(r.salaried_cents))), 0);
    const pure = straight + premium;
    const openPunches = rs.reduce((s, r) => s + Number(r.open_punches), 0);
    const hoursKnown = rs.every(rowHoursKnown);
    const projection: LaborProjection | null = readiness.length === 0 ? null : {
      overtimeKnown: readiness.every((x) => x.overtimeKnown), moneyKnown: readiness.every((x) => x.moneyKnown),
      salaryCurrent: readiness.every((x) => x.salaryCurrent),
      gaps: [...new Set(readiness.flatMap((x) => x.gaps))],
    };
    // An open punch's hours are unknown, so its week's overtime can only be a lower bound (never upgrades week_open).
    // A row holding planned days has no stored overtime: it is the plan's count, or not assessed.
    const otRows = rs.map((r): LaborWeekView["otState"] => (leansOnPlan(r)
      ? (laborProjectionReadiness(projectionFor?.(r)).overtimeKnown ? "projected" : "not_assessed")
      : r.ot_state === "assessed" && Number(r.open_punches) > 0 ? "lower_bound" : r.ot_state));
    return {
      weekStart, hourlyStraightCents: straight, otPremiumCents: premium, pureHourlyCents: pure,
      salariedCents: salaried, burdenCents: burden, fullyLoadedCents: salaried === null || burden === null ? null : pure + salaried + burden,
      salaryUnknown, burdenEstimated: rs.some((r) => r.burden_basis === "estimated"), rateEstimated: rs.some((r) => Number(r.estimated_rate_minutes) > 0),
      otState: otRows.sort((a, b) => OT_RANK[b] - OT_RANK[a])[0]!,
      coverageComplete: rs.every((r) => r.days_pending + r.days_fallback + r.days_incomplete + r.days_missing + r.open_punches === 0),
      hoursKnown, openPunches,
      salaryIncomplete: rs.some((r) => r.salary_basis === "incomplete"),
      salaryGaps: Math.max(0, ...rs.map((r) => Number(r.salary_unplaced_people))) + rs.reduce((s, r) => s + Number(r.salary_missing_wage_people), 0),
      projected: rs.some((r) => planned(r) > 0), daysPlanned: rs.reduce((s, r) => s + planned(r), 0), projection,
      salaryProjected: rs.some((r) => r.salary_projected === true),
    };
  });
}

/** Several payroll weeks as ONE view (a board week Mon-Sun spans two; a range spans many): raw cents summed
 * first, an unknown salary in any week makes the loaded total unknown, hours are known only when every week's
 * are, the overtime state is the worst, and the plan's readiness is every week's. Never an average. */
export function sumLaborViews(views: readonly LaborWeekView[]): LaborWeekView | null {
  if (views.length === 0) return null;
  if (views.length === 1) return views[0]!;
  const sum = (f: (v: LaborWeekView) => number) => views.reduce((s, v) => s + f(v), 0);
  const nullable = (f: (v: LaborWeekView) => number | null) => (views.some((v) => f(v) === null) ? null : views.reduce((s, v) => s + (f(v) as number), 0));
  const leaning = views.filter((v) => v.projection !== null).map((v) => v.projection!);
  return {
    weekStart: views[0]!.weekStart, hourlyStraightCents: sum((v) => v.hourlyStraightCents), otPremiumCents: sum((v) => v.otPremiumCents),
    pureHourlyCents: sum((v) => v.pureHourlyCents), salariedCents: nullable((v) => v.salariedCents), burdenCents: nullable((v) => v.burdenCents),
    fullyLoadedCents: nullable((v) => v.fullyLoadedCents), salaryUnknown: views.some((v) => v.salaryUnknown),
    burdenEstimated: views.some((v) => v.burdenEstimated), rateEstimated: views.some((v) => v.rateEstimated),
    otState: [...views].sort((a, b) => OT_RANK[b.otState] - OT_RANK[a.otState])[0]!.otState,
    coverageComplete: views.every((v) => v.coverageComplete), hoursKnown: views.every((v) => v.hoursKnown), openPunches: sum((v) => v.openPunches),
    salaryIncomplete: views.some((v) => v.salaryIncomplete), salaryGaps: sum((v) => v.salaryGaps),
    projected: views.some((v) => v.projected), daysPlanned: sum((v) => v.daysPlanned),
    projection: leaning.length === 0 ? null : { overtimeKnown: leaning.every((x) => x.overtimeKnown), moneyKnown: leaning.every((x) => x.moneyKnown),
      salaryCurrent: leaning.every((x) => x.salaryCurrent),
      gaps: [...new Set(leaning.flatMap((x) => x.gaps))] },
    salaryProjected: views.some((v) => v.salaryProjected),
  };
}

export interface LaborTarget { pct: number; source: "structure" | "default" }
export interface LaborTargets { loaded: LaborTarget; hourly: LaborTarget }
/** The structure in force at the week's start decides which view its targetPct is for (its `basis`). */
export function laborTargetsFor(structure: { labor: { targetPct: number; basis: "hourly" | "total" } } | null): LaborTargets {
  const loaded: LaborTarget = { pct: LABOR_TARGET_LOADED_PCT, source: "default" };
  const hourly: LaborTarget = { pct: LABOR_TARGET_HOURLY_PCT, source: "default" };
  if (!structure) return { loaded, hourly };
  return structure.labor.basis === "total"
    ? { loaded: { pct: structure.labor.targetPct, source: "structure" }, hourly }
    : { loaded, hourly: { pct: structure.labor.targetPct, source: "structure" } };
}
/** A range's targets: one number when every week agrees, else `target_varies` (never an average). */
export function rangeTargets(weeks: readonly LaborTargets[]): { loaded: number | "target_varies"; hourly: number | "target_varies" } {
  const one = (xs: number[]) => (new Set(xs).size === 1 ? xs[0]! : "target_varies" as const);
  return { loaded: one(weeks.map((w) => w.loaded.pct)), hourly: one(weeks.map((w) => w.hourly.pct)) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
export interface LaborPercents { pureHourlyPct: number | null; pureHourlyTone: LaborTone; fullyLoadedPct: number | null; fullyLoadedTone: LaborTone }
export function laborPercents(v: LaborWeekView, netSalesCents: number | null, t: LaborTargets): LaborPercents {
  // A projection shows a % only when its overtime is the whole week's count and every projected minute has a wage.
  const known = v.hoursKnown && (v.projection === null || (v.projection.overtimeKnown && v.projection.moneyKnown));
  const pct = (c: number | null) => (!known || c === null || netSalesCents === null || netSalesCents <= 0 ? null : round1((100 * c) / netSalesCents));
  const h = pct(v.pureHourlyCents), f = pct(v.fullyLoadedCents);
  return { pureHourlyPct: h, pureHourlyTone: laborTone(h, t.hourly.pct), fullyLoadedPct: f, fullyLoadedTone: laborTone(f, t.loaded.pct) };
}

/** Juan Q2: the salaried weekly cost spread evenly over the shop's open quarters (for hour readers);
 * the remainder cents go to the earliest quarters so the parts sum exactly. */
export function spreadSalariedOverQuarters(weeklyCents: number, openQuarters: readonly string[]): Map<string, number> {
  const keys = [...new Set(openQuarters)].sort();
  const out = new Map<string, number>();
  if (keys.length === 0) return out;
  const base = Math.floor(weeklyCents / keys.length);
  let rest = weeklyCents - base * keys.length;
  for (const k of keys) { out.set(k, base + (rest > 0 ? 1 : 0)); if (rest > 0) rest--; }
  return out;
}

/** Who may read what from the labor facts (the reader enforces it before any I/O; the AGM's payload
 * carries nothing money-derivable). GM: both views for their own shops; MoO+: per-person cost. */
export type LaborFactAccess = "none" | "hours_only" | "shop_money" | "person_money";
export function laborFactAccess(role: RoleCode): LaborFactAccess {
  if (role === "moo" || role === "owner" || role === "cgs") return "person_money";
  if (role === "gm") return "shop_money";
  if (role === "agm") return "hours_only";
  return "none";
}

const ACCESS_RANK: Record<LaborFactAccess, number> = { none: 0, hours_only: 1, shop_money: 2, person_money: 3 };
/** Item 9 (Juan's default, plan r2 finding 4): the ONE switch for cost BY PERSON on every labor reader (the
 * business report, its export, the board). `person_money` = MoO / Owner / CGS; set it to `shop_money` and a GM
 * sees it too, everywhere at once. Never a second rule beside this one. */
export const PERSON_COST_MIN: LaborFactAccess = "person_money";
export function canSeePersonCost(role: RoleCode): boolean {
  return ACCESS_RANK[laborFactAccess(role)] >= ACCESS_RANK[PERSON_COST_MIN];
}

/** Every label a labor reader shows (en + es, pinned by tests/fact-labor-i18n.test.ts). No reader ships in
 * 2c; these exist so the first one is born translated. */
export const LABOR_FACT_I18N_KEYS = [
  "labor.facts.view.fully_loaded", "labor.facts.view.pure_hourly", "labor.facts.target.loaded", "labor.facts.target.hourly",
  "labor.facts.target.default", "labor.facts.target_varies", "labor.facts.estimated", "labor.facts.burden_estimated",
  "labor.facts.rate_estimated", "labor.facts.straight_time", "labor.facts.salary_unknown", "labor.facts.ot_lower_bound",
  "labor.facts.week_open", "labor.facts.coverage.fallback", "labor.facts.coverage.pending", "labor.facts.coverage.incomplete",
  "labor.facts.salary_incomplete", "labor.facts.salary_gaps",
] as const;
