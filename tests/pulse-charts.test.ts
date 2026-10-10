/** 2D charts: SVG, accessible label, the basis caption, and an honest empty state (never a fake zero bar). */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Bars } from "@/components/pulse/charts/Bars";
import { Heatmap } from "@/components/pulse/charts/Heatmap";
import { PaceCurve } from "@/components/pulse/charts/PaceCurve";

describe("PaceCurve", () => {
  const today = [...new Array(11).fill(0), 100, 300, 350, ...new Array(10).fill(null)];
  const base = [...new Array(11).fill(0), 120, 260, 400, 500, 600, ...new Array(7).fill(600)];
  it("draws today solid and the baseline dashed, with a legend and the aria label", () => {
    const html = renderToStaticMarkup(createElement(PaceCurve, { today, baseline: base, currentHour: 13, ariaLabel: "Pace vs a normal Friday", labelToday: "Today", labelNormal: "Normal day", noData: "No data yet" }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Pace vs a normal Friday"');
    expect(html).toContain("stroke-dasharray");
    expect(html).toContain("Normal day");
    expect(html).toContain("Today");
    expect((html.match(/<path/g) ?? []).length).toBe(2);
  });
  it("no baseline: only today's path and no normal-day legend; nothing at all → the empty state", () => {
    const html = renderToStaticMarkup(createElement(PaceCurve, { today, baseline: null, currentHour: 13, ariaLabel: "x", labelToday: "Today", labelNormal: "Normal day", noData: "No data yet" }));
    expect((html.match(/<path/g) ?? []).length).toBe(1);
    expect(html).not.toContain("Normal day");
    const empty = renderToStaticMarkup(createElement(PaceCurve, { today: new Array(24).fill(null), baseline: null, currentHour: 9, ariaLabel: "x", labelToday: "Today", labelNormal: "Normal day", noData: "No data yet" }));
    expect(empty).toContain("No data yet");
    expect(empty).not.toContain("<svg");
  });
});

describe("Bars", () => {
  it("renders label + display text per row and scales widths to the max; empty → noData", () => {
    const html = renderToStaticMarkup(createElement(Bars, { ariaLabel: "Top", noData: "none", rows: [
      { key: "a", label: "Teamster", value: 10, display: "10 units" }, { key: "b", label: "Crunchy Boi", value: 5, display: "5 units" },
    ] }));
    expect(html).toContain("Teamster");
    expect(html).toContain("5 units");
    expect(html).toContain("width:100%");
    expect(html).toContain("width:50%");
    expect(renderToStaticMarkup(createElement(Bars, { ariaLabel: "Top", noData: "none", rows: [] }))).toContain("none");
  });
});

describe("Heatmap", () => {
  it("renders a labelled table with weekday rows and hour columns; cells carry their value", () => {
    const html = renderToStaticMarkup(createElement(Heatmap, { cells: [{ dow: 5, hour: 12, cents: 12345 }, { dow: 1, hour: 11, cents: 100 }], language: "en", ariaLabel: "Hour × weekday", noData: "none" }));
    expect(html).toContain("<table");
    expect(html).toContain("Fri 12:00 $123");
    expect(html).toContain("Mon 11:00 $1");
    expect(html).toContain('aria-label="Hour × weekday"');
    expect(renderToStaticMarkup(createElement(Heatmap, { cells: [], language: "es", ariaLabel: "x", noData: "nada" }))).toContain("nada");
  });
});
