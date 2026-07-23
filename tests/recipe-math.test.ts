/**
 * Unit spine — lib/recipe-math.ts (pure SKU oz/cost conversions).
 * Locks the DESIGN DECISION that volume units deliberately ignore the
 * registry's to_base_factor (volume→weight needs a density we don't store;
 * conversion goes through the human-entered avg_oz_per_each, same as count).
 * A future "fix" that starts multiplying by the volume factor breaks every
 * volume-measured SKU's content_oz — this test is the tripwire.
 */
import { describe, it, expect } from "vitest";
import { ozFromMeasure, skuContentOz, skuCostPerOz, type MeasureUnitFactor } from "@/lib/recipe-math";

const MEASURES = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["lb", { dimension: "weight", toBaseFactor: 16 }],
  ["quart", { dimension: "volume", toBaseFactor: 32 }],
  ["each", { dimension: "count", toBaseFactor: 1 }],
]);

describe("ozFromMeasure", () => {
  it("weight units convert via to_base_factor", () => {
    expect(ozFromMeasure(0.5, "lb", MEASURES, null)).toBeCloseTo(8, 10);
  });

  it("volume units IGNORE to_base_factor and use the avg fallback (design decision)", () => {
    // quart carries toBaseFactor 32, but 2 quarts × avg 3 oz = 6 — NOT 64.
    expect(ozFromMeasure(2, "quart", MEASURES, 3)).toBeCloseTo(6, 10);
  });

  it("volume/count without an avg fallback return null — never guess", () => {
    expect(ozFromMeasure(2, "quart", MEASURES, null)).toBeNull();
    expect(ozFromMeasure(2, "each", MEASURES, null)).toBeNull();
  });

  it("unregistered units return null", () => {
    expect(ozFromMeasure(2, "handful", MEASURES, 3)).toBeNull();
  });
});

describe("skuContentOz / skuCostPerOz", () => {
  it("content = units_per_pack × each_size × oz-per-measure-unit", () => {
    const content = skuContentOz(
      { unitsPerPack: 6, eachSize: 2, eachMeasure: "lb", avgOzPerEach: null },
      MEASURES,
    );
    expect(content).toBeCloseTo(192, 10); // 6 × 2 lb × 16
    expect(skuCostPerOz(96, content)).toBeCloseTo(0.5, 10);
  });

  it("count-measured SKUs convert through avg_oz_per_each", () => {
    expect(
      skuContentOz({ unitsPerPack: 12, eachSize: 1, eachMeasure: "each", avgOzPerEach: 4 }, MEASURES),
    ).toBeCloseTo(48, 10);
  });

  it("missing inputs null the chain (content null → cost null)", () => {
    const content = skuContentOz(
      { unitsPerPack: 12, eachSize: 1, eachMeasure: "each", avgOzPerEach: null },
      MEASURES,
    );
    expect(content).toBeNull();
    expect(skuCostPerOz(96, content)).toBeNull();
  });
});
