/**
 * Catalog Phase 2b — a preview token binds EVERYTHING the preview shows (Astra full-branch r1 P2-1).
 * The real server path (computePackPreview / computePricePreview over the real 2a loaders) runs on
 * the in-memory DB; each test changes ONE real dependency the preview displays — a price, the pack, a
 * recipe line, an open order — and proves the token changes AND the apply refuses the old token
 * (409 preview_stale) before any write. A control proves an unchanged world keeps the token and
 * reaches the write.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { buildShopVersionsFixture, LOC } from "./fixtures/shop-versions-fixture";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
let world: Record<string, Row[]> | null = null;
let current: ReturnType<typeof createFakeDb> | null = null;
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => {
  if (!current || !world) throw new Error("no fake db installed");
  const w = world;
  return {
    from: current.client.from,
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      // The dependency snapshot of the reached shops (a stand-in for 0261's: what the DB would say).
      if (name === "sku_pack_change_snapshot" || name === "sku_price_snapshot") {
        const sku = args.p_sku as string;
        return { data: { overlay: (w.location_sku_settings ?? []).filter((o) => o.sku_id === sku), versions: (w.sku_pack_versions ?? []).filter((v) => v.sku_id === sku && v.active) }, error: null };
      }
      return { data: { version_id: "v-new", retired_version_id: null, pars_converted: 0, request_applied: false, mirror_synced: true, price_id: "p-new", lane_id: null, lane_created: false }, error: null };
    },
  };
} }));
vi.mock("@/lib/audit", () => ({ audit: async () => {}, auditChecked: async () => ({ ok: true }) }));
import { applyPackChange, applyPriceChange, CatalogItemError, computePackPreview, computePricePreview, loadSkuItemView } from "@/lib/catalog/sku-item";
afterEach(() => { current = null; world = null; rpcCalls.length = 0; });

const moo = { user: { id: "u-moo", role: "moo" }, role: "moo", level: 8, locations: [] } as unknown as AuthContext;
const SKU = "s-turkey";
const target = { kind: "shop" as const, shopId: LOC };
// It arrives differently now: case → 4 sack → 10 lb.
const LEVELS = [
  { label: "case", containsQty: 4, containsIndex: 1, containsMeasureUnit: null },
  { label: "sack", containsQty: 10, containsIndex: null, containsMeasureUnit: "lb" },
];

function install(mutate?: (w: Record<string, Row[]>) => void) {
  const w = buildShopVersionsFixture();
  w.sku_pack_epochs ??= [];
  w.purchase_orders = [{ id: "po-1", display_code: "S1-1", status: "placed", location_id: LOC }];
  w.po_lines = [{ id: "pol-1", po_id: "po-1", sku_id: SKU, order_qty: 2, order_unit_label: "case" }];
  // A sandwich made of turkey alone, so its cost is fully priced and SHOWN on both previews.
  w.menu_items!.push({ id: "m-turkey", name: "Turkey sub", name_es: null, active: true });
  w.recipes!.push({ id: "r-turkey", name: "Turkey sub", batch_yield: 1, active: true, created_at: "2026-09-04T00:00:00.000Z" });
  w.recipe_inputs!.push({ id: "ri-t1", recipe_id: "r-turkey", quantity: 4, unit: "oz", component_sku_id: SKU, component_item_id: null, component_product_id: null });
  w.recipe_outputs!.push({ id: "ro-t1", recipe_id: "r-turkey", output_item_id: null, output_menu_item_id: "m-turkey", yield: 1 });
  mutate?.(w);
  world = w;
  current = createFakeDb(w);
  return w;
}
const packToken = async () => (await computePackPreview(moo, SKU, target, LEVELS)).token;
const priceToken = async () => (await computePricePreview(moo, SKU, target, 140, "2026-10-16")).token;
async function stale(p: Promise<unknown>) {
  try { await p; } catch (e) { if (e instanceof CatalogItemError) return e.code; throw e; }
  return "no refusal";
}
const applyPack = (token: string) => applyPackChange(moo, { skuId: SKU, target, levels: LEVELS, conversions: [], requestId: null, previewToken: token });
const applyPrice = (token: string) => applyPriceChange(moo, { skuId: SKU, target, unitPrice: 140, effectiveDate: "2026-10-16", previewToken: token });

const DEPENDENCIES: Array<[string, (w: Record<string, Row[]>) => void]> = [
  ["a new price row (the $/oz and sandwich costs shown)", (w) => { w.vendor_price_history!.push({ id: "ph-new", vendor_item_id: SKU, unit_price: 256, effective_date: "2026-10-10", recorded_at: "2026-10-10T12:00:00.000Z", recorded_by: null, source: null, source_note: null, location_id: null, price_lane_id: null }); }],
  ["the pack (the case the $/oz is read in)", (w) => { const bag = w.sku_pack_levels!.find((l) => l.id === "pl-t-bag")!; bag.contains_qty = 160; }],
  ["a recipe line (the sandwich costs shown)", (w) => { const line = w.recipe_inputs!.find((r) => r.id === "ri-t1")!; line.quantity = 6; }],
  ["an open order (the orders not received yet)", (w) => { w.po_lines!.push({ id: "pol-2", po_id: "po-1", sku_id: SKU, order_qty: 5, order_unit_label: "case" }); }],
];

describe("the PACK preview token binds every dependency it shows", () => {
  it("control: an unchanged world keeps the token, and the save reaches the one write", async () => {
    install();
    const t1 = await packToken();
    expect(await packToken()).toBe(t1);
    await applyPack(t1);
    expect(rpcCalls.map((c) => c.name)).toContain("apply_sku_pack_change");
  });
  for (const [what, mutate] of DEPENDENCIES) {
    it(`${what} changes the token, and the apply refuses the old one before any write`, async () => {
      const w = install();
      const before = await packToken();
      mutate(w);
      current = createFakeDb(w);
      expect(await packToken()).not.toBe(before);
      rpcCalls.length = 0;
      expect(await stale(applyPack(before))).toBe("preview_stale");
      expect(rpcCalls.map((c) => c.name)).not.toContain("apply_sku_pack_change");
    });
  }
});

describe("the PRICE preview token binds every dependency it shows", () => {
  it("control: an unchanged world keeps the token, and the save reaches the one write", async () => {
    install();
    const t1 = await priceToken();
    expect(await priceToken()).toBe(t1);
    await applyPrice(t1);
    const write = rpcCalls.find((c) => c.name === "apply_sku_price_change")!;
    // The save carries the snapshot its preview was computed on (full-branch r1 P2-2).
    expect(write.args.p_snapshot).toMatchObject({ overlay: expect.any(Array), versions: expect.any(Array) });
  });
  // An open order is not on the price preview; the other three are.
  for (const [what, mutate] of DEPENDENCIES.slice(0, 3)) {
    it(`${what} changes the token, and the apply refuses the old one before any write`, async () => {
      const w = install();
      const before = await priceToken();
      mutate(w);
      current = createFakeDb(w);
      expect(await priceToken()).not.toBe(before);
      rpcCalls.length = 0;
      expect(await stale(applyPrice(before))).toBe("preview_stale");
      expect(rpcCalls.map((c) => c.name)).not.toContain("apply_sku_price_change");
    });
  }
});

describe("the reviewer sees the door's photo (full-branch r1 P2-3)", () => {
  it("an open report's photo is carried through the authorized read into the item view", async () => {
    install((w) => {
      w.sku_pack_change_requests = [{ id: "req-1", sku_id: SKU, location_id: LOC, status: "open", filed_by: "u-kh", filed_at: "2026-10-15T10:00:00Z", note: null, proposal: null, photo_id: "ph-door" }];
      w.users = [...(w.users ?? []), { id: "u-kh", name: "Kai" }];
      w.sku_pack_change_request_additions = []; w.vendor_delivery_rhythm ??= []; w.vendor_cutoffs ??= []; w.sku_barcodes ??= []; w.product_primaries ??= []; w.products ??= [];
    });
    const view = await loadSkuItemView(moo, SKU, LOC, [{ id: LOC, name: "Shop one" }]);
    expect(view.openRequests).toEqual([expect.objectContaining({ id: "req-1", filedBy: "Kai", photoId: "ph-door" })]);
  });
});
