/**
 * Nav PR 8: the numbers strip (plan r2 2.1, 2.4, 7.1; lead rulings r1 A1, A2, Q2; r2 B2).
 *
 * Rendered half (NumbersStrip, StripLaborCell): T-R2, T-R3a / T-R3b, T-R7, T-R8, T-R9, T-B3 labels, links, T-B2's source pin.
 *
 * Pure half:
 *   - T-R3a: `salesStripCell` keeps a covered zero apart from "not captured" (A1);
 *   - T-R9: `cateringStripCell` classifies each order accepted / estimated / missing, values the pipeline only, counts
 *     unlinked ezCater orders and never values them, and never sums a missing price as $0 (A2);
 *   - T-B3: `newestLaborDay` picks the newest day whose fully loaded % is comparable, else the newest day as it stands, on
 *     views built by the real narrow loader; with the newer days in a rebuilding payroll week it picks the newest READY
 *     day, with its own date (B2).
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

import { NumbersStrip } from "@/components/dashboard/NumbersStrip";
import type { StripShop } from "@/lib/dashboard-blocks";
import type { CateringStripCell } from "@/lib/dashboard-blocks-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { summarizeSales, type SalesTotals } from "@/lib/sales-reports-shared";
import { links, text } from "./helpers/day-render";
import { sightedText, visibleText } from "./helpers/business-report-states";

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

// ── Rendered (commit 8): NumbersStrip + StripLaborCell ──────────────────────────────────────────────────────────────

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;
const SHOP1 = { id: "11111111-1111-4111-8111-111111111111", code: "P", name: "P Street" };
const SHOP2 = { id: "22222222-2222-4222-8222-222222222222", code: "CH", name: "Capitol Hill" };
const totals = (o: Partial<SalesTotals>): SalesTotals => ({ ...summarizeSales([], D, D, "day").totals, ...o });
const salesOk = (o: Partial<SalesTotals>, capturedAt: string | null = "2026-11-18T18:42:00Z"): StripShop["sales"] => ({ kind: "ok", value: { totals: totals(o), capturedAt } });
const cateringOk = (o: Partial<CateringStripCell> = {}): StripShop["catering"] => ({ kind: "ok", value: { orders: 1, pipeline: 1, unlinkedEzcater: 0, valuedCents: 50_000, estimated: 0, missing: 0, ...o } });
async function stripRow(o: Partial<StripShop> = {}): Promise<StripShop> {
  const labor = (await laborSelectionCases()).yesterdayPending;
  return { shop: SHOP1, sales: salesOk({ checks: 3, toastChecksCents: 4_500, coverage: "complete", coveredDays: 1 }), labor: { kind: "ok", value: labor }, catering: cateringOk(), ...o };
}
const render = (rows: StripShop[], language: "en" | "es" = "en") => renderToStaticMarkup(createElement(NumbersStrip, { rows, language }));
const cell = (html: string, kind: string, shop = "P") => {
  const block = html.split(`data-strip-shop="${shop}"`)[1] ?? "";
  const m = block.match(new RegExp(`<a[^>]*data-strip-cell="${kind}"[\\s\\S]*?</a>`));
  return m ? m[0] : "";
};
const plain = (h: string) => text(h);

describe("T-R3a rendered (A1), both languages", () => {
  it.each(["en", "es"] as const)("%s", async (lang) => {
    const L = lang === "en" ? EN : ES;
    // A successful RPC with nothing captured and no checks.
    const none = plain(cell(render([await stripRow({ sales: salesOk({}, null) })], lang), "sales"));
    expect(none).toContain(L["dashboard.strip.sales_not_captured"]);
    expect(none).toContain(L["pulse.sales.synced_none"]);
    expect(none).not.toContain(L["dashboard.strip.sales_none"]);
    expect(none).not.toMatch(/\$0\.00|0,00/);
    // Captured, 0 checks: a covered zero + the synced time.
    const zero = plain(cell(render([await stripRow({ sales: salesOk({ coverage: "complete", coveredDays: 1 }) })], lang), "sales"));
    expect(zero).toContain(L["dashboard.strip.sales_none"]);
    expect(zero).toContain(L["pulse.sales.synced"]!.split(" {time}")[0]!);
    // Checks with an unknown amount: "At least".
    const partial = plain(cell(render([await stripRow({ sales: salesOk({ checks: 3, toastChecksCents: 4_500, amountMissing: 1, coverage: "complete", coveredDays: 1 }) })], lang), "sales"));
    expect(partial).toContain(L["dashboard.strip.sales_at_least"]!.split(" {amount}")[0]!);
    // The RPC rejects / is not installed: the cell fails, never $0.
    for (const kind of ["failed", "timed_out"] as const) {
      const failed = plain(cell(render([await stripRow({ sales: { kind } })], lang), "sales"));
      expect(failed).toContain(L["dashboard.tile.unavailable"]);
      expect(failed).not.toMatch(/\$|0,00/);
    }
  });
});

describe("T-R3b: a failed number reads Couldn't load; the other cells are unchanged", () => {
  it("each cell alone, then all together", async () => {
    const ok = render([await stripRow()]);
    for (const [kind, patch] of [["sales", { sales: { kind: "failed" } }], ["labor", { labor: { kind: "timed_out" } }], ["catering", { catering: { kind: "failed" } }]] as const) {
      const html = render([await stripRow(patch as Partial<StripShop>)]);
      expect(plain(cell(html, kind))).toContain(EN["dashboard.tile.unavailable"]);
      for (const other of ["sales", "labor", "catering"].filter((k) => k !== kind)) expect(cell(html, other)).toBe(cell(ok, other));
    }
    const all = render([await stripRow({ sales: { kind: "failed" }, labor: { kind: "failed" }, catering: { kind: "timed_out" } })]);
    for (const kind of ["sales", "labor", "catering"]) expect(plain(cell(all, kind))).toContain(EN["dashboard.tile.unavailable"]);
    expect(plain(all)).not.toMatch(/\$/);
  });
  it("the business reads timing out (business_reads_timeout) is a failed labor cell, the others stand", async () => {
    const html = render([await stripRow({ labor: { kind: "failed" } })]);
    expect(plain(cell(html, "labor"))).toBe(`${EN["dashboard.tile.unavailable"]}`);
    expect(plain(cell(html, "sales"))).toContain("$45.00");
  });
});

describe("T-R2: an estimated figure keeps its label", () => {
  it("the 12% burden default: fully loaded carries its mark and the legend says burden estimated", async () => {
    const html = render([await stripRow()]);
    const labor = cell(html, "labor");
    expect(labor).toMatch(/data-marks="a"/);
    expect(visibleText(labor)).toContain(EN["reports.business.burden_estimated"]);
    expect(sightedText(labor)).toContain(EN["reports.business.burden_estimated"]);
  });
  it("a first-known wage adds wage estimated", async () => {
    const r = await loadBusinessLaborDays(MOO, { locationId: A, days: DAYS }, { client: fakeClient({ weeks: [W("2026-09-27"), W("2026-10-04")], laborCostRow: () => ({ ...RICH, estimated_rate_minutes: 30 }) }).client, env: ON });
    const days = r.days.map((d) => ({ date: d.date, view: businessLaborView(d.labor, r.access) }));
    const html = render([await stripRow({ labor: { kind: "ok", value: days } })]);
    expect(visibleText(cell(html, "labor"))).toContain(EN["reports.business.wage_estimated"]);
  });
  it("a rebuilding week: a dash with its reason, under that day's own label", async () => {
    const days = (await laborSelectionCases()).boundary.slice(1); // Sun / Mon of the rebuilding week only
    const html = render([await stripRow({ labor: { kind: "ok", value: days } })]);
    const labor = plain(cell(html, "labor"));
    expect(labor).toContain("—");
    expect(labor).toContain(EN["reports.business.labor.state.rebuilding"]);
    expect(labor).toContain("Monday");
  });
});

describe("T-R7: labor absent while the switch is off", () => {
  it("no labor cell, sales and catering still shown", async () => {
    const html = render([await stripRow({ labor: "off" })]);
    expect(cell(html, "labor")).toBe("");
    expect(html).not.toContain("data-labor-day");
    expect(cell(html, "sales")).not.toBe("");
    expect(cell(html, "catering")).not.toBe("");
  });
});

describe("T-R8: never blended", () => {
  it("two shops, two rows, each with its own figures, no total", async () => {
    const html = render([await stripRow(), await stripRow({ shop: SHOP2, sales: salesOk({ checks: 1, toastChecksCents: 1_000, coverage: "complete", coveredDays: 1 }), catering: cateringOk({ valuedCents: 7_000 }) })]);
    expect([...html.matchAll(/data-strip-shop="([^"]+)"/g)].map((m) => m[1])).toEqual(["P", "CH"]);
    expect(plain(cell(html, "sales", "P"))).toContain("$45.00");
    expect(plain(cell(html, "sales", "CH"))).toContain("$10.00");
    expect(plain(html)).not.toContain("$55.00");
    expect(plain(cell(html, "catering", "CH"))).toContain("$70.00");
  });
});

describe("T-R9 rendered (A2)", () => {
  it("accepted only: the value, no qualifier", async () => {
    const c = plain(cell(render([await stripRow()]), "catering"));
    expect(c).toContain(EN["dashboard.strip.catering_booked"]!.replace("{amount}", "$500.00"));
    expect(c).not.toMatch(/estimate|without a price|not valued/);
  });
  it("estimate only: the value + 1 valued from an estimate", async () => {
    const c = plain(cell(render([await stripRow({ catering: cateringOk({ estimated: 1, valuedCents: 40_000 }) })]), "catering"));
    expect(c).toContain("$400.00");
    expect(c).toContain(EN["dashboard.strip.catering_estimated"]!.replace("{n}", "1"));
  });
  it("no quote and no estimate: NO value, 1 without a price, never $0.00 booked", async () => {
    const c = plain(cell(render([await stripRow({ catering: cateringOk({ valuedCents: null, missing: 1 }) })]), "catering"));
    expect(c).not.toContain("$0.00");
    expect(c).not.toContain(EN["dashboard.strip.catering_booked"]!.replace(" {amount}", "").replace("{amount} ", ""));
    expect(c).toContain(EN["dashboard.strip.catering_no_price"]!.replace("{n}", "1"));
  });
  it("an unlinked ezCater order: counted and named not valued; zero orders: the engine's none line", async () => {
    const c = plain(cell(render([await stripRow({ catering: cateringOk({ orders: 2, unlinkedEzcater: 1 }) })]), "catering"));
    expect(c).toContain(EN["dashboard.strip.catering_count_other"]!.replace("{n}", "2"));
    expect(c).toContain(EN["dashboard.strip.catering_ezcater_unvalued"]!.replace("{n}", "1"));
    const none = plain(cell(render([await stripRow({ catering: cateringOk({ orders: 0, pipeline: 0, valuedCents: null }) })]), "catering"));
    expect(none).toContain(EN["day.reason.catering.none"]);
    expect(none).not.toContain("$");
  });
});

describe("T-B3 rendered: the labor day's own label, both languages", () => {
  it.each([["en", "Tuesday"], ["es", "martes"]] as const)("%s", async (lang, day) => {
    const html = render([await stripRow()], lang);
    expect(plain(cell(html, "labor"))).toContain((lang === "en" ? EN : ES)["dashboard.strip.labor_day"]!.replace("{day}", day));
    expect(cell(html, "labor")).toContain('data-labor-day="2026-10-06"');
  });
});

describe("links and sizes", () => {
  it("each cell is a full-row link to its page, at least 44 px with items-center, with its ARIA label", async () => {
    const html = render([await stripRow()]);
    const hrefs = links(html).map((l) => l.href);
    expect(hrefs).toEqual([`/reports/sales?location=${SHOP1.id}&range=today`,
      `/reports/business?location=${SHOP1.id}&range=custom&from=2026-10-06&to=2026-10-06`, "/catering/insights"]);
    for (const kind of ["sales", "labor", "catering"]) expect(cell(html, kind)).toMatch(/min-h-\[44px\][^"]*items-center/);
    expect(links(html).map((l) => l.aria)).toEqual([`Open Sales so far for P · P Street`, `Open Business report for P · P Street`, `Open Catering today for P · P Street`]);
  });
});

describe("T-B2 (A8): NumbersStrip holds no business-report figure", () => {
  it("imports no @/lib/business-* module and no Figure", () => {
    const src = readFileSync("components/dashboard/NumbersStrip.tsx", "utf8");
    expect(src).not.toMatch(/from "@\/lib\/business-/);
    expect(src).not.toMatch(/\bFigure\b/);
  });
});
