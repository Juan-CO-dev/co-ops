// Item 9b fix round 7 (review ITEM9B-r7), failing-first. Two findings, each the visible end of a class:
//  P2-1  burden (a share of hourly + salaried pay) dropped the salary estimate: its qualifications were a
//        hand-picked list. A DERIVED figure now inherits EVERY qualification of EVERY input (derivedFrom).
//  P2-2  "No checks or labor this day." was said whenever the 15-minute list was empty. An empty list is a CLAIM:
//        it is said only when every input behind it is known complete (and empty); otherwise the reasons.
// Then the same two rules on every other derived figure and every other "none" sentence (page and files).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
// Drawers OPEN with the collapsed summary beside them (as tests/business-report-9b-r4-sweep.test.ts).
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
import { detectRushes, resolveBusinessRange, type LaborFigures, type QuarterPoint } from "@/lib/business-report-shared";
import {
  figureCells, loadedCentsFigure, loadedPctFigure, personCostFigure, pureCentsFigure, purePctFigure, quarterCentsFigure, quarterPctFigure, type Figure,
} from "@/lib/business-figure-shared";
import type { ExportRow } from "@/lib/report-export-shared";
import { A, fakeClient, type FakeOpts } from "./helpers/business-report-fake";
import { EN, laborIn, visibleText } from "./helpers/business-report-states";
import {
  BusinessChannels, BusinessCompare, BusinessHours, BusinessOverview, BusinessPeople,
  businessCompareRows, businessHoursRows, businessOverviewRows,
} from "./helpers/business-report-views";

const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const SHOP = { id: A, code: "MEP", name: "Capitol Hill" };
const moo = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
const range = resolveBusinessRange({ range: "custom", from: "2026-10-01", to: "2026-10-07" }, "2026-10-08");
const loadWith = (o: FakeOpts = {}) => loadBusinessReport(moo, { locationId: A, range }, { client: fakeClient(o).client, env: ON });
const text = (el: Parameters<typeof renderToStaticMarkup>[0]) => visibleText(renderToStaticMarkup(el));
const R = (k: string) => EN[`reports.business.${k}`] ?? `<<reports.business.${k} is not translated>>`;
const count = (t: string, s: string) => t.split(s).length - 1;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const X = "2026-10-03";

const datesOf = (a: Record<string, unknown>) => {
  const out: string[] = [];
  for (let t = Date.parse(`${a.p_from}T00:00:00Z`); t <= Date.parse(`${a.p_to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
/** fact_labor_cost: whole by default (real wage, real salary, payroll burden); `over` changes one thing. */
const cost = (over: Record<string, unknown> = {}) => ({ fact_labor_cost: (a: Record<string, unknown>) => {
  const n = datesOf(a).length;
  return [{ week_start: "2026-09-27", location_id: A, hourly_straight_cents: 900, ot_premium_cents: 0, salaried_cents: 400, salary_basis: "wages",
    burden_pct: 12, burden_basis: "payroll", estimated_rate_minutes: 0, hourly_minutes: 30, ot_minutes: 0, salaried_minutes: 0, ot_state: "assessed",
    range_days: n, days_covered: n, days_pending: 0, days_fallback: 0, days_incomplete: 0, days_missing: 0, open_punches: 0, ...over }];
} });
/** sales_report_daily: `rung` days have checks; `captured` days were captured (a captured day with no check is a real zero). */
const sales = (rung: (d: string) => boolean, captured: (d: string) => boolean = rung) => ({ sales_report_daily: (a: Record<string, unknown>) => {
  const ds = datesOf(a);
  return { classes: ds.filter(rung).map((d) => ({ business_date: d, sale_class: "sale", checks: 2, amount_cents: 3_000, tax_cents: 0, amount_missing: 0, tax_missing: 0,
    gross_cents: 3_000, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 })),
    tips: [], discounts: [], refunds: [], captured_days: ds.filter(captured), ezcater: [] };
} });
const cuts = (bend: (d: string, rows: Array<Record<string, unknown>>) => Array<Record<string, unknown>>) => ({ business_report_check_cuts: (a: Record<string, unknown>) =>
  datesOf(a).flatMap((d) => bend(d, [
    { business_date: d, quarter_start_at: `${d}T16:00:00.000Z`, wall_quarter: 48, fold: 0, et_date: d, channel: "dine_in", provider: null,
      server_guid: "srv-1", server_label: "Ana", sale_class: "sale", checks: 1, amount_cents: 1_000, amount_missing: 0, large_checks: 0, large_cents: 0 },
    { business_date: d, quarter_start_at: `${d}T16:15:00.000Z`, wall_quarter: 49, fold: 0, et_date: d, channel: "online", provider: null,
      server_guid: null, server_label: null, sale_class: "sale", checks: 1, amount_cents: 2_000, amount_missing: 0, large_checks: 0, large_cents: 0 },
  ])) });
const NO_LABOR_QUARTERS = { business_report_labor_quarters: () => [] };
const NO_PEOPLE = { business_report_labor_people: () => [] };

/** The qualification codes a figure carries, read the only way a file can: its `figure_notes`. */
function codes(f: Figure): string[] {
  const note = String(figureCells({ x: f }).figure_notes ?? "");
  const m = /^x=[a-z]+\(([^)]*)\)/.exec(note);
  return m ? m[1]!.split(",").filter(Boolean) : [];
}
const QUALS = ["wage_estimated", "hours_unverified", "burden_estimated", "salary_estimated", "salary_gaps"];
const quals = (f: Figure) => codes(f).filter((c) => QUALS.includes(c)).sort();

// ── P2-1 ────────────────────────────────────────────────────────────────────────────────────────

describe("P2-1: burden carries the salary estimate (it is a share of hourly + salaried pay)", () => {
  it("the fixture: salary from the shop's estimate, everything else real", async () => {
    const l = (await loadWith({ rpcRows: cost({ salary_basis: "estimate" }) })).total.labor;
    expect([l.state, l.loadedState, l.salaryEstimated, l.burdenEstimated, l.wageEstimated, l.hoursUnverified, l.salaryGaps]).toEqual(["ok", "ok", true, false, false, false, 0]);
  });
  it("the files: burden_cost is named estimated(salary_estimated) on every day, week and total row", async () => {
    const dto = await loadWith({ rpcRows: cost({ salary_basis: "estimate" }) });
    const rows = [...businessOverviewRows(dto, SHOP), ...businessCompareRows(dto, dto, SHOP).filter((r) => r.period !== "last_year")];
    expect(rows.length).toBeGreaterThan(dto.days.length);
    for (const r of rows) {
      expect(r.burden_cost, String(r.row_type)).not.toBeNull();
      for (const c of ["salaried_cost", "burden_cost", "fully_loaded_cost", "fully_loaded_pct"]) {
        expect(String(r.figure_notes), `${String(r.row_type)}.${c}`).toMatch(new RegExp(`(^|; )${c}=estimated\\([a-z_,]*salary_estimated`));
      }
    }
  });
  it("the page: the burden line of every week and day drawer says so", async () => {
    const dto = await loadWith({ rpcRows: cost({ salary_basis: "estimate" }) });
    const t = text(createElement(BusinessOverview, { dto, language: "en" }));
    // Polish (marker + legend form): the burden figure shows its marks and carries its sentences (`text` proved each
    // mark against the drawer's legend): label, amount, marks, then the sentences up to the next amount.
    const line = new RegExp(`${esc(R("detail.burden"))} \\$[\\d.,]+ [a-z,]+ \\([^$]*?${esc(R("salary_estimated"))}`, "g");
    expect(t.match(line)?.length ?? 0).toBe(dto.weeks.length + dto.days.length);
  });
  it("real salaries: burden carries no such words", async () => {
    const dto = await loadWith({ rpcRows: cost() });
    for (const r of businessOverviewRows(dto, SHOP)) expect(r.figure_notes ?? null).toBeNull();
  });
});

describe("a derived figure inherits EVERY qualification of EVERY input, in every combination", () => {
  const base = (): LaborFigures => ({
    state: "ok", minutes: 300, pureHourlyCents: 5_000, otPremiumCents: 100, otMinutes: 30, denominator: { cents: 25_000, state: "ok" }, pct: 20, tone: "watch",
    loadedState: "ok", salariedCents: 2_000, burdenCents: 840, fullyLoadedCents: 7_840, loadedPct: 31.4, loadedTone: "high",
    burdenEstimated: false, salaryEstimated: false, salaryGaps: 0, wageEstimated: false, hoursUnverified: false,
  });
  const combos: LaborFigures[] = [];
  for (let m = 0; m < 32; m++) {
    combos.push({ ...base(), wageEstimated: !!(m & 1), hoursUnverified: !!(m & 2), burdenEstimated: !!(m & 4), salaryEstimated: !!(m & 8), salaryGaps: m & 16 ? 2 : 0 });
  }
  const union = (...xs: string[][]) => [...new Set(xs.flat())].sort();
  it("32 combinations: hourly money, burden, fully loaded, both %", () => {
    for (const l of combos) {
      const label = JSON.stringify([l.wageEstimated, l.hoursUnverified, l.burdenEstimated, l.salaryEstimated, l.salaryGaps]);
      const hourly = [...(l.wageEstimated ? ["wage_estimated"] : []), ...(l.hoursUnverified ? ["hours_unverified"] : [])].sort();
      const salaried = [...(l.salaryEstimated ? ["salary_estimated"] : []), ...(l.salaryGaps ? ["salary_gaps"] : [])].sort();
      const rate = l.burdenEstimated ? ["burden_estimated"] : [];
      const pure = pureCentsFigure(l, "pureHourlyCents");
      expect(quals(pure), `pure ${label}`).toEqual(hourly);
      expect(quals(pureCentsFigure(l, "otPremiumCents")), `premium ${label}`).toEqual(hourly);
      expect(quals(loadedCentsFigure(l, "salariedCents")), `salaried ${label}`).toEqual(salaried);
      // Burden = (hourly + salaried) x the burden rate: all three.
      expect(quals(loadedCentsFigure(l, "burdenCents")), `burden ${label}`).toEqual(union(hourly, salaried, rate));
      // Fully loaded = hourly + salaried + burden.
      expect(quals(loadedCentsFigure(l, "fullyLoadedCents")), `loaded ${label}`).toEqual(union(hourly, salaried, rate));
      expect(quals(purePctFigure(l)), `pure % ${label}`).toEqual(hourly);
      expect(quals(loadedPctFigure(l)), `loaded % ${label}`).toEqual(union(hourly, salaried, rate));
      // A payroll gap makes the figure incomplete, whatever else is estimated.
      const note = String(figureCells({ x: loadedCentsFigure(l, "burdenCents") }).figure_notes ?? "");
      if (l.salaryGaps) expect(note, `burden kind ${label}`).toMatch(/^x=incomplete\(/);
    }
  });
  it("per person and per 15 minutes: hours x wage", () => {
    for (const l of combos.filter((c) => !c.burdenEstimated && !c.salaryEstimated && !c.salaryGaps)) {
      const hourly = [...(l.wageEstimated ? ["wage_estimated"] : []), ...(l.hoursUnverified ? ["hours_unverified"] : [])].sort();
      expect(quals(personCostFigure(18_000, "hourly", l))).toEqual(hourly);
      expect(quals(quarterCentsFigure(900, 30, l))).toEqual(hourly);
      expect(quals(quarterPctFigure(12.5, l))).toEqual(hourly);
      // A 15 minutes with no labor is $0 only because the hours say so: it inherits what the hours carry.
      expect(quals(quarterCentsFigure(null, 0, l))).toEqual(l.hoursUnverified ? ["hours_unverified"] : []);
    }
  });
  it("Compare: a change between estimated figures names the estimates; a change between plain figures is plain", async () => {
    const est = await loadWith({ rpcRows: cost({ salary_basis: "estimate" }) });
    const t = text(createElement(BusinessCompare, { dto: est, previous: est, language: "en" }));
    // Polish fix round 1 (review POLISH-r1 P3): the change names the estimate as the Compare legend's MARK (proved
    // against its legend line by visibleText), never the short words again beside it.
    expect(t).toMatch(new RegExp(`0 pts [a-z]+ \\(${esc(R("salary_estimated"))}\\)`));
    expect(t).not.toContain(`pts (${R("qual.salary_estimated")})`);
    const clean = await loadWith({ rpcRows: cost() });
    const c = text(createElement(BusinessCompare, { dto: clean, previous: clean, language: "en" }));
    expect(c).toContain("0 pts");
    expect(c).not.toMatch(/0 pts \(/);
    // One side estimated is enough.
    const mixed = text(createElement(BusinessCompare, { dto: clean, previous: est, language: "en" }));
    expect(mixed).toMatch(new RegExp(`pts [a-z]+ \\(${esc(R("salary_estimated"))}\\)`));
  });
});

// ── P2-2 ────────────────────────────────────────────────────────────────────────────────────────

const hoursRowsOf = (dto: BusinessReportDto, date: string): ExportRow[] => businessHoursRows(dto, SHOP).filter((r) => r.business_date === date);

describe("P2-2: 'No checks or labor this day' is a claim: only over known-complete inputs", () => {
  it("sales not captured AND labor not built: the reasons, never 'No checks or labor'", async () => {
    const dto = await loadWith({ weeks: [], rpcRows: { ...sales((d) => d !== X), ...cuts((d, rows) => (d === X ? [] : rows)), ...NO_LABOR_QUARTERS, ...cost() } });
    const day = dto.days.find((d) => d.date === X)!;
    expect([day.sales.coverage, day.cuts, day.labor.state]).toEqual(["missing", "sales_not_covered", "unbuilt"]);
    expect(dto.quarters!.filter((q) => q.date === X)).toEqual([]);
    const t = text(createElement(BusinessHours, { dto, language: "en" }));
    expect(t).not.toContain(R("hours.no_activity"));
    expect(t).toContain(R("empty.not_known"));
    expect(t).toContain(`${R("empty.not_known")} ${R("sales.not_captured")} ${R("labor.state.unbuilt")}`);
    // The day's sales were not captured: nothing on this tab calls it "rebuilding ... Totals are final".
    expect(t).not.toContain(R("cuts.rebuilding"));
    expect(t).not.toContain(R("badge.rebuilding"));
    // The file: one row for the day, saying it is unknown and why. Never silence.
    const rows = hoursRowsOf(dto, X);
    expect(rows.map((r) => [r.row_type, r.status, r.labor_state])).toEqual([["day", "activity_unknown", "unbuilt"]]);
    expect(String(rows[0]!.figure_notes)).toBe("activity=unknown(not_captured,unbuilt)");
  });
  it("sales captured, breakdown ready, but labor not final: unknown with the labor reason", async () => {
    const dto = await loadWith({ rpcRows: { ...sales((d) => d !== X, () => true), ...cuts((d, rows) => (d === X ? [] : rows)), ...NO_LABOR_QUARTERS, ...cost({ open_punches: 1 }) } });
    const day = dto.days.find((d) => d.date === X)!;
    expect([day.cuts, day.labor.state]).toEqual(["ok", "hours_unknown"]);
    const t = text(createElement(BusinessHours, { dto, language: "en" }));
    expect(t).not.toContain(R("hours.no_activity"));
    expect(t).toContain(`${R("empty.not_known")} ${R("labor.state.hours_unknown")}`);
    expect(hoursRowsOf(dto, X).map((r) => [r.row_type, r.status])).toEqual([["day", "activity_unknown"]]);
  });
  it("checks with no opened time: never 'No checks'; the day says nothing is TIMED and lists them", async () => {
    const dto = await loadWith({ rpcRows: { ...cuts((d, rows) => (d === X ? rows.map((r) => ({ ...r, quarter_start_at: null, wall_quarter: null, fold: null })) : rows)),
      ...NO_LABOR_QUARTERS, ...cost({ hourly_minutes: 0, hourly_straight_cents: 0 }) } });
    const day = dto.days.find((d) => d.date === X)!;
    expect(day.cuts).toBe("ok");
    expect(dto.quartersUnassigned!.find((u) => u.date === X)!.checks).toBe(2);
    const t = text(createElement(BusinessHours, { dto, language: "en" }));
    expect(t).not.toContain(R("hours.no_activity"));
    expect(count(t, R("hours.no_timed_activity"))).toBe(1);
    expect(t).toMatch(new RegExp(`${esc(R("hours.no_timed_activity"))} ${esc(R("quarter.unassigned"))}: 2 checks`));
    expect(hoursRowsOf(dto, X).map((r) => [r.row_type, r.status])).toEqual([["unassigned", undefined], ["day", "no_timed_activity"]]);
  });
  it("VERIFIED zero (sales captured with no check, breakdown ready, hours final and zero): the sentence, once", async () => {
    const dto = await loadWith({ rpcRows: { ...sales((d) => d !== X, () => true), ...cuts((d, rows) => (d === X ? [] : rows)), ...NO_LABOR_QUARTERS,
      ...cost({ hourly_minutes: 0, hourly_straight_cents: 0 }) } });
    const day = dto.days.find((d) => d.date === X)!;
    expect([day.sales.coverage, day.cuts, day.labor.minutes]).toEqual(["complete", "ok", 0]);
    const t = text(createElement(BusinessHours, { dto, language: "en" }));
    expect(count(t, R("hours.no_activity"))).toBe(1);
    expect(t).not.toContain(R("empty.not_known"));
    const rows = hoursRowsOf(dto, X);
    expect(rows.map((r) => [r.row_type, r.status, r.figure_notes ?? null])).toEqual([["day", "no_activity", null]]);
  });
  it("hours on the day but none in any 15 minutes: the list cannot say 'no labor'", async () => {
    const dto = await loadWith({ rpcRows: { ...sales((d) => d !== X, () => true), ...cuts((d, rows) => (d === X ? [] : rows)), ...NO_LABOR_QUARTERS, ...cost() } });
    expect(dto.days.find((d) => d.date === X)!.labor.minutes).toBeGreaterThan(0);
    const t = text(createElement(BusinessHours, { dto, language: "en" }));
    expect(t).not.toContain(R("hours.no_activity"));
    expect(t).toContain(`${R("empty.not_known")} ${R("figure.not_available")}`);
  });
  it("a day WITH quarters gets no day row in the file", async () => {
    const dto = await loadWith({ rpcRows: cost() });
    expect(businessHoursRows(dto, SHOP).filter((r) => r.row_type === "day")).toEqual([]);
  });
});

// ── The same rule on every other "none" ─────────────────────────────────────────────────────────

describe("every other empty sentence: said only over known-complete inputs", () => {
  it("Channels: 'Nothing excluded' / the empty channel list only when every day's breakdown is ready", async () => {
    const none = await loadWith({ rpcRows: { ...sales(() => false), ...cost() } });
    expect(none.days.every((d) => d.cuts === "sales_not_covered")).toBe(true);
    const t = text(createElement(BusinessChannels, { dto: none, language: "en" }));
    expect(t).not.toContain(R("channels.excluded_none"));
    expect(t).not.toContain(R("channels.none_verified"));
    expect(count(t, `${R("empty.not_known")} ${R("figure.breakdown_none")}`)).toBe(2);
    // Part of the period ready and nothing excluded on it: still not "nothing excluded in this range".
    const part = text(createElement(BusinessChannels, { dto: await loadWith({ rpcRows: { ...sales((d) => d !== X), ...cost() } }), language: "en" }));
    expect(part).not.toContain(R("channels.excluded_none"));
    expect(part).toContain(`${R("empty.not_known")} ${R("figure.breakdown_partial")}`);
    // Every day ready: the sentence stands.
    const whole = text(createElement(BusinessChannels, { dto: await loadWith({ rpcRows: cost() }), language: "en" }));
    expect(whole).toContain(R("channels.excluded_none"));
    expect(whole).not.toContain(R("empty.not_known"));
    // Every day ready and no Toast check at all: a real "none", not "no breakdown yet".
    const zero = text(createElement(BusinessChannels, { dto: await loadWith({ rpcRows: { ...sales(() => false, () => true), ...cuts(() => []), ...cost() } }), language: "en" }));
    expect(zero).toContain(R("channels.none_verified"));
    expect(zero).not.toContain(R("channels.none"));
  });
  it("People: 'No hours in this range' only when the hours are final and zero; never '0 people' over unknown hours", async () => {
    const unbuilt = text(createElement(BusinessPeople, { dto: await loadWith({ weeks: [], rpcRows: { ...NO_PEOPLE, ...cost() } }), language: "en" }));
    expect(unbuilt).not.toContain(R("people.none"));
    expect(unbuilt).toContain(`${R("empty.not_known")} ${R("labor.state.unbuilt")}`);
    expect(unbuilt).not.toContain(R("people.count").replace("{n}", "0"));
    // Hours known and above zero but nobody listed: the list is not known, it is not "no hours".
    const mismatch = text(createElement(BusinessPeople, { dto: await loadWith({ rpcRows: { ...NO_PEOPLE, ...cost() } }), language: "en" }));
    expect(mismatch).not.toContain(R("people.none"));
    expect(mismatch).toContain(R("empty.not_known"));
    const zero = text(createElement(BusinessPeople, { dto: await loadWith({ rpcRows: { ...NO_PEOPLE, ...cost({ hourly_minutes: 0, hourly_straight_cents: 0 }) } }), language: "en" }));
    expect(zero).toContain(R("people.none"));
    expect(zero).not.toContain(R("empty.not_known"));
  });
  it("Sales by server: an empty list over days that are not ready is unknown, never '0 people'", async () => {
    const t = text(createElement(BusinessPeople, { dto: await loadWith({ rpcRows: { ...sales(() => false), ...cost() } }), language: "en" }));
    expect(t).not.toContain(R("people.count").replace("{n}", "0"));
    expect(t).not.toContain(R("people.servers_none"));
    expect(t).toContain(`${R("empty.not_known")} ${R("figure.breakdown_none")}`);
    const zero = text(createElement(BusinessPeople, { dto: await loadWith({ rpcRows: { ...sales(() => false, () => true), ...cuts(() => []), ...cost() } }), language: "en" }));
    expect(zero).toContain(R("people.servers_none"));
  });
  it("Rushes: a 15 minutes that could not be compared (a check with no amount) is counted, and 'No rushes' is not said over it", async () => {
    const q = (wq: number, checks: number, cents: number, amountMissing = 0): QuarterPoint =>
      ({ quarterStartAt: new Date(Date.parse("2026-10-07T04:00:00Z") + wq * 900_000).toISOString(), wallQuarter: wq, fold: 0, checks, cents, amountMissing });
    const hist = Array.from({ length: 8 }, (_, i) => ({ date: `2026-09-${String(30 - 7 * i > 0 ? 30 - 7 * i : 1).padStart(2, "0")}`, quarters: [q(46, 6, 12_000), q(47, 6, 12_000)] }));
    const r = (qs: QuarterPoint[]) => detectRushes({ date: "2026-10-07", quarters: qs }, hist) as { uncompared?: number };
    expect(r([q(46, 5, 10_000), q(47, 5, 10_000)]).uncompared).toBe(0);
    expect(r([q(46, 12, 24_000, 1), q(47, 5, 10_000)]).uncompared).toBe(1);
    // Too few checks to ever be a rush: its unknown amount changes nothing.
    expect(r([q(46, 2, 1_000, 1), q(47, 5, 10_000)]).uncompared).toBe(0);
    // A baseline day with an unknown amount at that quarter leaves today's quarter uncompared too.
    const holed = hist.map((h, i) => (i === 0 ? { ...h, quarters: [q(46, 6, 12_000, 1), q(47, 6, 12_000)] } : h));
    expect((detectRushes({ date: "2026-10-07", quarters: [q(46, 12, 24_000), q(47, 5, 10_000)] }, holed) as { uncompared?: number }).uncompared).toBe(1);

    const clean = await loadWith({ rpcRows: cost() });
    expect(clean.days.every((d) => d.rush?.state === "ok")).toBe(true);
    const all = text(createElement(BusinessHours, { dto: clean, language: "en" }));
    expect(count(all, R("rush.none"))).toBe(clean.days.length);
    const dto: BusinessReportDto = { ...clean, days: clean.days.map((d) => (d.date === X ? { ...d, rush: { state: "ok" as const, windows: [], uncompared: 2 } as never } : d)) };
    const t = text(createElement(BusinessHours, { dto, language: "en" }));
    expect(count(t, R("rush.none"))).toBe(clean.days.length - 1);
    expect(t).toContain(R("rush.not_all_compared"));
    const row = businessOverviewRows(dto, SHOP).find((x) => x.row_type === "day" && x.period_start === X)!;
    expect(row.rushes).toBe(0);
    expect(String(row.figure_notes)).toContain("rushes=incomplete(not_all_compared)");
  });
  it("Same days last year: 'No data until ...' only while that is the reason", async () => {
    const dto = await loadWith({ rpcRows: cost() });
    for (const el of [createElement(BusinessOverview, { dto, language: "en" }), createElement(BusinessCompare, { dto, previous: dto, language: "en" })]) {
      expect(text(el)).toContain(R("last_year.no_data_yet"));
    }
    const later: BusinessReportDto = { ...dto, range: { ...dto.range, lastYear: { from: "2025-10-01", to: "2025-10-07" }, lastYearReason: null } };
    for (const el of [createElement(BusinessOverview, { dto: later, language: "en" }), createElement(BusinessCompare, { dto: later, previous: later, language: "en" })]) {
      const t = text(el);
      expect(t).not.toContain(R("last_year.no_data_yet"));
      expect(t).toContain(R("last_year.not_shown"));
    }
  });
  it("a labor state the pure core can return never turns an empty list into a 'none' (every state x Hours, People)", async () => {
    const base = await loadWith({ rpcRows: { ...NO_LABOR_QUARTERS, ...NO_PEOPLE, ...sales(() => false, () => true), ...cuts(() => []), ...cost() } });
    for (const s of ["rebuilding", "unbuilt", "before_history", "hours_unknown"] as const) {
      const dto: BusinessReportDto = { ...base, days: base.days.map((d) => ({ ...d, labor: laborIn(d.labor, s) })), total: { ...base.total, labor: laborIn(base.total.labor, s) } };
      expect(text(createElement(BusinessHours, { dto, language: "en" })), s).not.toContain(R("hours.no_activity"));
      expect(text(createElement(BusinessPeople, { dto, language: "en" })), s).not.toContain(R("people.none"));
    }
  });
});

// ── Source pins ─────────────────────────────────────────────────────────────────────────────────

describe("the page cannot write a 'none' sentence, or a qualification list, by hand", () => {
  const read = async (f: string) => (await import("node:fs")).readFileSync((await import("node:path")).resolve(__dirname, "..", f), "utf8");
  it("every 'none' key reaches the page only as the `none` of an EmptyNote; no list is judged empty by its length", async () => {
    const src = await read("components/reports-business/BusinessReport.tsx");
    const NONE_KEYS = ["hours.no_activity", "hours.no_timed_activity", "channels.none_verified", "channels.excluded_none", "people.none", "people.servers_none"];
    for (const k of NONE_KEYS) {
      const uses = src.split(`"reports.business.${k}"`).length - 1;
      expect(uses, k).toBe(1);
      expect(src, k).toMatch(new RegExp(`none=\\{?[^>]*"reports\\.business\\.${k.replace(".", "\\.")}"`));
    }
    expect(src).not.toMatch(/\.length === 0/);
    // "No rushes" only behind the view's verified flag.
    expect(src.split('"reports.business.rush.none"').length - 1).toBe(1);
    expect(src).toMatch(/rush\.none \? t\("reports\.business\.rush\.none"\)/);
    // "No data until ..." only through the one function that reads the range's own reason.
    expect(src.split('"reports.business.last_year.no_data_yet"').length - 1).toBe(1);
  });
  it("the figure module holds no hand-picked list: every labor builder's notes come from derivedFrom(...inputs)", async () => {
    const src = await read("lib/business-figure-shared.ts");
    expect(src).not.toMatch(/\bwageNotes\b|\bhourNotes\b|\bloadedNotes\b/);
    // Every options object handed to `make` with notes: `{ notes: <who>...`.
    const notes = [...src.matchAll(/\{ notes: (\w+)/g)].map((m) => m[1]!);
    expect(notes.length).toBeGreaterThanOrEqual(12);
    expect([...new Set(notes)]).toEqual(["derivedFrom"]);
    // The four qualification constants are named only by their sources, the order, and nothing else.
    for (const c of ["BURDEN", "SALARY", "RATE", "UNVERIFIED"]) {
      const uses = [...src.matchAll(new RegExp(`\\[${c}\\]|\\b${c}\\.key\\b`, "g"))].length;
      expect(uses, c).toBe(2);
    }
  });
});
