import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyShopOwnership, migratedShopOwnedDb, seedOperationalBaseline, SHOP_OWNED_ID as I } from "./fixtures/shop-owned-pglite";

let db: PGlite;
afterEach(async () => { await db?.close(); });
it("preflight runs before ownership migration and distinguishes zero-only and nonzero foreign counts", async () => {
  db = await migratedShopOwnedDb(false);
  await seedOperationalBaseline(db);
  const sku = (await db.query<{ id: string }>("insert into vendor_items(name,location_id) values ('Foreign historical SKU',$1) returning id", [I.shopA])).rows[0]!.id;
  await db.query(`with e as (insert into sku_count_events(location_id,counted_at,counted_by) values ($1,now(),$2) returning id)
    insert into sku_count_lines(count_event_id,sku_id,level_label,qty,resolved_oz)
    select e.id,$3,'case',n.qty,n.oz from e cross join (values (0,0),(1,0),(0,2)) n(qty,oz)`, [I.shopB, I.actor, sku]);
  const sql = readFileSync("scripts/catalog-release-preflight.sql", "utf8");
  const results = await db.exec(sql);
  const gate = results.flatMap(r => r.rows).find(row => "cross_shop_count_rows" in row);
  expect(gate).toMatchObject({ cross_shop_count_rows: 3, nonzero_cross_shop_count_rows: 2, blocking_nonzero_count_gate: true });
  expect((await db.query("select id from sku_count_lines where sku_id=$1", [sku])).rows).toHaveLength(3);
  await applyShopOwnership(db);
  await db.exec(readFileSync("supabase/migrations/0265_sku_swaps.sql", "utf8"));
  const afterApply = await db.exec(sql);
  expect(afterApply.flatMap(r => r.rows).find(row => "cross_shop_count_rows" in row)).toEqual(gate);
}, 120_000);
