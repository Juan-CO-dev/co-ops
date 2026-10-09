/**
 * Live shop floor — the PURE half: station status, auto-arrange, saved-layout merge, crew stripping,
 * and the 3D-or-2D decision. Status is a WORD (never colour-only) and crew payloads carry no names.
 */
import { describe, expect, it } from "vitest";
import {
  autoArrange,
  choose3D,
  FLOOR_COLS,
  floorMode,
  floorStations,
  mergeLayout,
  stationStatus,
  validLayout,
} from "@/lib/pulse/floor-shared";
import type { ShiftBoard, Station, StationEvent } from "@/lib/assignments-shared";

const pos = (stationId: string, id: string, sort: number) => ({ id, stationId, name: `P${sort}`, nameEs: null, duty: null, dutyEs: null, sort, active: true });
const st = (id: string, sort: number, over: Partial<Station> = {}): Station => ({
  id, name: `S${sort}`, nameEs: null, sort, active: true, staffed: true, positions: [pos(id, `${id}-1`, 1), pos(id, `${id}-2`, 2)], closedAt: null, usuallyClosesAt: null, ...over,
});
const ev = (userId: string, stationId: string | null, seq: number, positionId: string | null = stationId ? `${stationId}-1` : null): StationEvent => ({
  id: `e${seq}`, sequence: String(seq), locationId: "loc", businessDate: "2026-10-09", userId, stationId, positionId,
  kind: stationId ? "assign" : "release", actorId: "mgr", actorName: "Mgr", at: `2026-10-09T15:0${seq}:00Z`, source: stationId ? "assigned" : null,
});
function board(stations: Station[], events: StationEvent[], people: ShiftBoard["people"]): ShiftBoard {
  return { locationId: "loc", date: "2026-10-09", viewerId: "v", viewerLevel: 5, stations, people, events, tasks: [] };
}

describe("stationStatus", () => {
  it("closed > inactive > uncovered > short/closing_soon > covered", () => {
    expect(stationStatus({ active: true, staffed: true, closed: true, filled: 2, positions: 2, closingSoon: false, closeDue: false, onBreak: 0 })).toBe("closed");
    expect(stationStatus({ active: false, staffed: true, closed: false, filled: 0, positions: 2, closingSoon: false, closeDue: false, onBreak: 0 })).toBe("inactive");
    expect(stationStatus({ active: true, staffed: true, closed: false, filled: 0, positions: 2, closingSoon: false, closeDue: false, onBreak: 0 })).toBe("uncovered");
    expect(stationStatus({ active: true, staffed: true, closed: false, filled: 1, positions: 2, closingSoon: false, closeDue: false, onBreak: 0 })).toBe("short");
    expect(stationStatus({ active: true, staffed: true, closed: false, filled: 2, positions: 2, closingSoon: true, closeDue: false, onBreak: 0 })).toBe("closing_soon");
    expect(stationStatus({ active: true, staffed: true, closed: false, filled: 2, positions: 2, closingSoon: false, closeDue: false, onBreak: 0 })).toBe("covered");
  });
  it("Astra #9: past its close time a staffed open station is close_due, never covered again", () => {
    expect(stationStatus({ active: true, staffed: true, closed: false, filled: 2, positions: 2, closingSoon: false, closeDue: true, onBreak: 0 })).toBe("close_due");
    expect(stationStatus({ active: true, staffed: true, closed: false, filled: 1, positions: 2, closingSoon: false, closeDue: true, onBreak: 0 })).toBe("short");
    expect(stationStatus({ active: true, staffed: true, closed: true, filled: 2, positions: 2, closingSoon: false, closeDue: true, onBreak: 0 })).toBe("closed");
  });
  it("a station with no positions counts as covered by one person; everyone on break = uncovered", () => {
    expect(stationStatus({ active: true, staffed: true, closed: false, filled: 1, positions: 0, closingSoon: false, closeDue: false, onBreak: 0 })).toBe("covered");
    expect(stationStatus({ active: true, staffed: true, closed: false, filled: 1, positions: 1, closingSoon: false, closeDue: false, onBreak: 1 })).toBe("uncovered");
  });
  it("an unstaffed station (storage / prep table) is never 'uncovered'", () => {
    expect(stationStatus({ active: true, staffed: false, closed: false, filled: 0, positions: 0, closingSoon: false, closeDue: false, onBreak: 0 })).toBe("covered");
  });
});

describe("floorStations (from one board read)", () => {
  const stations = [st("a", 1), st("b", 2, { usuallyClosesAt: "16:00:00", positions: [pos("b", "b-1", 1)] }), st("c", 3, { closedAt: "2026-10-09T14:00:00Z" })];
  const people: ShiftBoard["people"] = [
    { id: "u1", name: "Ana Perez", level: 3, hasWork: true },
    { id: "u2", name: "Bo Li", level: 3, hasWork: true, onBreak: true },
    { id: "v", name: "Val Viewer", level: 3, hasWork: true },
  ];
  const events = [ev("u1", "a", 1), ev("u2", "a", 2, "a-2"), ev("v", "b", 3)];
  it("KH+ see first names, statuses, positions filled, close facts", () => {
    const out = floorStations(board(stations, events, people), { nowMinutes: 15 * 60 + 30, viewerId: "v", showNames: true });
    expect(out.map((s) => s.status)).toEqual(["short", "closing_soon", "closed"]);
    expect(out[0]!.people).toEqual(["Ana"]); // Bo is on break: not covering
    expect(out[0]!.filled).toBe(1);
    expect(out[0]!.positions).toBe(2);
    expect(out[1]!.closesAt).toBe("16:00");
    expect(out[2]!.closedAt).toBe("2026-10-09T14:00:00Z");
  });
  it("crew payloads carry NO names except the viewer's own", () => {
    const out = floorStations(board(stations, events, people), { nowMinutes: 15 * 60 + 30, viewerId: "v", showNames: false });
    expect(out[0]!.people).toEqual([]);
    expect(out[1]!.people).toEqual(["Val"]);
    expect(JSON.stringify(out)).not.toContain("Ana");
  });
  it("Astra #9 on the board: Expo (closes 16:00) read at 16:30 is close_due with closeDue=true", () => {
    const out = floorStations(board(stations, events, people), { nowMinutes: 16 * 60 + 30, viewerId: "v", showNames: true });
    expect(out[1]).toMatchObject({ status: "close_due", closeDue: true });
  });
  it("a release event clears the person's station", () => {
    const out = floorStations(board(stations, [ev("u1", "a", 1), ev("u1", null, 2)], people), { nowMinutes: 900, viewerId: "v", showNames: true });
    expect(out[0]!.status).toBe("uncovered");
    expect(out[0]!.people).toEqual([]);
  });
});

describe("autoArrange + mergeLayout", () => {
  it("serpentine grid by sort, FLOOR_COLS wide, unit coordinates", () => {
    expect(FLOOR_COLS).toBe(3);
    const auto = autoArrange(["s1", "s2", "s3", "s4", "s5"]);
    expect(auto.s1).toEqual({ x: 0, y: 0 });
    expect(auto.s3).toEqual({ x: 2, y: 0 });
    expect(auto.s4).toEqual({ x: 2, y: 1 }); // second row runs right-to-left
    expect(auto.s5).toEqual({ x: 1, y: 1 });
  });
  it("saved points override auto; unknown saved ids are dropped; missing stations keep auto", () => {
    const merged = mergeLayout(["s1", "s2"], { s2: { x: 5, y: 1 }, ghost: { x: 0, y: 0 } });
    expect(merged.s1).toEqual({ x: 0, y: 0 });
    expect(merged.s2).toEqual({ x: 5, y: 1 });
    expect(merged.ghost).toBeUndefined();
  });
  it("validLayout accepts bounded finite points only", () => {
    expect(validLayout({ a: { x: 0, y: 0 }, b: { x: 7.5, y: 3 } })).toBe(true);
    expect(validLayout({ a: { x: -1, y: 0 } })).toBe(false);
    expect(validLayout({ a: { x: 99, y: 0 } })).toBe(false);
    expect(validLayout({ a: { x: Number.NaN, y: 0 } })).toBe(false);
    expect(validLayout([])).toBe(false);
    expect(validLayout({ a: { x: "0", y: 0 } })).toBe(false);
  });
});

describe("choose3D", () => {
  it("3D only with WebGL, motion allowed, not low-power, not save-data", () => {
    expect(choose3D({ webgl: true, reducedMotion: false, lowPower: false, saveData: false })).toBe(true);
    expect(choose3D({ webgl: false, reducedMotion: false, lowPower: false, saveData: false })).toBe(false);
    expect(choose3D({ webgl: true, reducedMotion: true, lowPower: false, saveData: false })).toBe(false);
    expect(choose3D({ webgl: true, reducedMotion: false, lowPower: true, saveData: false })).toBe(false);
    expect(choose3D({ webgl: true, reducedMotion: false, lowPower: false, saveData: true })).toBe(false);
  });
});

describe("floorMode (Astra #8)", () => {
  it("a three.js failure forces the 2D map regardless of device or toggle; otherwise toggle beats device; server = 2D", () => {
    expect(floorMode({ deviceWants3D: true, override: null, failed: true })).toBe("2d");
    expect(floorMode({ deviceWants3D: true, override: true, failed: true })).toBe("2d");
    expect(floorMode({ deviceWants3D: true, override: null, failed: false })).toBe("3d");
    expect(floorMode({ deviceWants3D: false, override: true, failed: false })).toBe("3d");
    expect(floorMode({ deviceWants3D: true, override: false, failed: false })).toBe("2d");
    expect(floorMode({ deviceWants3D: null, override: null, failed: false })).toBe("2d");
  });
});
