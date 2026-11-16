/**
 * Audit W20/B198: the "already received" pre-check compared the invoice number with ILIKE on the
 * RAW text, so `_` and `%` were wildcards (and PostgREST also turns `*` into `%`): "INV_1001" was
 * refused as a duplicate of "INV-1001", and a pattern matching two rows was a 500. The check now
 * reads the vendor's same-day invoice numbers and compares them exactly (case-insensitive), the
 * same identity as the 0169 index key lower(invoice_number).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: vi.fn(async () => true), auditOperationalTaskOverride: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email-receipts", () => ({ attemptReceivingAutoLink: vi.fn(async () => {}) }));
vi.mock("@/lib/prep-consumption", () => ({ loadMeasures: vi.fn(async () => new Map()), loadSkuPackChains: vi.fn(async () => new Map()) }));

import { getServiceRoleClient } from "@/lib/supabase-server";
import { recordDelivery } from "@/lib/receiving";
import { sameInvoiceNumber } from "@/lib/receiving-shared";

const SHOP = "11111111-1111-4111-8111-111111111111";
const VENDOR = "44444444-4444-4444-8444-444444444444";
const actor = { user: { id: "user", role: "key_holder" }, locations: [SHOP] } as never;

let calls: string[] = [];
function client(existing: Array<{ id: string; invoice_number: string; delivery_status: string }>) {
  return { from(table: string) {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "is", "not", "order", "in", "limit", "range", "returns", "maybeSingle"]) {
      q[op] = () => { if (table === "vendor_deliveries") calls.push(op); return q; };
    }
    q.ilike = () => { calls.push("ilike"); return q; };
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null,
      data: table === "vendors" ? { id: VENDOR, source_kind: "vendor" } : table === "vendor_deliveries" ? existing : [] }).then(resolve);
    return q;
  } };
}
// No lines: a delivery that PASSES the duplicate check stops at the next gate (400 no_lines),
// before any write, so the test never needs the rest of the save.
const save = (invoiceNumber: string) => recordDelivery(actor, { locationId: SHOP, vendorId: VENDOR, deliveryDate: "2026-11-14", invoiceNumber, lines: [] });

beforeEach(() => { calls = []; vi.clearAllMocks(); });

describe("sameInvoiceNumber", () => {
  it("is exact apart from case and outer spaces", () => {
    expect(sameInvoiceNumber("INV-1001", " inv-1001 ")).toBe(true);
    expect(sameInvoiceNumber("INV_1001", "INV-1001")).toBe(false);
    expect(sameInvoiceNumber("INV%", "INV-1001")).toBe(false);
    expect(sameInvoiceNumber("INV*", "INV-1001")).toBe(false);
    expect(sameInvoiceNumber("1_", "10")).toBe(false);
    expect(sameInvoiceNumber(String.raw`a\b`, String.raw`A\B`)).toBe(true);
    expect(sameInvoiceNumber(null, "10")).toBe(false);
    expect(sameInvoiceNumber("", "")).toBe(false);
  });
});

describe("W20/B198 the delivery duplicate check", () => {
  it("still refuses the same invoice number in another case", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(client([{ id: "d1", invoice_number: "INV-1001", delivery_status: "complete" }]) as never);
    await expect(save("inv-1001")).rejects.toMatchObject({ status: 409, code: "duplicate_delivery" });
  });
  it.each(["INV_1001", "INV%", "INV*1001", "%"])("does not treat %s as a pattern", async (invoice) => {
    vi.mocked(getServiceRoleClient).mockReturnValue(client([{ id: "d1", invoice_number: "INV-1001", delivery_status: "complete" }]) as never);
    await expect(save(invoice)).rejects.toMatchObject({ status: 400, code: "no_lines" });
  });
  it("a number that used to match two rows is no longer an error", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(client([
      { id: "d1", invoice_number: "10", delivery_status: "complete" }, { id: "d2", invoice_number: "11", delivery_status: "complete" },
    ]) as never);
    await expect(save("1_")).rejects.toMatchObject({ status: 400, code: "no_lines" });
  });
  it("names an in-progress match as one to continue", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(client([
      { id: "other", invoice_number: "A-1", delivery_status: "complete" }, { id: "d2", invoice_number: "B-2", delivery_status: "in_progress" },
    ]) as never);
    await expect(save("b-2")).rejects.toMatchObject({ status: 409, code: "duplicate_delivery", message: expect.stringContaining("d2") });
  });
  it("never sends the invoice number as a pattern, and never asks for a single row", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(client([]) as never);
    await expect(save("INV_1001")).rejects.toMatchObject({ code: "no_lines" });
    expect(calls).not.toContain("ilike");
    expect(calls).not.toContain("maybeSingle");
    expect(calls).toContain("not"); // only deliveries that carry an invoice number
  });
});
