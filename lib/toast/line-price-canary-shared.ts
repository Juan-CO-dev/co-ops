/** Item 1 PR B canary classifier (plan r3 §4 step 3). Pure, zero I/O.
 * For one shop-day: every order Toast returns today, normalized with line prices ON, against what
 * toast_orders already stores for that order. The gate is ZERO orders whose hash is absent while the
 * order's LATEST stored modified_at equals Toast's modifiedDate — that would be a snapshot created by
 * line prices alone, i.e. the hash claim proven wrong. An absent hash with a different modified_at is
 * a real Toast edit. A day with fewer than CANARY_MIN_ORDERS orders does not count. */
export const CANARY_MIN_ORDERS = 50;

export interface CanaryFetchedOrder { order_guid: string; content_hash: string; modified_at: string | null }
export interface CanaryStoredSnapshot { id: string; order_guid: string; content_hash: string; modified_at: string | null; latest: boolean }
export interface CanaryDay {
  orders: number;
  present: number;
  absent_edited: number;
  absent_never_captured: number;
  absent_null_modified: number;
  absent_same_modified: number;
  violations: string[];
  null_modified_review: string[];
  representative: boolean;
  pass: boolean;
}

const instant = (v: string | null): number | null => { if (v == null) return null; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };

export function classifyCanaryDay(fetched: CanaryFetchedOrder[], stored: CanaryStoredSnapshot[]): CanaryDay {
  const byOrder = new Map<string, CanaryStoredSnapshot[]>();
  for (const s of stored) byOrder.set(s.order_guid, [...(byOrder.get(s.order_guid) ?? []), s]);
  const day: CanaryDay = { orders: fetched.length, present: 0, absent_edited: 0, absent_never_captured: 0, absent_null_modified: 0,
    absent_same_modified: 0, violations: [], null_modified_review: [], representative: fetched.length >= CANARY_MIN_ORDERS, pass: false };
  for (const order of fetched) {
    const snapshots = byOrder.get(order.order_guid) ?? [];
    if (snapshots.some((s) => s.content_hash === order.content_hash)) { day.present++; continue; }
    const latest = snapshots.find((s) => s.latest);
    if (!latest) { day.absent_never_captured++; continue; }
    const [mine, theirs] = [instant(order.modified_at), instant(latest.modified_at)];
    if (mine === null || theirs === null) { day.absent_null_modified++; day.null_modified_review.push(order.order_guid); continue; }
    if (mine === theirs) { day.absent_same_modified++; day.violations.push(order.order_guid); continue; }
    day.absent_edited++;
  }
  day.pass = day.representative && day.absent_same_modified === 0;
  return day;
}
