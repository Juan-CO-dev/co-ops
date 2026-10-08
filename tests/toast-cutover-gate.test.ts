import { expect, it } from "vitest";
import { reconcileCutoverKeys, type GateLegacyRow } from "@/lib/toast/cutover-gate-shared";
import type { CapturedToastDay, CapturedToastOrder } from "@/lib/toast/captured-day";
const legacy = (id = "s", quantity = 1): GateLegacyRow => ({ check_guid: "c", selection_guid: id,
  parent_selection_guid: null, toast_item_guid: "item", quantity, voided: false, snapshot_version: 1, pulled_at: "2026-10-06T20:00:00Z" });
const order = (): CapturedToastOrder => ({ snapshotId: "snap", orderGuid: "o", modifiedAt: "2026-10-06T19:00:00Z", diningOptionGuid: null,
  diningOption: null, salesChannel: null, deleted: false, voided: false, excessFood: false,
  checks: [{ checkGuid: "c", amountCents: 100, deleted: false, voided: false }],
  selections: [{ check_guid: "c", selection_guid: "s", parent_selection_guid: null, item_guid: "item", name: "Synthetic", quantity: 1, voided: false, deleted: false }] });
const day = (orders = [order()]): CapturedToastDay => ({ orders, coverage: { runId: "run", finishedAt: "2026-10-07T09:00:00Z", orderCount: orders.length,
  missingPointerCount: 0, absenceRemovalApplied: false, configDegraded: false } });
it("matches latest legacy version per key and refuses cancelling errors", () => {
  const o = order(); o.selections.push({ ...o.selections[0]!, selection_guid: "s2", quantity: 2 });
  const result = reconcileCutoverKeys("2026-10-06", [legacy("s", 99), { ...legacy("s", 2), snapshot_version: 2 }, legacy("s2", 1)], day([o]));
  expect(result.unexplainedSharedKeyMismatches).toBe(2); expect(result.passed).toBe(false);
});
it("buckets removed selection with present-order evidence as phantom", () => {
  const o = order(); o.selections = [];
  expect(reconcileCutoverKeys("2026-10-06", [legacy()], day([o]))).toMatchObject({ passed: true, buckets: { phantom: 1 } });
});
it("blocks entire missing order unless reviewed absence rule supplies evidence", () => {
  const absent = day([]);
  expect(reconcileCutoverKeys("2026-10-06", [legacy()], absent)).toMatchObject({ passed: false, wholeOrderMissingWithoutEvidence: 1 });
  expect(reconcileCutoverKeys("2026-10-06", [legacy()], absent, { checkOrder: new Map([["c", "o"]]), removedOrders: new Set(["o"]) }))
    .toMatchObject({ passed: true, buckets: { phantom: 1 } });
});
it("requires matching identity/parent even when quantities match", () => {
  const o = order(); o.selections[0]!.item_guid = "other";
  expect(reconcileCutoverKeys("2026-10-06", [legacy()], day([o])).unexplainedSharedKeyMismatches).toBe(1);
});
it("separates note descendants from other missed lines", () => {
  const o = order(); o.selections[0]!.parent_selection_guid = "note-not-captured";
  expect(reconcileCutoverKeys("2026-10-06", [], day([o])).buckets["note-descendant"]).toBe(1);
  expect(reconcileCutoverKeys("2026-10-06", [], day()).buckets["legacy-missed"]).toBe(1);
});
it("explains source edits strictly after legacy pull", () => {
  const o = order(); o.modifiedAt = "2026-10-06T21:00:00Z"; o.selections[0]!.quantity = 8;
  expect(reconcileCutoverKeys("2026-10-06", [legacy()], day([o]))).toMatchObject({ passed: true, buckets: { "edited-after-legacy-pull": 1 } });
});
it("pre-overlap history checks completeness only and missing capture never passes", () => {
  expect(reconcileCutoverKeys("2026-07-22", [legacy()], day([]))).toMatchObject({ comparable: false, passed: true });
  expect(reconcileCutoverKeys("2026-07-22", [], null)).toMatchObject({ comparable: false, passed: false });
  expect(reconcileCutoverKeys("2026-10-06", [], null).passed).toBe(false);
});
