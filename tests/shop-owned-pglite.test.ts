import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyShopOwnership, migratedShopOwnedDb, SHOP_OWNED_ID as ID } from "./fixtures/shop-owned-pglite";

let db: PGlite;
const inputs = (sku = ID.sharedSku as string, quantity = 1) => [{ component_sku_id: sku, quantity, unit: "oz", portioned: false }];
const header = (name: string) => ({ name, recipe_type: "production", batch_yield: 1 });
const inline = (name: string) => [{ new_item: { name, section: "prep", recommended_par: 2, recommended_par_unit: "oz", required: true, min_role_level: 3 }, yield: 1 }];
async function create(name: string, lines = inputs(), outputs: unknown[] = inline(name), owner: string | null = ID.shopA) {
  const result = await db.query<{ result: { id: string; output_item_ids: string[] } }>(
    "select public.create_shop_recipe($1::jsonb,$2::jsonb,$3::jsonb,$4::uuid,$5::uuid) result",
    [JSON.stringify(header(name)), JSON.stringify(lines), JSON.stringify(outputs), ID.actor, owner]);
  return result.rows[0]!.result;
}
async function head(recipe: string) {
  return (await db.query<{ id: string }>("select id from public.recipe_versions where recipe_id=$1 and location_id is null and active", [recipe])).rows[0]!.id;
}
async function count(table: string) {
  return (await db.query<{ n: number }>(`select count(*)::int n from public.${table}`)).rows[0]!.n;
}
async function refusal(action: Promise<unknown>, message: string) {
  await expect(action).rejects.toMatchObject({ code: "P0001", message });
}

describe("0264 real SQL ownership writers (in-memory only, triggers enabled)", () => {
  beforeAll(async () => { db = await migratedShopOwnedDb(); }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("keeps existing entities shared and ownership constraints enabled", async () => {
    expect((await db.query("select location_id from public.recipes where id=$1", [ID.sharedRecipe])).rows).toEqual([{ location_id: null }]);
    expect((await db.query("select location_id from public.menu_items where id=$1", [ID.sharedMenu])).rows).toEqual([{ location_id: null }]);
    const triggers = await db.query<{ tgenabled: string }>("select tgenabled from pg_trigger where not tgisinternal and tgrelid in ('public.recipes'::regclass,'public.recipe_inputs'::regclass,'public.recipe_outputs'::regclass)");
    expect(triggers.rows.length).toBeGreaterThan(3);
    expect(triggers.rows.every(row => row.tgenabled === "O")).toBe(true);
  });

  it("atomically creates inline prep, recipe, output, and initial journal in the owner shop", async () => {
    const result = await create("Inline owned prep");
    expect(result.output_item_ids).toHaveLength(1);
    expect((await db.query("select location_id, is_default, default_par, default_par_unit, required from public.items where id=$1", [result.output_item_ids[0]])).rows)
      .toEqual([{ location_id: ID.shopA, is_default: false, default_par: "2", default_par_unit: "oz", required: true }]);
    expect((await db.query("select location_id from public.recipes where id=$1", [result.id])).rows).toEqual([{ location_id: ID.shopA }]);
    expect((await db.query("select location_id from public.recipe_versions where recipe_id=$1 and active", [result.id])).rows).toEqual([{ location_id: null }]);
    expect((await db.query("select output_item_id from public.recipe_outputs where recipe_id=$1", [result.id])).rows).toEqual([{ output_item_id: result.output_item_ids[0] }]);
  });

  it("refuses foreign ingredients and rolls back the inline item and recipe", async () => {
    const sku = (await db.query<{ id: string }>("insert into public.vendor_items(name,location_id) values ('Foreign input',$1) returning id", [ID.shopB])).rows[0]!.id;
    const before = [await count("items"), await count("recipes"), await count("recipe_versions")];
    await refusal(create("Rejected foreign input", inputs(sku)), "shop_owned:line_other_shop:1");
    expect([await count("items"), await count("recipes"), await count("recipe_versions")]).toEqual(before);
  });

  it("rolls back inline outputs when output definitions are invalid or exclusive fields collide", async () => {
    const before = [await count("items"), await count("recipes")];
    await refusal(create("Invalid inline section", inputs(), [{ new_item: { name: "Invalid", section: "missing" }, yield: 1 }]), "shop_owned:invalid_payload");
    await refusal(create("Ambiguous output", inputs(), [{ ...inline("Ambiguous")[0], output_item_id: ID.sharedItem }]), "shop_owned:invalid_payload");
    expect([await count("items"), await count("recipes")]).toEqual(before);
  });

  it("never reassigns a shared or foreign existing output item", async () => {
    const foreign = (await db.query<{ id: string }>("insert into public.items(name,location_id) values ('Foreign output',$1) returning id", [ID.shopB])).rows[0]!.id;
    for (const id of [ID.sharedItem, foreign]) {
      await refusal(create(`Rejected output ${id}`, inputs(), [{ output_item_id: id, yield: 1 }]), "shop_owned:output_other_shop");
    }
    expect((await db.query("select location_id from public.items where id=$1", [ID.sharedItem])).rows).toEqual([{ location_id: null }]);
  });

  it("edits owned default lines, compares ownership, and appends history", async () => {
    const created = await create("Owned editable");
    const initial = await head(created.id);
    const save = (owner: string, expected: string, quantity: number) => db.query(
      "select public.save_owned_recipe_version($1,$2,$3::jsonb,$4,$5,public.recipe_change_snapshot($1,null,$3::jsonb))",
      [created.id, owner, JSON.stringify(inputs(ID.sharedSku, quantity)), expected, ID.actor]);
    await refusal(save(ID.shopB, initial, 2), "shop_owned:ownership_changed");
    await save(ID.shopA, initial, 2);
    expect(await head(created.id)).not.toBe(initial);
    expect((await db.query("select quantity from public.recipe_inputs where recipe_id=$1", [created.id])).rows).toEqual([{ quantity: "2" }]);
    expect((await db.query("select location_id from public.recipe_versions where recipe_id=$1", [created.id])).rows.every(row => (row as { location_id: string | null }).location_id === null)).toBe(true);
  });

  it("shares produced prep with its recipe and rejects a stale owned edit after sharing", async () => {
    const created = await create("Share owned prep");
    const initial = await head(created.id);
    await db.query("select public.share_shop_recipe($1,$2,$3,$4::uuid[],'{}'::uuid[])", [created.id, ID.shopA, ID.actor, created.output_item_ids]);
    expect((await db.query("select location_id from public.recipes where id=$1", [created.id])).rows).toEqual([{ location_id: null }]);
    expect((await db.query("select location_id from public.items where id=$1", [created.output_item_ids[0]])).rows).toEqual([{ location_id: null }]);
    await refusal(db.query("select public.save_owned_recipe_version($1,$2,$3::jsonb,$4,$5,public.recipe_change_snapshot($1,null,$3::jsonb))", [created.id, ID.shopA, JSON.stringify(inputs()), initial, ID.actor]), "shop_owned:ownership_changed");
  });

  it("restores owned history through the owner-bound writer and refuses that restore after sharing", async () => {
    const created = await create("Owned restore history");
    const initial = await head(created.id);
    await db.query("select public.save_owned_recipe_version($1,$2,$3::jsonb,$4,$5,public.recipe_change_snapshot($1,null,$3::jsonb))", [created.id, ID.shopA, JSON.stringify(inputs(ID.sharedSku, 4)), initial, ID.actor]);
    const edited = await head(created.id);
    const copiedLines = (await db.query<{ lines: unknown }>("select jsonb_agg(jsonb_build_object('component_sku_id',component_sku_id,'component_item_id',component_item_id,'component_product_id',component_product_id,'quantity',quantity,'unit',unit,'portioned',portioned) order by display_order) lines from public.recipe_version_lines where version_id=$1", [initial])).rows[0]!.lines;
    const restore = async (expected: string, note: string | null = null) => {
      const snapshot = (await db.query<{ snapshot: unknown }>("select public.recipe_change_snapshot($1,null,$2::jsonb) snapshot", [created.id, JSON.stringify(copiedLines)])).rows[0]!.snapshot;
      return db.query("select public.save_owned_recipe_version($1,$2,null,$3,$4,$5::jsonb,$6,$7)", [created.id, ID.shopA, expected, ID.actor, JSON.stringify(snapshot), initial, note]);
    };
    await restore(edited);
    const restored = await head(created.id);
    expect(restored).not.toBe(initial);
    expect(restored).not.toBe(edited);
    expect((await db.query("select quantity from public.recipe_inputs where recipe_id=$1", [created.id])).rows).toEqual([{ quantity: "1" }]);
    expect((await db.query("select note,created_by,location_id,based_on_version_id from public.recipe_versions where id=$1", [restored])).rows)
      .toEqual([{ note: "restored", created_by: ID.actor, location_id: null, based_on_version_id: edited }]);
    expect((await db.query("select id from public.recipe_versions where recipe_id=$1 and not active", [created.id])).rows).toHaveLength(2);
    await db.query("select public.share_shop_recipe($1,$2,$3,$4::uuid[],'{}'::uuid[])", [created.id, ID.shopA, ID.actor, created.output_item_ids]);
    await refusal(restore(restored, "Restore after sharing"), "shop_owned:ownership_changed");
    expect(await head(created.id)).toBe(restored);
  });

  it("creates a sandwich atomically and leaves Toast confirmation separate", async () => {
    const result = await db.query<{ result: { id: string; menu_item_id: string } }>("select public.create_shop_sandwich($1::jsonb,$2::jsonb,$3::jsonb,$4,$5) result", [JSON.stringify({ name: "Owned sandwich", menu_price: 12 }), JSON.stringify({ ...header("Owned sandwich"), recipe_type: "consumer" }), JSON.stringify(inputs()), ID.actor, ID.shopA]);
    const created = result.rows[0]!.result;
    expect((await db.query("select location_id from public.menu_items where id=$1", [created.menu_item_id])).rows).toEqual([{ location_id: ID.shopA }]);
    expect((await db.query("select output_menu_item_id from public.recipe_outputs where recipe_id=$1", [created.id])).rows).toEqual([{ output_menu_item_id: created.menu_item_id }]);
    expect((await db.query("select id from public.toast_menu_map where menu_item_id=$1", [created.menu_item_id])).rows).toEqual([]);
    await refusal(db.query("insert into public.toast_menu_map(location_id,menu_item_id,toast_item_guid,toast_item_name,match_status) values ($1,$2,'test-guid','Sandwich','confirmed')", [ID.shopB, created.menu_item_id]), "shop_owned:toast_other_shop");
  });

  it("refuses stale share dependencies and direct produced-item promotion without mutation", async () => {
    const created = await create("Share dependencies");
    await refusal(db.query("select public.share_shop_item($1,$2,$3)", [created.output_item_ids[0], ID.shopA, ID.actor]), "shop_owned:share_the_recipe");
    await refusal(db.query("select public.share_shop_recipe($1,$2,$3,$4::uuid[],$5::uuid[])", [created.id, ID.shopA, ID.actor, [], []]), "shop_owned:items_changed");
    await refusal(db.query("select public.share_shop_recipe($1,$2,$3,$4::uuid[],$5::uuid[])", [created.id, ID.shopA, ID.actor, created.output_item_ids, [ID.sharedSku]]), "shop_owned:skus_changed");
    expect((await db.query("select location_id from public.recipes where id=$1", [created.id])).rows).toEqual([{ location_id: ID.shopA }]);
    expect((await db.query("select location_id from public.items where id=$1", [created.output_item_ids[0]])).rows).toEqual([{ location_id: ID.shopA }]);
  });

  it("preserves an edit that commits before sharing (the reverse serial ordering)", async () => {
    const created = await create("Edit then share");
    await db.query("select public.save_owned_recipe_version($1,$2,$3::jsonb,$4,$5,public.recipe_change_snapshot($1,null,$3::jsonb))", [created.id, ID.shopA, JSON.stringify(inputs(ID.sharedSku, 3)), await head(created.id), ID.actor]);
    await db.query("select public.share_shop_recipe($1,$2,$3,$4::uuid[],'{}'::uuid[])", [created.id, ID.shopA, ID.actor, created.output_item_ids]);
    expect((await db.query("select quantity from public.recipe_inputs where recipe_id=$1", [created.id])).rows).toEqual([{ quantity: "3" }]);
    expect((await db.query("select location_id from public.recipes where id=$1", [created.id])).rows).toEqual([{ location_id: null }]);
  });

  it("rejects owned shop versions/overlays and direct owner reassignment", async () => {
    const created = await create("No shop versions");
    await refusal(db.query("select public.save_recipe_version($1,$2,$3::jsonb,null,$4,null,$5,null,null,null,public.recipe_change_snapshot($1,$2,$3::jsonb))", [created.id, ID.shopA, JSON.stringify(inputs()), await head(created.id), ID.actor]), "shop_owned:recipe_has_no_shop_versions");
    await refusal(db.query("update public.recipes set location_id=$1 where id=$2", [ID.shopB, created.id]), "shop_owned:owner_is_set_at_creation");
    const menu = (await db.query<{ id: string }>("insert into public.menu_items(name,location_id,menu_price) values ('No overlay',$1,10) returning id", [ID.shopA])).rows[0]!.id;
    await refusal(db.query("select public.save_menu_item_shop_setting($1,$2,11,true,null,null,null,null,$3,null,public.menu_item_change_snapshot($1,$2))", [menu, ID.shopA, ID.actor]), "shop_owned:menu_item_has_no_shop_settings");
  });

  it("allows only own/shared components in a shared recipe's shop version", async () => {
    const own = (await db.query<{ id: string }>("insert into public.vendor_items(name,location_id) values ('Own version ingredient',$1) returning id", [ID.shopA])).rows[0]!.id;
    const foreign = (await db.query<{ id: string }>("insert into public.vendor_items(name,location_id) values ('Foreign version ingredient',$1) returning id", [ID.shopB])).rows[0]!.id;
    const initial = await head(ID.sharedRecipe);
    const save = (sku: string) => db.query("select public.save_recipe_version($1,$2,$3::jsonb,null,$4,null,$5,null,null,null,public.recipe_change_snapshot($1,$2,$3::jsonb))", [ID.sharedRecipe, ID.shopA, JSON.stringify(inputs(sku)), initial, ID.actor]);
    await refusal(save(foreign), "shop_owned:line_other_shop:1");
    await save(own);
    expect((await db.query("select location_id from public.recipe_versions where recipe_id=$1 and location_id=$2 and active", [ID.sharedRecipe, ID.shopA])).rows).toEqual([{ location_id: ID.shopA }]);
    await refusal(db.query("update public.vendor_items set location_id=$1 where id=$2", [ID.shopB, own]), "shop_owned:owner_is_set_at_creation");
    expect((await db.query("select location_id from public.vendor_items where id=$1", [own])).rows).toEqual([{ location_id: ID.shopA }]);
  });

  it("rolls back initial SKU pack and price failures and serializes normalized job numbers", async () => {
    const vendor = (await db.query<{ id: string }>("insert into public.vendors(name) values ('Job vendor') returning id")).rows[0]!.id;
    const pack = { levels: [{ label: "Each", containsQty: 1, containsMeasureUnit: "oz" }] };
    const sku = (name: string, itemNumber: string, price: unknown, initialPack: unknown = pack, shop = ID.shopA as string) => db.query<{ result: { id: string } }>("select public.create_catalog_sku($1::jsonb,$2::jsonb,$3::jsonb,$4,$5) result", [JSON.stringify({ name, vendorId: vendor, itemNumber }), initialPack === null ? null : JSON.stringify(initialPack), price === null ? null : JSON.stringify(price), ID.actor, shop]);
    const before = await count("vendor_items");
    await refusal(sku("Bad price", "bad-price", { unitPrice: -1, effectiveDate: "2026-10-15" }), "shop_owned:invalid_price");
    await refusal(sku("Bad pack", "bad-pack", null, { levels: [{ label: "Each", containsQty: -1, containsMeasureUnit: "oz" }] }), "sku_pack_version:non_positive_qty");
    expect(await count("vendor_items")).toBe(before);
    // PGlite queues one connection: this proves normalized cooperating RPC behavior,
    // not independent-session PostgreSQL contention (the release harness owns that).
    const results = await Promise.allSettled([
      sku("First job", "  ABC-42 ", { unitPrice: 5, effectiveDate: "2026-10-15" }),
      sku("Second job", "abc-42", { unitPrice: 6, effectiveDate: "2026-10-15" }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { code: "P0001", message: "shop_owned:item_number_taken" } });
    const success = results.find(result => result.status === "fulfilled");
    if (!success || success.status !== "fulfilled") throw new Error("Expected a committed SKU");
    const id = success.value.rows[0]!.result.id;
    expect((await db.query("select location_id from public.vendor_items where id=$1", [id])).rows).toEqual([{ location_id: ID.shopA }]);
    expect((await db.query("select id from public.sku_pack_versions where sku_id=$1 and active", [id])).rows).toHaveLength(1);
    expect((await db.query("select id from public.vendor_price_history where vendor_item_id=$1", [id])).rows).toHaveLength(1);
    await sku("Other shop twin", "ABC-42", null, null, ID.shopB);
  });

  it("denies client execution of every protected ownership RPC", async () => {
    const functions = await db.query<{ signature: string; anon: boolean; authenticated: boolean; service: boolean }>(`
      select p.oid::regprocedure::text signature,
        has_function_privilege('anon',p.oid,'EXECUTE') anon,
        has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
        has_function_privilege('service_role',p.oid,'EXECUTE') service
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('create_shop_recipe','create_shop_sandwich','create_catalog_sku','save_owned_recipe_version','share_shop_recipe','share_shop_sku','share_shop_menu_item','share_shop_item')`);
    expect(functions.rows).toHaveLength(8);
    for (const row of functions.rows) expect(row, row.signature).toMatchObject({ anon: false, authenticated: false, service: true });
    const ownedSignature = "public.save_owned_recipe_version(uuid,uuid,jsonb,uuid,uuid,jsonb,uuid,text)";
    expect((await db.query<{ exists: boolean }>("select to_regprocedure($1) is not null as exists", [ownedSignature])).rows).toEqual([{ exists: true }]);
    const legacySignature = "public.update_recipe_input_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,text,boolean,uuid,uuid,uuid,numeric,text,text,boolean)";
    expect((await db.query<{ retained: boolean }>("select to_regprocedure($1) is not null retained", [legacySignature])).rows).toEqual([{ retained: true }]);
    const internals = await db.query<{ allowed: boolean }>("select bool_or(has_function_privilege('service_role',p.oid,'EXECUTE')) allowed from pg_proc p where p.proname in ('shop_owned_create_recipe_full','shop_owned_owner_guard','shop_owned_graph_lock','shop_owned_integrity','shop_owned_check_recipe')");
    expect(internals.rows).toEqual([{ allowed: false }]);
  });

  it("shares a sandwich and its recipe atomically; a direct recipe share names the sandwich", async () => {
    const created = (await db.query<{ result: { id: string; menu_item_id: string } }>("select public.create_shop_sandwich($1::jsonb,$2::jsonb,$3::jsonb,$4,$5) result", [JSON.stringify({ name: "Shared from owned", menu_price: 14 }), JSON.stringify(header("Shared from owned")), JSON.stringify(inputs()), ID.actor, ID.shopA])).rows[0]!.result;
    const retired = await create("Older sandwich recipe", inputs(), [{ output_menu_item_id: created.menu_item_id, yield: 1 }]);
    await db.query("update public.recipes set active=false where id=$1", [retired.id]);
    await refusal(db.query("select public.share_shop_recipe($1,$2,$3)", [created.id, ID.shopA, ID.actor]), "shop_owned:share_the_sandwich");
    await db.query("select public.share_shop_menu_item($1,$2,$3)", [created.menu_item_id, ID.shopA, ID.actor]);
    expect((await db.query("select location_id from public.menu_items where id=$1", [created.menu_item_id])).rows).toEqual([{ location_id: null }]);
    expect((await db.query("select location_id from public.recipes where id=$1", [created.id])).rows).toEqual([{ location_id: null }]);
    expect((await db.query("select location_id from public.recipes where id=$1", [retired.id])).rows).toEqual([{ location_id: null }]);
    await db.query("update public.recipes set active=true where id=$1", [retired.id]);
  });

  it("refuses even unreferenced SKU owner moves and supports owner-bound sharing", async () => {
    const sku = (await db.query<{ id: string }>("insert into public.vendor_items(name,location_id) values ('Movable SKU',$1) returning id", [ID.shopA])).rows[0]!.id;
    await refusal(db.query("update public.vendor_items set location_id=$1 where id=$2", [ID.shopB, sku]), "shop_owned:owner_is_set_at_creation");
    await refusal(db.query("select public.share_shop_sku($1,$2,$3)", [sku, ID.shopB, ID.actor]), "shop_owned:ownership_changed");
    await db.query("select public.share_shop_sku($1,$2,$3)", [sku, ID.shopA, ID.actor]);
    expect((await db.query("select location_id from public.vendor_items where id=$1", [sku])).rows).toEqual([{ location_id: null }]);
  });

  it("enforces ownership for Toast effects, aliases, and later target moves", async () => {
    const created = await create("Toast owned prep");
    const item = created.output_item_ids[0]!;
    const map = (await db.query<{ id: string }>("insert into public.toast_menu_map(location_id,menu_item_id,toast_item_guid,toast_item_name,match_status) values ($1,$2,'effect-parent','Shared parent','confirmed') returning id", [ID.shopB, ID.sharedMenu])).rows[0]!.id;
    await refusal(db.query("insert into public.toast_map_effects(map_id,ordinal,item_id,disposition) values ($1,1,$2,'deplete')", [map, item]), "shop_owned:toast_other_shop");
    for (const location of [null, ID.shopB]) {
      await refusal(db.query("insert into public.toast_open_item_aliases(location_id,normalized_text,item_id) values ($1,'owned alias',$2)", [location, item]), "shop_owned:toast_other_shop");
    }
    await db.query("insert into public.toast_open_item_aliases(location_id,normalized_text,item_id) values ($1,'owned alias',$2)", [ID.shopA, item]);
    await refusal(db.query("update public.toast_open_item_aliases set location_id=$1 where item_id=$2", [ID.shopB, item]), "shop_owned:toast_other_shop");
    expect((await db.query("select location_id from public.toast_open_item_aliases where item_id=$1", [item])).rows).toEqual([{ location_id: ID.shopA }]);
  });

  it("shares exactly approved owned SKU dependencies along with recipe outputs", async () => {
    const sku = (await db.query<{ id: string }>("insert into public.vendor_items(name,location_id) values ('Share input dependency',$1) returning id", [ID.shopA])).rows[0]!.id;
    const created = await create("Share all dependencies", inputs(sku));
    await refusal(db.query("select public.share_shop_recipe($1,$2,$3,$4::uuid[],'{}'::uuid[])", [created.id, ID.shopA, ID.actor, created.output_item_ids]), "shop_owned:skus_changed");
    await db.query("select public.share_shop_recipe($1,$2,$3,$4::uuid[],$5::uuid[])", [created.id, ID.shopA, ID.actor, created.output_item_ids, [sku]]);
    expect((await db.query("select location_id from public.vendor_items where id=$1", [sku])).rows).toEqual([{ location_id: null }]);
    expect((await db.query("select location_id from public.recipes where id=$1", [created.id])).rows).toEqual([{ location_id: null }]);
  });
});

describe("0264 preserves pre-migration preview compare-and-set", () => {
  it("preserves historical shared recipe outputs to shop template items", async () => {
    const oldDb = await migratedShopOwnedDb(false);
    try {
      const item = (await oldDb.query<{ id: string }>("insert into public.items(name,location_id) values ('Legacy shop output',$1) returning id", [ID.shopA])).rows[0]!.id;
      const recipe = (await oldDb.query<{ id: string }>("select public.create_recipe_full($1::jsonb,$2::jsonb,$3::jsonb,$4) id", [JSON.stringify(header("Legacy shared producer")), JSON.stringify(inputs()), JSON.stringify([{ output_item_id: item, yield: 1 }]), ID.actor])).rows[0]!.id;
      await applyShopOwnership(oldDb);
      await oldDb.query("update public.recipes set name='Legacy shared producer edited' where id=$1", [recipe]);
      await oldDb.query("update public.recipe_outputs set yield=2 where recipe_id=$1", [recipe]);
      await oldDb.query("update public.recipe_outputs set output_item_id=output_item_id where recipe_id=$1", [recipe]);
      expect((await oldDb.query("select yield from public.recipe_outputs where recipe_id=$1", [recipe])).rows).toEqual([{ yield: "2" }]);
      expect((await oldDb.query("select r.location_id recipe_owner,i.location_id item_owner from public.recipes r join public.recipe_outputs o on o.recipe_id=r.id join public.items i on i.id=o.output_item_id where r.id=$1", [recipe])).rows).toEqual([{ recipe_owner: null, item_owner: ID.shopA }]);
    } finally { await oldDb.close(); }
  }, 120_000);

  it("stales old recipe/menu previews, preserves state, then accepts a fresh preview", async () => {
    const oldDb = await migratedShopOwnedDb(false);
    try {
      const oldRecipe = (await oldDb.query<{ snapshot: unknown }>("select public.recipe_change_snapshot($1,$2,$3::jsonb) snapshot", [ID.sharedRecipe, ID.shopA, JSON.stringify(inputs())])).rows[0]!.snapshot;
      const oldMenu = (await oldDb.query<{ snapshot: unknown }>("select public.menu_item_change_snapshot($1,$2) snapshot", [ID.sharedMenu, ID.shopA])).rows[0]!.snapshot;
      const initial = (await oldDb.query<{ id: string }>("select id from public.recipe_versions where recipe_id=$1 and location_id is null and active", [ID.sharedRecipe])).rows[0]!.id;
      await applyShopOwnership(oldDb);
      const saveRecipe = (snapshot: unknown) => oldDb.query("select public.save_recipe_version($1,$2,$3::jsonb,null,$4,null,$5,null,null,null,$6::jsonb)", [ID.sharedRecipe, ID.shopA, JSON.stringify(inputs()), initial, ID.actor, JSON.stringify(snapshot)]);
      const saveMenu = (snapshot: unknown) => oldDb.query("select public.save_menu_item_shop_setting($1,$2,13,true,null,null,null,null,$3,null,$4::jsonb)", [ID.sharedMenu, ID.shopA, ID.actor, JSON.stringify(snapshot)]);
      await refusal(saveRecipe(oldRecipe), "recipe_version:dependencies_changed");
      await refusal(saveMenu(oldMenu), "menu_item_shop:dependencies_changed");
      expect((await oldDb.query("select id from public.recipe_versions where recipe_id=$1 and location_id=$2", [ID.sharedRecipe, ID.shopA])).rows).toEqual([]);
      expect((await oldDb.query("select id from public.menu_item_shop_settings where menu_item_id=$1", [ID.sharedMenu])).rows).toEqual([]);
      const freshRecipe = (await oldDb.query<{ snapshot: unknown }>("select public.recipe_change_snapshot($1,$2,$3::jsonb) snapshot", [ID.sharedRecipe, ID.shopA, JSON.stringify(inputs())])).rows[0]!.snapshot;
      await saveRecipe(freshRecipe);
      const freshMenu = (await oldDb.query<{ snapshot: unknown }>("select public.menu_item_change_snapshot($1,$2) snapshot", [ID.sharedMenu, ID.shopA])).rows[0]!.snapshot;
      await saveMenu(freshMenu);
      expect((await oldDb.query("select price from public.menu_item_shop_settings where menu_item_id=$1 and active", [ID.sharedMenu])).rows).toEqual([{ price: "13.00" }]);
    } finally { await oldDb.close(); }
  }, 120_000);
});
