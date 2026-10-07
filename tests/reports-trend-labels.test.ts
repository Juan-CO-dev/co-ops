import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { formatTrendMonthLabels } from "@/lib/i18n/format";
import { parseReportRange } from "@/lib/report-range";
import { TrendControls } from "@/components/trends/TrendControls";
import { ReportRangeControls } from "@/components/reports-hub/ReportRangeControls";

describe("month trend labels",()=>{
  it("localizes short months and adds years when buckets cross a year",()=>{
    expect(formatTrendMonthLabels(["2026-08-01","2026-09-01"],"en")).toEqual(["Aug","Sep"]);
    const en=formatTrendMonthLabels(["2025-12-01","2026-01-01"],"en");
    const es=formatTrendMonthLabels(["2025-12-01","2026-01-01"],"es");
    expect(en).toEqual(["Dec 2025","Jan 2026"]);
    expect(es[0]).toContain("2025");expect(es[1]).toContain("2026");
    expect(es[0]).not.toBe(en[0]);
  });

  it.each(["en","es"] as const)("names both clipped end buckets in %s",language=>{
    const range=parseReportRange({range:"custom",from:"2026-08-15",to:"2026-10-07"},"2026-10-07","month");
    const html=renderToStaticMarkup(React.createElement(TrendControls,{range,locationId:"shop",granularity:"month",compare:false,language}));
    expect(html.toLowerCase()).toContain(language==="es"?"ago":"aug");
    expect(html.toLowerCase()).toContain("oct");
    expect((html.match(/partial|parcial/g)??[]).length).toBeGreaterThanOrEqual(2);
  });
});

it("states when an operations range was shortened to the 92-day cap",()=>{
  const range=parseReportRange({range:"custom",from:"2026-01-01",to:"2026-10-07"},"2026-10-07");
  const html=renderToStaticMarkup(React.createElement(ReportRangeControls,{range,locationId:"shop",language:"en",shortened:true}));
  expect(html).toContain("Range shortened to 92 days.");
});
