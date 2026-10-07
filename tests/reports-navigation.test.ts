import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parentFor, resolveBackLink } from "@/lib/nav-parents";
import { TranslationProvider } from "@/lib/i18n/provider";
import { BackLink } from "@/components/nav/BackLink";
import { DashboardBackLink } from "@/components/DashboardBackLink";
import { ReportList } from "@/components/reports-hub/ReportList";
import type { ReportListItem } from "@/lib/reports-hub";

const route = vi.hoisted(() => ({ path: "/reports" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.path }));

const routes = [
  ["/reports", "/dashboard"],
  ["/reports/operations", "/reports"],
  ["/reports/written", "/reports"],
  ["/reports/written/example", "/reports/written"],
  ["/reports/trends", "/reports"],
  ["/reports/trends/ops", "/reports/trends"],
  ["/reports/trends/team", "/reports/trends"],
  ["/reports/trends/team/person", "/reports/trends/team"],
  ["/my-feedback", "/reports"],
  ...["opening", "am_prep", "mid_day", "closing", "cash", "pm", "maintenance"]
    .map(type => [`/reports/${type}/example`, "/reports/operations"] as const),
] as const;

describe("reports parent hierarchy", () => {
  it.each(routes)("%s goes up to %s without a cycle", (path, parent) => {
    expect(parentFor(path).href).toBe(parent);
    const visited = new Set<string>();
    let current: string = path;
    while (current !== "/dashboard") {
      expect(visited.has(current)).toBe(false);
      visited.add(current);
      const next = parentFor(current).href;
      expect(next).not.toBe(current);
      current = next;
    }
  });

  it.each(routes)("renders %s back link to a different page", (path, parent) => {
    route.path = path;
    const html = renderToStaticMarkup(React.createElement(TranslationProvider, {
      initialLanguage: "en",
      children: React.createElement(BackLink, { search: "?location=shop&range=last7&cursor=page2&q=milk" }),
    }));
    const href = html.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
    expect(href).toBeDefined();
    const url = new URL(href!, "http://local");
    expect(url.pathname).toBe(parent);
    expect(url.pathname).not.toBe(path);
    expect(url.searchParams.get("cursor")).toBe("page2");
    expect(url.searchParams.get("q")).toBe("milk");
  });

  it("refuses a same-page override, including query-only changes", () => {
    expect(resolveBackLink("/reports/operations", {
      hrefOverride: "/reports/operations/?location=other", labelKey: "reports.hub.operations",
      search: "?location=shop",
    })).toEqual({ href: "/reports?location=shop", labelKey: "reports.page.title" });
  });

  it("merges search into an override without producing two question marks", () => {
    expect(resolveBackLink("/reports/closing/id", {
      hrefOverride: "/reports/operations?location=shop&cursor=page2",
      search: "?range=last7",
    }).href).toBe("/reports/operations?location=shop&cursor=page2&range=last7");
  });

  it.each(["en", "es"] as const)("labels Dashboard in %s with a 44px target", language => {
    route.path = "/reports/closing/id";
    const html = renderToStaticMarkup(React.createElement(TranslationProvider, {
      initialLanguage: language, children: React.createElement(DashboardBackLink),
    }));
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("min-h-[44px]");
    expect(html).not.toContain("nav.dashboard");
  });
});

it("report rows carry the all-shop return scope, filters and per-shop cursors into details", () => {
  const item: ReportListItem = {
    type: "closing", id: "close", locationId: "shop", date: "2026-10-06",
    status: "submitted", submitterName: null,
  };
  const html = renderToStaticMarkup(React.createElement(ReportList, {
    items: [item], locationId: "shop", viewerLevel: 8, language: "en",
    context: "location=all&range=last7&type=closing&sf_skipped=true&cursor_shop=page2",
  }));
  const href = html.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  const url = new URL(href!, "http://local");
  expect(url.pathname).toBe("/reports/closing/close");
  expect(url.searchParams.get("location")).toBe("shop");
  expect(url.searchParams.get("returnLocation")).toBe("all");
  expect(url.searchParams.get("cursor_shop")).toBe("page2");
  expect(url.searchParams.get("sf_skipped")).toBe("true");
});
