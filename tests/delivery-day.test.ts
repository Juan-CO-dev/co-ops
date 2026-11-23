/**
 * Catering delivery D3 — the money-free delivery fact (plan r6 section 6.2): its pure shaping (`lib/delivery/day-shared.ts`)
 * and its loader (`lib/delivery/day.ts`).
 *
 *  - The state of a lead comes from `deliveryStateOf` ONLY; the latest job is the highest attempt, never a time.
 *  - The fact carries ids, enums, booleans and instants: the SELECT lists are pinned, and sentinels planted in every
 *    other column never reach a result.
 *  - Off (the switch, the status gate, the shop's own switch, 0356 not installed) = `{ off: true }` and no further
 *    query. A real failure = `{ ok: false }`: never an empty list, so nothing reads "to book" from it.
 *  - A fixed number of query kinds, paged and chunked; a lead that changed shop under the reads is dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no default client in this test"); }) }));

import type { DeliveryActor } from "@/lib/delivery/access-shared";
import {
  DAY_DECISION_COLUMNS, DAY_EZCATER_COLUMNS, DAY_JOB_COLUMNS, DAY_LEAD_COLUMNS, DAY_OPEN_JOB_COLUMNS, DAY_QUOTE_COLUMNS, DAY_SETTINGS_COLUMNS, DAY_SHOP_RECHECK_COLUMNS,
  loadDeliveryDay, loadDeliveryStates, loadPipelineDeliveryStates,
} from "@/lib/delivery/day";
import {
  attachDelivery, DELIVERY_ALERT_STATES, DELIVERY_NEEDS_PERSON, DELIVERY_UNKNOWN, deliveryAlerts, deliveryDayLeads, deliveryLabel, deliveryNeedsPerson, deliveryRowStateOf,
  rowStateSoon, type DeliveryDayLead, type DeliveryDayResult, type DeliveryRowState,
} from "@/lib/delivery/day-shared";
import { deliveryStateOf, toBookSoon } from "@/lib/delivery/status-shared";
import { DELIVERY_STATES } from "@/lib/delivery/types-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import type { RoleCode } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { A, B, DAY, decision, job, lead, on, quote, SENTINELS, worldResponder, type World } from "./fixtures/delivery/day-world";
import { fakeSupabase } from "./helpers/fake-supabase";

const actor = (role: RoleCode, locations: string[] = [A], active = true): DeliveryActor => ({ role, active, locations });
const KH = actor("key_holder");
const run = async (world: World, who: DeliveryActor = KH, shop = A) => {
  const f = fakeSupabase(worldResponder(world));
  const result = await loadDeliveryDay(f.client as never, who, shop, DAY);
  return { result, calls: f.calls, tables: f.calls.map((c) => c.table) };
};
const leadsOf = (r: DeliveryDayResult): DeliveryDayLead[] => {
  if (!("ok" in r) || !r.ok) throw new Error(`expected an ok fact, got ${JSON.stringify(r)}`);
  return r.leads;
};
const stateOf = (r: DeliveryDayResult, id: string) => deliveryRowStateOf(leadsOf(r).find((l) => l.leadId === id)!).state;

/** The world every state of plan 4.8 lives in. */
function world(): World {
  return {
    settings: [on(A), on(B)],
    leads: [
      lead("l-book"),                                                     // a confirmed house delivery, nothing booked
      lead("l-lost", { stage: "lost", event_date: "2026-11-01" }),        // rejected by stage, a courier still booked (set b)
      lead("l-declined"),                                                 // rejected by its quote while the lead stays confirmed
      lead("l-mistake"),                                                  // job 1 delivered by mistake (LATER time), job 2 cancelled
      lead("l-ez"),                                                       // ezCater by its ezcater_orders row; the label was edited away
      lead("l-mismatch"),                                                 // booked for pickup at B; the order is at A
      lead("l-kept"),                                                     // the same, acknowledged for A
      lead("l-pickup", { stage: "out" }),                                 // a pickup order: no delivery
      lead("l-other-shop", { location_id: B }),                           // another shop's lead with an open job
      lead("l-old", { event_date: "2026-11-01", stage: "completed" }),    // another day, nothing open: not in the fact
      lead("l-problem"),                                                  // the latest job failed
      lead("l-out", { stage: "out" }),                                    // picked up
    ],
    jobs: [
      job("l-lost", 1, "accepted", { pickup_at: "2026-11-18T15:40:00.000Z" }),
      job("l-declined", 1, "accepted"),
      job("l-mistake", 1, "delivered", { status_at: "2026-11-18T20:00:00.000Z" }),
      job("l-mistake", 2, "cancelled", { status_at: "2026-11-18T14:00:00.000Z" }),
      job("l-mismatch", 1, "accepted", { location_id: B }),
      job("l-kept", 1, "accepted", { location_id: B }),
      job("l-other-shop", 1, "accepted", { location_id: B }),
      job("l-problem", 1, "failed"),
      job("l-out", 1, "picked_up", { status_at: "2026-11-18T15:42:00.000Z" }),
    ],
    decisions: [decision("job-l-kept-1", A), decision("job-l-mismatch-1", "cccccccc-cccc-4ccc-8ccc-cccccccccccc")],
    quotes: [
      quote("l-book", "accepted"), quote("l-declined", "declined"), quote("l-mistake", "accepted"), quote("l-mismatch", "accepted"), quote("l-kept", "accepted"),
      quote("l-pickup", "accepted", { is_delivery: false }), quote("l-problem", "accepted"), quote("l-out", "accepted"), quote("l-lost", "accepted"),
      // A superseded revision is not a candidate.
      quote("l-book", "declined", { superseded_at: "2026-11-11T00:00:00.000Z" }),
    ],
    ezcater: [{ id: "ez-1", lead_id: "l-ez", total_cents: SENTINELS[6], order_number: SENTINELS[4] }],
  };
}

beforeEach(() => { vi.stubEnv("DELIVERY_TRACKING", "1"); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("the pure shaping", () => {
  it("toBookSoon is the one place to_book becomes to_book_soon; deliveryStateOf uses it", () => {
    for (const s of DELIVERY_STATES) expect(toBookSoon(s, false)).toBe(s);
    for (const s of DELIVERY_STATES) expect(toBookSoon(s, true)).toBe(s === "to_book" ? "to_book_soon" : s);
    expect(toBookSoon("unknown", true)).toBe("unknown");
    const input = { stage: "confirmed" as const, currentShopId: A, orderQuote: { kind: "accepted" as const, isDelivery: true }, isEzcater: false, jobs: [] };
    expect(deliveryStateOf(input).state).toBe("to_book");
    expect(deliveryStateOf({ ...input, soon: true }).state).toBe("to_book_soon");
  });

  it("the fact is stable whatever order the rows arrive in: leads by id, jobs by attempt", () => {
    const rows = { leads: [{ id: "b", location_id: A, stage: "confirmed" as const, lead_source: null }, { id: "a", location_id: A, stage: "out" as const, lead_source: "ezcater" }],
      jobs: [
        { id: "j2", pipeline_id: "a", location_id: A, attempt_no: 2, closed_at: null, status: "accepted" as const, status_at: "t2", pickup_at: "p2" },
        { id: "j1", pipeline_id: "a", location_id: B, attempt_no: 1, closed_at: "c", status: "cancelled" as const, status_at: "t1", pickup_at: null },
      ], decisions: [{ job_id: "j1", lead_location_id: A }], quotes: [], ezcater: [] };
    const fact = deliveryDayLeads(rows);
    expect(fact).toEqual(deliveryDayLeads({ ...rows, leads: [...rows.leads].reverse(), jobs: [...rows.jobs].reverse() }));
    expect(fact.map((l) => l.leadId)).toEqual(["a", "b"]);
    expect(fact[0]).toEqual({ leadId: "a", stage: "out", currentShopId: A, orderQuote: { kind: "none", isDelivery: null }, isEzcater: true, jobs: [
      { attemptNo: 1, status: "cancelled", open: false, pickupShopId: B, keptForCurrentShop: true, at: "t1", pickupAt: null },
      { attemptNo: 2, status: "accepted", open: true, pickupShopId: A, keptForCurrentShop: false, at: "t2", pickupAt: "p2" },
    ] });
  });

  it("a row's instant: the booked pick-up while booked (and for an alert), the status time once it moves; none when it is about no job", () => {
    const l = (jobs: DeliveryDayLead["jobs"], over: Partial<DeliveryDayLead> = {}): DeliveryDayLead =>
      ({ leadId: "x", stage: "confirmed", currentShopId: A, orderQuote: { kind: "accepted", isDelivery: true }, isEzcater: false, jobs, ...over });
    const j = (status: DeliveryDayLead["jobs"][number]["status"], open: boolean) => ({ attemptNo: 1, status, open, pickupShopId: A, keptForCurrentShop: false, at: "AT", pickupAt: "PICKUP" });
    expect(deliveryRowStateOf(l([j("accepted", true)]))).toEqual({ state: "booked", at: "PICKUP", status: "accepted" });
    expect(deliveryRowStateOf(l([j("picked_up", true)]))).toEqual({ state: "on_the_way", at: "AT", status: "picked_up" });
    expect(deliveryRowStateOf(l([j("delivered", false)]))).toEqual({ state: "delivered", at: "AT", status: "delivered" });
    expect(deliveryRowStateOf(l([j("failed", false)]))).toEqual({ state: "problem", at: "AT", status: "failed" });
    expect(deliveryRowStateOf(l([j("accepted", true)], { stage: "lost" }))).toEqual({ state: "cancel_needed", at: "PICKUP", status: "accepted" });
    expect(deliveryRowStateOf(l([]))).toEqual({ state: "to_book", at: null, status: null });
    expect(deliveryRowStateOf(l([]), true)).toEqual({ state: "to_book_soon", at: null, status: null });
    expect(rowStateSoon({ state: "to_book", at: null, status: null }, true).state).toBe("to_book_soon");
    const booked: DeliveryRowState = { state: "booked", at: "x", status: "accepted" };
    expect(rowStateSoon(booked, true)).toBe(booked);
    expect(rowStateSoon(DELIVERY_UNKNOWN, true)).toBe(DELIVERY_UNKNOWN);
  });

  it("who needs a person: to book inside the window, to cancel, a failed delivery, a courier at another shop; alerts are the two an order-less lead can be in", () => {
    expect(DELIVERY_NEEDS_PERSON).toEqual(["to_book_soon", "cancel_needed", "problem", "pickup_mismatch"]);
    expect(DELIVERY_ALERT_STATES).toEqual(["cancel_needed", "pickup_mismatch"]);
    for (const s of [...DELIVERY_STATES, "unknown" as const]) expect([s, deliveryNeedsPerson(s)]).toEqual([s, (DELIVERY_NEEDS_PERSON as readonly string[]).includes(s)]);
  });

  it("every state has ONE label, in en and es, with {time} only where a time is given; none shows nothing", () => {
    const EN = en as Record<string, string>, ES = es as Record<string, string>;
    expect(deliveryLabel(null)).toBeNull();
    expect(deliveryLabel(undefined)).toBeNull();
    expect(deliveryLabel({ state: "none", at: null, status: null })).toBeNull();
    for (const state of [...DELIVERY_STATES, "unknown" as const]) for (const at of [null, "2026-11-18T15:40:00.000Z"]) for (const status of [null, "accepted", "picked_up", "en_route_pickup", "delivered"] as const) {
      const label = deliveryLabel({ state, at, status });
      if (state === "none") { expect(label).toBeNull(); continue; }
      expect(EN[label!.key], label!.key).toBeTruthy();
      expect(ES[label!.key], label!.key).toBeTruthy();
      expect([label!.key, EN[label!.key]!.includes("{time}")]).toEqual([label!.key, label!.time !== null]);
      expect([label!.key, ES[label!.key]!.includes("{time}")]).toEqual([label!.key, label!.time !== null]);
    }
    expect(deliveryLabel({ state: "booked", at: "T", status: "accepted" })).toEqual({ key: "catering.delivery_state.booked_at", time: "T", tone: "ok" });
    expect(deliveryLabel({ state: "on_the_way", at: "T", status: "picked_up" })!.key).toBe("catering.delivery_state.picked_up_at");
    // A courier still heading to the shop has not picked anything up.
    expect(deliveryLabel({ state: "on_the_way", at: "T", status: "en_route_pickup" })).toEqual({ key: "catering.delivery_state.on_the_way", time: null, tone: "ok" });
    expect(deliveryLabel(DELIVERY_UNKNOWN)).toEqual({ key: "catering.delivery_state.unknown", time: null, tone: "muted" });
    expect(["to_book_soon", "problem", "cancel_needed", "pickup_mismatch"].map((state) => deliveryLabel({ state: state as never, at: null, status: null })!.tone)).toEqual(Array(4).fill("alert"));
  });

  it("attachDelivery: off = the same array untouched; a failed read = unknown on every row; ok = the lead's state, no key for none or a lead the fact lacks", () => {
    const rows = [{ id: "l-book" }, { id: "l-pickup" }, { id: "nobody" }];
    expect(attachDelivery(rows, null)).toBe(rows);
    expect(attachDelivery(rows, { off: true })).toBe(rows);
    expect(attachDelivery(rows, { ok: false })).toEqual(rows.map((r) => ({ ...r, delivery: DELIVERY_UNKNOWN })));
    const fact = deliveryDayLeads({ leads: [{ id: "l-book", location_id: A, stage: "confirmed", lead_source: null }, { id: "l-pickup", location_id: A, stage: "confirmed", lead_source: null }],
      jobs: [], decisions: [], ezcater: [], quotes: [{ id: "q1", pipeline_id: "l-book", status: "accepted", is_delivery: true, created_at: "x" }, { id: "q2", pipeline_id: "l-pickup", status: "accepted", is_delivery: false, created_at: "x" }] });
    expect(attachDelivery(rows, { ok: true, leads: fact })).toEqual([{ id: "l-book", delivery: { state: "to_book", at: null, status: null } }, { id: "l-pickup" }, { id: "nobody" }]);
  });
});

describe("loadDeliveryDay: the lead set and the states", () => {
  it("(a) the day's booked leads UNION (b) every lead at the shop with an OPEN job; never another shop's, never an old day with nothing open", async () => {
    const { result } = await run(world());
    expect(leadsOf(result).map((l) => l.leadId)).toEqual(["l-book", "l-declined", "l-ez", "l-kept", "l-lost", "l-mismatch", "l-mistake", "l-out", "l-pickup", "l-problem"]);
  });

  it("every state of the rule, from deliveryStateOf", async () => {
    const { result } = await run(world());
    expect(Object.fromEntries(leadsOf(result).map((l) => [l.leadId, deliveryRowStateOf(l).state]))).toEqual({
      "l-book": "to_book",
      // Rejected after booking, by stage ...
      "l-lost": "cancel_needed",
      // ... and by a declined quote while the lead stays confirmed.
      "l-declined": "cancel_needed",
      // The latest job is attempt 2 (cancelled), whatever the times say: to book, not delivered.
      "l-mistake": "to_book",
      // ezCater's courier: never ours to book.
      "l-ez": "provider_managed",
      "l-mismatch": "pickup_mismatch",
      // Acknowledged for the lead's CURRENT shop.
      "l-kept": "booked",
      "l-pickup": "none",
      "l-problem": "problem",
      "l-out": "on_the_way",
    });
  });

  it("ezCater-ness is durable: the source label OR an ezcater_orders row naming the lead", async () => {
    const { result } = await run(world());
    const ez = leadsOf(result).find((l) => l.leadId === "l-ez")!;
    expect(ez).toMatchObject({ isEzcater: true, orderQuote: { kind: "none", isDelivery: null } });
    const labelled = await run({ ...world(), ezcater: [], leads: [lead("l-ez", { lead_source: "ezcater" })] });
    expect(stateOf(labelled.result, "l-ez")).toBe("provider_managed");
    // Neither: a quote-less lead is not known to be a delivery, so it never reads "to book" either.
    const neither = await run({ ...world(), ezcater: [], leads: [lead("l-ez")] });
    expect(stateOf(neither.result, "l-ez")).toBe("none");
  });

  it("a pickup decision answers only for the destination it was made for", async () => {
    const w = world();
    const elsewhere = await run({ ...w, decisions: [decision("job-l-kept-1", B)] });
    expect(stateOf(elsewhere.result, "l-kept")).toBe("pickup_mismatch");
  });

  it("the alerts: the fact's leads with no order row that still need a person", async () => {
    const { result } = await run(world());
    const leads = leadsOf(result);
    // l-declined has an order row today (the lead is still confirmed): it is a ROW, not an alert.
    expect(deliveryAlerts(leads, new Set(["l-book", "l-declined", "l-mismatch"]))).toEqual([{ leadId: "l-lost", state: "cancel_needed", at: "2026-11-18T15:40:00.000Z" }]);
    // With no order row known at all, every lead in an alert state is an alert.
    expect(deliveryAlerts(leads, new Set()).map((a) => [a.leadId, a.state])).toEqual([["l-declined", "cancel_needed"], ["l-lost", "cancel_needed"], ["l-mismatch", "pickup_mismatch"]]);
  });
});

describe("loadDeliveryDay: money-free by construction", () => {
  it("the SELECT lists are these, exactly", () => {
    expect({ DAY_SETTINGS_COLUMNS, DAY_LEAD_COLUMNS, DAY_OPEN_JOB_COLUMNS, DAY_JOB_COLUMNS, DAY_DECISION_COLUMNS, DAY_QUOTE_COLUMNS, DAY_EZCATER_COLUMNS, DAY_SHOP_RECHECK_COLUMNS }).toEqual({
      DAY_SETTINGS_COLUMNS: "location_id,enabled",
      DAY_LEAD_COLUMNS: "id,location_id,stage,lead_source",
      DAY_OPEN_JOB_COLUMNS: "id,pipeline_id",
      DAY_JOB_COLUMNS: "id,pipeline_id,location_id,attempt_no,closed_at,status,status_at,pickup_at",
      DAY_DECISION_COLUMNS: "id,job_id,lead_location_id",
      DAY_QUOTE_COLUMNS: "id,pipeline_id,status,is_delivery,created_at",
      DAY_EZCATER_COLUMNS: "id,lead_id",
      DAY_SHOP_RECHECK_COLUMNS: "id,location_id",
    });
  });

  it("every query names only those columns: no money, name, address, courier label, reference or note; never *", async () => {
    const { calls } = await run(world());
    const allowed: Record<string, string[]> = {
      delivery_settings: [DAY_SETTINGS_COLUMNS], catering_pipeline: [DAY_LEAD_COLUMNS, DAY_SHOP_RECHECK_COLUMNS], delivery_job_current: [DAY_OPEN_JOB_COLUMNS, DAY_JOB_COLUMNS],
      delivery_pickup_decisions: [DAY_DECISION_COLUMNS], catering_quotes: [DAY_QUOTE_COLUMNS], ezcater_orders: [DAY_EZCATER_COLUMNS],
    };
    expect([...new Set(calls.map((c) => c.table))].sort()).toEqual(Object.keys(allowed).sort());
    for (const c of calls) {
      const select = String(c.arg("select"));
      expect(allowed[c.table], `${c.table}: ${select}`).toContain(select);
      expect(select).not.toMatch(/\*|_cents|amount|total|gratuity|fee|contact|name|company|address|provider|label|external|ref\b|note|email|phone|order_number/);
    }
    // No relation that holds money or notes is read at all.
    for (const t of ["delivery_job_costs", "delivery_gratuity_splits", "delivery_job_events", "delivery_jobs"]) expect(calls.some((c) => c.table === t), t).toBe(false);
  });

  it("the sentinels planted in every other column never reach the fact; it holds ids, enums, booleans and instants only", async () => {
    const { result } = await run(world());
    const text = JSON.stringify(result);
    for (const s of SENTINELS) expect(text).not.toContain(String(s));
    for (const l of leadsOf(result)) {
      expect(Object.keys(l).sort()).toEqual(["currentShopId", "isEzcater", "jobs", "leadId", "orderQuote", "stage"]);
      expect(Object.keys(l.orderQuote).sort()).toEqual(["isDelivery", "kind"]);
      for (const j of l.jobs) expect(Object.keys(j).sort()).toEqual(["at", "attemptNo", "keptForCurrentShop", "open", "pickupAt", "pickupShopId", "status"]);
    }
  });
});

describe("loadDeliveryDay: off means no query", () => {
  it("the switch unset: off, zero queries", async () => {
    vi.stubEnv("DELIVERY_TRACKING", "");
    const { result, calls } = await run(world());
    expect(result).toEqual({ off: true });
    expect(calls).toEqual([]);
    vi.stubEnv("DELIVERY_TRACKING", "true");
    expect((await run(world())).calls).toEqual([]);
  });

  it.each([
    ["the social media manager", actor("social_media_mgr")], ["crew (below key holder)", actor("employee")], ["a key holder of another shop", actor("key_holder", [B])],
    ["an inactive key holder", actor("key_holder", [A], false)], ["a GM of another shop", actor("gm", [B])],
  ])("a viewer the status gate refuses (%s): off, zero queries", async (_n, who) => {
    const { result, calls } = await run(world(), who);
    expect(result).toEqual({ off: true });
    expect(calls).toEqual([]);
  });

  it.each([["key holder", KH], ["trainer", actor("trainer")], ["shift lead", actor("shift_lead")], ["AGM", actor("agm")], ["prep manager", actor("prep_mgr")], ["GM", actor("gm")],
    ["catering manager, any shop", actor("catering_mgr", [])], ["MoO, any shop", actor("moo", [])], ["owner", actor("owner", [])], ["CGS", actor("cgs", [])],
  ])("the status gate admits %s", async (_n, who) => {
    expect(leadsOf((await run(world(), who)).result).length).toBeGreaterThan(0);
  });

  it("the shop's own switch: no row, or off = off after ONE read", async () => {
    for (const settings of [[], [on(A, false)], [on(B)]]) {
      const { result, tables } = await run({ ...world(), settings });
      expect(result).toEqual({ off: true });
      expect(tables).toEqual(["delivery_settings"]);
    }
  });

  it.each(["42P01", "42883", "PGRST202", "PGRST205"])("0356 not on the database (%s): off after ONE read, never a failure", async (code) => {
    const { result, tables } = await run({ ...world(), fail: { table: "delivery_settings", error: { code, message: "missing" } } });
    expect(result).toEqual({ off: true });
    expect(tables).toEqual(["delivery_settings"]);
  });
});

describe("loadDeliveryDay: a failed read is { ok: false }, never an empty day", () => {
  it.each(["delivery_settings", "delivery_job_current", "catering_pipeline", "catering_quotes", "ezcater_orders", "delivery_pickup_decisions"])("%s fails", async (table) => {
    const { result } = await run({ ...world(), fail: { table, error: { code: "08006", message: "down" } } });
    expect(result).toEqual({ ok: false });
  });

  it("a thrown client is a failure too (the read never rejects)", async () => {
    const boom = { from() { throw new Error("socket"); } };
    await expect(loadDeliveryDay(boom as never, KH, A, DAY)).resolves.toEqual({ ok: false });
  });
});

describe("loadDeliveryDay: a fixed number of query kinds, paged and chunked", () => {
  it("a quiet day (no lead, nothing open): the shop's switch, the open jobs, the day's leads = 3", async () => {
    const { tables, result } = await run({ settings: [on(A)], leads: [], jobs: [], decisions: [], quotes: [], ezcater: [] });
    expect(result).toEqual({ ok: true, leads: [] });
    expect(tables.sort()).toEqual(["catering_pipeline", "delivery_job_current", "delivery_settings"]);
  });

  it("a day with leads and no job: + jobs, quotes, ezCater rows and the shop re-check = 7; no decision read without a job", async () => {
    const { tables } = await run({ settings: [on(A)], leads: [lead("x")], jobs: [], decisions: [], quotes: [], ezcater: [] });
    expect(tables.sort()).toEqual(["catering_pipeline", "catering_pipeline", "catering_quotes", "delivery_job_current", "delivery_job_current", "delivery_settings", "ezcater_orders"]);
  });

  it("the same reads at 3 leads and at 90 (no per-lead read); 250 leads read in chunks of 100", async () => {
    const many = (n: number): World => ({ settings: [on(A)], leads: Array.from({ length: n }, (_, i) => lead(`lead-${String(i).padStart(4, "0")}`)),
      jobs: Array.from({ length: n }, (_, i) => job(`lead-${String(i).padStart(4, "0")}`, 1, "accepted")), decisions: [], quotes: [], ezcater: [] });
    const [few, more, lots] = [await run(many(3)), await run(many(90)), await run(many(250))];
    expect(more.tables).toEqual(few.tables);
    expect(few.tables).toHaveLength(8);
    expect(leadsOf(lots.result)).toHaveLength(250);
    for (const c of lots.calls) for (const o of c.ops) if (o.op === "in") expect((o.args[1] as unknown[]).length).toBeLessThanOrEqual(100);
    // 3 chunks each for jobs, quotes, ezCater, decisions and the re-check; the leads were already known from the day read.
    expect(lots.tables.filter((t) => t === "catering_quotes")).toHaveLength(3);
    expect(lots.tables.filter((t) => t === "delivery_pickup_decisions")).toHaveLength(3);
  });

  it("past 1,000 rows a read pages; every list read is ordered and ranged", async () => {
    const n = 1200;
    const w: World = { settings: [on(A)], leads: Array.from({ length: n }, (_, i) => lead(`lead-${String(i).padStart(4, "0")}`)), jobs: [], decisions: [], quotes: [], ezcater: [] };
    const { result, calls } = await run(w);
    expect(leadsOf(result)).toHaveLength(n);
    const day = calls.filter((c) => c.table === "catering_pipeline" && c.has("eq", "event_date", DAY));
    expect(day.map((c) => c.arg("range", 0))).toEqual([0, 1000]);
    for (const c of calls) { expect(c.has("order"), c.table).toBe(true); expect(c.has("range"), c.table).toBe(true); expect(c.has("limit")).toBe(false); }
  });

  it("the day read is the shop, the date and the booked stages; the open-job read is `closed_at is null` on the VIEW", async () => {
    const { calls } = await run(world());
    const day = calls.find((c) => c.table === "catering_pipeline" && c.has("eq", "event_date", DAY))!;
    expect(day.has("eq", "location_id", A) && day.has("in", "stage", ["confirmed", "out", "completed"])).toBe(true);
    const open = calls.find((c) => c.table === "delivery_job_current" && c.has("is", "closed_at", null))!;
    expect(String(open.arg("select"))).toBe(DAY_OPEN_JOB_COLUMNS);
    // (b): the open jobs' leads are read at THIS shop only.
    const withOpen = calls.find((c) => c.table === "catering_pipeline" && c.has("in", "id") && String(c.arg("select")) === DAY_LEAD_COLUMNS)!;
    expect(withOpen.has("eq", "location_id", A)).toBe(true);
    for (const q of calls.filter((c) => c.table === "catering_quotes")) expect(q.has("is", "superseded_at", null)).toBe(true);
  });
});

describe("what a read returns is bound to the shop its gate was judged for", () => {
  it("a lead that moved to another shop during the reads is dropped (nothing read about it is returned)", async () => {
    const { result, calls } = await run({ ...world(), after: { "l-book": B, "l-lost": null } });
    const ids = leadsOf(result).map((l) => l.leadId);
    expect(ids).not.toContain("l-book");
    expect(ids).not.toContain("l-lost");
    expect(ids).toContain("l-declined");
    // The re-check is the LAST read.
    expect(String(calls.at(-1)!.arg("select"))).toBe(DAY_SHOP_RECHECK_COLUMNS);
  });
});

describe("loadDeliveryStates: the pipeline's cards, one batched read", () => {
  const states = async (w: World, who: DeliveryActor, ids: string[]) => {
    const f = fakeSupabase(worldResponder(w));
    return { result: await loadDeliveryStates(f.client as never, who, ids), calls: f.calls };
  };
  const ALL = ["l-book", "l-lost", "l-other-shop", "l-pickup", "l-out"];

  it("each lead is judged at its CURRENT shop: a key holder of A gets A's leads and nothing of B's", async () => {
    const { result } = await states(world(), KH, ALL);
    expect(result).toEqual({ ok: true, states: {
      "l-book": { state: "to_book", at: null, status: null }, "l-lost": { state: "cancel_needed", at: "2026-11-18T15:40:00.000Z", status: "accepted" },
      "l-pickup": { state: "none", at: null, status: null }, "l-out": { state: "on_the_way", at: "2026-11-18T15:42:00.000Z", status: "picked_up" },
    } });
    const moo = await states(world(), actor("moo", []), ALL);
    expect(Object.keys((moo.result as { states: object }).states).sort()).toEqual([...ALL].sort());
  });

  it("a shop that is off contributes nothing; with every readable shop off the answer is off", async () => {
    const mixed = await states({ ...world(), settings: [on(A), on(B, false)] }, actor("moo", []), ALL);
    expect(Object.keys((mixed.result as { states: object }).states)).not.toContain("l-other-shop");
    expect((await states({ ...world(), settings: [] }, actor("moo", []), ALL)).result).toEqual({ off: true });
  });

  it("off with no query: the switch, the social media manager, an inactive viewer; no lead = no query", async () => {
    expect((await states(world(), actor("social_media_mgr"), ALL)).calls).toEqual([]);
    expect((await states(world(), actor("gm", [A], false), ALL)).calls).toEqual([]);
    const none = await states(world(), KH, []);
    expect(none).toMatchObject({ result: { ok: true, states: {} }, calls: [] });
    vi.stubEnv("DELIVERY_TRACKING", "");
    const off = await states(world(), KH, ALL);
    expect(off).toMatchObject({ result: { off: true }, calls: [] });
  });

  it("crew: the leads are read (one query), no shop admits them, off", async () => {
    const { result, calls } = await states(world(), actor("employee"), ALL);
    expect(result).toEqual({ off: true });
    expect(calls.map((c) => c.table)).toEqual(["catering_pipeline"]);
    expect(String(calls[0]!.arg("select"))).toBe(DAY_LEAD_COLUMNS);
  });

  it("a failed read is { ok: false }; not installed is off; the queries name the same money-free columns", async () => {
    expect((await states({ ...world(), fail: { table: "delivery_job_current", error: { code: "08006", message: "down" } } }, KH, ALL)).result).toEqual({ ok: false });
    expect((await states({ ...world(), fail: { table: "delivery_settings", error: { code: "42P01", message: "missing" } } }, KH, ALL)).result).toEqual({ off: true });
    const { result, calls } = await states(world(), KH, ALL);
    for (const s of SENTINELS) expect(JSON.stringify(result)).not.toContain(String(s));
    for (const c of calls) expect(String(c.arg("select"))).not.toMatch(/\*|_cents|contact|company|address|provider|external|note/);
  });

  it("loadPipelineDeliveryStates: the switch is checked before a client is made; a failure is { ok: false }", async () => {
    const auth = { role: "gm", locations: [A], user: { id: "u", active: true }, level: 7, session: {} } as unknown as AuthContext;
    vi.stubEnv("DELIVERY_TRACKING", "");
    // No client is passed: the default one throws in this test, so reaching it would not answer "off".
    await expect(loadPipelineDeliveryStates(auth, ALL)).resolves.toEqual({ off: true });
    vi.stubEnv("DELIVERY_TRACKING", "1");
    await expect(loadPipelineDeliveryStates(auth, ALL)).resolves.toEqual({ ok: false });
    const f = fakeSupabase(worldResponder(world()));
    const got = await loadPipelineDeliveryStates(auth, ALL, { client: f.client as never });
    expect(Object.keys((got as { states: object }).states).sort()).toEqual(["l-book", "l-lost", "l-out", "l-pickup"]);
  });
});
