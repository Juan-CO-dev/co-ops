/**
 * Audit W20/B193: a vendor mail "assign" (a person names the shop / vendor) must run the receipt's
 * automatic matching once. A replayed request, a different action, and a mail with no receipt row
 * yet run nothing; a failure of the matching never fails an assignment that committed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), automation: vi.fn(), audit: vi.fn(), receiptId: null as string | null, readFails: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  rpc: mocks.rpc,
  from: (table: string) => {
    if (mocks.readFails) throw new Error("read failed");
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "inbound_messages" ? { email_receipt_id: mocks.receiptId } : null, error: null }) };
    return q;
  },
}) }));
vi.mock("@/lib/vendor-mail", () => ({
  readVendorMailRow: vi.fn(async () => ({})),
  VendorMailError: class VendorMailError extends Error { constructor(public status: number, public code: string) { super(code); } },
  VENDOR_MAIL_UUID: /^[0-9a-f-]{36}$/i,
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/email-receipts", () => ({ runReceiptAutomation: mocks.automation }));

import { actOnVendorMail } from "@/lib/vendor-mail-actions";

const ctx = { user: { id: "gm", role: "gm" }, session: { id: "session" } } as unknown as AuthContext;
const MESSAGE = "11111111-1111-4111-8111-111111111111";
const input = { expected_revision: 0, request_id: "22222222-2222-4222-8222-222222222222" };
const answer = (replayed: boolean) => ({ data: { revision: 1, replayed, data: {} }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.receiptId = "receipt-1"; mocks.readFails = false;
  mocks.rpc.mockResolvedValue(answer(false));
  mocks.automation.mockResolvedValue(undefined);
});

describe("vendor mail assign runs the receipt's automatic matching (B193)", () => {
  it("runs it once, after the assignment and its audit row", async () => {
    await actOnVendorMail(ctx, MESSAGE, "assign", input, { location_id: "33333333-3333-4333-8333-333333333333" });
    expect(mocks.automation).toHaveBeenCalledExactlyOnceWith("receipt-1");
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.automation.mock.invocationCallOrder[0]!);
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.automation.mock.invocationCallOrder[0]!);
  });
  it("a replayed request runs nothing", async () => {
    mocks.rpc.mockResolvedValue(answer(true));
    await actOnVendorMail(ctx, MESSAGE, "assign", input, { vendor_id: null });
    expect(mocks.automation).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(["handle", "redrive"] as const)("%s runs nothing", async action => {
    await actOnVendorMail(ctx, MESSAGE, action, input, action === "handle" ? { reason: "done" } : {});
    expect(mocks.automation).not.toHaveBeenCalled();
  });
  it("a mail with no receipt row yet runs nothing (its parse will)", async () => {
    mocks.receiptId = null;
    await actOnVendorMail(ctx, MESSAGE, "assign", input, { vendor_id: null });
    expect(mocks.automation).not.toHaveBeenCalled();
  });
  it("a refused assignment runs nothing", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "linked_evidence" } });
    await expect(actOnVendorMail(ctx, MESSAGE, "assign", input, { vendor_id: null })).rejects.toMatchObject({ status: 409, code: "linked_evidence" });
    expect(mocks.automation).not.toHaveBeenCalled();
  });
  it.each(["the matching throws", "the receipt lookup throws"])("the assignment still succeeds when %s", async which => {
    if (which === "the matching throws") mocks.automation.mockRejectedValue(new Error("matching unavailable"));
    else mocks.readFails = true;
    await expect(actOnVendorMail(ctx, MESSAGE, "assign", input, { vendor_id: null })).resolves.toMatchObject({ replayed: false });
  });
});
