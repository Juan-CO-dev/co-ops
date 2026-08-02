/**
 * Unit spine — lib/receiving-shared.ts pure math (zero I/O, no server imports).
 * Pins: credit derivation for short/over/damaged/substitution lines, qty-delta
 * arithmetic, amount-cents derivation from intake price (spec D1), and the
 * vendor-invoice deduplication key normalisation.
 */
import { describe, it, expect } from "vitest";
import {
  deriveCreditDrafts,
  dedupeKey,
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

describe("dedupeKey", () => {
  it("normalizes invoice casing/whitespace", () => {
    expect(dedupeKey("v1", " INV-001 ", "2026-08-02")).toBe(
      "v1|inv-001|2026-08-02",
    );
  });

  it("null invoice yields a date-scoped key", () => {
    expect(dedupeKey("v1", null, "2026-08-02")).toBe("v1||2026-08-02");
  });
});
