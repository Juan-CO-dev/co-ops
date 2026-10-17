/**
 * CC chunk H9 fix 2 (2026-10-17) — the interim TWO DAYS OFF (spec §5.1). The sim walk (p2.12) put trainees and trainers on
 * 7 days / 42 h because Phase 2 fed days-off [] and a new hire with < 3 observed weeks is assumed available every day.
 *  - The validator: `max_days_per_week` — an HOURLY person on more than `maxDaysPerWeek` dates (5) is a WARNING on any week
 *    (a manager's hand edit), and the generator keeps it HARD (`GENERATOR_HARD_WARNINGS`, the salaried-week pattern).
 *  - The proofs agree: an hourly person already on their 5th date cannot be added on another date, so for that date they are
 *    `unavailable` to every certificate (a floor_limit / availability / capacity proof is never refused by a sixth day).
 *  - The generator's off days: the person's LOWEST-OBSERVED weekdays from punches (`observedDowShare`), else the
 *    LOWEST-DEMAND days, else a per-person rotation; preferred, relaxed only when nobody else fits; the 5-date cap never.
 * Untouchable / flex days stay inert (Phase 3).
 */
import { describe, expect, it } from "vitest";
import {
  GENERATOR_HARD_WARNINGS, MAX_DAYS_PER_WEEK, RULE_CODES, atDayCap, checkScheduleRules, floorCandidateStatus, generatorRefuses,
} from "@/lib/scheduling/rules-shared";
import { buildWeek } from "@/lib/scheduling/generator/build-shared";
import { assumedAvailability, punchPatterns, toSchedPeople, type PunchEntry } from "@/lib/scheduling/people-input-shared";
import { DATES as FX_DATES, day, fixture, normalCurve, structure as fxStructure, type PersonSpec } from "./fixtures/schedule/fixtures";
import { perPersonWeek, simShapeInput } from "./fixtures/schedule/sim-shape";
import { DATES, P, U, context, setNeed, shift, week } from "./fixtures/schedule/rules-fixture";

const sixDays = (userId: string) => DATES.slice(0, 6).map((d) => shift(userId, d, 44, 60, P.REG));

describe("H9 fix 2: the validator's two-days-off rule", () => {
  it("max_days_per_week is a WARNING the generator keeps hard; the limit is 5 until the shop setting lands (0276)", () => {
    expect(RULE_CODES.max_days_per_week).toBe("warning");
    expect(GENERATOR_HARD_WARNINGS.has("max_days_per_week")).toBe(true);
    expect(generatorRefuses({ code: "max_days_per_week", severity: "warning" })).toBe(true);
    expect(MAX_DAYS_PER_WEEK).toBe(5);
  });

  it("an hourly person on 6 dates is flagged once (on their last built date); 5 dates is clean; salaried people are not counted", () => {
    const ctx = context({ built: [...DATES] });
    const six = checkScheduleRules(week(sixDays(U.ben)), ctx).filter((p) => p.code === "max_days_per_week");
    expect(six).toEqual([expect.objectContaining({ code: "max_days_per_week", severity: "warning", userId: U.ben, day: DATES[5], params: { days: 6, limit: 5 } })]);
    const five = checkScheduleRules(week(sixDays(U.ben).slice(0, 5)), ctx).filter((p) => p.code === "max_days_per_week");
    expect(five).toEqual([]);
    const gm = checkScheduleRules(week(DATES.slice(0, 6).map((d) => shift(U.alex, d, 30, 62, "mod"))), ctx).filter((p) => p.code === "max_days_per_week");
    expect(gm).toEqual([]);
  });

  it("inherited dates count toward the cap but the warning lands on a built date", () => {
    const ctx = context(); // built = Wed–Sun; Mon / Tue inherited
    const inherited = DATES.slice(0, 2).map((date) => ({ date, originRevisionId: "rev-0", structureVersionId: "sv-1", inherited: true, problems: [] }));
    const got = checkScheduleRules(week(sixDays(U.ben), [], inherited), ctx).filter((p) => p.code === "max_days_per_week");
    expect(got).toHaveLength(1);
    expect(got[0]!.day).toBe(DATES[5]);
  });

  it("atDayCap: an hourly person working 5 other dates is capped for a 6th date, never for a date they already work", () => {
    const ctx = context({ built: [...DATES] });
    const s = week(sixDays(U.ben).slice(0, 5));
    const ben = ctx.people[U.ben]!;
    expect(atDayCap(ben, s, DATES[5]!)).toBe(true);
    expect(atDayCap(ben, s, DATES[0]!)).toBe(false);
    expect(atDayCap(ctx.people[U.alex]!, week(DATES.slice(0, 5).map((d) => shift(U.alex, d, 30, 62, "mod"))), DATES[5]!)).toBe(false);
  });

  it("a floor_limit candidate on their 5th date elsewhere is UNAVAILABLE for the 6th (the proof agrees with the cap)", () => {
    const ctx = context({ built: [...DATES] });
    setNeed(ctx, DATES[5]!, P.REG, 44, 52);
    const g = { date: DATES[5]!, positionId: P.REG, fromQ: 44, toQ: 52 };
    expect(floorCandidateStatus(ctx.people[U.ben]!, g, week([]), ctx)).toBeNull();
    expect(floorCandidateStatus(ctx.people[U.ben]!, g, week(sixDays(U.ben).slice(0, 5)), ctx)).toBe("unavailable");
  });
});

describe("H9 fix 2: the generator never plans a 6th date for an hourly person", () => {
  it("the sim-shaped P Street week: every hourly person works at most 5 dates (p2.12 had trainees on 7)", () => {
    const input = simShapeInput();
    const out = buildWeek(input);
    for (const r of perPersonWeek(input, out.shifts)) expect(r.days, r.userId).toBeLessThanOrEqual(5);
    expect(out.problems.filter((p) => p.code === "max_days_per_week")).toEqual([]);
  });

  it("off days: the person's LOWEST-OBSERVED weekdays win (punch share), else the lowest-demand days", () => {
    const s = fxStructure();
    // One all-day person and a big need every day: they would work all 7 dates without the rule.
    const specs: PersonSpec[] = [{ id: "u-a", role: "employee", softMin: 0, softMax: 80 }];
    const busy = (i: number) => normalCurve(i === 2 ? 0.5 : i === 4 ? 0.6 : 1 + i / 10);
    const days = FX_DATES.map((d, i) => day(d, { hourlyCents: busy(i), dayCents: busy(i).reduce((a, b) => a + b, 0) }, s));
    // Demand fallback: Wed (index 2) and Fri (index 4) are the slowest dates → off.
    const byDemand = buildWeek(fixture({ structure: s, specs, days }));
    expect(new Set(byDemand.shifts.filter((x) => x.userId === "u-a").map((x) => x.date))).toEqual(new Set(FX_DATES.filter((_, i) => i !== 2 && i !== 4)));
    // Punch share: Monday and Tuesday are rarely worked → those are the off days, whatever the demand says.
    const input = fixture({ structure: s, specs, days });
    input.people[0]!.observedDowShare = { 1: 0.3, 2: 0.4, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 };
    const byPunch = buildWeek(input);
    expect(new Set(byPunch.shifts.filter((x) => x.userId === "u-a").map((x) => x.date))).toEqual(new Set(FX_DATES.slice(2)));
  });

  it("people input: observedDowShare carries the punch share for weekdays with >= 3 observed weeks only", () => {
    const entries: PunchEntry[] = [];
    // u-1 works Mondays in 4 of 4 weeks and Tuesdays in 1 of 4 (the shop punches both days every week via u-2).
    for (const w of ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"]) {
      const tue = w.replace(/(\d\d)$/, (m) => String(Number(m) + 1).padStart(2, "0"));
      entries.push({ userId: "u-1", businessDate: w, inAt: `${w}T15:00:00Z`, outAt: `${w}T21:00:00Z`, hours: 6, deleted: false });
      entries.push({ userId: "u-2", businessDate: tue, inAt: `${tue}T15:00:00Z`, outAt: `${tue}T21:00:00Z`, hours: 6, deleted: false });
      if (w === "2026-10-12") entries.push({ userId: "u-1", businessDate: tue, inAt: `${tue}T15:00:00Z`, outAt: `${tue}T21:00:00Z`, hours: 6, deleted: false });
    }
    const patterns = punchPatterns(entries, { asOf: "2026-10-19" });
    const { people } = toSchedPeople({
      members: [{ userId: "u-1", role: "employee", active: true }], settings: [], patterns, dates: ["2026-10-19"], structure: fxStructure(),
      shopDay: { fromQ: 28, toQ: 84 }, wages: { byUserCents: {}, estimateHourlyCents: null }, skills: null,
    });
    expect(people[0]!.observedDowShare).toEqual({ 1: 1, 2: 0.25 });
    void assumedAvailability;
  });
});
