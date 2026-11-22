/**
 * Nav PR 8: the numbers strip (plan r2 2.1, 2.4, 7.1; lead rulings r1 A1, A2, Q2; r2 B2).
 *
 * Pure half:
 *   - T-R3a: `salesStripCell` keeps a covered zero apart from "not captured" (A1);
 *   - T-R9: `cateringStripCell` classifies each order accepted / estimated / missing, values the pipeline only, counts
 *     unlinked ezCater orders and never values them, and never sums a missing price as $0 (A2);
 *   - T-B3: `newestLaborDay` picks the newest day whose fully loaded % is comparable, else the newest day as it stands, on
 *     views built by the real narrow loader; with the newer days in a rebuilding payroll week it picks the newest READY
 *     day, with its own date (B2).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

import { loadBusinessLaborDays } from "@/lib/business-report";
import { figureComparable, figureReasonOf } from "@/lib/business-figure-shared";
import { businessLaborView } from "@/lib/business-view-shared";
import { cateringStripCell, cateringValueBasis, needsYouSummary, newestLaborDay, salesStripCell, stripLinks, type LaborStripDay } from "@/lib/dashboard-blocks-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { A, fakeClient, type FakeOpts } from "./helpers/business-report-fake";

const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const MOO = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
const TOTALS = { toastChecksCents: 0, checks: 0, amountMissing: 0, coverage: "missing" as const, coveredDays: 0 };

describe("T-R3a (A1): the sales cell", () => {
  it("a successful answer with nothing captured and no checks: not captured, never a zero", () => {
    expect(salesStripCell({ totals: TOTALS, capturedAt: null })).toEqual({ kind: "not_captured" });
  });
  it("today captured completely with 0 checks: a covered zero, with the capture time", () => {
    expect(salesStripCell({ totals: { ...TOTALS, coverage: "complete", coveredDays: 1 }, capturedAt: "2026-11-18T15:00:00Z" }))
      .toEqual({ kind: "covered_zero", capturedAt: "2026-11-18T15:00:00Z" });
  });
  it("checks: the amount; partial when an amount is unknown or the day is not covered", () => {
    expect(salesStripCell({ totals: { ...TOTALS, checks: 3, toastChecksCents: 4_500, coverage: "complete", coveredDays: 1 }, capturedAt: "x" }))
      .toEqual({ kind: "amount", cents: 4_500, partial: false, capturedAt: "x" });
    expect(salesStripCell({ totals: { ...TOTALS, checks: 3, toastChecksCents: 4_500, amountMissing: 1, coverage: "complete", coveredDays: 1 }, capturedAt: "x" }))
      .toMatchObject({ kind: "amount", partial: true });
    expect(salesStripCell({ totals: { ...TOTALS, checks: 3, toastChecksCents: 4_500 }, capturedAt: null })).toMatchObject({ kind: "amount", partial: true });
  });
});

const lead = (p: { accepted?: number; estimate?: number | null; date?: string }) => ({
  eventDate: p.date ?? "2026-11-18",
  acceptedQuote: p.accepted !== undefined ? { totalCents: p.accepted, isDelivery: false, version: 1 } : null,
  estimatedRevenueCents: p.estimate ?? null,
});
const ez = (status: string | null = "confirmed", date = "2026-11-18") => ({ status, event_date: date });
const D = "2026-11-18";

describe("T-R9 (A2): the catering cell", () => {
  it.each([
    ["one accepted order", [lead({ accepted: 50_000, estimate: 40_000 })], [], { orders: 1, pipeline: 1, unlinkedEzcater: 0, valuedCents: 50_000, estimated: 0, missing: 0 }],
    ["one estimate-only order", [lead({ estimate: 40_000 })], [], { orders: 1, pipeline: 1, unlinkedEzcater: 0, valuedCents: 40_000, estimated: 1, missing: 0 }],
    ["one with neither: NO value, named", [lead({})], [], { orders: 1, pipeline: 1, unlinkedEzcater: 0, valuedCents: null, estimated: 0, missing: 1 }],
    ["accepted + missing", [lead({ accepted: 50_000 }), lead({})], [], { orders: 2, pipeline: 2, unlinkedEzcater: 0, valuedCents: 50_000, estimated: 0, missing: 1 }],
    ["an unlinked ezCater order: counted, never valued", [lead({ accepted: 50_000 })], [ez()], { orders: 2, pipeline: 1, unlinkedEzcater: 1, valuedCents: 50_000, estimated: 0, missing: 0 }],
    ["a cancelled ezCater order: not counted", [], [ez("Cancelled")], { orders: 0, pipeline: 0, unlinkedEzcater: 0, valuedCents: null, estimated: 0, missing: 0 }],
    ["another day's rows are not today's", [lead({ accepted: 1, date: "2026-11-19" })], [ez("confirmed", "2026-11-19")], { orders: 0, pipeline: 0, unlinkedEzcater: 0, valuedCents: null, estimated: 0, missing: 0 }],
  ] as const)("%s", (_n, booked, ezc, expected) => {
    expect(cateringStripCell(booked, ezc, D)).toEqual(expected);
  });
  it("the basis is the booked-events fallback without its ?? 0", () => {
    expect(cateringValueBasis(lead({ accepted: 0, estimate: 5 }))).toBe("accepted");
    expect(cateringValueBasis(lead({ estimate: 0 }))).toBe("estimated");
    expect(cateringValueBasis(lead({}))).toBe("missing");
  });
});

describe("needsYouSummary: never a 0 from a source that did not load", () => {
  it.each([
    [[{ count: 2 }, { count: 0 }, { count: 1 }], { kind: "count", n: 3 }],
    [[{ count: 0 }, { count: 0 }], { kind: "none" }],
    [[{ count: 0 }, { count: null }], { kind: "at_least", n: 0 }],
    [[{ count: 4 }, { count: null }, { count: 1 }], { kind: "at_least", n: 5 }],
  ] as const)("%j", (cells, expected) => {
    expect(needsYouSummary(cells)).toEqual(expected);
  });
});

describe("stripLinks", () => {
  it("sales today, the business report on the labor day, catering insights", () => {
    expect(stripLinks("s 1", "2026-11-16")).toEqual({ sales: "/reports/sales?location=s%201&range=today",
      labor: "/reports/business?location=s%201&range=custom&from=2026-11-16&to=2026-11-16", catering: "/catering/insights" });
  });
});

// ── T-B3: the labor day, on views from the real narrow loader ──
const W = (week_start: string, extra: Record<string, unknown> = {}) => ({ week_start, ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, ...extra });
async function stripDays(days: string[], o: FakeOpts): Promise<LaborStripDay[]> {
  const r = await loadBusinessLaborDays(MOO, { locationId: A, days }, { client: fakeClient({ weeks: [W("2026-09-27"), W("2026-10-04")], ...o }).client, env: ON });
  return r.days.map((d) => ({ date: d.date, view: businessLaborView(d.labor, { hourlyCost: true, loaded: true }) }));
}
const RICH = { salaried_cents: 4_000, salary_basis: "wages" };
const pendingOn = (...pending: string[]) => (args: Record<string, unknown>) => ({ ...RICH, days_pending: pending.includes(String(args.p_from)) ? 1 : 0 });
const DAYS = ["2026-10-05", "2026-10-06", "2026-10-07"];

export async function laborSelectionCases() {
  return {
    yesterdayPending: await stripDays(DAYS, { laborCostRow: pendingOn("2026-10-07") }),
    onlyDay3: await stripDays(DAYS, { laborCostRow: pendingOn("2026-10-06", "2026-10-07") }),
    none: await stripDays(DAYS, { laborCostRow: pendingOn(...DAYS) }),
    boundary: await stripDays(["2026-10-03", "2026-10-04", "2026-10-05"], { weeks: [W("2026-09-27"), W("2026-10-04", { builder_version: "labor-v2" })], laborCostRow: () => RICH }),
  };
}

describe("T-B3 (Q2, B2): newestLaborDay", () => {
  it("yesterday pending, day-2 settled: day-2, with its own date", async () => {
    const pick = newestLaborDay((await laborSelectionCases()).yesterdayPending)!;
    expect(pick.date).toBe("2026-10-06");
    expect(figureComparable(pick.view.loadedPct!)).toBe(true);
  });
  it("only day-3 settled: day-3", async () => {
    expect(newestLaborDay((await laborSelectionCases()).onlyDay3)!.date).toBe("2026-10-05");
  });
  it("none settled: the newest day (yesterday), with its dash and reason, never another day's number", async () => {
    const pick = newestLaborDay((await laborSelectionCases()).none)!;
    expect(pick.date).toBe("2026-10-07");
    expect(figureComparable(pick.view.loadedPct!)).toBe(false);
    expect(figureReasonOf(pick.view.loadedPct!)).toBe("reports.business.labor.state.hours_unknown");
  });
  it("B2: the newer days in a rebuilding payroll week: the newest READY day, labelled with its date", async () => {
    const days = (await laborSelectionCases()).boundary;
    expect(days.map((d) => figureComparable(d.view.loadedPct!))).toEqual([true, false, false]);
    const pick = newestLaborDay(days)!;
    expect(pick.date).toBe("2026-10-03");
    expect(pick).toBe(days[0]);
  });
  it("no days: null", () => {
    expect(newestLaborDay([])).toBeNull();
  });
});
