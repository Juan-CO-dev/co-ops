import type { CapturedToastOrder } from "@/lib/toast/captured-day";

export interface DepletionLink { toast_snapshot_id: string; toast_order_guid: string; check_guid: string }
/** Check identity includes snapshot and order, so stale links cannot eat a new ring. */
export const depletionCheckKey = (snapshot: string, order: string, check: string): string =>
  JSON.stringify([snapshot, order, check]);

export function reconciledToastOrders(orders: CapturedToastOrder[], links: DepletionLink[]): CapturedToastOrder[] {
  const excluded = new Set(links.map((link) => depletionCheckKey(link.toast_snapshot_id, link.toast_order_guid, link.check_guid)));
  return orders.map((order) => ({ ...order,
    // Unlinked ezCater rings remain sales even if channel configuration says catering.
    salesChannel: order.diningOption?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() === "ezcater" ? null : order.salesChannel,
    selections: order.selections.filter((selection) => !excluded.has(depletionCheckKey(order.snapshotId, order.orderGuid, selection.check_guid))),
    checks: order.checks.filter((check) => !excluded.has(depletionCheckKey(order.snapshotId, order.orderGuid, check.checkGuid))),
  }));
}
