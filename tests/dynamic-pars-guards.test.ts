/**
 * Unit spine — lib/dynamic-pars-shared.ts guard primitives.
 *
 * ⚠ PHASE 1 OPENING BLOCK ONLY. This file covers the four primitives Phase 1 seeded into
 * the module for Task 1.6 (the SKU admin's cushion-class datalist and par-step placeholder).
 * Phase 2 Task 2.8 fills in the rest: the par-step band, cap-after-rounding, the ≤3-step
 * manual-only rule, the day-class budget, hysteresis + generation, the PIN lifecycle, slot
 * creation, self-invalidation and the trust ramp.
 */
import { describe, it, expect } from "vitest";
import {
  CUSHION_BY_CLASS,
  CUSHION_DEFAULT,
  roundToStep,
  parStepFor,
} from "../lib/dynamic-pars-shared";

describe("roundToStep", () => {
  it("rounds to the nearest multiple of the step", () => {
    expect(roundToStep(2.6, 0.25)).toBe(2.5);
    expect(roundToStep(2.63, 0.25)).toBe(2.75);
    expect(roundToStep(2.6, 1)).toBe(3);
  });

  it("kills float drift at the step grain", () => {
    expect(roundToStep(0.1 + 0.2, 0.25)).toBe(0.25);
    // 0.30000000000000004 must not survive into a rendered par.
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3);
  });

  it("returns the value untouched on a non-positive step or a non-finite value", () => {
    expect(roundToStep(2.6, 0)).toBe(2.6);
    expect(roundToStep(2.6, -1)).toBe(2.6);
    expect(roundToStep(Number.NaN, 0.25)).toBeNaN();
  });
});

describe("parStepFor", () => {
  it("honours an explicitly authored par_step over any inference", () => {
    expect(parStepFor({ parStep: 0.5, weekdayPar: 3, weekendPar: null })).toBe(0.5);
    // A 0.25-grain par does NOT override the author.
    expect(parStepFor({ parStep: 2, weekdayPar: 0.25, weekendPar: null })).toBe(2);
  });

  it("ignores a non-positive authored step and falls back to the inference", () => {
    expect(parStepFor({ parStep: 0, weekdayPar: 3, weekendPar: null })).toBe(1);
    expect(parStepFor({ parStep: -1, weekdayPar: 1.5, weekendPar: null })).toBe(0.5);
  });

  it("infers 0.25 from a quarter-grain par (the 36 deliberately fractional SKUs)", () => {
    expect(parStepFor({ parStep: null, weekdayPar: 0.25, weekendPar: null })).toBe(0.25);
    expect(parStepFor({ parStep: null, weekdayPar: 2.75, weekendPar: null })).toBe(0.25);
    // Either par can carry the grain — the finer one wins.
    expect(parStepFor({ parStep: null, weekdayPar: 3, weekendPar: 1.25 })).toBe(0.25);
  });

  it("infers 0.5 from a half-grain par", () => {
    expect(parStepFor({ parStep: null, weekdayPar: 1.5, weekendPar: null })).toBe(0.5);
    expect(parStepFor({ parStep: null, weekdayPar: 1.5, weekendPar: 2.5 })).toBe(0.5);
  });

  it("infers 1 from whole pars, and from no pars at all", () => {
    expect(parStepFor({ parStep: null, weekdayPar: 3, weekendPar: null })).toBe(1);
    expect(parStepFor({ parStep: null, weekdayPar: 3, weekendPar: 4 })).toBe(1);
    expect(parStepFor({ parStep: null, weekdayPar: null, weekendPar: null })).toBe(1);
    expect(parStepFor({ parStep: null, weekdayPar: 0, weekendPar: null })).toBe(1);
  });
});

describe("CUSHION_BY_CLASS", () => {
  it("carries the six shipped policy classes, all as fractions", () => {
    expect(Object.keys(CUSHION_BY_CLASS).sort()).toEqual([
      "bakery",
      "dairy",
      "dry",
      "frozen",
      "produce",
      "protein",
    ]);
    for (const pct of Object.values(CUSHION_BY_CLASS)) {
      expect(pct).toBeGreaterThan(0);
      expect(pct).toBeLessThan(1);
    }
  });

  it("has a conservative default for the un-classed SKU — cushion never silences a par", () => {
    expect(CUSHION_DEFAULT).toBe(0.2);
  });
});
