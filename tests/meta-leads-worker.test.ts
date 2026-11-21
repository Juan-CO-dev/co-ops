import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
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
/** The company latest-lead query: one DB-side row through the FK-named inner embed (AGENTS: service-role embed, disambiguated by constraint name). */
const COMPANY_JOIN = (companyId: string): Op[] => [["select", ["location_id, created_at, catering_customers!catering_pipeline_customer_id_fkey!inner(company_id)"]], ["eq", ["catering_customers.company_id", companyId]], ["not", ["location_id", "is", null]], ["order", ["created_at", { ascending: false }]], ["limit", [1]]];
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
/** Item 1: `meta_lead_record_ad_refs` is answered by its own mock (`adRefs`, default "recorded"), so the
 *  sequenced `rpc` replies and call counts below keep describing the intake RPCs only. Call order is
 *  still comparable across both mocks (vitest's invocationCallOrder is global). */
function database(replies: Reply[] = [claim, created], tables: Record<string, Reply | Reply[]> = {}, adRefsReply: Reply = { data: "recorded" }) {
  const merged: Record<string, Reply | Reply[]> = { locations: { data: { id: "shop-id", name: "Capitol Hill" } }, catering_customers: { data: null }, catering_pipeline: { data: null }, ...tables };
  const adRefs = vi.fn(async (...args: unknown[]) => { void args; return adRefsReply; });
  const rpc = vi.fn(async (...args: unknown[]) => { void args; const reply = replies.shift(); if (!reply) throw new Error("unexpected rpc"); return reply; });
  const dispatch = (name: string, args: unknown) => name === "meta_lead_record_ad_refs" ? adRefs(name, args) : rpc(name, args);
  const queries: Array<{ table: string; ops: Op[] }> = [];
  const from = vi.fn((table: string) => {
    const record = { table, ops: [] as Op[] }; queries.push(record);
    const reply = (): Reply => { const r = merged[table]; if (Array.isArray(r)) return r.length > 1 ? r.shift()! : (r[0] ?? { data: null }); return r ?? { data: null }; };
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "eq", "ilike", "in", "not", "order", "limit", "returns", "lte", "gte", "lt", "or"]) chain[op] = vi.fn((...args: unknown[]) => { record.ops.push([op, args]); return chain; });
    chain.maybeSingle = vi.fn(async () => reply());
    chain.then = (resolve: (v: Reply) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(reply()).then(resolve, reject);
    return chain;
  });
  const sb = { rpc: dispatch, from } as unknown as NonNullable<Parameters<typeof processMetaLead>[1]>;
  mocks.db.mockReturnValue(sb);
  const ops = (table: string) => queries.filter(q => q.table === table).map(q => q.ops);
  const applied = () => rpc.mock.calls.find(c => c[0] === "meta_lead_intake_apply")?.[1] as { p_location_id: string; p_intake: { notes: string | null; location_id: string } } | undefined;
  return { sb, rpc, adRefs, from, queries, ops, applied };
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
  // The fixture answers "Nov 20", which the parser resolves to the NEXT Nov 20 on or after today (ET). Pin the clock
  // before it, so the expected 2026-11-20 never rolls to the following year as real dates pass (broke 2026-11-21).
  vi.useFakeTimers({ now: Date.parse("2026-11-15T12:00:00.000Z"), toFake: ["Date"] });
  onTestFinished(() => { vi.useRealTimers(); });
  const db = database(); expect(await processMetaLead("11", db.sb)).toBe("created");
  expect(db.ops("locations")[0]).toEqual(expect.arrayContaining([["eq", ["code", "MEP"]], ["eq", ["active", true]]]));
  expect(mocks.customer).toHaveBeenCalledWith("guest@example.test", "Example Guest", "meta_lead_form");
  expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_intake_apply", expect.objectContaining({ p_customer_id: "customer-id", p_assigned_to: "manager-id", p_location_id: "shop-id", p_raw_keys: [...LIVE_KEYS, "email_marketing_opt_in", "unknown_key"], p_intake: expect.objectContaining({ language: "es", fulfillment: "pickup", email: "guest@example.test", secondary_email: null, mapping_version: "meta-leads-v5", headcount: null, event_date: "2026-11-20" }) }));
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
    expect(db.ops("catering_pipeline")[0]).toEqual([["select", ["location_id"]], ["eq", ["customer_id", "cust-1"]], ["not", ["location_id", "is", null]], ["order", ["created_at", { ascending: false }]], ["limit", [1]]]);
    expect(db.ops("catering_customers")).toHaveLength(1);
    expect(db.ops("locations")[0]).toEqual(expect.arrayContaining([["eq", ["id", "em-id"]], ["eq", ["active", true]]]));
    expect(db.applied()).toMatchObject({ p_location_id: "em-id", p_intake: { notes: "Meeting\nSizing: seconds yes · add sides and drinks\nHeadcount: 21-40\nRouted: last order at Dupont\nunknown_key: PRIVATE VALUE" } });
    expect(mocks.company).not.toHaveBeenCalled();
  });
  it("(a) a known company (domain auto-attach, no customer yet) goes to the company's most recent lead", async () => {
    mocks.company.mockResolvedValue("company-1");
    const db = database([claim, created], { catering_customers: [{ data: null }, { data: [] }], catering_pipeline: { data: { location_id: "em-id", created_at: "2026-11-01T00:00:00Z", catering_customers: { company_id: "company-1" } } }, locations: { data: { id: "em-id", name: "Dupont" } } });
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(mocks.company).toHaveBeenCalledWith("guest@example.test");
    expect(db.ops("catering_customers")).toHaveLength(2);
    expect(db.ops("catering_pipeline")[0]).toEqual(COMPANY_JOIN("company-1"));
    expect(db.applied()!.p_intake.notes).toContain("Routed: last order at Dupont");
  });
  it("(a) the customer's own company is used without the domain lookup when the customer has no lead of their own", async () => {
    const db = database([claim, created], { catering_customers: { data: { id: "cust-1", company_id: "company-9" } }, catering_pipeline: [{ data: null }, { data: { location_id: "em-id" } }], locations: { data: { id: "em-id", name: "Dupont" } } });
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(mocks.company).not.toHaveBeenCalled();
    expect(db.ops("catering_customers")).toHaveLength(1);
    expect(db.ops("catering_pipeline")[1]).toEqual(COMPANY_JOIN("company-9"));
    expect(db.applied()!.p_intake.notes).toContain("Routed: last order at Dupont");
  });
  it("(a) an INACTIVE returning customer (the resolver's revival precedence, read-only) routes to the shop of their own history", async () => {
    const db = database([claim, created], { catering_customers: [{ data: null }, { data: [{ id: "cust-old", company_id: null }] }], catering_pipeline: { data: { location_id: "em-id" } }, locations: { data: { id: "em-id", name: "Dupont" } } });
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(db.ops("catering_customers")[0]).toEqual(expect.arrayContaining([["eq", ["active", true]]]));
    expect(db.ops("catering_customers")[1]).toEqual([["select", ["id, company_id"]], ["or", ["active.is.null,active.is.false"]], ["ilike", ["email", "guest@example.test"]], ["order", ["created_at", { ascending: false }]], ["limit", [1]], ["returns", []]]);
    expect(db.ops("catering_pipeline")[0]).toEqual(expect.arrayContaining([["eq", ["customer_id", "cust-old"]]]));
    expect(db.applied()).toMatchObject({ p_location_id: "em-id", p_intake: { notes: expect.stringContaining("Routed: last order at Dupont") } });
    // Routing revives nothing: the identity step (mocked here) is still the only writer, and it runs after.
    expect(mocks.customer).toHaveBeenCalledTimes(1);
    expect(db.queries.every(q => !q.ops.some(([op]) => op === "update" || op === "insert" || op === "upsert"))).toBe(true);
  });
  it("(a) a company's latest lead is found DB-side through the customer join — contact 501's lead wins, no contact list, no .in()", async () => {
    mocks.company.mockResolvedValue("company-1");
    // The database answers the join with the newest lead, which belongs to the 501st contact.
    const db = database([claim, created], { catering_customers: [{ data: null }, { data: [] }], catering_pipeline: { data: { location_id: "em-id", created_at: "2026-11-11T00:00:00Z", catering_customers: { company_id: "company-1" } } }, locations: { data: { id: "em-id", name: "Dupont" } } });
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(db.ops("catering_pipeline")).toHaveLength(1);
    expect(db.ops("catering_pipeline")[0]).toEqual(COMPANY_JOIN("company-1"));
    expect(db.queries.every(q => !q.ops.some(([op]) => op === "in"))).toBe(true);
    expect(db.ops("catering_customers").every(ops => !ops.some(([op, args]) => op === "eq" && args[0] === "company_id"))).toBe(true);
    expect(db.applied()).toMatchObject({ p_location_id: "em-id", p_intake: { notes: expect.stringContaining("Routed: last order at Dupont") } });
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
it("the LIVE form's label-keyed consent checkbox (custom_disclaimer_responses) records consent through the worker", async () => {
  const LIVE_KEY = "email_me_news_and_offers_from_compliments_only_at_my_email_above._i_can_unsubscribe_anytime.";
  mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", field_data: fields(false).filter(f => f.name !== "email_marketing_opt_in"), custom_disclaimer_responses: [{ checkbox_key: LIVE_KEY, is_checked: "1" }] } });
  const db = database([claim, { data: { event_id: "consent-id", recorded: true } }, created]);
  expect(await processMetaLead("11", db.sb)).toBe("created");
  expect(db.rpc).toHaveBeenNthCalledWith(2, "customer_consent_record_explicit", expect.objectContaining({ p_evidence_ref: "11:email_marketing_opt_in", p_text_version: "meta-email-marketing-v3" }));
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

describe("Ad refs (item 1): stored under the lease, before mapping", () => {
  const leaseOf = (db: ReturnType<typeof database>) => (db.rpc.mock.calls[0]![1] as { p_lease_id: string }).p_lease_id;
  it("records the Graph ad_id / adset_id with the claim's lease, after the fetch and before mapping, identity or the apply", async () => {
    mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", ad_id: "1", adset_id: "777", field_data: fields() } });
    const db = database();
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(db.adRefs).toHaveBeenCalledExactlyOnceWith("meta_lead_record_ad_refs", { p_leadgen_id: "11", p_lease_id: leaseOf(db), p_ad_id: "1", p_adset_id: "777" });
    expect(db.adRefs.mock.invocationCallOrder[0]!).toBeGreaterThan(mocks.graph.mock.invocationCallOrder[0]!);
    expect(db.adRefs.mock.invocationCallOrder[0]!).toBeLessThan(mocks.customer.mock.invocationCallOrder[0]!);
    expect(db.adRefs.mock.invocationCallOrder[0]!).toBeLessThan(db.rpc.mock.invocationCallOrder[1]!);
  });
  it("missing ids are sent as SQL NULLs", async () => {
    const db = database();
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(db.adRefs).toHaveBeenCalledWith("meta_lead_record_ad_refs", expect.objectContaining({ p_ad_id: null, p_adset_id: null }));
  });
  it("a lead that fails mapping (needs_human) still keeps its ids", async () => {
    mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", ad_id: "1", adset_id: "777", field_data: fields(false, { preferred_shop: "Somewhere" }) } });
    const db = database([claim, { data: true }]);
    expect(await processMetaLead("11", db.sb)).toBe("needs_human");
    expect(db.adRefs).toHaveBeenCalledWith("meta_lead_record_ad_refs", expect.objectContaining({ p_ad_id: "1", p_adset_id: "777" }));
    expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_fail", expect.objectContaining({ p_error_code: "invalid_payload" }));
  });
  it("a Graph failure records nothing (there are no Graph ids)", async () => {
    mocks.graph.mockResolvedValue({ ok: false, error: "graph_timeout" });
    const db = database([claim, { data: true }]);
    expect(await processMetaLead("11", db.sb)).toBe("retry");
    expect(db.adRefs).not.toHaveBeenCalled();
  });
  it("stale_lease returns busy at once: no identity, consent, apply or failure write", async () => {
    mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", ad_id: "1", field_data: fields(true) } });
    const db = database([claim], {}, { data: "stale_lease" });
    expect(await processMetaLead("11", db.sb)).toBe("busy");
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.customer).not.toHaveBeenCalled(); expect(mocks.manager).not.toHaveBeenCalled(); expect(mocks.continuation).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each([[{ error: { message: "boom" } }], [{ data: "not_found" }], [{ data: null }], [{ data: "constructor" }]])("an RPC error or unknown answer %j is a retryable database failure", async reply => {
    const db = database([claim, { data: true }], {}, reply as Reply);
    expect(await processMetaLead("11", db.sb)).toBe("retry");
    expect(db.rpc).toHaveBeenLastCalledWith("meta_lead_fail", expect.objectContaining({ p_error_code: "database", p_retryable: true }));
    expect(mocks.customer).not.toHaveBeenCalled();
  });
  it("'unchanged' (a retry, or ids already stored) proceeds normally", async () => {
    const db = database([claim, created], {}, { data: "unchanged" });
    expect(await processMetaLead("11", db.sb)).toBe("created");
  });
  it("webhook and Graph ids that disagree are both stored and the intake proceeds (attribution is not identity)", async () => {
    const receipt = database([{ data: { inserted: true } }]);
    expect(await recordMetaLead({ leadgenId: "11", pageId: "22", formId: "33", createdAt: "2026-11-11T12:00:00Z", adId: "5", adgroupId: "6" }, true, receipt.sb)).toBe(true);
    expect(receipt.rpc).toHaveBeenCalledWith("meta_lead_record", { p_leadgen_id: "11", p_page_id: "22", p_form_id: "33", p_created_at: "2026-11-11T12:00:00Z", p_enabled: true, p_webhook_ad_id: "5", p_webhook_adgroup_id: "6" });
    mocks.graph.mockResolvedValue({ ok: true, lead: { id: "11", ad_id: "1", adset_id: "2", field_data: fields() } });
    const db = database();
    expect(await processMetaLead("11", db.sb)).toBe("created");
    expect(db.adRefs).toHaveBeenCalledWith("meta_lead_record_ad_refs", expect.objectContaining({ p_ad_id: "1", p_adset_id: "2" }));
  });
  it("a receipt without webhook ids sends NULLs (the named 7-argument call)", async () => {
    const db = database([{ data: { inserted: true } }]);
    await recordMetaLead({ leadgenId: "11", pageId: "22", formId: "33", createdAt: "2026-11-11T12:00:00Z" }, true, db.sb);
    expect(db.rpc).toHaveBeenCalledWith("meta_lead_record", expect.objectContaining({ p_webhook_ad_id: null, p_webhook_adgroup_id: null }));
  });
});

// W24/B211: a lead CREATED whose email was never attempted (a lost apply response, or a claim RPC
// error) is swept: the claim (compare-and-set, 24 h per-address cap) is safe to repeat.
describe("sweep: stranded continuation", () => {
  const LOCATION = "0d7a3c2e-6f43-4b8e-9c1a-2b3c4d5e6f70";
  const NOW = Date.parse("2026-11-15T12:00:00.000Z");
  const snapshot = (email = "guest@example.test", name = "Example Guest") => ({ contact_name: name, email, contact_phone: null, company: null, event_date: "2026-11-20", headcount: 30, fulfillment: "delivery", language: "es", location_id: LOCATION, mapping_version: "meta-leads-v5" });
  const stranded = (id: string, s: unknown = snapshot()) => ({ leadgen_id: id, pipeline_id: `pipe-${id}`, intake_snapshot: s });
  /** meta_lead_events queries in order: the retry sweep, the stranded read, the stale count. */
  function sweepDb(rows: unknown[], stale = 0) {
    return database([], { meta_lead_events: [{ data: [] }, { data: rows }, { data: null, count: stale } as Reply] });
  }
  beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ["Date"] }); });
  afterEach(() => { vi.useRealTimers(); });

  it("a created/pending lead past the grace gets exactly one continuation rebuilt from its snapshot", async () => {
    const db = sweepDb([stranded("41")]);
    const result = await sweepMetaLeads(db.sb);
    expect(mocks.continuation).toHaveBeenCalledOnce();
    const [, args] = mocks.continuation.mock.calls[0]!;
    expect(args).toMatchObject({ leadgenId: "41", pipelineId: "pipe-41", locationId: LOCATION, language: "es" });
    expect(args.intake.contactEmail).toBe("guest@example.test");
    expect(args.intake.isDelivery).toBe(true);
    expect(result).toEqual({ processed: 0, continuations: { sent: 1, other: 0, unusable: 0, failed: 0, stale: 0 } });
  });

  it("selects only created+pending+pipeline rows inside the grace and max-age window", async () => {
    const db = sweepDb([], 3);
    const result = await sweepMetaLeads(db.sb);
    const [, read, count] = db.ops("meta_lead_events");
    expect(read).toEqual(expect.arrayContaining([
      ["eq", ["state", "created"]], ["eq", ["email_state", "pending"]], ["not", ["pipeline_id", "is", null]],
      ["lte", ["completed_at", new Date(NOW - 10 * 60_000).toISOString()]],
      ["gte", ["completed_at", new Date(NOW - 24 * 60 * 60_000).toISOString()]],
      ["limit", [10]],
    ]));
    expect(read!.find(op => op[0] === "select")?.[1][0]).toBe("leadgen_id, pipeline_id, intake_snapshot");
    expect(count).toEqual(expect.arrayContaining([
      ["eq", ["state", "created"]], ["eq", ["email_state", "pending"]], ["not", ["pipeline_id", "is", null]],
      ["lt", ["completed_at", new Date(NOW - 24 * 60 * 60_000).toISOString()]],
    ]));
    expect(mocks.continuation).not.toHaveBeenCalled();
    expect(result.continuations?.stale).toBe(3);
  });

  it("a continuation failure on one row neither stops the sweep nor logs PII", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.continuation.mockRejectedValueOnce(new Error("guest@example.test Example Guest")).mockResolvedValueOnce("capped");
    const db = sweepDb([stranded("41"), stranded("42", snapshot("other@example.test", "Other Guest"))]);
    const result = await sweepMetaLeads(db.sb);
    expect(mocks.continuation).toHaveBeenCalledTimes(2);
    expect(result.continuations).toEqual({ sent: 0, other: 1, unusable: 0, failed: 1, stale: 0 });
    const logged = JSON.stringify(errors.mock.calls);
    for (const pii of ["guest@example.test", "Example Guest", "other@example.test", "Other Guest"]) expect(logged).not.toContain(pii);
    errors.mockRestore();
  });

  it("an unusable snapshot sends nothing and is counted", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = sweepDb([stranded("41", null), stranded("42", { ...snapshot(), location_id: "nope" })]);
    const result = await sweepMetaLeads(db.sb);
    expect(mocks.continuation).not.toHaveBeenCalled();
    expect(result.continuations).toEqual({ sent: 0, other: 0, unusable: 2, failed: 0, stale: 0 });
    expect(JSON.stringify(errors.mock.calls)).not.toContain("guest@example.test");
    errors.mockRestore();
  });

  it("a failed stranded read is a closed sweep failure", async () => {
    const db = database([], { meta_lead_events: [{ data: [] }, { data: null, error: { message: "boom" } }] });
    await expect(sweepMetaLeads(db.sb)).rejects.toThrow("meta_continuation_read_failed");
  });

  it("META_LEADS_ENABLED off does no continuation work", async () => {
    vi.stubEnv("META_LEADS_ENABLED", "0");
    const db = sweepDb([stranded("41")]);
    expect(await sweepMetaLeads(db.sb)).toEqual({ processed: 0 });
    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.continuation).not.toHaveBeenCalled();
  });
});
