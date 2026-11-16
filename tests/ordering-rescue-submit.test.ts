/**
 * Audit W18/B026: the walk rescues a dropped par'd member P (its vendor is down) onto the
 * product's backup member B and shows B with P's par. Submitting that walk resolved B's OWN par,
 * found none, and refused the WHOLE walk `no_par`. The submission now asks the walk's own rescue
 * rule (lib/ordering-rescue-shared.ts), so the row the walk shows is the row it accepts.
 */
import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import type { AuthContext } from "@/lib/session";
import { EMPTY_PAR_SILENCE } from "@/lib/dynamic-pars-shared";

const h = vi.hoisted(() => ({ db: vi.fn(), productIndex: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: async () => true, auditOperationalTaskOverride: async () => {} }));
vi.mock("@/lib/prep-consumption", () => ({
  loadMeasures: async () => new Map(), loadResolvedRecipeInputs: async () => [],
  loadSkuPackResolution: async () => new Map(), loadShopPackEpochs: async () => new Map(), loadSkuPackChains: async () => new Map(),
}));
vi.mock("@/lib/counts", () => ({ loadOnHandDerived: async () => ({ rows: [], salesThrough: null }) }));
vi.mock("@/lib/toast/effective-depletion", () => ({ loadEffectiveSalesWindow: async () => ({ rows: [], coverage: {} }) }));
vi.mock("@/lib/products", () => ({ loadProductIndex: h.productIndex }));
vi.mock("@/lib/order-guides", () => ({ guideKeysFor: async () => new Map() }));
vi.mock("@/lib/dynamic-pars-probes", () => ({ parAutoLaneReady: async () => false }));
vi.mock("@/lib/vendor-schema-probes", () => ({ vendorOrderMinimumReady: async () => false }));
vi.mock("@/lib/dynamic-pars-walker", () => ({ loadParSuggestions: async () => new Map(), loadParSilence: async () => EMPTY_PAR_SILENCE }));
vi.mock("@/lib/catering/sku-demand", () => ({ deriveCateringSkuDemand: async () => ({ rows: [] }) }));
import { loadWalkerData, submitParPass, OrderingError } from "@/lib/ordering";
import { resolveRescueTargets } from "@/lib/ordering-rescue-shared";

const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const actor = { user: { id: "u1", role: "gm", language: "en" }, locations: [SHOP] } as AuthContext;
const sku = (id: string, vendor: string, par: number | null, product: string | null) => ({ id, name: id, active: true, location_id: null,
  vendor_id: vendor, product_id: product, weekday_par: par, weekend_par: par, pack_format: "case", each_size: null, each_measure: null, item_number: null });
const index = (members: Array<{ skuId: string; vendorId: string }>) => {
  const entry = {
    productId: "prod", name: "Ham", active: true, unitOz: null, primarySkuId: "P", primaryIsLocationSpecific: false,
    members: members.map((m) => ({ ...m, vendorName: m.vendorId, active: true, name: m.skuId })),
    resolution: { productId: "prod", skuId: "B", rung: "most_recent", reason: null, consideredSkuIds: members.map((m) => m.skuId) },
    basis: null,
  };
  return { index: { resolution: new Map(), basis: new Map() }, byProduct: new Map([["prod", entry]]), productBySku: new Map(members.map((m) => [m.skuId, "prod"])) };
};
let tables: Tables;
let db: ReturnType<typeof createFakeDb>;
beforeEach(() => {
  vi.clearAllMocks();
  tables = {
    vendor_items: [sku("P", "vA", 4, "prod"), sku("B", "vB", null, "prod"), sku("other", "vB", 2, null), sku("lonely", "vB", null, "prod2")],
    vendors: [
      { id: "vA", name: "Down vendor", active: false, source_kind: "vendor", order_days: [] },
      { id: "vB", name: "Up vendor", active: true, source_kind: "vendor", order_days: [] },
    ],
    location_sku_settings: [], productions: [], par_pass_lines: [], par_pass_events: [], vendor_cutoffs: [], recipes: [],
    purchase_orders: [], vendor_ordering_details: [], audit_log: [],
  };
  db = createFakeDb(tables);
  h.db.mockReturnValue(db.client);
  h.productIndex.mockResolvedValue(index([{ skuId: "P", vendorId: "vA" }, { skuId: "B", vendorId: "vB" }]));
});

it("submitting the rescued backup row snapshots the carried par", async () => {
  // The walk shows B carrying P's par…
  const walk = await loadWalkerData(actor, SHOP);
  const shown = walk.vendors.flatMap((v) => v.skus).find((r) => r.skuId === "B");
  expect(shown).toMatchObject({ parToday: 4, reroutedFromSkuId: "P" });
  // …and the submission of that walk is accepted with the same par.
  const out = await submitParPass(actor, SHOP, [{ skuId: "B", orderQty: 0 }, { skuId: "other", orderQty: 0 }]);
  expect(out.eventId).toBeTruthy();
  const lines = db.writes.find((w) => w.table === "par_pass_lines")!.rows;
  expect(lines.map((l) => [l.sku_id, l.par_qty])).toEqual([["B", 4], ["other", 2]]);
});

it("a parless member with no dropped twin is still refused no_par, naming the SKU", async () => {
  tables.vendors![0]!.active = true; // P's vendor is up: P is walked, nothing is rescued onto B.
  const err = await submitParPass(actor, SHOP, [{ skuId: "B", orderQty: 0 }]).then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(OrderingError);
  expect(err).toMatchObject({ status: 400, code: "no_par", skuId: "B" });
  expect(db.writes.filter((w) => w.table === "par_pass_lines")).toEqual([]);
});

it("a parless SKU outside any product is refused no_par by name", async () => {
  tables.vendor_items!.push(sku("solo", "vB", null, null));
  const err = await submitParPass(actor, SHOP, [{ skuId: "solo", orderQty: 0 }]).then(() => null, (e: unknown) => e);
  expect(err).toMatchObject({ code: "no_par", skuId: "solo" });
});

it("resolveRescueTargets: highest par carried (id tiebreak), resolved member first, covered and no-entry products", () => {
  const byProduct = new Map([
    ["p1", { resolution: { skuId: "b" }, members: [{ skuId: "a", active: true, vendorId: "v" }, { skuId: "c", active: true, vendorId: "v" }, { skuId: "b", active: true, vendorId: "v" }] }],
    ["p2", { resolution: { skuId: null }, members: [{ skuId: "x", active: false, vendorId: "v" }, { skuId: "y", active: true, vendorId: "dead" }] }],
    ["p3", { resolution: { skuId: "q" }, members: [{ skuId: "q", active: true, vendorId: "v" }] }],
  ]);
  const d = resolveRescueTargets({
    droppedByProduct: new Map([
      ["p1", [{ skuId: "a2", par: 3 }, { skuId: "a1", par: 3 }, { skuId: "a0", par: 1 }]],
      ["p2", [{ skuId: "z", par: 2 }]],
      ["p3", [{ skuId: "r", par: 5 }]],
      ["p4", [{ skuId: "s", par: 1 }]],
    ]),
    coveredProductIds: new Set(["p3"]),
    byProduct,
    liveVendorIds: new Set(["v"]),
  });
  expect([...d.targets].map(([k, t]) => [k, t.carried.skuId, t.dropped.length])).toEqual([["b", "a1", 3]]);
  expect(d.unroutable).toEqual(["p2"]);
  expect(d.covered.map((c) => c.productId)).toEqual(["p3"]);
  expect(d.noEntry.map((n) => n.productId)).toEqual(["p4"]);
});
