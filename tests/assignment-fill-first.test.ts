/**
 * D-26 (Juan 2026-10-13): "fill first" names only an UNCOVERED floor station's first UNOCCUPIED
 * position. Coverage is the Pulse floor's rule (B7b review #2): held by someone NOT on break.
 */
import { describe, expect, it } from "vitest";
import {
  fillFirstPositionIds, isFloorStation,
  type ShiftBoard, type ShiftPerson, type Station, type StationEvent, type StationPosition,
} from "@/lib/assignments-shared";
import { floorStations } from "@/lib/pulse/floor-shared";

const pos = (id: string, stationId: string, sort: number, over: Partial<StationPosition> = {}): StationPosition => ({
  id, stationId, name: id, nameEs: null, duty: null, dutyEs: null, sort, active: true, ...over,
});
const station = (id: string, positions: StationPosition[], over: Partial<Station> = {}): Station => ({
  id, name: id, nameEs: null, sort: 1, active: true, staffed: true, positions, closedAt: null, ...over,
});
const person = (id: string, over: Partial<ShiftPerson> = {}): ShiftPerson => ({ id, name: id, level: 3, hasWork: true, available: true, ...over });
let seq = 0;
const ev = (userId: string, stationId: string | null, positionId: string | null, kind: StationEvent["kind"] = "claim"): StationEvent => ({
  id: `e${++seq}`, sequence: String(seq), locationId: "shop", businessDate: "2026-10-13", userId, stationId, positionId,
  kind, actorId: userId, actorName: null, at: "2026-10-13T15:00:00Z", source: stationId ? "claimed" : null,
});
const cue = (b: Pick<ShiftBoard, "stations" | "events" | "people" | "occupiedPositions">) => [...fillFirstPositionIds(b)].sort();

describe("fillFirstPositionIds", () => {
  it("cues the first position of each uncovered station and nothing on covered ones", () => {
    const stations = [
      station("grill", [pos("grill-2", "grill", 2), pos("grill-1", "grill", 1)]),
      station("walk", [pos("walk-1", "walk", 1), pos("walk-2", "walk", 2)]),
      station("slice", [pos("slice-1", "slice", 1)]),
    ];
    expect(cue({ stations, people: [person("maya")], events: [ev("maya", "walk", "walk-2")], occupiedPositions: [{ positionId: "walk-2" }] }))
      .toEqual(["grill-1", "slice-1"]);
  });
  it("review #2: a two-position station whose only holder is ON BREAK is uncovered; the cue goes to the first UNOCCUPIED position", () => {
    const stations = [station("walk", [pos("walk-1", "walk", 1), pos("walk-2", "walk", 2)])];
    const events = [ev("maya", "walk", "walk-1")];
    const occupiedPositions = [{ positionId: "walk-1" }];
    expect(cue({ stations, events, occupiedPositions, people: [person("maya", { onBreak: true })] })).toEqual(["walk-2"]);
    // Back from break: covered again, no cue.
    expect(cue({ stations, events, occupiedPositions, people: [person("maya")] })).toEqual([]);
  });
  it("review #2: a cue exists exactly where the Pulse floor says uncovered", () => {
    const b: ShiftBoard = {
      locationId: "shop", date: "2026-10-13", viewerId: "x", viewerLevel: 4, tasks: [],
      stations: [
        station("a", [pos("a-1", "a", 1), pos("a-2", "a", 2)]),
        station("b", [pos("b-1", "b", 1)]),
        station("c", [pos("c-1", "c", 1), pos("c-2", "c", 2)]),
      ],
      people: [person("onbreak", { onBreak: true }), person("working")],
      events: [ev("onbreak", "a", "a-1"), ev("working", "b", "b-1")],
      occupiedPositions: [{ positionId: "a-1" }, { positionId: "b-1" }],
    };
    const floor = floorStations(b, { nowMinutes: 600, viewerId: "x", showNames: true });
    const uncovered = floor.filter((s) => s.status === "uncovered").map((s) => s.id).sort();
    expect(uncovered).toEqual(["a", "c"]);
    const cued = fillFirstPositionIds(b);
    const cuedStations = b.stations.filter(isFloorStation).filter((s) => s.positions.some((p) => cued.has(p.id))).map((s) => s.id).sort();
    expect(cuedStations).toEqual(uncovered);
    expect([...cued].sort()).toEqual(["a-2", "c-1"]);
  });
  it("a hold with no position (legacy assign) still covers its station", () => {
    expect(cue({ stations: [station("grill", [pos("grill-1", "grill", 1)])], people: [person("sam")], events: [ev("sam", "grill", null, "assign")] })).toEqual([]);
  });
  it("a released hold no longer covers the station", () => {
    const events = [ev("sam", "grill", "grill-1"), ev("sam", null, null, "release")];
    expect(cue({ stations: [station("grill", [pos("grill-1", "grill", 1)])], people: [person("sam")], events })).toEqual(["grill-1"]);
  });
  it("skips inactive positions, so the first OPEN position gets the cue", () => {
    expect(cue({ stations: [station("grill", [pos("a", "grill", 1, { active: false }), pos("b", "grill", 2)])], people: [], events: [] })).toEqual(["b"]);
  });
  it("breaks a sort tie by name, matching the board's option order", () => {
    expect(cue({ stations: [station("grill", [pos("zeta", "grill", 1), pos("alpha", "grill", 1)])], people: [], events: [] })).toEqual(["alpha"]);
  });
  it("never cues a closed station or a closing section (not a floor station)", () => {
    expect(cue({ stations: [
      station("closed", [pos("c-1", "closed", 1)], { closedAt: "2026-10-13T22:00:00Z" }),
      station("section", [pos("s-1", "section", 1)], { staffed: false }),
      station("off", [pos("o-1", "off", 1)], { active: false }),
    ], people: [], events: [] })).toEqual([]);
  });
});
