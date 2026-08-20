/**
 * Unit spine — lib/prep-consumption-graph.ts (the pure recipe-flatten resolver
 * extracted in the 2026-07-23 batch-flatten rewrite; council fixture #1).
 * Pins: recursion + quantity scaling, cycle poisoning, unresolvable-input
 * poisoning, multi-output fan-out share (incl. the item-outputs-only weight
 * universe vs the menu engine's all-outputs universe), first-wins indexing.
 */
import { describe, it, expect } from "vitest";
import {
  buildRecipeGraph,
  perUnitSkuOzForItemFromGraph,
  perUnitSkuOzForMenuItemFromGraph,
  perUnitDirectSkuOzForMenuItem,
  firstLevelItemConsumption,
  type GraphRecipe,
} from "@/lib/prep-consumption-graph";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";

const MEASURES = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["lb", { dimension: "weight", toBaseFactor: 16 }],
  ["quart", { dimension: "volume", toBaseFactor: 32 }],
  ["each", { dimension: "count", toBaseFactor: 1 }],
]);
const SKU: RecipeInputSku = {
  packFormat: null, eachContainerLabel: null, unitsPerPack: null,
  eachSize: null, eachMeasure: null, avgOzPerEach: null,
};
const PACK = new Map<string, RecipeInputSku>([
  ["sku1", SKU], ["sku2", SKU], ["sku3", SKU],
]);

function ozIn(quantity: number, skuId: string): GraphRecipe["inputs"][number] {
  return { quantity, unit: "oz", componentSkuId: skuId, componentItemId: null };
}
function itemIn(quantity: number, itemId: string): GraphRecipe["inputs"][number] {
  return { quantity, unit: null, componentSkuId: null, componentItemId: itemId };
}
function itemOut(itemId: string, yld: number, ozPerParUnit: number | null = null): GraphRecipe["outputs"][number] {
  return { outputItemId: itemId, outputMenuItemId: null, yield: yld, ozPerParUnit };
}
function menuOut(menuItemId: string, yld: number): GraphRecipe["outputs"][number] {
  return { outputItemId: null, outputMenuItemId: menuItemId, yield: yld, ozPerParUnit: null };
}
function graphOf(recipes: GraphRecipe[]) {
  return buildRecipeGraph(recipes, PACK, MEASURES);
}

describe("perUnitSkuOzForItemFromGraph", () => {
  it("flattens a single-level recipe: batch oz ÷ batch yield per SKU", () => {
    const g = graphOf([
      { recipeId: "r1", batchYield: 10, inputs: [ozIn(20, "sku1"), ozIn(5, "sku2")], outputs: [itemOut("A", 10)] },
    ]);
    const m = perUnitSkuOzForItemFromGraph(g, "A");
    expect(m.get("sku1")).toBeCloseTo(2, 10);
    expect(m.get("sku2")).toBeCloseTo(0.5, 10);
  });

  it("recurses through component items with quantity scaling", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1"), ozIn(5, "sku2")], outputs: [itemOut("A", 10)] },
      { recipeId: "rB", batchYield: 4, inputs: [itemIn(2, "A"), ozIn(8, "sku3")], outputs: [itemOut("B", 4)] },
    ]);
    const m = perUnitSkuOzForItemFromGraph(g, "B");
    // per-unit A = {sku1:2, sku2:0.5}; B batch = 2×A + 8oz sku3; ÷ yield 4
    expect(m.get("sku1")).toBeCloseTo(1, 10);
    expect(m.get("sku2")).toBeCloseTo(0.25, 10);
    expect(m.get("sku3")).toBeCloseTo(2, 10);
  });

  it("a cycle poisons the flatten to empty (never loops, never partial)", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 1, inputs: [itemIn(1, "B")], outputs: [itemOut("A", 1)] },
      { recipeId: "rB", batchYield: 1, inputs: [itemIn(1, "A")], outputs: [itemOut("B", 1)] },
    ]);
    expect(perUnitSkuOzForItemFromGraph(g, "A").size).toBe(0);
    expect(perUnitSkuOzForItemFromGraph(g, "B").size).toBe(0);
  });

  it("any unresolvable input poisons the whole flatten (null unit on a SKU line)", () => {
    const g = graphOf([
      {
        recipeId: "r1", batchYield: 10,
        inputs: [ozIn(20, "sku1"), { quantity: 3, unit: null, componentSkuId: "sku2", componentItemId: null }],
        outputs: [itemOut("A", 10)],
      },
    ]);
    expect(perUnitSkuOzForItemFromGraph(g, "A").size).toBe(0);
  });

  it("multi-output fan-out allocates by ozWeight (yield × oz_per_par_unit)", () => {
    const g = graphOf([
      {
        recipeId: "r1", batchYield: 4, inputs: [ozIn(12, "sku1")],
        outputs: [itemOut("A", 2, 4), itemOut("C", 2, 2)], // weights 8 and 4 → shares 2/3, 1/3
      },
    ]);
    expect(perUnitSkuOzForItemFromGraph(g, "A").get("sku1")).toBeCloseTo((12 * (2 / 3)) / 2, 10);
    expect(perUnitSkuOzForItemFromGraph(g, "C").get("sku1")).toBeCloseTo((12 * (1 / 3)) / 2, 10);
  });

  it("ITEM engine's weight universe excludes menu outputs (the load-bearing asymmetry)", () => {
    const g = graphOf([
      {
        recipeId: "r1", batchYield: 1, inputs: [ozIn(10, "sku1")],
        outputs: [itemOut("A", 1), menuOut("M", 3)],
      },
    ]);
    // Item engine: only A in the universe → share 1 → 10 oz per unit.
    expect(perUnitSkuOzForItemFromGraph(g, "A").get("sku1")).toBeCloseTo(10, 10);
    // Menu engine: universe = A(w=1) + M(w=3) → share 3/4, ÷ myYield 3.
    expect(perUnitSkuOzForMenuItemFromGraph(g, "M").get("sku1")).toBeCloseTo((10 * (3 / 4)) / 3, 10);
  });

  it("zero/null batch yield and missing recipes resolve to empty", () => {
    const g = graphOf([
      { recipeId: "r1", batchYield: 0, inputs: [ozIn(10, "sku1")], outputs: [itemOut("A", 1)] },
      { recipeId: "r2", batchYield: null, inputs: [ozIn(10, "sku1")], outputs: [itemOut("B", 1)] },
    ]);
    expect(perUnitSkuOzForItemFromGraph(g, "A").size).toBe(0);
    expect(perUnitSkuOzForItemFromGraph(g, "B").size).toBe(0);
    expect(perUnitSkuOzForItemFromGraph(g, "nope").size).toBe(0);
  });

  it("first recipe wins per output (mirrors the original limit-1 lookup)", () => {
    const g = graphOf([
      { recipeId: "r1", batchYield: 1, inputs: [ozIn(7, "sku1")], outputs: [itemOut("A", 1)] },
      { recipeId: "r2", batchYield: 1, inputs: [ozIn(99, "sku1")], outputs: [itemOut("A", 1)] },
    ]);
    expect(perUnitSkuOzForItemFromGraph(g, "A").get("sku1")).toBeCloseTo(7, 10);
  });
});

describe("perUnitSkuOzForMenuItemFromGraph", () => {
  it("sole menu output: full batch ÷ sub yield", () => {
    const g = graphOf([
      { recipeId: "r1", batchYield: 4, inputs: [ozIn(16, "sku1")], outputs: [menuOut("M", 4)] },
    ]);
    expect(perUnitSkuOzForMenuItemFromGraph(g, "M").get("sku1")).toBeCloseTo(4, 10);
  });

  it("component sub-ITEMS flatten via the item engine with quantity scaling", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10)] },
      { recipeId: "rM", batchYield: 2, inputs: [itemIn(3, "A"), ozIn(4, "sku2")], outputs: [menuOut("M", 2)] },
    ]);
    const m = perUnitSkuOzForMenuItemFromGraph(g, "M");
    // batch = 3×(A per-unit 2oz sku1) + 4oz sku2 = {sku1:6, sku2:4}; share 1; ÷ myYield 2
    expect(m.get("sku1")).toBeCloseTo(3, 10);
    expect(m.get("sku2")).toBeCloseTo(2, 10);
  });

  it("an empty component-item flatten poisons the sub (mirrors original .size===0 guard)", () => {
    const g = graphOf([
      { recipeId: "rM", batchYield: 2, inputs: [itemIn(1, "ghost")], outputs: [menuOut("M", 2)] },
    ]);
    expect(perUnitSkuOzForMenuItemFromGraph(g, "M").size).toBe(0);
  });

  it("no recipe / zero yield / zero batch resolve to empty", () => {
    const g = graphOf([
      { recipeId: "r1", batchYield: 2, inputs: [ozIn(4, "sku1")], outputs: [menuOut("M0", 0)] },
      { recipeId: "r2", batchYield: 0, inputs: [ozIn(4, "sku1")], outputs: [menuOut("M1", 2)] },
    ]);
    expect(perUnitSkuOzForMenuItemFromGraph(g, "nope").size).toBe(0);
    expect(perUnitSkuOzForMenuItemFromGraph(g, "M0").size).toBe(0);
    expect(perUnitSkuOzForMenuItemFromGraph(g, "M1").size).toBe(0);
  });
});

describe("weight-denominated item refs (Wave 1.5 math fix)", () => {
  function itemInUnit(quantity: number, unit: string | null, itemId: string): GraphRecipe["inputs"][number] {
    return { quantity, unit, componentSkuId: null, componentItemId: itemId };
  }

  it("converts oz → par-units via the sub's registered oz_per_par_unit (the Marinara-quart bug)", () => {
    // A = a quart-par item (oz_per_par_unit 32) whose batch consumes 480 oz of
    // sku1 across 4 quarts → 120 oz input mass per quart (cook-down).
    // "2 oz of A" must consume 2/32 = 0.0625 quarts → 7.5 oz of sku1,
    // NOT 2 quarts (240 oz) as the legacy par-unit reading computed.
    const g = graphOf([
      { recipeId: "rA", batchYield: 4, inputs: [ozIn(480, "sku1")], outputs: [itemOut("A", 4, 32)] },
      { recipeId: "rB", batchYield: 1, inputs: [itemInUnit(2, "oz", "A")], outputs: [itemOut("B", 1)] },
    ]);
    expect(perUnitSkuOzForItemFromGraph(g, "B").get("sku1")).toBeCloseTo(7.5, 10);
  });

  it("falls back to the sub's per-par-unit input mass when oz_per_par_unit is unset", () => {
    // A per-unit input mass = 2 oz (20 oz ÷ yield 10). "4 oz of A" → 2 par-units
    // → exactly 4 oz of A's ingredient mass flows through (identity for mixes).
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10)] },
      { recipeId: "rB", batchYield: 1, inputs: [itemInUnit(4, "oz", "A")], outputs: [itemOut("B", 1)] },
    ]);
    expect(perUnitSkuOzForItemFromGraph(g, "B").get("sku1")).toBeCloseTo(4, 10);
  });

  it("non-oz weight units convert through toBaseFactor (0.25 lb = 4 oz)", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10)] },
      { recipeId: "rB", batchYield: 1, inputs: [itemInUnit(0.25, "lb", "A")], outputs: [itemOut("B", 1)] },
    ]);
    expect(perUnitSkuOzForItemFromGraph(g, "B").get("sku1")).toBeCloseTo(4, 10);
  });

  it("volume-denominated item refs poison the flatten (no density — never guess)", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10)] },
      { recipeId: "rB", batchYield: 1, inputs: [itemInUnit(1, "quart", "A")], outputs: [itemOut("B", 1)] },
    ]);
    expect(perUnitSkuOzForItemFromGraph(g, "B").size).toBe(0);
  });

  it("count units and a null unit keep par-unit semantics (seed convention)", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10)] },
      { recipeId: "rB", batchYield: 1, inputs: [itemInUnit(2, "each", "A")], outputs: [itemOut("B", 1)] },
      { recipeId: "rC", batchYield: 1, inputs: [itemInUnit(2, null, "A")], outputs: [itemOut("C", 1)] },
    ]);
    expect(perUnitSkuOzForItemFromGraph(g, "B").get("sku1")).toBeCloseTo(4, 10);
    expect(perUnitSkuOzForItemFromGraph(g, "C").get("sku1")).toBeCloseTo(4, 10);
  });

  it("MENU engine converts the same way (consumer builds are where the prod bug lived)", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10)] },
      { recipeId: "rM", batchYield: 2, inputs: [itemInUnit(4, "oz", "A")], outputs: [menuOut("M", 2)] },
    ]);
    // parUnits = 4 oz ÷ 2 oz-per-par = 2 → batch sku1 = 4 oz; share 1; ÷ myYield 2.
    expect(perUnitSkuOzForMenuItemFromGraph(g, "M").get("sku1")).toBeCloseTo(2, 10);
  });
});

describe("unknown-unit refusal on item refs (2026-08-20 costing cleanup)", () => {
  function itemInUnit(quantity: number, unit: string | null, itemId: string): GraphRecipe["inputs"][number] {
    return { quantity, unit, componentSkuId: null, componentItemId: itemId };
  }
  /** An item output that also declares the sub-item's own par-unit label. */
  function itemOutPar(itemId: string, yld: number, ozPerParUnit: number | null, parUnitLabel: string | null) {
    return { outputItemId: itemId, outputMenuItemId: null, yield: yld, ozPerParUnit, parUnitLabel };
  }

  it("an UNREGISTERED unit poisons the flatten instead of silently meaning par-units", () => {
    // This is prod's `1 ladle` of Jus on Our French Dip: `ladle` is in no
    // measure_units row, and the old code read it as ONE QUART.
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10)] },
      { recipeId: "rC", batchYield: 1, inputs: [itemInUnit(1, "ladle", "A")], outputs: [itemOut("C", 1)] },
    ]);
    expect(perUnitSkuOzForItemFromGraph(g, "C").size).toBe(0);
  });

  it("the same refusal reaches the MENU engine and the direct-SKU lane", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10)] },
      {
        recipeId: "rM", batchYield: 1,
        inputs: [itemInUnit(1, "ladle", "A"), ozIn(3, "sku2")],
        outputs: [menuOut("M", 1)],
      },
    ]);
    expect(perUnitSkuOzForMenuItemFromGraph(g, "M").size).toBe(0);
    // The direct-SKU lane validates item refs too, so both lanes agree.
    expect(perUnitDirectSkuOzForMenuItem(g, "M").size).toBe(0);
    expect(firstLevelItemConsumption(g, "M").size).toBe(0);
  });

  it("the sub-item's OWN par-unit label still means par-units (case-insensitive)", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOutPar("A", 10, null, "Quart")] },
      { recipeId: "rB", batchYield: 1, inputs: [itemInUnit(2, "Quart", "A")], outputs: [itemOut("B", 1)] },
      { recipeId: "rC", batchYield: 1, inputs: [itemInUnit(2, " quart ", "A")], outputs: [itemOut("C", 1)] },
    ]);
    // 2 par-units of A × 2 oz-per-par-unit input mass = 4 oz of sku1.
    expect(perUnitSkuOzForItemFromGraph(g, "B").get("sku1")).toBeCloseTo(4, 10);
    expect(perUnitSkuOzForItemFromGraph(g, "C").get("sku1")).toBeCloseTo(4, 10);
  });

  it("a par-unit label belonging to a DIFFERENT item is still a refusal", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOutPar("A", 10, null, "Quart")] },
      { recipeId: "rZ", batchYield: 10, inputs: [ozIn(20, "sku2")], outputs: [itemOutPar("Z", 10, null, "Bundle")] },
      // "Bundle" is a real par-unit label — just not A's.
      { recipeId: "rB", batchYield: 1, inputs: [itemInUnit(2, "Bundle", "A")], outputs: [itemOut("B", 1)] },
    ]);
    expect(perUnitSkuOzForItemFromGraph(g, "B").size).toBe(0);
  });

  it("registering the unit as a WEIGHT measure resolves it (the ladle, once registered)", () => {
    const measures = new Map(MEASURES);
    measures.set("ladle", { dimension: "weight", toBaseFactor: 4 });
    const g = buildRecipeGraph(
      [
        { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10, 32)] },
        { recipeId: "rC", batchYield: 1, inputs: [itemInUnit(1, "ladle", "A")], outputs: [itemOut("C", 1)] },
      ],
      PACK,
      measures,
    );
    // 1 ladle = 4 oz ÷ 32 oz-per-par-unit = 0.125 par-units × 2 oz/par input mass.
    expect(perUnitSkuOzForItemFromGraph(g, "C").get("sku1")).toBeCloseTo(0.25, 10);
  });
});

describe("firstLevelItemConsumption (sales→prep-item grain)", () => {
  function itemInUnit2(quantity: number, unit: string | null, itemId: string): GraphRecipe["inputs"][number] {
    return { quantity, unit, componentSkuId: null, componentItemId: itemId };
  }

  it("count/null-unit refs consume quantity÷myYield par-units; SKU refs ignored", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10)] },
      { recipeId: "rM", batchYield: 2, inputs: [itemInUnit2(3, null, "A"), ozIn(4, "sku2")], outputs: [menuOut("M", 2)] },
    ]);
    const m = firstLevelItemConsumption(g, "M");
    expect(m.size).toBe(1);
    expect(m.get("A")).toBeCloseTo(1.5, 10); // 3 par-units per batch ÷ yield 2
  });

  it("weight-denominated refs convert via the sub's oz-per-par (registered)", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 4, inputs: [ozIn(480, "sku1")], outputs: [itemOut("A", 4, 32)] },
      { recipeId: "rM", batchYield: 1, inputs: [itemInUnit2(2, "oz", "A")], outputs: [menuOut("M", 1)] },
    ]);
    // 2 oz ÷ 32 oz/quart = 0.0625 quarts per unit of M
    expect(firstLevelItemConsumption(g, "M").get("A")).toBeCloseTo(0.0625, 10);
  });

  it("an unresolvable item-ref poisons the map (volume unit, no density)", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10)] },
      { recipeId: "rM", batchYield: 1, inputs: [itemInUnit2(1, "quart", "A")], outputs: [menuOut("M", 1)] },
    ]);
    expect(firstLevelItemConsumption(g, "M").size).toBe(0);
  });

  it("no recipe / zero yield → empty", () => {
    const g = graphOf([]);
    expect(firstLevelItemConsumption(g, "nope").size).toBe(0);
  });
});

describe("perUnitDirectSkuOzForMenuItem (SKU double-count guard, PR #180)", () => {
  function itemInU(quantity: number, unit: string | null, itemId: string): GraphRecipe["inputs"][number] {
    return { quantity, unit, componentSkuId: null, componentItemId: itemId };
  }
  const g = graphOf([
    { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10)] },
    { recipeId: "rM", batchYield: 2, inputs: [itemInU(3, null, "A"), ozIn(4, "sku2")], outputs: [menuOut("M", 2)] },
  ]);

  it("emits ONLY direct SKU-ref inputs (item-ref SKUs flow via the item lane)", () => {
    const direct = perUnitDirectSkuOzForMenuItem(g, "M");
    expect(direct.get("sku2")).toBeCloseTo(2, 10);
    expect(direct.has("sku1")).toBe(false);
  });

  it("INVARIANT: direct + Σ firstLevel×perUnitItem === full flatten (no double-count)", () => {
    const full = perUnitSkuOzForMenuItemFromGraph(g, "M");
    const recombined = new Map(perUnitDirectSkuOzForMenuItem(g, "M"));
    for (const [itemId, units] of firstLevelItemConsumption(g, "M")) {
      for (const [skuId, oz] of perUnitSkuOzForItemFromGraph(g, itemId)) {
        recombined.set(skuId, (recombined.get(skuId) ?? 0) + oz * units);
      }
    }
    expect([...recombined.keys()].sort()).toEqual([...full.keys()].sort());
    for (const [skuId, oz] of full) expect(recombined.get(skuId)).toBeCloseTo(oz, 10);
  });

  it("poison parity: unresolvable item-ref poisons the direct flatten too", () => {
    const bad = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10)] },
      { recipeId: "rM", batchYield: 1, inputs: [itemInU(1, "quart", "A"), ozIn(4, "sku2")], outputs: [menuOut("M", 1)] },
    ]);
    expect(perUnitDirectSkuOzForMenuItem(bad, "M").size).toBe(0);
    expect(perUnitSkuOzForMenuItemFromGraph(bad, "M").size).toBe(0);
  });
});
