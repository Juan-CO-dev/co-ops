/**
 * Catalog Phase 2b — the item page's server half: every gate holds before any write (the ROLE rule —
 * the social media manager refused — the shop allowance, the owner rule of a shop-owned SKU), the
 * parsers are strict, and every named refusal has its own en + es message.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";

let current: ReturnType<typeof createFakeDb> | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
import { applyPackChange, applyPriceChange, CatalogItemError, computePackPreview, computePricePreview, loadSkuItemView, setSkuPriceBasis } from "@/lib/catalog/sku-item";
import { CATALOG_ITEM_ERROR_CODES, itemClientKey, parseConversions, parseLevels, parseTarget } from "@/lib/catalog/sku-item-shared";
import { conversionKey } from "@/lib/catalog/change-preview-shared";
afterEach(() => { current = null; });

const A = "6f1d2c3e-0000-4000-8000-00000000000a";
const B = "6f1d2c3e-0000-4000-8000-00000000000b";
const actor = (role: RoleCode, level: number, locations: string[], id = "u1") =>
  ({ user: { id, role }, role, level, locations }) as unknown as AuthContext;
async function refused(p: Promise<unknown>) {
  try { await p; } catch (e) { if (e instanceof CatalogItemError) return { status: e.status, code: e.code }; throw e; }
  throw new Error("expected a refusal");
}
const LEVELS = [{ label: "case", containsQty: 1, containsIndex: null, containsMeasureUnit: "lb" }];
const apply = (a: AuthContext, over: Partial<Parameters<typeof applyPackChange>[1]> = {}) =>
  applyPackChange(a, { skuId: "s", target: { kind: "shop", shopId: A }, levels: LEVELS, conversions: [], requestId: null, previewToken: "t", ...over });
/** The gates passed and the call reached the database (none is installed): the exact I/O error. */
const reachedIo = (p: Promise<unknown>) => expect(p).rejects.toThrow("no fake db installed");

describe("reads: a catalog role, and only a shop you may act in (MoO+ every shop)", () => {
  it("a shift lead and the social media manager cannot open the page or preview — a ROLE check, not a level", async () => {
    expect(await refused(loadSkuItemView(actor("shift_lead", 5, [A]), "s", A, []))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(loadSkuItemView(actor("social_media_mgr", 6, [A]), "s", A, []))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(loadSkuItemView(actor("social_media_mgr", 6, [A]), "s", null, []))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(computePackPreview(actor("social_media_mgr", 6, [A]), "s", { kind: "shop", shopId: A }, LEVELS))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(computePricePreview(actor("social_media_mgr", 6, [A]), "s", { kind: "shop", shopId: A }, 10, "2026-10-15"))).toEqual({ status: 403, code: "forbidden" });
  });
  it("the operational level-6 managers pass the role rule (they reach the database)", async () => {
    for (const role of ["agm", "prep_mgr", "catering_mgr"] as const) await reachedIo(loadSkuItemView(actor(role, 6, [A]), "s", A, []));
  });
  it("a GM cannot open or preview another shop; an unassigned MoO can (D2)", async () => {
    expect(await refused(loadSkuItemView(actor("gm", 7, [A]), "s", B, []))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(computePackPreview(actor("gm", 7, [A]), "s", { kind: "shop", shopId: B }, LEVELS))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(computePricePreview(actor("agm", 6, [A]), "s", { kind: "shop", shopId: B }, 10, "2026-10-15"))).toEqual({ status: 404, code: "not_found" });
    await reachedIo(computePackPreview(actor("moo", 8, []), "s", { kind: "shop", shopId: B }, LEVELS));
  });
  it("an AGM cannot preview a GLOBAL pack change (it would show every shop; the save is MoO+ or a GM's first chain)", async () => {
    expect(await refused(computePackPreview(actor("agm", 6, [A]), "s", { kind: "global" }, LEVELS))).toEqual({ status: 403, code: "global_requires_moo" });
  });
  it("a preview of an empty chain or a bad price is refused by name", async () => {
    expect(await refused(computePackPreview(actor("gm", 7, [A]), "s", { kind: "shop", shopId: A }, []))).toEqual({ status: 400, code: "empty_chain" });
    expect(await refused(computePricePreview(actor("gm", 7, [A]), "s", { kind: "shop", shopId: A }, -1, "2026-10-15"))).toEqual({ status: 400, code: "invalid_price" });
    expect(await refused(computePricePreview(actor("gm", 7, [A]), "s", { kind: "shop", shopId: A }, 10, "Oct 15"))).toEqual({ status: 400, code: "invalid_date" });
  });
});

describe("a SHOP-OWNED SKU has no other shop (0259's owner rule)", () => {
  const owned = (owner: string) => ({
    vendor_items: [{ id: "s", name: "Store ham", location_id: owner, active: true, price_basis: null, weekday_par: null, weekend_par: null }],
    sku_pack_versions: [] as Array<Record<string, unknown>>,
    vendor_price_history: [] as Array<Record<string, unknown>>,
  });
  it("another shop cannot see, preview or price it — refused by its own name", async () => {
    current = createFakeDb(owned(B));
    const gm = actor("gm", 7, [A, B]);
    expect(await refused(loadSkuItemView(gm, "s", A, []))).toEqual({ status: 409, code: "sku_owned_by_other_shop" });
    expect(await refused(computePackPreview(gm, "s", { kind: "shop", shopId: A }, LEVELS))).toEqual({ status: 409, code: "sku_owned_by_other_shop" });
    expect(await refused(computePricePreview(gm, "s", { kind: "shop", shopId: A }, 10, "2026-10-15"))).toEqual({ status: 409, code: "sku_owned_by_other_shop" });
  });
  it("below MoO, its GLOBAL value is reached only by the owning shop's people", async () => {
    current = createFakeDb(owned(B));
    expect(await refused(computePricePreview(actor("agm", 6, [A]), "s", { kind: "global" }, 10, "2026-10-15"))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(computePackPreview(actor("gm", 7, [A]), "s", { kind: "global" }, LEVELS))).toEqual({ status: 404, code: "not_found" });
  });
  it("its price basis is the owner's: a GM elsewhere is refused; the owner's GM sets it the first time", async () => {
    current = createFakeDb({ ...owned(B), audit_log: [] });
    expect(await refused(setSkuPriceBasis(actor("gm", 7, [A]), "s", "per_case"))).toEqual({ status: 404, code: "not_found" });
    await setSkuPriceBasis(actor("gm", 7, [B]), "s", "per_case");
    expect(current.writes.find((w) => w.table === "vendor_items")!.rows).toEqual([expect.objectContaining({ id: "s", price_basis: "per_case" })]);
    expect(current.writes.filter((w) => w.table === "audit_log").flatMap((w) => w.rows.map((r) => r.action))).toEqual(["sku.price_basis_set"]);
  });
});

describe("the atomic apply refuses before any I/O", () => {
  it("the social media manager, another shop (2a's gate with the role), an AGM converting a par, a GM converting another shop's par", async () => {
    expect(await refused(apply(actor("social_media_mgr", 6, [A])))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(apply(actor("gm", 7, [A]), { target: { kind: "shop", shopId: B } }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(apply(actor("agm", 6, [A]), { target: { kind: "global" } }))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(apply(actor("agm", 6, [A]), { conversions: [{ locationId: A, slot: "weekday", expected: 3, to: 2 }] }))).toEqual({ status: 403, code: "par_forbidden" });
    expect(await refused(apply(actor("gm", 7, [A]), { conversions: [{ locationId: B, slot: "weekday", expected: 3, to: 2 }] }))).toEqual({ status: 404, code: "not_found" });
    expect(await refused(applyPriceChange(actor("social_media_mgr", 6, [A]), { skuId: "s", target: { kind: "shop", shopId: A }, unitPrice: 10, effectiveDate: "2026-10-15", previewToken: "t" }))).toEqual({ status: 403, code: "forbidden" });
  });
  it("an UNASSIGNED MoO passes every gate for shop B (D2): the call reaches the database", async () => {
    await reachedIo(apply(actor("moo", 8, []), { target: { kind: "shop", shopId: B }, conversions: [{ locationId: B, slot: "weekday", expected: 3, to: 2 }] }));
  });
  it("price basis: GM+ only (the social media manager never), and only a known basis", async () => {
    expect(await refused(setSkuPriceBasis(actor("agm", 6, [A]), "s", "per_case"))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(setSkuPriceBasis(actor("social_media_mgr", 6, [A]), "s", "per_case"))).toEqual({ status: 403, code: "forbidden" });
    expect(await refused(setSkuPriceBasis(actor("moo", 8, [A]), "s", "per_gallon" as never))).toEqual({ status: 400, code: "invalid_basis" });
  });
  it("a GM may set an unset basis but never change a set one; MoO changes it", async () => {
    current = createFakeDb({ vendor_items: [{ id: "s", price_basis: "per_lb", location_id: null }], audit_log: [] });
    expect(await refused(setSkuPriceBasis(actor("gm", 7, [A]), "s", "per_case"))).toEqual({ status: 403, code: "global_requires_moo" });
    await setSkuPriceBasis(actor("moo", 8, []), "s", "per_case");
    expect(current.writes.find((w) => w.table === "vendor_items")!.rows).toEqual([expect.objectContaining({ price_basis: "per_case" })]);
  });
});

describe("the routes' explicit field lists", () => {
  it("parseLevels accepts the writer's shape and refuses anything else", () => {
    expect(parseLevels([{ label: "case", containsQty: 4, containsIndex: 1 }, { label: "bag", containsQty: 5, containsMeasureUnit: "lb" }]))
      .toEqual([{ label: "case", containsQty: 4, containsIndex: 1, containsMeasureUnit: null }, { label: "bag", containsQty: 5, containsIndex: null, containsMeasureUnit: "lb" }]);
    expect(parseLevels("x")).toBeNull();
    expect(parseLevels([{ label: 3, containsQty: 1 }])).toBeNull();
    expect(parseLevels([{ label: "a", containsQty: 1, containsIndex: 0.5 }])).toBeNull();
    expect(parseLevels(new Array(9).fill({ label: "a", containsQty: 1, containsMeasureUnit: "oz" }))).toBeNull();
  });
  it("parseTarget: a uuid shop or global, nothing else", () => {
    expect(parseTarget({ kind: "global" })).toEqual({ kind: "global" });
    expect(parseTarget({ kind: "shop", shopId: A })).toEqual({ kind: "shop", shopId: A });
    expect(parseTarget({ kind: "shop", shopId: "x" })).toBeNull();
    expect(parseTarget({ kind: "everyone" })).toBeNull();
  });
  it("parseConversions: ≤ 8 rows of { locationId uuid|null, slot, expected ≥ 0, to ≥ 0 }, an own-par from the global or the auto par", () => {
    expect(parseConversions([{ locationId: null, slot: "weekday", expected: 3, to: 2 }])).toEqual([{ locationId: null, slot: "weekday", expected: 3, to: 2 }]);
    expect(parseConversions([{ locationId: A, slot: "weekend", expected: 3, to: -1 }])).toBeNull();
    expect(parseConversions([{ locationId: A, slot: "weekday", expected: 3, to: 2, inherited: true }])).toEqual([{ locationId: A, slot: "weekday", expected: 3, to: 2, inherited: true }]);
    expect(parseConversions([{ locationId: A, slot: "weekday", expected: 6, to: 3, inherited: true, from: "auto" }])).toEqual([{ locationId: A, slot: "weekday", expected: 6, to: 3, inherited: true, from: "auto" }]);
    expect(parseConversions([{ locationId: A, slot: "weekday", expected: 6, to: 3, from: "auto" }])).toBeNull();
    expect(parseConversions([{ locationId: A, slot: "weekday", expected: 6, to: 3, inherited: true, from: "human" }])).toBeNull();
    expect(parseConversions([{ locationId: null, slot: "weekday", expected: 3, to: 2, inherited: true }])).toBeNull();
    expect(parseConversions([{ locationId: "x", slot: "weekday", expected: 3, to: 2 }])).toBeNull();
    expect(parseConversions(undefined)).toEqual([]);
  });
  it("conversionKey and itemClientKey are stable identities", () => {
    expect(conversionKey({ locationId: null, slot: "weekday", expected: 3, to: 2 })).toBe("global|weekday|3|2");
    expect(conversionKey({ locationId: A, slot: "weekday", expected: 3, to: 2, inherited: true })).toBe(`${A}|weekday|3|2|inherited`);
    expect(conversionKey({ locationId: A, slot: "weekday", expected: 3, to: 2, inherited: true, from: "auto" })).toBe(`${A}|weekday|3|2|inherited:auto`);
    expect(itemClientKey("s", A)).not.toBe(itemClientKey("s", B));
    expect(itemClientKey("s", null)).toBe("s:global");
  });
});

describe("every named refusal maps to its OWN en + es message, never the generic one", () => {
  const E = en as Record<string, string>;
  const S = es as Record<string, string>;
  it("each code in the closed list has both languages, and none reads like the generic text", () => {
    for (const code of CATALOG_ITEM_ERROR_CODES) {
      expect(E[`catalog.error.${code}`], `en ${code}`).toBeTruthy();
      expect(S[`catalog.error.${code}`], `es ${code}`).toBeTruthy();
      expect(E[`catalog.error.${code}`]).not.toBe(E["catalog.error.generic"]);
    }
    expect(E["catalog.error.sku_owned_by_other_shop"]).toMatch(/another shop/);
    expect(E["admin.skus.error.sku_owned_by_other_shop"]).toBeTruthy();
    expect(S["admin.skus.error.sku_owned_by_other_shop"]).toBeTruthy();
  });
  it("the list covers every code the server half, the 2a/0261 RPC map and the dismiss can raise", () => {
    const src = ["lib/catalog/sku-item.ts", "lib/pack-change-requests.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
    const thrown = [...src.matchAll(/(?:CatalogItemError|PackChangeRequestError)\(\d{3}, "([a-z_]+)"/g)].map((m) => m[1]!)
      // door-only codes (filing is the receiving door's surface — its messages ship with the door sheet)
      .filter((c) => !["delivery_not_found", "photo_not_found"].includes(c));
    const rpc = readFileSync("lib/admin/sku-versions.ts", "utf8");
    const rpcMap = rpc.slice(rpc.indexOf("const status: Record<string, number> = {"), rpc.indexOf("if (code && status[code])"));
    const rpcCodes = [...rpcMap.matchAll(/([a-z_]+): \d{3}/g)].map((m) => m[1]!);
    const list = new Set<string>(CATALOG_ITEM_ERROR_CODES);
    for (const c of [...thrown, ...rpcCodes, "step_up_required", "step_up_stale"]) expect(list, c).toContain(c);
  });
});
