/**
 * Catalog Phase 4a fixture foundation: production-shaped base schema followed by
 * the real 0258-0264 migrations, exclusively in memory. The opt-out exists to
 * capture real pre-migration snapshots before applying the actual 0264 file.
 */
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { migratedCatalogDb } from "./recipe-versions-pglite";

export const SHOP_OWNED_ID = {
  actor: "00000000-0000-4000-8000-0000000000a1",
  shopA: "00000000-0000-4000-8000-00000000a0a0",
  shopB: "00000000-0000-4000-8000-00000000b0b0",
  sharedSku: "00000000-0000-4000-8000-0000000000d1",
  sharedItem: "00000000-0000-4000-8000-0000000000d2",
  sharedRecipe: "00000000-0000-4000-8000-0000000000e1",
  sharedMenu: "00000000-0000-4000-8000-0000000000f1",
} as const;

/** Two-shop, shared-only baseline ready for 0264 ownership tests in Chunk 2. */
export async function migratedShopOwnedDb(applyOwnership = true): Promise<PGlite> {
  const db = await migratedCatalogDb();
  await db.exec(`
    insert into public.users(id) values ('${SHOP_OWNED_ID.actor}');
    insert into public.locations(id, name, active) values
      ('${SHOP_OWNED_ID.shopA}', 'Shop A', true),
      ('${SHOP_OWNED_ID.shopB}', 'Shop B', true);
    insert into public.measure_units(label, dimension, to_base_factor, active)
      values ('oz', 'weight', 1, true);
    insert into public.prep_sections(slug, label_en, columns) values ('prep', 'Prep', '[]');
    insert into public.vendor_items(id, name) values ('${SHOP_OWNED_ID.sharedSku}', 'Shared turkey');
    insert into public.items(id, name) values ('${SHOP_OWNED_ID.sharedItem}', 'Shared prep');
    insert into public.menu_items(id, name, menu_price) values ('${SHOP_OWNED_ID.sharedMenu}', 'Shared sandwich', 12);
    insert into public.recipes(id, name, recipe_type, batch_yield, created_by)
      values ('${SHOP_OWNED_ID.sharedRecipe}', 'Shared sandwich', 'consumer', 1, '${SHOP_OWNED_ID.actor}');
    insert into public.recipe_inputs(recipe_id, component_sku_id, quantity, unit, created_by)
      values ('${SHOP_OWNED_ID.sharedRecipe}', '${SHOP_OWNED_ID.sharedSku}', 4, 'oz', '${SHOP_OWNED_ID.actor}');
    insert into public.recipe_outputs(recipe_id, output_menu_item_id, yield, created_by)
      values ('${SHOP_OWNED_ID.sharedRecipe}', '${SHOP_OWNED_ID.sharedMenu}', 1, '${SHOP_OWNED_ID.actor}');
  `);
  if (applyOwnership) await applyShopOwnership(db);
  return db;
}

export async function applyShopOwnership(db: PGlite): Promise<void> {
  await db.exec(readFileSync("supabase/migrations/0264_catalog_shop_owned.sql", "utf8"));
}
