/**
 * CC chunk H10 P2 ruling (2026-10-17, Astra H9 P2, BC-031 / BC-042) — non-exceeding partitions BEFORE relaxing a limit. `splitRun`
 * considered only the middle and availability edges, so a 10 AM–8 PM station with two people whose soft maxima are 6 h and 4 h
 * went 10 / 0 (the 6 h person took 5 h, then extended past their range), and with 34 / 36 h already worked it went 44 / 36.
 * Now each candidate's remaining room to their soft max and to `overtimeH` is a split point, and every complete non-exceeding
 * partition is tried before any partial one or any later tier.
 */
import { describe, expect, it } from "vitest";
import { buildWeek, type GeneratorOutput, type HeadSnapshot } from "@/lib/scheduling/generator/build-shared";
import type { ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { DATES, I, day, fixture, structure, type PersonSpec } from "./fixtures/schedule/fixtures";

const MON = DATES[0]!;
/** One Register position 10:00 AM–8:00 PM needing one head throughout; no MoD, no BOH, no closing crew. */
function tenHourStation(): ScheduleStructure {
  return structure((s) => {
    s.shopDay = { prepStartQ: 40, prepDishArrivalQ: 40, serviceStartQ: 40, serviceCloseQ: 80, outEarliestQ: 80, outLatestQ: 84 };
    s.positions = { [I.$REG]: { role: "register", openQ: 40, trimQ: 80, closeQ: 80, headsBefore: 1, headsAfter: 1, allowedRoles: ["trainee", "employee", "trainer"] } };
    s.priority = [];
    s.leadership.modRequired = false;
    for (const t of ["slow", "normal", "busy", "weekend"] as const) {
      s.crews[t] = { prepHeads: 0, prepUntilQ: 40, prepDishHeads: 0, waves: { setup: { heads: 1, atQ: 40 }, service: { heads: 0 }, rush: { heads: 0, atQ: 48 } }, close: { registerHeads: 0, walkHeads: 0, prepDishHeads: 0 }, lineMinHeads: { [I.$REG]: 1 } };
    }
  });
}
const weekHours = (out: GeneratorOutput, id: string) => out.shifts.filter((x) => x.userId === id).reduce((n, x) => n + x.endQ - x.startQ, 0) / 4;
const monHours = (out: GeneratorOutput, id: string) => out.shifts.filter((x) => x.userId === id && x.date === MON).reduce((n, x) => n + x.endQ - x.startQ, 0) / 4;

describe("H10 P2: non-exceeding partitions before any soft-max or overtime relaxation", () => {
  it("10 AM–8 PM with soft maxima 6 h and 4 h → 6 / 4, not 10 / 0", () => {
    const s = tenHourStation();
    const specs: PersonSpec[] = [{ id: "u-a", role: "employee", softMin: 0, softMax: 6 }, { id: "u-b", role: "employee", softMin: 0, softMax: 4 }];
    const out = buildWeek(fixture({ structure: s, specs, days: [day(MON, { demandKind: "no_history", hourlyCents: null, dayCents: null, scheduledOutQ: 80 }, s)] }));
    expect(out.gaps).toEqual([]);
    expect([monHours(out, "u-a"), monHours(out, "u-b")]).toEqual([6, 4]);
    expect(out.problems.filter((p) => p.code === "soft_range")).toEqual([]);
  });

  it("with 34 h / 36 h already worked (overtime 40 h) → 40 / 40, not 44 / 36", () => {
    const s = tenHourStation();
    // Four kept days of 8.5 h (34 quarters a day = 34 h) and 9 h (36 quarters = 36 h).
    const kept = (id: string, hours: number): HeadSnapshot["shifts"] => DATES.slice(1, 5).map((d) => ({ userId: id, date: d, startQ: 40, endQ: 40 + hours, segments: [{ positionId: I.$REG, startQ: 40, endQ: 40 + hours }], closingManager: false, flex: false, pinned: false }));
    const head: HeadSnapshot = { revisionId: "rev-0", shifts: [...kept("u-a", 34), ...kept("u-b", 36)], days: [], gaps: [], closingWindowByDate: {} };
    const specs: PersonSpec[] = [{ id: "u-a", role: "employee", softMin: 0, softMax: 40 }, { id: "u-b", role: "employee", softMin: 0, softMax: 40 }];
    const out = buildWeek(fixture({ structure: s, specs, head, days: [day(MON, { demandKind: "no_history", hourlyCents: null, dayCents: null, scheduledOutQ: 80 }, s)] }));
    expect(out.gaps).toEqual([]);
    expect([weekHours(out, "u-a"), weekHours(out, "u-b")]).toEqual([40, 40]);
    expect(out.problems.filter((p) => p.code === "overtime")).toEqual([]);
    expect(out.notes.filter((n) => n.code === "overtime_used")).toEqual([]);
  });
});
