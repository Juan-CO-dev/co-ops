import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), service: vi.fn(), pathname: "/reports" }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: mocks.auth }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.service }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, redirect: (path: string) => { throw new Error(path); } }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: async () => false }));
vi.mock("@/lib/reports-hub", async original => ({ ...await original<typeof import("@/lib/reports-hub")>(), listReports: async () => [], listReportSkeleton: async () => [], listReportsPage: async () => ({ items: [], nextCursor: null }) }));
vi.mock("@/lib/written-reports", async original => ({ ...await original<typeof import("@/lib/written-reports")>(), listWrittenReports: async () => ({ reports: [], nextCursor: null }) }));
vi.mock("@/lib/pm-report", async original => ({ ...await original<typeof import("@/lib/pm-report")>(), loadMyFeedback: async () => [] }));
vi.mock("@/lib/team-metrics", async original => ({ ...await original<typeof import("@/lib/team-metrics")>(), loadTeamOperatingHealth: async () => null, loadPersonDetail: async () => null, loadMyPerformance: async () => null }));
vi.mock("@/lib/reports-trends", async original => ({ ...await original<typeof import("@/lib/reports-trends")>(), loadTrendSeries: async () => ({ current: [], previous: null, cashVisible: false, totals: Object.fromEntries(["par", "temps", "cash", "completion"].map(key => [key, { current: 0, delta: null }])) }) }));
import Landing from "@/app/(authed)/reports/page";
import Operations from "@/app/(authed)/reports/operations/page";
import Written from "@/app/(authed)/reports/written/page";
import Trends from "@/app/(authed)/reports/trends/page";
import Ops from "@/app/(authed)/reports/trends/ops/page";
import Team from "@/app/(authed)/reports/trends/team/page";
import Person from "@/app/(authed)/reports/trends/team/[personId]/page";
import Feedback from "@/app/(authed)/my-feedback/page";
import { ReportPageNav } from "@/components/reports-hub/ReportPageNav";
import { ReportShopTabs, ReportShopTabLinks } from "@/components/reports-hub/ReportShopTabs";
import { TrendShopPanels } from "@/components/trends/TrendShopPanels";
import { ReportList } from "@/components/reports-hub/ReportList";

function elements(node: React.ReactNode): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  return [node, ...elements((node.props as { children?: React.ReactNode }).children)];
}
function renderedHref(node: React.ReactNode): URL {
  const html = renderToStaticMarkup(React.createElement(TranslationProvider, { initialLanguage: "en", children: node }));
  return new URL(html.match(/href="([^"]+)"/)![1]!.replaceAll("&amp;", "&"), "https://local");
}

async function navigation(node: React.ReactNode): Promise<React.ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(navigation));
  if (!React.isValidElement(node)) return null;
  if (node.type === ReportPageNav) return node;
  if (node.type === ReportShopTabs) return await ReportShopTabs(node.props as React.ComponentProps<typeof ReportShopTabs>);
  if (node.type === TrendShopPanels) return navigation(await TrendShopPanels(node.props as React.ComponentProps<typeof TrendShopPanels>));
  return navigation((node.props as { children?: React.ReactNode }).children);
}
const pages = [
  ["/reports", Landing], ["/reports/operations", Operations], ["/reports/written", Written],
  ["/reports/trends", Trends], ["/reports/trends/ops", Ops], ["/reports/trends/team", Team],
  ["/reports/trends/team/person", Person], ["/my-feedback", Feedback],
] as const;
const shops = [{ id: "a", name: "Shop A", code: "A" }, { id: "b", name: "Shop B", code: "B" }];
describe("actual report pages expose consistent navigation", () => {
  beforeEach(() => {
    const query = { select: () => query, eq: () => query, order: () => query, in: () => query, then: (resolve: (value: unknown) => unknown) => resolve({ data: shops, error: null }) };
    mocks.service.mockReturnValue({ from: () => query });
  });
  it("round-trips a shop list and cursor through detail before restoring the all-shop hub", async () => {
    mocks.auth.mockResolvedValue({ role: "moo", level: 8, locations: ["a"], user: { id: "viewer", language: "en" } });
    const landing = await Landing({ searchParams: Promise.resolve({ location: "all", cursor: "page2", sf_underPar: "true" }) });
    const href = elements(landing).map(element => (element.props as { href?: string }).href).find(href => href?.startsWith("/reports/operations?"))!;
    const listParams = Object.fromEntries(new URL(href, "https://local").searchParams);
    expect(listParams).toMatchObject({ location: "a", hubLocation: "all", cursor: "page2" });
    expect(listParams.returnLocation).toBeUndefined();
    const list = await Operations({ searchParams: Promise.resolve(listParams) });
    const reportList = elements(list).find(element => element.type === ReportList)!;
    const props = reportList.props as React.ComponentProps<typeof ReportList>;
    const detailUrl = renderedHref(React.createElement(ReportList, { ...props, items: [{ type: "closing", id: "close", locationId: "a", date: "2026-10-06", status: "submitted", submitterName: null }] }));
    expect(detailUrl.searchParams.get("returnLocation")).toBeNull();
    mocks.pathname = detailUrl.pathname;
    const up = renderedHref(React.createElement(ReportPageNav, { path: detailUrl.pathname, params: Object.fromEntries(detailUrl.searchParams), language: "en", viewerLevel: 8 }));
    expect(up.pathname).toBe("/reports/operations");
    expect(up.searchParams.get("location")).toBe("a");
    expect(up.searchParams.get("cursor")).toBe("page2");
    const restoredList = await Operations({ searchParams: Promise.resolve(Object.fromEntries(up.searchParams)) });
    mocks.pathname = up.pathname;
    const restoredNav = elements(restoredList).find(element => element.type === ReportPageNav)!;
    const hub = renderedHref(restoredNav);
    expect(hub.pathname).toBe("/reports");
    expect(hub.searchParams.get("location")).toBe("all");
    expect(hub.searchParams.get("hubLocation")).toBeNull();
    expect(hub.searchParams.get("cursor")).toBe("page2");
  });
  for (const [path, page] of [["/reports/written", Written], ["/my-feedback", Feedback], ["/reports/trends", Trends]] as const) {
    it.each([7, 8])(`${path} consumes hub provenance only for authorized L%s`, async level => {
      mocks.pathname = path;
      mocks.auth.mockResolvedValue({ role: level === 8 ? "moo" : "gm", level, locations: ["a"], user: { id: "viewer", language: "en" } });
      const tree = await page({ searchParams: Promise.resolve({ location: "a", hubLocation: "all", cursor: "page2" }) });
      const up = renderedHref(elements(tree).find(element => element.type === ReportPageNav)!);
      expect(up.pathname).toBe("/reports");
      expect(up.searchParams.get("location")).toBe(level === 8 ? "all" : "a");
      expect(up.searchParams.get("hubLocation")).toBeNull();
    });
  }
  for (const [path, page] of pages) {
    it.each([7, 8])(`${path} renders a different parent, dashboard and authorized tabs at L%s`, async level => {
      mocks.pathname = path;
      mocks.auth.mockResolvedValue({ role: level === 8 ? "moo" : "gm", level, locations: ["a"], user: { id: "viewer", language: "en" } });
      const params = { location: "a", range: "week", cursor: "saved", sf_underPar: "true", returnLocation: "all" };
      const tree = await page({ searchParams: Promise.resolve(params), params: Promise.resolve({ personId: "person" }) });
      const html = renderToStaticMarkup(React.createElement(TranslationProvider, { initialLanguage: "en", children: await navigation(tree) }));
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]!);
      expect(hrefs[0]!.split("?")[0]).not.toBe(path);
      expect(hrefs.some(href => href.startsWith("/dashboard?"))).toBe(true);
      expect(hrefs[0]).toContain("cursor=saved");
      if (level < 8) expect(new URL(hrefs[0]!.replaceAll("&amp;", "&"), "https://local").searchParams.get("location")).not.toBe("all");
      expect(hrefs[0]).toContain("sf_underPar=true");
      expect(html.includes("All shops")).toBe(level >= 8);
      expect(html).toContain('aria-current="page"');
      expect(html).toContain("bg-co-gold");
      expect(html.includes("Shop B")).toBe(level >= 8);
    });
    it(`${path} keeps All shops highlighted in all-shop sections`, async () => {
      mocks.pathname = path;
      mocks.auth.mockResolvedValue({ role: "moo", level: 8, locations: ["a"], user: { id: "viewer", language: "en" } });
      const tree = await page({ searchParams: Promise.resolve({ location: "all" }), params: Promise.resolve({ personId: "person" }) });
      const html = renderToStaticMarkup(React.createElement(TranslationProvider, { initialLanguage: "en", children: await navigation(tree) }));
      const active = html.match(/<a[^>]*aria-current="page"[^>]*>[^<]*<\/a>/g) ?? [];
      expect(active.length).toBeGreaterThan(0);
      expect(active.every(link => link.includes("All shops"))).toBe(true);
    });
  }
  it("shop links preserve filters, range and cursor and normalize the feedback loc alias", () => {
    const html = renderToStaticMarkup(React.createElement(ReportShopTabLinks, { path: "/my-feedback", locationId: "b", language: "en", viewer: { level: 8, locations: [] }, shops, params: { loc: "a", from: "2026-10-01", q: "hello world", cursor: "saved" } }));
    expect(html).toContain("q=hello+world");
    expect(html).toContain("cursor=saved");
    expect(html).not.toContain("?loc=");
    expect(html).toMatch(/<a aria-current="page"[^>]*location=b"/);
  });
});
