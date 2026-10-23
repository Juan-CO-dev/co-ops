import { describe, expect, it } from "vitest";
import { crewStructureCases, shopBase } from "../scripts/schedule-structure-cases.mjs";
import { structureFromStations, scheduleEngine, shiftTypesOf, structureProblem, withCrewStructureDefaults, type ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { stationAdvisory, structureBody } from "@/lib/scheduling/settings-view-shared";

describe("crew structure contracts", () => {
  it.each(crewStructureCases())("$name", ({ value, key }) => expect(structureProblem(value)).toBe(key));
  it("defaults new saves without changing historical snapshots", () => {
    const old = shopBase() as ScheduleStructure, before = structuredClone(old);
    expect(scheduleEngine(old)).toBe("stations"); expect(shiftTypesOf(old)).toEqual([]);
    expect(structureBody("shop", null, old).structure).toEqual(withCrewStructureDefaults(old));
    expect(old).toEqual(before); expect(old.engine).toBeUndefined();
  });
});


describe("station refresh with shift types", () => {
  it.each(["retired", "unmanned"])("keeps advisories when a shift type uses a %s station", (kind) => {
    const saved = shopBase() as ScheduleStructure;
    const id = Object.keys(saved.positions)[0]!;
    saved.shiftTypes = [{ id: "morning", name: "Morning", fromQ: 28, toQ: 60, startFlexQ: 0, minLengthQ: 16,
      headcount: { slow: 1, normal: 1, busy: 1, weekend: 1 }, stations: [id], countsTowardMod: true }];
    const rebuilt = structureFromStations([{ id: "station", active: kind !== "retired", staffed: kind !== "unmanned", usuallyClosesAt: null, trims: [] }],
      [{ id, stationId: "station", active: true, usuallyTrimsAt: null }], {}, saved);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.structure.shiftTypes![0]!.stations).toEqual([]);
    expect(saved.shiftTypes[0]!.stations).toEqual([id]);
    expect(stationAdvisory(saved, rebuilt.structure, rebuilt.seededFrom)).toContainEqual({
      key: "schedule.settings.advisory.shift_station_removed", params: { shiftType: "Morning", positionId: id },
    });
  });
});
