/**
 * Mid-shift sales pulse — PURE aggregation math (client-safe, zero I/O).
 * Council 2026-07-31: the pulse's sales lanes read `toast_sales_events`
 * directly (never the depletion ledger, never deriveSalesConsumption — the
 * double-count law keeps drift ledger-side and display event-side).
 *
 * Ledger semantics this module encodes (from lib/catering/toast-sales.ts):
 *   - rows are APPEND-ONLY snapshot-versioned per (check_guid, selection_guid);
 *     only the LATEST snapshot_version of each selection is current truth.
 *   - price_cents is Toast's selection price — the EXTENDED line price
 *     (quantity already included). Net $ = SUM(price_cents), never × quantity.
 *   - modifiers are child selections (parent_selection_guid != null) carrying
 *     their own upcharge price_cents → included in net $, excluded from
 *     top-items (an item count, not an upcharge count).
 *   - voided latest-versions are excluded everywhere.
 */

export interface SalesEventRow {
  business_date: string;
  check_guid: string;
  selection_guid: string;
  parent_selection_guid: string | null;
  item_name: string;
  quantity: number;
  price_cents: number | null;
  voided: boolean;
  snapshot_version: number;
}

export interface DaySalesAgg {
  businessDate: string;
  /** Sum of latest non-void selection prices (item gross, pre-tax/discount). */
  netCents: number;
  /** Distinct checks with at least one non-void latest selection. */
  checks: number;
  /** netCents / checks; null when no checks. */
  avgTicketCents: number | null;
}

export interface TopItem {
  name: string;
  qty: number;
}

/** Latest snapshot_version per (check, selection) for ONE business date's rows. */
export function reduceLatestSelections(rows: SalesEventRow[]): SalesEventRow[] {
  const latest = new Map<string, SalesEventRow>();
  for (const r of rows) {
    const key = `${r.check_guid}:${r.selection_guid}`;
    const cur = latest.get(key);
    if (!cur || r.snapshot_version > cur.snapshot_version) latest.set(key, r);
  }
  return [...latest.values()];
}

/** Aggregate one business date's rows (pass ALL versions; reduced internally). */
export function aggregateDaySales(businessDate: string, rows: SalesEventRow[]): DaySalesAgg {
  const live = reduceLatestSelections(rows).filter((r) => !r.voided);
  let netCents = 0;
  const checks = new Set<string>();
  for (const r of live) {
    netCents += r.price_cents ?? 0;
    checks.add(r.check_guid);
  }
  const n = checks.size;
  return {
    businessDate,
    netCents,
    checks: n,
    avgTicketCents: n > 0 ? Math.round(netCents / n) : null,
  };
}

/** Top sellers for one date: TOP-LEVEL (parent null) non-void latest selections,
 *  grouped by display name, summed quantity, descending. */
export function topItemsForDay(rows: SalesEventRow[], limit: number): TopItem[] {
  const live = reduceLatestSelections(rows).filter((r) => !r.voided && r.parent_selection_guid == null);
  const byName = new Map<string, number>();
  for (const r of live) byName.set(r.item_name, (byName.get(r.item_name) ?? 0) + r.quantity);
  return [...byName.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Y-M-D calendar arithmetic (UTC-safe on the date string; no tz involvement). */
export function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + delta));
  return dt.toISOString().slice(0, 10);
}

/** The trailing same-weekday dates for the pace baseline: [t-7, t-14, …]. */
export function sameWeekdayBaselineDates(todayYmd: string, weeks: number): string[] {
  return Array.from({ length: weeks }, (_, i) => addDaysYmd(todayYmd, -7 * (i + 1)));
}

/** Percent delta of `current` vs `baseline` in whole percent, null when the
 *  baseline can't support a comparison (zero/negative). */
export function pctDelta(current: number, baseline: number): number | null {
  if (baseline <= 0) return null;
  return Math.round(((current - baseline) / baseline) * 100);
}
