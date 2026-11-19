// Fix round 1 of the business report polish (review POLISH-r1).
//
// P2: the readable PDF must not drop what the file carried before it. The PDF used to be the CSV's own rows
// (businessOverviewRows / businessTotalRow / ...); the polish rebuilt it as tables for a person and left out the
// large checks, the rushes, the labor targets and most of Compare. THE CENSUS: every figure the CSV row builders
// write (recorded at `figureCells`, the one way a figure enters a file) must be printed by the PDF (recorded at the
// legend's `cell` / `changeCell`, the one way a figure enters the PDF), by object identity. The one aggregation is
// the Hours tab: the PDF prints HOURS, so each 15-minute figure must be carried by its hour's figure of the same
// measure. Every other column of the CSV is classified below (identity, state said by the marks, or shown and
// checked); nothing that is a figure may be classified away.
//
// P3: Compare's change carries the qualifications of both periods as the scope's legend MARKS, never the sentences
// again beside each change.
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ csv: [] as Array<[string, unknown]>, pdf: new Set<unknown>() }));
vi.mock("@/lib/business-figure-shared", async (orig) => {
  const m = await orig<typeof import("@/lib/business-figure-shared")>();
  return {
    ...m,
    figureCells: (o: Parameters<typeof m.figureCells>[0]) => {
      for (const [k, f] of Object.entries(o)) if (f !== undefined && f !== null) seen.csv.push([k, f]);
      return m.figureCells(o);
    },
  };
});
vi.mock("@/lib/business-figure-format", async (orig) => {
  const m = await orig<typeof import("@/lib/business-figure-format")>();
  return {
    ...m,
    figureLegend: (...a: Parameters<typeof m.figureLegend>) => {
      const l = m.figureLegend(...a);
      return {
        ...l,
        cell: (f: Parameters<typeof l.cell>[0]) => { seen.pdf.add(f); return l.cell(f); },
        changeCell: (c: Parameters<typeof l.changeCell>[0], p: Parameters<typeof l.changeCell>[1]) => l.changeCell(c, p),
      };
    },
  };
});

import en from "@/lib/i18n/en.json";
import { loadBusinessReport, type BusinessReportDto } from "@/lib/business-report";
import { resolveBusinessRange } from "@/lib/business-report-shared";
import { BUSINESS_PDF_OMITTED, businessPdf } from "@/lib/business-report-pdf";
import { businessView, type BusinessReportView } from "@/lib/business-view-shared";
import { figureLegend } from "@/lib/business-figure-format";
import {
  BUSINESS_EXPORT_COLUMNS, BUSINESS_EXPORT_TABS, businessChannelRows, businessCompareRows, businessHoursRows, businessOverviewRows, businessPeopleRows,
  type BusinessExportTab,
} from "@/lib/report-export-shared";
import { A, fakeClient } from "./helpers/business-report-fake";
import { BusinessCompare } from "./helpers/business-report-views";
import { assertMarksResolve, loadedIn, withLabor } from "./helpers/business-report-states";

const EN = en as Record<string, string>;
const R = (k: string) => EN[`reports.business.${k}`]!;
const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const range = resolveBusinessRange({ range: "custom", from: "2026-10-01", to: "2026-10-07" }, "2026-11-10");
const load = (role: "moo" | "gm" = "moo") => loadBusinessReport({ userId: `u-${role}`, level: role === "moo" ? 8 : 7, role, locations: role === "gm" ? [A] : [] },
  { locationId: A, range }, { client: fakeClient().client, env: ON });
const SHOP = { id: A, code: "CH", name: "Capitol Hill" };

/** A day with large checks and two detected rushes (the review's own example), and estimates on every labor figure. */
function busy(dto: BusinessReportDto): BusinessReportDto {
  const d0 = dto.days[0]!;
  const withRush: BusinessReportDto = {
    ...dto,
    days: dto.days.map((d, i) => (i !== 0 || d.cuts !== "ok" ? d : {
      ...d, largeChecks: { checks: 2, cents: 1_234_500 },
      rush: { state: "ok", uncompared: 0, untimed: 0, baselineUntimed: 0, windows: [
        { startAt: `${d0.date}T16:00:00.000Z`, endAt: `${d0.date}T16:30:00.000Z`, quarters: 2, checks: 11, cents: 45_600, baselineChecks: 4, baselineCents: 12_000 },
        { startAt: `${d0.date}T22:00:00.000Z`, endAt: `${d0.date}T22:45:00.000Z`, quarters: 3, checks: 13, cents: 51_700, baselineChecks: 5, baselineCents: 14_000 },
      ] },
    })),
    largeChecks: { checks: 2, cents: 1_234_500 },
  };
  return withLabor(withRush, (l) => ({ ...loadedIn(l, "estimated"), wageEstimated: true, hoursUnverified: true }));
}

/** What a CSV column is when it is not a figure. `shown` columns are checked in the PDF's text below. */
type Kind = "identity" | "state" | "shown";
const NON_FIGURE: Record<string, { kind: Kind; why: string }> = {
  row_type: { kind: "identity", why: "the PDF's tables are the row types (days, weeks, total; channels; people; servers)" },
  period: { kind: "identity", why: "Compare's columns name the two periods" },
  period_start: { kind: "identity", why: "the row label is the day / week / range" },
  period_end: { kind: "identity", why: "the row label is the day / week / range" },
  location_code: { kind: "identity", why: "the PDF header names the shop" },
  location_name: { kind: "identity", why: "the PDF header names the shop" },
  business_date: { kind: "identity", why: "the Hours table is per day (its heading)" },
  quarter_start: { kind: "identity", why: "the PDF prints hours (the hour column)" },
  time_et: { kind: "identity", why: "the PDF prints hours (the hour column)" },
  channel: { kind: "identity", why: "the channel column" },
  provider: { kind: "identity", why: "the provider column" },
  name: { kind: "identity", why: "the name / server column" },
  server_ref: { kind: "identity", why: "the server column (label)" },
  source: { kind: "state", why: "Toast-fallback hours carry the 'hours unverified' mark" },
  status: { kind: "state", why: "said by the figures' reasons (a dash with its mark) and the file's notes" },
  coverage_status: { kind: "state", why: "the sales figures' state (covered days only, unknown) with its mark" },
  net_sales_state: { kind: "state", why: "the net sales figure's reason, in the legend" },
  labor_state: { kind: "state", why: "every labor figure's reason, in the legend" },
  fully_loaded_state: { kind: "state", why: "the fully loaded figures' reason, in the legend" },
  breakdown_state: { kind: "state", why: "the large-check figures' reason + the coverage notice" },
  burden_estimated: { kind: "state", why: "the 'burden estimated' mark" },
  salary_estimated: { kind: "state", why: "the 'salary estimated' mark" },
  salary_gaps: { kind: "state", why: "the 'N payroll gaps' mark" },
  wage_estimated: { kind: "state", why: "the 'wage estimated' mark" },
  hours_unverified: { kind: "state", why: "the 'hours unverified' mark" },
  basis: { kind: "state", why: "the quarter basis note (reports.business.quarter.basis)" },
  days_included: { kind: "state", why: "the coverage notice in the file's notes" },
  days_in_period: { kind: "state", why: "the coverage notice in the file's notes" },
  figure_notes: { kind: "state", why: "the marks and the Notes legend" },
  currency: { kind: "state", why: "every amount is written with its $" },
  pure_hourly_target_pct: { kind: "shown", why: "the Target column of Hourly labor / the Compare target row" },
  fully_loaded_target_pct: { kind: "shown", why: "the Target column of Fully loaded labor / the Compare target row" },
  pay_class: { kind: "shown", why: "the Pay column" },
  weeks_withheld: { kind: "shown", why: "the overtime cell says the weeks still being recounted" },
};

const builders: Record<BusinessExportTab, (v: BusinessReportView, prev: BusinessReportView) => unknown> = {
  overview: (v) => businessOverviewRows(v, SHOP), hours: (v) => businessHoursRows(v, SHOP), channels: (v) => businessChannelRows(v, SHOP),
  people: (v) => businessPeopleRows(v, SHOP), compare: (v, p) => businessCompareRows(v, p, SHOP),
};
/** The Hours aggregation: a 15-minute figure of the CSV is carried by its hour's figure of the same measure. */
const HOUR_FIELD: Record<string, "checks" | "sales" | "amountMissing" | "hours" | "cost" | "pct"> = {
  checks: "checks", toast_sales: "sales", amount_missing: "amountMissing", labor_hours: "hours", straight_time_cost: "cost", straight_time_pct: "pct",
};
const hourOf = (at: string) => `${at.slice(0, 13)}:00:00.000Z`;

function census(tab: BusinessExportTab, v: BusinessReportView, prev: BusinessReportView): string[] {
  seen.csv.length = 0; seen.pdf.clear();
  builders[tab](v, prev);
  const csv = [...seen.csv];
  const pdf = businessPdf(tab, v, tab === "compare" ? prev : null, "en");
  const quarters = new Map((v.quarters ?? []).flatMap((q) => Object.entries(q).filter(([, f]) => typeof f === "object" && f !== null).map(([, f]) => [f, q] as const)));
  const missing: string[] = [];
  for (const [column, f] of csv) {
    if (column in BUSINESS_PDF_OMITTED[tab]) continue;
    const q = tab === "hours" ? quarters.get(f) : undefined;
    if (q) {
      if (!q.active) continue; // nothing happened in that 15 minutes: its hour (if any) sums zeros
      const hour = v.days.find((d) => d.date === q.date)?.hourly.find((h) => h.hourStartAt === hourOf(q.quarterStartAt));
      const field = HOUR_FIELD[column];
      if (!field || !hour || hour[field] === undefined || !seen.pdf.has(hour[field])) missing.push(`${tab}: ${column} of ${q.quarterStartAt} (its hour's ${field ?? "?"})`);
      continue;
    }
    if (!seen.pdf.has(f)) missing.push(`${tab}: ${column}`);
  }
  // Every non-figure column is classified, and a `shown` one is in the PDF's words.
  const figureColumns = new Set(csv.map(([c]) => c));
  const text = [...pdf.tables.flatMap((t) => [t.heading ?? "", ...t.columns.map((c) => c.label ?? ""), ...t.rows.flatMap((r) => Object.values(r).map((x) => String(x ?? "")))]), ...pdf.notes].join("\n");
  for (const c of BUSINESS_EXPORT_COLUMNS[tab]) {
    if (figureColumns.has(c.key) || c.key in BUSINESS_PDF_OMITTED[tab]) continue;
    const k = NON_FIGURE[c.key];
    if (!k) { missing.push(`${tab}: ${c.key} is neither a figure nor classified`); continue; }
    if (k.kind !== "shown") continue;
    const want: Record<string, string[]> = {
      pure_hourly_target_pct: tab === "overview" || tab === "compare" ? [R("target").replace("{pct}", "18")] : [],
      fully_loaded_target_pct: tab === "overview" || tab === "compare" ? [R("target_le").replace("{pct}", "28")] : [],
      pay_class: tab === "people" && v.people.length ? [R("people.pay.hourly")] : [],
      weeks_withheld: [],
    };
    for (const w of want[c.key] ?? []) if (!text.includes(w)) missing.push(`${tab}: ${c.key} ("${w}" not in the PDF)`);
  }
  return missing;
}

describe("P2: the readable PDF carries every figure the CSV rows carry", () => {
  it("every tab, MoO (every cost) and GM: no figure of the old row builders is missing from the PDF", async () => {
    for (const role of ["moo", "gm"] as const) {
      const dto = busy(await load(role));
      const v = businessView(dto), prev = businessView(dto);
      expect(v.days[0]!.largeChecks.any, "the fixture has large checks").toBe(true);
      expect(v.days[0]!.rush?.windows.length, "the fixture has rushes").toBe(2);
      const missing = BUSINESS_EXPORT_TABS.flatMap((tab) => census(tab, v, prev));
      expect(missing, role).toEqual([]);
    }
  });
  it("the census can fail: a figure the PDF does not print is named", async () => {
    const v = businessView(busy(await load()));
    seen.csv.length = 0; seen.pdf.clear();
    businessOverviewRows(v, SHOP);
    businessPdf("channels", v, null, "en"); // the wrong tab: Overview's figures are not printed
    expect(seen.csv.some(([, f]) => !seen.pdf.has(f))).toBe(true);
  });
  it("nothing that is money, labor, a rush or a large check is listed as deliberately left out of the PDF", () => {
    for (const tab of BUSINESS_EXPORT_TABS) {
      for (const [column, why] of Object.entries(BUSINESS_PDF_OMITTED[tab])) {
        expect(why.length, `${tab}.${column}: a reason`).toBeGreaterThan(10);
        expect(column, `${tab}.${column}`).not.toMatch(/cost|pct|premium|burden|salar|sales|net|refund|ezcater|hours|overtime|large|rush|checks|amount|toast/);
      }
    }
  });
  it("the review's example: Overview of a day with large checks and detected rushes prints both, with each window", async () => {
    const p = businessPdf("overview", businessView(busy(await load())), null, "en");
    const table = (key: string) => p.tables.find((t) => t.heading === R(key));
    const large = table("pdf.large_rush")!;
    expect(large, "a large-checks-and-rushes table").toBeDefined();
    const row = Object.values(large.rows[0]!).map(String);
    expect(row.some((c) => c.startsWith("2"))).toBe(true);
    expect(row.some((c) => c.includes("$12,345.00"))).toBe(true);
    expect(row.some((c) => c.startsWith(R("rush.count").replace("{n}", "2")) || c.startsWith("2"))).toBe(true);
    const windows = table("pdf.rush_windows")!;
    expect(windows.rows).toHaveLength(2);
    for (const t of p.tables) expect(t.columns.length, t.heading ?? "").toBeLessThanOrEqual(7);
  });
  it("Compare prints every measure of both periods (the old total rows), the two targets and the large checks", async () => {
    const v = businessView(busy(await load()));
    const p = businessPdf("compare", v, v, "en");
    const labels = p.tables[0]!.rows.map((r) => String(r.c0));
    for (const k of ["detail.checks", "pdf.col.toast_checks", "detail.toast_net", "detail.ezcater", "channels.ezcater_label", "card.refunds", "pdf.col.no_amount",
      "detail.hours", "detail.ot_hours", "detail.pure_hourly_cost", "detail.ot_premium", "detail.salaried", "detail.burden", "detail.fully_loaded",
      "pdf.hourly_target", "pdf.loaded_target", "pdf.col.large_checks", "pdf.col.large_amount"]) expect(labels, k).toContain(R(k));
  });
});

describe("P3: Compare's change uses the scope's marks, not the qualification sentences again", () => {
  const SHORTS = ["qual.burden_estimated", "qual.salary_estimated", "qual.wage_estimated", "qual.hours_unverified"].map((k) => EN[`reports.business.${k}`]).filter((s): s is string => !!s);
  it("the fixture's qualifications have short words to look for", () => expect(SHORTS.length).toBeGreaterThan(1));
  it("page: two comparable estimated periods — each change is a value with marks; no short qualifier words beside it; every mark resolves", async () => {
    const dto = busy(await load());
    const markup = renderToStaticMarkup(createElement(BusinessCompare, { dto, previous: dto, language: "en" }));
    assertMarksResolve(markup);
    const changes = markup.split(`>${R("compare.change")}</span>`).slice(1).map((s) => s.split("</li>")[0]!);
    expect(changes.length).toBe(5);
    let marked = 0;
    for (const c of changes) {
      // What a sighted reader sees beside the change (the full markup's marks were proved above).
      const text = c.replace(/<span class="sr-only"[^>]*>[\s\S]*?<\/span>/g, "").replace(/<[^>]+>/g, " ");
      for (const s of SHORTS) expect(text, `change: ${text}`).not.toContain(s);
      if (c.includes("data-marks=")) marked += 1;
    }
    expect(marked, "the labor changes carry the estimate marks").toBeGreaterThan(0);
  });
  it("PDF: each change cell is the value and the marks of the file's legend; no short qualifier words", async () => {
    const v = businessView(busy(await load()));
    const p = businessPdf("compare", v, v, "en");
    const marks = new Set(p.legend.map((l) => /^\(([a-z]+)\)/.exec(l)![1]!));
    let marked = 0;
    for (const r of p.tables[0]!.rows) {
      const c = String(r.c3 ?? "");
      for (const s of SHORTS) expect(c, c).not.toContain(s);
      const m = /^\S+ \(([a-z]+(?:, [a-z]+)*)\)$/.exec(c);
      if (m) { marked += 1; for (const x of m[1]!.split(", ")) expect(marks.has(x), `${c}: mark ${x}`).toBe(true); }
    }
    expect(marked).toBeGreaterThan(0);
  });
  it("a qualification the legend does not hold is still said beside the change (nothing dropped)", async () => {
    const v = businessView(busy(await load()));
    const l = figureLegend("en", []);
    const c = l.change(v.total.labor.purePct, v.total.labor.purePct);
    expect(c).not.toBeNull();
    expect(c!.marks).toEqual([]);
    expect(c!.loose.length).toBeGreaterThan(0);
  });
});
