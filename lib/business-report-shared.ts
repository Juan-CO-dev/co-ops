/**
 * Item 9 PR 9a: the BUSINESS REPORT's pure core. Zero I/O, no env, no clock (callers pass `today` and env).
 * Plan: CHIEF item-09-FULL-REPORT-PLAN-r2.md, with Astra r2's three findings fixed per CC's rulings:
 *
 *  P1  LABOR DENOMINATOR. labor % = labor cost / NET SALES, where net sales = the Sales report's own net
 *      (Toast gross - discounts/comps - voids - sales refunds: `toastNetCents`, before tax and tips) PLUS
 *      ezCater's own subtotal by event date. A Toast ring linked to an ezCater order is classed
 *      `ezcater_linked` and never enters, so nothing is counted twice. Day / week / range grain use that
 *      total; quarter grain uses the quarter's Toast check sales only (ezCater has no hour), straight time,
 *      labelled `toast_only_straight_time`. A missing or zero denominator is no % (null, never 0 or
 *      Infinity), and BOTH sides must be covered: unknown hours (pending / open punch / missing day /
 *      unbuilt week) are no % either.
 *  P2  OVERTIME GATE. Hourly / overtime-bearing labor shows only for payroll weeks built per shop (0339:
 *      labor_week_coverage.ot_scope = 'per_shop') by the CURRENT builder (LABOR_BUILDER_VERSION). A week
 *      still on the company-wide rule (labor-v1) is `rebuilding`: its money, overtime and % are withheld.
 *  P2  RUSH ZERO BASELINE. A quarter qualifies only when its baseline is real (median checks >= 1 AND
 *      median sales > 0 over the last 8 covered same weekdays), it has at least RUSH_MIN_CHECKS checks,
 *      sales > 0, and sales >= 1.5x the median. A zero or thin baseline can never make a rush.
 *
 * Money is the Sales report's (sales_report_daily through summarizeSales, so parity holds by construction);
 * the cuts (quarter, channel, server) come from the order facts and must RECOMPOSE to that day's Toast check
 * total, or the day's cuts read `rebuilding`. Checks over $5,000 are included and flagged (Juan's default).
 */
import { shiftReportDate, validReportDate } from "@/lib/report-range";
import { summarizeSales, type CoverageStatus, type DailyRaw } from "@/lib/sales-reports-shared";
import { laborWeekViews, canSeePersonCost as laborCanSeePersonCost, type LaborCostRow } from "@/lib/facts/labor-cost-shared";
import { LABOR_BUILDER_VERSION, LABOR_HISTORY_FLOOR_DAY, LABOR_TARGET_HOURLY_PCT, LABOR_TARGET_LOADED_PCT } from "@/lib/facts/labor-config-shared";
import { laborTone, type LaborTone } from "@/lib/scheduling/board-shared";
import type { RoleCode } from "@/lib/roles";

/** The widest range one request reads (plan finding 7: with or without rollups). */
export const BUSINESS_REPORT_MAX_DAYS = 92;
/** The 15-minute grid is returned only for ranges this short (plan finding 7: <= 31 days per response). */
export const BUSINESS_QUARTER_MAX_DAYS = 31;
/** No fact (orders or labor) exists before this business date; "same days last year" waits for it. */
export const BUSINESS_HISTORY_FLOOR = LABOR_HISTORY_FLOOR_DAY;
/** Juan's default: Toast checks over $5,000 are included in every total and flagged beside it. */
export const LARGE_CHECK_CENTS = 500_000;

// ── Switch and access ───────────────────────────────────────────────────────────────────────────

export interface BusinessReportEnv { BUSINESS_REPORT?: string; FACT_LAYER?: string; FACT_LAYER_LABOR?: string }
/** Dark unless all three are exactly "1" (plan finding 3: BUSINESS_REPORT, FACT_LAYER, FACT_LAYER_LABOR). */
export function businessReportEnabled(env: BusinessReportEnv): boolean {
  return env.BUSINESS_REPORT === "1" && env.FACT_LAYER === "1" && env.FACT_LAYER_LABOR === "1";
}

const READ_ROLES: ReadonlySet<RoleCode> = new Set<RoleCode>(["gm", "moo", "owner", "cgs"]);
/** GM+ by ROLE (the Sales floor, SALES_READ_MIN = 7). Every level-6 role (AGM, SMM, prep, catering) and
 * below is refused the whole report: there is no AGM payload. */
export function businessReportRefusal(role: RoleCode): "role_insufficient" | null {
  return READ_ROLES.has(role) ? null : "role_insufficient";
}
/** $ per person: decided by THE shared labor policy constant (PERSON_COST_MIN), never here. */
export const canSeePersonCost = laborCanSeePersonCost;

// ── Range ───────────────────────────────────────────────────────────────────────────────────────

export const BUSINESS_RANGES = ["yesterday", "last7", "last30", "last90", "custom"] as const;
export interface BusinessRange {
  range: (typeof BUSINESS_RANGES)[number];
  from: string; to: string; days: number;
  /** A custom request was clipped to BUSINESS_REPORT_MAX_DAYS. */
  shortened: boolean;
  /** No finished business day in the request. */
  empty: boolean;
  previous: { from: string; to: string };
  /** The same calendar days a year earlier, or null with a reason (no fact exists before the floor). */
  lastYear: { from: string; to: string } | null;
  lastYearReason: "no_data_yet" | null;
}

function minusYear(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}
export function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Finished business days only (today stays on Pulse). Default: the seven days ending yesterday. */
export function resolveBusinessRange(p: Record<string, string | undefined>, today: string): BusinessRange {
  const yesterday = shiftReportDate(today, -1);
  const range = (BUSINESS_RANGES as readonly string[]).includes(p.range ?? "") ? p.range as BusinessRange["range"]
    : p.from || p.to ? "custom" : "last7";
  let from = shiftReportDate(yesterday, -6);
  let to = yesterday;
  if (range === "yesterday") from = yesterday;
  else if (range === "last30") from = shiftReportDate(yesterday, -29);
  else if (range === "last90") from = shiftReportDate(yesterday, -89);
  else if (range === "custom") {
    if (validReportDate(p.to)) to = p.to;
    if (validReportDate(p.from)) from = p.from;
  }
  if (to > yesterday) to = yesterday;
  let shortened = false;
  const floor = shiftReportDate(to, -(BUSINESS_REPORT_MAX_DAYS - 1));
  if (from < floor) { from = floor; shortened = range === "custom"; }
  const empty = from > to;
  if (empty) from = to;
  const days = empty ? 0 : inclusiveDays(from, to);
  const previous = { from: shiftReportDate(from, -Math.max(days, 1)), to: shiftReportDate(from, -1) };
  const ly = { from: minusYear(from), to: minusYear(to) };
  const lastYear = ly.from >= BUSINESS_HISTORY_FLOOR ? ly : null;
  return { range, from, to, days, shortened, empty, previous, lastYear, lastYearReason: lastYear ? null : "no_data_yet" };
}

/** Days [from, to], oldest first. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftReportDate(d, 1)) out.push(d);
  return out;
}

// ── Day money (the Sales report's own) ──────────────────────────────────────────────────────────

export interface DaySales {
  date: string;
  coverage: CoverageStatus;
  checks: number;
  /** Toast check totals of `sale` checks, before refunds (the Sales report's legacy basis). */
  toastChecksCents: number;
  toastAmountMissing: number;
  /** The Sales report's exact Toast net (gross - discounts/comps - voids - sales refunds); null when unknown. */
  toastNetCents: number | null;
  ezcaterCents: number;
  ezcaterOrders: number;
  ezcaterMissing: number;
  refundCents: number;
  /** Sales before refunds = Toast check totals + ezCater (Sales' totalCents). */
  totalCents: number;
  giftCardCents: number;
  ezcaterLinkedCents: number;
}

/** Per business day, exactly summarizeSales' day buckets (parity by construction) plus ezCater's own
 * missing count (the Sales total folds it into amountMissing). A day with no row is `missing`, never $0. */
export function daySalesFrom(raws: readonly DailyRaw[], from: string, to: string): DaySales[] {
  if (from > to) return [];
  const ezMissing = new Map<string, number>();
  for (const r of raws) for (const e of r.ezcater ?? []) ezMissing.set(e.business_date, (ezMissing.get(e.business_date) ?? 0) + Number(e.amount_missing ?? 0));
  return summarizeSales(raws, from, to, "day").buckets.map((b) => {
    const ez = ezMissing.get(b.from) ?? 0;
    return {
      date: b.from, coverage: b.coverage, checks: b.checks, toastChecksCents: b.toastChecksCents, toastAmountMissing: b.amountMissing - ez,
      toastNetCents: b.toastNetCents, ezcaterCents: b.ezcaterCents, ezcaterOrders: b.ezcaterOrders, ezcaterMissing: ez,
      refundCents: b.refundCents, totalCents: b.totalCents, giftCardCents: b.giftCardCents, ezcaterLinkedCents: b.ezcaterLinkedCents,
    };
  });
}

/** All shops: raw cents and counts summed per date first; a date is complete only when every shop's is. */
export function combineShopDays(shops: readonly (readonly DaySales[])[]): DaySales[] {
  const byDate = new Map<string, DaySales[]>();
  for (const s of shops) for (const d of s) (byDate.get(d.date) ?? byDate.set(d.date, []).get(d.date)!).push(d);
  return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, ds]) => {
    const sum = (k: keyof DaySales) => ds.reduce((s, d) => s + (d[k] as number), 0);
    const coverage: CoverageStatus = ds.length === shops.length && ds.every((d) => d.coverage === "complete") ? "complete"
      : ds.some((d) => d.coverage !== "missing") ? "partial" : "missing";
    return {
      date, coverage, checks: sum("checks"), toastChecksCents: sum("toastChecksCents"), toastAmountMissing: sum("toastAmountMissing"),
      toastNetCents: ds.length === shops.length && ds.every((d) => d.toastNetCents !== null) ? ds.reduce((s, d) => s + d.toastNetCents!, 0) : null,
      ezcaterCents: sum("ezcaterCents"), ezcaterOrders: sum("ezcaterOrders"), ezcaterMissing: sum("ezcaterMissing"),
      refundCents: sum("refundCents"), totalCents: sum("totalCents"), giftCardCents: sum("giftCardCents"), ezcaterLinkedCents: sum("ezcaterLinkedCents"),
    };
  });
}

// ── P1: the labor denominator ───────────────────────────────────────────────────────────────────

export type DenominatorState = "ok" | "sales_not_covered" | "net_unknown" | "ezcater_missing" | "zero_sales";
export interface Denominator { cents: number | null; state: DenominatorState }

/** NET SALES of one day = Sales' Toast net + ezCater subtotal (linked Toast rings excluded upstream). */
export function laborNetSales(d: Pick<DaySales, "coverage" | "toastNetCents" | "ezcaterCents" | "ezcaterMissing">): Denominator {
  if (d.coverage !== "complete") return { cents: null, state: "sales_not_covered" };
  if (d.toastNetCents === null) return { cents: null, state: "net_unknown" };
  if (d.ezcaterMissing > 0) return { cents: null, state: "ezcater_missing" };
  const cents = d.toastNetCents + d.ezcaterCents;
  return cents > 0 ? { cents, state: "ok" } : { cents: null, state: "zero_sales" };
}
/** A week or range: every day's net must be known; the raw cents are summed, then judged once. */
export function sumNetSales(days: readonly DaySales[]): Denominator {
  let cents = 0;
  for (const d of days) {
    const n = laborNetSales(d);
    if (n.state !== "ok" && n.state !== "zero_sales") return n;
    // A zero (or refund-negative) day still adds its exact net: the range is judged once, on the sum.
    cents += d.toastNetCents! + d.ezcaterCents;
  }
  return cents > 0 ? { cents, state: "ok" } : { cents: null, state: "zero_sales" };
}

// ── P2: the overtime gate ───────────────────────────────────────────────────────────────────────

export type LaborWeekState = "ready" | "rebuilding" | "unbuilt";
export interface LaborWeekCoverageRow { ot_scope: string; builder_version: string }
/** Ready only when the week was built per shop (0339) by the current builder. */
export function laborWeekState(row: LaborWeekCoverageRow | undefined, builderVersion = LABOR_BUILDER_VERSION): LaborWeekState {
  if (!row) return "unbuilt";
  return row.ot_scope === "per_shop" && row.builder_version === builderVersion ? "ready" : "rebuilding";
}

/** One week's coverage row with the generation token every rebuild changes (`fact_replace_labor_week`
 *  writes `built_at = clock_timestamp()` and the fingerprint in the same transaction as the labor rows). */
export interface LaborWeekGenerationRow extends LaborWeekCoverageRow {
  week_start: string; built_at?: string | null; source_fingerprint?: string | null;
}
const generationKey = (r: LaborWeekGenerationRow) =>
  JSON.stringify([r.ot_scope, r.builder_version, r.built_at ? new Date(r.built_at).toISOString() : null, r.source_fingerprint ?? null]);

/**
 * Fix round 3 (P2): the labor reads (costs, quarters, people) are separate requests, each its own snapshot, so a
 * rebuild may commit between them. Coverage is read BEFORE any labor read starts and AGAIN after every one has
 * answered; every rebuild commits its rows and its coverage row together, so a week whose generation is the same
 * in both reads was not rebuilt while its rows were read. Any week that differs (rebuilt, first built, or gone) is
 * marked `rebuilding`: its minutes stay, its money and % are withheld until a fresh load.
 */
export function stableWeekCoverage(before: readonly LaborWeekGenerationRow[], after: readonly LaborWeekGenerationRow[]): Map<string, LaborWeekCoverageRow> {
  const day = (v: string) => String(v).slice(0, 10);
  const b = new Map(before.map((r) => [day(r.week_start), r]));
  const a = new Map(after.map((r) => [day(r.week_start), r]));
  const out = new Map<string, LaborWeekCoverageRow>();
  for (const w of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(w), y = a.get(w);
    out.set(w, x && y && generationKey(x) === generationKey(y)
      ? { ot_scope: y.ot_scope, builder_version: y.builder_version }
      : { ot_scope: "moved_during_read", builder_version: "moved_during_read" });
  }
  return out;
}
/** The payroll week (Sunday 00:00 ET calendar) a business date falls in. */
export function payrollWeekStart(date: string): string {
  return shiftReportDate(date, -new Date(`${date}T00:00:00Z`).getUTCDay());
}

// ── Labor figures ───────────────────────────────────────────────────────────────────────────────

export type LaborState = "ok" | "rebuilding" | "unbuilt" | "before_history" | "hours_unknown" | DenominatorState;
/** Item 9b: why a FULLY LOADED figure is missing. `salary_incomplete` = 0340's payroll-shop gap (salaries not set
 * up yet); `salary_unknown` = no salary known at all (no shop estimate, no 7shifts salaries). Otherwise the pure
 * hourly state (a blocked week, unknown hours, an unknown denominator) withholds it too. */
export type LoadedState = LaborState | "salary_incomplete" | "salary_unknown";
export interface LaborFigures {
  state: LaborState;
  /** Worked minutes (hourly + salaried presence): independent of the overtime scope, always shown when built. */
  minutes: number | null;
  /** Pure hourly = straight + overtime premium; null while the week is not ready. */
  pureHourlyCents: number | null;
  otPremiumCents: number | null;
  otMinutes: number | null;
  denominator: Denominator;
  pct: number | null;
  tone: LaborTone;
  /** Item 9b, FULLY LOADED (Juan 2026-11-16/18): pure hourly + salaried + burden, over the same net sales
   * (target <= 28%). Priced by THE shared pricer (laborWeekViews); null with `loadedState` saying why. */
  loadedState: LoadedState;
  salariedCents: number | null;
  burdenCents: number | null;
  fullyLoadedCents: number | null;
  loadedPct: number | null;
  loadedTone: LaborTone;
  /** The 12% default burden (no payroll figure yet): always labelled "estimated". */
  burdenEstimated: boolean;
  /** A salary came from the shop's estimate, not 7shifts wages. */
  salaryEstimated: boolean;
  /** 0340 payroll-shop gaps behind the figures (unplaced + missing wage), shown beside any figure. */
  salaryGaps: number;
}
const round1 = (x: number) => Math.round(x * 10) / 10;

type ViewWithOt = ReturnType<typeof laborWeekViews>[number] & { otMinutes: number; salaryEstimated: boolean };
type Target = number | "target_varies";
const NO_LOADED = { salariedCents: null, burdenCents: null, fullyLoadedCents: null, loadedPct: null, loadedTone: "none" as LaborTone };
function withheld(state: LaborState, minutes: number | null, denominator: Denominator): LaborFigures {
  return { state, minutes, pureHourlyCents: null, otPremiumCents: null, otMinutes: null, denominator, pct: null, tone: "none",
    loadedState: state, ...NO_LOADED, burdenEstimated: false, salaryEstimated: false, salaryGaps: 0 };
}
function figures(views: readonly ViewWithOt[], weekStates: readonly LaborWeekState[], minutes: number | null,
  denominator: Denominator, target: { hourly: Target; loaded: Target }): LaborFigures {
  const blocked = weekStates.find((s) => s !== "ready");
  if (blocked) return withheld(blocked, minutes, denominator);
  const pure = views.reduce((s, v) => s + v.pureHourlyCents, 0);
  const prem = views.reduce((s, v) => s + v.otPremiumCents, 0);
  const otMinutes = views.reduce((s, v) => s + v.otMinutes, 0);
  const known = views.length > 0 && views.every((v) => v.hoursKnown);
  const state: LaborState = !known ? "hours_unknown" : denominator.state;
  const pctOf = (c: number) => (state === "ok" && denominator.cents !== null && denominator.cents > 0 ? round1((100 * c) / denominator.cents) : null);
  const toneOf = (p: number | null, t: Target) => (p === null || t === "target_varies" ? "none" as const : laborTone(p, t));
  const pct = pctOf(pure);
  const flags = {
    burdenEstimated: views.some((v) => v.burdenEstimated), salaryEstimated: views.some((v) => v.salaryEstimated),
    salaryGaps: views.reduce((s, v) => s + v.salaryGaps, 0),
  };
  const base = { state, minutes, pureHourlyCents: pure, otPremiumCents: prem, otMinutes, denominator, pct, tone: toneOf(pct, target.hourly), ...flags };
  // Any week with an unknown salary leaves the whole span's fully loaded unknown (never a partial sum).
  if (views.length === 0 || views.some((v) => v.fullyLoadedCents === null)) {
    return { ...base, loadedState: views.some((v) => v.salaryIncomplete) ? "salary_incomplete" : "salary_unknown", ...NO_LOADED };
  }
  const salaried = views.reduce((s, v) => s + v.salariedCents!, 0);
  const burden = views.reduce((s, v) => s + v.burdenCents!, 0);
  const loaded = views.reduce((s, v) => s + v.fullyLoadedCents!, 0);
  const loadedPct = pctOf(loaded);
  return { ...base, loadedState: state, salariedCents: salaried, burdenCents: burden, fullyLoadedCents: loaded, loadedPct, loadedTone: toneOf(loadedPct, target.loaded) };
}
function views(rows: readonly LaborCostRow[]): ViewWithOt[] {
  return rows.map((r) => ({ ...laborWeekViews([r])[0]!, otMinutes: Number(r.ot_minutes), salaryEstimated: r.salary_basis === "estimate" }));
}
const rowMinutes = (rows: readonly LaborCostRow[]) => rows.reduce((s, r) => s + Number(r.hourly_minutes) + Number(r.salaried_minutes), 0);

/** One day: its fact_labor_cost(day, day) row against its own net sales. */
export function laborDayFigures(day: DaySales, row: LaborCostRow | null, week: LaborWeekCoverageRow | undefined,
  target: Target = LABOR_TARGET_HOURLY_PCT, loadedTarget: Target = LABOR_TARGET_LOADED_PCT): LaborFigures {
  const denominator = laborNetSales(day);
  if (day.date < BUSINESS_HISTORY_FLOOR) return withheld("before_history", null, denominator);
  if (!row) return withheld("unbuilt", null, denominator);
  const state = row.ot_state === "unbuilt" ? "unbuilt" as const : laborWeekState(week);
  return figures(views([row]), [state], rowMinutes([row]), denominator, { hourly: target, loaded: loadedTarget });
}
/** A week or a whole range: the weeks' fact_labor_cost rows (raw cents summed first) over the days' net. */
export function laborRangeFigures(days: readonly DaySales[], rows: readonly LaborCostRow[], weeks: ReadonlyMap<string, LaborWeekCoverageRow>,
  target: { hourly: Target; loaded?: Target }): LaborFigures {
  const denominator = sumNetSales(days);
  if (days.length === 0 || days[0]!.date < BUSINESS_HISTORY_FLOOR) return withheld("before_history", null, denominator);
  const weekStarts = [...new Set(days.map((d) => payrollWeekStart(d.date)))];
  const states = weekStarts.map((w) => {
    const r = rows.find((x) => x.week_start === w);
    return !r || r.ot_state === "unbuilt" ? "unbuilt" as const : laborWeekState(weeks.get(w));
  });
  return figures(views(rows), states, rows.length ? rowMinutes(rows) : null, denominator, { hourly: target.hourly, loaded: target.loaded ?? LABOR_TARGET_LOADED_PCT });
}

/** A 15-minute (or hour) cell: Toast-hour sales only, straight time, never toned (plan: tones at day/week).
 * Any check of unknown amount in the cell makes its sales unknown: no % (fix round 2), never a % over a partial sum. */
export interface QuarterInput { toastCents: number; checks: number; amountMissing?: number; laborMinutes: number | null; straightCents: number | null; salesOk: boolean; laborOk: boolean }
export function quarterFigures(q: QuarterInput): { pct: number | null; basis: "toast_only_straight_time"; tone: "none" } {
  const pct = q.salesOk && q.laborOk && (q.amountMissing ?? 0) === 0 && q.straightCents !== null && q.toastCents > 0
    ? round1((100 * q.straightCents) / q.toastCents) : null;
  return { pct, basis: "toast_only_straight_time", tone: "none" };
}

// ── Cuts (order facts) ──────────────────────────────────────────────────────────────────────────

export interface CutRow {
  business_date: string; quarter_start_at: string | null; wall_quarter: number | null; fold: number | null; et_date: string | null;
  channel: string; provider: string | null; server_guid: string | null; server_label: string | null; sale_class: string;
  checks: number; amount_cents: number; amount_missing: number; large_checks: number; large_cents: number;
}
type Num = number | string | null | undefined;
const num = (v: Num): number => {
  if (v === null || v === undefined || v === "") return 0;
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Error("business_amount_invalid");
  return x;
};
const ymd = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const intOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** A 0341 business_report_check_cuts row (PostgREST may send bigints as strings). */
export function toCutRow(r: Record<string, unknown>): CutRow {
  return {
    business_date: ymd(r.business_date)!, quarter_start_at: iso(r.quarter_start_at), wall_quarter: intOrNull(r.wall_quarter), fold: intOrNull(r.fold),
    et_date: ymd(r.et_date), channel: String(r.channel ?? "unknown"), provider: (r.provider as string | null) ?? null,
    server_guid: (r.server_guid as string | null) ?? null, server_label: (r.server_label as string | null) ?? null, sale_class: String(r.sale_class),
    checks: num(r.checks as Num), amount_cents: num(r.amount_cents as Num), amount_missing: num(r.amount_missing as Num),
    large_checks: num(r.large_checks as Num), large_cents: num(r.large_cents as Num),
  };
}
/** Window chunks are disjoint business dates: concatenation never double counts. */
export function mergeCuts(chunks: readonly (readonly CutRow[])[]): CutRow[] {
  return chunks.flat();
}

export type CutsState = "ok" | "rebuilding" | "sales_not_covered";
/** A day's cuts are shown only when its `sale` cuts carry exactly the Sales report's day (money, checks,
 * unknown amounts). Facts lag up to an hour: a day that differs is `rebuilding`, never a wrong number. */
export function recomposeDay(day: DaySales, cuts: readonly CutRow[]): { ok: boolean; reason: CutsState; cutCents: number; toastChecksCents: number } {
  const sale = cuts.filter((c) => c.sale_class === "sale");
  const cutCents = sale.reduce((s, c) => s + c.amount_cents, 0);
  const base = { cutCents, toastChecksCents: day.toastChecksCents };
  if (day.coverage !== "complete") return { ok: false, reason: "sales_not_covered", ...base };
  const same = cutCents === day.toastChecksCents && sale.reduce((s, c) => s + c.checks, 0) === day.checks
    && sale.reduce((s, c) => s + c.amount_missing, 0) === day.toastAmountMissing;
  return same ? { ok: true, reason: "ok", ...base } : { ok: false, reason: "rebuilding", ...base };
}

export interface CutTotal { key: string; label?: string | null; provider?: string | null; cents: number; checks: number; amountMissing?: number; unassigned?: boolean }
/** Channels: `sale` checks by channel/provider (included) and the named exclusions (gift cards, ezCater-linked). */
export function channelTotals(cuts: readonly CutRow[]): { included: CutTotal[]; excluded: CutTotal[] } {
  const inc = new Map<string, CutTotal>();
  const exc = new Map<string, CutTotal>();
  for (const c of cuts) {
    if (c.sale_class === "sale") {
      const k = `${c.channel}|${c.provider ?? ""}`;
      const t = inc.get(k) ?? inc.set(k, { key: c.channel, provider: c.provider, cents: 0, checks: 0, amountMissing: 0 }).get(k)!;
      t.cents += c.amount_cents; t.checks += c.checks; t.amountMissing! += c.amount_missing;
    } else if (c.sale_class === "gift_card" || c.sale_class === "ezcater_linked") {
      const t = exc.get(c.sale_class) ?? exc.set(c.sale_class, { key: c.sale_class, cents: 0, checks: 0 }).get(c.sale_class)!;
      t.cents += c.amount_cents; t.checks += c.checks;
    }
  }
  const order = (a: CutTotal, b: CutTotal) => b.cents - a.cents || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return { included: [...inc.values()].sort(order), excluded: [...exc.values()].sort(order) };
}
/** Sales per server (the ORDER's server, Juan): `sale` checks only; no server = the unassigned row (key ""). */
export function serverTotals(cuts: readonly CutRow[]): CutTotal[] {
  const out = new Map<string, CutTotal>();
  for (const c of cuts) {
    if (c.sale_class !== "sale") continue;
    const k = c.server_guid ?? "";
    const t = out.get(k) ?? out.set(k, { key: k, label: null, cents: 0, checks: 0, amountMissing: 0, unassigned: k === "" }).get(k)!;
    if (!t.label && c.server_label) t.label = c.server_label;
    t.cents += c.amount_cents; t.checks += c.checks; t.amountMissing! += c.amount_missing;
  }
  return [...out.values()].sort((a, b) => b.cents - a.cents || (a.key < b.key ? -1 : 1));
}
/** Checks over $5,000 (counted inside every total, listed beside it). */
export function largeCheckTotals(cuts: readonly CutRow[]): { checks: number; cents: number } {
  return cuts.filter((c) => c.sale_class === "sale").reduce((s, c) => ({ checks: s.checks + c.large_checks, cents: s.cents + c.large_cents }), { checks: 0, cents: 0 });
}

// ── P2: rush detection (placed time) ────────────────────────────────────────────────────────────

export const RUSH_MULTIPLIER = 1.5;
export const RUSH_HISTORY_WEEKS = 8;
/** Fewer covered same weekdays than this = "not enough history". */
export const RUSH_MIN_HISTORY = 4;
export const RUSH_MIN_RUN_QUARTERS = 2;
/** A quarter needs at least this many checks to be part of a rush (a stated minimum, shown on the page). */
export const RUSH_MIN_CHECKS = 3;
/** The baseline must be real: at least this many median checks AND median sales > 0. */
export const RUSH_MIN_BASELINE_CHECKS = 1;

/** `amountMissing` = checks of unknown amount in the quarter (absent = 0): such a quarter's sales are unknown. */
export interface QuarterPoint { quarterStartAt: string; wallQuarter: number; fold: number; checks: number; cents: number; amountMissing?: number }
export interface RushWindow { startAt: string; endAt: string; quarters: number; checks: number; cents: number; baselineChecks: number; baselineCents: number }
export interface RushResult { state: "ok" | "not_enough_history"; windows: RushWindow[] }

const QUARTER_MS = 15 * 60_000;
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
/** Rushes of one day against the last 8 COVERED same weekdays (the caller passes only covered days and
 * leaves out catering-channel checks and ezCater). The baseline of a quarter is the median over those
 * days at the same ET wall quarter and fold (a day with no check there counts as 0). */
export function detectRushes(day: { date: string; quarters: readonly QuarterPoint[] },
  history: ReadonlyArray<{ date: string; quarters: readonly QuarterPoint[] }>): RushResult {
  const hist = [...history].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, RUSH_HISTORY_WEEKS);
  if (hist.length < RUSH_MIN_HISTORY) return { state: "not_enough_history", windows: [] };
  const key = (q: { wallQuarter: number; fold: number }) => `${q.wallQuarter}|${q.fold}`;
  const hot: Array<QuarterPoint & { bChecks: number; bCents: number }> = [];
  for (const q of day.quarters) {
    // Fix round 2: a quarter whose sales are unknown (today, or at the same quarter on any baseline day) is never compared.
    if ((q.amountMissing ?? 0) > 0) continue;
    const at = hist.map((h) => h.quarters.find((x) => key(x) === key(q)));
    if (at.some((x) => (x?.amountMissing ?? 0) > 0)) continue;
    const bChecks = median(at.map((x) => x?.checks ?? 0));
    const bCents = median(at.map((x) => x?.cents ?? 0));
    const qualifies = bChecks >= RUSH_MIN_BASELINE_CHECKS && bCents > 0
      && q.checks >= RUSH_MIN_CHECKS && q.cents > 0 && q.cents >= RUSH_MULTIPLIER * bCents;
    if (qualifies) hot.push({ ...q, bChecks, bCents });
  }
  hot.sort((a, b) => Date.parse(a.quarterStartAt) - Date.parse(b.quarterStartAt));
  const windows: RushWindow[] = [];
  let run: typeof hot = [];
  const flush = () => {
    if (run.length >= RUSH_MIN_RUN_QUARTERS) {
      windows.push({
        startAt: new Date(Date.parse(run[0]!.quarterStartAt)).toISOString(),
        endAt: new Date(Date.parse(run[run.length - 1]!.quarterStartAt) + QUARTER_MS).toISOString(),
        quarters: run.length, checks: run.reduce((s, q) => s + q.checks, 0), cents: run.reduce((s, q) => s + q.cents, 0),
        baselineChecks: run.reduce((s, q) => s + q.bChecks, 0), baselineCents: run.reduce((s, q) => s + q.bCents, 0),
      });
    }
    run = [];
  };
  for (const q of hot) {
    const prev = run[run.length - 1];
    if (prev && Date.parse(q.quarterStartAt) - Date.parse(prev.quarterStartAt) !== QUARTER_MS) flush();
    run.push(q);
  }
  flush();
  return { state: "ok", windows };
}

/** Every label a business-report reader shows (en + es tú, pinned by tests/business-report-i18n.test.ts). No page
 * ships in 9a; these exist so 9b is born translated. Every refusal code and every labor state has its line. */
export const BUSINESS_REPORT_I18N_KEYS = [
  "reports.business.error.business_report_unavailable", "reports.business.error.role_insufficient", "reports.business.error.location_forbidden",
  "reports.business.error.business_reads_not_installed", "reports.business.error.business_reads_timeout", "reports.business.error.business_reads_incomplete",
  "reports.business.quarter.unassigned",
  "reports.business.labor.state.rebuilding", "reports.business.labor.state.unbuilt", "reports.business.labor.state.before_history",
  "reports.business.labor.state.hours_unknown", "reports.business.labor.state.sales_not_covered", "reports.business.labor.state.net_unknown",
  "reports.business.labor.state.ezcater_missing", "reports.business.labor.state.zero_sales",
  "reports.business.labor.denominator", "reports.business.quarter.basis", "reports.business.cuts.rebuilding", "reports.business.large_checks",
  "reports.business.rush.not_enough_history", "reports.business.rush.rule", "reports.business.last_year.no_data_yet",
] as const;
