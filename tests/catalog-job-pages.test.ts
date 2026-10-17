import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ auth: vi.fn(), newItem: vi.fn(), swap: vi.fn(), strip: vi.fn(), sku: vi.fn(), db: {} as unknown }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("404"); }, redirect: (url: string) => { throw Error(`redirect:${url}`); } }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: h.auth }));
vi.mock("@/lib/catalog/jobs", () => ({ loadNewItemJobView: h.newItem, loadSwapVendorJobView: h.swap, loadItemJobsStrip: h.strip }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db }));
vi.mock("@/lib/i18n/server", () => ({ serverT: () => "Item" }));
vi.mock("@/lib/shop-context", () => ({ resolveShopId: async (ids: string[], explicit: string | null) => explicit ?? ids[0] }));
vi.mock("@/lib/catalog/sku-item", () => ({ loadSkuItemView: h.sku, CatalogItemError: class extends Error {} }));
vi.mock("@/components/catalog/SkuItemClient", () => ({ SkuItemClient: () => null }));
vi.mock("@/components/catalog/jobs/NewItemJob", () => ({ NewItemJob: () => null }));
import NewItemPage from "@/app/admin/catalog/new/item/page";
import SkuPage from "@/app/admin/catalog/sku/[id]/page";
import { ShopOwnedError } from "@/lib/catalog/shop-owned-shared";
import { createFakeDb } from "./fixtures/counts-fake-db";
const shop = "10000000-0000-4000-8000-000000000001", sku = "20000000-0000-4000-8000-000000000001";
type Node = { props?: Record<string, unknown> };
function find(node: unknown, key: string): Node | undefined {
  if (Array.isArray(node)) return node.map(n => find(n, key)).find(Boolean);
  if (!node || typeof node !== "object") return;
  const n = node as Node;
  return n.props && key in n.props ? n : find(n.props?.children, key);
}
beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { role: "gm", language: "en" }, level: 7, locations: [shop] });
  h.newItem.mockResolvedValue({ scope: shop });
  h.swap.mockResolvedValue({ scope: shop });
  h.strip.mockResolvedValue({ skuId: sku, scope: shop });
  h.sku.mockResolvedValue({ sku: { id: sku, name: "Item", active: true }, scope: null });
  h.db = createFakeDb({ locations: [{ id: shop, name: "Shop", active: true }], vendor_items: [{ id: sku, location_id: shop }] }).client;
});
it("authorizes swap-return context through the swap loader before passing it to New item", async () => {
  const tree = await NewItemPage({ searchParams: Promise.resolve({ location: shop, swapFrom: sku }) });
  expect(h.swap).toHaveBeenCalledWith(await h.auth.mock.results[0]!.value, sku, shop);
  expect(find(tree, "swapFrom")?.props?.swapFrom).toBe(sku);
});
it("rejects inaccessible original items rather than emitting a forged swap return", async () => {
  h.swap.mockRejectedValue(new ShopOwnedError(404, "not_found"));
  await expect(NewItemPage({ searchParams: Promise.resolve({ location: shop, swapFrom: sku }) })).rejects.toThrow("404");
});
it("ignores invalid and absent swap return values without extra reads", async () => {
  for (const swapFrom of [undefined, "https://example.com", [sku]]) {
    await NewItemPage({ searchParams: Promise.resolve({ location: shop, swapFrom }) });
  }
  expect(h.swap).not.toHaveBeenCalled();
});
it("loads the owned SKU jobs in its owner shop while preserving the existing global version view", async () => {
  const tree = await SkuPage({ params: Promise.resolve({ id: sku }), searchParams: Promise.resolve({ location: "global" }) });
  expect(h.strip).toHaveBeenCalledWith(await h.auth.mock.results[0]!.value, sku, shop);
  expect(find(tree, "jobs")?.props?.jobs).toEqual({ skuId: sku, scope: shop });
});
it("keeps inactive SKU history readable without offering active catalog jobs", async () => {
  h.sku.mockResolvedValue({ sku: { id: sku, name: "Item", active: false }, scope: null });
  const tree = await SkuPage({ params: Promise.resolve({ id: sku }), searchParams: Promise.resolve({ location: "global" }) });
  expect(h.strip).not.toHaveBeenCalled();
  expect(find(tree, "view")?.props?.view).toMatchObject({ sku: { active: false } });
});
