import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { batchSkuOzForItemFromGraph, buildRecipeGraph, type GraphRecipe } from "@/lib/prep-consumption-graph";

const mocks = vi.hoisted(() => ({ productIndex: vi.fn(), inserts: [] as Array<{ table: string; value: unknown }> }));
vi.mock("@/lib/products", () => ({ loadProductIndex: mocks.productIndex }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => ({ from: (table: string) => {
    const rows: Record<string, unknown> = {
      recipes: [{ id: "recipe", batch_yield: 2 }],
      recipe_inputs: [{ recipe_id: "recipe", quantity: 12, unit: "oz", component_sku_id: null, component_item_id: null, component_product_id: "product" }],
      recipe_outputs: [{ recipe_id: "recipe", output_item_id: "prep", output_menu_item_id: null, yield: 2 }],
      items: [{ id: "prep", oz_per_par_unit: 6, default_par_unit: "unit" }],
      measure_units: [{ label: "oz", dimension: "weight", to_base_factor: 1 }],
      vendor_items: ["regular-A", "shop-B-store"].map((id) => ({ id, name: id, units_per_pack: null, each_size: null, each_measure: null, avg_oz_per_each: 1, pack_format: null, each_container_label: null })),
      productions: { id: "production" },
    };
    const result = { data: rows[table] ?? [], error: null };
    const query = {
      select: () => query, eq: () => query, is: () => query, in: () => query, order: () => query,
      update: () => query,
      insert: (value: unknown) => { mocks.inserts.push({ table, value }); return query; },
      returns: () => Promise.resolve(result), maybeSingle: () => Promise.resolve(result),
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return query;
  } }),
}));
import { loadBatchDerivedForItems, recordBatchProductionFromPrep } from "@/lib/prep-consumption";

beforeEach(() => {
  mocks.inserts.length = 0;
  mocks.productIndex.mockReset().mockImplementation((_ids: string[], locationId?: string) => {
    const skuId = locationId === "shop-A" ? "regular-A" : "shop-B-store";
    return { index: {
      resolution: new Map([["product", { productId: "product", skuId, rung: "primary", reason: null, consideredSkuIds: [skuId] }]]),
      basis: new Map([["product", { packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: 1 }]]),
    } };
  });
});

const read = (path: string) => readFileSync(path, "utf8");

describe("BC-025: batch preview and production shop resolution", () => {
  it.each(["shop-A", "shop-B"])("preview and persisted inputs both resolve the %s member", async (locationId) => {
    const skuId = locationId === "shop-A" ? "regular-A" : "shop-B-store";
    const preview = await loadBatchDerivedForItems(["prep"], locationId);
    expect(preview.get("prep")?.skus.map((sku) => [sku.skuId, sku.perUnitOz])).toEqual([[skuId, 12]]);
    await recordBatchProductionFromPrep({ userId: "maker", role: "agm" }, {
      locationId, instanceId: "instance", templateItemId: "line", outputItemId: "prep",
      batches: 2, cameOutTo: 4, confirmedConsumption: null, producedAt: "2026-10-08T12:00:00Z", madeBy: "maker", source: "opening_p2",
    });
    expect(mocks.productIndex.mock.calls.map((call) => call[1])).toEqual([locationId, locationId]);
    expect(mocks.inserts.find((row) => row.table === "productions")?.value).toMatchObject({ location_id: locationId, output_qty: 4 });
    expect(mocks.inserts.find((row) => row.table === "production_inputs")?.value).toEqual([
      { production_id: "production", input_sku_id: skuId, input_oz: 24, qty_entered: null, unit_entered: null, derived_oz: 24 },
    ]);
  });
  it("requires the shop at both preview callers and uses it in the production graph", () => {
    const source = read("lib/prep-consumption.ts");
    const preview = source.slice(source.indexOf("export async function loadBatchDerivedForItems"), source.indexOf("export interface RecordBatchFromPrepInput"));
    const production = source.slice(source.indexOf("export async function recordBatchProductionFromPrep"));
    expect(preview).toContain("itemIds: string[], locationId: string");
    expect(preview).toContain("loadRecipeGraph({ locationId })");
    expect(production).toContain("loadRecipeGraph({ locationId: input.locationId })");
    expect(preview + production).not.toContain("loadRecipeGraph()");
    expect(read("lib/opening.ts")).toContain("loadBatchDerivedForItems(batchItemIds, args.locationId)");
    expect(read("lib/prep.ts")).toContain("loadBatchDerivedForItems(batchItemIds, instanceRow.location_id)");
  });

  it("attributes a product batch to the shop's member, never the other shop's SKU", () => {
    const recipe: GraphRecipe = {
      recipeId: "batch", batchYield: 2,
      inputs: [{ quantity: 12, unit: "oz", componentSkuId: null, componentItemId: null, componentProductId: "product" }],
      outputs: [{ outputItemId: "prep", outputMenuItemId: null, yield: 2, ozPerParUnit: 6 }],
    };
    for (const skuId of ["regular-A", "shop-B-store"]) {
      const graph = buildRecipeGraph([recipe], new Map(), new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]]), {
        resolution: new Map([["product", { productId: "product", skuId, rung: "primary", reason: null, consideredSkuIds: [skuId] }]]),
        basis: new Map([["product", { packFormat: null, eachContainerLabel: null, unitsPerPack: null, eachSize: null, eachMeasure: null, avgOzPerEach: 1 }]]),
      });
      expect([...batchSkuOzForItemFromGraph(graph, "prep")!]).toEqual([[skuId, 12]]);
    }
  });
});
