/**
 * B4 - closing report links, shift board and Pulse (triage issues #15-#21, #23).
 * Pure helpers get unit tests; wiring and copy get source/key pins.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  closedStationFor, showBreakButton, taskHref, TASK_TYPES,
  type Station, type StationEvent, type ShiftBoard,
} from "@/lib/assignments-shared";
import { reportNameKey, reportRoute } from "@/lib/report-reference-route";
import { lateTaskKeys } from "@/lib/pulse/attention-shared";
import { computeOverdue, EXPECTED_BY } from "@/lib/midshift-shared";
import type { ReportType } from "@/lib/types";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const en = JSON.parse(read("lib/i18n/en.json")) as Record<string, string>;
const es = JSON.parse(read("lib/i18n/es.json")) as Record<string, string>;

const ALL_REPORT_TYPES: ReportType[] = [
  "am_prep", "mid_day_prep", "cash_report", "opening_report", "training_report",
  "special_report", "receiving", "counts", "ordering", "pm_report",
];

describe("#15 reportRoute / reportNameKey", () => {
  it("routes every ReportType, pm_report to its own page (not AM Prep)", () => {
    expect(reportRoute("pm_report")).toBe("/pm-report");
    expect(reportRoute("opening_report")).toBe("/operations/opening");
    expect(reportRoute("mid_day_prep")).toBe("/operations/mid-day");
    expect(reportRoute("cash_report")).toBe("/cash");
    expect(reportRoute("receiving")).toBe("/operations/receiving");
    expect(reportRoute("counts")).toBe("/operations/counts");
    expect(reportRoute("ordering")).toBe("/ordering");
    expect(reportRoute("am_prep")).toBe("/operations/am-prep");
    // Defensive default for types with no page yet (and null): AM Prep, never a 404.
    expect(reportRoute("training_report")).toBe("/operations/am-prep");
    expect(reportRoute("special_report")).toBe("/operations/am-prep");
    expect(reportRoute(null)).toBe("/operations/am-prep");
  });
  it("agrees with the shift board's taskHref for every task-type report", () => {
    for (const task of TASK_TYPES) {
      expect(taskHref(task, "loc").split("?")[0]).toBe(reportRoute(task));
    }
  });
  it("names every ReportType with an existing en + es key", () => {
    for (const type of ALL_REPORT_TYPES) {
      const key = reportNameKey(type);
      expect(en[key], `${type} -> ${key} (en)`).toBeTruthy();
      expect(es[key], `${type} -> ${key} (es)`).toBeTruthy();
    }
    expect(reportNameKey("pm_report")).toBe("assignments.task.pm_report");
    expect(reportNameKey("training_report")).toBe("closing.report_ref.report_fallback");
  });
  it("report_ref copy no longer says 'AM Prep page' / 'dashboard' for every report", () => {
    for (const dict of [en, es]) {
      for (const [key, value] of Object.entries(dict)) {
        if (!key.startsWith("closing.report_ref.")) continue;
        expect(value, key).not.toMatch(/AM Prep|Prep AM|submit from the dashboard|desde el dashboard/i);
      }
    }
    expect(en["closing.report_ref.tap_to_submit_aria"]).toContain("{report}");
    expect(es["closing.report_ref.tap_to_submit_aria"]).toContain("{report}");
    expect(en["closing.report_ref.edit_link_aria"]).toContain("{report}");
    expect(es["closing.report_ref.edit_link_aria"]).toContain("{report}");
    expect(en["closing.report_ref.empty_subtitle_tap"]).toBe("Pending — tap to open");
  });
  it("component uses the shared route + per-type name, and the tap subtitle only when tappable", () => {
    const src = read("components/ReportReferenceItem.tsx");
    expect(src).toContain('from "@/lib/report-reference-route"');
    expect(src).not.toMatch(/function reportRoute/);
    expect(src).toContain("reportNameKey(templateItem.reportReferenceType)");
    expect(src).toContain("closing.report_ref.empty_subtitle_tap");
  });
});

describe("#16 report time", () => {
  it("shows the report's own submit time, falling back to the row time", () => {
    const src = read("components/ReportReferenceItem.tsx");
    expect(src).toContain("completion.autoCompleteMeta?.reportSubmittedAt ?? completion.completedAt");
    expect(src).not.toContain("formatTime(completion.completedAt, language)");
  });
});

describe("#17 amber AM-prep note wording", () => {
  it("no longer sends the closer to 'the opener' (AM prep is the closer's count)", () => {
    expect(en["closing.am_prep_gap.banner"]).not.toMatch(/opener/i);
    expect(en["closing.am_prep_gap.banner"]).toMatch(/closer/i);
    expect(es["closing.am_prep_gap.banner"]).not.toMatch(/abri/i);
    expect(es["closing.am_prep_gap.banner"]).toMatch(/cierra/i);
  });
});

describe("#18 temp label", () => {
  it("has en + es keys and is wired page -> client -> ChecklistItem", () => {
    expect(en["closing.expand.temp_label"]).toBe("Temp (°F)");
    expect(es["closing.expand.temp_label"]).toBeTruthy();
    expect(read("app/(authed)/operations/closing/page.tsx")).toContain("loadLocationTempItemIds(sb, locationParam)");
    const client = read("app/(authed)/operations/closing/closing-client.tsx");
    expect(client).toContain("isTempReading={tempReadingItems[it.id] ?? false}");
    const item = read("components/ChecklistItem.tsx");
    expect(item).toContain('isTempReading ? "closing.expand.temp_label" : "closing.expand.count_label"');
  });
});

// -- shift board ------------------------------------------------------------------------------
const station = (over: Partial<Station> = {}): Station => ({
  id: "st-1", name: "Slicer", nameEs: null, sort: 1, active: true, staffed: true,
  positions: [{ id: "pos-1", stationId: "st-1", name: "Lead", nameEs: null, duty: null, dutyEs: null, sort: 1, active: true }],
  closedAt: "2026-10-12T00:45:00Z", ...over,
});
const ev = (over: Partial<StationEvent>): StationEvent => ({
  id: "e", sequence: "1", locationId: "loc", businessDate: "2026-10-12", userId: "u1", stationId: "st-1",
  positionId: "pos-1", kind: "assign", actorId: "boss", actorName: "Boss", at: "2026-10-12T22:00:00Z", source: "assigned", ...over,
});
const board = (events: StationEvent[], stations: Station[] = [station()]): Pick<ShiftBoard, "events" | "stations"> => ({ events, stations });

describe("#19 closedStationFor", () => {
  const closedRelease = ev({
    id: "r", sequence: "2", kind: "release", stationId: null, positionId: null, source: null,
    releaseReason: "station_closed", priorPositionId: "pos-1",
  });
  it("resolves the closed station through priorPositionId after assign -> release(station_closed)", () => {
    const hit = closedStationFor(board([ev({ sequence: "1" }), closedRelease]), "u1");
    expect(hit?.station.id).toBe("st-1");
    expect(hit?.position.id).toBe("pos-1");
  });
  it("returns null for ended_shift / clocked_out releases, no events, an active head and other users", () => {
    const release = (reason: NonNullable<StationEvent["releaseReason"]>) => ({ ...closedRelease, releaseReason: reason });
    expect(closedStationFor(board([ev({}), release("ended_shift")]), "u1")).toBeNull();
    expect(closedStationFor(board([ev({}), release("clocked_out")]), "u1")).toBeNull();
    expect(closedStationFor(board([]), "u1")).toBeNull();
    expect(closedStationFor(board([ev({})]), "u1")).toBeNull();
    expect(closedStationFor(board([ev({}), closedRelease]), "someone-else")).toBeNull();
  });
  it("returns null when the station is no longer closed, not a floor station, or the position is unknown", () => {
    expect(closedStationFor(board([ev({}), closedRelease], [station({ closedAt: null })]), "u1")).toBeNull();
    expect(closedStationFor(board([ev({}), closedRelease], [station({ staffed: false })]), "u1")).toBeNull();
    expect(closedStationFor(board([ev({}), { ...closedRelease, priorPositionId: "nope" }]), "u1")).toBeNull();
    expect(closedStationFor(board([ev({}), { ...closedRelease, priorPositionId: null }]), "u1")).toBeNull();
  });
  it("is wired into the person card", () => {
    const src = read("components/assignments/ShiftBoardClient.tsx");
    expect(src).toContain("closedStationFor(board, person.id)");
  });
});

describe("#20 showBreakButton", () => {
  const onShift = { onShift: true, source: "coops_activity" as const, since: null };
  const offShift = { onShift: false, source: null, since: null };
  it("hides START BREAK once off shift (presence live), keeps it on shift", () => {
    expect(showBreakButton({ presence: offShift }, { whosHere: true })).toBe(false);
    expect(showBreakButton({ presence: onShift }, { whosHere: true })).toBe(true);
  });
  it("keeps 'Back from break' for someone on break, and everything when presence is off", () => {
    expect(showBreakButton({ presence: offShift, onBreak: true }, { whosHere: true })).toBe(true);
    expect(showBreakButton({ presence: offShift }, { whosHere: false })).toBe(true);
    expect(showBreakButton({}, { whosHere: true })).toBe(true);
  });
  it("never offers a break to an unavailable person", () => {
    expect(showBreakButton({ available: false, presence: onShift }, { whosHere: true })).toBe(false);
  });
  it("leaves CLAIM alone (a new claim is how someone gets back on shift)", () => {
    const src = read("components/assignments/ShiftBoardClient.tsx");
    expect(src).toContain("showBreakButton(person, board) &&");
    expect(src).toMatch(/const canClaim = person\.available !== false && !person\.onBreak && compact/);
  });
});

describe("#21 compact station card", () => {
  it("is titled 'My station' with 'Yours: ...' / 'None yet', never 'N of 1 assigned'", () => {
    const src = read("components/assignments/ShiftBoardClient.tsx");
    expect(src).toContain('compact ? "assignments.myStation" : "assignments.people"');
    expect(src).toContain('t("assignments.yoursStation", { station: myStation })');
    expect(src).toContain('t("assignments.yoursNone")');
    for (const dict of [en, es]) {
      expect(dict["assignments.myStation"]).toBeTruthy();
      expect(dict["assignments.yoursStation"]).toContain("{station}");
      expect(dict["assignments.yoursNone"]).toBeTruthy();
    }
  });
});

describe("#23 late tasks are overdue-only", () => {
  type Row = Parameters<typeof lateTaskKeys>[0][number];
  const midDay = (overdue: Row["overdue"]): Row[] => [{ key: "mid_day", overdue }];
  it("does not call the due window late", () => {
    expect([...lateTaskKeys(midDay("due_now"))]).toEqual([]);
    expect([...lateTaskKeys(midDay("not_due_yet"))]).toEqual([]);
    expect([...lateTaskKeys(midDay("waiting_on_closing"))]).toEqual([]);
    expect([...lateTaskKeys(midDay("ok"))]).toEqual([]);
  });
  it("flags only overdue reports", () => {
    expect([...lateTaskKeys(midDay("overdue"))]).toEqual(["mid_day"]);
    const mixed = lateTaskKeys([
      { key: "opening", overdue: "overdue" }, { key: "mid_day", overdue: "due_now" }, { key: "cash", overdue: "ok" },
    ]);
    expect([...mixed]).toEqual(["opening"]);
  });
  it("matches the real mid-day clock: due_now 2:00-3:30 PM, late only after 3:30 PM", () => {
    const at = (minutesOfDay: number) => computeOverdue({ key: "mid_day", done: false, minutesOfDay, closingDone: false, midDayDoneCount: 0 });
    expect(lateTaskKeys(midDay(at(EXPECTED_BY.midDayDueFrom))).size).toBe(0);
    expect(lateTaskKeys(midDay(at(EXPECTED_BY.midDayOverdueAfter))).size).toBe(0);
    expect(lateTaskKeys(midDay(at(EXPECTED_BY.midDayOverdueAfter + 1))).size).toBe(1);
  });
  it("sections.ts uses the helper (no inline due_now-as-late)", () => {
    const src = read("lib/pulse/sections.ts");
    expect(src).toContain("lateTaskKeys(overdue)");
    expect(src).not.toMatch(/overdue === "overdue" \|\| r\.overdue === "due_now"/);
  });
});
