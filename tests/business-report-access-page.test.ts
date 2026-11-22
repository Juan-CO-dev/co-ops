// Business report access (plan r5, test 6): THE PAGE. The real page function, the real loader, the real view and
// the real tab components; only the session, the database and the page chrome around the report are stubbed.
//   - gate order: switch, role, shop BY ROLE, then the settings as they are now, then the report;
//   - a GM never opens "All shops"; MoO / Owner / CGS do;
//   - a tab that is not in the viewer's report falls back to Overview and is not in the tab strip;
//   - the tab is judged again on the LOADED report before anything is rendered from it;
//   - the tab strip and the CSV / PDF links of a loaded panel follow the access that report was BUILT with, in both
//     directions of a change between the early read and the load; the early read decides only when nothing loaded.
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ auth: null as unknown, shop: "" }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: vi.fn(async () => session.auth) }));
vi.mock("@/lib/shop-context", () => ({ resolveReportShopId: vi.fn(async () => session.shop) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children: unknown }) => h("a", { href, ...rest }, children as never) };
});
vi.mock("@/components/reports-hub/ReportPageNav", () => ({ ReportPageNav: () => null }));
vi.mock("@/components/reports-hub/ReportShopTabs", () => ({ ReportShopTabs: () => null }));
vi.mock("@/components/reports-hub/ReportRangeForm", async () => {
  const { createElement: h } = await import("react");
  return { ReportRangeForm: ({ children }: { children: unknown }) => h("form", null, children as never) };
});
vi.mock("@/components/reports-export/ExportLinks", async () => {
  const { createElement: h } = await import("react");
  return { ExportLinks: ({ query }: { query: Record<string, string> }) => h("div", { "data-export-links": query.tab ?? "" }, "CSV PDF") };
});
vi.mock("@/components/trends/TrendShopPanels", async () => {
  const { createElement: h } = await import("react");
  return { TrendShopPanels: ({ header }: { header: unknown }) => h("main", { "data-all-shops": "" }, header as never) };
});
vi.mock("@/components/ui/CollapsibleSection", async () => {
  const { createElement: h } = await import("react");
  return { CollapsibleSection: ({ title, count, badge, children }: { title: unknown; count?: unknown; badge?: unknown; children: unknown }) =>
    h("section", null, h("h3", null, title as never), h("span", null, count as never), h("span", null, badge as never), h("div", null, children as never)) };
});
vi.mock("@/components/reports-business/HourDisclosure", async () => {
  const { createElement: h } = await import("react");
  return { HourDisclosure: ({ title, summary, children }: { title: unknown; summary?: unknown; children: unknown }) =>
    h("li", null, h("span", null, title as never), h("span", null, summary as never), h("ul", null, children as never)) };
});

import BusinessReportPage from "@/app/(authed)/reports/business/page";
import en from "@/lib/i18n/en.json";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { GmVisibilityKey } from "@/lib/business-access-shared";
import { A, GM_ALL_ON, VISIBILITY_TABLE, gmOff, type FakeOpts } from "./helpers/business-report-fake";
import { DAY, figuresOf, pricedFake } from "./helpers/business-access-fixture";

const EN = en as Record<string, string>;
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const TABS = ["overview", "hours", "channels", "people", "compare"] as const;
const tabLabel = (t: string) => EN[`reports.business.tab.${t}`]!;
function as(role: string, level: number, locations: string[] = [A]) {
  session.auth = { user: { id: "viewer-1", role, name: "Viewer", language: "en" }, role, level, locations, session: {} };
}
function wire(o: FakeOpts = {}) {
  const f = pricedFake(o, { [DAY]: 1, "2026-10-04": 2 });
  vi.mocked(getServiceRoleClient).mockImplementation(() => f.client);
  return f;
}
const open = async (params: Record<string, string> = {}) => {
  const tree = await BusinessReportPage({ searchParams: Promise.resolve({ location: A, range: "custom", from: DAY, to: DAY, ...params }) });
  return renderToStaticMarkup(tree as ReactElement);
};
const redirected = async (params: Record<string, string> = {}) => (await open(params).then(() => "rendered", (e: Error) => e.message));
/** The tabs the strip offers (the labels of its links). */
const strip = (html: string) => TABS.filter((t) => new RegExp(`<a[^>]*href="[^"]*tab=${t}[^"]*"[^>]*>${tabLabel(t)}</a>`).test(html));
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const off = (k: string) => gmOff(k as GmVisibilityKey);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T16:00:00Z"));
  vi.stubEnv("BUSINESS_REPORT", "1"); vi.stubEnv("FACT_LAYER", "1"); vi.stubEnv("FACT_LAYER_LABOR", "1");
  session.shop = A;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("gates, in order", () => {
  it("dark, or a role that may not read it: the hub, before any read", async () => {
    as("gm", 7);
    vi.stubEnv("BUSINESS_REPORT", "0");
    let f = wire({ visibility: ["throw"] });
    expect(await redirected()).toBe("REDIRECT /reports");
    expect(f.tables.length + f.calls.length).toBe(0);
    vi.stubEnv("BUSINESS_REPORT", "1");
    for (const [role, level] of [["agm", 6], ["social_media_mgr", 6], ["catering_mgr", 6], ["shift_lead", 5]] as const) {
      as(role, level);
      f = wire({ visibility: ["throw"] });
      // Nav spec PR S1: the social media manager is refused by the report family's role rule first (the denial notice).
      expect(await redirected(), role).toBe(role === "social_media_mgr" ? "REDIRECT /dashboard?denied=reports" : "REDIRECT /reports");
      expect(f.tables.length + f.calls.length, role).toBe(0);
    }
  });
  it("the shop is by ROLE: a GM at another shop and a GM asking for All shops go to the hub, before any read", async () => {
    as("gm", 7);
    for (const location of [B, "all"]) {
      const f = wire();
      expect(await redirected({ location }), location).toBe("REDIRECT /reports");
      expect(f.tables.length + f.calls.length, location).toBe(0);
    }
  });
  it("MoO / Owner / CGS open All shops (each shop stacked), and read no settings", async () => {
    for (const [role, level] of [["moo", 8], ["owner", 9], ["cgs", 10]] as const) {
      as(role, level, []);
      const f = wire({ visibility: ["throw"] });
      const html = await open({ location: "all" });
      expect(html).toContain("data-all-shops");
      expect(strip(html)).toEqual([...TABS]);
      expect(f.visibilityReads()).toBe(0);
    }
  });
  it("the report switched off for GMs: the hub, with only the settings read", async () => {
    as("gm", 7);
    const f = wire({ visibility: [gmOff("report")] });
    expect(await redirected()).toBe("REDIRECT /reports");
    expect(f.tables).toEqual([VISIBILITY_TABLE]);
    expect(f.calls).toHaveLength(0);
  });
  it("a settings store that cannot be read: 'not available' with its reason, no report read, no tabs, no downloads", async () => {
    as("gm", 7);
    for (const [answer, code] of [["missing", "business_access_not_installed"], ["error", "business_access_unavailable"], ["throw", "business_access_unavailable"]] as const) {
      const f = wire({ visibility: [answer] });
      const html = await open();
      expect(text(html), answer).toContain(EN[`reports.business.error.${code}`]!);
      expect(strip(html), answer).toEqual([]);
      expect(html, answer).not.toContain("data-export-links");
      expect(f.calls, answer).toHaveLength(0);
    }
  });
});

describe("what a GM's page holds follows the setting", () => {
  it("the defaults: every tab, downloads, hourly labor; no fully loaded labor anywhere on the page", async () => {
    as("gm", 7); wire({ visibility: [null] });
    const html = await open();
    expect(strip(html)).toEqual([...TABS]);
    expect(html).toContain("data-export-links");
    const t = text(html);
    expect(t).toContain(EN["reports.business.card.pure_hourly"]!);
    expect(t).toContain("$1,860.00");
    expect(t).toContain("18.6%");
    for (const w of [EN["reports.business.card.fully_loaded"]!, EN["reports.business.detail.salaried"]!, EN["reports.business.detail.burden"]!, EN["reports.business.loaded.basis"]!,
      "$1,000.00", "$343.20", "$3,203.20", "32%"]) expect(t, w).not.toContain(w);
    // No row of dashes stands in for what is not there.
    expect(t).not.toContain(EN["reports.business.access.not_shared"]!);
  });
  it("hours and sales only: no labor dollar or % on the page, and the hours are still there", async () => {
    as("gm", 7); wire({ visibility: [off("hourly_cost")] });
    const t = text(await open());
    for (const w of ["$1,860.00", "$60.00", "18.6%", EN["reports.business.card.pure_hourly"]!, EN["reports.business.detail.ot_premium"]!, EN["reports.business.labor.denominator"]!]) expect(t, w).not.toContain(w);
    expect(t).toContain(EN["reports.business.card.hours"]!);
    expect(t).toContain("125");
  });
  const dollars = (n: number) => (n / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
  it("everything on: fully loaded labor, each hourly person's cost and the labor dollars per 15 minutes are on the page", async () => {
    as("gm", 7); wire({ visibility: [GM_ALL_ON] });
    const overview = text(await open());
    for (const w of ["$1,000.00", "$343.20", "$3,203.20", "32%"]) expect(overview, w).toContain(w);
    wire({ visibility: [GM_ALL_ON] });
    const people = text(await open({ tab: "people" }));
    const f = figuresOf();
    for (const n of f.people) expect(people).toContain(dollars(n));
    expect(people).not.toContain(EN["reports.business.people.cost_note"]!);
    // The salaried person has no amount: the sentence, never a number.
    expect(people).toContain(EN["reports.business.people.salaried_cost"]!);
    expect(people).not.toContain("$1,000.00");
    wire({ visibility: [GM_ALL_ON] });
    const hours = text(await open({ tab: "hours" }));
    for (const n of f.quarters) expect(hours).toContain(dollars(n));
    expect(hours).not.toContain(EN["reports.business.hours.gm_note"]!);
  });
  it("the defaults (no row): each hourly person's cost and the dollars per 15 minutes are on the page; no salary figure is", async () => {
    as("gm", 7); wire({});
    const people = text(await open({ tab: "people" }));
    const f = figuresOf();
    for (const n of f.people) expect(people).toContain(dollars(n));
    wire({});
    const hours = text(await open({ tab: "hours" }));
    for (const n of f.quarters) expect(hours).toContain(dollars(n));
    wire({});
    const overview = text(await open());
    for (const w of ["$1,000.00", "$343.20", "$3,203.20"]) expect(overview, w).not.toContain(w);
  });
  it("cost per person off / dollars per 15 minutes off (each on its own): that part is gone and the page says it is not included", async () => {
    as("gm", 7); wire({ visibility: [gmOff("person_cost")] });
    const f = figuresOf();
    const people = text(await open({ tab: "people" }));
    for (const n of f.people) expect(people).not.toContain(dollars(n));
    expect(people).toContain(EN["reports.business.people.cost_note"]!);
    wire({ visibility: [gmOff("person_cost")] });
    for (const n of f.quarters) expect(text(await open({ tab: "hours" }))).toContain(dollars(n));
    wire({ visibility: [gmOff("quarter_cost")] });
    const hours = text(await open({ tab: "hours" }));
    for (const n of f.quarters) expect(hours).not.toContain(dollars(n));
    expect(hours).toContain(EN["reports.business.hours.gm_note"]!);
    wire({ visibility: [gmOff("quarter_cost")] });
    for (const n of f.people) expect(text(await open({ tab: "people" }))).toContain(dollars(n));
  });
  it("a tab that is off is not in the strip, and asking for it by URL gives the Overview", async () => {
    as("gm", 7);
    for (const [tab, key] of [["hours", "quarters"], ["channels", "channels"], ["compare", "compare"]] as const) {
      wire({ visibility: [off(key)] });
      const html = await open({ tab });
      expect(strip(html), tab).toEqual(TABS.filter((t) => t !== tab));
      expect(html, tab).toContain(`aria-label="${tabLabel("overview")}"`);
      expect(html, tab).not.toContain(`aria-label="${tabLabel(tab)}"`);
    }
  });
  it("People: hours per person and sales per server are separate switches; the tab is there while either is on", async () => {
    as("gm", 7);
    wire({ visibility: [off("people")] });
    let html = await open({ tab: "people" });
    expect(strip(html)).toContain("people");
    expect(text(html)).toContain(EN["reports.business.people.servers"]!);
    expect(text(html)).not.toContain("Cy"); // the salaried person is only in the people list
    wire({ visibility: [off("servers")] });
    html = await open({ tab: "people" });
    expect(text(html)).toContain("Cy");
    expect(text(html)).not.toContain(EN["reports.business.people.servers"]!);
    wire({ visibility: [gmOff("people", "servers")] });
    html = await open({ tab: "people" });
    expect(strip(html)).not.toContain("people");
    expect(html).toContain(`aria-label="${tabLabel("overview")}"`);
  });
  it("downloads off: no CSV / PDF links, and the page says so", async () => {
    as("gm", 7); wire({ visibility: [off("export")] });
    const html = await open();
    expect(html).not.toContain("data-export-links");
    expect(text(html)).toContain(EN["reports.business.export.off.not_shared"]!);
  });
  it("only MoO / Owner / CGS get the link to the settings", async () => {
    as("gm", 7); wire();
    expect(text(await open())).not.toContain(EN["reports.business.access.settings_link"]!);
    as("moo", 8, []); wire();
    const html = await open();
    expect(html).toMatch(new RegExp(`<a href="/admin/sevenshifts"[^>]*>${EN["reports.business.access.settings_link"]}</a>`));
  });
});

describe("controls follow the access the LOADED report was built with (the settings moved between the two reads)", () => {
  beforeEach(() => as("gm", 7));
  it("downloads ON at the early read, OFF at the loader: the rendered panel has NO download links", async () => {
    wire({ visibility: [GM_ALL_ON, off("export")] });
    const html = await open();
    expect(html).not.toContain("data-export-links");
    expect(text(html)).toContain(EN["reports.business.export.off.not_shared"]!);
  });
  it("downloads OFF at the early read, ON at the loader: the rendered panel HAS them", async () => {
    wire({ visibility: [off("export"), GM_ALL_ON] });
    expect(await open()).toContain("data-export-links");
  });
  it("a tab ON at the early read, OFF at the loader: the panel is the 'not in your view' card, and the strip does not list the tab", async () => {
    for (const [tab, key] of [["hours", "quarters"], ["channels", "channels"], ["compare", "compare"]] as const) {
      wire({ visibility: [GM_ALL_ON, off(key), off(key)] });
      const html = await open({ tab });
      expect(text(html), tab).toContain(EN["reports.business.error.business_tab_off"]!);
      expect(html, tab).not.toContain(`aria-label="${tabLabel(tab)}"`);
      expect(strip(html), tab).toEqual(TABS.filter((t) => t !== tab));
    }
  });
  it("a tab OFF at the early read, ON at the loader: the request was coerced to Overview, and the strip lists the tab again", async () => {
    wire({ visibility: [off("channels"), GM_ALL_ON] });
    const html = await open({ tab: "channels" });
    expect(html).toContain(`aria-label="${tabLabel("overview")}"`);
    expect(strip(html)).toEqual([...TABS]);
  });
  it("fully loaded labor ON at the early read, OFF at the loader: the page is the NARROWER one", async () => {
    wire({ visibility: [GM_ALL_ON, off("loaded")] });
    const t = text(await open());
    for (const w of ["$1,000.00", "$343.20", "$3,203.20"]) expect(t, w).not.toContain(w);
    expect(t).toContain("$1,860.00");
  });
  it("Compare: the settings change between the two periods' loads: a refusal card, never a panel mixing two grants", async () => {
    wire({ visibility: [GM_ALL_ON, GM_ALL_ON, off("loaded")] });
    const html = await open({ tab: "compare" });
    expect(text(html)).toContain(EN["reports.business.error.business_access_changed"]!);
    expect(html).not.toContain(`aria-label="${tabLabel("compare")}"`);
    expect(text(html)).not.toContain("$3,203.20");
  });
  it("nothing loaded (an empty range): the early read decides the controls", async () => {
    wire({ visibility: [off("compare"), GM_ALL_ON] });
    const html = await open({ from: "2026-10-08", to: "2026-10-08" });
    expect(strip(html)).toEqual(TABS.filter((t) => t !== "compare"));
    expect(text(html)).toContain(EN["reports.business.export.off.no_finished_days"]!);
    expect(html).not.toContain("data-export-links");
  });
  it("a load that is refused (the store goes away after the early read): the reason card; the early read decides the strip", async () => {
    wire({ visibility: [GM_ALL_ON, "missing"] });
    const html = await open();
    expect(text(html)).toContain(EN["reports.business.error.business_access_not_installed"]!);
    expect(strip(html)).toEqual([...TABS]);
  });
});

describe("source pins", () => {
  const page = readFileSync("app/(authed)/reports/business/page.tsx", "utf8");
  const exp = readFileSync("lib/report-export.ts", "utf8");
  it("the page: switch and role, shop by role, the early access, then the load, then the surface check, then the view", () => {
    const order = ["businessReportEnabled(process.env)", "businessAllShopsAllowed(auth.role)", "await resolveBusinessAccess(viewer)", "await loadBusinessReport(viewer, { locationId: shopId, range })",
      "assertBusinessSurface(earlier ? [current, earlier] : [current], tab, { download: false })", "businessView(current)"].map((s) => page.indexOf(s));
    expect(order.every((i) => i > -1), JSON.stringify(order)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(page).not.toMatch(/REPORT_ALL_LOCATIONS_LEVEL|canReadScopedReport/); // never by level
    expect(page.match(/businessView\(/g)).toHaveLength(2);
    expect(page).toContain("const access = loaded ?? early;");
    expect(page).toContain("tabs={businessTabsFor(access)}");
  });
  it("the export: the early check before the empty-range answer, and the surface check after every load, before the view", () => {
    const body = exp.slice(exp.indexOf("async function businessExportTable"), exp.indexOf("/** Bounded like every hub list"));
    const order = ["assertBusinessSurface([{ access: await resolveBusinessAccess(viewer) }], tab, { download: true })", 'if (request.kind === "empty")',
      "await loadBusinessReport(viewer, { locationId: shop.id, range })", "assertBusinessSurface(earlier ? [current, earlier] : [current], tab, { download: true })", "businessView(current)"]
      .map((s) => body.indexOf(s));
    expect(order.every((i) => i > -1), JSON.stringify(order)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(body.match(/loadBusinessReport\(/g)).toHaveLength(2);
    expect(body.match(/businessView\(/g)).toHaveLength(2);
  });
  it("the loader takes no access argument, resolves it itself before any report read, and cuts LAST", () => {
    const src = readFileSync("lib/business-report.ts", "utf8");
    expect(src).toMatch(/export async function loadBusinessReport\(viewer: BusinessViewer, args: \{ locationId: string; range: BusinessRange \}, deps: BusinessDeps = \{\}\)/);
    const body = src.slice(src.lastIndexOf("export async function loadBusinessReport("));
    expect(body.indexOf("await resolveBusinessAccess(viewer, { client: sb, env })")).toBeGreaterThan(-1);
    expect(body.indexOf("await resolveBusinessAccess(viewer, { client: sb, env })")).toBeLessThan(body.indexOf("readWeekCoverage()"));
    expect(body.trimEnd().endsWith("return redactBusinessDto(dto, access);\n}")).toBe(true);
    expect(src.match(/redactBusinessDto\(/g)).toHaveLength(1);
  });
});
