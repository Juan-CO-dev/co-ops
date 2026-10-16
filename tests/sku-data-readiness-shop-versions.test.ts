/** Catalog Phase 2a — readiness is per shop: a shop's own pack/price answers for that shop only. */
import { describe, expect, it } from "vitest";
import { evaluateWave7Tables, type LiveTables } from "@/lib/sku-data-readiness";

function tables(): LiveTables {
  const data: LiveTables = Object.fromEntries(["items", "menu_items", "products", "recipes", "recipe_inputs", "recipe_outputs", "vendor_deliveries", "vendor_delivery_items", "product_primaries", "location_sku_settings", "sku_pack_levels", "vendor_price_history", "vendor_cutoffs", "vendor_delivery_rhythm", "sku_price_lanes"].map((n) => [n, []]));
  data.locations = [{ id: "north", name: "North", active: true }, { id: "south", name: "South", active: true }];
  data.vendors = [{ id: "vendor", active: true }];
  data.vendor_items = [{ id: "sku", name: "Turkey", vendor_id: "vendor", active: true, sku_class: "raw", pack_format: null, units_per_pack: null, each_size: null, each_measure: null, weight_class: "OPERATIONAL", weekday_par: 1, weekend_par: 1 }];
  data.measure_units = [{ id: "oz", label: "oz", dimension: "weight", to_base_factor: 1, active: true }];
  data.vendor_cutoffs = [{ id: "c", vendor_id: "vendor", active: true }];
  data.vendor_delivery_rhythm = [{ id: "r", vendor_id: "vendor", active: true }];
  return data;
}

describe("evaluateWave7Tables — per-shop chain and price", () => {
  it("a shop-only chain and a shop-only price clear that shop's errands and nobody else's", () => {
    const data = tables();
    data.sku_pack_levels = [{ id: "l1", sku_id: "sku", version_id: "v-n", location_id: "north", label: "case", contains_qty: 160, contains_level_id: null, contains_measure_unit: "oz", display_ordinal: 0, active: true }];
    data.sku_price_lanes = [{ id: "lane-n", sku_id: "sku", location_id: "north", active: true }];
    data.vendor_price_history = [{ id: "p-n", vendor_item_id: "sku", unit_price: 40, effective_date: "2026-09-05", recorded_at: "2026-09-05T12:00:00Z", location_id: "north", price_lane_id: "lane-n" }];
    const shops = evaluateWave7Tables(data).shops;
    const north = shops.find((s) => s.id === "north")!.rows[0]!;
    const south = shops.find((s) => s.id === "south")!.rows[0]!;
    expect(north.errands.map((e) => e.code)).not.toContain("no_price");
    expect(north.errands.map((e) => e.code)).not.toContain("raw_pack_contents_missing");
    expect(south.errands.map((e) => e.code)).toEqual(expect.arrayContaining(["no_price", "raw_pack_contents_missing"]));
  });

  it("a retired lane answers nobody: the shop falls back to the global price", () => {
    const data = tables();
    data.sku_price_lanes = [{ id: "lane-n", sku_id: "sku", location_id: "north", active: false }];
    data.vendor_price_history = [
      { id: "p-g", vendor_item_id: "sku", unit_price: 30, effective_date: "2026-09-01", recorded_at: "2026-09-01T12:00:00Z", location_id: null, price_lane_id: null },
      { id: "p-n", vendor_item_id: "sku", unit_price: 40, effective_date: "2026-09-05", recorded_at: "2026-09-05T12:00:00Z", location_id: "north", price_lane_id: "lane-n" },
    ];
    const north = evaluateWave7Tables(data).shops.find((s) => s.id === "north")!.rows[0]!;
    expect(JSON.parse(north.consumerBasis).price).toBe(30);
  });

  it("with no versions at all, every shop reads exactly what it read before 0259", () => {
    const data = tables();
    Object.assign(data.vendor_items![0]!, { pack_format: "Case", units_per_pack: 1, each_size: 16, each_measure: "oz" });
    data.vendor_price_history = [{ id: "p", vendor_item_id: "sku", unit_price: 10, effective_date: "2026-09-01" }];
    for (const shop of evaluateWave7Tables(data).shops) expect(shop.rows[0]).toMatchObject({ order: "usable", count: "usable", cost: "usable" });
  });
});

describe("evaluateWave7Tables — per-shop RECIPE versions (catalog Phase 3a chunk-2 review P2)", () => {
  /** North's slaw swaps mayo for pickle (its own live version); south rides the default. */
  function withSlaw(): LiveTables {
    const data = tables();
    data.vendor_items = ["lettuce", "mayo", "pickle"].map((id) => ({ id, name: id, vendor_id: "vendor", active: true, sku_class: "raw", pack_format: null,
      units_per_pack: null, each_size: null, each_measure: null, weight_class: "OPERATIONAL", weekday_par: 1, weekend_par: 1 }));
    data.items = [{ id: "i-slaw", name: "Slaw", oz_per_par_unit: 32, default_par_unit: "quart" }];
    data.recipes = [{ id: "r-slaw", name: "Slaw", active: true, created_at: "2026-09-01T00:00:00Z", batch_yield: 1 }];
    data.recipe_outputs = [{ id: "ro", recipe_id: "r-slaw", output_item_id: "i-slaw", output_menu_item_id: null, yield: 1 }];
    data.recipe_inputs = [
      { id: "ri-1", recipe_id: "r-slaw", quantity: 48, unit: "oz", component_sku_id: "lettuce", component_item_id: null, component_product_id: null },
      { id: "ri-2", recipe_id: "r-slaw", quantity: 16, unit: "oz", component_sku_id: "mayo", component_item_id: null, component_product_id: null },
    ];
    data.recipe_versions = [{ id: "rv-n", recipe_id: "r-slaw", location_id: "north", valid_from: "2026-10-01T00:00:00Z", valid_to: null, active: true }];
    data.recipe_version_lines = [
      { id: "l1", version_id: "rv-n", recipe_id: "r-slaw", quantity: 48, unit: "oz", component_sku_id: "lettuce", component_item_id: null, component_product_id: null, display_order: 0 },
      { id: "l2", version_id: "rv-n", recipe_id: "r-slaw", quantity: 16, unit: "oz", component_sku_id: "pickle", component_item_id: null, component_product_id: null, display_order: 1 },
    ];
    return data;
  }
  const deps = (data: LiveTables, shop: string) =>
    [...evaluateWave7Tables(data).shops.find((s) => s.id === shop)!.recipes.find((r) => r.id.startsWith("r-slaw/"))!.dependencies].sort();

  it("owned recipes appear only at their shop after full-universe validation", () => {
    const data = withSlaw();
    data.recipes![0]!.location_id = "north";
    delete data.recipe_versions;
    delete data.recipe_version_lines;
    const report = evaluateWave7Tables(data);
    expect(report.shops.find(s => s.id === "north")!.recipes).toHaveLength(1);
    expect(report.shops.find(s => s.id === "south")!.recipes).toHaveLength(0);
    data.recipe_inputs![0]!.component_sku_id = "missing";
    expect(() => evaluateWave7Tables(data, new Map(), "2026-10-15", "2026-10-15", new Set(["south"]))).toThrow("INCOMPLETE_GRAPH");
  });

  it("each shop's graph is built from ITS resolved recipe: pickle at north, mayo at south", () => {
    const data = withSlaw();
    expect(deps(data, "north")).toEqual(["lettuce", "pickle"]);
    expect(deps(data, "south")).toEqual(["lettuce", "mayo"]);
  });
  it("with no shop version (or the version tables absent, pre-0262) every shop reads the default", () => {
    const none = withSlaw();
    none.recipe_versions = [];
    none.recipe_version_lines = [];
    expect(deps(none, "north")).toEqual(["lettuce", "mayo"]);
    const pre = withSlaw();
    delete pre.recipe_versions;
    delete pre.recipe_version_lines;
    expect(deps(pre, "north")).toEqual(["lettuce", "mayo"]);
  });
  it("a version line naming a SKU the load does not hold refuses (a dropped page is not a smaller graph)", () => {
    const data = withSlaw();
    data.recipe_version_lines![1]!.component_sku_id = "ghost";
    expect(() => evaluateWave7Tables(data)).toThrow(/INCOMPLETE_GRAPH/);
  });
});
