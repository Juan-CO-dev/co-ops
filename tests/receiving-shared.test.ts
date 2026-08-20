/**
 * Unit spine — lib/receiving-shared.ts pure math (zero I/O, no server imports).
 * Pins: credit derivation for short/over/damaged/substitution lines, qty-delta
 * arithmetic, amount-cents derivation from intake price (spec D1), and the
 * addDeliveryLines double-submit multiset guard (isDuplicateAppend), and the
 * offline intake-draft shelf (one slot per vendor, newest first, capped).
 */
import { describe, it, expect } from "vitest";
import {
  deriveCreditDrafts,
  deriveMissingCreditDrafts,
  findVendorMismatch,
  isDuplicateAppend,
  upsertIntakeDraft,
  removeIntakeDraft,
  INTAKE_DRAFT_CAP,
  type AppendLine,
  type IntakeLineForCredits,
  type SkuVendorBinding,
} from "../lib/receiving-shared";

const line = (over: Partial<IntakeLineForCredits>): IntakeLineForCredits => ({
  deliveryItemId: "item-1",
  skuId: "sku-1",
  qtyReceived: 5,
  expectedQty: 5,
  unitPrice: 12.5,
  discrepancyType: null,
  ...over,
});

describe("deriveCreditDrafts", () => {
  it("returns nothing for clean lines", () => {
    expect(deriveCreditDrafts([line({})])).toEqual([]);
  });

  it("derives a short credit with qty = expected - received and amount from intake price", () => {
    const [c] = deriveCreditDrafts([
      line({ qtyReceived: 3, discrepancyType: "short" }),
    ]);
    expect(c).toMatchObject({
      deliveryItemId: "item-1",
      reason: "short",
      qty: 2,
      amountCents: 2500,
    });
  });

  it("flags with no qty delta still produce a credit with null qty (damaged whole-line judgment)", () => {
    const [c] = deriveCreditDrafts([line({ discrepancyType: "damaged" })]);
    expect(c).toMatchObject({ reason: "damaged", qty: null, amountCents: null });
  });

  it("never derives negative qty (over-delivery credit carries the overage qty)", () => {
    const [c] = deriveCreditDrafts([
      line({ qtyReceived: 8, discrepancyType: "over" }),
    ]);
    expect(c).toMatchObject({ reason: "over", qty: 3 });
  });

  it("null expectedQty (added line) with a flag produces a null-qty credit", () => {
    const [c] = deriveCreditDrafts([
      line({ expectedQty: null, discrepancyType: "substitution" }),
    ]);
    expect(c).toMatchObject({ reason: "substitution", qty: null });
  });

  it("amountCents is null when unitPrice missing", () => {
    const [c] = deriveCreditDrafts([
      line({ qtyReceived: 3, discrepancyType: "short", unitPrice: null }),
    ]);
    expect(c?.amountCents).toBeNull();
  });
});

describe("deriveMissingCreditDrafts", () => {
  it("credits the WHOLE expected qty (nothing arrived) at the intake price", () => {
    const [c] = deriveMissingCreditDrafts([
      { skuId: "sku-9", expectedQty: 4, unitPrice: 12.5 },
    ]);
    expect(c).toMatchObject({ skuId: "sku-9", reason: "short", qty: 4, amountCents: 5000 });
  });

  it("leaves amountCents null when no intake price was entered (advisory, never fabricated)", () => {
    const [c] = deriveMissingCreditDrafts([
      { skuId: "sku-9", expectedQty: 4, unitPrice: null },
    ]);
    expect(c).toMatchObject({ qty: 4, amountCents: null });
  });

  it("carries no delivery_item_id — these credits have no line by construction", () => {
    const [c] = deriveMissingCreditDrafts([{ skuId: "s", expectedQty: 1, unitPrice: null }]);
    expect(c?.deliveryItemId).toBe("");
  });

  it("empty input → no drafts", () => {
    expect(deriveMissingCreditDrafts([])).toEqual([]);
  });
});

describe("isDuplicateAppend", () => {
  const l = (skuId: string, level: string | null, qty: number): AppendLine => ({ skuId, level, qty });

  it("exact multiset match → true (retry of the identical batch)", () => {
    const batch = [l("sku-1", "case", 2), l("sku-2", null, 5)];
    // different array order, same tuples + counts → still an exact multiset match
    const recent = [l("sku-2", null, 5), l("sku-1", "case", 2)];
    expect(isDuplicateAppend(batch, recent)).toBe(true);
  });

  it("differing qty → false", () => {
    const batch = [l("sku-1", "case", 2)];
    const recent = [l("sku-1", "case", 3)];
    expect(isDuplicateAppend(batch, recent)).toBe(false);
  });

  it("subset → false (incoming smaller than recent)", () => {
    const batch = [l("sku-1", "case", 2)];
    const recent = [l("sku-1", "case", 2), l("sku-2", null, 5)];
    expect(isDuplicateAppend(batch, recent)).toBe(false);
  });

  it("empty recent → false (nothing appended in the window)", () => {
    expect(isDuplicateAppend([l("sku-1", "case", 2)], [])).toBe(false);
  });
});

describe("intake draft shelf", () => {
  const d = (vendorId: string, startedAt: string, savedAt = startedAt) => ({
    vendorId,
    startedAt,
    savedAt,
  });

  it("prepends a new draft — newest first", () => {
    const shelf = upsertIntakeDraft([d("v-1", "t1")], d("v-2", "t2"));
    expect(shelf.map((x) => x.vendorId)).toEqual(["v-2", "v-1"]);
  });

  it("replaces the same vendor's slot instead of duplicating it", () => {
    // The live intake saves every 500 ms; each save must land in ONE slot.
    const shelf = [d("v-1", "t1", "s1")]
      .reduce((acc, x) => upsertIntakeDraft(acc, x), [] as ReturnType<typeof d>[]);
    const after = upsertIntakeDraft(upsertIntakeDraft(shelf, d("v-1", "t1", "s2")), d("v-1", "t1", "s3"));
    expect(after).toHaveLength(1);
    expect(after[0]?.savedAt).toBe("s3");
  });

  it("replaces by vendor even when startedAt differs (a fresh intake for that vendor)", () => {
    const after = upsertIntakeDraft([d("v-1", "t1")], d("v-1", "t9"));
    expect(after).toEqual([d("v-1", "t9")]);
  });

  it("keeps DIFFERENT vendors side by side — the two-trucks-one-hour case", () => {
    const shelf = upsertIntakeDraft(upsertIntakeDraft([], d("v-1", "t1")), d("v-2", "t2"));
    expect(shelf.map((x) => x.vendorId).sort()).toEqual(["v-1", "v-2"]);
  });

  it("caps the shelf, dropping the oldest", () => {
    const shelf = [d("v-1", "t1"), d("v-2", "t2"), d("v-3", "t3"), d("v-4", "t4")].reduce(
      (acc, x) => upsertIntakeDraft(acc, x),
      [] as ReturnType<typeof d>[],
    );
    expect(shelf).toHaveLength(INTAKE_DRAFT_CAP);
    expect(shelf.map((x) => x.vendorId)).toEqual(["v-4", "v-3", "v-2"]);
  });

  it("does not mutate the input shelf", () => {
    const shelf = [d("v-1", "t1")];
    upsertIntakeDraft(shelf, d("v-2", "t2"));
    expect(shelf).toEqual([d("v-1", "t1")]);
  });

  it("removes exactly one draft by full identity", () => {
    const shelf = [d("v-1", "t1"), d("v-2", "t2")];
    expect(removeIntakeDraft(shelf, "v-1", "t1")).toEqual([d("v-2", "t2")]);
  });

  it("leaves the shelf alone when the identity does not match", () => {
    // Same vendor, different session — submitting one intake must not delete another.
    const shelf = [d("v-1", "t1")];
    expect(removeIntakeDraft(shelf, "v-1", "t-other")).toEqual(shelf);
    expect(removeIntakeDraft(shelf, "v-other", "t1")).toEqual(shelf);
  });
});

// ── findVendorMismatch (multi-vendor audit P3) ────────────────────────────────
describe("findVendorMismatch", () => {
  const sku = (id: string, vendorId: string | null): SkuVendorBinding => ({ id, vendorId });

  it("passes when every SKU belongs to the delivering vendor", () => {
    expect(findVendorMismatch("v-baldor", [sku("a", "v-baldor"), sku("b", "v-baldor")])).toBeNull();
  });

  it("catches a twin from another vendor (the P3 bug)", () => {
    // Baldor's truck, but a line names PFG's "Ham" — this is what wrote price history
    // onto the twin that never arrived.
    const hit = findVendorMismatch("v-baldor", [sku("a", "v-baldor"), sku("ham-pfg", "v-pfg")]);
    expect(hit?.id).toBe("ham-pfg");
  });

  it("returns the FIRST offender when several cross vendors", () => {
    expect(findVendorMismatch("v-1", [sku("x", "v-2"), sku("y", "v-3")])?.id).toBe("x");
  });

  it("tolerates vendorless SKUs — unassigned is not another vendor", () => {
    // 11 ACTIVE SKUs carry a null vendor in prod (Sub Roll, Mortadella, …). Rejecting
    // them would make real ingredients un-receivable at the door.
    expect(findVendorMismatch("v-baldor", [sku("sub-roll", null), sku("a", "v-baldor")])).toBeNull();
  });

  it("disables the check when the delivery names no vendor", () => {
    expect(findVendorMismatch(null, [sku("a", "v-1")])).toBeNull();
    expect(findVendorMismatch("", [sku("a", "v-1")])).toBeNull();
    expect(findVendorMismatch(undefined, [sku("a", "v-1")])).toBeNull();
  });

  it("passes on an empty line set", () => {
    expect(findVendorMismatch("v-1", [])).toBeNull();
  });
});
