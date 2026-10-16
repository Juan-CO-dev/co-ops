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
  const parsed = parseNewItemRequest({ scope: ID.shopA, name, levels: [{ label: "case", containsQty: 12, containsMeasureUnit: count ? "each" : "oz" }], avgOzPerEach: count ? 3 : null, unitPrice: 18, priceDate: "2026-10-16" });
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
