import { describe, expect, it } from "vitest";
import { stationNudges, trimReleasePayload, validStationTrims } from "@/lib/station-schedule-shared";
import type { ShiftBoard, StationEvent } from "@/lib/assignments-shared";
import { etClockTime } from "@/lib/operational-day";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

function fixture(): ShiftBoard {
  return { locationId: "shop", date: "2026-10-09", stationDate: "2026-10-09", viewerId: "kh", viewerLevel: 4,
    tasks: [], people: ["a", "b"].map(id => ({ id, name: id, level: 3, hasWork: true })),
    // A FLOOR station (isFloorStation): staffed with an active position. A position-less station is a closing section and gets no nudge.
    stations: [{ id: "s", name: "Station", nameEs: null, active: true, staffed: true, sort: 1, positions: [{ id: "a", stationId: "s", name: "First", nameEs: null, duty: null, dutyEs: null, sort: 1, active: true }], usuallyClosesAt: "16:00", trims: [{ at: "14:00", to_count: 1 }] }],
    events: ["a", "b"].map((id, index): StationEvent => ({ id, sequence: String(index + 1), userId: id,
      locationId: "shop", businessDate: "2026-10-09", stationId: "s", positionId: id,
      kind: "claim", actorId: id, actorName: id, source: "claimed", at: "2026-10-09T12:00:00Z" })) };
}
const nudges = (board: ShiftBoard, time: string, dismissed: string[] = []) => stationNudges(board, board.stations[0]!, time, dismissed);
describe("daily station schedule", () => {
  it.each([ ["17:59:59", []], ["18:00:00", ["trim"]], ["19:00:00", ["trim"]], ["20:00:00", ["close"]], ["21:00:00", ["close"]] ])("projects before/at/after %s without changing state", (time, kinds) => {
    const board = fixture(), before = JSON.stringify(board);
    expect(nudges(board, `2026-10-09T${time}Z`).map(n => n.kind)).toEqual(kinds);
    expect(JSON.stringify(board)).toBe(before);
  });
  it("suppresses closed, inactive, unstaffed, crew, stale day and dismissed nudges", () => {
    for (const field of ["closedAt", "active", "staffed"] as const) {
      const board = fixture();
      if (field === "closedAt") board.stations[0]!.closedAt = "2026-10-09T20:00:00Z";
      else board.stations[0]![field] = false;
      expect(nudges(board, "2026-10-09T21:00:00Z")).toEqual([]);
    }
    const board = fixture();
    const due = nudges(board, "2026-10-09T20:00:00Z")[0]!;
    expect(nudges(board, "2026-10-09T20:00:00Z", [due.key])).toEqual([]);
    expect(nudges(board, "2026-10-10T20:00:00Z")).toEqual([]);
    board.viewerLevel = 3;
    expect(nudges(board, "2026-10-09T20:00:00Z")).toEqual([]);
  });
  it("counts current heads, respects latest target and resets dismissal next day", () => {
    const board = fixture();
    board.events.push({ ...board.events[0]!, id: "release", sequence: "3", stationId: null, positionId: null, kind: "release", source: null });
    expect(nudges(board, "2026-10-09T18:00:00Z")).toEqual([]);
    board.stations[0]!.trims!.push({ at: "15:00", to_count: 0 });
    expect(nudges(board, "2026-10-09T19:00:00Z")[0]?.toCount).toBe(0);
    const dismissed = nudges(board, "2026-10-09T20:00:00Z").map(n => n.key);
    board.date = board.stationDate = "2026-10-10";
    expect(nudges(board, "2026-10-10T20:00:00Z", dismissed)).toHaveLength(1);
  });
  it("uses Eastern wall clock in summer/winter and retains a previous station day after midnight", () => {
    expect(etClockTime("2026-10-09T18:00:00Z")).toBe("14:00");
    expect(etClockTime("2026-12-09T19:00:00Z")).toBe("14:00");
    const board = fixture(); board.date = "2026-10-10";
    expect(nudges(board, "2026-10-10T04:01:00Z")[0]?.kind).toBe("close");
  });
  it.each(["2026-10-10", "2026-12-10"])("waits for next-morning close and trim targets (%s)", (date) => {
    const board = fixture();
    board.date = date;
    board.stationDate = `${date.slice(0, 8)}09`;
    // Explicit offsets cover both daylight and standard Eastern time.
    const offset = date.includes("-12-") ? "-05:00" : "-04:00";
    for (const kind of ["close", "trim"] as const) {
      board.stations[0]!.usuallyClosesAt = kind === "close" ? "02:00" : null;
      board.stations[0]!.trims = kind === "trim" ? [{ at: "02:00", to_count: 0 }] : [];
      for (const clock of ["00:01:00", "01:59:59"]) expect(nudges(board, `${date}T${clock}${offset}`)).toEqual([]);
      for (const clock of ["02:00:00", "02:01:00"]) expect(nudges(board, `${date}T${clock}${offset}`)[0]?.kind).toBe(kind);
    }
  });
  it("keeps evening trims due before the next-morning trim and close", () => {
    const board = fixture();
    board.stations[0]!.usuallyClosesAt = "02:00";
    board.stations[0]!.trims = [{ at: "01:00", to_count: 0 }, { at: "23:00", to_count: 1 }];
    expect(nudges(board, "2026-10-09T22:00:00-04:00")).toEqual([]);
    expect(nudges(board, "2026-10-09T23:00:00-04:00")[0]?.toCount).toBe(1);
    board.date = "2026-10-10";
    expect(nudges(board, "2026-10-10T00:01:00-04:00")[0]?.toCount).toBe(1);
    expect(nudges(board, "2026-10-10T01:00:00-04:00")[0]?.toCount).toBe(0);
    expect(nudges(board, "2026-10-10T02:00:00-04:00")[0]?.kind).toBe("close");
  });
  it("releases only the chosen current holder through the existing unassign payload", () => {
    const board = fixture();
    expect(trimReleasePayload(board, "s", "b")).toEqual({ action: "station", userId: "b", stationId: null, positionId: null, manage: true });
    expect(trimReleasePayload(board, "other", "b")).toBeNull();
    expect(trimReleasePayload(board, "s", "missing")).toBeNull();
    board.people[1]!.level = 7;
    expect(trimReleasePayload(board, "s", "b")).toBeNull();
    board.viewerLevel = 3;
    expect(trimReleasePayload(board, "s", "a")).toBeNull();
  });
  it("validates sorted unique clock times and bounded integer counts", () => {
    expect(validStationTrims([])).toBe(true);
    expect(validStationTrims([{ at: "00:00", to_count: 0 }, { at: "23:59", to_count: 100 }])).toBe(true);
    for (const value of [null, {}, [null], [{ at: "24:00", to_count: 1 }], [{ at: "14:00", to_count: 1.5 }],
      [{ at: "14:00", to_count: -1 }], [{ at: "14:00", to_count: 1, extra: true }],
      [{ at: "14:00", to_count: 2 }, { at: "14:00", to_count: 1 }]]) expect(validStationTrims(value)).toBe(false);
  });
  it("ships matching en/es keys and interpolation contracts", () => {
    const keys = Object.keys(en).filter(key => key.startsWith("assignments.schedule."));
    expect(Object.keys(es).filter(key => key.startsWith("assignments.schedule.")).sort()).toEqual(keys.sort());
    for (const key of keys) expect(es[key as keyof typeof es].match(/\{\w+\}/g)).toEqual(en[key as keyof typeof en].match(/\{\w+\}/g));
  });
});
