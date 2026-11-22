/**
 * Nav PR 6 (plan r3, section 7 and 8.3; C1, C8): the social media manager's facts come from their OWN rows only. No shop
 * read and no board call ever happens for them; failures are `{ kind: "failed" }`, never an empty list or null.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Station, TaskAssignment } from "@/lib/assignments-shared";
import { loadBookedCateringEvents } from "@/lib/catering/booked-events";
import { defaultDayFactDeps, loadDayFacts, type DayFactDeps } from "@/lib/day-plan";
import { planDay, type DayViewer, type SmmPlan } from "@/lib/day-plan-shared";
import { operationalNow } from "@/lib/midshift-shared";
import { loadEzcater } from "@/lib/scheduling/inputs";
import { viewer } from "./fixtures/day-plan/build";
import { args, ev, NO_CLIENT, okDeps, PLAN, SHOP } from "./fixtures/day-plan/loader-deps";
import { stripComments } from "./fixtures/schedule/no-notify-closure";
import { fakeSupabase, type FakeCall } from "./helpers/fake-supabase";

vi.mock("@/lib/catering/booked-events", async (orig) => ({ ...(await orig<object>()), loadBookedCateringEvents: vi.fn(async () => []) }));
vi.mock("@/lib/scheduling/inputs", async (orig) => ({ ...(await orig<object>()), loadEzcater: vi.fn(async () => []) }));

const SMM: DayViewer = { ...viewer("social_media_mgr", "33333333-3333-4333-8333-333333333333"), surfaces: new Set(["tasks", "ops", "catering", "schedule", "report_read"]) };
const ALL_TASKS = (["am_prep", "mid_day_prep", "cash_report", "opening_report", "receiving", "counts", "ordering", "pm_report"] as const)
  .map((task, i): TaskAssignment => ({ id: `t${i}`, task, assigneeId: SMM.userId, assignerId: "g", assignerName: null, note: null, available: true }));
const SHOP_DEPS = ["shopDay", "stationFlags", "closingClassification", "templateItems", "completedItems", "phase1At", "userNames", "cashReport", "pmReport",
  "vendors", "cutoffs", "recentPos", "rhythm", "halfLogged", "openOrders", "completedOn", "booked", "ezcater", "outEvents", "flaggedLines"] as const;
const expo: Station = { id: "expo", name: "Expo Station", nameEs: "Estación Expo", sort: 2, active: true, staffed: true,
  positions: [{ id: "expo-p", stationId: "expo", name: "Expo", nameEs: null, duty: null, dutyEs: null, sort: 1, active: true }] };

function smmDeps(over: Partial<DayFactDeps> = {}) {
  const spies = Object.fromEntries(SHOP_DEPS.map((k) => [k, vi.fn(async () => { throw new Error(`shop read ${k}`); })]));
  const deps: DayFactDeps = {
    ...okDeps(), ...spies,
    ownTasks: async () => ALL_TASKS,
    dayInstance: async (_sb, a) => (a.type === "opening" ? { id: "o", template_id: "t", status: "confirmed", created_at: null, confirmed_at: "x", confirmed_by: null } : null),
    prepInstances: async (_sb, a) => (a.subtype === "mid_day_prep" ? [{ id: "m", template_id: "t", status: "open", created_at: null, confirmed_at: null, confirmed_by: null }] : []),
    ownStationEvents: async () => [ev("1", { userId: SMM.userId, stationId: "expo" })],
    stationWithPositions: async () => expo,
    ...over,
  };
  return { deps, spies };
}
const smmPlanOf = (facts: Parameters<typeof planDay>[0]["facts"]) => planDay({ planDate: PLAN, nowMin: 600, viewer: SMM, facts }) as SmmPlan;

describe("the social media manager: own rows only", () => {
  beforeEach(() => { vi.mocked(loadBookedCateringEvents).mockClear(); vi.mocked(loadEzcater).mockClear(); });

  it("no shop dependency is called and the board is never called; only the three checklist tasks; the own station", async () => {
    const { deps, spies } = smmDeps();
    const board = vi.fn(async () => { throw new Error("board"); });
    const input = await loadDayFacts(NO_CLIENT, args(SMM, { board }), deps);
    for (const [k, spy] of Object.entries(spies)) expect(spy, k).not.toHaveBeenCalled();
    expect(board).not.toHaveBeenCalled();
    expect(input.facts).toEqual({ kind: "smm",
      ownTasks: { kind: "ok", value: [{ task: "am_prep", status: "not_started" }, { task: "mid_day_prep", status: "in_progress" }, { task: "opening_report", status: "done" }] },
      ownStation: { kind: "ok", value: { name: "Expo Station", nameEs: "Estación Expo" } } });
    // PR 5 group 13's payload on the loader's output.
    const p = smmPlanOf(input.facts);
    expect(Object.keys(p).sort()).toEqual(["closingDestId", "kind", "notes", "planDate", "station", "tasks"]);
    expect(p.tasks === "unavailable" ? [] : p.tasks.map((t) => [t.task, t.state])).toEqual([["opening_report", "done"], ["mid_day_prep", "in_progress"], ["am_prep", "not_started"]]);
    expect(p.notes).toEqual([]);
  });

  it("failures are failed, never empty or null; nothing assigned is ok([]); no station is ok(null); a closed station's release resolves", async () => {
    const tasksDown = await loadDayFacts(NO_CLIENT, args(SMM), smmDeps({ ownTasks: async () => { throw new Error("x"); } }).deps);
    expect(tasksDown.facts).toMatchObject({ ownTasks: { kind: "failed" }, ownStation: { kind: "ok" } });
    expect(smmPlanOf(tasksDown.facts).notes).toEqual(["day.fail.assignments"]);
    const stationDown = await loadDayFacts(NO_CLIENT, args(SMM), smmDeps({ stationBusinessDate: async () => { throw new Error("x"); } }).deps);
    expect(stationDown.facts).toMatchObject({ ownTasks: { kind: "ok" }, ownStation: { kind: "failed" } });
    const taskInstanceDown = await loadDayFacts(NO_CLIENT, args(SMM), smmDeps({ prepInstances: async () => { throw new Error("x"); } }).deps);
    expect(taskInstanceDown.facts).toMatchObject({ ownTasks: { kind: "failed" } });
    const none = await loadDayFacts(NO_CLIENT, args(SMM), smmDeps({ ownTasks: async () => [], ownStationEvents: async () => [] }).deps);
    expect(none.facts).toEqual({ kind: "smm", ownTasks: { kind: "ok", value: [] }, ownStation: { kind: "ok", value: null } });
    const lookups: unknown[] = [];
    const released = await loadDayFacts(NO_CLIENT, args(SMM), smmDeps({
      ownStationEvents: async () => [ev("1", { userId: SMM.userId, stationId: "expo" }), ev("2", { userId: SMM.userId, kind: "release", releaseReason: "station_closed", priorPositionId: "expo-p" })],
      stationWithPositions: async (_sb, a) => { lookups.push(a); return expo; },
    }).deps);
    expect(lookups).toEqual([{ shopId: SHOP.id, positionId: "expo-p" }]);
    expect(released.facts).toMatchObject({ ownStation: { kind: "ok", value: { name: "Expo Station" } } });
    const notFloor = await loadDayFacts(NO_CLIENT, args(SMM), smmDeps({ stationWithPositions: async () => ({ ...expo, staffed: false }) }).deps);
    expect(notFloor.facts).toMatchObject({ ownStation: { kind: "ok", value: null } });
  });

  it("ruling B6: the path calls neither booked-catering reader; the recording client sees only the allowlist, each filter on the person", async () => {
    const now = new Date(); // loadOwnTaskAssignments binds the server's today
    const date = operationalNow(now).date;
    const f = fakeSupabase((c: FakeCall) => {
      if (c.table === "users") return { data: { role: "social_media_mgr" } };
      if (c.table === "user_locations") return { data: { user_id: SMM.userId } };
      if (c.table === "report_assignments") return { data: [{ id: "a", report_type: "opening_report", assignee_id: SMM.userId, assigner_id: "g", note: null }] };
      if (c.table === "checklist_templates") return { data: [{ id: "tpl" }] };
      if (c.table === "checklist_instances") return { data: [] };
      if (c.table === "station_events") return { data: [{ id: "e", sequence: "1", location_id: SHOP.id, business_date: date, user_id: SMM.userId, station_id: "expo", kind: "claim", at: "x", source: "claimed" }] };
      if (c.table === "stations") return { data: { id: "expo", name: "Expo Station", name_es: null, sort: 1, active: true, staffed: true } };
      if (c.table === "station_positions") return { data: [{ id: "p", active: true }] };
      return { data: [] };
    }, () => ({ data: date }));
    const input = await loadDayFacts(f.client as never, { ...args(SMM), now, board: vi.fn() }, defaultDayFactDeps);
    expect(input.facts).toMatchObject({ kind: "smm", ownTasks: { kind: "ok", value: [{ task: "opening_report", status: "not_started" }] }, ownStation: { kind: "ok", value: { name: "Expo Station" } } });
    expect(loadBookedCateringEvents).not.toHaveBeenCalled();
    expect(loadEzcater).not.toHaveBeenCalled();
    const ALLOW = new Set(["users", "user_locations", "report_assignments", "checklist_templates", "checklist_instances", "station_events", "stations", "station_positions"]);
    for (const c of f.calls) expect(ALLOW.has(c.table), c.table).toBe(true);
    for (const t of ["catering_pipeline", "catering_quotes", "ezcater_orders", "vendors", "purchase_orders", "catering_prep_demand", "schedule_structures"]) {
      expect(f.calls.some((c) => c.table === t), t).toBe(false);
    }
    expect(f.rpcs.map((r) => r.name)).toEqual(["station_business_date"]);
    // Each person-scoped read filters on the person; the station reads on their own station.
    const on = (table: string) => f.calls.filter((c) => c.table === table);
    expect(on("users").every((c) => c.has("eq", "id", SMM.userId))).toBe(true);
    expect(on("user_locations").every((c) => c.has("eq", "user_id", SMM.userId))).toBe(true);
    expect(on("report_assignments").every((c) => c.has("eq", "assignee_id", SMM.userId))).toBe(true);
    expect(on("station_events").every((c) => c.has("eq", "user_id", SMM.userId))).toBe(true);
    expect(on("stations").every((c) => c.has("eq", "id", "expo"))).toBe(true);
    expect(on("station_positions").every((c) => c.has("eq", "station_id", "expo"))).toBe(true);
  });

  it("source order: in loadDayFacts the lensFor branch is the first statement after operationalNow", () => {
    const src = stripComments(readFileSync("lib/day-plan.ts", "utf8"));
    const body = src.slice(src.indexOf("export async function loadDayFacts("));
    const lines = body.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
    expect(lines[0]).toMatch(/^const \{ date: planDate, minutesOfDay: nowMin \} = operationalNow\(args\.now\);$/);
    expect(lines[1]).toMatch(/^if \(lensFor\(args\.viewer\.role\) === "smm"\) return /);
  });
});
