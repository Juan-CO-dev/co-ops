/**
 * Unit spine — lib/toast/modifiers-shared.ts (modifier depletion, Part 1) +
 * flattenToastModifierOptions. Pins: the disposition classifier, portion
 * derivation from consumer builds, the 32×-trap guard (a topping never
 * depletes a par unit), and PARENT-AWARE removal amounts (Juan: removals
 * COUNT — "we do not count that as being consumed").
 */
import { describe, it, expect } from "vitest";
import { classifyModifier, derivePortion, modifierParUnits, removalAmount, skuPortionOz } from "@/lib/toast/modifiers-shared";
import { flattenToastModifierOptions } from "@/lib/toast/menus-shared";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";

const MEASURES = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["each", { dimension: "count", toBaseFactor: 1 }],
]);
const SKU: RecipeInputSku = { packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null };
const PACK = new Map<string, RecipeInputSku>([["sku1", SKU], ["sku2", SKU]]);
function ozIn(quantity: number, skuId: string): GraphRecipe["inputs"][number] {
  return { quantity, unit: "oz", componentSkuId: skuId, componentItemId: null };
}
function itemIn(quantity: number, unit: string | null, itemId: string): GraphRecipe["inputs"][number] {
  return { quantity, unit, componentSkuId: null, componentItemId: itemId };
}

// PROV: quart-style prep item — 32 oz per par unit registered; batch 480oz sku1 → 4 units.
// Signature sub SIG uses 2 each PROV... we use oz for conversion tests instead:
const graph = buildRecipeGraph([
  { recipeId: "rProv", batchYield: 4, inputs: [ozIn(480, "sku1")],
    outputs: [{ outputItemId: "PROV", outputMenuItemId: null, yield: 4, ozPerParUnit: 32 }] },
  { recipeId: "rSig", batchYield: 2, inputs: [itemIn(2, "oz", "PROV"), ozIn(8, "sku2")],
    outputs: [{ outputItemId: null, outputMenuItemId: "SIG", yield: 2, ozPerParUnit: null }] },
  { recipeId: "rSig2", batchYield: 1, inputs: [itemIn(4, "oz", "PROV")],
    outputs: [{ outputItemId: null, outputMenuItemId: "SIG2", yield: 1, ozPerParUnit: null }] },
], PACK, MEASURES);

describe("classifyModifier", () => {
  it("No X → remove with stripped match name", () => {
    expect(classifyModifier("No Onions")).toEqual({ disposition: "remove", matchName: "Onions" });
    expect(classifyModifier("no pickles")).toEqual({ disposition: "remove", matchName: "pickles" });
  });
  it("Add/Extra/More X → deplete with stripped match name", () => {
    expect(classifyModifier("Extra Mayo")).toEqual({ disposition: "deplete", matchName: "Mayo" });
    expect(classifyModifier("Add Bacon")).toEqual({ disposition: "deplete", matchName: "Bacon" });
    expect(classifyModifier("More Capicola")).toEqual({ disposition: "deplete", matchName: "Capicola" });
  });
  it("plain toppings → deplete verbatim", () => {
    expect(classifyModifier("Provolone")).toEqual({ disposition: "deplete", matchName: "Provolone" });
  });
});

describe("derivePortion", () => {
  it("median qty in the modal unit across consumer builds", () => {
    // PROV appears in SIG (2 oz) and SIG2 (4 oz) → modal unit oz, median 3.
    expect(derivePortion(graph, "PROV")).toEqual({ qty: 3, unit: "oz" });
  });
  it("null when no consumer build references the item", () => {
    expect(derivePortion(graph, "ghost")).toBeNull();
  });
});

describe("modifierParUnits (the 32×-trap guard)", () => {
  it("a 3 oz topping application on a 32 oz/par item = 0.09375 par-units, NOT 1", () => {
    expect(modifierParUnits(graph, "PROV", { qty: 3, unit: "oz" })).toBeCloseTo(3 / 32, 10);
  });
});

describe("removalAmount (parent-aware — removals COUNT)", () => {
  it("subtracts exactly what the parent recipe contributes per sub", () => {
    // SIG: 2 oz PROV per batch of 2 → 1 oz per sub → 1/32 par-units.
    expect(removalAmount(graph, "SIG", "PROV")).toBeCloseTo(1 / 32, 10);
  });
  it("null when the parent has no input for the item (caller falls back to portion)", () => {
    expect(removalAmount(graph, "SIG", "ghost")).toBeNull();
    expect(removalAmount(graph, "nope", "PROV")).toBeNull();
  });
});

describe("skuPortionOz (Part 2 — raw-SKU modifier portion → oz)", () => {
  it("unit 'oz' → qty oz directly (avg_oz_per_each irrelevant)", () => {
    expect(skuPortionOz({ qty: 2.5, unit: "oz" }, null)).toBe(2.5);
    expect(skuPortionOz({ qty: 2.5, unit: "oz" }, 4)).toBe(2.5);
  });
  it("unit 'each' → qty × avg_oz_per_each (Sub Roll: 1 each × 3 oz)", () => {
    expect(skuPortionOz({ qty: 1, unit: "each" }, 3)).toBe(3);
    expect(skuPortionOz({ qty: 2, unit: "each" }, 3)).toBe(6);
  });
  it("null unit behaves like 'each'", () => {
    expect(skuPortionOz({ qty: 1, unit: null }, 3)).toBe(3);
  });
  it("null per-each on an each/null portion → null (surfaces to portionNeeded)", () => {
    expect(skuPortionOz({ qty: 1, unit: "each" }, null)).toBeNull();
    expect(skuPortionOz({ qty: 1, unit: null }, null)).toBeNull();
    expect(skuPortionOz({ qty: 1, unit: "each" }, 0)).toBeNull(); // non-positive weight = unknown
  });
  it("any other unit → null (out of scope — no volume/count conversion)", () => {
    expect(skuPortionOz({ qty: 1, unit: "quart" }, 32)).toBeNull();
  });
  it("non-finite qty → null", () => {
    expect(skuPortionOz({ qty: Number.NaN, unit: "oz" }, null)).toBeNull();
  });
  it("the sign is the caller's job — this returns the magnitude only", () => {
    // deplete adds +oz, remove subtracts −oz at the call site; the helper is unsigned.
    const oz = skuPortionOz({ qty: 1, unit: "each" }, 3);
    expect(oz).toBe(3);
    expect(oz! * -1).toBe(-3); // remove application
  });
});

describe("flattenToastModifierOptions", () => {
  it("walks the referenceId-keyed dict (live-verified shape) with first-wins dedupe", () => {
    const out = flattenToastModifierOptions({
      modifierOptionReferences: {
        "2": { guid: "m-1", name: "Provolone", price: 1.0 },
        "7": { guid: "m-2", name: "No Onions" },
        "9": { guid: "m-1", name: "Provolone dup", price: 2.0 },
      },
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ itemGuid: "m-1", name: "Provolone", priceCents: 100, groupName: "(modifier)" });
    expect(out[1]!.priceCents).toBeNull();
  });
  it("empty when the block is absent; poisons on malformed entries", () => {
    expect(flattenToastModifierOptions({ menus: [] })).toEqual([]);
    expect(() => flattenToastModifierOptions({ modifierOptionReferences: { "1": { name: "x" } } })).toThrow(/without guid/);
  });
});
