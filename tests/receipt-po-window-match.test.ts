/**
 * Audit W20/B113: when an invoice carries no PO code, the fallback looks for the vendor's ONE
 * order near the invoice's date. It only looked at orders still open (placed / invoiced), so the
 * order the invoice was really for (already received at the door) was invisible, the NEXT open
 * order became the single candidate, and it was linked and marked "invoiced" by the wrong
 * document. The window now also sees received and reconciled orders.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: vi.fn(), auditOperationalTaskOverride: vi.fn(), canTriageUnattributedReceipt: vi.fn() }));
vi.mock("@/lib/purchase-orders", () => ({ autoPlaceOnEmailEvidence: vi.fn() }));

import { applyReceiptPoEffects, matchReceiptToPo } from "@/lib/email-receipts";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let updates: Array<{ table: string; patch: Row; count: number }>;
const sb = { from(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let patch: Row | undefined;
  let single = false;
  const q = {
    select: () => q, returns: () => q,
    eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
    is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
    in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return q; },
    gte: (k: string, v: string) => { filters.push(r => r[k] != null && String(r[k]) >= v); return q; },
    lte: (k: string, v: string) => { filters.push(r => r[k] != null && String(r[k]) <= v); return q; },
    update: (v: Row) => { patch = v; return q; },
    maybeSingle: () => { single = true; return q; },
    then: (resolve: (v: unknown) => void) => {
      const matched = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
      if (patch) { updates.push({ table, patch, count: matched.length }); matched.forEach(r => Object.assign(r, patch)); }
      resolve({ data: single ? (matched[0] ? { ...matched[0] } : null) : matched.map(r => ({ ...r })), error: null, count: matched.length });
    },
  };
  return q;
} } as unknown as SupabaseClient;

const po = (id: string, status: string, placed_at: string, extra: Row = {}): Row =>
  ({ id, vendor_id: "vendor", location_id: "shop", status, placed_at, ack: null, display_code: `SHOP-${id}`, ...extra });
// Wednesday 2026-11-11: the vendor's invoice for Monday's order arrives, with no PO code on it.
const WED = "2026-11-11T16:00:00.000Z";
const receiptInput = { id: "r1", subject: "Invoice 88421", body: null, vendorGuessId: "vendor", locationId: "shop", receivedAt: WED };

beforeEach(() => {
  vi.clearAllMocks();
  updates = [];
  tables = {
    email_receipts: [{ id: "r1", inbound_message_id: "m1", parse_state: "parsed", attribution_conflict: false, location_id: "shop",
      linked_po_id: null, doc_kind: "invoice", from_address: "billing@vendor.example", received_at: WED }],
    purchase_orders: [],
  };
});

describe("B113 vendor + date-range fallback", () => {
  it("a late invoice sees its received order and goes to a person when another order is open", async () => {
    tables.purchase_orders = [po("PO1", "received", "2026-11-09T15:00:00.000Z"), po("PO2", "placed", "2026-11-11T14:00:00.000Z")];
    await expect(matchReceiptToPo(sb, receiptInput)).resolves.toBeNull();
    expect(updates).toEqual([]);
    expect(tables.email_receipts![0]?.linked_po_id).toBeNull();
    // Nothing linked, so nothing is marked invoiced either.
    await applyReceiptPoEffects(sb, "r1", null);
    expect(tables.purchase_orders.map(p => p.status)).toEqual(["received", "placed"]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(["received", "reconciled"])("a late invoice with only its %s order links, and the order's status does not move", async status => {
    tables.purchase_orders = [po("PO1", status, "2026-11-09T15:00:00.000Z")];
    await expect(matchReceiptToPo(sb, receiptInput)).resolves.toEqual({ poId: "PO1", matchedBy: "vendor_window" });
    expect(tables.email_receipts![0]?.linked_po_id).toBe("PO1");
    await applyReceiptPoEffects(sb, "r1", "vendor_window");
    expect(tables.purchase_orders[0]?.status).toBe(status);
    // The guarded placed -> invoiced flip is issued and matches nothing.
    expect(updates.filter(u => u.table === "purchase_orders")).toEqual([{ table: "purchase_orders", patch: { status: "invoiced" }, count: 0 }]);
  });
  it("the ordinary case is unchanged: one open order links and is marked invoiced", async () => {
    tables.purchase_orders = [po("PO2", "placed", "2026-11-11T14:00:00.000Z")];
    await expect(matchReceiptToPo(sb, receiptInput)).resolves.toEqual({ poId: "PO2", matchedBy: "vendor_window" });
    await applyReceiptPoEffects(sb, "r1", "vendor_window");
    expect(tables.purchase_orders[0]?.status).toBe("invoiced");
  });
  it.each(["draft", "confirmed", "cancelled"])("a %s order is never a date-range candidate (a guess never places an order nobody sent)", async status => {
    tables.purchase_orders = [po("PO0", status, "2026-11-10T15:00:00.000Z"), po("PO2", "placed", "2026-11-11T14:00:00.000Z")];
    await expect(matchReceiptToPo(sb, receiptInput)).resolves.toEqual({ poId: "PO2", matchedBy: "vendor_window" });
  });
  it("another shop's or another vendor's order is not a candidate", async () => {
    tables.purchase_orders = [po("PO1", "received", "2026-11-09T15:00:00.000Z", { location_id: "other" }),
      po("PO3", "received", "2026-11-09T15:00:00.000Z", { vendor_id: "other" }), po("PO2", "placed", "2026-11-11T14:00:00.000Z")];
    await expect(matchReceiptToPo(sb, receiptInput)).resolves.toEqual({ poId: "PO2", matchedBy: "vendor_window" });
  });
  it("an order placed more than three days away is outside the range", async () => {
    tables.purchase_orders = [po("PO1", "received", "2026-11-07T15:00:00.000Z"), po("PO2", "placed", "2026-11-11T14:00:00.000Z")];
    await expect(matchReceiptToPo(sb, receiptInput)).resolves.toEqual({ poId: "PO2", matchedBy: "vendor_window" });
  });
});
