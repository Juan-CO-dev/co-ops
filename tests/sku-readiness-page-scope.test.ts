import { expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ readiness: vi.fn(async () => new Map()), packs: vi.fn(async () => new Map()) }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({ user: { role: "owner", language: "en" }, level: 9, locations: [] }) }));
vi.mock("@/lib/shop-context", () => ({ resolveShopId: async (_: string[], explicit: string) => explicit ?? null }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: () => {
  const result = { data: [{ id: "shop-a", name: "Shop A" }] };
  const q = { select: () => q, eq: () => q, order: () => q, returns: async () => result, then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve) }; return q;
} }) }));
vi.mock("@/lib/admin/skus", () => ({ loadSkus: async () => [], loadPackFormats: async () => [], loadMeasureUnits: async () => [], loadLocationSkuSettings: async () => new Map(), parsColumnsReady: async () => true, SKU_WRITE_MIN: 7 }));
vi.mock("@/lib/admin/vendors", () => ({ loadVendors: async () => [] }));
vi.mock("@/lib/products", () => ({ listProducts: async () => [], ProductError: class extends Error {} }));
vi.mock("@/lib/admin/cost", () => ({ loadCurrentSkuPrices: async () => new Map(), computeSkuCostPerOz: () => new Map(), loadSkuUsageMap: async () => new Map(), loadSkuReceivingLedger: async () => new Map(), loadSkuConsumption: async () => new Map() }));
vi.mock("@/lib/prep-consumption", () => ({ loadSkuPackResolution: h.packs }));
vi.mock("@/lib/admin/readiness-load", () => ({ loadSkuReadinessMap: h.readiness }));
vi.mock("@/lib/sku-data-readiness-load", () => ({ loadSkuDataReadiness: async () => [] }));
vi.mock("@/lib/pack-change-requests", () => ({ loadOpenPackChangeRequests: async () => [] }));
vi.mock("@/components/admin/skus/SkuCatalogClient", () => ({ SkuCatalogClient: () => null }));
import Page from "@/app/admin/skus/page";

it("a hub shop link reads that shop's readiness while the legacy editor keeps its global pack baseline", async () => {
  await Page({ searchParams: Promise.resolve({ location: "shop-a" }) } as never);
  expect(h.readiness).toHaveBeenLastCalledWith(expect.anything(), "shop-a");
  expect(h.packs).toHaveBeenLastCalledWith([], null);
});
it("the explicit default ignores remembered shop preference", async () => {
  await Page({ searchParams: Promise.resolve({ location: "global" }) } as never);
  expect(h.readiness).toHaveBeenLastCalledWith(expect.anything(), null);
});
