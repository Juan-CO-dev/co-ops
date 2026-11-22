/**
 * PR SCH (plan r5, 12.5; r1 8.4): the before / after goldens. The "before" cuts were frozen on main's code (93172bf1) in
 * SCH commit 1, before any lib change, through this file's own canonical writer:
 *   UPDATE_SCH_BEFORE=1 npx vitest run tests/schedule-sch-goldens.test.ts   (main's code only; never after commit 1)
 * Each fixture is cut per date (`schSlices`), so a later commit can name exactly which dates changed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/scheduling/context-shared";
import { buildWeek } from "@/lib/scheduling/generator/build-shared";
import { generateWeek } from "@/lib/scheduling/generator/dispatch-shared";
import { generatorInputFor } from "@/lib/scheduling/inputs-shared";
import { WEEK as CREW_WEEK } from "./fixtures/schedule/crew-p-street-2026-10-19";
import { schCrewInputs, schSlices, schStationsWeek, schTightWeek, type WeekSlices } from "./fixtures/schedule/sch-fixtures";

const BEFORE = path.resolve(__dirname, "fixtures/schedule/sch-before.json");
const write = (file: string, v: unknown) => writeFileSync(file, JSON.stringify(JSON.parse(canonicalJson(v)), null, 1) + "\n");

function outputs(): { stations: WeekSlices; tight: WeekSlices; crew: WeekSlices } {
  return {
    stations: schSlices(buildWeek(schStationsWeek())),
    tight: schSlices(buildWeek(schTightWeek())),
    crew: schSlices(generateWeek(generatorInputFor(schCrewInputs(), CREW_WEEK, { today: CREW_WEEK }))),
  };
}

describe("PR SCH: the frozen before-goldens (main's code)", () => {
  it("the stations week, the tight week and the crew week equal their frozen cuts", () => {
    const now = outputs();
    if (process.env.UPDATE_SCH_BEFORE === "1") write(BEFORE, { _header: "PR SCH before-goldens, frozen on main 93172bf1 before any lib change. Never regenerate.", ...now });
    expect(existsSync(BEFORE)).toBe(true);
    const before = JSON.parse(readFileSync(BEFORE, "utf8")) as Record<string, WeekSlices>;
    for (const k of ["stations", "tight", "crew"] as const) expect(canonicalJson(now[k]), k).toBe(canonicalJson(before[k]));
  }, 120000);
});
