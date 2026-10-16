import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { AuthContext } from "@/lib/session";
import { migratedShopOwnedDb, persistedCatalogRows, SHOP_OWNED_ID as ID } from "./fixtures/shop-owned-pglite";
import { createFakeDb } from "./fixtures/counts-fake-db";
let db: PGlite;
let snapshot: ReturnType<typeof createFakeDb>;
let beforeWrite: (() => Promise<void>) | undefined;
let accesses = 0;
const actor = { user: { id: ID.actor, role: "owner", language: "en" }, level: 9, locations: [] } as unknown as AuthContext;
const client = {
  from: (table: string) => { accesses++; return snapshot.client.from(table); },
  rpc: async (name: string, args: Record<string, unknown>) => {
    accesses++;
    if (!/^[a-z_]+$/.test(name) || Object.keys(args).some(key => !/^p_[a-z_]+$/.test(key))) throw new Error("invalid test RPC identifier");
    if (name === "share_catalog_entity" && beforeWrite) { const hook = beforeWrite; beforeWrite = undefined; await hook(); }
    try {
      const keys = Object.keys(args);
      const values = keys.map(key => Array.isArray(args[key]) ? `{${(args[key] as string[]).join(",")}}`
        : typeof args[key] === "object" && args[key] !== null ? JSON.stringify(args[key]) : args[key]);
      const result = await db.query<{ result: unknown }>(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(",")}) result`, values);
      snapshot = createFakeDb(await persistedCatalogRows(db));
      return { data: result.rows[0]?.result, error: null };
    } catch (error) { return { data: null, error: { message: (error as Error).message, code: (error as { code?: string }).code } }; }
  },
};
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { accesses++; return client; } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { previewShareSku, previewShareRecipe, previewShareMenuItem, shareSkuWithAllShops, shareRecipeWithAllShops, shareMenuItemWithAllShops } from "@/lib/catalog/share";
beforeAll(async () => { db = await migratedShopOwnedDb(); snapshot = createFakeDb(await persistedCatalogRows(db)); }, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(() => { accesses = 0; beforeWrite = undefined; });
async function refresh() { snapshot = createFakeDb(await persistedCatalogRows(db)); }
async function newSku() {
  const id = (await db.query<{ id: string }>("insert into vendor_items(name,location_id) values ('Owned test SKU',$1) returning id", [ID.shopA])).rows[0]!.id;
  await refresh(); return id;
}
async function newRecipe(componentSkuId: string, componentItemId?: string) {
  const created = (await db.query<{ result: { id: string; output_item_ids: string[] } }>(
    "select create_shop_recipe($1::jsonb,$2::jsonb,$3::jsonb,$4,$5) result", [
      JSON.stringify({ name: "Owned test prep", recipe_type: "production", batch_yield: 1 }),
      JSON.stringify([componentItemId ? { component_item_id: componentItemId, quantity: 1, unit: "oz" } : { component_sku_id: componentSkuId, quantity: 1, unit: "oz" }]),
      JSON.stringify([{ new_item: { name: `Prep ${componentSkuId}`, section: "prep" }, yield: 1 }]), ID.actor, ID.shopA,
    ])).rows[0]!.result;
  await refresh(); return { recipeId: created.id, itemId: created.output_item_ids[0]! };
}
async function owner(table: "vendor_items" | "recipes" | "items" | "menu_items", id: string) {
  return (await db.query<{ location_id: string | null }>(`select location_id from ${table} where id=$1`, [id])).rows[0]!.location_id;
}
it.each(["gm", "social_media_mgr"] as const)("refuses %s before I/O", async role => {
  const forbidden = { ...actor, level: role === "gm" ? 7 : 8, user: { ...actor.user, role } } as AuthContext;
  for (const preview of [previewShareSku, previewShareRecipe, previewShareMenuItem]) await expect(preview(forbidden, ID.sharedSku)).rejects.toMatchObject({ status: 403 });
  for (const call of [
    () => shareSkuWithAllShops(forbidden, { skuId: ID.sharedSku, expectedOwner: ID.shopA, previewToken: "invalid" }),
    () => shareRecipeWithAllShops(forbidden, { recipeId: ID.sharedRecipe, expectedOwner: ID.shopA, previewToken: "invalid", shareSkuIds: [], shareItemIds: [] }),
    () => shareMenuItemWithAllShops(forbidden, { menuItemId: ID.sharedMenu, expectedOwner: ID.shopA, previewToken: "invalid", shareSkuIds: [] }),
  ]) await expect(call()).rejects.toMatchObject({ status: 403 });
  expect(accesses).toBe(0);
});
it("validates UUIDs before I/O", async () => {
  for (const preview of [previewShareSku, previewShareRecipe, previewShareMenuItem]) await expect(preview(actor, "not-a-uuid")).rejects.toMatchObject({ status: 400 });
  expect(accesses).toBe(0);
});
it("shares the exact owned recipe, output and confirmed SKU atomically", async () => {
  const skuId = await newSku(); const { recipeId, itemId } = await newRecipe(skuId);
  const preview = await previewShareRecipe(actor, recipeId);
  expect(preview).toMatchObject({ ownerShopId: ID.shopA, ownerShopName: "Shop A", recipeId, makesSandwich: null });
  await shareRecipeWithAllShops(actor, { recipeId, expectedOwner: ID.shopA, previewToken: preview.token, shareSkuIds: [skuId], shareItemIds: [itemId] });
  expect(await owner("recipes", recipeId)).toBeNull();
  expect(await owner("items", itemId)).toBeNull();
  expect(await owner("vendor_items", skuId)).toBeNull();
});
it("refuses a recipe that still consumes an owned prep item", async () => {
  const skuId = await newSku(); const producer = await newRecipe(skuId); const consumer = await newRecipe(skuId, producer.itemId);
  const preview = await previewShareRecipe(actor, consumer.recipeId);
  expect(preview.blockedBy).not.toHaveLength(0);
  await expect(shareRecipeWithAllShops(actor, { recipeId: consumer.recipeId, expectedOwner: ID.shopA, previewToken: preview.token, shareSkuIds: [], shareItemIds: [consumer.itemId] })).rejects.toMatchObject({ status: 409 });
  expect(await owner("recipes", consumer.recipeId)).toBe(ID.shopA);
  expect(await owner("items", consumer.itemId)).toBe(ID.shopA);
});
it("refuses a stale preview after a dependency edit without publishing", async () => {
  const skuId = await newSku(); const { recipeId, itemId } = await newRecipe(skuId);
  const preview = await previewShareRecipe(actor, recipeId);
  await db.query("update recipe_inputs set quantity=2 where recipe_id=$1", [recipeId]); await refresh();
  await expect(shareRecipeWithAllShops(actor, { recipeId, expectedOwner: ID.shopA, previewToken: preview.token, shareSkuIds: [skuId], shareItemIds: [itemId] })).rejects.toMatchObject({ status: 409 });
  expect(await owner("recipes", recipeId)).toBe(ID.shopA);
  expect(await owner("vendor_items", skuId)).toBe(ID.shopA);
});
it("binds the preview again in SQL when a dependency changes immediately before RPC", async () => {
  const skuId = await newSku(); const { recipeId, itemId } = await newRecipe(skuId);
  const preview = await previewShareRecipe(actor, recipeId);
  beforeWrite = async () => { await db.query("update recipe_inputs set quantity=3 where recipe_id=$1", [recipeId]); };
  await expect(shareRecipeWithAllShops(actor, { recipeId, expectedOwner: ID.shopA, previewToken: preview.token, shareSkuIds: [skuId], shareItemIds: [itemId] })).rejects.toMatchObject({ status: 409, code: "dependencies_changed" });
  expect(beforeWrite).toBeUndefined();
  expect(await owner("recipes", recipeId)).toBe(ID.shopA);
  expect(await owner("items", itemId)).toBe(ID.shopA);
  expect(await owner("vendor_items", skuId)).toBe(ID.shopA);
});
it("keeps both share entry points service-role only", async () => {
  for (const name of ["catalog_share_recipe_ids", "catalog_share_snapshot", "share_catalog_entity"]) {
    const rows = (await db.query<{ signature: string }>("select oid::regprocedure::text signature from pg_proc where pronamespace='public'::regnamespace and proname=$1", [name])).rows;
    expect(rows).toHaveLength(1);
    for (const { signature } of rows) for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2,'execute') allowed", [role, signature])).rows[0]!.allowed).toBe(role === "service_role" && name !== "catalog_share_recipe_ids");
    }
  }
});

it("SKU preview finds references present only in an active shop recipe version", async () => {
  const skuId = await newSku();
  const head = (await db.query<{ id: string }>("select id from recipe_versions where recipe_id=$1 and location_id is null and active", [ID.sharedRecipe])).rows[0]!.id;
  const lines = JSON.stringify([{ component_sku_id: skuId, quantity: 2, unit: "oz", portioned: false }]);
  await db.query(`select save_recipe_version($1,$2,$3::jsonb,null,$4,null,$5,null,null,null,recipe_change_snapshot($1,$2,$3::jsonb))`, [ID.sharedRecipe, ID.shopA, lines, head, ID.actor]);
  await refresh();
  expect((await db.query("select id from recipe_inputs where component_sku_id=$1", [skuId])).rows).toEqual([]);
  const preview = await previewShareSku(actor, skuId);
  expect(preview.usedIn).toEqual(expect.arrayContaining([expect.objectContaining({ id: ID.sharedRecipe })]));
  await shareSkuWithAllShops(actor, { skuId, expectedOwner: ID.shopA, previewToken: preview.token });
  expect(await owner("vendor_items", skuId)).toBeNull();
});
it("shares a sandwich with its producer and confirmed owned SKU", async () => {
  const skuId = await newSku();
  const result = (await db.query<{ result: { id: string; menu_item_id: string } }>("select create_shop_sandwich($1::jsonb,$2::jsonb,$3::jsonb,$4,$5) result", [
    JSON.stringify({ name: `Sandwich ${skuId}`, menu_price: 12 }), JSON.stringify({ name: "Sandwich recipe" }),
    JSON.stringify([{ component_sku_id: skuId, quantity: 2, unit: "oz" }]), ID.actor, ID.shopA,
  ])).rows[0]!.result;
  await refresh();
  const preview = await previewShareMenuItem(actor, result.menu_item_id);
  await shareMenuItemWithAllShops(actor, { menuItemId: result.menu_item_id, expectedOwner: ID.shopA, previewToken: preview.token, shareSkuIds: [skuId] });
  expect(await owner("menu_items", result.menu_item_id)).toBeNull();
  expect(await owner("recipes", result.id)).toBeNull();
  expect(await owner("vendor_items", skuId)).toBeNull();
});

it("sharing a SKU preserves the owner's distinct pack and price lanes", async () => {
  const skuId = await newSku();
  const global = (await db.query<{ result: { version_id: string } }>("select save_sku_pack_version($1,null,$2::jsonb,null,null,null,$3,false) result", [skuId, JSON.stringify([{ label: "case", containsQty: 16, containsMeasureUnit: "oz" }]), ID.actor])).rows[0]!.result.version_id;
  await db.query("select save_sku_pack_version($1,$2,$3::jsonb,null,$4,null,$5,false)", [skuId, ID.shopA, JSON.stringify([{ label: "case", containsQty: 32, containsMeasureUnit: "oz" }]), global, ID.actor]);
  await db.query("select save_sku_shop_price($1,$2,24,'2020-01-01',$3,'manual',null)", [skuId, ID.shopA, ID.actor]);
  const beforePacks = (await db.query("select * from sku_pack_versions where sku_id=$1 order by id", [skuId])).rows;
  const beforePrices = (await db.query("select * from vendor_price_history where vendor_item_id=$1 order by id", [skuId])).rows;
  await refresh();
  const preview = await previewShareSku(actor, skuId);
  expect(preview).toMatchObject({ ownerKeepsOwnPack: true, ownerKeepsOwnPrice: true });
  await shareSkuWithAllShops(actor, { skuId, expectedOwner: ID.shopA, previewToken: preview.token });
  expect((await db.query("select * from sku_pack_versions where sku_id=$1 order by id", [skuId])).rows).toEqual(beforePacks);
  expect((await db.query("select * from vendor_price_history where vendor_item_id=$1 order by id", [skuId])).rows).toEqual(beforePrices);
});
it("rejects malformed dependency UUIDs before database access", async () => {
  await expect(shareRecipeWithAllShops(actor, { recipeId: ID.sharedRecipe, expectedOwner: ID.shopA, previewToken: "token", shareSkuIds: ["bad-uuid"], shareItemIds: [] })).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
  await expect(shareRecipeWithAllShops(actor, { recipeId: ID.sharedRecipe, expectedOwner: ID.shopA, previewToken: "token", shareSkuIds: [], shareItemIds: ["bad-uuid"] })).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
  await expect(shareMenuItemWithAllShops(actor, { menuItemId: ID.sharedMenu, expectedOwner: ID.shopA, previewToken: "token", shareSkuIds: ["bad-uuid"] })).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
  expect(accesses).toBe(0);
});
it("refuses an unexpected owner with the named conflict", async () => {
  const skuId = await newSku(); const preview = await previewShareSku(actor, skuId);
  await expect(shareSkuWithAllShops(actor, { skuId, expectedOwner: ID.shopB, previewToken: preview.token })).rejects.toMatchObject({ status: 409, code: "ownership_changed" });
  expect(await owner("vendor_items", skuId)).toBe(ID.shopA);
});
it("SQL refuses a menu producer added after preview without publishing either producer", async () => {
  const skuId = await newSku();
  const result = (await db.query<{ result: { id: string; menu_item_id: string } }>("select create_shop_sandwich($1::jsonb,$2::jsonb,$3::jsonb,$4,$5) result", [
    JSON.stringify({ name: `Racing sandwich ${skuId}`, menu_price: 12 }), JSON.stringify({ name: "Original producer" }),
    JSON.stringify([{ component_sku_id: skuId, quantity: 2, unit: "oz" }]), ID.actor, ID.shopA,
  ])).rows[0]!.result;
  await refresh(); const preview = await previewShareMenuItem(actor, result.menu_item_id);
  let lateRecipe = "";
  beforeWrite = async () => {
    lateRecipe = (await db.query<{ id: string }>("insert into recipes(name,recipe_type,batch_yield,location_id,created_by) values ('Later producer','consumer',1,$1,$2) returning id", [ID.shopA, ID.actor])).rows[0]!.id;
    await db.query("insert into recipe_inputs(recipe_id,component_sku_id,quantity,unit,created_by) values ($1,$2,1,'oz',$3)", [lateRecipe, skuId, ID.actor]);
    await db.query("insert into recipe_outputs(recipe_id,output_menu_item_id,yield,created_by) values ($1,$2,1,$3)", [lateRecipe, result.menu_item_id, ID.actor]);
  };
  await expect(shareMenuItemWithAllShops(actor, { menuItemId: result.menu_item_id, expectedOwner: ID.shopA, previewToken: preview.token, shareSkuIds: [skuId] })).rejects.toMatchObject({ status: 409, code: "dependencies_changed" });
  expect(beforeWrite).toBeUndefined();
  expect(await owner("menu_items", result.menu_item_id)).toBe(ID.shopA);
  expect(await owner("recipes", result.id)).toBe(ID.shopA);
  expect(await owner("recipes", lateRecipe)).toBe(ID.shopA);
  expect(await owner("vendor_items", skuId)).toBe(ID.shopA);
});
