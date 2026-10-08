import type { CapturedToastDay } from "./captured-day";
export interface GateLegacyRow {
  check_guid: string; selection_guid: string; parent_selection_guid: string | null;
  toast_item_guid: string; quantity: number | string; voided: boolean; snapshot_version: number; pulled_at: string;
}
export const OVERLAP_FROM = "2026-07-23";
export const OVERLAP_THROUGH = "2026-10-06";
const key = (check: string, selection: string) => JSON.stringify([check, selection]);

/** Per-key reasons precede aggregation: opposing quantity errors cannot cancel.
 * Legacy has no order GUID, so missing checks need historical check->order evidence.
 * A whole absent order is blocking unless CC enabled complete-run absence removal. */
export function reconcileCutoverKeys(date: string, legacyRows: readonly GateLegacyRow[], day: CapturedToastDay | null,
  evidence: { checkOrder?: ReadonlyMap<string, string>; removedOrders?: ReadonlySet<string> } = {}) {
  const comparable = date >= OVERLAP_FROM && date <= OVERLAP_THROUGH;
  const buckets = { match: 0, phantom: 0, "legacy-missed": 0, "note-descendant": 0, "edited-after-legacy-pull": 0 };
  let unexplainedSharedKeyMismatches = 0;
  const missingOrders = new Set<string>();
  if (!day || !comparable) return { comparable, coverageComplete: day !== null, buckets,
    wholeOrderMissingWithoutEvidence: 0, unexplainedSharedKeyMismatches: 0, passed: day !== null };
  const legacy = new Map<string, GateLegacyRow>();
  for (const row of legacyRows) {
    const k = key(row.check_guid, row.selection_guid), old = legacy.get(k);
    if (!old || row.snapshot_version > old.snapshot_version) legacy.set(k, row);
  }
  const captured = new Map<string, { item: string; parent: string | null; quantity: number; voided: boolean;
    removed: boolean; editedAt: string | null; noteDescendant: boolean }>();
  const checkOrder = new Map(evidence.checkOrder);
  const presentOrders = new Set(day.orders.map((order) => order.orderGuid));
  for (const order of day.orders) {
    const checkById = new Map(order.checks.map((check) => [check.checkGuid, check]));
    for (const check of order.checks) checkOrder.set(check.checkGuid, order.orderGuid);
    const keys = new Set(order.selections.map((row) => key(row.check_guid, row.selection_guid)));
    for (const row of order.selections) {
      const check = checkById.get(row.check_guid);
      const removed = order.deleted || order.excessFood || row.deleted || check?.deleted === true;
      captured.set(key(row.check_guid, row.selection_guid), { item: row.item_guid,
        parent: row.parent_selection_guid, quantity: row.quantity,
        voided: order.voided || row.voided || check?.voided === true,
        removed, editedAt: order.modifiedAt,
        noteDescendant: row.parent_selection_guid !== null && !keys.has(key(row.check_guid, row.parent_selection_guid)) });
    }
  }
  for (const [k, row] of legacy) {
    const next = captured.get(k);
    if (!next) {
      const owner = checkOrder.get(row.check_guid);
      if (row.voided || (owner && (presentOrders.has(owner) || evidence.removedOrders?.has(owner)))) buckets.phantom++;
      else missingOrders.add(owner ?? `check:${row.check_guid}`);
      continue;
    }
    const same = row.toast_item_guid === next.item && row.parent_selection_guid === next.parent
      && Number.isFinite(Number(row.quantity)) && Math.abs(Number(row.quantity) - next.quantity) <= 1e-9
      && row.voided === next.voided && !next.removed;
    if (same) buckets.match++;
    else if (next.removed || (!row.voided && next.voided)) buckets.phantom++;
    else if (next.editedAt && Date.parse(next.editedAt) > Date.parse(row.pulled_at)) buckets["edited-after-legacy-pull"]++;
    else unexplainedSharedKeyMismatches++;
  }
  for (const [k, row] of captured) {
    if (legacy.has(k) || row.voided || row.removed) continue;
    buckets[row.noteDescendant ? "note-descendant" : "legacy-missed"]++;
  }
  return { comparable, coverageComplete: true, buckets,
    wholeOrderMissingWithoutEvidence: missingOrders.size, unexplainedSharedKeyMismatches,
    passed: missingOrders.size === 0 && unexplainedSharedKeyMismatches === 0 };
}
