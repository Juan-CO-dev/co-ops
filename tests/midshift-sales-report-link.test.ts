import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SalesPanel } from "@/components/midshift/SalesPanel";
import type { SalesPulse } from "@/lib/midshift-sales";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

describe("Mid-shift Sales report link", () => {
  const pulse: SalesPulse = {
    todayYmd: "2026-10-08", today: null, yesterday: null, yesterdayDeltaPct: null,
    baselineAvgCents: null, baselineWeeks: 0, topToday: [], lastPulledAt: null,
  };

  it("renders for a GM at level 7 with the current shop", () => {
    const html = renderToStaticMarkup(createElement(SalesPanel, { pulse, viewerLevel: 7, locationId: "shop one", language: "en" }));
    expect(html).toContain('href="/reports/sales?location=shop%20one"');
    expect(html).toContain("View Sales report");
    expect(html).toContain("min-h-[44px]");
  });

  it("hides the link below the Sales read floor", () => {
    const html = renderToStaticMarkup(createElement(SalesPanel, { pulse, viewerLevel: 6, locationId: "shop one", language: "en" }));
    expect(html).not.toContain("/reports/sales");
    expect(html).not.toContain("View Sales report");
  });

  it("ships matching English and Spanish strings", () => {
    const key = "midshift.sales.report_link";
    expect(en[key]).toBeTruthy();
    expect(es[key]).toBeTruthy();
    expect((es[key].match(/\{\w+\}/g) ?? []).sort()).toEqual((en[key].match(/\{\w+\}/g) ?? []).sort());
  });
});
