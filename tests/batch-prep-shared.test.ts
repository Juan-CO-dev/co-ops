/**
 * Unit spine — batch vs bottle pure core (lib/batch-prep-shared.ts; plan S r4, Phase A).
 *
 * Ruling B arithmetic, the minimum-batch rule, the over-batch reason gate (Juan addendum 2:
 * ALWAYS when batches > minimum; one tap from four codes; only `other` needs a note), the
 * NULL refusals the RPCs mirror (ruling G), the stepper's whole-number rule and typo guard,
 * the two-box recount total, eligibility, shelf life, and the reject-whole parser of the
 * stored batch object.
 */
import { describe, expect, it } from "vitest";

import {
  BATCH_STEPPER_MAX,
  OVER_BATCH_REASON_CODES,
  availableForLine,
  backupAfter,
  batchEligibility,
  defaultCameOutTo,
  isOverBatch,
  isPastShelfLife,
  minBatches,
  needForLine,
  needsTypoGuard,
  parseBatchRecord,
  readBatchFromPrepData,
  recountTotal,
  toBatchPayload,
  validateBatchEntry,
  validateOverBatchReason,
} from "@/lib/batch-prep-shared";

describe("ruling B arithmetic", () => {
  it("need_for_line = max(0, par − LINE); null when either is unknown", () => {
    expect(needForLine(10, 2)).toBe(8);
    expect(needForLine(10, 12)).toBe(0);
    expect(needForLine(null, 2)).toBeNull();
    expect(needForLine(10, null)).toBeNull();
  });
  it("available = before − tossed + came_out_to; backup_after = available − bottled", () => {
    expect(availableForLine(8, 0, 4)).toBe(12);
    expect(availableForLine(8, 8, 4)).toBe(4);
    expect(backupAfter(8, 0, 4, 6)).toBe(6);
    expect(backupAfter(8, 8, 4, 4)).toBe(0);
  });
  it("minimum batches: 0 when the counted bulk covers the need, else ceil((need − bulk) / yield); null need → null", () => {
    expect(minBatches(6, 8, 0, 4)).toBe(0);
    expect(minBatches(6, 2, 0, 4)).toBe(1);
    expect(minBatches(6, 0, 0, 4)).toBe(2);
    expect(minBatches(6, 8, 8, 4)).toBe(2); // a toss removes the bulk from the equation
    expect(minBatches(6, 2, 0, 2.25)).toBe(2); // fractional yields (HC Aioli) still whole batches
    expect(minBatches(null, 2, 0, 4)).toBeNull();
    expect(minBatches(6, 2, 0, 0)).toBeNull();
  });
  it("over-batch = batches above the minimum; never when the minimum is unknown", () => {
    expect(isOverBatch(2, 1)).toBe(true);
    expect(isOverBatch(1, 1)).toBe(false);
    expect(isOverBatch(3, null)).toBe(false);
  });
  it("the stepper is 0..3; above it the row asks once; the pre-fill is batches × yield", () => {
    expect(BATCH_STEPPER_MAX).toBe(3);
    expect(needsTypoGuard(3)).toBe(false);
    expect(needsTypoGuard(4)).toBe(true);
    expect(defaultCameOutTo(2, 4)).toBe(8);
    expect(defaultCameOutTo(3, 2.25)).toBeCloseTo(6.75, 10);
  });
  it("two-box recount total = line + back up, only when BOTH are present and non-negative", () => {
    expect(recountTotal(2, 8)).toBe(10);
    expect(recountTotal(2, null)).toBeNull();
    expect(recountTotal(null, 8)).toBeNull();
    expect(recountTotal(-1, 8)).toBeNull();
  });
});

describe("over-batch reason (addendum 2)", () => {
  it("is one of four codes; only `other` needs a note; a blank note is no note", () => {
    expect([...OVER_BATCH_REASON_CODES]).toEqual(["catering_order", "busy_day_expected", "prepping_ahead", "other"]);
    expect(validateOverBatchReason(null)).toEqual({ ok: true, reason: null });
    expect(validateOverBatchReason({ code: "catering_order" })).toEqual({ ok: true, reason: { code: "catering_order", note: null } });
    expect(validateOverBatchReason({ code: "other", note: "  " })).toEqual({ ok: false, code: "over_batch_note_required" });
    expect(validateOverBatchReason({ code: "other", note: "Pete asked" })).toEqual({ ok: true, reason: { code: "other", note: "Pete asked" } });
    expect(validateOverBatchReason({ code: "management_directive" })).toEqual({ ok: false, code: "invalid_over_batch_reason" });
    expect(validateOverBatchReason("other")).toEqual({ ok: false, code: "invalid_over_batch_reason" });
  });
});

describe("validateBatchEntry — the RPC's gates, in the RPC's order (ruling G + addendum 2)", () => {
  const ctx = { bottled: 6, backupBefore: 2, need: 6, yieldPerBatch: 4 };
  it("accepts the minimum batch with its pre-fill and returns the server numbers", () => {
    const r = validateBatchEntry({ batches: 1, cameOutTo: 4, tossed: 0, overBatchReason: null }, ctx);
    expect(r).toEqual({ ok: true, entry: { batches: 1, cameOutTo: 4, tossed: 0, overBatchReason: null }, minBatches: 1, backupAfter: 0 });
  });
  it("refuses a missing / null / fractional / negative batches count", () => {
    expect(validateBatchEntry({ batches: null, cameOutTo: 4, tossed: 0, overBatchReason: null }, ctx)).toEqual({ ok: false, code: "batches_missing" });
    expect(validateBatchEntry({ batches: 1.5, cameOutTo: 4, tossed: 0, overBatchReason: null }, ctx)).toEqual({ ok: false, code: "invalid_batch_count" });
    expect(validateBatchEntry({ batches: -1, cameOutTo: 4, tossed: 0, overBatchReason: null }, ctx)).toEqual({ ok: false, code: "invalid_batch_count" });
  });
  it("came_out_to is required when batches > 0 and must be 0/absent when batches = 0", () => {
    expect(validateBatchEntry({ batches: 1, cameOutTo: null, tossed: 0, overBatchReason: null }, ctx)).toEqual({ ok: false, code: "came_out_to_missing" });
    expect(validateBatchEntry({ batches: 1, cameOutTo: -2, tossed: 0, overBatchReason: null }, ctx)).toEqual({ ok: false, code: "invalid_came_out_to" });
    expect(validateBatchEntry({ batches: 0, cameOutTo: 3, tossed: 0, overBatchReason: null }, { ...ctx, bottled: 2 })).toEqual({ ok: false, code: "invalid_came_out_to" });
    const zero = validateBatchEntry({ batches: 0, cameOutTo: null, tossed: 0, overBatchReason: null }, { ...ctx, bottled: 2 });
    expect(zero.ok && zero.entry.cameOutTo).toBe(0);
  });
  it("tossed must be within the counted backup; bottled within what is available", () => {
    expect(validateBatchEntry({ batches: 1, cameOutTo: 4, tossed: 3, overBatchReason: null }, ctx)).toEqual({ ok: false, code: "tossed_exceeds_backup" });
    expect(validateBatchEntry({ batches: 1, cameOutTo: 4, tossed: 0, overBatchReason: null }, { ...ctx, bottled: 7 })).toEqual({ ok: false, code: "bottled_exceeds_available" });
    expect(validateBatchEntry({ batches: 1, cameOutTo: 4, tossed: 0, overBatchReason: null }, { ...ctx, bottled: null })).toEqual({ ok: false, code: "bottled_missing" });
  });
  it("a ruined batch is honest: batches 1, came out to 0 depletes a batch and credits nothing", () => {
    const r = validateBatchEntry({ batches: 1, cameOutTo: 0, tossed: 0, overBatchReason: null }, { ...ctx, bottled: 2 });
    expect(r.ok && r.backupAfter).toBe(0);
  });
  it("the over-batch reason is ALWAYS required above the minimum; bottling from backup alone never asks", () => {
    expect(validateBatchEntry({ batches: 2, cameOutTo: 8, tossed: 0, overBatchReason: null }, ctx)).toEqual({ ok: false, code: "over_batch_reason_missing" });
    const ok = validateBatchEntry({ batches: 2, cameOutTo: 8, tossed: 0, overBatchReason: { code: "busy_day_expected", note: null } }, ctx);
    expect(ok.ok && ok.minBatches).toBe(1);
    expect(validateBatchEntry({ batches: 2, cameOutTo: 8, tossed: 0, overBatchReason: { code: "other", note: "" } }, ctx)).toEqual({ ok: false, code: "over_batch_note_required" });
    // No batch made, bottling 2 of a counted 8: no reason, no gate.
    const bottleOnly = validateBatchEntry({ batches: 0, cameOutTo: null, tossed: 0, overBatchReason: null }, { bottled: 2, backupBefore: 8, need: 2, yieldPerBatch: 4 });
    expect(bottleOnly.ok && bottleOnly.minBatches).toBe(0);
  });
  it("a par-null item has no minimum, so no over-batch gate", () => {
    const r = validateBatchEntry({ batches: 3, cameOutTo: 12, tossed: 0, overBatchReason: null }, { ...ctx, need: null });
    expect(r.ok && r.minBatches).toBeNull();
  });
  it("serialises to the RPC's p_batch shape", () => {
    expect(toBatchPayload({ batches: 2, cameOutTo: 7, tossed: 1, overBatchReason: { code: "prepping_ahead", note: null } }))
      .toEqual({ batches: 2, came_out_to: 7, tossed: 1, over_batch_reason: { code: "prepping_ahead", note: null } });
    expect(toBatchPayload({ batches: 0, cameOutTo: null, tossed: 0, overBatchReason: null }).came_out_to).toBe(0);
  });
});

describe("eligibility and shelf life", () => {
  it("batch_mode false = single box always; true needs exactly one output, a yield and a resolvable recipe, else BLOCKED", () => {
    expect(batchEligibility({ batchMode: false, outputCount: 3, yieldPerBatch: null, resolvable: false })).toBe("single_box");
    expect(batchEligibility({ batchMode: true, outputCount: 1, yieldPerBatch: 4, resolvable: true })).toBe("batched");
    expect(batchEligibility({ batchMode: true, outputCount: 2, yieldPerBatch: 4, resolvable: true })).toBe("blocked");
    expect(batchEligibility({ batchMode: true, outputCount: 1, yieldPerBatch: null, resolvable: true })).toBe("blocked");
    expect(batchEligibility({ batchMode: true, outputCount: 1, yieldPerBatch: 4, resolvable: false })).toBe("blocked");
  });
  it("past shelf life only when the age exceeds shelf_life_days; unknown made-on never flags", () => {
    expect(isPastShelfLife("2026-10-01", 5, "2026-10-07")).toBe(true);
    expect(isPastShelfLife("2026-10-02", 5, "2026-10-07")).toBe(false);
    expect(isPastShelfLife(null, 5, "2026-10-07")).toBe(false);
    expect(isPastShelfLife("2026-10-01T09:12:00.000Z", 5, "2026-10-07T06:00:00.000Z")).toBe(true);
  });
});

describe("parseBatchRecord / readBatchFromPrepData — reject whole", () => {
  const stored = {
    batches: 2, came_out_to: "7.5", bottled: 6, tossed: 0, backup_before: 2, backup_after: 3.5,
    line_count: 4, need_for_line: 6, min_batches: 1, yield_at_time: 4, recipe_id: "r1",
    over_batch_reason: { code: "catering_order", note: null }, produced_at: "2026-10-07T12:00:00.000Z",
    made_by: "u1", phase1_prep_need: 8,
  };
  it("reads numeric strings as numbers and the reason through the same validator", () => {
    const r = parseBatchRecord(stored);
    expect(r?.cameOutTo).toBe(7.5);
    expect(r?.overBatchReason).toEqual({ code: "catering_order", note: null });
    expect(r?.madeBy).toBe("u1");
  });
  it("is null when any load-bearing number is missing", () => {
    expect(parseBatchRecord({ ...stored, backup_after: undefined })).toBeNull();
    expect(parseBatchRecord({ ...stored, bottled: "x" })).toBeNull();
    expect(parseBatchRecord(null)).toBeNull();
    expect(parseBatchRecord([])).toBeNull();
  });
  it("finds the object under phase2 (opening) or as a sibling key (mid-day); absent = single-box row", () => {
    expect(readBatchFromPrepData({ phase2: { opener_prepped: 6, batch: stored } })?.batches).toBe(2);
    expect(readBatchFromPrepData({ inputs: { total: 6 }, snapshot: {}, batch: stored })?.batches).toBe(2);
    expect(readBatchFromPrepData({ phase2: { opener_prepped: 6 } })).toBeNull();
    expect(readBatchFromPrepData({ inputs: { total: 6 }, snapshot: {} })).toBeNull();
  });
});
