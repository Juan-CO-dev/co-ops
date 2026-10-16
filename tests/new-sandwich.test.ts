import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migratedShopOwnedDb, persistedCatalogRows, seedOperationalBaseline, SHOP_OWNED_ID as ID } from "./fixtures/shop-owned-pglite";
import { createFakeDb } from "./fixtures/counts-fake-db";
import type { AuthContext } from "@/lib/session";
let db: PGlite;
let snapshot: ReturnType<typeof createFakeDb>;
const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
  try {
    const keys = Object.keys(args);
    const result = await db.query<{ result: unknown }>(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(",")}) result`,
      keys.map(key => typeof args[key] === "object" && args[key] !== null ? JSON.stringify(args[key]) : args[key]));
    snapshot = createFakeDb(await persistedCatalogRows(db));
    return { data: result.rows[0]?.result, error: null };
  } catch (error) { return { data: null, error: { message: (error as Error).message, code: (error as { code?: string }).code } }; }
});
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: (table: string) => snapshot.client.from(table), rpc }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/toast/menus", () => ({ fetchToastMenuItems: vi.fn(async () => [{ itemGuid: "toast-1", name: "Toast sandwich", priceCents: 1200, groupName: null }]), fetchToastModifierOptions: vi.fn() }));
import { parseNewSandwichRequest } from "@/lib/catalog/new-sandwich-shared";
import { previewNewSandwich, createNewSandwich } from "@/lib/catalog/new-sandwich";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { costPerOzFromGraph, rollupMenuItemCost } from "@/lib/menu-costing-shared";
import { confirmSandwichToastLink, loadSandwichToastChoices } from "@/lib/admin/toast-map";
const actor = { user: { id: ID.actor, role: "gm" }, level: 7, locations: [ID.shopA] } as unknown as AuthContext;
const draft = { locationId: ID.shopA, name: " New sandwich ", nameEs: " Nuevo ", menuPrice: 12, inputs: [{ componentSkuId: ID.sharedSku, quantity: 2, unit: "oz" }] };
beforeAll(async () => { db = await migratedShopOwnedDb(); await seedOperationalBaseline(db); snapshot = createFakeDb(await persistedCatalogRows(db)); }, 120_000);
afterAll(async () => { await db?.close(); });
it("normalizes one request without losing omitted versus explicit global scope", () => {
  expect(parseNewSandwichRequest(draft)).toMatchObject({ ok: true, request: { name: "New sandwich", nameEs: "Nuevo", inputs: [{ quantity: 2 }] } });
  const { locationId: _, ...omitted } = draft;
  expect(parseNewSandwichRequest(omitted)).toMatchObject({ ok: true, request: { locationId: undefined } });
  expect(parseNewSandwichRequest({ ...draft, locationId: null })).toMatchObject({ ok: true, request: { locationId: null } });
});
it.each([{ menuPrice: NaN }, { menuPrice: "12" }, { name: " " }, { inputs: [] }, { inputs: [{ componentSkuId: "bad-uuid", quantity: 2 }] }])("refuses malformed input before writes: %j", async changes => {
  rpc.mockClear(); await expect(createNewSandwich(actor, { ...draft, ...changes })).rejects.toBeDefined(); expect(rpc).not.toHaveBeenCalled();
});
it("authorizes explicit scope before I/O and refuses global GM/social-media creation", async () => {
  rpc.mockClear();
  await expect(createNewSandwich(actor, { ...draft, locationId: null })).rejects.toMatchObject({ code: "global_requires_moo" });
  await expect(createNewSandwich(actor, { ...draft, locationId: ID.shopB })).rejects.toMatchObject({ code: "not_found" });
  await expect(createNewSandwich({ ...actor, user: { ...actor.user, role: "social_media_mgr" } }, draft)).rejects.toMatchObject({ code: "forbidden" });
  expect(rpc).not.toHaveBeenCalled();
});
it("previews using shop packs/prices and commits exactly those normalized lines atomically, without Toast", async () => {
  const preview = await previewNewSandwich(actor, draft);
  expect(preview.request.locationId).toBe(ID.shopA);
  expect(parseNewSandwichRequest(preview.request)).toEqual({ ok: true, request: preview.request });
  expect(preview.cost.cost).toBe(1.5);
  const saved = await createNewSandwich(actor, preview.request);
  expect(saved).toEqual({ recipeId: expect.any(String), menuItemId: expect.any(String) });
  const graph = await loadRecipeGraph({ locationId: ID.shopA });
  const prices = await loadCurrentSkuPrices([...graph.skuPack.keys()], ID.shopA);
  expect(rollupMenuItemCost(graph, saved.menuItemId, costPerOzFromGraph(graph, prices))).toEqual(preview.cost);
  expect((await db.query("select name,location_id from recipes where id=$1", [saved.recipeId])).rows).toEqual([{ name: "New sandwich", location_id: ID.shopA }]);
  expect((await db.query("select * from toast_menu_map")).rows).toHaveLength(0);
  await expect(loadSandwichToastChoices(actor, ID.shopB)).rejects.toMatchObject({ code: "forbidden" });
  expect(await loadSandwichToastChoices(actor, ID.shopA)).toEqual([{ itemGuid: "toast-1", name: "Toast sandwich", priceCents: 1200, groupName: null }]);
  await expect(confirmSandwichToastLink(actor, { locationId: ID.shopA, menuItemId: saved.menuItemId, toastItemGuid: "toast-1", confirmed: false })).rejects.toMatchObject({ code: "invalid_payload" });
  expect(snapshot.writes).toHaveLength(0);
  await confirmSandwichToastLink(actor, { locationId: ID.shopA, menuItemId: saved.menuItemId, toastItemGuid: "toast-1", confirmed: true });
  expect(snapshot.writes.find(w => w.table === "toast_menu_map")?.rows[0]).toMatchObject({ match_status: "confirmed", menu_item_id: saved.menuItemId, is_modifier: false });
});
it("hydrates a previously unreferenced draft SKU and refuses duplicate creation without orphan recipe rows", async () => {
  const sku = "00000000-0000-4000-8000-00000000fccc";
  await db.query("insert into vendor_items(id,name,location_id) values ($1,'Unused owned ingredient',$2)", [sku, ID.shopA]);
  await db.query("select save_sku_pack_version($1,null,$2::jsonb,null,null,null,$3,false)", [sku, JSON.stringify([{ label: "case", containsQty: 8, containsMeasureUnit: "oz" }]), ID.actor]);
  await db.query("select save_sku_global_price($1,16,'2020-01-01',$2,false)", [sku, ID.actor]);
  snapshot = createFakeDb(await persistedCatalogRows(db));
  const input = { ...draft, name: "Fresh leaf sandwich", inputs: [{ componentSkuId: sku, quantity: 3, unit: "oz" }] };
  const preview = await previewNewSandwich(actor, input);
  expect(preview.cost.cost).toBe(6);
  const saved = await createNewSandwich(actor, preview.request);
  const graph = await loadRecipeGraph({ locationId: ID.shopA });
  expect(rollupMenuItemCost(graph, saved.menuItemId, costPerOzFromGraph(graph, await loadCurrentSkuPrices([...graph.skuPack.keys()], ID.shopA)))).toEqual(preview.cost);
  const before = (await db.query("select id from recipes order by id")).rows;
  await expect(createNewSandwich(actor, input)).rejects.toMatchObject({ code: "name_taken", status: 409 });
  expect((await db.query("select id from recipes order by id")).rows).toEqual(before);
});
it("refuses foreign components before any RPC and rejects synthetic collisions even with hidden recipes", async () => {
  const foreignSku = "00000000-0000-4000-8000-00000000faaa";
  const foreignRecipe = "00000000-0000-4000-8000-00000000fbbb";
  await db.query("insert into vendor_items(id,name,location_id) values ($1,'Foreign',$2)", [foreignSku, ID.shopB]);
  await db.query("insert into recipes(id,name,location_id,recipe_type,batch_yield) values ($1,'Foreign',$2,'consumer',1)", [foreignRecipe, ID.shopB]);
  snapshot = createFakeDb(await persistedCatalogRows(db)); rpc.mockClear();
  await expect(createNewSandwich(actor, { ...draft, inputs: [{ componentSkuId: foreignSku, quantity: 1, unit: "oz" }] })).rejects.toMatchObject({ code: "line_other_shop", line: { position: 1 } });
  expect(rpc).not.toHaveBeenCalled();
  await expect(loadRecipeGraph({ locationId: ID.shopA, draftRecipes: [{ recipeId: foreignRecipe, batchYield: 1, inputs: [], outputs: [] }] })).rejects.toThrow("draft_recipe_id_collision");
});
it("refuses a foreign menu target before manualMap can supersede an existing mapping", async () => {
  const foreignMenu = "00000000-0000-4000-8000-00000000fddd";
  await db.query("insert into menu_items(id,name,location_id,menu_price) values ($1,'Foreign sandwich',$2,12)", [foreignMenu, ID.shopB]);
  snapshot = createFakeDb(await persistedCatalogRows(db));
  await expect(confirmSandwichToastLink(actor, { locationId: ID.shopA, menuItemId: foreignMenu, toastItemGuid: "toast-1", confirmed: true })).rejects.toMatchObject({ code: "invalid_entity" });
  expect(snapshot.writes).toHaveLength(0);
});
