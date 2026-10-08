/**
 * Sales reports (Reports hub piece 4, Phase 2b) — the PURE core: zero I/O, client-safe.
 *
 * The SQL (migration 0232) aggregates one bounded window (<= 31 business days, one shop) per call;
 * the server loader (lib/sales-reports.ts) authorizes, fans the windows out two at a time and hands
 * the raw window results here. Everything a human reads is computed below, so the rules are
 * testable without a database:
 *
 *   - ONE eligible class. Only `sale` checks are sales. `gift_card` (E-Gift Cards, reviewed channel
 *     map), `ezcater_linked` (a Toast ring linked to an ezCater order: ezCater is the source of
 *     truth, Juan 2026-10-08), `void` and `excess_food` are carried as named exclusions, never summed.
 *   - ezCater revenue comes from ezCater orders (subtotal, by EVENT date), added once.
 *   - Discounts stay BY NAME: rows are keyed on the Toast discount name, never lumped (Juan).
 *   - Employee credit is the ORDER's server (Juan); the label is the Toast first name or "not mapped".
 *   - UNKNOWN IS NEVER ZERO: a check with no amount is counted as missing and flags the total as
 *     partial; a day without a completed capture run is a coverage gap, not a $0 day.
 */
import { shiftReportDate, validReportDate, type ReportGrain } from "@/lib/report-range";

/** Juan 2026-10-08: GM+ sees their own shop; level 8+ every shop (lib/report-scope.ts). */
export const SALES_READ_MIN = 7;
/** One SQL call never spans more than this many business days (0232 refuses wider). */
export const SALES_WINDOW_DAYS = 31;
/** Windows in flight at once per shop (plan: bounded fan-out, never a day x shop x dimension N+1). */
export const SALES_WINDOW_CONCURRENCY = 2;
/** Keyset list page (plan: 50 + 1 lookahead, hard maximum 100). */
export const SALES_PAGE_SIZE = 50;
/** Breakdown tables render this many rows per page. */
export const SALES_BREAKDOWN_PAGE = 50;
/** Exports page through the same reads; beyond this they refuse rather than truncate. */
export const SALES_EXPORT_MAX_ROWS = 10_000;

export const SALES_VIEWS = ["summary", "items", "modifiers", "channels", "heatmap", "discounts", "servers"] as const;
export type SalesView = (typeof SALES_VIEWS)[number];
export const SALES_EXPORT_VIEWS = [...SALES_VIEWS, "checks", "catering"] as const;
export type SalesExportView = (typeof SALES_EXPORT_VIEWS)[number];
export function isSalesView(v: unknown): v is SalesView {
  return typeof v === "string" && (SALES_VIEWS as readonly string[]).includes(v);
}
export function isSalesExportView(v: unknown): v is SalesExportView {
  return typeof v === "string" && (SALES_EXPORT_VIEWS as readonly string[]).includes(v);
}

export type SalesDimension = "item" | "modifier" | "channel" | "hour_weekday" | "discount" | "server";
export const VIEW_DIMENSION: Record<Exclude<SalesView, "summary">, SalesDimension> = {
  items: "item", modifiers: "modifier", channels: "channel", heatmap: "hour_weekday", discounts: "discount", servers: "server",
};

/** Channels of the reviewed map (0221) plus the two the reader derives. */
export const SALES_CHANNELS = ["dine_in", "takeout", "online", "app", "delivery", "third_party", "catering", "unknown"] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];
export type SaleClass = "sale" | "void" | "excess_food" | "gift_card" | "ezcater_linked";

// ── Range ───────────────────────────────────────────────────────────────────────────────────

export interface SalesRange {
  /** The requested preset (canonical URL context). */
  range: string;
  grain: ReportGrain;
  from: string;
  to: string;
  previous: { from: string; to: string };
  compare: boolean;
  /** No finished business day falls inside the request (e.g. "this month" on the 1st). */
  empty: boolean;
  /** Only on an explicit "today": already-captured rows, labelled "today so far". */
  todaySoFar: boolean;
  /** A custom request was clipped to the grain's cap. */
  shortened: boolean;
}

export const SALES_RANGES = ["yesterday", "last7", "last30", "last90", "this_month", "last_month", "last12m", "today", "custom"] as const;
export const SALES_GRAINS: readonly ReportGrain[] = ["day", "week", "month"];

function monthStart(date: string, offset = 0): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 10);
}
export function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}
/** The earliest `from` a grain allows for an inclusive range ending `to` (92 days / 26 weeks / 12 months). */
function grainFloor(to: string, grain: ReportGrain): string {
  if (grain === "month") return monthStart(to, -11);
  if (grain === "week") {
    const weekday = new Date(`${to}T00:00:00Z`).getUTCDay();
    return shiftReportDate(to, -((weekday + 6) % 7) - 25 * 7);
  }
  return shiftReportDate(to, -91);
}

/**
 * The Sales range (plan, "Range wrapper"): finished business days by default, the seven ending
 * yesterday. Today is never mixed into a historical window; it appears only on an explicit "today".
 * Real calendar meanings stay (yesterday, this month, last month); a window is never shifted to
 * make it look full. Twelve months of history are reachable through "last12m" or a custom range at
 * month grain (Juan: "12 months of history, available in ranges").
 */
export function resolveSalesRange(p: Record<string, string | undefined>, today: string): SalesRange {
  const yesterday = shiftReportDate(today, -1);
  const requested = p.range && (SALES_RANGES as readonly string[]).includes(p.range) ? p.range : (p.from || p.to ? "custom" : "last7");
  let grain: ReportGrain = p.g === "week" || p.g === "month" ? p.g : "day";
  let from = shiftReportDate(yesterday, -6);
  let to = yesterday;
  switch (requested) {
    case "today": from = to = today; break;
    case "yesterday": from = to = yesterday; break;
    case "last30": from = shiftReportDate(yesterday, -29); break;
    case "last90": from = shiftReportDate(yesterday, -89); break;
    case "this_month": from = monthStart(today); break;
    case "last_month": from = monthStart(today, -1); to = shiftReportDate(monthStart(today), -1); break;
    case "last12m": from = monthStart(yesterday, -11); grain = "month"; break;
    case "custom": {
      from = validReportDate(p.from) ? p.from : from;
      to = validReportDate(p.to) ? p.to : yesterday;
      break;
    }
  }
  const todaySoFar = requested === "today";
  const last = todaySoFar ? today : yesterday;
  if (to > last) to = last;
  // A range wider than its grain allows steps up a grain instead of silently losing days.
  while (grain !== "month" && from < grainFloor(to, grain)) grain = grain === "day" ? "week" : "month";
  let shortened = false;
  const floor = grainFloor(to, grain);
  if (from < floor) { from = floor; shortened = requested === "custom"; }
  const empty = from > to;
  const days = empty ? 0 : inclusiveDays(from, to);
  let previous = { from: shiftReportDate(from, -Math.max(days, 1)), to: shiftReportDate(from, -1) };
  if (requested === "this_month" && !empty) {
    const priorStart = monthStart(from, -1);
    const priorEnd = shiftReportDate(monthStart(from), -1);
    const sameDay = shiftReportDate(priorStart, Number(to.slice(8)) - 1);
    previous = { from: priorStart, to: sameDay < priorEnd ? sameDay : priorEnd };
  } else if (requested === "last_month" || (requested === "last12m")) {
    const months = requested === "last_month" ? 1 : 12;
    previous = { from: monthStart(from, -months), to: shiftReportDate(from, -1) };
  }
  return {
    range: requested, grain, from, to: empty ? from : to, previous,
    compare: p.compare === "true" || p.compare === "1", empty, todaySoFar, shortened,
  };
}

/** The canonical URL context of a Sales range. */
export function salesRangeParams(r: SalesRange): Record<string, string> {
  return { range: r.range, from: r.from, to: r.to, g: r.grain, compare: String(r.compare) };
}

/** Windows of at most `maxDays` business days covering [from, to], NEWEST first. */
export function salesWindows(from: string, to: string, maxDays = SALES_WINDOW_DAYS): Array<{ from: string; to: string }> {
  if (!validReportDate(from) || !validReportDate(to) || from > to) return [];
  const out: Array<{ from: string; to: string }> = [];
  let end = to;
  while (end >= from) {
    let start = shiftReportDate(end, -(maxDays - 1));
    if (start < from) start = from;
    out.push({ from: start, to: end });
    end = shiftReportDate(start, -1);
  }
  return out;
}

/** Monday of the ISO week / first of the month / the day itself. */
export function bucketStart(date: string, grain: ReportGrain): string {
  if (grain === "month") return monthStart(date);
  if (grain === "week") {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return shiftReportDate(date, -((weekday + 6) % 7));
  }
  return date;
}
function bucketEnd(start: string, grain: ReportGrain): string {
  if (grain === "month") return shiftReportDate(monthStart(start, 1), -1);
  if (grain === "week") return shiftReportDate(start, 6);
  return start;
}

// ── Raw window results (what 0232 returns) ──────────────────────────────────────────────────

type Num = number | string | null | undefined;
const n = (v: Num): number => {
  if (v === null || v === undefined || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(x)) throw new Error("sales_amount_invalid");
  return x;
};

export interface DailyRaw {
  classes: Array<{ business_date: string; sale_class: SaleClass; checks: Num; amount_cents: Num; tax_cents: Num; amount_missing: Num }>;
  tips: Array<{ business_date: string; tip_cents: Num }>;
  discounts: Array<{ business_date: string; count: Num; cents: Num }>;
  refunds: Array<{ business_date: string; count: Num; refund_cents: Num; refund_tip_cents: Num }>;
  captured_days: string[];
  ezcater: Array<{ business_date: string; orders: Num; subtotal_cents: Num; amount_missing: Num }>;
}

export type CoverageStatus = "complete" | "partial" | "missing";
export function coverageStatus(covered: number, expected: number): CoverageStatus {
  if (expected > 0 && covered >= expected) return "complete";
  return covered > 0 ? "partial" : "missing";
}

export interface SalesTotals {
  /** Toast net sales: eligible (`sale`) check amounts, pre-tax, pre-tip, after discounts. */
  toastNetCents: number;
  checks: number;
  /** Eligible check sales / eligible checks (never an average of averages). */
  avgCheckCents: number | null;
  taxCents: number;
  tipCents: number;
  discountCents: number;
  discountCount: number;
  /** Refunds dated by their REFUND business date (shown beside sales, never netted silently). */
  refundCents: number;
  refundCount: number;
  /** ezCater orders (source of truth), subtotal by event date. */
  ezcaterCents: number;
  ezcaterOrders: number;
  /** Toast net + ezCater: the one total, with nothing counted twice. */
  totalCents: number;
  /** Named exclusions (never in any total). */
  giftCardCents: number;
  giftCardChecks: number;
  ezcaterLinkedCents: number;
  ezcaterLinkedChecks: number;
  voidChecks: number;
  excessFoodChecks: number;
  /** Eligible checks / ezCater orders with no amount: the total above is then PARTIAL. */
  amountMissing: number;
  coveredDays: number;
  expectedDays: number;
  coverage: CoverageStatus;
}
export interface SalesBucket extends SalesTotals { key: string; from: string; to: string }

function emptyTotals(expectedDays: number): SalesTotals {
  return {
    toastNetCents: 0, checks: 0, avgCheckCents: null, taxCents: 0, tipCents: 0, discountCents: 0, discountCount: 0,
    refundCents: 0, refundCount: 0, ezcaterCents: 0, ezcaterOrders: 0, totalCents: 0, giftCardCents: 0, giftCardChecks: 0,
    ezcaterLinkedCents: 0, ezcaterLinkedChecks: 0, voidChecks: 0, excessFoodChecks: 0, amountMissing: 0,
    coveredDays: 0, expectedDays, coverage: "missing",
  };
}

/** Folds one business day's raw facts into a running total (the ONE place a class is summed). */
function addDay(t: SalesTotals, day: DayFacts): void {
  for (const c of day.classes) {
    const cents = n(c.amount_cents);
    const checks = n(c.checks);
    switch (c.sale_class) {
      case "sale":
        t.toastNetCents += cents; t.checks += checks; t.taxCents += n(c.tax_cents); t.amountMissing += n(c.amount_missing);
        break;
      case "gift_card": t.giftCardCents += cents; t.giftCardChecks += checks; break;
      case "ezcater_linked": t.ezcaterLinkedCents += cents; t.ezcaterLinkedChecks += checks; break;
      case "void": t.voidChecks += checks; break;
      case "excess_food": t.excessFoodChecks += checks; break;
    }
  }
  t.tipCents += day.tipCents;
  t.discountCents += day.discountCents; t.discountCount += day.discountCount;
  t.refundCents += day.refundCents; t.refundCount += day.refundCount;
  t.ezcaterCents += day.ezcaterCents; t.ezcaterOrders += day.ezcaterOrders; t.amountMissing += day.ezcaterMissing;
  if (day.captured) t.coveredDays += 1;
}
function finish(t: SalesTotals): SalesTotals {
  t.totalCents = t.toastNetCents + t.ezcaterCents;
  t.avgCheckCents = t.checks > 0 ? Math.round(t.toastNetCents / t.checks) : null;
  t.coverage = coverageStatus(t.coveredDays, t.expectedDays);
  return t;
}

interface DayFacts {
  classes: DailyRaw["classes"]; tipCents: number; discountCents: number; discountCount: number;
  refundCents: number; refundCount: number; ezcaterCents: number; ezcaterOrders: number; ezcaterMissing: number; captured: boolean;
}

/** Index every window's rows by business date. Windows are disjoint, so nothing is added twice. */
function dayIndex(raws: readonly DailyRaw[]): Map<string, DayFacts> {
  const days = new Map<string, DayFacts>();
  const day = (d: string) => {
    let f = days.get(d);
    if (!f) {
      f = { classes: [], tipCents: 0, discountCents: 0, discountCount: 0, refundCents: 0, refundCount: 0, ezcaterCents: 0, ezcaterOrders: 0, ezcaterMissing: 0, captured: false };
      days.set(d, f);
    }
    return f;
  };
  for (const raw of raws) {
    for (const c of raw.classes ?? []) day(c.business_date).classes.push(c);
    for (const r of raw.tips ?? []) day(r.business_date).tipCents += n(r.tip_cents);
    for (const r of raw.discounts ?? []) { const f = day(r.business_date); f.discountCents += n(r.cents); f.discountCount += n(r.count); }
    for (const r of raw.refunds ?? []) { const f = day(r.business_date); f.refundCents += n(r.refund_cents); f.refundCount += n(r.count); }
    for (const r of raw.ezcater ?? []) { const f = day(r.business_date); f.ezcaterCents += n(r.subtotal_cents); f.ezcaterOrders += n(r.orders); f.ezcaterMissing += n(r.amount_missing); }
    for (const d of raw.captured_days ?? []) day(d).captured = true;
  }
  return days;
}

/** The summary: buckets at the range's grain (clipped to the window) plus the window total. */
export function summarizeSales(raws: readonly DailyRaw[], from: string, to: string, grain: ReportGrain): { buckets: SalesBucket[]; totals: SalesTotals } {
  const days = dayIndex(raws);
  const totals = emptyTotals(from > to ? 0 : inclusiveDays(from, to));
  const buckets = new Map<string, SalesBucket>();
  for (let d = from; d <= to; d = shiftReportDate(d, 1)) {
    const key = bucketStart(d, grain);
    let b = buckets.get(key);
    if (!b) {
      const start = key < from ? from : key;
      const endFull = bucketEnd(key, grain);
      const end = endFull > to ? to : endFull;
      b = { ...emptyTotals(inclusiveDays(start, end)), key, from: start, to: end };
      buckets.set(key, b);
    }
    const f = days.get(d);
    if (f) { addDay(b, f); addDay(totals, f); }
  }
  return { buckets: [...buckets.values()].map((b) => finish(b) as SalesBucket), totals: finish(totals) };
}

/**
 * Whole-percent change, only when it MEANS something: both windows fully covered, no missing
 * amounts, and a non-zero prior. Otherwise null (the screen shows the absolute numbers only).
 */
export function salesDeltaPct(current: SalesTotals, previous: SalesTotals | null): number | null {
  if (!previous || current.coverage !== "complete" || previous.coverage !== "complete") return null;
  if (current.amountMissing > 0 || previous.amountMissing > 0 || previous.totalCents <= 0) return null;
  return Math.round(((current.totalCents - previous.totalCents) / previous.totalCents) * 100);
}

// ── Breakdowns ──────────────────────────────────────────────────────────────────────────────

export interface BreakdownRaw {
  key: string; label?: string | null; units?: Num; checks?: Num; cents?: Num; count?: Num; amount_missing?: Num;
  channel?: string | null; provider?: string | null; sale_class?: string | null; dow?: Num; hour?: Num;
}
export interface BreakdownRow {
  key: string; label: string | null; units: number; checks: number; cents: number; count: number; amountMissing: number;
  channel?: string; provider?: string | null; saleClass?: string; dow?: number; hour?: number;
}

/**
 * Merges window results into one row per key. Every metric is additive across DISJOINT business
 * date windows (a check belongs to one business date), including distinct check counts. The label
 * is the NEWEST window's (windows arrive newest first), so a renamed item shows its current name.
 */
export function mergeBreakdown(dimension: SalesDimension, chunks: readonly (readonly BreakdownRaw[])[]): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>();
  for (const chunk of chunks) {
    for (const r of chunk) {
      const key = dimension === "channel" ? `${r.key}|${r.sale_class ?? ""}` : r.key;
      let row = rows.get(key);
      if (!row) {
        row = { key: r.key, label: r.label ?? null, units: 0, checks: 0, cents: 0, count: 0, amountMissing: 0 };
        if (dimension === "channel") { row.channel = r.channel ?? "unknown"; row.provider = r.provider ?? null; row.saleClass = r.sale_class ?? "sale"; }
        if (dimension === "hour_weekday") { row.dow = n(r.dow); row.hour = n(r.hour); }
        rows.set(key, row);
      } else if (!row.label && r.label) row.label = r.label;
      row.units += n(r.units); row.checks += n(r.checks); row.cents += n(r.cents); row.count += n(r.count); row.amountMissing += n(r.amount_missing);
    }
  }
  return sortBreakdown(dimension, [...rows.values()]);
}

/** Fixed sorts, never from the URL: units for items/modifiers, money otherwise; key breaks ties. */
export function sortBreakdown(dimension: SalesDimension, rows: BreakdownRow[]): BreakdownRow[] {
  const metric = (r: BreakdownRow) => (dimension === "item" || dimension === "modifier" ? r.units : r.cents);
  return rows.sort((a, b) => metric(b) - metric(a) || b.checks - a.checks || a.key.localeCompare(b.key));
}

export interface ChannelView {
  /** Rows that ARE sales: Toast `sale` checks by channel/provider, plus ezCater orders. */
  included: BreakdownRow[];
  /** Named exclusions: E-Gift Cards and ezCater-linked Toast rings. */
  excluded: BreakdownRow[];
  includedCents: number;
}
export function channelView(rows: readonly BreakdownRow[]): ChannelView {
  const included = rows.filter((r) => r.saleClass === "sale" || r.saleClass === "ezcater_source");
  const excluded = rows.filter((r) => r.saleClass === "gift_card" || r.saleClass === "ezcater_linked");
  return { included, excluded, includedCents: included.reduce((s, r) => s + r.cents, 0) };
}

export interface HeatmapGrid {
  /** [weekday 0 = Monday .. 6 = Sunday][hour 0..23]; null = no eligible check in that cell. */
  cents: (number | null)[][];
  checks: (number | null)[][];
  unknown: { cents: number; checks: number };
  maxCents: number;
}
/** Business-date weekday x opened hour (ET). A cell with no check is null, never 0. */
export function heatmapGrid(rows: readonly BreakdownRow[]): HeatmapGrid {
  const blank = () => Array.from({ length: 7 }, () => Array<number | null>(24).fill(null));
  const grid: HeatmapGrid = { cents: blank(), checks: blank(), unknown: { cents: 0, checks: 0 }, maxCents: 0 };
  for (const r of rows) {
    const dow = r.dow ?? 0;
    const hour = r.hour ?? -1;
    if (dow < 1 || dow > 7) continue;
    if (hour < 0 || hour > 23) { grid.unknown.cents += r.cents; grid.unknown.checks += r.checks; continue; }
    const centsRow = grid.cents[dow - 1]!;
    const checksRow = grid.checks[dow - 1]!;
    centsRow[hour] = (centsRow[hour] ?? 0) + r.cents;
    checksRow[hour] = (checksRow[hour] ?? 0) + r.checks;
    grid.maxCents = Math.max(grid.maxCents, centsRow[hour]!);
  }
  return grid;
}
/** Five intensity steps (0 = empty) so the color never carries meaning alone (the cell prints its value). */
export function heatLevel(cents: number | null, max: number): 0 | 1 | 2 | 3 | 4 {
  if (cents === null || cents <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((cents / max) * 4))) as 1 | 2 | 3 | 4;
}

/** A page of an already-merged (bounded) breakdown. */
export function pageRows<T>(rows: readonly T[], offset: number, size = SALES_BREAKDOWN_PAGE): { rows: T[]; nextOffset: number | null } {
  const start = Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
  const slice = rows.slice(start, start + size);
  return { rows: slice, nextOffset: start + size < rows.length ? start + size : null };
}

// ── Check list filters (closed allowlist) ───────────────────────────────────────────────────

/** URL sentinel for an EMPTY key (an unnamed discount, an order with no server, no provider). */
export const SALES_EMPTY_KEY = "~";
export interface SalesCheckFilters {
  channel?: SalesChannel; provider?: string; server?: string; discount?: string; dow?: number; hour?: number;
}
export const SALES_FILTER_KEYS = ["channel", "provider", "server", "discount", "dow", "hour"] as const;

/** Invalid values are DROPPED (never passed to SQL); every survivor is a bound RPC argument. */
export function parseSalesCheckFilters(p: Record<string, string | undefined>): SalesCheckFilters {
  const out: SalesCheckFilters = {};
  const text = (v: string | undefined, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v) ? v : undefined);
  const decode = (v: string | undefined) => (v === SALES_EMPTY_KEY ? "" : v);
  if (p.channel && (SALES_CHANNELS as readonly string[]).includes(p.channel)) out.channel = p.channel as SalesChannel;
  const provider = text(p.provider, 80);
  if (provider !== undefined) out.provider = decode(provider);
  const server = text(p.server, 64);
  if (server !== undefined && (server === SALES_EMPTY_KEY || /^[A-Za-z0-9-]+$/.test(server))) out.server = decode(server);
  const discount = text(p.discount, 120);
  if (discount !== undefined) out.discount = decode(discount);
  if (p.dow && /^[1-7]$/.test(p.dow)) out.dow = Number(p.dow);
  if (p.hour && /^(-1|[0-9]|1[0-9]|2[0-3])$/.test(p.hour)) out.hour = Number(p.hour);
  return out;
}
/** Filters back to URL params (empty keys as the sentinel). */
export function salesFilterParams(f: SalesCheckFilters): Record<string, string> {
  const out: Record<string, string> = {};
  const enc = (v: string) => (v === "" ? SALES_EMPTY_KEY : v);
  if (f.channel) out.channel = f.channel;
  if (f.provider !== undefined) out.provider = enc(f.provider);
  if (f.server !== undefined) out.server = enc(f.server);
  if (f.discount !== undefined) out.discount = enc(f.discount);
  if (f.dow !== undefined) out.dow = String(f.dow);
  if (f.hour !== undefined) out.hour = String(f.hour);
  return out;
}

/** The cursor binds the whole list context: shop, effective window and every filter. */
export function salesListContext(locationId: string, from: string, to: string, filters: SalesCheckFilters): string {
  return JSON.stringify([locationId, from, to, salesFilterParams(filters)]);
}

// ── DTOs the pages and exports share ────────────────────────────────────────────────────────

export interface SalesCheckRow {
  businessDate: string; checkGuid: string; openedAt: string | null; channel: string; provider: string | null;
  diningOption: string | null; serverGuid: string | null; serverName: string | null;
  amountCents: number | null; taxCents: number | null; discountCents: number | null; units: number;
}
export interface SalesCheckDetail {
  businessDate: string; checkGuid: string; openedAt: string | null; closedAt: string | null; paidAt: string | null;
  channel: string; provider: string | null; diningOption: string | null; saleClass: SaleClass;
  serverName: string | null; serverGuid: string | null; ezcaterOrderNumber: string | null;
  amountCents: number | null; taxCents: number | null; totalCents: number | null;
  discounts: Array<{ ordinal: number; name: string | null; amountCents: number | null; itemName: string | null }>;
  serviceCharges: Array<{ ordinal: number; name: string | null; amountCents: number | null; gratuity: boolean }>;
  payments: Array<{ type: string | null; status: string | null; amountCents: number | null; tipCents: number | null;
    paidBusinessDate: string | null; refundAmountCents: number | null; refundBusinessDate: string | null }>;
  selections: Array<{ selectionGuid: string; parentSelectionGuid: string | null; name: string; quantity: number; voided: boolean; depth: number }>;
}
export interface SalesEzcaterRow {
  orderId: string; eventDate: string; orderNumber: string | null; headcount: number | null; subtotalCents: number | null; status: string;
}

const centsOrNull = (v: Num): number | null => (v === null || v === undefined || v === "" ? null : n(v));

export function toCheckRow(r: Record<string, unknown>): SalesCheckRow {
  return {
    businessDate: String(r.business_date), checkGuid: String(r.check_guid), openedAt: (r.opened_at as string | null) ?? null,
    channel: String(r.channel ?? "unknown"), provider: (r.provider as string | null) ?? null,
    diningOption: (r.dining_option as string | null) ?? null, serverGuid: (r.server_guid as string | null) ?? null,
    serverName: (r.server_name as string | null) ?? null, amountCents: centsOrNull(r.amount_cents as Num),
    taxCents: centsOrNull(r.tax_cents as Num), discountCents: centsOrNull(r.discount_cents as Num), units: n(r.units as Num),
  };
}

/** Orders the selection tree parent-first and gives each line its depth (modifiers indent). */
export function selectionTree(rows: ReadonlyArray<{ selection_guid: string; parent_selection_guid: string | null; name: string; quantity: Num; voided: boolean }>): SalesCheckDetail["selections"] {
  const byParent = new Map<string | null, typeof rows[number][]>();
  const known = new Set(rows.map((r) => r.selection_guid));
  for (const r of rows) {
    const parent = r.parent_selection_guid && known.has(r.parent_selection_guid) ? r.parent_selection_guid : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), r]);
  }
  const out: SalesCheckDetail["selections"] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const r of byParent.get(parent) ?? []) {
      if (seen.has(r.selection_guid)) continue;
      seen.add(r.selection_guid);
      out.push({ selectionGuid: r.selection_guid, parentSelectionGuid: r.parent_selection_guid, name: r.name, quantity: n(r.quantity), voided: !!r.voided, depth });
      walk(r.selection_guid, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function toCheckDetail(r: Record<string, unknown>): SalesCheckDetail {
  const selections = selectionTree((r.selections as Array<{ selection_guid: string; parent_selection_guid: string | null; name: string; quantity: Num; voided: boolean }>) ?? []);
  const nameBySelection = new Map(selections.map((s) => [s.selectionGuid, s.name]));
  return {
    businessDate: String(r.business_date), checkGuid: String(r.check_guid), openedAt: (r.opened_at as string | null) ?? null,
    closedAt: (r.closed_at as string | null) ?? null, paidAt: (r.paid_at as string | null) ?? null,
    channel: String(r.channel ?? "unknown"), provider: (r.provider as string | null) ?? null,
    diningOption: (r.dining_option as string | null) ?? null, saleClass: (r.sale_class as SaleClass) ?? "sale",
    serverName: (r.server_name as string | null) ?? null, serverGuid: (r.server_guid as string | null) ?? null,
    ezcaterOrderNumber: (r.ezcater_order_number as string | null) ?? null,
    amountCents: centsOrNull(r.amount_cents as Num), taxCents: centsOrNull(r.tax_cents as Num), totalCents: centsOrNull(r.total_cents as Num),
    discounts: ((r.discounts as Array<Record<string, unknown>>) ?? []).map((d) => ({
      ordinal: n(d.ordinal as Num), name: (d.name as string | null) ?? null, amountCents: centsOrNull(d.amount_cents as Num),
      itemName: d.selection_guid ? nameBySelection.get(String(d.selection_guid)) ?? null : null,
    })),
    serviceCharges: ((r.service_charges as Array<Record<string, unknown>>) ?? []).map((s) => ({
      ordinal: n(s.ordinal as Num), name: (s.name as string | null) ?? null, amountCents: centsOrNull(s.amount_cents as Num), gratuity: !!s.gratuity,
    })),
    payments: ((r.payments as Array<Record<string, unknown>>) ?? []).map((p) => ({
      type: (p.type as string | null) ?? null, status: (p.status as string | null) ?? null, amountCents: centsOrNull(p.amount_cents as Num),
      tipCents: centsOrNull(p.tip_cents as Num), paidBusinessDate: (p.paid_business_date as string | null) ?? null,
      refundAmountCents: centsOrNull(p.refund_amount_cents as Num), refundBusinessDate: (p.refund_business_date as string | null) ?? null,
    })),
    selections,
  };
}

export function toEzcaterRow(r: Record<string, unknown>): SalesEzcaterRow {
  return {
    orderId: String(r.order_id), eventDate: String(r.event_date), orderNumber: (r.order_number as string | null) ?? null,
    headcount: r.headcount === null || r.headcount === undefined ? null : n(r.headcount as Num),
    subtotalCents: centsOrNull(r.subtotal_cents as Num), status: String(r.status ?? "not_rung_in_toast"),
  };
}

export interface EzcaterSummaryRaw {
  orders: Num; subtotal_cents: Num; amount_missing: Num; statuses: Record<string, Num>; orphan_checks: Num; orphan_cents: Num;
}
export interface EzcaterSummary {
  orders: number; subtotalCents: number; amountMissing: number;
  statuses: { matched: number; not_rung_in_toast: number; amount_mismatch: number };
  orphanChecks: number; orphanCents: number;
}
export function mergeEzcaterSummaries(raws: readonly EzcaterSummaryRaw[]): EzcaterSummary {
  const out: EzcaterSummary = { orders: 0, subtotalCents: 0, amountMissing: 0, statuses: { matched: 0, not_rung_in_toast: 0, amount_mismatch: 0 }, orphanChecks: 0, orphanCents: 0 };
  for (const r of raws) {
    out.orders += n(r.orders); out.subtotalCents += n(r.subtotal_cents); out.amountMissing += n(r.amount_missing);
    out.orphanChecks += n(r.orphan_checks); out.orphanCents += n(r.orphan_cents);
    for (const [k, v] of Object.entries(r.statuses ?? {})) if (k in out.statuses) out.statuses[k as keyof EzcaterSummary["statuses"]] += n(v);
  }
  return out;
}

/** Short, non-identifying reference for a server GUID with no Toast name (last 4 characters). */
export function serverRef(guid: string | null | undefined): string {
  return guid ? guid.slice(-4) : "";
}

export interface SalesSummaryDto {
  locationId: string;
  range: SalesRange;
  buckets: SalesBucket[];
  totals: SalesTotals;
  previous: SalesTotals | null;
  deltaPct: number | null;
  /** Explicit "today" only: when the latest completed capture of today finished (null = none yet). */
  capturedAt: string | null;
}
