import { beforeEach, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
const mocks = vi.hoisted(() => ({ builder: vi.fn(), resolve: vi.fn() }));
let db: ReturnType<typeof createFakeDb>, tables: Tables;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/shop-context", () => ({ resolveShopId: mocks.resolve }));
vi.mock("@/lib/admin/recipe-builder-data", () => ({ loadRecipeBuilderCatalog: mocks.builder }));
import { loadNewItemJobView, loadNewSandwichJobView, loadSwapVendorJobView, loadItemJobsStrip } from "@/lib/catalog/jobs";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", SKU = "33333333-3333-4333-8333-333333333333";
const gm = { user: { id: A, role: "gm" }, level: 7, locations: [A] } as AuthContext;
const moo = { ...gm, user: { ...gm.user, role: "moo" }, level: 8 } as AuthContext;
beforeEach(() => {
  vi.clearAllMocks();
  tables = { locations: [{ id: A, name: "One", active: true }, { id: B, name: "Two", active: true }],
    vendors: [{ id: "v", name: "Vendor", active: true, source_kind: "vendor" }], categories: [], order_types: [],
    vendor_order_guides: [{ id: "g", vendor_id: "v", name: "Guide", updated_at: "now" }], order_guide_sections: [{ id: "s", guide_id: "g", name: "Produce", position: 1 }],
    vendor_delivery_rhythm: [{ id: "r", vendor_id: "v", location_id: A, order_dow: 1, lead_days: 2, active: true }],
    vendor_items: [{ id: SKU, name: "Owned", location_id: A, vendor_id: "v", product_id: null, active: true, inventory_only: false }, { id: "shared", name: "Shared", location_id: null, vendor_id: "v", product_id: null, active: true, inventory_only: false }, { id: "foreign", name: "Foreign", location_id: B, active: true, inventory_only: false }],
    sku_swaps: [], sku_swap_ends: [], location_sku_settings: [] };
  db = createFakeDb(tables);
  mocks.resolve.mockImplementation(async (ids: string[], requested?: string) => requested ?? ids[0] ?? null);
  mocks.builder.mockResolvedValue({ skus: [], items: [], products: [], outputItems: [], prices: new Map([[SKU, 2]]), measures: new Map([["oz", { dimension: "weight", toBaseFactor: 1 }]]), unitOptions: [], activeMeasureLabels: ["oz"] });
});
it("resolves only authorized shops and loads setup options in batches", async () => {
  const view = await loadNewItemJobView(gm);
  expect(view.scope).toBe(A); expect(view.shops).toEqual([{ id: A, name: "One" }]);
  expect(mocks.resolve).toHaveBeenCalledWith([A], undefined);
  expect(view.vendors).toEqual([{ id: "v", name: "Vendor" }]);
  expect(view.guides[0]?.sections).toEqual([{ id: "s", name: "Produce", position: 1 }]);
  expect(view.rhythm).toEqual([{ id: "r", vendorId: "v", orderDow: 1, leadDays: 2 }]);
  expect(db.log.length).toBe(7); expect(db.writes).toEqual([]);
});
it("distinguishes explicit global from omission and binds builder owner", async () => {
  await expect(loadNewSandwichJobView(gm, null)).rejects.toMatchObject({ code: "global_requires_moo" });
  const global = await loadNewSandwichJobView(moo, null);
  expect(global.scope).toBeNull(); expect(mocks.builder).toHaveBeenLastCalledWith(moo, null, null, { strict: true });
  const owned = await loadNewSandwichJobView(gm, A);
  expect(mocks.builder).toHaveBeenLastCalledWith(gm, A, A, { strict: true });
  expect(owned.catalog.prices).toEqual([[SKU, 2]]);
  expect(JSON.parse(JSON.stringify(owned))).toEqual(owned);
});
it("refuses foreign, inactive, malformed and SMM requests instead of fallback", async () => {
  await expect(loadNewItemJobView(gm, B)).rejects.toMatchObject({ code: "not_found" });
  await expect(loadNewItemJobView(gm, "bad")).rejects.toMatchObject({ code: "invalid_payload" });
  tables.locations![0]!.active = false;
  await expect(loadNewItemJobView(gm, A)).rejects.toMatchObject({ code: "not_found" });
  db.log.length = 0;
  await expect(loadNewItemJobView({ ...gm, user: { ...gm.user, role: "social_media_mgr" } })).rejects.toMatchObject({ code: "forbidden" });
  expect(db.log).toEqual([]);
});
it.each(["locations", "vendors", "categories", "order_types", "vendor_order_guides", "order_guide_sections", "vendor_delivery_rhythm"])("throws %s read errors", async table => {
  delete tables[table]; await expect(loadNewItemJobView(gm, A)).rejects.toThrow();
});
it("does not turn a builder error into an empty sandwich picker", async () => {
  mocks.builder.mockRejectedValue(new Error("read failed"));
  await expect(loadNewSandwichJobView(gm, A)).rejects.toThrow("read failed");
});
it("projects owned identity, null write scope and separate owner shop", async () => {
  const view = await loadItemJobsStrip(gm, SKU, A);
  expect(view.owner).toEqual({ ownerLocationId: A, ownerShopName: "One", writeScope: null, canEdit: true, canShare: false });
  expect((await loadItemJobsStrip(moo, SKU, A)).owner.canShare).toBe(true);
  await expect(loadItemJobsStrip(moo, SKU, B)).rejects.toMatchObject({ code: "sku_not_found" });
});
it("loads only eligible scoped swap choices and excludes ended journal entries", async () => {
  tables.sku_swaps = [{ id: "live", old_sku_id: SKU, new_sku_id: "shared", location_id: A, temporary: true, created_at: "now" }, { id: "ended", old_sku_id: SKU, new_sku_id: "shared", location_id: A, temporary: true, created_at: "before" }];
  tables.sku_swap_ends = [{ id: "end", swap_id: "ended" }];
  const view = await loadSwapVendorJobView(gm, SKU, A);
  expect(view.replacements.map(r => r.id)).toEqual(["shared"]);
  expect(view.jobs.liveSwaps.map(s => s.swapId)).toEqual(["live"]);
  expect(db.writes).toEqual([]);
});
it("paginates vendor lists and batches section IDs, without per-vendor queries", async () => {
  tables.vendors = Array.from({ length: 1005 }, (_, i) => ({ id: `v${i}`, name: `V${i}`, active: true, source_kind: "vendor" }));
  tables.vendor_order_guides = tables.vendors.map((v, i) => ({ id: `g${i}`, vendor_id: v.id, name: "Guide", updated_at: "now" }));
  tables.order_guide_sections = tables.vendor_order_guides.map((g, i) => ({ id: `s${i}`, guide_id: g.id, name: "Section", position: 1 }));
  const view = await loadNewItemJobView(gm, A);
  expect(view.vendors).toHaveLength(1005); expect(view.guides).toHaveLength(1005);
  expect(view.guides.every(g => g.sections.length === 1)).toBe(true);
  expect(db.log.length).toBeLessThan(40);
});
