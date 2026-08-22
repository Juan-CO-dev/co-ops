/**
 * Unit spine — the Dynamic Pars COVERAGE math (plan Tasks 2.3, 2.5, 2.6).
 *
 * Σ per covered day (never rate × days) · the cushion C-socket · the observed-peak floor.
 *
 * The horizon itself comes from lib/vendor-rhythm-shared.coverageWindow and ends at the
 * SECOND-next delivery (plan D3) — this module only consumes the day list, and it derives
 * each day's class HERE so a caller cannot hand in a second opinion about where the weekend
 * starts. Calendar anchors: 2026-08-25/26/27 are Tue/Wed/Thu (weekday); 2026-08-28/29/30 are
 * Fri/Sat/Sun (weekend, the shipped boundary).
 */
import { describe, it, expect } from "vitest";
import {
  CUSHION_BY_CLASS,
  CUSHION_DEFAULT,
  DYNAMIC_PARS,
  computeCoverage,
  cushionFor,
  observedPeakCoverageOz,
  type CoverageInput,
  type DemandStats,
} from "../lib/dynamic-pars-shared";

const TUE = "2026-08-25";
const WED = "2026-08-26";
const THU = "2026-08-27";
const FRI = "2026-08-28";
const SAT = "2026-08-29";

function input(over: Partial<CoverageInput> = {}): CoverageInput {
  return {
    coveredDays: [TUE, WED],
    baseOzPerDay: { weekday: 30, weekend: 45 },
    velocityRatio: 1,
    cushionPct: 0.2,
    perOrderUnitOz: 24,
    peakFloorOz: null,
    ...over,
  };
}

describe("observedPeakCoverageOz — the empirical service level (Task 2.3)", () => {
  it("returns the p90 of the consecutive runs once there are enough runs to rank", () => {
    const daily = Array.from({ length: 20 }, (_, i) => i + 1); // 1 … 20
    // 19 consecutive 2-day sums: 3, 5, 7 … 39. p90 index = ceil(0.9 × 19) − 1 = 17 ⇒ 37.
    expect(observedPeakCoverageOz(daily, 2)).toBe(37);
  });

  it("returns the MAX run when there are too few runs to rank (a p90 in a costume)", () => {
    expect(observedPeakCoverageOz([1, 2, 3, 10], 3)).toBe(15); // runs 6 and 15
    expect(DYNAMIC_PARS.PEAK_MIN_RUNS_FOR_QUANTILE).toBe(5);
  });

  it("makes NO floor claim when there is less data than one horizon", () => {
    expect(observedPeakCoverageOz([5, 5], 3)).toBeNull();
    expect(observedPeakCoverageOz([], 1)).toBeNull();
    expect(observedPeakCoverageOz([5, 5, 5], 0)).toBeNull();
    expect(observedPeakCoverageOz([5, 5, 5], -2)).toBeNull();
  });

  it("caps one catering-shaped outlier out of the answer once ranking is possible", () => {
    // Six 1-day runs, one of them a 500 outlier. p90 index = ceil(5.4) − 1 = 5 ⇒ the outlier
    // is the p90 here (n is small), but the MEAN would be far below it either way.
    expect(observedPeakCoverageOz([10, 10, 10, 10, 10, 500], 1)).toBe(500);
    // Add enough ordinary runs and the outlier stops governing.
    const many = [...Array.from({ length: 19 }, () => 10), 500];
    expect(observedPeakCoverageOz(many, 1)).toBe(10);
  });

  it("handles a horizon equal to the whole series (exactly one run)", () => {
    expect(observedPeakCoverageOz([2, 3, 4], 3)).toBe(9);
  });
});

describe("cushionFor — THE C-SOCKET (Task 2.5)", () => {
  const stats: DemandStats = { ozPerDay: 30, observedDays: 12 };

  it("returns the policy percentage for a known class", () => {
    expect(cushionFor({ cushionClass: "protein" }, { id: "loc" }, stats)).toEqual({
      pct: 0.2,
      classUsed: "protein",
      isDefault: false,
    });
    expect(cushionFor({ cushionClass: "produce" }, { id: "loc" }, stats).pct).toBe(0.3);
    expect(cushionFor({ cushionClass: "dry" }, { id: "loc" }, stats).pct).toBe(0.15);
    expect(cushionFor({ cushionClass: "frozen" }, { id: "loc" }, stats).pct).toBe(0.1);
  });

  it("normalises case and whitespace — the class is free-text tenant data (plan D6)", () => {
    expect(cushionFor({ cushionClass: "  Protein " }, { id: "loc" }, stats).pct).toBe(0.2);
    expect(cushionFor({ cushionClass: "DAIRY" }, { id: "loc" }, stats).classUsed).toBe("dairy");
  });

  it("falls to the conservative default on an unknown class, and says so", () => {
    const res = cushionFor({ cushionClass: "unobtanium" }, { id: "loc" }, stats);
    expect(res.pct).toBe(CUSHION_DEFAULT);
    expect(res.isDefault).toBe(true);
    expect(res.classUsed).toBe("unobtanium");
  });

  it("falls to the default on a null class WITHOUT silencing anything (r2-13)", () => {
    const res = cushionFor({ cushionClass: null }, { id: "loc" }, stats);
    expect(res).toEqual({ pct: CUSHION_DEFAULT, classUsed: null, isDefault: true });
    // Cushion is THIRD on the data critical path; a missing class must never produce a null.
    expect(res.pct).toBeGreaterThan(0);
  });

  it("accepts demandStats and DELIBERATELY ignores it — the socket's contract", () => {
    const thin: DemandStats = { ozPerDay: 1, observedDays: 1, stdDevOzPerDay: 0.1 };
    const fat: DemandStats = { ozPerDay: 900, observedDays: 365, stdDevOzPerDay: 400 };
    expect(cushionFor({ cushionClass: "protein" }, { id: "a" }, thin)).toEqual(
      cushionFor({ cushionClass: "protein" }, { id: "a" }, fat),
    );
  });

  it("is per-location by signature so the statistical implementation needs no caller change", () => {
    expect(cushionFor({ cushionClass: "protein" }, { id: "cap-hill" }, stats).pct).toBe(
      cushionFor({ cushionClass: "protein" }, { id: "p-street" }, stats).pct,
    );
    expect(Object.keys(CUSHION_BY_CLASS)).toHaveLength(6);
  });
});

describe("computeCoverage — Σ per covered day, never rate × days (Task 2.6)", () => {
  it("sums a two-weekday horizon and applies the cushion", () => {
    const res = computeCoverage(input());
    expect(res).not.toBeNull();
    expect(res!.demandOz).toBe(60); // 30 + 30
    expect(res!.coveredOz).toBe(72); // +20%
    expect(res!.targetUnits).toBe(3); // 72 oz / 24 oz per unit
    expect(res!.flooredByPeak).toBe(false);
  });

  it("SUMS PER DAY-CLASS across a horizon that straddles into the weekend", () => {
    const res = computeCoverage(input({ coveredDays: [THU, FRI], cushionPct: 0 }));
    expect(res!.demandOz).toBe(75); // weekday 30 + weekend 45
    // Neither single-rate shortcut may appear: 30×2 = 60, 45×2 = 90.
    expect(res!.demandOz).not.toBe(60);
    expect(res!.demandOz).not.toBe(90);
  });

  it("sums three weekend days at the weekend rate", () => {
    const res = computeCoverage(input({ coveredDays: [FRI, SAT, "2026-08-30"], cushionPct: 0 }));
    expect(res!.demandOz).toBe(135);
  });

  it("returns NULL when any covered day's class rate is unknown — you cannot sum an unknown", () => {
    const res = computeCoverage(
      input({ coveredDays: [THU, FRI], baseOzPerDay: { weekday: 30, weekend: null } }),
    );
    expect(res).toBeNull();
  });

  it("returns NULL on an empty horizon — never a zero", () => {
    const res = computeCoverage(input({ coveredDays: [] }));
    expect(res).toBeNull();
    expect(res).not.toBe(0);
  });

  it("multiplies by the velocity ratio, never adds to it", () => {
    const res = computeCoverage(input({ velocityRatio: 1.25, cushionPct: 0 }));
    expect(res!.demandOz).toBe(75); // (30 + 30) × 1.25
    const neutral = computeCoverage(input({ velocityRatio: 1, cushionPct: 0 }));
    expect(neutral!.demandOz).toBe(60);
  });

  it("derives targetUnits from the covered oz and the order-unit denominator", () => {
    const res = computeCoverage(input({ cushionPct: 0, perOrderUnitOz: 8 }));
    expect(res!.targetUnits).toBe(7.5); // 60 / 8 — fractional targets are real (36 SKUs)
  });

  it("REFUSES a unit target with no honest denominator (the perOrderUnitOz refusal)", () => {
    expect(computeCoverage(input({ perOrderUnitOz: null }))).toBeNull();
    expect(computeCoverage(input({ perOrderUnitOz: 0 }))).toBeNull();
    expect(computeCoverage(input({ perOrderUnitOz: -8 }))).toBeNull();
  });
});

describe("computeCoverage — the observed-peak floor (the Prosciutto proof)", () => {
  it("RAISES a mean-based target that the observed peak run beats", () => {
    // Weekend demand 100/day over Fri+Sat = 200; mean + 20% = 240. The worst observed
    // two-day weekend run was 245 — the cushion covered the average and failed the day it
    // was bought for. The floor fixes exactly that.
    const res = computeCoverage(
      input({
        coveredDays: [FRI, SAT],
        baseOzPerDay: { weekday: 30, weekend: 100 },
        peakFloorOz: 245,
        perOrderUnitOz: 49,
      }),
    );
    expect(res!.demandOz).toBe(200);
    expect(res!.coveredOz).toBe(245);
    expect(res!.flooredByPeak).toBe(true);
    expect(res!.targetUnits).toBe(5);
    // The un-floored answer would have been 240 — cleared by the worst weekend by ~2%.
    expect(res!.coveredOz).toBeGreaterThan(240);
  });

  it("leaves a target that already clears the peak alone", () => {
    const res = computeCoverage(input({ peakFloorOz: 50 })); // cushioned target is 72
    expect(res!.coveredOz).toBe(72);
    expect(res!.flooredByPeak).toBe(false);
  });

  it("makes no floor claim when the peak is unknown", () => {
    const res = computeCoverage(input({ peakFloorOz: null }));
    expect(res!.coveredOz).toBe(72);
    expect(res!.flooredByPeak).toBe(false);
  });

  it("does not floor on an exactly-equal peak (the floor RAISES, it does not relabel)", () => {
    const res = computeCoverage(input({ peakFloorOz: 72 }));
    expect(res!.coveredOz).toBe(72);
    expect(res!.flooredByPeak).toBe(false);
  });
});
