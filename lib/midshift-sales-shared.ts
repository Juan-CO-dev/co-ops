/**
 * Mid-shift sales pulse — PURE aggregation math (client-safe, zero I/O).
 * Capture check amounts provide money; normalized capture selections provide
 * top-item quantities. Selection prices never supply the live pulse's money.
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
  /** Net check amount pre-tax in the capture pulse. */
  netCents: number;
  /** Capture-only top-level item units; modifiers never inflate this count. */
  units?: number;
  /** Live check count. */
  checks: number;
  /** netCents / checks; null when no checks. */
  avgTicketCents: number | null;
}

export interface TopItem {
  name: string;
  qty: number;
}

/** Top sellers for one date: TOP-LEVEL (parent null) non-void normalized capture selections,
 *  grouped by display name, summed quantity, descending. */
export function topItemsForDay(rows: SalesEventRow[], limit: number): TopItem[] {
  const live = rows.filter((r) => !r.voided && r.parent_selection_guid == null);
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
