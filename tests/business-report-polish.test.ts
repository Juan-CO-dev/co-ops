// Business report polish (2026-11-18): PRESENTATION only. The correctness laws of item 9b stand (an unknown is
// never a plain number or $0; every figure keeps its state and qualifications: the census, r1-r9). What changed is
// how it is said, and each change is pinned here:
//
//   1. ONCE PER SCOPE   a qualification is written once in the scope's legend; every figure it qualifies shows the
//                       mark and carries the sentence for a screen reader. Every mark resolves (helpers prove it).
//   2. LABELS           no figure without a visible label: drawers, 15-minute lines, closed rows.
//   3. WORDING          the Net sales card speaks about sales; "still being rebuilt" only when a day is.
//   4. HOURS            a day lists its HOURS (closed); an hour opens its 15-minute lines.
//   5. LAYOUT           People, Channels and Compare rows are two fixed columns.
//   6. EMPTY RANGE      no CSV / PDF link, and the reason in their place.
//   7. CSV              line 1 is the header row; notices follow the table and are the tab's own.
//   8. PDF              words, not codes: translated labels, marks + one "Notes" legend, portrait, few pages.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
// Drawers render closed on the server; open the CollapsibleSection ones. HourDisclosure stays REAL (closed).
vi.mock("@/components/ui/CollapsibleSection", async () => {
  const { createElement: h } = await import("react");
  return { CollapsibleSection: ({ title, count, badge, children }: { title: unknown; count?: unknown; badge?: unknown; children: unknown }) =>
    h("section", null, h("span", null, title as never), h("span", { "data-row": "" }, count as never), badge as never, h("div", { "data-drawer": "" }, children as never)) };
});

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { loadBusinessReport, type BusinessReportDto } from "@/lib/business-report";
import { resolveBusinessRange } from "@/lib/business-report-shared";
import { businessPdf } from "@/lib/business-report-pdf";
import { figureLegend } from "@/lib/business-figure-format";
import { businessView } from "@/lib/business-view-shared";
import { renderReportPdf } from "@/lib/report-pdf";
import { BUSINESS_EXPORT_COLUMNS, BUSINESS_EXPORT_TABS, businessCoverageNotice, businessOverviewRows, toCsv } from "@/lib/report-export-shared";
import { BusinessChannels, BusinessCompare, BusinessHours, BusinessOverview, BusinessPeople } from "./helpers/business-report-views";
import { A, fakeClient } from "./helpers/business-report-fake";
import { PURE_STATES, assertMarksResolve, laborIn, legendsOf, loadedIn, markedFigures, sightedText, visibleText, withLabor } from "./helpers/business-report-states";

const EN = en as Record<string, string>, ES = es as Record<string, string>;
const R = (k: string) => EN[`reports.business.${k}`]!;
const ROOT = path.resolve(__dirname, "..");
const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const SHOP = { id: A, code: "MEP", name: "Capitol Hill" };
const range = resolveBusinessRange({ range: "custom", from: "2026-10-01", to: "2026-10-07" }, "2026-10-08");
const viewer = (role: "moo" | "gm") => ({ userId: `u-${role}`, level: role === "moo" ? 8 : 7, role, locations: role === "gm" ? [A] : [] as string[] });
const load = (role: "moo" | "gm" = "moo") => loadBusinessReport(viewer(role), { locationId: A, range }, { client: fakeClient().client, env: ON });
const count = (t: string, s: string) => t.split(s).length - 1;
type El = Parameters<typeof renderToStaticMarkup>[0];
const html = (el: El) => renderToStaticMarkup(el);
const tabs = (dto: BusinessReportDto): Record<string, El> => ({
  overview: createElement(BusinessOverview, { dto, language: "en" }), hours: createElement(BusinessHours, { dto, language: "en" }),
  channels: createElement(BusinessChannels, { dto, language: "en" }), people: createElement(BusinessPeople, { dto, language: "en" }),
  compare: createElement(BusinessCompare, { dto, previous: dto, language: "en" }),
});
/** Every estimate at once on top of a fully known report: wage, Toast-fallback hours, burden, salary, payroll gaps. */
const estimated = (dto: BusinessReportDto) => withLabor(dto, (l) => ({ ...loadedIn(l, "estimated"), wageEstimated: true, hoursUnverified: true }));
/** A day with no sales captured: its breakdown is not shown (the DTO shape lib/business-report.ts gives it). */
const notCaptured = (dto: BusinessReportDto, cuts: "sales_not_covered" | "rebuilding"): BusinessReportDto => ({
  ...dto, days: dto.days.map((d) => ({ ...d, cuts, rush: null })),
  quarters: dto.quarters!.map((q) => ({ ...q, toastCents: null, checks: null, amountMissing: null })), quartersUnassigned: [],
});
const QUALS = ["wage_estimated", "hours_unverified", "burden_estimated", "salary_estimated"].map(R);

// ── 1. Once per scope ───────────────────────────────────────────────────────────────────────────

describe("1. a qualification is said ONCE per scope, and every figure it qualifies is marked", () => {
  it("every labor state x every tab: every mark names a legend line holding the figure's own sentence", async () => {
    const base = await load();
    for (const state of PURE_STATES) {
      const dto = withLabor(base, (l) => laborIn(l, state));
      for (const [tab, el] of Object.entries(tabs(dto))) expect(() => assertMarksResolve(html(el)), `${state} ${tab}`).not.toThrow();
    }
    for (const el of Object.values(tabs(estimated(base)))) expect(() => assertMarksResolve(html(el))).not.toThrow();
  });
  it("the proof can fail: a mark with no legend line, or whose legend says something else, throws by name", () => {
    const fig = (mark: string, said: string) => `<sup aria-hidden="true" title="x" data-marks="${mark}" class="x">${mark}</sup><span class="sr-only" data-figure-note=""> (${said})</span>`;
    const legend = (mark: string, text: string) => `<ul data-legend="" aria-label="Notes" class="x"><li class="x"><span aria-hidden="true" data-mark="${mark}" class="x">${mark}</span><span class="x">${text}</span></li></ul>`;
    expect(() => assertMarksResolve(fig("a", "Wage estimated.") + legend("a", "Wage estimated."))).not.toThrow();
    expect(() => assertMarksResolve(fig("a", "Wage estimated."))).toThrow(/mark "a".*no legend line/);
    expect(() => assertMarksResolve(fig("b", "Wage estimated.") + legend("a", "Wage estimated."))).toThrow(/mark "b"/);
    expect(() => assertMarksResolve(fig("a", "Wage estimated.") + legend("a", "Burden estimated."))).toThrow(/mark "a"/);
    expect(() => assertMarksResolve(`<sup>a</sup>${legend("a", "Wage estimated.")}`)).toThrow(/1 marks on the page, 0 carry/);
  });
  it("Overview: each estimate sentence is read once under the cards, once on top of each list, once in each open drawer", async () => {
    const dto = estimated(await load());
    const markup = html(tabs(dto).overview);
    const n = dto.weeks.length + dto.days.length;
    for (const q of QUALS) {
      expect(count(sightedText(markup), q), q).toBe(3 + n);
      // ... while EVERY affected figure still carries it (so nothing became less qualified than before).
      expect(markedFigures(markup).filter((f) => f.said.includes(q)).length, q).toBeGreaterThanOrEqual(2 + 3 * n);
    }
    // The old form repeated the short words on every row: gone.
    for (const k of ["qual.wage_estimated", "qual.hours_unverified", "qual.burden_estimated", "qual.salary_estimated"]) expect(sightedText(markup), k).not.toContain(`(${R(k)}`);
  });
  it("People: 'Toast hours' and 'wage estimated' are said once for the list, and every person's hours and cost carry their mark", async () => {
    const dto = estimated(await load());
    const markup = html(tabs(dto).people);
    expect(count(sightedText(markup), R("hours_unverified"))).toBe(1);
    expect(count(sightedText(markup), R("wage_estimated"))).toBe(1);
    expect(dto.people.length).toBeGreaterThan(0);
    expect(markedFigures(markup).filter((f) => f.said.includes(R("hours_unverified"))).length).toBeGreaterThanOrEqual(dto.people.length);
  });
  it("Compare: 'Sales are missing ...' is said once under the cards, not in all four labor cells", async () => {
    const dto = withLabor(await load(), (l) => laborIn(l, "sales_not_covered"));
    const markup = html(tabs(dto).compare);
    const reason = R("labor.state.sales_not_covered");
    expect(count(sightedText(markup), reason)).toBe(1);
    expect(markedFigures(markup).filter((f) => f.said.includes(reason)).length).toBe(4);
  });
  it("a legend can never drop a sentence: what the scope's legend does not hold is written beside the figure", async () => {
    const view = businessView(estimated(await load()));
    const f = view.total.labor.loadedCost;
    const other = figureLegend("en", [view.total.sales.total], { reasons: true }).read(f);
    expect(other.marks).toEqual([]);
    expect(other.loose.map((n) => n.text)).toEqual(expect.arrayContaining(QUALS));
    const own = figureLegend("en", [f], { reasons: true }).read(f);
    expect(own.loose).toEqual([]);
    expect(own.marks.map((m) => m.text)).toEqual(expect.arrayContaining(QUALS));
    // A printed cell says the value, its marks, and anything the legend lacks: never the value alone.
    expect(figureLegend("en", [f]).cell(f)).toMatch(/^\$[\d,.]+ \(a, b, c, d(, e)?\)$/);
    expect(figureLegend("en", []).cell(f)).toContain(R("burden_estimated"));
  });
  it("marks are a, b, ... z, aa: stable and unique within a scope", async () => {
    const view = businessView(estimated(await load()));
    const marks = figureLegend("en", [view.total.labor.loadedCost, view.total.labor.hours], { reasons: true }).entries.map((e) => e.mark);
    expect(new Set(marks).size).toBe(marks.length);
    expect(marks[0]).toBe("a");
  });
});

// ── 2. Labels ───────────────────────────────────────────────────────────────────────────────────

describe("2. every figure has a visible label", () => {
  it("week and day drawers: the two labor % are labelled lines with their target (no bare dash on top)", async () => {
    for (const state of ["ok", "sales_not_covered", "unbuilt"] as const) {
      const dto = withLabor(await load(), (l) => laborIn(l, state));
      const markup = html(tabs(dto).overview);
      const drawers = markup.split('data-drawer=""').slice(1).filter((d) => d.includes(R("detail.hours")));
      expect(drawers.length).toBeGreaterThanOrEqual(dto.weeks.length);
      for (const d of drawers.filter((x) => !x.includes('data-row=""') || x.indexOf(R("detail.pure_pct")) >= 0)) {
        const t = visibleText(`<div>${d}`);
        if (!t.includes(R("detail.pure_hourly_cost"))) continue; // the outer list wrapper
        expect(t, state).toContain(R("detail.pure_pct"));
        expect(t, state).toContain(R("detail.loaded_pct"));
        expect(t, state).toMatch(/Target 18%|Target changes/);
      }
    }
  });
  it("no figure on any tab is a dash or value directly under a drawer with nothing naming it (every FigureView sits in a labelled part)", () => {
    const src = readFileSync(path.join(ROOT, "components/reports-business/BusinessReport.tsx"), "utf8");
    // The page writes a figure only through a part that takes a label, or inside a Card / CutLine / Compare cell
    // (each of which prints its own label next to it).
    const bare = [...src.matchAll(/<FigureView\b[^>]*>/g)].map((m) => src.slice(Math.max(0, m.index! - 400), m.index! + m[0].length));
    for (const use of bare) expect(use).toMatch(/<Card label=|LaborShare|label\}|\{label\}|p\.label|font-semibold text-co-text">\{label\}|className="text-xs text-co-text-muted">/);
    expect(src).not.toMatch(/<LaborShare labor=\{[wd]\.labor\}/); // the unlabelled pair that opened each drawer
  });
  it("a 15-minute line and an hour row name each figure: Sales, Labor, Labor cost, Labor %, and Checks when it is a dash", async () => {
    const dto = notCaptured(withLabor(await load(), (l) => laborIn(l, "ok")), "sales_not_covered");
    const markup = html(createElement(BusinessHours, { dto, language: "en" }));
    const hour = markup.split("<li").find((s) => s.includes("aria-expanded")) ?? "";
    const t = sightedText(`<ul><li${hour}</li></ul>${markup.match(/<ul data-legend=""[\s\S]*?<\/ul>/g)!.join("")}`);
    for (const k of ["slot.checks", "slot.sales", "slot.labor", "slot.cost"]) expect(t, k).toContain(`${R(k)} `);
    expect(t).toMatch(new RegExp(`${R("slot.checks")} — [a-z]`));
    expect(t).toMatch(new RegExp(`${R("slot.sales")} — [a-z]`));
  });
  it("a closed week / day row labels its four figures", async () => {
    const t = sightedText(html(tabs(withLabor(await load(), (l) => laborIn(l, "sales_not_covered"))).overview));
    for (const k of ["sum.sales", "sum.hours", "sum.pure", "sum.loaded"]) expect(t, k).toContain(`${R(k)} `);
    expect(t).toMatch(new RegExp(`${R("sum.pure")} — [a-z]`));
  });
  it("People: a cost always has its label, a dash included; overtime has its label", async () => {
    const dto = withLabor(await load(), (l) => laborIn(l, "ok"));
    const withheld: BusinessReportDto = { ...dto, people: dto.people.map((p, i) => (i === 0 ? { ...p, straightCostCents: null, otMinutes: 120 } : p)) };
    const t = sightedText(html(createElement(BusinessPeople, { dto: withheld, language: "en" })));
    expect(count(t, `${R("people.cost")} `)).toBe(withheld.people.length);
    expect(t).toMatch(new RegExp(`${R("people.cost")} — [a-z]`));
    expect(t).toContain(`${R("people.ot_label")} 2 h`);
  });
});

// ── 3. Wording ──────────────────────────────────────────────────────────────────────────────────

describe("3. each sentence says what is true of ITS figure", () => {
  it("the Net sales card speaks about sales, never 'so no labor %' (that is the % cards' line)", async () => {
    for (const state of ["sales_not_covered", "net_unknown", "ezcater_missing"] as const) {
      const markup = html(tabs(withLabor(await load(), (l) => ({ ...laborIn(l, state), denominator: { cents: null, state } }))).overview);
      const card = (label: string) => visibleText(`<div>${markup.split(`>${label}</div>`)[1]!.split("rounded-lg border")[0]!}`);
      expect(card(R("card.net")), state).toContain(R(`net.state.${state}`));
      expect(card(R("card.net")), state).not.toMatch(/labor %/);
      expect(card(R("card.pure_hourly")), state).toContain(R(`labor.state.${state}`));
    }
    for (const s of ["sales_not_covered", "net_unknown", "ezcater_missing", "zero_sales"]) {
      expect(EN[`reports.business.net.state.${s}`], s).not.toMatch(/labor %/);
      expect(ES[`reports.business.net.state.${s}`], s).not.toMatch(/% de mano de obra/);
    }
  });
  it("the file's code for that reason did not move (figure_notes is a contract)", async () => {
    const dto = withLabor(await load(), (l) => ({ ...laborIn(l, "sales_not_covered"), denominator: { cents: null, state: "sales_not_covered" as const } }));
    const total = businessOverviewRows(businessView(dto), SHOP).find((r) => r.row_type === "total")!;
    expect(String(total.figure_notes)).toMatch(/net_sales_for_labor=unknown\(sales_not_covered\)/);
  });
  it("a day with NO SALES CAPTURED never says 'still being rebuilt': its hours and 15-minute lines say no sales were captured", async () => {
    const dto = notCaptured(withLabor(await load(), (l) => laborIn(l, "ok")), "sales_not_covered");
    const t = visibleText(html(createElement(BusinessHours, { dto, language: "en" })));
    expect(t).toContain(R("sales.not_captured"));
    expect(t).not.toContain(R("cuts.rebuilding"));
    expect(t).not.toMatch(/rebuil/i);
    // ... and it is said once per day drawer for a sighted reader, not on every slot.
    expect(count(sightedText(html(createElement(BusinessHours, { dto, language: "en" }))), R("sales.not_captured"))).toBe(dto.days.length);
  });
  it("a day that IS rebuilding still says so", async () => {
    const dto = notCaptured(withLabor(await load(), (l) => laborIn(l, "ok")), "rebuilding");
    const t = visibleText(html(createElement(BusinessHours, { dto, language: "en" })));
    expect(t).toContain(R("cuts.rebuilding"));
    expect(t).not.toContain(R("sales.not_captured"));
  });
  it("the breakdown banner and the large-check line name the real cause", async () => {
    const base = withLabor(await load(), (l) => laborIn(l, "ok"));
    const none = businessView(notCaptured(base, "sales_not_covered"));
    expect(none.breakdownLeftOut).toBe("not_captured");
    expect(none.breakdownNotice?.key).toBe("reports.business.channels.not_captured_days");
    const reb = businessView(notCaptured(base, "rebuilding"));
    expect(reb.breakdownLeftOut).toBe("rebuilding");
    expect(reb.breakdownNotice?.key).toBe("reports.business.channels.rebuilding_days");
    const mixed = businessView({ ...base, days: base.days.map((d, i) => ({ ...d, cuts: i === 0 ? "rebuilding" as const : i === 1 ? "sales_not_covered" as const : d.cuts })) });
    expect(mixed.breakdownLeftOut).toBe("mixed");
    expect(businessView(base).breakdownLeftOut).toBeNull();
    const overview = visibleText(html(createElement(BusinessOverview, { dto: notCaptured(base, "sales_not_covered"), language: "en" })));
    expect(overview).toContain("the rest have no sales captured");
    expect(overview).not.toMatch(/rebuilding/);
  });
});

// ── 4. Hours ────────────────────────────────────────────────────────────────────────────────────

describe("4. the 15-minute list is HOURS that open", () => {
  it("a day lists one closed row per hour; no 15-minute line is rendered until an hour is opened", async () => {
    const dto = withLabor(await load(), (l) => laborIn(l, "ok"));
    const view = businessView(dto);
    const markup = html(createElement(BusinessHours, { dto, language: "en" }));
    const hours = view.days.flatMap((d) => d.hourly);
    expect(hours.length).toBeGreaterThan(0);
    expect(count(markup, 'aria-expanded="false"')).toBe(hours.length);
    expect(count(markup, 'aria-expanded="true"')).toBe(0);
    // Each hour holds every listed quarter of its hour, in order, and nothing is lost in the grouping.
    for (const d of view.days) {
      expect(d.hourly.flatMap((h) => h.quarters)).toEqual(d.quarters);
      for (const h of d.hourly) for (const q of h.quarters) expect(q.quarterStartAt.slice(0, 13)).toBe(h.hourStartAt.slice(0, 13));
    }
    expect(visibleText(markup)).toContain(R("hours.tap_hour"));
  });
  it("an hour's figures are its quarters', through the quarter builders: summed when known, a floor with an unknown amount, a dash when not shown", async () => {
    const dto = withLabor(await load(), (l) => laborIn(l, "ok"));
    const cell = (v: ReturnType<typeof businessView>, pick: (h: ReturnType<typeof businessView>["days"][number]["hourly"][number]) => Parameters<ReturnType<typeof figureLegend>["cell"]>[0]) =>
      figureLegend("en", []).cell(pick(v.days[0]!.hourly[0]!));
    const ok = businessView(dto);
    // withLabor: 3 checks $45.00 with no labor at :00 and 2 checks $30.00 with 45 minutes ($14.00) one hour later.
    expect(ok.days[0]!.hourly.map((h) => [cell(ok, () => h.checks), cell(ok, () => h.sales), cell(ok, () => h.hours), cell(ok, () => h.cost!)])).toEqual([
      ["3 checks", "$45.00", "No labor", "$0.00"], ["2 checks", "$30.00", "0.75 h", "$14.00"]]);
    // Two quarters in one hour add up; an unknown amount in one of them makes the hour a floor.
    const same: BusinessReportDto = { ...dto, quarters: dto.quarters!.map((q) => ({ ...q, quarterStartAt: q.quarterStartAt.replace("T16:", "T15:").replace(":00:00", q.laborMinutes ? ":15:00" : ":00:00") })) };
    const one = businessView(same).days[0]!.hourly;
    expect(one).toHaveLength(1);
    expect([cell(businessView(same), (h) => h.checks), cell(businessView(same), (h) => h.sales), cell(businessView(same), (h) => h.hours), cell(businessView(same), (h) => h.cost!)])
      .toEqual(["5 checks", "$75.00", "0.75 h", "$14.00"]);
    const floor = businessView({ ...same, quarters: same.quarters!.map((q) => (q.laborMinutes ? { ...q, amountMissing: 1 } : q)) });
    expect(cell(floor, (h) => h.sales)).toBe("at least $75.00 + 1 unknown");
    const dark = businessView(notCaptured(same, "sales_not_covered"));
    expect(cell(dark, (h) => h.sales)).toBe(`— (${R("sales.not_captured")})`);
    expect(cell(dark, (h) => h.checks)).toBe(`— (${R("sales.not_captured")})`);
    expect(cell(dark, (h) => h.hours)).toBe("0.75 h");
  });
  it("an hour's labor follows the DAY's state: not final = 'so far' or a dash with the reason, never 'No labor' / $0", async () => {
    const v = businessView(withLabor(await load(), (l) => laborIn(l, "unbuilt")));
    const legend = figureLegend("en", []);
    const [quiet, worked] = v.days[0]!.hourly;
    expect(legend.cell(quiet!.hours)).toBe(`— (${R("labor.state.unbuilt")})`);
    expect(legend.cell(worked!.hours)).toBe(`0.75 h so far (${R("labor.state.unbuilt")})`);
    expect(legend.cell(worked!.cost!)).toBe(`— (${R("labor.state.unbuilt")})`);
  });
  it("a GM's hour has no labor dollars at all (QUARTER_COST_MIN), like its quarters", async () => {
    const gm = businessView(await load("gm")), moo = businessView(await load("moo"));
    expect(gm.days.flatMap((d) => d.hourly).every((h) => !("cost" in h))).toBe(true);
    expect(moo.days.flatMap((d) => d.hourly).every((h) => "cost" in h)).toBe(true);
    expect(visibleText(html(createElement(BusinessHours, { dto: await load("gm"), language: "en" })))).not.toContain(R("slot.cost"));
  });
  it("the hour row is a full-row button with the disclosure contract (44 px, aria-expanded + aria-controls, useState only)", () => {
    const src = readFileSync(path.join(ROOT, "components/reports-business/HourDisclosure.tsx"), "utf8");
    expect(src).toMatch(/^"use client";/);
    expect(src).toMatch(/min-h-\[44px\][^"]*items-center|items-center[^"]*min-h-\[44px\]/);
    expect(src).toContain("aria-expanded={open}");
    expect(src).toContain("aria-controls={idBase}");
    expect(src).toContain("useState(false)");
    expect(src).not.toMatch(/localStorage|sessionStorage|useSearchParams/);
  });
});

// ── 5. Layout ───────────────────────────────────────────────────────────────────────────────────

describe("5. rows are two fixed columns, and Compare lays both periods out the same way", () => {
  it("every People and Channels row is the same two-column grid (a person with overtime is not indented differently)", async () => {
    const dto = withLabor(await load(), (l) => laborIn(l, "ok"));
    const ot: BusinessReportDto = { ...dto, people: dto.people.map((p, i) => (i === 0 ? { ...p, otMinutes: 480 } : p)) };
    const people = html(createElement(BusinessPeople, { dto: ot, language: "en" }));
    const rows = people.split("<li").slice(1).filter((r) => r.includes("border-b"));
    expect(rows.length).toBeGreaterThanOrEqual(ot.people.length);
    for (const r of rows) expect(r.slice(0, 200)).toContain("grid grid-cols-[minmax(0,1fr)_auto]");
    const channels = html(tabs(dto).channels).split("<li").slice(1).filter((r) => r.includes("border-b"));
    expect(channels.length).toBeGreaterThan(0);
    for (const r of channels) expect(r.slice(0, 200)).toContain("grid grid-cols-[minmax(0,1fr)_auto]");
  });
  it("Compare: 'This period' and 'Before' are the same cell (label line, figure under it), then the change with its label", async () => {
    const markup = html(tabs(withLabor(await load(), (l) => laborIn(l, "sales_not_covered"))).compare);
    const cards = markup.split("<li").slice(1, 6);
    for (const c of cards) {
      expect(count(c, 'class="flex min-w-0 flex-col"')).toBe(2);
      expect(c).toContain("grid grid-cols-2");
      expect(c.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).toContain(`${R("compare.change")} `);
    }
  });
  it("no horizontal scrolling or clipping was added (375 px law)", () => {
    for (const f of ["BusinessReport.tsx", "BusinessParts.tsx", "HourDisclosure.tsx"]) {
      expect(readFileSync(path.join(ROOT, "components/reports-business", f), "utf8"), f).not.toMatch(/overflow-x-auto|whitespace-nowrap|\btruncate\b/);
    }
  });
});

// ── 6. Empty range ──────────────────────────────────────────────────────────────────────────────

describe("6. an empty range offers no download, and says why", () => {
  it("the page shows the reason in place of the CSV / PDF links for every empty request", () => {
    const page = readFileSync(path.join(ROOT, "app/(authed)/reports/business/page.tsx"), "utf8");
    expect(page).toMatch(/request\.kind === "empty" \? <p[^>]*role="note">\{t\(BUSINESS_EXPORT_OFF_KEY\[request\.reason\]\)\}<\/p>\s*: <ExportLinks/);
    expect(count(page, "<ExportLinks")).toBe(1);
  });
  it("each reason has its sentence in en and es", async () => {
    const { BUSINESS_EXPORT_OFF_KEY } = await import("@/components/reports-business/BusinessParts");
    expect(Object.keys(BUSINESS_EXPORT_OFF_KEY).sort()).toEqual(["dates_missing", "from_after_to", "no_finished_days"]);
    for (const k of Object.values(BUSINESS_EXPORT_OFF_KEY)) { expect(EN[k], k).toMatch(/^Nothing to download/); expect(ES[k], k).toMatch(/^Nada que descargar/); }
  });
});

// ── 7. CSV ──────────────────────────────────────────────────────────────────────────────────────

describe("7. CSV: line 1 is the header row; notices follow the table and are the tab's own", () => {
  it("a business table with notices: header first, rows, one blank line, then the notes", () => {
    for (const tab of BUSINESS_EXPORT_TABS) {
      const cols = BUSINESS_EXPORT_COLUMNS[tab];
      const lines = toCsv(cols, [{ row_type: "total" }], [], ["Notes", "Covers 6 of 7 days."]).replace(/^﻿/, "").split("\r\n");
      expect(lines[0], tab).toBe(cols.map((c) => c.key).join(","));
      expect(lines[1]!.startsWith("total"), tab).toBe(true);
      expect(lines.slice(2), tab).toEqual(["", "Notes", "Covers 6 of 7 days.", ""]);
    }
  });
  it("the notice names what the tab's file holds; Compare has none; a whole file has none", async () => {
    const base = withLabor(await load(), (l) => laborIn(l, "ok"));
    const partial = businessView({ ...base, days: base.days.map((d, i) => (i === 0 ? { ...d, cuts: "rebuilding" as const } : d)) });
    const said = (tab: "overview" | "hours" | "channels" | "people") => { const n = businessCoverageNotice(partial, tab)!; return EN[n.key]!.replace(/\{(\w+)\}/g, (_, k: string) => String(n.values[k])); };
    expect(said("overview")).toMatch(/^Large checks and rushes are counted on 6 of 7 days\. 1 day/);
    expect(said("hours")).toMatch(/^Checks and sales by time are filled for 6 of 7 days/);
    expect(said("channels")).toMatch(/^Channels cover 6 of 7 days/);
    expect(said("people")).toMatch(/^Sales by server cover 6 of 7 days/);
    for (const tab of ["overview", "hours", "people"] as const) expect(said(tab), tab).not.toMatch(/[Cc]hannels/);
    for (const tab of ["overview", "hours", "channels", "people"] as const) {
      expect(businessCoverageNotice(businessView(base), tab), tab).toBeNull();
      expect(businessCoverageNotice(businessView(notCaptured(base, "sales_not_covered")), tab)!.key, tab).toBe(`reports.business.export.cover_none.${tab}`);
    }
  });
  it("the route puts business notices after the table and keeps the costing pricing line first", () => {
    const route = readFileSync(path.join(ROOT, "app/api/reports/export/route.ts"), "utf8");
    expect(route).toContain("toCsv(table.columns, table.rows, topLines, csvNotes)");
    expect(route).toContain("const topLines = pricingLine ? [pricingLine] : [];");
    expect(route).not.toMatch(/topLines = \[[^\]]*noticeLines/);
  });
});

// ── 8. PDF ──────────────────────────────────────────────────────────────────────────────────────

describe("8. the PDF is for a person: words, marks and one Notes legend", () => {
  const cellsOf = (p: ReturnType<typeof businessPdf>) => p.tables.flatMap((t) => t.rows.flatMap((r) => Object.values(r).map((v) => String(v ?? ""))));
  const labelsOf = (p: ReturnType<typeof businessPdf>) => p.tables.flatMap((t) => [t.heading ?? "", ...t.columns.map((c) => c.label ?? "")]);
  const CODE = /\b[a-z]+_[a-z_]+\b|=(unknown|estimated|incomplete)\(|\b(true|false|null)\b/;
  const all = async (dto: BusinessReportDto, language: "en" | "es" = "en") => {
    const v = businessView(dto);
    return BUSINESS_EXPORT_TABS.map((tab) => [tab, businessPdf(tab, v, tab === "compare" ? v : null, language)] as const);
  };
  it("every labor state x every tab: no raw code, no snake_case column, no true / false; every column has a translated label", async () => {
    const base = await load();
    for (const state of PURE_STATES) {
      for (const [tab, p] of await all(notCaptured(withLabor(base, (l) => laborIn(l, state)), state === "ok" ? "rebuilding" : "sales_not_covered"))) {
        for (const text of [...cellsOf(p), ...labelsOf(p), ...p.legend, ...p.notes]) expect(text, `${state} ${tab}: ${text}`).not.toMatch(CODE);
        for (const t of p.tables) for (const c of t.columns) expect(c.label, `${tab} ${c.key}`).toBeTruthy();
      }
    }
  });
  it("an unknown is a dash with a mark, and the mark's sentence is in the legend once", async () => {
    for (const [tab, p] of await all(notCaptured(withLabor(await load(), (l) => laborIn(l, "sales_not_covered")), "sales_not_covered"))) {
      const marks = new Map(p.legend.map((l) => { const m = /^\(([a-z]+)\) (.*)$/.exec(l)!; return [m[1]!, m[2]!]; }));
      expect(new Set(marks.values()).size, tab).toBe(marks.size);
      const dashes = cellsOf(p).filter((c) => c.startsWith("—"));
      expect(dashes.length, tab).toBeGreaterThan(0);
      for (const c of cellsOf(p)) {
        const m = /^(.*?) \(([a-z]+(?:, [a-z]+)*)\)$/.exec(c);
        if (c.startsWith("—")) expect(m, `${tab}: a bare dash "${c}"`).not.toBeNull();
        if (m) for (const mark of m[2]!.split(", ")) expect(marks.has(mark), `${tab}: mark ${mark} of "${c}"`).toBe(true);
      }
    }
  });
  it("estimates: each sentence once in the legend, every affected cell marked", async () => {
    const [, p] = (await all(estimated(await load())))[0]!;
    for (const q of QUALS) expect(p.legend.filter((l) => l.endsWith(q)).length, q).toBe(1);
    const loaded = p.tables[2]!;
    for (const r of loaded.rows) expect(String(r.c3)).toMatch(/^\$[\d,.]+ \([a-z, ]+\)$/);
  });
  it("portrait, seven columns at most, and the tables never split into 'Columns i of n'", async () => {
    for (const [tab, p] of await all(estimated(await load()))) {
      expect(p.layout, tab).toBe("portrait");
      for (const t of p.tables) { expect(t.columns.length, tab).toBeLessThanOrEqual(7); expect(t.fit, tab).toBe(true); expect(t.plain, tab).toBe(true); }
    }
  });
  it("a GM's PDF has no cost column on People and no labor-cost column on Hours", async () => {
    const gm = businessView(await load("gm")), moo = businessView(await load("moo"));
    const cols = (v: typeof gm, tab: "people" | "hours") => businessPdf(tab, v, null, "en").tables[0]!.columns.map((c) => c.label);
    expect(cols(gm, "people")).not.toContain(R("people.cost"));
    expect(cols(moo, "people")).toContain(R("people.cost"));
    expect(cols(gm, "hours")).not.toContain(R("slot.cost"));
    expect(cols(moo, "hours")).toContain(R("slot.cost"));
  });
  it("Spanish: the labels and the legend are Spanish", async () => {
    const [, p] = (await all(estimated(await load()), "es"))[0]!;
    expect(labelsOf(p)).toEqual(expect.arrayContaining([ES["reports.business.pdf.sales"]!, ES["reports.business.detail.hours"]!, ES["reports.business.pdf.loaded_pct"]!]));
    expect(p.legend.some((l) => l.endsWith(ES["reports.business.burden_estimated"]!))).toBe(true);
    expect(labelsOf(p).join(" ")).not.toMatch(/\b(Hours worked|Salaries|Burden)\b/);
  });
  it("a week of the Overview is ONE portrait page (the code-column PDF was 7 landscape pages)", async () => {
    const p = businessPdf("overview", businessView(notCaptured(estimated(await load()), "sales_not_covered")), null, "en");
    const pdf = await renderReportPdf({ title: "Business report", lines: ["Capitol Hill", "2026-10-01 to 2026-10-07"] }, p.tables,
      { pageLabel: (n, total) => `Page ${n} / ${total}`, layout: p.layout, fontSize: 8, compress: false, trailer: [{ heading: "Notes", lines: [...p.legend, ...p.notes] }] });
    const text = pdf.toString("latin1");
    expect(count(text, "/Type /Page\n") + count(text, "/Type /Page ")).toBeLessThanOrEqual(1 + 1);
    expect(text).toMatch(/\/MediaBox \[0 0 612 792\]/);
    expect(text).not.toContain("Columns 1 of");
  });
  it("the renderer's new options leave every other family's PDF as it was: landscape, 7 pt, split when wide", () => {
    const src = readFileSync(path.join(ROOT, "lib/report-pdf.ts"), "utf8");
    expect(src).toContain('layout: options.layout ?? "landscape"');
    expect(src).toContain("const DEFAULT_FONT_SIZE = 7;");
    expect(src).toContain("table.fit ? [natural.map((_, i) => i)] : splitColumns(natural, width, identity)");
  });
});

describe("the legend is one mechanism for the page and the PDF", () => {
  it("the page's marks and the PDF's marks come from figureLegend, and the page reads a figure only through it or figureDisplay", () => {
    const parts = readFileSync(path.join(ROOT, "components/reports-business/BusinessParts.tsx"), "utf8");
    expect(parts).toContain("return figureLegend(language, figures, o);");
    expect(readFileSync(path.join(ROOT, "lib/business-report-pdf.ts"), "utf8")).toContain("legend.cell(c)");
    expect(legendsOf("<ul data-legend=\"\" class=\"x\"><li><span data-mark=\"a\">a</span><span>One</span></li></ul>")).toEqual([new Map([["a", "One"]])]);
  });
});
