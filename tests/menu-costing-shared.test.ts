/**
 * Unit spine — lib/menu-costing-shared.ts (the menu costing board's pure math).
 *
 * Tripwires for the invariants the board's honesty rests on:
 *  - recipe→recipe nesting ≥3 rolls cost all the way to leaf SKUs;
 *  - count-unit lines cost through avg_oz_per_each (the moat Angel lacks);
 *  - a missing price makes ONE LINE unpriced and counted — never a $0, never a
 *    poisoned row, and never an FC%/margin derived from a partial cost;
 *  - cook-down: a declared finished weight (items.oz_per_par_unit) changes what
 *    a downstream ounce COSTS, and the undeclared fallback understates it;
 *  - "unresolved" (a data bug) never masquerades as "no_recipe" or as $0.
 */
import { describe, it, expect } from "vitest";

import {
  FOOD_COST_RED_THRESHOLD_PCT,
  compareMenuCostRows,
  composeMenuCostRows,
  rollupItemCost,
  rollupMenuItemCost,
  summarizeMenuCostRows,
  toMenuCostRow,
  type MenuCostInput,
} from "@/lib/menu-costing-shared";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";

const MEASURES = new Map<string, MeasureUnitFactor>([
  ["oz", { dimension: "weight", toBaseFactor: 1 }],
  ["lb", { dimension: "weight", toBaseFactor: 16 }],
  ["each", { dimension: "count", toBaseFactor: 1 }],
]);

const PLAIN: RecipeInputSku = {
  packFormat: null, eachContainerLabel: null, unitsPerPack: null,
  eachSize: null, eachMeasure: null, avgOzPerEach: null,
};
/** A COUNT-measured SKU: one "each" weighs 1.5 oz (the avg_oz_per_each bridge). */
const COUNTED: RecipeInputSku = { ...PLAIN, avgOzPerEach: 1.5 };

const PACK = new Map<string, RecipeInputSku>([
  ["sku1", PLAIN], ["sku2", PLAIN], ["sku3", PLAIN], ["skuCount", COUNTED],
]);

function ozIn(quantity: number, skuId: string): GraphRecipe["inputs"][number] {
  return { quantity, unit: "oz", componentSkuId: skuId, componentItemId: null };
}
function eachIn(quantity: number, skuId: string): GraphRecipe["inputs"][number] {
  return { quantity, unit: "each", componentSkuId: skuId, componentItemId: null };
}
/** Item ref in PAR-UNITS (null unit → quantity is par-units, the seed convention). */
function itemIn(quantity: number, itemId: string): GraphRecipe["inputs"][number] {
  return { quantity, unit: null, componentSkuId: null, componentItemId: itemId };
}
/** Item ref denominated in OUNCES — the line shape cook-down math acts on. */
function itemOzIn(quantity: number, itemId: string): GraphRecipe["inputs"][number] {
  return { quantity, unit: "oz", componentSkuId: null, componentItemId: itemId };
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
/** $/oz map. `null` and "absent" both mean UNPRICED — the board treats them alike. */
function prices(entries: Array<[string, number | null]>) {
  return new Map<string, number | null>(entries);
}

describe("rollupMenuItemCost — nesting", () => {
  it("rolls cost through recipe→recipe→recipe nesting (depth 3) to leaf SKUs", () => {
    // A (prep)      : 20 oz sku1 per batch, yield 10 → 2 oz/unit
    // B (prep)      : 2 units of A + 8 oz sku2, yield 4 → 1 oz sku1 + 2 oz sku2 per unit
    // M (menu build): 3 units of B + 1 oz sku3, yield 1
    const g = graphOf([
      { recipeId: "rA", batchYield: 10, inputs: [ozIn(20, "sku1")], outputs: [itemOut("A", 10)] },
      { recipeId: "rB", batchYield: 4, inputs: [itemIn(2, "A"), ozIn(8, "sku2")], outputs: [itemOut("B", 4)] },
      { recipeId: "rM", batchYield: 1, inputs: [itemIn(3, "B"), ozIn(1, "sku3")], outputs: [menuOut("M", 1)] },
    ]);
    // per unit of M: sku1 3×1 = 3 oz, sku2 3×2 = 6 oz, sku3 1 oz
    const r = rollupMenuItemCost(g, "M", prices([["sku1", 0.10], ["sku2", 0.20], ["sku3", 0.50]]));
    expect(r.status).toBe("costed");
    expect(r.cost).toBeCloseTo(3 * 0.1 + 6 * 0.2 + 1 * 0.5, 10); // 0.30 + 1.20 + 0.50
    expect(r.unpricedLineCount).toBe(0);
    expect(r.pricedLineCount).toBe(3);
  });

  it("a SKU reached through TWO different nesting paths is ONE line, summed once", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 1, inputs: [ozIn(2, "sku1")], outputs: [itemOut("A", 1)] },
      { recipeId: "rM", batchYield: 1, inputs: [itemIn(1, "A"), ozIn(3, "sku1")], outputs: [menuOut("M", 1)] },
    ]);
    const r = rollupMenuItemCost(g, "M", prices([["sku1", 1]]));
    expect(r.pricedLineCount).toBe(1);
    expect(r.cost).toBeCloseTo(5, 10); // 2 oz via A + 3 oz direct
  });
});

describe("rollupMenuItemCost — count units", () => {
  it("costs a count-denominated line through avg_oz_per_each", () => {
    // 4 each × 1.5 oz/each = 6 oz @ $0.25/oz = $1.50
    const g = graphOf([
      { recipeId: "rM", batchYield: 1, inputs: [eachIn(4, "skuCount")], outputs: [menuOut("M", 1)] },
    ]);
    const r = rollupMenuItemCost(g, "M", prices([["skuCount", 0.25]]));
    expect(r.status).toBe("costed");
    expect(r.cost).toBeCloseTo(1.5, 10);
  });

  it("a count SKU with NO avg_oz_per_each is oz-unresolvable → unresolved, not $0", () => {
    const pack = new Map<string, RecipeInputSku>([["skuNoAvg", PLAIN]]);
    const g = buildRecipeGraph(
      [{ recipeId: "rM", batchYield: 1, inputs: [eachIn(4, "skuNoAvg")], outputs: [menuOut("M", 1)] }],
      pack, MEASURES,
    );
    const r = rollupMenuItemCost(g, "M", prices([["skuNoAvg", 0.25]]));
    expect(r.status).toBe("unresolved");
    expect(r.cost).toBeNull();
  });
});

describe("rollupMenuItemCost — unpriced honesty (§2.2 doctrine)", () => {
  const g = graphOf([
    { recipeId: "rM", batchYield: 1, inputs: [ozIn(2, "sku1"), ozIn(4, "sku2")], outputs: [menuOut("M", 1)] },
  ]);

  it("one missing price makes ONE line unpriced and counted — cost stays null", () => {
    const r = rollupMenuItemCost(g, "M", prices([["sku1", 1]]));
    expect(r.status).toBe("partial");
    expect(r.unpricedLineCount).toBe(1);
    expect(r.unpricedSkuIds).toEqual(["sku2"]);
    expect(r.cost).toBeNull();
    // the partial subtotal is still available — as a LOWER BOUND, never as "the cost"
    expect(r.pricedCost).toBeCloseTo(2, 10);
    expect(r.pricedLineCount).toBe(1);
  });

  it("an explicit null price is identical to an absent one (never a fabricated $0)", () => {
    const explicitNull = rollupMenuItemCost(g, "M", prices([["sku1", 1], ["sku2", null]]));
    const absent = rollupMenuItemCost(g, "M", prices([["sku1", 1]]));
    expect(explicitNull).toEqual(absent);
    expect(explicitNull.pricedCost).toBeCloseTo(2, 10); // NOT 2 + 4×0
  });

  it("no prices at all → unpriced, cost null, every line counted (the day-one state)", () => {
    const r = rollupMenuItemCost(g, "M", prices([]));
    expect(r.status).toBe("unpriced");
    expect(r.unpricedLineCount).toBe(2);
    expect(r.pricedCost).toBe(0);
    expect(r.cost).toBeNull();
  });

  it("FC% and margin are null whenever the rollup is incomplete", () => {
    const input: MenuCostInput = { id: "M", name: "M", nameEs: null, section: null, menuPrice: 10 };
    const partial = toMenuCostRow(input, rollupMenuItemCost(g, "M", prices([["sku1", 1]])));
    expect(partial.foodCostPct).toBeNull();
    expect(partial.marginDollars).toBeNull();
    expect(partial.overThreshold).toBe(false);

    const costed = toMenuCostRow(input, rollupMenuItemCost(g, "M", prices([["sku1", 1], ["sku2", 0.5]])));
    expect(costed.rollup.cost).toBeCloseTo(4, 10);
    expect(costed.foodCostPct).toBeCloseTo(40, 10);
    expect(costed.marginDollars).toBeCloseTo(6, 10);
  });
});

describe("rollupMenuItemCost — status disambiguation", () => {
  it("no producing recipe → no_recipe (NOT unresolved, NOT $0)", () => {
    const g = graphOf([]);
    const r = rollupMenuItemCost(g, "M", prices([]));
    expect(r.status).toBe("no_recipe");
    expect(r.cost).toBeNull();
  });

  it("a recipe that exists but cannot resolve oz → unresolved (a DATA BUG, distinct from no_recipe)", () => {
    // null unit on a SKU line is un-convertible → the engine poisons the flatten
    const g = graphOf([
      {
        recipeId: "rM", batchYield: 1,
        inputs: [{ quantity: 1, unit: null, componentSkuId: "sku1", componentItemId: null }],
        outputs: [menuOut("M", 1)],
      },
    ]);
    const r = rollupMenuItemCost(g, "M", prices([["sku1", 1]]));
    expect(r.status).toBe("unresolved");
    expect(r.cost).toBeNull();
    expect(r.unpricedLineCount).toBe(0); // an oz failure is NOT a price failure
  });

  it("a cycle poisons to unresolved rather than looping", () => {
    const g = graphOf([
      { recipeId: "rA", batchYield: 1, inputs: [itemIn(1, "B")], outputs: [itemOut("A", 1)] },
      { recipeId: "rB", batchYield: 1, inputs: [itemIn(1, "A")], outputs: [itemOut("B", 1)] },
    ]);
    expect(rollupItemCost(g, "A", prices([])).status).toBe("unresolved");
  });
});

describe("cook-down costing (declared finished weight)", () => {
  // "Caramelized Onions": 16 oz of raw onion in, batch yield 1 par-unit.
  // Input mass = 16 oz. Declared FINISHED mass = 4 oz (cooked down 4:1).
  const raw = (ozPerParUnit: number | null): GraphRecipe[] => [
    { recipeId: "rOnion", batchYield: 1, inputs: [ozIn(16, "sku1")], outputs: [itemOut("Onion", 1, ozPerParUnit)] },
    // A build asking for 4 OUNCES of the finished item.
    { recipeId: "rM", batchYield: 1, inputs: [itemOzIn(4, "Onion")], outputs: [menuOut("M", 1)] },
  ];

  it("a declared finished weight makes each finished ounce carry the FULL input cost", () => {
    // finished batch = 4 oz, so 4 oz = 1 whole par-unit = all 16 oz of onion = $1.60
    const g = graphOf(raw(4));
    const r = rollupMenuItemCost(g, "M", prices([["sku1", 0.10]]));
    expect(r.status).toBe("costed");
    expect(r.cost).toBeCloseTo(1.6, 10);
  });

  it("WITHOUT a declared finished weight the fallback UNDERSTATES a cook-down item", () => {
    // fallback per-par-unit mass = input sum = 16 oz, so 4 oz reads as 1/4 par-unit → $0.40
    const g = graphOf(raw(null));
    const r = rollupMenuItemCost(g, "M", prices([["sku1", 0.10]]));
    expect(r.status).toBe("costed");
    expect(r.cost).toBeCloseTo(0.4, 10);
    // 4× understated vs the declared-finished-weight truth above — the documented
    // gap: the engine has cook-down SEMANTICS (oz_per_par_unit) but no cook-down
    // FLAG and no declared-vs-input variance warning to make the omission loud.
  });
});

describe("board composition + ordering", () => {
  const g = graphOf([
    { recipeId: "rHigh", batchYield: 1, inputs: [ozIn(10, "sku1")], outputs: [menuOut("high", 1)] },
    { recipeId: "rLow", batchYield: 1, inputs: [ozIn(2, "sku1")], outputs: [menuOut("low", 1)] },
    { recipeId: "rPart", batchYield: 1, inputs: [ozIn(1, "sku1"), ozIn(1, "sku2")], outputs: [menuOut("part", 1)] },
    { recipeId: "rNone", batchYield: 1, inputs: [ozIn(1, "sku3")], outputs: [menuOut("none", 1)] },
  ]);
  const inputs: MenuCostInput[] = [
    { id: "none", name: "Nothing Priced", nameEs: null, section: null, menuPrice: 10 },
    { id: "low", name: "Low FC", nameEs: null, section: null, menuPrice: 10 },
    { id: "norecipe", name: "No Recipe", nameEs: null, section: null, menuPrice: 10 },
    { id: "part", name: "Partly Priced", nameEs: null, section: null, menuPrice: 10 },
    { id: "high", name: "High FC", nameEs: null, section: null, menuPrice: 10 },
  ];
  const rows = composeMenuCostRows(inputs, g, prices([["sku1", 0.5]]));

  it("groups costed → partial → unpriced → no_recipe, FC% desc within costed", () => {
    expect(rows.map((r) => r.id)).toEqual(["high", "low", "part", "none", "norecipe"]);
    expect(rows[0]!.foodCostPct).toBeCloseTo(50, 10); // 10 oz × $0.5 = $5 of $10
    expect(rows[1]!.foodCostPct).toBeCloseTo(10, 10);
  });

  it("flags rows strictly above the threshold, and only those", () => {
    expect(FOOD_COST_RED_THRESHOLD_PCT).toBe(30);
    expect(rows[0]!.overThreshold).toBe(true);
    expect(rows[1]!.overThreshold).toBe(false);
    const exactly = toMenuCostRow(
      { id: "x", name: "x", nameEs: null, section: null, menuPrice: 10 },
      { status: "costed", cost: 3, pricedCost: 3, pricedLineCount: 1, unpricedLineCount: 0, unpricedSkuIds: [] },
    );
    expect(exactly.foodCostPct).toBeCloseTo(30, 10);
    expect(exactly.overThreshold).toBe(false); // AT the threshold is not OVER it
  });

  it("a costed row with no menu price sorts after priced ones instead of ranking as worst", () => {
    const noPrice = toMenuCostRow(
      { id: "np", name: "No Price", nameEs: null, section: null, menuPrice: null },
      { status: "costed", cost: 1, pricedCost: 1, pricedLineCount: 1, unpricedLineCount: 0, unpricedSkuIds: [] },
    );
    expect(compareMenuCostRows(noPrice, rows[0]!)).toBeGreaterThan(0);
  });

  it("partial rows sort fewest-unpriced-first (the board doubles as a work queue)", () => {
    const mk = (id: string, unpriced: number) =>
      toMenuCostRow(
        { id, name: id, nameEs: null, section: null, menuPrice: 10 },
        { status: "partial", cost: null, pricedCost: 1, pricedLineCount: 1, unpricedLineCount: unpriced, unpricedSkuIds: [] },
      );
    expect([mk("b", 3), mk("a", 1)].sort(compareMenuCostRows).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("summarizes statuses and counts DISTINCT blocking SKUs across rows", () => {
    const t = summarizeMenuCostRows(rows);
    expect(t).toMatchObject({
      rowCount: 5, costedCount: 2, partialCount: 1, unpricedCount: 1, noRecipeCount: 1, overThresholdCount: 1,
    });
    expect(t.blockingSkuCount).toBe(2); // sku2 (partial) + sku3 (unpriced) — sku1 is priced
  });
});
