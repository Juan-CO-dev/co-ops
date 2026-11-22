// Item 9b fix round 4, the builder's own adversarial sweep: EVERY surface (the five tabs with drawers open, the
// closed rows, the five export tables, which the PDF and the CSV both print) x EVERY input state that makes a
// figure less than plain, each produced by the REAL loader from source rows (not by editing a DTO):
//
//   open punch · day still settling · before labor history · Toast fallback hours · estimated wage ·
//   salary from the shop's estimate + 12% default burden · payroll gap (salary incomplete) · no salary at all ·
//   payroll week not built · week being recounted · no sales captured · sales captured for part of the period ·
//   a day's breakdown rebuilding · a check of unknown amount · a GM (no cost per person / per 15 minutes).
//
// Two invariants hold in every one of them, on every surface:
//   PAGE  no money, % or hours is written without its qualifier: a scenario's forbidden plain forms never appear.
//   FILE  every figure cell that is empty is named `unknown(...)` in figure_notes; every scenario's affected
//         columns are named with the right kind; nothing is named when the scenario is clean.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
// Drawers OPEN with the collapsed summary beside them (as tests/business-report-9b-r3.test.ts): one render shows
// both what a closed row says and what a tap shows. The real closed component is tests/business-report-9b-r3-closed.
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
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { BUSINESS_EXPORT_COLUMNS, type ExportRow } from "@/lib/report-export-shared";
import { A, fakeClient, gmOff, type FakeOpts } from "./helpers/business-report-fake";
import { EN, visibleText } from "./helpers/business-report-states";
import {
  BusinessChannels, BusinessCompare, BusinessHours, BusinessOverview, BusinessPeople,
  businessChannelRows, businessCompareRows, businessHoursRows, businessOverviewRows, businessPeopleRows,
} from "./helpers/business-report-views";

const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const SHOP = { id: A, code: "MEP", name: "Capitol Hill" };
const RANGE = { from: "2026-10-01", to: "2026-10-07" };
const viewer = (role: "moo" | "gm") => ({ userId: `u-${role}`, level: role === "moo" ? 8 : 7, role, locations: role === "gm" ? [A] : [] as string[] });
const loadWith = (o: FakeOpts = {}, r = RANGE, role: "moo" | "gm" = "moo") =>
  loadBusinessReport(viewer(role), { locationId: A, range: resolveBusinessRange({ range: "custom", ...r }, "2026-10-08") }, { client: fakeClient(o).client, env: ON });

const datesOf = (a: Record<string, unknown>) => {
  const out: string[] = [];
  for (let t = Date.parse(`${a.p_from}T00:00:00Z`); t <= Date.parse(`${a.p_to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
/** fact_labor_cost: a whole week by default (real wage, real salary, payroll burden); `over` breaks one thing. */
const cost = (over: Record<string, unknown>) => ({ fact_labor_cost: (a: Record<string, unknown>) => {
  const n = datesOf(a).length;
  return [{ week_start: "2026-09-27", location_id: A, hourly_straight_cents: 900, ot_premium_cents: 0, salaried_cents: 400, salary_basis: "wages",
    burden_pct: 12, burden_basis: "payroll", estimated_rate_minutes: 0, hourly_minutes: 30, ot_minutes: 0, salaried_minutes: 0, ot_state: "assessed",
    range_days: n, days_covered: n, days_pending: 0, days_fallback: 0, days_incomplete: 0, days_missing: 0, open_punches: 0, ...over }];
} });
/** sales_report_daily with the given dates not captured at all. */
const sales = (skip: (d: string) => boolean) => ({ sales_report_daily: (a: Record<string, unknown>) => {
  const ds = datesOf(a).filter((d) => !skip(d));
  return { classes: ds.map((d) => ({ business_date: d, sale_class: "sale", checks: 2, amount_cents: 3_000, tax_cents: 0, amount_missing: 0, tax_missing: 0,
    gross_cents: 3_000, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 })),
    tips: [], discounts: [], refunds: [], captured_days: ds, ezcater: ds.map((d) => ({ business_date: d, orders: 1, subtotal_cents: 2_000, amount_missing: 0 })) };
} });
/** business_report_check_cuts: the fake's two checks a day; `bend` changes a day's rows. */
const cuts = (bend: (d: string, rows: Array<Record<string, unknown>>) => Array<Record<string, unknown>>) => ({ business_report_check_cuts: (a: Record<string, unknown>) =>
  datesOf(a).flatMap((d) => bend(d, [
    { business_date: d, quarter_start_at: `${d}T16:00:00.000Z`, wall_quarter: 48, fold: 0, et_date: d, channel: "dine_in", provider: null,
      server_guid: "srv-1", server_label: "Ana", sale_class: "sale", checks: 1, amount_cents: 1_000, amount_missing: 0, large_checks: 0, large_cents: 0 },
    { business_date: d, quarter_start_at: `${d}T16:15:00.000Z`, wall_quarter: 49, fold: 0, et_date: d, channel: "online", provider: null,
      server_guid: null, server_label: null, sale_class: "sale", checks: 1, amount_cents: 2_000, amount_missing: 0, large_checks: 0, large_cents: 0 },
  ])) });
const WEEKS = (scope: string, version: string) => ["2026-09-27", "2026-10-04"].map((week_start) => ({ week_start, ot_scope: scope, builder_version: version }));

const text = (el: Parameters<typeof renderToStaticMarkup>[0]) => visibleText(renderToStaticMarkup(el));
/** Every tab as a sighted person reads it. `open` = drawers open (the mock below is installed per call). */
type Tab = "overview" | "hours" | "channels" | "people" | "compare";
function pages(dto: BusinessReportDto, previous: BusinessReportDto | null = dto): Record<Tab, string> {
  return {
    overview: text(createElement(BusinessOverview, { dto, language: "en" })),
    hours: text(createElement(BusinessHours, { dto, language: "en" })),
    channels: text(createElement(BusinessChannels, { dto, language: "en" })),
    people: text(createElement(BusinessPeople, { dto, language: "en" })),
    compare: text(createElement(BusinessCompare, { dto, previous, language: "en" })),
  };
}
function files(dto: BusinessReportDto): Record<Tab, ExportRow[]> {
  return { overview: businessOverviewRows(dto, SHOP), compare: businessCompareRows(dto, dto, SHOP).filter((r) => r.period !== "last_year"),
    hours: businessHoursRows(dto, SHOP), channels: businessChannelRows(dto, SHOP), people: businessPeopleRows(dto, SHOP) };
}
const PLAIN_COLUMNS = new Set(["pure_hourly_target_pct", "fully_loaded_target_pct", "salary_gaps", "days_included", "days_in_period", "weeks_withheld"]);
/** FILE invariant: an empty figure cell is named unknown; a named-unknown cell is empty. */
function fileInvariant(tables: Record<string, ExportRow[]>, label: string): void {
  for (const [tab, rows] of Object.entries(tables)) {
    const figureColumns = BUSINESS_EXPORT_COLUMNS[tab as keyof typeof BUSINESS_EXPORT_COLUMNS].filter((c) => ["money", "number", "int"].includes(c.kind) && !PLAIN_COLUMNS.has(c.key));
    for (const r of rows) for (const c of figureColumns) {
      if (!(c.key in r)) continue;
      const named = new RegExp(`(^|; )${c.key}=(estimated|incomplete|unknown)\\(`).exec(String(r.figure_notes ?? ""))?.[2];
      expect(r[c.key] === null, `${label} ${tab}.${String(r.row_type)}.${c.key}`).toBe(named === "unknown");
    }
  }
}
const notesOf = (rows: ExportRow[], type: string) => rows.filter((r) => r.row_type === type).map((r) => String(r.figure_notes ?? ""));
const R = (k: string) => EN[`reports.business.${k}`]!;
const count = (t: string, s: string) => t.split(s).length - 1;
/** A labor % as a figure (not a target line, not the "12%" inside the burden sentence). */
const PCT = /(?<![\d.])(?<!Target )(?<!at most )(?<!estimated at )\d+(\.\d)?%/;

describe("labor: hours that are not final (real source rows)", () => {
  const cases: Array<[string, FakeOpts, string, { minutes: boolean }]> = [
    ["an open punch", { rpcRows: cost({ open_punches: 1 }) }, "hours_unknown", { minutes: true }],
    ["a day still settling", { rpcRows: cost({ days_pending: 1 }) }, "hours_unknown", { minutes: true }],
    ["a day missing from the labor facts", { rpcRows: cost({ days_missing: 1 }) }, "hours_unknown", { minutes: true }],
    ["a payroll week not built", { weeks: [] }, "unbuilt", { minutes: true }],
    ["a week still on the old overtime rule (being recounted)", { weeks: WEEKS("company", LABOR_BUILDER_VERSION) }, "rebuilding", { minutes: true }],
    ["a week built by an older builder", { weeks: WEEKS("per_shop", "labor-v0") }, "rebuilding", { minutes: true }],
  ];
  for (const [name, opts, state, has] of cases) {
    it(`${name}: every tab and every file say so`, async () => {
      const dto = await loadWith(opts);
      expect(dto.total.labor.state).toBe(state);
      const reason = R(`labor.state.${state}`);
      const p = pages(dto);
      // No labor % anywhere; hours are "so far"; the reason is on every labor tab.
      for (const tab of ["overview", "compare"] as const) expect(p[tab], tab).toContain(reason);
      expect(p.overview).not.toMatch(PCT);
      // Compare: both labor % cells are dashes (the only % left on the tab is the change in sales).
      for (const label of ["card.pure_hourly", "card.fully_loaded"]) expect(p.compare, label).toContain(`${R(label)} ${R("compare.this")}: — `);
      if (has.minutes) {
        expect(p.overview).toMatch(/\d h so far/);
        expect(p.overview).not.toMatch(/\d h(?! so far)/);
        expect(p.people).toMatch(/\d+ h so far/);
        expect(p.people).not.toMatch(/\d h(?! so far)/);
        // The closed row, the day line, and beside every quarter that has no labor row.
        expect(count(p.hours, reason)).toBeGreaterThanOrEqual(3 * dto.days.length);
        expect(p.hours).not.toMatch(/\d h(?! so far)/);
      }
      // Money that exists is "so far"; money that does not is a dash with the reason. Never a bare labor amount.
      for (const tab of ["people", "hours"] as const) expect(p[tab], tab).not.toMatch(/Straight time \$[\d.,]+(?![\d.,])(?! so far)/);
      expect(p.compare).toContain(R("compare.not_comparable"));
      const f = files(dto);
      fileInvariant(f, name);
      for (const n of [...notesOf(f.overview, "total"), ...notesOf(f.compare, "total"), ...notesOf(f.overview, "day"), ...notesOf(f.overview, "week")]) {
        expect(n).toContain(`pure_hourly_pct=unknown(${state})`);
        expect(n).toContain(`labor_hours=incomplete(so_far,${state})`);
        expect(n).toMatch(new RegExp(`pure_hourly_cost=(incomplete\\(so_far,${state}|unknown\\(${state})`));
      }
      for (const n of notesOf(f.people, "person")) expect(n).toContain(`hours=incomplete(so_far,${state})`);
      for (const r of f.hours.filter((x) => x.row_type === "quarter")) expect(String(r.figure_notes)).toMatch(new RegExp(`labor_hours=(incomplete\\(so_far,${state}|unknown\\(${state})`));
    });
  }
  it("before labor history: dashes with the reason, no hours and no money at all", async () => {
    const dto = await loadWith({}, { from: "2026-07-01", to: "2026-07-07" });
    expect(dto.total.labor.state).toBe("before_history");
    const p = pages(dto);
    const reason = R("labor.state.before_history");
    for (const tab of ["overview", "compare", "hours"] as const) expect(p[tab], tab).toContain(reason);
    expect(p.overview).not.toMatch(PCT);
    expect(p.overview).not.toMatch(/\d h\b/);
    const f = files(dto);
    fileInvariant(f, "before_history");
    for (const n of notesOf(f.overview, "total")) for (const c of ["labor_hours", "pure_hourly_cost", "pure_hourly_pct", "fully_loaded_cost", "fully_loaded_pct"]) {
      expect(n, c).toContain(`${c}=unknown(before_history)`);
    }
  });
});

describe("labor: figures built on an estimate (shown, and named)", () => {
  const cases: Array<[string, Record<string, unknown>, { full: string; short: string; code: string; flag: string; columns: string[] }]> = [
    ["hours from the Toast fallback (7shifts not confirmed)", { days_fallback: 2 },
      { full: R("hours_unverified"), short: R("qual.hours_unverified"), code: "hours_unverified", flag: "hours_unverified",
        columns: ["labor_hours", "pure_hourly_cost", "pure_hourly_pct", "burden_cost", "fully_loaded_cost", "fully_loaded_pct"] }],
    ["hours priced at an estimated wage", { estimated_rate_minutes: 30 },
      { full: R("wage_estimated"), short: R("qual.wage_estimated"), code: "wage_estimated", flag: "wage_estimated",
        columns: ["pure_hourly_cost", "overtime_premium", "pure_hourly_pct", "burden_cost", "fully_loaded_cost", "fully_loaded_pct"] }],
    ["the 12% default burden", { burden_basis: "estimated" },
      { full: R("burden_estimated"), short: R("qual.burden_estimated"), code: "burden_estimated", flag: "burden_estimated",
        columns: ["burden_cost", "fully_loaded_cost", "fully_loaded_pct"] }],
    ["salaries from the shop's estimate", { salary_basis: "estimate" },
      { full: R("salary_estimated"), short: R("qual.salary_estimated"), code: "salary_estimated", flag: "salary_estimated",
        // Fix round 7 (ITEM9B-r7 P2): burden is a share of hourly + SALARIED pay, so it carries the salary estimate too.
        columns: ["salaried_cost", "burden_cost", "fully_loaded_cost", "fully_loaded_pct"] }],
  ];
  for (const [name, over, x] of cases) {
    it(`${name}: on the cards, in every drawer, on every closed row, in Compare and in the files`, async () => {
      const dto = await loadWith({ rpcRows: cost(over) });
      expect([dto.total.labor.state, dto.total.labor.loadedState]).toEqual(["ok", "ok"]);
      const p = pages(dto);
      // Polish (marker + legend form; `text` proves every mark against its legend and says each figure's sentence
      // in place): the cards' legend, the weeks' legend and EVERY week row and day row carry the full sentence.
      expect(count(p.overview, x.full)).toBeGreaterThanOrEqual(2 + dto.weeks.length + dto.days.length);
      // The short words are gone from the page: a qualification is one sentence, said once per scope.
      expect(count(p.overview, `(${x.short})`)).toBe(0);
      expect(count(p.compare, x.full)).toBeGreaterThanOrEqual(2);
      // An estimate is whole: it compares, with its label on both sides.
      expect(p.compare).not.toContain(`${R("card.fully_loaded")} ${R("compare.this")}: — `);
      const f = files(dto);
      fileInvariant(f, name);
      for (const r of [...f.overview, ...f.compare]) {
        expect(r[x.flag], `${String(r.row_type)}.${x.flag}`).toBe(true);
        for (const c of x.columns) expect(String(r.figure_notes), `${String(r.row_type)}.${c}`).toMatch(new RegExp(`(^|; )${c}=estimated\\([a-z_,]*${x.code}`));
      }
    });
  }
  it("the clean fixture carries no qualifier on any tab and no figure_notes in any file", async () => {
    const dto = await loadWith({ rpcRows: cost({}) });
    const p = pages(dto);
    for (const k of ["hours_unverified", "wage_estimated", "burden_estimated", "salary_estimated", "qual.hours_unverified", "qual.wage_estimated", "qual.burden_estimated",
      "qual.salary_estimated", "figure.breakdown_partial", "sales.not_captured", "coverage.partial"]) {
      for (const [tab, t] of Object.entries(p)) expect(t, `${tab}: ${k}`).not.toContain(R(k));
    }
    for (const t of Object.values(p)) expect(t).not.toMatch(/so far|at least \$|days only\)|amount unknown/);
    const f = files(dto);
    fileInvariant(f, "clean");
    // The one thing a clean file names: a 15 minutes with sales and no labor has no % (the page's "No % for this 15 minutes").
    for (const [tab, rows] of Object.entries(f)) for (const r of rows) {
      expect(r.figure_notes ?? null, `${tab}.${String(r.row_type)}`).toBe(tab === "hours" && r.straight_time_pct === null ? "straight_time_pct=unknown(no_pct)" : null);
    }
  });
  it("a payroll gap / no salary at all: fully loaded is a dash with its reason everywhere; pure hourly still shows", async () => {
    for (const [basis, state] of [["incomplete", "salary_incomplete"], ["unknown", "salary_unknown"]] as const) {
      const dto = await loadWith({ rpcRows: cost({ salaried_cents: null, salary_basis: basis, salary_missing_wage_people: basis === "incomplete" ? 2 : 0 }) });
      expect([dto.total.labor.state, dto.total.labor.loadedState]).toEqual(["ok", state]);
      const p = pages(dto);
      expect(p.overview).toContain(R(`labor.state.${state}`));
      expect(p.compare).toContain(R(`labor.state.${state}`));
      expect(p.overview).toMatch(PCT);
      const f = files(dto);
      fileInvariant(f, state);
      for (const n of [...notesOf(f.overview, "total"), ...notesOf(f.overview, "day"), ...notesOf(f.overview, "week")]) {
        for (const c of ["salaried_cost", "burden_cost", "fully_loaded_cost", "fully_loaded_pct"]) expect(n, c).toContain(`${c}=unknown(${state}`);
        expect(n).not.toContain("pure_hourly_pct=");
      }
    }
  });
});

describe("sales: not captured, partly captured, a breakdown still rebuilding, an unknown amount", () => {
  it("no sales captured at all: no $0.00 and no '0 checks' on any tab; every sales cell empty and named", async () => {
    const dto = await loadWith({ rpcRows: { ...sales(() => true), ...cost({}) } });
    expect(dto.total.sales.coverage).toBe("missing");
    const p = pages(dto);
    for (const [tab, t] of Object.entries(p)) expect(t, tab).not.toMatch(/(^|\D)0 checks/);
    // Sales money: never $0.00 (the only $0.00 on Overview is real labor money: the overtime premium).
    for (const tab of ["channels", "people", "hours"] as const) expect(p[tab], tab).not.toMatch(/\$0\.00/);
    for (const label of ["card.sales", "card.refunds", "detail.sales", "detail.ezcater", "detail.toast_net"]) {
      expect(p.overview, label).not.toMatch(new RegExp(`${R(label)} \\$`));
    }
    expect(p.compare).not.toMatch(/Sales before refunds This period: \$/);
    for (const tab of ["overview", "channels", "compare"] as const) expect(p[tab], tab).toContain(R("sales.not_captured"));
    // Nothing on a tab that lists the breakdown says the totals are final.
    for (const tab of ["channels", "people"] as const) {
      expect(p[tab], tab).not.toContain("totals are final");
      // Polish: the banner names the REAL cause (no sales captured), never "rebuilding", and that empty is not zero.
      expect(p[tab], tab).toContain("No sales were captured on 7 of 7 days");
      expect(p[tab], tab).toContain("Empty here means not known, not zero.");
      expect(p[tab], tab).not.toContain("rebuilding");
    }
    // Labor % has no denominator: a dash with the sales reason, and labor money stays what it is.
    expect(p.overview).toContain(R("labor.state.sales_not_covered"));
    expect(p.overview).not.toMatch(PCT);
    const f = files(dto);
    fileInvariant(f, "sales missing");
    for (const n of [...notesOf(f.overview, "total"), ...notesOf(f.overview, "day"), ...notesOf(f.overview, "week"), ...notesOf(f.compare, "total")]) {
      for (const c of ["checks", "toast_check_totals", "ezcater_sales", "ezcater_orders", "refunds_captured_so_far", "sales_before_refunds", "amount_missing"]) {
        expect(n, c).toMatch(new RegExp(`(^|; )${c}=unknown\\(`));
      }
    }
    expect(notesOf(f.channels, "ezcater")[0]).toContain("sales=unknown(not_captured)");
  });
  it("sales captured for part of the period: totals are 'covered days only', breakdowns 'ready days only', nothing compares", async () => {
    const dto = await loadWith({ rpcRows: { ...sales((d) => d === "2026-10-03"), ...cost({}) } });
    expect(dto.total.sales.coverage).toBe("partial");
    expect(dto.days.find((d) => d.date === "2026-10-03")!.sales.coverage).toBe("missing");
    const p = pages(dto);
    expect(p.overview).toMatch(/\$300\.00 \(covered days only\)/);
    expect(p.overview).not.toMatch(/\$300\.00(?! \(covered days only\))/);
    // Channels, servers: only the six ready days.
    expect(p.channels).toMatch(/\$120\.00 \(ready days only\)/);
    expect(p.channels).not.toMatch(/\$(120|60)\.00(?! \((ready|covered) days only\))/);
    expect(p.channels).toMatch(/ezCater orders\s+\$120\.00 \(covered days only\)/);
    expect(p.people).toMatch(/\$60\.00 \(ready days only\)/);
    expect(p.people).not.toMatch(/\$60\.00(?! \(ready days only\))/);
    // Compare: a partly covered period never yields a change for sales.
    expect(p.compare).toMatch(/Sales before refunds This period: \$300\.00 \(covered days only\)/);
    expect(p.compare).toMatch(/Sales before refunds This period:[^%]*Not comparable Net sales/);
    // Polish: the list banner names the day's REAL cause (no sales captured; it is not "rebuilding"), and the totals
    // are not called final.
    expect(p.channels).toContain("No sales were captured on 1 of 7 days");
    expect(p.channels).not.toContain("rebuilding");
    expect(p.channels).not.toContain("totals are final");
    const f = files(dto);
    fileInvariant(f, "sales partial");
    expect(notesOf(f.overview, "total")[0]).toContain("sales_before_refunds=incomplete(covered_days_only,partial)");
    expect(notesOf(f.overview, "total")[0]).toContain("pure_hourly_pct=unknown(sales_not_covered)");
    for (const n of [...notesOf(f.channels, "channel"), ...notesOf(f.people, "server")]) expect(n).toContain("sales=incomplete(ready_days_only,breakdown_partial)");
    expect(notesOf(f.channels, "ezcater")[0]).toContain("sales=incomplete(covered_days_only,partial)");
    // The missing day's row: empty, named.
    const day = f.overview.find((r) => r.row_type === "day" && r.period_start === "2026-10-03")!;
    expect([day.sales_before_refunds, day.checks, day.large_checks]).toEqual([null, null, null]);
  });
  it("one day's breakdown rebuilding: that day's quarters are dashes with the reason; lists are 'ready days only'; totals stay final", async () => {
    const dto = await loadWith({ rpcRows: { ...cuts((d, rows) => (d === "2026-10-05" ? rows.slice(0, 1) : rows)), ...cost({}) } });
    expect(dto.days.find((d) => d.date === "2026-10-05")!.cuts).toBe("rebuilding");
    expect(dto.total.sales.coverage).toBe("complete");
    const p = pages(dto);
    expect(p.overview).toMatch(/Sales before refunds \$350\.00(?! \()/);
    expect(p.channels).toContain(R("channels.rebuilding_days").replace("{n}", "1"));
    expect(p.channels).toMatch(/\(ready days only\)/);
    expect(p.channels).not.toMatch(/\$(60|120)\.00(?! \(ready days only\))/);
    expect(p.hours).toContain(R("cuts.rebuilding"));
    const f = files(dto);
    fileInvariant(f, "breakdown rebuilding");
    const q = f.hours.filter((r) => r.row_type === "quarter" && r.business_date === "2026-10-05");
    expect(q.length).toBeGreaterThan(0);
    for (const r of q) { expect([r.checks, r.toast_sales]).toEqual([null, null]); expect(String(r.figure_notes)).toContain("toast_sales=unknown(rebuilding)"); }
    const day = f.overview.find((r) => r.row_type === "day" && r.period_start === "2026-10-05")!;
    expect(day.large_checks).toBeNull();
    expect(String(day.figure_notes)).toContain("large_checks=unknown(rebuilding)");
    expect(notesOf(f.overview, "total")[0]).toContain("large_checks=incomplete(ready_days_only,breakdown_partial)");
  });
  it("a check of unknown amount: a floor on every tab that shows it, 'at_least' in every file", async () => {
    const bend = (d: string, rows: Array<Record<string, unknown>>) => (d === "2026-10-02" ? [{ ...rows[0]!, amount_missing: 1 }, rows[1]!] : rows);
    const daily = sales(() => false).sales_report_daily;
    const dto = await loadWith({ rpcRows: { ...cuts(bend), ...cost({}), sales_report_daily: (a) => {
      const r = daily(a);
      return { ...r, classes: r.classes.map((c) => (c.business_date === "2026-10-02" ? { ...c, amount_missing: 1 } : c)) };
    } } });
    expect(dto.days.find((d) => d.date === "2026-10-02")!.cuts).toBe("ok");
    const p = pages(dto);
    expect(p.overview).toMatch(/at least \$350\.00 \+ 1 unknown/);
    expect(p.overview).not.toMatch(/Sales before refunds \$350\.00/);
    expect(p.channels).toMatch(/at least \$\d+\.00 \+ 1 unknown/);
    expect(p.people).toMatch(/at least \$\d+\.00 \+ 1 unknown/);
    expect(p.hours).toMatch(/at least \$10\.00 \+ 1 unknown/);
    const f = files(dto);
    fileInvariant(f, "amount missing");
    expect(notesOf(f.overview, "total")[0]).toContain("sales_before_refunds=incomplete(at_least,amount_missing)");
    expect(notesOf(f.channels, "channel").some((n) => n.includes("sales=incomplete(at_least,amount_missing)"))).toBe(true);
    expect(notesOf(f.people, "server").some((n) => n.includes("sales=incomplete(at_least,amount_missing)"))).toBe(true);
    expect(f.hours.some((r) => String(r.figure_notes).includes("toast_sales=incomplete(at_least,amount_missing)"))).toBe(true);
  });
});

describe("a GM whose MoO+ turned cost per person and dollars per 15 minutes off: neither is on the page or in a file, in any state", () => {
  for (const [name, opts] of [["clean", { rpcRows: cost({}) }], ["open punch", { rpcRows: cost({ open_punches: 1 }) }], ["estimated wage", { rpcRows: cost({ estimated_rate_minutes: 30 }) }]] as const) {
    it(name, async () => {
      const dto = await loadWith({ ...(opts as FakeOpts), visibility: [gmOff("person_cost", "quarter_cost")] }, RANGE, "gm");
      const p = pages(dto);
      expect(p.people).not.toContain(R("people.cost"));
      expect(p.people).not.toMatch(/\$180/);
      // Hours tab: the only dollars are sales.
      expect(p.hours).not.toMatch(/\$9\.00/);
      expect(p.hours).not.toMatch(PCT);
      const f = files(dto);
      fileInvariant(f, `gm ${name}`);
      for (const r of f.people.filter((x) => x.row_type === "person")) expect("straight_time_cost" in r).toBe(false);
      for (const r of f.hours.filter((x) => x.row_type === "quarter")) expect("straight_time_cost" in r || "straight_time_pct" in r).toBe(false);
    });
  }
});
