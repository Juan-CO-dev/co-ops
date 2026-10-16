import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { migratedShopOwnedDb, persistedCatalogRows, seedOperationalBaseline, SHOP_OWNED_ID as ID } from "./fixtures/shop-owned-pglite";
import { createFakeDb } from "./fixtures/counts-fake-db";
import type { AuthContext } from "@/lib/session";
import { audit } from "@/lib/audit";
import { isDestructive } from "@/lib/destructive-actions";
let db: PGlite;
let snapshot: ReturnType<typeof createFakeDb>;
let accesses = 0;
let race: (() => Promise<void>) | null = null;
const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
  accesses++;
  try {
    if (name === "start_sku_swap" && race) { const run = race; race = null; await run(); }
    const keys = Object.keys(args);
    const result = await db.query<{ result: unknown }>(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(",")}) result`,
      keys.map(key => typeof args[key] === "object" && args[key] !== null ? JSON.stringify(args[key]) : args[key]));
    snapshot = createFakeDb(await persistedCatalogRows(db));
    return { data: result.rows[0]?.result, error: null };
  } catch (error) { return { data: null, error: { message: (error as Error).message, code: (error as { code?: string }).code } }; }
});
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: (table: string) => { accesses++; return snapshot.client.from(table); }, rpc }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
import { previewSkuSwap, startSkuSwap, previewBackToNormal, endSkuSwap, loadLiveSwapsForItem } from "@/lib/catalog/swap-vendor";
const actor = { user: { id: ID.actor, role: "gm" }, level: 7, locations: [ID.shopA] } as unknown as AuthContext;
const replacement = "00000000-0000-4000-8000-00000000fccc";
const req = { oldSkuId: ID.sharedSku, newSkuId: replacement, scope: ID.shopA, mode: "for_now" as const, productName: null, productNameEs: null, note: null };
beforeAll(async () => {
 db = await migratedShopOwnedDb(); await seedOperationalBaseline(db);
 // Verbatim 0216 eligibility columns omitted by the bounded graph fixture.
 await db.exec("alter table public.vendor_items add column pending_review boolean not null default false;");
 await db.exec(readFileSync("supabase/migrations/0265_sku_swaps.sql", "utf8"));
 await db.query("insert into vendor_items(id,name) values ($1,'Replacement')", [replacement]);
 await db.query("select save_sku_pack_version($1,null,$2::jsonb,null,null,null,$3,false)", [replacement, JSON.stringify([{ label: "case", containsQty: 16, containsMeasureUnit: "oz" }]), ID.actor]);
 await db.query("select save_sku_global_price($1,16,'2020-01-01',$2,false)", [replacement, ID.actor]);
 snapshot = createFakeDb(await persistedCatalogRows(db));
}, 120_000);
afterAll(async () => { await db?.close(); });
it("rejects forged level and social roles and foreign scope before I/O", async () => {
 accesses = 0;
 await expect(previewSkuSwap({ ...actor, user: { ...actor.user, role: "employee" }, level: 10 }, req)).rejects.toMatchObject({ code: "forbidden" });
 await expect(previewSkuSwap({ ...actor, user: { ...actor.user, role: "social_media_mgr" } }, req)).rejects.toMatchObject({ code: "forbidden" });
 await expect(previewSkuSwap(actor, { ...req, scope: ID.shopB })).rejects.toMatchObject({ code: "not_found" });
 await expect(previewBackToNormal(actor, "bad-id")).rejects.toMatchObject({ code: "invalid_payload" });
 await expect(loadLiveSwapsForItem(actor, "bad-id", ID.shopA)).rejects.toMatchObject({ code: "invalid_payload" });
 expect(accesses).toBe(0);
});
it("refuses pending-review replacement instead of silently falling back to the old primary", async () => {
 await db.query("update vendor_items set pending_review=true where id=$1", [replacement]);
 snapshot = createFakeDb(await persistedCatalogRows(db));
 try { await expect(previewSkuSwap(actor, req)).rejects.toMatchObject({ code: "replacement_ineligible" }); }
 finally { await db.query("update vendor_items set pending_review=false where id=$1", [replacement]); snapshot = createFakeDb(await persistedCatalogRows(db)); }
});
it("refuses an unpromoted store replacement instead of accepting common-resolver fallback", async () => {
 const store = "00000000-0000-4000-8000-00000000fddd";
 await db.query("insert into vendors(id,name,source_kind) values($1,'Corner store','store')", [store]);
 await db.query("update vendor_items set vendor_id=$1 where id=$2", [store, replacement]);
 snapshot = createFakeDb(await persistedCatalogRows(db));
 try { await expect(previewSkuSwap(actor, req)).rejects.toMatchObject({ code: "replacement_ineligible" }); }
 finally { await db.query("update vendor_items set vendor_id=null where id=$1", [replacement]); snapshot = createFakeDb(await persistedCatalogRows(db)); }
});
it("normalizes, costs the real direct recipe, starts atomically and restores it", async () => {
 const p = await previewSkuSwap(actor, req);
 expect(p.request.productName).toBeTruthy();
 expect(p.recipes).toHaveLength(1);
 expect(p.ordering).toEqual({ scope: ID.shopA, primarySkuId: replacement, parsChanged: false, messageKey: "catalog.swap.ordering_consequence" });
 expect(p.costs).toContainEqual(expect.objectContaining({ menuItemId: ID.sharedMenu, before: 4.5, after: 6 }));
 expect((await previewSkuSwap(actor, p.request)).token).toBe(p.token);
 const saved = await startSkuSwap(actor, p.request, p.token);
 expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "sku_swap.start", resourceTable: "sku_swaps", resourceId: saved.swapId }));
 expect(isDestructive("sku_swap.start")).toBe(true);
 const back = await previewBackToNormal(actor, saved.swapId);
 expect(back.goingBack).toHaveLength(1);
 expect(await endSkuSwap(actor, saved.swapId, back.token)).toMatchObject({ back: [ID.sharedRecipe], kept: [] });
 expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "sku_swap.end", resourceTable: "sku_swaps", resourceId: saved.swapId }));
 expect(isDestructive("sku_swap.end")).toBe(true);
});
it("maps a product change racing between fresh preview and locked start to exact 409", async () => {
 const p = await previewSkuSwap(actor, req);
 race = async () => { await db.query("update vendor_items set active=false where id=$1", [replacement]); };
 await expect(startSkuSwap(actor, p.request, p.token)).rejects.toMatchObject({ code: "product_changed", status: 409 });
 await db.query("update vendor_items set active=true where id=$1", [replacement]);
 snapshot = createFakeDb(await persistedCatalogRows(db));
});
it("costs product-primary followers through the real resolver and retains a later same-SKU choice", async () => {
 const product = "00000000-0000-4000-8000-00000000faaa";
 await db.query("insert into products(id,name,created_by,updated_by) values($1,'Swap group',$2,$2)", [product, ID.actor]);
 await db.query("update vendor_items set product_id=$1 where id in($2,$3)", [product, ID.sharedSku, replacement]);
 await db.query("insert into product_primaries(product_id,primary_sku_id,updated_by) values($1,$2,$3)", [product, ID.sharedSku, ID.actor]);
 await db.query("update recipe_version_lines set component_sku_id=null,component_product_id=$1 where recipe_id=$2", [product, ID.sharedRecipe]);
 snapshot = createFakeDb(await persistedCatalogRows(db));
 const p = await previewSkuSwap(actor, req);
 expect(p.recipes).toHaveLength(0);
 expect(p.followsPrimary).toEqual([{ id: ID.sharedRecipe, name: expect.any(String) }]);
 expect(p.costs).toContainEqual(expect.objectContaining({ before: 4.5, after: 6 }));
 const saved = await startSkuSwap(actor, p.request, p.token);
 await db.query("update product_primaries set primary_sku_id=primary_sku_id where product_id=$1 and location_id=$2", [product, ID.shopA]);
 snapshot = createFakeDb(await persistedCatalogRows(db));
 const back = await previewBackToNormal(actor, saved.swapId);
 expect(back.primary).toBe("changed_since");
 expect(back.goingBack).toHaveLength(0);
 expect(back.kept).toHaveLength(0);
 expect(await endSkuSwap(actor, saved.swapId, back.token)).toMatchObject({ primary: "changed_since" });
});
it("binds product evidence with zero recipes and refuses changed primary revision", async () => {
 await db.query("update recipes set active=false where id=$1", [ID.sharedRecipe]);
 snapshot = createFakeDb(await persistedCatalogRows(db));
 const p = await previewSkuSwap(actor, req);
 expect(p.recipeSnapshots).toEqual([]);
 race = async () => { await db.query("update product_primaries set primary_sku_id=primary_sku_id where location_id=$1", [ID.shopA]); };
 await expect(startSkuSwap(actor, p.request, p.token)).rejects.toMatchObject({ status: 409, code: "product_changed" });
});
