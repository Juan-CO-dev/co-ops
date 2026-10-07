/**
 * Unit spine — ONE graph, ONE yield (0215 batch vs bottle, CC ruling 3 / Astra r3 #3).
 *
 * The batch fold multiplies and divides by the SAME graph's yield. These helpers are the
 * proof: batchSkuOzForItemFromGraph × 1 == perUnitSkuOzForItemFromGraph × yield per SKU,
 * so `batches × batchSkuOz` is exactly `batches × the recipe` whatever the yield says, and
 * a yield edited between render and save (a different graph) changes nothing about how much
 * one batch consumes. Conservation is pinned for 1, 2 and 3 batches (Juan: double / triple).
 */
import { describe, expect, it } from "vitest";

import {
  batchSkuOzForItemFromGraph,
  buildRecipeGraph,
  isSingleItemOutputFromGraph,
  perUnitSkuOzForItemFromGraph,
  yieldForItemFromGraph,
  type GraphRecipe,
} from "@/lib/prep-consumption-graph";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";

const MEASURES = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["lb", { dimension: "weight", toBaseFactor: 16 }],
]);
const SKU: RecipeInputSku = { packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null };
const PACK = new Map<string, RecipeInputSku>([["mayo", SKU], ["peppers", SKU], ["garlic", SKU]]);

function ozIn(quantity: number, skuId: string): GraphRecipe["inputs"][number] {
  return { quantity, unit: "oz", componentSkuId: skuId, componentItemId: null };
}
function itemOut(itemId: string, yld: number, ozPerParUnit: number | null = null): GraphRecipe["outputs"][number] {
  return { outputItemId: itemId, outputMenuItemId: null, yield: yld, ozPerParUnit };
}
/** Honey Chili Aioli-shaped: 56.5 oz mayo + 7.5 oz peppers + 0.55 oz garlic → 2.25 quarts. */
function hcAioli(yld: number) {
  return buildRecipeGraph(
    [{ recipeId: "hc", batchYield: yld, inputs: [ozIn(56.5, "mayo"), ozIn(7.5, "peppers"), ozIn(0.55, "garlic")], outputs: [itemOut("HC", yld)] }],
    PACK,
    MEASURES,
  );
}

describe("one graph, one yield", () => {
  it("yieldForItemFromGraph is the output row's yield — the number the per-unit engine divides by", () => {
    expect(yieldForItemFromGraph(hcAioli(2.25), "HC")).toBe(2.25);
    expect(yieldForItemFromGraph(hcAioli(8), "HC")).toBe(8);
    expect(yieldForItemFromGraph(hcAioli(2.25), "nope")).toBeNull();
  });

  it.each([2.25, 4, 8])("batchSkuOz == perUnitSkuOz × yield, per SKU, at yield %s", (yld) => {
    const g = hcAioli(yld);
    const batch = batchSkuOzForItemFromGraph(g, "HC")!;
    const perUnit = perUnitSkuOzForItemFromGraph(g, "HC");
    expect(batch).not.toBeNull();
    for (const [sku, oz] of batch) expect(oz).toBeCloseTo(perUnit.get(sku)! * yld, 10);
  });

  it("one batch consumes the WHOLE recipe regardless of the yield (a yield edit between render and save cannot mis-scale)", () => {
    for (const yld of [2.25, 4, 8]) {
      const batch = batchSkuOzForItemFromGraph(hcAioli(yld), "HC")!;
      expect(batch.get("mayo")).toBeCloseTo(56.5, 10);
      expect(batch.get("peppers")).toBeCloseTo(7.5, 10);
      expect(batch.get("garlic")).toBeCloseTo(0.55, 10);
    }
  });

  it.each([1, 2, 3])("conservation: %s batch(es) deplete exactly batches × the recipe lines and credit batches × yield", (batches) => {
    const g = hcAioli(2.25);
    const batch = batchSkuOzForItemFromGraph(g, "HC")!;
    const yld = yieldForItemFromGraph(g, "HC")!;
    expect(batch.get("mayo")! * batches).toBeCloseTo(56.5 * batches, 10);
    expect(batch.get("peppers")! * batches).toBeCloseTo(7.5 * batches, 10);
    expect(yld * batches).toBeCloseTo(2.25 * batches, 10);
  });

  it("the single-output restriction: a second output makes the item ineligible, and the per-batch map is its share only", () => {
    const g = buildRecipeGraph(
      [{ recipeId: "two", batchYield: 4, inputs: [ozIn(100, "mayo")], outputs: [itemOut("A", 2, 10), itemOut("B", 2, 10)] }],
      PACK,
      MEASURES,
    );
    expect(isSingleItemOutputFromGraph(g, "A")).toBe(false);
    expect(isSingleItemOutputFromGraph(hcAioli(4), "HC")).toBe(true);
    // Astra r1 #3: multiplying by one output's yield would consume only its share — which is why v1 refuses multi-output.
    expect(batchSkuOzForItemFromGraph(g, "A")!.get("mayo")).toBeCloseTo(50, 10);
  });

  it("an unresolvable recipe poisons to null (the row BLOCKS; it never falls back to single-box depletion)", () => {
    const g = buildRecipeGraph(
      [{ recipeId: "bad", batchYield: 4, inputs: [{ quantity: 1, unit: "ladle", componentSkuId: "mayo", componentItemId: null }], outputs: [itemOut("X", 4)] }],
      PACK,
      MEASURES,
    );
    expect(batchSkuOzForItemFromGraph(g, "X")).toBeNull();
    expect(yieldForItemFromGraph(g, "X")).toBe(4);
  });
});
