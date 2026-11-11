import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { audit, identity } = vi.hoisted(() => ({ audit: vi.fn(async () => undefined), identity: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/catering/inbox-identity", () => ({ resolveCateringInboxIdentity: identity }));
import { finalizeCateringInbound, type StoredCateringInbound } from "@/lib/catering/inbox-ingest";

const message: StoredCateringInbound = { id: "message", inbound_message_id: "transport", revision: 1, disposition: "recorded",
  sender_address: "guest@example.com", subject: "Need catering for Friday", body_text: "We need catering for our event",
  headers: {}, external_ref: null, thread_key: null };
function service(options: { replayed?: boolean; error?: boolean; location?: string; aliases?: unknown[] } = {}) {
  const from = vi.fn((table: string) => {
    const data = table === "inbound_messages" ? { location_id: options.location ?? null } : table === "inbound_address_aliases" ? options.aliases ?? [] : [];
    const query: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
    for (const method of ["select", "eq", "order", "range", "single"]) query[method] = () => query;
    return query;
  });
  const rpc = vi.fn(async () => ({ data: { replayed: options.replayed ?? false }, error: options.error ? { message: "failure" } : null }));
  return { sb: { from, rpc } as unknown as Parameters<typeof finalizeCateringInbound>[1], from, rpc };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tenant.example/path?not-a-token=1");
  identity.mockResolvedValue({ identity: "new_sender", customerId: null, leadId: null, quoteId: null, locationId: null, artifact: "none" });
});
afterEach(() => vi.unstubAllEnvs());
describe("stored catering ingest", () => {
  it.each(["PGRST205", "42P01", "42883", "PGRST202"])("preserves missing-schema code %s for the router's zero-attempt skip", async code => {
    const { sb, rpc } = service();
    rpc.mockResolvedValueOnce({ data: null, error: { code, message: "missing schema" } } as never);
    await expect(finalizeCateringInbound(message, sb)).rejects.toMatchObject({ code });
    expect(audit).not.toHaveBeenCalled();
  });
  it("finalizes with plain portal URL, alias location, Spanish draft and closed audit metadata", async () => {
    const { sb, rpc } = service({ location: "shop" });
    await finalizeCateringInbound({ ...message, subject: "Necesito catering para el viernes", body_text: "Hola, necesito catering para 30 personas" }, sb);
    expect(rpc).toHaveBeenCalledWith("finalize_catering_inbound", expect.objectContaining({ p_expected_revision: 1,
      p_result: expect.objectContaining({ location_id: "shop", disposition: "drafted" }),
      p_draft: expect.objectContaining({ language: "es", params: expect.objectContaining({ portalUrl: "https://tenant.example/order/start" }) }) }));
    expect(audit.mock.calls.map(call => (call as unknown as [{ action: string }])[0].action)).toEqual(["catering.inbox.ingest", "catering.inbox.draft"]);
    expect(JSON.stringify(audit.mock.calls)).not.toContain("guest@example.com");
  });
  it("resumes recorded evidence without network fetch", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try { await finalizeCateringInbound(message, service().sb); expect(fetch).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
  });
  it("does nothing to already finalized evidence", async () => {
    const { sb, from, rpc } = service();
    await finalizeCateringInbound({ ...message, disposition: "drafted" }, sb);
    expect(from).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it("does not duplicate observations for a replayed finalization", async () => {
    await finalizeCateringInbound(message, service({ replayed: true }).sb);
    expect(audit).not.toHaveBeenCalled();
  });
  it("escalates urgent content without a draft or configured portal URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const { sb, rpc } = service();
    await finalizeCateringInbound({ ...message, subject: "Urgent allergy complaint" }, sb);
    expect(rpc).toHaveBeenCalledWith("finalize_catering_inbound", expect.objectContaining({ p_draft: null,
      p_result: expect.objectContaining({ disposition: "needs_human", reason: "urgent" }) }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "catering.inbox.escalate" }));
  });
  it("suppresses an active own alias", async () => {
    const { sb, rpc } = service({ aliases: [{ address: "guest@example.com", active: true }] });
    await finalizeCateringInbound(message, sb);
    expect(rpc).toHaveBeenCalledWith("finalize_catering_inbound", expect.objectContaining({ p_draft: null,
      p_result: expect.objectContaining({ disposition: "noise", reason: "own_address" }) }));
  });
  it("throws on writer failure without claiming ingest succeeded", async () => {
    await expect(finalizeCateringInbound(message, service({ error: true }).sb)).rejects.toThrow("inbox_finalize_failed");
    expect(audit).not.toHaveBeenCalled();
  });
});
