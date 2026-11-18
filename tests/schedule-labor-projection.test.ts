// Board two labor views PR 1: the PROJECTION's pure rules (lib/scheduling/labor-projection-shared.ts).
// Which days are a schedule instead of facts (the replacement mask), the plan 0345 is sent (rows with the
// facts' own rate pick, the overtime counted by the builder's own counter over ONE selected population, this
// shop's salary row from the one allocation rule), and what each payroll week's plan is complete enough to say.
import { describe, expect, it } from "vitest";
import {
  buildLaborPlan, classifyLaborDays, planForRange, projectionInputsFor, scheduleLaborViewsEnabled,
  type BuildPlanInput, type FactQuarter, type PlanShift,
} from "@/lib/scheduling/labor-projection-shared";
import type { LaborWeekSource } from "@/lib/facts/labor-week-shared";
import type { WageVersion } from "@/lib/facts/labor-wages-shared";
import type { LaborCostRow } from "@/lib/facts/labor-cost-shared";

const LOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ANA = "00000000-0000-4000-8000-000000000010", BEN = "00000000-0000-4000-8000-000000000011", NEW = "00000000-0000-4000-8000-000000000012";
const BOSS = "00000000-0000-4000-8000-000000000001";
// Board week Mon 2026-10-05 .. Sun 2026-10-11; payroll weeks Sun 2026-10-04 (main) and Sun 2026-10-11.
const BOARD = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];
const W = "2026-10-04", W2 = "2026-10-11";
const wage = (user: string, cents: number, type: WageVersion["wage_type"] = "hourly", effective: string | null = "2026-01-01"): WageVersion =>
  ({ user_id: user, wage_id: `${user}0`, upcoming: false, effective_date: effective, wage_type: type, wage_cents: cents, role_id: null, active: true, seq: 1 });
const source = (weekStart: string, o: Partial<LaborWeekSource> = {}): LaborWeekSource => ({
  weekStart, builtThrough: null, floorDay: "2026-07-23", days: [], locationLinks: [{ location_id: LOC, sevenshifts_location_id: "501" }, { location_id: OTHER, sevenshifts_location_id: "502" }],
  userLinks: [{ sevenshifts_user_id: "7", user_id: ANA, linked_at_location_id: LOC }, { sevenshifts_user_id: "8", user_id: BEN, linked_at_location_id: LOC },
    { sevenshifts_user_id: "20", user_id: BOSS, linked_at_location_id: LOC }, { sevenshifts_user_id: "9", user_id: ANA, linked_at_location_id: OTHER }],
  toastLinks: [], punches: [], toastEntries: [], wages: [wage("7", 2000), wage("8", 3000), wage("9", 9900), wage("20", 140000, "weekly_salary")], laborSettings: [],
  payrollShops: [{ seq: 1, sevenshifts_user_id: "20", location_id: LOC, disposition: "shop", valid_from: "2026-07-19" }], ...o,
});
const shift = (userId: string, date: string, hours: number, startQ = 24): PlanShift => ({ userId, date, startQ, endQ: startQ + hours * 4 });
/** A person's recorded hours on a date as labor_quarter rows (15-minute rows from 06:00 ET). */
function facts(user: string, date: string, hours: number, otHours = 0): FactQuarter[] {
  const out: FactQuarter[] = [];
  const t0 = Date.parse(`${date}T10:00:00Z`);
  for (let i = 0; i < hours * 4; i++) out.push({ business_date: date, quarter_start_at: new Date(t0 + i * 900_000).toISOString(), person_key: `u:${user}`,
    minutes: 15, ot_minutes: i >= (hours - otHours) * 4 ? 15 : 0, pay_class: "hourly" });
  return out;
}
const covered = (dates: string[]) => dates.map((d) => ({ business_date: d, state: "covered", open_punches: 0 }));
const ready = new Map([[W, "ready" as const], [W2, "ready" as const]]);

function plan(o: Partial<BuildPlanInput> & { today: string; dayCoverage?: ReturnType<typeof covered>; weekStates?: Map<string, "ready" | "rebuilding" | "unbuilt"> }) {
  const classification = classifyLaborDays({ today: o.today, boardDates: BOARD, hasHead: o.shifts !== null, hasPrevHead: (o.prevShifts ?? null) !== null,
    dayCoverage: o.dayCoverage ?? [], weekStates: o.weekStates ?? new Map() });
  const built = buildLaborPlan({ locationId: LOC, boardDates: BOARD, classification, shifts: o.shifts ?? null, prevShifts: o.prevShifts ?? null, quarters: o.quarters ?? [],
    sources: o.sources ?? new Map([[W, source(W)], [W2, source(W2)]]), storedSalariedWeeks: o.storedSalariedWeeks ?? new Set() });
  return { classification, built };
}

describe("the switch", () => {
  it("is dark unless SCHEDULE_LABOR_VIEWS, FACT_LAYER and FACT_LAYER_LABOR are all exactly 1", () => {
    expect(scheduleLaborViewsEnabled({ SCHEDULE_LABOR_VIEWS: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" })).toBe(true);
    for (const env of [{}, { SCHEDULE_LABOR_VIEWS: "1" }, { SCHEDULE_LABOR_VIEWS: "true", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" }, { SCHEDULE_LABOR_VIEWS: "1", FACT_LAYER: "1" }]) {
      expect(scheduleLaborViewsEnabled(env)).toBe(false);
    }
  });
});

describe("which days are a schedule (the mask)", () => {
  it("a future week: every day projected and masked; the prior Sunday joins from the previous head", () => {
    const c = classifyLaborDays({ today: "2026-10-01", boardDates: BOARD, hasHead: true, hasPrevHead: true, dayCoverage: [], weekStates: new Map() });
    expect(Object.values(c.kinds)).toEqual(Array(7).fill("projected"));
    expect(c.mask).toEqual([W, ...BOARD]);
    expect(c.planWeeks).toEqual([W, W2]);
  });
  it("mid-week: past covered days of a READY week are actual and keep their facts; today and later are the plan", () => {
    const c = classifyLaborDays({ today: "2026-10-07", boardDates: BOARD, hasHead: true, hasPrevHead: true, dayCoverage: covered([W, "2026-10-05", "2026-10-06"]), weekStates: ready });
    expect(c.kinds).toMatchObject({ "2026-10-05": "actual", "2026-10-06": "actual", "2026-10-07": "projected", "2026-10-11": "projected" });
    expect(c.mask).toEqual(["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(c.priorSundayActual).toBe(true);
  });
  it("a past day that is pending, has an open punch, or sits in a rebuilding week is NOT settled: masked, never actual", () => {
    const cov = [{ business_date: "2026-10-05", state: "pending_settle", open_punches: 0 }, { business_date: "2026-10-06", state: "covered", open_punches: 1 }];
    const c = classifyLaborDays({ today: "2026-10-07", boardDates: BOARD, hasHead: true, hasPrevHead: false, dayCoverage: cov, weekStates: ready });
    expect(c.kinds).toMatchObject({ "2026-10-05": "not_settled", "2026-10-06": "not_settled" });
    expect(c.mask.slice(0, 2)).toEqual(["2026-10-05", "2026-10-06"]);
    const stale = classifyLaborDays({ today: "2026-10-07", boardDates: BOARD, hasHead: true, hasPrevHead: false, dayCoverage: covered(["2026-10-05"]),
      weekStates: new Map([[W, "rebuilding" as const]]) });
    expect(stale.kinds["2026-10-05"]).toBe("not_settled");
  });
  it("no schedule: nothing is masked (a masked day with no rows would be a false zero); future days read no_schedule", () => {
    const c = classifyLaborDays({ today: "2026-10-07", boardDates: BOARD, hasHead: false, hasPrevHead: true, dayCoverage: covered(["2026-10-05"]), weekStates: ready });
    expect(c.mask).toEqual([]);
    expect(c.kinds).toMatchObject({ "2026-10-05": "actual", "2026-10-06": "not_settled", "2026-10-07": "no_schedule" });
  });
  it("a fully settled past week has no plan at all (the prior Sunday is never masked on its own)", () => {
    const c = classifyLaborDays({ today: "2026-11-01", boardDates: BOARD, hasHead: true, hasPrevHead: true, dayCoverage: covered(BOARD), weekStates: ready });
    expect(c.mask).toEqual([]);
    expect(c.planWeeks).toEqual([]);
  });
});

describe("the plan rows", () => {
  it("one row per (person, date) with the facts' own rate pick; a salaried manager is presence; no wage = `none`, named", () => {
    const { built } = plan({ today: "2026-10-01", shifts: [shift(ANA, "2026-10-05", 4), shift(ANA, "2026-10-05", 4, 60), shift(BOSS, "2026-10-05", 8), shift(NEW, "2026-10-06", 5)], prevShifts: [] });
    expect(built.plan.rows).toEqual([
      { person_key: `u:${BOSS}`, business_date: "2026-10-05", minutes: 480, pay_class: "salaried", rate_cents: null, rate_basis: "known", carry_back_rate_cents: null },
      { person_key: `u:${ANA}`, business_date: "2026-10-05", minutes: 480, pay_class: "hourly", rate_cents: 2000, rate_basis: "known", carry_back_rate_cents: null },
      { person_key: `u:${NEW}`, business_date: "2026-10-06", minutes: 300, pay_class: "hourly", rate_cents: null, rate_basis: "none", carry_back_rate_cents: null },
    ]);
    expect(built.wageUnknownByDate).toEqual({ "2026-10-06": [NEW] });
    expect(built.scheduledMinutesByDate["2026-10-05"]).toBe(960);
    expect(built.scheduledMinutesByDate["2026-10-07"]).toBe(0);
  });
  it("the wage is the account linked at THIS shop (Ana's other-shop account at $99 never prices her here)", () => {
    const { built } = plan({ today: "2026-10-01", shifts: [shift(ANA, "2026-10-05", 1)], prevShifts: [] });
    expect(built.plan.rows[0]!.rate_cents).toBe(2000);
  });
  it("the first-known-wage rule: a wage that starts later is carried back, not unknown", () => {
    const src = source(W, { wages: [wage("7", 2500, "hourly", "2026-12-01")] });
    const { built } = plan({ today: "2026-10-01", shifts: [shift(ANA, "2026-10-05", 1)], prevShifts: [], sources: new Map([[W, src], [W2, src]]) });
    expect(built.plan.rows[0]).toMatchObject({ rate_basis: "before_first_known", rate_cents: null, carry_back_rate_cents: 2500 });
    expect(built.wageUnknownByDate).toEqual({});
  });
});

describe("overtime: one counter over one selected population (per shop, Sunday-Saturday)", () => {
  it("a 48-hour schedule: the 8 hours past 40 land on the last day", () => {
    const { built } = plan({ today: "2026-10-01", shifts: BOARD.slice(0, 6).map((d) => shift(ANA, d, 8)), prevShifts: [] });
    expect(built.plan.ot).toEqual([{ person_key: `u:${ANA}`, business_date: "2026-10-10", ot_minutes: 480 }]);
    expect(built.weeks[W]).toEqual({ weekScheduleComplete: true, retainedFactsReady: true, otRecountMatches: true });
  });
  it("Astra r3 P2-4: 8 unsettled Sunday hours on the PREVIOUS head + 40 h Mon-Fri = 8 overtime hours", () => {
    const { built, classification } = plan({ today: "2026-10-01", shifts: BOARD.slice(0, 5).map((d) => shift(ANA, d, 8)), prevShifts: [shift(ANA, W, 8)] });
    expect(classification.mask[0]).toBe(W);
    expect(built.plan.rows.find((r) => r.business_date === W)).toMatchObject({ minutes: 480 });
    expect(built.plan.ot).toEqual([{ person_key: `u:${ANA}`, business_date: "2026-10-09", ot_minutes: 480 }]);
  });
  it("the prior Sunday SETTLED: its facts feed the counter and no previous head is needed", () => {
    const { built, classification } = plan({ today: "2026-10-05", shifts: BOARD.slice(0, 5).map((d) => shift(ANA, d, 8)), prevShifts: null,
      dayCoverage: covered([W]), weekStates: ready, quarters: facts(ANA, W, 8) });
    expect(classification.mask).not.toContain(W);
    expect(built.plan.ot).toEqual([{ person_key: `u:${ANA}`, business_date: "2026-10-09", ot_minutes: 480 }]);
    expect(built.weeks[W]!.weekScheduleComplete).toBe(true);
  });
  it("the prior Sunday unsettled with NO previous head: the week's overtime cannot be assessed", () => {
    const { built } = plan({ today: "2026-10-01", shifts: BOARD.slice(0, 5).map((d) => shift(ANA, d, 8)), prevShifts: null });
    expect(built.weeks[W]).toMatchObject({ weekScheduleComplete: false });
    expect(built.weeks[W2]).toMatchObject({ weekScheduleComplete: true });
  });
  it("Astra r3 P1-1: a not-settled day's recorded hours are REPLACED by its schedule, never added to it", () => {
    // Monday pending with 6 recorded hours; the schedule says 8. Tue-Fri 8 h each: 40 h, not 46.
    const { built } = plan({ today: "2026-10-06", shifts: BOARD.slice(0, 5).map((d) => shift(ANA, d, 8)), prevShifts: [],
      dayCoverage: [{ business_date: "2026-10-05", state: "pending_settle", open_punches: 0 }], weekStates: ready, quarters: facts(ANA, "2026-10-05", 6) });
    expect(built.plan.mask).toContain("2026-10-05");
    expect(built.plan.ot).toEqual([]);
  });
  it("replacing Wednesday moves the overtime of a RETAINED later day; the days before the first planned date are never listed", () => {
    // Mon-Tue 10 h settled, Wed not settled (schedule: 12 h), Thu 10 h settled, Fri 8 h settled (stored: all 8 h over).
    const quarters = [...facts(ANA, "2026-10-05", 10), ...facts(ANA, "2026-10-06", 10), ...facts(ANA, "2026-10-07", 10), ...facts(ANA, "2026-10-08", 10), ...facts(ANA, "2026-10-09", 8, 8)];
    const cov = [...covered([W, "2026-10-05", "2026-10-06", "2026-10-08", "2026-10-09", "2026-10-10"]), { business_date: "2026-10-07", state: "incomplete", open_punches: 0 }];
    const { built } = plan({ today: "2026-10-11", shifts: [shift(ANA, "2026-10-07", 12)], prevShifts: [], dayCoverage: cov, weekStates: ready, quarters });
    expect(built.plan.mask).toEqual(["2026-10-07", "2026-10-11"]);
    expect(built.plan.ot).toEqual([
      { person_key: `u:${ANA}`, business_date: "2026-10-08", ot_minutes: 120 },
      { person_key: `u:${ANA}`, business_date: "2026-10-09", ot_minutes: 480 },
    ]);
    expect(built.weeks[W]).toEqual({ weekScheduleComplete: true, retainedFactsReady: true, otRecountMatches: true });
  });
  it("the counter must reproduce the STORED overtime of the stored rows, or the week says so", () => {
    const quarters = [...facts(ANA, "2026-10-05", 10, 3)];
    const { built } = plan({ today: "2026-10-06", shifts: [shift(ANA, "2026-10-06", 8)], prevShifts: [], dayCoverage: covered([W, "2026-10-05"]), weekStates: ready, quarters });
    expect(built.weeks[W]!.otRecountMatches).toBe(false);
  });
  it("two people each count their own 40; an unlinked fact account keeps its own counter", () => {
    const quarters = [...facts(BEN, "2026-10-05", 8)].map((q) => ({ ...q, person_key: "ss:99" }));
    const { built } = plan({ today: "2026-10-06", shifts: [...BOARD.slice(1, 6).map((d) => shift(ANA, d, 8)), ...BOARD.slice(1, 6).map((d) => shift(BEN, d, 8))], prevShifts: [],
      dayCoverage: covered([W, "2026-10-05"]), weekStates: ready, quarters });
    expect(built.plan.ot).toEqual([]);
  });
  it("the board Sunday's own payroll week needs nothing more: a first day cannot carry overtime", () => {
    const { built } = plan({ today: "2026-10-01", shifts: [shift(ANA, "2026-10-11", 10)], prevShifts: [] });
    expect(built.weeks[W2]).toEqual({ weekScheduleComplete: true, retainedFactsReady: true, otRecountMatches: true });
    expect(built.plan.ot).toEqual([]);
  });
});

describe("salary (Astra r3 P2-3): the one allocation rule, this shop's row only", () => {
  it("a week with no stored row gets this shop's allocated row; a stored week gets none", () => {
    const { built } = plan({ today: "2026-10-01", shifts: [shift(ANA, "2026-10-05", 8)], prevShifts: [], storedSalariedWeeks: new Set([W2]) });
    expect(built.plan.salaried).toEqual([{ week_start: W, salaried_cents: 140000, salaried_people: 1, unplaced_people: 0, missing_wage_people: 0 }]);
  });
  it("a salaried account with no payroll shop that is NOT on the board roster still makes this shop incomplete", () => {
    const src = source(W, { wages: [...source(W).wages, wage("77", 5200000, "annual_salary")] });
    const { built } = plan({ today: "2026-10-01", shifts: [shift(ANA, "2026-10-05", 8)], prevShifts: [], sources: new Map([[W, src], [W2, src]]) });
    expect(built.plan.salaried[0]).toEqual({ week_start: W, salaried_cents: null, salaried_people: 1, unplaced_people: 1, missing_wage_people: 0 });
    expect(JSON.stringify(built.plan)).not.toContain("5200000");
    expect(JSON.stringify(built.plan)).not.toContain(OTHER);
  });
});

describe("what a request is sent, and what the pricer is told", () => {
  const { built } = plan({ today: "2026-10-01", shifts: [...BOARD.map((d) => shift(ANA, d, 8)), shift(NEW, "2026-10-06", 2)], prevShifts: [shift(ANA, W, 8)] });
  it("a day call carries only its own payroll week's part of the plan (0345 refuses a mask date outside the request's weeks)", () => {
    const tue = planForRange(built.plan, "2026-10-06", "2026-10-06") as { mask: string[]; rows: unknown[]; salaried: Array<{ week_start: string }> };
    expect(tue.mask).toEqual([W, ...BOARD.slice(0, 6)]);
    expect(tue.salaried.map((s) => s.week_start)).toEqual([W]);
    const sun = planForRange(built.plan, "2026-10-11", "2026-10-11") as { mask: string[]; ot?: unknown[] };
    expect(sun.mask).toEqual(["2026-10-11"]);
    expect(sun.ot).toBeUndefined();
  });
  it("`only` rides along; an empty plan with no `only` is no plan at all", () => {
    expect(planForRange(built.plan, "2026-10-05", "2026-10-11", ["2026-10-05"])).toMatchObject({ only: ["2026-10-05"] });
    expect(planForRange({ mask: [], rows: [], ot: [], salaried: [] }, "2026-10-05", "2026-10-11")).toBeNull();
  });
  it("the pricer is told the row's own week and the no-wage people of the row's own dates; an unknown week is nothing stated", () => {
    const row = { week_start: W } as LaborCostRow;
    expect(projectionInputsFor(built, row, ["2026-10-05"])).toEqual({ weekScheduleComplete: true, retainedFactsReady: true, otRecountMatches: true, wageUnknownPeople: 0 });
    expect(projectionInputsFor(built, row, BOARD)!.wageUnknownPeople).toBe(1);
    expect(projectionInputsFor(built, { week_start: "2026-09-27" } as LaborCostRow, BOARD)).toBeUndefined();
  });
});
