import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { AuthContext } from "@/lib/session";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { migratedShopOwnedDb, persistedCatalogRows, seedOperationalBaseline, SHOP_OWNED_ID as ID } from "./fixtures/shop-owned-pglite";
let db: ReturnType<typeof createFakeDb>;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
import { reconcileNewSandwich } from "@/lib/catalog/new-sandwich";
import { parseNewSandwichRequest } from "@/lib/catalog/new-sandwich-shared";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { user: { id: id(1), role: "gm" }, level: 7, locations: [id(2)] } as unknown as AuthContext;
const now = Date.parse("2026-10-16T18:00:00Z");
const request = { attemptKey: id(5), shopId: id(2), ownerLocationId: id(2), name: " Sandwich " };
const menu = { id: id(3), name: "Sandwich", active: true, location_id: id(2), created_by: id(1), created_at: new Date(now - 60_000).toISOString() };
function seed(changes = {}, recipeChanges = {}) {
  db = createFakeDb({ locations: [{ id: id(2), active: true }], menu_items: [{ ...menu, ...changes }],
    recipe_outputs: [{ id: id(6), recipe_id: id(4), output_menu_item_id: id(3) }],
    recipes: [{ id: id(4), active: true, location_id: id(2), ...recipeChanges }] });
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); seed(); });
afterEach(() => { vi.useRealTimers(); });
it("reopens a committed lost response and name-taken retry with minimal identity and no writes", async () => {
  expect(await reconcileNewSandwich(actor, request)).toEqual({ matched: true, menuItemId: id(3) });
  expect(await reconcileNewSandwich(actor, request)).toEqual({ matched: true, menuItemId: id(3) });
  expect(db.writes).toEqual([]);
});
it.each([{ created_by: id(9) }, { created_by: null }, { created_at: new Date(now - 600_001).toISOString() },
  { created_at: new Date(now + 1).toISOString() }, { created_at: "bad-date" }, { name: "sandwich" },
  { name: "Sandwich " }, { active: false }, { location_id: id(8) }])("refuses nonmatches: %j", async changes => {
  seed(changes); await expect(reconcileNewSandwich(actor, request)).rejects.toMatchObject({ code: "name_taken", status: 409 });
});
it("cannot match an unknown actor", async () => {
  await expect(reconcileNewSandwich({ ...actor, user: { ...actor.user, id: id(99) } }, request)).rejects.toMatchObject({ code: "name_taken" });
});
it("propagates read failures instead of manufacturing name_taken", async () => {
  db = createFakeDb({ locations: [{ id: id(2), active: true }] });
  await expect(reconcileNewSandwich(actor, request)).rejects.toThrow("sandwich reconciliation menu");
});
it.each([0, 600_000])("accepts the inclusive server age boundary %i", async age => {
  seed({ created_at: new Date(now - age).toISOString() }); expect(await reconcileNewSandwich(actor, request)).toMatchObject({ matched: true });
});
it.each([{ active: false }, { location_id: id(8) }])("refuses an inaccessible producing recipe %j", async changes => {
  seed({}, changes); await expect(reconcileNewSandwich(actor, request)).rejects.toMatchObject({ code: "name_taken" });
});
it("requires explicit authorized shop and owner scope", async () => {
  for (const changes of [{ shopId: id(8) }, { ownerLocationId: id(8) }, { ownerLocationId: null }, { ownerLocationId: undefined }, { attemptKey: "bad" }]) {
    await expect(reconcileNewSandwich(actor, { ...request, ...changes })).rejects.toBeDefined();
  }
  expect(db.log).toEqual([]);
});
it("matches explicit global only for MoO and an active global producing recipe", async () => {
  seed({ location_id: null }, { location_id: null });
  expect(await reconcileNewSandwich({ ...actor, user: { ...actor.user, role: "moo" }, level: 8 }, { ...request, ownerLocationId: null })).toMatchObject({ matched: true });
});
it("pins creator inside the query and exact-name/owner restrictions as a subset of the RPC collision", () => {
  const source = readFileSync("lib/catalog/new-sandwich.ts", "utf8");
  expect(source).toMatch(/\.eq\("created_by", actor\.user\.id\)/);
  expect(source).toMatch(/\.eq\("name", name\)/);
  expect(source).toContain('.is("location_id", null)');
  const migration = readFileSync("supabase/migrations/0264_catalog_shop_owned.sql", "utf8");
  expect(migration).toContain("lower(btrim");

});
it.each(["Sandwich", "A&B", "\u00d1and\u00fa"])("reconciles trimmed input using exact persisted name: %s", async name => {
  seed({ name });
  expect(await reconcileNewSandwich(actor, { ...request, name: `  ${name}  ` })).toEqual({ matched: true, menuItemId: id(3) });
  seed({ name: name.toLowerCase() });
  await expect(reconcileNewSandwich(actor, { ...request, name })).rejects.toMatchObject({ code: "name_taken" });
});
it("validates an optional correlation-only attempt key on create without breaking old callers", () => {
  const draft = { name: "Sandwich", menuPrice: 12, inputs: [{ componentSkuId: id(7), quantity: 1, unit: "oz" }] };
  expect(parseNewSandwichRequest(draft)).toMatchObject({ ok: true });
  expect(parseNewSandwichRequest({ ...draft, attemptKey: id(5) })).toMatchObject({ ok: true, request: { attemptKey: id(5) } });
  expect(parseNewSandwichRequest({ ...draft, attemptKey: "bad" })).toMatchObject({ ok: false, code: "invalid_payload" });
});
it("a real committed RPC reconciles after its response is lost and the same RPC retry refuses name_taken", async () => {
  const sql = await migratedShopOwnedDb();
  try {
    await seedOperationalBaseline(sql);
    const args = [JSON.stringify({ name: "Committed sandwich", menu_price: 12 }),
      JSON.stringify({ name: "Committed sandwich" }),
      JSON.stringify([{ component_sku_id: ID.sharedSku, quantity: 1, unit: "oz" }]), ID.actor, ID.shopA];
    const statement = "select public.create_shop_sandwich($1::jsonb,$2::jsonb,$3::jsonb,$4::uuid,$5::uuid) result";
    const committed = await sql.query<{ result: { menu_item_id: string } }>(statement, args);
    const menuItemId = committed.rows[0]!.result.menu_item_id;
    await sql.query("update menu_items set created_at=$1 where id=$2", [new Date(now).toISOString(), menuItemId]);
    db = createFakeDb(await persistedCatalogRows(sql));
    const actualActor = { ...actor, user: { ...actor.user, id: ID.actor }, locations: [ID.shopA] };
    const lost = { ...request, shopId: ID.shopA, ownerLocationId: ID.shopA, name: "Committed sandwich" };
    expect(await reconcileNewSandwich(actualActor, lost)).toEqual({ matched: true, menuItemId });
    await expect(sql.query(statement, args)).rejects.toThrow("shop_owned:name_taken");
    expect(await reconcileNewSandwich(actualActor, lost)).toEqual({ matched: true, menuItemId });
    expect(db.writes).toEqual([]);
  } finally { await sql.close(); }
}, 120_000);
