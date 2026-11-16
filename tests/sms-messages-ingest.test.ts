import { beforeEach, expect, it, vi } from "vitest";

// Audit W11/B171: a failed vendor-contact read ran BEFORE the ledger insert and threw, so the text was dropped.
const mocks = vi.hoisted(() => ({ audit: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.client }));
import { ingestInboundSms } from "@/lib/sms-messages";

type Reply = { data?: unknown; error?: unknown };
function service(replies: Record<string, Reply[]>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const from = (table: string) => {
    const reply = replies[table]?.shift();
    if (!reply) throw new Error(`unexpected query ${table}`);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "eq", "in", "not", "is", "order", "limit", "gte", "lte"]) {
      chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
    }
    chain.maybeSingle = () => Promise.resolve(reply);
    chain.returns = () => Promise.resolve(reply);
    chain.then = (resolve: (r: Reply) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(reply).then(resolve, reject);
    return chain;
  };
  return { sb: { from }, calls };
}
beforeEach(() => { vi.resetAllMocks(); });

it("a failed vendor lookup still ledgers the text, and never links a PO without a vendor", async () => {
  const { sb, calls } = service({
    sms_messages: [{ data: null, error: null }, { data: { id: "sms1" }, error: null }],
    vendor_contacts: [{ data: null, error: { message: "boom" } }],
  });
  mocks.client.mockReturnValue(sb);
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await ingestInboundSms({ providerSid: "SM1", fromNumber: "+12025550123", toNumber: "+12025550100", body: "PO-1234 confirmed", mediaUrls: [], occurredAt: "2026-11-15T12:00:00Z" });
    expect(result).toEqual({ smsId: "sms1", linkedPoId: null });
    const insert = calls.find(c => c.table === "sms_messages" && c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ provider_sid: "SM1", vendor_guess_id: null, body: "PO-1234 confirmed" });
    expect(calls.some(c => c.table === "purchase_orders")).toBe(false);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "sms.received", metadata: expect.objectContaining({ vendor_guess_failed: true, linked_po_id: null }) }));
    expect(JSON.stringify(logged.mock.calls)).not.toContain("2025550123");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("PO-1234");
  } finally { logged.mockRestore(); }
});
