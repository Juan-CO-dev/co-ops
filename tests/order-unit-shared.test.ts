/** Catalog Phase 2b — the order-unit helpers and costPerOzFromGraph are pure and importable from shared modules. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orderUnitLabel, perOrderUnitOz } from "@/lib/order-unit-shared";
import { perOrderUnitOz as viaOrdering } from "@/lib/ordering";
import { costPerOzFromGraph } from "@/lib/menu-costing-shared";
import { costPerOzFromGraph as viaMenuCosting } from "@/lib/admin/menu-costing";
import { buildRecipeGraph } from "@/lib/prep-consumption-graph";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";

const measures = new Map<string, MeasureUnitFactor>([["oz", { dimension: "weight", toBaseFactor: 1 }], ["lb", { dimension: "weight", toBaseFactor: 16 }]]);
const turkey: RecipeInputSku = {
  packFormat: "case", eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null,
  packChain: [
    { id: "c", label: "case", containsQty: 4, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "b", label: "bag", containsQty: 5, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
  ],
};

describe("order-unit-shared", () => {
  it("chain root is the order unit; its oz walks the chain", () => {
    expect(perOrderUnitOz(turkey, turkey.packChain ?? null, measures)).toBe(320);
    expect(orderUnitLabel("ignored", turkey.packChain ?? null)).toBe("case");
  });
  it("lib/ordering re-exports the same function AND imports it locally (a re-export binds nothing locally)", () => {
    expect(viaOrdering).toBe(perOrderUnitOz);
    const src = readFileSync("lib/ordering.ts", "utf8");
    expect(src).toContain('import { orderUnitLabel as orderUnitLabelFor, perOrderUnitOz } from "@/lib/order-unit-shared";');
    expect(src).toContain("export { perOrderUnitOz };");
    expect(src).not.toMatch(/function perOrderUnitOz\(|function orderUnitLabelFor\(/);
  });
  it("unchained: the flat pack", () => {
    const flat: RecipeInputSku = { packFormat: "tub", eachContainerLabel: null, unitsPerPack: 1, eachSize: 30, eachMeasure: "lb", avgOzPerEach: null };
    expect(perOrderUnitOz(flat, null, measures)).toBe(480);
    expect(orderUnitLabel("tub", null)).toBe("tub");
  });
  it("a chain with no unique root has no order unit oz and falls back to the pack label", () => {
    const loop = [
      { id: "a", label: "a", containsQty: 2, containsLevelId: "b", containsMeasureUnit: null, displayOrdinal: 0 },
      { id: "b", label: "b", containsQty: 2, containsLevelId: "a", containsMeasureUnit: null, displayOrdinal: 1 },
    ];
    expect(perOrderUnitOz(turkey, loop, measures)).toBeNull();
    expect(orderUnitLabel("case", loop)).toBe("case");
  });
  it("costPerOzFromGraph prices every graph SKU: price ÷ content oz — one function, re-exported by the server module", () => {
    const graph = buildRecipeGraph([], new Map([["t", turkey]]), measures);
    expect(costPerOzFromGraph(graph, new Map([["t", 128]])).get("t")).toBeCloseTo(0.4, 12);
    expect(costPerOzFromGraph(graph, new Map()).get("t")).toBeNull();
    expect(viaMenuCosting).toBe(costPerOzFromGraph);
  });
});
