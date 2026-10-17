/**
 * CC chunk H11 (2026-10-17, Astra H10 P2, BC-031 / BC-042, spec §6.2) — backtrack candidates inside each partition. H10 tried every
 * split point, but each point filled the FIRST part greedily before looking at the second, so "every boundary" was not "every
 * complete non-exceeding partition". Astra's repro: one station 10 AM–8 PM; A available all day (soft max 6 h), B only 10 AM–2 PM
 * (soft max 4 h) → A 10 h / B 0 h, though B 10–2 + A 2–8 (6 / 4) validates clean. Now each point tries the first part's ranked
 * candidates in turn (bounded, counted against the repair budget) until the second part fills too; only when no complete
 * non-exceeding pair exists anywhere does it fall back to a partial fill and the relaxation tiers.
 */
import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/lib/scheduling/context-shared";
import { buildWeek, type GeneratorInput, type GeneratorOutput, type HeadSnapshot } from "@/lib/scheduling/generator/build-shared";
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
const MORNING = { fromQ: 40, toQ: 56 }; // 10 AM – 2 PM
const monday = (s: ScheduleStructure) => [day(MON, { demandKind: "no_history", hourlyCents: null, dayCents: null, scheduledOutQ: 80 }, s)];
const monHours = (out: GeneratorOutput, id: string) => out.shifts.filter((x) => x.userId === id && x.date === MON).reduce((n, x) => n + x.endQ - x.startQ, 0) / 4;
const weekHours = (out: GeneratorOutput, id: string) => out.shifts.filter((x) => x.userId === id).reduce((n, x) => n + x.endQ - x.startQ, 0) / 4;
const clean = (out: GeneratorOutput) => {
  expect(out.gaps).toEqual([]);
  expect(out.problems.filter((p) => p.code === "soft_range" || p.code === "overtime")).toEqual([]);
  expect(out.notes.filter((n) => n.code === "overtime_used")).toEqual([]);
};

function twoPeople(): GeneratorInput {
  const s = tenHourStation();
  const specs: PersonSpec[] = [{ id: "u-a", role: "employee", softMin: 0, softMax: 6 }, { id: "u-b", role: "employee", softMin: 0, softMax: 4, window: MORNING }];
  return fixture({ structure: s, specs, days: monday(s) });
}

describe("H11: candidate backtracking inside each partition", () => {
  it("A all day (soft max 6 h), B 10 AM–2 PM (soft max 4 h) → B 10–2, A 2–8: 6 / 4, not 10 / 0", () => {
    const out = buildWeek(twoPeople());
    clean(out);
    expect([monHours(out, "u-a"), monHours(out, "u-b")]).toEqual([6, 4]);
    expect(out.shifts.find((x) => x.userId === "u-b")).toMatchObject({ startQ: 40, endQ: 56 });
  });

  it("a third morning-only candidate (soft max 4 h) does not break it: A 6 h, the morning held by one of B / C", () => {
    const s = tenHourStation();
    const specs: PersonSpec[] = [
      { id: "u-a", role: "employee", softMin: 0, softMax: 6 }, { id: "u-b", role: "employee", softMin: 0, softMax: 4, window: MORNING },
      { id: "u-c", role: "employee", softMin: 0, softMax: 4, window: MORNING },
    ];
    const out = buildWeek(fixture({ structure: s, specs, days: monday(s) }));
    clean(out);
    expect(monHours(out, "u-a")).toBe(6);
    expect(monHours(out, "u-b") + monHours(out, "u-c")).toBe(4);
  });

  it("with 34 h / 36 h already worked (B mornings only on Monday) → 40 / 40, no overtime", () => {
    const s = tenHourStation();
    // Four kept days of 8.5 h (34 quarters a day = 34 h) and 9 h (36 quarters = 36 h).
    const kept = (id: string, perDayQ: number): HeadSnapshot["shifts"] => DATES.slice(1, 5).map((d) => ({ userId: id, date: d, startQ: 40, endQ: 40 + perDayQ, segments: [{ positionId: I.$REG, startQ: 40, endQ: 40 + perDayQ }], closingManager: false, flex: false, pinned: false }));
    const head: HeadSnapshot = { revisionId: "rev-0", shifts: [...kept("u-a", 34), ...kept("u-b", 36)], days: [], gaps: [], closingWindowByDate: {} };
    const specs: PersonSpec[] = [{ id: "u-a", role: "employee", softMin: 0, softMax: 40 }, { id: "u-b", role: "employee", softMin: 0, softMax: 40, window: MORNING }];
    const out = buildWeek(fixture({ structure: s, specs, head, days: monday(s) }));
    clean(out);
    expect([weekHours(out, "u-a"), weekHours(out, "u-b")]).toEqual([40, 40]);
  });

  it("determinism: the roster order shuffled gives the byte-identical week", () => {
    const input = twoPeople();
    const a = buildWeek(input);
    const b = buildWeek({ ...input, people: [...input.people].reverse() });
    expect(canonicalJson(b)).toBe(canonicalJson(a));
    expect(canonicalJson(buildWeek(input))).toBe(canonicalJson(a));
  });
});
