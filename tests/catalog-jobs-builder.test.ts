import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import type { AuthContext } from "@/lib/session";
const h = vi.hoisted(() => ({ products: vi.fn(), packs: vi.fn(), prices: vi.fn() }));
let db: ReturnType<typeof createFakeDb>;
let tables: Tables;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/products", () => ({ loadProductIndex: h.products }));
vi.mock("@/lib/prep-consumption", () => ({ loadSkuPackChains: h.packs }));
vi.mock("@/lib/admin/cost", () => ({ loadCurrentSkuPrices: h.prices }));
import { loadRecipeBuilderCatalog } from "@/lib/admin/recipe-builder-data";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const actor = { user: { id: "gm", role: "gm" }, locations: [A] } as AuthContext;
const strictLoad = () => loadRecipeBuilderCatalog(actor, A, A, { strict: true });
beforeEach(() => {
  vi.clearAllMocks();
  tables = { vendor_items: [], items: [], units: [], measure_units: [], products: [], vendors: [] };
  db = createFakeDb(tables);
  h.products.mockImplementation(async (ids: string[]) => ({ index: { resolution: new Map(ids.map(id => [id, { skuId: `sku-${id}` }])) } }));
  h.packs.mockImplementation(async (ids: string[]) => new Map(ids.map(id => [id, []])));
  h.prices.mockImplementation(async (ids: string[]) => new Map(ids.map(id => [id, 12])));
});
it("strict jobs picker reads all pages and batches dependency IDs at 100", async () => {
  for (let i = 0; i < 1003; i++) {
    const id = String(i).padStart(5, "0");
    tables.vendor_items!.push({ id, name: id, active: true, inventory_only: false, location_id: A });
    tables.items!.push({ id, name: id, active: true, location_id: A });
    tables.products!.push({ id, name: id, active: true });
    tables.units!.push({ id, label: id });
    tables.measure_units!.push({ label: id, dimension: "weight", to_base_factor: 1, active: true });
    tables.vendors!.push({ id, name: id });
  }
  const data = await strictLoad();
  expect(data.skus).toHaveLength(1003);
  expect(data.items).toHaveLength(1003);
  expect(data.outputItems).toHaveLength(1003);
  expect(data.products).toHaveLength(1003);
  expect(data.unitOptions).toHaveLength(1003);
  expect(data.measures.size).toBe(1003);
  expect(data.prices.size).toBe(1003);
  for (const mock of [h.products, h.packs, h.prices]) {
    expect(mock).toHaveBeenCalledTimes(11);
    expect(mock.mock.calls.every(([ids, scope]) => ids.length <= 100 && scope === A)).toBe(true);
  }
  expect(db.log.filter(q => q.table === "vendors")).toHaveLength(3);
  expect(db.writes).toEqual([]);
});
it.each(["vendor_items", "items", "products", "units", "measure_units", "vendors"])("strict jobs picker refuses %s read errors", async table => {
  delete tables[table];
  await expect(strictLoad()).rejects.toThrow();
});
it("default caller retains empty-list behavior on failed base reads", async () => {
  delete tables.vendors;
  await expect(loadRecipeBuilderCatalog(actor, A, A)).resolves.toMatchObject({ skus: [] });
});
it("strict picker excludes foreign owners and limits outputs to the exact owner", async () => {
  tables.items = [null, A, B].map((location_id, i) => ({ id: String(i), name: String(i), active: true, location_id }));
  tables.vendor_items = [null, A, B].map((location_id, i) => ({ id: String(i), name: String(i), active: true, inventory_only: false, location_id }));
  const result = await strictLoad();
  expect(result.items.map(i => i.id)).toEqual(["0", "1"]);
  expect(result.skus.map(i => i.id)).toEqual(["0", "1"]);
  expect(result.outputItems.map(i => i.id)).toEqual(["1"]);
});
