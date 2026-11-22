/**
 * PR SCH (plan r5, 12.4, 20.3, 22.2; rulings A3, C3, D3, E1): the crew engine (P Street's live engine) on a heavy day and on
 * an opened date, through the P Street acceptance fixture.
 *  (a) the LIVE configuration (crewShift absent, mode manual) with heavy days changes nothing — pinned byte for byte in
 *      tests/schedule-sch-goldens.test.ts; here the real fixture's availability fact is pinned (nobody before 7:00);
 *  (b) crewShift on: one more Opener on the heavy-by-total day, none on a 25-guest day;
 *  (c) an accepted opening at 5:30 on the EARLY-AVAILABLE variant: the typed shifts flex only as far as their own range
 *      (6:30), the manager-on-duty hole before it is a proven `no_mod_member` piece with the `crew_mod_start_mismatch` note,
 *      Prep and Prep/Dishwasher are proven `crew_shortfall` from 5:30, Approve is not blocked, and a hand-added 5:30 Prep
 *      shift validates with no error and is typed by overlap;
 *  (iii) the same opening on the REAL fixture, frozen from the implementation (E1 widens only estimated availability).
 */
import { describe, expect, it } from "vitest";
import type { RuleContext } from "@/lib/scheduling/context-shared";
import { crewOpenItems, crewRequired } from "@/lib/scheduling/crew-gap-verifier-shared";
import { applyEdit, revalidateDay } from "@/lib/scheduling/edit-shared";
import { generateWeek } from "@/lib/scheduling/generator/dispatch-shared";
import { generatorInputFor, type SchedulingInputs } from "@/lib/scheduling/inputs-shared";
import { legalHoldPath } from "@/lib/scheduling/people-rules-shared";
import { approvalRefusal, atDayCap, maxDaysPerWeek, type WeekSchedule } from "@/lib/scheduling/rules-shared";
import { shiftTypesOf } from "@/lib/scheduling/structure-shared";
import { acceptanceInputs, crewPStreetEarly, DATES, WEEK, personId } from "./fixtures/schedule/crew-p-street-2026-10-19";
import { schCrewInputs } from "./fixtures/schedule/sch-fixtures";

const TUE = DATES[1]!;
const PREP = "position-6";
const DISH = "position-8";
const OPEN_530 = { date: TUE, decision: { kind: "accepted" as const, startQ: 22 } };
const run = (inputs: SchedulingInputs, override?: typeof OPEN_530) => generateWeek(generatorInputFor(inputs, WEEK, { today: WEEK, ...(override ? { openingOverride: override } : {}) }));
const week = (out: ReturnType<typeof run>): WeekSchedule => ({ locationId: "shop-p-street", weekStart: WEEK, shifts: out.shifts, gaps: out.gaps, days: out.days });
const gapsOn = (out: ReturnType<typeof run>, date: string) => out.gaps.filter((g) => g.date === date);

describe("(a) the real fixture cannot start early (D3 i)", () => {
  it("with no opening, the earliest availability is 7:00 (q28) on every date", () => {
    const g = generatorInputFor(acceptanceInputs(), WEEK, { today: WEEK });
    for (const d of DATES) expect(Math.min(...g.people.map((p) => p.availability[d]?.fromQ ?? 96)), d).toBe(28);
  });
});

describe("(b) crewShift on: the extra people follow the day total", () => {
  it("one more Opener on the heavy-by-total Tuesday (3 × 20), none on a 25-guest Monday", () => {
    const inputs = schCrewInputs();
    inputs.catering.push({ id: "crew-ev-mon-0", date: DATES[0]!, name: "Order", headcount: 25, valueCents: null, eventQ: 36 });
    inputs.structure.structure.catering.crewShift = { enabled: true, typeId: "opener", extraHeads: 1 };
    const out = run(inputs);
    const opener = shiftTypesOf(out.context.days[TUE]!.structure).find((t) => t.id === "opener")!;
    const base = opener.headcount[out.context.days[TUE]!.dayType];
    expect(crewRequired(opener, out.context.days[TUE]!)).toBe(base + 1);
    expect(crewRequired(opener, out.context.days[DATES[0]!]!)).toBe(opener.headcount[out.context.days[DATES[0]!]!.dayType]);
    // Every required Opener seat on Tuesday is placed or a proven open shift.
    const placed = out.context.days[TUE]!.crew!.shifts.filter((m) => m.typeId === "opener").length;
    const open = crewOpenItems(TUE, week(out), out.context).find((i) => i.typeId === "opener");
    expect(placed + (open?.missing ?? 0)).toBe(base + 1);
    expect(out.gaps.filter((g) => g.cause === "unresolved_search")).toEqual([]);
  }, 60000);
});

describe("(c) an accepted opening at 5:30 on the early-available variant", () => {
  const out = run(crewPStreetEarly(), OPEN_530);
  const day = out.context.days[TUE]!;

  it("the date's structure opens at 5:30, and its opening is stored", () => {
    expect(day.opening).toMatchObject({ status: "accepted", startQ: 22, normalStartQ: 28 });
    expect(day.structure.shopDay.prepStartQ).toBe(22);
    expect([day.structure.positions[PREP]!.openQ, day.structure.positions[DISH]!.openQ]).toEqual([22, 22]);
    expect(day.base).toMatchObject({ prepStartQ: 28 });
  });

  it("the typed shifts flex only as far as their own range: nobody before 6:30, and the GM's Opener flexes to 6:30", () => {
    expect(out.shifts.filter((s) => s.date === TUE).every((s) => s.startQ >= 26)).toBe(true);
    expect(out.shifts.find((s) => s.date === TUE && s.userId === personId("J"))).toMatchObject({ startQ: 26 });
  });

  it("the manager-on-duty hole 5:30–6:30 is a proven no_mod_member piece with the crew_mod_start_mismatch note; nothing else of it is left", () => {
    const mod = gapsOn(out, TUE).filter((g) => g.code === "mod_missing");
    expect(mod).toEqual([expect.objectContaining({ fromQ: 22, toQ: 26, cause: "structure", certificate: { rule: "no_mod_member", detail: { earliestTypeStartQ: 26 } } })]);
    expect(out.notes).toContainEqual(expect.objectContaining({ code: "crew_mod_start_mismatch", date: TUE, params: expect.objectContaining({ earliestQ: 26 }) }));
  });

  it("Prep and Prep/Dishwasher are proven crew_shortfall from 5:30 until someone holds them", () => {
    for (const id of [PREP, DISH]) {
      const first = gapsOn(out, TUE).filter((g) => g.code === "coverage_gap" && g.positionId === id).sort((a, b) => a.fromQ - b.fromQ)[0];
      expect(first, id).toMatchObject({ fromQ: 22, cause: "crew_shortfall" });
    }
    expect(gapsOn(out, TUE).filter((g) => g.cause === "unresolved_search")).toEqual([]);
  });

  it("every piece is proven, so Approve is not blocked", () => {
    expect(approvalRefusal(week(out), out.problems)).toBeNull();
  });

  it("a hand-added 5:30 Prep shift validates with no error and is typed by overlap (the Opener)", () => {
    const ctx = structuredClone(out.context) as RuleContext;
    const who = Object.values(ctx.people).filter((p) => !out.shifts.some((s) => s.date === TUE && s.userId === p.userId)
      && (p.availability[TUE]?.fromQ ?? 96) <= 22 && legalHoldPath(p, PREP, ctx.days[TUE]!, TUE, 22) === "eligible"
      && !atDayCap(p, week(out), TUE, maxDaysPerWeek(ctx.days[TUE]!.structure))).map((p) => p.userId).sort()[0];
    expect(who).toBeDefined();
    const r = applyEdit(week(out), { kind: "addShift", date: TUE, userId: who!, startQ: 22, endQ: 56, positionId: PREP }, ctx, { today: WEEK, newRevisionId: "rev-hand" });
    expect(r.problems.filter((p) => p.severity === "error" && p.userId === who)).toEqual([]);
    expect(r.problems.filter((p) => p.code === "segment_outside_window")).toEqual([]);
    expect(ctx.days[TUE]!.crew!.shifts.find((m) => m.userId === who && m.startQ === 22)).toMatchObject({ typeId: "opener", source: "manual" });
  });
});

describe("(iii) the same opening on the REAL fixture (frozen from the implementation)", () => {
  it("estimated availability widens to 5:30 on the opened date only; a lead covers the manager on duty from 6:30; the 5:30–6:30 hole is the proven structure piece", () => {
    const real = run(acceptanceInputs(), OPEN_530);
    const g = generatorInputFor(acceptanceInputs(), WEEK, { today: WEEK, openingOverride: OPEN_530 });
    expect(Math.min(...g.people.map((p) => p.availability[TUE]?.fromQ ?? 96))).toBe(22);
    for (const d of DATES.filter((x) => x !== TUE)) expect(Math.min(...g.people.map((p) => p.availability[d]?.fromQ ?? 96)), d).toBe(28);
    expect(real.shifts.find((s) => s.date === TUE && s.userId === personId("Islam"))).toMatchObject({ startQ: 26 });
    expect(gapsOn(real, TUE).filter((x) => x.code === "mod_missing").map((x) => [x.fromQ, x.toQ, x.cause])).toEqual([[22, 26, "structure"]]);
    expect(approvalRefusal(week(real), real.problems)).toBeNull();
  }, 60000);
});

describe("D2 flow on both P Street fixtures: accept before regenerating → Approve → regenerate → an ordinary edit on the date → Approve", () => {
  for (const [name, inputs, lead] of [["early-available variant", crewPStreetEarly, "J"], ["real fixture", acceptanceInputs, "Islam"]] as const) {
    it(`${name}: the declared pieces follow the partition at every step; Approve succeeds exactly when every piece is proven`, () => {
      // 1. The week as built with the normal opening; then the opening is accepted WITHOUT moving shifts (setDayOpening's tail).
      const built = run(inputs());
      const liveCtx = run(inputs(), OPEN_530).context; // the date's live context with the decision (what setDayOpening builds)
      const ctx = { ...liveCtx, days: { [TUE]: { ...liveCtx.days[TUE]!, crew: structuredClone(built.context.days[TUE]!.crew!) } } } as RuleContext;
      const accepted = revalidateDay(week(built), built.shifts.map((s) => ({ ...s, segments: s.segments.map((g) => ({ ...g })) })), TUE, ctx, { newRevisionId: "rev-open" });
      const mod1 = accepted.schedule.gaps.filter((g) => g.date === TUE && g.code === "mod_missing").map((g) => [g.fromQ, g.toQ, g.cause]);
      expect(mod1).toEqual([[22, 26, "structure"]]);
      // The 6:30–7:00 remainder has no proof (a lead COULD be there): left undeclared, so Approve is refused honestly.
      expect(accepted.problems.some((p) => p.code === "undeclared_gap" && p.params.gap === "mod_missing" && Number(p.params.fromQ) === 26)).toBe(true);
      expect(approvalRefusal(accepted.schedule, accepted.problems)).toBe("rules_failing");
      // 2. Regenerate with the decision: the lead's typed shift flexes to 6:30; every piece is proven.
      const regenerated = run(inputs(), OPEN_530);
      expect(regenerated.shifts.find((s) => s.date === TUE && s.userId === personId(lead))).toMatchObject({ startQ: 26 });
      expect(approvalRefusal(week(regenerated), regenerated.problems)).toBeNull();
      // 3. An ordinary edit on that date (a PM shift ends 15 minutes earlier): the same pieces, still approvable.
      const pm = regenerated.shifts.find((s) => s.date === TUE && s.startQ >= 60)!;
      const edited = applyEdit(week(regenerated), { kind: "end", shift: { date: TUE, userId: pm.userId, startQ: pm.startQ }, toQ: pm.endQ - 1 }, structuredClone(regenerated.context) as RuleContext, { today: WEEK, newRevisionId: "rev-edit" });
      expect(edited.schedule.gaps.filter((g) => g.date === TUE && g.code === "mod_missing").map((g) => [g.fromQ, g.toQ, g.cause])).toEqual([[22, 26, "structure"]]);
      expect(edited.schedule.gaps.filter((g) => g.cause === "unresolved_search")).toEqual([]);
      expect(approvalRefusal(edited.schedule, [...edited.problems, ...regenerated.problems.filter((p) => p.day !== TUE)])).toBeNull();
    }, 60000);
  }
});
