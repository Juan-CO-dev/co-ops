import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboundAddresses, inboundRetryDelayMs, inboundErrorCode, normalizeInboundAddress, resolveInboundRoute, type InboundAddressRule } from "@/lib/inbound-router-shared";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), ingest: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/inbound-fetch", () => ({ fetchInboundContent: mocks.fetch }));
vi.mock("@/lib/email-receipts", () => ({ ingestInboundReceipt: mocks.ingest }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("unexpected database access"); }) }));
import { processInboundMessage, recordInboundMessage, sweepInboundMessages } from "@/lib/inbound-router";
const rules: InboundAddressRule[] = [
  { address: "one@example.test", lane: "vendor_receipt", location_id: "one", primary: true },
  { address: "two@example.test", lane: "vendor_receipt", location_id: "two", primary: true },
  { address: "alias@example.test", lane: "vendor_receipt", location_id: "one" },
  { address: "events@example.test", lane: "catering", location_id: null },
];
describe("recipient lane matrix", () => {
  it.each([
    [["one@example.test"], "vendor_receipt", "one", "shop_address"],
    [["alias@example.test"], "vendor_receipt", "one", "shop_alias"],
    [["events@example.test"], "catering", null, "catering_address"],
    [["one@example.test", "two@example.test"], "vendor_receipt", null, "ambiguous"],
    [["one@example.test", "events@example.test"], "vendor_receipt", null, "ambiguous"],
    [["unknown@example.test"], "noise", null, "unknown_address"],
  ] as const)("%j routes to %s", (recipients, lane, location_id, route_reason) => {
    expect(resolveInboundRoute([...recipients], rules)).toEqual({ lane, location_id, route_reason });
  });
  it("normalizes display names and case but preserves plus tags", () => {
    expect(normalizeInboundAddress("Shop <ONE@example.test>")).toBe("one@example.test");
    expect(inboundAddresses(["ONE@example.test", "Shop <one@example.test>"])).toEqual(["one@example.test"]);
    expect(resolveInboundRoute(["one+two@example.test"], rules).lane).toBe("noise");
    expect(normalizeInboundAddress("not an address")).toBeNull();
  });
  it("caps exponential retry delay", () => {
    expect(inboundRetryDelayMs(1)).toBe(60_000); expect(inboundRetryDelayMs(20)).toBe(3_600_000);
  });
});

type Reply = { data?: unknown; error?: unknown; count?: number };
function database(replies: Reply[]) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const from = vi.fn((table: string) => {
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected query ${table}`);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "upsert", "update", "eq", "in", "lt", "lte", "order", "limit", "range"]) {
      chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
    }
    chain.maybeSingle = () => Promise.resolve(reply);
    chain.returns = () => Promise.resolve(reply);
    chain.then = (resolve: (r: Reply) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(reply).then(resolve, reject);
    return chain;
  });
  return { sb: { from } as unknown as Parameters<typeof processInboundMessage>[1], calls, from };
}
const row = { id: "fixture-row", provider_email_id: "fixture-message", from_address: "sender@example.test", subject: "invoice",
  to_addresses: ["delivery@example.test"], cc_addresses: [], received_for: ["one@example.test"], lane: "noise", location_id: null,
  route_reason: "unresolved", fetch_attempts: 0, received_at: "2026-11-01T12:00:00Z" };
const routeReplies = (): Reply[] => [{ data: row }, { data: { id: row.id } },
  { data: [{ id: "one", receipt_email_address: "one@example.test" }] }, { data: [] }, { count: 1 }, { data: null }, { count: 1 }];
beforeEach(() => { vi.clearAllMocks(); mocks.fetch.mockResolvedValue({ rawEml: { bytes: Buffer.from("invoice"), contentType: "text/plain" }, attachments: [] }); mocks.ingest.mockResolvedValue({ receiptId: "fixture-receipt" }); });
afterEach(() => vi.unstubAllEnvs());
it("inserts normalized metadata first with provider id conflict suppression", async () => {
  const db = database([{ data: { id: row.id } }]);
  await expect(recordInboundMessage({ email_id: row.provider_email_id, from: "Vendor <SENDER@example.test>", to: ["one@example.test"], received_for: ["alias@example.test"] }, db.sb)).resolves.toEqual({ duplicate: false, id: row.id });
  expect(db.calls[0]).toMatchObject({ table: "inbound_messages", method: "upsert", args: [
    { provider_email_id: row.provider_email_id, from_address: "sender@example.test", received_for: ["alias@example.test"], content_state: "pending" },
    { onConflict: "provider_email_id", ignoreDuplicates: true },
  ] });
});
it("ledger duplicate does not ingest; ledger errors reject", async () => {
  await expect(recordInboundMessage({ email_id: row.provider_email_id }, database([{ data: null }]).sb)).resolves.toEqual({ duplicate: true });
  await expect(recordInboundMessage({ email_id: row.provider_email_id }, database([{ error: {} }]).sb)).rejects.toThrow("inbound_ledger_failed");
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.ingest).not.toHaveBeenCalled();
});
it("forwarded-copy received_for alone routes fetched bytes through receipt writer", async () => {
  const db = database(routeReplies());
  expect(await processInboundMessage(row.id, db.sb)).toBe("fetched");
  expect(mocks.ingest).toHaveBeenCalledWith(expect.objectContaining({ addressLocationId: "one", inboundMessageId: row.id,
    rawEml: { bytes: Buffer.from("invoice"), contentType: "text/plain" } }));
  expect(db.calls.filter(c => c.method === "update").at(-1)?.args[0]).toMatchObject({ content_state: "fetched", email_receipt_id: "fixture-receipt" });
});
it("failed fetch persists failed, and bounded sweep retries successfully", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("resend_download_expired"));
  const first = database(routeReplies());
  expect(await processInboundMessage(row.id, first.sb)).toBe("failed");
  expect(first.calls.filter(c => c.method === "update").at(-1)?.args[0]).toMatchObject({ content_state: "failed", last_error: "provider_error" });
  expect(mocks.ingest).not.toHaveBeenCalled();
  vi.stubEnv("RESEND_INBOUND_SECRET", randomBytes(20).toString("hex"));
  vi.stubEnv("RESEND_API_KEY", randomBytes(20).toString("hex"));
  const retry = database([{ data: [{ id: row.id }] }, { data: { ...row, fetch_attempts: 1, route_reason: "shop_address", lane: "vendor_receipt", location_id: "one" } }, { data: { id: row.id } }, { count: 1 }, { data: null }, { count: 1 }]);
  expect(await sweepInboundMessages(retry.sb)).toEqual({ swept: 1, failed: 0 });
  expect(mocks.fetch).toHaveBeenCalledTimes(2); expect(mocks.ingest).toHaveBeenCalledTimes(1);
  expect(retry.calls).toContainEqual({ table: "inbound_messages", method: "limit", args: [25] });
  expect(retry.calls).toContainEqual({ table: "inbound_messages", method: "lt", args: ["fetch_attempts", 5] });
});
it.each(["noise", "catering"])("%s records skipped without fetching", async lane => {
  const db = database([{ data: { ...row, lane, route_reason: lane === "noise" ? "unknown_address" : "catering_address" } }, { data: { id: row.id } }, { count: 1 }, { count: 1 }]);
  expect(await processInboundMessage(row.id, db.sb)).toBe("skipped");
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.ingest).not.toHaveBeenCalled();
});
it("a lost lease never fetches or ingests", async () => {
  const db = database([{ data: row }, { data: null }]);
  expect(await processInboundMessage(row.id, db.sb)).toBe("busy"); expect(mocks.fetch).not.toHaveBeenCalled();
});
it("repairs a committed receipt's ledger link without fetching again", async () => {
  const db = database([{ data: { ...row, route_reason: "shop_address", lane: "vendor_receipt", location_id: "one" } },
    { data: { id: row.id } }, { count: 1 }, { data: { id: "existing-receipt" } }, { count: 1 }]);
  expect(await processInboundMessage(row.id, db.sb)).toBe("fetched");
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.ingest).not.toHaveBeenCalled();
  expect(db.calls.filter(c => c.method === "update").at(-1)?.args[0]).toMatchObject({ email_receipt_id: "existing-receipt", content_state: "fetched" });
});

it.each(["provider_auth", "resend_not_configured"])("config error %s preserves attempt allowance", async message => {
  mocks.fetch.mockRejectedValueOnce(new Error(message));
  const db = database(routeReplies());
  expect(await processInboundMessage(row.id, db.sb)).toBe("blocked_config");
  expect(db.calls.filter(c => c.method === "update").at(-1)?.args[0]).toMatchObject({
    content_state: "blocked_config", fetch_attempts: 0, last_error: "provider_auth", lease_token: null,
  });
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("exhaustion writes a closed audit with no provider text", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("SECRET provider https://signed.example.test"));
  const replies = routeReplies(); replies[0] = { data: { ...row, fetch_attempts: 4 } };
  const db = database(replies);
  expect(await processInboundMessage(row.id, db.sb)).toBe("failed");
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "inbound.retries_exhausted",
    resourceId: row.id, metadata: { attempts: 5, error_code: "provider_error" } }));
  expect(db.calls.filter(c => c.method === "update").at(-1)?.args[0]).toMatchObject({ fetch_attempts: 5 });
});
it("ledger insert stamps eligibility from the app clock, not a skewed database clock", async () => {
  const before = Date.now();
  const db = database([{ data: { id: row.id } }]);
  await recordInboundMessage({ email_id: row.provider_email_id }, db.sb);
  const inserted = db.calls[0]!.args[0] as { next_attempt_at: string };
  expect(Date.parse(inserted.next_attempt_at)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(inserted.next_attempt_at)).toBeLessThanOrEqual(Date.now());
});
it("does not start fetch work without a full time window", async () => {
  vi.stubEnv("RESEND_INBOUND_SECRET", "fixture"); vi.stubEnv("RESEND_API_KEY", "fixture");
  const db = database([{ data: [{ id: row.id }] }]);
  expect(await sweepInboundMessages(db.sb, Date.now() + 10_000)).toEqual({ swept: 0, failed: 0 });
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it.each([
  ["provider_auth", "provider_error", "provider_auth"],
  ["resend_untrusted_download", "provider_error", "untrusted_url"],
  ["resend_invalid_size", "provider_error", "invalid_size"],
  ["storeReceiptAsset: private provider text", "ledger", "storage"],
  ["anything private", "routing", "routing"],
  ["anything private", "ledger", "ledger"],
] as const)("classifies %s into a closed safe code", (message, stage, expected) => {
  expect(inboundErrorCode(new Error(message), stage)).toBe(expected);
});
