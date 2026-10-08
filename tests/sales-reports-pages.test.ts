import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { parentFor } from "@/lib/nav-parents";
import { reportNavigationHref } from "@/lib/report-navigation";
import { SALES_CHANNELS, SALES_GRAINS, SALES_RANGES, SALES_VIEWS } from "@/lib/sales-reports-shared";

const E = en as Record<string, string>;
const S = es as Record<string, string>;
const PAGES = [
  "app/(authed)/reports/sales/page.tsx",
  "app/(authed)/reports/sales/checks/page.tsx",
  "app/(authed)/reports/sales/checks/[checkGuid]/page.tsx",
  "app/(authed)/reports/sales/catering/page.tsx",
];
const COMPONENTS = ["SalesParts", "SalesSummary", "SalesBreakdown", "SalesHeatmap"].map((c) => `components/reports-hub/${c}.tsx`);
const read = (p: string) => readFileSync(p, "utf8");

describe("Sales strings ship en + es together", () => {
  const ours = (d: Record<string, string>) => Object.keys(d).filter((k) => k.startsWith("reports.sales.") || k === "reports.hub.last90" || k === "reports.hub.last12m").sort();
  it("same keys, same {params}, Spanish actually translated where it should be", () => {
    expect(ours(E).length).toBeGreaterThan(100);
    expect(ours(S)).toEqual(ours(E));
    const params = (v: string) => (v.match(/\{\w+\}/g) ?? []).sort();
    for (const k of ours(E)) expect(params(S[k]!), k).toEqual(params(E[k]!));
    expect(S["reports.sales.total"]).not.toBe(E["reports.sales.total"]);
  });
  it("every literal key the Sales pages and components use exists", () => {
    for (const file of [...PAGES, ...COMPONENTS]) {
      for (const m of read(file).matchAll(/\bt\("([a-z_.A-Z0-9]+)"/g)) expect(E[m[1]!], `${file}: ${m[1]}`).toBeTruthy();
    }
  });
  it("every templated key family is complete", () => {
    const need = [
      ...SALES_VIEWS.map((v) => `reports.sales.view.${v}`), ...SALES_CHANNELS.map((c) => `reports.sales.channel.${c}`),
      ...SALES_GRAINS.map((g) => `reports.sales.grain.${g}`), ...SALES_GRAINS.map((g) => `reports.sales.by_${g}`),
      ...SALES_RANGES.map((r) => `reports.hub.${r}`), ...["complete", "partial", "missing"].map((s) => `reports.sales.coverage.${s}`),
      ...["items", "modifiers", "channels", "discounts", "servers"].map((v) => `reports.sales.col.${v}`),
      ...["matched", "not_rung_in_toast", "amount_mismatch"].map((s) => `reports.sales.catering.status.${s}`),
      ...["sale", "void", "excess_food", "gift_card", "ezcater_linked"].map((c) => `reports.sales.check.class.${c}`),
    ];
    for (const k of need) expect(E[k], k).toBeTruthy();
  });
});

describe("Sales pages: gated, server-rendered, no service import in a client file", () => {
  it("every page refuses below GM and checks the concrete shop before loading", () => {
    for (const file of PAGES) {
      const src = read(file);
      expect(src, file).toContain("auth.level < SALES_READ_MIN");
      expect(src, file).toContain("canReadScopedReport(viewer, locationId)");
      expect(src, file).not.toMatch(/getServiceRoleClient|\.rpc\(/);
    }
  });
  it("components are server components that never import the service client", () => {
    for (const file of COMPONENTS) {
      const src = read(file);
      expect(src, file).not.toContain('"use client"');
      expect(src, file).not.toMatch(/supabase-server|lib\/sales-reports"/);
    }
  });
  it("controls keep the 44 px floor", () => {
    for (const file of COMPONENTS) for (const m of read(file).matchAll(/<Link[^>]*className="([^"]*)"/g)) {
      if (m[1]!.startsWith("$")) continue;
      expect(m[1], file).toMatch(/min-h-\[44px\]|h-11/);
    }
    expect(read("components/reports-hub/SalesParts.tsx")).toMatch(/salesLink = "inline-flex min-h-\[44px\] items-center/);
  });
});

describe("Sales navigation", () => {
  it("specific parents: list/catering -> Sales root -> Reports; a check -> its list (never Operations)", () => {
    expect(parentFor("/reports/sales").href).toBe("/reports");
    expect(parentFor("/reports/sales/checks").href).toBe("/reports/sales");
    expect(parentFor("/reports/sales/catering").href).toBe("/reports/sales");
    expect(parentFor("/reports/sales/checks/abc-123")).toMatchObject({ href: "/reports/sales/checks", labelKey: "reports.sales.checks.title" });
  });
  it("switching shop keeps range/filters and drops every cursor", () => {
    const href = reportNavigationHref("/reports/sales/checks", { location: "a", range: "custom", from: "2026-10-01", to: "2026-10-07", channel: "catering", cursor: "x", cursor_a: "y" }, "b");
    const q = new URL(href, "https://local").searchParams;
    expect(q.get("location")).toBe("b");
    expect(q.get("channel")).toBe("catering");
    expect(q.get("cursor")).toBeNull();
    expect(q.get("cursor_a")).toBeNull();
  });
});
