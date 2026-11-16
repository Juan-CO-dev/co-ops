import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit W04/B148: a "missing item" short credit must be for an item the linked PO ordered,
 * and can claim at most the qty it ordered.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: vi.fn(async () => true), auditOperationalTaskOverride: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/prep-consumption", () => ({ loadMeasures: vi.fn(async () => new Map()), loadSkuPackChains: vi.fn(async () => new Map()) }));

import { getServiceRoleClient } from "@/lib/supabase-server";
import { recordDelivery } from "@/lib/receiving";

const SHOP = "11111111-1111-4111-8111-111111111111";
const VENDOR = "44444444-4444-4444-8444-444444444444";
const A = "55555555-5555-4555-8555-555555555555";
const B = "66666666-6666-4666-8666-666666666666";
const C = "77777777-7777-4777-8777-777777777777";
const PO = "88888888-8888-4888-8888-888888888888";

let inserts: Array<{ table: string; rows: unknown }> = [];
// W20/B197: a new delivery is written by ONE call (record_delivery_atomic); the missing-item
// credits travel in its `p_missing_credits`.
let atomic: Array<Record<string, unknown>> = [];
const missingCredits = () => atomic[0]!.p_missing_credits as Array<Record<string, unknown>>;
function client(poLines: Array<{ sku_id: string; order_qty: number }>) {
  return { from(table: string) {
    let ids: unknown[] = [];
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "is", "ilike", "order", "not", "gte", "update"]) q[op] = () => q;
    q.in = (_c: string, v: unknown[]) => { ids = v; return q; };
    q.insert = (rows: unknown) => { inserts.push({ table, rows }); return q; };
    q.returns = () => q;
    q.maybeSingle = () => q;
    q.then = (resolve: (value: unknown) => unknown) => {
      let data: unknown = [];
      if (table === "vendors") data = { id: VENDOR, source_kind: "vendor" };
      else if (table === "purchase_orders") data = { id: PO, vendor_id: VENDOR, location_id: SHOP, status: "placed" };
      else if (table === "vendor_deliveries") data = inserts.some((i) => i.table === "vendor_deliveries") ? { id: "delivery" } : null;
      else if (table === "po_lines") data = poLines.filter((l) => ids.includes(l.sku_id));
      else if (table === "vendor_items") data = ids.map((id) => ({ id, vendor_id: VENDOR, location_id: null, pack_format: null,
        each_container_label: null, units_per_pack: 1, each_size: null, each_measure: null, avg_oz_per_each: null, weight_class: null }));
      return Promise.resolve({ data, error: null, count: 1 }).then(resolve);
    };
    return q;
  }, rpc: async (fn: string, args: Record<string, unknown>) => {
    if (fn !== "record_delivery_atomic") return { data: null, error: null };
    atomic.push(args);
    return { data: { delivery_id: "delivery", item_ids: ["item"] }, error: null };
  } };
}
const actor = { user: { id: "user", role: "key_holder" }, locations: [SHOP] } as never;
const input = (missing: { skuId: string; expectedQty: number; unitPrice: number | null }) => ({
  locationId: SHOP, vendorId: VENDOR, deliveryDate: "2026-11-10", purchaseOrderId: PO,
  deliveryStatus: "in_progress" as const,
  lines: [{ skuId: A, qtyReceived: 1 }], missingLines: [missing],
});

beforeEach(() => { inserts = []; atomic = []; vi.clearAllMocks(); });

describe("W04/B148 missing-item credits are bounded by the PO", () => {
  it("refuses a SKU that was never on the PO, before any write", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(client([{ sku_id: A, order_qty: 1 }]) as never);
    await expect(recordDelivery(actor, input({ skuId: B, expectedQty: 100, unitPrice: 200 })))
      .rejects.toMatchObject({ status: 400, code: "missing_not_on_po" });
    expect(inserts).toEqual([]);
    expect(atomic).toEqual([]);
  });

  it("caps the claimed qty at what the PO ordered", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(client([{ sku_id: A, order_qty: 1 }, { sku_id: C, order_qty: 3 }]) as never);
    await recordDelivery(actor, input({ skuId: C, expectedQty: 100, unitPrice: 2 }));
    expect(missingCredits()).toEqual([{ sku_id: C, reason: "short", qty: 3, amount_cents: 600 }]);
    expect(inserts).toEqual([]);
  });

  it("an honest claim at the ordered qty is unchanged", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(client([{ sku_id: A, order_qty: 1 }, { sku_id: C, order_qty: 3 }]) as never);
    await recordDelivery(actor, input({ skuId: C, expectedQty: 2, unitPrice: null }));
    expect(missingCredits()).toEqual([expect.objectContaining({ sku_id: C, qty: 2, amount_cents: null })]);
  });
});
