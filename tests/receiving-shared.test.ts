/**
 * Unit spine — lib/receiving-shared.ts pure math (zero I/O, no server imports).
 * Pins: credit derivation for short/over/damaged/substitution lines, qty-delta
 * arithmetic, amount-cents derivation from intake price (spec D1), and the
 * addDeliveryLines double-submit multiset guard (isDuplicateAppend).
 */
import { describe, it, expect } from "vitest";
import {
  deriveCreditDrafts,
  deriveMissingCreditDrafts,
  isDuplicateAppend,
  type AppendLine,
  type IntakeLineForCredits,
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
