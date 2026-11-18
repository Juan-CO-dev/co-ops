/**
 * BOARD TWO LABOR VIEWS, PR 1: the projection's LOADER (server-only; the pure rules are labor-projection-shared.ts).
 * Dark behind SCHEDULE_LABOR_VIEWS (with FACT_LAYER and FACT_LAYER_LABOR); called by `loadBoard` only for a viewer
 * who may see shop labor money (GM own shop, MoO+), so an AGM's board makes no labor read and carries no key.
 *
 * Reads, in this order (the labor reads are bracketed by the shared gate, like the business report's):
 *   1. labor_week_coverage of the board's two payroll weeks (BEFORE);
 *   2. this shop's labor_day_coverage, labor_quarter and labor_week_salaried rows of those weeks;
 *   3. labor_week_coverage again + fact_labor_week_fingerprint -> currentWeekCoverage: which weeks are `ready`;
 *      the previous board week's shift times (its Sunday starts the main payroll week);
 *   4. fact_labor_week_source of each payroll week that holds a planned day (wages, links, payroll shops: the
 *      builder's own global universe; only this shop's rows leave the pure planner);
 *   5. fact_labor_cost_planned (0345) per board day and per strip line, and the Sales report's days for the
 *      settled dates (the actual denominator);
 *   6. labor_week_coverage + the fingerprints once more (AFTER): a week that was `ready` and no longer is means
 *      the rows above came from two generations, so the whole view answers `rebuilding`.
 * Fix r1 (P2-1): the same week states gate the STORED salaried row a projection is priced from. A week that is not
 * `ready` (its source moved: a payroll-shop reassignment, a salary change) has its stored salary withheld
 * (`salary_rebuilding`: no salary, no burden, no fully loaded) until the builder's next pass.
 * It never throws into the board: 0345 not applied = `not_installed`, any other failed read = `unavailable`.
 * No write, no email, no notification. No wage rate and nothing per person is returned.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  currentWeekCoverage, daySalesFrom, laborWeekState, payrollWeekStart, type DaySales, type LaborWeekGenerationRow, type LaborWeekState,
} from "@/lib/business-report-shared";
import type { WageFallback } from "@/lib/facts/labor-config-shared";
import { toLaborCostRow, type LaborCostRow, type LaborTargets } from "@/lib/facts/labor-cost-shared";
import { readCurrentWeekFingerprints } from "@/lib/facts/labor-week-gate";
import { laborWeekSourceFromJson, type LaborWeekSource } from "@/lib/facts/labor-week-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import type { DailyRaw } from "@/lib/sales-reports-shared";
import { selectAllRows } from "@/lib/supabase-paginate";
import {
  buildLaborPlan, classifyLaborDays, hoursOnlyFigure, laborFigure, planForRange, untonedPartialWeek,
  type BoardLaborDay, type BoardLaborStripPart, type BoardLaborViews, type DayCoverageRow, type FactQuarter, type PlanShift,
} from "./labor-projection-shared";
import { addDays } from "./time-shared";

/** A labor read failed; `notInstalled` = the function or table does not exist yet (0345 / the fact layer). */
export class LaborViewsReadError extends Error {
  constructor(public notInstalled: boolean) {
    super(notInstalled ? "labor_views_not_installed" : "labor_views_read_failed");
    this.name = "LaborViewsReadError";
  }
}
const MISSING = new Set(["PGRST202", "PGRST205", "42883", "42P01", "42703"]);
const fail = (e: { code?: string } | null | undefined): never => { throw new LaborViewsReadError(!!e?.code && MISSING.has(e.code)); };

/** Every labor / sales read the projection makes (injected in tests; `supabaseLaborReads` in production). */
export interface LaborProjectionReads {
  weekCoverage(weekStarts: readonly string[]): Promise<LaborWeekGenerationRow[]>;
  weekFingerprints(weekStarts: readonly string[]): Promise<Map<string, string | null>>;
  dayCoverage(locationId: string, from: string, to: string): Promise<DayCoverageRow[]>;
  quarters(locationId: string, weekStarts: readonly string[]): Promise<FactQuarter[]>;
  /** the payroll weeks that have a stored labor_week_salaried row for this shop */
  salariedWeeks(locationId: string, weekStarts: readonly string[]): Promise<string[]>;
  weekSource(weekStart: string): Promise<LaborWeekSource>;
  cost(args: { locationId: string; from: string; to: string; wageFallback: WageFallback; plan: Record<string, unknown> | null }): Promise<LaborCostRow[]>;
  salesDaily(locationId: string, from: string, to: string): Promise<DailyRaw>;
}

const ymd = (v: unknown) => String(v).slice(0, 10);

export function supabaseLaborReads(service: SupabaseClient): LaborProjectionReads {
  const table = async <T>(build: (f: number, t: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>): Promise<T[]> => {
    let failed: { code?: string } | null = null;
    try {
      return await selectAllRows<T>(async (f, t) => { const r = await build(f, t); if (r.error) { failed = r.error; throw new Error("read"); } return { data: r.data }; });
    } catch {
      return fail(failed);
    }
  };
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    let r: { data: unknown; error: { code?: string } | null };
    try { r = await service.rpc(fn, args); } catch { return fail(null); }
    if (r.error) return fail(r.error);
    return r.data as T;
  };
  return {
    weekCoverage: (weeks) => table<LaborWeekGenerationRow>((f, t) => service.from("labor_week_coverage")
      .select("week_start,ot_scope,builder_version,built_at,source_fingerprint").in("week_start", [...weeks]).order("week_start", { ascending: true }).range(f, t)),
    weekFingerprints: (weeks) => readCurrentWeekFingerprints(service, weeks),
    dayCoverage: (locationId, from, to) => table<DayCoverageRow>((f, t) => service.from("labor_day_coverage")
      .select("business_date,state,open_punches").eq("location_id", locationId).gte("business_date", from).lte("business_date", to)
      .order("business_date", { ascending: true }).range(f, t)),
    quarters: (locationId, weeks) => table<FactQuarter>((f, t) => service.from("labor_quarter")
      .select("business_date,quarter_start_at,person_key,minutes,ot_minutes,pay_class").eq("location_id", locationId).in("week_start", [...weeks])
      .order("quarter_start_at", { ascending: true }).order("person_key", { ascending: true }).order("source", { ascending: true }).order("role_key", { ascending: true }).range(f, t)),
    salariedWeeks: async (locationId, weeks) => (await table<{ week_start: string }>((f, t) => service.from("labor_week_salaried")
      .select("week_start").eq("location_id", locationId).in("week_start", [...weeks]).order("week_start", { ascending: true }).range(f, t))).map((r) => ymd(r.week_start)),
    weekSource: async (weekStart) => {
      const j = await rpc<Record<string, unknown> | null>("fact_labor_week_source", { p_week_start: weekStart, p_builder_version: LABOR_BUILDER_VERSION });
      if (j === null || typeof j !== "object") return fail(null);
      try { return laborWeekSourceFromJson(j).source; } catch { return fail(null); }
    },
    cost: async (a) => {
      const rows = await rpc<Record<string, unknown>[] | null>("fact_labor_cost_planned",
        { p_location_id: a.locationId, p_from: a.from, p_to: a.to, p_wage_fallback: a.wageFallback, p_plan: a.plan });
      if (!Array.isArray(rows)) return fail(null);
      return rows.map(toLaborCostRow);
    },
    salesDaily: async (locationId, from, to) => {
      const raw = await rpc<DailyRaw | null>("sales_report_daily", { p_location_id: locationId, p_from: from, p_to: to });
      if (raw === null || typeof raw !== "object") return fail(null);
      return raw;
    },
  };
}

/** The shift TIMES of a board week's head (the plan needs nothing else); null = that week has no schedule. */
export async function loadHeadShiftTimes(service: SupabaseClient, locationId: string, weekStart: string): Promise<PlanShift[] | null> {
  const weeks = await selectAllRows<{ head_revision_id: string | null }>((f, t) => service.from("schedule_weeks").select("head_revision_id")
    .eq("location_id", locationId).eq("week_start", weekStart).order("id", { ascending: true }).range(f, t));
  const head = weeks[0]?.head_revision_id ?? null;
  if (!head) return null;
  const rows = await selectAllRows<{ user_id: string; business_date: string; start_q: number; end_q: number }>((f, t) => service.from("schedule_revision_shifts")
    .select("user_id, business_date, start_q, end_q").eq("revision_id", head)
    .order("business_date", { ascending: true }).order("user_id", { ascending: true }).order("start_q", { ascending: true }).range(f, t));
  return rows.map((r) => ({ userId: r.user_id, date: r.business_date, startQ: r.start_q, endQ: r.end_q }));
}

/** At most this many fact_labor_cost_planned calls in flight (a board asks for nine). */
const COST_CONCURRENCY = 4;
async function mapBounded<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(COST_CONCURRENCY, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); }
  }));
  return out;
}

export interface BoardLaborArgs {
  reads: LaborProjectionReads;
  locationId: string;
  /** ET business date of the load */
  today: string;
  /** the board week, Mon..Sun */
  boardDates: readonly string[];
  /** the board week's shift times (null = no schedule) */
  shifts: readonly PlanShift[] | null;
  /** the previous board week's shift times (null = no schedule), read only when the projection runs */
  loadPrevShifts: () => Promise<PlanShift[] | null>;
  /** the scheduling forecast per board date (the heads budget's own): cents, or null when there is none */
  forecastCentsByDate: Readonly<Record<string, number | null>>;
  targets: LaborTargets;
  wageFallback: WageFallback;
}

export async function loadBoardLaborViews(args: BoardLaborArgs): Promise<BoardLaborViews> {
  try {
    return await project(args);
  } catch (e) {
    if (e instanceof LaborViewsReadError && e.notInstalled) return { state: "not_installed" };
    // Fixed code only: never a message, an argument or a payload.
    console.error("schedule_labor_views_unavailable");
    return { state: "unavailable" };
  }
}

async function project(a: BoardLaborArgs): Promise<BoardLaborViews> {
  const { reads, locationId, boardDates } = a;
  const from = boardDates[0]!, to = boardDates[boardDates.length - 1]!;
  const priorSunday = addDays(from, -1);
  const weeks = [...new Set([payrollWeekStart(priorSunday), payrollWeekStart(to)])].sort();
  const statesOf = async (before: readonly LaborWeekGenerationRow[]): Promise<Map<string, LaborWeekState>> => {
    const after = await reads.weekCoverage(weeks);
    const gate = currentWeekCoverage(before, after, await reads.weekFingerprints(after.map((r) => ymd(r.week_start))));
    return new Map(weeks.map((w) => [w, laborWeekState(gate.get(w))]));
  };

  const before = await reads.weekCoverage(weeks);
  const [dayCoverage, quarters, storedSalaried] = await Promise.all([
    reads.dayCoverage(locationId, priorSunday, to), reads.quarters(locationId, weeks), reads.salariedWeeks(locationId, weeks),
  ]);
  const weekStates = await statesOf(before);
  const prevShifts = a.shifts === null ? null : await a.loadPrevShifts();
  const classification = classifyLaborDays({ today: a.today, boardDates, hasHead: a.shifts !== null, hasPrevHead: prevShifts !== null, dayCoverage, weekStates });
  const sources = new Map(await Promise.all(classification.planWeeks.map(async (w) => [w, await reads.weekSource(w)] as const)));
  const built = buildLaborPlan({ locationId, boardDates, classification, shifts: a.shifts, prevShifts, quarters, sources, storedSalariedWeeks: new Set(storedSalaried), weekStates });

  const kind = (d: string) => classification.kinds[d]!;
  const actual = boardDates.filter((d) => kind(d) === "actual");
  const projected = boardDates.filter((d) => kind(d) === "projected");
  const cost = (f: string, t: string, only?: readonly string[]) =>
    reads.cost({ locationId, from: f, to: t, wageFallback: a.wageFallback, plan: planForRange(built.plan, f, t, only) });

  // The actual denominator: the Sales report's own days, for the settled dates only.
  let sales = new Map<string, DaySales>();
  if (actual.length) {
    const first = actual[0]!, last = actual[actual.length - 1]!;
    sales = new Map(daySalesFrom([await reads.salesDaily(locationId, first, last)], first, last).map((s) => [s.date, s]));
  }
  const salesOf = (dates: readonly string[]) => dates.map((d) => sales.get(d)).filter((s): s is DaySales => !!s);
  const forecastOf = (dates: readonly string[]) => dates.map((d) => a.forecastCentsByDate[d] ?? null);
  const figure = (rows: LaborCostRow[], dates: readonly string[], basis: "actual" | "forecast") => laborFigure({
    rows, dates, basis, targets: a.targets, built, ...(basis === "actual" ? { sales: salesOf(dates) } : { forecast: forecastOf(dates) }),
  });

  const days = await mapBounded(boardDates, async (date): Promise<BoardLaborDay> => {
    const k = kind(date);
    if (k === "no_schedule") return { date, kind: k, ...hoursOnlyFigure(k, null) };
    // A not-settled day with a schedule shows its scheduled hours; without one, the hours recorded so far.
    if (k === "not_settled" && classification.mask.includes(date)) return { date, kind: k, ...hoursOnlyFigure(k, built.scheduledMinutesByDate[date] ?? 0) };
    const rows = await cost(date, date);
    if (k === "not_settled") return { date, kind: k, ...hoursOnlyFigure(k, rows.reduce((s, r) => s + Number(r.hourly_minutes) + Number(r.salaried_minutes), 0)) };
    return { date, kind: k, ...figure(rows, [date], k === "actual" ? "actual" : "forecast") };
  });
  // The strip: the pricer's own answer for each population of the week (never days summed, never blended).
  const stripPart = async (dates: readonly string[], basis: "actual" | "forecast"): Promise<BoardLaborStripPart | null> => {
    if (dates.length === 0) return null;
    const f = figure(await cost(from, to, dates), dates, basis);
    return basis === "actual" ? untonedPartialWeek(f, dates.length) : { ...f, days: dates.length };
  };
  const [stripActual, stripProjected] = await Promise.all([stripPart(actual, "actual"), stripPart(projected, "forecast")]);

  // The closing bracket: a week that was ready when the days were classified must still be the same generation.
  const closing = await statesOf(before);
  if (weeks.some((w) => weekStates.get(w) === "ready" && closing.get(w) !== "ready")) return { state: "rebuilding" };

  return {
    state: "ready",
    targets: { hourlyPct: a.targets.hourly.pct, loadedPct: a.targets.loaded.pct },
    days,
    strip: {
      actual: stripActual, projected: stripProjected,
      notSettledDays: boardDates.filter((d) => kind(d) === "not_settled").length,
      noScheduleDays: boardDates.filter((d) => kind(d) === "no_schedule").length,
    },
  };
}
