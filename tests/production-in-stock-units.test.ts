/**
 * W16/B096 — the production page's stock hint and yield prediction count consumption in PACKS from
 * input_oz ÷ the shop's content, never from qty_entered (whose unit varies: manual = packs, the prep panel =
 * case / each / oz, a derived prep line = null). predictOutput is per shop and a failed read is loud.
 * Fixture: s-lettuce = a case of 24 × 1 lb = 384 oz (global flat pack), 16 oz per each.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopVersionsFixture, LOC, OTHER } from "./fixtures/shop-versions-fixture";
import { loadInStockPacks, predictOutput } from "@/lib/production";
import type { AuthContext } from "@/lib/session";

let current: { client: unknown } | null = null;
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current) throw new Error("no fake db installed");
  return current.client;
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));

const actor = { user: { id: "u-cook", role: "key_holder" }, role: "key_holder", level: 4, locations: [LOC] } as unknown as AuthContext;
const hdr = (id: string, location_id: string, output_qty: number, extra: Record<string, unknown> = {}) =>
  ({ id, location_id, output_item_id: "i-slaw", output_qty, superseded_at: null, revoked_at: null, produced_at: "2026-11-10T12:00:00.000Z", ...extra });
const ln = (id: string, production_id: string, input_oz: number, qty_entered: number | null, unit_entered: string | null) =>
  ({ id, production_id, input_sku_id: "s-lettuce", input_oz, qty_entered, unit_entered, derived_oz: null });

function seed() {
  const t = buildShopVersionsFixture();
  t.vendor_deliveries = [{ id: "d-loc", location_id: LOC }, { id: "d-other", location_id: OTHER }];
  t.vendor_delivery_items = [
    { id: "vdi-1", delivery_id: "d-loc", vendor_item_id: "s-lettuce", qty_received: 10 },
    { id: "vdi-2", delivery_id: "d-other", vendor_item_id: "s-lettuce", qty_received: 50 },
  ];
  t.productions = [hdr("h-panel", LOC, 4), hdr("h-derived", LOC, 6), hdr("h-manual", LOC, 12),
    hdr("h-old", LOC, 9, { superseded_at: "2026-11-10T13:00:00.000Z" }), hdr("h-other", OTHER, 100)];
  t.production_inputs = [
    ln("pi-1", "h-panel", 32, 2, "each"),     // prep panel: 2 each
    ln("pi-2", "h-derived", 96, null, null),  // untouched prep panel: derived, no qty_entered
    ln("pi-3", "h-manual", 384, 1, null),     // manual form: 1 pack
    ln("pi-4", "h-old", 999, 9, null),        // superseded
    ln("pi-5", "h-other", 384, 1, null),      // the other shop
  ];
  return t;
}

beforeEach(() => { current = createFakeDb(seed()); });
afterEach(() => { current = null; });

describe("W16/B096: in-stock packs", () => {
  it("count consumption in packs from input_oz, at this shop, live headers only", async () => {
    const out = await loadInStockPacks(["s-lettuce"], LOC);
    expect(out.get("s-lettuce")).toBeCloseTo(10 - 32 / 384 - 96 / 384 - 1, 9);
  });
});

describe("W16/B096: predictOutput", () => {
  it("is per shop and unit-safe", async () => {
    // At LOC: 4 quarts from 32 oz = 1/12 case → 48 quarts per case. The other shop's 100-from-1 never enters.
    const r = await predictOutput(actor, { locationId: LOC, inputSkuId: "s-lettuce", outputItemId: "i-slaw", inputQty: 1 });
    expect(r.predicted).toBeCloseTo(4 / (32 / 384) * (1 / 3) + 6 / (96 / 384) * (1 / 3) + 12 / 1 * (1 / 3), 9);
  });

  it("refuses a shop the actor does not hold", async () => {
    await expect(predictOutput(actor, { locationId: OTHER, inputSkuId: "s-lettuce", outputItemId: "i-slaw", inputQty: 1 }))
      .rejects.toMatchObject({ status: 404 });
  });

  it("a failed read throws instead of silently predicting nothing", async () => {
    const fake = createFakeDb(seed());
    current = { client: { from: (table: string) => {
      if (table !== "productions" && table !== "production_inputs") return fake.client.from(table);
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "is", "in", "order", "range", "returns"]) q[k] = () => q;
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "read denied" } }).then(resolve);
      return q;
    } } };
    await expect(predictOutput(actor, { locationId: LOC, inputSkuId: "s-lettuce", outputItemId: "i-slaw", inputQty: 1 })).rejects.toThrow(/read denied/);
  });
});

/**
 * W16 fix round 1 (P2): the conversion reads B096 added (vendor_items, the measure registry, the pack
 * levels) and the headers / inputs each fail ON THEIR OWN — the fake fails exactly one table, so every
 * downstream read is reached. A failed read must throw; never a `predicted: null` or an in-stock number
 * that skipped consumption (a valid-looking answer built on a read that did not happen).
 */
function failOnly(table: string) {
  const fake = createFakeDb(seed());
  current = { client: { from: (t: string) => {
    if (t !== table) return fake.client.from(t);
    const q: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "in", "order", "range", "returns", "limit", "lte", "gte", "lt", "gt", "or", "not"]) q[k] = () => q;
    const failed = { data: null, error: { message: `${table} read denied` } };
    q.maybeSingle = () => Promise.resolve(failed);
    q.single = () => Promise.resolve(failed);
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(failed).then(resolve, reject);
    return q;
  } } };
}

describe("W16 fix round 1: injected read failures propagate", () => {
  const predict = () => predictOutput(actor, { locationId: LOC, inputSkuId: "s-lettuce", outputItemId: "i-slaw", inputQty: 1 });

  for (const table of ["vendor_items", "measure_units", "sku_pack_levels", "productions", "production_inputs"]) {
    it(`predictOutput throws when only ${table} fails`, async () => {
      failOnly(table);
      await expect(predict()).rejects.toThrow(new RegExp(`${table} read denied`));
    });
  }
  // loadInStockPacks reads productions only through the production_inputs embed (audit W17 / B098), so its
  // own reads are the two ledgers plus the conversion reads.
  for (const table of ["vendor_delivery_items", "production_inputs", "vendor_items", "measure_units", "sku_pack_levels"]) {
    it(`loadInStockPacks throws when only ${table} fails`, async () => {
      failOnly(table);
      await expect(loadInStockPacks(["s-lettuce"], LOC)).rejects.toThrow(new RegExp(`${table} read denied`));
    });
  }

  it("the same reads, all succeeding, still answer (the fake is not failing everything)", async () => {
    failOnly("no_such_table");
    expect((await predict()).predicted).not.toBeNull();
    expect((await loadInStockPacks(["s-lettuce"], LOC)).get("s-lettuce")).toBeCloseTo(10 - 32 / 384 - 96 / 384 - 1, 9);
  });
});

/**
 * W16 fix round 2 (P2): receipts are counted in packs AT THE SIZE THEY WERE RECEIVED, consumption is oz, so
 * the arithmetic runs in OUNCES and converts to packs once, at today's size. Before: 10 cases received at
 * 384 oz, all 3,840 oz consumed, then the case edited to 768 oz → 10 − 3840/768 = 5 cases "left" of zero.
 * A receipt's oz is its frozen resolved_oz; a legacy line without one converts through the pack in force
 * at the shop when it was written (the W04 rule).
 */
describe("W16 fix round 2: a pack-size change never invents or hides stock", () => {
  const RECEIVED_AT = "2026-10-15T14:00:00.000Z";
  const EDITED_AT = "2026-11-01T00:00:00.000Z";
  const flat = (units: number) => ({ pack_format: "case", each_container_label: null, units_per_pack: units, each_size: 1, each_measure: "lb" });
  function packChange(opts: { unitsNow: number; consumedOz: number; resolvedOz: number | null; history: boolean }) {
    const t = buildShopVersionsFixture();
    t.vendor_deliveries = [{ id: "d-loc", location_id: LOC }];
    // 10 cases received while a case was 24 × 1 lb = 384 oz.
    t.vendor_delivery_items = [{ id: "vdi-1", delivery_id: "d-loc", vendor_item_id: "s-lettuce", qty_received: 10,
      received_level_label: null, resolved_oz: opts.resolvedOz, created_at: RECEIVED_AT }];
    t.productions = [hdr("h-manual", LOC, 40)];
    t.production_inputs = [ln("pi-1", "h-manual", opts.consumedOz, opts.consumedOz / 384, null)];
    // The case is edited today (the flat mirror follows the global pack).
    Object.assign(t.vendor_items!.find((r) => r.id === "s-lettuce")!, { units_per_pack: opts.unitsNow });
    if (opts.history) t.sku_pack_versions!.push(
      { id: "pv-let-384", sku_id: "s-lettuce", location_id: null, valid_from: "2026-08-01T00:00:00.000Z", valid_to: EDITED_AT, flat_snapshot: flat(24) },
      { id: "pv-let-now", sku_id: "s-lettuce", location_id: null, valid_from: EDITED_AT, valid_to: null, flat_snapshot: flat(opts.unitsNow) },
    );
    current = createFakeDb(t);
  }
  const stock = async () => (await loadInStockPacks(["s-lettuce"], LOC)).get("s-lettuce");

  it("the reviewer's case: 10 × 384 oz received, 3,840 oz consumed, case → 768 oz shows 0, not 5", async () => {
    packChange({ unitsNow: 48, consumedOz: 3840, resolvedOz: 3840, history: true });
    expect(await stock()).toBeCloseTo(0, 9);
  });

  it("half consumed, then the case doubles: 1,920 oz left = 2.5 of today's cases", async () => {
    packChange({ unitsNow: 48, consumedOz: 1920, resolvedOz: 3840, history: true });
    expect(await stock()).toBeCloseTo(2.5, 9);
  });

  it("a legacy receipt with no frozen oz converts at the pack in force when it was received", async () => {
    packChange({ unitsNow: 48, consumedOz: 3840, resolvedOz: null, history: true });
    expect(await stock()).toBeCloseTo(0, 9);
  });

  it("control: no pack change, the answer is the old one (10 − 1920/384 = 5)", async () => {
    packChange({ unitsNow: 24, consumedOz: 1920, resolvedOz: 3840, history: false });
    expect(await stock()).toBeCloseTo(5, 9);
  });

  it("control: a legacy receipt on a SKU never versioned converts at its only pack (= 5)", async () => {
    packChange({ unitsNow: 24, consumedOz: 1920, resolvedOz: null, history: false });
    expect(await stock()).toBeCloseTo(5, 9);
  });

  it("a failed pack-history read throws (a legacy receipt would otherwise convert at today's size)", async () => {
    packChange({ unitsNow: 48, consumedOz: 3840, resolvedOz: null, history: true });
    const fake = current as ReturnType<typeof createFakeDb>;
    current = { client: { from: (t: string) => {
      if (t !== "sku_pack_versions") return fake.client.from(t);
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "is", "in", "order", "range", "returns", "or", "not", "lte"]) q[k] = () => q;
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "sku_pack_versions read denied" } }).then(resolve);
      return q;
    } } };
    await expect(stock()).rejects.toThrow(/sku_pack_versions read denied/);
  });
});
