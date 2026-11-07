import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseReceipt } from "@/lib/receipt-parse";
import { matchReceiptToPo, applyReceiptPoEffects, attemptAutoLink } from "@/lib/email-receipts";
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email-receipts", () => ({
  matchReceiptToPo: vi.fn(async () => null), applyReceiptPoEffects: vi.fn(async () => {}),
  attemptAutoLink: vi.fn(async () => {}), EmailReceiptError: Error, RECEIPT_MIN: 4,
}));

function service(locationId: string | null, accounts: unknown[], lookupError = false, writeCount = 1) {
  const writes: Record<string, unknown>[] = [];
  const receipt = { id: "receipt", inbound_message_id: "message", attributed_by: locationId ? "address" : null,
    parse_state: "unparsed", source: "inbound", location_id: locationId, vendor_guess_id: "sender-vendor",
    raw_storage_path: "message.eml", attachment_paths: [], linked_po_id: null };
  const sb = {
    from: (table: string) => {
      const q = {
        select: () => q, eq: () => q, is: () => q, order: () => q, range: () => q,
        update: (write: Record<string, unknown>) => { writes.push(write); return q; },
        maybeSingle: async () => ({ error: null, data: receipt }),
        returns: async () => ({ data: accounts, error: table === "vendor_location_accounts" && lookupError ? { message: "unavailable" } : null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, count: writeCount }).then(resolve),
      };
      return q;
    },
    storage: { from: () => ({ download: async () => ({ error: null, data: new Blob(["invoice document"]) }) }) },
  } as unknown as SupabaseClient;
  return { sb, writes };
}

describe("routed inbound parse attribution gates", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("ANTHROPIC_API_KEY", "test-value"); vi.stubEnv("AI_PARSE_MODEL", ""); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  function response(accountNumber: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ docKind: "invoice", accountNumber, vendorName: "An untrusted vendor hint" }) }] })));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  it.each([
    ["shop-a", "001", "shop-a", "both", false],
    ["shop-a", undefined, "shop-a", "address", false],
    [null, "001", "shop-a", "account", false],
    ["shop-b", "001", "shop-b", "address", true],
    [null, undefined, null, null, false],
  ] as const)("persists %s/%s before effects", async (address, number, location, source, conflict) => {
    const { sb, writes } = service(address, [{ vendor_id: "account-vendor", location_id: "shop-a", account_number: "001" }]);
    const fetched = response(number);
    await expect(parseReceipt(sb, "receipt")).resolves.toEqual({ ok: true, docKind: "invoice" });
    expect(writes[0]).toMatchObject({ parse_state: "parsed", location_id: location, attributed_by: source, attribution_conflict: conflict });
    const allowed = !conflict && location != null;
    expect(matchReceiptToPo).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(applyReceiptPoEffects).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(attemptAutoLink).toHaveBeenCalledTimes(allowed ? 1 : 0);
    const request = fetched.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request[1].body)).model).toBe("claude-sonnet-5-5");
  });
  it("fails closed on account lookup failure", async () => {
    const { sb, writes } = service("shop-a", [], true);
    response("001");
    await parseReceipt(sb, "receipt");
    expect(writes[0]).toMatchObject({ parse_state: "failed", parsed_json: { reason: "attribution_lookup_failed" } });
    expect(matchReceiptToPo).not.toHaveBeenCalled();
  });
  it("a concurrent manual claim prevents inferred effects", async () => {
    const { sb } = service("shop-a", [], false, 0);
    response(undefined);
    await expect(parseReceipt(sb, "receipt")).resolves.toEqual({ ok: false });
    expect(matchReceiptToPo).not.toHaveBeenCalled();
    expect(attemptAutoLink).not.toHaveBeenCalled();
  });
  it("rejects non-string account data and never binds by vendorName", async () => {
    const { sb, writes } = service(null, []);
    response({ injected: "001" });
    await parseReceipt(sb, "receipt");
    expect(writes[0]).toMatchObject({ location_id: null, vendor_guess_id: "sender-vendor" });
    expect((writes[0]?.parsed_json as { extraction: object }).extraction).not.toHaveProperty("accountNumber");
    expect(matchReceiptToPo).not.toHaveBeenCalled();
  });
});
