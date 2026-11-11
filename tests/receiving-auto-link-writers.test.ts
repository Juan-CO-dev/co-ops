import { beforeEach, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ link: vi.fn(), writes: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/email-receipts", () => ({ attemptReceivingAutoLink: mocks.link }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: vi.fn(async () => true), auditOperationalTaskOverride: vi.fn() }));
vi.mock("@/lib/prep-consumption", () => ({ loadMeasures: vi.fn(async () => new Map()), loadSkuPackChains: vi.fn(async () => new Map()) }));
import { recordDelivery, addDeliveryLines, completeDelivery, attachDeliveryReceipt } from "@/lib/receiving";
const shop = "11111111-1111-4111-8111-111111111111", sku = "22222222-2222-4222-8222-222222222222";
const vendor = "33333333-3333-4333-8333-333333333333", delivery = "44444444-4444-4444-8444-444444444444";
const actor = { user: { id: shop, role: "key_holder" }, locations: [shop], level: 4 } as AuthContext;
const lines = [{ skuId: sku, qtyReceived: 1 }];
beforeEach(() => {
  vi.clearAllMocks(); mocks.link.mockResolvedValue(undefined);
  mocks.client.mockReturnValue({ from(table: string) {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "is", "in", "gte", "order", "returns", "maybeSingle"]) q[op] = () => q;
    for (const op of ["insert", "update"]) q[op] = (value: unknown) => { mocks.writes(table, value); return q; };
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, count: 1, data:
      table === "vendors" ? { id: vendor, source_kind: "vendor" } :
      table === "vendor_deliveries" ? { id: delivery, vendor_id: vendor, location_id: shop, delivery_date: "2026-11-11", delivery_status: "in_progress", purchase_order_id: null, receipt_url: null } :
      table === "photos" ? { id: sku, location_id: shop } :
      table === "vendor_items" ? [{ id: sku, vendor_id: vendor, location_id: null, units_per_pack: 1, each_size: null, each_measure: null, avg_oz_per_each: null }] : []
    }).then(resolve);
    return q;
  } });
});
const writers = [
  ["recordDelivery", () => recordDelivery(actor, { locationId: shop, vendorId: vendor, deliveryDate: "2026-11-11", lines })],
  ["addDeliveryLines", () => addDeliveryLines(actor, delivery, lines)],
  ["completeDelivery", () => completeDelivery(actor, delivery)],
  ["attachDeliveryReceipt", () => attachDeliveryReceipt(actor, delivery, sku)],
] as const;
for (const [name, save] of writers) {
  it.each([false, true])(`${name} attempts matching after saving; rejected matching=%s cannot fail the save`, async rejects => {
    if (rejects) mocks.link.mockRejectedValue(new Error("auto-link unavailable"));
    await save();
    expect(mocks.writes).toHaveBeenCalled();
    expect(mocks.link).toHaveBeenCalledExactlyOnceWith(delivery);
    expect(mocks.writes.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.link.mock.invocationCallOrder[0]!);
  });
}
