/**
 * Catalog Phase 2a — the write gates hold INSIDE the lib, before any I/O (spec §2, §8: the lib bind
 * holds even when the route is bypassed). vitest has no Supabase env, so a call that got PAST the
 * gates fails on the service client with a plain Error — which is how the MoO case proves it passed.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { loadSkuPackVersionHistory, restoreSkuPackVersion, retireShopPackVersion, retireShopPriceLane, saveSkuPackVersion, saveSkuPrice, SkuVersionError } from "@/lib/admin/sku-versions";
import { AdminCostError, recordSkuPrice } from "@/lib/admin/cost";

let current: ReturnType<typeof createFakeDb> | null = null;
/** Every RPC a passed write made: the proof it got PAST the gates (chunk-4 review P3e). */
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const RPC_RESULTS: Record<string, unknown> = {
  save_sku_pack_version: { version_id: "v-new", retired_version_id: null, mirror_synced: null },
  save_sku_shop_price: { price_id: "p-new", lane_id: "lane-new", lane_created: true },
  save_sku_global_price: { price_id: "p-new" },
};
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed"); // "fails for want of a database"
  return {
    ...current.client,
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return { data: RPC_RESULTS[fn] ?? null, error: null }; },
  };
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
afterEach(() => { current = null; rpcCalls.length = 0; });
/** A database where every gate can be passed: shared SKU "s", shop-A SKU "s-a", shop-B SKU "s-b", the measures the chain uses. */
const passableDb = () => createFakeDb({
  vendor_items: [
    { id: "s", location_id: null, avg_oz_per_each: null, sku_class: "raw", active: true },
    { id: "s-shared", location_id: null, avg_oz_per_each: null, sku_class: "raw", active: true },
    { id: "s-a", location_id: SHOP_A, avg_oz_per_each: null, sku_class: "raw", active: true },
    { id: "s-b", location_id: SHOP_B, avg_oz_per_each: null, sku_class: "raw", active: true },
  ],
  measure_units: [
    { label: "lb", dimension: "weight", to_base_factor: 16, active: true },
    { label: "oz", dimension: "weight", to_base_factor: 1, active: true },
  ],
  sku_pack_versions: [
    { id: "v-g", sku_id: "s", location_id: null, active: false },
    { id: "v-a", sku_id: "s", location_id: SHOP_A, active: false },
    { id: "v-b", sku_id: "s", location_id: SHOP_B, active: false },
  ],
  sku_pack_levels: [],
});
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
  it("an UNASSIGNED MoO passes the gate for shop B — and the write goes through", async () => {
    current = passableDb();
    const r = await saveSkuPackVersion(actor("moo", 8, []), { skuId: "s", scope: SHOP_B, levels: LEVELS, expectedLiveVersionId: null });
    expect(r.versionId).toBe("v-new");
    expect(rpcCalls).toEqual([expect.objectContaining({ fn: "save_sku_pack_version", args: expect.objectContaining({ p_sku: "s", p_location: SHOP_B, p_first_only: false }) })]);
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
    expect(await refused(retireShopPackVersion(actor("gm", 7, [SHOP_A]), { skuId: "s", versionId: "v", locationId: SHOP_B }))).toEqual({ status: 404, code: "not_found" });
  });
  it("a GLOBAL first value binds the SKU's OWNING shop (Astra 2a r3#1): a shop-B SKU refuses an AGM/GM of A, for price AND pack", async () => {
    current = createFakeDb({ vendor_items: [{ id: "s-b", location_id: SHOP_B, avg_oz_per_each: null, sku_class: "raw", active: true }] });
    expect(await refused(saveSkuPrice(actor("agm", 6, [SHOP_A]), { skuId: "s-b", scope: null, unitPrice: 10, effectiveDate: "2026-10-15" }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(saveSkuPackVersion(actor("gm", 7, [SHOP_A]), { skuId: "s-b", scope: null, levels: LEVELS, expectedLiveVersionId: null }))).toEqual({ status: 404, code: "not_found" });
  });
  it("a shared SKU, or one owned by the actor's own shop, passes the owner bind — the first-value write goes through", async () => {
    current = passableDb();
    for (const skuId of ["s-shared", "s-a"]) {
      const r = await saveSkuPrice(actor("agm", 6, [SHOP_A]), { skuId, scope: null, unitPrice: 10, effectiveDate: "2026-10-15" });
      expect(r).toEqual({ priceId: "p-new", laneId: null, laneCreated: false });
    }
    expect(rpcCalls.map((c) => [c.fn, c.args.p_sku, c.args.p_first_only])).toEqual([
      ["save_sku_global_price", "s-shared", true], ["save_sku_global_price", "s-a", true],
    ]);
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
    expect(await refused(retireShopPackVersion(smm, { skuId: "s", versionId: "v", locationId: SHOP_A }))).toEqual({ status: 403, code: "forbidden" });
  });
  it("a prep manager and a catering manager (level 6) pass the gate at their own shop — the write goes through", async () => {
    current = passableDb();
    for (const role of ["prep_mgr", "catering_mgr"] as const) {
      const r = await saveSkuPrice(actor(role, 6, [SHOP_A]), { skuId: "s", scope: SHOP_A, unitPrice: 10, effectiveDate: "2026-10-15" });
      expect(r).toEqual({ priceId: "p-new", laneId: "lane-new", laneCreated: true });
    }
    expect(rpcCalls.map((c) => [c.fn, c.args.p_location])).toEqual([["save_sku_shop_price", SHOP_A], ["save_sku_shop_price", SHOP_A]]);
  });
  it("the social media manager is refused the version history read and Record price too (before any I/O)", async () => {
    const smm = actor("social_media_mgr", 6, [SHOP_A]);
    expect(await refused(loadSkuPackVersionHistory(smm, "s", SHOP_A))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(loadSkuPackVersionHistory(smm, "s", null))).toEqual({ status: 403, code: "forbidden" });
    await expect(recordSkuPrice(smm, { skuId: "s", unitPrice: 10, effectiveDate: "2026-10-15" })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(recordSkuPrice(smm, { skuId: "s", unitPrice: 10, effectiveDate: "2026-10-15" })).rejects.toBeInstanceOf(AdminCostError);
    expect(rpcCalls).toEqual([]);
  });
});

describe("chunk-4 review: shop-owned SKUs and Restore stay inside their scope", () => {
  it("P3b: a shop-scope pack or price write on a SKU OWNED by another shop is refused by name (MoO included)", async () => {
    current = passableDb();
    expect(await refused(saveSkuPackVersion(actor("moo", 8, []), { skuId: "s-b", scope: SHOP_A, levels: LEVELS, expectedLiveVersionId: null }))).toEqual({ status: 409, code: "sku_owned_by_other_shop" });
    expect(await refused(saveSkuPrice(actor("moo", 8, []), { skuId: "s-b", scope: SHOP_A, unitPrice: 10, effectiveDate: "2026-10-15" }))).toEqual({ status: 409, code: "sku_owned_by_other_shop" });
    // …while the owning shop writes its own SKU
    expect((await saveSkuPrice(actor("gm", 7, [SHOP_B]), { skuId: "s-b", scope: SHOP_B, unitPrice: 10, effectiveDate: "2026-10-15" })).laneId).toBe("lane-new");
    expect(rpcCalls.map((c) => c.fn)).toEqual(["save_sku_shop_price"]);
  });
  it("P3a: Restore takes only THIS SKU's version, global or this scope's own — never another shop's", async () => {
    current = passableDb();
    const gm = actor("gm", 7, [SHOP_A]);
    expect(await refused(restoreSkuPackVersion(gm, { skuId: "s", scope: SHOP_A, fromVersionId: "v-b", expectedLiveVersionId: null }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(restoreSkuPackVersion(gm, { skuId: "s-a", scope: SHOP_A, fromVersionId: "v-a", expectedLiveVersionId: null }))).toEqual({ status: 404, code: "not_found" }); // another SKU's version
    expect(await refused(restoreSkuPackVersion(gm, { skuId: "s", scope: SHOP_A, fromVersionId: "v-missing", expectedLiveVersionId: null }))).toEqual({ status: 404, code: "not_found" });
    // its own shop's and the global one pass the scope check (then find no levels in this empty fixture)
    expect(await refused(restoreSkuPackVersion(gm, { skuId: "s", scope: SHOP_A, fromVersionId: "v-a", expectedLiveVersionId: null }))).toEqual({ status: 404, code: "not_found" });
    expect(rpcCalls).toEqual([]);
  });
  it("P3a: a restore of an allowed version DOES go through when its levels exist", async () => {
    current = createFakeDb({
      vendor_items: [{ id: "s", location_id: null, avg_oz_per_each: null, sku_class: "raw", active: true }],
      measure_units: [{ label: "lb", dimension: "weight", to_base_factor: 16, active: true }],
      sku_pack_versions: [{ id: "v-g", sku_id: "s", location_id: null, active: false }],
      sku_pack_levels: [{ id: "l-1", sku_id: "s", version_id: "v-g", label: "case", contains_qty: 12, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 0 }],
    });
    const r = await restoreSkuPackVersion(actor("gm", 7, [SHOP_A]), { skuId: "s", scope: SHOP_A, fromVersionId: "v-g", expectedLiveVersionId: null });
    expect(r.versionId).toBe("v-new");
    expect(rpcCalls[0]).toMatchObject({ fn: "save_sku_pack_version", args: { p_sku: "s", p_location: SHOP_A, p_based_on: "v-g" } });
  });
});

describe("chunk-4 P2/P3b: the new RPC refusals reach the caller by name", () => {
  it("flat_pack_exists is 403, sku_owned_by_other_shop 409; an unknown failure stays a plain Error (500)", async () => {
    const { versionErrorFromRpc } = await import("@/lib/admin/sku-versions");
    const as = (m: string) => { try { versionErrorFromRpc(m); } catch (e) { return e; } return null; };
    expect(as("ERROR: sku_pack_version:flat_pack_exists")).toMatchObject({ status: 403, code: "flat_pack_exists" });
    expect(as("ERROR: sku_pack_version:sku_owned_by_other_shop")).toMatchObject({ status: 409, code: "sku_owned_by_other_shop" });
    expect(as("ERROR: sku_price:sku_owned_by_other_shop")).toMatchObject({ status: 409, code: "sku_owned_by_other_shop" });
    expect(as("ERROR: sku_pack_version:cycle")).toMatchObject({ status: 400, code: "cycle" });
    expect(as("connection reset")).not.toBeInstanceOf(SkuVersionError);
  });
});

describe("Astra full-branch r1 P3: back to default retires only a version of the SKU the route names", () => {
  it("a version of ANOTHER SKU (same shop) is refused by name, before the RPC", async () => {
    current = createFakeDb({ sku_pack_versions: [{ id: "v-other", sku_id: "s-other", location_id: SHOP_A, active: true }] });
    expect(await refused(retireShopPackVersion(actor("gm", 7, [SHOP_A]), { skuId: "s", versionId: "v-other", locationId: SHOP_A })))
      .toEqual({ status: 409, code: "version_sku_mismatch" });
    expect(rpcCalls).toEqual([]);
  });
  it("this SKU's own shop version retires (the RPC runs, for exactly that version)", async () => {
    current = createFakeDb({ sku_pack_versions: [{ id: "v-mine", sku_id: "s", location_id: SHOP_A, active: true }] });
    await retireShopPackVersion(actor("gm", 7, [SHOP_A]), { skuId: "s", versionId: "v-mine", locationId: SHOP_A });
    expect(rpcCalls).toEqual([{ fn: "retire_sku_pack_version", args: { p_version: "v-mine", p_actor: "u1" } }]);
  });
  it("the route passes the SKU it addresses", () => {
    const src = readFileSync("app/api/admin/catalog/sku/[id]/pack/back-to-default/route.ts", "utf8");
    expect(src).toContain("retireShopPackVersion(ctx, { skuId: id, versionId: b.versionId, locationId: b.locationId })");
  });
});
