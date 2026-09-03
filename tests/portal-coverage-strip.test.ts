// At-a-glance coverage strip (lib/portal/coverage-shared.ts) — the collapsed mobile bar and the
// desktop side column both read from this so the numbers can never disagree with the panel.
import { describe, expect, it } from "vitest";
import { coverageSegments, coverageStripText } from "@/lib/portal/coverage-shared";

const cov = { main: 12.4, side: 20, sweet: 0, drink: 36 };

describe("coverageSegments", () => {
  it("one segment per category, in the customer's reading order, served rounded, fill capped at 100%", () => {
    const segs = coverageSegments(cov, 35);
    expect(segs.map((s) => s.label)).toEqual(["Mains", "Sides", "Sweets", "Drinks"]);
    expect(segs.map((s) => s.served)).toEqual([12, 20, 0, 36]);
    expect(segs.map((s) => s.headcount)).toEqual([35, 35, 35, 35]);
    expect(segs.map((s) => s.pct)).toEqual([34, 57, 0, 100]);
    expect(segs.map((s) => s.covered)).toEqual([false, false, false, true]);
  });

  it("a zero headcount never divides by zero", () => {
    const segs = coverageSegments(cov, 0);
    expect(segs.every((s) => s.pct === 0 && s.covered === false)).toBe(true);
  });
});

describe("coverageStripText", () => {
  it("reads as one compact line", () => {
    expect(coverageStripText(cov, 35)).toBe("Mains 12/35 · Sides 20/35 · Sweets 0/35 · Drinks 36/35");
  });
});
