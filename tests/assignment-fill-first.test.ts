/**
 * D-26 (Juan 2026-10-13): "fill first" names only an UNCOVERED floor station's first open position —
 * not every station's sort-1 slot.
 */
import { describe, expect, it } from "vitest";
import { fillFirstPositionIds, type Station, type StationEvent, type StationPosition } from "@/lib/assignments-shared";

const pos = (id: string, stationId: string, sort: number, over: Partial<StationPosition> = {}): StationPosition => ({
  id, stationId, name: id, nameEs: null, duty: null, dutyEs: null, sort, active: true, ...over,
});
const station = (id: string, positions: StationPosition[], over: Partial<Station> = {}): Station => ({
  id, name: id, nameEs: null, sort: 1, active: true, staffed: true, positions, closedAt: null, ...over,
});
let seq = 0;
const ev = (userId: string, stationId: string | null, positionId: string | null, kind: StationEvent["kind"] = "claim"): StationEvent => ({
  id: `e${++seq}`, sequence: String(seq), locationId: "shop", businessDate: "2026-10-13", userId, stationId, positionId,
  kind, actorId: userId, actorName: null, at: "2026-10-13T15:00:00Z", source: stationId ? "claimed" : null,
});

describe("fillFirstPositionIds", () => {
  it("cues the first position of each uncovered station and nothing on covered ones", () => {
    const stations = [
      station("grill", [pos("grill-2", "grill", 2), pos("grill-1", "grill", 1)]),
      station("walk", [pos("walk-1", "walk", 1), pos("walk-2", "walk", 2)]),
      station("slice", [pos("slice-1", "slice", 1)]),
    ];
    const cued = fillFirstPositionIds({ stations, events: [ev("maya", "walk", "walk-2")], occupiedPositions: [{ positionId: "walk-2" }] });
    expect([...cued].sort()).toEqual(["grill-1", "slice-1"]);
  });
  it("a hold with no position (legacy assign) still covers its station", () => {
    const cued = fillFirstPositionIds({ stations: [station("grill", [pos("grill-1", "grill", 1)])], events: [ev("sam", "grill", null, "assign")] });
    expect(cued.size).toBe(0);
  });
  it("a released hold no longer covers the station", () => {
    const events = [ev("sam", "grill", "grill-1"), ev("sam", null, null, "release")];
    expect([...fillFirstPositionIds({ stations: [station("grill", [pos("grill-1", "grill", 1)])], events })]).toEqual(["grill-1"]);
  });
  it("skips inactive positions, so the first OPEN position gets the cue", () => {
    const cued = fillFirstPositionIds({ stations: [station("grill", [pos("a", "grill", 1, { active: false }), pos("b", "grill", 2)])], events: [] });
    expect([...cued]).toEqual(["b"]);
  });
  it("breaks a sort tie by name, matching the board's option order", () => {
    const cued = fillFirstPositionIds({ stations: [station("grill", [pos("zeta", "grill", 1), pos("alpha", "grill", 1)])], events: [] });
    expect([...cued]).toEqual(["alpha"]);
  });
  it("never cues a closed station or a closing section (not a floor station)", () => {
    const cued = fillFirstPositionIds({ stations: [
      station("closed", [pos("c-1", "closed", 1)], { closedAt: "2026-10-13T22:00:00Z" }),
      station("section", [pos("s-1", "section", 1)], { staffed: false }),
      station("off", [pos("o-1", "off", 1)], { active: false }),
    ], events: [] });
    expect(cued.size).toBe(0);
  });
});
