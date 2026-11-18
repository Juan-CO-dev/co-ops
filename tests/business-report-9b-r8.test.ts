// Item 9b fix round 8 (review ITEM9B-r8), failing-first.
//  P2  "No rushes" is an empty claim, and the rush detector only sees checks with an opened time. A day with
//      checks that have NO time was declared "No rushes" with no evidence of when those checks happened. Now the
//      checks it could not place are COUNTED and block the claim ("{n} checks have no time — rushes unknown"), on
//      the page and in the file; a baseline day with untimed checks is left out of the usual, and said so.
// Then the same rule on every other aggregate that filters its input: "Not counted as sales" listed only gift cards
// and ezCater-linked rings, so a range whose only non-sales were voided checks said "Nothing excluded".
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

import { loadBusinessReport } from "@/lib/business-report";
import { channelTotals, detectRushes, resolveBusinessRange, type CutRow, type QuarterPoint } from "@/lib/business-report-shared";
import { A, fakeClient, type FakeOpts } from "./helpers/business-report-fake";
import { EN, visibleText } from "./helpers/business-report-states";
import { BusinessChannels, BusinessHours, businessChannelRows, businessOverviewRows } from "./helpers/business-report-views";

const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const SHOP = { id: A, code: "MEP", name: "Capitol Hill" };
const moo = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };
const range = resolveBusinessRange({ range: "custom", from: "2026-10-01", to: "2026-10-07" }, "2026-10-08");
const loadWith = (o: FakeOpts = {}) => loadBusinessReport(moo, { locationId: A, range }, { client: fakeClient(o).client, env: ON });
const text = (el: Parameters<typeof renderToStaticMarkup>[0]) => visibleText(renderToStaticMarkup(el));
const R = (k: string, v: Record<string, string | number> = {}) => {
  let s = EN[`reports.business.${k}`] ?? `<<reports.business.${k} is not translated>>`;
  for (const [a, b] of Object.entries(v)) s = s.split(`{${a}}`).join(String(b));
  return s;
};
const count = (t: string, s: string) => t.split(s).length - 1;
const X = "2026-10-03";

const datesOf = (a: Record<string, unknown>) => {
  const out: string[] = [];
  for (let t = Date.parse(`${a.p_from}T00:00:00Z`); t <= Date.parse(`${a.p_to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
/** The fake's two checks a day (1 x $10 at 12:00, 1 x $20 at 12:15); `bend` reshapes one date's rows. */
const cuts = (bend: (d: string, rows: Array<Record<string, unknown>>) => Array<Record<string, unknown>>) => ({ business_report_check_cuts: (a: Record<string, unknown>) =>
  datesOf(a).flatMap((d) => bend(d, [
    { business_date: d, quarter_start_at: `${d}T16:00:00.000Z`, wall_quarter: 48, fold: 0, et_date: d, channel: "dine_in", provider: null,
      server_guid: "srv-1", server_label: "Ana", sale_class: "sale", checks: 1, amount_cents: 1_000, amount_missing: 0, large_checks: 0, large_cents: 0 },
    { business_date: d, quarter_start_at: `${d}T16:15:00.000Z`, wall_quarter: 49, fold: 0, et_date: d, channel: "online", provider: null,
      server_guid: null, server_label: null, sale_class: "sale", checks: 1, amount_cents: 2_000, amount_missing: 0, large_checks: 0, large_cents: 0 },
  ])) });
/** The 12:15 check of `on` has no opened time (no quarter). */
const untimedOn = (on: (d: string) => boolean) => cuts((d, rows) => on(d)
  ? [rows[0]!, { ...rows[1]!, quarter_start_at: null, wall_quarter: null, fold: null, et_date: null }] : rows);

const q = (wq: number, checks: number, cents: number): QuarterPoint =>
  ({ quarterStartAt: new Date(Date.parse("2026-10-07T04:00:00Z") + wq * 900_000).toISOString(), wallQuarter: wq, fold: 0, checks, cents });
const hist = (n: number, untimed = 0) => Array.from({ length: n }, (_, i) => ({ date: `2026-0${i < 4 ? 9 : 8}-${String(28 - i).padStart(2, "0")}`, quarters: [q(46, 6, 12_000)], untimed: i === 0 ? untimed : 0 }));

describe("ITEM9B-r8 P2: checks with no time block 'No rushes'", () => {
  it("the detector counts today's untimed checks and leaves a baseline day with untimed checks out of the usual", () => {
    const clean = detectRushes({ date: "2026-10-07", quarters: [q(46, 5, 10_000)] }, hist(8));
    expect(clean).toMatchObject({ state: "ok", windows: [], uncompared: 0, untimed: 0, baselineUntimed: 0 });
    const today = detectRushes({ date: "2026-10-07", quarters: [], untimed: 100 }, hist(8));
    expect(today).toMatchObject({ state: "ok", windows: [], untimed: 100 });
    const base = detectRushes({ date: "2026-10-07", quarters: [q(46, 5, 10_000)] }, hist(8, 3));
    expect(base).toMatchObject({ state: "ok", untimed: 0, baselineUntimed: 1 });
    // Leaving the untimed day out can leave too little history: then it is "not enough history", never a baseline over it.
    expect(detectRushes({ date: "2026-10-07", quarters: [q(46, 5, 10_000)] }, hist(4, 3))).toMatchObject({ state: "not_enough_history", baselineUntimed: 1 });
  });

  it("loader -> page: a day with a check that has no time says '<n> checks have no time — rushes unknown', never 'No rushes'", async () => {
    const dto = await loadWith({ rpcRows: untimedOn((d) => d === X) });
    const day = dto.days.find((d) => d.date === X)!;
    expect(day.cuts).toBe("ok");
    expect(day.rush).toMatchObject({ state: "ok", windows: [], untimed: 1 });
    const t = text(createElement(BusinessHours, { dto, language: "en" }));
    expect(count(t, R("rush.none"))).toBe(dto.days.length - 1);
    expect(t).toContain(R("rush.untimed_unknown", { n: 1 }));
  });

  it("loader -> export: that day's rushes cell is empty and its figure_notes say why", async () => {
    const dto = await loadWith({ rpcRows: untimedOn((d) => d === X) });
    const row = businessOverviewRows(dto, SHOP).find((x) => x.row_type === "day" && x.period_start === X)!;
    expect(row.rushes).toBeNull();
    expect(String(row.figure_notes)).toContain("rushes=unknown(untimed_unknown)");
    const other = businessOverviewRows(dto, SHOP).find((x) => x.row_type === "day" && x.period_start === "2026-10-04")!;
    expect(other.rushes).toBe(0);
  });

  it("a rush found beside untimed checks is a floor: shown, incomplete, 'there may be more'", async () => {
    const { businessView } = await import("@/lib/business-view-shared");
    const dto = await loadWith({ rpcRows: untimedOn((d) => d === X) });
    const w = { startAt: `${X}T16:00:00.000Z`, endAt: `${X}T16:30:00.000Z`, quarters: 2, checks: 8, cents: 40_000, baselineChecks: 2, baselineCents: 4_000 };
    const bent = { ...dto, days: dto.days.map((d) => (d.date === X ? { ...d, rush: { ...d.rush!, windows: [w] } } : d)) };
    const v = businessView(bent).days.find((d) => d.date === X)!;
    expect(v.rush?.any).toBe(true);
    expect(v.rush?.none).toBe(false);
    const t = text(createElement(BusinessHours, { dto: bent, language: "en" }));
    expect(t).toContain(R("rush.untimed_more", { n: 1 }));
    const row = businessOverviewRows(bent, SHOP).find((x) => x.row_type === "day" && x.period_start === X)!;
    expect(row.rushes).toBe(1);
    expect(String(row.figure_notes)).toContain("rushes=incomplete(untimed_more)");
  });

  it("loader -> page: a baseline day with untimed checks is left out of the usual, and the day says so", async () => {
    // 2026-09-26 is the same weekday as X, one week earlier: one of X's eight baseline days.
    const dto = await loadWith({ rpcRows: untimedOn((d) => d === "2026-09-26") });
    const day = dto.days.find((d) => d.date === X)!;
    expect(day.rush).toMatchObject({ state: "ok", untimed: 0, baselineUntimed: 1 });
    const t = text(createElement(BusinessHours, { dto, language: "en" }));
    expect(t).toContain(R("rush.baseline_untimed", { n: 1 }));
    const row = businessOverviewRows(dto, SHOP).find((x) => x.row_type === "day" && x.period_start === X)!;
    expect(String(row.figure_notes)).toContain("rushes=estimated(baseline_untimed)");
  });
});

describe("ITEM9B-r8 sweep: 'Not counted as sales' lists every check that is not a sale", () => {
  const row = (sale_class: string, checks = 1, amount_cents = 500): CutRow => ({
    business_date: X, quarter_start_at: null, wall_quarter: null, fold: null, et_date: null, channel: "dine_in", provider: null,
    server_guid: null, server_label: null, sale_class, checks, amount_cents, amount_missing: 0, large_checks: 0, large_cents: 0,
  } as unknown as CutRow);
  it("channelTotals: voided and excess-food checks are excluded rows, never dropped", () => {
    const t = channelTotals([row("sale"), row("void", 2, 700), row("excess_food", 1, 300), row("gift_card")]);
    expect(t.excluded.map((c) => c.key).sort()).toEqual(["excess_food", "gift_card", "void"]);
    expect(t.excluded.find((c) => c.key === "void")).toMatchObject({ checks: 2, cents: 700 });
  });
  it("loader -> page + export: a range whose only non-sale is a voided check never says 'Nothing excluded'", async () => {
    const dto = await loadWith({ rpcRows: cuts((d, rows) => (d === X ? [...rows, { ...rows[0]!, sale_class: "void", amount_cents: 700 }] : rows)) });
    const t = text(createElement(BusinessChannels, { dto, language: "en" }));
    expect(t).not.toContain(R("channels.excluded_none"));
    expect(t).toContain(R("channels.excluded.void"));
    const rows = businessChannelRows(dto, SHOP).filter((r) => r.row_type === "excluded");
    expect(rows.map((r) => r.channel)).toContain("void");
  });
});
