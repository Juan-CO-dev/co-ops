import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

/**
 * Audit W04/B043: loadSkuReceivingLedger against a fake service-role client.
 * Chain: case = 6 x bag, bag = 5 lb, so one root = 480 oz; current case price $48.
 */
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  errors: {} as Record<string, string>,
  inSizes: {} as Record<string, number[]>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/admin/skus", () => ({
  loadMeasureUnits: async () => [
    { id: "lb", label: "lb", dimension: "weight", toBaseFactor: 16 },
    { id: "oz", label: "oz", dimension: "weight", toBaseFactor: 1 },
  ],
}));
vi.mock("@/lib/prep-consumption", () => ({
  loadRecipeInputsAcrossScopes: async () => [],
  loadSkuPackChains: async (ids: string[]) => new Map(ids.map((id) => [id, [
    { id: "case", label: "case", containsQty: 6, containsLevelId: "bag", containsMeasureUnit: null, displayOrdinal: 0 },
    { id: "bag", label: "bag", containsQty: 5, containsLevelId: null, containsMeasureUnit: "lb", displayOrdinal: 1 },
  ]])),
}));
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
  state.errors = {}; state.inSizes = {};
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
