/**
 * Nav PR 6 (plan r3, 8.1): the day loader. This file starts with the PURE companion (lib/day-plan-load-shared.ts):
 * the mappers, the B1 rule in code, the effective template pick, the sections-left count, which facts a viewer needs,
 * and the social media manager's helpers. The composition (lib/day-plan.ts) follows below.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShiftBoard, Station, StationEvent, TaskAssignment } from "@/lib/assignments-shared";
import { DAY_FACT_DEADLINE_MS, DAY_OPEN_ORDER, defaultDayFactDeps, loadDayFacts, type DayFactDeps, type DayFactsArgs } from "@/lib/day-plan";
import { planDay, type DayPlan, type DayPlanInput, type ShopFacts } from "@/lib/day-plan-shared";
import {
  cashDay, cateringOrders, checklistDay, dayAssignments, dayPrepStarts, dayStations, factsNeeded, firstName, midDayDay, notPhaseSections, outTimes,
  pickEffectiveClosingTemplate, pmDay, sectionsLeft, shopHoursFrom, smmChecklistTasks, smmStationRef, smmTaskState,
} from "@/lib/day-plan-load-shared";
import { etWallQ, eventQFromWindow, ezcaterCancelled } from "@/lib/scheduling/inputs-shared";
import { SCHEDULE_STRUCTURE_DEFAULTS } from "@/lib/scheduling/structure-shared";
import { ALL_VIEWERS, ANA } from "./fixtures/day-plan/build";
import { args, at, board, ev, MID_DAY, NO_CLIENT, okDeps, OPENING, PLAN, SHOP, STATIONS, TOMORROW, withDeps, YESTERDAY } from "./fixtures/day-plan/loader-deps";
import { stripComments } from "./fixtures/schedule/no-notify-closure";
import { fakeSupabase } from "./helpers/fake-supabase";

const shop = (input: DayPlanInput): ShopFacts => {
  if (input.facts.kind !== "shop") throw new Error("shop facts expected");
  return input.facts;
};

const RULES = { eventQFromWindow, etWallQ, ezcaterCancelled };
const pos = (stationId: string, active = true) => ({ id: `${stationId}-p`, stationId, name: "Spot", nameEs: null, duty: null, dutyEs: null, sort: 1, active });
const st = (id: string, name: string, p: Partial<Station> = {}): Station =>
  ({ id, name, nameEs: null, sort: 1, active: true, staffed: true, positions: [pos(id)], usuallyClosesAt: null, closedAt: null, ...p });

describe("pure companion: names and the shop day", () => {
  it("firstName is the board's rule; no name is null", () => {
    expect(firstName("  Ana  María Ruiz ")).toBe("Ana");
    expect(firstName(null)).toBeNull();
    expect(firstName("   ")).toBeNull();
  });

  it("hours: the structure's values (the base read; the per-date starts are the schedule read's, SCH 22.3); a non-finite value throws", () => {
    const saved = shopHoursFrom({ structure: { ...SCHEDULE_STRUCTURE_DEFAULTS, shopDay: { ...SCHEDULE_STRUCTURE_DEFAULTS.shopDay, prepStartQ: 26 } }, source: "saved" });
    expect(saved).toMatchObject({ source: "saved", shopDay: { prepStartQ: 26 } });
    expect(saved).not.toHaveProperty("dayPrepStartQ");
    const defaults = shopHoursFrom({ structure: SCHEDULE_STRUCTURE_DEFAULTS, source: "defaults" });
    expect(defaults.shopDay.prepStartQ).toBe(SCHEDULE_STRUCTURE_DEFAULTS.shopDay.prepStartQ);
    expect(() => shopHoursFrom({ structure: { ...SCHEDULE_STRUCTURE_DEFAULTS, shopDay: { ...SCHEDULE_STRUCTURE_DEFAULTS.shopDay, serviceStartQ: Number.NaN } }, source: "saved" })).toThrow();
  });
});

describe("pure companion: the B1 rule and the effective template", () => {
  it("the effective closing template: active, effective on the date, newest effective_from (nulls last), then newest created_at", () => {
    const t = (id: string, effective_from: string | null, created_at: string, active = true) => ({ id, effective_from, created_at, active });
    expect(pickEffectiveClosingTemplate([t("a", null, "2026-03-01"), t("b", "2026-11-01", "2026-01-01"), t("c", "2026-12-01", "2026-12-01")], "2026-11-18")).toBe("b");
    expect(pickEffectiveClosingTemplate([t("a", null, "2026-03-01"), t("b", null, "2026-05-01"), t("x", null, "2026-09-01", false)], "2026-11-18")).toBe("b");
    expect(pickEffectiveClosingTemplate([t("a", "2026-11-18", "2026-01-01"), t("b", "2026-11-18", "2026-02-01")], "2026-11-18")).toBe("b");
    expect(pickEffectiveClosingTemplate([{ ...t("p", null, "2026-01-01"), type: "prep" }], "2026-11-18")).toBeNull();
    expect(pickEffectiveClosingTemplate([], "2026-11-18")).toBeNull();
  });

  it("notPhaseSections: at least one ACTIVE report reference (live Closing Manager: 5 of 7); names trimmed", () => {
    const cm = ["opening_report", "am_prep", "mid_day_prep", "cash_report", "pm_report", null, null]
      .map((ref) => ({ station: "Closing Manager", active: true, report_reference_type: ref }));
    const items = [...cm,
      { station: "Expo Station", active: true, report_reference_type: null },
      { station: "Dish", active: false, report_reference_type: "pm_report" },
      { station: "  Prep Fridge ", active: true, report_reference_type: "am_prep" },
      { station: null, active: true, report_reference_type: "am_prep" },
    ];
    expect(notPhaseSections(items)).toEqual(new Set(["Closing Manager", "Prep Fridge"]));
  });

  it("dayStations: installed, the column decides (even over references); not installed, the code rule; data, not name", () => {
    const board = [st("cm", "Closing Manager", { usuallyClosesAt: "14:00:00" }), st("crunchy", "Crunchy Boi Station"), st("other", "Expo Station"),
      st("fridge", "Prep Fridge", { staffed: false }), st("gone", "Gone", { active: false })];
    const installed = dayStations(board, { installed: true, midDayStationId: "crunchy", notPhaseIds: new Set(["other"]) }, { installed: true, ids: new Set(["other"]) });
    expect(installed.map((s) => [s.id, s.floor, s.startsMidDay])).toEqual([["cm", true, false], ["crunchy", true, true], ["other", false, false], ["fridge", false, false]]);
    expect(installed[0]!.usuallyClosesAt).toBe("14:00:00");
    const fallback = dayStations(board, { installed: false }, { installed: false, sections: new Set(["Closing Manager"]) });
    expect(fallback.map((s) => [s.id, s.floor, s.startsMidDay])).toEqual([["cm", false, false], ["crunchy", true, false], ["other", true, false], ["fridge", false, false]]);
    // A station named Closing Manager with no reference stays floor; another name with one leaves it.
    const byData = dayStations(board, { installed: false }, { installed: false, sections: new Set(["Crunchy Boi Station"]) });
    expect(byData.find((s) => s.id === "cm")!.floor).toBe(true);
    expect(byData.find((s) => s.id === "crunchy")!.floor).toBe(false);
  });

  it("sectionsLeft: active items by trimmed station; a blank station is one section; any item without a live completion leaves its section", () => {
    const items = [
      { id: "1", station: "Expo", active: true }, { id: "2", station: " Expo ", active: true },
      { id: "3", station: "Dish", active: true }, { id: "4", station: null, active: true }, { id: "5", station: "", active: true },
      { id: "6", station: "Gone", active: false },
    ];
    expect(sectionsLeft(items, new Set())).toBe(3);
    expect(sectionsLeft(items, new Set(["1"]))).toBe(3);
    expect(sectionsLeft(items, new Set(["1", "2", "4"]))).toBe(2);
    expect(sectionsLeft(items, new Set(["1", "2", "3", "4", "5"]))).toBe(0);
  });
});

describe("pure companion: checklists, reports, catering", () => {
  const names = new Map([["u-ana", "Ana Ruiz"], ["u-mia", "Mia Lopez"]]);
  it("checklistDay and midDayDay: status, finish, the first name; no instance = status null", () => {
    expect(checklistDay("2026-11-18", null)).toEqual({ forDate: "2026-11-18", status: null, phase1At: null, finishedAt: null, finishedByName: null, sectionsLeft: null });
    expect(checklistDay("2026-11-18", { id: "i", template_id: "t", status: "confirmed", created_at: null, confirmed_at: "x", confirmed_by: "u-ana" }, { finishedByName: "Ana", sectionsLeft: 0, phase1At: "p" }))
      .toEqual({ forDate: "2026-11-18", status: "confirmed", phase1At: "p", finishedAt: "x", finishedByName: "Ana", sectionsLeft: 0 });
    expect(midDayDay("d", [{ id: "i", template_id: "t", status: "confirmed", created_at: null, confirmed_at: "x", confirmed_by: "u-mia" }], names).instances)
      .toEqual([{ status: "confirmed", finishedAt: "x", finishedByName: "Mia" }]);
  });

  it("reports (ruling 7): open → draft; submitted / incomplete_confirmed → submitted; auto_finalized → submitted + autoFinalized; cash never sets it", () => {
    const pm = (status: string) => pmDay("d", { status, submitted_at: "t", submitted_by: "u-ana" }, names);
    expect(pm("open")).toEqual({ forDate: "d", state: "draft", at: null, byName: null });
    expect(pm("submitted")).toEqual({ forDate: "d", state: "submitted", at: "t", byName: "Ana" });
    expect(pm("incomplete_confirmed")).toEqual({ forDate: "d", state: "submitted", at: "t", byName: "Ana" });
    expect(pm("auto_finalized")).toEqual({ forDate: "d", state: "submitted", at: "t", byName: "Ana", autoFinalized: true });
    expect(() => pm("weird")).toThrow();
    expect(pmDay("d", null, names)).toEqual({ forDate: "d", state: "none", at: null, byName: null });
    expect(cashDay("d", { signed_at: "s", signed_by: "u-mia" }, names)).toEqual({ forDate: "d", state: "submitted", at: "s", byName: "Mia" });
    expect(cashDay("d", null, names)).toEqual({ forDate: "d", state: "none", at: null, byName: null });
  });

  it("catering: pipeline stages → states, ezCater cancelled / not tracked, the event quarter, out times; no name or money field", () => {
    const booked = [
      { id: "p1", eventDate: "2026-11-18", timeWindow: "11:30 AM–1 PM", headcount: 40, stage: "confirmed" },
      { id: "p2", eventDate: "2026-11-18", timeWindow: null, headcount: null, stage: "out" },
      { id: "p3", eventDate: "2026-11-18", timeWindow: "12pm", headcount: 10, stage: "completed" },
      { id: "p4", eventDate: "2026-11-19", timeWindow: "9am", headcount: 5, stage: "confirmed" },
    ];
    const ez = [
      { id: "e1", event_date: "2026-11-18", event_timestamp: "2026-11-18T17:00:00Z", handoff_time: "x", headcount: 20, status: "Cancelled" },
      { id: "e2", event_date: "2026-11-18", event_timestamp: null, handoff_time: "1:15 PM", headcount: 8, status: "Confirmed" },
    ];
    const out = outTimes([
      { pipeline_id: "p2", to_stage: "out", created_at: "2026-11-18T16:00:00Z" }, { pipeline_id: "p2", to_stage: "out", created_at: "2026-11-18T16:30:00Z" },
      { pipeline_id: "p3", to_stage: "completed", created_at: "2026-11-18T18:00:00Z" },
    ]);
    const today = cateringOrders("2026-11-18", booked, ez, out, RULES);
    expect(today).toEqual([
      { id: "p1", source: "pipeline", eventQ: 46, headcount: 40, state: "to_go_out", outAt: null },
      { id: "p2", source: "pipeline", eventQ: null, headcount: null, state: "out", outAt: "2026-11-18T16:30:00Z" },
      { id: "p3", source: "pipeline", eventQ: 48, headcount: 10, state: "completed", outAt: "2026-11-18T18:00:00Z" },
      { id: "e1", source: "ezcater", eventQ: 48, headcount: 20, state: "cancelled", outAt: null },
      { id: "e2", source: "ezcater", eventQ: 53, headcount: 8, state: "not_tracked", outAt: null },
    ]);
    expect(cateringOrders("2026-11-19", booked, ez, out, RULES).map((o) => o.id)).toEqual(["p4"]);
  });

  it("assignments from the board: first names, availability, source", () => {
    const tasks: TaskAssignment[] = [
      { id: "a", task: "am_prep", assigneeId: "u", assignerId: "g", assignerName: null, note: null, assigneeName: "Luis Diaz", source: "assigned" },
      { id: "b", task: "counts", assigneeId: "v", assignerId: "v", assignerName: null, note: null, available: false, source: "taken" },
    ];
    expect(dayAssignments(tasks)).toEqual([
      { id: "a", task: "am_prep", assigneeId: "u", firstName: "Luis", available: true, source: "assigned" },
      { id: "b", task: "counts", assigneeId: "v", firstName: null, available: false, source: "taken" },
    ]);
  });
});

describe("pure companion: which facts a viewer needs (section 6)", () => {
  it("ops facts need ops AND level 4+; flagged lines need catering; board facts need ops", () => {
    const got = Object.fromEntries(Object.entries(ALL_VIEWERS).map(([k, v]) => [k, factsNeeded(v)]));
    expect(got.ANA).toEqual({ ops: true, flaggedLines: true, board: true, skipped: [] });
    expect(got.LUIS).toEqual({ ops: false, flaggedLines: true, board: true, skipped: ["cash", "pm", "ordering", "rhythm", "receiving"] });
    expect(got.CATERING_NON_MEMBER).toEqual({ ops: false, flaggedLines: true, board: false, skipped: ["cash", "pm", "ordering", "rhythm", "receiving"] });
    expect(factsNeeded({ level: 7, surfaces: new Set(["tasks", "ops"]) })).toEqual({ ops: true, flaggedLines: false, board: true, skipped: ["flaggedLines"] });
  });
});

describe("pure companion: the social media manager", () => {
  it("task state from the day's instance statuses; only the checklist tasks", () => {
    expect(smmTaskState([])).toBe("not_started");
    expect(smmTaskState([null])).toBe("not_started");
    expect(smmTaskState(["open"])).toBe("in_progress");
    expect(smmTaskState(["open", "confirmed"])).toBe("done");
    expect(smmTaskState(["auto_finalized"])).toBe("done");
    const all = (["am_prep", "mid_day_prep", "cash_report", "opening_report", "receiving", "counts", "ordering", "pm_report"] as const)
      .map((task, i): TaskAssignment => ({ id: `t${i}`, task, assigneeId: "s", assignerId: "g", assignerName: null, note: null }));
    expect(smmChecklistTasks(all).sort()).toEqual(["am_prep", "mid_day_prep", "opening_report"]);
  });

  it("own station: the head's station; after a station_closed release the prior position; else none", () => {
    const ev = (sequence: string, p: Partial<StationEvent>): StationEvent => ({ id: sequence, sequence, locationId: "l", businessDate: "d", userId: "s", stationId: null,
      kind: "claim", actorId: null, actorName: null, at: "x", source: null, ...p });
    expect(smmStationRef([ev("1", { stationId: "a" }), ev("2", { stationId: "b", kind: "move" })], "s")).toEqual({ stationId: "b" });
    expect(smmStationRef([ev("9", { stationId: "a" }), ev("10", { kind: "release", releaseReason: "station_closed", priorPositionId: "p" })], "s")).toEqual({ priorPositionId: "p" });
    expect(smmStationRef([ev("1", { stationId: "a" }), ev("2", { kind: "release", releaseReason: "clocked_out", priorPositionId: "p" })], "s")).toBeNull();
    expect(smmStationRef([], "s")).toBeNull();
  });
});

// ══ The composition: lib/day-plan.ts loadDayFacts ══════════════════════════════════════════════════════════════════════

describe("loadDayFacts: the all-ok baseline", () => {
  it("fills every fact, each with the date its read used (C5)", async () => {
    const input = await loadDayFacts(NO_CLIENT, args(ANA), okDeps());
    expect(input.planDate).toBe(PLAN);
    expect(input.nowMin).toBe(13 * 60 + 45);
    const f = shop(input);
    expect(f.hours).toMatchObject({ kind: "ok", value: { shopDay: { prepStartQ: 28 }, dayPrepStartQ: {} } });
    expect(f.closing).toEqual({ kind: "ok", value: { forDate: PLAN, status: "open", phase1At: null, finishedAt: null, finishedByName: null, sectionsLeft: 3 } });
    expect(f.opening).toEqual({ kind: "ok", value: { forDate: PLAN, status: "confirmed", phase1At: "2026-11-18T12:40:00.000Z", finishedAt: OPENING.confirmed_at, finishedByName: "Ana", sectionsLeft: null } });
    expect(f.yesterdayClosing).toMatchObject({ kind: "ok", value: { forDate: YESTERDAY, status: "confirmed", finishedByName: "Mia" } });
    expect(f.midDay).toEqual({ kind: "ok", value: { forDate: PLAN, instances: [{ status: "confirmed", finishedAt: MID_DAY[0]!.confirmed_at, finishedByName: "Luis" }] } });
    expect(f.pm).toEqual({ kind: "ok", value: { forDate: PLAN, state: "draft", at: null, byName: null } });
    expect(f.cateringToday).toMatchObject({ kind: "ok", value: { forDate: PLAN, orders: [{ id: "lead-1", state: "out", outAt: "2026-11-18T16:20:00.000Z" }, { id: "ez-1", state: "cancelled" }] } });
    expect(f.cateringTomorrow).toMatchObject({ kind: "ok", value: { forDate: TOMORROW, orders: [{ id: "lead-2", state: "to_go_out" }] } });
    expect(f.flaggedLines).toEqual({ kind: "ok", value: { today: 2, tomorrow: 1 } });
    expect(f.assignments).toMatchObject({ kind: "ok", value: { forDate: PLAN, scope: "all_tasks" } });
    expect(f.myStation).toEqual({ kind: "ok", value: { stationId: "crunchy" } });
    expect(f.counts).toEqual({ kind: "ok", value: { inProgress: false } });
    expect(f.holdsStationOnStationDay).toBe(true);
    expect(f.ordering).toMatchObject({ kind: "ok", value: { forDate: PLAN } });
    expect(f.receiving).toMatchObject({ kind: "ok", value: { forDate: PLAN, openOrders: [{ id: "po-1", totalCents: null, unpricedLines: 0, placedByName: null }] } });
    // Stations: active rows only; Closing Manager off the floor by the code rule (not installed); the raw usual time.
    expect(f.stations).toEqual({ kind: "ok", value: { stationDate: PLAN, stations: [
      { id: "crunchy", name: "Crunchy Boi Station", nameEs: "Crunchy Boi Station ES", sort: 1, floor: true, startsMidDay: false, usuallyClosesAt: "14:00:00", closedAt: null },
      { id: "expo", name: "Expo Station", nameEs: "Expo Station ES", sort: 2, floor: true, startsMidDay: false, usuallyClosesAt: null, closedAt: "2026-11-18T18:30:00.000Z" },
      { id: "fridge", name: "Prep Fridge", nameEs: "Prep Fridge ES", sort: 3, floor: false, startsMidDay: false, usuallyClosesAt: null, closedAt: null },
      { id: "cm", name: "Closing Manager", nameEs: "Closing Manager ES", sort: 4, floor: false, startsMidDay: false, usuallyClosesAt: null, closedAt: null },
    ] } });
  });

  it("C5: every day-keyed fact carries the date its read was called with", async () => {
    const seen: Array<[string, string]> = [];
    const deps = withDeps({
      dayInstance: async (sb, a) => { seen.push([a.type, a.date]); return okDeps().dayInstance(sb, a); },
      prepInstances: async (sb, a) => { seen.push([a.subtype, a.date]); return okDeps().prepInstances(sb, a); },
      cashReport: async (_sb, _s, date) => { seen.push(["cash", date]); return null; },
      pmReport: async (_sb, _s, date) => { seen.push(["pm", date]); return null; },
      booked: async (sb, s, dates) => { seen.push(["booked", dates.join(",")]); return okDeps().booked(sb, s, dates); },
    });
    const f = shop(await loadDayFacts(NO_CLIENT, args(ANA), deps));
    expect(seen).toEqual(expect.arrayContaining([["closing", PLAN], ["opening", PLAN], ["closing", YESTERDAY], ["am_prep", PLAN], ["mid_day_prep", PLAN],
      ["cash", PLAN], ["pm", PLAN], ["booked", `${PLAN},${TOMORROW}`]]));
    const forDate = (x: unknown) => (x as { value?: { forDate?: string } }).value?.forDate;
    expect([f.closing, f.opening, f.amPrep, f.midDay, f.cash, f.pm, f.ordering, f.receiving, f.cateringToday].map(forDate)).toEqual(Array(9).fill(PLAN));
    expect(forDate(f.yesterdayClosing)).toBe(YESTERDAY);
    expect(forDate(f.cateringTomorrow)).toBe(TOMORROW);
  });
});

/** Every Fact field the loader fills (assignments / stations / myStation included). */
const FIELDS = ["hours", "stations", "opening", "closing", "amPrep", "midDay", "cash", "pm", "ordering", "rhythm", "receiving",
  "cateringToday", "cateringTomorrow", "flaggedLines", "assignments", "myStation", "counts", "yesterdayClosing"] as const;
const boom = async (): Promise<never> => { throw new Error("read failed"); };
const never = (): Promise<never> => new Promise<never>(() => undefined);

describe("loadDayFacts: each source failing alone fails exactly its facts (8.1 item 1)", () => {
  type Case = [string, Partial<DayFactDeps> | ((a: DayFactsArgs) => DayFactsArgs), readonly (typeof FIELDS)[number][]];
  const failInstance = (type: "opening" | "closing", date: string): Partial<DayFactDeps> =>
    ({ dayInstance: async (sb, a) => (a.type === type && a.date === date ? boom() : okDeps().dayInstance(sb, a)) });
  const failPrep = (subtype: string): Partial<DayFactDeps> =>
    ({ prepInstances: async (sb, a) => (a.subtype === subtype ? boom() : okDeps().prepInstances(sb, a)) });
  const CASES: Case[] = [
    ["H1", { shopDay: boom }, ["hours"]],
    ["S1 (the board)", (a) => ({ ...a, board: boom }), ["stations", "assignments", "myStation"]],
    ["S2", { stationFlags: boom }, ["stations"]],
    ["S3a", { closingClassification: boom }, ["stations"]],
    ["K1", failInstance("closing", PLAN), ["closing"]],
    ["K3", failInstance("opening", PLAN), ["opening"]],
    ["K5", failInstance("closing", YESTERDAY), ["yesterdayClosing"]],
    ["K6", failPrep("am_prep"), ["amPrep"]],
    ["K7", failPrep("mid_day_prep"), ["midDay"]],
    ["P1", { cashReport: boom }, ["cash"]],
    ["P2", { pmReport: boom }, ["pm"]],
    ["O1", { vendors: boom }, ["ordering", "receiving"]],
    ["O2", { cutoffs: boom }, ["ordering"]],
    ["O3", { recentPos: boom }, ["ordering"]],
    ["Y1", { rhythm: boom }, ["rhythm"]],
    ["R1", { halfLogged: boom }, ["receiving"]],
    ["R2", { openOrders: boom }, ["receiving"]],
    ["R3", { completedOn: boom }, ["receiving"]],
    ["C1", { booked: boom }, ["cateringToday", "cateringTomorrow"]],
    ["C2", { ezcater: boom }, ["cateringToday", "cateringTomorrow"]],
    ["F1", { flaggedLines: boom }, ["flaggedLines"]],
  ];
  it.each(CASES)("%s", async (_name, change, failedFields) => {
    const base = shop(await loadDayFacts(NO_CLIENT, args(ANA), okDeps()));
    const a = typeof change === "function" ? change(args(ANA)) : args(ANA);
    const deps = typeof change === "function" ? okDeps() : withDeps(change);
    const got = shop(await loadDayFacts(NO_CLIENT, a, deps));
    for (const field of FIELDS) {
      if (failedFields.includes(field)) expect(got[field], field).toEqual({ kind: "failed" });
      else expect(got[field], field).toEqual(base[field]);
    }
    if (failedFields.includes("myStation")) expect(got.holdsStationOnStationDay).toBe(false);
    else expect(got.holdsStationOnStationDay).toBe(base.holdsStationOnStationDay);
  });

  const DEGRADES: Array<[string, Partial<DayFactDeps>, (f: ShopFacts) => void]> = [
    ["K2", { completedItems: boom }, (f) => expect(f.closing).toMatchObject({ kind: "ok", value: { status: "open", sectionsLeft: null } })],
    ["S3b", { templateItems: boom }, (f) => { expect(f.closing).toMatchObject({ kind: "ok", value: { sectionsLeft: null } }); expect(f.stations.kind).toBe("ok"); }],
    ["K4", { phase1At: boom }, (f) => expect(f.opening).toMatchObject({ kind: "ok", value: { status: "confirmed", phase1At: null, finishedByName: "Ana" } })],
    ["K8", { userNames: boom }, (f) => {
      expect(f.opening).toMatchObject({ kind: "ok", value: { finishedByName: null } });
      expect(f.midDay).toMatchObject({ kind: "ok", value: { instances: [{ finishedByName: null }] } });
    }],
    ["C3", { outEvents: boom }, (f) => expect(f.cateringToday).toMatchObject({ kind: "ok", value: { orders: [{ id: "lead-1", state: "out", outAt: null }, { id: "ez-1" }] } })],
  ];
  it.each(DEGRADES)("degrades %s: every fact stays ok, only its field blanks", async (_name, change, check) => {
    const f = shop(await loadDayFacts(NO_CLIENT, args(ANA), withDeps(change)));
    for (const field of FIELDS) expect(f[field].kind, field).not.toBe("failed");
    check(f);
  });
});

describe("loadDayFacts: the deadline race (ruling B2; 8.1 items 1 and 12)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const run = async (a: DayFactsArgs, deps: DayFactDeps) => {
    let done = false;
    const p = loadDayFacts(NO_CLIENT, a, deps).then((r) => { done = true; return r; });
    await vi.advanceTimersByTimeAsync(DAY_FACT_DEADLINE_MS - 1);
    const before = done;
    await vi.advanceTimersByTimeAsync(1);
    return { before, input: await p };
  };

  it("(a) a board that never settles: the three board facts fail at 6 s, the rest resolve, the board is never aborted", async () => {
    let resolvePage: (b: ShiftBoard) => void = () => undefined;
    const pageBoard = new Promise<ShiftBoard>((r) => { resolvePage = r; });
    const boardFn = vi.fn((...seen: unknown[]) => { void seen; return pageBoard; });
    const { before, input } = await run(args(ANA, { board: boardFn }), okDeps());
    expect(before).toBe(false);
    const f = shop(input);
    expect([f.stations, f.assignments, f.myStation]).toEqual([{ kind: "failed" }, { kind: "failed" }, { kind: "failed" }]);
    expect(f.holdsStationOnStationDay).toBe(false);
    expect(f.closing.kind).toBe("ok");
    expect(f.hours.kind).toBe("ok");
    expect(boardFn).toHaveBeenCalledTimes(1);
    expect(boardFn.mock.calls[0]).toEqual([]); // no signal is ever handed to the page's promise
    resolvePage(board());
    await expect(pageBoard).resolves.toMatchObject({ stationDate: PLAN }); // the page can still await it
  });

  it("(b) a dependency that ignores the abort signal and answers at 9 s: its fact fails at 6 s, the late answer is discarded", async () => {
    const late = withDeps({ flaggedLines: () => new Promise((r) => { setTimeout(() => r({ [PLAN]: 99 }), 9_000); }) });
    const { before, input } = await run(args(ANA), late);
    expect(before).toBe(false);
    expect(shop(input).flaggedLines).toEqual({ kind: "failed" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(shop(input).flaggedLines).toEqual({ kind: "failed" });
  });

  it("(c) three sequential pages of 2.5 s each (7.5 s): the fact fails at 6 s though no single read passed the abort", async () => {
    const page = () => new Promise<void>((r) => { setTimeout(r, 2_500); });
    const deps = withDeps({ halfLogged: async () => { await page(); await page(); await page(); return []; } });
    const { input } = await run(args(ANA), deps);
    expect(shop(input).receiving).toEqual({ kind: "failed" });
    expect(shop(input).ordering.kind).toBe("ok");
  });

  it("a dependency that hangs fails its fact alone; (d) no timer is left once the lanes settle", async () => {
    const hung = shop((await run(args(ANA), withDeps({ shopDay: never }))).input);
    expect(hung.hours).toEqual({ kind: "failed" });
    expect(hung.closing.kind).toBe("ok");
    vi.clearAllTimers();
    const quick = loadDayFacts(NO_CLIENT, args(ANA), okDeps());
    await vi.advanceTimersByTimeAsync(0);
    await quick;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the deadline aborts the lanes' query signal", async () => {
    let signal: AbortSignal | undefined;
    const builder = { abortSignal: (s: AbortSignal) => { signal = s; return builder; }, then: (res: (v: unknown) => unknown) => never().then(res) };
    const client = { from: () => ({ select: () => builder }) };
    const deps = withDeps({ shopDay: async (sb) => { await (sb as unknown as typeof client).from().select(); return never(); } });
    const p = loadDayFacts(client as never, args(ANA), deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(DAY_FACT_DEADLINE_MS);
    await p;
    expect(signal?.aborted).toBe(true);
  });
});

describe("loadDayFacts: the clock, the board, the raw time, another day (C2, C3, C4)", () => {
  it("C2: one operationalNow, no clock read in lib/day-plan.ts; a fixed now gives the exact plan date and minutes", async () => {
    const code = stripComments(readFileSync("lib/day-plan.ts", "utf8"));
    expect(code.match(/operationalNow\(/g)).toHaveLength(1);
    expect(code).not.toMatch(/new Date\(|Date\.now\(/);
    const input = await loadDayFacts(NO_CLIENT, args(ANA, { now: at("00:30", "2026-11-19") }), okDeps());
    expect([input.planDate, input.nowMin]).toEqual(["2026-11-19", 30]);
  });

  it("C3: a release-shaped board (station_closed, priorPositionId) gives the card's station, not null", async () => {
    const released = board({ events: [ev("1", { stationId: "crunchy", positionId: "crunchy-p" }),
      ev("2", { kind: "release", stationId: null, releaseReason: "station_closed", priorPositionId: "crunchy-p" })],
      stations: STATIONS.map((s) => (s.id === "crunchy" ? { ...s, closedAt: "2026-11-18T19:00:00.000Z" } : s)) });
    const f = shop(await loadDayFacts(NO_CLIENT, args(ANA, { board: async () => released }), okDeps()));
    expect(f.myStation).toEqual({ kind: "ok", value: { stationId: "crunchy" } });
    expect(f.holdsStationOnStationDay).toBe(false);
  });

  it("C4: usuallyClosesAt in raw, out raw; the only mention in the loader is the copy; no cutoffMinutes", async () => {
    const f = shop(await loadDayFacts(NO_CLIENT, args(ANA), okDeps()));
    expect(f.stations.kind === "ok" && f.stations.value.stations[0]!.usuallyClosesAt).toBe("14:00:00");
    const loader = stripComments(readFileSync("lib/day-plan.ts", "utf8"));
    const shared = stripComments(readFileSync("lib/day-plan-load-shared.ts", "utf8"));
    expect(loader).not.toContain("usuallyClosesAt");
    expect(shared.match(/usuallyClosesAt/g)).toEqual(["usuallyClosesAt", "usuallyClosesAt"]);
    expect(shared).toContain("usuallyClosesAt: s.usuallyClosesAt ?? null");
    for (const src of [loader, shared]) expect(src).not.toContain("cutoffMinutes");
  });

  it("another_day: at 00:30 ET with the board's stationDate = yesterday; every other fact on the plan date", async () => {
    const a = args(ANA, { now: at("00:30", TOMORROW), board: async () => board({ stationDate: PLAN, date: TOMORROW }) });
    const f = shop(await loadDayFacts(NO_CLIENT, a, okDeps()));
    expect(f.stations).toEqual({ kind: "another_day", stationDate: PLAN });
    expect(f.closing).toMatchObject({ kind: "ok", value: { forDate: TOMORROW } });
    expect(f.assignments).toMatchObject({ kind: "ok", value: { forDate: TOMORROW } });
    const missing = shop(await loadDayFacts(NO_CLIENT, args(ANA, { board: async () => board({ stationDate: undefined }) }), okDeps()));
    expect(missing.stations).toEqual({ kind: "failed" });
  });
});

describe("loadDayFacts: the flags and B1 (rulings 1c, B1)", () => {
  it("installed: the column decides (not_phase true → off the floor; false → isFloorStation even with references); S3a never issued", async () => {
    const classification = vi.fn(okDeps().closingClassification);
    const deps = withDeps({ stationFlags: async () => ({ installed: true, midDayStationId: "expo", notPhaseIds: new Set(["crunchy"]) }), closingClassification: classification });
    const f = shop(await loadDayFacts(NO_CLIENT, args(ANA), deps));
    const rows = f.stations.kind === "ok" ? f.stations.value.stations : [];
    expect(rows.map((s) => [s.id, s.floor, s.startsMidDay])).toEqual([["crunchy", false, false], ["expo", true, true], ["fridge", false, false], ["cm", true, false]]);
    expect(classification).not.toHaveBeenCalled();
  });

  it("not installed: planDay picks the earliest-usual-time trigger (the engine's default)", async () => {
    const open = board({ stations: STATIONS.map((s) => ({ ...s, closedAt: null })) });
    const p = planDay(await loadDayFacts(NO_CLIENT, args(ANA, { now: at("14:05"), board: async () => open }), okDeps())) as DayPlan;
    expect(p.phase).toMatchObject({ id: "midday", decidedBy: "clock" });
    expect(p.phase.since?.params.station).toMatchObject({ en: "Crunchy Boi Station" });
  });

  it("an inactive marked station is not sent; not installed: every startsMidDay false and the code rule decides", async () => {
    const marked = shop(await loadDayFacts(NO_CLIENT, args(ANA), withDeps({ stationFlags: async () => ({ installed: true, midDayStationId: "gone", notPhaseIds: new Set<string>() }) })));
    expect(marked.stations.kind === "ok" && marked.stations.value.stations.some((s) => s.id === "gone" || s.startsMidDay)).toBe(false);
    const fallback = shop(await loadDayFacts(NO_CLIENT, args(ANA), okDeps()));
    expect(fallback.stations.kind === "ok" && fallback.stations.value.stations.filter((s) => s.startsMidDay)).toEqual([]);
  });
});

describe("loadDayFacts: ruling 7 and SCH through the loader (8.1 items 10, 11)", () => {
  it("an auto_finalized PM report → submitted + autoFinalized, and planDay's PM item is done with autoFinalized true", async () => {
    const deps = withDeps({ pmReport: async () => ({ status: "auto_finalized", submitted_at: "2026-11-19T03:00:00.000Z", submitted_by: null }),
      cashReport: async () => ({ signed_at: "2026-11-19T02:00:00.000Z", signed_by: "u-ana" }) });
    const input = await loadDayFacts(NO_CLIENT, args(ANA, { now: at("22:30") }), deps);
    expect(shop(input).pm).toEqual({ kind: "ok", value: { forDate: PLAN, state: "submitted", at: "2026-11-19T03:00:00.000Z", byName: null, autoFinalized: true } });
    const plan = planDay(input) as DayPlan;
    expect(plan.items.find((i) => i.id === "pm_report")?.done).toEqual({ at: "2026-11-19T03:00:00.000Z", byName: null, autoFinalized: true });
    expect(plan.items.find((i) => i.id === "cash")?.done?.autoFinalized).toBe(false);
  });

  it("hours: the shop day's prepStartQ for a saved structure and for the defaults (the real H1 read)", async () => {
    const saved = { ...SCHEDULE_STRUCTURE_DEFAULTS, shopDay: { ...SCHEDULE_STRUCTURE_DEFAULTS.shopDay, prepStartQ: 27 } };
    const savedClient = fakeSupabase((c) => (c.table === "schedule_structures" ? { data: [{ id: "s1", structure: saved, created_at: "x" }] } : { data: [] }));
    expect(await defaultDayFactDeps.shopDay(savedClient.client as never, SHOP.id)).toMatchObject({ source: "saved", shopDay: { prepStartQ: 27 } });
    const none = fakeSupabase(() => ({ data: [] }));
    expect(await defaultDayFactDeps.shopDay(none.client as never, SHOP.id)).toMatchObject({ source: "defaults", shopDay: { prepStartQ: SCHEDULE_STRUCTURE_DEFAULTS.shopDay.prepStartQ } });
  });
});

describe("loadDayFacts: everything down (ruling B5; 8.1 item 2), on the REAL loader output", () => {
  it("every dependency and the board fail: counts stays the constant ok, and planDay says day.fail.all with the fixed order", async () => {
    const all = Object.fromEntries(Object.keys(okDeps()).map((k) => [k, boom])) as unknown as DayFactDeps;
    const input = await loadDayFacts(NO_CLIENT, args(ANA, { board: boom }), all);
    const f = shop(input);
    expect(f.counts).toEqual({ kind: "ok", value: { inProgress: false } });
    for (const field of FIELDS) if (field !== "counts") expect(f[field], field).toEqual({ kind: "failed" });
    const plan = planDay(input) as DayPlan;
    expect(plan.notes.map((n) => n.reason.key)).toEqual(["day.fail.all"]);
    expect(plan.items.map((i) => i.id)).toEqual(["opening", "closing", "mid_day_prep", "catering_today", "ordering", "receiving", "am_prep", "cash", "pm_report", "counts"]);
    for (const i of plan.items) expect(i.state, i.id).toBe("unknown");
    expect(JSON.stringify(plan)).not.toMatch(/day\.reason\.(ordering|receiving|catering)\.none|day\.empty\.crew/);
  });
});

describe("loadDayFacts: source guards (8.1 item 9)", () => {
  it("lib/day-plan.ts imports server-only first; the open-order list is the digest's", () => {
    const src = readFileSync("lib/day-plan.ts", "utf8");
    expect(stripComments(src).trimStart().startsWith('import "server-only";')).toBe(true);
    expect(readFileSync("lib/report-digests-v2-shared.ts", "utf8")).toContain(`const OPEN_ORDER = new Set(${JSON.stringify([...DAY_OPEN_ORDER]).replace(/,/g, ", ")});`);
  });
  it("the engine never reads the PoFact money fields the loader fills null / 0 / null", () => {
    const engine = stripComments(readFileSync("lib/day-plan-shared.ts", "utf8"));
    for (const k of ["totalCents", "unpricedLines", "placedByName"]) expect(engine).not.toContain(k);
  });
});

// ══ PR SCH (plan r5 22.3, 23.1, 23.2; rulings D5, F3, G): the day's start, from the schedule, through the real loader ══

describe("SCH: the schedule's start per date, on the REAL loader output through buildDay (22.3)", () => {
  const WEEK_OF_PLAN = "2026-11-16";
  type Rows = Awaited<ReturnType<DayFactDeps["scheduleStarts"]>>;
  const rows = (head: string | null, days: Array<[string, string | null]>, starts: Record<string, Record<string, unknown>>): Rows =>
    ({ weeks: [{ week_start: WEEK_OF_PLAN, head_revision_id: head }], days: days.map(([d, origin]) => ({ revision_id: head ?? "none", business_date: d, origin_revision_id: origin })), starts });
  const savedAt = (q: number): Partial<DayFactDeps> => ({ shopDay: async () => ({ source: "saved", shopDay: { prepStartQ: q, serviceStartQ: 42 },
    catering: { minHeadcount: 30, leadMinutes: 210, defaultStartQ: 34, defaultEndQ: 52, extraPrepDishHeads: 1 } }) });
  const noOpening: Partial<DayFactDeps> = { dayInstance: async (sb, a) => (a.type === "opening" ? null : okDeps().dayInstance(sb, a)) };
  const load = async (t: string, over: Partial<DayFactDeps>) => {
    const input = await loadDayFacts(NO_CLIENT, args(ANA, { now: at(t) }), withDeps({ ...noOpening, ...over }));
    return { f: shop(input), day: planDay(input) as DayPlan };
  };
  const opening = (p: DayPlan) => p.items.find((i) => i.id === "opening")!;

  it("no schedule (no week row): absent → the saved start (7:00)", async () => {
    const { f, day } = await load("06:00", {});
    expect(f.hours).toMatchObject({ kind: "ok", value: { dayPrepStartQ: {} } });
    expect(opening(day)).toMatchObject({ band: "upcoming", at: 7 * 60 });
  });

  it("scheduled: the head's own day at q28 → 7:00, for today and tomorrow", async () => {
    const { f, day } = await load("06:00", { scheduleStarts: async () => rows("h1", [[PLAN, "h1"], [TOMORROW, "h1"]], { h1: { [PLAN]: 28, [TOMORROW]: 28 } }) });
    expect(f.hours.kind === "ok" && f.hours.value.dayPrepStartQ).toEqual({ [PLAN]: { kind: "scheduled", q: 28 }, [TOMORROW]: { kind: "scheduled", q: 28 } });
    expect(opening(day)).toMatchObject({ band: "upcoming", at: 7 * 60 });
  });

  it("settings drift: the schedule's context says 7:00, the saved structure now 6:00 → the day starts at 7:00, never 6:00", async () => {
    const { day } = await load("06:15", { ...savedAt(24), scheduleStarts: async () => rows("h1", [[PLAN, "h1"]], { h1: { [PLAN]: 28 } }) });
    expect(day.phase.id).toBe("before_opening");
    expect(opening(day)).toMatchObject({ band: "upcoming", at: 7 * 60 });
  });

  it("an inherited origin: the date's origin revision's value is used, not the head's", async () => {
    const { day } = await load("05:45", { scheduleStarts: async () => rows("h2", [[PLAN, "h1"]], { h1: { [PLAN]: 22 }, h2: { [PLAN]: 28 } }) });
    expect(day.phase).toMatchObject({ id: "opening_check", decidedBy: "clock" });
    expect(day.phase.since?.params.time).toEqual({ t: "wall", min: 5 * 60 + 30 });
  });

  it("an accepted opening at 5:30: the day starts at 5:30, and the heavy lines carry it", async () => {
    const booked: Partial<DayFactDeps> = { booked: async () => [{ id: "big", eventDate: PLAN, timeWindow: "9:00 AM", headcount: 120, stage: "confirmed" }] };
    const { day } = await load("05:45", { ...booked, scheduleStarts: async () => rows("h1", [[PLAN, "h1"]], { h1: { [PLAN]: 22 } }) });
    expect(day.phase.id).toBe("opening_check");
    const heavy = opening(day).reasons.find((r) => r.key === "day.reason.heavy.today")!;
    expect(heavy.params.start).toEqual({ t: "wall", min: 5 * 60 + 30 });
  });

  it("a failed context read, a missing day row, no stored start: unknown → no clock rise, day.fail.day_start, and hours still ok with the saved day", async () => {
    for (const over of [
      { scheduleStarts: async (): Promise<Rows> => { throw new Error("contexts down"); } },
      { scheduleStarts: async () => rows("h1", [], {}) },
      { scheduleStarts: async () => rows("h1", [[PLAN, "h1"]], { h1: { [PLAN]: null } }) },
    ] as Array<Partial<DayFactDeps>>) {
      const { f, day } = await load("07:30", { ...savedAt(26), ...over });
      expect(f.hours).toMatchObject({ kind: "ok", value: { shopDay: { prepStartQ: 26 }, dayPrepStartQ: { [PLAN]: { kind: "unknown" } } } });
      expect(day.phase.id).toBe("before_opening");
      expect(opening(day)).toMatchObject({ band: "upcoming", at: null });
      expect(day.notes.map((n) => n.reason.key)).toContain("day.fail.day_start");
    }
  });

  it("tomorrow: the night-before heads-up uses tomorrow's state — tomorrow unknown → the no-start key", async () => {
    const { day } = await load("20:30", { scheduleStarts: async () => rows("h1", [[PLAN, "h1"]], { h1: { [PLAN]: 28 } }) });
    expect(day.headsUp).toEqual({ key: "day.reason.heavy.tomorrow_one_unknown_start", params: { guests: { t: "count", v: 40 } } });
    const known = await load("20:30", { scheduleStarts: async () => rows("h1", [[PLAN, "h1"], [TOMORROW, "h1"]], { h1: { [PLAN]: 28, [TOMORROW]: 22 } }) });
    expect(known.day.headsUp).toEqual({ key: "day.reason.heavy.tomorrow_one", params: { guests: { t: "count", v: 40 }, start: { t: "wall", min: 5 * 60 + 30 } } });
  });

  it("everything down still says day.fail.all, whatever the schedule-start read does (PR 6's outage test, 8.1 item 2)", async () => {
    const all = Object.fromEntries(Object.keys(okDeps()).map((k) => [k, boom])) as unknown as DayFactDeps;
    for (const starts of [boom, async () => rows("h1", [[PLAN, "h1"]], { h1: { [PLAN]: 28 } })]) {
      const input = await loadDayFacts(NO_CLIENT, args(ANA, { board: boom }), { ...all, scheduleStarts: starts as DayFactDeps["scheduleStarts"] });
      expect(shop(input).hours).toEqual({ kind: "failed" });
      expect((planDay(input) as DayPlan).notes.map((n) => n.reason.key)).toEqual(["day.fail.all"]);
    }
  });
});

describe("SCH (ruling G, 23.2): the base hours and the schedule start are bounded INDEPENDENTLY", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const base = { source: "saved" as const, shopDay: { prepStartQ: 26, serviceStartQ: 42 }, catering: { minHeadcount: 30, leadMinutes: 210, defaultStartQ: 34, defaultEndQ: 52, extraPrepDishHeads: 1 } };
  const after = (ms: number) => () => new Promise<typeof base>((r) => { setTimeout(() => r(base), ms); });
  const neverSettles = () => new Promise<never>(() => undefined);
  const ignoresAbort = () => new Promise<Awaited<ReturnType<DayFactDeps["scheduleStarts"]>>>((r) => {
    setTimeout(() => r({ weeks: [{ week_start: "2026-11-16", head_revision_id: "h" }], days: [], starts: {} }), 20_000);
  });
  it.each([
    ["immediate (100 ms)", "never settles", 100, neverSettles],
    ["immediate (100 ms)", "ignores its abort (would answer at 20 s)", 100, ignoresAbort],
    ["late (5,900 ms)", "never settles", 5_900, neverSettles],
    ["late (5,900 ms)", "ignores its abort (would answer at 20 s)", 5_900, ignoresAbort],
  ] as const)("base hours %s, schedule start %s: on time, the saved hours kept, both dates unknown, no clock rise", async (_b, _s, baseMs, starts) => {
    const deps = withDeps({ shopDay: after(baseMs), scheduleStarts: starts as DayFactDeps["scheduleStarts"], dayInstance: async (sb, a) => (a.type === "opening" ? null : okDeps().dayInstance(sb, a)) });
    let done = false;
    const p = loadDayFacts(NO_CLIENT, args(ANA, { now: at("06:45") }), deps).then((r) => { done = true; return r; });
    await vi.advanceTimersByTimeAsync(DAY_FACT_DEADLINE_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    const input = await p;
    const f = shop(input);
    expect(f.hours).toEqual({ kind: "ok", value: { ...base, dayPrepStartQ: { [PLAN]: { kind: "unknown" }, [TOMORROW]: { kind: "unknown" } } } });
    const day = planDay(input) as DayPlan;
    expect(day.notes.map((n) => n.reason.key)).toContain("day.fail.day_start");
    expect(day.phase.id).toBe("before_opening"); // 6:45 is after the saved 6:30 start, but an unknown start has no clock rise
    expect(day.items.find((i) => i.id === "opening")).toMatchObject({ band: "upcoming", at: null });
  });
  it("the base hours failing still fails hours (PR 6), whatever the schedule start says; no timer is left once both settle", async () => {
    const failed = withDeps({ shopDay: neverSettles as DayFactDeps["shopDay"], scheduleStarts: async () => ({ weeks: [], days: [], starts: {} }) });
    const p = loadDayFacts(NO_CLIENT, args(ANA), failed);
    await vi.advanceTimersByTimeAsync(DAY_FACT_DEADLINE_MS);
    expect(shop(await p).hours).toEqual({ kind: "failed" });
    vi.clearAllTimers();
    const quick = loadDayFacts(NO_CLIENT, args(ANA), withDeps({}));
    await vi.advanceTimersByTimeAsync(0);
    await quick;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("SCH: the source shape of the two bounded reads (23.1)", () => {
  it("each read has its own bound; the schedule-start read is not inside H1's failure wrapper", () => {
    const code = stripComments(readFileSync("lib/day-plan.ts", "utf8"));
    expect(code).toContain('boundedRead(service, "hours", (abortable) => deps.shopDay(abortable, shopId))');
    expect(code).toMatch(/boundedRead\(service, "hours\.schedule_start", async \(abortable\) => dayPrepStarts\(await deps\.scheduleStarts\(abortable/);
    expect(code).not.toMatch(/L\("hours"/);
    expect(code.match(/deps\.scheduleStarts\(/g)).toHaveLength(1);
    expect(code.replace(/\r\n/g, "\n")).toContain("const controller = new AbortController();\n  const d = startDeadline(DAY_FACT_DEADLINE_MS, controller);");
  });
});

describe("SCH: the schedule-start read's real queries (22.3)", () => {
  const dates = [PLAN, TOMORROW];
  it("no week row: ONE read (schedule_weeks, the shop, the dates' weeks)", async () => {
    const f = fakeSupabase(() => ({ data: [] }));
    expect(await defaultDayFactDeps.scheduleStarts(f.client as never, SHOP.id, dates)).toEqual({ weeks: [], days: [], starts: {} });
    expect(f.calls.map((c) => c.table)).toEqual(["schedule_weeks"]);
    expect(f.calls[0]!.has("eq", "location_id", SHOP.id) && f.calls[0]!.has("in", "week_start", ["2026-11-16"])).toBe(true);
  });
  it("a schedule: three batched reads, each bound to the shop; the contexts read selects ONLY each date's start", async () => {
    const f = fakeSupabase((c) => {
      if (c.table === "schedule_weeks") return { data: [{ week_start: "2026-11-16", head_revision_id: "h2" }] };
      if (c.table === "schedule_revision_days") return { data: [{ revision_id: "h2", business_date: PLAN, origin_revision_id: "h1" }, { revision_id: "h2", business_date: TOMORROW, origin_revision_id: null }] };
      return { data: [{ revision_id: "h1", t0: 22, t1: null }, { revision_id: "h2", t0: 28, t1: 28 }] };
    });
    const r = await defaultDayFactDeps.scheduleStarts(f.client as never, SHOP.id, dates);
    expect(f.calls.map((c) => c.table)).toEqual(["schedule_weeks", "schedule_revision_days", "schedule_revision_contexts"]);
    for (const c of f.calls) expect(c.has("eq", "location_id", SHOP.id), c.table).toBe(true);
    expect(f.calls[1]!.has("in", "revision_id", ["h2"]) && f.calls[1]!.has("in", "business_date", dates)).toBe(true);
    expect(f.calls[2]!.arg("select")).toBe(`revision_id, t0:context->days->"${PLAN}"->structure->shopDay->prepStartQ, t1:context->days->"${TOMORROW}"->structure->shopDay->prepStartQ`);
    expect(f.calls[2]!.has("in", "revision_id", ["h1", "h2"])).toBe(true);
    expect(r.starts).toEqual({ h1: { [PLAN]: 22, [TOMORROW]: null }, h2: { [PLAN]: 28, [TOMORROW]: 28 } });
    expect(dayPrepStarts(r, dates, () => "2026-11-16")).toEqual({ [PLAN]: { kind: "scheduled", q: 22 }, [TOMORROW]: { kind: "scheduled", q: 28 } });
  });
  it("a PostgREST that cannot parse the JSON path (PGRST100) → one fallback read of the whole context; any other error throws", async () => {
    let n = 0;
    const ctx = { days: { [PLAN]: { structure: { shopDay: { prepStartQ: 24 } } } } };
    const f = fakeSupabase((c) => {
      if (c.table === "schedule_weeks") return { data: [{ week_start: "2026-11-16", head_revision_id: "h1" }] };
      if (c.table === "schedule_revision_days") return { data: [{ revision_id: "h1", business_date: PLAN, origin_revision_id: "h1" }] };
      return n++ === 0 ? { error: { code: "PGRST100", message: "failed to parse select parameter" } } : { data: [{ revision_id: "h1", context: ctx }] };
    });
    const r = await defaultDayFactDeps.scheduleStarts(f.client as never, SHOP.id, dates);
    expect(f.calls.map((c) => String(c.arg("select")))).toContain("revision_id, context");
    expect(r.starts).toEqual({ h1: { [PLAN]: 24, [TOMORROW]: undefined } });
    const bad = fakeSupabase((c) => (c.table === "schedule_weeks" ? { data: [{ week_start: "2026-11-16", head_revision_id: "h1" }] }
      : c.table === "schedule_revision_days" ? { data: [{ revision_id: "h1", business_date: PLAN, origin_revision_id: null }] } : { error: { code: "57014", message: "timeout" } }));
    await expect(defaultDayFactDeps.scheduleStarts(bad.client as never, SHOP.id, dates)).rejects.toThrow(/schedule_revision_contexts/);
  });
  it("the pure mapping (dayPrepStartFor): no week / no head → absent; a missing row or start → unknown; else scheduled", () => {
    const wk = () => "2026-11-16";
    expect(dayPrepStarts({ weeks: [], days: [], starts: {} }, dates, wk)).toEqual({});
    expect(dayPrepStarts({ weeks: [{ week_start: "2026-11-16", head_revision_id: null }], days: [], starts: {} }, dates, wk)).toEqual({});
    expect(dayPrepStarts({ weeks: [{ week_start: "2026-11-16", head_revision_id: "h" }], days: [], starts: {} }, dates, wk))
      .toEqual({ [PLAN]: { kind: "unknown" }, [TOMORROW]: { kind: "unknown" } });
    expect(dayPrepStarts({ weeks: [{ week_start: "2026-11-16", head_revision_id: "h" }], days: [{ revision_id: "h", business_date: PLAN, origin_revision_id: null }],
      starts: { h: { [PLAN]: 7.5 } } }, [PLAN], wk)).toEqual({ [PLAN]: { kind: "unknown" } });
  });
});
