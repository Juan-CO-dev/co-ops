/**
 * Audit W17 / B098 — the production page's in-stock hint must not spend id lists.
 *
 * `loadInStockPacks` is called with EVERY active SKU id. It used to send that list in
 * `.in("vendor_item_id", …)` together with every delivery id at the shop in
 * `.in("delivery_id", …)`, and the SKU list again on `production_inputs` — past the
 * request-line ceiling at ~210 SKUs, so /operations/production failed to render. Both ledgers
 * are now scoped to the shop by their header embed and the SKUs are picked in memory.
 * Consumption is input_oz ÷ the shop's content (W16/B096): every SKU here is a 1-oz pack, so the
 * oz consumed reads as packs consumed.
 */
import { expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { withInListGuard } from "./fixtures/in-list-guard";
import { loadInStockPacks } from "@/lib/production";

let client: ReturnType<typeof createFakeDb>["client"];
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => client }));

const L = "loc-L";
const OTHER = "loc-other";
const sku = (i: number) => `sku-${String(i).padStart(3, "0")}`;

function seed() {
  const deliveries: Array<Record<string, unknown>> = [];
  const deliveryItems: Array<Record<string, unknown>> = [];
  const productions: Array<Record<string, unknown>> = [];
  const inputs: Array<Record<string, unknown>> = [];
  let n = 0;
  const id = (p: string) => `${p}-${String(++n).padStart(5, "0")}`;
  // 250 deliveries at L: delivery i receives 2 packs of SKU i and 1 pack ("1" as numeric text) of SKU 0.
  for (let i = 0; i < 250; i++) {
    deliveries.push({ id: `d-${i}`, location_id: L });
    deliveryItems.push({ id: id("vdi"), delivery_id: `d-${i}`, vendor_item_id: sku(i), qty_received: 2 });
    deliveryItems.push({ id: id("vdi"), delivery_id: `d-${i}`, vendor_item_id: sku(0), qty_received: "1" });
  }
  // The other shop's receipts must never reach L's hint.
  for (let i = 0; i < 5; i++) {
    deliveries.push({ id: `d-other-${i}`, location_id: OTHER });
    deliveryItems.push({ id: id("vdi"), delivery_id: `d-other-${i}`, vendor_item_id: sku(i), qty_received: 100 });
  }
  // A SKU the caller did not ask about (inactive in the catalog) has lines too.
  deliveryItems.push({ id: id("vdi"), delivery_id: "d-0", vendor_item_id: "sku-unasked", qty_received: 7 });

  const production = (pid: string, over: Record<string, unknown>, lines: Array<[string, number | string | null]>) => {
    productions.push({ id: pid, location_id: L, superseded_at: null, revoked_at: null, ...over });
    for (const [skuId, oz] of lines) inputs.push({ id: id("pi"), production_id: pid, input_sku_id: skuId, input_oz: oz });
  };
  for (let i = 0; i < 10; i++) production(`p-live-${i}`, {}, [[sku(0), 3], [sku(1), "0.5"]]);
  production("p-null-qty", {}, [[sku(2), null]]);
  production("p-superseded", { superseded_at: "2026-10-02T00:00:00+00:00" }, [[sku(0), 1000]]);
  production("p-revoked", { revoked_at: "2026-10-02T00:00:00+00:00" }, [[sku(0), 1000]]);
  production("p-other-shop", { location_id: OTHER }, [[sku(0), 1000]]);
  production("p-unasked", {}, [["sku-unasked", 4]]);
  // A 1-oz pack for every SKU (flat path, no chains), so oz consumed = packs consumed.
  const vendorItems = [...Array.from({ length: 251 }, (_, i) => sku(i)), "sku-unasked"].map((sid) =>
    ({ id: sid, pack_format: "case", units_per_pack: 1, each_size: 1, each_measure: "oz", avg_oz_per_each: null }));
  return {
    vendor_deliveries: deliveries, vendor_delivery_items: deliveryItems, productions, production_inputs: inputs,
    vendor_items: vendorItems, measure_units: [{ label: "oz", dimension: "weight", to_base_factor: 1, active: true }], sku_pack_levels: [],
  };
}

it("in-stock packs for 250 SKUs × 250 deliveries: shop-scoped, live-only, no id lists", async () => {
  const db = createFakeDb(seed());
  client = withInListGuard(db.client);
  const ids = Array.from({ length: 251 }, (_, i) => sku(i)); // sku-250 is active but has no ledger rows
  const got = await loadInStockPacks(ids, L);

  expect(got.size).toBe(251);
  expect(got.get(sku(0))).toBe(2 + 250 * 1 - 10 * 3); // every delivery's extra pack, minus live consumption
  expect(got.get(sku(1))).toBe(2 - 10 * 0.5);
  expect(got.get(sku(2))).toBe(2); // a null input_oz consumes nothing
  for (let i = 3; i < 250; i++) expect(got.get(sku(i))).toBe(2);
  expect(got.get(sku(250))).toBe(0);
  expect(got.has("sku-unasked")).toBe(false);
  // The two ledgers plus the conversion reads (one each, no id lists), and no header round trips.
  expect(db.log.map((q) => q.table).sort()).toEqual(["measure_units", "production_inputs", "sku_pack_levels", "vendor_delivery_items", "vendor_items"]);
});

it("the other shop gets its own receipts and none of this shop's consumption", async () => {
  client = withInListGuard(createFakeDb(seed()).client);
  const got = await loadInStockPacks([sku(0), sku(1), sku(9)], OTHER);
  expect(got).toEqual(new Map([[sku(0), 100 - 1000], [sku(1), 100], [sku(9), 0]]));
});

it("no SKUs asked → nothing read", async () => {
  const db = createFakeDb(seed());
  client = db.client;
  expect(await loadInStockPacks([], L)).toEqual(new Map());
  expect(db.log).toEqual([]);
});
