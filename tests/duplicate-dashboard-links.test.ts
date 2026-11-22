/* eslint-disable react/no-children-prop -- the render wraps the element in the translation provider */
/**
 * Nav PR 9, D5 (plan r2 3.4; spec 4.4; lead ruling r1 Q6): the two duplicate "Dashboard" links the top bar supersedes
 * are gone. A report page links to /dashboard exactly once, and only when the Dashboard IS its parent (the back link);
 * /assignments draws no hand-made Dashboard link (the bar's bare /dashboard keeps the shop through the remembered shop).
 */
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/reports/operations", useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { ReportPageNav } from "@/components/reports-hub/ReportPageNav";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const hrefs = (node: React.ReactNode) => [...renderToStaticMarkup(React.createElement(TranslationProvider, { initialLanguage: "en", children: node }))
  .matchAll(/href="([^"]+)"/g)].map((m) => new URL(m[1]!.replaceAll("&amp;", "&"), "https://local"));

describe("ReportPageNav", () => {
  it("a page whose parent is NOT the Dashboard: no /dashboard link at all", () => {
    const links = hrefs(React.createElement(ReportPageNav, { path: "/reports/operations", params: { location: "a" }, language: "en", viewerLevel: 8 }));
    expect(links).toHaveLength(1);
    expect(links[0]!.pathname).not.toBe("/dashboard");
    expect(links.filter((l) => l.pathname === "/dashboard")).toEqual([]);
  });
  it("a page whose parent IS the Dashboard: exactly one /dashboard link, the back link", () => {
    const links = hrefs(React.createElement(ReportPageNav, { path: "/my-feedback", params: { location: "a" }, language: "en", viewerLevel: 1 }));
    expect(links.filter((l) => l.pathname === "/dashboard")).toHaveLength(1);
    expect(links).toHaveLength(1);
  });
  it("source: no second Link, no serverT(nav.dashboard)", () => {
    const src = readFileSync("components/reports-hub/ReportPageNav.tsx", "utf8");
    expect(src).not.toMatch(/import Link from "next\/link"/);
    expect(src).not.toContain('serverT(language, "nav.dashboard")');
  });
});

describe("/assignments", () => {
  it("renders no hand-made Dashboard link; its key is retired in both languages", () => {
    const src = readFileSync("app/(authed)/assignments/page.tsx", "utf8");
    expect(src).not.toMatch(/href=\{`\/dashboard/);
    expect(src).not.toContain("assignments.dashboard");
    expect((en as Record<string, string>)["assignments.dashboard"]).toBeUndefined();
    expect((es as Record<string, string>)["assignments.dashboard"]).toBeUndefined();
  });
});
