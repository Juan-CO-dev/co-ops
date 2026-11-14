// Build 2, A1–A3 + A6: the ONE continuation email per created Meta lead — claim → mint+send → result.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ mint: vi.fn() }));
vi.mock("@/lib/portal/magic-link", () => ({ mintAndSendPortalLink: mocks.mint, META_CONTINUATION_TTL_MIN: 4320 }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("not used"); } }));
import { sendMetaContinuation } from "@/lib/meta-leads/continuation";

type Reply = { data?: unknown; error?: unknown };
const intake = { contactName: "Example Guest", contactEmail: "buyer@work.example", marketingEmail: "guest@example.test", secondaryEmail: "guest@example.test",
  contactPhone: "+12025550100", company: "Work", headcount: 20, eventDate: "2027-01-02", shopCode: "p-street", isDelivery: true, notes: "Meeting", timing: null };
const args = { leadgenId: "11", pipelineId: "lead-id", locationId: "shop-id", language: "es" as const, intake };
function database(replies: Reply[]) {
  const rpc = vi.fn(async () => { const r = replies.shift(); if (!r) throw new Error("unexpected rpc"); return r; });
  return { sb: { rpc } as unknown as Parameters<typeof sendMetaContinuation>[0], rpc };
}
const claimed = { data: { claimed: true, reason: null } };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("RESEND_API_KEY", "re_stub"); vi.stubEnv("EMAIL_FROM", "catering@example.test"); });
afterEach(() => vi.unstubAllEnvs());

it("an unclaimable row (attached / needs_human / already emailed) mints nothing and writes nothing", async () => {
  const db = database([{ data: { claimed: false, reason: "not_claimable" } }]);
  expect(await sendMetaContinuation(db.sb, args)).toBe("not_claimable");
  expect(mocks.mint).not.toHaveBeenCalled(); expect(db.rpc).toHaveBeenCalledTimes(1);
});
it("the SQL 24 h per-address cap refuses before any token is minted", async () => {
  const db = database([{ data: { claimed: false, reason: "capped" } }]);
  expect(await sendMetaContinuation(db.sb, args)).toBe("capped");
  expect(mocks.mint).not.toHaveBeenCalled(); expect(db.rpc).toHaveBeenCalledTimes(1);
});
it("sent: a 72 h token to the ORDER email carrying the draft intake + pipelineId, the form language, the idempotency key and two tries", async () => {
  mocks.mint.mockResolvedValue({ kind: "sent", tokenId: "token-id", providerId: "re_123" });
  const db = database([claimed, { data: true }]);
  expect(await sendMetaContinuation(db.sb, args)).toBe("sent");
  expect(mocks.mint).toHaveBeenCalledTimes(1);
  expect(mocks.mint).toHaveBeenCalledWith({
    email: "buyer@work.example", name: "Example Guest", ttlMinutes: 4320, language: "es", idempotencyKey: "meta-lead-email:11", tries: 2,
    via: "meta_lead_form", preflightDelivery: true, linkQuery: { lang: "es", ttl: "72h" },
    intake: { locationId: "shop-id", contactName: "Example Guest", email: "buyer@work.example", company: "Work", eventDate: "2027-01-02", headcount: 20, isDelivery: true, contactPhone: "+12025550100", pipelineId: "lead-id" },
  });
  expect(JSON.stringify(mocks.mint.mock.calls)).not.toContain("guest@example.test");
  expect(db.rpc).toHaveBeenNthCalledWith(1, "meta_lead_email_claim", { p_leadgen_id: "11" });
  expect(db.rpc).toHaveBeenNthCalledWith(2, "meta_lead_email_result", { p_leadgen_id: "11", p_email_state: "sent", p_portal_token_id: "token-id", p_provider_id: "re_123" });
});
it.each([
  [{ kind: "unknown", tokenId: "token-id" }, "unknown", "token-id"],
  [{ kind: "failed", tokenId: "token-id", code: "validation_error" }, "failed", "token-id"],
  [{ kind: "throttled" }, "capped", null],
  [{ kind: "suppressed", tokenId: null }, "suppressed", null],
  [{ kind: "suppressed", tokenId: "token-id" }, "suppressed", "token-id"],
  [{ kind: "invalid_email" }, "failed", null],
  [{ kind: "insert_failed" }, "failed", null],
])("outcome %j is recorded once as %s and never retried here", async (outcome, state, token) => {
  mocks.mint.mockResolvedValue(outcome);
  const db = database([claimed, { data: true }]);
  expect(await sendMetaContinuation(db.sb, args)).toBe(state);
  expect(mocks.mint).toHaveBeenCalledTimes(1);
  expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_email_result", { p_leadgen_id: "11", p_email_state: state, p_portal_token_id: token, p_provider_id: null });
});
it("no provider key / sender → suppressed without minting (configuration, not a failed send)", async () => {
  vi.stubEnv("RESEND_API_KEY", ""); const db = database([claimed, { data: true }]);
  expect(await sendMetaContinuation(db.sb, args)).toBe("suppressed");
  expect(mocks.mint).not.toHaveBeenCalled();
  expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_email_result", expect.objectContaining({ p_email_state: "suppressed", p_portal_token_id: null }));
});
it("the sim capture path counts as a configured sender", async () => {
  vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("SIM_MODE", "1"); vi.stubEnv("SIM_EMAIL_CAPTURE_DIR", "C:/tmp");
  mocks.mint.mockResolvedValue({ kind: "sent", tokenId: "t", providerId: "sim" });
  const db = database([claimed, { data: true }]);
  expect(await sendMetaContinuation(db.sb, args)).toBe("sent"); expect(mocks.mint).toHaveBeenCalledTimes(1);
});
it("a claim write error throws a fixed code before any send", async () => {
  const db = database([{ error: { message: "boom guest@example.test" } }]);
  await expect(sendMetaContinuation(db.sb, args)).rejects.toThrow("meta_email_claim_failed");
  expect(mocks.mint).not.toHaveBeenCalled();
});
it("a result write that did not land throws a fixed code (the row stays an honest unknown)", async () => {
  mocks.mint.mockResolvedValue({ kind: "sent", tokenId: "token-id", providerId: "re_123" });
  const db = database([claimed, { data: false }]);
  await expect(sendMetaContinuation(db.sb, args)).rejects.toThrow("meta_email_result_failed");
});
