/**
 * Nav PR 6 (plan r3, 8.1): the day loader. This file starts with the PURE companion (lib/day-plan-load-shared.ts):
 * the mappers, the B1 rule in code, the effective template pick, the sections-left count, which facts a viewer needs,
 * and the social media manager's helpers. The composition (lib/day-plan.ts) follows below.
 */
import { describe, expect, it } from "vitest";
import type { Station, StationEvent, TaskAssignment } from "@/lib/assignments-shared";
import {
  cashDay, cateringOrders, checklistDay, dayAssignments, dayStations, factsNeeded, firstName, midDayDay, notPhaseSections, outTimes,
  pickEffectiveClosingTemplate, pmDay, sectionsLeft, shopHoursFrom, smmChecklistTasks, smmStationRef, smmTaskState,
} from "@/lib/day-plan-load-shared";
import { etWallQ, eventQFromWindow, ezcaterCancelled } from "@/lib/scheduling/inputs-shared";
import { SCHEDULE_STRUCTURE_DEFAULTS } from "@/lib/scheduling/structure-shared";
import { ALL_VIEWERS } from "./fixtures/day-plan/build";

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

  it("hours: the structure's values; dayPrepStartQ = prepStartQ (SCH); a non-finite value throws", () => {
    const saved = shopHoursFrom({ structure: { ...SCHEDULE_STRUCTURE_DEFAULTS, shopDay: { ...SCHEDULE_STRUCTURE_DEFAULTS.shopDay, prepStartQ: 26 } }, source: "saved" });
    expect(saved).toMatchObject({ source: "saved", shopDay: { prepStartQ: 26 }, dayPrepStartQ: 26 });
    const defaults = shopHoursFrom({ structure: SCHEDULE_STRUCTURE_DEFAULTS, source: "defaults" });
    expect(defaults.dayPrepStartQ).toBe(SCHEDULE_STRUCTURE_DEFAULTS.shopDay.prepStartQ);
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
