/**
 * Scheduling Phase 2, Task 12 — the planning horizon, pure (spec §5.8, plan "Horizon").
 */
import { describe, expect, it } from "vitest";
import { horizonActions, planHorizon } from "@/lib/scheduling/horizon-shared";
import { ScheduleError } from "@/lib/scheduling/errors-shared";

const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return (e as ScheduleError).code; } };

describe("planHorizon", () => {
  it("next_week from Wed 2026-10-21 → the week of 10-26, all 7 days built", () => {
    expect(planHorizon({ mode: "next_week" }, "2026-10-21")).toEqual([
      { weekStart: "2026-10-26", buildDays: ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"], keptDays: [], weeksAhead: 1, confidence: "normal" },
    ]);
  });

  it("rest_of_month from 10-27 → week 10-26: build 28–31 (from TOMORROW), keep 26–27 and Nov 1 (inherited)", () => {
    expect(planHorizon({ mode: "rest_of_month" }, "2026-10-27")).toEqual([
      { weekStart: "2026-10-26", buildDays: ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"], keptDays: ["2026-10-26", "2026-10-27", "2026-11-01"], weeksAhead: 0, confidence: "normal" },
    ]);
    expect(code(() => planHorizon({ mode: "rest_of_month" }, "2026-10-31"))).toBe("horizon_invalid"); // nothing left this month
  });

  it("month 2026-11 → 6 ISO weeks touched, with a partial first (Nov 1 only) and last (Nov 30 only) week", () => {
    const weeks = planHorizon({ mode: "month", month: "2026-11" }, "2026-10-21");
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(weeks[0]!.buildDays).toEqual(["2026-11-01"]);
    expect(weeks[0]!.keptDays).toHaveLength(6);
    expect(weeks[5]!.buildDays).toEqual(["2026-11-30"]);
    // The current month builds from tomorrow only.
    expect(planHorizon({ mode: "month", month: "2026-10" }, "2026-10-29")[0]!.buildDays).toEqual(["2026-10-30", "2026-10-31"]);
  });

  it("n = 7 → horizon_too_long; n < 2, a past month, a month after next, a bad month → horizon_invalid", () => {
    expect(code(() => planHorizon({ mode: "next_weeks", n: 7 }, "2026-10-21"))).toBe("horizon_too_long");
    expect(code(() => planHorizon({ mode: "next_weeks", n: 1 }, "2026-10-21"))).toBe("horizon_invalid");
    expect(code(() => planHorizon({ mode: "next_weeks", n: 2.5 }, "2026-10-21"))).toBe("horizon_invalid");
    expect(code(() => planHorizon({ mode: "month", month: "2026-09" }, "2026-10-21"))).toBe("horizon_invalid");
    expect(code(() => planHorizon({ mode: "month", month: "2026-12" }, "2026-10-21"))).toBe("horizon_invalid");
    expect(code(() => planHorizon({ mode: "month", month: "2026-13" }, "2026-10-21"))).toBe("horizon_invalid");
    expect(planHorizon({ mode: "next_weeks", n: 6 }, "2026-10-21")).toHaveLength(6);
  });

  it("a week two or more ahead is further_out (the forecast weakens)", () => {
    expect(planHorizon({ mode: "next_weeks", n: 3 }, "2026-10-21").map((w) => [w.weeksAhead, w.confidence])).toEqual([[1, "normal"], [2, "further_out"], [3, "further_out"]]);
  });

  it("horizonActions: unconfirmed edited weeks are listed as SKIPPED, never overwritten; a confirmed one asks Tier B", () => {
    const weeks = planHorizon({ mode: "next_weeks", n: 3 }, "2026-10-21");
    const heads = { "2026-11-02": { edited: true }, "2026-11-09": { edited: true }, "2026-10-26": { edited: false } };
    const a = horizonActions(weeks, heads, ["2026-11-09"]);
    expect(a.build.map((w) => w.weekStart)).toEqual(["2026-10-26", "2026-11-09"]);
    expect(a.skipped).toEqual([{ weekStart: "2026-11-02", code: "edited_week_unconfirmed" }]);
    expect(a.overwritesEdits).toBe(true);
    expect(horizonActions(weeks, {}, []).overwritesEdits).toBe(false);
  });
});
