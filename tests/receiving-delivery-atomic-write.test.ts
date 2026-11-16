/**
 * Audit W20/B197: recordDelivery wrote the delivery header, then its lines, then its credits, as
 * separate requests. A failed line insert left an EMPTY delivery behind, and with an invoice
 * number the retry then answered "already received".
 *
 * Three pieces are pinned here:
 *   1. the shape check both intake routes run (a bad line is a 400 before any write);
 *   2. the single atomic write (record_delivery_atomic, migration 0327) and its payload;
 *   3. the fallback while 0327 is not applied (the previous four-step write, unchanged).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "user", role: "key_holder" }, locations: ["11111111-1111-4111-8111-111111111111"] })) }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: vi.fn(async () => true), auditOperationalTaskOverride: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email-receipts", () => ({ attemptReceivingAutoLink: vi.fn(async () => {}) }));
vi.mock("@/lib/purchase-orders", () => ({ advanceToReceived: vi.fn(async () => {}) }));
vi.mock("@/lib/credits", () => ({ resolveCreditsRedelivered: vi.fn(), loadOpenCreditRowsForVendor: vi.fn() }));
vi.mock("@/lib/prep-consumption", () => ({ loadMeasures: vi.fn(async () => new Map()), loadSkuPackChains: vi.fn(async () => new Map()) }));

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { attemptReceivingAutoLink } from "@/lib/email-receipts";
import { advanceToReceived } from "@/lib/purchase-orders";
import { recordDelivery } from "@/lib/receiving";
import { parseDeliveryLineInputs, rpcNotInstalled } from "@/lib/receiving-shared";
import { POST as createPOST } from "@/app/api/operations/receiving/route";
import { POST as continuePOST } from "@/app/api/operations/receiving/continue/route";

const SHOP = "11111111-1111-4111-8111-111111111111";
const VENDOR = "44444444-4444-4444-8444-444444444444";
const A = "55555555-5555-4555-8555-555555555555";
const B = "66666666-6666-4666-8666-666666666666";
const C = "77777777-7777-4777-8777-777777777777";
const PO = "88888888-8888-4888-8888-888888888888";
const PHOTO = "99999999-9999-4999-8999-999999999999";
const actor = { user: { id: "user", role: "key_holder" }, locations: [SHOP] } as never;

type RpcCall = { fn: string; args: Record<string, unknown> };
let rpcCalls: RpcCall[] = [];
let inserts: Array<{ table: string; rows: unknown }> = [];
function client(opts: { atomic?: { data?: unknown; error?: { code?: string; message?: string } | null }; poLines?: Array<{ sku_id: string; order_qty: number }>; itemsBack?: unknown[] } = {}) {
  return {
    from(table: string) {
      let ids: unknown[] = [];
      const q: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "order", "not", "gte", "update", "limit"]) q[op] = () => q;
      q.in = (_c: string, v: unknown[]) => { ids = v; return q; };
      q.insert = (rows: unknown) => { inserts.push({ table, rows }); return q; };
      q.returns = () => q;
      q.maybeSingle = () => q;
      q.then = (resolve: (value: unknown) => unknown) => {
        let data: unknown = [];
        if (table === "vendors") data = { id: VENDOR, source_kind: "vendor" };
        else if (table === "purchase_orders") data = { id: PO, vendor_id: VENDOR, location_id: SHOP, status: "placed" };
        else if (table === "photos") data = [{ id: PHOTO, location_id: SHOP }];
        else if (table === "vendor_deliveries") data = inserts.some((i) => i.table === "vendor_deliveries") ? { id: "legacy-delivery" } : [];
        else if (table === "po_lines") data = (opts.poLines ?? []).filter((l) => ids.includes(l.sku_id));
        else if (table === "vendor_delivery_items") data = opts.itemsBack ?? [];
        else if (table === "vendor_items") data = ids.map((id) => ({ id, vendor_id: VENDOR, location_id: null, pack_format: null,
          each_container_label: null, units_per_pack: 1, each_size: null, each_measure: null, avg_oz_per_each: null, weight_class: null }));
        return Promise.resolve({ data, error: null, count: 1 }).then(resolve);
      };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "record_delivery_atomic") return { data: null, error: null, ...(opts.atomic ?? { data: { delivery_id: "atomic-delivery", item_ids: ["i1", "i2", "i3"] } }) };
      return { data: null, error: null };
    },
  };
}
const use = (c: ReturnType<typeof client>) => vi.mocked(getServiceRoleClient).mockReturnValue(c as never);
const input = (extra: Record<string, unknown> = {}) => ({
  locationId: SHOP, vendorId: VENDOR, deliveryDate: "2026-11-14", invoiceNumber: " INV-1 ", invoiceTotal: 99.5, notes: " dock 2 ",
  purchaseOrderId: PO, receiptUrl: `/api/photos/${PHOTO}`,
  lines: [
    { skuId: A, qtyReceived: 4, expectedQty: 5, unitPrice: 12.5, discrepancyType: "short" as const, receivedLevelLabel: " case ", notes: " one crushed " },
    { skuId: B, qtyReceived: 2 },
    { skuId: C, qtyReceived: 6, expectedQty: 4, unitPrice: 2, discrepancyType: "over" as const, photoUrl: `/api/photos/${PHOTO}` },
  ],
  ...extra,
});
const atomicCall = () => rpcCalls.find((c) => c.fn === "record_delivery_atomic")!;

beforeEach(() => { rpcCalls = []; inserts = []; vi.clearAllMocks(); });

describe("parseDeliveryLineInputs: one shape check for both routes", () => {
  const good = { skuId: A, qtyReceived: 2 };
  it("fills every optional field with null and keeps the values", () => {
    expect(parseDeliveryLineInputs([good, { ...good, unitPrice: 1.5, notes: "n", receivedLevelLabel: "case", photoUrl: "/api/photos/x", expectedQty: 3, observedOzPerEach: 8, discrepancyType: "damaged" }]))
      .toEqual({ ok: true, lines: [
        { skuId: A, qtyReceived: 2, unitPrice: null, observedOzPerEach: null, notes: null, receivedLevelLabel: null, photoUrl: null, expectedQty: null, discrepancyType: null },
        { skuId: A, qtyReceived: 2, unitPrice: 1.5, observedOzPerEach: 8, notes: "n", receivedLevelLabel: "case", photoUrl: "/api/photos/x", expectedQty: 3, discrepancyType: "damaged" },
      ] });
    expect(parseDeliveryLineInputs([])).toEqual({ ok: true, lines: [] });
  });
  it.each([
    ["lines", "not an array"], ["lines", [null]], ["lines", ["x"]], ["lines", [[good]]],
    ["lines[].skuId", [{ ...good, skuId: 7 }]], ["lines[].skuId", [{ ...good, skuId: "not-a-uuid" }]],
    ["lines[].qtyReceived", [{ ...good, qtyReceived: "2" }]],
    ["lines[].unitPrice", [{ ...good, unitPrice: "1" }]],
    ["lines[].observedOzPerEach", [{ ...good, observedOzPerEach: {} }]],
    ["lines[].notes", [{ ...good, notes: 123 }]],
    ["lines[].receivedLevelLabel", [{ ...good, receivedLevelLabel: 5 }]],
    ["lines[].photoUrl", [{ ...good, photoUrl: { href: "x" } }]],
    ["lines[].expectedQty", [{ ...good, expectedQty: "4" }]],
    ["lines[].discrepancyType", [{ ...good, discrepancyType: "bogus" }]],
    ["lines[].discrepancyType", [{ ...good, discrepancyType: 1 }]],
    ["lines[].discrepancyType", [good, { ...good, discrepancyType: "SHORT" }]],
  ])("names %s for a malformed line", (field, raw) => {
    expect(parseDeliveryLineInputs(raw)).toEqual({ ok: false, field });
  });
});

describe("both intake routes refuse a malformed line before any write (the B197 repro)", () => {
  const post = (path: string, body: unknown) => new NextRequest(`https://co-ops.test${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://co-ops.test", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) });
  it.each([
    ["a bogus discrepancy flag", { discrepancyType: "bogus" }, "lines[].discrepancyType"],
    ["a numeric note", { notes: 123 }, "lines[].notes"],
    ["a non-text photo", { photoUrl: 9 }, "lines[].photoUrl"],
  ])("create: %s is 400 and never reaches the database", async (_, bad, field) => {
    use(client());
    const res = await createPOST(post("/api/operations/receiving", { vendorId: VENDOR, locationId: SHOP, deliveryDate: "2026-11-14", invoiceNumber: "INV-1",
      lines: [{ skuId: A, qtyReceived: 1 }, { skuId: B, qtyReceived: 1, ...bad }] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_payload", field });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
    expect(inserts).toEqual([]); expect(rpcCalls).toEqual([]);
  });
  it("continue: the same check, the same field names", async () => {
    use(client());
    const res = await continuePOST(post("/api/operations/receiving/continue", { deliveryId: "d", lines: [{ skuId: A, qtyReceived: 1, discrepancyType: "bogus" }] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_payload", field: "lines[].discrepancyType" });
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });
  it("create: a well-formed request still reaches the writer with the parsed lines", async () => {
    use(client());
    const res = await createPOST(post("/api/operations/receiving", { vendorId: VENDOR, locationId: SHOP, deliveryDate: "2026-11-14", lines: [{ skuId: A, qtyReceived: 1 }] }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ deliveryId: "atomic-delivery" });
    expect(rpcCalls.map((c) => c.fn)).toEqual(["record_delivery_atomic"]);
    expect((atomicCall().args.p_lines as unknown[])).toEqual([expect.objectContaining({ vendor_item_id: A, qty_received: 1, discrepancy_type: null, notes: null })]);
  });
});

describe("recordDelivery writes a new delivery in one transaction (0327)", () => {
  it("sends the header, the lines in order, and the credits to ONE call, and inserts nothing itself", async () => {
    use(client({ poLines: [{ sku_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", order_qty: 3 }] }));
    const result = await recordDelivery(actor, input({ missingLines: [{ skuId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedQty: 9, unitPrice: 2 }] }));
    expect(result.deliveryId).toBe("atomic-delivery");
    expect(inserts).toEqual([]);
    expect(rpcCalls.filter((c) => c.fn === "record_delivery_atomic")).toHaveLength(1);
    const { p_header, p_lines, p_line_credits, p_missing_credits } = atomicCall().args as { p_header: Record<string, unknown>; p_lines: Array<Record<string, unknown>>; p_line_credits: unknown[]; p_missing_credits: unknown[] };
    expect(p_header).toEqual({ vendor_id: VENDOR, location_id: SHOP, delivery_date: "2026-11-14", invoice_number: "INV-1", invoice_total: 99.5,
      notes: "dock 2", note: "dock 2", receipt_url: `/api/photos/${PHOTO}`, received_by: "user", delivery_status: "complete", purchase_order_id: PO });
    expect(p_lines.map((l) => l.vendor_item_id)).toEqual([A, B, C]);
    expect(p_lines[0]).toEqual({ vendor_item_id: A, qty_received: 4, vendor_id: VENDOR, unit_price: 12.5, observed_oz_per_each: null, notes: "one crushed",
      created_by: "user", received_level_label: "case", received_qty_at_level: 4, resolved_oz: null, note: "one crushed", photo_url: null, expected_qty: 5, discrepancy_type: "short" });
    expect(p_lines[2]).toMatchObject({ photo_url: `/api/photos/${PHOTO}`, received_level_label: null, received_qty_at_level: null });
    expect(p_lines.every((l) => !("delivery_id" in l))).toBe(true);
    // Credits name their line by position (1-based), never by an id that does not exist yet.
    // Line 1 was received at a level with no chain to place it: its amount is a judgment call (null).
    expect(p_line_credits).toEqual([
      { line_index: 1, reason: "short", sku_id: A, qty: 1, amount_cents: null },
      { line_index: 3, reason: "over", sku_id: C, qty: 2, amount_cents: 400 },
    ]);
    // The missing-item claim is still capped at what the PO ordered (W04/B148).
    expect(p_missing_credits).toEqual([{ reason: "short", sku_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", qty: 3, amount_cents: 600 }]);
  });
  it("runs the follow-ups against the new delivery, after the write", async () => {
    use(client());
    await recordDelivery(actor, input());
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "delivery.received", resourceId: "atomic-delivery",
      metadata: expect.objectContaining({ line_count: 3, priced_lines: 2, missing_expected_credits: 0, purchase_order_id: PO }) }));
    expect(advanceToReceived).toHaveBeenCalledWith(expect.anything(), PO);
    expect(attemptReceivingAutoLink).toHaveBeenCalledExactlyOnceWith("atomic-delivery");
    expect(rpcCalls.map((c) => c.fn)).toEqual(["record_delivery_atomic", "record_receiving_prices"]);
  });
  it("a duplicate-invoice refusal from the database is the same 409, with nothing else attempted", async () => {
    use(client({ atomic: { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "vendor_deliveries_dedupe_uq"' } } }));
    await expect(recordDelivery(actor, input())).rejects.toMatchObject({ status: 409, code: "duplicate_delivery" });
    expect(inserts).toEqual([]);
    expect(rpcCalls.map((c) => c.fn)).toEqual(["record_delivery_atomic"]);
    expect(audit).not.toHaveBeenCalled();
  });
  it.each([
    ["a check violation", { code: "23514", message: "violates check constraint" }],
    ["a duplicate credit pair", { code: "23505", message: 'duplicate key value violates unique constraint "vendor_credits_line_reason_uq"' }],
    ["a refused payload", { code: "P0001", message: "invalid_input" }],
  ])("%s fails the save (never the non-atomic fallback)", async (_, error) => {
    use(client({ atomic: { data: null, error } }));
    await expect(recordDelivery(actor, input())).rejects.toThrow(/recordDelivery write/);
    expect(inserts).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
    expect(attemptReceivingAutoLink).not.toHaveBeenCalled();
  });
  it("an answer with no delivery id is an error, never a silent success", async () => {
    use(client({ atomic: { data: null, error: null } }));
    await expect(recordDelivery(actor, input())).rejects.toThrow(/returned no delivery id/);
    expect(inserts).toEqual([]);
  });
});

describe("before 0327 is applied the door keeps working (fallback)", () => {
  it.each([{ code: "PGRST202", message: "Could not find the function public.record_delivery_atomic" }, { code: "42883", message: "function does not exist" }])(
    "a missing function ($code) falls back to the previous header, lines, credits writes", async (error) => {
      use(client({ atomic: { data: null, error }, itemsBack: [
        { id: "item-1", vendor_item_id: A, received_qty_at_level: null, qty_received: 6, expected_qty: 4, unit_price: 2, discrepancy_type: "over", received_level_label: null },
      ] }));
      const result = await recordDelivery(actor, input({ lines: [{ skuId: A, qtyReceived: 6, expectedQty: 4, unitPrice: 2, discrepancyType: "over" as const }] }));
      expect(result.deliveryId).toBe("legacy-delivery");
      expect(inserts.map((i) => i.table)).toEqual(["vendor_deliveries", "vendor_delivery_items", "vendor_credits"]);
      expect(inserts[1]!.rows).toEqual([expect.objectContaining({ delivery_id: "legacy-delivery", vendor_item_id: A, qty_received: 6 })]);
      expect(inserts[2]!.rows).toEqual([expect.objectContaining({ delivery_id: "legacy-delivery", delivery_item_id: "item-1", reason: "over", qty: 2, amount_cents: 400 })]);
      expect(attemptReceivingAutoLink).toHaveBeenCalledExactlyOnceWith("legacy-delivery");
    });
  it("rpcNotInstalled is true only for a missing function", () => {
    expect(rpcNotInstalled({ code: "PGRST202" })).toBe(true);
    expect(rpcNotInstalled({ code: "42883" })).toBe(true);
    expect(rpcNotInstalled({ message: "Could not find the function public.x in the schema cache" })).toBe(true);
    expect(rpcNotInstalled({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(rpcNotInstalled({ code: "P0001", message: "invalid_input" })).toBe(false);
    expect(rpcNotInstalled(null)).toBe(false);
  });
});
