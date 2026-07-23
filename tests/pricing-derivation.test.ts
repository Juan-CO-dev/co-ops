/**
 * Unit spine — lib/catering/pricing-derivation.ts (pure, W1a).
 * Pins: portion math, bps rounding, rate-resolution precedence.
 */
import { describe, it, expect } from "vitest";
import {
  cateringUnitPriceCents,
  impliedRateBps,
  sumComponentsCents,
  resolveRateBps,
  PORTION_FRACTION,
  DEFAULT_RATE_BPS,
  type RateRule,
} from "@/lib/catering/pricing-derivation";

describe("cateringUnitPriceCents", () => {
  it("whole portion at par rate (10000 bps) returns the regular price", () => {
    expect(cateringUnitPriceCents(1450, "whole", 10000)).toBe(1450);
  });

  it("applies portion fractions (quarter/half)", () => {
    expect(cateringUnitPriceCents(1450, "half", 10000)).toBe(725);
    expect(cateringUnitPriceCents(1450, "quarter", 10000)).toBe(363); // 362.5 → rounds up
  });

  it("applies wholesale discount and raise rates", () => {
    expect(cateringUnitPriceCents(1000, "whole", 8500)).toBe(850);
    expect(cateringUnitPriceCents(1000, "whole", 12000)).toBe(1200);
  });

  it("rounds to nearest cent (half-up via Math.round)", () => {
    // 999 * 0.5 * 1.0 = 499.5 → 500
    expect(cateringUnitPriceCents(999, "half", 10000)).toBe(500);
    // 1001 * 0.25 = 250.25 → 250
    expect(cateringUnitPriceCents(1001, "quarter", 10000)).toBe(250);
  });

  it("rate 0 zeroes the price; portion fractions are exactly 1/4, 1/2, 1", () => {
    expect(cateringUnitPriceCents(1450, "whole", 0)).toBe(0);
    expect(PORTION_FRACTION.quarter).toBe(0.25);
    expect(PORTION_FRACTION.half).toBe(0.5);
    expect(PORTION_FRACTION.whole).toBe(1);
  });
});

describe("impliedRateBps", () => {
  it("computes the implied rate from chosen vs baseline", () => {
    expect(impliedRateBps(850, 1000)).toBe(8500);
    expect(impliedRateBps(1000, 1000)).toBe(10000);
  });

  it("rounds to the nearest bp", () => {
    // 333/1000 = 0.333 → 3330
    expect(impliedRateBps(333, 1000)).toBe(3330);
    // 1/3 → 3333.33… → 3333
    expect(impliedRateBps(1, 3)).toBe(3333);
  });

  it("returns null for zero, negative, or non-finite baselines", () => {
    expect(impliedRateBps(500, 0)).toBeNull();
    expect(impliedRateBps(500, -100)).toBeNull();
    expect(impliedRateBps(500, Number.NaN)).toBeNull();
    expect(impliedRateBps(500, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("sumComponentsCents", () => {
  it("sums qty × unit with per-line rounding", () => {
    expect(
      sumComponentsCents([
        { unitCents: 725, qty: 2 },
        { unitCents: 363, qty: 4 },
      ]),
    ).toBe(725 * 2 + 363 * 4);
  });

  it("rounds each line independently (fractional qty)", () => {
    // 999 * 0.5 = 499.5 → 500 per line, × 2 lines = 1000 (not round(999) = 999)
    expect(
      sumComponentsCents([
        { unitCents: 999, qty: 0.5 },
        { unitCents: 999, qty: 0.5 },
      ]),
    ).toBe(1000);
  });

  it("empty input sums to 0", () => {
    expect(sumComponentsCents([])).toBe(0);
  });
});

describe("resolveRateBps — most-specific-wins precedence", () => {
  const rules: RateRule[] = [
    { scope: "location", scopeRef: null, rateBps: 9000 },
    { scope: "section", scopeRef: "Subs", rateBps: 8500 },
    { scope: "menu_item", scopeRef: "mi-1", rateBps: 8000 },
    { scope: "item", scopeRef: "it-1", rateBps: 7500 },
  ];

  it("entity scope wins over section and location", () => {
    expect(
      resolveRateBps(rules, { kind: "menu_item", entityId: "mi-1", section: "Subs" }),
    ).toBe(8000);
    expect(resolveRateBps(rules, { kind: "item", entityId: "it-1", section: "Subs" })).toBe(
      7500,
    );
  });

  it("entity kinds do not cross-match (item id never matches menu_item scope)", () => {
    // "mi-1" exists only as a menu_item rule; querying as kind item falls to section.
    expect(resolveRateBps(rules, { kind: "item", entityId: "mi-1", section: "Subs" })).toBe(
      8500,
    );
  });

  it("section wins over location when no entity rule matches", () => {
    expect(
      resolveRateBps(rules, { kind: "menu_item", entityId: "other", section: "Subs" }),
    ).toBe(8500);
  });

  it("null section skips section scope entirely", () => {
    expect(
      resolveRateBps(rules, { kind: "menu_item", entityId: "other", section: null }),
    ).toBe(9000);
  });

  it("falls to location, then to DEFAULT_RATE_BPS when no rules match", () => {
    expect(
      resolveRateBps(
        [{ scope: "location", scopeRef: null, rateBps: 11000 }],
        { kind: "item", entityId: "x", section: "y" },
      ),
    ).toBe(11000);
    expect(resolveRateBps([], { kind: "item", entityId: "x", section: "y" })).toBe(
      DEFAULT_RATE_BPS,
    );
  });
});
