// Item 2 PR 2c (labor plan r6 §3 P0 / P2 #3): the PURE two-view pricer over 0338's fact_labor_cost rows.
// Fully loaded = hourly straight + overtime premium + salaried + burden (target <= 28%); pure hourly =
// hourly straight + overtime premium (target 18%). Components are stored and summed; never one blend.
import { describe, expect, it } from "vitest";
import { laborFactAccess, laborTargetsFor, laborWeekViews, rangeTargets, spreadSalariedOverQuarters, laborPercents, type LaborCostRow } from "@/lib/facts/labor-cost-shared";

const A = "loc-a", B = "loc-b";
const row = (o: Partial<LaborCostRow> = {}): LaborCostRow => ({ week_start: "2026-10-04", location_id: A, hourly_straight_cents: 100_000,
  ot_premium_cents: 5_000, salaried_cents: 150_000, salary_basis: "estimate", burden_pct: 12, burden_basis: "estimated",
  estimated_rate_minutes: 0, hourly_minutes: 3000, ot_minutes: 300, salaried_minutes: 2400, ot_state: "assessed", range_days: 7,
  days_covered: 7, days_pending: 0, days_fallback: 0, days_incomplete: 0, days_missing: 0, open_punches: 0, ...o });

describe("the two views", () => {
  it("pure hourly = straight + premium; fully loaded adds salary and burden on all gross pay", () => {
    const [w] = laborWeekViews([row()]);
    expect(w).toMatchObject({ weekStart: "2026-10-04", hourlyStraightCents: 100_000, otPremiumCents: 5_000, pureHourlyCents: 105_000,
      salariedCents: 150_000, burdenCents: Math.round(0.12 * 255_000), fullyLoadedCents: 255_000 + Math.round(0.12 * 255_000),
      burdenEstimated: true, salaryUnknown: false });
  });
  it("an unknown salary makes fully loaded null and leaves pure hourly valid", () => {
    const [w] = laborWeekViews([row({ salaried_cents: null, salary_basis: "unknown" })]);
    expect(w).toMatchObject({ pureHourlyCents: 105_000, salariedCents: null, burdenCents: null, fullyLoadedCents: null, salaryUnknown: true });
  });
  it("two shops sum per week, each shop's burden on its own pay; a payroll row is not estimated", () => {
    const [w] = laborWeekViews([row({ burden_pct: 10, burden_basis: "payroll" }), row({ location_id: B, burden_pct: 20, burden_basis: "payroll",
      hourly_straight_cents: 50_000, ot_premium_cents: 0, salaried_cents: 50_000 })]);
    expect(w).toMatchObject({ pureHourlyCents: 155_000, salariedCents: 200_000, burdenCents: 25_500 + 20_000, burdenEstimated: false });
  });
  it("an estimated rate (no wage, or Q5 = DC minimum) is labelled, never hidden", () => {
    expect(laborWeekViews([row({ estimated_rate_minutes: 30 })])[0]!.rateEstimated).toBe(true);
    expect(laborWeekViews([row()])[0]!.rateEstimated).toBe(false);
  });
  it("percents against net sales, each view toned against its own target; unknown sales = null, never 0", () => {
    const [w] = laborWeekViews([row()]);
    const p = laborPercents(w!, 1_000_000, laborTargetsFor(null));
    expect(p).toMatchObject({ pureHourlyPct: 10.5, pureHourlyTone: "good", fullyLoadedPct: 28.6, fullyLoadedTone: "watch" });
    expect(laborPercents(w!, null, laborTargetsFor(null))).toMatchObject({ pureHourlyPct: null, fullyLoadedPct: null, pureHourlyTone: "none" });
  });
});

describe("fix r1 P1: unknown hours suppress the percentages", () => {
  it("an open punch keeps coverage incomplete, overtime a lower bound, and the percents and tones null until its hours are known", () => {
    const [w] = laborWeekViews([row({ open_punches: 1 })]);
    expect(w).toMatchObject({ coverageComplete: false, hoursKnown: false, openPunches: 1, otState: "lower_bound" });
    expect(laborPercents(w!, 1_000_000, laborTargetsFor(null))).toEqual({ pureHourlyPct: null, pureHourlyTone: "none", fullyLoadedPct: null, fullyLoadedTone: "none" });
  });
  it("a missing, incomplete or PENDING day or an unbuilt week is unknown hours too (fix r3); a Toast-fallback day is labelled, its hours still known", () => {
    for (const o of [{ days_missing: 1 }, { days_incomplete: 1 }, { days_pending: 1 }, { ot_state: "unbuilt" as const }]) {
      const [w] = laborWeekViews([row(o)]);
      expect(w!.hoursKnown).toBe(false);
      expect(laborPercents(w!, 1_000_000, laborTargetsFor(null))).toEqual({ pureHourlyPct: null, pureHourlyTone: "none", fullyLoadedPct: null, fullyLoadedTone: "none" });
    }
    const [w] = laborWeekViews([row({ days_fallback: 1 })]);
    expect(w).toMatchObject({ hoursKnown: true, coverageComplete: false });
    expect(laborPercents(w!, 1_000_000, laborTargetsFor(null)).pureHourlyPct).toBe(10.5);
  });
  it("an open punch at ONE shop makes the summed week unknown; a week_open row is never upgraded to lower_bound", () => {
    expect(laborWeekViews([row(), row({ location_id: B, open_punches: 2 })])[0]).toMatchObject({ hoursKnown: false, openPunches: 2 });
    expect(laborWeekViews([row({ ot_state: "week_open", open_punches: 1 })])[0]!.otState).toBe("week_open");
  });
});

describe("targets by the structure's basis (P2 #3)", () => {
  it("total basis = the loaded target; hourly basis = the hourly target; no structure = Juan's constants", () => {
    expect(laborTargetsFor({ labor: { targetPct: 26, basis: "total" } })).toEqual({ loaded: { pct: 26, source: "structure" }, hourly: { pct: 18, source: "default" } });
    expect(laborTargetsFor({ labor: { targetPct: 18, basis: "hourly" } })).toEqual({ loaded: { pct: 28, source: "default" }, hourly: { pct: 18, source: "structure" } });
    expect(laborTargetsFor(null)).toEqual({ loaded: { pct: 28, source: "default" }, hourly: { pct: 18, source: "default" } });
  });
  it("weeks with different targets show target_varies, never an average", () => {
    const t1 = laborTargetsFor(null), t2 = laborTargetsFor({ labor: { targetPct: 25, basis: "total" } });
    expect(rangeTargets([t1, t1])).toEqual({ loaded: 28, hourly: 18 });
    expect(rangeTargets([t1, t2])).toEqual({ loaded: "target_varies", hourly: 18 });
  });
});

describe("salary spread and read access", () => {
  it("a weekly salary spreads evenly over the open quarters, remainder to the earliest, summing exactly", () => {
    const s = spreadSalariedOverQuarters(1000, ["q3", "q1", "q2"]);
    expect([...s.entries()]).toEqual([["q1", 334], ["q2", 333], ["q3", 333]]);
    expect(spreadSalariedOverQuarters(1000, []).size).toBe(0);
  });
  it("GM: shop money; MoO / owner / CGS: per person; AGM: hours only; the social media manager and staff: nothing", () => {
    expect(laborFactAccess("gm")).toBe("shop_money");
    for (const r of ["moo", "owner", "cgs"] as const) expect(laborFactAccess(r)).toBe("person_money");
    expect(laborFactAccess("agm")).toBe("hours_only");
    for (const r of ["social_media_mgr", "catering_mgr", "prep_mgr", "shift_lead", "employee"] as const) expect(laborFactAccess(r)).toBe("none");
  });
});
