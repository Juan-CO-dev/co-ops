/**
 * Audit W20/B193: after a person resolves a receipt's attribution (vendor mail "assign", or the
 * conflict "move"), the automatic delivery and order matching the parser skipped must run. It
 * never did, so the receipt sat in triage although one delivery or order was waiting for it.
 *
 * This file drives the REAL lib/email-receipts.ts against a small in-memory table set, so the
 * gates (resolved attribution, single candidate, only an invoice takes a delivery) are the
 * production ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

const mocks = vi.hoisted(() => ({ client: vi.fn(), audit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.client }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: vi.fn(async () => true), auditOperationalTaskOverride: vi.fn(), canTriageUnattributedReceipt: vi.fn(async () => true) }));
vi.mock("@/lib/purchase-orders", () => ({ autoPlaceOnEmailEvidence: vi.fn() }));

import { moveConflictedReceipt, runReceiptAutomation } from "@/lib/email-receipts";
import { assembleMatchBody } from "@/lib/email-receipts-matching-shared";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let loseMove = false;
function query(table: string) {
  const rows = tables[table] ?? [];
  const filters: ((r: Row) => boolean)[] = [];
  let patch: Row | undefined;
  let single = false;
  const q = {
    select: () => q, order: () => q, range: () => q, returns: () => q,
    eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
    is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
    in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return q; },
    gte: (k: string, v: string) => { filters.push(r => String(r[k]) >= v); return q; },
    lte: (k: string, v: string) => { filters.push(r => String(r[k]) <= v); return q; },
    lt: (k: string, v: string) => { filters.push(r => String(r[k]) < v); return q; },
    update: (v: Row) => { patch = v; return q; },
    maybeSingle: () => { single = true; return q; },
    then: (resolve: (v: unknown) => void) => {
      const lost = !!patch && loseMove && table === "email_receipts" && "attribution_conflict" in patch;
      const matched = lost ? [] : rows.filter(r => filters.every(f => f(r)));
      if (patch) matched.forEach(r => Object.assign(r, patch));
      resolve({ data: single ? (matched[0] ? { ...matched[0] } : null) : matched.map(r => ({ ...r })), error: null, count: matched.length });
    },
  };
  return q;
}
const receipt = (extra: Row = {}): Row => ({
  id: "r1", subject: "Invoice 42", parsed_json: { extraction: { docKind: "invoice" } }, doc_kind: "invoice",
  location_id: "shop", vendor_guess_id: "vendor", received_at: "2026-11-11T12:00:00.000Z",
  linked_delivery_id: null, linked_po_id: null, inbound_message_id: "m1", parse_state: "parsed",
  attribution_conflict: false, from_address: "billing@vendor.example", account_location_id: null, account_vendor_id: null, ...extra,
});
const gm = { user: { id: "gm", role: "gm" }, locations: ["shop", "old"] } as unknown as AuthContext;

beforeEach(() => {
  vi.clearAllMocks();
  loseMove = false;
  tables = {
    email_receipts: [receipt()],
    vendor_deliveries: [{ id: "d1", location_id: "shop", vendor_id: "vendor", delivery_date: "2026-11-11", email_receipt_id: null }],
    purchase_orders: [{ id: "po1", vendor_id: "vendor", location_id: "shop", status: "placed", placed_at: "2026-11-10T15:00:00.000Z", ack: null, display_code: "SHOP-20261110-VENDOR" }],
  };
  mocks.client.mockReturnValue({ from: query });
});

describe("runReceiptAutomation (B193)", () => {
  it("links the one waiting delivery and the one order in the window, as the system", async () => {
    await runReceiptAutomation("r1");
    expect(tables.email_receipts![0]).toMatchObject({ linked_delivery_id: "d1", linked_po_id: "po1" });
    expect(tables.vendor_deliveries![0]?.email_receipt_id).toBe("r1");
    expect(tables.purchase_orders![0]?.status).toBe("invoiced");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: null, action: "delivery.receipt_linked" }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: null, action: "receipt.po_linked", metadata: expect.objectContaining({ matched_by: "vendor_window" }) }));
  });
  it("finds the order by the parsed PO code when the subject does not carry it", async () => {
    tables.purchase_orders!.push({ id: "po2", vendor_id: "vendor", location_id: "shop", status: "placed", placed_at: "2026-11-11T09:00:00.000Z", ack: null, display_code: "SHOP-20261111-VENDOR" });
    tables.email_receipts = [receipt({ parsed_json: { extraction: { poCode: "SHOP-20261111-VENDOR" } } })];
    await runReceiptAutomation("r1");
    expect(tables.email_receipts[0]?.linked_po_id).toBe("po2");
  });
  it.each([
    ["still in conflict", { attribution_conflict: true }],
    ["no shop", { location_id: null }],
    ["not parsed yet", { parse_state: "unparsed" }],
  ])("does nothing while the receipt is %s", async (_, extra) => {
    tables.email_receipts = [receipt(extra)];
    await runReceiptAutomation("r1");
    expect(tables.email_receipts[0]).toMatchObject({ linked_delivery_id: null, linked_po_id: null });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("a confirmation fills the order's acknowledgement but never takes the delivery (B112)", async () => {
    tables.email_receipts = [receipt({ doc_kind: "confirmation" })];
    await runReceiptAutomation("r1");
    expect(tables.email_receipts[0]).toMatchObject({ linked_delivery_id: null, linked_po_id: "po1" });
    expect(tables.vendor_deliveries![0]?.email_receipt_id).toBeNull();
    expect(tables.purchase_orders![0]).toMatchObject({ status: "placed", ack: expect.objectContaining({ receiptId: "r1" }) });
  });
  it("two candidate deliveries stay with a person", async () => {
    tables.vendor_deliveries!.push({ id: "d2", location_id: "shop", vendor_id: "vendor", delivery_date: "2026-11-12", email_receipt_id: null });
    await runReceiptAutomation("r1");
    expect(tables.email_receipts![0]?.linked_delivery_id).toBeNull();
  });
  it("never throws, whatever the database does", async () => {
    mocks.client.mockReturnValue({ from: () => { throw new Error("database is down"); } });
    await expect(runReceiptAutomation("r1")).resolves.toBeUndefined();
    mocks.client.mockImplementation(() => { throw new Error("no client"); });
    await expect(runReceiptAutomation("r1")).resolves.toBeUndefined();
  });
});

describe("moving a conflicted receipt runs the matching it was waiting for (B193)", () => {
  const conflicted = () => receipt({ location_id: "old", vendor_guess_id: "sender", account_location_id: "shop", account_vendor_id: "vendor", attribution_conflict: true });
  it("a successful move links the delivery and the order at the new shop", async () => {
    tables.email_receipts = [conflicted()];
    await moveConflictedReceipt(gm, "r1");
    expect(tables.email_receipts[0]).toMatchObject({ location_id: "shop", vendor_guess_id: "vendor", attribution_conflict: false,
      attributed_by: "manual", linked_delivery_id: "d1", linked_po_id: "po1" });
    const actions = mocks.audit.mock.calls.map(c => (c[0] as { action: string }).action);
    expect(actions[0]).toBe("receipt.location_moved");
    expect(actions).toEqual(expect.arrayContaining(["delivery.receipt_linked", "receipt.po_linked"]));
  });
  it("a lost compare-and-set runs nothing", async () => {
    tables.email_receipts = [conflicted()];
    loseMove = true;
    await expect(moveConflictedReceipt(gm, "r1")).rejects.toMatchObject({ status: 409, code: "conflict_changed" });
    expect(tables.email_receipts[0]).toMatchObject({ location_id: "old", linked_delivery_id: null, linked_po_id: null });
    expect(tables.vendor_deliveries![0]?.email_receipt_id).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe("assembleMatchBody: one builder for the parse leg and the re-run", () => {
  it("joins the parsed fields and the optional raw text, ignoring non-strings", () => {
    expect(assembleMatchBody({ poCode: "A-20261111-V", shipTo: "Shop", vendorName: "Vendor" }, "raw text")).toBe("A-20261111-V \n Shop \n Vendor \n raw text");
    expect(assembleMatchBody({ poCode: { injected: true }, shipTo: 7, vendorName: "Vendor" }, null)).toBe("Vendor");
    expect(assembleMatchBody(null, null)).toBe("");
    expect(assembleMatchBody(undefined, "raw")).toBe("raw");
  });
});
