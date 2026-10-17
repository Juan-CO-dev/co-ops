import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadGuideSkuShopNames } from "@/lib/order-guides";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/ordering-sources", () => ({ loadStoreVendorIds: async () => new Set() }));
beforeEach(() => vi.clearAllMocks());
it("names placed, unplaced and retired owners without inventing absent metadata", async () => {
  const db = createFakeDb({ locations: [{ id: "a", name: "North", active: false }, { id: "b", name: "South", active: true }] });
  vi.mocked(getServiceRoleClient).mockReturnValue(db.client);
  expect(await loadGuideSkuShopNames([{ id: "placed", location_id: "a" }, { id: "bucket", location_id: "b" }, { id: "shared", location_id: null }, { id: "legacy" }, { id: "missing", location_id: "gone" }])).toEqual({ placed: "North", bucket: "South" });
  expect(db.log).toHaveLength(1);
});
it("avoids a database read for shared or absent metadata", async () => {
  expect(await loadGuideSkuShopNames([{ id: "shared", location_id: null }, { id: "legacy" }])).toEqual({});
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});
it("deduplicates and bounds each location lookup to 100 owners", async () => {
  const batches: string[][] = [];
  const q = { select: () => q, in: (_key: string, ids: string[]) => { batches.push(ids); return q; }, returns: async () => ({ data: [], error: null }) };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => q } as unknown as ReturnType<typeof getServiceRoleClient>);
  await loadGuideSkuShopNames(Array.from({ length: 402 }, (_, i) => ({ id: `sku-${i}`, location_id: `shop-${i % 201}` })));
  expect(batches.map(b => b.length)).toEqual([100, 100, 1]);
  expect(new Set(batches.flat()).size).toBe(201);
});
it("propagates lookup failures rather than publishing misleading empty ownership", async () => {
  const q = { select: () => q, in: () => q, returns: async () => ({ data: null, error: { message: "offline" } }) };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => q } as unknown as ReturnType<typeof getServiceRoleClient>);
  await expect(loadGuideSkuShopNames([{ id: "sku", location_id: "a" }])).rejects.toThrow("loadGuideSkuShopNames: offline");
});
