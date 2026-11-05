import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import type { AuthContext } from "@/lib/session";
import { getRoleLevel, type RoleCode } from "@/lib/roles";
import { EMPTY_PAR_SILENCE, type WalkerParSuggestion } from "@/lib/dynamic-pars-shared";
import type { LocationSkuOverlay } from "@/lib/location-sku-shared";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import { canViewPars, filterPars, parSectionKey, parSlots } from "@/lib/admin/pars-shared";
import { adminSectionsFor } from "@/lib/admin/sections";

const h = vi.hoisted(() => ({ db: vi.fn(), walk: vi.fn(), packs: vi.fn(), measures: vi.fn(), products: vi.fn(), guides: vi.fn(), task: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
vi.mock("@/lib/ordering", () => ({ loadWalkerData: h.walk, loadPackAwareOverlay: h.packs,
  OrderingError: class extends Error { constructor(public status: number, public code: string) { super(code); } } }));
vi.mock("@/lib/prep-consumption", () => ({ loadMeasures: h.measures }));
vi.mock("@/lib/products", () => ({ loadProductIndex: h.products }));
vi.mock("@/lib/order-guides", () => ({ guideKeysFor: h.guides }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: h.task }));
import { loadPars } from "@/lib/admin/pars";

const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const FOREIGN_SHOP = "6f1d2c3e-0000-4000-8000-00000000000b";
const actor = (role: RoleCode = "agm", level = getRoleLevel(role)) => ({ user: { role, language: "en" }, role, level, locations: [SHOP] }) as AuthContext;
const sku = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, vendor_id: "v", location_id: null, active: true, product_id: null,
  weekday_par: 3, weekend_par: null, pack_format: "case", each_container_label: "bag", units_per_pack: 3, each_size: 10, each_measure: "lb", avg_oz_per_each: null, ...extra });
let db: ReturnType<typeof createFakeDb>;
let tables: Tables;
let overlays: Map<string, LocationSkuOverlay & { activeOverride: boolean | null }>;
let chains: Map<string, PackChainLevel[]>;
const suggestion: WalkerParSuggestion = { currentPar: 3, suggestedPar: 4, generationId: "fixture-generation", tier: "suggestion", reasonCode: "ok",
  coverThroughDate: "2026-11-05", coveredDayCount: 3, cushionPct: 0.2, flooredByPeak: false, velocityApplied: false, slotCreation: false, canAct: true };
beforeEach(() => {
  vi.clearAllMocks();
  tables = { vendor_items: [sku("a")], vendors: [{ id: "v", name: "Vendor", active: true, source_kind: "vendor" }] };
  db = createFakeDb(tables); h.db.mockReturnValue(db.client);
  overlays = new Map(); chains = new Map();
  h.packs.mockImplementation(async () => ({ overlayBySku: overlays, chainsBySku: chains, epochs: new Map() }));
  h.task.mockResolvedValue(true);
  h.walk.mockResolvedValue({ vendors: [], parSilence: EMPTY_PAR_SILENCE });
  h.measures.mockResolvedValue(new Map([["lb", { dimension: "weight", toBaseFactor: 16 }]]));
  h.products.mockResolvedValue({ byProduct: new Map() });
  h.guides.mockResolvedValue(new Map());
});

describe("Pars authorization", () => {
  it.each(["social_media_mgr", "key_holder", "shift_lead", "employee"] as RoleCode[])("refuses %s before any I/O even with inflated level", async (role) => {
    await expect(loadPars(actor(role, 10), SHOP)).rejects.toMatchObject({ status: 403 });
    expect(h.task).not.toHaveBeenCalled(); expect(h.db).not.toHaveBeenCalled(); expect(h.walk).not.toHaveBeenCalled();
    expect(canViewPars(role)).toBe(false);
    expect(adminSectionsFor(10, role).some((s) => s.id === "pars")).toBe(false);
  });
  it.each(["agm", "prep_mgr", "catering_mgr", "gm", "moo", "owner", "cgs"] as RoleCode[])("admits %s and shows a live hub card", async (role) => {
    await expect(loadPars(actor(role), SHOP)).resolves.toHaveProperty("rows");
    expect(adminSectionsFor(getRoleLevel(role), role).find((s) => s.id === "pars")).toMatchObject({ minLevel: 6 });
    expect(adminSectionsFor(getRoleLevel(role), role).find((s) => s.id === "pars")?.comingSoon).not.toBe(true);
  });
  it.each(["agm", "prep_mgr", "catering_mgr", "gm", "moo"] as RoleCode[])("binds %s to membership before I/O", async (role) => {
    await expect(loadPars(actor(role), FOREIGN_SHOP)).rejects.toMatchObject({ status: 404 });
    expect(h.db).not.toHaveBeenCalled(); expect(h.task).not.toHaveBeenCalled();
  });
  it("admits a level-9 owner at a foreign shop", async () => {
    await expect(loadPars(actor("owner", 9), FOREIGN_SHOP)).resolves.toHaveProperty("rows");
    expect(h.task).toHaveBeenCalledWith(actor("owner", 9), FOREIGN_SHOP, "ordering");
    expect(h.walk).toHaveBeenCalledWith(actor("owner", 9), FOREIGN_SHOP);
  });
  it("honors the ordering task gate before loading data", async () => {
    h.task.mockResolvedValue(false);
    await expect(loadPars(actor(), SHOP)).rejects.toMatchObject({ status: 403 });
    expect(h.task).toHaveBeenCalledWith(actor(), SHOP, "ordering"); expect(h.db).not.toHaveBeenCalled();
  });
  it("refuses a malformed shop even for an all-shops role before I/O", async () => {
    await expect(loadPars(actor("owner"), "bad,location_id.not.is.null")).rejects.toMatchObject({ status: 404 });
    expect(h.task).not.toHaveBeenCalled(); expect(h.db).not.toHaveBeenCalled();
  });
  it("preserves the admin layout's unconditional level-6 floor (no pathname exemption)", () => {
    const src = readFileSync("app/admin/layout.tsx", "utf8");
    expect(src).toContain("const ADMIN_MIN_LEVEL = 6;");
    expect(src).toContain('if (auth.level < ADMIN_MIN_LEVEL) redirect("/dashboard")');
    expect(src).not.toContain('"/admin/pars"');
  });
});

describe("Pars read model", () => {
  it("gives GM raw human values and the current pack epoch while keeping AGM read-only", async () => {
    overlays.set("a", { activeOverride: true, weekdayPar: null, weekendPar: 5 });
    h.packs.mockResolvedValue({ overlayBySku: overlays, chainsBySku: chains, epochs: new Map([["a", 3]]) });
    h.walk.mockResolvedValue({ vendors: [{ skus: [{ skuId: "a", parSuggestion: suggestion }] }], parSilence: EMPTY_PAR_SILENCE });
    const writable = await loadPars(actor("gm"), SHOP);
    expect(writable.locationId).toBe(SHOP);
    expect(writable.rows[0]?.edit).toEqual({ activeOverride: true, weekdayPar: null, weekendPar: 5, packEpoch: 3, poundsPerUnit: 30 });
    expect(writable.rows[0]?.suggestion).toEqual(suggestion);
    expect((await loadPars(actor("agm"), SHOP)).rows[0]?.edit).toBeUndefined();
    h.walk.mockResolvedValue({ vendors: [{ skus: [{ skuId: "a", parSuggestion: { ...suggestion, canAct: false } }] }], parSilence: EMPTY_PAR_SILENCE });
    expect((await loadPars(actor("gm"), SHOP)).rows[0]?.suggestion?.canAct).toBe(false);
  });
  it("refreshes through the page's same loadPars and walk loaders, without an alternate row reader", () => {
    expect(readFileSync("components/admin/pars/ParEditor.tsx", "utf8")).toContain("router.refresh()");
    expect(readFileSync("app/admin/pars/page.tsx", "utf8")).toContain("await loadPars(auth, locationId)");
    const source = readFileSync("lib/admin/pars.ts", "utf8");
    expect(source).toContain("loadWalkerData(actor, locationId)");
    expect(source).toContain("loadPackAwareOverlay(sb, locationId, ids)");
  });
  it.each([false, true])("carries the walk day-class (weekend %s)", async (isWeekendPar) => {
    h.walk.mockResolvedValue({ isWeekendPar, vendors: [{ skus: [{ skuId: "a", parSuggestion: suggestion }] }], parSilence: EMPTY_PAR_SILENCE });
    const view = await loadPars(actor(), SHOP);
    expect(view.dayClass).toBe(isWeekendPar ? "weekend" : "weekday");
    expect(view.rows[0]?.suggestion?.suggestedPar).toBe(4);
  });
  it("uses the shared stamped pack loader once for the whole catalog, with current shop units and weight", async () => {
    chains.set("a", [{ id: "c", label: "crate", containsQty: 2, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 0 }]);
    const view = await loadPars(actor(), SHOP);
    expect(h.packs).toHaveBeenCalledExactlyOnceWith(db.client, SHOP, ["a"]);
    expect(h.measures).toHaveBeenCalledTimes(1);
    expect(view.rows[0]).toMatchObject({ unit: "crate", weekday: { value: 3, lane: "global", pounds: 6 }, weekendFallback: true });
    expect(db.writes).toEqual([]);
  });
  it("preserves human zero, valid auto, global fallback and absent pars", async () => {
    tables.vendor_items = [sku("human"), sku("auto"), sku("global"), sku("none", { weekday_par: null })];
    overlays.set("human", { weekdayPar: 0, weekendPar: 2, activeOverride: null });
    overlays.set("auto", { weekdayPar: null, weekendPar: null, activeOverride: null, autoWeekdayPar: 5, autoWeekdayBaselinePar: 3, autoWeekdayPackEpoch: 2, effectivePackEpoch: 2 });
    const rows = new Map((await loadPars(actor(), SHOP)).rows.map((r) => [r.skuId, r]));
    expect(rows.get("human")?.weekday).toEqual({ value: 0, lane: "human", pounds: 0 });
    expect(rows.get("auto")?.weekday).toEqual({ value: 5, lane: "auto", pounds: 150 });
    expect(rows.get("global")?.weekday).toEqual({ value: 3, lane: "global", pounds: 90 });
    expect(rows.get("none")?.weekday).toEqual({ value: null, lane: "none", pounds: null });
    expect(rows.get("none")?.weekendFallback).toBe(false);
  });
  it.each([1, 2])("never resurrects epoch-zero auto after a pack change/back to default (epoch %s)", async (epoch) => {
    overlays.set("a", { weekdayPar: null, weekendPar: null, activeOverride: null, autoWeekdayPar: 5, autoWeekdayBaselinePar: 3, autoWeekdayPackEpoch: 0, effectivePackEpoch: epoch });
    expect((await loadPars(actor(), SHOP)).rows[0]?.weekday).toMatchObject({ value: 3, lane: "global" });
  });
  it("never makes unknown weight zero, including a zero par", async () => {
    tables.vendor_items = [sku("a", { each_measure: "each", weekday_par: 0 })];
    expect((await loadPars(actor(), SHOP)).rows[0]?.weekday).toEqual({ value: 0, lane: "global", pounds: null });
  });
  it("scopes ownership and excludes store/down/missing vendors, off-here SKUs and retired products; honors on-here", async () => {
    tables.vendor_items = [sku("a"), sku("foreign", { location_id: "other" }), sku("mine", { location_id: SHOP }), sku("store", { vendor_id: "store" }),
      sku("down", { vendor_id: "down" }), sku("missing", { vendor_id: null }), sku("off"), sku("on", { active: false }), sku("retired", { product_id: "p" })];
    tables.vendors!.push({ id: "store", active: true, source_kind: "store" }, { id: "down", active: false, source_kind: "vendor" });
    overlays.set("off", { weekdayPar: null, weekendPar: null, activeOverride: false });
    overlays.set("on", { weekdayPar: null, weekendPar: null, activeOverride: true });
    h.products.mockResolvedValue({ byProduct: new Map([["p", { resolution: { reason: "retired_product" } }]]) });
    expect((await loadPars(actor(), SHOP)).rows.map((r) => r.skuId)).toEqual(["a", "mine", "off", "on"]);
  });
  it("takes suggestions ONLY from final walked rows (dedupe/backup eligibility), without actions; reuses aggregate unchanged", async () => {
    tables.vendor_items = [sku("a"), sku("twin"), sku("backup", { weekday_par: null }), sku("source", { active: false })];
    const silence = { ...EMPTY_PAR_SILENCE, suggestionsWaiting: 2 };
    h.walk.mockResolvedValue({ vendors: [{ skus: [{ skuId: "a", parSuggestion: suggestion }, { skuId: "backup", parSuggestion: suggestion, reroutedFromSkuId: "source" }] }], parSilence: silence });
    const view = await loadPars(actor(), SHOP);
    expect(h.walk).toHaveBeenCalledExactlyOnceWith(actor(), SHOP);
    expect(view.rows.find((r) => r.skuId === "twin")?.suggestion).toBeNull();
    expect(view.rows.find((r) => r.skuId === "a")?.suggestion).toEqual({ ...suggestion, canAct: false });
    expect(view.rows.find((r) => r.skuId === "backup")).toMatchObject({ weekday: { value: null }, suggestion: { suggestedPar: 4 }, reroutedFromName: "source" });
    expect(view.silence).toBe(silence);
  });
  it("orders by guide within vendor and filters without extra reads", async () => {
    tables.vendor_items = [sku("a"), sku("z"), sku("b")];
    h.guides.mockResolvedValue(new Map([["z", { position: 1, section: "First" }], ["b", { position: 2, section: "Second" }]]));
    const view = await loadPars(actor(), SHOP);
    expect(view.rows.map((r) => r.skuId)).toEqual(["z", "b", "a"]);
    expect(filterPars(view.rows, "v", parSectionKey({ vendorId: "v", section: "First" })).map((r) => r.skuId)).toEqual(["z"]);
    expect(filterPars(view.rows, "other", "")).toEqual([]);
    expect(db.log).toHaveLength(2); expect(h.guides).toHaveBeenCalledTimes(1);
  });
  it("keeps slot-creation suggestions aggregate-only, as on the walk", async () => {
    h.walk.mockResolvedValue({ vendors: [{ skus: [{ skuId: "a", parSuggestion: { ...suggestion, slotCreation: true } }] }], parSilence: EMPTY_PAR_SILENCE });
    expect((await loadPars(actor(), SHOP)).rows[0]?.suggestion).toBeNull();
  });
  it("pages beyond 1000 SKUs without per-row reads", async () => {
    tables.vendor_items = Array.from({ length: 1001 }, (_, i) => sku(`sku-${i}`));
    expect((await loadPars(actor(), SHOP)).rows).toHaveLength(1001);
    expect(db.log.filter((q) => q.table === "vendor_items")).toHaveLength(2);
    expect(h.packs).toHaveBeenCalledTimes(1); expect(h.guides).toHaveBeenCalledTimes(11);
    expect(h.guides.mock.calls.every(([ids]) => ids.length <= 100)).toBe(true);
  });
  it.each(["vendor_items", "vendors"])("surfaces %s failures rather than an empty success", async (table) => {
    delete tables[table];
    await expect(loadPars(actor(), SHOP)).rejects.toThrow(/loadPars/);
  });
  it.each(["packs", "walk", "measures", "products", "guides"] as const)("propagates %s failure", async (key) => {
    h[key].mockRejectedValueOnce(new Error("fixture read failed"));
    await expect(loadPars(actor(), SHOP)).rejects.toThrow("fixture read failed");
  });
  it("pins reuse of the walk pack reader and lane resolvers, and leaves the API at 501", () => {
    const loader = readFileSync("lib/admin/pars.ts", "utf8");
    const walk = readFileSync("lib/ordering.ts", "utf8");
    expect(loader).toContain("loadPackAwareOverlay(sb, locationId, ids)");
    expect(walk).toContain("loadPackAwareOverlay(sb, locationId, skuIds)");
    expect(readFileSync("app/api/admin/pars/route.ts", "utf8")).toContain("501");
    expect(parSlots(null, { weekdayPar: 3, weekendPar: null }, 480)).toMatchObject({ weekendFallback: true, weekend: { value: 3, pounds: 90 } });
  });
});

it("keeps off rows for viewers and pins their exclusion to the walk predicate", async () => {
  const { resolveActive, walkDisposition } = await import("@/lib/location-sku-shared");
  for (const activeOverride of [false, null, true]) {
    overlays.set("a", { weekdayPar: null, weekendPar: null, activeOverride });
    const row = (await loadPars(actor(), SHOP)).rows[0]!;
    expect(row.offHere).toBe(activeOverride === false);
    expect(walkDisposition({ productRetired: false, vendorKnown: true, skuActive: resolveActive(activeOverride, true), par: row.weekday.value }) === "skuInactive").toBe(row.offHere);
    expect(row.edit).toBeUndefined();
  }
});
