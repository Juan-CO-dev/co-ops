import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ graph: vi.fn(), customer: vi.fn(), manager: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.db }));
vi.mock("@/lib/portal/magic-link", () => ({ resolveOrCreatePortalCustomer: mocks.customer }));
vi.mock("@/lib/catering/system-intake-assignee", () => ({ resolveCateringManager: mocks.manager }));
vi.mock("@/lib/meta-leads/graph", () => ({ fetchMetaLead: mocks.graph }));
import { processMetaLead, recordMetaLead, sweepMetaLeads } from "@/lib/meta-leads/worker";
type Reply = { data?: unknown; error?: unknown };
const claim = { data: { claimed: true, attempts: 1, page_id: "22", form_id: "33", provider_created_at: "2026-11-11T12:00:00Z" } };
const fields = (opted = false) => Object.entries({ full_name: "Example Guest", email: "guest@example.test", preferred_shop: "p-street", fulfillment_method: "delivery", notes: "Meeting", email_marketing_opt_in: String(opted), unknown_key: "PRIVATE VALUE" }).map(([name, value]) => ({ name, values: [value] }));
function database(replies: Reply[] = [claim, { data: { state: "created" } }], location: Reply = { data: { id: "shop-id" } }) {
  const rpc = vi.fn(async (...args: unknown[]) => {
    void args;
    const reply = replies.shift(); if (!reply) throw new Error("unexpected rpc"); return reply;
  });
  const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(location) };
  const from = vi.fn(() => chain);
  const sb = { rpc, from } as unknown as NonNullable<Parameters<typeof processMetaLead>[1]>;
  mocks.db.mockReturnValue(sb);
  return { sb, rpc, from, chain };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("META_LEADS_ENABLED", "1"); vi.stubEnv("CUSTOMER_PROFILES", "1");
  vi.stubEnv("META_LEADS_PAGE_TOKEN", "stub-page-token"); vi.stubEnv("META_LEADS_APP_SECRET", "stub-secret");
  vi.stubEnv("META_LEADS_FORMS", JSON.stringify([{ pageId: "22", formId: "33", language: "es" }]));
  mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: fields() } });
  mocks.customer.mockResolvedValue("customer-id"); mocks.manager.mockResolvedValue("manager-id");
});
afterEach(() => vi.unstubAllEnvs());
it("off does no client, Graph, customer or manager work even during sweep", async () => {
  vi.stubEnv("META_LEADS_ENABLED", "true");
  expect(await processMetaLead("11")).toBe("disabled");
  expect(await sweepMetaLeads()).toEqual({ processed: 0 });
  expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.graph).not.toHaveBeenCalled(); expect(mocks.customer).not.toHaveBeenCalled();
});
it("disabled receipts persist through the ledger RPC and duplicates return false", async () => {
  const db = database([{ data: { inserted: true } }, { data: { inserted: false } }]);
  const event = { leadgenId: "11", pageId: "22", formId: "33", createdAt: "2026-11-11T12:00:00Z" };
  expect(await recordMetaLead(event, false, db.sb)).toBe(true);
  expect(await recordMetaLead(event, false, db.sb)).toBe(false);
  expect(db.rpc).toHaveBeenCalledWith("meta_lead_record", expect.objectContaining({ p_enabled: false }));
  expect(mocks.graph).not.toHaveBeenCalled();
});
it("unclaimed replay does no business work", async () => {
  const db = database([{ data: { claimed: false } }]);
  expect(await processMetaLead("11", db.sb)).toBe("busy"); expect(mocks.graph).not.toHaveBeenCalled();
});
it("creates only through the RPC with resolved manager, code-based shop, source attribution and key-only diagnostics", async () => {
  const db = database(); expect(await processMetaLead("11", db.sb)).toBe("created");
  expect(db.chain.eq).toHaveBeenCalledWith("code", "p-street");
  expect(mocks.customer).toHaveBeenCalledWith("guest@example.test", "Example Guest", "meta_lead_form");
  expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_intake_apply", expect.objectContaining({ p_customer_id: "customer-id", p_assigned_to: "manager-id", p_location_id: "shop-id", p_raw_keys: expect.arrayContaining(["unknown_key"]), p_intake: expect.objectContaining({ language: "es", fulfillment: "delivery" }) }));
  expect(JSON.stringify(db.rpc.mock.calls)).not.toContain("PRIVATE VALUE");
  expect(db.rpc.mock.calls.map(c => c[0])).not.toContain("customer_consent_record_explicit");
});
it.each(["attached", "needs_human"])("honors SQL %s result without further writes", async state => {
  const db = database([claim, { data: { state } }]);
  expect(await processMetaLead("11", db.sb)).toBe(state); expect(db.rpc).toHaveBeenCalledTimes(2);
});
it("records only checked consent before lead creation with stable evidence ref", async () => {
  mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: fields(true) } });
  const db = database([claim, { data: { event_id: "consent-id", recorded: true } }, { data: { state: "created" } }]);
  expect(await processMetaLead("11", db.sb)).toBe("created");
  expect(db.rpc).toHaveBeenNthCalledWith(2, "customer_consent_record_explicit", expect.objectContaining({ p_evidence_ref: "11:email_marketing_opt_in", p_source: "meta_lead_form", p_channel: "email" }));
});
it("customer profiles flag suppresses consent writer even for checked checkbox", async () => {
  vi.stubEnv("CUSTOMER_PROFILES", "0"); mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: fields(true) } });
  const db = database(); expect(await processMetaLead("11", db.sb)).toBe("created"); expect(db.rpc).toHaveBeenCalledTimes(2);
});
it("suppressed consent refuses identity and pipeline writes", async () => {
  mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: fields(true) } });
  const db = database([claim, { error: { message: "consent_suppressed" } }, { data: true }]);
  expect(await processMetaLead("11", db.sb)).toBe("needs_human"); expect(mocks.customer).not.toHaveBeenCalled();
  expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_fail", expect.objectContaining({ p_error_code: "consent_refused", p_retryable: false }));
});
it.each(["graph_auth", "graph_not_found", "configuration", "invalid_payload"])("terminal Graph %s stays closed", async error => {
  mocks.graph.mockResolvedValue({ ok: false, error }); const db = database([claim, { data: true }]);
  expect(await processMetaLead("11", db.sb)).toBe("needs_human"); expect(mocks.customer).not.toHaveBeenCalled();
  expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_fail", expect.objectContaining({ p_error_code: error, p_retryable: false }));
});
it("transient Graph failures retry through a lease-fenced closed code", async () => {
  mocks.graph.mockResolvedValue({ ok: false, error: "graph_rate_limit" }); const db = database([claim, { data: true }]);
  expect(await processMetaLead("11", db.sb)).toBe("retry");
  expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_fail", expect.objectContaining({ p_error_code: "graph_rate_limit", p_retryable: true, p_lease_id: expect.any(String) }));
});
it("unknown DB errors cannot leak token or contact text into logs or ledger", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.customer.mockRejectedValue(new Error("stub-page-token guest@example.test")); const db = database([claim, { data: true }]);
  expect(await processMetaLead("11", db.sb)).toBe("retry");
  expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_fail", expect.objectContaining({ p_error_code: "database" }));
  expect(JSON.stringify(db.rpc.mock.calls)).not.toContain("stub-page-token"); expect(log).not.toHaveBeenCalled(); log.mockRestore();
});
it("unknown form stops before Graph or customer creation", async () => {
  vi.stubEnv("META_LEADS_FORMS", "[]"); const db = database([claim, { data: true }]);
  expect(await processMetaLead("11", db.sb)).toBe("needs_human"); expect(mocks.graph).not.toHaveBeenCalled();
});
it("missing shop fails rather than guessing a location", async () => {
  const db = database([claim, { data: true }], { data: null }); expect(await processMetaLead("11", db.sb)).toBe("needs_human"); expect(mocks.customer).not.toHaveBeenCalled();
});
it("stale completion is not reported as a persisted failure", async () => {
  mocks.graph.mockResolvedValue({ ok: false, error: "graph_timeout" }); const db = database([claim, { data: false }]);
  await expect(processMetaLead("11", db.sb)).rejects.toThrow("meta_state_write_failed");
});
