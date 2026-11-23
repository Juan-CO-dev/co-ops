/**
 * Catering delivery D4 — the economics loader (lib/delivery/economics.ts) over a recording fake client.
 *
 *  - The switch off, a role the cost gate refuses, or a shop the viewer is not at: OFF with ZERO queries.
 *  - The shop's own switch off / no row / 0356 not on the database: OFF after ONE read, zero further queries.
 *  - A failed read is `{ kind: "failed" }`: never zeros, never a throw. A read that never answers is bounded.
 *  - Each relation is read once (id lists chunked), with exactly its own columns: no customer field, no note, no reason,
 *    no reference, no pipeline-value source.
 *  - Scope follows the lead: a lead that left the shop during the reads discards the attempt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliveryActor, deliveryFake, type FakeQuery, type FakeResult, type FakeTables } from "./helpers/delivery-fake";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ defaultClient: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.defaultClient }));

import {
  DELIVERY_ECONOMICS_DEADLINE_MS, ECON_COST_COLUMNS, ECON_EZCATER_COLUMNS, ECON_JOB_COLUMNS, ECON_LEAD_COLUMNS, ECON_QUOTE_COLUMNS, ECON_RECHECK_COLUMNS, ECON_SETTINGS_COLUMNS,
  ECON_SPLIT_COLUMNS, loadDeliveryEconomics, loadDeliveryEconomicsBounded,
} from "@/lib/delivery/economics";

const A = "00000000-0000-4000-8000-00000000000a", B = "00000000-0000-4000-8000-00000000000b";
const RANGE = { from: "2026-11-01", to: "2026-11-30" };
const lead = (n: number, o: Record<string, unknown> = {}) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, location_id: A, stage: "completed", lead_source: "website", event_date: "2026-11-20", ...o });
const L1 = lead(1), L2 = lead(2, { event_date: "2026-11-22" }), L3 = lead(3, { lead_source: "ezcater", event_date: "2026-11-23" }), L4 = lead(4, { stage: "inquiry" });
const quoteRow = (id: string, pipeline: string, o: Record<string, unknown> = {}) => ({ id, pipeline_id: pipeline, status: "accepted", is_delivery: true, gratuity_cents: 10_000, delivery_fee_cents: 4_500, created_at: "2026-11-10T10:00:00Z", ...o });
const jobRow = (id: string, pipeline: string, attempt: number, status: string, o: Record<string, unknown> = {}) => ({ id, pipeline_id: pipeline, booked_via: "manual", provider_label: "Courier A", attempt_no: attempt, status, ...o });
const costRow = (id: string, job: string, cents: number) => ({ id, job_id: job, component: "base", semantics: "snapshot", amount_cents: cents, money_identity: `${job}:base`, observed_at: "2026-11-21T10:00:00Z", corrects_id: null });
const splitRow = (id: string, pipeline: string, job: string) => ({ id, pipeline_id: pipeline, job_id: job, kind: "split", gratuity_cents: 10_000, driver_bps: 1000, driver_cents: 1_000, crew_cents: 9_000, supersedes_id: null });

interface Seen { table: string; q: FakeQuery }
/** A small database: lead 1 delivered and costed (a net), lead 2 a replacement with one job uncosted (partial), lead 3 ezCater, lead 4 an inquiry (not an order). */
function db(over: Partial<Record<string, (q: FakeQuery) => FakeResult>> = {}) {
  const seen: Seen[] = [];
  const leads = [L1, L2, L3, L4];
  const base: FakeTables = {
    delivery_settings: () => ({ data: { location_id: A, enabled: true, gratuity_driver_bps: 1000 } }),
    catering_pipeline: (q) => q.in.id ? { data: leads.filter((l) => (q.in.id as string[]).includes(l.id)).map((l) => ({ id: l.id, location_id: l.location_id })) }
      : { data: leads.filter((l) => l.location_id === q.eq.location_id && l.event_date >= (q.gte.event_date as string) && l.event_date <= (q.lte.event_date as string)) },
    ezcater_orders: () => ({ data: [] }),
    catering_quotes: (q) => ({ data: [quoteRow("q1", L1.id), quoteRow("q2", L2.id), quoteRow("q4", L4.id)].filter((r) => (q.in.pipeline_id as string[]).includes(r.pipeline_id)) }),
    delivery_job_current: (q) => ({ data: [jobRow("j1", L1.id, 1, "delivered"), jobRow("j2a", L2.id, 1, "cancelled"), jobRow("j2b", L2.id, 2, "delivered"),
      jobRow("j3", L3.id, 1, "delivered", { booked_via: "provider_native" })].filter((r) => (q.in.pipeline_id as string[]).includes(r.pipeline_id)) }),
    delivery_gratuity_splits: (q) => ({ data: [splitRow("s1", L1.id, "j1"), splitRow("s2", L2.id, "j2b")].filter((r) => (q.in.pipeline_id as string[]).includes(r.pipeline_id)) }),
    delivery_job_costs: (q) => ({ data: [costRow("c1", "j1", 3_000), costRow("c2", "j2b", 3_000)].filter((r) => (q.in.job_id as string[]).includes(r.job_id)) }),
  };
  const tables: FakeTables = {};
  for (const [name, answer] of Object.entries({ ...base, ...over })) tables[name] = (q) => { seen.push({ table: name, q }); return answer!(q); };
  const fake = deliveryFake(tables);
  return { ...fake, seen };
}
const gm = (shops = [A]) => deliveryActor("gm", shops);

beforeEach(() => { vi.stubEnv("DELIVERY_TRACKING", "1"); h.defaultClient.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("before any I/O: the switch, then the cost gate by trusted role", () => {
  it("the switch off: off, zero queries, for everyone", async () => {
    vi.stubEnv("DELIVERY_TRACKING", "");
    const d = db();
    expect(await loadDeliveryEconomics(d.sb, deliveryActor("owner"), { locationId: A }, RANGE)).toEqual({ kind: "off", reason: "switch" });
    expect(d.reads).toEqual([]);
  });
  it.each([
    ["the prep manager at the shop", deliveryActor("prep_mgr", [A])], ["the social media manager at the shop", deliveryActor("social_media_mgr", [A])],
    ["a shift lead at the shop", deliveryActor("shift_lead", [A])], ["a key holder at the shop", deliveryActor("key_holder", [A])],
    ["a GM of another shop", deliveryActor("gm", [B])], ["an AGM of another shop", deliveryActor("agm", [B])], ["a deactivated owner", deliveryActor("owner", [], {}, false)],
  ])("%s is refused the delivery money: off, zero queries", async (_name, actor) => {
    const d = db();
    expect(await loadDeliveryEconomics(d.sb, actor, { locationId: A }, RANGE)).toEqual({ kind: "off", reason: "forbidden" });
    expect(d.reads).toEqual([]);
  });
  it.each([["the shop's GM", gm()], ["the shop's AGM", deliveryActor("agm", [A])], ["the catering manager", deliveryActor("catering_mgr")],
    ["the MoO", deliveryActor("moo")], ["the owner", deliveryActor("owner")], ["the CGS", deliveryActor("cgs")]])("%s reads it", async (_name, actor) => {
    expect((await loadDeliveryEconomics(db().sb, actor, { locationId: A }, RANGE)).kind).toBe("ok");
  });
  it("'all' or a malformed shop is never a shop: off, zero queries", async () => {
    for (const locationId of ["all", "", "x", `${A} or 1=1`]) {
      const d = db();
      expect(await loadDeliveryEconomics(d.sb, deliveryActor("owner"), { locationId }, RANGE)).toEqual({ kind: "off", reason: "forbidden" });
      expect(d.reads).toEqual([]);
    }
  });
});

describe("the shop's own switch: one read, then nothing", () => {
  it.each([["off", { data: { location_id: A, enabled: false, gratuity_driver_bps: 1000 } }], ["no row", { data: null }]])("%s: off after ONE read, zero further queries", async (_name, row) => {
    const d = db({ delivery_settings: () => row });
    expect(await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, RANGE)).toEqual({ kind: "off", reason: "shop" });
    expect(d.reads).toEqual(["delivery_settings"]);
  });
  it.each(["42P01", "42883", "PGRST202", "PGRST205"])("0356 not on the database (%s): off (not installed), zero further queries, never a failure", async (code) => {
    const d = db({ delivery_settings: () => ({ error: { code, message: "missing" } }) });
    expect(await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, RANGE)).toEqual({ kind: "off", reason: "not_installed" });
    expect(d.reads).toEqual(["delivery_settings"]);
  });
  it("an empty period (no finished day in it) is an EMPTY report after the shop's switch, with no further read", async () => {
    const d = db();
    const out = await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, { ...RANGE, empty: true });
    expect(out).toMatchObject({ kind: "ok", report: { coverage: { orders: 0, withNet: 0 }, orders: [] } });
    expect(d.reads).toEqual(["delivery_settings"]);
  });
});

describe("the report", () => {
  it("the orders of the period at the shop, by event date; coverage, totals over orders with a net, the gaps named", async () => {
    const out = await loadDeliveryEconomics(db().sb, gm(), { locationId: A }, RANGE);
    if (out.kind !== "ok") throw new Error(out.kind);
    expect([out.locationId, out.from, out.to]).toEqual([A, "2026-11-01", "2026-11-30"]);
    expect(out.report.orders.map((o) => o.leadId)).toEqual([L3.id, L2.id, L1.id]); // newest event date first; the inquiry is not an order
    expect(out.report.coverage).toEqual({ orders: 3, withNet: 1 });
    expect(out.report.totals).toEqual({ feeCents: 4_500, costCents: 3_000, netCents: 1_500 });
    expect(out.report.excluded).toEqual([{ reason: "ezcater_fee_unknown", orders: 1 }, { reason: "cost_not_recorded", orders: 1 }, { reason: "cost_partial", orders: 1 }]);
    expect(out.report.orders.find((o) => o.leadId === L2.id)).toMatchObject({ cost: { kind: "partial", knownCents: 3_000, unknownJobs: 1 }, netCents: null });
    expect(out.report.gratuity).toMatchObject({ orders: 2, gratuityCents: 20_000, driverCents: 2_000, crewCents: 18_000 });
  });
  it("an ezCater provider_native job: fee 'not known', no gratuity split; ezCater-ness also by an ezcater_orders row", async () => {
    const out = await loadDeliveryEconomics(db({ ezcater_orders: () => ({ data: [{ id: "e1", lead_id: L1.id }] }) }).sb, gm(), { locationId: A }, RANGE);
    if (out.kind !== "ok") throw new Error(out.kind);
    const byLabel = out.report.orders.find((o) => o.leadId === L3.id)!, byRow = out.report.orders.find((o) => o.leadId === L1.id)!;
    expect(byLabel).toMatchObject({ isEzcater: true, fee: { kind: "gap", reason: "ezcater_fee_unknown" }, gratuity: { kind: "none" }, netCents: null });
    expect(byRow).toMatchObject({ isEzcater: true, fee: { kind: "gap", reason: "ezcater_fee_unknown" }, netCents: null });
  });
  it("the range is by the lead's EVENT DATE, at the shop in scope", async () => {
    const d = db();
    const out = await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, { from: "2026-11-22", to: "2026-11-22" });
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.report.orders.map((o) => o.leadId)).toEqual([L2.id]);
    const leads = d.seen.find((s) => s.table === "catering_pipeline")!.q;
    expect([leads.eq, leads.gte, leads.lte]).toEqual([{ location_id: A }, { event_date: "2026-11-22" }, { event_date: "2026-11-22" }]);
  });
  it("a row of another shop that slipped into the lead read is dropped (bound again on the rows)", async () => {
    const stray = lead(9, { location_id: B });
    const out = await loadDeliveryEconomics(db({ catering_pipeline: (q) => q.in.id ? { data: (q.in.id as string[]).map((id) => ({ id, location_id: A })) } : { data: [L1, stray] } }).sb, gm(), { locationId: A }, RANGE);
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.report.orders.map((o) => o.leadId)).toEqual([L1.id]);
  });
  it("no lead in the period: an empty report after the lead read, nothing else asked", async () => {
    const d = db({ catering_pipeline: () => ({ data: [] }) });
    expect(await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, RANGE)).toMatchObject({ kind: "ok", report: { coverage: { orders: 0, withNet: 0 } } });
    expect(d.reads).toEqual(["delivery_settings", "catering_pipeline"]);
  });
});

describe("the queries: each relation once, its own columns, nothing it has no use for", () => {
  it("the tables read and the columns selected, per relation", async () => {
    const d = db();
    await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, RANGE);
    const selects = d.seen.map((s) => [s.table, s.q.select]);
    expect(selects).toEqual(expect.arrayContaining([
      ["delivery_settings", ECON_SETTINGS_COLUMNS], ["catering_pipeline", ECON_LEAD_COLUMNS], ["ezcater_orders", ECON_EZCATER_COLUMNS], ["catering_quotes", ECON_QUOTE_COLUMNS],
      ["delivery_job_current", ECON_JOB_COLUMNS], ["delivery_gratuity_splits", ECON_SPLIT_COLUMNS], ["delivery_job_costs", ECON_COST_COLUMNS], ["catering_pipeline", ECON_RECHECK_COLUMNS],
    ]));
    // Eight reads for the whole report: one per relation, plus the leads' shops read again at the end.
    expect(selects).toHaveLength(8);
    expect(d.reads.at(0)).toBe("delivery_settings");
    expect(d.reads.at(1)).toBe("catering_pipeline");
    expect(d.reads.at(-1)).toBe("catering_pipeline");
    expect(d.reads.at(-2)).toBe("delivery_job_costs");
  });
  it("no customer field, note, reason, reference or pipeline-value source is ever selected; never *", () => {
    const columns = [ECON_SETTINGS_COLUMNS, ECON_LEAD_COLUMNS, ECON_EZCATER_COLUMNS, ECON_QUOTE_COLUMNS, ECON_JOB_COLUMNS, ECON_COST_COLUMNS, ECON_SPLIT_COLUMNS, ECON_RECHECK_COLUMNS].join(",").split(",");
    for (const never of ["*", "note", "reason", "external_ref", "contact_name", "name", "email", "phone", "company", "address", "notes", "estimated_revenue_cents", "total_cents", "subtotal_cents",
      "manual_providers", "actor_id", "recorded_by", "created_by", "tip_cents"]) expect([never, columns.includes(never)]).toEqual([never, false]);
    expect(ECON_LEAD_COLUMNS).toBe("id,location_id,stage,lead_source,event_date");
    expect(ECON_JOB_COLUMNS).toBe("id,pipeline_id,booked_via,provider_label,attempt_no,status");
  });
  it("quotes are the LIVE revisions only; jobs come from the view; costs are asked for exactly the jobs of the response", async () => {
    const d = db();
    await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, RANGE);
    expect(d.seen.find((s) => s.table === "catering_quotes")!.q.is).toEqual({ superseded_at: null });
    expect(d.reads).not.toContain("delivery_jobs");
    expect(d.seen.find((s) => s.table === "delivery_job_costs")!.q.in.job_id).toEqual(["j1", "j2a", "j2b", "j3"]);
  });
  it("250 orders: id lists go out in chunks of 100, and the number of RELATIONS read does not grow", async () => {
    const many = Array.from({ length: 250 }, (_, i) => lead(1000 + i));
    const d = db({
      catering_pipeline: (q) => q.in.id ? { data: (q.in.id as string[]).map((id) => ({ id, location_id: A })) } : { data: q.range && q.range[0] > 0 ? [] : many },
      catering_quotes: (q) => ({ data: (q.in.pipeline_id as string[]).map((id) => quoteRow(`q-${id}`, id)) }),
      delivery_job_current: (q) => ({ data: (q.in.pipeline_id as string[]).map((id) => jobRow(`j-${id}`, id, 1, "delivered")) }),
      delivery_gratuity_splits: () => ({ data: [] }),
      delivery_job_costs: (q) => ({ data: (q.in.job_id as string[]).map((id) => costRow(`c-${id}`, id, 1_000)) }),
    });
    const out = await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, RANGE);
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.report.coverage).toEqual({ orders: 250, withNet: 250 });
    expect(out.report.totals).toEqual({ feeCents: 250 * 4_500, costCents: 250 * 1_000, netCents: 250 * 3_500 });
    for (const [table, column] of [["ezcater_orders", "lead_id"], ["catering_quotes", "pipeline_id"], ["delivery_job_current", "pipeline_id"], ["delivery_gratuity_splits", "pipeline_id"],
      ["delivery_job_costs", "job_id"]] as const) {
      const lists = d.seen.filter((s) => s.table === table).map((s) => (s.q.in[column] as string[]).length);
      expect([table, lists]).toEqual([table, [100, 100, 50]]);
    }
    expect(d.seen.filter((s) => s.table === "catering_pipeline" && s.q.in.id).map((s) => (s.q.in.id as string[]).length)).toEqual([100, 100, 50]);
    expect([...new Set(d.reads)].sort()).toEqual(["catering_pipeline", "catering_quotes", "delivery_gratuity_splits", "delivery_job_costs", "delivery_job_current", "delivery_settings", "ezcater_orders"]);
  });
  it("a relation with more than one page is read to the end (1,000 rows then the rest)", async () => {
    const many = Array.from({ length: 1_200 }, (_, i) => lead(5000 + i));
    const d = db({
      catering_pipeline: (q) => q.in.id ? { data: (q.in.id as string[]).map((id) => ({ id, location_id: A })) } : { data: many.slice(q.range![0], q.range![1] + 1) },
      catering_quotes: (q) => ({ data: (q.in.pipeline_id as string[]).map((id) => quoteRow(`q-${id}`, id)) }),
      delivery_job_current: () => ({ data: [] }), delivery_gratuity_splits: () => ({ data: [] }),
    });
    const out = await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, RANGE);
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.report.coverage.orders).toBe(1_200);
    expect(d.seen.filter((s) => s.table === "catering_pipeline" && !s.q.in.id).map((s) => s.q.range)).toEqual([[0, 999], [1000, 1999]]);
  });
});

describe("scope follows the lead: an order that left the shop during the reads", () => {
  it("discards the attempt and reads again; the second answer no longer has the order", async () => {
    let lists = 0;
    const d = db({ catering_pipeline: (q) => {
      if (!q.in.id) { lists += 1; return { data: lists === 1 ? [L1, L2] : [L1] }; }
      // After the first attempt's reads, lead 2 sits at shop B.
      return { data: (q.in.id as string[]).map((id) => ({ id, location_id: id === L2.id ? B : A })) };
    } });
    const out = await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, RANGE);
    if (out.kind !== "ok") throw new Error(out.kind);
    expect(out.report.orders.map((o) => o.leadId)).toEqual([L1.id]);
    expect(lists).toBe(2);
  });
  it("orders that keep moving: failed after three attempts, never a report that includes them", async () => {
    let lists = 0;
    const d = db({ catering_pipeline: (q) => q.in.id ? { data: (q.in.id as string[]).map((id) => ({ id, location_id: B })) } : (lists += 1, { data: [L1] }) });
    expect(await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, RANGE)).toEqual({ kind: "failed" });
    expect(lists).toBe(3);
  });
  it("a lead that vanished from the re-read is treated as moved", async () => {
    const d = db({ catering_pipeline: (q) => q.in.id ? { data: [] } : { data: [L1] } });
    expect(await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, RANGE)).toEqual({ kind: "failed" });
  });
});

describe("a failed read is its own result: never zeros, never a throw", () => {
  it.each(["catering_pipeline", "ezcater_orders", "catering_quotes", "delivery_job_current", "delivery_gratuity_splits", "delivery_job_costs"])("%s fails → failed", async (table) => {
    const d = db({ [table]: () => ({ error: { code: "57014", message: "canceling statement due to statement timeout" } }) });
    expect(await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, RANGE)).toEqual({ kind: "failed" });
  });
  it("the shop's switch read failing (not a missing table) → failed", async () => {
    expect(await loadDeliveryEconomics(db({ delivery_settings: () => ({ error: { code: "XX000", message: "boom" } }) }).sb, gm(), { locationId: A }, RANGE)).toEqual({ kind: "failed" });
  });
  it("a client that throws (transport) → failed", async () => {
    const sb = { from: () => { throw new Error("socket hang up"); } } as never;
    expect(await loadDeliveryEconomics(sb, gm(), { locationId: A }, RANGE)).toEqual({ kind: "failed" });
  });
  it("a malformed range → failed, zero queries (it is never guessed)", async () => {
    const d = db();
    expect(await loadDeliveryEconomics(d.sb, gm(), { locationId: A }, { from: "yesterday", to: "2026-11-30" })).toEqual({ kind: "failed" });
    expect(d.reads).toEqual([]);
  });
});

describe("bounded: a delivery read that never answers costs the page this one section", () => {
  it("resolves 'failed' at the deadline while the read is still hanging", async () => {
    vi.useFakeTimers();
    const hanging = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }) } as never;
    const pending = loadDeliveryEconomicsBounded(gm(), { locationId: A }, RANGE, { client: hanging });
    let settled: unknown = "pending";
    void pending.then((v) => { settled = v; });
    await vi.advanceTimersByTimeAsync(DELIVERY_ECONOMICS_DEADLINE_MS - 1);
    expect(settled).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ kind: "failed" });
    expect(DELIVERY_ECONOMICS_DEADLINE_MS).toBeLessThanOrEqual(10_000);
  });
  it("answers at once when the read answers, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const out = await loadDeliveryEconomicsBounded(gm(), { locationId: A }, RANGE, { client: db().sb });
    expect(out.kind).toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never rejects: a client that cannot even be created is 'failed'", async () => {
    h.defaultClient.mockImplementation(() => { throw new Error("no service key"); });
    expect(await loadDeliveryEconomicsBounded(gm(), { locationId: A }, RANGE)).toEqual({ kind: "failed" });
  });
  it("the switch off: off without creating a client", async () => {
    vi.stubEnv("DELIVERY_TRACKING", "");
    expect(await loadDeliveryEconomicsBounded(deliveryActor("owner"), { locationId: A }, RANGE)).toEqual({ kind: "off", reason: "switch" });
    expect(h.defaultClient).not.toHaveBeenCalled();
  });
  it("a refused viewer: off, and the default client is never queried", async () => {
    const d = db();
    h.defaultClient.mockReturnValue(d.sb);
    expect(await loadDeliveryEconomicsBounded(deliveryActor("prep_mgr", [A]), { locationId: A }, RANGE)).toEqual({ kind: "off", reason: "forbidden" });
    expect(d.reads).toEqual([]);
  });
});
