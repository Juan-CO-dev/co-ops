/**
 * Catering delivery D2 — what D2 added to the service-role lib (lib/delivery/jobs.ts):
 *
 *  - `loadMovedDeliveries`: the pickup shop's entry point after an order moved away. AGM / GM only; the jobs recorded
 *    FOR a shop they belong to whose order now sits at a shop they do not read. It returns the JOB only (no customer,
 *    no lead state, no cost, no reference, no note), newest first, inside a 90-day window. Off / anyone else = [] with
 *    ZERO queries; 0356 missing = []; any other failure is thrown, never an empty list.
 *  - The job-of-lead bind: a job-level write that names its lead refuses `job_not_found` before the writer when the job
 *    is another lead's.
 *  - `canManageDeliverySettings`: owner / CGS / MoO, by role.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canManageDeliverySettings, DELIVERY_SETTINGS_ROLES } from "@/lib/delivery/access-shared";
import { keepDeliveryPickup, loadLeadDelivery, loadMovedDeliveries, loadMovedDeliveriesSafe, MOVED_DELIVERY_WINDOW_DAYS, MOVED_JOB_COLUMNS, recordDeliveryCost, recordDeliveryEvent } from "@/lib/delivery/jobs";
import { ROLES, type RoleCode } from "@/lib/roles";
import { deliveryActor, deliveryFake, type FakeQuery, type FakeTables } from "./helpers/delivery-fake";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no default client in this test"); }) }));

const A = "00000000-0000-4000-8000-00000000000a", B = "00000000-0000-4000-8000-00000000000b", C = "00000000-0000-4000-8000-00000000000c";
const L1 = "00000000-0000-4000-8000-0000000000d1", L2 = "00000000-0000-4000-8000-0000000000d2", L3 = "00000000-0000-4000-8000-0000000000d3", L4 = "00000000-0000-4000-8000-0000000000d4";
const NOW = new Date("2026-11-22T12:00:00Z");
const job = (id: string, lead: string, shop: string, created: string, status = "cancelled") => ({
  id, pipeline_id: lead, location_id: shop, quote_id: null, confirm_event_id: null, booked_via: "manual", provider_label: `Courier ${id}`, external_ref: "SECRET-REF",
  attempt_no: 1, pickup_at: "2026-11-25T15:40:00.000Z", dropoff_at: null, closed_at: status === "accepted" ? null : created, created_by: "u", created_at: created, status,
  status_seq: 2, status_at: created,
});
/** Shop A booked j1 (lead now at B), j2 (lead still at A), j3 (lead now at C), j4 (lead now has no shop). */
const JOBS = [job("j1", L1, A, "2026-11-10T10:00:00Z"), job("j2", L2, A, "2026-11-12T10:00:00Z", "accepted"), job("j3", L3, A, "2026-11-20T10:00:00Z", "delivered"),
  job("j4", L4, A, "2026-11-01T10:00:00Z")];
const LEADS: Record<string, string | null> = { [L1]: B, [L2]: A, [L3]: C, [L4]: null };
const seen: FakeQuery[] = [];
/** Each shop's switch: true = an enabled row, false = a row that is off, absent = no row at all. */
let SWITCH: Record<string, boolean> = { [A]: true, [B]: true, [C]: true };
const settings = (q: FakeQuery) => {
  const row = (id: string) => ({ location_id: id, enabled: SWITCH[id] });
  if (q.in.location_id) return { data: (q.in.location_id as string[]).filter((id) => id in SWITCH).map(row) };
  const id = q.eq.location_id as string;
  return { data: id in SWITCH ? row(id) : null };
};
const TABLES: FakeTables = {
  delivery_settings: settings,
  delivery_job_current: (q) => { seen.push(q); return { data: JOBS.filter((j) => (q.in.location_id ?? []).includes(j.location_id)) }; },
  catering_pipeline: (q) => ({ data: (q.in.id ?? []).map((id) => ({ id, location_id: LEADS[id as string] })) }),
  locations: (q) => ({ data: (q.in.id ?? []).map((id) => ({ id, name: id === A ? "Shop A" : id === B ? "Shop B" : "Shop C" })) }),
};

beforeEach(() => { vi.stubEnv("DELIVERY_TRACKING", "1"); seen.length = 0; SWITCH = { [A]: true, [B]: true, [C]: true }; });
afterEach(() => { vi.unstubAllEnvs(); });

describe("loadMovedDeliveries", () => {
  it("A's GM: the jobs booked at A whose order sits elsewhere — newest first, the job only", async () => {
    const fake = deliveryFake(TABLES);
    const rows = await loadMovedDeliveries(deliveryActor("gm", [A]), { client: fake.sb, now: NOW });
    expect(rows.map((r) => r.jobId)).toEqual(["j3", "j1", "j4"]);
    expect(rows[0]).toEqual({ leadId: L3, jobId: "j3", attemptNo: 1, status: "delivered", statusAt: "2026-11-20T10:00:00Z", providerLabel: "Courier j3",
      pickupAt: "2026-11-25T15:40:00.000Z", dropoffAt: null, pickupShopId: A, pickupShopName: "Shop A", movedToShopId: C, movedToShopName: "Shop C" });
    expect(rows[2]).toMatchObject({ movedToShopId: null, movedToShopName: null });
    // The row type is an allow-list: nothing of the order, no reference, no money, no note.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["attemptNo", "dropoffAt", "jobId", "leadId", "movedToShopId", "movedToShopName", "pickupAt", "pickupShopId", "pickupShopName",
        "providerLabel", "status", "statusAt"]);
    }
    expect(JSON.stringify(rows)).not.toContain("SECRET-REF");
    // Four bounded reads: the shop's own switch, its recent jobs, those leads' current shop, the shop names. Never a quote, a cost or a customer.
    expect(fake.reads).toEqual(["delivery_settings", "delivery_job_current", "catering_pipeline", "locations"]);
    // And the job read names the list's own columns only: no reference, no author, no quote (never fetched, never redacted).
    expect(seen[0]!.select).toBe(MOVED_JOB_COLUMNS);
    for (const hidden of ["external_ref", "created_by", "quote_id", "confirm_event_id", "booked_via"]) expect(MOVED_JOB_COLUMNS.split(",")).not.toContain(hidden);
    expect(fake.calls).toEqual([]);
  });
  it("reads only the viewer's own shops, inside the window", async () => {
    await loadMovedDeliveries(deliveryActor("agm", [A]), { client: deliveryFake(TABLES).sb, now: NOW });
    expect(seen[0]!.in.location_id).toEqual([A]);
    expect(seen[0]!.gte.created_at).toBe(new Date(NOW.getTime() - MOVED_DELIVERY_WINDOW_DAYS * 86_400_000).toISOString());
    expect(MOVED_DELIVERY_WINDOW_DAYS).toBe(90);
  });
  it("a manager who belongs to BOTH shops does not get the order that is still in their pipeline", async () => {
    const rows = await loadMovedDeliveries(deliveryActor("gm", [A, B]), { client: deliveryFake(TABLES).sb, now: NOW });
    expect(rows.map((r) => r.jobId)).toEqual(["j3", "j4"]); // L1 sits at B, which they read
  });
  it("only an AGM or a GM: everyone else gets [] with zero queries (the catering manager and MoO+ read every lead anyway)", async () => {
    for (const role of Object.keys(ROLES) as RoleCode[]) {
      if (role === "gm" || role === "agm") continue;
      const fake = deliveryFake(TABLES);
      expect([role, await loadMovedDeliveries(deliveryActor(role, [A]), { client: fake.sb, now: NOW })]).toEqual([role, []]);
      expect([role, fake.reads]).toEqual([role, []]);
    }
  });
  it("the switch off, no shop, or an inactive account: [] with zero queries", async () => {
    const fake = deliveryFake(TABLES);
    expect(await loadMovedDeliveries(deliveryActor("gm", []), { client: fake.sb, now: NOW })).toEqual([]);
    expect(await loadMovedDeliveries(deliveryActor("gm", [A], {}, false), { client: fake.sb, now: NOW })).toEqual([]);
    vi.stubEnv("DELIVERY_TRACKING", "");
    expect(await loadMovedDeliveries(deliveryActor("gm", [A]), { client: fake.sb, now: NOW })).toEqual([]);
    expect(fake.reads).toEqual([]);
  });
  it("no job, or none that moved: [] without the later reads", async () => {
    const none = deliveryFake({ ...TABLES, delivery_job_current: () => ({ data: [] }) });
    expect(await loadMovedDeliveries(deliveryActor("gm", [A]), { client: none.sb, now: NOW })).toEqual([]);
    expect(none.reads).toEqual(["delivery_settings", "delivery_job_current"]);
    const stay = deliveryFake({ ...TABLES, delivery_job_current: () => ({ data: [JOBS[1]] }) });
    expect(await loadMovedDeliveries(deliveryActor("gm", [A]), { client: stay.sb, now: NOW })).toEqual([]);
    expect(stay.reads).toEqual(["delivery_settings", "delivery_job_current", "catering_pipeline"]);
  });
  describe("OFF MEANS OFF: the pickup shop's own switch (review DELIV2-r1)", () => {
    const gm = deliveryActor("gm", [A]);
    it("a settings row that is off: nothing, and the jobs are never read", async () => {
      SWITCH = { [A]: false, [B]: true };
      const fake = deliveryFake(TABLES);
      expect(await loadMovedDeliveries(gm, { client: fake.sb, now: NOW })).toEqual([]);
      expect(fake.reads).toEqual(["delivery_settings"]);
    });
    it("no settings row at all: nothing", async () => {
      SWITCH = { [B]: true };
      const fake = deliveryFake(TABLES);
      expect(await loadMovedDeliveries(gm, { client: fake.sb, now: NOW })).toEqual([]);
      expect(fake.reads).toEqual(["delivery_settings"]);
    });
    it("a shop that was ON, has moved jobs, and is then turned OFF stops listing them; on again, they are back", async () => {
      const fake = deliveryFake(TABLES);
      expect((await loadMovedDeliveries(gm, { client: fake.sb, now: NOW })).map((r) => r.jobId)).toEqual(["j3", "j1", "j4"]);
      SWITCH[A] = false;
      expect(await loadMovedDeliveries(gm, { client: fake.sb, now: NOW })).toEqual([]);
      SWITCH[A] = true;
      expect(await loadMovedDeliveries(gm, { client: fake.sb, now: NOW })).toHaveLength(3);
    });
    it("only the viewer's ENABLED shops are asked for jobs; the destination shop's switch does not matter", async () => {
      SWITCH = { [A]: true, [C]: false };
      const rows = await loadMovedDeliveries(deliveryActor("gm", [A, "00000000-0000-4000-8000-00000000000f"]), { client: deliveryFake(TABLES).sb, now: NOW });
      expect(seen[0]!.in.location_id).toEqual([A]);
      expect(rows.map((r) => r.jobId)).toEqual(["j3", "j1", "j4"]);
    });
    it("the history READ follows the same switch: a job at a shop that is off answers nothing (a 404 at the route)", async () => {
      const lead = { id: L1, location_id: B, stage: "confirmed", lead_source: "website" };
      const tables: FakeTables = { ...TABLES, catering_pipeline: () => ({ data: lead }),
        delivery_job_current: (q) => ({ data: JOBS.filter((j) => j.pipeline_id === q.eq.pipeline_id && (q.in.location_id ?? []).includes(j.location_id)) }),
        delivery_job_events: () => ({ data: [] }) };
      const on = deliveryFake(tables);
      expect(await loadLeadDelivery(gm, L1, { client: on.sb })).toMatchObject({ view: "history", jobs: [{ jobId: "j1" }] });
      const offs: Array<Record<string, boolean>> = [{ [A]: false, [B]: true }, { [B]: true }];
      for (const off of offs) {
        SWITCH = off;
        const fake = deliveryFake(tables);
        expect(await loadLeadDelivery(gm, L1, { client: fake.sb })).toBeNull();
        expect(fake.reads).not.toContain("delivery_job_current"); // the jobs are never read for a shop that is off
      }
    });
  });

  describe("the page's result: a failed read is its own answer, never an empty list (review DELIV2-r1)", () => {
    it("ok with the rows; ok and empty when off, the shop is off or 0356 is missing", async () => {
      expect(await loadMovedDeliveriesSafe(deliveryActor("gm", [A]), { client: deliveryFake(TABLES).sb, now: NOW })).toMatchObject({ ok: true, rows: [{ jobId: "j3" }, { jobId: "j1" }, { jobId: "j4" }] });
      SWITCH = {};
      expect(await loadMovedDeliveriesSafe(deliveryActor("gm", [A]), { client: deliveryFake(TABLES).sb, now: NOW })).toEqual({ ok: true, rows: [] });
      const missing = deliveryFake({ ...TABLES, delivery_settings: () => ({ error: { code: "42P01", message: "relation does not exist" } }) });
      expect(await loadMovedDeliveriesSafe(deliveryActor("gm", [A]), { client: missing.sb, now: NOW })).toEqual({ ok: true, rows: [] });
      vi.stubEnv("DELIVERY_TRACKING", "");
      expect(await loadMovedDeliveriesSafe(deliveryActor("gm", [A]), { now: NOW })).toEqual({ ok: true, rows: [] });
    });
    it("a database failure at ANY of the reads is { ok: false }", async () => {
      for (const table of ["delivery_settings", "delivery_job_current", "catering_pipeline", "locations"]) {
        const broken = deliveryFake({ ...TABLES, [table]: () => ({ error: { code: "57014", message: "timeout" } }) });
        expect([table, await loadMovedDeliveriesSafe(deliveryActor("gm", [A]), { client: broken.sb, now: NOW })]).toEqual([table, { ok: false }]);
      }
    });
  });

  it("0356 not on the database is [] (nothing to list); any other failure is thrown, never an empty list", async () => {
    const missing = deliveryFake({ ...TABLES, delivery_job_current: () => ({ error: { code: "42P01", message: "relation does not exist" } }) });
    expect(await loadMovedDeliveries(deliveryActor("gm", [A]), { client: missing.sb, now: NOW })).toEqual([]);
    const broken = deliveryFake({ ...TABLES, catering_pipeline: () => ({ error: { code: "XX000", message: "boom" } }) });
    await expect(loadMovedDeliveries(deliveryActor("gm", [A]), { client: broken.sb, now: NOW })).rejects.toMatchObject({ status: 500, code: "generic" });
  });
});

describe("a job-level write that names its lead", () => {
  const JOB = "00000000-0000-4000-8000-0000000000e1";
  const tables: FakeTables = { delivery_settings: settings, delivery_job_current: (q) => { seen.push(q); return { data: q.eq.id === JOB ? [{ id: JOB, pipeline_id: L1 }] : [] }; } };
  const rpcs = { record_delivery_event: () => ({ data: { job_id: JOB, status: "picked_up", status_seq: 2 } }), record_delivery_cost: () => ({ data: { cost_id: "c" } }),
    keep_delivery_pickup: () => ({ data: { decision_id: "d" } }) };
  const event = { jobId: JOB, expectedShopId: A, expectedStatus: "accepted" as const, status: "picked_up" as const, occurredAt: null, note: null };
  const cost = { jobId: JOB, expectedShopId: A, component: "base" as const, amountCents: 100, correctsId: null, note: null };
  const keep = { jobId: JOB, expectedShopId: A, note: null };
  const who = deliveryActor("gm", [A]);

  it("the job is that lead's: one read of the view, then the writer", async () => {
    const fake = deliveryFake(tables, rpcs);
    await recordDeliveryEvent(who, { ...event, leadId: L1 }, { client: fake.sb });
    await recordDeliveryCost(who, { ...cost, leadId: L1 }, { client: fake.sb });
    await keepDeliveryPickup(who, { ...keep, leadId: L1 }, { client: fake.sb });
    expect(fake.calls.map((c) => c.name)).toEqual(["record_delivery_event", "record_delivery_cost", "keep_delivery_pickup"]);
    expect(fake.reads.filter((r) => r === "delivery_job_current")).toHaveLength(3);
    for (const q of seen) expect(q.select).toBe("id,pipeline_id"); // two ids: no tier-restricted column
  });
  it("another lead's job, or no such job: 404 job_not_found, the writer never called", async () => {
    const fake = deliveryFake(tables, rpcs);
    for (const act of [() => recordDeliveryEvent(who, { ...event, leadId: L2 }, { client: fake.sb }), () => recordDeliveryCost(who, { ...cost, leadId: L2 }, { client: fake.sb }),
      () => keepDeliveryPickup(who, { ...keep, leadId: L2 }, { client: fake.sb }), () => recordDeliveryEvent(who, { ...event, jobId: L3, leadId: L1 }, { client: fake.sb })]) {
      await expect(act()).rejects.toMatchObject({ status: 404, code: "job_not_found" });
    }
    expect(fake.calls).toEqual([]);
  });
  it("the gate still comes first: a refused actor makes no read at all", async () => {
    const fake = deliveryFake(tables, rpcs);
    await expect(recordDeliveryEvent(deliveryActor("prep_mgr", [A]), { ...event, leadId: L1 }, { client: fake.sb })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(fake.reads).toEqual([]);
  });
  it("without a lead (a server caller that has the job only) there is no extra read", async () => {
    const fake = deliveryFake(tables, rpcs);
    await recordDeliveryEvent(who, event, { client: fake.sb });
    expect(fake.reads).toEqual(["delivery_settings", "rpc:record_delivery_event"]);
  });
  it("off means off comes before the job read: a shop that is off refuses delivery_off and never reads the job", async () => {
    SWITCH = { [A]: false };
    const fake = deliveryFake(tables, rpcs);
    await expect(recordDeliveryEvent(who, { ...event, leadId: L1 }, { client: fake.sb })).rejects.toMatchObject({ status: 409, code: "delivery_off" });
    expect(fake.reads).toEqual(["delivery_settings"]);
  });
  it("0356 missing on that read is 503 delivery_unavailable", async () => {
    const fake = deliveryFake({ delivery_settings: settings, delivery_job_current: () => ({ error: { code: "PGRST205", message: "no relation" } }) }, rpcs);
    await expect(recordDeliveryCost(who, { ...cost, leadId: L1 }, { client: fake.sb })).rejects.toMatchObject({ status: 503, code: "delivery_unavailable" });
  });
});

describe("the settings page gate", () => {
  it("owner, CGS and MoO — by role, never by level", () => {
    const allowed = (Object.keys(ROLES) as RoleCode[]).filter((role) => canManageDeliverySettings(role)).sort();
    expect(allowed).toEqual([...DELIVERY_SETTINGS_ROLES].sort());
    expect(allowed).toEqual(["cgs", "moo", "owner"]);
  });
});
