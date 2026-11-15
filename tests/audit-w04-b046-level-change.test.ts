import { describe, expect, it } from "vitest";
import { creditUnitPrice, deriveCreditDrafts, levelChangePatch, levelMultiplier } from "@/lib/receiving-shared";
import type { PackChainLevel } from "@/lib/pack-chain-shared";

/** Audit W04/B046. Chain: case = 12 x each, each = 32 oz. PO: 2 cases. */
const labels = ["case", "each"];
const counts = [12];
const chain: PackChainLevel[] = [
  { id: "case", label: "case", containsQty: 12, containsLevelId: "each", containsMeasureUnit: null, displayOrdinal: 0 },
  { id: "each", label: "each", containsQty: 32, containsLevelId: null, containsMeasureUnit: "oz", displayOrdinal: 1 },
];
const row = { level: "case", expectedQty: 2, discrepancy: null };

describe("W04/B046 changing the received level rescales the expectation", () => {
  it("converts between chain levels (empty label = root pack)", () => {
    expect(levelMultiplier(labels, counts, "case", "each")).toBe(12);
    expect(levelMultiplier(labels, counts, "each", "case")).toBeCloseTo(1 / 12, 12);
    expect(levelMultiplier(labels, counts, "", "each")).toBe(12);
    expect(levelMultiplier(labels, counts, "case", "bag")).toBeNull();
    expect(levelMultiplier(labels, [], "case", "each")).toBeNull();
  });

  it("2 cases expected become 24 each, so 24 each is exact (no Over)", () => {
    expect(levelChangePatch(row, "each", labels, counts)).toEqual({ level: "each", expectedQty: 24 });
  });

  it("an unconvertible level clears the expectation and the flag", () => {
    expect(levelChangePatch({ ...row, discrepancy: "over" }, "pallet", labels, counts)).toEqual({ level: "pallet", expectedQty: null, discrepancy: null });
  });

  it("rows without an expectation only change their level", () => {
    expect(levelChangePatch({ ...row, expectedQty: null }, "each", labels, counts)).toEqual({ level: "each" });
  });

  it("a short of 4 each on a $18/case vendor line credits $6, not $72", () => {
    const price = creditUnitPrice(18, "each", chain, "case", false);
    expect(price).toBe(1.5);
    const [draft] = deriveCreditDrafts([{ deliveryItemId: "l", skuId: "s", qtyReceived: 20, expectedQty: 24, unitPrice: price, discrepancyType: "short" }]);
    expect(draft).toMatchObject({ qty: 4, amountCents: 600 });
  });

  it("root-level, store and unplaceable levels", () => {
    expect(creditUnitPrice(18, "case", chain, "case", false)).toBe(18);
    expect(creditUnitPrice(18, null, chain, "case", false)).toBe(18);
    expect(creditUnitPrice(1.5, "each", chain, "case", true)).toBe(1.5);
    expect(creditUnitPrice(18, "pallet", chain, "case", false)).toBeNull();
  });
});
