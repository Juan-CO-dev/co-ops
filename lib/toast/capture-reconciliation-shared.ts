/** Pure quantity shadow. Money/refunds and depletion exclusions are deliberately absent. */
export interface CaptureSelection {
  check_guid: string;
  selection_guid: string;
  parent_selection_guid: string | null;
  item_guid: string;
  name: string;
  quantity: number;
  voided: boolean;
  deleted: boolean;
  ezcater_codes?: string[];
}
export interface LegacyCaptureSelection {
  check_guid: string;
  selection_guid: string;
  parent_selection_guid: string | null;
  toast_item_guid: string;
  item_name: string;
  quantity: number | string;
  snapshot_version: number;
  voided: boolean;
}
export interface QuantityCapture {
  order: { deleted: boolean; selection_units: CaptureSelection[] };
  checks: { check_guid: string; deleted: boolean }[];
}
export interface CaptureReconciliation {
  status: "match" | "mismatch" | "skipped";
  old_units: number | null;
  new_units: number | null;
  mismatched_items: { item_guid: string; name: string; old_qty: number; new_qty: number }[];
}
const key = (row: { check_guid: string; selection_guid: string }) => JSON.stringify([row.check_guid, row.selection_guid]);

export function reconcileCaptureQuantities(oldRows: LegacyCaptureSelection[], captures: QuantityCapture[]): CaptureReconciliation {
  // Versions advance independently PER SELECTION inside each check.
  const latest = new Map<string, LegacyCaptureSelection>();
  for (const row of oldRows) {
    const previous = latest.get(key(row));
    if (!previous || row.snapshot_version > previous.snapshot_version) latest.set(key(row), row);
  }
  const deletedChecks = new Set<string>();
  const deletedSelections = new Set<string>();
  const newRows = captures.flatMap(capture => {
    for (const check of capture.checks) if (capture.order.deleted || check.deleted) deletedChecks.add(check.check_guid);
    for (const row of capture.order.selection_units) if (row.deleted) deletedSelections.add(key(row));
    return capture.order.selection_units;
  });
  const totals = new Map<string, { item_guid: string; name: string; old_qty: number; new_qty: number }>();
  const add = (guid: string, name: string, quantity: number, side: "old_qty" | "new_qty") => {
    if (!Number.isFinite(quantity)) throw new Error("capture_reconciliation_invalid_quantity");
    const total = totals.get(guid) ?? { item_guid: guid, name, old_qty: 0, new_qty: 0 };
    total[side] += quantity;
    totals.set(guid, total);
  };
  for (const row of latest.values()) {
    if (row.voided || deletedChecks.has(row.check_guid) || deletedSelections.has(key(row))) continue;
    add(row.toast_item_guid, row.item_name, Number(row.quantity), "old_qty");
  }
  for (const row of newRows) {
    if (row.voided || row.deleted || deletedChecks.has(row.check_guid)) continue;
    add(row.item_guid, row.name, row.quantity, "new_qty");
  }
  const values = [...totals.values()].sort((a, b) => a.item_guid.localeCompare(b.item_guid));
  const mismatches = values.filter(row => Math.abs(row.old_qty - row.new_qty) > 1e-9);
  return {
    // Absence of legacy observations is not evidence of an empty sales day.
    status: oldRows.length === 0 ? "skipped" : mismatches.length ? "mismatch" : "match",
    old_units: oldRows.length === 0 ? null : values.reduce((sum, row) => sum + row.old_qty, 0),
    new_units: values.reduce((sum, row) => sum + row.new_qty, 0),
    mismatched_items: oldRows.length === 0 ? [] : mismatches.slice(0, 50),
  };
}
