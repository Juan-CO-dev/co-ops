import { beforeEach, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import { loadLiveSwapsForItem } from "@/lib/catalog/swap-vendor";
const shop = "00000000-0000-4000-8000-000000000001";
const sku = "00000000-0000-4000-8000-000000000002";
const other = "00000000-0000-4000-8000-000000000003";
const actor = { user: { role: "gm" }, level: 7, locations: [shop] } as AuthContext;
let tables: Tables;
let queries: Array<{ table: string; calls: Array<{ method: string; args: unknown[] }> }>;
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
 const db = createFakeDb(tables);
 return { from(table: string) {
  const entry = { table, calls: [] as Array<{ method: string; args: unknown[] }> }; queries.push(entry);
  const target = db.client.from(table);
  const proxy: unknown = new Proxy(target, { get(object, key) {
   const fn = Reflect.get(object, key);
   if (typeof fn !== "function") return fn;
   if (key === "then") return fn.bind(object);
   return (...args: unknown[]) => { entry.calls.push({ method: String(key), args }); fn.apply(object, args); return proxy; };
  } }); return proxy;
 } };
} }));
beforeEach(() => { tables = { sku_swaps: [], sku_swap_ends: [] }; queries = []; });
const row = (id: string, overrides = {}) => ({ id, old_sku_id: sku, new_sku_id: other, location_id: shop, temporary: true, created_at: "2026-10-16T00:00:00Z", ...overrides });
it("scopes the database query and batches matching ends past 1000 rows", async () => {
 tables.sku_swaps = Array.from({ length: 1005 }, (_, n) => row(`swap-${String(n).padStart(4, "0")}`));
 tables.sku_swaps.push(row("foreign", { location_id: other }), row("unrelated", { old_sku_id: other }), row("permanent", { temporary: false }));
 tables.sku_swap_ends = [{ id: "end", swap_id: "swap-0000" }, { id: "foreign-end", swap_id: "foreign" }];
 const result = await loadLiveSwapsForItem(actor, sku, shop);
 expect(result).toHaveLength(1004);
 expect(result.some(r => ["foreign", "unrelated", "permanent", "swap-0000"].includes(r.swapId))).toBe(false);
 for (const q of queries.filter(q => q.table === "sku_swaps")) {
  expect(q.calls).toContainEqual({ method: "eq", args: ["location_id", shop] });
  expect(q.calls).toContainEqual({ method: "eq", args: ["temporary", true] });
  expect(q.calls).toContainEqual({ method: "or", args: [`old_sku_id.eq.${sku},new_sku_id.eq.${sku}`] });
 }
 for (const q of queries.filter(q => q.table === "sku_swap_ends")) {
  const ids = q.calls.find(c => c.method === "in" && c.args[0] === "swap_id")?.args[1] as string[];
  expect(ids).toBeDefined(); expect(ids.length).toBeLessThanOrEqual(100); expect(ids).not.toContain("foreign");
 }
});
it("does not query ends for an empty scoped journal", async () => {
 expect(await loadLiveSwapsForItem(actor, sku, shop)).toEqual([]);
 expect(queries.map(q => q.table)).toEqual(["sku_swaps"]);
});
it("refuses foreign and social-media access before I/O", async () => {
 await expect(loadLiveSwapsForItem(actor, sku, other)).rejects.toMatchObject({ status: 404 });
 await expect(loadLiveSwapsForItem({ ...actor, user: { ...actor.user, role: "social_media_mgr" } }, sku, shop)).rejects.toMatchObject({ status: 404 });
 expect(queries).toEqual([]);
});
