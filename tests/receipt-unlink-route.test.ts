/** W20-2: PATCH action=unlink on the receiving email-receipts route (manager only, reason required). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ unlink: vi.fn(), role: "agm" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u", role: mocks.role }, locations: ["shop"] })) }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/receipt-parse", () => ({ parseReceiptForActor: vi.fn() }));
vi.mock("@/lib/email-receipts", () => {
  class EmailReceiptError extends Error { constructor(public status: number, public code: string) { super(code); } }
  return { EmailReceiptError, RECEIPT_MIN: 4, RECEIPT_OVERRIDE_MIN: 6, unlinkReceipt: mocks.unlink, listUnlinkedReceipts: vi.fn(),
    moveConflictedReceipt: vi.fn(), uploadManualReceipt: vi.fn(), linkReceipt: vi.fn(), attestMatch: vi.fn(), overrideMatch: vi.fn(),
    attachReceiptToPo: vi.fn(), loadPoCandidatesForReceipt: vi.fn() };
});

import { PATCH } from "@/app/api/operations/receiving/email-receipts/route";
import { EmailReceiptError } from "@/lib/email-receipts";

const RECEIPT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const patch = (body: unknown, headers: Record<string, string> = { origin: "https://co-ops.test", "sec-fetch-site": "same-origin" }) =>
  PATCH(new NextRequest("https://co-ops.test/api/operations/receiving/email-receipts", { method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

beforeEach(() => { vi.clearAllMocks(); mocks.role = "agm"; mocks.unlink.mockResolvedValue(undefined); });

describe("PATCH action=unlink", () => {
  it("passes the delivery, the reason and the receipt on screen to the lib", async () => {
    const res = await patch({ action: "unlink", deliveryId: "d1", note: "wrong document", receiptId: RECEIPT });
    expect(res.status).toBe(200);
    expect(mocks.unlink).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ user: expect.objectContaining({ role: "agm" }) }), "d1", "wrong document", RECEIPT);
  });
  it("works without naming a receipt", async () => {
    await patch({ action: "unlink", deliveryId: "d1", note: "wrong document" });
    expect(mocks.unlink).toHaveBeenCalledWith(expect.anything(), "d1", "wrong document", null);
  });
  it.each(["key_holder", "shift_lead"])("a %s is refused at the door", async role => {
    mocks.role = role;
    const res = await patch({ action: "unlink", deliveryId: "d1", note: "wrong document" });
    expect(res.status).toBe(403);
    expect(mocks.unlink).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "   ", 7])("a missing reason (%j) is 400 unlink_note_required", async note => {
    const res = await patch({ action: "unlink", deliveryId: "d1", note });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "unlink_note_required" });
    expect(mocks.unlink).not.toHaveBeenCalled();
  });
  it.each(["not-a-uuid", 5, {}])("a malformed receiptId (%j) is 400", async receiptId => {
    const res = await patch({ action: "unlink", deliveryId: "d1", note: "wrong document", receiptId });
    expect(res.status).toBe(400);
    expect(mocks.unlink).not.toHaveBeenCalled();
  });
  it("needs a delivery", async () => {
    expect((await patch({ action: "unlink", note: "wrong document" })).status).toBe(400);
    expect(mocks.unlink).not.toHaveBeenCalled();
  });
  it("is same-origin only", async () => {
    const res = await patch({ action: "unlink", deliveryId: "d1", note: "wrong document" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
    expect(mocks.unlink).not.toHaveBeenCalled();
  });
  it.each([[503, "unlink_unavailable"], [409, "receipt_changed"], [409, "no_receipt"]])("returns the lib's %s %s by code", async (status, code) => {
    mocks.unlink.mockRejectedValue(new EmailReceiptError(status, code));
    const res = await patch({ action: "unlink", deliveryId: "d1", note: "wrong document" });
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
  });
});
