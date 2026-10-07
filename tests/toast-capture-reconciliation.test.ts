import { expect, it } from "vitest";
import { normalizeToastOrder } from "@/lib/toast/capture-shared";
import { reconcileCaptureQuantities, type LegacyCaptureSelection } from "@/lib/toast/capture-reconciliation-shared";

const day = "2026-10-06";
const item = (guid = "item", quantity = 2, extra = {}) => ({ guid, item: { guid }, displayName: guid, quantity, ...extra });
const capture = (selections = [item()], extra = {}, checkExtra = {}) => normalizeToastOrder({
  guid: "order", businessDate: 20261006, ...extra, checks: [{ guid: "check", selections, ...checkExtra }],
}, day);
const legacy = (extra: Partial<LegacyCaptureSelection> = {}): LegacyCaptureSelection => ({
  check_guid: "check", selection_guid: "item", parent_selection_guid: null, toast_item_guid: "item",
  item_name: "item", quantity: 2, snapshot_version: 1, voided: false, ...extra,
});

it("matches exact item and recursive modifier quantities using latest version per selection within a check", () => {
  const row = capture([item("item", 2, { modifiers: [item("mod", 3, { modifiers: [item("nested", 1)] })] })]);
  const old = [legacy({ quantity: 9 }), legacy({ snapshot_version: 2 }),
    legacy({ selection_guid: "mod", parent_selection_guid: "item", toast_item_guid: "mod", quantity: 3 }),
    legacy({ selection_guid: "nested", parent_selection_guid: "mod", toast_item_guid: "nested", quantity: 1 })];
  expect(reconcileCaptureQuantities(old.reverse(), [row])).toEqual({ status: "match", old_units: 6, new_units: 6, mismatched_items: [] });
});
it("reports a missing item", () => {
  expect(reconcileCaptureQuantities([legacy()], [capture([])])).toMatchObject({ status: "mismatch", mismatched_items: [{ item_guid: "item", old_qty: 2, new_qty: 0 }] });
});
it("reports an extra item", () => {
  expect(reconcileCaptureQuantities([legacy()], [capture([item(), item("extra", 1)])])).toMatchObject({ status: "mismatch", mismatched_items: [{ item_guid: "extra", old_qty: 0, new_qty: 1 }] });
});
it("reports modifier differences even when total units match", () => {
  const old = [legacy(), legacy({ selection_guid: "mod", toast_item_guid: "mod", parent_selection_guid: "item", quantity: 1 })];
  const result = reconcileCaptureQuantities(old, [capture([item("item", 1, { modifiers: [item("mod", 2)] })])]);
  expect(result).toMatchObject({ status: "mismatch", old_units: 3, new_units: 3 });
  expect(result.mismatched_items).toHaveLength(2);
});
it.each(["order", "check", "selection"])("excludes voided %s and its modifier subtree", scope => {
  const row = capture([item("item", 2, { voided: scope === "selection", modifiers: [item("mod", 1)] })],
    { voided: scope === "order" }, { voided: scope === "check" });
  expect(reconcileCaptureQuantities([legacy({ voided: true }), legacy({ selection_guid: "mod", toast_item_guid: "mod", quantity: 1, voided: true })], [row]))
    .toMatchObject({ status: "match", old_units: 0, new_units: 0 });
});
it.each(["order", "check", "selection"])("excludes deleted %s using capture markers on the legacy side too", scope => {
  const row = capture([item("item", 2, { deleted: scope === "selection", modifiers: [item("mod", 1)] })],
    { deleted: scope === "order" }, { deleted: scope === "check" });
  expect(reconcileCaptureQuantities([legacy(), legacy({ selection_guid: "mod", toast_item_guid: "mod", quantity: 1 })], [row]))
    .toMatchObject({ status: "match", old_units: 0, new_units: 0 });
});
it("ignores later refund-day money noise without subtracting physical units", () => {
  const row = capture([item()], {}, { payments: [{ guid: "payment", refundStatus: "FULL", refund: { refundAmount: 20, refundBusinessDate: 20261007 } }] });
  expect(row.payments[0]?.refund_business_date).toBe("2026-10-07");
  expect(reconcileCaptureQuantities([legacy()], [row])).toMatchObject({ status: "match", old_units: 2, new_units: 2 });
});
it("does not certify an absent legacy baseline as a match", () => {
  expect(reconcileCaptureQuantities([], [capture([])])).toEqual({ status: "skipped", old_units: null, new_units: 0, mismatched_items: [] });
});
it("caps item detail at 50 while totals include every mismatch", () => {
  const rows = Array.from({ length: 60 }, (_, i) => legacy({ selection_guid: `s${i}`, toast_item_guid: `i${i}` }));
  const result = reconcileCaptureQuantities(rows, [capture([])]);
  expect(result.mismatched_items).toHaveLength(50);
  expect(result.old_units).toBe(120);
});
it("keeps checks distinct and compares fractional numeric strings without rounding noise", () => {
  expect(reconcileCaptureQuantities([legacy({ quantity: "0.3" }), legacy({ check_guid: "other", quantity: "0" })],
    [capture([item("item", 0.1 + 0.2)])]).status).toBe("match");
});
it("captures order provider names without retaining provider payloads", () => {
  expect(capture([], { thirdPartyProviderInfo: { provider: "DoorDash", customerName: "PRIVATE" } }).order)
    .toMatchObject({ third_party_provider_name: "DoorDash" });
  expect(JSON.stringify(capture([], { thirdPartyProviderInfo: { providerName: "Uber Eats", customerName: "PRIVATE" } }))).not.toContain("PRIVATE");
});
