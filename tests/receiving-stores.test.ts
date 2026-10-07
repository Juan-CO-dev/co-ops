import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { storeName, pendingItemInput, resolutionContentOz } from "@/lib/receiving-stores-shared";
import { skuContentOz } from "@/lib/recipe-math";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/receiving", () => ({ RECEIVE_MIN: 4, ReceivingError: class extends Error {
  constructor(public status: number, public code: string) { super(code); }
} }));
import { createStore, createStoreItem, resolvePendingStoreItem } from "@/lib/receiving-stores";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const STORE = "33333333-3333-4333-8333-333333333333";
const SKU = "44444444-4444-4444-8444-444444444444";
const REF = "55555555-5555-4555-8555-555555555555";
function actor(role: RoleCode, locations = [SHOP]): AuthContext {
  return { user: { id: REF, role }, locations } as AuthContext;
}
beforeEach(() => { vi.clearAllMocks(); });

describe("store input boundaries", () => {
  it("normalizes spacing without erasing the displayed store's case", () => {
    expect(storeName("  Corner   Market \n")).toBe("Corner Market");
    expect(storeName("   ")).toBeNull();
    expect(storeName("x".repeat(161))).toBeNull();
    expect(storeName({ name: "market" })).toBeNull();
  });
  it("accepts unknown ounces, refuses fabricated or nonfinite measurements", () => {
    expect(pendingItemInput("New ingredient", "jar", undefined)).toEqual({ name: "New ingredient", countUnit: "jar", contentOz: null });
    expect(pendingItemInput("New ingredient", "jar", 12)).toMatchObject({ contentOz: 12 });
    for (const bad of [0, -1, Infinity, NaN, "12", {}]) expect(pendingItemInput("X", "jar", bad)).toBeNull();
  });
  it("the pending SKU count basis carries known ounces and preserves unknown ounces", () => {
    const measures = new Map([["count", { dimension: "count" as const, toBaseFactor: 1 }]]);
    const basis = { unitsPerPack: 1, eachSize: 1, eachMeasure: "count", avgOzPerEach: 12 };
    expect(skuContentOz(basis, measures)).toBe(12);
    expect(skuContentOz({ ...basis, avgOzPerEach: null }, measures)).toBeNull();
  });
});

describe("store writer authority before database access", () => {
  const cases = [
    { name: "store", minRole: "key_holder" as const, below: "employee" as const,
      run: (a: AuthContext, locationId: string) => createStore(a, { locationId, name: "Market" }) },
    { name: "store SKU", minRole: "key_holder" as const, below: "employee" as const,
      run: (a: AuthContext, locationId: string) => createStoreItem(a, { locationId, storeId: STORE, referenceSkuId: REF }) },
    { name: "pending SKU", minRole: "key_holder" as const, below: "employee" as const,
      run: (a: AuthContext, locationId: string) => createStoreItem(a, { locationId, storeId: STORE, name: "X", countUnit: "jar" }) },
    { name: "GM resolution", minRole: "gm" as const, below: "agm" as const,
      run: (a: AuthContext, locationId: string) => resolvePendingStoreItem(a, { locationId, skuId: SKU, referenceSkuId: REF }) },
  ];
  for (const c of cases) {
    it(`${c.name} refuses below-floor actors and other shops before RPC`, async () => {
      await expect(c.run(actor(c.below), SHOP)).rejects.toMatchObject({ status: 403 });
      await expect(c.run(actor(c.minRole), OTHER)).rejects.toMatchObject({ status: 404 });
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    });
  }
  it("reused stores do not emit a false creation audit", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: STORE, name: "Market", created: false }, error: null });
    expect(await createStore(actor("key_holder"), { locationId: SHOP, name: "market" })).toEqual({ store: { id: STORE, name: "Market", sourceKind: "store" }, regularVendorNameMatch: false });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("copies a reference only through the store-scoped transaction", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: SKU, created: true, product_id: REF }, error: null });
    expect(await createStoreItem(actor("key_holder"), { locationId: SHOP, storeId: STORE, referenceSkuId: REF })).toEqual({ skuId: SKU });
    expect(mocks.rpc).toHaveBeenCalledWith("receiving_create_store_item", expect.objectContaining({ p_store: STORE, p_location: SHOP, p_reference: REF }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "receiving.store_sku_create", resourceId: SKU }));
  });
  it("audits unknown-item creation and successful GM resolution", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { id: SKU, created: true, product_id: null }, error: null })
      .mockResolvedValueOnce({ data: { product_id: REF, reference_sku_id: REF, product_created: false, reference_attached: false }, error: null });
    await createStoreItem(actor("key_holder"), { locationId: SHOP, storeId: STORE, name: "X", countUnit: "jar", requestId: SKU });
    await resolvePendingStoreItem(actor("gm"), { locationId: SHOP, skuId: SKU, referenceSkuId: REF, contentOz: 12 });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "receiving.pending_create" }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "receiving.pending_resolve" }));
  });
  it("does not audit a transaction rejected by SQL", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "not_found" } });
    await expect(resolvePendingStoreItem(actor("gm"), { locationId: SHOP, skuId: SKU, referenceSkuId: REF, contentOz: 12 })).rejects.toMatchObject({ status: 404 });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("store migration contract (SQL execution remains a sim gate)", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0216_receiving_store_runs.sql", import.meta.url), "utf8");
  it("keeps RPCs inaccessible to staff PostgREST JWTs", () => {
    for (const name of ["receiving_create_store", "receiving_store_product", "receiving_create_store_item", "receiving_resolve_pending_item"]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]+from public, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^;]+to service_role;`));
    }
  });
  it("enforces case-insensitive store identity and leaves historical rows untouched", () => {
    expect(sql).toContain("vendors_store_name_uq on public.vendors (lower(btrim(name)))");
    expect(sql).not.toMatch(/(?:update|delete from) public\.(vendor_delivery_items|vendor_price_history)/i);
  });
});


describe("pending conversion and product governance", () => {
  it("requires a finite positive ounce basis", async () => {
    for (const bad of [undefined, null, 0, -1, NaN, Infinity, "12"]) {
      expect(resolutionContentOz(bad)).toBeNull();
      await expect(resolvePendingStoreItem(actor("gm"), { locationId: SHOP, skuId: SKU, referenceSkuId: REF, contentOz: bad })).rejects.toMatchObject({ code: "conversion_required" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(resolutionContentOz(128)).toBe(128);
  });
  it("writes the conversion and audits each product membership", async () => {
    mocks.rpc.mockResolvedValue({ data: { product_id: REF, product_created: true, reference_attached: true, reference_sku_id: REF }, error: null });
    await resolvePendingStoreItem(actor("gm"), { locationId: SHOP, skuId: SKU, referenceSkuId: REF, contentOz: 128 });
    expect(mocks.rpc).toHaveBeenCalledWith("receiving_resolve_pending_item", expect.objectContaining({ p_content_oz: 128 }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "product.create", resourceId: REF }));
    for (const id of [REF, SKU]) expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "product.member_attach", resourceId: id }));
  });
});
