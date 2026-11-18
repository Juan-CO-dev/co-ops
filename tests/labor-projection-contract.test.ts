// Board two views PR 1: the SHARED labor contract's three additions (CC's rulings on Astra r3 P1-2 and r4 P1 / P2).
//  - currentWeekCoverage: a stored week is ready only when its generation did not move across the reads AND its
//    stored fingerprint is the CURRENT source's (a payroll-shop save with no rebuild is `rebuilding`, in 9a too);
//  - projected readiness, separate from the actual-generation gate: a complete plan gets its overtime and its
//    percentages although no stored week exists; a missing input withholds exactly the figure that needs it;
//  - the projected denominator: forecast sales, a separate value that is never a covered actual.
import { describe, expect, it } from "vitest";
import { laborPercents, laborProjectionReadiness, laborTargetsFor, laborWeekViews, sumLaborViews, toLaborCostRow, type LaborCostRow, type LaborProjectionInputs } from "@/lib/facts/labor-cost-shared";
import { currentWeekCoverage, laborNetSales, laborWeekState, projectedNetSales, type LaborWeekGenerationRow } from "@/lib/business-report-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";

const row = (o: Partial<LaborCostRow> = {}): LaborCostRow => ({ week_start: "2099-01-04", location_id: "loc-a", hourly_straight_cents: 96_000,
  ot_premium_cents: 8_000, salaried_cents: 140_000, salary_basis: "wages", burden_pct: 12, burden_basis: "estimated",
  estimated_rate_minutes: 0, hourly_minutes: 2880, ot_minutes: 480, salaried_minutes: 0, ot_state: "unbuilt", range_days: 7,
  days_covered: 0, days_pending: 0, days_fallback: 0, days_incomplete: 0, days_missing: 0, open_punches: 0,
  salaried_people: 1, salary_unplaced_people: 0, salary_missing_wage_people: 0, days_planned: 7, salary_projected: true, ...o });
const complete: LaborProjectionInputs = { weekScheduleComplete: true, retainedFactsReady: true, otRecountMatches: true, wageUnknownPeople: 0 };
const targets = laborTargetsFor(null);

describe("projected readiness (Astra r4 P1)", () => {
  it("a wholly planned, genuinely unbuilt week with complete inputs gets its overtime and both percentages, labelled projected", () => {
    const [v] = laborWeekViews([row()], () => complete);
    expect(v).toMatchObject({ projected: true, daysPlanned: 7, hoursKnown: true, otState: "projected", pureHourlyCents: 104_000, salaryProjected: true,
      projection: { overtimeKnown: true, moneyKnown: true, gaps: [] } });
    const p = laborPercents(v!, 1_000_000, targets);
    expect(p).toMatchObject({ pureHourlyPct: 10.4, pureHourlyTone: "good" });
    expect(p.fullyLoadedPct).toBe(Math.round((1000 * (104_000 + 140_000 + Math.round(0.12 * 244_000))) / 1_000_000) / 10);
  });
  it("the ACTUAL gate is untouched: the same unbuilt row with no plan is unknown hours, no %", () => {
    const [v] = laborWeekViews([row({ days_planned: 0, days_missing: 7, salary_projected: false })], () => complete);
    expect(v).toMatchObject({ projected: false, projection: null, hoursKnown: false, otState: "unbuilt" });
    expect(laborPercents(v!, 1_000_000, targets)).toEqual({ pureHourlyPct: null, pureHourlyTone: "none", fullyLoadedPct: null, fullyLoadedTone: "none" });
  });
  it("a row from before 0343 (no days_planned) reads exactly as before", () => {
    const { days_planned: _d, salary_projected: _s, ...old } = row({ ot_state: "assessed", days_covered: 7 });
    const r = toLaborCostRow(old as unknown as Record<string, unknown>);
    expect(r).toMatchObject({ days_planned: 0, salary_projected: false });
    expect(laborWeekViews([r])[0]).toMatchObject({ projected: false, projection: null, hoursKnown: true, otState: "assessed", daysPlanned: 0 });
  });
  it("fails closed: a planned row with no stated inputs has no overtime, no money and no %", () => {
    const [v] = laborWeekViews([row()]);
    expect(v!.projection).toEqual({ overtimeKnown: false, moneyKnown: false, gaps: ["schedule_incomplete"] });
    expect(v!.otState).toBe("not_assessed");
    expect(laborPercents(v!, 1_000_000, targets).pureHourlyPct).toBeNull();
  });
  it("each missing input withholds what needs it, by name; never a 0", () => {
    expect(laborProjectionReadiness({ ...complete, weekScheduleComplete: false })).toEqual({ overtimeKnown: false, moneyKnown: true, gaps: ["schedule_incomplete"] });
    expect(laborProjectionReadiness({ ...complete, retainedFactsReady: false })).toEqual({ overtimeKnown: false, moneyKnown: true, gaps: ["actuals_rebuilding"] });
    expect(laborProjectionReadiness({ ...complete, otRecountMatches: false })).toEqual({ overtimeKnown: false, moneyKnown: true, gaps: ["ot_not_assessed"] });
    expect(laborProjectionReadiness({ ...complete, wageUnknownPeople: 2 })).toEqual({ overtimeKnown: true, moneyKnown: false, gaps: ["wage_unknown"] });
    for (const inputs of [{ ...complete, weekScheduleComplete: false }, { ...complete, wageUnknownPeople: 1 }]) {
      const [v] = laborWeekViews([row()], () => inputs);
      expect(laborPercents(v!, 1_000_000, targets)).toEqual({ pureHourlyPct: null, pureHourlyTone: "none", fullyLoadedPct: null, fullyLoadedTone: "none" });
    }
  });
  it("a MIXED row validates its retained actual days with the actual rules and its planned days with the plan's", () => {
    // 3 covered actual days + 4 planned days of a built, ready week.
    const mixed = row({ ot_state: "week_open", days_planned: 4, days_covered: 3, salary_projected: false });
    expect(laborWeekViews([mixed], () => complete)[0]).toMatchObject({ projected: true, hoursKnown: true, otState: "projected" });
    // A pending or missing RETAINED day is unknown hours, whatever the plan says.
    for (const o of [{ days_pending: 1, days_covered: 2 }, { days_missing: 1, days_covered: 2 }, { open_punches: 1 }]) {
      const [v] = laborWeekViews([row({ ot_state: "week_open", days_planned: 4, days_covered: 3, ...o })], () => complete);
      expect(v!.hoursKnown).toBe(false);
      expect(laborPercents(v!, 1_000_000, targets).pureHourlyPct).toBeNull();
    }
    // Retained days of a week nobody built cannot be validated.
    expect(laborWeekViews([row({ days_planned: 4, days_missing: 3 })], () => complete)[0]!.hoursKnown).toBe(false);
  });
  it("retained ACTUAL days whose overtime is the plan's count (ot_planned) need the plan's inputs too", () => {
    const actual = row({ ot_state: "week_open", days_planned: 0, days_covered: 7, salary_projected: false, ot_planned: true });
    const [ok] = laborWeekViews([actual], () => complete);
    expect(ok).toMatchObject({ projected: false, daysPlanned: 0, hoursKnown: true, otState: "projected", projection: { overtimeKnown: true } });
    expect(laborPercents(ok!, 1_000_000, targets).pureHourlyPct).toBe(10.4);
    const [no] = laborWeekViews([actual], () => ({ ...complete, weekScheduleComplete: false }));
    expect(no).toMatchObject({ otState: "not_assessed" });
    expect(laborPercents(no!, 1_000_000, targets).pureHourlyPct).toBeNull();
    // The same row with no plan reaching it is plain facts: no projection asked, no inputs needed.
    expect(laborWeekViews([{ ...actual, ot_planned: false }])[0]).toMatchObject({ projection: null, otState: "week_open", hoursKnown: true });
  });
  it("sumLaborViews: two payroll weeks as one view (raw cents first; the worst state and every week's readiness)", () => {
    const a = laborWeekViews([row({ week_start: "2099-01-04", range_days: 6, days_planned: 6 })], () => complete)[0]!;
    const b = laborWeekViews([row({ week_start: "2099-01-11", range_days: 1, days_planned: 1, hourly_straight_cents: 10_000, ot_premium_cents: 0, salaried_cents: 20_000 })], () => complete)[0]!;
    const both = sumLaborViews([a, b])!;
    expect(both).toMatchObject({ pureHourlyCents: 114_000, salariedCents: 160_000, daysPlanned: 7, hoursKnown: true, otState: "projected",
      fullyLoadedCents: a.fullyLoadedCents! + b.fullyLoadedCents!, projection: { overtimeKnown: true, moneyKnown: true, gaps: [] } });
    const gap = laborWeekViews([row({ week_start: "2099-01-11", salaried_cents: null, salary_basis: "unknown" })], () => ({ ...complete, wageUnknownPeople: 1 }))[0]!;
    expect(sumLaborViews([a, gap])).toMatchObject({ fullyLoadedCents: null, salariedCents: null, projection: { moneyKnown: false, gaps: ["wage_unknown"] } });
    expect(sumLaborViews([])).toBeNull();
    expect(sumLaborViews([a])).toBe(a);
  });
  it("an unknown projected salary nulls fully loaded only; pure hourly keeps its number and tone", () => {
    const [v] = laborWeekViews([row({ salaried_cents: null, salary_basis: "incomplete", salary_unplaced_people: 1 })], () => complete);
    const p = laborPercents(v!, 1_000_000, targets);
    expect(p).toMatchObject({ pureHourlyPct: 10.4, pureHourlyTone: "good", fullyLoadedPct: null, fullyLoadedTone: "none" });
    expect(v).toMatchObject({ salaryIncomplete: true, salaryGaps: 1 });
  });
});

describe("the projected denominator (Astra r4 P2)", () => {
  it("forecast sales summed over the projected days, as its own kind of value", () => {
    expect(projectedNetSales([100_000, 250_000])).toEqual({ cents: 350_000, state: "ok", basis: "forecast" });
  });
  it("a missing forecast on any day, or no day at all, is no denominator (never a partial sum, never 0)", () => {
    expect(projectedNetSales([100_000, null])).toEqual({ cents: null, state: "forecast_missing", basis: "forecast" });
    expect(projectedNetSales([undefined])).toEqual({ cents: null, state: "forecast_missing", basis: "forecast" });
    expect(projectedNetSales([])).toEqual({ cents: null, state: "forecast_missing", basis: "forecast" });
  });
  it("a zero forecast is zero sales: no percentage", () => {
    expect(projectedNetSales([0, 0])).toEqual({ cents: null, state: "zero_sales", basis: "forecast" });
  });
  it("is never the actual denominator: an uncovered future day stays sales_not_covered there", () => {
    expect(laborNetSales({ coverage: "missing", toastNetCents: null, ezcaterCents: 0, ezcaterMissing: 0 })).toEqual({ cents: null, state: "sales_not_covered" });
    expect("basis" in laborNetSales({ coverage: "complete", toastNetCents: 5, ezcaterCents: 0, ezcaterMissing: 0 })).toBe(false);
  });
});

describe("currentWeekCoverage (Astra r3 P1-2): generation unchanged AND the stored fingerprint is the current source's", () => {
  const built = (o: Partial<LaborWeekGenerationRow> = {}): LaborWeekGenerationRow => ({ week_start: "2026-10-04", ot_scope: "per_shop",
    builder_version: LABOR_BUILDER_VERSION, built_at: "2026-11-01T00:00:00Z", source_fingerprint: "a".repeat(32), ...o });
  const state = (m: Map<string, { ot_scope: string; builder_version: string }>) => laborWeekState(m.get("2026-10-04"));
  it("nothing moved: ready", () => {
    expect(state(currentWeekCoverage([built()], [built()], new Map([["2026-10-04", "a".repeat(32)]])))).toBe("ready");
  });
  it("a payroll-shop row saved with no rebuild (the coverage row untouched, the source moved): rebuilding", () => {
    const m = currentWeekCoverage([built()], [built()], new Map([["2026-10-04", "b".repeat(32)]]));
    expect(state(m)).toBe("rebuilding");
    expect(m.get("2026-10-04")).toEqual({ ot_scope: "stale_source", builder_version: "stale_source" });
  });
  it("a rebuild between the two coverage reads: rebuilding, even though the new row matches the current source", () => {
    const after = built({ built_at: "2026-11-17T12:00:00Z", source_fingerprint: "c".repeat(32) });
    expect(currentWeekCoverage([built()], [after], new Map([["2026-10-04", "c".repeat(32)]])).get("2026-10-04"))
      .toEqual({ ot_scope: "moved_during_read", builder_version: "moved_during_read" });
  });
  it("fails closed: a fingerprint read that errored or did not answer, or a stored row with no fingerprint, is rebuilding", () => {
    expect(state(currentWeekCoverage([built()], [built()], new Map([["2026-10-04", null]])))).toBe("rebuilding");
    expect(state(currentWeekCoverage([built()], [built()], new Map()))).toBe("rebuilding");
    const bare = built({ source_fingerprint: null });
    expect(state(currentWeekCoverage([bare], [bare], new Map([["2026-10-04", "a".repeat(32)]])))).toBe("rebuilding");
  });
  it("a week with no stored row stays unbuilt (never invented by a fingerprint)", () => {
    expect(laborWeekState(currentWeekCoverage([], [], new Map([["2026-10-04", "a".repeat(32)]])).get("2026-10-04"))).toBe("unbuilt");
  });
  it("an old-scope week stays rebuilding by its own row", () => {
    const old = built({ ot_scope: "company", builder_version: "labor-v1" });
    expect(state(currentWeekCoverage([old], [old], new Map([["2026-10-04", "a".repeat(32)]])))).toBe("rebuilding");
  });
});
