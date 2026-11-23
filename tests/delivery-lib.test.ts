/**
 * Catering delivery D1: lib/delivery/jobs.ts + settings.ts with a mocked client. The order of every entry point is the
 * law: the switch (off = "off" / 503 with ZERO queries), then the gate by trusted role BEFORE any I/O, then the
 * database; "not installed" is never a 500; a SQL refusal is passed through by NAME; a failure is never a success.
 * The view is decided in the lib: lead / history / nothing, and a status-only viewer receives no money.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { DELIVERY_SQL_REFUSALS, DeliveryError, deliveryErrorFrom, deliveryErrorStatus } from "@/lib/delivery/errors";
import { deliveryTrackingOn } from "@/lib/delivery/config";
import {
  keepDeliveryPickup, loadLeadDelivery, recordDeliveryCost, recordDeliveryEvent, recordDeliveryGratuitySplit, recordManualDeliveryJob,
} from "@/lib/delivery/jobs";
import { loadDeliverySettings, saveDeliverySettings } from "@/lib/delivery/settings";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no default client in this test"); }) }));

type Result = { data?: unknown; error?: { code?: string; message?: string } | null };
interface Query { eq: Record<string, unknown>; in: Record<string, unknown[]>; is: Record<string, unknown>; range: [number, number] | null }
/** A chainable PostgREST stand-in. Every settled read or RPC is recorded by name. */
function client(tables: Record<string, (q: Query) => Result>, rpcs: Record<string, (params: Record<string, unknown>) => Result> = {}) {
  const reads: string[] = [];
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const chain = (name: string, answer: (q: Query) => Result) => {
    const query: Query = { eq: {}, in: {}, is: {}, range: null };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order"]) q[m] = () => q;
    q.eq = (col: string, value: unknown) => { query.eq[col] = value; return q; };
    q.is = (col: string, value: unknown) => { query.is[col] = value; return q; };
    q.in = (col: string, value: unknown[]) => { query.in[col] = value; return q; };
    q.range = (from: number, to: number) => { query.range = [from, to]; return q; };
    const settle = () => { reads.push(name); return Promise.resolve({ data: null, error: null, ...answer(query) }); };
    q.maybeSingle = () => settle();
    q.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject);
    return q;
  };
  const sb = {
    from: (name: string) => chain(name, (q) => { const t = tables[name]; if (!t) throw new Error(`unexpected table ${name}`); return t(q); }),
    rpc: (name: string, params: Record<string, unknown>) => { calls.push({ name, params }); return chain(name, () => { const f = rpcs[name]; if (!f) throw new Error(`unexpected rpc ${name}`); return f(params); }); },
  };
  return { sb: sb as never, reads, calls };
}

const A = "00000000-0000-4000-8000-00000000000a", B = "00000000-0000-4000-8000-00000000000b", C = "00000000-0000-4000-8000-00000000000c";
const LEAD = "00000000-0000-4000-8000-0000000000d1", JOB_A = "00000000-0000-4000-8000-0000000000e1", JOB_B = "00000000-0000-4000-8000-0000000000e2";
const actor = (role: string, locations: string[] = [A], active = true): AuthContext =>
  ({ user: { id: "user-1", role, active }, role, level: 0, locations, session: {} } as unknown as AuthContext);

const job = { leadId: LEAD, expectedShopId: A, providerLabel: "Courier A", externalRef: null, bookedVia: "manual" as const, pickupAt: null, dropoffAt: null, costCents: 3000, note: null };
const event = { jobId: JOB_A, expectedShopId: A, expectedStatus: "accepted" as const, status: "picked_up" as const, occurredAt: null, note: null };
const cost = { jobId: JOB_A, expectedShopId: A, component: "base" as const, amountCents: 3000, correctsId: null, note: null };
const keep = { jobId: JOB_A, expectedShopId: A, note: null };
const split = { leadId: LEAD, expectedShopId: A, mode: "recompute" as const, expectedHeadId: null, reason: "the quote changed" };
const settings = { locationId: A, values: { enabled: true, manualProviders: ["Courier A"], gratuityDriverBps: 1000 }, expectedUpdatedAt: null };
type Sb = ReturnType<typeof client>["sb"];
const WRITES: Array<[string, (who: AuthContext, sb: Sb) => Promise<unknown>]> = [
  ["record_manual_delivery_job", (who, sb) => recordManualDeliveryJob(who, job, { client: sb })],
  ["record_delivery_event", (who, sb) => recordDeliveryEvent(who, event, { client: sb })],
  ["record_delivery_cost", (who, sb) => recordDeliveryCost(who, cost, { client: sb })],
  ["keep_delivery_pickup", (who, sb) => keepDeliveryPickup(who, keep, { client: sb })],
  ["record_delivery_gratuity_split", (who, sb) => recordDeliveryGratuitySplit(who, split, { client: sb })],
];
const OK: Record<string, Record<string, unknown>> = {
  record_manual_delivery_job: { job_id: JOB_A, attempt_no: 1, status: "accepted", status_seq: 1 },
  record_delivery_event: { job_id: JOB_A, status: "picked_up", status_seq: 2, closed: false, split_id: null },
  record_delivery_cost: { cost_id: "c1", job_id: JOB_A, component: "base", amount_cents: 3000 },
  keep_delivery_pickup: { decision_id: "d1", job_id: JOB_A, lead_location_id: B },
  record_delivery_gratuity_split: { split_id: "s1", kind: "split", job_id: JOB_A, gratuity_cents: 10000, driver_bps: 1000, driver_cents: 1000, crew_cents: 9000 },
};

const previous = process.env.DELIVERY_TRACKING;
beforeEach(() => { process.env.DELIVERY_TRACKING = "1"; });
afterEach(() => { if (previous === undefined) delete process.env.DELIVERY_TRACKING; else process.env.DELIVERY_TRACKING = previous; });

describe("the switch", () => {
  it("is on only for DELIVERY_TRACKING=1", () => {
    expect(deliveryTrackingOn({ DELIVERY_TRACKING: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", "on", " 1"]) expect(deliveryTrackingOn({ DELIVERY_TRACKING: v })).toBe(false);
  });

  it("off: every loader answers 'off' and every write 503 delivery_off, with ZERO queries, whoever asks", async () => {
    delete process.env.DELIVERY_TRACKING;
    const { sb, reads, calls } = client({}, {});
    for (const role of ["owner", "moo", "gm", "social_media_mgr", "employee"]) {
      const who = actor(role);
      expect(await loadLeadDelivery(who, LEAD, { client: sb })).toEqual({ view: "off" });
      expect(await loadDeliverySettings(who, { client: sb })).toEqual({ state: "off" });
      for (const [, run] of WRITES) await expect(run(who, sb)).rejects.toMatchObject({ status: 503, code: "delivery_off" });
      await expect(saveDeliverySettings(who, settings, { client: sb })).rejects.toMatchObject({ status: 503, code: "delivery_off" });
    }
    expect(reads).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("the gate is bound before any I/O", () => {
  it("writes: the prep manager, the social media manager, a key holder, a GM of another shop and an inactive GM never reach the database", async () => {
    const { sb, reads, calls } = client({}, {});
    for (const who of [actor("prep_mgr"), actor("social_media_mgr"), actor("key_holder"), actor("shift_lead"), actor("gm", [B]), actor("agm", []), actor("gm", [A], false)]) {
      for (const [, run] of WRITES) await expect(run(who, sb)).rejects.toMatchObject({ status: 403, code: "forbidden" });
    }
    expect(reads).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("the gate binds to the shop the person SAW; SQL then refuses shop_moved if the lead is elsewhere", async () => {
    // A GM of A naming shop B (which they are not a member of) is refused here ...
    const none = client({}, {});
    await expect(recordManualDeliveryJob(actor("gm", [A]), { ...job, expectedShopId: B }, { client: none.sb })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(none.calls).toEqual([]);
    // ... and naming their own shop while the lead has moved is the database's `shop_moved`.
    const moved = client({}, { record_manual_delivery_job: () => ({ error: { code: "P0001", message: "shop_moved" } }) });
    await expect(recordManualDeliveryJob(actor("gm", [A]), job, { client: moved.sb })).rejects.toMatchObject({ status: 409, code: "shop_moved" });
    expect(moved.calls[0]!.params.p_expected_shop).toBe(A);
  });

  it("settings: only the owner, the CGS and the MoO", async () => {
    const { sb, reads, calls } = client({}, {});
    for (const role of ["gm", "agm", "catering_mgr", "prep_mgr", "social_media_mgr", "key_holder"]) {
      await expect(loadDeliverySettings(actor(role), { client: sb })).rejects.toMatchObject({ status: 403, code: "forbidden" });
      await expect(saveDeliverySettings(actor(role), settings, { client: sb })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    }
    expect(reads).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("reads: someone who could pass no gate anywhere is refused before the first query", async () => {
    const { sb, reads } = client({}, {});
    for (const role of ["social_media_mgr", "employee", "trainee", "prospect"]) {
      await expect(loadLeadDelivery(actor(role), LEAD, { client: sb })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    }
    await expect(loadLeadDelivery(actor("gm", [A], false), LEAD, { client: sb })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(reads).toEqual([]);
  });
});

describe("writes: one RPC, the person's own arguments, refusals by name", () => {
  it("each wrapper calls its writer once with the actor, the shop the person saw and nothing invented", async () => {
    const who = actor("agm");
    for (const [name, run] of WRITES) {
      const { sb, calls, reads } = client({}, { [name]: () => ({ data: OK[name] }) });
      await run(who, sb);
      expect(calls.map((c) => c.name)).toEqual([name]);
      expect(reads).toEqual([name]);
      expect(calls[0]!.params).toMatchObject({ p_actor_id: "user-1", p_expected_shop: A });
    }
    const rec = client({}, { record_manual_delivery_job: () => ({ data: OK.record_manual_delivery_job }) });
    expect(await recordManualDeliveryJob(who, { ...job, externalRef: "DT-1", pickupAt: "2026-11-22T15:00:00Z" }, { client: rec.sb })).toEqual({ jobId: JOB_A, attemptNo: 1 });
    expect(rec.calls[0]!.params).toEqual({ p_actor_id: "user-1", p_lead_id: LEAD, p_expected_shop: A, p_provider_label: "Courier A", p_external_ref: "DT-1",
      p_booked_via: "manual", p_pickup_at: "2026-11-22T15:00:00Z", p_dropoff_at: null, p_cost_cents: 3000, p_note: null });
    const ev = client({}, { record_delivery_event: () => ({ data: { ...OK.record_delivery_event, status: "delivered", closed: true, split_id: "s9" } }) });
    expect(await recordDeliveryEvent(who, { ...event, status: "delivered" }, { client: ev.sb })).toEqual({ jobId: JOB_A, status: "delivered", statusSeq: 2, closed: true, splitId: "s9" });
    expect(ev.calls[0]!.params).toEqual({ p_actor_id: "user-1", p_job_id: JOB_A, p_expected_shop: A, p_expected_status: "accepted", p_status: "delivered", p_occurred_at: null, p_note: null });
    const g = client({}, { record_delivery_gratuity_split: () => ({ data: OK.record_delivery_gratuity_split }) });
    expect(await recordDeliveryGratuitySplit(who, split, { client: g.sb })).toEqual({ splitId: "s1", kind: "split", jobId: JOB_A, gratuityCents: 10000, driverBps: 1000, driverCents: 1000, crewCents: 9000 });
    expect(g.calls[0]!.params).toEqual({ p_actor_id: "user-1", p_lead_id: LEAD, p_expected_shop: A, p_mode: "recompute", p_expected_head: null, p_reason: "the quote changed" });
  });

  it.each(DELIVERY_SQL_REFUSALS.map((c) => [c] as const))("SQL refusal %s is a DeliveryError with that code", async (code) => {
    const { sb } = client({}, { record_delivery_event: () => ({ error: { code: "P0001", message: code } }) });
    const error = await recordDeliveryEvent(actor("gm"), event, { client: sb }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeliveryError);
    expect(error).toMatchObject({ code, status: deliveryErrorStatus(code) });
  });

  it("the statuses: 403 forbidden, 404 not found, 400 bad input, 409 for every stale or state refusal", () => {
    expect(deliveryErrorStatus("forbidden")).toBe(403);
    for (const c of ["lead_not_found", "job_not_found", "location_not_found"] as const) expect(deliveryErrorStatus(c)).toBe(404);
    for (const c of ["invalid_request", "invalid_settings", "bad_amount", "bad_occurred_at", "reason_required"] as const) expect(deliveryErrorStatus(c)).toBe(400);
    for (const c of ["shop_moved", "status_moved", "settings_moved", "split_moved", "not_current_head", "delivery_job_open", "job_closed", "cost_exists", "ezcater_never_booked",
      "order_rejected", "lead_not_confirmed", "delivery_off"] as const) expect(deliveryErrorStatus(c)).toBe(409);
    expect(deliveryErrorStatus("delivery_unavailable")).toBe(503);
    expect(deliveryErrorStatus("generic")).toBe(500);
  });

  it("not installed is 503 delivery_unavailable on every write, never a 500", async () => {
    for (const code of ["42P01", "42883", "PGRST202", "PGRST205"]) {
      for (const [name, run] of WRITES) {
        const { sb } = client({}, { [name]: () => ({ error: { code, message: "function does not exist" } }) });
        await expect(run(actor("moo"), sb)).rejects.toMatchObject({ status: 503, code: "delivery_unavailable" });
      }
      const { sb } = client({}, { set_delivery_settings: () => ({ error: { code, message: "x" } }) });
      await expect(saveDeliverySettings(actor("moo"), settings, { client: sb })).rejects.toMatchObject({ status: 503, code: "delivery_unavailable" });
    }
  });

  it("the loser of a double tap (23505) is the named refusal of that call; anything unknown is generic, never a success", async () => {
    const dup = { error: { code: "23505", message: "duplicate key value violates unique constraint \"delivery_jobs_one_open_per_lead\"" } };
    await expect(recordManualDeliveryJob(actor("gm"), job, { client: client({}, { record_manual_delivery_job: () => dup }).sb })).rejects.toMatchObject({ status: 409, code: "delivery_job_open" });
    await expect(recordDeliveryCost(actor("gm"), cost, { client: client({}, { record_delivery_cost: () => dup }).sb })).rejects.toMatchObject({ status: 409, code: "cost_exists" });
    await expect(recordDeliveryCost(actor("gm"), { ...cost, correctsId: "c0", note: "fix" }, { client: client({}, { record_delivery_cost: () => dup }).sb })).rejects.toMatchObject({ code: "not_current_head" });
    await expect(recordDeliveryEvent(actor("gm"), event, { client: client({}, { record_delivery_event: () => dup }).sb })).rejects.toMatchObject({ status: 500, code: "generic" });
    await expect(recordDeliveryEvent(actor("gm"), event, { client: client({}, { record_delivery_event: () => ({ error: { code: "P0001", message: "something_new" } }) }).sb }))
      .rejects.toMatchObject({ status: 500, code: "generic" });
    // An answer that is not the writer's shape is a failure.
    for (const data of [null, [], "ok", {}]) {
      await expect(recordDeliveryEvent(actor("gm"), event, { client: client({}, { record_delivery_event: () => ({ data }) }).sb })).rejects.toMatchObject({ status: 500, code: "generic" });
    }
    expect(deliveryErrorFrom({ code: "PGRST205", message: "shop_moved" }).code).toBe("delivery_unavailable");
  });
});

describe("settings", () => {
  const row = { location_id: A, enabled: true, manual_providers: ["Courier A"], gratuity_driver_bps: 1500, updated_at: "2026-11-22T10:00:00Z" };
  it("load: every active shop, a shop with no row is off with the default share", async () => {
    const { sb, reads } = client({ locations: () => ({ data: [{ id: A, name: "A" }, { id: B, name: "B" }] }), delivery_settings: () => ({ data: [row] }) },
      { delivery_ready: () => ({ data: { ready: true, version: 1 } }) });
    expect(await loadDeliverySettings(actor("moo"), { client: sb })).toEqual({ state: "ready", shops: [
      { locationId: A, name: "A", enabled: true, manualProviders: ["Courier A"], gratuityDriverBps: 1500, updatedAt: "2026-11-22T10:00:00Z" },
      { locationId: B, name: "B", enabled: false, manualProviders: [], gratuityDriverBps: 1000, updatedAt: null }] });
    expect(reads.sort()).toEqual(["delivery_ready", "delivery_settings", "locations"]);
  });

  it("load: 0356 missing is not_installed (the probe, or the table), never a 500", async () => {
    const probe = client({}, { delivery_ready: () => ({ error: { code: "PGRST202", message: "x" } }) });
    expect(await loadDeliverySettings(actor("owner"), { client: probe.sb })).toEqual({ state: "not_installed" });
    const table = client({ locations: () => ({ data: [] }), delivery_settings: () => ({ error: { code: "42P01", message: "relation does not exist" } }) },
      { delivery_ready: () => ({ data: { ready: true } }) });
    expect(await loadDeliverySettings(actor("owner"), { client: table.sb })).toEqual({ state: "not_installed" });
    const broken = client({ locations: () => ({ data: [] }), delivery_settings: () => ({ error: { code: "57014", message: "timeout" } }) }, { delivery_ready: () => ({ data: { ready: true } }) });
    await expect(loadDeliverySettings(actor("owner"), { client: broken.sb })).rejects.toMatchObject({ status: 500, code: "generic" });
  });

  it("save: one RPC with the whole row and the row the person saw; refusals by name", async () => {
    const ok = client({}, { set_delivery_settings: () => ({ data: row }) });
    expect(await saveDeliverySettings(actor("cgs"), { ...settings, expectedUpdatedAt: "2026-11-21T10:00:00Z" }, { client: ok.sb })).toMatchObject({ locationId: A, gratuityDriverBps: 1500 });
    expect(ok.calls).toEqual([{ name: "set_delivery_settings", params: { p_actor_id: "user-1", p_location_id: A,
      p_settings: { enabled: true, manual_providers: ["Courier A"], gratuity_driver_bps: 1000 }, p_expected_updated_at: "2026-11-21T10:00:00Z" } }]);
    for (const [code, status] of [["settings_moved", 409], ["no_change", 409], ["invalid_settings", 400], ["location_not_found", 404], ["forbidden", 403]] as const) {
      const { sb } = client({}, { set_delivery_settings: () => ({ error: { code: "P0001", message: code } }) });
      await expect(saveDeliverySettings(actor("moo"), settings, { client: sb })).rejects.toMatchObject({ status, code });
    }
    await expect(saveDeliverySettings(actor("moo"), settings, { client: client({}, { set_delivery_settings: () => ({ data: null }) }).sb })).rejects.toMatchObject({ status: 500, code: "generic" });
  });
});

describe("loadLeadDelivery: the view is decided in the lib", () => {
  const jobRow = (id: string, shop: string, attempt: number, status: string, closed: boolean) => ({ id, pipeline_id: LEAD, location_id: shop, quote_id: null, confirm_event_id: null,
    booked_via: "manual", provider_label: "Courier A", external_ref: `REF-${attempt}`, attempt_no: attempt, pickup_at: null, dropoff_at: null,
    closed_at: closed ? "2026-11-22T12:00:00Z" : null, created_by: "u", created_at: "2026-11-22T10:00:00Z", status, status_seq: closed ? 2 : 1, status_at: "2026-11-22T11:00:00Z" });
  const eventRow = (jobId: string, seq: number, status: string) => ({ id: `${jobId}-${seq}`, job_id: jobId, seq, status, occurred_at: "2026-11-22T11:00:00Z",
    recorded_at: "2026-11-22T11:00:00Z", source: "manual", actor_id: "u", note: "gate code 4411" });
  /** The lead moved A -> B. Job 1 was recorded (and cancelled) at A; the replacement job 2 is open at B. */
  const moved = (stage = "confirmed") => client({
    catering_pipeline: () => ({ data: { id: LEAD, location_id: B, stage, lead_source: "website" } }),
    ezcater_orders: () => ({ data: [] }),
    catering_quotes: () => ({ data: [{ id: "q1", status: "accepted", is_delivery: true, gratuity_cents: 10000, delivery_fee_cents: 2500, created_at: "2026-11-01T10:00:00Z" }] }),
    delivery_job_current: () => ({ data: [jobRow(JOB_A, A, 1, "cancelled", true), jobRow(JOB_B, B, 2, "accepted", false)] }),
    delivery_job_events: (q) => ({ data: [eventRow(JOB_A, 1, "accepted"), eventRow(JOB_A, 2, "cancelled"), eventRow(JOB_B, 1, "accepted")].filter((e) => (q.in.job_id ?? []).includes(e.job_id)) }),
    delivery_job_costs: () => ({ data: [{ id: "c1", job_id: JOB_B, component: "base", semantics: "snapshot", amount_cents: 3000, money_identity: `${JOB_B}:base`, source: "manual",
      provider_ref: null, observed_at: "2026-11-22T10:00:00Z", corrects_id: null, actor_id: "u", note: null }] }),
    delivery_gratuity_splits: () => ({ data: [] }),
    delivery_pickup_decisions: () => ({ data: [] }),
    delivery_settings: () => ({ data: { location_id: B, enabled: true, manual_providers: ["Courier B"], gratuity_driver_bps: 1000, updated_at: "2026-11-22T09:00:00Z" } }),
  });
  /** Every key path of a serialized payload. */
  const paths = (v: unknown, at = ""): string[] => Array.isArray(v) ? v.flatMap((x) => paths(x, `${at}[]`))
    : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => paths(x, at ? `${at}.${k}` : k)) : [at];

  it("B's GM: view lead, both jobs, the cost (partial: job 1 has no cost row), the couriers of the CURRENT shop", async () => {
    const { sb } = moved();
    const view = await loadLeadDelivery(actor("gm", [B]), LEAD, { client: sb });
    expect(view).toMatchObject({ view: "lead", leadId: LEAD, shopId: B, enabled: true, isEzcater: false, orderQuote: { kind: "accepted", isDelivery: true }, state: "booked",
      status: { attemptNo: 2, status: "accepted", providerLabel: "Courier A" } });
    if (view?.view !== "lead") throw new Error("expected the lead view");
    expect(view.detail?.jobs.map((j) => j.id)).toEqual([JOB_A, JOB_B]);
    expect(view.detail?.manualProviders).toEqual(["Courier B"]);
    expect(view.detail?.events).toHaveLength(3);
    expect(view.cost?.orderCost).toEqual({ kind: "partial", knownCents: 3000, unknownJobs: 1 });
    expect(view.cost?.splitHead).toBeNull();
    expect(view.cost?.candidates[0]).toMatchObject({ gratuityCents: 10000, deliveryFeeCents: 2500 });
  });

  it("A's GM (the pickup shop, after the order moved): view history with A's job ONLY — no state, no cost, not B's job", async () => {
    const { sb, reads } = moved();
    const view = await loadLeadDelivery(actor("gm", [A]), LEAD, { client: sb });
    expect(view).toEqual({ view: "history", leadId: LEAD, movedToShopId: B, jobs: [{ jobId: JOB_A, attemptNo: 1, status: "cancelled", statusAt: "2026-11-22T11:00:00Z",
      providerLabel: "Courier A", externalRef: "REF-1", pickupAt: null, dropoffAt: null, pickupShopId: A,
      events: [expect.objectContaining({ jobId: JOB_A, seq: 1 }), expect.objectContaining({ jobId: JOB_A, seq: 2 })] }] });
    expect(JSON.stringify(view)).not.toContain(JOB_B);
    // Allow-list over the serialized payload: an unknown path fails.
    const allowed = new Set(["view", "leadId", "movedToShopId", ...["jobId", "attemptNo", "status", "statusAt", "providerLabel", "externalRef", "pickupAt", "dropoffAt", "pickupShopId"].map((k) => `jobs[].${k}`),
      ...["id", "jobId", "seq", "status", "occurredAt", "recordedAt", "source", "actorId", "note"].map((k) => `jobs[].events[].${k}`)]);
    expect(paths(view).filter((p) => !allowed.has(p))).toEqual([]);
    // It never read a cost, a split, a quote or the settings.
    expect(reads.sort()).toEqual(["catering_pipeline", "delivery_job_current", "delivery_job_events"]);
  });

  it("a GM of neither shop gets nothing (a 404 at the route); so does anyone for a lead that does not exist", async () => {
    expect(await loadLeadDelivery(actor("gm", [C]), LEAD, { client: moved().sb })).toBeNull();
    expect(await loadLeadDelivery(actor("agm", []), LEAD, { client: moved().sb })).toBeNull();
    const none = client({ catering_pipeline: () => ({ data: null }) });
    expect(await loadLeadDelivery(actor("owner"), LEAD, { client: none.sb })).toBeNull();
  });

  it("a key holder at the lead's shop: the status only — no money, no external reference, no note, no detail", async () => {
    const view = await loadLeadDelivery(actor("key_holder", [B]), LEAD, { client: moved().sb });
    expect(view).toEqual({ view: "lead", leadId: LEAD, shopId: B, enabled: true, isEzcater: false, orderQuote: { kind: "accepted", isDelivery: true }, state: "booked",
      status: { attemptNo: 2, status: "accepted", statusAt: "2026-11-22T11:00:00Z", providerLabel: "Courier A", pickupAt: null, dropoffAt: null } });
    const allowed = new Set(["view", "leadId", "shopId", "enabled", "isEzcater", "orderQuote.kind", "orderQuote.isDelivery", "state",
      ...["attemptNo", "status", "statusAt", "providerLabel", "pickupAt", "dropoffAt"].map((k) => `status.${k}`)]);
    expect(paths(view).filter((p) => !allowed.has(p))).toEqual([]);
    for (const leak of ["3000", "10000", "2500", "REF-", "4411", "Cents", "cents"]) expect(JSON.stringify(view)).not.toContain(leak);
    // The prep manager reads the same and no more.
    expect(await loadLeadDelivery(actor("prep_mgr", [B]), LEAD, { client: moved().sb })).toEqual(view);
  });

  it("the catering manager and the MoO see the lead view at any shop", async () => {
    for (const who of [actor("catering_mgr", []), actor("moo", [])]) {
      const view = await loadLeadDelivery(who, LEAD, { client: moved().sb });
      expect(view).toMatchObject({ view: "lead", state: "booked" });
      expect(view && "detail" in view && "cost" in view).toBe(true);
    }
  });

  it("the state is the ONE rule's: a rejected order with the open job reads cancel_needed; a job kept for this shop does not read mismatch", async () => {
    const lost = moved("lost");
    expect(await loadLeadDelivery(actor("moo"), LEAD, { client: lost.sb })).toMatchObject({ state: "cancel_needed", status: { attemptNo: 2 } });
    // The open job was recorded at A while the lead sits at B: a mismatch until a decision exists for B.
    const tables = (kept: boolean) => client({
      catering_pipeline: () => ({ data: { id: LEAD, location_id: B, stage: "confirmed", lead_source: "website" } }),
      ezcater_orders: () => ({ data: [] }), catering_quotes: () => ({ data: [] }),
      delivery_job_current: () => ({ data: [jobRow(JOB_A, A, 1, "accepted", false)] }),
      delivery_job_events: () => ({ data: [] }), delivery_job_costs: () => ({ data: [] }), delivery_gratuity_splits: () => ({ data: [] }),
      delivery_pickup_decisions: () => ({ data: kept ? [{ id: "d1", job_id: JOB_A, lead_location_id: B, decided_by: "u", decided_at: "2026-11-22T10:00:00Z", note: null }] : [] }),
      delivery_settings: () => ({ data: null }),
    });
    expect(await loadLeadDelivery(actor("moo"), LEAD, { client: tables(false).sb })).toMatchObject({ state: "pickup_mismatch", enabled: false });
    expect(await loadLeadDelivery(actor("moo"), LEAD, { client: tables(true).sb })).toMatchObject({ state: "booked" });
  });

  it("an ezCater lead by its ezcater_orders row, even with lead_source edited away", async () => {
    const { sb } = client({
      catering_pipeline: () => ({ data: { id: LEAD, location_id: A, stage: "confirmed", lead_source: "phone" } }),
      ezcater_orders: (q) => ({ data: q.eq.lead_id === LEAD ? [{ id: "ez1" }] : [] }), catering_quotes: () => ({ data: [] }), delivery_job_current: () => ({ data: [] }),
      delivery_gratuity_splits: () => ({ data: [] }), delivery_settings: () => ({ data: null }),
    });
    expect(await loadLeadDelivery(actor("gm"), LEAD, { client: sb })).toMatchObject({ isEzcater: true, state: "provider_managed", status: null, cost: { orderCost: { kind: "none" } } });
  });

  it("not installed (a missing table) is view not_installed, never a 500; any other failed read is an error, never an empty answer", async () => {
    for (const code of ["42P01", "PGRST205"]) {
      const { sb } = client({ catering_pipeline: () => ({ data: { id: LEAD, location_id: A, stage: "confirmed", lead_source: null } }), ezcater_orders: () => ({ data: [] }),
        catering_quotes: () => ({ data: [] }), delivery_job_current: () => ({ error: { code, message: "relation does not exist" } }),
        delivery_gratuity_splits: () => ({ error: { code, message: "x" } }), delivery_settings: () => ({ error: { code, message: "x" } }) });
      expect(await loadLeadDelivery(actor("gm"), LEAD, { client: sb })).toEqual({ view: "not_installed" });
    }
    const broken = client({ catering_pipeline: () => ({ data: { id: LEAD, location_id: A, stage: "confirmed", lead_source: null } }), ezcater_orders: () => ({ data: [] }),
      catering_quotes: () => ({ data: [] }), delivery_job_current: () => ({ error: { code: "57014", message: "timeout" } }),
      delivery_gratuity_splits: () => ({ data: [] }), delivery_settings: () => ({ data: null }) });
    await expect(loadLeadDelivery(actor("gm"), LEAD, { client: broken.sb })).rejects.toMatchObject({ status: 500, code: "generic" });
  });
});
