/**
 * Scheduling Phase 2, Task 3 — the validator `checkScheduleRules` (plan "The validator ↔ mockup
 * invariants map"): one positive and one negative case for EVERY code, the gap certificates per cause
 * (r2 P1-1, r3 capacity + unresolved_search, r4 Approve), original vs current validation (r3 P2-4,
 * r4), the historical contract (r2 P1-3), deterministic order and a complexity guard.
 */
import { describe, expect, it } from "vitest";
import {
  CALLOUT_LAST_RESORT, RULE_CODES, REPAIR_LIMITS, approvalRefusal, capacityBound, checkCertificate, checkScheduleRules,
  proveGap, structureInfeasible, type DeclaredGap, type RuleCode, type RuleProblem,
} from "@/lib/scheduling/rules-shared";
import { contextAdvisory, ruleContextFromSnapshot, toContextSnapshot, type RuleContext } from "@/lib/scheduling/context-shared";
import {
  DATES, FRI, MON, P, SAT, SUN, THU, TUE, U, WED, context, setNeed, shift, structure, week,
} from "./fixtures/schedule/rules-fixture";

const run = (shifts = [] as ReturnType<typeof shift>[], ctx: RuleContext = context(), gaps: DeclaredGap[] = []) =>
  checkScheduleRules(week(shifts, gaps), ctx);
const codes = (ps: RuleProblem[]) => [...new Set(ps.map((p) => p.code))].sort();
const of = (ps: RuleProblem[], code: RuleCode) => ps.filter((p) => p.code === code);

describe("the severity table", () => {
  it("errors, gaps and warnings are exactly the plan's map", () => {
    const by = (sev: string) => Object.entries(RULE_CODES).filter(([, s]) => s === sev).map(([c]) => c).sort();
    expect(by("gap")).toEqual(["closing_manager_missing", "coverage_gap", "mod_missing"]);
    expect(by("warning")).toEqual(["checklist_past_max", "flex_used", "outside_assumed_availability", "over_budget", "overtime", "pairing_unmet", "soft_range"]);
    expect(by("error")).toEqual([
      "closing_manager_not_closing", "closing_manager_role", "closing_manager_setting", "cover_outside_preferences", "leader_setting", "manager_floor_exceeded",
      "manager_on_boh", "not_member", "person_overlap", "position_over_headcount", "role_not_allowed", "salaried_minimum",
      "secondary_without_primary", "segment_outside_window", "segments_malformed", "shift_below_minimum", "uncertified_gap",
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
    const ctx = context({ s: structure((s) => { s.leadership.modRequired = true; }), built: [THU] });
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
    const gap: DeclaredGap = { code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48, cause: "budget",
      certificate: { budgetedDates: [WED], budgetHours: 0, usedHours: 0, essentialHours: 0, hoursNeeded: 1 } };
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
  it("budget: certifies with free qualified people when the arithmetic holds; fails when the budget had room", () => {
    const ctx = context();
    setNeed(ctx, WED, P.REG, 44, 48);
    ctx.budgetByDate[WED] = 0;
    const g: DeclaredGap = { code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48, cause: "budget",
      certificate: { budgetedDates: [WED], budgetHours: 0, usedHours: 0, essentialHours: 0, hoursNeeded: 1 } };
    expect(checkCertificate(g, week([]), ctx)).toBe(true);
    ctx.budgetByDate[WED] = 10;
    expect(checkCertificate({ ...g, certificate: { ...g.certificate, budgetHours: 10 } as never }, week([]), ctx)).toBe(false);
  });

  it("floor_limit: only when every free eligible candidate is a salaried manager at the cap and no hourly person is free", () => {
    const ctx = context();
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
    const ctx = context({ s: structure((s) => { s.leadership.modRequired = true; }) });
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
    ctx.budgetByDate[WED] = 0; // now `budget` proves it: an unresolved claim is no longer honest
    expect(checkCertificate(g, week([]), ctx)).toBe(false);
    expect(proveGap({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48 }, week([]), ctx)?.cause).toBe("budget");
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
    const ctx = context();
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
    const closing: DeclaredGap = { code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 80, toQ: 83, cause: "budget",
      certificate: { budgetedDates: [WED], budgetHours: 0, usedHours: 0, essentialHours: 0, hoursNeeded: 0.75 } };
    expect(checkCertificate(closing, week([]), ctx)).toBe(false);
    expect(proveGap(closing, week([]), ctx)?.cause).not.toBe("budget");
    // A gap that merely TOUCHES the closing window is filled by a closing shift: exempt too.
    setNeed(ctx, WED, P.REG, 76, 83);
    const touching: DeclaredGap = { ...closing, fromQ: 76, toQ: 81, certificate: { ...closing.certificate, hoursNeeded: 1.25 } };
    expect(checkCertificate(touching, week([]), ctx)).toBe(false);
    // Scheduling the closer costs no budget: a whole shift working the closing window is essential.
    const filled = run([shift(U.iris, WED, 67, 83, P.REG, { closingManager: true })], ctx);
    expect(filled.filter((p) => p.severity === "error" || p.severity === "gap" || p.code === "over_budget")).toEqual([]);
    // MoD deficits are never budget gaps either.
    const modCtx = context({ s: structure((s) => { s.leadership.modRequired = true; }), built: [THU] });
    modCtx.budgetByDate[THU] = 0;
    expect(proveGap({ code: "mod_missing", date: THU, positionId: null, fromQ: 28, toQ: 83 }, week([]), modCtx)?.cause).not.toBe("budget");
    // A lunch gap with no budget is still a budget gap.
    const lunch = context({ built: [WED] });
    setNeed(lunch, WED, P.REG, 44, 48);
    lunch.budgetByDate[WED] = 0;
    expect(proveGap({ code: "coverage_gap", date: WED, positionId: P.REG, fromQ: 44, toQ: 48 }, week([]), lunch)?.cause).toBe("budget");
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
