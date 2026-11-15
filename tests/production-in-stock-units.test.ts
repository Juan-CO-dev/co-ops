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
