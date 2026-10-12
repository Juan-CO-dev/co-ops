import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalesHeatmap } from "@/components/reports-hub/SalesHeatmap";
import { channelLabel, serverLabel } from "@/components/reports-hub/SalesParts";
import { formatHourRange, formatHourShort } from "@/lib/i18n/format";
import { heatmapHours } from "@/lib/sales-heatmap-shared";
import { heatmapGrid, mergeBreakdown, parseSalesCheckFilters } from "@/lib/sales-reports-shared";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

describe("Sales heatmap hour boundaries", () => {
  it("labels midnight, noon and closing buckets in each language", () => {
    expect([0, 12, 17].map((h) => formatHourShort(h, "en"))).toEqual(["12a", "12p", "5p"]);
    expect(formatHourShort(17, "es")).toMatch(/^5 p\.\s*m\.$/);
    expect(formatHourRange(17, "en")).toBe("5–6 PM");
    expect(formatHourRange(11, "en")).toBe("11 AM–12 PM");
    expect(formatHourRange(23, "en")).toBe("11 PM–12 AM");
    expect(formatHourRange(17, "es")).toMatch(/^5–6 p\.\s*m\.$/);
  });
  it("trims by checks, keeps zero-dollar sales, pads edges and keeps empty grids empty", () => {
    const grid = heatmapGrid(mergeBreakdown("hour_weekday", [[
      { key: "6:10", dow: 6, hour: 10, checks: 1, cents: 0 },
      { key: "7:17", dow: 7, hour: 17, checks: 2, cents: 500 },
    ]]));
    expect(heatmapHours(grid)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    grid.checks[0]![0] = 1;
    grid.checks[6]![23] = 1;
    expect(heatmapHours(grid)).toEqual(Array.from({ length: 24 }, (_, h) => h));
    expect(heatmapHours(heatmapGrid([]))).toEqual([]);
  });
  it("uses full ranges for headers and cells while preserving hour drill indexes", () => {
    const rows = mergeBreakdown("hour_weekday", [[{ key: "6:17", dow: 6, hour: 17, checks: 2, cents: 1250 }]]);
    const html = renderToStaticMarkup(React.createElement(SalesHeatmap, { rows, language: "en", cellHref: (d, h) => `/checks?dow=${d}&hour=${h}` }));
    expect(html).toContain('title="5–6 PM"');
    expect(html).toContain('aria-label="Saturday, 5–6 PM: $12.50 from 2 checks"');
    expect(html).toContain('aria-label="Monday, 4–5 PM: no checks"');
    expect(html).toContain("dow=6&amp;hour=17");
    expect(html).not.toContain('title="12–1 AM"');
  });
  it("keeps no-row and unknown-hour disclosures", () => {
    expect(renderToStaticMarkup(React.createElement(SalesHeatmap, { rows: [], language: "en", cellHref: () => "#" }))).toContain("Nothing in this range.");
    const rows = mergeBreakdown("hour_weekday", [[{ key: "6:-1", dow: 6, hour: -1, checks: 2, cents: 500 }]]);
    const html = renderToStaticMarkup(React.createElement(SalesHeatmap, { rows, language: "en", cellHref: (_d, h) => `/checks?hour=${h}` }));
    expect(html).toContain("2 checks with no opened time");
    expect(html).toContain("hour=-1");
    expect(html).not.toContain("Nothing in this range.");
  });
});

describe("Sales server and excluded channel display labels", () => {
  it("localizes online buckets without overriding a resolved first name", () => {
    expect(serverLabel("en", "guid1234", null, true)).toBe("Online / no server");
    expect(serverLabel("es", "guid1234", null, true)).toBe("En línea / sin mesero");
    expect(serverLabel("en", "guid1234", "Ana", true)).toBe("Ana");
    expect(serverLabel("en", "guid1234", null)).toContain("…1234");
  });
  it("labels gift cards without admitting them as an eligible sales check filter", () => {
    expect(channelLabel("en", "gift_card")).toBe("Gift card sales");
    expect(channelLabel("es", "gift_card")).toBe("Venta de tarjetas de regalo");
    expect(parseSalesCheckFilters({ channel: "gift_card" }).channel).toBeUndefined();
  });
});
