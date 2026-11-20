// Item 9b fix round 2 (review ITEM9B-r2). Failing-first.
// P2: a fully loaded figure keeps its qualifications EVERYWHERE — the burden estimate, the salary estimate and the
//     payroll gaps travel beside it on Overview, on BOTH Compare periods, and in the Overview / Compare files.
// P3: every dash shows its reason as VISIBLE text (checked on the text a sighted reader sees, attributes stripped).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
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

import { loadBusinessReport, type WholeBusinessReportDto as BusinessReportDto } from "@/lib/business-report";
import { loadedQualifiers, resolveBusinessRange, type LaborFigures } from "@/lib/business-report-shared";
import { BUSINESS_EXPORT_COLUMNS } from "@/lib/report-export-shared";
// Fix round 4: the page and the export take the VIEW; these adapters build it from a DTO as the page does.
import { BusinessCompare, BusinessOverview, businessCompareRows, businessOverviewRows } from "./helpers/business-report-views";
import { Dash } from "@/components/reports-business/BusinessParts";
import { A, fakeClient } from "./helpers/business-report-fake";

const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const moo = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
const SHOP = { id: A, code: "MEP", name: "Capitol Hill" };
const range = resolveBusinessRange({ range: "custom", from: "2026-10-01", to: "2026-10-07" }, "2026-10-08");
const load = async () => loadBusinessReport(moo, { locationId: A, range }, { client: fakeClient().client, env: ON });
/** What a sighted reader sees: the markup with every tag (and so every attribute) removed. */
const visible = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el).replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const compareRow = (text: string, label: string, next: string) => text.slice(text.indexOf(label), text.indexOf(next, text.indexOf(label) + label.length));

/** The reviewer's scenario: salary from the shop estimate despite unplaced salaried staff, burden at the 12% default. */
const estimated = (l: LaborFigures): LaborFigures => ({ ...l, loadedState: "ok", salariedCents: 50_000, burdenCents: 6_000,
  fullyLoadedCents: 80_000, loadedPct: 26.5, loadedTone: "good", burdenEstimated: true, salaryEstimated: true, salaryGaps: 2 });
const withEstimates = (d: BusinessReportDto): BusinessReportDto => ({ ...d, total: { ...d.total, labor: estimated(d.total.labor) },
  days: d.days.map((x) => ({ ...x, labor: estimated(x.labor) })), weeks: d.weeks.map((w) => ({ ...w, labor: estimated(w.labor) })) });

const BURDEN = "Burden is estimated at 12% until payroll gives the real figure.";
const SALARY = "Salaries come from the shop's estimate.";
const GAPS = "2 salaried people still need a payroll shop or a 7shifts salary.";

describe("P2: fully loaded keeps its qualifications", () => {
  it("one rule lists them, and only beside a shown figure (gaps always)", () => {
    const l = estimated({} as LaborFigures);
    expect(loadedQualifiers(l).map((q) => q.key)).toEqual(["reports.business.burden_estimated", "reports.business.salary_estimated", "reports.business.salary_gaps"]);
    expect(loadedQualifiers({ ...l, fullyLoadedCents: null }).map((q) => q.key)).toEqual(["reports.business.salary_gaps"]);
    expect(loadedQualifiers({ ...l, burdenEstimated: false, salaryEstimated: false, salaryGaps: 0 })).toEqual([]);
  });
  it("Overview's fully loaded card names burden, salary estimate and gaps", async () => {
    const card = visible(createElement(BusinessOverview, { dto: withEstimates(await load()), language: "en" }));
    const loaded = card.slice(card.indexOf("Fully loaded"), card.indexOf("Refunds"));
    for (const s of [BURDEN, SALARY, GAPS]) expect(loaded).toContain(s);
  });
  it("Compare shows the same labels beside BOTH periods", async () => {
    const cur = withEstimates(await load());
    const prev = withEstimates(await load());
    const text = visible(createElement(BusinessCompare, { dto: cur, previous: prev, language: "en" }));
    const row = compareRow(text, "Fully loaded", "Same days last year");
    for (const s of [BURDEN, SALARY, GAPS]) expect(row.split(s).length - 1, s).toBe(2);
  });
  it("Overview and Compare files carry salary_estimated and salary_gaps beside burden_estimated", async () => {
    for (const tab of ["overview", "compare"] as const) {
      const keys = BUSINESS_EXPORT_COLUMNS[tab].map((c) => c.key);
      expect(keys.indexOf("salary_estimated"), tab).toBe(keys.indexOf("burden_estimated") + 1);
      expect(keys.indexOf("salary_gaps"), tab).toBe(keys.indexOf("burden_estimated") + 2);
    }
    const dto = withEstimates(await load());
    for (const rows of [businessOverviewRows(dto, SHOP), businessCompareRows(dto, dto, SHOP).filter((r) => r.period !== "last_year")]) {
      for (const r of rows) expect(r).toMatchObject({ burden_estimated: true, salary_estimated: true, salary_gaps: 2 });
    }
  });
});

describe("P3: a dash shows its reason as visible text", () => {
  it("Dash renders the reason in the text, not only in an attribute", () => {
    const text = visible(createElement(Dash, { reason: "reports.business.sales.not_captured", language: "en" }));
    expect(text).toContain("—");
    expect(text).toContain("No sales were captured");
  });
  it("Compare against a period with no capture and no salary: every dash says why", async () => {
    const cur = await load();
    const prev: BusinessReportDto = { ...cur, total: { ...cur.total, sales: { ...cur.total.sales, coverage: "missing" },
      labor: { ...cur.total.labor, loadedState: "salary_unknown", fullyLoadedCents: null, loadedPct: null } } };
    const text = visible(createElement(BusinessCompare, { dto: cur, previous: prev, language: "en" }));
    expect(compareRow(text, "Sales", "Net sales")).toContain("No sales were captured");
    expect(compareRow(text, "Fully loaded", "Same days last year")).toMatch(/salar/i);
  });
  it("Compare with no previous period names that, not a bare dash", async () => {
    const text = visible(createElement(BusinessCompare, { dto: await load(), previous: null, language: "en" }));
    expect(text).toContain("No earlier period to compare");
  });
});
