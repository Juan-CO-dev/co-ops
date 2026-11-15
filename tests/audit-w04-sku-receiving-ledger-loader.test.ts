import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

/**
 * Audit W04/B043 + B149: loadSkuReceivingLedger against a fake service-role client.
 * Chain: case = 6 x bag, bag = 5 lb, so one root = 480 oz; current case price $48.
 */
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  errors: {} as Record<string, string>,
  inSizes: {} as Record<string, number[]>,
  todayBags: 6,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/admin/skus", () => ({
  loadMeasureUnits: async () => [
    { id: "lb", label: "lb", dimension: "weight", toBaseFactor: 16 },
    { id: "oz", label: "oz", dimension: "weight", toBaseFactor: 1 },
  ],
}));
vi.mock("@/lib/prep-consumption", async () => {
  const { resolvePacksAtPoints } = await import("@/lib/sku-versions-shared");
  return {
  loadRecipeInputsAcrossScopes: async () => [],
  // The real pure picker over the fake version tables (the loader's I/O half is chunked/paged like loadSkuPackResolution).
  loadSkuPacksAtPoints: async (points: Parameters<typeof resolvePacksAtPoints>[2]) => {
    const versions = (state.tables.sku_pack_versions ?? []) as unknown as Parameters<typeof resolvePacksAtPoints>[0];
    const levels = (state.tables.sku_pack_levels ?? []) as unknown as Parameters<typeof resolvePacksAtPoints>[1];
    return { packs: resolvePacksAtPoints(versions, levels, points), versioned: new Set(versions.map((v) => v.sku_id)) };
  },
  loadSkuPackChains: async (ids: string[]) => new Map(ids.map((id) => [id, [
    { id: "case", label: "case", containsQty: state.todayBags, containsLevelId: "bag", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "bag", label: "bag", containsQty: 5, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
  ]])),
  };
});
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => ({
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let lo = 0, hi = Number.POSITIVE_INFINITY;
      const run = () => {
        if (state.errors[table]) return { data: null, error: { message: state.errors[table] } };
        return { data: (state.tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(lo, hi + 1), error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q, order: () => q, returns: () => q, or: () => q,
        eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
        is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
        in: (k: string, v: unknown[]) => { (state.inSizes[table] ??= []).push(v.length); filters.push((r) => v.includes(r[k])); return q; },
        range: (a: number, b: number) => { lo = a; hi = b; return q; },
        then: (resolve: (x: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      };
      return q;
    },
  }),
}));

import { loadSkuReceivingLedger } from "@/lib/admin/cost";

const actor = { user: { id: "u", role: "owner" }, locations: [] } as unknown as AuthContext;

beforeEach(() => {
  state.errors = {}; state.inSizes = {}; state.todayBags = 6;
  state.tables = {
    vendor_items: [{ id: "sku", units_per_pack: 6, each_size: 5, each_measure: "lb", avg_oz_per_each: null, pack_format: "case" }],
    vendor_price_history: [{ id: "p", vendor_item_id: "sku", unit_price: 48, effective_date: "2026-11-01", recorded_at: null, location_id: null, price_lane_id: null }],
    vendor_delivery_items: [
      { id: "l1", vendor_item_id: "sku", delivery_id: "d1", qty_received: 2, unit_price: null, received_level_label: "bag", resolved_oz: 160 },
    ],
    vendor_deliveries: [{ id: "d1", delivery_date: "2026-11-10", vendor_id: "v" }],
    vendors: [{ id: "v", name: "PFG", source_kind: "vendor" }],
  };
});

describe("W04/B043 SKU receiving ledger", () => {
  it("two bags received at level 'bag' are 160 oz and a third of a case", async () => {
    const led = (await loadSkuReceivingLedger(actor, ["sku"])).get("sku")!;
    expect(led.receivedOz).toBe(160);
    expect(led.receivedDollars).toBeCloseTo(16, 6);
    expect(led.missingOzLineCount).toBe(0);
    expect(led.deliveries).toEqual([{ deliveryId: "d1", date: "2026-11-10", vendorName: "PFG", qty: 2, unitPrice: null }]);
  });

  it("a store-run line's price is per received level", async () => {
    state.tables.vendors = [{ id: "v", name: "Store", source_kind: "store" }];
    state.tables.vendor_delivery_items![0]!.unit_price = 9;
    const led = (await loadSkuReceivingLedger(actor, ["sku"])).get("sku")!;
    expect(led.receivedDollars).toBeCloseTo(18, 6);
  });

  it("a legacy root line keeps qty x content and the line price", async () => {
    state.tables.vendor_delivery_items = [{ id: "l1", vendor_item_id: "sku", delivery_id: "d1", qty_received: 3, unit_price: 50, received_level_label: null, resolved_oz: null }];
    const led = (await loadSkuReceivingLedger(actor, ["sku"])).get("sku")!;
    expect(led.receivedOz).toBe(1440);
    expect(led.receivedDollars).toBe(150);
  });
});

describe("W04 r1: historical delivery dollars use the pack in force at that shop then", () => {
  const levels = (version: string, location: string | null, bags: number) => [
    { id: `${version}-case`, sku_id: "sku", version_id: version, location_id: location, label: "case", contains_qty: bags, contains_level_id: `${version}-bag`, contains_measure_unit: null, display_ordinal: 0 },
    { id: `${version}-bag`, sku_id: "sku", version_id: version, location_id: location, label: "bag", contains_qty: 5, contains_level_id: null, contains_measure_unit: "lb", display_ordinal: 1 },
  ];
  beforeEach(() => {
    state.tables.sku_pack_versions = [
      { id: "g1", sku_id: "sku", location_id: null, valid_from: "2026-01-01T00:00:00Z", valid_to: "2026-11-12T00:00:00Z", flat_snapshot: null },
      { id: "g2", sku_id: "sku", location_id: null, valid_from: "2026-11-12T00:00:00Z", valid_to: null, flat_snapshot: null },
      { id: "s1", sku_id: "sku", location_id: "shopB", valid_from: "2026-06-01T00:00:00Z", valid_to: null, flat_snapshot: null },
    ];
    state.tables.sku_pack_levels = [...levels("g1", null, 6), ...levels("g2", null, 4), ...levels("s1", "shopB", 3)];
    state.tables.vendor_delivery_items = [
      { id: "l1", vendor_item_id: "sku", delivery_id: "d1", qty_received: 2, unit_price: 60, received_level_label: "bag", resolved_oz: 160, created_at: "2026-11-10T15:00:00Z" },
    ];
    state.tables.vendor_deliveries = [{ id: "d1", delivery_date: "2026-11-10", vendor_id: "v", location_id: "shopA" }];
  });

  it("two bags at a frozen $60/case stay $20 after the case drops to 4 bags", async () => {
    state.todayBags = 4;
    const led = (await loadSkuReceivingLedger(actor, ["sku"])).get("sku")!;
    expect(led.receivedOz).toBe(160);
    expect(led.receivedDollars).toBeCloseTo(20, 6);
  });

  it("a delivery at a shop with its own 3-bag case prices against that case", async () => {
    state.tables.vendor_deliveries = [{ id: "d1", delivery_date: "2026-11-10", vendor_id: "v", location_id: "shopB" }];
    const led = (await loadSkuReceivingLedger(actor, ["sku"])).get("sku")!;
    expect(led.receivedDollars).toBeCloseTo(40, 6);
  });
});

describe("W04/B149 SKU receiving ledger reads are bounded and loud", () => {
  it.each(["vendor_deliveries", "vendors", "vendor_items"])("a failed %s read throws instead of rendering partial history", async (table) => {
    state.errors[table] = "boom";
    await expect(loadSkuReceivingLedger(actor, ["sku"])).rejects.toThrow(/boom/);
  });

  it("chunks delivery, vendor and SKU id lists to 100 and still finds every delivery", async () => {
    const n = 250;
    state.tables.vendor_delivery_items = Array.from({ length: n }, (_, i) => ({ id: `l${i}`, vendor_item_id: "sku", delivery_id: `d${i}`, qty_received: 1, unit_price: 48, received_level_label: null, resolved_oz: null }));
    state.tables.vendor_deliveries = Array.from({ length: n }, (_, i) => ({ id: `d${i}`, delivery_date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, vendor_id: `v${i % 130}` }));
    state.tables.vendors = Array.from({ length: 130 }, (_, i) => ({ id: `v${i}`, name: `Vendor ${i}`, source_kind: "vendor" }));
    const skuIds = ["sku", ...Array.from({ length: 149 }, (_, i) => `other${i}`)];
    const led = (await loadSkuReceivingLedger(actor, skuIds)).get("sku")!;
    expect(led.deliveries).toHaveLength(n);
    expect(led.deliveries.every((d) => d.date !== "" && d.vendorName !== "(vendor)")).toBe(true);
    expect(led.receivedDollars).toBe(48 * n);
    for (const table of ["vendor_deliveries", "vendors", "vendor_delivery_items", "vendor_items"]) {
      expect(Math.max(...state.inSizes[table]!)).toBeLessThanOrEqual(100);
    }
  });
});
