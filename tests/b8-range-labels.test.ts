import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportRangeControls } from "@/components/reports-hub/ReportRangeControls";
import { parseReportRange } from "@/lib/report-range";
import { resolveSalesRange, SALES_RANGES, SALES_RANGE_LABELS } from "@/lib/sales-reports-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

// B8 #5 (sim walk 2026-10-14): the hub's "Last 7 days" showed 10/08–10/14 and Sales' showed
// 10/07–10/13. Both rules are deliberate (hub: today's reports are real records; Sales: finished
// business days only, plan 2026-10-07 "Range wrapper") — the bug was ONE label for two windows.

const TODAY = "2026-10-14";
const range = { range: "last7", from: "2026-10-08", to: "2026-10-14", compare: false };

describe("B8 #5 the two rolling-7 windows", () => {
  it("the hub's ends today (ET business day)", () => {
    expect(parseReportRange({ range: "last7" }, TODAY)).toMatchObject({ from: "2026-10-08", to: "2026-10-14" });
  });
  it("Sales' ends yesterday — finished days only", () => {
    expect(resolveSalesRange({ range: "last7" }, TODAY)).toMatchObject({ from: "2026-10-07", to: "2026-10-13" });
    expect(resolveSalesRange({ range: "last30" }, TODAY)).toMatchObject({ to: "2026-10-13" });
    expect(resolveSalesRange({ range: "last90" }, TODAY)).toMatchObject({ to: "2026-10-13" });
  });
});

describe("B8 #5 a different window never shares the hub's label", () => {
  const render = (props: Record<string, unknown>, language: "en" | "es" = "en") =>
    renderToStaticMarkup(createElement(ReportRangeControls, { range, locationId: "shop", language, ...props } as Parameters<typeof ReportRangeControls>[0]));

  it("Sales presets say 'full days' (en + es)", () => {
    const html = render({ ranges: SALES_RANGES, labelKeys: SALES_RANGE_LABELS });
    expect(html).toContain(">Last 7 full days<");
    expect(html).toContain(">Last 30 full days<");
    expect(html).toContain(">Last 90 full days<");
    expect(html).not.toContain(">Last 7 days<");
    expect(render({ ranges: SALES_RANGES, labelKeys: SALES_RANGE_LABELS }, "es")).toContain(">Últimos 7 días completos<");
  });
  it("the hub keeps 'Last 7 days'", () => {
    expect(render({})).toContain(">Last 7 days<");
  });
  it("every Sales page passes the labels", () => {
    for (const f of ["app/(authed)/reports/sales/page.tsx", "app/(authed)/reports/sales/catering/page.tsx", "app/(authed)/reports/sales/checks/page.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toContain("ranges={SALES_RANGES} labelKeys={SALES_RANGE_LABELS}");
    }
  });
  it("keys exist in both dictionaries", () => {
    for (const key of Object.values(SALES_RANGE_LABELS)) {
      expect(en[key]).toBeTruthy();
      expect(es[key]).toBeTruthy();
    }
  });
});
