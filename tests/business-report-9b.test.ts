// Item 9 PR 9b: what the PAGE needs beyond 9a. Failing-first.
//  1. FULLY LOADED labor (Juan 2026-11-18): pure hourly + salaried + burden (12% default, labelled estimated)
//     over the same net sales, target <= 28%. Salaries not set up (0340 `incomplete`) = no fully loaded figure,
//     with its own reason; pure hourly still shows.
//  2. 15-minute labor DOLLARS are MoO+ only (Juan: "GMs see hours only for 15-min"): a GM's quarters carry
//     minutes, never straight-time cents or a % (a % times the shown sales IS the dollars).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no database in unit tests"); }) }));

import { BUSINESS_REPORT_DTO_PATHS, loadBusinessReport } from "@/lib/business-report";
import { daySalesFrom, laborDayFigures, laborRangeFigures, resolveBusinessRange } from "@/lib/business-report-shared";
import { QUARTER_COST_MIN, canSeeQuarterLaborCost, type LaborCostRow } from "@/lib/facts/labor-cost-shared";
import { LABOR_BUILDER_VERSION, LABOR_TARGET_LOADED_PCT } from "@/lib/facts/labor-config-shared";
import type { DailyRaw } from "@/lib/sales-reports-shared";
import { A, fakeClient } from "./helpers/business-report-fake";

const LOC = "00000000-0000-4000-8000-000000000001";
const READY = { ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION };
const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const gm = { userId: "u-gm", level: 7, role: "gm" as const, locations: [A] };
const moo = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
const owner = { userId: "u-o", level: 9, role: "owner" as const, locations: [] as string[] };

function raw(date: string, toast: number, ezcater = 0): DailyRaw {
  return {
    classes: [{ business_date: date, sale_class: "sale", checks: 10, amount_cents: toast, tax_cents: 0, amount_missing: 0, tax_missing: 0,
      gross_cents: toast, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 }],
    tips: [], discounts: [], refunds: [], captured_days: [date],
    ezcater: ezcater ? [{ business_date: date, orders: 1, subtotal_cents: ezcater, amount_missing: 0 }] : [],
  };
}
function costRow(week: string, o: Partial<LaborCostRow> = {}): LaborCostRow {
  return { week_start: week, location_id: LOC, hourly_straight_cents: 18_000, ot_premium_cents: 0, salaried_cents: null, salary_basis: "unknown",
    burden_pct: 12, burden_basis: "estimated", estimated_rate_minutes: 0, hourly_minutes: 600, ot_minutes: 0, salaried_minutes: 0,
    ot_state: "assessed", range_days: 1, days_covered: 1, days_pending: 0, days_fallback: 0, days_incomplete: 0, days_missing: 0, open_punches: 0,
    salaried_people: 0, salary_unplaced_people: 0, salary_missing_wage_people: 0, ...o };
}

describe("fully loaded labor (Juan 2026-11-18)", () => {
  const day = daySalesFrom([raw("2026-10-05", 100_000)], "2026-10-05", "2026-10-05")[0]!;

  it("salaries INCOMPLETE in prod: fully loaded is '-' with its own reason; pure hourly still shows", () => {
    const f = laborDayFigures(day, costRow("2026-10-04", { salary_basis: "incomplete", salaried_cents: null, salary_unplaced_people: 2 }), READY);
    expect(f).toMatchObject({ state: "ok", pct: 18, pureHourlyCents: 18_000 });
    expect(f).toMatchObject({ loadedState: "salary_incomplete", fullyLoadedCents: null, loadedPct: null, loadedTone: "none", salaryGaps: 2 });
  });
  it("no salary known at all (no estimate, no wages): 'salary_unknown', never a 0", () => {
    const f = laborDayFigures(day, costRow("2026-10-04"), READY);
    expect(f).toMatchObject({ loadedState: "salary_unknown", fullyLoadedCents: null, loadedPct: null });
  });
  it("known salary: pure + salaried + 12% burden (estimated), over the same net, toned against 28%", () => {
    // $180 hourly + $40 salaried = $220; burden 12% = $26.40; fully loaded $246.40 over $1,000 = 24.6% (under 28)
    const f = laborDayFigures(day, costRow("2026-10-04", { salaried_cents: 4_000, salary_basis: "estimate" }), READY);
    expect(f).toMatchObject({ loadedState: "ok", salariedCents: 4_000, burdenCents: 2_640, fullyLoadedCents: 24_640, loadedPct: 24.6,
      burdenEstimated: true, salaryEstimated: true });
    expect(f.loadedTone).not.toBe("none");
    expect(LABOR_TARGET_LOADED_PCT).toBe(28);
  });
  it("a rebuilding week withholds fully loaded too (its money is not final)", () => {
    const f = laborDayFigures(day, costRow("2026-10-04", { salaried_cents: 4_000, salary_basis: "wages" }), { ot_scope: "company", builder_version: "labor-v1" });
    expect(f).toMatchObject({ state: "rebuilding", loadedState: "rebuilding", fullyLoadedCents: null, loadedPct: null });
  });
  it("a range sums raw cents first, and one week with no salary nulls the whole range's fully loaded", () => {
    const days = daySalesFrom([raw("2026-10-03", 100_000), raw("2026-10-04", 100_000)], "2026-10-03", "2026-10-04");
    const weeks = new Map([["2026-09-27", READY], ["2026-10-04", READY]]);
    const ok = laborRangeFigures(days, [costRow("2026-09-27", { salaried_cents: 1_000, salary_basis: "wages", burden_basis: "payroll" }),
      costRow("2026-10-04", { salaried_cents: 1_000, salary_basis: "wages", burden_basis: "payroll" })], weeks, { hourly: 18, loaded: 28 });
    // (36,000 + 2,000) * 1.12 = 42,560 over 200,000 = 21.3%
    expect(ok).toMatchObject({ loadedState: "ok", fullyLoadedCents: 42_560, loadedPct: 21.3, burdenEstimated: false, salaryEstimated: false });
    const gap = laborRangeFigures(days, [costRow("2026-09-27", { salaried_cents: 1_000, salary_basis: "wages" }),
      costRow("2026-10-04", { salary_basis: "incomplete" })], weeks, { hourly: 18, loaded: 28 });
    expect(gap).toMatchObject({ loadedState: "salary_incomplete", fullyLoadedCents: null, loadedPct: null, pct: 18 });
  });
});

describe("15-minute labor dollars are MoO+ only", () => {
  it("one named constant decides, beside PERSON_COST_MIN", () => {
    expect(QUARTER_COST_MIN).toBe("person_money");
    expect(canSeeQuarterLaborCost("gm")).toBe(false);
    expect(canSeeQuarterLaborCost("agm")).toBe(false);
    for (const r of ["moo", "owner", "cgs"] as const) expect(canSeeQuarterLaborCost(r)).toBe(true);
  });
  const range = resolveBusinessRange({}, "2026-10-08");
  it("a GM's quarters carry minutes only: no straightCents, no pct key at all", async () => {
    const dto = await loadBusinessReport(gm, { locationId: A, range }, { client: fakeClient().client, env: ON });
    expect(dto.access).toMatchObject({ personCost: false, quarterCost: false });
    expect(dto.quarters!.length).toBeGreaterThan(0);
    for (const q of dto.quarters!) {
      expect(q).not.toHaveProperty("straightCents");
      expect(q).not.toHaveProperty("pct");
    }
    expect(dto.quarters!.some((q) => q.laborMinutes === 30)).toBe(true);
    expect(BUSINESS_REPORT_DTO_PATHS.shop_money).not.toContain("quarters[].straightCents");
    expect(BUSINESS_REPORT_DTO_PATHS.shop_money).not.toContain("quarters[].pct");
  });
  it("MoO and Owner get the quarter dollars and %", async () => {
    for (const v of [moo, owner]) {
      const dto = await loadBusinessReport(v, { locationId: A, range }, { client: fakeClient().client, env: ON });
      expect(dto.access).toMatchObject({ personCost: true, quarterCost: true });
      expect(dto.quarters!.find((q) => q.laborMinutes === 30)).toMatchObject({ straightCents: 900, pct: 90 });
    }
    expect(BUSINESS_REPORT_DTO_PATHS.person_money).toContain("quarters[].straightCents");
  });
  it("the loader carries both targets and the fully loaded figures on days, weeks and the total", async () => {
    const dto = await loadBusinessReport(gm, { locationId: A, range }, { client: fakeClient().client, env: ON });
    expect(dto.total).toMatchObject({ target: 18, loadedTarget: 28 });
    expect(dto.weeks[0]).toMatchObject({ target: 18, loadedTarget: 28 });
    // The fake's fact_labor_cost has no salary (basis unknown): fully loaded is withheld with its reason.
    expect(dto.days[0]!.labor).toMatchObject({ loadedState: "salary_unknown", fullyLoadedCents: null });
  });
});
