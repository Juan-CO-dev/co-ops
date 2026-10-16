/** Phase 4a consumer fixture. Prospective ownership rows, NOT SQL writer evidence.
 * Each shop has its own SKU -> prep recipe/item -> sandwich recipe/menu item.
 * No cross-owner edge is fabricated. Shared rows and all existing goldens stay intact.
 * SQL legality and the real-schema before/after 0264 gate belong to Chunks 2/3.
 */
import { buildRecipeVersionsFixture, withBackfilledRecipeVersions, LOC, OTHER } from "./recipe-versions-fixture";
import type { Tables } from "./counts-fake-db";

export const OWNED = [
  { shop: LOC, sku: "owned-a-sku", item: "owned-a-item", menu: "owned-a-menu", prep: "owned-a-prep", recipe: "owned-a-recipe" },
  { shop: OTHER, sku: "owned-b-sku", item: "owned-b-item", menu: "owned-b-menu", prep: "owned-b-prep", recipe: "owned-b-recipe" },
] as const;

export function buildShopOwnedFixture(includeOwned = true): Tables {
  const tables = buildRecipeVersionsFixture();
  // Omit ownership consistently on every legacy entity projection. The fake DB's
  // .is(null) distinguishes omitted from null for item/product links; preserving
  // omission keeps the historical goldens intact. Owned rows below are explicit.
  // This compatibility fixture does not replace the real-schema PGlite gate.
  for (const table of ["vendor_items", "items", "recipes", "menu_items"]) {
    for (const row of tables[table]!) delete row.location_id;
  }
  if (!includeOwned) return tables;
  for (const own of OWNED) {
    // Clone a known legacy pack basis, but keep this SKU outside every shared product.
    const baseSku = tables.vendor_items!.find(row => row.id === "s-lettuce")!;
    tables.vendor_items!.push({ ...baseSku, id: own.sku, name: own.sku, location_id: own.shop,
      product_id: null, pack_format: "bag", units_per_pack: 1, each_size: 16, each_measure: "oz" });
    tables.items!.push({ id: own.item, name: own.item, active: true, location_id: own.shop,
      oz_per_par_unit: 8, default_par_unit: "each" });
    tables.menu_items!.push({ id: own.menu, name: own.menu, name_es: null, section: "Subs", active: true,
      location_id: own.shop, menu_price: 10, price_same_as_id: null, catering_available: false });
    for (const id of [own.prep, own.recipe]) tables.recipes!.push({ id, name: id, active: true,
      location_id: own.shop, batch_yield: 1, created_at: "2026-10-01T00:00:00.000Z" });
    tables.recipe_inputs!.push(
      { id: `${own.prep}-line`, recipe_id: own.prep, component_sku_id: own.sku, component_item_id: null,
        component_product_id: null, quantity: 8, unit: "oz", portioned: false, display_order: 0 },
      { id: `${own.recipe}-line`, recipe_id: own.recipe, component_sku_id: null, component_item_id: own.item,
        component_product_id: null, quantity: 1, unit: "each", portioned: false, display_order: 0 },
    );
    tables.recipe_outputs!.push(
      { id: `${own.prep}-out`, recipe_id: own.prep, output_item_id: own.item, output_menu_item_id: null, yield: 1 },
      { id: `${own.recipe}-out`, recipe_id: own.recipe, output_item_id: null, output_menu_item_id: own.menu, yield: 1 },
    );
    tables.vendor_price_history!.push({ id: `${own.sku}-price`, vendor_item_id: own.sku,
      unit_price: 4, effective_date: "2026-10-01", recorded_at: "2026-10-01T00:00:00.000Z",
      location_id: null, price_lane_id: null });
  }
  return withBackfilledRecipeVersions(tables);
}
