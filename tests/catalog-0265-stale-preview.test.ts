import { afterEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { migratedShopOwnedDb, SHOP_OWNED_ID as I } from "./fixtures/shop-owned-pglite";

let db: PGlite;
afterEach(async () => { await db?.close(); });

it("0265 refuses a pre-schema product-primary preview without mutation, then accepts fresh evidence", async () => {
  db = await migratedShopOwnedDb();
  const product = (await db.query<{ id: string }>("insert into products(name) values ('Before revision') returning id")).rows[0]!.id;
  await db.query("update vendor_items set product_id=$1 where id=$2", [product, I.sharedSku]);
  await db.query("insert into product_primaries(product_id,primary_sku_id) values ($1,$2)", [product, I.sharedSku]);
  const lines = JSON.stringify([{ component_product_id: product, quantity: 4, unit: "oz", portioned: false }]);
  const head = (await db.query<{ id: string }>("select id from recipe_versions where recipe_id=$1 and location_id is null and active", [I.sharedRecipe])).rows[0]!.id;
  // A genuine 0264 snapshot, before the primary's revision column exists.
  expect((await db.query("select column_name from information_schema.columns where table_name='product_primaries' and column_name='revision'")).rows).toHaveLength(0);
  const stale = (await db.query<{ snapshot: unknown }>("select recipe_change_snapshot($1,$2,$3::jsonb) snapshot", [I.sharedRecipe, I.shopA, lines])).rows[0]!.snapshot;
  await db.exec(readFileSync("supabase/migrations/0265_sku_swaps.sql", "utf8"));
  const state = async () => {
    const rows = {} as Record<string, unknown>;
    for (const table of ["recipe_versions", "recipe_version_lines", "recipe_inputs", "product_primaries"])
      rows[table] = (await db.query(`select to_jsonb(v) row from ${table} v order by id`)).rows;
    return rows;
  };
  const before = await state();
  const save = (snapshot: unknown) => db.query("select save_recipe_version($1,$2,$3::jsonb,null,$4,null,$5,null,null,null,$6::jsonb)", [I.sharedRecipe, I.shopA, lines, head, I.actor, JSON.stringify(snapshot)]);
  await expect(save(stale)).rejects.toMatchObject({ message: "recipe_version:dependencies_changed" });
  expect(await state()).toEqual(before);
  expect((await db.query("select id from recipe_versions where recipe_id=$1 and location_id=$2 and active", [I.sharedRecipe, I.shopA])).rows).toHaveLength(0);
  const fresh = (await db.query<{ snapshot: unknown }>("select recipe_change_snapshot($1,$2,$3::jsonb) snapshot", [I.sharedRecipe, I.shopA, lines])).rows[0]!.snapshot;
  expect(fresh).not.toEqual(stale);
  await save(fresh);
  expect((await db.query("select id from recipe_versions where recipe_id=$1 and location_id=$2 and active", [I.sharedRecipe, I.shopA])).rows).toHaveLength(1);
}, 120_000);
