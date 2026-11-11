// Build 2: mintAndSendPortalLink outcomes (A2 72 h token, A3 two identical tries + classification,
// A6 rate-limit → throttled, delivery preflight) and the constant-shape public wrapper.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  send: vi.fn<(message: Record<string, unknown>) => Promise<{ id: string } | { error: string; code?: string }>>(),
  audit: vi.fn(), rateLimit: vi.fn(async () => true),
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({
  from: (table: string) => {
    expect(table).toBe("catering_portal_tokens");
    return {
      update: (patch: Record<string, unknown>) => ({ eq: (_key: string, email: string) => ({
        is: () => ({ gt: (_column: string, now: string) => {
          for (const row of state.rows) if (row.email === email && row.consumed_at == null && String(row.expires_at) > now) Object.assign(row, patch);
          return Promise.resolve({ error: null });
        } }),
      }) }),
      insert: async (row: Record<string, unknown>) => { state.rows.push(row); return { error: null }; },
    };
  },
}) }));
vi.mock("@/lib/portal/rate-limit", () => ({ checkAndRecord: state.rateLimit }));
vi.mock("@/lib/portal/auth", () => ({ generateToken: () => "new-token", hashToken: async () => "new-hash" }));
vi.mock("@/lib/portal/session", () => ({ createCustomerSession: vi.fn() }));
vi.mock("@/lib/portal/draft", () => ({ createDraftFromIntake: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: state.send }));
vi.mock("@/lib/audit", () => ({ audit: state.audit }));
import { classifySendResult, META_CONTINUATION_TTL_MIN, mintAndSendPortalLink, requestMagicLink } from "@/lib/portal/magic-link";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const meta = {
  email: "Buyer@Work.example", name: "Example Guest", ttlMinutes: META_CONTINUATION_TTL_MIN, language: "es" as const,
  idempotencyKey: "meta-lead-email:11", tries: 2 as const, via: "meta_lead_form" as const, preflightDelivery: true,
  linkQuery: { lang: "es", ttl: "72h" }, intake: { locationId: "loc", contactName: "Example Guest", isDelivery: false, pipelineId: "lead-id" },
};
beforeEach(() => {
  state.rows.length = 0; state.send.mockReset(); state.send.mockResolvedValue({ id: "mail" }); state.audit.mockReset(); state.rateLimit.mockReset(); state.rateLimit.mockResolvedValue(true);
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  vi.stubEnv("PORTAL_ORIGIN", "https://order.test"); vi.stubEnv("PORTAL_HOSTS", "order.test"); vi.stubEnv("STAFF_ORIGIN", "https://staff.test");
  vi.stubEnv("PORTAL_MAGIC_LINK_ALLOWLIST", "*");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it("Meta mode: a 72 h single-use token whose intake carries pipelineId, a Spanish email with the lifetime, the idempotency key, and sent only on the provider id", async () => {
  state.rows.push({ email: "buyer@work.example", token_hash: "old-hash", consumed_at: null, expires_at: "2026-11-11T12:20:00.000Z" });
  const outcome = await mintAndSendPortalLink(meta);
  expect(outcome).toEqual({ kind: "sent", tokenId: expect.stringMatching(UUID), providerId: "mail" });
  expect(state.rows[0]?.expires_at).toBe("2026-11-11T12:00:00.000Z"); // latest link wins, unchanged
  expect(state.rows[1]).toMatchObject({ id: (outcome as { tokenId: string }).tokenId, email: "buyer@work.example", token_hash: "new-hash", expires_at: "2026-11-14T12:00:00.000Z", intake: { pipelineId: "lead-id", locationId: "loc" } });
  expect(state.send).toHaveBeenCalledTimes(1);
  const payload = state.send.mock.calls[0]![0] as Record<string, string>;
  expect(payload.to).toBe("buyer@work.example");
  expect(payload.idempotencyKey).toBe("meta-lead-email:11");
  expect(payload.subject).toBe("Termina tu pedido de Compliments Only — inicia sesión (7:00 AM ET)");
  expect(payload.text).toContain("https://order.test/order/verify?token=new-token&lang=es&ttl=72h");
  expect(payload.text).toContain("caduca en 72 horas"); expect(payload.html).toContain("72 horas"); expect(payload.html).toContain("ENTRAR");
  expect(payload.html).not.toContain("30 minutes");
  expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "portal.magic_link_requested", metadata: expect.objectContaining({ via: "meta_lead_form", outcome: "sent" }) }));
});
it("A3: at most two IDENTICAL tries, the second only after an unknown-class outcome; a confirmed id on the second = sent", async () => {
  state.send.mockResolvedValueOnce({ error: "fetch failed" }).mockResolvedValueOnce({ id: "mail-2" });
  expect(await mintAndSendPortalLink(meta)).toMatchObject({ kind: "sent", providerId: "mail-2" });
  expect(state.send).toHaveBeenCalledTimes(2);
  expect(state.send.mock.calls[0]![0]).toEqual(state.send.mock.calls[1]![0]);
  expect(state.send.mock.calls[0]![0]).toBe(state.send.mock.calls[1]![0]);
  expect(state.rows).toHaveLength(1); // one token, never re-minted
});
it("UNKNOWN IS STICKY (review P2-2): a named refusal on the second try never downgrades a possibly-delivered first try", async () => {
  state.send.mockResolvedValueOnce({ error: "timeout" }).mockResolvedValueOnce({ error: "refused", code: "validation_error" });
  expect(await mintAndSendPortalLink(meta)).toEqual({ kind: "unknown", tokenId: expect.stringMatching(UUID) });
  expect(state.send).toHaveBeenCalledTimes(2);
  expect(state.send.mock.calls[0]![0]).toBe(state.send.mock.calls[1]![0]);
});
it("unknown then a confirmed id on the identical retry → sent with THAT id", async () => {
  state.send.mockResolvedValueOnce({ error: "x", code: "concurrent_idempotent_requests" }).mockResolvedValueOnce({ id: "re_second" });
  expect(await mintAndSendPortalLink(meta)).toEqual({ kind: "sent", tokenId: expect.stringMatching(UUID), providerId: "re_second" });
});
it.each([
  [{ error: "timeout" }, "unknown"], [{ error: "send returned no id" }, "unknown"],
  [{ error: "x", code: "internal_server_error" }, "unknown"], [{ error: "x", code: "application_error" }, "unknown"],
  [{ error: "x", code: "concurrent_idempotent_requests" }, "unknown"],
])("two unknown-class outcomes %j end as unknown with the token kept", async (reply, kind) => {
  state.send.mockResolvedValue(reply);
  expect(await mintAndSendPortalLink(meta)).toEqual({ kind, tokenId: expect.stringMatching(UUID) });
  expect(state.send).toHaveBeenCalledTimes(2);
});
it.each(["validation_error", "rate_limit_exceeded", "invalid_idempotent_request", "daily_quota_exceeded", "missing_api_key"])("a named provider refusal %s is failed after ONE try", async code => {
  state.send.mockResolvedValue({ error: "refused", code });
  expect(await mintAndSendPortalLink(meta)).toEqual({ kind: "failed", tokenId: expect.stringMatching(UUID), code });
  expect(state.send).toHaveBeenCalledTimes(1);
});
it("classifySendResult: only a confirmed id is sent", () => {
  expect(classifySendResult({ id: "re_1" })).toBe("sent");
  expect(classifySendResult({ id: "" })).toBe("unknown");
  expect(classifySendResult({ error: "ECONNRESET" })).toBe("unknown");
  expect(classifySendResult({ error: "x", code: "concurrent_idempotent_requests" })).toBe("unknown");
  expect(classifySendResult({ error: "x", code: "validation_error" })).toBe("failed");
});
it("A6: the existing magic_link_email rate limit answers throttled before any token", async () => {
  state.rateLimit.mockResolvedValue(false);
  expect(await mintAndSendPortalLink(meta)).toEqual({ kind: "throttled" });
  expect(state.rows).toHaveLength(0); expect(state.send).not.toHaveBeenCalled();
  expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "portal.magic_link_throttled" }));
});
it("delivery preflight (Meta mode): not allowlisted → suppressed BEFORE minting, so the customer's live portal link is NOT retired", async () => {
  vi.stubEnv("PORTAL_MAGIC_LINK_ALLOWLIST", "juan@example.test");
  state.rows.push({ email: "buyer@work.example", token_hash: "old-hash", consumed_at: null, expires_at: "2026-11-11T12:20:00.000Z" });
  expect(await mintAndSendPortalLink(meta)).toEqual({ kind: "suppressed", tokenId: null });
  expect(state.rows).toHaveLength(1); expect(state.rows[0]?.expires_at).toBe("2026-11-11T12:20:00.000Z");
  expect(state.send).not.toHaveBeenCalled(); expect(state.rateLimit).not.toHaveBeenCalled();
});
it("delivery preflight (Meta mode): a dormant portal identity is suppressed the same way", async () => {
  vi.stubEnv("PORTAL_ORIGIN", ""); vi.stubEnv("PORTAL_HOSTS", ""); vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  expect(await mintAndSendPortalLink(meta)).toEqual({ kind: "suppressed", tokenId: null });
  expect(state.rows).toHaveLength(0);
});
it("portal mode keeps today's order: not allowlisted still mints (constant shape) and skips the send", async () => {
  vi.stubEnv("PORTAL_MAGIC_LINK_ALLOWLIST", "juan@example.test");
  expect(await mintAndSendPortalLink({ email: "customer@example.test" })).toEqual({ kind: "suppressed", tokenId: expect.stringMatching(UUID) });
  expect(state.rows[0]).toMatchObject({ email: "customer@example.test", expires_at: "2026-11-11T12:30:00.000Z" });
  expect(state.send).not.toHaveBeenCalled();
});
it("portal mode: one try, 30 minutes, English, no idempotency key, and the public wrapper resolves void on every branch", async () => {
  state.send.mockResolvedValue({ error: "timeout" });
  await expect(requestMagicLink({ email: "customer@example.test", intake: { locationId: "loc", contactName: "A", isDelivery: false } })).resolves.toBeUndefined();
  expect(state.send).toHaveBeenCalledTimes(1);
  const payload = state.send.mock.calls[0]![0] as Record<string, string>;
  expect(payload.subject).toBe("Finish your Compliments Only order — sign in (7:00 AM ET)");
  expect(payload.text).toContain("expires in 30 minutes"); expect(payload.text).toContain("https://order.test/order/verify?token=new-token");
  expect(payload.text).not.toContain("lang="); expect(payload).not.toHaveProperty("idempotencyKey");
  expect(state.rows[0]).toMatchObject({ expires_at: "2026-11-11T12:30:00.000Z" });
  state.rateLimit.mockResolvedValue(false);
  await expect(requestMagicLink({ email: "customer@example.test" })).resolves.toBeUndefined();
  await expect(requestMagicLink({ email: "not an email" })).resolves.toBeUndefined();
});
it("an invalid address is a named outcome with nothing minted", async () => {
  expect(await mintAndSendPortalLink({ ...meta, email: "nope" })).toEqual({ kind: "invalid_email" });
  expect(state.rows).toHaveLength(0);
});
