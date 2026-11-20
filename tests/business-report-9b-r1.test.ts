// Item 9b fix round 1 (review ITEM9B-r1, four P2s + the sweep). Failing-first. THE RULE: an unknown is never a
// plain number. Partial hours never compare; missing sales are a dash with a reason, never $0.00; a total that
// holds checks of unknown amount reads "at least $X + N unknown"; an export that leaves days out says so.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
// Drawers render closed on the server; open every one so the test sees what a tap would show.
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
const pdfHeaders: string[][] = [];
const pdfTrailers: string[][] = [];
vi.mock("@/lib/report-pdf", async (orig) => {
  const real = await orig<typeof import("@/lib/report-pdf")>();
  return { ...real, renderReportPdf: vi.fn(async (header: { lines: string[] }, tables: unknown, options: { trailer?: Array<{ lines: string[] }> }) => {
    pdfHeaders.push(header.lines);
    pdfTrailers.push((options.trailer ?? []).flatMap((b) => b.lines));
    return (real.renderReportPdf as (...a: unknown[]) => Promise<Buffer>)(header, tables, options);
  }) };
});

import { GET } from "@/app/api/reports/export/route";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadBusinessReport, type WholeBusinessReportDto as BusinessReportDto } from "@/lib/business-report";
import { breakdownCoverage, laborHoursComplete, resolveBusinessRange, type LaborFigures } from "@/lib/business-report-shared";
// Fix round 4: the page and the export take the VIEW; these adapters build it from a DTO as the page does.
import {
  BusinessChannels, BusinessCompare, BusinessHours, BusinessOverview, BusinessPeople,
  businessChannelRows, businessHoursRows, businessOverviewRows, businessPeopleRows,
} from "./helpers/business-report-views";
import { A, fakeClient } from "./helpers/business-report-fake";
import { assertMarksResolve, legendsOf, markedFigures } from "./helpers/business-report-states";

const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const moo = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
const SHOP = { id: A, code: "MEP", name: "Capitol Hill" };
const range = resolveBusinessRange({ range: "custom", from: "2026-10-01", to: "2026-10-07" }, "2026-10-08");
const load = async (client = fakeClient().client) => loadBusinessReport(moo, { locationId: A, range }, { client, env: ON });
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
/** One `<li>` of the Compare list by its label. */
const compareRow = (markup: string, label: string) => markup.split("<li").find((s) => s.includes(`>${label}</div>`)) ?? "";
const unbuilt = (l: LaborFigures): LaborFigures => ({ ...l, state: "unbuilt", loadedState: "unbuilt", minutes: 300, pct: null, loadedPct: null,
  pureHourlyCents: null, otPremiumCents: null, otMinutes: null });
const unbuiltTotal = (d: BusinessReportDto): BusinessReportDto => ({ ...d, total: { ...d.total, labor: unbuilt(d.total.labor) },
  weeks: d.weeks.map((w, i) => (i === d.weeks.length - 1 ? { ...w, labor: unbuilt(w.labor) } : w)) });

describe("shared rules", () => {
  it("hours are final only when every week behind them is built, ready and known", () => {
    for (const s of ["unbuilt", "rebuilding", "before_history", "hours_unknown"] as const) expect(laborHoursComplete(s), s).toBe(false);
    for (const s of ["ok", "zero_sales", "sales_not_covered", "net_unknown", "ezcater_missing"] as const) expect(laborHoursComplete(s), s).toBe(true);
  });
  it("breakdown coverage counts the days whose cuts recomposed", () => {
    expect(breakdownCoverage([{ cuts: "ok" }, { cuts: "rebuilding" }, { cuts: "sales_not_covered" }])).toEqual({ state: "partial", included: 1, expected: 3, excluded: 2 });
    expect(breakdownCoverage([{ cuts: "ok" }])).toEqual({ state: "complete", included: 1, expected: 1, excluded: 0 });
    expect(breakdownCoverage([{ cuts: "rebuilding" }])).toEqual({ state: "none", included: 0, expected: 1, excluded: 1 });
  });
});

describe("P2-1: Compare with partial hours", () => {
  it("a range with one unbuilt week shows hours 'so far' and no change", async () => {
    const prev = await load();
    // Two payroll weeks, the second unbuilt: the total keeps the first week's minutes and is `unbuilt`.
    const dto = unbuiltTotal(prev);
    expect(prev.total.labor.state).toBe("ok");
    const row = compareRow(html(createElement(BusinessCompare, { dto, previous: prev, language: "en" })), "Labor hours");
    expect(row).toContain("so far");
    expect(row).not.toMatch(/[+-]?\d+%/);
    expect(row).toContain("Not comparable");
  });
});

describe("P2-3: missing sales are a dash with a reason, never $0.00", () => {
  it("Compare: a previous period before captured history", async () => {
    const dto = await load();
    const prev: BusinessReportDto = { ...dto, days: dto.days.map((d) => ({ ...d, sales: { ...d.sales, coverage: "missing" as const, totalCents: 0 } })),
      total: { ...dto.total, sales: { ...dto.total.sales, coverage: "missing", totalCents: 0 } } };
    const row = compareRow(html(createElement(BusinessCompare, { dto, previous: prev, language: "en" })), "Sales before refunds");
    expect(row).not.toContain("$0.00");
    expect(row).toContain("No sales were captured");
  });
  it("Compare and Overview: partial sales are labelled as covered days only", async () => {
    const dto = await load();
    const partial: BusinessReportDto = { ...dto, total: { ...dto.total, sales: { ...dto.total.sales, coverage: "partial" } } };
    expect(compareRow(html(createElement(BusinessCompare, { dto: partial, previous: dto, language: "en" })), "Sales before refunds")).toContain("covered days only");
    expect(html(createElement(BusinessOverview, { dto: partial, language: "en" }))).toContain("covered days only");
  });
});

describe("P2-4: amounts with unknown-amount checks are qualified", () => {
  it("channels, servers, ezCater and exclusions read 'at least ... + N unknown'; all-unknown is never $0", async () => {
    const dto = await load();
    const q: BusinessReportDto = {
      ...dto,
      days: dto.days.map((d, i) => (i === 0 ? { ...d, sales: { ...d.sales, ezcaterMissing: 1 } } : d)),
      channels: { included: [{ key: "dine_in", provider: null, cents: 2_000, checks: 2, amountMissing: 1 }, { key: "online", provider: null, cents: 0, checks: 2, amountMissing: 2 }],
        excluded: [{ key: "gift_card", cents: 500, checks: 2, amountMissing: 1 }] },
      servers: [{ key: "srv-1", label: "Ana", cents: 2_000, checks: 2, amountMissing: 1 }],
    };
    const ch = html(createElement(BusinessChannels, { dto: q, language: "en" }));

    expect(ch).toContain("at least $20.00 + 1 unknown");
    expect(ch).toContain("at least $5.00 + 1 unknown");
    expect(ch).toMatch(/at least \$[\d,.]+ \+ 1 unknown/);
    expect(ch).toContain("amount unknown (2 checks)");
    expect(ch).not.toContain("$0.00");
    expect(html(createElement(BusinessPeople, { dto: q, language: "en" }))).toContain("at least $20.00 + 1 unknown");
    expect(html(createElement(BusinessOverview, { dto: q, language: "en" }))).toMatch(/at least \$[\d,.]+ \+ 1 unknown/);
  });
  it("Hours: a quarter and the unassigned line with unknown amounts are qualified", async () => {
    const dto = await load();
    const q: BusinessReportDto = { ...dto,
      quarters: dto.quarters!.map((x, i) => (i === 0 ? { ...x, checks: 2, toastCents: 1_000, amountMissing: 1 } : x)),
      quartersUnassigned: [{ date: dto.days[0]!.date, toastCents: 700, checks: 2, amountMissing: 1 }] };
    const out = html(createElement(BusinessHours, { dto: q, language: "en" }));
    expect(out).toContain("at least $10.00 + 1 unknown");
    expect(out).toContain("at least $7.00 + 1 unknown");
  });
});

describe("sweep: drawers and overview show partial hours as partial", () => {
  it("the Overview hours card and the week drawer say 'so far' for an unbuilt span", async () => {
    const out = html(createElement(BusinessOverview, { dto: unbuiltTotal(await load()), language: "en" }));
    // the card, the week's summary line is unchanged (no hours there), and the week drawer's hours line
    expect(out.match(/so far/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("sweep: unbuilt labor is unknown, not zero, on Hours and People", () => {
  it("Hours: a quarter of an unbuilt day with no minutes is a dash with the reason, never 'No labor'", async () => {
    const dto = await load();
    const day = dto.days[0]!;
    const q: BusinessReportDto = { ...dto, days: dto.days.map((d, i) => (i === 0 ? { ...d, labor: unbuilt(d.labor) } : d)),
      quarters: dto.quarters!.map((x) => (x.date === day.date ? { ...x, laborMinutes: null } : x)) };
    const out = html(createElement(BusinessHours, { dto: q, language: "en" }));
    // The day's own drawer (the piece that holds its hour rows; the list's notes on top say the sentence too).
    const section = out.split("<section").find((s) => s.includes(">Labor for these days is not counted yet.<") && s.includes("data-hour")) ?? "";
    expect(section).not.toContain("No labor");
    // Fix round 2: the reason is VISIBLE text (not an attribute). Polish (marker + legend form): it is written ONCE
    // in the day's notes, and every figure it explains (the day's hours, each hour's and quarter's labor) shows its
    // mark and carries the sentence for a screen reader; every mark is proved against the notes.
    const REASON = "Labor for these days is not counted yet.";
    assertMarksResolve(section);
    expect(legendsOf(section).some((l) => [...l.values()].includes(REASON))).toBe(true);
    expect(markedFigures(section).filter((f) => f.said.includes(REASON)).length).toBeGreaterThanOrEqual(2);
  });
  it("People: the per-person hours say 'so far' while a week is not final; the export coverage row names the labor state", async () => {
    const dto = unbuiltTotal(await load());
    expect(html(createElement(BusinessPeople, { dto, language: "en" }))).toContain("Hours per person are so far only.");
    expect(businessPeopleRows(dto, SHOP)[0]).toMatchObject({ row_type: "coverage", labor_state: "unbuilt" });
  });
});

describe("P2-2: exports say which days a breakdown covers", () => {
  const withRebuilding = async () => {
    const dto = await load();
    return { ...dto, days: dto.days.map((d, i) => (i === 2 ? { ...d, cuts: "rebuilding" as const } : d)) };
  };
  it("channels and people tabs open with a coverage row (status, days included, days in the period)", async () => {
    const dto = await withRebuilding();
    for (const rows of [businessChannelRows(dto, SHOP), businessPeopleRows(dto, SHOP)]) {
      expect(rows[0]).toMatchObject({ row_type: "coverage", status: "partial", days_included: 6, days_in_period: 7 });
    }
    const full = await load();
    expect(businessChannelRows(full, SHOP)[0]).toMatchObject({ row_type: "coverage", status: "complete", days_included: 7, days_in_period: 7 });
  });
  it("amounts carry their unknown count everywhere (excluded rows, unassigned, overview)", async () => {
    const dto = await load();
    const q: BusinessReportDto = { ...dto, channels: { ...dto.channels, excluded: [{ key: "gift_card", cents: 500, checks: 2, amountMissing: 1 }] },
      quartersUnassigned: [{ date: dto.days[0]!.date, toastCents: 700, checks: 2, amountMissing: 1 }],
      days: dto.days.map((d, i) => (i === 0 ? { ...d, sales: { ...d.sales, toastAmountMissing: 2, ezcaterMissing: 1 } } : d)) };
    expect(businessChannelRows(q, SHOP).find((r) => r.row_type === "excluded")).toMatchObject({ amount_missing: 1 });
    expect(businessHoursRows(q, SHOP).find((r) => r.row_type === "unassigned")).toMatchObject({ amount_missing: 1 });
    const ov = businessOverviewRows(q, SHOP);
    expect(ov[0]).toMatchObject({ amount_missing: 3 });
    expect(ov.find((r) => r.row_type === "total")).toMatchObject({ amount_missing: 3, breakdown_state: "ok" });
  });
  it("the overview total names a partial breakdown (its large checks cover the recomposed days only)", async () => {
    const ov = businessOverviewRows(await withRebuilding(), SHOP);
    expect(ov.find((r) => r.row_type === "total")).toMatchObject({ breakdown_state: "partial" });
  });

  describe("through the route (CSV and PDF)", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-08T16:00:00Z"));
      vi.stubEnv("BUSINESS_REPORT", "1"); vi.stubEnv("FACT_LAYER", "1"); vi.stubEnv("FACT_LAYER_LABOR", "1");
      vi.mocked(requireSession).mockResolvedValue({ user: { id: "v", role: "moo", name: "V", language: "en" }, role: "moo", level: 8, locations: [], session: {} } as never);
      // 2026-10-03's cuts never arrive: that day is rebuilding, six of seven recompose.
      const biz = fakeClient({ rpcRows: { business_report_check_cuts: (args) => {
        const days: string[] = [];
        for (let t = Date.parse(`${String(args.p_from)}T00:00:00Z`); t <= Date.parse(`${String(args.p_to)}T00:00:00Z`); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
        return days.filter((d) => d !== "2026-10-03").flatMap((d) => [
          { business_date: d, quarter_start_at: `${d}T16:00:00.000Z`, wall_quarter: 48, fold: 0, et_date: d, channel: "dine_in", provider: null,
            server_guid: "srv-1", server_label: "Ana", sale_class: "sale", checks: 2, amount_cents: 3_000, amount_missing: 0, large_checks: 0, large_cents: 0 }]);
      } } });
      const shopQ = { select: () => shopQ, eq: () => shopQ, maybeSingle: async () => ({ data: SHOP, error: null }) };
      vi.mocked(getServiceRoleClient).mockImplementation(() => ({
        rpc: (...a: unknown[]) => (biz.client as { rpc: (...x: unknown[]) => unknown }).rpc(...a),
        from: (t: string) => (t === "locations" ? shopQ : (biz.client as { from: (x: string) => unknown }).from(t)),
      }) as never);
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
    const get = (q: string) => GET(new NextRequest(`https://example.test/api/reports/export?family=business&location=${A}&range=custom&from=2026-10-01&to=2026-10-07&${q}`));

    // Polish (2026-11-18): line 1 of the CSV is the HEADER ROW (Excel / Sheets). The notice is still in the file,
    // AFTER the table (a blank line, "Notes", the sentence), and it is the TAB's own sentence.
    it("CSV: the header row first, a coverage row naming 6 of 7 days, and the notice in the notes block after the table", async () => {
      for (const [tab, what] of [["channels", "Channels cover 6 of 7 days"], ["people", "Sales by server cover 6 of 7 days"]] as const) {
        const text = (await (await get(`format=csv&tab=${tab}`)).text()).replace(/^﻿/, "");
        const lines = text.trim().split("\r\n");
        expect(lines[0]!.startsWith("row_type,"), tab).toBe(true);
        expect(lines[1]!.startsWith("coverage,"), tab).toBe(true);
        expect(lines[1], tab).toContain("partial");
        const blank = lines.indexOf("");
        expect(blank, tab).toBeGreaterThan(1);
        expect(lines[blank + 1], tab).toBe("Notes");
        expect(lines.slice(blank + 2).join("\n"), tab).toContain(what);
        // Nothing but the notes follows the blank line, and no table row follows them.
        expect(lines.slice(blank + 1).every((l) => !/^(coverage|channel|person|server|ezcater|excluded),/.test(l)), tab).toBe(true);
      }
    });
    it("CSV: the notice names what THIS file holds (an Overview or People file never talks about channels)", async () => {
      const text = async (tab: string) => (await (await get(`format=csv&tab=${tab}`)).text());
      expect(await text("overview")).toContain("Large checks and rushes are counted on 6 of 7 days");
      expect(await text("overview")).not.toMatch(/[Cc]hannels/);
      expect(await text("people")).not.toMatch(/Channels (and servers )?cover/);
      expect(await text("hours")).toContain("Checks and sales by time are filled for 6 of 7 days");
    });
    it("PDF: the notice is in the Notes block under the tables (never cut to one header line)", async () => {
      pdfHeaders.length = 0; pdfTrailers.length = 0;
      const r = await get("format=pdf&tab=channels");
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("application/pdf");
      expect(pdfTrailers[0]!.some((l) => /Channels cover 6 of 7 days/.test(l))).toBe(true);
      expect(pdfHeaders[0]!.some((l) => /6 of 7 days/.test(l))).toBe(false);
    });
  });
});
