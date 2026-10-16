import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyShopOwnership, migratedShopOwnedDb, SHOP_OWNED_ID as ID } from "./fixtures/shop-owned-pglite";

let db: PGlite;
async function entity(table: "items" | "vendor_items", owner: string | null) {
  return (await db.query<{ id: string }>(`insert into public.${table}(name,location_id) values ('Review fixture',$1) returning id`, [owner])).rows[0]!.id;
}
async function recipe(owner: string | null) {
  return (await db.query<{ id: string }>("insert into public.recipes(name,location_id,batch_yield) values ('Review recipe',$1,1) returning id", [owner])).rows[0]!.id;
}
async function refuses(action: Promise<unknown>, code: string) {
  await expect(action).rejects.toMatchObject({ code: "P0001", message: `shop_owned:${code}` });
}

describe("0264 chunk-2 review regression probes (real SQL, in-memory only)", () => {
  beforeAll(async () => { db = await migratedShopOwnedDb(); }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("owned menu items refuse catering on insert and update; shared menus may cater", async () => {
    await refuses(db.query("insert into public.menu_items(name,location_id,catering_available) values ('Owned catering',$1,true)", [ID.shopA]), "owned_not_catering");
    const menu = (await db.query<{ id: string }>("insert into public.menu_items(name,location_id) values ('Owned menu',$1) returning id", [ID.shopA])).rows[0]!.id;
    await refuses(db.query("update public.menu_items set catering_available=true where id=$1", [menu]), "owned_not_catering");
    expect((await db.query("select catering_available from public.menu_items where id=$1", [menu])).rows).toEqual([{ catering_available: false }]);
    await db.query("update public.menu_items set catering_available=true where id=$1", [ID.sharedMenu]);
    expect((await db.query("select catering_available from public.menu_items where id=$1", [ID.sharedMenu])).rows).toEqual([{ catering_available: true }]);
  });

  it("receiving's exact weight-fold columns take no advisory lock or integrity check", async () => {
    // Missing receiving-only columns are added locally; ownership schema/triggers remain real.
    await db.exec(`alter table public.vendor_items
      add column if not exists weight_class text,
      add column if not exists weight_source_note text,
      add column if not exists weight_established_at timestamptz,
      add column if not exists weight_established_by uuid;
      begin;
      create temp table review_integrity_calls(n int);
      create or replace function public.shop_owned_integrity() returns trigger
      language plpgsql security definer set search_path=pg_catalog,public as $$
      begin insert into pg_temp.review_integrity_calls values (1); return null; end $$;`);
    try {
      const locks = () => db.query("select count(*)::int n from pg_locks where locktype='advisory' and pid=pg_backend_pid()");
      expect((await locks()).rows).toEqual([{ n: 0 }]);
      // The baseline SKU is cited by a live recipe: this also covers the R5b closure case.
      await db.query(`update public.vendor_items set avg_oz_per_each=5,
        weight_class='observed', weight_source_note='review fold',
        weight_established_at=now(), weight_established_by=$1,
        updated_by=$1, updated_at=now() where id=$2`, [ID.actor, ID.sharedSku]);
      await db.exec("set constraints all immediate");
      expect((await locks()).rows).toEqual([{ n: 0 }]);
      expect((await db.query("select count(*)::int n from pg_temp.review_integrity_calls")).rows).toEqual([{ n: 0 }]);
    } finally { await db.exec("rollback"); }
  });

  it.each(["items", "vendor_items"] as const)("%s ownership cannot move null-to-shop or shop-to-shop", async table => {
    for (const owner of [null, ID.shopA]) {
      const id = await entity(table, owner);
      await refuses(db.query(`update public.${table} set location_id=$1 where id=$2`, [ID.shopB, id]), "owner_is_set_at_creation");
      expect((await db.query(`select location_id from public.${table} where id=$1`, [id])).rows).toEqual([{ location_id: owner }]);
    }
  });

  it.each([
    ["items", "component_item_id", "uses_shop_only_item"],
    ["vendor_items", "component_sku_id", "uses_other_shop_sku"],
  ] as const)("new global recipe and version citations reject owned %s", async (table, column, code) => {
    const component = await entity(table, ID.shopA);
    const id = await recipe(null);
    await refuses(db.query(`insert into public.recipe_inputs(recipe_id,${column},quantity,unit) values ($1,$2,1,'oz')`, [id, component]), code);
    // Create and populate the version in one transaction, respecting immutable journal guards.
    await refuses(db.query(`with version as (
      insert into public.recipe_versions(recipe_id,active,valid_to) values ($1,false,now()) returning id
    ) insert into public.recipe_version_lines(version_id,recipe_id,${column},quantity,unit)
      select id,$1,$2,1,'oz' from version`, [id, component]), code);
  });

  it("new global outputs reject owned items and menu items", async () => {
    const item = await entity("items", ID.shopA);
    const menu = (await db.query<{ id: string }>("insert into public.menu_items(name,location_id,menu_price) values ('Review owned menu',$1,12) returning id", [ID.shopA])).rows[0]!.id;
    for (const [column, component] of [["output_item_id", item], ["output_menu_item_id", menu]]) {
      const id = await recipe(null);
      await refuses(db.query(`insert into public.recipe_outputs(recipe_id,${column},yield) values ($1,$2,1)`, [id, component]), "global_recipe_makes_shop_item");
    }
  });

  it("direct promotion refuses owned item/SKU dependencies and owned outputs", async () => {
    for (const [table, column, code] of [
      ["items", "component_item_id", "uses_shop_only_item"],
      ["vendor_items", "component_sku_id", "uses_other_shop_sku"],
    ] as const) {
      const id = await recipe(ID.shopA);
      await db.query(`insert into public.recipe_inputs(recipe_id,${column},quantity,unit) values ($1,$2,1,'oz')`, [id, await entity(table, ID.shopA)]);
      await refuses(db.query("update public.recipes set location_id=null where id=$1", [id]), code);
    }
    const id = await recipe(ID.shopA);
    await db.query("insert into public.recipe_outputs(recipe_id,output_item_id,yield) values ($1,$2,1)", [id, await entity("items", ID.shopA)]);
    await refuses(db.query("update public.recipes set location_id=null where id=$1", [id]), "global_recipe_makes_shop_item");
  });

  it("SQL refuses a null owner for an inline new item", async () => {
    await refuses(db.query("select public.create_shop_recipe($1::jsonb,$2::jsonb,$3::jsonb,$4,null)", [
      JSON.stringify({ name: "Review global inline", recipe_type: "production", batch_yield: 1 }),
      JSON.stringify([{ component_sku_id: ID.sharedSku, quantity: 1, unit: "oz" }]),
      JSON.stringify([{ new_item: { name: "Review inline", section: "prep" }, yield: 1 }]), ID.actor,
    ]), "location_required");
  });

  it("owned items cannot be defaults on insert or update", async () => {
    await refuses(db.query("insert into public.items(name,location_id,is_default) values ('Bad default',$1,true)", [ID.shopA]), "invalid_payload");
    await refuses(db.query("update public.items set is_default=true where id=$1", [await entity("items", ID.shopA)]), "invalid_payload");
  });

  it("16-argument legacy writer passes its actual CAS and reaches ownership enforcement", async () => {
    const id = await recipe(ID.shopA);
    const line = (await db.query<{ id: string }>("insert into public.recipe_inputs(recipe_id,component_sku_id,quantity,unit,portioned) values ($1,$2,1,'oz',false) returning id", [id, ID.sharedSku])).rows[0]!.id;
    const foreign = await entity("vendor_items", ID.shopB);
    await refuses(db.query(`select * from public.update_recipe_input_atomic(
      $1::uuid,$2::uuid,$3::uuid,null::uuid,null::uuid,2::numeric,'oz'::text,null::text,false,
      $4::uuid,null::uuid,null::uuid,1::numeric,'oz'::text,null::text,false)`, [line, id, foreign, ID.sharedSku]), "line_other_shop:1");
    expect((await db.query("select component_sku_id,quantity from public.recipe_inputs where id=$1", [line])).rows).toEqual([{ component_sku_id: ID.sharedSku, quantity: "1" }]);
  });

  it.each([
    ["items", "component_item_id", "uses_shop_only_item"],
    ["vendor_items", "component_sku_id", "uses_other_shop_sku"],
  ] as const)("legacy owned %s permits deactivation but refuses reactivation", async (table, column, code) => {
    const old = await migratedShopOwnedDb(false);
    try {
      const component = (await old.query<{ id: string }>(`insert into public.${table}(name,location_id) values ('Legacy owned',$1) returning id`, [ID.shopA])).rows[0]!.id;
      await old.query(`insert into public.recipe_inputs(recipe_id,${column},quantity,unit) values ($1,$2,1,'oz')`, [ID.sharedRecipe, component]);
      await applyShopOwnership(old);
      await old.query("update public.recipes set active=false where id=$1", [ID.sharedRecipe]);
      expect((await old.query("select active from public.recipes where id=$1", [ID.sharedRecipe])).rows).toEqual([{ active: false }]);
      await refuses(old.query("update public.recipes set active=true where id=$1", [ID.sharedRecipe]), code);
      expect((await old.query("select active from public.recipes where id=$1", [ID.sharedRecipe])).rows).toEqual([{ active: false }]);
    } finally { await old.close(); }
  }, 120_000);

  it("pre-0264 global owned citations survive non-citation edits but reject new citations", async () => {
    const old = await migratedShopOwnedDb(false);
    try {
      const item = (await old.query<{ id: string }>("insert into public.items(name,location_id) values ('Historical input',$1) returning id", [ID.shopA])).rows[0]!.id;
      const line = (await old.query<{ id: string }>("insert into public.recipe_inputs(recipe_id,component_item_id,quantity,unit) values ($1,$2,1,'oz') returning id", [ID.sharedRecipe, item])).rows[0]!.id;
      // Before 0264, create an inactive historical version containing the owned citation.
      await old.query("update public.recipe_inputs set quantity=2 where id=$1", [line]);
      const history = (await old.query<{ id: string }>("select l.id from public.recipe_version_lines l join public.recipe_versions v on v.id=l.version_id where v.recipe_id=$1 and not v.active and l.component_item_id=$2", [ID.sharedRecipe, item])).rows[0]!.id;
      await applyShopOwnership(old);
      await old.query("update public.recipes set name='Historical recipe renamed' where id=$1", [ID.sharedRecipe]);
      await old.query("update public.recipe_inputs set component_item_id=component_item_id where id=$1", [line]);
      expect((await old.query("select quantity from public.recipe_inputs where id=$1", [line])).rows).toEqual([{ quantity: "2" }]);
      expect((await old.query("select component_item_id from public.recipe_version_lines where id=$1", [history])).rows).toEqual([{ component_item_id: item }]);
      await old.exec("set role service_role");
      try {
        await expect(old.query("update public.recipe_version_lines set quantity=3 where id=$1", [history])).rejects.toMatchObject({ code: "42501" });
      } finally { await old.exec("reset role"); }
      // A quantity edit creates a NEW journal citation, so read compatibility does not authorize it.
      await refuses(old.query("update public.recipe_inputs set quantity=3 where id=$1", [line]), "uses_shop_only_item");
      const other = (await old.query<{ id: string }>("insert into public.items(name,location_id) values ('Another owned input',$1) returning id", [ID.shopA])).rows[0]!.id;
      await refuses(old.query("update public.recipe_inputs set component_item_id=$1 where id=$2", [other, line]), "uses_shop_only_item");
    } finally { await old.close(); }
  }, 120_000);
});
