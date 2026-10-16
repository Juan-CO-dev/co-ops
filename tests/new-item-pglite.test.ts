/** The job consumer executes real 0258–0264 writers in PGlite; no live database. */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { AuthContext } from "@/lib/session";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { migratedShopOwnedDb, SHOP_OWNED_ID as ID } from "./fixtures/shop-owned-pglite";
let db: PGlite;
let transport: ReturnType<typeof createFakeDb>;
let intercept: ((args: Record<string, unknown>) => void) | undefined;
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ ...transport.client,
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name !== "create_catalog_sku") throw new Error(`Unexpected RPC ${name}`);
    intercept?.(args);
    try {
      const result = await db.query<{ result: unknown }>("select public.create_catalog_sku($1::jsonb,$2::jsonb,$3::jsonb,$4::uuid,$5::uuid) result", [JSON.stringify(args.p_sku), JSON.stringify(args.p_pack), JSON.stringify(args.p_price), args.p_actor, args.p_location_id]);
      return { data: result.rows[0]!.result, error: null };
    } catch (error) { return { data: null, error }; }
  },
}) }));
import { createCatalogItem } from "@/lib/catalog/new-item";
import { parseNewItemRequest } from "@/lib/catalog/new-item-shared";
const actor = { user: { id: ID.actor, role: "gm" }, role: "gm", level: 7, locations: [ID.shopA] } as AuthContext;
function request(name: string, count = false) {
  const parsed = parseNewItemRequest({ request_id: crypto.randomUUID(), scope: ID.shopA, name, levels: [{ label: "case", containsQty: 12, containsMeasureUnit: count ? "each" : "oz" }], avgOzPerEach: count ? 3 : null, unitPrice: 18, priceDate: "2026-10-16" });
  if (!parsed.ok) throw new Error(parsed.field);
  return parsed.request;
}
async function counts() {
  return (await db.query("select (select count(*) from vendor_items)::int skus,(select count(*) from sku_pack_versions)::int packs,(select count(*) from vendor_price_history)::int prices")).rows;
}
beforeAll(async () => {
  db = await migratedShopOwnedDb();
  await db.exec("insert into measure_units(label,dimension,to_base_factor,active) values ('each','count',1,true)");
  // Inject a downstream failure AFTER the SKU/pack writes to prove RPC rollback.
  await db.exec(`create function reject_test_initial_price() returns trigger language plpgsql as $$
    begin if new.unit_price=99999 then raise exception 'sku_price:invalid_price' using errcode='P0001'; end if; return new; end $$;
    create trigger reject_test_initial_price before insert on vendor_price_history for each row execute function reject_test_initial_price()`);
  transport = createFakeDb({ measure_units: (await db.query<Record<string, unknown>>("select * from measure_units")).rows });
}, 120_000);
beforeEach(() => { intercept = undefined; });
afterAll(async () => { await db?.close(); });
it("commits the actual engine SKU, first pack and first price together", async () => {
  const created = await createCatalogItem(actor, request("Job atomic trio"));
  expect(created.ownerLocationId).toBe(ID.shopA);
  expect((await db.query("select location_id from vendor_items where id=$1", [created.skuId])).rows).toEqual([{ location_id: ID.shopA }]);
  expect((await db.query("select sku_id from sku_pack_versions where sku_id=$1 and active", [created.skuId])).rows).toHaveLength(1);
  expect((await db.query("select unit_price from vendor_price_history where vendor_item_id=$1", [created.skuId])).rows).toEqual([{ unit_price: "18.00" }]);
});
it("persists count-leaf weight in the same creation transaction", async () => {
  const created = await createCatalogItem(actor, request("Job count weight", true));
  expect((await db.query("select avg_oz_per_each from vendor_items where id=$1", [created.skuId])).rows).toEqual([{ avg_oz_per_each: "3" }]);
});
it.each(["pack", "price"])("late SQL %s refusal leaves no orphan row or history", async kind => {
  const before = await counts();
  intercept = args => { if (kind === "pack") args.p_pack = { levels: [{ label: "case", containsQty: 0, containsMeasureUnit: "oz" }] }; else args.p_price = { unitPrice: 99999, effectiveDate: "2026-10-16" }; };
  await expect(createCatalogItem(actor, request(`Rejected ${kind}`))).rejects.toMatchObject({ status: 400 });
  expect(await counts()).toEqual(before);
});
it.each(["bad", -2, {}, true])("SQL refuses malformed initial weight %j with no writes", async avgOzPerEach => {
  const before = await counts();
  await expect(db.query("select public.create_catalog_sku($1::jsonb,null,null,$2,$3)", [JSON.stringify({ name: "Invalid weight", avgOzPerEach }), ID.actor, ID.shopA])).rejects.toMatchObject({ code: "P0001", message: "shop_owned:invalid_payload" });
  expect(await counts()).toEqual(before);
});

it("replays one request without duplicating the SKU, pack, price or audit", async () => {
  const input = request("Replay no item number");
  const first = await createCatalogItem(actor, input);
  const after = await counts();
  const { audit } = await import("@/lib/audit");
  vi.mocked(audit).mockClear();
  expect(first.replayed).toBe(false);
  expect(await createCatalogItem(actor, input)).toEqual({ ...first, replayed: true });
  expect(await counts()).toEqual(after);
  expect(audit).not.toHaveBeenCalled();
});
it("different request ids create two SKUs even with identical unnumbered inputs", async () => {
  const input = request("Distinct requests");
  const first = await createCatalogItem(actor, input);
  const second = await createCatalogItem(actor, { ...input, request_id: crypto.randomUUID() });
  expect(second.skuId).not.toBe(first.skuId);
});
it("scopes a request id to its creation owner, including the shared scope", async () => {
  const input = request("Scoped replay");
  const moo = { ...actor, role: "moo", level: 8, user: { ...actor.user, role: "moo" }, locations: [ID.shopA, ID.shopB] } as AuthContext;
  const a = await createCatalogItem(moo, input);
  const b = await createCatalogItem(moo, { ...input, scope: ID.shopB });
  const global = await createCatalogItem(moo, { ...input, scope: null });
  expect(new Set([a.skuId, b.skuId, global.skuId]).size).toBe(3);
  expect([a.replayed, b.replayed, global.replayed]).toEqual([false, false, false]);
  expect(await createCatalogItem(moo, { ...input, scope: null })).toEqual({ ...global, replayed: true });
  await db.query("update vendor_items set location_id=null where id=$1", [a.skuId]);
  const replay = await createCatalogItem(moo, input);
  expect(replay).toEqual({ skuId: a.skuId, ownerLocationId: null, replayed: true });
});

it("the partial unique index refuses duplicate creation keys, including null global owners", async () => {
  for (const scope of [ID.shopA, null]) {
    const input = { ...request("Index enforced"), scope };
    const moo = { ...actor, level: 8 } as AuthContext;
    await createCatalogItem(moo, input);
    await expect(db.query("insert into vendor_items(id,name,request_id,request_owner_location_id) values(gen_random_uuid(),'Forged',$1,$2)", [input.request_id, scope])).rejects.toMatchObject({ code: "23505" });
  }
});
it("creation replay identity cannot be edited after insert", async () => {
  const item = await createCatalogItem(actor, request("Immutable replay identity"));
  await expect(db.query("update vendor_items set request_id=gen_random_uuid() where id=$1", [item.skuId])).rejects.toMatchObject({ message: "shop_owned:invalid_payload" });
  await expect(db.query("update vendor_items set request_owner_location_id=null where id=$1", [item.skuId])).rejects.toMatchObject({ message: "shop_owned:invalid_payload" });
});
it.each(["bad", 3, {}, []])("SQL refuses malformed request identity %j", async request_id => {
  await expect(db.query("select public.create_catalog_sku($1::jsonb,null,null,$2,$3)", [JSON.stringify({ name: "Bad request", request_id }), ID.actor, ID.shopA])).rejects.toMatchObject({ message: "shop_owned:invalid_payload", code: "P0001" });
});
