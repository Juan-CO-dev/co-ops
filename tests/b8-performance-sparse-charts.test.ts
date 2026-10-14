import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LineChart, hasTrend, MIN_TREND_POINTS } from "@/components/trends/LineChart";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

// B8 #10 (sim walk 2026-10-14): My Performance's two charts drew "a row of dashes plus one mark
// at the right edge" on ~1 day of data. Real rendering cause: every isolated point is a
// zero-length round-capped sub-path, and preserveAspectRatio="none" stretched each cap into a
// dash; with one real point there is no line at all. Fix: unscaled strokes (dots stay dots) and
// an honest "not enough days yet" state below two points.

const thirty = (filled: Record<number, number>) => Array.from({ length: 30 }, (_, i) => filled[i] ?? null);

describe("B8 #10 sparse performance charts", () => {
  it("one real point is not a trend; two are", () => {
    expect(MIN_TREND_POINTS).toBe(2);
    expect(hasTrend(thirty({ 29: 5 }))).toBe(false);
    expect(hasTrend(thirty({}))).toBe(false);
    expect(hasTrend(thirty({ 3: 0, 29: 5 }))).toBe(true);
  });
  it("chart strokes do not stretch with the viewBox (isolated points stay dots)", () => {
    const svg = renderToStaticMarkup(createElement(LineChart, { series: [{ points: thirty({ 3: 1, 10: 2, 29: 5 }), color: "red" }], ariaLabel: "x" }));
    expect(svg).toContain('vector-effect="non-scaling-stroke"');
  });
  it("My Performance and the manager's person view show the empty state instead of a broken chart", () => {
    const me = readFileSync("components/me/MyPerformance.tsx", "utf8");
    expect(me).toContain("hasTrend(data.contribution) ?");
    expect(me).toContain("hasTrend(data.onTime) ?");
    expect(me.match(/me\.not_enough_days/g)?.length).toBe(2);
    const person = readFileSync("components/team/PersonDetail.tsx", "utf8");
    expect(person).toContain("hasTrend(detail.contribution) ?");
    expect(person).toContain("hasTrend(detail.onTime) ?");
  });
  it("en + es copy", () => {
    for (const d of [en, es]) {
      expect(d["me.not_enough_days"]).toBeTruthy();
      expect(d["people.detail.not_enough_days"]).toBeTruthy();
    }
  });
});
