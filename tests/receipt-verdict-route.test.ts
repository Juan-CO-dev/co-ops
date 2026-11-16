/**
 * Review W20-r1 (B114): a match verdict names the receipt the person compared.
 *
 * A key holder opens a delivery and compares receipt A. A manager unlinks A and links B. The key
 * holder then taps "Matches": the request used to carry only the delivery, so the verdict landed
 * on B using A's comparison. The page now sends the receipt on screen with the verdict, the route
 * passes it to the lib, and the lib (and delivery_match_verdict, 0327) refuse `receipt_changed`.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const mocks = vi.hoisted(() => ({ attest: vi.fn(), override: vi.fn(), role: "agm" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ requireSession: vi.fn(async () => ({ user: { id: "u", role: mocks.role }, locations: ["shop"] })) }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: vi.fn(() => ({ ok: true })) }));
vi.mock("@/lib/receipt-parse", () => ({ parseReceiptForActor: vi.fn() }));
vi.mock("@/lib/email-receipts", () => {
  class EmailReceiptError extends Error { constructor(public status: number, public code: string) { super(code); } }
  return { EmailReceiptError, RECEIPT_MIN: 4, RECEIPT_OVERRIDE_MIN: 6, unlinkReceipt: vi.fn(), listUnlinkedReceipts: vi.fn(),
    moveConflictedReceipt: vi.fn(), uploadManualReceipt: vi.fn(), linkReceipt: vi.fn(), attestMatch: mocks.attest, overrideMatch: mocks.override,
    attachReceiptToPo: vi.fn(), loadPoCandidatesForReceipt: vi.fn() };
});

import { PATCH } from "@/app/api/operations/receiving/email-receipts/route";
import { EmailReceiptError } from "@/lib/email-receipts";

const RECEIPT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const patch = (body: unknown) =>
  PATCH(new NextRequest("https://co-ops.test/api/operations/receiving/email-receipts", { method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://co-ops.test", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body) }));

beforeEach(() => { vi.clearAllMocks(); mocks.role = "agm"; mocks.attest.mockResolvedValue(undefined); mocks.override.mockResolvedValue(undefined); });

describe("PATCH action=attest carries the receipt on screen", () => {
  it("passes the delivery, verdict, note and the receipt compared to the lib", async () => {
    mocks.role = "key_holder";
    const res = await patch({ action: "attest", deliveryId: "d1", verdict: "discrepant", note: "short 2 cases", receiptId: RECEIPT });
    expect(res.status).toBe(200);
    expect(mocks.attest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ user: expect.objectContaining({ role: "key_holder" }) }), "d1", "discrepant", "short 2 cases", RECEIPT);
  });
  it("a request that names no receipt still works (the lib judges it on the receipt it reads)", async () => {
    await patch({ action: "attest", deliveryId: "d1", verdict: "matched" });
    expect(mocks.attest).toHaveBeenCalledExactlyOnceWith(expect.anything(), "d1", "matched", undefined, null);
  });
  it.each(["not-a-uuid", 5, {}, ""])("a malformed receiptId (%j) is 400 and reaches no writer", async receiptId => {
    const res = await patch({ action: "attest", deliveryId: "d1", verdict: "matched", receiptId });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_payload", field: "receiptId" });
    expect(mocks.attest).not.toHaveBeenCalled();
  });
  it.each([[409, "receipt_changed"], [409, "match_changed"], [409, "already_overridden"], [503, "verdict_note_unavailable"]])("returns the lib's %s %s by code", async (status, code) => {
    mocks.attest.mockRejectedValue(new EmailReceiptError(status, code));
    const res = await patch({ action: "attest", deliveryId: "d1", verdict: "matched", receiptId: RECEIPT });
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
  });
});

describe("PATCH action=override carries the receipt on screen", () => {
  it("passes the delivery, the note and the receipt on screen to the lib", async () => {
    const res = await patch({ action: "override", deliveryId: "d1", note: "accepted per vendor call", receiptId: RECEIPT });
    expect(res.status).toBe(200);
    expect(mocks.override).toHaveBeenCalledExactlyOnceWith(expect.anything(), "d1", "accepted per vendor call", RECEIPT);
  });
  it("works without naming a receipt", async () => {
    await patch({ action: "override", deliveryId: "d1", note: "no paperwork came" });
    expect(mocks.override).toHaveBeenCalledExactlyOnceWith(expect.anything(), "d1", "no paperwork came", null);
  });
  it("a malformed receiptId is 400", async () => {
    const res = await patch({ action: "override", deliveryId: "d1", note: "accepted", receiptId: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(mocks.override).not.toHaveBeenCalled();
  });
  it("returns receipt_changed by code", async () => {
    mocks.override.mockRejectedValue(new EmailReceiptError(409, "receipt_changed"));
    const res = await patch({ action: "override", deliveryId: "d1", note: "accepted", receiptId: RECEIPT });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "receipt_changed" });
  });
});

describe("the delivery page sends the receipt it is showing", () => {
  const panel = readFileSync("components/receiving/VendorClaimPanel.tsx", "utf8").replace(/\r\n/g, "\n");
  it("attest and override both name receipt.id, like unlink", () => {
    const attest = panel.slice(panel.indexOf("const attest = async"), panel.indexOf("const override = async"));
    expect(attest).toContain('action: "attest"');
    expect(attest).toContain("receiptId: receipt?.id");
    const override = panel.slice(panel.indexOf("const override = async"), panel.indexOf("const unlink = async"));
    expect(override).toContain('JSON.stringify({ deliveryId, action: "override", receiptId: receipt?.id, note: note.trim() })');
  });
  it("every refusal a verdict can get has a message in English and Spanish", () => {
    for (const code of ["receipt_changed", "match_changed", "already_overridden", "no_receipt", "verdict_note_unavailable"]) {
      const key = `receiving.claim.error.${code}`;
      const a = (en as Record<string, string>)[key], b = (es as Record<string, string>)[key];
      expect(a, key).toBeTruthy(); expect(b, key).toBeTruthy(); expect(b, key).not.toBe(a);
    }
  });
});
