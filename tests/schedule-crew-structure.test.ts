import { describe, expect, it } from "vitest";
import { crewStructureCases, shopBase } from "../scripts/schedule-structure-cases.mjs";
import { scheduleEngine, shiftTypesOf, structureProblem, withCrewStructureDefaults, type ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { structureBody } from "@/lib/scheduling/settings-view-shared";

describe("crew structure contracts", () => {
  it.each(crewStructureCases())("$name", ({ value, key }) => expect(structureProblem(value)).toBe(key));
  it("defaults new saves without changing historical snapshots", () => {
    const old = shopBase() as ScheduleStructure, before = structuredClone(old);
    expect(scheduleEngine(old)).toBe("stations"); expect(shiftTypesOf(old)).toEqual([]);
    expect(structureBody("shop", null, old).structure).toEqual(withCrewStructureDefaults(old));
    expect(old).toEqual(before); expect(old.engine).toBeUndefined();
  });
});
