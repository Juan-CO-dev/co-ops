// Item 9 PR 9a: the business report's PURE core (lib/business-report-shared.ts). Written failing-first.
// Astra r2: P1 labor denominator (CC ruling), P2 overtime gate (0339 per_shop + current builder), P2 rush zero baseline.
import { describe, expect, it } from "vitest";
import {
  BUSINESS_REPORT_MAX_DAYS, BUSINESS_HISTORY_FLOOR, RUSH_MIN_CHECKS, RUSH_MULTIPLIER, RUSH_HISTORY_WEEKS, RUSH_MIN_HISTORY,
  businessReportEnabled, businessReportRefusal, canSeePersonCost, resolveBusinessRange, daySalesFrom, laborNetSales, sumNetSales,
  laborWeekState, payrollWeekStart, laborDayFigures, laborRangeFigures, quarterFigures, recomposeDay, detectRushes, mergeCuts,
  combineShopDays, serverTotals, channelTotals, largeCheckTotals, toCutRow, type CutRow, type QuarterPoint, type DaySales,
} from "@/lib/business-report-shared";
import { summarizeSales, type DailyRaw } from "@/lib/sales-reports-shared";
import { PERSON_COST_MIN, laborFactAccess, type LaborCostRow } from "@/lib/facts/labor-cost-shared";
import { LABOR_BUILDER_VERSION, LABOR_HISTORY_FLOOR_DAY } from "@/lib/facts/labor-config-shared";

const LOC = "00000000-0000-4000-8000-000000000001";

/** One business day of sales_report_daily, the Sales report's own RPC shape (0239/0247). */
function dailyRaw(date: string, o: { toast?: number; checks?: number; gross?: number; disc?: number; voids?: number; refund?: number;
  ezcater?: number; ezMissing?: number; captured?: boolean; accountingMissing?: number; salesRefundMissing?: number } = {}): DailyRaw {
  const toast = o.toast ?? 100_000;
  return {
    classes: [{ business_date: date, sale_class: "sale", checks: o.checks ?? 10, amount_cents: toast, tax_cents: 0, amount_missing: 0, tax_missing: 0,
      gross_cents: o.gross ?? toast, discounts_comps_cents: o.disc ?? 0, voids_cents: o.voids ?? 0, service_charges_cents: 0,
      accounting_missing: o.accountingMissing ?? 0 }],
    tips: [], discounts: [],
    refunds: o.refund !== undefined || o.salesRefundMissing ? [{ business_date: date, count: 1, refund_cents: o.refund ?? 0, refund_tip_cents: 0,
      sales_refund_cents: o.salesRefundMissing ? null : (o.refund ?? 0), sales_refund_missing: o.salesRefundMissing ?? 0 }] : [],
    captured_days: o.captured === false ? [] : [date],
    ezcater: o.ezcater !== undefined || o.ezMissing ? [{ business_date: date, orders: 1, subtotal_cents: o.ezcater ?? 0, amount_missing: o.ezMissing ?? 0 }] : [],
  };
}
function costRow(week: string, o: Partial<LaborCostRow> = {}): LaborCostRow {
  return { week_start: week, location_id: LOC, hourly_straight_cents: 18_000, ot_premium_cents: 0, salaried_cents: null, salary_basis: "unknown",
    burden_pct: 12, burden_basis: "estimated", estimated_rate_minutes: 0, hourly_minutes: 600, ot_minutes: 0, salaried_minutes: 0,
    ot_state: "assessed", range_days: 1, days_covered: 1, days_pending: 0, days_fallback: 0, days_incomplete: 0, days_missing: 0, open_punches: 0, ...o };
}
const READY = { ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION };
const cut = (o: Partial<CutRow>): CutRow => ({ business_date: "2026-10-05", quarter_start_at: "2026-10-05T16:00:00.000Z", wall_quarter: 48, fold: 0,
  et_date: "2026-10-05", channel: "dine_in", provider: null, server_guid: "srv-1", server_label: "Ana", sale_class: "sale", checks: 1,
  amount_cents: 1000, amount_missing: 0, large_checks: 0, large_cents: 0, ...o });

describe("switch and access (plan finding 3/4; AGM sees nothing)", () => {
  it("is dark unless BUSINESS_REPORT, FACT_LAYER and FACT_LAYER_LABOR are all exactly 1", () => {
    expect(businessReportEnabled({})).toBe(false);
    expect(businessReportEnabled({ BUSINESS_REPORT: "1", FACT_LAYER: "1" })).toBe(false);
    expect(businessReportEnabled({ BUSINESS_REPORT: "true", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" })).toBe(false);
    expect(businessReportEnabled({ BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" })).toBe(true);
  });
  it("refuses below GM and the social media manager by role; GM+ pass", () => {
    for (const role of ["agm", "catering_mgr", "prep_mgr", "social_media_mgr", "shift_lead", "key_holder", "employee"] as const) {
      expect(businessReportRefusal(role)).toBe("role_insufficient");
    }
    for (const role of ["gm", "moo", "owner", "cgs"] as const) expect(businessReportRefusal(role)).toBeNull();
  });
  it("$ per person is ONE named constant in the shared labor policy: MoO+ by default, never a GM", () => {
    expect(PERSON_COST_MIN).toBe("person_money");
    expect(canSeePersonCost("gm")).toBe(false);
    expect(canSeePersonCost("agm")).toBe(false);
    for (const role of ["moo", "owner", "cgs"] as const) expect(canSeePersonCost(role)).toBe(true);
    expect(laborFactAccess("gm")).toBe("shop_money");
  });
});

describe("range: 92-day cap, finished days, last year empty until Jul 2027", () => {
  it("caps a wide custom range at 92 days ending on its `to`, and says so", () => {
    const r = resolveBusinessRange({ range: "custom", from: "2026-01-01", to: "2026-11-10" }, "2026-11-17");
    expect(BUSINESS_REPORT_MAX_DAYS).toBe(92);
    expect(r.to).toBe("2026-11-10");
    expect(r.days).toBe(92);
    expect(r.from).toBe("2026-08-11");
    expect(r.shortened).toBe(true);
  });
  it("never includes today; defaults to the seven days ending yesterday", () => {
    const r = resolveBusinessRange({}, "2026-11-17");
    expect(r).toMatchObject({ from: "2026-11-10", to: "2026-11-16", days: 7, shortened: false, empty: false });
    expect(resolveBusinessRange({ range: "custom", from: "2026-11-15", to: "2026-11-20" }, "2026-11-17").to).toBe("2026-11-16");
    expect(r.previous).toEqual({ from: "2026-11-03", to: "2026-11-09" });
  });
  it("same days last year read 'no data yet' until the year-ago window is past the history floor", () => {
    expect(BUSINESS_HISTORY_FLOOR).toBe(LABOR_HISTORY_FLOOR_DAY);
    const now = resolveBusinessRange({}, "2026-11-17");
    expect(now.lastYear).toBeNull();
    expect(now.lastYearReason).toBe("no_data_yet");
    const later = resolveBusinessRange({ range: "custom", from: "2027-08-01", to: "2027-08-07" }, "2027-08-20");
    expect(later.lastYear).toEqual({ from: "2026-08-01", to: "2026-08-07" });
    expect(later.lastYearReason).toBeNull();
  });
});

describe("P1 LABOR DENOMINATOR (CC ruling): labor cost / NET SALES = Sales net + ezCater net", () => {
  it("Astra's example: $180 labor on $1,000 Toast net + $500 ezCater = 12.0%, never 18%", () => {
    const [day] = daySalesFrom([dailyRaw("2026-10-05", { toast: 100_000, ezcater: 50_000 })], "2026-10-05", "2026-10-05");
    expect(laborNetSales(day!)).toEqual({ cents: 150_000, state: "ok" });
    const f = laborDayFigures(day!, costRow("2026-10-04"), READY);
    expect(f.pureHourlyCents).toBe(18_000);
    expect(f.pct).toBe(12);
    expect(f.state).toBe("ok");
  });
  it("Toast net is the Sales report's own net: gross - discounts/comps - voids - sales refunds", () => {
    const raw = dailyRaw("2026-10-05", { toast: 100_000, gross: 110_000, disc: 6_000, voids: 4_000, refund: 2_000 });
    const [day] = daySalesFrom([raw], "2026-10-05", "2026-10-05");
    const sales = summarizeSales([raw], "2026-10-05", "2026-10-05", "day").totals;
    expect(day!.toastNetCents).toBe(sales.toastNetCents);
    expect(day!.toastNetCents).toBe(98_000);
    expect(laborNetSales(day!).cents).toBe(98_000);
  });
  it("a linked Toast ring is never counted twice: only ezCater's own subtotal enters", () => {
    const raw = dailyRaw("2026-10-05", { toast: 100_000, ezcater: 50_000 });
    raw.classes.push({ business_date: "2026-10-05", sale_class: "ezcater_linked", checks: 1, amount_cents: 50_000, tax_cents: 0, amount_missing: 0 });
    const [day] = daySalesFrom([raw], "2026-10-05", "2026-10-05");
    expect(laborNetSales(day!).cents).toBe(150_000);
  });
  it("missing or zero denominator = no percentage (null, never 0 or Infinity)", () => {
    const ok = (o: Parameters<typeof dailyRaw>[1]) => daySalesFrom([dailyRaw("2026-10-05", o)], "2026-10-05", "2026-10-05")[0]!;
    expect(laborNetSales(ok({ captured: false }))).toEqual({ cents: null, state: "sales_not_covered" });
    expect(laborNetSales(ok({ accountingMissing: 1 }))).toEqual({ cents: null, state: "net_unknown" });
    expect(laborNetSales(ok({ salesRefundMissing: 1 }))).toEqual({ cents: null, state: "net_unknown" });
    expect(laborNetSales(ok({ ezcater: 0, ezMissing: 1 }))).toEqual({ cents: null, state: "ezcater_missing" });
    expect(laborNetSales(ok({ toast: 0, gross: 0, checks: 0 }))).toEqual({ cents: null, state: "zero_sales" });
    const zero = laborDayFigures(ok({ toast: 0, gross: 0, checks: 0 }), costRow("2026-10-04"), READY);
    expect(zero.pct).toBeNull();
    expect(zero.state).toBe("zero_sales");
    // A day nothing was captured for has no row at all: still a gap, never $0.
    const [missing] = daySalesFrom([], "2026-10-05", "2026-10-05");
    expect(laborNetSales(missing!).state).toBe("sales_not_covered");
  });
  it("both sides must be covered: unknown hours (pending / open punch / missing day) = no %", () => {
    const [day] = daySalesFrom([dailyRaw("2026-10-05")], "2026-10-05", "2026-10-05");
    for (const o of [{ days_pending: 1, days_covered: 0 }, { open_punches: 1 }, { days_missing: 1, days_covered: 0 }, { days_incomplete: 1 }] as const) {
      const f = laborDayFigures(day!, costRow("2026-10-04", o), READY);
      expect(f.pct).toBeNull();
      expect(f.state).toBe("hours_unknown");
    }
    expect(laborDayFigures(day!, null, READY).state).toBe("unbuilt");
  });
  it("range/week grain sums RAW cents and minutes first, then divides; any uncovered day = no %", () => {
    const days = daySalesFrom([dailyRaw("2026-10-05", { toast: 100_000 }), dailyRaw("2026-10-06", { toast: 50_000, ezcater: 50_000 })], "2026-10-05", "2026-10-06");
    expect(sumNetSales(days)).toEqual({ cents: 200_000, state: "ok" });
    const range = laborRangeFigures(days, [costRow("2026-10-04", { hourly_straight_cents: 30_000, ot_premium_cents: 6_000, range_days: 2, days_covered: 2 })],
      new Map([["2026-10-04", READY]]), { hourly: 18 });
    expect(range.pct).toBe(18);
    expect(range.tone).toBe("good");
    const gap = daySalesFrom([dailyRaw("2026-10-05")], "2026-10-05", "2026-10-06");
    expect(sumNetSales(gap)).toEqual({ cents: null, state: "sales_not_covered" });
  });
  it("tones follow the week's own target (a non-default 25% target is honoured; varying targets are named)", () => {
    const days = daySalesFrom([dailyRaw("2026-10-05", { toast: 100_000 })], "2026-10-05", "2026-10-05");
    const row = [costRow("2026-10-04", { hourly_straight_cents: 22_000 })];
    expect(laborRangeFigures(days, row, new Map([["2026-10-04", READY]]), { hourly: 18 }).tone).toBe("watch");
    expect(laborRangeFigures(days, row, new Map([["2026-10-04", READY]]), { hourly: 25 }).tone).toBe("good");
    expect(laborRangeFigures(days, row, new Map([["2026-10-04", READY]]), { hourly: "target_varies" }).tone).toBe("none");
  });
  it("hour/quarter grain: Toast-hour sales only, straight time, labelled toast_only; no tone", () => {
    const q = quarterFigures({ toastCents: 20_000, checks: 4, laborMinutes: 60, straightCents: 2_000, salesOk: true, laborOk: true });
    expect(q).toMatchObject({ pct: 10, basis: "toast_only_straight_time", tone: "none" });
    expect(quarterFigures({ toastCents: 0, checks: 0, laborMinutes: 60, straightCents: 2_000, salesOk: true, laborOk: true }).pct).toBeNull();
    expect(quarterFigures({ toastCents: 20_000, checks: 4, laborMinutes: 60, straightCents: 2_000, salesOk: false, laborOk: true }).pct).toBeNull();
    expect(quarterFigures({ toastCents: 20_000, checks: 4, laborMinutes: 60, straightCents: 2_000, salesOk: true, laborOk: false }).pct).toBeNull();
  });
});

describe("P2 OVERTIME GATE: only per_shop weeks of the current builder show hourly/OT labor", () => {
  it("names each week's state from labor_week_coverage", () => {
    expect(laborWeekState(READY)).toBe("ready");
    expect(laborWeekState({ ot_scope: "company", builder_version: "labor-v1" })).toBe("rebuilding");
    expect(laborWeekState({ ot_scope: "per_shop", builder_version: "labor-v1" })).toBe("rebuilding");
    expect(laborWeekState({ ot_scope: "company", builder_version: LABOR_BUILDER_VERSION })).toBe("rebuilding");
    expect(laborWeekState(undefined)).toBe("unbuilt");
  });
  it("payroll weeks start Sunday (ET calendar)", () => {
    expect(payrollWeekStart("2026-10-04")).toBe("2026-10-04");
    expect(payrollWeekStart("2026-10-10")).toBe("2026-10-04");
    expect(payrollWeekStart("2026-10-11")).toBe("2026-10-11");
  });
  it("a mixed-generation range: the company week is suppressed (money, OT and %), the per_shop week shows", () => {
    const days = daySalesFrom([dailyRaw("2026-10-10"), dailyRaw("2026-10-11")], "2026-10-10", "2026-10-11");
    const weeks = new Map([["2026-10-04", { ot_scope: "company", builder_version: "labor-v1" }], ["2026-10-11", READY]]);
    const old = laborDayFigures(days[0]!, costRow("2026-10-04", { ot_premium_cents: 900, ot_minutes: 60 }), weeks.get("2026-10-04"));
    expect(old).toMatchObject({ state: "rebuilding", pct: null, pureHourlyCents: null, otPremiumCents: null, otMinutes: null });
    expect(old.minutes).toBe(600);
    const now = laborDayFigures(days[1]!, costRow("2026-10-11", { ot_premium_cents: 900, ot_minutes: 60 }), weeks.get("2026-10-11"));
    expect(now).toMatchObject({ state: "ok", pureHourlyCents: 18_900, otPremiumCents: 900, otMinutes: 60, pct: 18.9 });
    const range = laborRangeFigures(days, [costRow("2026-10-04"), costRow("2026-10-11")], weeks, { hourly: 18 });
    expect(range).toMatchObject({ pct: null, state: "rebuilding", pureHourlyCents: null });
  });
});

describe("P2 RUSH: zero / thin baselines never make a rush", () => {
  const Q = (date: string, wq: number, checks: number, cents: number, offsetH = 4): QuarterPoint => {
    const ms = Date.parse(`${date}T00:00:00Z`) + offsetH * 3_600_000 + wq * 15 * 60_000;
    return { quarterStartAt: new Date(ms).toISOString(), wallQuarter: wq, fold: 0, checks, cents };
  };
  const history = (n: number, f: (wq: number) => [number, number]) => Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.parse("2026-10-05T00:00:00Z") - (i + 1) * 7 * 86_400_000).toISOString().slice(0, 10);
    return { date, quarters: [44, 45, 46, 47, 48, 49].map((wq) => Q(date, wq, ...f(wq))) };
  });
  const day = (f: (wq: number) => [number, number]) => ({ date: "2026-10-05", quarters: [44, 45, 46, 47, 48, 49].map((wq) => Q("2026-10-05", wq, ...f(wq))) });

  it("constants are Juan's defaults and stated", () => {
    expect(RUSH_MULTIPLIER).toBe(1.5);
    expect(RUSH_HISTORY_WEEKS).toBe(8);
    expect(RUSH_MIN_HISTORY).toBe(4);
    expect(RUSH_MIN_CHECKS).toBeGreaterThanOrEqual(2);
  });
  it("finds a real rush: two+ quarters at or above 1.5x the median, with enough checks", () => {
    const r = detectRushes(day((wq) => (wq === 46 || wq === 47 ? [12, 24_000] : [5, 10_000])), history(8, () => [6, 12_000]));
    expect(r.state).toBe("ok");
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0]).toMatchObject({ quarters: 2, checks: 24, cents: 48_000, baselineChecks: 12, baselineCents: 24_000 });
  });
  it("ALL-ZERO: an empty day over an empty history is never a rush (0 >= 1.5 x 0 does not qualify)", () => {
    expect(detectRushes(day(() => [0, 0]), history(8, () => [0, 0])).windows).toEqual([]);
  });
  it("ZERO BASELINE: activity over a zero median is not a rush (no baseline to be 1.5x of)", () => {
    expect(detectRushes(day(() => [9, 30_000]), history(8, () => [0, 0])).windows).toEqual([]);
  });
  it("SPARSE: a median below the baseline minimum, or too few checks, never qualifies", () => {
    // 5 of 8 weeks empty -> median 0 checks at every quarter.
    const sparse = history(8, (wq) => [wq % 2, 3_000]).map((h, i) => (i < 5 ? { ...h, quarters: h.quarters.map((q) => ({ ...q, checks: 0, cents: 0 })) } : h));
    expect(detectRushes(day(() => [6, 20_000]), sparse).windows).toEqual([]);
    // Baseline 1 check / $10, today 2 checks / $40: 2x the median but under the check minimum.
    expect(detectRushes(day(() => [RUSH_MIN_CHECKS - 1, 4_000]), history(8, () => [1, 1_000])).windows).toEqual([]);
    // Checks qualify but sales are 0 (comped quarter): no rush.
    expect(detectRushes(day(() => [9, 0]), history(8, () => [2, 2_000])).windows).toEqual([]);
  });
  it("a single qualifying quarter is not a run", () => {
    expect(detectRushes(day((wq) => (wq === 46 ? [20, 40_000] : [5, 10_000])), history(8, () => [6, 12_000])).windows).toEqual([]);
  });
  it("thin history (< 4 covered same-weekdays) reads 'not enough history'", () => {
    const r = detectRushes(day(() => [20, 40_000]), history(3, () => [6, 12_000]));
    expect(r).toEqual({ state: "not_enough_history", windows: [] });
  });
  it("uses at most the last 8 covered weeks", () => {
    const h = [...history(8, () => [6, 12_000]), ...history(20, () => [100, 200_000]).slice(8)];
    expect(detectRushes(day((wq) => (wq < 46 ? [12, 24_000] : [5, 10_000])), h).windows).toHaveLength(1);
  });
  it("DST fall back 2026-11-01: both 01:15s are distinct quarters, and a run is contiguous by instant", () => {
    // 01:00/01:15 EDT = 05:00Z/05:15Z (fold 0); 01:00/01:15 EST = 06:00Z/06:15Z (fold 1).
    const pts = (checks: number, cents: number): QuarterPoint[] => [
      { quarterStartAt: "2026-11-01T05:00:00.000Z", wallQuarter: 4, fold: 0, checks, cents },
      { quarterStartAt: "2026-11-01T05:15:00.000Z", wallQuarter: 5, fold: 0, checks, cents },
      { quarterStartAt: "2026-11-01T06:00:00.000Z", wallQuarter: 4, fold: 1, checks: 0, cents: 0 },
      { quarterStartAt: "2026-11-01T06:15:00.000Z", wallQuarter: 5, fold: 1, checks, cents },
    ];
    const hist = Array.from({ length: 4 }, (_, i) => ({ date: `2026-10-${String(25 - 7 * i).padStart(2, "0")}`, quarters: pts(4, 4_000).map((p) => ({ ...p, quarterStartAt: p.quarterStartAt })) }));
    const r = detectRushes({ date: "2026-11-01", quarters: pts(10, 10_000) }, hist);
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0]).toMatchObject({ startAt: "2026-11-01T05:00:00.000Z", quarters: 2 });
  });
  it("DST spring forward 2027-03-14: 01:45 EST then 03:00 EDT are adjacent quarters (no 02:xx exists)", () => {
    const pts = (checks: number, cents: number): QuarterPoint[] => [
      { quarterStartAt: "2027-03-14T06:45:00.000Z", wallQuarter: 7, fold: 0, checks, cents },
      { quarterStartAt: "2027-03-14T07:00:00.000Z", wallQuarter: 12, fold: 0, checks, cents },
    ];
    const hist = Array.from({ length: 4 }, (_, i) => ({ date: `h${i}`, quarters: pts(4, 4_000) }));
    const r = detectRushes({ date: "2027-03-14", quarters: pts(10, 10_000) }, hist);
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0]).toMatchObject({ quarters: 2, endAt: "2027-03-14T07:15:00.000Z" });
  });
});

describe("recompose: every cut sums to the Sales report's own day (parity with sales_report_daily)", () => {
  const raw = dailyRaw("2026-10-05", { toast: 3_000, checks: 3, ezcater: 5_000 });
  raw.classes.push({ business_date: "2026-10-05", sale_class: "gift_card", checks: 1, amount_cents: 2_500, tax_cents: 0, amount_missing: 0 });
  const [day] = daySalesFrom([raw], "2026-10-05", "2026-10-05");
  const cuts = [
    cut({ quarter_start_at: "2026-10-05T16:00:00.000Z", channel: "dine_in", server_guid: "srv-1", amount_cents: 1_000 }),
    cut({ quarter_start_at: "2026-10-05T16:15:00.000Z", wall_quarter: 49, channel: "online", server_guid: null, server_label: null, amount_cents: 1_200 }),
    cut({ quarter_start_at: null, wall_quarter: null, fold: null, et_date: null, channel: "unknown", server_guid: "srv-2", server_label: null, amount_cents: 800 }),
    cut({ channel: "gift_card", sale_class: "gift_card", amount_cents: 2_500 }),
  ];
  it("hour, channel and server cuts plus 'unassigned' each equal toastChecksCents; plus ezCater = total", () => {
    const rc = recomposeDay(day!, cuts);
    expect(rc).toMatchObject({ ok: true, cutCents: 3_000, toastChecksCents: 3_000 });
    const ch = channelTotals(cuts);
    expect(ch.included.reduce((s, r) => s + r.cents, 0)).toBe(day!.toastChecksCents);
    expect(ch.excluded).toEqual([{ key: "gift_card", cents: 2_500, checks: 1 }]);
    const sv = serverTotals(cuts);
    expect(sv.reduce((s, r) => s + r.cents, 0)).toBe(3_000);
    expect(sv.find((r) => r.key === "")).toMatchObject({ unassigned: true, cents: 1_200 });
    expect(day!.toastChecksCents + day!.ezcaterCents).toBe(day!.totalCents);
  });
  it("a day whose facts do not add up to the Sales report is 'rebuilding', never shown", () => {
    expect(recomposeDay(day!, cuts.slice(1))).toMatchObject({ ok: false, reason: "rebuilding" });
    const [gap] = daySalesFrom([], "2026-10-05", "2026-10-05");
    expect(recomposeDay(gap!, [])).toMatchObject({ ok: false, reason: "sales_not_covered" });
  });
  it("checks over $5,000 are INCLUDED in every total and flagged beside it", () => {
    const big = [cut({ amount_cents: 600_000, large_checks: 1, large_cents: 600_000 }), cut({ amount_cents: 1_000 })];
    expect(largeCheckTotals(big)).toEqual({ checks: 1, cents: 600_000 });
    expect(channelTotals(big).included.reduce((s, r) => s + r.cents, 0)).toBe(601_000);
  });
  it("merges window chunks without double counting and parses PostgREST strings", () => {
    const a = toCutRow({ ...cut({}), checks: "2", amount_cents: "2000" } as unknown as Record<string, unknown>);
    expect(a.checks).toBe(2);
    expect(mergeCuts([[cut({})], [cut({ business_date: "2026-10-06" })]])).toHaveLength(2);
  });
  it("all shops equals the sum of shops (raw first, ratios after)", () => {
    const a = daySalesFrom([dailyRaw("2026-10-05", { toast: 100_000 })], "2026-10-05", "2026-10-05");
    const b = daySalesFrom([dailyRaw("2026-10-05", { toast: 50_000, ezcater: 10_000 })], "2026-10-05", "2026-10-05");
    const all = combineShopDays([a, b]);
    expect(all[0]).toMatchObject({ toastChecksCents: 150_000, ezcaterCents: 10_000, totalCents: 160_000, toastNetCents: 150_000 });
    expect(laborNetSales(all[0]!).cents).toBe(160_000);
    const gap = daySalesFrom([], "2026-10-05", "2026-10-05");
    expect(laborNetSales(combineShopDays([a, gap])[0]!).cents).toBeNull();
  });
});

describe("parity with summarizeSales over a 31-day window", () => {
  it("day rows carry exactly the Sales report's day buckets", () => {
    const raws: DailyRaw[] = [];
    for (let i = 0; i < 31; i++) {
      const d = new Date(Date.parse("2026-10-01T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
      raws.push(dailyRaw(d, { toast: 50_000 + i * 100, refund: i % 7 === 0 ? 500 : undefined, ezcater: i % 5 === 0 ? 20_000 : undefined }));
    }
    const ours: DaySales[] = daySalesFrom(raws, "2026-10-01", "2026-10-31");
    const theirs = summarizeSales(raws, "2026-10-01", "2026-10-31", "day").buckets;
    expect(ours.map((d) => [d.date, d.totalCents, d.toastChecksCents, d.toastNetCents, d.refundCents, d.ezcaterCents]))
      .toEqual(theirs.map((b) => [b.from, b.totalCents, b.toastChecksCents, b.toastNetCents, b.refundCents, b.ezcaterCents]));
  });
});

describe("range net with a refund-negative day", () => {
  it("adds the negative day's exact net instead of skipping it", () => {
    const days = daySalesFrom([dailyRaw("2026-10-05", { toast: 100_000 }), dailyRaw("2026-10-06", { toast: 0, gross: 0, checks: 0, refund: 5_000 })], "2026-10-05", "2026-10-06");
    expect(laborNetSales(days[1]!).state).toBe("zero_sales");
    expect(sumNetSales(days)).toEqual({ cents: 95_000, state: "ok" });
  });
});
