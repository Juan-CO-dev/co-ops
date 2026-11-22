/**
 * Nav PR 8 (plan r2 2.12, Q3, A5; lead rulings r2 B2): `loadBusinessLaborDays`, the labor half of the business report
 * for the Dashboard's strip.
 *
 * T-B1   Raw-reader twins: for each case a FRESH fake client per loader, built from the same options; per day, the narrow
 *        loader's `labor` deep-equals the full report's (MoO, a custom range over the same days).
 * T-B1o  The read order, from the fake's request log: coverage before, then the sales / cost / structure reads, then
 *        coverage after, then the fingerprints. None of the report's other reads. Refusals read nothing.
 * T-B1w  The withheld results asserted ON THEIR OWN (not only by twin equality), on the narrow loader's view. The
 *        blanket rebuilding assertion covers cases 2-9 only; case 10 (the payroll-week boundary) is asserted per week
 *        (B2), with the newestLaborDay selection test in tests/dashboard-strip.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

import { BusinessReportError, loadBusinessLaborDays, loadBusinessReport } from "@/lib/business-report";
import { resolveBusinessRange } from "@/lib/business-report-shared";
import { figureComparable, figureHasNote, figureKindOf, figureReasonOf } from "@/lib/business-figure-shared";
import { businessLaborView } from "@/lib/business-view-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { A, fakeClient, type FakeOpts } from "./helpers/business-report-fake";

const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const MOO = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
const DAYS = ["2026-10-05", "2026-10-06", "2026-10-07"];
const BOUNDARY = ["2026-10-03", "2026-10-04", "2026-10-05"]; // Sat (week 09-27) / Sun, Mon (week 10-04)
const W1 = "2026-09-27", W2 = "2026-10-04";
const ready = (week_start: string, extra: Record<string, unknown> = {}) => ({ week_start, ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, ...extra });
/** Salaries known (so fully loaded is comparable) and the 12% burden estimated: every case starts from this row. */
const RICH = { salaried_cents: 4_000, salary_basis: "wages" };

/** sales_report_daily per date; `drop` = a day with no capture, `ezMissing` = a day whose ezCater amount is unknown. */
function salesRows(o: { drop?: string; ezMissing?: string } = {}) {
  return (args: Record<string, unknown>) => {
    const dates: string[] = [];
    for (let t = Date.parse(`${String(args.p_from)}T00:00:00Z`); t <= Date.parse(`${String(args.p_to)}T00:00:00Z`); t += 86_400_000) dates.push(new Date(t).toISOString().slice(0, 10));
    const kept = dates.filter((d) => d !== o.drop);
    return {
      classes: kept.map((d) => ({ business_date: d, sale_class: "sale", checks: 2, amount_cents: 3_000, tax_cents: 0, amount_missing: 0, tax_missing: 0,
        gross_cents: 3_000, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 })),
      tips: [], discounts: [], refunds: [], captured_days: kept,
      ezcater: kept.map((d) => ({ business_date: d, orders: 1, subtotal_cents: 2_000, amount_missing: d === o.ezMissing ? 1 : 0 })),
    };
  };
}

type Case = { name: string; days: string[]; o: FakeOpts };
const base = (o: FakeOpts = {}, days = DAYS): Case["o"] => ({ weeks: [ready(W1), ready(W2)], ...o, laborCostRow: (a) => ({ ...RICH, ...(o.laborCostRow?.(a) ?? {}) }) });
const CASES: Case[] = [
  { name: "1 all ready", days: DAYS, o: base() },
  { name: "2 generation movement", days: DAYS, o: base({ weeksAfterRebuild: [ready(W1), ready(W2, { built_at: "2026-10-08T05:00:00Z" })] }) },
  { name: "3 first build", days: DAYS, o: base({ weeks: [ready(W1)], weeksAfterRebuild: [ready(W1), ready(W2)] }) },
  { name: "4 disappearance", days: DAYS, o: base({ weeksAfterRebuild: [ready(W1)] }) },
  { name: "5 wrong builder", days: DAYS, o: base({ weeks: [ready(W1), ready(W2, { builder_version: "labor-v2" })] }) },
  { name: "6 wrong scope", days: DAYS, o: base({ weeks: [ready(W1), ready(W2, { ot_scope: "company" })] }) },
  { name: "7 stale fingerprint", days: DAYS, o: base({ currentFingerprint: (w) => (w === W2 ? "another-source" : undefined) }) },
  { name: "8 null fingerprint", days: DAYS, o: base({ currentFingerprint: (w) => (w === W2 ? null : undefined) }) },
  { name: "9 error fingerprint", days: DAYS, o: base({ currentFingerprint: (w) => (w === W2 ? "error" : undefined) }) },
  { name: "10 payroll-week boundary", days: BOUNDARY, o: base({ weeks: [ready(W1), ready(W2, { builder_version: "labor-v2" })] }) },
  { name: "11 open punches", days: DAYS, o: base({ laborCostRow: () => ({ open_punches: 1 }) }) },
  { name: "12 pending day", days: DAYS, o: base({ laborCostRow: () => ({ days_pending: 1 }) }) },
  { name: "13 salary gap", days: DAYS, o: base({ laborCostRow: () => ({ salary_basis: "incomplete", salaried_cents: null, salary_unplaced_people: 1 }) }) },
  { name: "14a denominator: the day not captured", days: DAYS, o: base({ rpcRows: { sales_report_daily: salesRows({ drop: "2026-10-06" }) } }) },
  { name: "14b denominator: ezCater missing", days: DAYS, o: base({ rpcRows: { sales_report_daily: salesRows({ ezMissing: "2026-10-06" }) } }) },
];

const narrow = (c: Case) => {
  const f = fakeClient(c.o);
  return { f, run: loadBusinessLaborDays(MOO, { locationId: A, days: c.days }, { client: f.client, env: ON }) };
};
const view = (labor: Parameters<typeof businessLaborView>[0]) => businessLaborView(labor, { hourlyCost: true, loaded: true });

describe("T-B1: raw-reader twins (a fresh fake per loader per case)", () => {
  it.each(CASES)("$name: per day, labor deep-equals the full report's", async (c) => {
    const n = await narrow(c).run;
    const range = resolveBusinessRange({ range: "custom", from: c.days[0], to: c.days.at(-1) }, "2026-10-08");
    const full = await loadBusinessReport(MOO, { locationId: A, range }, { client: fakeClient(c.o).client, env: ON });
    expect(n.days.map((d) => d.date)).toEqual(c.days);
    for (const d of n.days) expect(d.labor, `${c.name} ${d.date}`).toEqual(full.days.find((x) => x.date === d.date)!.labor);
    expect(n.access).toMatchObject({ hourlyCost: true, loaded: true });
  });
});

describe("T-B1o: the read order", () => {
  it("coverage, then sales / cost / structures, then coverage, then fingerprints; none of the report's other reads", async () => {
    const { f, run } = narrow(CASES[0]!);
    await run;
    const log = f.log;
    const cov = log.map((x, i) => (x === "table:labor_week_coverage" ? i : -1)).filter((i) => i >= 0);
    expect(cov).toHaveLength(2);
    const middle = log.map((x, i) => (["rpc:sales_report_daily", "rpc:fact_labor_cost", "table:schedule_structures"].includes(x) ? i : -1)).filter((i) => i >= 0);
    expect(middle.length).toBe(1 + 3 + 1);
    for (const i of middle) { expect(i).toBeGreaterThan(cov[0]!); expect(i).toBeLessThan(cov[1]!); }
    const fps = log.map((x, i) => (x === "rpc:fact_labor_week_fingerprint" ? i : -1)).filter((i) => i >= 0);
    expect(fps.length).toBeGreaterThan(0);
    for (const i of fps) expect(i).toBeGreaterThan(cov[1]!);
    for (const banned of ["rpc:business_report_check_cuts", "rpc:business_report_labor_quarters", "rpc:business_report_labor_people", "table:fact_day_coverage",
      "table:business_report_gm_visibility"]) expect(log).not.toContain(banned);
    expect(log).toHaveLength(2 + 5 + fps.length);
  });

  it("a GM or an AGM is 403 and the switch off is 503, each with the log empty", async () => {
    for (const viewer of [{ userId: "g", level: 7, role: "gm" as const, locations: [A] }, { userId: "a", level: 6, role: "agm" as const, locations: [A] }]) {
      const f = fakeClient(base());
      const err = await loadBusinessLaborDays(viewer, { locationId: A, days: DAYS }, { client: f.client, env: ON }).catch((e) => e);
      expect(err).toBeInstanceOf(BusinessReportError);
      expect(err).toMatchObject({ status: 403 });
      expect(f.log).toEqual([]);
    }
    const f = fakeClient(base());
    await expect(loadBusinessLaborDays(MOO, { locationId: A, days: DAYS }, { client: f.client, env: { BUSINESS_REPORT: "1", FACT_LAYER: "1" } }))
      .rejects.toMatchObject({ status: 503, code: "business_report_unavailable" });
    expect(f.log).toEqual([]);
  });

  it("refuses days that are empty, too many, out of order or not contiguous, before any read", async () => {
    for (const days of [[], ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"],
      ["2026-10-06", "2026-10-05"], ["2026-10-05", "2026-10-07"], ["2026-13-01"]]) {
      const f = fakeClient(base());
      await expect(loadBusinessLaborDays(MOO, { locationId: A, days }, { client: f.client, env: ON })).rejects.toThrow(RangeError);
      expect(f.log).toEqual([]);
    }
  });
});

const REBUILDING = "reports.business.labor.state.rebuilding";
describe("T-B1w: the withheld results, on their own", () => {
  it("case 1: both % comparable, the fully loaded one with the estimated-burden note", async () => {
    for (const d of (await narrow(CASES[0]!).run).days) {
      const v = view(d.labor);
      expect(figureComparable(v.purePct!)).toBe(true);
      expect(figureComparable(v.loadedPct!)).toBe(true);
      expect(figureHasNote(v.loadedPct!, "burden_estimated")).toBe(true);
    }
  });

  it.each(CASES.slice(1, 9))("$name: the week-2 days withhold both % with the rebuilding reason; hours still shown", async (c) => {
    for (const d of (await narrow(c).run).days) {
      const v = view(d.labor);
      expect(figureComparable(v.purePct!), d.date).toBe(false);
      expect(figureComparable(v.loadedPct!), d.date).toBe(false);
      expect(figureReasonOf(v.purePct!)).toBe(REBUILDING);
      expect(figureReasonOf(v.loadedPct!)).toBe(REBUILDING);
      expect(figureKindOf(v.hours)).not.toBe("unknown");
    }
  });

  it("case 10 (B2): the ready week's day stays comparable; the rebuilding week's days are withheld with the rebuilding reason", async () => {
    const days = (await narrow(CASES[9]!).run).days;
    const sat = view(days.find((d) => d.date === "2026-10-03")!.labor);
    expect(figureComparable(sat.purePct!)).toBe(true);
    expect(figureComparable(sat.loadedPct!)).toBe(true);
    expect(figureReasonOf(sat.loadedPct!)).toBeNull();
    for (const date of ["2026-10-04", "2026-10-05"]) {
      const v = view(days.find((d) => d.date === date)!.labor);
      expect(figureComparable(v.purePct!), date).toBe(false);
      expect(figureComparable(v.loadedPct!), date).toBe(false);
      expect(figureReasonOf(v.loadedPct!)).toBe(REBUILDING);
      expect(figureKindOf(v.hours)).not.toBe("unknown");
    }
  });

  it.each([CASES[10]!, CASES[11]!])("$name: no % (hours not known), reason named", async (c) => {
    for (const d of (await narrow(c).run).days) {
      const v = view(d.labor);
      expect(d.labor.state).toBe("hours_unknown");
      expect(figureComparable(v.purePct!)).toBe(false);
      expect(figureComparable(v.loadedPct!)).toBe(false);
      expect(figureReasonOf(v.purePct!)).toBe("reports.business.labor.state.hours_unknown");
    }
  });

  it("case 13: fully loaded withheld as salary_incomplete, pure hourly known", async () => {
    for (const d of (await narrow(CASES[12]!).run).days) {
      const v = view(d.labor);
      expect(v.loadedState).toBe("salary_incomplete");
      expect(figureComparable(v.loadedPct!)).toBe(false);
      expect(figureReasonOf(v.loadedPct!)).toBe("reports.business.labor.state.salary_incomplete");
      expect(figureComparable(v.purePct!)).toBe(true);
    }
  });

  it.each([[CASES[13]!, "sales_not_covered"], [CASES[14]!, "ezcater_missing"]] as const)("$0.name: no % on that day, with the denominator reason", async (c, state) => {
    const days = (await narrow(c).run).days;
    const bad = view(days.find((d) => d.date === "2026-10-06")!.labor);
    expect(figureComparable(bad.purePct!)).toBe(false);
    expect(figureComparable(bad.loadedPct!)).toBe(false);
    expect(figureReasonOf(bad.purePct!)).toBe(`reports.business.labor.state.${state}`);
    const good = view(days.find((d) => d.date === "2026-10-05")!.labor);
    expect(figureComparable(good.purePct!)).toBe(true);
  });
});
