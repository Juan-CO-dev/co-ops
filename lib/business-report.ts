/**
 * Item 9 PR 9a: the business report's authorized READ boundary (server-only). No page yet (9b).
 *
 * Every load:
 *   1. refuses BEFORE any I/O: the switch (BUSINESS_REPORT, FACT_LAYER and FACT_LAYER_LABOR all "1", else
 *      503 business_report_unavailable), the role (GM / MoO / Owner / CGS; every level-6 role and below,
 *      the AGM and the social media manager included, is 403 with no payload at all), and the concrete shop
 *      through the reports-hub scope (own shop below 8, any shop at 8+; `all` is never a shop);
 *   2. reads only bounded windows: a range is <= 92 business days, split into <= 31-day windows fetched two
 *      at a time (the Sales contract), plus the 8 prior weeks the rush baseline needs;
 *   3. takes day MONEY from the Sales report's own RPC (sales_report_daily), so the denominator is the Sales
 *      net by construction, and CUTS from the order facts (0341), shown only when they recompose to that day;
 *   4. takes LABOR from fact_labor_cost (day and week, the board's own pricer) and 0341's quarter / person
 *      reads, gated per payroll week on labor_week_coverage (0339 ot_scope per_shop + the current builder, an
 *      unchanged generation across the reads, and a stored fingerprint equal to the week's current source).
 * Cost per person is serialized only where PERSON_COST_MIN allows; no wage rate and no contact field ever.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canReadScopedReport, type ReportScopeViewer } from "@/lib/report-scope";
import { shiftReportDate } from "@/lib/report-range";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { operationalDayUtcRange } from "@/lib/operational-day";
import { SALES_READ_MIN, SALES_WINDOW_CONCURRENCY, salesWindows, summarizeSales, type DailyRaw } from "@/lib/sales-reports-shared";
import { canSeeQuarterLaborCost, laborTargetsFor, rangeTargets, toLaborCostRow, type LaborCostRow, type LaborTargets } from "@/lib/facts/labor-cost-shared";
import { LABOR_HISTORY_FLOOR_DAY, laborWageFallback, type WageFallback } from "@/lib/facts/labor-config-shared";
import { readCurrentWeekFingerprints } from "@/lib/facts/labor-week-gate";
import type { RoleCode } from "@/lib/roles";
import {
  BUSINESS_QUARTER_MAX_DAYS, RUSH_HISTORY_WEEKS, RUSH_MIN_CHECKS, RUSH_MIN_HISTORY, RUSH_MULTIPLIER, RUSH_MIN_BASELINE_CHECKS, RUSH_MIN_RUN_QUARTERS,
  businessReportEnabled, businessReportRefusal, canSeePersonCost, channelTotals, daySalesFrom, detectRushes, eachDay, largeCheckTotals,
  currentWeekCoverage, laborDayFigures, laborRangeFigures, laborWeekState, mergeCuts, payrollWeekStart, quarterFigures, recomposeDay, serverTotals, toCutRow,
  type BusinessRange, type BusinessReportEnv, type CutRow, type CutTotal, type CutsState, type DaySales, type LaborFigures,
  type LaborWeekCoverageRow, type LaborWeekGenerationRow, type QuarterPoint, type RushResult,
} from "@/lib/business-report-shared";

export * from "@/lib/business-report-shared";

export class BusinessReportError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
    this.name = "BusinessReportError";
  }
}

export interface BusinessViewer extends ReportScopeViewer { role: RoleCode }
type Client = Pick<SupabaseClient, "rpc" | "from">;
export interface BusinessDeps { client?: Client; env?: BusinessReportEnv & { LABOR_WAGE_FALLBACK?: string }; wageFallback?: WageFallback }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The gate every load runs first (switch, role, shop). Throws; never returns a partial grant. */
export function assertBusinessScope(viewer: BusinessViewer, locationId: string | undefined, env: BusinessReportEnv): asserts locationId is string {
  if (!businessReportEnabled(env)) throw new BusinessReportError(503, "business_report_unavailable");
  if (viewer.level < SALES_READ_MIN || businessReportRefusal(viewer.role)) throw new BusinessReportError(403, "role_insufficient");
  if (!locationId || locationId === "all" || !UUID.test(locationId)) throw new BusinessReportError(400, "invalid_location");
  if (!canReadScopedReport(viewer, locationId)) throw new BusinessReportError(403, "location_forbidden");
}

/** A JSON-returning read (sales_report_daily): one object, no row cap applies. */
async function call<T>(sb: Client, fn: string, args: Record<string, unknown>): Promise<T> {
  let result;
  try {
    result = await sb.rpc(fn, args);
  } catch {
    console.error("business_reads_timeout");
    throw new BusinessReportError(503, "business_reads_timeout");
  }
  if (result.error) rpcError(result.error);
  return result.data as T;
}
type Page = { data: unknown; error: { code?: string } | null; count?: number | null };

/** Rows per request: PostgREST's default max-rows. A server configured lower is still read to completion,
 * because the END is decided by the exact count, never by a short page. */
export const BUSINESS_READ_PAGE = 1_000;
/** A read needing more pages than this is refused by name (a bounded window never should). */
export const BUSINESS_READ_MAX_PAGES = 50;

/**
 * Reads EVERY row of a table-returning read (fix round 1, P1): pages of BUSINESS_READ_PAGE by `range`, each
 * asking the exact count, until the rows collected equal it. A page that comes back empty (or a count that is
 * missing or moves) before the count is reached is 503 `business_reads_incomplete`: never a silently
 * truncated report. Ordering is the read's own total ORDER BY (0341) / an explicit order on table reads.
 */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<Page>, onError: (e: { code?: string }) => never): Promise<T[]> {
  const out: T[] = [];
  let expected: number | null = null;
  for (let i = 0; ; i++) {
    if (i >= BUSINESS_READ_MAX_PAGES) throw new BusinessReportError(503, "business_reads_incomplete");
    let r: Page;
    try {
      r = await page(out.length, out.length + BUSINESS_READ_PAGE - 1);
    } catch {
      console.error("business_reads_timeout");
      throw new BusinessReportError(503, "business_reads_timeout");
    }
    if (r.error) onError(r.error);
    const got = (r.data ?? []) as T[];
    if (!Array.isArray(got) || typeof r.count !== "number" || (expected !== null && r.count !== expected)) {
      console.error("business_reads_incomplete");
      throw new BusinessReportError(503, "business_reads_incomplete");
    }
    expected = r.count;
    out.push(...got);
    if (out.length === expected) return out;
    if (got.length === 0 || out.length > expected) {
      console.error("business_reads_incomplete");
      throw new BusinessReportError(503, "business_reads_incomplete");
    }
  }
}
const rpcError = (e: { code?: string }): never => {
  // 0341 not applied yet: say so, never an empty report. Never log messages, args or payloads.
  if (e.code === "PGRST202" || e.code === "42883") throw new BusinessReportError(503, "business_reads_not_installed");
  console.error("business_reads_timeout");
  throw new BusinessReportError(503, "business_reads_timeout");
};
const tableError = (e: { code?: string }): never => {
  if (e.code === "42P01" || e.code === "42703" || e.code === "PGRST205") throw new BusinessReportError(503, "business_reads_not_installed");
  console.error("business_reads_timeout");
  throw new BusinessReportError(503, "business_reads_timeout");
};
/** Every row of a table-returning RPC (0341's three reads). */
function rpcAll<T>(sb: Client, fn: string, args: Record<string, unknown>): Promise<T[]> {
  return readAll<T>((a, z) => sb.rpc(fn, args, { count: "exact" }).range(a, z) as unknown as PromiseLike<Page>, rpcError);
}
/** Every row of a table read; `build` returns the filtered, totally ordered select (count: exact). */
function rows<T>(build: () => { range: (a: number, z: number) => PromiseLike<Page> }): Promise<T[]> {
  return readAll<T>((a, z) => build().range(a, z), tableError);
}

/** Order-preserving map with at most `limit` calls in flight. */
async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]!); } catch (e) { failed = true; throw e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── DTO ─────────────────────────────────────────────────────────────────────────────────────────

export interface BusinessDayDto {
  date: string;
  sales: DaySales;
  /** `ok` = the day's cuts recompose to its Sales total; otherwise they are withheld. */
  cuts: CutsState;
  labor: LaborFigures;
  largeChecks: { checks: number; cents: number };
  /** Null when the day's cuts are not shown. */
  rush: RushResult | null;
}
export interface BusinessWeekDto { weekStart: string; from: string; to: string; target: number; loadedTarget: number; labor: LaborFigures }
export interface BusinessQuarterDto {
  date: string; quarterStartAt: string; wallQuarter: number; fold: number;
  /** `amountMissing` = checks of unknown amount in this quarter (> 0 = its sales are partial, so no %). */
  toastCents: number | null; checks: number | null; amountMissing: number | null; laborMinutes: number | null;
  /** Item 9b: the quarter's labor DOLLARS and % exist only where QUARTER_COST_MIN allows (MoO+); a GM's quarter
   * has neither key (a % times the shown sales would be the dollars). */
  straightCents?: number | null; pct?: number | null;
  basis: "toast_only_straight_time"; tone: "none";
}
/** A day's `sale` Toast checks with no opened quarter; quarters + this = the day's Toast check sales. */
/** `amountMissing` (fix round 1) = of those checks, how many have an unknown amount (> 0 = the cents are a floor). */
export interface BusinessUnassignedDto { date: string; toastCents: number; checks: number; amountMissing: number }
export interface BusinessPersonDto {
  personKey: string; label: string | null; source: string; payClass: string;
  minutes: number; otMinutes: number | null;
  /** Payroll weeks in the range whose overtime / cost is withheld (not rebuilt per shop yet). */
  weeksSuppressed: number;
  /** Straight-time cost; present ONLY where PERSON_COST_MIN allows (MoO+ by default). */
  straightCostCents?: number | null;
}
export interface BusinessReportDto {
  locationId: string;
  range: BusinessRange;
  access: { personCost: boolean; quarterCost: boolean };
  days: BusinessDayDto[];
  weeks: BusinessWeekDto[];
  total: {
    sales: { totalCents: number; toastChecksCents: number; toastNetCents: number | null; ezcaterCents: number; refundCents: number; coverage: string };
    labor: LaborFigures;
    target: number | "target_varies";
    loadedTarget: number | "target_varies";
  };
  quarters: BusinessQuarterDto[] | null;
  /** Per day whose cuts are shown (<= 31-day ranges); null when quarters are. Days with nothing unassigned are omitted. */
  quartersUnassigned: BusinessUnassignedDto[] | null;
  quartersReason: "range_too_wide" | null;
  channels: { included: CutTotal[]; excluded: CutTotal[] };
  servers: CutTotal[];
  people: BusinessPersonDto[];
  largeChecks: { checks: number; cents: number };
  rushRule: { multiplier: number; historyWeeks: number; minHistory: number; minChecks: number; minBaselineChecks: number; minRunQuarters: number };
}

// The serialized-payload allowlist (plan finding 4): every leaf path a role may receive. An unknown path
// fails tests/business-report-loader.test.ts. `x[]` = each element of x.
const keys = (prefix: string, ks: readonly string[]) => ks.map((k) => `${prefix}.${k}`);
const SALES_KEYS = ["date", "coverage", "checks", "toastChecksCents", "toastAmountMissing", "toastNetCents", "ezcaterCents", "ezcaterOrders",
  "ezcaterMissing", "refundCents", "totalCents", "giftCardCents", "ezcaterLinkedCents"] as const;
const LABOR_KEYS = ["state", "minutes", "pureHourlyCents", "otPremiumCents", "otMinutes", "denominator", "denominator.cents", "denominator.state", "pct", "tone",
  "loadedState", "salariedCents", "burdenCents", "fullyLoadedCents", "loadedPct", "loadedTone", "burdenEstimated", "salaryEstimated", "salaryGaps", "wageEstimated", "hoursUnverified"] as const;
const RUSH_KEYS = ["state", "uncompared", "untimed", "baselineUntimed", "windows[].startAt", "windows[].endAt", "windows[].quarters", "windows[].checks", "windows[].cents",
  "windows[].baselineChecks", "windows[].baselineCents"] as const;
const CUT_KEYS = ["key", "label", "provider", "cents", "checks", "amountMissing", "unassigned"] as const;
const PERSON_KEYS = ["personKey", "label", "source", "payClass", "minutes", "otMinutes", "weeksSuppressed"] as const;
const SHOP_MONEY_PATHS: readonly string[] = [
  "locationId",
  ...keys("range", ["range", "from", "to", "days", "shortened", "empty", "previous.from", "previous.to", "lastYear", "lastYear.from", "lastYear.to", "lastYearReason"]),
  "access.personCost", "access.quarterCost",
  "days[].date", ...keys("days[].sales", SALES_KEYS), "days[].cuts", ...keys("days[].labor", LABOR_KEYS),
  "days[].largeChecks.checks", "days[].largeChecks.cents", "days[].rush", ...keys("days[].rush", RUSH_KEYS),
  "weeks[].weekStart", "weeks[].from", "weeks[].to", "weeks[].target", "weeks[].loadedTarget", ...keys("weeks[].labor", LABOR_KEYS),
  ...keys("total.sales", ["totalCents", "toastChecksCents", "toastNetCents", "ezcaterCents", "refundCents", "coverage"]),
  ...keys("total.labor", LABOR_KEYS), "total.target", "total.loadedTarget",
  "quarters", ...keys("quarters[]", ["date", "quarterStartAt", "wallQuarter", "fold", "toastCents", "checks", "amountMissing", "laborMinutes", "basis", "tone"]),
  "quartersUnassigned", ...keys("quartersUnassigned[]", ["date", "toastCents", "checks", "amountMissing"]),
  "quartersReason",
  ...keys("channels.included[]", CUT_KEYS), ...keys("channels.excluded[]", CUT_KEYS), ...keys("servers[]", CUT_KEYS),
  ...keys("people[]", PERSON_KEYS),
  "largeChecks.checks", "largeChecks.cents",
  ...keys("rushRule", ["multiplier", "historyWeeks", "minHistory", "minChecks", "minBaselineChecks", "minRunQuarters"]),
];
export const BUSINESS_REPORT_DTO_PATHS = {
  shop_money: SHOP_MONEY_PATHS,
  person_money: [...SHOP_MONEY_PATHS, "people[].straightCostCents", "quarters[].straightCents", "quarters[].pct"],
} as const;

// ── Loader ──────────────────────────────────────────────────────────────────────────────────────

interface QuarterRaw { business_date: string; quarter_start_at: string; wall_quarter: number; fold: number; minutes: number | string; straight_cents: number | string }
interface PersonRaw { week_start: string; person_key: string; person_label: string | null; source: string; pay_class: string;
  minutes: number | string; ot_minutes: number | string; straight_cents: number | string | null }
interface StructureRow { structure: { labor?: { targetPct: number; basis: "hourly" | "total"; hourlyTargetPct?: number } } | null; created_at: string }

const ymd = (v: unknown) => String(v).slice(0, 10);
const isoOf = (v: unknown) => new Date(v as string).toISOString();
const n = (v: unknown) => Number(v ?? 0);

/** The structure in force at a payroll week's start (ET midnight) decides that week's targets. */
function targetsForWeek(structures: readonly StructureRow[], weekStart: string): LaborTargets {
  const at = operationalDayUtcRange(weekStart).startIso;
  const s = [...structures].filter((x) => x.created_at <= at).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  return laborTargetsFor(s?.structure?.labor ? { labor: s.structure.labor } : null);
}

export async function loadBusinessReport(viewer: BusinessViewer, args: { locationId: string; range: BusinessRange }, deps: BusinessDeps = {}): Promise<BusinessReportDto> {
  const env = deps.env ?? (process.env as BusinessDeps["env"] & object);
  assertBusinessScope(viewer, args.locationId, env);
  const sb = deps.client ?? getServiceRoleClient();
  const { range, locationId } = args;
  const personCost = canSeePersonCost(viewer.role);
  const quarterCost = canSeeQuarterLaborCost(viewer.role);
  const wf = deps.wageFallback ?? laborWageFallback(env.LABOR_WAGE_FALLBACK);
  const win = (w: { from: string; to: string }) => ({ p_location_id: locationId, p_from: w.from, p_to: w.to });

  const days = range.empty ? [] : eachDay(range.from, range.to);
  const histFrom = shiftReportDate(range.from, -7 * RUSH_HISTORY_WEEKS);
  const laborFrom = range.from < LABOR_HISTORY_FLOOR_DAY ? LABOR_HISTORY_FLOOR_DAY : range.from;
  const laborWindows = range.empty || laborFrom > range.to ? [] : salesWindows(laborFrom, range.to);
  const laborDays = days.filter((d) => d >= LABOR_HISTORY_FLOOR_DAY);
  const weekStarts = [...new Set(days.map(payrollWeekStart))];

  // Fix round 3 (P2): coverage is read BEFORE any labor read starts and AGAIN after all have answered; a week
  // whose generation moved in between is `rebuilding` (currentWeekCoverage). Never one read beside the labor reads.
  const readWeekCoverage = () => rows<LaborWeekGenerationRow>(() => sb.from("labor_week_coverage")
    .select("week_start,ot_scope,builder_version,built_at,source_fingerprint", { count: "exact" })
    .gte("week_start", payrollWeekStart(range.from)).lte("week_start", range.to).order("week_start", { ascending: true }));
  const coverageBefore = range.empty ? [] : await readWeekCoverage();
  const [dailyRaws, cutChunks, quarterChunks, peopleChunks, factCoverage, structures, dayCosts, weekCosts] = range.empty
    ? [[], [], [], [], [], [], [], []] as never
    : await Promise.all([
      mapBounded(salesWindows(range.from, range.to), SALES_WINDOW_CONCURRENCY, (w) => call<DailyRaw>(sb, "sales_report_daily", win(w))),
      mapBounded(salesWindows(histFrom, range.to), SALES_WINDOW_CONCURRENCY,
        async (w) => (await rpcAll<Record<string, unknown>>(sb, "business_report_check_cuts", win(w))).map(toCutRow)),
      mapBounded(laborWindows, SALES_WINDOW_CONCURRENCY,
        (w) => rpcAll<QuarterRaw>(sb, "business_report_labor_quarters", { ...win(w), p_wage_fallback: wf })),
      mapBounded(laborWindows, SALES_WINDOW_CONCURRENCY,
        (w) => rpcAll<PersonRaw>(sb, "business_report_labor_people", { ...win(w), p_wage_fallback: wf })),
      rows<{ business_date: string; state: string }>(() => sb.from("fact_day_coverage").select("business_date,state", { count: "exact" })
        .eq("location_id", locationId).eq("fact", "orders").gte("business_date", histFrom).lte("business_date", range.to)
        .order("business_date", { ascending: true })),
      rows<StructureRow>(() => sb.from("schedule_structures").select("structure,created_at", { count: "exact" }).eq("location_id", locationId)
        .order("created_at", { ascending: true }).order("id", { ascending: true })),
      mapBounded(laborDays, SALES_WINDOW_CONCURRENCY, async (d) => {
        const r = await rpcAll<Record<string, unknown>>(sb, "fact_labor_cost", { p_location_id: locationId, p_from: d, p_to: d, p_wage_fallback: wf });
        return r?.[0] ? toLaborCostRow(r[0]) : null;
      }),
      mapBounded(weekStarts, SALES_WINDOW_CONCURRENCY, async (ws) => {
        const from = [ws, range.from, LABOR_HISTORY_FLOOR_DAY].sort().at(-1)!;
        const to = [shiftReportDate(ws, 6), range.to].sort()[0]!;
        if (from > to) return null;
        const r = await rpcAll<Record<string, unknown>>(sb, "fact_labor_cost", { p_location_id: locationId, p_from: from, p_to: to, p_wage_fallback: wf });
        // The request names one payroll week, so its one row IS that week.
        return r?.[0] ? { ...toLaborCostRow(r[0]), week_start: ws } : null;
      }),
    ]);

  const coverageAfter = range.empty ? [] : await readWeekCoverage();
  // Board two views PR 1 (Astra r3 P1-2): unchanged generation is not enough. Each stored week's fingerprint must
  // also be its CURRENT source's (read last, never throws: an unanswered week is `rebuilding`).
  const currentFingerprints = await readCurrentWeekFingerprints(sb, coverageAfter.map((r) => ymd(r.week_start)));
  const weekMap: ReadonlyMap<string, LaborWeekCoverageRow> = currentWeekCoverage(coverageBefore, coverageAfter, currentFingerprints);
  const weekTargets = new Map(weekStarts.map((ws) => [ws, targetsForWeek(structures, ws)]));
  const sales = range.empty ? [] : daySalesFrom(dailyRaws, range.from, range.to);
  const cuts = mergeCuts(cutChunks);
  const cutsByDate = new Map<string, CutRow[]>();
  for (const c of cuts) (cutsByDate.get(c.business_date) ?? cutsByDate.set(c.business_date, []).get(c.business_date)!).push(c);
  const covered = new Set(factCoverage.filter((c) => c.state === "covered" || c.state === "covered_zero").map((c) => ymd(c.business_date)));
  const costByDay = new Map(laborDays.map((d, i) => [d, dayCosts[i] ?? null]));

  // Quarter SALES (fix round 1, P2): every `sale` Toast check with an opened quarter, the catering channel
  // INCLUDED: an unlinked Toast catering ring is Toast check sales like any other, and the quarter labor % divides
  // by all of them. Only the RUSH detector leaves catering out (named events, never a rush): `rushOnly`.
  const points = (date: string, rushOnly: boolean): QuarterPoint[] => {
    const by = new Map<string, QuarterPoint>();
    for (const c of cutsByDate.get(date) ?? []) {
      if (c.sale_class !== "sale" || (rushOnly && c.channel === "catering") || !c.quarter_start_at || c.wall_quarter === null || c.fold === null) continue;
      const p = by.get(c.quarter_start_at) ?? by.set(c.quarter_start_at, { quarterStartAt: c.quarter_start_at, wallQuarter: c.wall_quarter, fold: c.fold, checks: 0, cents: 0, amountMissing: 0 }).get(c.quarter_start_at)!;
      // Fix round 2: the unknown-amount count rides with the quarter (its sales are partial, never a % or a rush).
      p.checks += c.checks; p.cents += c.amount_cents; p.amountMissing! += c.amount_missing;
    }
    return [...by.values()];
  };
  const rushPoints = (date: string) => points(date, true);
  /** Fix round 8 (ITEM9B-r8 P2): the checks `rushPoints` had to leave out because they have no opened time (`sale`,
   * not catering: the rush detector's own population). Counted, so a day holding any is never "no rushes". */
  const rushUntimed = (date: string) => (cutsByDate.get(date) ?? [])
    .filter((c) => c.sale_class === "sale" && c.channel !== "catering" && (!c.quarter_start_at || c.wall_quarter === null || c.fold === null))
    .reduce((t, c) => t + c.checks, 0);
  const rushDay = (date: string) => ({ date, quarters: rushPoints(date), untimed: rushUntimed(date) });
  /** `sale` checks the facts could not place in a quarter (no opened time): shown, never dropped. */
  const unassigned = (date: string) => (cutsByDate.get(date) ?? [])
    .filter((c) => c.sale_class === "sale" && (!c.quarter_start_at || c.wall_quarter === null || c.fold === null))
    .reduce((t, c) => ({ toastCents: t.toastCents + c.amount_cents, checks: t.checks + c.checks, amountMissing: t.amountMissing + c.amount_missing }),
      { toastCents: 0, checks: 0, amountMissing: 0 });

  const dayDtos: BusinessDayDto[] = sales.map((s) => {
    const dayCuts = cutsByDate.get(s.date) ?? [];
    const rc = recomposeDay(s, dayCuts);
    const wt = weekTargets.get(payrollWeekStart(s.date));
    const history = Array.from({ length: RUSH_HISTORY_WEEKS }, (_, i) => shiftReportDate(s.date, -7 * (i + 1)))
      .filter((d) => covered.has(d)).map(rushDay);
    return {
      date: s.date, sales: s, cuts: rc.reason,
      labor: laborDayFigures(s, costByDay.get(s.date) ?? null, weekMap.get(payrollWeekStart(s.date)), wt?.hourly.pct, wt?.loaded.pct),
      largeChecks: rc.ok ? largeCheckTotals(dayCuts) : { checks: 0, cents: 0 },
      rush: rc.ok ? detectRushes(rushDay(s.date), history) : null,
    };
  });
  const okCuts = dayDtos.filter((d) => d.cuts === "ok").flatMap((d) => cutsByDate.get(d.date) ?? []);

  const weekRows = weekCosts.filter((r): r is LaborCostRow => r !== null);
  const weeks: BusinessWeekDto[] = weekStarts.map((ws) => {
    const inWeek = sales.filter((s) => payrollWeekStart(s.date) === ws);
    const target = weekTargets.get(ws)!.hourly.pct;
    const loadedTarget = weekTargets.get(ws)!.loaded.pct;
    return { weekStart: ws, from: inWeek[0]!.date, to: inWeek[inWeek.length - 1]!.date, target, loadedTarget,
      labor: laborRangeFigures(inWeek, weekRows.filter((r) => r.week_start === ws), weekMap, { hourly: target, loaded: loadedTarget }) };
  });
  const rangeTargetPair = rangeTargets([...weekTargets.values()]);
  const rangeTarget = rangeTargetPair.hourly;
  const totals = summarizeSales(dailyRaws, range.from, range.to, "day").totals;

  // Quarters (<= 31 days): Toast-hour sales on days whose cuts recompose, labor minutes and straight time.
  let quarters: BusinessQuarterDto[] | null = null;
  let quartersUnassigned: BusinessUnassignedDto[] | null = null;
  if (range.days <= BUSINESS_QUARTER_MAX_DAYS) {
    quartersUnassigned = dayDtos.filter((d) => d.cuts === "ok").map((d) => ({ date: d.date, ...unassigned(d.date) })).filter((u) => u.checks > 0 || u.toastCents !== 0);
    const dayBy = new Map(dayDtos.map((d) => [d.date, d]));
    const cells = new Map<string, BusinessQuarterDto>();
    const cell = (date: string, at: string, wq: number, fd: number) => {
      const k = `${date}|${at}`;
      return cells.get(k) ?? cells.set(k, { date, quarterStartAt: at, wallQuarter: wq, fold: fd, toastCents: null, checks: null, amountMissing: null, laborMinutes: null,
        straightCents: null, pct: null, basis: "toast_only_straight_time", tone: "none" }).get(k)!;
    };
    for (const d of dayDtos) {
      if (d.cuts !== "ok") continue;
      for (const p of points(d.date, false)) {
        const c = cell(d.date, p.quarterStartAt, p.wallQuarter, p.fold);
        c.toastCents = p.cents; c.checks = p.checks; c.amountMissing = p.amountMissing ?? 0;
      }
    }
    // Fix round 2: MINUTES always (a rebuilding week keeps its quarter hours, like its days and people);
    // straight-time MONEY only where the day's money is shown (`pureHourlyCents` non-null = a ready week).
    for (const q of quarterChunks.flat()) {
      const date = ymd(q.business_date);
      const day = dayBy.get(date);
      if (!day) continue;
      const c = cell(date, isoOf(q.quarter_start_at), n(q.wall_quarter), n(q.fold));
      c.laborMinutes = n(q.minutes);
      if (day.labor.pureHourlyCents !== null) c.straightCents = n(q.straight_cents);
    }
    quarters = [...cells.values()].sort((a, b) => Date.parse(a.quarterStartAt) - Date.parse(b.quarterStartAt)).map((c) => {
      const day = dayBy.get(c.date)!;
      const salesOk = day.cuts === "ok";
      const f = quarterFigures({ toastCents: c.toastCents ?? 0, checks: c.checks ?? 0, amountMissing: c.amountMissing ?? 0, laborMinutes: c.laborMinutes, straightCents: c.straightCents ?? null,
        salesOk, laborOk: day.labor.pureHourlyCents !== null && day.labor.state !== "hours_unknown" });
      const out: BusinessQuarterDto = { ...c, toastCents: salesOk ? c.toastCents ?? 0 : null, checks: salesOk ? c.checks ?? 0 : null, amountMissing: salesOk ? c.amountMissing ?? 0 : null, ...f };
      // Item 9b: below QUARTER_COST_MIN the quarter's dollars and % are not serialized at all.
      if (!quarterCost) { delete out.straightCents; delete out.pct; }
      return out;
    });
  }

  // People: minutes always; overtime and cost only for weeks rebuilt per shop; cost only where allowed.
  const people = new Map<string, BusinessPersonDto & { suppressed: Set<string>; ot: number; cost: number | null }>();
  for (const r of peopleChunks.flat()) {
    const k = `${r.person_key}|${r.source}|${r.pay_class}`;
    const p = people.get(k) ?? people.set(k, { personKey: r.person_key, label: r.person_label, source: r.source, payClass: r.pay_class,
      minutes: 0, otMinutes: 0, weeksSuppressed: 0, suppressed: new Set(), ot: 0, cost: r.pay_class === "hourly" ? 0 : null }).get(k)!;
    if (!p.label && r.person_label) p.label = r.person_label;
    p.minutes += n(r.minutes);
    if (laborWeekState(weekMap.get(ymd(r.week_start))) !== "ready") { p.suppressed.add(ymd(r.week_start)); continue; }
    p.ot += n(r.ot_minutes);
    if (p.cost !== null) p.cost += n(r.straight_cents);
  }
  const peopleDtos: BusinessPersonDto[] = [...people.values()].sort((a, b) => b.minutes - a.minutes || (a.personKey < b.personKey ? -1 : 1)).map((p) => {
    const blocked = p.suppressed.size > 0;
    const out: BusinessPersonDto = { personKey: p.personKey, label: p.label, source: p.source, payClass: p.payClass, minutes: p.minutes,
      otMinutes: blocked ? null : p.ot, weeksSuppressed: p.suppressed.size };
    if (personCost) out.straightCostCents = blocked ? null : p.cost;
    return out;
  });

  return {
    locationId, range, access: { personCost, quarterCost },
    days: dayDtos, weeks,
    total: {
      sales: { totalCents: totals.totalCents, toastChecksCents: totals.toastChecksCents, toastNetCents: totals.toastNetCents,
        ezcaterCents: totals.ezcaterCents, refundCents: totals.refundCents, coverage: totals.coverage },
      labor: laborRangeFigures(sales, weekRows, weekMap, { hourly: rangeTarget, loaded: rangeTargetPair.loaded }),
      target: rangeTarget,
      loadedTarget: rangeTargetPair.loaded,
    },
    quarters, quartersUnassigned, quartersReason: quarters === null ? "range_too_wide" : null,
    channels: channelTotals(okCuts), servers: serverTotals(okCuts), people: peopleDtos,
    largeChecks: largeCheckTotals(okCuts),
    rushRule: { multiplier: RUSH_MULTIPLIER, historyWeeks: RUSH_HISTORY_WEEKS, minHistory: RUSH_MIN_HISTORY, minChecks: RUSH_MIN_CHECKS,
      minBaselineChecks: RUSH_MIN_BASELINE_CHECKS, minRunQuarters: RUSH_MIN_RUN_QUARTERS },
  };
}
