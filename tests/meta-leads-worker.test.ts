import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ graph: vi.fn(), customer: vi.fn(), manager: vi.fn(), db: vi.fn(), continuation: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.db }));
vi.mock("@/lib/portal/magic-link", () => ({ resolveOrCreatePortalCustomer: mocks.customer }));
vi.mock("@/lib/catering/system-intake-assignee", () => ({ resolveCateringManager: mocks.manager }));
vi.mock("@/lib/meta-leads/graph", () => ({ fetchMetaLead: mocks.graph }));
vi.mock("@/lib/meta-leads/continuation", () => ({ sendMetaContinuation: mocks.continuation }));
import { processMetaLead, recordMetaLead, sweepMetaLeads } from "@/lib/meta-leads/worker";
type Reply = { data?: unknown; error?: unknown };
const claim = { data: { claimed: true, attempts: 1, page_id: "22", form_id: "33", provider_created_at: "2026-11-11T12:00:00Z" } };
const created = { data: { state: "created", pipeline_id: "lead-id" } };
const fields = (opted = false, extra: Record<string, string> = {}) => Object.entries({ full_name: "Example Guest", email: "guest@example.test", preferred_shop: "p-street", fulfillment_method: "delivery", notes: "Meeting", email_marketing_opt_in: String(opted), unknown_key: "PRIVATE VALUE", ...extra }).map(([name, value]) => ({ name, values: [value] }));
function database(replies: Reply[] = [claim, created], location: Reply = { data: { id: "shop-id" } }) {
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
  mocks.continuation.mockResolvedValue("sent");
});
afterEach(() => vi.unstubAllEnvs());
it("off does no client, Graph, customer, manager or email work even during sweep", async () => {
  vi.stubEnv("META_LEADS_ENABLED", "true");
  expect(await processMetaLead("11")).toBe("disabled");
  expect(await sweepMetaLeads()).toEqual({ processed: 0 });
  expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.graph).not.toHaveBeenCalled(); expect(mocks.customer).not.toHaveBeenCalled();
  expect(mocks.continuation).not.toHaveBeenCalled();
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
  expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_intake_apply", expect.objectContaining({ p_customer_id: "customer-id", p_assigned_to: "manager-id", p_location_id: "shop-id", p_raw_keys: expect.arrayContaining(["unknown_key"]), p_intake: expect.objectContaining({ language: "es", fulfillment: "delivery", email: "guest@example.test", secondary_email: null, mapping_version: "meta-leads-v2" }) }));
  expect(JSON.stringify(db.rpc.mock.calls)).not.toContain("PRIVATE VALUE");
  expect(db.rpc.mock.calls.map(c => c[0])).not.toContain("customer_consent_record_explicit");
});
it("a created lead gets exactly ONE continuation, after the apply, to the order email with the pipeline id", async () => {
  const db = database(); expect(await processMetaLead("11", db.sb)).toBe("created");
  expect(mocks.continuation).toHaveBeenCalledTimes(1);
  expect(mocks.continuation).toHaveBeenCalledWith(db.sb, { leadgenId: "11", pipelineId: "lead-id", locationId: "shop-id", language: "es", intake: expect.objectContaining({ contactEmail: "guest@example.test", contactName: "Example Guest" }) });
  expect(db.rpc.mock.invocationCallOrder[1]!).toBeLessThan(mocks.continuation.mock.invocationCallOrder[0]!);
});
it.each(["attached", "needs_human"])("honors SQL %s result without further writes and without any email", async state => {
  const db = database([claim, { data: { state, pipeline_id: "lead-id" } }]);
  expect(await processMetaLead("11", db.sb)).toBe(state); expect(db.rpc).toHaveBeenCalledTimes(2);
  expect(mocks.continuation).not.toHaveBeenCalled();
});
it("a continuation ledger failure never fails or re-runs the intake and logs no PII", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.continuation.mockRejectedValue(new Error("guest@example.test stub-page-token"));
  const db = database(); expect(await processMetaLead("11", db.sb)).toBe("created");
  expect(db.rpc).toHaveBeenCalledTimes(2);
  expect(db.rpc.mock.calls.map(c => c[0])).not.toContain("meta_lead_fail");
  expect(JSON.stringify(log.mock.calls)).not.toContain("guest@example.test"); expect(JSON.stringify(log.mock.calls)).not.toContain("stub-page-token");
  log.mockRestore();
});
it("records only checked consent before lead creation with stable evidence ref", async () => {
  mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: fields(true) } });
  const db = database([claim, { data: { event_id: "consent-id", recorded: true } }, created]);
  expect(await processMetaLead("11", db.sb)).toBe("created");
  expect(db.rpc).toHaveBeenNthCalledWith(2, "customer_consent_record_explicit", expect.objectContaining({ p_evidence_ref: "11:email_marketing_opt_in", p_source: "meta_lead_form", p_channel: "email", p_text_version: "meta-email-marketing-v3" }));
});
it("double capture: the work email is the order identity everywhere, the Meta email is the ONLY consent subject and a secondary note", async () => {
  mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: fields(true, { work_email: "Buyer@Work.example" }) } });
  const db = database([claim, { data: { event_id: "consent-id", recorded: true } }, created]);
  expect(await processMetaLead("11", db.sb)).toBe("created");
  expect(db.rpc).toHaveBeenNthCalledWith(2, "customer_consent_record_explicit", expect.objectContaining({ p_email: "guest@example.test" }));
  expect(mocks.customer).toHaveBeenCalledWith("buyer@work.example", "Example Guest", "meta_lead_form");
  expect(db.rpc).toHaveBeenNthCalledWith(3, "meta_lead_intake_apply", expect.objectContaining({ p_intake: expect.objectContaining({ email: "buyer@work.example", secondary_email: "guest@example.test" }) }));
  expect(mocks.continuation).toHaveBeenCalledWith(db.sb, expect.objectContaining({ intake: expect.objectContaining({ contactEmail: "buyer@work.example", marketingEmail: "guest@example.test" }) }));
  for (const call of db.rpc.mock.calls.filter(c => c[0] === "customer_consent_record_explicit")) expect((call[1] as { p_email: string }).p_email).not.toBe("buyer@work.example");
});
it("double capture: the same address in both boxes is one identity with nothing secondary", async () => {
  mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: fields(true, { work_email: "GUEST@Example.test" }) } });
  const db = database([claim, { data: { event_id: "consent-id", recorded: true } }, created]);
  expect(await processMetaLead("11", db.sb)).toBe("created");
  expect(mocks.customer).toHaveBeenCalledWith("guest@example.test", "Example Guest", "meta_lead_form");
  expect(db.rpc).toHaveBeenNthCalledWith(3, "meta_lead_intake_apply", expect.objectContaining({ p_intake: expect.objectContaining({ email: "guest@example.test", secondary_email: null }) }));
});
it("double capture: an invalid work email never changes the identity and is kept as typed in the notes", async () => {
  mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: fields(false, { work_email: "not-an-email" }) } });
  const db = database(); expect(await processMetaLead("11", db.sb)).toBe("created");
  expect(mocks.customer).toHaveBeenCalledWith("guest@example.test", "Example Guest", "meta_lead_form");
  expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_intake_apply", expect.objectContaining({ p_intake: expect.objectContaining({ email: "guest@example.test", secondary_email: null, notes: expect.stringContaining("Work email (as typed): not-an-email") }) }));
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
  expect(mocks.continuation).not.toHaveBeenCalled();
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

it.each([["invalid_customer", "identity_unresolved"], ["invalid_location", "invalid_location"], ["invalid_assignee", "invalid_assignee"], ["invalid_intake", "invalid_payload"]])("RPC refusal %s is terminal", async (message, code) => {
  const db = database([claim, { error: { message } }, { data: true }]);
  expect(await processMetaLead("11", db.sb)).toBe("needs_human");
  expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_fail", expect.objectContaining({ p_error_code: code, p_retryable: false }));
});
it("stale apply lease returns busy without attempting a failure write or an email", async () => {
  const db = database([claim, { error: { message: "stale_lease" } }]);
  expect(await processMetaLead("11", db.sb)).toBe("busy");
  expect(db.rpc).toHaveBeenCalledTimes(2); expect(mocks.continuation).not.toHaveBeenCalled();
});
it("consent uses receipt time across retries despite changed Graph time", async () => {
  for (const created_time of ["2026-11-10T00:00:00Z", "2026-11-11T00:00:00Z"]) {
    mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", created_time, field_data: fields(true) } });
    const db = database([claim, { data: { event_id: "same-event" } }, created]);
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(db.rpc).toHaveBeenNthCalledWith(2, "customer_consent_record_explicit", expect.objectContaining({ p_effective_at: claim.data.provider_created_at }));
  }
});

it("unknown refusal names cannot escape the closed error vocabulary", async () => {
  const db = database([claim, { error: { message: "constructor" } }, { data: true }]);
  expect(await processMetaLead("11", db.sb)).toBe("retry");
  expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_fail", expect.objectContaining({ p_error_code: "database", p_retryable: true }));
});
