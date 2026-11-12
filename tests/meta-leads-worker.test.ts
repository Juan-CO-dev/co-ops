import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ graph: vi.fn(), customer: vi.fn(), manager: vi.fn(), db: vi.fn(), continuation: vi.fn(), company: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.db }));
vi.mock("@/lib/portal/magic-link", () => ({ resolveOrCreatePortalCustomer: mocks.customer }));
vi.mock("@/lib/catering/system-intake-assignee", () => ({ resolveCateringManager: mocks.manager }));
vi.mock("@/lib/catering/companies", () => ({ resolveCompanyForEmail: mocks.company, normalizeEmail: (s: string) => s.trim().toLowerCase(), escapeLike: (s: string) => s }));
vi.mock("@/lib/meta-leads/graph", () => ({ fetchMetaLead: mocks.graph }));
vi.mock("@/lib/meta-leads/continuation", () => ({ sendMetaContinuation: mocks.continuation }));
// The tenant tables, with ONE ad set mapped so routing rule (b) is testable (the CO config ships it empty).
vi.mock("@/config/tenant/meta-leads", async original => {
  const actual = await original<typeof import("@/config/tenant/meta-leads")>();
  return { ...actual, metaLeadsTenantConfig: { ...actual.metaLeadsTenantConfig, adSetShop: { "777": "EM" } } };
});
import { processMetaLead, recordMetaLead, sweepMetaLeads } from "@/lib/meta-leads/worker";
type Reply = { data?: unknown; error?: unknown };
type Op = [string, unknown[]];
const claim = { data: { claimed: true, attempts: 1, page_id: "22", form_id: "33", provider_created_at: "2026-11-11T12:00:00Z" } };
const created = { data: { state: "created", pipeline_id: "lead-id" } };
const DEFAULT_NOTE = "Routed: default shop — please confirm (delivery, no shop chosen)";
/** The live form's EXACT raw key list (form 2514347029057258), label values. */
const LIVE_KEYS = ["fulfillment_method", "preferred_shop", "headcount", "seconds", "extras", "event_date", "notes", "email", "phone_number", "full_name", "work_email", "work_phone_number", "company_name", "job_title"] as const;
type LiveKey = (typeof LIVE_KEYS)[number];
const fields = (opted = false, extra: Partial<Record<LiveKey | string, string>> = {}) => {
  const base: Record<LiveKey, string> = { fulfillment_method: "Pickup", preferred_shop: "Capitol Hill", headcount: "21-40", seconds: "Yes", extras: "Add sides and drinks", event_date: "Nov 20", notes: "Meeting", email: "guest@example.test", phone_number: "2025550100", full_name: "Example Guest", work_email: "", work_phone_number: "", company_name: "", job_title: "" };
  const merged: Record<string, string> = { ...base, email_marketing_opt_in: String(opted), unknown_key: "PRIVATE VALUE", ...extra };
  return Object.entries(merged).map(([name, value]) => ({ name, values: [value] }));
};
const delivery = (extra: Partial<Record<string, string>> = {}) => fields(false, { fulfillment_method: "Delivery", preferred_shop: "Our catering team picks the closest shop", ...extra });
/** A table-aware PostgREST stand-in: every builder call is recorded; the reply is per table (an array = one reply per query, the last one sticks). */
function database(replies: Reply[] = [claim, created], tables: Record<string, Reply | Reply[]> = {}) {
  const merged: Record<string, Reply | Reply[]> = { locations: { data: { id: "shop-id", name: "Capitol Hill" } }, catering_customers: { data: null }, catering_pipeline: { data: null }, ...tables };
  const rpc = vi.fn(async (...args: unknown[]) => { void args; const reply = replies.shift(); if (!reply) throw new Error("unexpected rpc"); return reply; });
  const queries: Array<{ table: string; ops: Op[] }> = [];
  const from = vi.fn((table: string) => {
    const record = { table, ops: [] as Op[] }; queries.push(record);
    const reply = (): Reply => { const r = merged[table]; if (Array.isArray(r)) return r.length > 1 ? r.shift()! : (r[0] ?? { data: null }); return r ?? { data: null }; };
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "eq", "ilike", "in", "not", "order", "limit", "returns", "lte", "or"]) chain[op] = vi.fn((...args: unknown[]) => { record.ops.push([op, args]); return chain; });
    chain.maybeSingle = vi.fn(async () => reply());
    chain.then = (resolve: (v: Reply) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(reply()).then(resolve, reject);
    return chain;
  });
  const sb = { rpc, from } as unknown as NonNullable<Parameters<typeof processMetaLead>[1]>;
  mocks.db.mockReturnValue(sb);
  const ops = (table: string) => queries.filter(q => q.table === table).map(q => q.ops);
  const applied = () => rpc.mock.calls.find(c => c[0] === "meta_lead_intake_apply")?.[1] as { p_location_id: string; p_intake: { notes: string | null; location_id: string } } | undefined;
  return { sb, rpc, from, queries, ops, applied };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("META_LEADS_ENABLED", "1"); vi.stubEnv("CUSTOMER_PROFILES", "1");
  vi.stubEnv("META_LEADS_PAGE_TOKEN", "stub-page-token"); vi.stubEnv("META_LEADS_APP_SECRET", "stub-secret");
  vi.stubEnv("META_LEADS_FORMS", JSON.stringify([{ pageId: "22", formId: "33", language: "es" }]));
  mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: fields() } });
  mocks.customer.mockResolvedValue("customer-id"); mocks.manager.mockResolvedValue("manager-id");
  mocks.continuation.mockResolvedValue("sent"); mocks.company.mockResolvedValue(null);
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
it("creates only through the RPC with resolved manager, label-resolved shop, source attribution and key-only ledger diagnostics", async () => {
  const db = database(); expect(await processMetaLead("11", db.sb)).toBe("created");
  expect(db.ops("locations")[0]).toEqual(expect.arrayContaining([["eq", ["code", "MEP"]], ["eq", ["active", true]]]));
  expect(mocks.customer).toHaveBeenCalledWith("guest@example.test", "Example Guest", "meta_lead_form");
  expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_intake_apply", expect.objectContaining({ p_customer_id: "customer-id", p_assigned_to: "manager-id", p_location_id: "shop-id", p_raw_keys: [...LIVE_KEYS, "email_marketing_opt_in", "unknown_key"], p_intake: expect.objectContaining({ language: "es", fulfillment: "pickup", email: "guest@example.test", secondary_email: null, mapping_version: "meta-leads-v3", headcount: null, event_date: "2026-11-20" }) }));
  // The ledger carries key names only; the unknown answer rides on the lead's notes (never a ledger field).
  const apply = db.rpc.mock.calls.at(-1)![1] as { p_raw_keys: string[]; p_intake: { notes: string } };
  expect(JSON.stringify(apply.p_raw_keys)).not.toContain("PRIVATE VALUE");
  expect(apply.p_intake.notes).toBe("Meeting\nSizing: seconds yes · add sides and drinks\nHeadcount: 21-40\nunknown_key: PRIVATE VALUE");
  expect(db.rpc.mock.calls.map(c => c[0])).not.toContain("customer_consent_record_explicit");
  expect(db.ops("catering_customers")).toEqual([]); expect(db.ops("catering_pipeline")).toEqual([]);
});
it("a created lead gets exactly ONE continuation, after the apply, to the order email with the pipeline id and the routed notes", async () => {
  const db = database(); expect(await processMetaLead("11", db.sb)).toBe("created");
  expect(mocks.continuation).toHaveBeenCalledTimes(1);
  expect(mocks.continuation).toHaveBeenCalledWith(db.sb, { leadgenId: "11", pipelineId: "lead-id", locationId: "shop-id", language: "es", intake: expect.objectContaining({ contactEmail: "guest@example.test", contactName: "Example Guest", shopCode: "MEP", notes: expect.stringContaining("Meeting") }) });
  expect(db.rpc.mock.invocationCallOrder[1]!).toBeLessThan(mocks.continuation.mock.invocationCallOrder[0]!);
});

describe("The live form: pickup labels", () => {
  it("Pickup + Dupont Circle (P Street) → EM, no routing line", async () => {
    mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: fields(false, { preferred_shop: "Dupont Circle (P Street)" }) } });
    const db = database([claim, created], { locations: { data: { id: "em-id", name: "Dupont" } } });
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(db.ops("locations")[0]).toEqual(expect.arrayContaining([["eq", ["code", "EM"]]]));
    expect(db.applied()).toMatchObject({ p_location_id: "em-id", p_intake: { location_id: "em-id" } });
    expect(db.applied()!.p_intake.notes).not.toContain("Routed");
  });
  it("Pickup + an unknown label is invalid_payload (terminal), before any identity work", async () => {
    mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: fields(false, { preferred_shop: "Somewhere" }) } });
    const db = database([claim, { data: true }]);
    expect(await processMetaLead("11", db.sb)).toBe("needs_human"); expect(mocks.customer).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_fail", expect.objectContaining({ p_error_code: "invalid_payload", p_retryable: false, p_raw_keys: expect.arrayContaining(["unknown_key"]) }));
    expect(JSON.stringify(db.rpc.mock.calls)).not.toContain("PRIVATE VALUE");
  });
  it("an invalid fulfillment is invalid_payload", async () => {
    mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: fields(false, { fulfillment_method: "Ship it" }) } });
    const db = database([claim, { data: true }]);
    expect(await processMetaLead("11", db.sb)).toBe("needs_human");
    expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_fail", expect.objectContaining({ p_error_code: "invalid_payload" }));
  });
});

describe("Delivery routing (history → ad set → default MEP)", () => {
  beforeEach(() => mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", adset_id: "777", field_data: delivery() } }));
  it("(a) a returning customer goes to the shop of their MOST RECENT pipeline lead, by the ORDER email", async () => {
    const db = database([claim, created], { catering_customers: { data: { id: "cust-1", company_id: null } }, catering_pipeline: { data: { location_id: "em-id" } }, locations: { data: { id: "em-id", name: "Dupont" } } });
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(db.ops("catering_customers")[0]).toEqual(expect.arrayContaining([["select", ["id, company_id"]], ["eq", ["active", true]], ["ilike", ["email", "guest@example.test"]]]));
    expect(db.ops("catering_pipeline")[0]).toEqual([["select", ["location_id"]], ["in", ["customer_id", ["cust-1"]]], ["not", ["location_id", "is", null]], ["order", ["created_at", { ascending: false }]], ["limit", [1]]]);
    expect(db.ops("locations")[0]).toEqual(expect.arrayContaining([["eq", ["id", "em-id"]], ["eq", ["active", true]]]));
    expect(db.applied()).toMatchObject({ p_location_id: "em-id", p_intake: { notes: "Meeting\nSizing: seconds yes · add sides and drinks\nHeadcount: 21-40\nRouted: last order at Dupont\nunknown_key: PRIVATE VALUE" } });
    expect(mocks.company).not.toHaveBeenCalled();
  });
  it("(a) a known company (domain auto-attach, no customer yet) goes to the company's most recent lead", async () => {
    mocks.company.mockResolvedValue("company-1");
    const db = database([claim, created], { catering_customers: [{ data: null }, { data: [{ id: "c1" }, { id: "c2" }] }], catering_pipeline: { data: { location_id: "em-id" } }, locations: { data: { id: "em-id", name: "Dupont" } } });
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(mocks.company).toHaveBeenCalledWith("guest@example.test");
    expect(db.ops("catering_customers")[1]).toEqual(expect.arrayContaining([["eq", ["company_id", "company-1"]]]));
    expect(db.ops("catering_pipeline")[0]).toEqual(expect.arrayContaining([["in", ["customer_id", ["c1", "c2"]]]]));
    expect(db.applied()!.p_intake.notes).toContain("Routed: last order at Dupont");
  });
  it("(a) the customer's own company is used without the domain lookup when the customer has no lead of their own", async () => {
    const db = database([claim, created], { catering_customers: [{ data: { id: "cust-1", company_id: "company-9" } }, { data: [{ id: "cust-1" }, { id: "cust-2" }] }], catering_pipeline: [{ data: null }, { data: { location_id: "em-id" } }], locations: { data: { id: "em-id", name: "Dupont" } } });
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(mocks.company).not.toHaveBeenCalled();
    expect(db.ops("catering_customers")[1]).toEqual(expect.arrayContaining([["eq", ["company_id", "company-9"]]]));
    expect(db.applied()!.p_intake.notes).toContain("Routed: last order at Dupont");
  });
  it("(b) no history + a mapped ad set → that shop", async () => {
    const db = database([claim, created], { locations: { data: { id: "em-id", name: "Dupont" } } });
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(db.ops("locations")[0]).toEqual(expect.arrayContaining([["eq", ["code", "EM"]]]));
    expect(db.applied()).toMatchObject({ p_location_id: "em-id", p_intake: { notes: expect.stringContaining("\nRouted: ad set 777\n") } });
  });
  it("(c) no history, no mapped ad set → the tenant default shop (MEP) with the please-confirm note", async () => {
    mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", adset_id: "999", field_data: delivery() } });
    const db = database();
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(db.ops("locations")[0]).toEqual(expect.arrayContaining([["eq", ["code", "MEP"]]]));
    expect(db.applied()).toMatchObject({ p_location_id: "shop-id", p_intake: { fulfillment: "delivery", notes: `Meeting\nSizing: seconds yes · add sides and drinks\nHeadcount: 21-40\n${DEFAULT_NOTE}\nunknown_key: PRIVATE VALUE` } });
  });
  it("(c) applies without any ad set id too", async () => {
    mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: delivery() } });
    const db = database();
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(db.applied()!.p_intake.notes).toContain(DEFAULT_NOTE);
  });
  it("delivery with an unknown label routes the same way and keeps the label as typed", async () => {
    mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: delivery({ preferred_shop: "Georgetown" }) } });
    const db = database();
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(db.applied()!.p_intake.notes).toContain(`${DEFAULT_NOTE}\nunknown_key: PRIVATE VALUE\nPreferred shop (as typed): Georgetown`);
  });
  it("a historical shop that is no longer active falls through to the next rule", async () => {
    const db = database([claim, created], { catering_customers: { data: { id: "cust-1", company_id: null } }, catering_pipeline: { data: { location_id: "gone-id" } }, locations: [{ data: null }, { data: { id: "em-id", name: "Dupont" } }] });
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(db.ops("locations")[1]).toEqual(expect.arrayContaining([["eq", ["code", "EM"]]]));
    expect(db.applied()!.p_intake.notes).toContain("Routed: ad set 777");
  });
  it("a missing default shop fails closed as invalid_location", async () => {
    mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: delivery() } });
    const db = database([claim, { data: true }], { locations: { data: null } });
    expect(await processMetaLead("11", db.sb)).toBe("needs_human"); expect(mocks.customer).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_fail", expect.objectContaining({ p_error_code: "invalid_location", p_retryable: false }));
  });
  it("a routing read error is a transient database failure with no PII in the ledger", async () => {
    const db = database([claim, { data: true }], { catering_customers: { error: { message: "guest@example.test boom" } } });
    expect(await processMetaLead("11", db.sb)).toBe("retry"); expect(mocks.customer).not.toHaveBeenCalled();
    expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_fail", expect.objectContaining({ p_error_code: "database", p_retryable: true }));
    expect(JSON.stringify(db.rpc.mock.calls)).not.toContain("guest@example.test");
  });
  it("routing lookups happen BEFORE consent, identity and the manager (read-only, nothing created)", async () => {
    mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", adset_id: "777", field_data: delivery({ email_marketing_opt_in: "true" }) } });
    const db = database([claim, { data: { event_id: "consent-id" } }, created], { locations: { data: { id: "em-id", name: "Dupont" } } });
    expect(await processMetaLead("11", db.sb)).toBe("created");
    const firstRpcOrder = db.rpc.mock.invocationCallOrder[1]!;
    for (const q of db.queries) expect(db.from.mock.invocationCallOrder[db.queries.indexOf(q)]!).toBeLessThan(firstRpcOrder);
    expect(mocks.customer.mock.invocationCallOrder[0]!).toBeGreaterThan(firstRpcOrder);
  });
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
it("double capture: delivery routing history is looked up by the ORDER (work) email", async () => {
  mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: delivery({ work_email: "Buyer@Work.example" }) } });
  const db = database([claim, created], { catering_customers: { data: { id: "cust-1", company_id: null } }, catering_pipeline: { data: { location_id: "em-id" } }, locations: { data: { id: "em-id", name: "Dupont" } } });
  expect(await processMetaLead("11", db.sb)).toBe("created");
  expect(db.ops("catering_customers")[0]).toEqual(expect.arrayContaining([["ilike", ["email", "buyer@work.example"]]]));
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
  const db = database([claim, { data: true }], { locations: { data: null } }); expect(await processMetaLead("11", db.sb)).toBe("needs_human"); expect(mocks.customer).not.toHaveBeenCalled();
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
