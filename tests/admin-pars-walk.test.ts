import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";
import type { AuthContext } from "@/lib/session";
import { EMPTY_PAR_SILENCE } from "@/lib/dynamic-pars-shared";

const h = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.db }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: async () => true }));
vi.mock("@/lib/prep-consumption", () => ({
  loadMeasures: async () => new Map(), loadResolvedRecipeInputs: async () => [],
  loadSkuPackResolution: async () => new Map(), loadShopPackEpochs: async () => new Map(),
}));
vi.mock("@/lib/counts", () => ({ loadOnHandDerived: async () => ({ rows: [], salesThrough: null }) }));
vi.mock("@/lib/toast/effective-depletion", () => ({ loadEffectiveSalesWindow: async () => ({ rows: [], coverage: {} }) }));
vi.mock("@/lib/products", () => ({ loadProductIndex: async () => ({ byProduct: new Map(), productBySku: new Map() }) }));
vi.mock("@/lib/order-guides", () => ({ guideKeysFor: async () => new Map() }));
vi.mock("@/lib/dynamic-pars-probes", () => ({ parAutoLaneReady: async () => false }));
vi.mock("@/lib/dynamic-pars-walker", () => ({ loadParSuggestions: async () => new Map(), loadParSilence: async () => EMPTY_PAR_SILENCE }));
vi.mock("@/lib/catering/sku-demand", () => ({ deriveCateringSkuDemand: async () => ({ rows: [] }) }));
import { loadWalkerData } from "@/lib/ordering";
import { loadPars } from "@/lib/admin/pars";

const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const actor = { user: { role: "gm", language: "en" }, locations: [SHOP] } as AuthContext;
beforeEach(() => vi.clearAllMocks());
it.each([true, false])("real walk excludes off-here SKU with global active=%s while Pars retains it", async (active) => {
  const sku = (id: string, active: boolean) => ({ id, name: id, active, location_id: null, vendor_id: "v", product_id: null,
    weekday_par: 3, weekend_par: 4, pack_format: "case", each_size: null, each_measure: null });
  const tables: Tables = {
    vendor_items: [sku("off", active), sku("visible-control", true)],
    vendors: [{ id: "v", name: "Vendor", active: true, source_kind: "vendor", order_days: [] }],
    location_sku_settings: [{ sku_id: "off", location_id: SHOP, active_override: false, weekday_par: null, weekend_par: null }],
    productions: [], par_pass_lines: [], vendor_cutoffs: [], recipes: [],
  };
  const db = createFakeDb(tables); h.db.mockReturnValue(db.client);
  const walk = await loadWalkerData(actor, SHOP);
  expect(walk.vendors.flatMap((vendor) => vendor.skus.map((row) => row.skuId))).toEqual(["visible-control"]);
  expect(walk.unroutable.skuInactive).toBe(1);
  const pars = await loadPars(actor, SHOP);
  expect(pars.rows.find((row) => row.skuId === "off")).toMatchObject({ offHere: true, edit: { globalActive: active, activeOverride: false } });
  expect(db.log.some((query) => query.table === "location_sku_settings")).toBe(true);
  expect(db.writes).toEqual([]);
});
