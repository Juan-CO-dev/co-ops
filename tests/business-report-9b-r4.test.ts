// Item 9b fix round 4 (review ITEM9B-r4), failing-first. Three findings, one class: a figure that is estimated,
// provisional or unknown shown as a plain number.
//  P2-1  hours priced at an estimated wage (estimated_rate_minutes > 0) read as known figures everywhere.
//  P2-2  cost per person rendered raw beside hours that are "so far".
//  P2-3  the Channels export writes 0 ezCater sales / orders when no sales were captured.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
// Drawers OPEN (what a tap shows) with the collapsed summary beside them, as in tests/business-report-9b-r3.test.ts.
vi.mock("@/components/ui/CollapsibleSection", async () => {
  const { createElement: h } = await import("react");
  return { CollapsibleSection: ({ title, count, badge, children }: { title: unknown; count?: unknown; badge?: unknown; children: unknown }) =>
    h("section", null, h("span", null, title as never), h("span", null, count as never), badge as never, children as never) };
});
// Polish: an hour of the 15-minute list is closed on the server too; open every one (its quarters are what a tap shows).
vi.mock("@/components/reports-business/HourDisclosure", async () => {
  const { createElement: h } = await import("react");
  return { HourDisclosure: ({ title, summary, children }: { title: unknown; summary?: unknown; children: unknown }) =>
    h("li", { "data-hour": "" }, h("span", null, title as never), h("span", null, summary as never), h("ul", null, children as never)) };
});

import { loadBusinessReport, type BusinessReportDto } from "@/lib/business-report";
import { resolveBusinessRange } from "@/lib/business-report-shared";
import { BUSINESS_EXPORT_COLUMNS } from "@/lib/report-export-shared";
import { A, fakeClient } from "./helpers/business-report-fake";
import { EN, laborIn, markedFigures, reasonOf, sightedText, visibleText, withLabor } from "./helpers/business-report-states";
import {
  BusinessChannels, BusinessCompare, BusinessHours, BusinessOverview, BusinessPeople,
  businessChannelRows, businessCompareRows, businessHoursRows, businessOverviewRows, businessPeopleRows,
} from "./helpers/business-report-views";

const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const moo = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
const SHOP = { id: A, code: "MEP", name: "Capitol Hill" };
const range = resolveBusinessRange({ range: "custom", from: "2026-10-01", to: "2026-10-07" }, "2026-10-08");
const text = (el: Parameters<typeof renderToStaticMarkup>[0]) => visibleText(renderToStaticMarkup(el));
const count = (t: string, s: string) => t.split(s).length - 1;

/** fact_labor_cost with hours priced at the shop's estimated wage (no wage on file) and a known salary. */
const costRow = (args: Record<string, unknown>, estimated: number) => {
  const days = Math.round((Date.parse(`${args.p_to}T00:00:00Z`) - Date.parse(`${args.p_from}T00:00:00Z`)) / 86_400_000) + 1;
  return [{ week_start: "2026-09-27", location_id: A, hourly_straight_cents: 900, ot_premium_cents: 0, salaried_cents: 400, salary_basis: "wages",
    burden_pct: 12, burden_basis: "payroll", estimated_rate_minutes: estimated, hourly_minutes: 30, ot_minutes: 0, salaried_minutes: 0, ot_state: "assessed",
    range_days: days, days_covered: days, days_pending: 0, days_fallback: 0, days_incomplete: 0, days_missing: 0, open_punches: 0 }];
};
const load = (estimated: number | null = null) => loadBusinessReport(moo, { locationId: A, range },
  { client: fakeClient(estimated === null ? {} : { rpcRows: { fact_labor_cost: (a) => costRow(a, estimated) } }).client, env: ON });

const RATE = EN["reports.business.wage_estimated"] ?? "<<reports.business.wage_estimated is not translated>>";
const RATE_SHORT = EN["reports.business.qual.wage_estimated"] ?? "<<reports.business.qual.wage_estimated is not translated>>";

describe("P2-1: an estimated wage qualifies every figure built on it", () => {
  it("the fixture is whole apart from the wage: hours final, sales complete, salary and burden real", async () => {
    const l = (await load(30)).total.labor;
    expect([l.state, l.loadedState, l.burdenEstimated, l.salaryEstimated, l.salaryGaps]).toEqual(["ok", "ok", false, false, 0]);
    expect((l as unknown as { wageEstimated?: boolean }).wageEstimated).toBe(true);
    expect(((await load(0)).total.labor as unknown as { wageEstimated?: boolean }).wageEstimated).toBe(false);
  });
  it("Overview: the cards, every week and day drawer", async () => {
    const dto = await load(30);
    const markup = renderToStaticMarkup(createElement(BusinessOverview, { dto, language: "en" }));
    const n = dto.weeks.length + dto.days.length;
    // Polish (marker + legend form). EVERY figure built on the wage carries the sentence (its mark; the sentence for a
    // screen reader): the two % cards; in each open drawer the two % and the hourly, premium, burden and loaded
    // lines; in each collapsed summary both labor %.
    expect(markedFigures(markup).filter((f) => f.said.includes(RATE)).length).toBe(2 + 6 * n + 2 * n);
    // A sighted reader reads it ONCE per scope: under the cards, on top of the weeks list and of the days list, and in
    // each open drawer's own notes. `sightedText` first proves every mark against its legend line.
    expect(count(sightedText(markup), RATE)).toBe(3 + n);
    // The short words are no longer repeated on every figure.
    expect(count(sightedText(markup), RATE_SHORT)).toBe(0);
  });
  it("a real wage carries no such words", async () => {
    const t = text(createElement(BusinessOverview, { dto: await load(0), language: "en" }));
    expect(t).not.toContain(RATE);
    expect(t).not.toContain(RATE_SHORT);
  });
  it("Compare: both periods; Hours: each quarter's dollars and %; People: each hourly cost", async () => {
    const dto = await load(30);
    expect(count(text(createElement(BusinessCompare, { dto, previous: dto, language: "en" })), RATE)).toBeGreaterThanOrEqual(4);
    // Hours: each hour's dollars, and each quarter's dollars and %, carry the sentence; the day's notes say it once.
    const hours = renderToStaticMarkup(createElement(BusinessHours, { dto, language: "en" }));
    expect(markedFigures(hours).filter((f) => f.said.includes(RATE)).length).toBeGreaterThanOrEqual(3 * dto.days.length);
    expect(count(sightedText(hours), RATE)).toBe(dto.days.length);
    // People: every hourly cost carries it; the list's notes say it once.
    const people = renderToStaticMarkup(createElement(BusinessPeople, { dto, language: "en" }));
    expect(markedFigures(people).filter((f) => f.said.includes(RATE)).length).toBe(dto.people.filter((p) => p.payClass === "hourly").length);
    expect(markedFigures(people).length).toBeGreaterThan(0);
    expect(count(sightedText(people), RATE)).toBe(1);
  });
  it("the export: a wage_estimated column, and every figure built on the wage is named as estimated", async () => {
    for (const tab of ["overview", "compare"] as const) {
      expect(BUSINESS_EXPORT_COLUMNS[tab].map((c) => c.key)).toEqual(expect.arrayContaining(["wage_estimated", "figure_notes"]));
    }
    for (const tab of ["hours", "channels", "people"] as const) expect(BUSINESS_EXPORT_COLUMNS[tab].map((c) => c.key)).toContain("figure_notes");
    const dto = await load(30);
    const rows = [...businessOverviewRows(dto, SHOP), ...businessCompareRows(dto, dto, SHOP).filter((r) => r.period !== "last_year")];
    for (const r of rows) {
      expect(r.wage_estimated, String(r.row_type)).toBe(true);
      for (const c of ["pure_hourly_cost", "pure_hourly_pct", "fully_loaded_cost", "fully_loaded_pct"]) {
        expect(String(r.figure_notes), c).toContain(`${c}=estimated(wage_estimated)`);
      }
    }
    for (const r of businessOverviewRows(await load(0), SHOP)) { expect(r.wage_estimated).toBe(false); expect(r.figure_notes ?? null).toBeNull(); }
    const q = businessHoursRows(dto, SHOP).find((r) => r.row_type === "quarter" && r.straight_time_cost !== null && r.straight_time_cost !== undefined)!;
    expect(String(q.figure_notes)).toContain("straight_time_cost=estimated(wage_estimated)");
    const person = businessPeopleRows(dto, SHOP).find((r) => r.row_type === "person")!;
    expect(String(person.figure_notes)).toContain("straight_time_cost=estimated(wage_estimated)");
  });
});

describe("P2-2: cost per person is 'so far' while the hours behind it are", () => {
  for (const s of ["hours_unknown", "rebuilding", "unbuilt"] as const) {
    it(`labor state ${s}`, async () => {
      const dto = withLabor(await load(), (l) => laborIn(l, s));
      expect(dto.people[0]!.straightCostCents).toBe(18_000);
      const t = text(createElement(BusinessPeople, { dto, language: "en" }));
      expect(t).toContain("$180.00 so far");
      expect(t).not.toMatch(/\$180\.00(?! so far)/);
      // The reason is beside the cost itself, not only in the banner on top.
      expect(count(t, reasonOf(s))).toBeGreaterThanOrEqual(2);
      const row = businessPeopleRows(dto, SHOP).find((r) => r.row_type === "person")!;
      expect(row.straight_time_cost).toBe(18_000);
      expect(String(row.figure_notes)).toContain(`straight_time_cost=incomplete(so_far,${s})`);
      expect(String(row.figure_notes)).toContain(`hours=incomplete(so_far,${s})`);
    });
  }
  it("final hours: the plain cost, nothing to say", async () => {
    const dto = await load();
    const t = text(createElement(BusinessPeople, { dto, language: "en" }));
    expect(t).toContain("$180.00");
    expect(t).not.toContain("so far");
    expect(businessPeopleRows(dto, SHOP).find((r) => r.row_type === "person")!.figure_notes ?? null).toBeNull();
  });
});

describe("P2-3: ezCater on Channels, page and file agree on missing and partial sales", () => {
  const withCoverage = (dto: BusinessReportDto, coverage: "missing" | "partial"): BusinessReportDto => ({
    ...dto, days: dto.days.map((d, i) => ({ ...d, sales: { ...d.sales, coverage: coverage === "partial" && i > 0 ? "complete" as const : "missing" as const } })),
    total: { ...dto.total, sales: { ...dto.total.sales, coverage } },
  });
  const ez = (dto: BusinessReportDto) => businessChannelRows(dto, SHOP).find((r) => r.row_type === "ezcater")!;
  const NOT_CAPTURED = EN["reports.business.sales.not_captured"]!;

  it("no sales captured: the page shows a dash with the reason; the file has EMPTY metrics and says why, never 0", async () => {
    const dto = withCoverage(await load(), "missing");
    const page = text(createElement(BusinessChannels, { dto, language: "en" }));
    expect(page).toContain(NOT_CAPTURED);
    expect(page).not.toMatch(/ezCater orders\s+\$/);
    expect(page).not.toMatch(/ezCater orders[^$]*\d+ checks/);
    const r = ez(dto);
    expect([r.sales, r.checks, r.amount_missing]).toEqual([null, null, null]);
    for (const c of ["sales", "checks", "amount_missing"]) expect(String(r.figure_notes), c).toContain(`${c}=unknown(not_captured)`);
  });
  it("partly captured: the number is 'covered days only' on the page and in the file", async () => {
    const dto = withCoverage(await load(), "partial");
    expect(text(createElement(BusinessChannels, { dto, language: "en" }))).toMatch(/ezCater orders\s+\$140\.00 \(covered days only\)/);
    const r = ez(dto);
    expect(r.sales).toBe(14_000);
    expect(String(r.figure_notes)).toContain("sales=incomplete(covered_days_only,partial)");
  });
  it("complete: the plain total", async () => {
    const r = ez(await load());
    expect([r.sales, r.checks, r.amount_missing, r.figure_notes ?? null]).toEqual([14_000, 7, 0, null]);
  });
});
