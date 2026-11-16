/**
 * Audit W18/B025: a par set ONLY for one shop (the catalog New-item job writes just the shop
 * overlay) never reached the walk, the Suggest chips or the nightly shadow ledger, because all
 * three loaders built the par'd universe from the GLOBAL par predicate alone.
 */
import { readFileSync } from "node:fs";
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
import { loadParSkuUniverse } from "@/lib/par-universe";

const SHOP = "6f1d2c3e-0000-4000-8000-00000000000a";
const OTHER = "6f1d2c3e-0000-4000-8000-00000000000b";
const actor = { user: { role: "gm", language: "en" }, locations: [SHOP, OTHER] } as AuthContext;
const sku = (id: string, weekday: number | null, weekend: number | null) => ({ id, name: id, active: true, location_id: null, vendor_id: "v",
  product_id: null, weekday_par: weekday, weekend_par: weekend, pack_format: "case", each_size: null, each_measure: null });
let tables: Tables;
beforeEach(() => {
  vi.clearAllMocks();
  tables = {
    vendor_items: [sku("global", 3, 4), sku("shop-only", null, null), sku("off-here", null, null)],
    vendors: [{ id: "v", name: "Vendor", active: true, source_kind: "vendor", order_days: [] }],
    location_sku_settings: [
      { id: "o1", sku_id: "shop-only", location_id: SHOP, active_override: null, weekday_par: 5, weekend_par: 5 },
      // An off-here row with no pars is NOT a par: the SKU stays out of the universe.
      { id: "o2", sku_id: "off-here", location_id: SHOP, active_override: false, weekday_par: null, weekend_par: null },
    ],
    productions: [], par_pass_lines: [], vendor_cutoffs: [], recipes: [],
  };
  h.db.mockImplementation(() => createFakeDb(tables).client);
});

it("a shop-only human par on a SKU with null global pars is walked at that shop only", async () => {
  const here = await loadWalkerData(actor, SHOP);
  const rows = here.vendors.flatMap((v) => v.skus);
  expect(rows.map((r) => r.skuId).sort()).toEqual(["global", "shop-only"]);
  expect(rows.find((r) => r.skuId === "shop-only")?.parToday).toBe(5);
  const there = await loadWalkerData(actor, OTHER);
  expect(there.vendors.flatMap((v) => v.skus).map((r) => r.skuId)).toEqual(["global"]);
});

it("the universe is the global rows plus this shop's human-par rows, de-duplicated", async () => {
  tables.location_sku_settings!.push({ id: "o3", sku_id: "global", location_id: SHOP, active_override: null, weekday_par: 9, weekend_par: null });
  const sb = createFakeDb(tables).client;
  const ids = (await loadParSkuUniverse<{ id: string }>(sb, SHOP, "id")).map((r) => r.id);
  expect(ids).toEqual(["global", "shop-only"]);
  expect((await loadParSkuUniverse<{ id: string }>(sb, OTHER, "id")).map((r) => r.id)).toEqual(["global"]);
});

it("the walk, the nightly engine and the suggestion index read the ONE universe", () => {
  const sites: Array<[string, RegExp]> = [
    ["lib/ordering.ts", /loadParSkuUniverse<WalkerSkuRow>\(sb, locationId, WALKER_SKU_COLUMNS\)/],
    ["lib/dynamic-pars.ts", /loadParSkuUniverse<DbSkuRow>\(sb, locationId, `\$\{WALKER_SKU_COLUMNS\}, cushion_class, par_step, sku_class`\)/],
    ["lib/dynamic-pars-walker.ts", /loadParSkuUniverse<[^>]+>\(\s*sb, locationId, "id, name, vendor_id, location_id"\)/],
  ];
  for (const [file, re] of sites) {
    const src = readFileSync(file, "utf8");
    expect(src, file).toMatch(re);
    expect(src, file).not.toContain('.or("weekday_par.not.is.null,weekend_par.not.is.null")');
  }
});
