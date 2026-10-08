import { expect, it } from "vitest";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import { buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";
import { packageShadowAmounts } from "@/lib/ezcater/shadow-package";

type Line = { id: string; slot_type: string; item_id: string | null; menu_item_id: string | null; quantity: number | string };
type Option = { item_id: string | null; menu_item_id: string | null; classic: boolean };
function client(lines: Line[], options: Record<string, Option[]> = {}) {
  return { from(table: string) {
    let slotId = "";
    const query = {
      select: () => query,
      eq: (key: string, value: string | boolean) => { if (key === "package_item_id") slotId = String(value); return query; },
      order: () => query,
      range: () => query,
      abortSignal: async () => ({ data: table === "catering_package_items" ? lines : options[slotId] ?? [], error: null }),
    };
    return query;
  } } as unknown as ReturnType<typeof getServiceRoleClient>;
}
const recipes: GraphRecipe[] = [
  { recipeId: "prep-recipe", batchYield: 1,
    inputs: [{ componentSkuId: "filling", componentItemId: null, quantity: 4, unit: "oz" }],
    outputs: [{ outputItemId: "prep", outputMenuItemId: null, yield: 1, ozPerParUnit: null }] },
  { recipeId: "sandwich-recipe", batchYield: 1,
    inputs: [{ componentSkuId: null, componentItemId: "prep", quantity: 1, unit: null },
      { componentSkuId: "bread", componentItemId: null, quantity: 2, unit: "oz" }],
    outputs: [{ outputItemId: null, outputMenuItemId: "sandwich", yield: 1, ozPerParUnit: null }] },
];
const graph = buildRecipeGraph(recipes, new Map(["filling", "bread"].map((sku) => [sku, {
  packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: null,
}])), new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]]));
const fixed: Line = { id: "fixed", slot_type: "fixed", item_id: "prep", menu_item_id: null, quantity: "2" };
const choice: Line = { id: "choice", slot_type: "choice", item_id: null, menu_item_id: null, quantity: 4 };
const signal = new AbortController().signal;

it("multiplies fixed package composition by the sold line quantity", async () => {
  expect(await packageShadowAmounts(client([fixed]), graph, "package", 3, "new", "2026-10-08", [], [], signal))
    .toEqual([{ sku_id: "filling", sales_oz: 24, suppressed_oz: 0, shadow_oz: 24 }]);
});

it("uses an even mix of all enabled choice options, including non-classics, without halving whole-sub slots", async () => {
  const options = { choice: [
    { item_id: "prep", menu_item_id: null, classic: true },
    { item_id: null, menu_item_id: "sandwich", classic: false },
  ] };
  const result = await packageShadowAmounts(client([fixed, choice], options), graph, "package", 3, "new", "2026-10-08", [], [], signal);
  // Fixed: 6 prep units. Choice: 12 whole units / 2 options = 6 each.
  expect(result).toEqual(expect.arrayContaining([
    { sku_id: "filling", sales_oz: 72, suppressed_oz: 0, shadow_oz: 72 },
    { sku_id: "bread", sales_oz: 12, suppressed_oz: 0, shadow_oz: 12 },
  ]));
  expect(result).toHaveLength(2);
});

it("a late transfer suppresses package prep from the old shop but preserves raw menu ingredients", async () => {
  const menu = { ...fixed, item_id: null, menu_item_id: "sandwich", quantity: 1 };
  const production = [{ location_id: "old", output_item_id: "prep", produced_at: "2026-10-08T01:00:00Z" }];
  const transfers = [{ created_at: "2026-10-07T04:00:00Z", metadata: { from_location_id: "old", to_location_id: "new" } }];
  const result = await packageShadowAmounts(client([menu]), graph, "package", 3, "new", "2026-10-08", production, transfers, signal);
  expect(result).toEqual(expect.arrayContaining([
    { sku_id: "filling", sales_oz: 12, suppressed_oz: 12, shadow_oz: 0 },
    { sku_id: "bread", sales_oz: 6, suppressed_oz: 0, shadow_oz: 6 },
  ]));
  const early = [{ ...transfers[0]!, created_at: "2026-10-07T03:59:59Z" }];
  const beforeCutoff = await packageShadowAmounts(client([menu]), graph, "package", 3, "new", "2026-10-08", production, early, signal);
  expect(beforeCutoff.find((amount) => amount.sku_id === "filling")?.shadow_oz).toBe(12);
});

it.each([
  { ...fixed, id: "unresolved", item_id: "missing-recipe" },
  { ...fixed, id: "unresolved", item_id: null },
  { ...fixed, id: "unresolved", quantity: "not-a-number" },
  { ...fixed, id: "unresolved", quantity: -1 },
  choice,
])("refuses the whole package instead of retaining earlier resolved lines: $id $quantity", async (unresolved) => {
  expect(await packageShadowAmounts(client([fixed, unresolved]), graph, "package", 3, "new", "2026-10-08", [], [], signal)).toEqual([]);
});

it("refuses an entire choice slot when one option has no recipe", async () => {
  const options = { choice: [
    { item_id: "prep", menu_item_id: null, classic: true },
    { item_id: "missing-recipe", menu_item_id: null, classic: false },
  ] };
  expect(await packageShadowAmounts(client([fixed, choice], options), graph, "package", 3, "new", "2026-10-08", [], [], signal)).toEqual([]);
});

it("refuses a menu line with one missing prep component instead of publishing its raw ingredients", async () => {
  const broken = { ...graph, byOutputItem: new Map(graph.byOutputItem) };
  broken.byOutputItem.delete("prep");
  const menu = { ...fixed, item_id: null, menu_item_id: "sandwich" };
  expect(await packageShadowAmounts(client([menu]), broken, "package", 3, "new", "2026-10-08", [], [], signal)).toEqual([]);
});
