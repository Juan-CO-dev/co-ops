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
