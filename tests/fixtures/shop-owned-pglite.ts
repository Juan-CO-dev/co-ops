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

/** Chunk 3 prerequisite: persisted shared data, written before ownership exists.
 * Packs, prices, recipe versions and menu overlays use the actual shipped RPCs.
 * Count tables are the verbatim 0160 definitions, not mock result objects.
 */
export async function seedOperationalBaseline(db: PGlite): Promise<void> {
  const countMigration = readFileSync("supabase/migrations/0160_receiving_counts.sql", "utf8");
  await db.exec(countMigration.slice(countMigration.indexOf("CREATE TABLE public.sku_count_events ("),
    countMigration.indexOf("COMMENT ON TABLE public.sku_count_events")));
  const id = SHOP_OWNED_ID;
  const pack = (oz: number) => JSON.stringify([{ label: "case", containsQty: oz, containsMeasureUnit: "oz" }]);
  const global = await db.query<{ result: { version_id: string } }>(
    "select public.save_sku_pack_version($1,null,$2::jsonb,null,null,null,$3,false) result", [id.sharedSku, pack(16), id.actor]);
  await db.query("select public.save_sku_pack_version($1,$2,$3::jsonb,null,$4,null,$5,false)",
    [id.sharedSku, id.shopA, pack(32), global.rows[0]!.result.version_id, id.actor]);
  await db.query("select public.save_sku_global_price($1,8,'2020-01-01',$2,false)", [id.sharedSku, id.actor]);
  await db.query("select public.save_sku_shop_price($1,$2,24,'2020-01-01',$3,'manual',null)", [id.sharedSku, id.shopA, id.actor]);
  const head = (await db.query<{ id: string }>("select id from public.recipe_versions where recipe_id=$1 and location_id is null and active", [id.sharedRecipe])).rows[0]!.id;
  const lines = JSON.stringify([{ component_sku_id: id.sharedSku, quantity: 6, unit: "oz", portioned: false }]);
  await db.query(`select public.save_recipe_version($1,$2,$3::jsonb,null,$4,null,$5,null,null,null,
    public.recipe_change_snapshot($1,$2,$3::jsonb))`, [id.sharedRecipe, id.shopA, lines, head, id.actor]);
  await db.query(`select public.save_menu_item_shop_setting($1,$2,15,true,null,null,null,null,$3,null,
    public.menu_item_change_snapshot($1,$2))`, [id.sharedMenu, id.shopA, id.actor]);
  for (const shop of [id.shopA, id.shopB]) {
    await db.query(`with event as (
      insert into public.sku_count_events(location_id,counted_at,counted_by) values ($1,'2026-10-14T12:00:00Z',$2) returning id
    ) insert into public.sku_count_lines(count_event_id,sku_id,level_label,qty,resolved_oz)
      select id,$3,'case',2,32 from event`, [shop, id.actor, id.sharedSku]);
  }
}

/** SQL-backed snapshot adapter: EVERY nonempty row comes from persisted PGlite.
 * The existing PostgREST adapter executes production query composition over that
 * snapshot; it implements transport only, never recipe/pack/ownership resolution.
 */
export async function persistedCatalogRows(db: PGlite): Promise<Record<string, Record<string, unknown>[]>> {
  const tables = await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename");
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const { tablename } of tables.rows) {
    const result = await db.query<{ row: Record<string, unknown> }>(`select to_jsonb(t) row from public."${tablename.replaceAll('"', '""')}" t order by to_jsonb(t)->>'id'`);
    out[tablename] = result.rows.map(r => r.row);
  }
  return out;
}
