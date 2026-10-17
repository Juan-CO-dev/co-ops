/**
 * Scheduling Phase 2, Task 3 — the validator `checkScheduleRules` (plan "The validator ↔ mockup
 * invariants map"): one positive and one negative case for EVERY code, the gap certificates per cause
 * (r2 P1-1, r3 capacity + unresolved_search, r4 Approve), original vs current validation (r3 P2-4,
 * r4), the historical contract (r2 P1-3), deterministic order and a complexity guard.
 */
import { describe, expect, it } from "vitest";
import {
  CALLOUT_LAST_RESORT, RULE_CODES, REPAIR_LIMITS, approvalRefusal, capacityBound, checkCertificate, checkScheduleRules,
  cheapestFill, fillIsLegal, proveGap, structureInfeasible, type DeclaredGap, type RuleCode, type RuleProblem,
  SALARIED_FLEX_REASON, CATERING_MANAGER_COVER, cateringWindows, zeroCostCovers, applyFillSteps, salariedWeek,
} from "@/lib/scheduling/rules-shared";
import { contextAdvisory, ruleContextFromSnapshot, toContextSnapshot, type RuleContext } from "@/lib/scheduling/context-shared";
import type { ScheduleStructure } from "@/lib/scheduling/structure-shared";
import {
  DATES, FRI, MON, P, SAT, SUN, THU, TUE, U, WED, context, setNeed, shift, structure, week,
} from "./fixtures/schedule/rules-fixture";

const run = (shifts = [] as ReturnType<typeof shift>[], ctx: RuleContext = context(), gaps: DeclaredGap[] = []) =>
  checkScheduleRules(week(shifts, gaps), ctx);
/** A budget_limited gap exactly as the search proves it (the witness is the search's own), or a forged one for refusals. */
const proven = (subject: Omit<DeclaredGap, "cause" | "certificate">, s: ReturnType<typeof week>, ctx: RuleContext): DeclaredGap => {
  const got = proveGap(subject, s, ctx);
  expect(got?.cause).toBe("budget_limited");
  return { ...subject, ...got! } as DeclaredGap;
};
const forged = (subject: Omit<DeclaredGap, "cause" | "certificate">, budgetedDates: string[], fillHours: number): DeclaredGap => ({ ...subject, cause: "budget_limited",
  certificate: { budgetedDates, budgetHours: 0, usedHours: 0, essentialHours: 0, remainingHours: 0, fillHours, witness: [] } } as DeclaredGap);
const codes = (ps: RuleProblem[]) => [...new Set(ps.map((p) => p.code))].sort();
const of = (ps: RuleProblem[], code: RuleCode) => ps.filter((p) => p.code === code);

describe("the severity table", () => {
  it("errors, gaps and warnings are exactly the plan's map", () => {
    const by = (sev: string) => Object.entries(RULE_CODES).filter(([, s]) => s === sev).map(([c]) => c).sort();
    expect(by("gap")).toEqual(["closing_manager_missing", "coverage_gap", "mod_missing"]);
    expect(by("warning")).toEqual(["checklist_past_max", "flex_used", "outside_assumed_availability", "over_budget", "overtime", "pairing_unmet", "soft_range"]);
    expect(by("error")).toEqual([
      "catering_cover_in_catering_window", "closing_manager_not_closing", "closing_manager_role", "closing_manager_setting", "cover_outside_preferences", "leader_setting", "manager_floor_exceeded",
      "manager_on_boh", "not_member", "person_overlap", "position_over_headcount", "role_not_allowed", "salaried_base_over_target", "salaried_minimum", "salaried_over_flex",
      "secondary_without_primary", "segment_outside_window", "segments_malformed", "shift_below_minimum", "shift_over_maximum", "uncertified_gap",
      "undeclared_gap", "unknown_person", "untouchable_day", "work_type_not_allowed",
    ]);
  });
});

describe("every code: a positive and a negative case", () => {
  it("(a) person_overlap — per 15-min slot, across shifts", () => {
    const ps = run([shift(U.maya, WED, 44, 60, P.REG), shift(U.maya, WED, 58, 74, P.WALKON)]);
    expect(of(ps, "person_overlap").map((p) => p.q)).toEqual([58, 59]);
    expect(of(run([shift(U.maya, WED, 44, 60, P.REG), shift(U.maya, WED, 60, 76, P.WALKON)]), "person_overlap")).toEqual([]);
  });

  it("(b) position_over_headcount — limit headsBefore before the trim, headsAfter after", () => {
    const ps = run([shift(U.maya, WED, 44, 60, P.REG), shift(U.ben, WED, 44, 60, P.REG)]);
    expect(of(ps, "position_over_headcount")).toHaveLength(16);
    expect(of(ps, "position_over_headcount")[0]).toMatchObject({ positionId: P.REG, q: 44, params: { count: 2, limit: 1 } });
    const two = context({ s: structure((s) => { s.positions[P.REG]!.headsBefore = 2; }) });
    expect(of(run([shift(U.maya, WED, 44, 60, P.REG), shift(U.ben, WED, 44, 60, P.REG)], two), "position_over_headcount")).toEqual([]);
  });

  it("(c) shift_below_minimum — the 4 h minimum", () => {
    expect(of(run([shift(U.ben, WED, 44, 56, P.REG)]), "shift_below_minimum")).toHaveLength(1);
    expect(of(run([shift(U.ben, WED, 44, 60, P.REG)]), "shift_below_minimum")).toEqual([]);
  });

  it("shift_over_maximum — CC chunk B ruling 3: a HARD daily maximum, the per-shop setting limits.maxShiftH (default 10.5 h, CC chunk C ruling 2)", () => {
    const over = of(run([shift(U.ben, WED, 42, 85, P.WALKON)]), "shift_over_maximum");
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ severity: "error", userId: U.ben, q: 42, params: { minutes: 645, maximumMinutes: 630 } });
    expect(of(run([shift(U.ben, WED, 42, 84, P.WALKON)]), "shift_over_maximum")).toEqual([]); // exactly 10.5 h is allowed
    expect(of(run([shift(U.ben, WED, 42, 83, P.WALKON)]), "shift_over_maximum")).toEqual([]); // the v17 line day, 10.25 h
    const ten = context({ s: structure((s) => { s.limits.maxShiftH = 10; }) });
    expect(of(run([shift(U.ben, WED, 42, 83, P.WALKON)], ten), "shift_over_maximum")).toHaveLength(1); // the setting decides
    const twelve = context({ s: structure((s) => { s.limits.maxShiftH = 12; }) });
    expect(of(run([shift(U.ben, WED, 42, 85, P.WALKON)], twelve), "shift_over_maximum")).toEqual([]);
    // A multi-position shift counts whole; an inherited day is never re-judged.
    const multi = shift(U.ben, WED, 42, 86, P.WALKON);
    multi.segments = [{ positionId: P.REG, startQ: 42, endQ: 60 }, { positionId: P.WALKON, startQ: 60, endQ: 86 }];
    expect(of(run([multi]), "shift_over_maximum")).toHaveLength(1);
    const inheritedMon = [{ date: MON, originRevisionId: "rev-0", structureVersionId: "sv-1", inherited: true, problems: [] }];
    expect(of(checkScheduleRules(week([shift(U.ben, MON, 42, 83, P.WALKON)], [], inheritedMon), context()), "shift_over_maximum")).toEqual([]);
  });

  it("(d) role_not_allowed and manager_on_boh — two codes; the call-out exemption is an inert branch", () => {
    expect(codes(run([shift(U.iris, WED, 28, 44, P.DISH, {}, {})]))).toContain("role_not_allowed");
    const dani = run([shift(U.dani, WED, 28, 44, P.DISH)]);
    expect(of(dani, "role_not_allowed")).toHaveLength(1);
    expect(of(dani, "manager_on_boh")).toHaveLength(1);
    const exempt = run([shift(U.dani, WED, 28, 44, P.DISH, {}, { coverFor: U.kai, reasonKey: CALLOUT_LAST_RESORT })]);
    expect(of(exempt, "role_not_allowed")).toEqual([]);
    expect(of(exempt, "manager_on_boh")).toEqual([]);
    const kai = run([shift(U.kai, WED, 28, 44, P.DISH)]);
    expect(of(kai, "role_not_allowed")).toEqual([]);
    expect(of(kai, "manager_on_boh")).toEqual([]);
  });

  it("(e) segment_outside_window — OPEN–CLOSE (trim belongs to rule b)", () => {
    expect(of(run([shift(U.ben, WED, 40, 56, P.EXPO)]), "segment_outside_window")).toHaveLength(1);
    expect(of(run([shift(U.ben, WED, 46, 62, P.EXPO), shift(U.maya, WED, 46, 62, P.REG)]), "segment_outside_window")).toEqual([]);
    expect(of(run([shift(U.ben, WED, 46, 62, "no-such-position")]), "segment_outside_window")).toHaveLength(1);
  });

  it("(f) closing_manager_role and (g) closing_manager_setting", () => {
    const maya = run([shift(U.maya, WED, 64, 83, P.REG, { closingManager: true })]);
    expect(of(maya, "closing_manager_role")).toHaveLength(1);
    expect(of(maya, "closing_manager_setting")).toHaveLength(1);
    const dani = run([shift(U.dani, WED, 64, 83, P.REG, { closingManager: true })]);
    expect(of(dani, "closing_manager_role")).toEqual([]);
    expect(of(dani, "closing_manager_setting")).toHaveLength(1); // the v17 Dani bug: an opens-only leader
    const iris = run([shift(U.iris, WED, 64, 83, P.REG, { closingManager: true })]);
    expect(of(iris, "closing_manager_role")).toEqual([]);
    expect(of(iris, "closing_manager_setting")).toEqual([]);
  });

  it("(g) leader_setting — opens-only ending at service close, closes-only starting before service", () => {
    expect(of(run([shift(U.dani, WED, 64, 83, P.REG)]), "leader_setting")).toHaveLength(1);
    expect(of(run([shift(U.iris, WED, 28, 44, P.PREP)]), "leader_setting")).toHaveLength(1);
    expect(of(run([shift(U.dani, WED, 28, 60, P.REG)]), "leader_setting")).toEqual([]);
    expect(of(run([shift(U.iris, WED, 64, 83, P.REG)]), "leader_setting")).toEqual([]);
  });

  it("(h) secondary_without_primary — per slot, from prep start to scheduled out", () => {
    const ps = of(run([shift(U.ben, WED, 46, 62, P.EXPO)]), "secondary_without_primary");
    expect(ps.map((p) => p.q)).toEqual(Array.from({ length: 16 }, (_, i) => 46 + i));
    expect(ps[0]).toMatchObject({ positionId: P.EXPO, params: { primary: P.REG } });
    expect(of(run([shift(U.ben, WED, 46, 62, P.EXPO), shift(U.maya, WED, 44, 64, P.REG)]), "secondary_without_primary")).toEqual([]);
  });

  it("(i) cover_outside_preferences — unless the segment is marked last resort", () => {
    expect(of(run([shift(U.dani, WED, 44, 60, P.WALK)]), "cover_outside_preferences")).toHaveLength(1);
    expect(of(run([shift(U.dani, WED, 44, 60, P.WALK, {}, { lastResort: true })]), "cover_outside_preferences")).toEqual([]);
    expect(of(run([shift(U.dani, WED, 44, 60, P.REG)]), "cover_outside_preferences")).toEqual([]);
  });

  it("segments_malformed — segments must tile the shift exactly", () => {
    const bad = shift(U.ben, WED, 44, 64, P.REG);
    bad.segments = [{ positionId: P.REG, startQ: 44, endQ: 50 }, { positionId: P.WALKON, startQ: 52, endQ: 64 }];
    expect(of(run([bad]), "segments_malformed")).toHaveLength(1);
    const notSpanning = shift(U.ben, WED, 44, 64, P.REG);
    notSpanning.segments = [{ positionId: P.REG, startQ: 44, endQ: 60 }];
    expect(of(run([notSpanning]), "segments_malformed")).toHaveLength(1);
    const good = shift(U.ben, WED, 44, 64, P.REG);
    good.segments = [{ positionId: P.REG, startQ: 44, endQ: 56 }, { positionId: P.WALKON, startQ: 56, endQ: 64 }];
    expect(of(run([good]), "segments_malformed")).toEqual([]);
  });

  it("unknown_person and not_member", () => {
    expect(of(run([shift("u-ghost", WED, 44, 60, P.REG)]), "unknown_person")).toHaveLength(1);
    expect(of(run([shift(U.tess, WED, 44, 60, P.REG)]), "not_member")).toHaveLength(1);
    const ok = run([shift(U.maya, WED, 44, 60, P.REG)]);
    expect(of(ok, "unknown_person")).toEqual([]);
    expect(of(ok, "not_member")).toEqual([]);
  });

  it("salaried_minimum — a GM / AGM's day reaches max(minimum shift, role minimum)", () => {
    expect(of(run([shift(U.alex, WED, 28, 44, "mod")]), "salaried_minimum")).toHaveLength(1);
    expect(of(run([shift(U.alex, WED, 28, 60, "mod")]), "salaried_minimum")).toEqual([]);
  });

  it("manager_floor_exceeded — a salaried manager's floor hours over managerFloorH (32) in the week", () => {
    const five = [WED, THU, FRI, SAT, SUN].map((d) => shift(U.alex, d, 28, 60, P.PREP));
    const ps = of(run(five), "manager_floor_exceeded");
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ day: SUN, userId: U.alex, params: { hours: 40, limit: 32 } });
    expect(of(run(five.slice(0, 4)), "manager_floor_exceeded")).toEqual([]);
  });

  it("work_type_not_allowed — BOH on the line, FOH on Prep/Dishwasher", () => {
    expect(of(run([shift(U.kai, WED, 44, 60, P.REG)]), "work_type_not_allowed")).toHaveLength(1);
    expect(of(run([shift(U.maya, WED, 28, 44, P.DISH)]), "work_type_not_allowed")).toHaveLength(1);
    expect(of(run([shift(U.maya, WED, 44, 60, P.REG)]), "work_type_not_allowed")).toEqual([]);
    expect(of(run([shift(U.maya, WED, 28, 44, P.PREP)]), "work_type_not_allowed")).toEqual([]); // FOH may prep (mockup)
  });

  it("untouchable_day — inert until Phase 3 feeds it", () => {
    const ctx = context();
    ctx.people[U.maya]!.untouchableDates = [WED];
    expect(of(run([shift(U.maya, WED, 44, 60, P.REG)], ctx), "untouchable_day")).toHaveLength(1);
    expect(of(run([shift(U.maya, THU, 44, 60, P.REG)], ctx), "untouchable_day")).toEqual([]);
  });

  it("mod_missing — a gap: undeclared → undeclared_gap; declared and certified → shown as a gap; covered → nothing", () => {
    // KH-as-MoD OFF for this case (the default is 19:00 since Juan's decision 6): the eligible MoD members are Alex and Dani.
    const ctx = context({ s: structure((s) => { s.leadership.modRequired = true; s.leadership.keyHolderModAfterQ = null; }), built: [THU] });
    const und = run([], ctx);
    expect(of(und, "undeclared_gap")).toHaveLength(1);
    expect(of(und, "undeclared_gap")[0]).toMatchObject({ day: THU, params: { gap: "mod_missing", fromQ: 28, toQ: 83 } });
    for (const u of [U.alex, U.dani]) ctx.people[u]!.availability[THU] = null;
    const gap: DeclaredGap = { code: "mod_missing", date: THU, positionId: null, fromQ: 28, toQ: 83, cause: "availability",
      certificate: { eligibleIds: [U.alex, U.dani], unavailableIds: [U.alex, U.dani] } };
    const shown = run([], ctx, [gap]);
    expect(codes(shown)).toEqual(["mod_missing"]);
    expect(of(shown, "mod_missing")[0]).toMatchObject({ severity: "gap", params: { cause: "availability", proven: true } });
    const covered = run([shift(U.pete, THU, 28, 83, "mod", { pinned: true })], context({ s: structure((s) => { s.leadership.modRequired = true; }), built: [THU] }));
    expect(codes(covered).filter((c) => c === "mod_missing" || c === "undeclared_gap")).toEqual([]);
  });

  it("closing_manager_missing — required when the line needs a closer; a Closing Manager satisfies it", () => {
    const ctx = context({ built: [WED] });
    setNeed(ctx, WED, P.REG, 80, 83);
    const missing = run([shift(U.iris, WED, 64, 83, P.REG)], ctx);
    expect(of(missing, "undeclared_gap").map((p) => p.params.gap)).toEqual(["closing_manager_missing"]);
    const ok = run([shift(U.iris, WED, 64, 83, P.REG, { closingManager: true })], ctx);
    expect(of(ok, "undeclared_gap")).toEqual([]);
    expect(of(ok, "closing_manager_missing")).toEqual([]);
  });

  it("coverage_gap / undeclared_gap / uncertified_gap — a deficit against the stored need", () => {
    const ctx = context();
    setNeed(ctx, WED, P.REG, 44, 48);
    expect(of(run([], ctx), "undeclared_gap")[0]).toMatchObject({ day: WED, positionId: P.REG, params: { gap: "coverage_gap", fromQ: 44, toQ: 48 } });
    ctx.budgetByDate[WED] = 0;
    // A 1 h hole with no adjacent shift: the cheapest legal fill FOUND is a 4 h block (budget_limited, CC chunk D ruling).
    const gap = proven({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48 }, week([]), ctx);
    expect(gap.certificate).toMatchObject({ fillHours: 4, remainingHours: 0 });
    const shown = run([], ctx, [gap]);
    expect(codes(shown)).toEqual(["coverage_gap"]);
    ctx.budgetByDate[WED] = 10;
    expect(codes(run([], ctx, [gap]))).toEqual(["uncertified_gap"]);
    expect(of(run([shift(U.maya, WED, 44, 60, P.REG)], ctx), "coverage_gap")).toEqual([]);
    expect(of(run([shift(U.maya, WED, 44, 60, P.REG)], ctx), "undeclared_gap")).toEqual([]);
  });

  it("warnings: overtime, over_budget, soft_range, outside_assumed_availability, checklist_past_max, flex_used, pairing_unmet", () => {
    const nine = (d: string) => shift(U.ben, d, 44, 80, P.REG);
    expect(of(run([WED, THU, FRI, SAT, SUN].map(nine)), "overtime")).toMatchObject([{ severity: "warning", day: SUN, params: { hours: 45, limit: 40 } }]);
    expect(of(run([WED, THU, FRI, SAT].map(nine)), "overtime")).toEqual([]);

    const budget = context();
    budget.budgetByDate[WED] = 2;
    expect(of(run([shift(U.ben, WED, 44, 60, P.REG)], budget), "over_budget")).toHaveLength(1);
    budget.budgetByDate[WED] = 10;
    expect(of(run([shift(U.ben, WED, 44, 60, P.REG)], budget), "over_budget")).toEqual([]);

    const soft = context();
    soft.people[U.ben]!.softMaxH = 30;
    expect(of(run([WED, THU, FRI, SAT].map(nine), soft), "soft_range")).toHaveLength(1);
    soft.people[U.ben]!.softMaxH = 40;
    expect(of(run([WED, THU, FRI, SAT].map(nine), soft), "soft_range")).toEqual([]);

    const avail = context();
    avail.people[U.ben]!.availability[WED] = { fromQ: 50, toQ: 84, source: "toast_pattern" };
    expect(of(run([shift(U.ben, WED, 44, 60, P.REG)], avail), "outside_assumed_availability")).toHaveLength(1);
    avail.people[U.ben]!.availability[WED] = { fromQ: 40, toQ: 84, source: "insufficient_history" };
    expect(of(run([shift(U.ben, WED, 44, 60, P.REG)], avail), "outside_assumed_availability")).toEqual([]);

    const late = context();
    late.days[WED]!.closingMinutes = 70;
    expect(of(run([], late), "checklist_past_max")).toMatchObject([{ day: WED }]);
    expect(of(run([], context()), "checklist_past_max")).toEqual([]);

    const flex = context();
    flex.people[U.ben]!.flexDates = [WED];
    const f = run([shift(U.ben, WED, 44, 56, P.REG, { flex: true })], flex);
    expect(of(f, "flex_used")).toHaveLength(1);
    expect(of(f, "shift_below_minimum")).toEqual([]); // 3 h meets the flex minimum on the flex day
    expect(of(run([shift(U.ben, WED, 44, 60, P.REG)], flex), "flex_used")).toEqual([]);

    const pair = context();
    pair.people[U.eli]!.newerPositions = [P.WALK];
    pair.people[U.maya]!.strongPositions = [P.WALKON];
    expect(of(run([shift(U.eli, WED, 44, 60, P.WALK)], pair), "pairing_unmet")).toHaveLength(1);
    expect(of(run([shift(U.eli, WED, 44, 60, P.WALK), shift(U.maya, WED, 44, 60, P.WALKON)], pair), "pairing_unmet")).toEqual([]);
  });
});

describe("gap certificates, per cause", () => {
  it("budget_limited: certifies R < W (the cheapest legal fill FOUND, its witness re-found exactly); fails when the budget had room", () => {
    const ctx = context();
    setNeed(ctx, WED, P.REG, 44, 48);
    ctx.budgetByDate[WED] = 0;
    const g = proven({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48 }, week([]), ctx);
    expect(checkCertificate(g, week([]), ctx)).toBe(true);
    // A tampered witness or W is refused: the verifier re-runs the same search.
    const c = g.certificate as { fillHours: number; witness: unknown[] };
    expect(checkCertificate({ ...g, certificate: { ...c, fillHours: 3 } } as unknown as DeclaredGap, week([]), ctx)).toBe(false);
    expect(checkCertificate({ ...g, certificate: { ...c, witness: [] } } as unknown as DeclaredGap, week([]), ctx)).toBe(false);
    ctx.budgetByDate[WED] = 10;
    expect(checkCertificate({ ...g, certificate: { ...g.certificate, budgetHours: 10 } as never }, week([]), ctx)).toBe(false);
    // W is what the found LEGAL fill adds: 4 h for the lone hole; exactly the hole when an eligible hourly shift is adjacent.
    ctx.budgetByDate[WED] = 2;
    const lone = proveGap({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48 }, week([]), ctx);
    expect(lone).toMatchObject({ cause: "budget_limited", certificate: { fillHours: 4, budgetHours: 2, remainingHours: 2 } });
    ctx.budgetByDate[WED] = 6;
    const beside = proveGap({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48 }, week([shift(U.ben, WED, 48, 64, P.REG)]), ctx);
    expect(beside).toBeNull(); // Ben (4 h) extends over the 1 h hole within the 6 h budget: the budget does not excuse it
    ctx.budgetByDate[WED] = 4.5;
    expect(proveGap({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48 }, week([shift(U.ben, WED, 48, 64, P.REG)]), ctx))
      .toMatchObject({ cause: "budget_limited", certificate: { fillHours: 1, usedHours: 4, remainingHours: 0.5 } }); // 1 > 4.5 - 4: even the extension is unaffordable
  });

  it("floor_limit: only when every free eligible candidate is a salaried manager at the cap and no hourly person is free", () => {
    // Juan 2026-10-16 (decision 4): past the floor a cover is FLEX, so the proof needs the flex spent too (0 h here).
    const ctx = context({ s: structure((x) => { x.limits.salariedFlexH = 0; }) });
    setNeed(ctx, THU, P.PREP, 28, 44);
    for (const u of [U.maya, U.ben, U.kai, U.iris, U.eli, U.dani]) ctx.people[u]!.availability[THU] = null;
    const shifts = [
      shift(U.alex, THU, 28, 60, "mod"),
      ...[WED, FRI, SAT].map((d) => shift(U.alex, d, 28, 60, P.PREP)),
      shift(U.alex, SUN, 28, 56, P.PREP),
    ];
    const g: DeclaredGap = { code: "coverage_gap", date: THU, positionId: P.PREP, fromQ: 28, toQ: 44, cause: "floor_limit",
      certificate: { managerIds: [U.alex], floorHoursUsed: { [U.alex]: 31 }, limitH: 32 } };
    expect(checkCertificate(g, week(shifts), ctx)).toBe(true);
    expect(checkCertificate(g, week(shifts.slice(0, 2)), ctx)).toBe(false); // 8 h used: room under the cap
    // With flex left, a GM on the clock who could take the window by a zero-hourly-cost relabel is not a floor-limit proof.
    const flexCtx = context();
    setNeed(flexCtx, THU, P.REG, 44, 52);
    for (const u of [U.maya, U.ben, U.kai, U.iris, U.eli, U.dani]) flexCtx.people[u]!.availability[THU] = null;
    const full = [...shifts.slice(0, 4), shift(U.alex, SUN, 28, 60, P.PREP)]; // 32 h of base station time: no room under the floor
    const regGap: DeclaredGap = { code: "coverage_gap", date: THU, positionId: P.REG, fromQ: 44, toQ: 52, cause: "floor_limit",
      certificate: { managerIds: [U.alex], floorHoursUsed: { [U.alex]: 32 }, limitH: 32 } };
    expect(checkCertificate(regGap, week(full), flexCtx)).toBe(false);
    const noFlex = context({ s: structure((x) => { x.limits.salariedFlexH = 0; }) });
    setNeed(noFlex, THU, P.REG, 44, 52);
    for (const u of [U.maya, U.ben, U.kai, U.iris, U.eli, U.dani]) noFlex.people[u]!.availability[THU] = null;
    expect(checkCertificate(regGap, week(full), noFlex)).toBe(true);
    ctx.people[U.ben]!.availability[THU] = { fromQ: 28, toQ: 84, source: "toast_pattern" };
    expect(checkCertificate(g, week(shifts), ctx)).toBe(false); // an hourly person is free
  });

  it("eligibility: fails when even one member could work the position", () => {
    const only = context({ s: structure((s) => { s.positions[P.DISH]!.allowedRoles = ["trainer"]; }) });
    setNeed(only, FRI, P.DISH, 28, 44);
    const g: DeclaredGap = { code: "coverage_gap", date: FRI, positionId: P.DISH, fromQ: 28, toQ: 44, cause: "eligibility",
      certificate: { positionId: P.DISH, eligibleCount: 0 } };
    expect(checkCertificate(g, week([]), only)).toBe(true);
    const normal = context();
    setNeed(normal, FRI, P.DISH, 28, 44);
    expect(checkCertificate(g, week([]), normal)).toBe(false); // kai (BOH employee) could
  });

  it("availability: fails when an eligible member is available and free", () => {
    const ctx = context();
    setNeed(ctx, FRI, P.DISH, 28, 44);
    ctx.people[U.kai]!.availability[FRI] = null;
    const g: DeclaredGap = { code: "coverage_gap", date: FRI, positionId: P.DISH, fromQ: 28, toQ: 44, cause: "availability",
      certificate: { eligibleIds: [U.kai], unavailableIds: [U.kai] } };
    expect(checkCertificate(g, week([]), ctx)).toBe(true);
    ctx.people[U.kai]!.availability[FRI] = { fromQ: 28, toQ: 84, source: "toast_pattern" };
    expect(checkCertificate(g, week([]), ctx)).toBe(false);
  });

  it("structure: certifies the case-file infeasible row (a secondary while its primary is closed); a short window is NOT a proof (Astra P2-4)", () => {
    const short = structure((s) => { s.positions[P.BOI]!.openQ = 52; });
    const g1: DeclaredGap = { code: "coverage_gap", date: SAT, positionId: P.BOI, fromQ: 52, toQ: 56, cause: "structure",
      certificate: { rule: "primary_window_closed", detail: { positionId: P.BOI } } };
    expect(structureInfeasible(short, SAT, g1)).toBe(false);
    const c1 = context({ s: short });
    setNeed(c1, SAT, P.BOI, 52, 56);
    expect(checkCertificate(g1, week([]), c1)).toBe(false);

    const closed = structure((s) => { s.positions[P.EXPO]!.closeQ = 84; s.positions[P.REG]!.trimQ = 64; s.positions[P.REG]!.closeQ = 64; });
    const g2: DeclaredGap = { code: "coverage_gap", date: SAT, positionId: P.EXPO, fromQ: 64, toQ: 80, cause: "structure",
      certificate: { rule: "primary_window_closed", detail: { positionId: P.EXPO, primaryId: P.REG } } };
    expect(structureInfeasible(closed, SAT, g2)).toBe(true);
    expect(structureInfeasible(closed, SAT, { ...g2, fromQ: 46, toQ: 60 })).toBe(false);

    const g3: DeclaredGap = { code: "mod_missing", date: SAT, positionId: null, fromQ: 28, toQ: 83, cause: "structure",
      certificate: { rule: "no_mod_member", detail: {} } };
    // KH-as-MoD OFF here (decision 6 makes Iris, a KH, eligible from 19:00 by default).
    const ctx = context({ s: structure((s) => { s.leadership.modRequired = true; s.leadership.keyHolderModAfterQ = null; }) });
    expect(checkCertificate(g3, week([]), ctx)).toBe(false); // Alex and Dani are members
    for (const u of [U.alex, U.dani]) ctx.people[u]!.activeMember = false;
    expect(checkCertificate(g3, week([]), ctx)).toBe(true);
  });

  it("capacity (r3): two positions, one eligible + available person → required 2, people 1, short 1", () => {
    const s = structure((x) => { x.positions[P.REG]!.allowedRoles = ["trainer"]; x.positions[P.WALKON]!.allowedRoles = ["trainer"]; });
    const ctx = context({ s });
    setNeed(ctx, SUN, P.REG, 44, 56);
    setNeed(ctx, SUN, P.WALKON, 44, 56);
    const cert = { fromQ: 44, toQ: 56, positionIds: [P.REG, P.WALKON], requiredHeads: 2, peopleIds: [U.maya], people: 1, shortBy: 1 };
    const g: DeclaredGap = { code: "coverage_gap", date: SUN, positionId: P.WALKON, fromQ: 44, toQ: 56, cause: "capacity", certificate: cert };
    const placed = [shift(U.maya, SUN, 44, 60, P.REG)];
    expect(checkCertificate(g, week(placed), ctx)).toBe(true); // exactly one head uncovered per quarter
    expect(checkCertificate(g, week([]), ctx)).toBe(false); // two uncovered: the excess is not proven
    expect(capacityBound({ date: SUN, positionId: P.WALKON, fromQ: 44, toQ: 56 }, week(placed), ctx)).toEqual(cert);
  });

  it("capacity: the Hall-type search finds the binding subset where no single position is short", () => {
    const s = structure((x) => {
      x.positions[P.REG]!.allowedRoles = ["trainer"];
      x.positions[P.WALKON]!.allowedRoles = ["trainer"];
      x.positions[P.THIRD]!.allowedRoles = ["employee"];
    });
    const ctx = context({ s });
    for (const p of [P.REG, P.WALKON, P.THIRD]) setNeed(ctx, SUN, p, 44, 56);
    const placed = [shift(U.maya, SUN, 44, 60, P.REG), shift(U.ben, SUN, 40, 60, P.THIRD)];
    const got = capacityBound({ date: SUN, positionId: P.WALKON, fromQ: 44, toQ: 56 }, week(placed), ctx);
    expect(got).toMatchObject({ positionIds: [P.REG, P.WALKON], requiredHeads: 2, people: 1, shortBy: 1 });
    for (const single of [P.REG, P.WALKON, P.THIRD]) {
      const one = capacityBound({ date: SUN, positionId: single, fromQ: 44, toQ: 56 }, week(placed), { ...ctx });
      expect(one?.positionIds.length ?? 0).not.toBe(1);
    }
  });

  it("unresolved_search (r3): only when a search limit was hit AND no proven cause certifies; a gap, never proven", () => {
    const ctx = context();
    setNeed(ctx, WED, P.REG, 44, 48);
    const g: DeclaredGap = { code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48, cause: "unresolved_search",
      certificate: { searched: { steps: REPAIR_LIMITS.REPAIR_MAX_STEPS, donorsTried: 8, chainDepth: 3 }, limits: { ...REPAIR_LIMITS }, candidateIds: [U.maya] } };
    expect(checkCertificate(g, week([]), ctx)).toBe(true);
    const ps = run([], ctx, [g]);
    expect(ps).toMatchObject([{ code: "coverage_gap", severity: "gap", params: { cause: "unresolved_search", proven: false } }]);
    const notHit = { ...g, certificate: { ...g.certificate, searched: { steps: 50, donorsTried: 2, chainDepth: 1 } } } as DeclaredGap;
    expect(checkCertificate(notHit, week([]), ctx)).toBe(false);
    ctx.budgetByDate[WED] = 0; // now `budget_limited` proves it: an unresolved claim is no longer honest
    expect(checkCertificate(g, week([]), ctx)).toBe(false);
    expect(proveGap({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48 }, week([]), ctx)?.cause).toBe("budget_limited");
  });

  it("Approve refuses unresolved_gaps while ANY unresolved_search gap exists, inherited or not (r4); rules_failing on a NEW error", () => {
    const inheritedGap: DeclaredGap = { code: "coverage_gap", date: MON, positionId: P.REG, fromQ: 44, toQ: 48, cause: "unresolved_search",
      certificate: { searched: { steps: 200, donorsTried: 8, chainDepth: 3 }, limits: { ...REPAIR_LIMITS }, candidateIds: [] } };
    const days = [{ date: MON, originRevisionId: "rev-0", structureVersionId: "sv-1", inherited: true, problems: [] }];
    const s = week([], [inheritedGap], days);
    expect(approvalRefusal(s, checkScheduleRules(s, context()))).toBe("unresolved_gaps");
    expect(approvalRefusal(week([]), [])).toBeNull();
    const broken = week([shift(U.ben, WED, 44, 56, P.REG)]);
    expect(approvalRefusal(broken, checkScheduleRules(broken, context()))).toBe("rules_failing");
    const inheritedError: RuleProblem = { code: "shift_below_minimum", severity: "error", day: MON, params: {}, inherited: true };
    expect(approvalRefusal(week([]), [inheritedError])).toBeNull();
  });
});

describe("original vs current validation (r3 P2-4, r4)", () => {
  it("replays from the stored snapshot only; the advisory lists exactly what changed", () => {
    const ctx = context();
    setNeed(ctx, WED, P.REG, 44, 64);
    ctx.budgetByDate[THU] = 62;
    ctx.people[U.ben]!.availability[THU] = { fromQ: 40, toQ: 84, source: "toast_pattern" };
    const s = week([shift(U.ben, WED, 44, 60, P.REG), shift(U.tess, THU, 44, 60, P.REG), shift(U.ben, THU, 44, 60, P.WALKON)]);
    const snap = toContextSnapshot(ctx);
    const original = checkScheduleRules(s, ruleContextFromSnapshot(snap.json));

    const live = structuredClone(ctx);
    live.people[U.maya]!.activeMember = false; // Maya left
    live.people[U.ben]!.availability[THU] = { fromQ: 60, toQ: 84, source: "toast_pattern" };
    live.budgetByDate[THU] = 58;
    // The stored snapshot is unchanged, so the original verdict is byte-identical.
    expect(JSON.stringify(checkScheduleRules(s, ruleContextFromSnapshot(snap.json)))).toBe(JSON.stringify(original));
    expect(JSON.stringify(checkScheduleRules(s, live))).not.toBe(JSON.stringify(original));
    expect(contextAdvisory(ruleContextFromSnapshot(snap.json), live).map((a) => [a.code, a.date, a.userId])).toEqual([
      ["member_removed", null, U.maya],
      ["availability_changed", THU, U.ben],
      ["budget_changed", THU, null],
    ]);
    expect(snap.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(toContextSnapshot(ruleContextFromSnapshot(snap.json)).digest).toBe(snap.digest);
  });

  it("coverage reads need(p, q) from the snapshot's need grid, never from the structure", () => {
    const ctx = context();
    setNeed(ctx, WED, P.BOI, 44, 48);
    ctx.days[WED]!.structure.positions[P.BOI]!.headsBefore = 0; // the structure says nothing about need
    expect(of(run([], ctx), "undeclared_gap")).toHaveLength(1);
  });
});

describe("the historical contract (r2 P1-3)", () => {
  it("an inherited day is NOT re-judged: its stored problems return as-is, inherited, even for a gone person / retired position", () => {
    const stored: RuleProblem = { code: "shift_below_minimum", severity: "error", day: MON, userId: "u-gone", params: { minutes: 120 }, inherited: false };
    const days = [{ date: MON, originRevisionId: "rev-1", structureVersionId: "sv-0", inherited: true, problems: [stored] }];
    const s = week([shift("u-gone", MON, 44, 52, "retired-position")], [], days);
    const ps = checkScheduleRules(s, context());
    expect(ps).toEqual([{ ...stored, inherited: true }]);
  });

  it("weekly totals COUNT inherited hours, and attribute the problem to a built day (overtime, as a warning)", () => {
    const days = [MON, TUE].map((date) => ({ date, originRevisionId: "rev-1", structureVersionId: "sv-1", inherited: true, problems: [] }));
    const s = week([MON, TUE, WED, THU, FRI].map((d) => shift(U.ben, d, 44, 80, P.REG)), [], days);
    const ot = of(checkScheduleRules(s, context()), "overtime");
    expect(ot).toEqual([expect.objectContaining({ day: FRI, severity: "warning", inherited: false, params: { hours: 45, limit: 40 } })]);
  });
});

describe("determinism and cost", () => {
  it("output order is (day, code, user, q) and byte-identical across runs and input permutations", () => {
    const ctx = context();
    setNeed(ctx, WED, P.REG, 44, 48);
    const shifts = [shift(U.dani, WED, 64, 83, P.REG), shift(U.ben, THU, 44, 56, P.EXPO), shift(U.maya, WED, 44, 60, P.REG), shift(U.ben, WED, 44, 60, P.REG)];
    const a = checkScheduleRules(week(shifts), ctx);
    const b = checkScheduleRules(week([...shifts].reverse()), ctx);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const keys = a.map((p) => [p.day, p.code, p.userId ?? "", p.q ?? -1]);
    const sorted = [...keys].sort((x, y) => (x[0]! < y[0]! ? -1 : x[0]! > y[0]! ? 1 : x[1]! < y[1]! ? -1 : x[1]! > y[1]! ? 1 : x[2]! < y[2]! ? -1 : x[2]! > y[2]! ? 1 : (x[3] as number) - (y[3] as number)));
    expect(keys).toEqual(sorted);
  });

  it("a 500-shift week checks in < 50 ms", () => {
    const ctx = context();
    for (let i = 0; i < 100; i++) ctx.people[`u-${i}`] = { ...ctx.people[U.ben]!, userId: `u-${i}` };
    for (const d of DATES.slice(2)) for (const p of [P.REG, P.WALKON, P.BOI, P.THIRD]) setNeed(ctx, d, p, 44, 56);
    // 100 people × 5 built days, one shift each a day (a big but real week), on four line positions.
    const shifts = Array.from({ length: 500 }, (_, i) => shift(`u-${i % 100}`, DATES[2 + Math.floor(i / 100)]!, 42 + (i % 8) * 2, 60 + (i % 8) * 2, [P.REG, P.WALKON, P.WALK, P.EXPO][i % 4]!));
    for (let i = 0; i < 2; i++) checkScheduleRules(week(shifts), ctx); // warm the JIT
    // The best of three runs: a complexity guard, not a benchmark of a busy 2-core desktop.
    const times = [0, 1, 2].map(() => { const t0 = performance.now(); checkScheduleRules(week(shifts), ctx); return performance.now() - t0; });
    expect(Math.min(...times)).toBeLessThan(50);
  });
});

describe("Astra's chunk A review probes (failing first, fixed in the same commit)", () => {
  it("P1 Closing Manager: the flag counts only on an eligible shift that COVERS the closing window; a KH 10:30-14:30 flagged CM FAILS", () => {
    const ctx = context({ built: [WED] });
    setNeed(ctx, WED, P.REG, 44, 83);
    const flaggedLunch = shift(U.iris, WED, 42, 58, P.REG, { closingManager: true });
    const closer = shift(U.ben, WED, 64, 83, P.REG);
    const ps = run([flaggedLunch, closer], ctx);
    expect(ps.some((p) => p.severity === "error")).toBe(true);
    expect(of(ps, "closing_manager_not_closing")).toMatchObject([{ userId: U.iris, day: WED }]);
    expect(of(ps, "undeclared_gap").map((p) => p.params.gap)).toContain("closing_manager_missing");
    expect(approvalRefusal(week([flaggedLunch, closer]), ps)).toBe("rules_failing");
    // The same KH actually closing satisfies it.
    const ok = run([shift(U.iris, WED, 64, 83, P.REG, { closingManager: true }), shift(U.ben, WED, 44, 64, P.REG)], ctx);
    expect(ok.filter((p) => p.severity === "error")).toEqual([]);
    // A flagged shift that starts after service close, or ends before everyone is out, does not cover the window either.
    expect(of(run([shift(U.iris, WED, 81, 83, P.REG, { closingManager: true })], ctx), "closing_manager_not_closing")).toHaveLength(1);
    expect(of(run([shift(U.iris, WED, 64, 82, P.REG, { closingManager: true })], ctx), "closing_manager_not_closing")).toHaveLength(1);
  });

  it("P1 floor_limit: an hourly person whose existing shift can EXTEND over the gap is free; 12:00-16:00 beside a 16:00-17:00 gap is NOT floor_limit", () => {
    const ctx = context({ s: structure((x) => { x.limits.salariedFlexH = 0; }) }); // the floor proof needs the flex spent (decision 4)
    setNeed(ctx, THU, P.REG, 48, 68);
    for (const u of [U.maya, U.kai, U.iris, U.eli, U.dani]) ctx.people[u]!.availability[THU] = null;
    ctx.people[U.ben]!.availability[THU] = { fromQ: 40, toQ: 84, source: "toast_pattern" };
    const shifts = [
      shift(U.ben, THU, 48, 64, P.REG),
      shift(U.alex, THU, 28, 60, "mod"),
      ...[WED, FRI, SAT, SUN].map((d) => shift(U.alex, d, 42, 74, P.REG)),
    ];
    // Alex has 32 floor hours (Register, in his cover list; 8 h days meet the GM minimum): the 1 h window would take him to 33 > 32.
    const g: DeclaredGap = { code: "coverage_gap", date: THU, positionId: P.REG, fromQ: 64, toQ: 68, cause: "floor_limit",
      certificate: { managerIds: [U.alex], floorHoursUsed: { [U.alex]: 32 }, limitH: 32 } };
    expect(checkCertificate(g, week(shifts), ctx)).toBe(false);
    expect(proveGap(g, week(shifts), ctx)?.cause).not.toBe("floor_limit");
    // Extending Ben to 17:00 is a clean fill.
    const extended = [shift(U.ben, THU, 48, 68, P.REG), ...shifts.slice(1)];
    expect(run(extended, ctx).filter((p) => p.severity === "error" || p.severity === "gap")).toEqual([]);
    // When the extension is impossible (Ben's availability ends at 16:00), the floor-limit proof stands again.
    ctx.people[U.ben]!.availability[THU] = { fromQ: 40, toQ: 64, source: "toast_pattern" };
    expect(checkCertificate(g, week(shifts), ctx)).toBe(true);
    // A gap INSIDE Ben's shift (he is on another position then) is not an extension: that is the repair search's business.
    ctx.people[U.ben]!.availability[THU] = { fromQ: 40, toQ: 84, source: "toast_pattern" };
    setNeed(ctx, THU, P.WALKON, 52, 56);
    const inside: DeclaredGap = { ...g, positionId: P.WALKON, fromQ: 52, toQ: 56 };
    expect(checkCertificate(inside, week(shifts), ctx)).toBe(true);
  });

  it("P1 budget: essential coverage (the closing window, MoD, the Closing Manager) is budget-exempt and is never excused by budget", () => {
    const ctx = context({ built: [WED] });
    setNeed(ctx, WED, P.REG, 80, 83);
    ctx.budgetByDate[WED] = 0;
    const closing = forged({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 80, toQ: 83 }, [WED], 0.75);
    expect(checkCertificate(closing, week([]), ctx)).toBe(false);
    expect(proveGap(closing, week([]), ctx)?.cause).not.toBe("budget_limited");
    // A gap that merely TOUCHES the closing window is filled by a closing shift: exempt too.
    setNeed(ctx, WED, P.REG, 76, 83);
    const touching = forged({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 76, toQ: 81 }, [WED], 1.25);
    expect(checkCertificate(touching, week([]), ctx)).toBe(false);
    // Scheduling the closer costs no budget: a whole shift working the closing window is essential.
    const filled = run([shift(U.iris, WED, 67, 83, P.REG, { closingManager: true })], ctx);
    expect(filled.filter((p) => p.severity === "error" || p.severity === "gap" || p.code === "over_budget")).toEqual([]);
    // MoD deficits are never budget gaps either.
    const modCtx = context({ s: structure((s) => { s.leadership.modRequired = true; }), built: [THU] });
    modCtx.budgetByDate[THU] = 0;
    expect(proveGap({ code: "mod_missing", date: THU, positionId: null, fromQ: 28, toQ: 83 }, week([]), modCtx)?.cause).not.toBe("budget_limited");
    // A lunch gap with no budget is still a budget gap.
    const lunch = context({ built: [WED] });
    setNeed(lunch, WED, P.REG, 44, 48);
    lunch.budgetByDate[WED] = 0;
    expect(proveGap({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48 }, week([]), lunch)?.cause).toBe("budget_limited");
  });

  it("P2 short windows: the minimum applies to the whole SHIFT; a 2 h window is a segment of a multi-position shift, never a structure proof", () => {
    const s = structure((x) => { x.positions[P.EXPO]!.openQ = 48; x.positions[P.EXPO]!.trimQ = 56; x.positions[P.EXPO]!.closeQ = 56; });
    const ctx = context({ s, built: [FRI] });
    setNeed(ctx, FRI, P.REG, 44, 48);
    setNeed(ctx, FRI, P.EXPO, 48, 56);
    setNeed(ctx, FRI, P.WALKON, 56, 60);
    const g: DeclaredGap = { code: "coverage_gap", date: FRI, positionId: P.EXPO, fromQ: 48, toQ: 56, cause: "structure",
      certificate: { rule: "primary_window_closed", detail: { positionId: P.EXPO } } };
    expect(structureInfeasible(s, FRI, g)).toBe(false);
    expect(proveGap(g, week([]), ctx)?.cause).not.toBe("structure");
    // The valid 4 h Register -> Expeditor -> Walk-ins / Online shift fills it with zero problems.
    const multi = { ...shift(U.ben, FRI, 44, 60, P.REG), segments: [
      { positionId: P.REG, startQ: 44, endQ: 48 }, { positionId: P.EXPO, startQ: 48, endQ: 56 }, { positionId: P.WALKON, startQ: 56, endQ: 60 },
    ] };
    const reg = shift(U.maya, FRI, 48, 64, P.REG); // the primary stays filled while Expeditor is
    expect(run([multi, reg], ctx).filter((p) => p.severity !== "warning")).toEqual([]);
  });

  it("CC ruling 2: 'KH may be manager on duty after <time>' is a SETTING, default OFF — OFF leaves the evening a MoD gap; ON lets the KH cover from that time", () => {
    const evening = (after: number | null) => context({ s: structure((s) => { s.leadership.modRequired = true; s.leadership.keyHolderModAfterQ = after; }), built: [THU] });
    // Pete (presence pin) holds MoD until 16:30; Iris, a key holder, closes on Register 16:00-20:45.
    const shifts = [shift(U.pete, THU, 28, 66, "mod", { pinned: true }), shift(U.iris, THU, 64, 83, P.REG)];
    const off = run(shifts, evening(null));
    expect(of(off, "undeclared_gap").map((p) => p.params)).toEqual([{ gap: "mod_missing", fromQ: 66, toQ: 83 }]);
    const on = run(shifts, evening(66));
    expect(of(on, "undeclared_gap")).toEqual([]);
    expect(of(on, "mod_missing")).toEqual([]);
    const later = run(shifts, evening(72));
    expect(of(later, "undeclared_gap").map((p) => p.params)).toEqual([{ gap: "mod_missing", fromQ: 66, toQ: 72 }]);
    // Certificates follow the setting: with only a KH able to be MoD, the structure proof holds before the time and fails after it.
    const ctx = evening(66);
    for (const u of [U.alex, U.dani]) ctx.people[u]!.activeMember = false;
    const before: DeclaredGap = { code: "mod_missing", date: THU, positionId: null, fromQ: 28, toQ: 66, cause: "structure", certificate: { rule: "no_mod_member", detail: {} } };
    expect(checkCertificate(before, week([]), ctx)).toBe(true);
    expect(checkCertificate({ ...before, fromQ: 66, toQ: 83 }, week([]), ctx)).toBe(false);
    expect(proveGap({ code: "mod_missing", date: THU, positionId: null, fromQ: 66, toQ: 83 }, week([]), ctx)?.cause).not.toBe("structure");
    expect(checkCertificate({ ...before, fromQ: 66, toQ: 83 }, week([]), evening(null))).toBe(false); // Alex and Dani are members when OFF
  });

  it("CC chunk B ruling 1: capacityBound returns the LARGEST VERIFIABLE subset — never one the excess check refuses", () => {
    // Register needs 2 (Maya on it), Expeditor needs 2 (Ben could work it but is not placed). {REG, EXPO} has the larger
    // raw shortBy (4 − 2 = 2) but leaves 3 uncovered > 2, so it can never verify; {REG} (2 − 1 = 1, 1 uncovered) is the
    // strongest proof the counting bound supports.
    const s = structure((x) => {
      x.positions[P.REG]!.headsBefore = 2; x.positions[P.REG]!.allowedRoles = ["trainer"];
      x.positions[P.EXPO]!.headsBefore = 2; x.positions[P.EXPO]!.allowedRoles = ["employee"];
    });
    const ctx = context({ s });
    setNeed(ctx, SUN, P.REG, 48, 52, 2);
    setNeed(ctx, SUN, P.EXPO, 48, 52, 2);
    const placed = [shift(U.maya, SUN, 44, 60, P.REG)];
    const cert = capacityBound({ date: SUN, positionId: P.REG, fromQ: 48, toQ: 52 }, week(placed), ctx);
    expect(cert).toEqual({ fromQ: 48, toQ: 52, positionIds: [P.REG], requiredHeads: 2, peopleIds: [U.maya], people: 1, shortBy: 1 });
    const g: DeclaredGap = { code: "coverage_gap", date: SUN, positionId: P.REG, fromQ: 48, toQ: 52, cause: "capacity", certificate: cert! };
    expect(checkCertificate(g, week(placed), ctx)).toBe(true);
    // The larger subset's certificate is refused by the excess check (that is why it is never returned).
    const big: DeclaredGap = { ...g, certificate: { fromQ: 48, toQ: 52, positionIds: [P.REG, P.EXPO].sort(), requiredHeads: 4, peopleIds: [U.ben, U.maya].sort(), people: 2, shortBy: 2 } };
    expect(checkCertificate(big, week(placed), ctx)).toBe(false);
    expect(proveGap({ code: "coverage_gap", date: SUN, positionId: P.REG, fromQ: 48, toQ: 52 }, week(placed), ctx)).toEqual({ cause: "capacity", certificate: cert });
    // Every certificate capacityBound returns verifies (the property the ruling asks for), across the earlier fixtures too.
    for (const pos of [P.REG, P.EXPO]) {
      const c = capacityBound({ date: SUN, positionId: pos, fromQ: 48, toQ: 52 }, week(placed), ctx);
      if (c) expect(checkCertificate({ ...g, positionId: pos, certificate: c }, week(placed), ctx)).toBe(true);
    }
  });

  it("P2 capacity: duplicate position ids are rejected before the bound is recomputed", () => {
    const s = structure((x) => { x.positions[P.REG]!.headsBefore = 2; x.positions[P.REG]!.allowedRoles = ["trainer", "employee"]; });
    const ctx = context({ s });
    for (const u of [U.kai, U.iris, U.eli, U.dani]) ctx.people[u]!.availability[SUN] = null;
    setNeed(ctx, SUN, P.REG, 44, 56, 2);
    const placed = [shift(U.maya, SUN, 44, 60, P.REG)];
    const dup: DeclaredGap = { code: "coverage_gap", date: SUN, positionId: P.REG, fromQ: 44, toQ: 56, cause: "capacity",
      certificate: { fromQ: 44, toQ: 56, positionIds: [P.REG, P.REG, P.REG], requiredHeads: 6, peopleIds: [U.ben, U.maya], people: 2, shortBy: 4 } };
    expect(checkCertificate(dup, week(placed), ctx)).toBe(false);
    expect(capacityBound({ date: SUN, positionId: P.REG, fromQ: 44, toQ: 56 }, week(placed), ctx)).toBeNull(); // Ben can fill it
    expect(approvalRefusal(week(placed, [dup]), run(placed, ctx, [dup]))).toBe("rules_failing");
    const dupPeople = { ...dup, certificate: { ...dup.certificate, positionIds: [P.REG], requiredHeads: 2, peopleIds: [U.maya, U.maya], people: 2, shortBy: 0 } } as DeclaredGap;
    expect(checkCertificate(dupPeople, week(placed), ctx)).toBe(false);
  });
});

describe("Astra's chunk B review probes (failing first)", () => {
  it("P1-1 budget vs salaried cover: a budget certificate is REJECTED while a legal zero-hourly-cost fill exists (the GM on MoD can take Register)", () => {
    const ctx = context({ built: [THU] });
    setNeed(ctx, THU, P.REG, 44, 60);
    ctx.budgetByDate[THU] = 0;
    const gm = shift(U.alex, THU, 28, 60, "mod");
    const g = proven({ code: "coverage_gap", date: THU, positionId: P.REG, fromQ: 44, toQ: 60 }, week([]), ctx);
    expect(checkCertificate(g, week([gm]), ctx)).toBe(false);
    expect(proveGap(g, week([gm]), ctx)?.cause).not.toBe("budget_limited");
    expect(cheapestFill(g, week([gm]), ctx)).toMatchObject({ hours: 0, steps: [{ kind: "relabel", userId: U.alex, fromPositionId: "mod" }] });
    // Relabelling the GM's block to Register is legal and costs no hourly money: zero problems.
    const relabelled = { ...gm, segments: [{ positionId: "mod", startQ: 28, endQ: 44 }, { positionId: P.REG, startQ: 44, endQ: 60 }] };
    expect(run([relabelled], ctx).filter((p) => p.severity !== "warning")).toEqual([]);
    // Without the GM (or with the GM's floor AND flex exhausted — past the floor a relabel is flex, Juan's decision 4)
    // the budget proof stands again.
    expect(checkCertificate(g, week([]), ctx)).toBe(true);
    const capped = context({ s: structure((x) => { x.limits.managerFloorH = 0; x.limits.salariedFlexH = 0; }), built: [THU] });
    setNeed(capped, THU, P.REG, 44, 60);
    capped.budgetByDate[THU] = 0;
    expect(proveGap(g, week([gm]), capped)?.cause).toBe("budget_limited");
  });

  it("P1-2 KH-MoD boundaries: impossibility before the KH-may-be-MoD time never certifies the time after it", () => {
    const s = structure((x) => { x.leadership.modRequired = true; x.leadership.keyHolderModAfterQ = 48; });
    const ctx = context({ s, built: [THU] });
    ctx.people = { [U.iris]: ctx.people[U.iris]! }; // a key-holder-only roster
    const across: DeclaredGap = { code: "mod_missing", date: THU, positionId: null, fromQ: 40, toQ: 64, cause: "structure", certificate: { rule: "no_mod_member", detail: {} } };
    expect(checkCertificate(across, week([]), ctx)).toBe(false); // Iris may be MoD 12:00–16:00
    expect(checkCertificate({ ...across, toQ: 48 }, week([]), ctx)).toBe(true); // before noon nobody can
    expect(proveGap({ code: "mod_missing", date: THU, positionId: null, fromQ: 40, toQ: 64 }, week([]), ctx)).toBeNull();
    expect(proveGap({ code: "mod_missing", date: THU, positionId: null, fromQ: 40, toQ: 48 }, week([]), ctx)?.cause).toBe("structure");
    const elig: DeclaredGap = { ...across, cause: "eligibility", certificate: { positionId: null, eligibleCount: 0 } };
    expect(checkCertificate(elig, week([]), ctx)).toBe(false);
    // Availability is judged per quarter where the person counts: Iris unavailable after noon proves the afternoon.
    ctx.people[U.iris]!.availability[THU] = { fromQ: 28, toQ: 48, source: "toast_pattern" };
    const av: DeclaredGap = { ...across, cause: "availability", certificate: { eligibleIds: [U.iris], unavailableIds: [U.iris] } };
    expect(checkCertificate(av, week([]), ctx)).toBe(true);
    ctx.people[U.iris]!.availability[THU] = { fromQ: 28, toQ: 56, source: "toast_pattern" };
    expect(checkCertificate(av, week([]), ctx)).toBe(false); // available 12:00–14:00, when she counts
  });

  it("hoursNeeded (Astra ruling): the legal MARGINAL non-essential hourly cost — extending an essential closer costs 0; an illegal extension is not counted", () => {
    const ctx = context({ built: [WED] });
    setNeed(ctx, WED, P.REG, 60, 64);
    ctx.budgetByDate[WED] = 0;
    const subject = { code: "coverage_gap" as const, date: WED, positionId: P.REG, fromQ: 60, toQ: 64 };
    // Iris closes 16:00–20:45 on Register (essential): extending her back to 15:00 costs no non-essential hour.
    const closer = shift(U.iris, WED, 64, 83, P.REG, { closingManager: true });
    expect(proveGap(subject, week([closer]), ctx)?.cause).not.toBe("budget_limited");
    // A non-essential adjacent shift: the extension's hours (1 h); its availability ending at 15:00 makes it illegal → a new 4 h block.
    const ben = shift(U.ben, WED, 44, 60, P.REG);
    ctx.budgetByDate[WED] = 4;
    expect(proveGap(subject, week([ben]), ctx)).toMatchObject({ cause: "budget_limited", certificate: { fillHours: 1, usedHours: 4 } });
    ctx.people[U.ben]!.availability[WED] = { fromQ: 40, toQ: 60, source: "toast_pattern" };
    expect(proveGap(subject, week([ben]), ctx)).toMatchObject({ cause: "budget_limited", certificate: { fillHours: 4 } });
    // A pinned shift is never extended.
    ctx.people[U.ben]!.availability = {};
    expect(proveGap(subject, week([{ ...ben, pinned: true }]), ctx)).toMatchObject({ cause: "budget_limited", certificate: { fillHours: 4 } });
    // Reassignment: Ben on an over-covered Walk-ins / Online can move over at no extra hour → never a budget gap.
    const twoWalk = shift(U.ben, WED, 56, 72, P.WALKON);
    const maya = shift(U.maya, WED, 56, 72, P.WALKON);
    const roomy = context({ s: structure((x) => { x.positions[P.WALKON]!.headsBefore = 2; x.positions[P.WALKON]!.headsAfter = 2; }), built: [WED] });
    setNeed(roomy, WED, P.REG, 60, 64);
    setNeed(roomy, WED, P.WALKON, 56, 72);
    roomy.budgetByDate[WED] = 0;
    expect(proveGap(subject, week([twoWalk, maya]), roomy)?.cause).not.toBe("budget_limited");
  });
});


describe("Astra's chunk C review probes (failing first)", () => {
  const regOnlyBen = () => {
    const ctx = context({ s: structure((x) => { x.positions[P.REG]!.allowedRoles = ["employee"]; }) }); // Ben is the one eligible member (Tess is inactive)
    setNeed(ctx, WED, P.REG, 44, 48);
    ctx.budgetByDate[WED] = 0;
    return ctx;
  };
  const budgetGap = (fillHours: number): DeclaredGap => forged({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48 }, [WED], fillHours);

  it("P1 budget needs a LEGAL PLACEMENT WITNESS: one eligible employee available 11:00–12:00, a 4 h minimum, a 1 h gap, budget 0 → NOT a budget proof", () => {
    const ctx = regOnlyBen();
    ctx.people[U.ben]!.availability[WED] = { fromQ: 44, toQ: 48, source: "toast_pattern" };
    // No 4 h shift fits inside 11:00–12:00, so no legal fill exists: the budget is not the reason.
    expect(checkCertificate(budgetGap(4), week([]), ctx)).toBe(false);
    expect(checkCertificate(budgetGap(1), week([]), ctx)).toBe(false);
    expect(proveGap({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48 }, week([]), ctx)?.cause).not.toBe("budget_limited");
    // With 11:00–15:00 available, the 4 h block 11:00–15:00 is the witness: budget_limited, W = 4.
    ctx.people[U.ben]!.availability[WED] = { fromQ: 44, toQ: 60, source: "toast_pattern" };
    expect(proven({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48 }, week([]), ctx).certificate).toMatchObject({ fillHours: 4,
      witness: [{ kind: "new_block", userId: U.ben, positionId: P.REG, fromQ: 44, toQ: 60, hours: 4 }] });
  });

  it("P1 the witness is a whole legal block: inside the position's open–close window, no overlap with the person's own shift, the daily maximum, the leader setting", () => {
    // Window: Register opens 10:30 (42). A gap at 10:30–11:00 needs a 4 h block starting at 10:30 at the earliest.
    const ctx = regOnlyBen();
    ctx.days[WED]!.need.positions[P.REG]!.fill(0);
    setNeed(ctx, WED, P.REG, 42, 44);
    ctx.people[U.ben]!.availability[WED] = { fromQ: 36, toQ: 50, source: "toast_pattern" }; // 9:00–12:30: no 4 h block from 10:30 fits
    const gap = (hoursNeeded: number): DeclaredGap => ({ ...budgetGap(hoursNeeded), fromQ: 42, toQ: 44 });
    expect(checkCertificate(gap(4), week([]), ctx)).toBe(false);
    ctx.people[U.ben]!.availability[WED] = { fromQ: 36, toQ: 58, source: "toast_pattern" }; // 9:00–14:30: 10:30–14:30 fits
    expect(proven({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 42, toQ: 44 }, week([]), ctx).certificate).toMatchObject({ fillHours: 4 });
    // Ben's own shift that day (Walk-ins / Online 1:00–8:00 PM, 7 h, not the closing window): a NEW 4 h block from 10:30 would
    // overlap it and break the daily maximum (7 + 4 > 10.5 h), so it is never the witness; extending his shift back to 10:30 (9.5 h, the
    // 0.5 h hole + a 2 h bridge on Register) is, and it costs 2.5 h.
    const busy = regOnlyBen();
    busy.people[U.ben]!.availability[WED] = { fromQ: 36, toQ: 84, source: "toast_pattern" };
    busy.days[WED]!.need.positions[P.REG]!.fill(0);
    setNeed(busy, WED, P.REG, 42, 44);
    const own = shift(U.ben, WED, 52, 80, P.WALKON);
    expect(checkCertificate({ ...gap(4), certificate: { ...gap(4).certificate, usedHours: 7 } } as DeclaredGap, week([own]), busy)).toBe(false);
    expect(proveGap({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 42, toQ: 44 }, week([own]), busy)).toMatchObject({ cause: "budget_limited", certificate: { fillHours: 2.5 } });
  });

  it("P1 a secondary whose primary is unstaffed: the witness must staff the primary too (two people, two blocks), else no budget proof", () => {
    const ctx = context();
    setNeed(ctx, WED, P.WALK, 44, 48); // Walk-ins (secondary of Walk-ins / Online), primary unstaffed
    ctx.budgetByDate[WED] = 0;
    const proof = proveGap({ code: "coverage_gap", date: WED, positionId: P.WALK, fromQ: 44, toQ: 48 }, week([]), ctx);
    expect(proof).toMatchObject({ cause: "budget_limited", certificate: { fillHours: 8 } }); // 4 h on Walk-ins + 4 h on Walk-ins / Online (paired)
    // Only one person may work either position: no legal pair exists → not a budget proof.
    const solo = context({ s: structure((x) => { x.positions[P.WALK]!.allowedRoles = ["employee"]; x.positions[P.WALKON]!.allowedRoles = ["employee"]; }) });
    setNeed(solo, WED, P.WALK, 44, 48);
    solo.budgetByDate[WED] = 0;
    expect(proveGap({ code: "coverage_gap", date: WED, positionId: P.WALK, fromQ: 44, toQ: 48 }, week([]), solo)?.cause).not.toBe("budget_limited");
  });
});

describe("Astra's chunk D review P1 + CC's design ruling: budget_limited — R < the cheapest legal fill FOUND (never a minimality claim)", () => {
  /** Her probe: Walk-ins / Online (primary) and Walk-ins (secondary) staffed 10:30–2:30 by two people; both needed to 3:30. */
  const probe = (budget: number) => {
    const ctx = context();
    setNeed(ctx, WED, P.WALKON, 42, 62);
    setNeed(ctx, WED, P.WALK, 42, 62);
    ctx.budgetByDate[WED] = budget;
    const s = week([shift(U.maya, WED, 42, 58, P.WALKON), shift(U.ben, WED, 42, 58, P.WALK)]);
    return { ctx, s, subject: { code: "coverage_gap" as const, date: WED, positionId: P.WALK, fromQ: 58, toQ: 62 } };
  };

  it("the PAIRED extension is found (each existing shift extended 1 h = 2 h) — with 2 h left it is NOT a budget gap", () => {
    const { ctx, s, subject } = probe(10); // 8 h used, R = 2
    expect(cheapestFill(subject, s, ctx)).toEqual({ hours: 2, steps: [
      { kind: "extend", userId: U.ben, shiftStartQ: 42, positionId: P.WALK, fromQ: 58, toQ: 62, hours: 1 },
      { kind: "extend", userId: U.maya, shiftStartQ: 42, positionId: P.WALKON, fromQ: 58, toQ: 62, hours: 1 },
    ] });
    expect(proveGap(subject, s, ctx)?.cause).not.toBe("budget_limited");
    // The old over-statement (a hand-made 8 h claim) is refused: it is not what the search found.
    expect(checkCertificate(forged(subject, [WED], 8), s, ctx)).toBe(false);
    // The completed schedule (both extended) leaves no error and no gap on those positions.
    const done = run([shift(U.maya, WED, 42, 62, P.WALKON), shift(U.ben, WED, 42, 62, P.WALK)], ctx);
    expect(done.filter((p) => p.severity !== "warning" && (p.positionId === P.WALK || p.positionId === P.WALKON))).toEqual([]);
  });

  it("with less than W left (R = 1.5 < 2) it IS budget_limited, carrying R, W and the witness; shown as a proven gap", () => {
    const { ctx, s, subject } = probe(9.5);
    const g = proven(subject, s, ctx);
    expect(g.certificate).toMatchObject({ remainingHours: 1.5, fillHours: 2 });
    expect(checkCertificate(g, s, ctx)).toBe(true);
    expect(run(s.shifts, ctx, [g]).filter((p) => p.code === "coverage_gap" && p.positionId === P.WALK)).toMatchObject([{ params: { cause: "budget_limited", proven: true } }]);
  });

  it("Approve does NOT refuse a budget_limited gap (a manager's choice); it still refuses unresolved_search", () => {
    const { ctx, s, subject } = probe(9.5);
    const g = proven(subject, s, ctx);
    expect(approvalRefusal(week(s.shifts, [g]), run(s.shifts, ctx, [g]).filter((p) => p.positionId === P.WALK))).toBeNull();
    const unresolved = { ...subject, cause: "unresolved_search", certificate: { searched: { steps: 200, donorsTried: 8, chainDepth: 3 }, limits: { ...REPAIR_LIMITS }, candidateIds: [] } } as DeclaredGap;
    expect(approvalRefusal(week(s.shifts, [unresolved]), [])).toBe("unresolved_gaps");
  });

  it("a REASSIGNMENT is searched: Ben moves off Walk-ins / Online to Register and Maya stays on there 1 h earlier (W = 1)", () => {
    const ctx = context();
    setNeed(ctx, WED, P.REG, 48, 52);
    setNeed(ctx, WED, P.WALKON, 42, 68);
    ctx.budgetByDate[WED] = 0;
    const s = week([shift(U.ben, WED, 42, 52, P.WALKON), shift(U.maya, WED, 52, 68, P.WALKON)]);
    const plan = cheapestFill({ date: WED, positionId: P.REG, fromQ: 48, toQ: 52 }, s, ctx);
    expect(plan).toEqual({ hours: 1, steps: [
      { kind: "relabel", userId: U.ben, shiftStartQ: 42, fromPositionId: P.WALKON, positionId: P.REG, fromQ: 48, toQ: 52 },
      { kind: "extend", userId: U.maya, shiftStartQ: 52, positionId: P.WALKON, fromQ: 48, toQ: 52, hours: 1 },
    ] });
  });
});

describe("Astra's chunk E review P1-1: a witness is legal only when the WHOLE combined fill applies cleanly", () => {
  /**
   * Her probe: Ben is on Register 11–3 (needed); Walk-ins (secondary) and Walk-ins / Online (primary) are both needed
   * 11–3 and empty. Only Ben and Maya can work. The old search moved Ben to Walk-ins, refilled Register with a Maya
   * block AND paired Walk-ins / Online with ANOTHER Maya block over the same hours (W = 8) — Maya double-booked.
   */
  const probe = (extra: (ctx: RuleContext) => void = () => {}) => {
    // Register holds two heads (the room her refill used); one is needed.
    const ctx = context({ s: structure((x) => { x.positions[P.REG]!.headsBefore = 2; x.positions[P.REG]!.headsAfter = 2; }) });
    for (const id of [U.iris, U.dani, U.eli, U.kai, U.alex, U.pete]) ctx.people[id]!.activeMember = false;
    setNeed(ctx, WED, P.REG, 44, 60);
    setNeed(ctx, WED, P.WALKON, 44, 60);
    setNeed(ctx, WED, P.WALK, 44, 60);
    ctx.budgetByDate[WED] = 0;
    extra(ctx);
    const s = week([shift(U.ben, WED, 44, 60, P.REG)]);
    return { ctx, s, subject: { code: "coverage_gap" as const, date: WED, positionId: P.WALK, fromQ: 44, toQ: 60 } };
  };
  const herWitness = [
    { kind: "relabel" as const, userId: U.ben, shiftStartQ: 44, fromPositionId: P.REG, positionId: P.WALK, fromQ: 44, toQ: 60 },
    { kind: "new_block" as const, userId: U.maya, positionId: P.REG, fromQ: 44, toQ: 60, hours: 4 },
    { kind: "new_block" as const, userId: U.maya, positionId: P.WALKON, fromQ: 44, toQ: 60, hours: 4 },
  ];

  it("her double-booked plan is REFUSED as a witness; with no legal plan the deficit is never budget_limited", () => {
    const { ctx, s, subject } = probe();
    expect(fillIsLegal(subject, s, ctx, { hours: 8, steps: herWitness })).toBe(false);
    expect(cheapestFill(subject, s, ctx)).toBeNull();
    expect(proveGap(subject, s, ctx)?.cause).not.toBe("budget_limited");
    const f = { budgetedDates: [WED], budgetHours: 0, usedHours: 4, essentialHours: 0, remainingHours: -4, fillHours: 8, witness: herWitness };
    expect(checkCertificate({ ...subject, cause: "budget_limited", certificate: f } as DeclaredGap, s, ctx)).toBe(false);
  });

  it("when a LEGAL combined plan exists (a third person for the paired primary) it is the witness, and it validates", () => {
    const { ctx, s, subject } = probe((c) => { c.people[U.eli]!.activeMember = true; });
    const plan = cheapestFill(subject, s, ctx)!;
    expect(plan).not.toBeNull();
    expect(fillIsLegal(subject, s, ctx, plan)).toBe(true);
    const users = plan.steps.filter((x) => x.kind === "new_block").map((x) => x.userId);
    expect(new Set(users).size).toBe(users.length); // nobody gets two blocks over the same hours
    const g = proven(subject, s, ctx);
    expect(g.certificate).toMatchObject({ fillHours: plan.hours, witness: plan.steps });
    expect(checkCertificate(g, s, ctx)).toBe(true);
  });

  it("the applied witness is validated, not just re-found: an overlapping, over-maximum or unavailable step is illegal", () => {
    const { ctx, s, subject } = probe((c) => { c.people[U.eli]!.activeMember = true; });
    // Overlap with the person's own shift.
    expect(fillIsLegal(subject, s, ctx, { hours: 4, steps: [{ kind: "new_block", userId: U.ben, positionId: P.WALK, fromQ: 44, toQ: 60, hours: 4 }] })).toBe(false);
    // Outside availability.
    ctx.people[U.eli]!.availability[WED] = { fromQ: 64, toQ: 84, source: "toast_pattern" };
    expect(fillIsLegal(subject, s, ctx, { hours: 8, steps: [
      { kind: "new_block", userId: U.eli, positionId: P.WALK, fromQ: 44, toQ: 60, hours: 4 },
      { kind: "new_block", userId: U.maya, positionId: P.WALKON, fromQ: 44, toQ: 60, hours: 4 },
    ] })).toBe(false);
    // A step that does not apply (no such shift) is illegal.
    expect(fillIsLegal(subject, s, ctx, { hours: 1, steps: [{ kind: "extend", userId: U.maya, shiftStartQ: 30, positionId: P.WALK, fromQ: 44, toQ: 60, hours: 4 }] })).toBe(false);
  });
});

describe("CC chunk C ruling 2: the cap-only structure certificate (max_shift) — a counting bound over eligible people × availability, capped per day", () => {
  /** Register 10:30–9:00 PM (42 quarters) needs one head; the shop's cap is 8 h (32 q); Ben is the only eligible member. */
  const capShop = (over: (s: ScheduleStructure) => void = () => {}) => {
    const ctx = context({ s: structure((x) => { x.positions[P.REG]!.allowedRoles = ["employee"]; x.limits.maxShiftH = 8; x.limits.gmMinimumH = 8; x.limits.agmMinimumH = 8; over(x); }) });
    setNeed(ctx, WED, P.REG, 42, 84);
    return ctx;
  };
  const subject = { code: "coverage_gap" as const, date: WED, positionId: P.REG, fromQ: 74, toQ: 84 };

  it("the validator's daily maximum is per person per DATE (a split day cannot dodge it), one problem at the day's first shift", () => {
    const two = run([shift(U.ben, WED, 42, 66, P.REG), shift(U.ben, WED, 66, 86, P.WALKON)]);
    expect(of(two, "shift_over_maximum")).toEqual([expect.objectContaining({ userId: U.ben, q: 42, params: { minutes: 660, maximumMinutes: 630 } })]);
    expect(of(run([shift(U.ben, WED, 42, 60, P.REG), shift(U.ben, WED, 64, 84, P.WALKON)]), "shift_over_maximum")).toEqual([]); // 9.5 h in two shifts
  });

  it("positive: one eligible person, a 10.5 h need, an 8 h cap → short 10 quarters in EVERY allocation; the 2:30–9:00 PM remainder is certified by the numbers", () => {
    const ctx = capShop();
    const s = week([shift(U.ben, WED, 42, 74, P.REG)]);
    const proof = proveGap(subject, s, ctx);
    expect(proof).toEqual({ cause: "structure", certificate: { rule: "max_shift", detail: {
      positionId: P.REG, runFromQ: 42, runToQ: 84, runQ: 42, maxShiftQ: 32, requiredQ: 42, peopleIds: [U.ben], availableQ: 42, coverableQ: 32, shortQ: 10,
    } } });
    expect(checkCertificate({ ...subject, ...proof! } as DeclaredGap, s, ctx)).toBe(true);
    // And the validator accepts the declared gap as certified.
    const gap = { ...subject, ...proof! } as DeclaredGap;
    const problems = run(s.shifts, ctx, [gap]);
    expect(problems.find((p) => p.code === "coverage_gap")).toMatchObject({ positionId: P.REG, q: 74, params: { cause: "structure", proven: true } });
    expect(problems.filter((p) => (p.code === "uncertified_gap" || p.code === "undeclared_gap") && p.params.gap === "coverage_gap")).toEqual([]);
  });

  it("negative: an overlong window ALONE is not proof — a second eligible person who is available makes it coverable (8 + 8 ≥ 10.5 h)", () => {
    const ctx = capShop((x) => { x.positions[P.REG]!.allowedRoles = ["employee", "trainer"]; }); // + Maya
    const s = week([shift(U.ben, WED, 42, 74, P.REG)]);
    expect(proveGap(subject, s, ctx)?.certificate).not.toMatchObject({ rule: "max_shift" });
    const forged: DeclaredGap = { ...subject, cause: "structure", certificate: { rule: "max_shift", detail: {
      positionId: P.REG, runFromQ: 42, runToQ: 84, runQ: 42, maxShiftQ: 32, requiredQ: 42, peopleIds: [U.ben], availableQ: 42, coverableQ: 32, shortQ: 10,
    } } };
    expect(checkCertificate(forged, s, ctx)).toBe(false);
    // …unless Maya is unavailable that day: then the bound is back (availability enters the count).
    ctx.people[U.maya]!.availability[WED] = null;
    expect(checkCertificate(forged, s, ctx)).toBe(true);
  });

  it("negative: the cap must be the ONLY reason — no availability shortage (a quarter with nobody available is not the cap's), no excess beyond the bound, a run that fits one shift", () => {
    const ctx = capShop();
    ctx.people[U.ben]!.availability[WED] = { fromQ: 42, toQ: 70, source: "toast_pattern" }; // nobody can stand there after 5:30 PM
    expect(proveGap(subject, week([shift(U.ben, WED, 42, 70, P.REG)]), ctx)?.certificate).not.toMatchObject({ rule: "max_shift" });
    const excess = capShop();
    expect(proveGap({ ...subject, fromQ: 66 }, week([shift(U.ben, WED, 42, 66, P.REG)]), excess)?.certificate).not.toMatchObject({ rule: "max_shift" }); // 18 q uncovered > 10 provable
    const fits = capShop((x) => { x.limits.maxShiftH = 12; });
    expect(proveGap(subject, week([shift(U.ben, WED, 42, 74, P.REG)]), fits)?.certificate).not.toMatchObject({ rule: "max_shift" });
  });

  it("tampered numbers are refused (every field is recomputed)", () => {
    const ctx = capShop();
    const s = week([shift(U.ben, WED, 42, 74, P.REG)]);
    const proof = proveGap(subject, s, ctx)!;
    const detail = (proof.certificate as { detail: Record<string, unknown> }).detail;
    for (const [k, v] of [["shortQ", 12], ["maxShiftQ", 40], ["runFromQ", 40], ["peopleIds", [U.ben, U.maya]], ["coverableQ", 30]] as const) {
      expect(checkCertificate({ ...subject, cause: "structure", certificate: { rule: "max_shift", detail: { ...detail, [k]: v } } } as DeclaredGap, s, ctx), k).toBe(false);
    }
  });

  it("the MoD: one manager for a 13.75 h shop day under a 10.5 h cap → the evening remainder is certified; with a second manager it is not", () => {
    // KH-as-MoD OFF here (with the 19:00 default Iris, a KH, would carry the evening).
    const ctx = context({ s: structure((x) => { x.leadership.modRequired = true; x.leadership.keyHolderModAfterQ = null; }) });
    ctx.people[U.alex]!.activeMember = false; // Dani is the only SL+ member
    const s = week([shift(U.dani, WED, 28, 70, "mod")]);
    const mod = { code: "mod_missing" as const, date: WED, positionId: null, fromQ: 70, toQ: 83 };
    expect(proveGap(mod, s, ctx)).toMatchObject({ cause: "structure", certificate: { rule: "max_shift", detail: { positionId: "mod", runFromQ: 28, runToQ: 83, requiredQ: 55, coverableQ: 42, shortQ: 13 } } });
    ctx.people[U.alex]!.activeMember = true;
    expect(proveGap(mod, s, ctx)?.certificate).not.toMatchObject({ rule: "max_shift" });
  });
});

describe("Juan 2026-10-16 — the salaried week (decision 4) and the catering manager's cover (decision 8)", () => {
  const segs = (userId: string, date: string, parts: Array<[string, number, number, string?]>) => shift(userId, date, parts[0]![1], parts[parts.length - 1]![2], parts[0]![0], {
    segments: parts.map(([positionId, startQ, endQ, reasonKey]) => ({ positionId, startQ, endQ, ...(reasonKey ? { reasonKey } : {}) })),
  });
  const FIVE = [WED, THU, FRI, SAT, SUN];

  it("salaried_base_over_target — the base week (station + MoD, flex quarters aside) over limits.salariedTargetWeekH (40) is an ERROR", () => {
    expect(RULE_CODES.salaried_base_over_target).toBe("error");
    const over = FIVE.map((d) => shift(U.alex, d, 28, 61, "mod")); // 5 × 8.25 h = 41.25 h, no flex reason
    const ps = of(run(over), "salaried_base_over_target");
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ day: SUN, userId: U.alex, params: { hours: 41.25, limit: 40 } });
    expect(of(run(FIVE.map((d) => shift(U.alex, d, 28, 60, "mod"))), "salaried_base_over_target")).toEqual([]);
    // Hourly people are never judged by it.
    expect(of(run(FIVE.map((d) => shift(U.maya, d, 28, 61, P.PREP))), "salaried_base_over_target")).toEqual([]);
  });

  it("flex quarters (SALARIED_FLEX_REASON) take a salaried week past 40 legally, up to 40 + limits.salariedFlexH; past it → salaried_over_flex (ERROR)", () => {
    expect(SALARIED_FLEX_REASON).toBe("schedule.reason.salaried_flex");
    expect(RULE_CODES.salaried_over_flex).toBe("error");
    // 40 h base + 2 h of stay-longer flex on Register.
    const week40 = FIVE.map((d, i) => (i === 0 ? segs(U.alex, d, [["mod", 28, 60], [P.REG, 60, 68, SALARIED_FLEX_REASON]]) : shift(U.alex, d, 28, 60, "mod")));
    const ok = run(week40);
    expect(of(ok, "salaried_base_over_target")).toEqual([]);
    expect(of(ok, "salaried_over_flex")).toEqual([]);
    // The same 2 h WITHOUT the flex reason: the base week is 42 h.
    const plain = FIVE.map((d, i) => (i === 0 ? segs(U.alex, d, [["mod", 28, 60], [P.REG, 60, 68]]) : shift(U.alex, d, 28, 60, "mod")));
    expect(of(run(plain), "salaried_base_over_target")[0]).toMatchObject({ params: { hours: 42, limit: 40 } });
    // Flex 0 h: any flex quarter is over.
    const noFlex = context({ s: structure((s) => { s.limits.salariedFlexH = 0; }) });
    expect(of(run(week40, noFlex), "salaried_over_flex")[0]).toMatchObject({ userId: U.alex, params: { hours: 42, flexHours: 2, flexLimit: 0, limit: 40 } });
    // 11.25 h of flex (5 × 2.25 h) over a 40 h base.
    const big = FIVE.map((d) => segs(U.alex, d, [["mod", 28, 60], [P.REG, 60, 69, SALARIED_FLEX_REASON]]));
    expect(of(run(big), "salaried_over_flex")[0]).toMatchObject({ params: { hours: 51.25, flexHours: 11.25, flexLimit: 10, limit: 40 } });
  });

  it("manager_floor_exceeded judges BASE station time: station past 32 h only through flex quarters", () => {
    const station = FIVE.map((d) => shift(U.alex, d, 28, 56, P.PREP)); // 5 × 7 h = 35 h of station time
    expect(of(run(station), "manager_floor_exceeded")[0]).toMatchObject({ params: { hours: 35, limit: 32 } });
    const flexed = FIVE.map((d, i) => (i === 0 ? segs(U.alex, d, [[P.PREP, 28, 44], [P.PREP, 44, 56, SALARIED_FLEX_REASON]]) : shift(U.alex, d, 28, 56, P.PREP)));
    expect(of(run(flexed), "manager_floor_exceeded")).toEqual([]); // 35 − 3 h of flex = 32 h of base station time
  });

  it("the overtime WARNING is for hourly people: a salaried week is governed by its target + flex", () => {
    const week40 = FIVE.map((d, i) => (i === 0 ? segs(U.alex, d, [["mod", 28, 60], [P.REG, 60, 68, SALARIED_FLEX_REASON]]) : shift(U.alex, d, 28, 60, "mod")));
    expect(of(run(week40), "overtime")).toEqual([]);
    expect(of(run(FIVE.map((d) => shift(U.maya, d, 28, 61, P.PREP))), "overtime")).toHaveLength(1);
  });

  it("zero-hourly-cost fills: the MoD relabel takes the base station room, then FLEX; staying longer is FLEX only", () => {
    const at = (floor: number, flex: number) => {
      const c = context({ built: [WED], s: structure((x) => { x.limits.managerFloorH = floor; x.limits.salariedFlexH = flex; }) });
      setNeed(c, WED, P.REG, 44, 52);
      return c;
    };
    const s = week([shift(U.alex, WED, 28, 60, "mod")]);
    const covers = (c: RuleContext) => zeroCostCovers({ date: WED, positionId: P.REG, fromQ: 44, toQ: 52 }, s, c);
    expect(covers(context({ built: [WED] }).days[WED] ? at(32, 10) : at(32, 10))).toEqual([{ userId: U.alex, fromQ: 44, toQ: 52 }]);
    expect(covers(at(0, 0))).toEqual([]); // floor and flex spent
    expect(covers(at(0, 1))).toEqual([{ userId: U.alex, fromQ: 44, toQ: 48 }]); // 1 h of flex
    expect(covers(at(1, 0))).toEqual([{ userId: U.alex, fromQ: 44, toQ: 48 }]); // 1 h of base room
    expect(covers(at(1, 1))).toEqual([{ userId: U.alex, fromQ: 44, toQ: 52 }]); // 1 h base + 1 h flex
    // Applied by the budget search: the base part unmarked, the rest FLEX.
    const plan = cheapestFill({ date: WED, positionId: P.REG, fromQ: 44, toQ: 52 }, s, at(1, 1));
    expect(plan).toMatchObject({ hours: 0, steps: [{ kind: "relabel", userId: U.alex }] });
    // Staying longer: FLEX only (the base station room never pays for added time).
    const after = week([shift(U.alex, WED, 28, 44, "mod")]);
    const ext = (c: RuleContext) => zeroCostCovers({ date: WED, positionId: P.REG, fromQ: 44, toQ: 52 }, after, c).filter((x) => x.extend);
    expect(ext(at(32, 0))).toEqual([]);
    expect(ext(at(0, 1))).toEqual([{ userId: U.alex, fromQ: 44, toQ: 48, extend: "after" }]);
  });

  it("decision 8: a catering manager may cover a station ONLY as a last resort marked CATERING_MANAGER_COVER, outside booked catering windows", () => {
    expect(CATERING_MANAGER_COVER).toBe("schedule.reason.catering_manager_cover");
    expect(RULE_CODES.catering_cover_in_catering_window).toBe("error");
    const ctx = context({ built: [WED] });
    ctx.people["u-cat"] = { ...ctx.people[U.dani]!, userId: "u-cat", role: "catering_mgr", leaderSetting: "mix", coverPositions: [] };
    // A booked event at 13:00 (lead 210 min → its window 09:30–13:00).
    ctx.days[WED]!.inputs.cateringEvents = [{ id: "ev-1", headcount: 12, eventQ: 52 }];
    expect(cateringWindows(ctx.days[WED]!)).toEqual([[38, 52]]);
    const cover = (from: number, to: number, extra: Record<string, unknown> = { lastResort: true, reasonKey: CATERING_MANAGER_COVER }) =>
      segs("u-cat", WED, [["mod", 36, from], [P.REG, from, to], ["mod", to, 76]]).segments.map((g) => (g.positionId === P.REG ? { ...g, ...extra } : g));
    const at = (segments: ReturnType<typeof cover>) => [{ ...shift("u-cat", WED, 36, 76, "mod"), pinned: true, segments }];
    const outside = run(at(cover(56, 64)), ctx);
    expect(of(outside, "role_not_allowed")).toEqual([]);
    expect(of(outside, "catering_cover_in_catering_window")).toEqual([]);
    expect(of(outside, "cover_outside_preferences")).toEqual([]);
    // Inside the booked window: an error, named.
    expect(of(run(at(cover(44, 52)), ctx), "catering_cover_in_catering_window")[0]).toMatchObject({ userId: "u-cat", positionId: P.REG, q: 44 });
    // Without the marker (or not as a last resort): the role is simply not allowed there.
    expect(of(run(at(cover(56, 64, { lastResort: true })), ctx), "role_not_allowed")).toHaveLength(1);
    expect(of(run(at(cover(56, 64, { reasonKey: CATERING_MANAGER_COVER })), ctx), "role_not_allowed")).toHaveLength(1);
    // Never on Prep/Dishwasher.
    const dish = segs("u-cat", WED, [["mod", 36, 56], [P.DISH, 56, 64], ["mod", 64, 76]]).segments.map((g) => (g.positionId === P.DISH ? { ...g, lastResort: true, reasonKey: CATERING_MANAGER_COVER } : g));
    expect(of(run(at(dish), ctx), "role_not_allowed")).toHaveLength(1);
  });
});

describe("Juan 2026-10-16 (decision 4): floor_limit also proves a manager whose BASE week target is reached", () => {
  it("a free GM at 40 h base (station time under 32 h) cannot take a new block: floor_limit certifies; with base room it does not", () => {
    const ctx = context({ s: structure((x) => { x.limits.salariedFlexH = 0; }) });
    setNeed(ctx, SUN, P.PREP, 28, 44);
    for (const u of [U.maya, U.ben, U.kai, U.iris, U.eli, U.dani]) ctx.people[u]!.availability[SUN] = null;
    const five = [WED, THU, FRI, SAT].map((d) => shift(U.alex, d, 28, 68, "mod")); // 4 × 10 h of MoD = 40 h base, 0 h station
    const g: DeclaredGap = { code: "coverage_gap", date: SUN, positionId: P.PREP, fromQ: 28, toQ: 44, cause: "floor_limit",
      certificate: { managerIds: [U.alex], floorHoursUsed: { [U.alex]: 0 }, limitH: 32 } };
    expect(checkCertificate(g, week(five), ctx)).toBe(true);
    expect(proveGap(g, week(five), ctx)?.cause).toBe("floor_limit");
    // 30 h of base week: a 4 h window fits under the target — no proof.
    const thirty = [WED, THU, FRI].map((d) => shift(U.alex, d, 28, 68, "mod"));
    expect(checkCertificate(g, week(thirty), ctx)).toBe(false);
  });
});

describe("Astra chunk H review (2026-10-16)", () => {
  it("P2-1: a relabel keeps each quarter's flex classification — 40 h base + 2 h flex MoD relabelled onto Register stays 40 + 2", () => {
    const flexMod = { positionId: "mod", startQ: 60, endQ: 68, reasonKey: SALARIED_FLEX_REASON };
    const sun = shift(U.alex, SUN, 28, 68, "mod", { segments: [{ positionId: "mod", startQ: 28, endQ: 60 }, flexMod] });
    const s = week([...[WED, THU, FRI, SAT].map((d) => shift(U.alex, d, 28, 60, "mod")), sun]);
    expect(salariedWeek(s, U.alex)).toEqual({ totalH: 42, flexH: 2, baseH: 40 });
    const ctx = context();
    setNeed(ctx, SUN, P.REG, 60, 68);
    const plan = cheapestFill({ date: SUN, positionId: P.REG, fromQ: 60, toQ: 68 }, s, ctx);
    expect(plan).toMatchObject({ hours: 0, steps: [{ kind: "relabel", userId: U.alex, fromPositionId: "mod", positionId: P.REG, fromQ: 60, toQ: 68 }] });
    const applied = applyFillSteps(s, SUN, plan!.steps, new Map([[U.alex, 32 * 4]]))!;
    expect(salariedWeek(applied, U.alex)).toEqual({ totalH: 42, flexH: 2, baseH: 40 });
    expect(applied.shifts.find((x) => x.date === SUN)!.segments.find((g) => g.positionId === P.REG)).toMatchObject({ startQ: 60, endQ: 68, reasonKey: SALARIED_FLEX_REASON });
    expect(of(run(applied.shifts, ctx), "salaried_base_over_target")).toEqual([]);
    expect(fillIsLegal({ date: SUN, positionId: P.REG, fromQ: 60, toQ: 68 }, s, ctx, plan!)).toBe(true);
  });
});
