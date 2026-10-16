/**
 * Scheduling Phase 2, Task 12 — the edit operations, pure (the mockup v17 `adjust` / `canSet` / `scaleSegments`;
 * spec §6.5: an edit that breaks a RULE is allowed and returns its problems; only structural failures refuse).
 */
import { describe, expect, it } from "vitest";
import { applyEdit, scaleSegments, type EditOp } from "@/lib/scheduling/edit-shared";
import { ScheduleError } from "@/lib/scheduling/errors-shared";
import type { DayRecord, Shift, WeekSchedule } from "@/lib/scheduling/rules-shared";
import { MON, P, THU, TODAY, U, WED, context, setNeed, shift, structure, week } from "./fixtures/schedule/rules-fixture";

const OPTS = { today: TODAY, newRevisionId: "rev-new" };
const twoPart = (): Shift => ({ ...shift(U.maya, THU, 44, 60, P.REG), segments: [{ positionId: P.REG, startQ: 44, endQ: 52 }, { positionId: P.WALKON, startQ: 52, endQ: 60 }] });
const ref = { date: THU, userId: U.maya, startQ: 44 };
const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return (e as ScheduleError).code; } };
const thuRecord = (origin: string): DayRecord => ({ date: THU, originRevisionId: origin, structureVersionId: "sv-1", inherited: false, problems: [] });

describe("the edits, on 15-minute snaps", () => {
  it("move: the whole shift and its segments by Δ", () => {
    const r = applyEdit(week([twoPart()]), { kind: "move", shift: ref, deltaQ: 4 }, context(), OPTS);
    const sh = r.schedule.shifts[0]!;
    expect([sh.startQ, sh.endQ]).toEqual([48, 64]);
    expect(sh.segments.map((g) => [g.positionId, g.startQ, g.endQ])).toEqual([[P.REG, 48, 56], [P.WALKON, 56, 64]]);
  });

  it("start / end: segments scale proportionally (the mockup's scaleSegments), each ≥ segmentMinQ", () => {
    const end = applyEdit(week([twoPart()]), { kind: "end", shift: ref, toQ: 68 }, context(), OPTS).schedule.shifts[0]!;
    expect(end.segments.map((g) => [g.startQ, g.endQ])).toEqual([[44, 56], [56, 68]]);
    const start = applyEdit(week([twoPart()]), { kind: "start", shift: ref, toQ: 40 }, context(), OPTS).schedule.shifts[0]!;
    expect(start.segments.map((g) => [g.startQ, g.endQ])).toEqual([[40, 50], [50, 60]]);
    expect(scaleSegments(twoPart().segments, 44, 60, 44, 48, 2).map((g) => [g.startQ, g.endQ])).toEqual([[44, 46], [46, 48]]);
    expect(code(() => scaleSegments(twoPart().segments, 44, 60, 44, 47, 2))).toBe("edit_below_segment_min");
  });

  it("divider:i moves the boundary; addShift; removeShift; setSegmentPosition", () => {
    const div = applyEdit(week([twoPart()]), { kind: "divider", shift: ref, index: 1, toQ: 56 }, context(), OPTS).schedule.shifts[0]!;
    expect(div.segments.map((g) => [g.startQ, g.endQ])).toEqual([[44, 56], [56, 60]]);
    const add = applyEdit(week([twoPart()]), { kind: "addShift", date: THU, userId: U.ben, startQ: 60, endQ: 76, positionId: P.WALKON }, context(), OPTS);
    expect(add.schedule.shifts.map((x) => [x.userId, x.startQ, x.endQ])).toEqual([[U.ben, 60, 76], [U.maya, 44, 60]]);
    expect(applyEdit(week([twoPart()]), { kind: "removeShift", shift: ref }, context(), OPTS).schedule.shifts).toEqual([]);
    const relabel = applyEdit(week([twoPart()]), { kind: "setSegmentPosition", shift: ref, index: 1, positionId: P.EXPO }, context(), OPTS).schedule.shifts[0]!;
    expect(relabel.segments.map((g) => g.positionId)).toEqual([P.REG, P.EXPO]);
  });

  it("refusals by name: edit_off_grid, edit_overlap, edit_segments_malformed, edit_below_segment_min, day_locked, shift_over_maximum, position_not_at_shop, person_not_at_shop, head_moved", () => {
    const run = (op: EditOp, shifts: Shift[] = [twoPart()]) => code(() => applyEdit(week(shifts), op, context(), OPTS));
    expect(run({ kind: "end", shift: ref, toQ: 60.5 })).toBe("edit_off_grid");
    expect(run({ kind: "move", shift: ref, deltaQ: 40 })).toBe("edit_off_grid");
    expect(run({ kind: "addShift", date: THU, userId: U.maya, startQ: 58, endQ: 74, positionId: P.REG })).toBe("edit_overlap");
    expect(run({ kind: "divider", shift: ref, index: 2, toQ: 56 })).toBe("edit_segments_malformed");
    expect(run({ kind: "divider", shift: ref, index: 1, toQ: 64 })).toBe("edit_segments_malformed");
    expect(run({ kind: "divider", shift: ref, index: 1, toQ: 59 })).toBe("edit_below_segment_min");
    expect(run({ kind: "removeShift", shift: { date: MON, userId: U.maya, startQ: 44 } }, [shift(U.maya, MON, 44, 60, P.REG)])).toBe("day_locked");
    expect(run({ kind: "end", shift: ref, toQ: 87 })).toBe("shift_over_maximum"); // 43 quarters > 10.5 h — CC chunk B ruling 3 (HARD), default per chunk C ruling 2
    expect(run({ kind: "end", shift: ref, toQ: 86 })).not.toBe("shift_over_maximum"); // exactly 10.5 h is allowed
    expect(run({ kind: "setSegmentPosition", shift: ref, index: 0, positionId: "elsewhere" })).toBe("position_not_at_shop");
    expect(run({ kind: "addShift", date: THU, userId: U.tess, startQ: 60, endQ: 76, positionId: P.REG })).toBe("person_not_at_shop");
    expect(run({ kind: "move", shift: { ...ref, startQ: 40 }, deltaQ: 4 })).toBe("head_moved");
  });

  it("an edit that creates RULE problems is ALLOWED and returns them (unlike the mockup, which silently rejects — J6)", () => {
    const r = applyEdit(week([twoPart()]), { kind: "end", shift: ref, toQ: 52 }, context(), OPTS); // 2 h: below the 4 h minimum
    expect(r.problems.map((p) => p.code)).toContain("shift_below_minimum");
    expect(r.schedule.shifts[0]!.endQ).toBe(52);
    const dani = applyEdit(week([]), { kind: "addShift", date: THU, userId: U.dani, startQ: 28, endQ: 44, positionId: P.DISH }, context(), OPTS);
    expect(dani.problems.map((p) => p.code)).toEqual(expect.arrayContaining(["manager_on_boh", "role_not_allowed"]));
  });
});

describe("history and the current context", () => {
  it("an edit never touches an inherited past day: its shifts, gaps and record stay byte-identical", () => {
    const past = shift(U.ben, MON, 44, 60, P.REG);
    const monRecord: DayRecord = { date: MON, originRevisionId: "rev-old", structureVersionId: "sv-old", inherited: true, problems: [{ code: "not_member", severity: "error", day: MON, params: {}, inherited: true }] };
    const s: WeekSchedule = { ...week([past, twoPart()]), days: [monRecord, thuRecord("rev-1")] };
    const r = applyEdit(s, { kind: "move", shift: ref, deltaQ: 2 }, context(), OPTS);
    expect(r.schedule.shifts.find((x) => x.date === MON)).toEqual(past);
    expect(r.schedule.days.find((d) => d.date === MON)).toEqual(monRecord);
  });

  it("an edit to a future day re-validates it under the CURRENT context and resets its originRevisionId to the new revision", () => {
    const s: WeekSchedule = { ...week([twoPart()]), days: [thuRecord("rev-1")] };
    const live = context({ s: structure((x) => { x.limits.minimumShiftQ = 20; }) }); // the live structure now asks 5 h
    const r = applyEdit(s, { kind: "move", shift: ref, deltaQ: 1 }, live, OPTS);
    expect(r.day).toMatchObject({ date: THU, originRevisionId: "rev-new", inherited: false });
    expect(r.problems.map((p) => p.code)).toContain("shift_below_minimum"); // 4 h under the CURRENT 5 h rule
    expect(r.schedule.days.find((d) => d.date === THU)!.originRevisionId).toBe("rev-new");
  });

  it("a hole the edit opens is re-declared with its proof when one exists; otherwise it stays an undeclared gap the board shows", () => {
    const ctx = context({ s: structure((x) => { x.positions[P.REG]!.allowedRoles = ["trainer"]; }) });
    setNeed(ctx, THU, P.REG, 44, 60);
    // Maya is the only person who may work Register and (live) is no longer available then: removing her shift opens a
    // hole that is PROVEN (the counting bound: 1 head needed, 0 eligible people available), declared with its certificate.
    ctx.people[U.maya]!.availability[THU] = { fromQ: 28, toQ: 44, source: "toast_pattern" };
    const r = applyEdit(week([shift(U.maya, THU, 44, 60, P.REG)]), { kind: "removeShift", shift: ref }, ctx, OPTS);
    expect(r.gaps.map((g) => [g.code, g.positionId, g.fromQ, g.toQ, g.cause])).toEqual([["coverage_gap", P.REG, 44, 60, "capacity"]]);
    expect(r.problems.filter((p) => p.code === "undeclared_gap")).toEqual([]);
    const open = context();
    setNeed(open, THU, P.REG, 44, 60);
    const r2 = applyEdit(week([shift(U.maya, THU, 44, 60, P.REG)]), { kind: "removeShift", shift: ref }, open, OPTS);
    expect(r2.problems.map((p) => p.code)).toContain("undeclared_gap"); // free people exist: no proof — the manager sees it
    expect(r2.gaps).toEqual([]);
    void WED;
  });
});
