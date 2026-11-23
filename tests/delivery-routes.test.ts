/**
 * Catering delivery D2 — the routes, over the REAL lib (lib/delivery/jobs.ts, settings.ts) and a recording fake client:
 *
 *   GET  /api/catering/pipeline/[id]/delivery                       the view the lib decides (off / lead / history / 404)
 *   POST /api/catering/pipeline/[id]/delivery                       record a job                       no step-up
 *   POST /api/catering/pipeline/[id]/delivery/[jobId]/status        one status                         no step-up
 *   POST /api/catering/pipeline/[id]/delivery/[jobId]/cost          a first cost: none; a correction:  Tier A
 *   POST /api/catering/pipeline/[id]/delivery/[jobId]/keep-pickup   "the old shop still sends it"      no step-up
 *   GET + POST /api/admin/catering/delivery                         the settings; POST is              Tier B
 *
 * The law per write: same-origin BEFORE the session; the switch off = 503 `delivery_off` with ZERO database work and
 * the body unread; a strict parse (400, never the writer); the gate by trusted ROLE before any I/O; every refusal the
 * database raises passed through BY NAME with its status; not installed = 503, never a 500. The serialized history and
 * status-only payloads are pinned by allow-lists over the actual JSON (an unknown path fails).
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliveryActor, deliveryFake, type FakeRpcs, type FakeTables } from "./helpers/delivery-fake";

const h = vi.hoisted(() => ({ actor: null as unknown, fake: null as unknown as ReturnType<typeof import("./helpers/delivery-fake").deliveryFake>, session: vi.fn() }));
vi.mock("@/lib/session", async (original) => ({ ...await original<typeof import("@/lib/session")>(), requireSession: h.session }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.fake.sb }));

import { isStepUpSurface } from "@/lib/session";
import { DELIVERY_SQL_REFUSALS, deliveryErrorStatus } from "@/lib/delivery/errors";
import { GET as GET_LEAD, POST as POST_JOB } from "@/app/api/catering/pipeline/[id]/delivery/route";
import { POST as POST_STATUS } from "@/app/api/catering/pipeline/[id]/delivery/[jobId]/status/route";
import { POST as POST_COST } from "@/app/api/catering/pipeline/[id]/delivery/[jobId]/cost/route";
import { POST as POST_KEEP } from "@/app/api/catering/pipeline/[id]/delivery/[jobId]/keep-pickup/route";
import { GET as GET_SETTINGS, POST as POST_SETTINGS } from "@/app/api/admin/catering/delivery/route";

const A = "00000000-0000-4000-8000-00000000000a", B = "00000000-0000-4000-8000-00000000000b", C = "00000000-0000-4000-8000-00000000000c";
const LEAD = "00000000-0000-4000-8000-0000000000d1", OTHER_LEAD = "00000000-0000-4000-8000-0000000000d2";
const JOB_A = "00000000-0000-4000-8000-0000000000e1", JOB_B = "00000000-0000-4000-8000-0000000000e2", COST = "00000000-0000-4000-8000-0000000000f1";
const ORIGIN = "http://localhost";

/** After a transfer A → B: job 1 was booked at A (cancelled), its replacement job 2 at B (open). The lead sits at B. */
const jobRow = (id: string, shop: string, attempt: number, status: string, closed: string | null) => ({
  id, pipeline_id: LEAD, location_id: shop, quote_id: null, confirm_event_id: null, booked_via: "manual", provider_label: `Courier ${attempt}`,
  external_ref: `REF-${attempt}`, attempt_no: attempt, pickup_at: "2026-11-25T15:40:00.000Z", dropoff_at: null, closed_at: closed, created_by: "u",
  created_at: "2026-11-22T10:00:00Z", status, status_seq: 2, status_at: "2026-11-22T11:00:00Z",
});
const JOBS = [jobRow(JOB_A, A, 1, "cancelled", "2026-11-22T11:00:00Z"), jobRow(JOB_B, B, 2, "accepted", null)];
const TABLES: FakeTables = {
  catering_pipeline: (q) => ({ data: q.eq.id === LEAD ? { id: LEAD, location_id: B, stage: "confirmed", lead_source: "website" } : null }),
  ezcater_orders: () => ({ data: [] }),
  catering_quotes: () => ({ data: [{ id: "q1", status: "accepted", is_delivery: true, gratuity_cents: 1000, delivery_fee_cents: 2500, created_at: "2026-11-20T10:00:00Z" }] }),
  delivery_job_current: (q) => ({ data: q.eq.id !== undefined ? JOBS.filter((j) => j.id === q.eq.id) : JOBS.filter((j) => j.pipeline_id === q.eq.pipeline_id) }),
  delivery_job_events: (q) => ({ data: (q.in.job_id ?? []).map((id, i) => ({ id: `ev-${i}`, job_id: id, seq: 1, status: "accepted", occurred_at: "2026-11-22T10:00:00Z",
    recorded_at: "2026-11-22T10:00:00Z", source: "manual", actor_id: "u", note: "SECRET-NOTE" })) }),
  delivery_job_costs: () => ({ data: [{ id: COST, job_id: JOB_B, component: "base", semantics: "snapshot", amount_cents: 3175, money_identity: `${JOB_B}:base`, source: "manual",
    provider_ref: null, observed_at: "2026-11-22T10:00:00Z", corrects_id: null, actor_id: "u", note: null }] }),
  delivery_gratuity_splits: () => ({ data: [] }),
  delivery_pickup_decisions: () => ({ data: [] }),
  delivery_settings: (q) => {
    const row = { location_id: B, enabled: true, manual_providers: ["Courier 2"], gratuity_driver_bps: 1000, updated_at: "2026-11-22T10:00:00.123456+00:00" };
    return { data: q.eq.location_id === undefined ? [row] : row };
  },
  locations: () => ({ data: [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }] }),
};
const OK: FakeRpcs = {
  delivery_ready: () => ({ data: { ready: true, version: 1 } }),
  record_manual_delivery_job: () => ({ data: { job_id: JOB_B, attempt_no: 2 } }),
  record_delivery_event: () => ({ data: { job_id: JOB_B, status: "picked_up", status_seq: 3, closed: false, split_id: null } }),
  record_delivery_cost: () => ({ data: { cost_id: COST } }),
  keep_delivery_pickup: () => ({ data: { decision_id: "d1" } }),
  set_delivery_settings: () => ({ data: { location_id: B, enabled: true, manual_providers: ["Courier 2"], gratuity_driver_bps: 1000, updated_at: "2026-11-22T12:00:00.654321+00:00" } }),
};

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ctx = (job = JOB_B, lead = LEAD) => ({ params: Promise.resolve({ id: lead, jobId: job }) });
const JOB_BODY = { expectedShopId: B, providerLabel: "Courier 2", bookedVia: "manual", pickupAt: { date: "2026-11-25", time: "10:40" }, costCents: 3000 };
const STATUS_BODY = { expectedShopId: B, expectedStatus: "accepted", status: "picked_up" };
const COST_BODY = { expectedShopId: B, component: "base", amountCents: 3000 };
const CORRECTION = { ...COST_BODY, correctsId: COST, note: "the invoice said 30" };
const KEEP_BODY = { expectedShopId: B };
const SETTINGS_BODY = { locationId: B, values: { enabled: true, manualProviders: ["Courier 2"], gratuityDriverBps: 1000 }, expectedUpdatedAt: "2026-11-22T10:00:00.123456+00:00" };

interface Write { name: string; path: string; handler: Handler; body: Record<string, unknown>; rpc: string }
const WRITES: Write[] = [
  { name: "record a job", path: `/api/catering/pipeline/${LEAD}/delivery`, handler: POST_JOB as Handler, body: JOB_BODY, rpc: "record_manual_delivery_job" },
  { name: "a status", path: `/api/catering/pipeline/${LEAD}/delivery/${JOB_B}/status`, handler: POST_STATUS as Handler, body: STATUS_BODY, rpc: "record_delivery_event" },
  { name: "a first cost", path: `/api/catering/pipeline/${LEAD}/delivery/${JOB_B}/cost`, handler: POST_COST as Handler, body: COST_BODY, rpc: "record_delivery_cost" },
  { name: "keep the pickup", path: `/api/catering/pipeline/${LEAD}/delivery/${JOB_B}/keep-pickup`, handler: POST_KEEP as Handler, body: KEEP_BODY, rpc: "keep_delivery_pickup" },
];
const SETTINGS: Write = { name: "the settings", path: "/api/admin/catering/delivery", handler: POST_SETTINGS as unknown as Handler, body: SETTINGS_BODY, rpc: "set_delivery_settings" };
const post = (w: Pick<Write, "path">, body: unknown, origin: string | null = ORIGIN) => new NextRequest(`${ORIGIN}${w.path}`, {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(origin ? { origin } : {}) } });
const get = (path: string) => new NextRequest(`${ORIGIN}${path}`);
const fresh = () => ({ stepUpUnlocked: true, stepUpUnlockedAt: new Date().toISOString() });
const as = (role: string, locations: string[] = [], session = {}) => { h.actor = deliveryActor(role, locations, session); };
const withDb = (rpcs: FakeRpcs = OK, tables: FakeTables = TABLES) => { h.fake = deliveryFake(tables, rpcs); };
const refuse = (name: string, error: { code?: string; message?: string }): FakeRpcs => ({ ...OK, [name]: () => ({ error }) });
const untouched = () => expect([h.fake.reads, h.fake.calls]).toEqual([[], []]);
const code = async (res: Response) => ((await res.json()) as { code?: string; error?: string }).code;

beforeEach(() => {
  vi.stubEnv("DELIVERY_TRACKING", "1");
  h.session.mockReset();
  h.session.mockImplementation(async () => h.actor);
  as("catering_mgr");
  withDb();
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("every write: same-origin, then the session, then the switch, then the parse, then the lib", () => {
  it.each([...WRITES, SETTINGS])("$name: a cross-origin or origin-less POST is refused before the session and the database", async (w) => {
    for (const origin of ["https://evil.test", null]) {
      const res = await w.handler(post(w, w.body, origin), ctx());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "bad_origin" });
    }
    expect(h.session).not.toHaveBeenCalled();
    untouched();
  });

  it.each([...WRITES, SETTINGS])("$name: the session is asked on the route's OWN path", async (w) => {
    as("moo", [], fresh());
    await w.handler(post(w, w.body), ctx());
    expect(h.session).toHaveBeenCalledWith(expect.anything(), w.path);
  });

  it.each([...WRITES, SETTINGS])("$name: a signed-out request stops at the session", async (w) => {
    h.session.mockResolvedValue(Response.json({ code: "unauthorized" }, { status: 401 }));
    expect((await w.handler(post(w, w.body), ctx())).status).toBe(401);
    untouched();
  });

  it.each([...WRITES, SETTINGS])("$name: the switch off is 503 delivery_off with Retry-After, the body unread, zero database work", async (w) => {
    vi.stubEnv("DELIVERY_TRACKING", "");
    as("moo", [], fresh());
    const req = post(w, w.body);
    const body = vi.spyOn(req, "json");
    const res = await w.handler(req, ctx());
    expect([res.status, await code(res), res.headers.get("Retry-After")]).toEqual([503, "delivery_off", "60"]);
    expect(body).not.toHaveBeenCalled();
    untouched();
  });

  it.each(WRITES)("$name: reaches the one writer with the actor and the shop the person saw", async (w) => {
    const res = await w.handler(post(w, w.body), ctx());
    expect(res.status).toBe(200);
    expect(h.fake.calls.map((c) => c.name)).toEqual([w.rpc]);
    expect(h.fake.calls[0]!.params).toMatchObject({ p_actor_id: "00000000-0000-4000-8000-0000000000aa", p_expected_shop: B });
  });

  it.each(WRITES)("$name: a malformed body never reaches the writer (400 invalid_request)", async (w) => {
    for (const body of [[], "x", 7, { ...w.body, surprise: 1 }, { ...w.body, expectedShopId: "not-a-uuid" }, Object.fromEntries(Object.entries(w.body).filter(([key]) => key !== "expectedShopId"))]) {
      const res = await w.handler(post(w, body), ctx());
      expect([res.status, await code(res)], JSON.stringify(body)).toEqual([400, "invalid_request"]);
    }
    expect(h.fake.calls).toEqual([]);
  });

  it.each(WRITES)("$name: a lead or job id that is not a uuid is a 400, never a query", async (w) => {
    const res = await w.handler(post(w, w.body), ctx("job", "lead"));
    expect(res.status).toBe(400);
    untouched();
  });
});

describe("what reaches the database", () => {
  it("ids are canonical lowercase; an ET wall time is the instant; cents are integers; nothing books through an API", async () => {
    const res = await POST_JOB(post(WRITES[0]!, { ...JOB_BODY, expectedShopId: B.toUpperCase(), externalRef: "  ABC-1 ", note: "  ", dropoffAt: { date: "2026-07-04", time: "12:15" } }), ctx());
    expect(res.status).toBe(200);
    expect(h.fake.calls[0]!.params).toEqual({
      p_actor_id: "00000000-0000-4000-8000-0000000000aa", p_lead_id: LEAD, p_expected_shop: B, p_provider_label: "Courier 2", p_external_ref: "ABC-1",
      p_booked_via: "manual", p_pickup_at: "2026-11-25T15:40:00.000Z", p_dropoff_at: "2026-07-04T16:15:00.000Z", p_cost_cents: 3000, p_note: null,
    });
    for (const bad of [{ ...JOB_BODY, bookedVia: "co_ops_api" }, { ...JOB_BODY, costCents: 30.5 }, { ...JOB_BODY, costCents: -1 }, { ...JOB_BODY, pickupAt: "2026-11-25T10:40" },
      { ...JOB_BODY, pickupAt: { date: "2026-02-30", time: "10:40" } }, { ...JOB_BODY, providerLabel: "x".repeat(41) }]) {
      expect((await POST_JOB(post(WRITES[0]!, bad), ctx())).status).toBe(400);
    }
    expect(h.fake.calls).toHaveLength(1);
  });

  it("a status names the status the person saw; the job must be THIS lead's", async () => {
    await POST_STATUS(post(WRITES[1]!, { ...STATUS_BODY, occurredAt: { date: "2026-11-22", time: "10:40" }, note: "at the door" }), ctx());
    expect(h.fake.calls[0]!.params).toEqual({ p_actor_id: "00000000-0000-4000-8000-0000000000aa", p_job_id: JOB_B, p_expected_shop: B, p_expected_status: "accepted",
      p_status: "picked_up", p_occurred_at: "2026-11-22T15:40:00.000Z", p_note: "at the door" });
    withDb();
    for (const [handler, w] of [[POST_STATUS, WRITES[1]!], [POST_COST, WRITES[2]!], [POST_KEEP, WRITES[3]!]] as const) {
      const res = await (handler as Handler)(post(w, w.body), ctx(JOB_B, OTHER_LEAD));
      expect([res.status, await code(res)]).toEqual([404, "job_not_found"]);
    }
    expect(h.fake.calls).toEqual([]);
    expect((await POST_STATUS(post(WRITES[1]!, { ...STATUS_BODY, status: "driver_assigned" }), ctx())).status).toBe(400);
  });
});

describe("every refusal is passed through by name", () => {
  const cases: Array<[Write, string]> = [
    ...(["lead_not_found", "shop_moved", "forbidden", "lead_not_confirmed", "order_rejected", "quote_ambiguous", "delivery_off", "ezcater_never_booked", "not_ezcater",
      "not_delivery", "unknown_provider", "delivery_job_open", "bad_amount", "invalid_request"] as const).map((c): [Write, string] => [WRITES[0]!, c]),
    ...(["job_not_found", "shop_moved", "forbidden", "job_closed", "status_moved", "illegal_move", "bad_occurred_at"] as const).map((c): [Write, string] => [WRITES[1]!, c]),
    ...(["shop_moved", "bad_amount", "cost_exists", "not_current_head", "reason_required", "no_change"] as const).map((c): [Write, string] => [WRITES[2]!, c]),
    ...(["shop_moved", "job_closed", "no_mismatch", "already_kept"] as const).map((c): [Write, string] => [WRITES[3]!, c]),
    ...(["invalid_settings", "forbidden", "location_not_found", "settings_moved", "no_change"] as const).map((c): [Write, string] => [SETTINGS, c]),
  ];
  it.each(cases)("%o → %s", async (w, refusal) => {
    as("moo", [], fresh());
    withDb(refuse(w.rpc, { code: "P0001", message: refusal }));
    const res = await w.handler(post(w, w.body), ctx());
    expect([res.status, await code(res)]).toEqual([deliveryErrorStatus(refusal as never), refusal]);
  });
  it("the cases only name refusals the migration raises, and a stale compare-and-set is a 409", () => {
    for (const [, refusal] of cases) expect(DELIVERY_SQL_REFUSALS).toContain(refusal);
    for (const stale of ["shop_moved", "status_moved", "settings_moved", "not_current_head", "cost_exists", "delivery_job_open", "job_closed"] as const) expect(deliveryErrorStatus(stale)).toBe(409);
  });

  it.each([...WRITES, SETTINGS])("$name: 0356 not on the database is 503 delivery_unavailable with Retry-After, never a 500", async (w) => {
    as("moo", [], fresh());
    withDb(refuse(w.rpc, { code: "PGRST202", message: "Could not find the function" }));
    const res = await w.handler(post(w, w.body), ctx());
    expect([res.status, await code(res), res.headers.get("Retry-After")]).toEqual([503, "delivery_unavailable", "60"]);
  });
  it.each([...WRITES, SETTINGS])("$name: an unknown failure is a 500 generic, and a double tap's 23505 is its named 409", async (w) => {
    as("moo", [], fresh());
    withDb(refuse(w.rpc, { code: "XX000", message: "boom" }));
    const res = await w.handler(post(w, w.body), ctx());
    expect([res.status, await code(res)]).toEqual([500, "generic"]);
    withDb({ ...OK, [w.rpc]: () => ({ data: null }) });
    expect((await w.handler(post(w, w.body), ctx())).status).toBe(500); // a writer that answers nothing is never a success
  });
  it("a unique violation that slipped past the writer's own check keeps its name", async () => {
    withDb(refuse("record_manual_delivery_job", { code: "23505", message: "duplicate key" }));
    expect(await code(await POST_JOB(post(WRITES[0]!, JOB_BODY), ctx()))).toBe("delivery_job_open");
    withDb(refuse("record_delivery_cost", { code: "23505", message: "duplicate key" }));
    expect(await code(await POST_COST(post(WRITES[2]!, COST_BODY), ctx()))).toBe("cost_exists");
  });
});

describe("who may write: by trusted ROLE, before any database work", () => {
  it.each(WRITES)("$name: the prep manager, the social media manager and a key holder are refused; so is a GM of another shop", async (w) => {
    for (const [role, shops] of [["prep_mgr", [B]], ["social_media_mgr", [B]], ["key_holder", [B]], ["shift_lead", [B]], ["gm", [C]], ["agm", [A]]] as const) {
      as(role, [...shops]);
      const res = await w.handler(post(w, w.body), ctx());
      expect([role, res.status, await code(res)]).toEqual([role, 403, "forbidden"]);
    }
    untouched();
  });
  it.each(WRITES)("$name: the shop's AGM and GM, the catering manager and MoO and up pass the gate", async (w) => {
    for (const [role, shops] of [["agm", [B]], ["gm", [B]], ["catering_mgr", []], ["moo", []], ["owner", []], ["cgs", []]] as const) {
      as(role, [...shops]); withDb();
      expect([role, (await w.handler(post(w, w.body), ctx())).status]).toEqual([role, 200]);
    }
  });
  it("the gate binds to the shop the person SAW: a GM of A naming B is refused before the database", async () => {
    as("gm", [A]);
    expect((await POST_JOB(post(WRITES[0]!, { ...JOB_BODY, expectedShopId: B }), ctx())).status).toBe(403);
    untouched();
  });
});

describe("step-up: a cost CORRECTION is Tier A; everything else on a job takes none", () => {
  it("a first cost and 'No charge' take no password", async () => {
    expect((await POST_COST(post(WRITES[2]!, { ...COST_BODY, amountCents: 0 }), ctx())).status).toBe(200);
    expect(h.fake.calls[0]!.params).toMatchObject({ p_amount_cents: 0, p_corrects_id: null, p_component: "base" });
  });
  it("a correction without an unlock is refused step_up_required and never reaches the database", async () => {
    const res = await POST_COST(post(WRITES[2]!, CORRECTION), ctx());
    expect([res.status, await code(res)]).toEqual([403, "step_up_required"]);
    untouched();
  });
  it("a correction with an unlock of ANY age reaches the writer with the row it corrects and the reason", async () => {
    as("agm", [B], { stepUpUnlocked: true, stepUpUnlockedAt: "2020-01-01T00:00:00Z" });
    expect((await POST_COST(post(WRITES[2]!, CORRECTION), ctx())).status).toBe(200);
    expect(h.fake.calls.at(-1)!.params).toMatchObject({ p_corrects_id: COST, p_note: "the invoice said 30", p_amount_cents: 3000 });
  });
  it("the tier is chosen by the act, after the parse: a malformed correction is a 400, not a password prompt", async () => {
    expect((await POST_COST(post(WRITES[2]!, { ...CORRECTION, correctsId: "nope" }), ctx())).status).toBe(400);
  });
  it("only the cost path keeps a password unlock; the read, the record, a status and keep-pickup clear it", () => {
    expect(isStepUpSurface(`/api/catering/pipeline/${LEAD}/delivery/${JOB_B}/cost`)).toBe(true);
    for (const path of [`/api/catering/pipeline/${LEAD}/delivery`, `/api/catering/pipeline/${LEAD}/delivery/${JOB_B}/status`, `/api/catering/pipeline/${LEAD}/delivery/${JOB_B}/keep-pickup`,
      `/api/catering/pipeline/${LEAD}/delivery/${JOB_B}/cost/x`, `/api/catering/pipeline/${LEAD}/delivery/cost`, "/catering/pipeline"]) expect([path, isStepUpSurface(path)]).toEqual([path, false]);
    expect(isStepUpSurface("/api/admin/catering/delivery")).toBe(true);
  });
  it.each(WRITES.filter((w) => w.rpc !== "record_delivery_cost"))("$name asserts no tier", async (w) => {
    as("agm", [B]); // no unlock at all
    expect((await w.handler(post(w, w.body), ctx())).status).toBe(200);
  });
});

describe("the settings: owner / CGS / MoO by role, Tier B, the row the person saw", () => {
  it("anyone else is refused by role before the password and the database (GET and POST)", async () => {
    for (const role of ["gm", "agm", "catering_mgr", "prep_mgr", "social_media_mgr", "key_holder"]) {
      as(role, [B], fresh());
      const res = await POST_SETTINGS(post(SETTINGS, SETTINGS_BODY));
      expect([role, res.status, await code(res)]).toEqual([role, 403, "forbidden"]);
      expect([role, (await GET_SETTINGS(get(SETTINGS.path))).status]).toEqual([role, 403]);
    }
    untouched();
  });
  it("without a password: step_up_required; with an old one: step_up_stale; neither reaches the database", async () => {
    as("moo");
    expect(await code(await POST_SETTINGS(post(SETTINGS, SETTINGS_BODY)))).toBe("step_up_required");
    as("owner", [], { stepUpUnlocked: true, stepUpUnlockedAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    const res = await POST_SETTINGS(post(SETTINGS, SETTINGS_BODY));
    expect([res.status, await code(res)]).toEqual([403, "step_up_stale"]);
    untouched();
  });
  it("a fresh password saves ONE shop's whole row, naming the updated_at the person saw (untouched, microseconds kept)", async () => {
    for (const role of ["moo", "owner", "cgs"]) {
      as(role, [], fresh()); withDb();
      const res = await POST_SETTINGS(post(SETTINGS, SETTINGS_BODY));
      expect(res.status).toBe(200);
      expect(h.fake.calls).toEqual([{ name: "set_delivery_settings", params: { p_actor_id: "00000000-0000-4000-8000-0000000000aa", p_location_id: B,
        p_settings: { enabled: true, manual_providers: ["Courier 2"], gratuity_driver_bps: 1000 }, p_expected_updated_at: "2026-11-22T10:00:00.123456+00:00" } }]);
      expect(((await res.json()) as { saved: { updatedAt: string } }).saved.updatedAt).toBe("2026-11-22T12:00:00.654321+00:00");
    }
  });
  it("a first save names 'no row' (null); a malformed row is 400 invalid_settings and never the writer", async () => {
    as("moo", [], fresh());
    expect((await POST_SETTINGS(post(SETTINGS, { ...SETTINGS_BODY, expectedUpdatedAt: null }))).status).toBe(200);
    expect(h.fake.calls[0]!.params.p_expected_updated_at).toBeNull();
    withDb();
    const v = SETTINGS_BODY.values;
    for (const bad of [{ ...SETTINGS_BODY, extra: 1 }, { ...SETTINGS_BODY, values: { ...v, extra: 1 } }, { ...SETTINGS_BODY, values: { ...v, gratuityDriverBps: 10_001 } },
      { ...SETTINGS_BODY, values: { ...v, gratuityDriverBps: 12.5 } }, { ...SETTINGS_BODY, values: { ...v, manualProviders: ["a", "A"] } },
      { ...SETTINGS_BODY, values: { ...v, manualProviders: [" a"] } }, { ...SETTINGS_BODY, values: { ...v, manualProviders: Array.from({ length: 13 }, (_, i) => `c${i}`) } },
      { ...SETTINGS_BODY, values: { ...v, enabled: "yes" } }, { ...SETTINGS_BODY, locationId: "x" }, { locationId: B, values: v }]) {
      const res = await POST_SETTINGS(post(SETTINGS, bad));
      expect([res.status, await code(res)], JSON.stringify(bad)).toEqual([400, "invalid_settings"]);
    }
    expect(h.fake.calls).toEqual([]);
  });
  it("GET: every active shop with its row; off with no query; not installed is its own state", async () => {
    as("moo");
    const ready = (await (await GET_SETTINGS(get(SETTINGS.path))).json()) as { settings: { state: string; shops: Array<{ locationId: string; name: string; enabled: boolean }> } };
    expect(ready.settings.state).toBe("ready");
    expect(ready.settings.shops.map((s) => s.name)).toEqual(["Shop A", "Shop B"]);
    withDb(refuse("delivery_ready", { code: "PGRST202", message: "missing" }));
    expect(await (await GET_SETTINGS(get(SETTINGS.path))).json()).toEqual({ settings: { state: "not_installed" } });
    vi.stubEnv("DELIVERY_TRACKING", ""); withDb();
    expect(await (await GET_SETTINGS(get(SETTINGS.path))).json()).toEqual({ settings: { state: "off" } });
    untouched();
  });
});

/** Every path of a JSON value: object keys joined with ".", an array as "[]". */
function paths(value: unknown, at = ""): string[] {
  if (Array.isArray(value)) return value.length === 0 ? [`${at}[]`] : [...new Set(value.flatMap((v) => paths(v, `${at}[]`)))];
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([key, v]) => paths(v, at ? `${at}.${key}` : key));
  return [at];
}
const HISTORY_PATHS = ["view", "leadId", "movedToShopId", ...["jobId", "attemptNo", "status", "statusAt", "providerLabel", "externalRef", "pickupAt", "dropoffAt", "pickupShopId",
  ...["id", "jobId", "seq", "status", "occurredAt", "recordedAt", "source", "actorId", "note"].map((key) => `events[].${key}`)].map((key) => `jobs[].${key}`)].sort();
const STATUS_ONLY_PATHS = ["view", "leadId", "shopId", "enabled", "isEzcater", "orderQuote.kind", "orderQuote.isDelivery", "state",
  ...["attemptNo", "status", "statusAt", "providerLabel", "pickupAt", "dropoffAt"].map((key) => `status.${key}`)].sort();

describe("GET: the view is decided in the lib, and each payload is an allow-list", () => {
  const read = async (role: string, shops: string[]) => { as(role, shops); withDb(); return GET_LEAD(get(`/api/catering/pipeline/${LEAD}/delivery`), ctx()); };

  it("the switch off: 200 { view: 'off' } with zero database work — the panel renders nothing", async () => {
    vi.stubEnv("DELIVERY_TRACKING", "");
    const res = await read("moo", []);
    expect([res.status, await res.json()]).toEqual([200, { view: "off" }]);
    untouched();
    expect(h.session).toHaveBeenCalledWith(expect.anything(), `/api/catering/pipeline/${LEAD}/delivery`);
  });
  it("0356 not on the database: 200 { view: 'not_installed' }", async () => {
    as("moo");
    withDb(OK, { ...TABLES, catering_pipeline: () => ({ error: { code: "42P01", message: "relation does not exist" } }) });
    const res = await GET_LEAD(get(`/api/catering/pipeline/${LEAD}/delivery`), ctx());
    expect([res.status, await res.json()]).toEqual([200, { view: "not_installed" }]);
  });
  it("a shop that is off answers the lead view with enabled false (the panel renders nothing)", async () => {
    as("moo");
    withDb(OK, { ...TABLES, delivery_settings: () => ({ data: null }) });
    expect(((await (await GET_LEAD(get(`/api/catering/pipeline/${LEAD}/delivery`), ctx())).json()) as { view: string; enabled: boolean })).toMatchObject({ view: "lead", enabled: false });
  });

  it("after A → B: A's GM gets the HISTORY view — A's job only, no state, no cost, nothing of B's job", async () => {
    for (const role of ["gm", "agm"]) {
      const res = await read(role, [A]);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { view: string; jobs: Array<{ jobId: string }> };
      expect(body.view).toBe("history");
      expect(body.jobs.map((j) => j.jobId)).toEqual([JOB_A]);
      expect(paths(body).sort()).toEqual(HISTORY_PATHS);
      const text = JSON.stringify(body);
      for (const never of [JOB_B, "REF-2", "Courier 2", "3175", "amountCents", "cost", "state", "orderQuote", "detail", "manualProviders", "candidates", "gratuity"]) expect(text).not.toContain(never);
      // It read the lead's shop, the jobs and THEIR events — never the quote, the costs, the split or the settings.
      expect([...new Set(h.fake.reads)].sort()).toEqual(["catering_pipeline", "delivery_job_current", "delivery_job_events"]);
    }
  });
  it("a GM of neither shop gets 404; so does an unknown lead and a lead id that is not a uuid", async () => {
    expect((await read("gm", [C])).status).toBe(404);
    as("moo"); withDb();
    expect((await GET_LEAD(get(`/api/catering/pipeline/${OTHER_LEAD}/delivery`), ctx(JOB_B, OTHER_LEAD))).status).toBe(404);
    withDb();
    expect((await GET_LEAD(get("/api/catering/pipeline/lead/delivery"), ctx(JOB_B, "lead"))).status).toBe(404);
    untouched();
  });
  it("B's GM gets the LEAD view with both jobs, the detail and the cost", async () => {
    const body = (await (await read("gm", [B])).json()) as { view: string; state: string; detail: { jobs: Array<{ id: string }>; manualProviders: string[] }; cost: { orderCost: unknown } };
    expect([body.view, body.state]).toEqual(["lead", "booked"]);
    expect(body.detail.jobs.map((j) => j.id)).toEqual([JOB_A, JOB_B]);
    expect(body.detail.manualProviders).toEqual(["Courier 2"]);
    expect(body.cost.orderCost).toEqual({ kind: "partial", knownCents: 3175, unknownJobs: 1 });
  });
  it("a key holder (and the prep manager) at the shop gets the STATUS only: no money, no reference, no note", async () => {
    for (const role of ["key_holder", "shift_lead", "prep_mgr"]) {
      const res = await read(role, [B]);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(paths(body).sort()).toEqual(STATUS_ONLY_PATHS);
      const text = JSON.stringify(body);
      for (const never of ["REF-", "SECRET-NOTE", "3175", "2500", "1000", "cost", "externalRef", "note", "detail", "amountCents"]) expect(text).not.toContain(never);
      expect(body).toMatchObject({ view: "lead", state: "booked", status: { providerLabel: "Courier 2", status: "accepted" } });
    }
  });
  it("the social media manager and anyone below key holder are refused before the database; a key holder elsewhere gets 404", async () => {
    for (const role of ["social_media_mgr", "employee", "trainee"]) {
      as(role, [B]); withDb();
      expect([role, (await GET_LEAD(get(`/api/catering/pipeline/${LEAD}/delivery`), ctx())).status]).toEqual([role, 403]);
      untouched();
    }
    expect((await read("key_holder", [A])).status).toBe(404);
  });
});
