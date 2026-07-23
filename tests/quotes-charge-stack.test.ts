/**
 * Unit spine — lib/catering/quotes.ts charge-stack math (pure, D20 server authority).
 * Pins: tax-base composition, non-negative defense (A-H1), deposit-on-total, line rounding.
 */
import { describe, it, expect } from "vitest";
import { computeChargeStack, lineTotalCents, type ChargeRates } from "@/lib/catering/quotes";

const RATES: ChargeRates = {
  taxRateBps: 1000, // 10% DC-style sales tax for round numbers
  gratuityBps: 2000, // 20%
  serviceChargeBps: 500, // 5%
  depositPctBps: 5000, // 50%
  taxOnDelivery: false,
  taxOnGratuity: false,
};

describe("lineTotalCents", () => {
  it("multiplies and rounds to the nearest cent", () => {
    expect(lineTotalCents(3, 725)).toBe(2175);
    expect(lineTotalCents(0.5, 999)).toBe(500); // 499.5 rounds up
  });
});

describe("computeChargeStack", () => {
  it("computes the full stack on a simple order", () => {
    const stack = computeChargeStack([10000], 0, RATES);
    expect(stack.subtotalCents).toBe(10000);
    expect(stack.serviceChargeCents).toBe(500); // 5% of subtotal
    expect(stack.gratuityCents).toBe(2000); // 20% of subtotal
    // tax base = subtotal + service charge (delivery/gratuity excluded by flags)
    expect(stack.taxCents).toBe(1050); // 10% of 10500
    expect(stack.totalCents).toBe(10000 + 0 + 500 + 2000 + 1050);
    expect(stack.depositCents).toBe(Math.round(stack.totalCents / 2));
  });

  it("service charge is ALWAYS in the tax base; delivery and gratuity only by flag", () => {
    const base = computeChargeStack([10000], 1000, RATES);
    expect(base.taxCents).toBe(1050); // delivery excluded

    const taxedDelivery = computeChargeStack([10000], 1000, {
      ...RATES,
      taxOnDelivery: true,
    });
    expect(taxedDelivery.taxCents).toBe(1150); // 10% of 10500 + 1000

    const taxedGratuity = computeChargeStack([10000], 0, {
      ...RATES,
      taxOnGratuity: true,
    });
    expect(taxedGratuity.taxCents).toBe(1250); // 10% of 10500 + 2000
  });

  it("delivery fee lands in the total (and deposit) even when untaxed", () => {
    const stack = computeChargeStack([10000], 1500, RATES);
    expect(stack.deliveryFeeCents).toBe(1500);
    expect(stack.totalCents).toBe(10000 + 1500 + 500 + 2000 + 1050);
    expect(stack.depositCents).toBe(Math.round(stack.totalCents / 2));
  });

  it("A-H1 defense: non-finite or negative rates contribute 0, never a negative charge", () => {
    const hostile: ChargeRates = {
      taxRateBps: Number.NaN,
      gratuityBps: -5000,
      serviceChargeBps: Number.POSITIVE_INFINITY,
      depositPctBps: -1,
      taxOnDelivery: true,
      taxOnGratuity: true,
    };
    const stack = computeChargeStack([10000], 500, hostile);
    expect(stack.serviceChargeCents).toBe(0);
    expect(stack.gratuityCents).toBe(0);
    expect(stack.taxCents).toBe(0);
    expect(stack.depositCents).toBe(0);
    expect(stack.totalCents).toBe(10500); // subtotal + delivery only
  });

  it("empty order: everything zero, no NaN leakage", () => {
    const stack = computeChargeStack([], 0, RATES);
    expect(stack.subtotalCents).toBe(0);
    expect(stack.taxCents).toBe(0);
    expect(stack.totalCents).toBe(0);
    expect(stack.depositCents).toBe(0);
  });

  it("bps rounding is half-up per charge", () => {
    // subtotal 1005 → service 5% = 50.25 → 50; gratuity 20% = 201
    const stack = computeChargeStack([1005], 0, RATES);
    expect(stack.serviceChargeCents).toBe(50);
    expect(stack.gratuityCents).toBe(201);
  });
});
