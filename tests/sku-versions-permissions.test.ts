/**
 * Catalog Phase 2a — the write gates hold INSIDE the lib, before any I/O (spec §2, §8: the lib bind
 * holds even when the route is bypassed). vitest has no Supabase env, so a call that got PAST the
 * gates fails on the service client with a plain Error — which is how the MoO case proves it passed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { retireShopPackVersion, retireShopPriceLane, saveSkuPackVersion, saveSkuPrice, SkuVersionError } from "@/lib/admin/sku-versions";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed"); // "fails for want of a database"
  return current.client;
} }));
afterEach(() => { current = null; });
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";

const SHOP_A = "6f1d2c3e-0000-4000-8000-00000000000a";
const SHOP_B = "6f1d2c3e-0000-4000-8000-00000000000b";
const LEVELS = [{ label: "case", containsQty: 4, containsIndex: 1, containsMeasureUnit: null }, { label: "bag", containsQty: 10, containsIndex: null, containsMeasureUnit: "lb" }];
const actor = (role: RoleCode, level: number, locations: string[]): AuthContext =>
  ({ user: { id: "u1", role }, role, level, locations }) as unknown as AuthContext;

async function refused(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try { await p; } catch (e) {
    if (e instanceof SkuVersionError) return { status: e.status, code: e.code };
    throw e;
  }
  throw new Error("expected a refusal");
}

describe("AGM/GM write only their own shop's version; MoO+ any shop (D2)", () => {
  it("a GM at shop A cannot write shop B's pack version (404, before I/O)", async () => {
    expect(await refused(saveSkuPackVersion(actor("gm", 7, [SHOP_A]), { skuId: "s", scope: SHOP_B, levels: LEVELS, expectedLiveVersionId: null }))).toEqual({ status: 404, code: "not_found" });
  });
  it("an UNASSIGNED MoO passes the gate for shop B (fails later only for want of a database)", async () => {
    const p = saveSkuPackVersion(actor("moo", 8, []), { skuId: "s", scope: SHOP_B, levels: LEVELS, expectedLiveVersionId: null });
    await expect(p).rejects.toThrow();
    await expect(p).rejects.not.toBeInstanceOf(SkuVersionError);
  });
  it("an AGM at shop A cannot write shop B's price or retire shop B's lane", async () => {
    expect(await refused(saveSkuPrice(actor("agm", 6, [SHOP_A]), { skuId: "s", scope: SHOP_B, unitPrice: 10, effectiveDate: "2026-10-15" }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(retireShopPriceLane(actor("agm", 6, [SHOP_A]), { skuId: "s", locationId: SHOP_B }))).toEqual({ status: 404, code: "not_found" });
  });
  it("a shift lead (5) cannot write any version; an AGM cannot write the global pack at all", async () => {
    expect(await refused(saveSkuPackVersion(actor("shift_lead", 5, [SHOP_A]), { skuId: "s", scope: SHOP_A, levels: LEVELS, expectedLiveVersionId: null }))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(saveSkuPackVersion(actor("agm", 6, [SHOP_A]), { skuId: "s", scope: null, levels: LEVELS, expectedLiveVersionId: null }))).toEqual({ status: 403, code: "forbidden" });
  });
  it("back to default: a GM may not retire another shop's version", async () => {
    expect(await refused(retireShopPackVersion(actor("gm", 7, [SHOP_A]), { versionId: "v", locationId: SHOP_B }))).toEqual({ status: 404, code: "not_found" });
  });
  it("a GLOBAL first value binds the SKU's OWNING shop (Astra 2a r3#1): a shop-B SKU refuses an AGM/GM of A, for price AND pack", async () => {
    current = createFakeDb({ vendor_items: [{ id: "s-b", location_id: SHOP_B, avg_oz_per_each: null, sku_class: "raw", active: true }] });
    expect(await refused(saveSkuPrice(actor("agm", 6, [SHOP_A]), { skuId: "s-b", scope: null, unitPrice: 10, effectiveDate: "2026-10-15" }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(saveSkuPackVersion(actor("gm", 7, [SHOP_A]), { skuId: "s-b", scope: null, levels: LEVELS, expectedLiveVersionId: null }))).toEqual({ status: 404, code: "not_found" });
  });
  it("a shared SKU, or one owned by the actor's own shop, passes the owner bind (it reaches the RPC)", async () => {
    current = createFakeDb({ vendor_items: [
      { id: "s-shared", location_id: null, avg_oz_per_each: null, sku_class: "raw", active: true },
      { id: "s-a", location_id: SHOP_A, avg_oz_per_each: null, sku_class: "raw", active: true },
    ] });
    for (const skuId of ["s-shared", "s-a"]) {
      const p = saveSkuPrice(actor("agm", 6, [SHOP_A]), { skuId, scope: null, unitPrice: 10, effectiveDate: "2026-10-15" });
      await expect(p).rejects.not.toBeInstanceOf(SkuVersionError); // the fake db has no rpc(): every gate passed
    }
  });
  it("payload refusals come after the bind: an in-scope actor with an empty chain or a bad price gets the validation error", async () => {
    expect(await refused(saveSkuPackVersion(actor("gm", 7, [SHOP_A]), { skuId: "s", scope: SHOP_A, levels: [], expectedLiveVersionId: null }))).toEqual({ status: 400, code: "empty_chain" });
    expect(await refused(saveSkuPrice(actor("gm", 7, [SHOP_A]), { skuId: "s", scope: SHOP_A, unitPrice: -1, effectiveDate: "2026-10-15" }))).toEqual({ status: 400, code: "invalid_price" });
  });
});

describe("level 6 is the operational managers only (lead decision, chunk-1 review)", () => {
  it("a social media manager (level 6) is refused every catalog write at their own shop, before I/O", async () => {
    const smm = actor("social_media_mgr", 6, [SHOP_A]);
    expect(await refused(saveSkuPackVersion(smm, { skuId: "s", scope: SHOP_A, levels: LEVELS, expectedLiveVersionId: null }))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(saveSkuPrice(smm, { skuId: "s", scope: SHOP_A, unitPrice: 10, effectiveDate: "2026-10-15" }))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(saveSkuPrice(smm, { skuId: "s", scope: null, unitPrice: 10, effectiveDate: "2026-10-15" }))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(retireShopPriceLane(smm, { skuId: "s", locationId: SHOP_A }))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(retireShopPackVersion(smm, { versionId: "v", locationId: SHOP_A }))).toEqual({ status: 403, code: "forbidden" });
  });
  it("a prep manager and a catering manager (level 6) pass the gate at their own shop", async () => {
    for (const role of ["prep_mgr", "catering_mgr"] as const) {
      const p = saveSkuPrice(actor(role, 6, [SHOP_A]), { skuId: "s", scope: SHOP_A, unitPrice: 10, effectiveDate: "2026-10-15" });
      await expect(p).rejects.not.toBeInstanceOf(SkuVersionError); // no database: every gate passed
    }
  });
});
