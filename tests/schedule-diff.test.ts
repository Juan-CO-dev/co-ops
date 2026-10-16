/**
 * Scheduling Phase 2, Task 12 — "What changed", a pure diff of two week snapshots (plan "What changed").
 */
import { describe, expect, it } from "vitest";
import { diffWeeks, type WeekSnapshot } from "@/lib/scheduling/diff-shared";
import type { DeclaredGap, DayRecord, RuleProblem } from "@/lib/scheduling/rules-shared";
import { P, THU, U, WED, context, shift } from "./fixtures/schedule/rules-fixture";

const people = context().people;
const WAGES = { [U.maya]: 2000, [U.ben]: 1800, [U.iris]: 2200, [U.eli]: 1600 };
const opts = (canSeeMoney: boolean) => ({ people, canSeeMoney, wageCentsByUser: WAGES });
const snap = (shifts: WeekSnapshot["shifts"], gaps: DeclaredGap[] = [], days: DayRecord[] = []): WeekSnapshot => ({ shifts, gaps, days });
const modGap = (date: string, fromQ: number, toQ: number): DeclaredGap => ({ code: "mod_missing", date, positionId: null, fromQ, toQ, cause: "structure", certificate: { rule: "no_mod_member", detail: {} } });
const budgetGap = (date: string, fromQ: number, toQ: number): DeclaredGap => ({
  code: "coverage_gap", date, positionId: P.REG, fromQ, toQ, cause: "budget", certificate: { budgetedDates: [date], budgetHours: 0, usedHours: 0, essentialHours: 0, hoursNeeded: 4 },
});
const prob = (day: string, severity: RuleProblem["severity"], inherited: boolean): RuleProblem => ({ code: severity === "warning" ? "overtime" : severity === "gap" ? "coverage_gap" : "person_overlap", severity, day, params: {}, inherited });

describe("diffWeeks: each change kind", () => {
  const before = snap([
    shift(U.maya, THU, 44, 60, P.REG), shift(U.ben, THU, 44, 60, P.WALKON), shift(U.iris, THU, 64, 83, P.REG, { closingManager: true }),
    shift(U.eli, WED, 44, 60, P.WALK),
  ], [modGap(THU, 60, 64), budgetGap(WED, 60, 64)], [{ date: THU, originRevisionId: "r1", structureVersionId: "sv", inherited: false, problems: [prob(THU, "warning", false), prob(THU, "error", true)] }]);
  const after = snap([
    shift(U.maya, THU, 46, 62, P.REG), shift(U.ben, THU, 44, 60, P.EXPO), shift(U.dani, THU, 60, 83, P.REG, { closingManager: true }), shift(U.iris, THU, 64, 83, P.WALKON),
  ], [modGap(THU, 62, 66)], [{ date: THU, originRevisionId: "r2", structureVersionId: "sv", inherited: false, problems: [prob(THU, "error", true)] }]);
  const d = diffWeeks(before, after, opts(true));

  it("people added / removed, shifts moved (Δstart / Δend), segments relabelled, the Closing Manager changed", () => {
    const thu = d.days.find((x) => x.date === THU)!.changes;
    expect(thu.filter((c) => c.kind === "person_added")).toEqual([{ kind: "person_added", userId: U.dani, startQ: 60, endQ: 83 }]);
    expect(thu.find((c) => c.kind === "shift_moved")).toEqual({ kind: "shift_moved", userId: U.maya, fromStartQ: 44, fromEndQ: 60, toStartQ: 46, toEndQ: 62, deltaStartQ: 2, deltaEndQ: 2 });
    expect(thu.filter((c) => c.kind === "segments_relabelled").map((c) => "userId" in c && c.userId)).toEqual([U.ben, U.iris]);
    expect(thu.find((c) => c.kind === "closing_manager_changed")).toEqual({ kind: "closing_manager_changed", from: U.iris, to: U.dani });
    const wed = d.days.find((x) => x.date === WED)!.changes;
    expect(wed[0]).toEqual({ kind: "person_removed", userId: U.eli, startQ: 44, endQ: 60 });
  });

  it("MoD gaps opened / closed, coverage-gap hours by cause, hourly hours, $ (money viewers), problems new vs inherited", () => {
    const thu = d.days.find((x) => x.date === THU)!.changes;
    expect(thu.filter((c) => c.kind === "mod_gap_opened")).toEqual([{ kind: "mod_gap_opened", fromQ: 64, toQ: 66 }]);
    expect(thu.filter((c) => c.kind === "mod_gap_closed")).toEqual([{ kind: "mod_gap_closed", fromQ: 60, toQ: 62 }]);
    expect(thu.find((c) => c.kind === "hourly_hours")).toEqual({ kind: "hourly_hours", deltaHours: 5.75 }); // Dani 5.75 h added
    expect(thu.find((c) => c.kind === "problems")).toEqual({ kind: "problems", severity: "warning", inherited: false, delta: -1 });
    const wed = d.days.find((x) => x.date === WED)!.changes;
    expect(wed).toContainEqual({ kind: "gap_hours", cause: "budget", deltaHours: -1 });
    expect(wed).toContainEqual({ kind: "cost", deltaCents: -6400 }); // Eli's 4 h at $16
    expect(d.summary).toMatchObject({ added: 1, removed: 1, moved: 1, relabelled: 2, closingManagerChanged: 1, gapHoursDelta: -1, newProblemsDelta: -1, inheritedProblemsDelta: 0 });
    expect(d.summaryLine.key).toBe("schedule.diff.summary");
  });

  it("$ lines are omitted without money permission (no cost change, no costDeltaCents key)", () => {
    const agm = diffWeeks(before, after, opts(false));
    expect(agm.days.flatMap((x) => x.changes).some((c) => c.kind === "cost")).toBe(false);
    expect("costDeltaCents" in agm.summary).toBe(false);
    expect(JSON.stringify(agm)).not.toMatch(/Cents/);
  });

  it("identical snapshots → empty; deterministic order (byte-identical with shuffled inputs)", () => {
    const same = diffWeeks(before, before, opts(true));
    expect(same.days).toEqual([]);
    expect(same.summaryLine).toEqual({ key: "schedule.diff.no_change" });
    const shuffled = snap([...after.shifts].reverse(), [...after.gaps].reverse(), after.days);
    expect(JSON.stringify(diffWeeks({ ...before, shifts: [...before.shifts].reverse() }, shuffled, opts(true)))).toBe(JSON.stringify(d));
  });

  it("a brand-new week (no head) lists everyone as added", () => {
    const fresh = diffWeeks(null, after, opts(true));
    expect(fresh.summary.added).toBe(4);
  });
});
