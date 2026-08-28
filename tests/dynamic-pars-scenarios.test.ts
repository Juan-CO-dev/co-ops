/**
 * Unit spine — DYNAMIC PARS, the council's scenario walks as permanent regressions
 * (plan Phase 5, Task 5.1).
 *
 * These are the only tests in the arc that run END TO END: `computeBaseRate` →
 * `computeVelocityRatio` → `computeCoverage` → `applyGuardStack` → `resolveWalkerSuggestion`
 * composed in the nightly engine's own order over hand-built inputs. The per-layer suites
 * (base / velocity / coverage / guards / reason / run / walker / write) prove each rule in
 * isolation; this one proves they still say the right thing TOGETHER, on the seven walks
 * the council actually argued about plus the two the lead added at Phase-5 close.
 *
 * Fixtures and expected verdicts live in `scripts/sim/dynamic-pars/scenarios.ts`; this file
 * is the assertions and the prose. When a number here changes, the question to ask is not
 * "which fixture do I update" — it is "which shipped rule moved, and was that intended".
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  DYNAMIC_PARS,
  ERRAND_REASONS,
  SILENCING_REASONS,
  resolveWalkerSuggestion,
  rollupParSilence,
  trustRampState,
} from "../lib/dynamic-pars-shared";
import {
  BUDGET_EXPECTED,
  BUDGET_SLOT,
  CARRIER_SKU,
  COLD_START_EXPECTED,
  COUNT_EXPECTED,
  CUTOFF_AFTER_MINUTES,
  CUTOFF_BEFORE_MINUTES,
  CUTOFF_EXPECTED,
  CUTOFF_WALK_DATE,
  FLIP_EXPECTED,
  FLIP_PRODUCT_BY_SKU,
  GRADUATION_CASES,
  GRADUATION_EXPECTED,
  HAM_WEEK_EXPECTED,
  LOCATION,
  MOZZ_EXPECTED,
  PFG_CUTOFFS,
  PFG_OUTAGE_SKIP,
  PFG_RHYTHM,
  PRIMARY_SKU,
  PROSCIUTTO_EXPECTED,
  budgetBlockedNight,
  budgetPriorAndBudget,
  coldStartNight,
  countArrivesNight,
  cutoffTerms,
  flipDepletionRows,
  flipNight,
  graduatedButDarkNight,
  hamWeekRun,
  horizonFor,
  mozzUnitBombNight,
  priorFrom,
  prosciuttoNight,
  prosciuttoSeries,
  simulateNight,
  type NightResult,
} from "../scripts/sim/dynamic-pars/scenarios";

/** 1-based night index of the first result matching `pred`, or 0. */
function firstNight(rows: NightResult[], pred: (r: NightResult) => boolean): number {
  const i = rows.findIndex(pred);
  return i < 0 ? 0 : i + 1;
}
function lastNight(rows: NightResult[], pred: (r: NightResult) => boolean): number {
  for (let i = rows.length - 1; i >= 0; i -= 1) if (pred(rows[i]!)) return i + 1;
  return 0;
}
const night = (rows: NightResult[], k: number): NightResult => rows[k - 1]!;

// ═════════════════════════════════════════════════════════════════════════════
describe("SCENARIO 1 — the ham week: demand steps +40%", () => {
  const baseOnly = hamWeekRun({ velocityLive: false, noFloor: true });
  const velocityOnly = hamWeekRun({ velocityLive: true, noFloor: true });
  const shipped = hamWeekRun({ velocityLive: true, noFloor: false });
  const shippedNoVelocity = hamWeekRun({ velocityLive: false, noFloor: false });

  it("THE ASSERTION: every night carries BOTH terms, so the latency is visible", () => {
    // This is the whole of aggie's r3 P1. A par that has not moved for two weeks is only
    // defensible if the ledger says, every single night, what the base thinks and what
    // velocity thinks. Silence about a slow instrument reads as a broken one.
    for (const r of shipped) {
      expect(r.baseRateOzPerDay).not.toBeNull();
      expect(typeof r.velocityRatio).toBe("number");
      expect(typeof r.velocityApplied).toBe("boolean");
      expect(r.runDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // …and the base is monotonically absorbing the step, never jumping to it.
    for (let i = 1; i < shipped.length; i += 1) {
      expect(night(shipped, i + 1).baseRateOzPerDay!).toBeGreaterThanOrEqual(
        night(shipped, i).baseRateOzPerDay!,
      );
    }
    expect(night(shipped, 21).baseRateOzPerDay).toBeCloseTo(56, 6); // 40 x 1.4, fully absorbed
  });

  it("the flat 21-day base takes SIXTEEN nights to break the band", () => {
    const e = HAM_WEEK_EXPECTED.baseOnly;
    expect(night(baseOnly, e.firstSilentNight).suggestedPar).toBeNull();
    expect(firstNight(baseOnly, (r) => r.suggestedPar != null)).toBe(e.firstRenderedNight);
    expect(night(baseOnly, e.firstRenderedNight).suggestedPar).toBe(e.firstRenderedSuggestion);
    expect(firstNight(baseOnly, (r) => r.outcome === "would_apply")).toBe(e.firstWouldApplyNight);

    const crossed = firstNight(baseOnly, (r) => r.suppressedBy === "band");
    expect(crossed).toBe(e.bandCrossNight);
    expect(night(baseOnly, crossed).suggestedPar).toBe(e.bandCrossSuggestion);
    expect(night(baseOnly, crossed).tier).toBe("suggestion");
    expect(night(baseOnly, 21).suggestedPar).toBe(e.finalSuggestion);
  });

  it("the one-step deadband holds the rendered number while the target climbs (F2)", () => {
    const e = HAM_WEEK_EXPECTED.baseOnly;
    for (let k = e.firstRenderedNight; k <= e.deadbandHeldThroughNight; k += 1) {
      expect(night(baseOnly, k).suggestedPar).toBe(e.deadbandHeldSuggestion);
    }
    // The underlying target moved almost two full steps underneath that flat number.
    expect(night(baseOnly, e.firstRenderedNight).targetUnits!).toBeCloseTo(8.533333, 5);
    expect(night(baseOnly, e.deadbandHeldThroughNight).targetUnits!).toBeCloseTo(10.4, 5);
  });

  it("velocity sees the step in THREE nights — and can only ever suggest", () => {
    const e = HAM_WEEK_EXPECTED.velocityOnly;
    expect(firstNight(velocityOnly, (r) => r.velocityApplied)).toBe(e.firstAppliedNight);
    expect(night(velocityOnly, e.firstAppliedNight).velocityRatio).toBe(e.cappedRatio);
    // Bounded and DIMENSIONLESS by construction: it can never enter an oz sum.
    for (const r of velocityOnly) {
      expect(r.velocityRatio).toBeLessThanOrEqual(1 + DYNAMIC_PARS.VELOCITY_CAP);
      expect(r.velocityRatio).toBeGreaterThanOrEqual(1 - DYNAMIC_PARS.VELOCITY_CAP);
    }
    // It breaks the band on the very night it fires — which is the point: a velocity move
    // is a SUGGESTION, immediately, and it is never an auto-move (r1-6).
    expect(firstNight(velocityOnly, (r) => r.suppressedBy === "band")).toBe(e.bandCrossNight);
    expect(night(velocityOnly, e.bandCrossNight).suggestedPar).toBe(e.bandCrossSuggestion);
    for (const r of velocityOnly) {
      if (r.velocityApplied) expect(r.tier).not.toBe("auto");
    }
    // And it hands itself back once the base has absorbed the step: what was momentum is
    // now trend, and claiming it twice would be the double-count the residual form exists
    // to prevent.
    expect(lastNight(velocityOnly, (r) => r.velocityApplied)).toBe(e.lastAppliedNight);
    expect(night(velocityOnly, 21).velocityApplied).toBe(false);
  });

  it("AS SHIPPED the peak floor is the fast responder, and that is the design working", () => {
    const e = HAM_WEEK_EXPECTED.asShipped;
    expect(firstNight(shipped, (r) => r.suppressedBy === "band")).toBe(e.bandCrossNight);
    expect(night(shipped, e.bandCrossNight).suggestedPar).toBe(e.bandCrossSuggestion);
    expect(night(shipped, 21).suggestedPar).toBe(e.finalSuggestion);
    // Two days after the step the worst run this shop has ACTUALLY had is already the new
    // level, while the 21-day mean is three weeks from it. A percentage on a mean is not a
    // service level — so the floor moves first, and the base's latency is measured against
    // the composed engine, not against an arithmetic that does not ship.
    expect(e.bandCrossNight).toBeLessThan(HAM_WEEK_EXPECTED.baseOnly.bandCrossNight);
    // …and with the floor binding, velocity moves the TARGET but not the rendered number:
    // the deadband absorbs it, because the floor already moved the par it was reaching for.
    expect(e.velocityChangesNoRenderedSuggestion).toBe(true);
    expect(shipped.map((r) => r.suggestedPar)).toEqual(
      shippedNoVelocity.map((r) => r.suggestedPar),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("SCENARIO 2 — the mozz unit bomb: eaches read as cases", () => {
  const r = simulateNight(mozzUnitBombNight());

  it("emits NO NUMBER, and names a unit problem rather than a demand one", () => {
    expect(r.targetUnits).toBe(MOZZ_EXPECTED.targetUnits);
    expect(r.suggestedPar).toBe(MOZZ_EXPECTED.suggestedPar);
    expect(r.reasonCode).toBe(MOZZ_EXPECTED.reasonCode);
    expect(r.tier).toBe(MOZZ_EXPECTED.tier);
    expect(r.outcome).toBe(MOZZ_EXPECTED.outcome);
    // No generation id means there is nothing for a human to accept — which is correct:
    // there is no honest offer here, only an errand.
    expect(r.generationId).toBe(MOZZ_EXPECTED.generationId);
  });

  it("the walker refuses it too — a silencing reason silences BOTH engines", () => {
    expect(SILENCING_REASONS.has(r.reasonCode)).toBe(true);
    expect(
      resolveWalkerSuggestion({
        locationId: LOCATION, skuId: "sku-mozz", dayClass: "weekday", terms: r.terms,
        coveredDays: ["2026-08-26", "2026-08-27"], coverThroughDate: "2026-08-28", canAct: true,
      }),
    ).toBeNull();
  });

  it("surfaces as an ERRAND that names the SKU, not as a fault to scroll past", () => {
    const summary = rollupParSilence(
      [{ skuId: "sku-mozz", reasonCode: r.reasonCode, skuName: MOZZ_EXPECTED.errandNamesTheSku }],
      { suggestionsWaiting: 0, autoMovesThisWeek: 0, runDate: r.runDate, shadowMode: true },
    );
    expect(summary.speaking).toBe(0);
    expect(summary.byCause).toHaveLength(1);
    expect(summary.byCause[0]!.cause).toBe("par_unit_suspect");
    expect(summary.byCause[0]!.sampleSkuNames).toEqual([MOZZ_EXPECTED.errandNamesTheSku]);
    expect(ERRAND_REASONS).toContain("par_unit_suspect");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("SCENARIO 3 — the prosciutto floor: mean + 20% under the worst observed run", () => {
  const floored = simulateNight(prosciuttoNight());
  const unfloored = simulateNight(prosciuttoNight(null, true));

  it("reproduces the live series shape it claims to (435 oz / 30 days, on 21)", () => {
    const total = [...prosciuttoSeries().values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(PROSCIUTTO_EXPECTED.seriesTotalOz);
    // 12 weekday + 9 weekend points. Any 21 consecutive days contain exactly three of each
    // day-of-week, so this is a property of the window length, not of these dates.
    expect(floored.base.byDayClass.weekday.observedDays).toBe(
      PROSCIUTTO_EXPECTED.weekdayObservedDays,
    );
    expect(floored.base.byDayClass.weekend.observedDays).toBe(
      PROSCIUTTO_EXPECTED.weekendObservedDays,
    );
  });

  it("the floor RAISES the suggestion, and the counterfactual proves it was the floor", () => {
    expect(floored.peakFloorOz).toBe(PROSCIUTTO_EXPECTED.peakFloorOz);
    expect(floored.demandOz! * 1.2).toBeCloseTo(PROSCIUTTO_EXPECTED.cushionedMeanOz, 5);
    expect(floored.flooredByPeak).toBe(PROSCIUTTO_EXPECTED.flooredByPeak);
    expect(floored.coveredOz).toBe(PROSCIUTTO_EXPECTED.peakFloorOz);
    expect(floored.suggestedPar).toBe(PROSCIUTTO_EXPECTED.suggestedPar);

    // THE PROSCIUTTO PROOF, stated as a test: without the floor, mean + cushion rounds
    // straight back to the standing par — so the engine would have said NOTHING on the one
    // SKU whose worst weekend is 60% above its own mean.
    expect(unfloored.flooredByPeak).toBe(false);
    expect(unfloored.suggestedPar).toBe(PROSCIUTTO_EXPECTED.unflooredSuggestedPar);
    expect(unfloored.tier).toBe(PROSCIUTTO_EXPECTED.unflooredTier);
  });

  it("p90, not max — one catering-shaped weekend cannot permanently inflate a par", () => {
    // The heaviest observed 3-day run is 135 oz (44+46+45). The floor takes 98.
    expect(floored.peakFloorOz).toBeLessThan(135);
    expect(DYNAMIC_PARS.PEAK_QUANTILE).toBe(0.9);
  });

  it("reaches the auto tier only on the SECOND night, and only as would_apply", () => {
    expect(floored.suppressedBy).toBe("hysteresis"); // direction unconfirmed on night one
    const n2 = simulateNight(prosciuttoNight(priorFrom(floored)));
    expect(n2.tier).toBe("auto");
    expect(n2.outcome).toBe(PROSCIUTTO_EXPECTED.secondNightOutcome);
    expect(n2.outcome).not.toBe("applied"); // v1 is shadow. Nothing applies itself.
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("SCENARIO 4 — the primary flip week: PFG down Tue-Thu, Baldor carries the par", () => {
  const rolled = simulateNight(flipNight(true));
  const unrolled = simulateNight(flipNight(false));

  it("the depletion ledger really does stamp the CARRIER on the outage days", () => {
    const rows = flipDepletionRows();
    const outage = rows.filter((r) => r.skuId === CARRIER_SKU);
    expect(outage.map((r) => r.date)).toEqual(["2026-08-18", "2026-08-19", "2026-08-20"]);
    expect(rows.filter((r) => r.skuId === PRIMARY_SKU).length).toBe(18);
    expect(FLIP_PRODUCT_BY_SKU.get(PRIMARY_SKU)).toBe(FLIP_PRODUCT_BY_SKU.get(CARRIER_SKU));
  });

  it("PRODUCT-GRAIN rates hold through the flip; SKU-grain rates collapse", () => {
    expect(rolled.baseRateOzPerDay).toBe(FLIP_EXPECTED.rolledWeekdayRate);
    expect(unrolled.baseRateOzPerDay).toBe(FLIP_EXPECTED.unrolledWeekdayRate);
    // Same denominator both ways — the register ran on the outage days. The difference is
    // entirely in the numerator, which is exactly the false demand collapse r1-3 names.
    expect(rolled.observedDays).toBe(unrolled.observedDays);
  });

  it("and the collapse would have reached the par: a vendor outage inventing a par cut", () => {
    expect(rolled.suggestedPar).toBe(FLIP_EXPECTED.rolledSuggestedPar);
    expect(rolled.tier).toBe(FLIP_EXPECTED.rolledTier);
    expect(unrolled.suggestedPar).toBe(FLIP_EXPECTED.unrolledSuggestedPar);
    expect(unrolled.tier).toBe(FLIP_EXPECTED.unrolledTier);
    expect(unrolled.suggestedPar!).toBeLessThan(rolled.currentPar!);
  });

  it("R3-B: the write-home is the DESIGNATED primary, never the week's carrier", () => {
    expect(rolled.writeHomeSkuId).toBe(FLIP_EXPECTED.writeHomeSkuId);
    expect(rolled.writeHomeSkuId).not.toBe(CARRIER_SKU);
    // The generation id — the identity a human's accept is arbitrated on — is keyed on the
    // primary too, so an accept during an outage still tunes the slot that survives it.
    const n2 = simulateNight({ ...flipNight(true), currentPar: 6 });
    expect(n2.generationId).toContain(PRIMARY_SKU);
  });

  it("the outage is attributed to the RHYTHM: more days to cover, not less demand", () => {
    const e = FLIP_EXPECTED.skip;
    const args = {
      rhythm: PFG_RHYTHM, cutoffs: PFG_CUTOFFS, locationId: LOCATION,
      walkDateEt: e.walkDateEt, walkMinutesEt: 0,
    };
    const normal = horizonFor({ ...args, skips: [] });
    const skipped = horizonFor({ ...args, skips: PFG_OUTAGE_SKIP });
    expect(normal!.coverThroughDate).toBe(e.normalCoverThrough);
    expect(normal!.coveredDays).toHaveLength(e.normalCoveredDayCount);
    expect(skipped!.nextDeliveryDate).toBe(e.skippedNextDelivery);
    expect(skipped!.coverThroughDate).toBe(e.skippedCoverThrough);
    expect(skipped!.coveredDays).toHaveLength(e.skippedCoveredDayCount);
    // The skipped trucks are inside the covered span — the par is being asked to survive
    // them, which is the honest reading of a vendor outage.
    for (const d of ["2026-08-18", "2026-08-19", "2026-08-20"]) {
      expect(skipped!.coveredDays).toContain(d);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("SCENARIO 5 — 9:58 / 10:02: one ledger row, two walks across a 10:00 cutoff", () => {
  const args = {
    rhythm: PFG_RHYTHM, cutoffs: PFG_CUTOFFS, skips: [], locationId: LOCATION,
    walkDateEt: CUTOFF_WALK_DATE,
  };
  const before = horizonFor({ ...args, walkMinutesEt: CUTOFF_BEFORE_MINUTES });
  const after = horizonFor({ ...args, walkMinutesEt: CUTOFF_AFTER_MINUTES });

  it("four minutes changes which truck the par has to reach", () => {
    expect(before!.nextDeliveryDate).toBe("2026-08-25"); // Monday's order, Tuesday's truck
    expect(before!.coverThroughDate).toBe(CUTOFF_EXPECTED.before.coverThroughDate);
    expect(before!.coveredDays).toHaveLength(CUTOFF_EXPECTED.before.coveredDayCount);
    // Past 10:00 Monday is gone: the order goes in Wednesday and lands Thursday, so the
    // par must now survive to SATURDAY's truck.
    expect(after!.nextDeliveryDate).toBe("2026-08-27");
    expect(after!.coverThroughDate).toBe(CUTOFF_EXPECTED.after.coverThroughDate);
    expect(after!.coveredDays).toHaveLength(CUTOFF_EXPECTED.after.coveredDayCount);
  });

  it("R3-A: ONE persisted row renders two different, both-correct numbers", () => {
    const terms = cutoffTerms();
    const read = (w: NonNullable<typeof before>) =>
      resolveWalkerSuggestion({
        locationId: LOCATION, skuId: "sku-lit", dayClass: "weekday", terms,
        coveredDays: w.coveredDays, coverThroughDate: w.coverThroughDate, canAct: true,
      });
    const b = read(before!);
    const a = read(after!);
    expect(b!.suggestedPar).toBe(CUTOFF_EXPECTED.before.suggestedPar);
    expect(a!.suggestedPar).toBe(CUTOFF_EXPECTED.after.suggestedPar);
    expect(b!.coverThroughDate).toBe(CUTOFF_EXPECTED.before.coverThroughDate);
    expect(a!.coverThroughDate).toBe(CUTOFF_EXPECTED.after.coverThroughDate);
    // The identity moves with the number — that is what the 409 arbitrates on (D14).
    expect(b!.generationId).toBe(CUTOFF_EXPECTED.before.generationId);
    expect(a!.generationId).toBe(CUTOFF_EXPECTED.after.generationId);
    expect(b!.generationId).not.toBe(a!.generationId);
    // The later horizon crosses into Friday, so the number could only be right by reading
    // the WEEKEND rate off the ledger's other half (the Phase-4 both-day-classes ruling).
    expect(after!.coveredDays).toContain("2026-08-28");
  });

  it("and the LEDGER ROW is unchanged by either read — a read path never mutates", () => {
    const terms = cutoffTerms();
    const snapshot = JSON.parse(JSON.stringify(terms)) as unknown;
    for (const w of [before!, after!]) {
      resolveWalkerSuggestion({
        locationId: LOCATION, skuId: "sku-lit", dayClass: "weekday", terms,
        coveredDays: w.coveredDays, coverThroughDate: w.coverThroughDate, canAct: true,
      });
    }
    expect(JSON.parse(JSON.stringify(terms))).toEqual(snapshot);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("SCENARIO 6 — cold start: a ghost kitchen on day one", () => {
  const r = simulateNight(coldStartNight());

  it("names the honest cause and emits no number", () => {
    expect(r.reasonCode).toBe(COLD_START_EXPECTED.reasonCode);
    expect(r.suggestedPar).toBe(COLD_START_EXPECTED.suggestedPar);
    expect(r.tier).toBe(COLD_START_EXPECTED.tier);
    expect(r.baseRateOzPerDay).toBe(COLD_START_EXPECTED.baseRateOzPerDay);
    expect(r.observedDays).toBe(COLD_START_EXPECTED.observedDays);
    expect(r.gapDays).toBe(COLD_START_EXPECTED.gapDays);
    expect(r.base.laneNeverStarted).toBe(COLD_START_EXPECTED.laneNeverStarted);
  });

  it("NO SIBLING NUMBER EITHER — the seam ships live and still buys nothing (r1-11)", () => {
    // At zero observed days the blend weight is a full 1.0: if the prior were wired, a
    // sibling's whole rate would flow straight in. It is not wired, and the silence above
    // is the proof. Asserting the two together is what stops a future reader concluding
    // from the live function that the prior must already be in play.
    expect(COLD_START_EXPECTED.siblingWeightAtZeroDays).toBe(1);
    expect(r.suggestedPar).toBeNull();
    expect(r.targetUnits).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("SCENARIO 7 — the budget-blocked Sunday", () => {
  const { budgetSpentBySlot } = budgetPriorAndBudget();
  const r = simulateNight(budgetBlockedNight());

  it("a simulated move inside the window really does spend the slot's budget", () => {
    expect(budgetSpentBySlot.has(BUDGET_SLOT)).toBe(BUDGET_EXPECTED.budgetSpent);
    expect(DYNAMIC_PARS.BUDGET_MOVES).toBe(1);
    expect(DYNAMIC_PARS.BUDGET_WINDOW_DAYS).toBe(7);
  });

  it("a within-band delta on a spent budget gets its OWN cause, and STILL renders", () => {
    expect(r.suppressedBy).toBe(BUDGET_EXPECTED.suppressedBy);
    expect(r.reasonCode).toBe(BUDGET_EXPECTED.reasonCode);
    expect(r.tier).toBe(BUDGET_EXPECTED.tier);
    expect(r.outcome).toBe(BUDGET_EXPECTED.outcome);
    // THE POINT (projects r3 P2-3): without its own cause this row is neither auto nor
    // suggestion, and renders as a silently stale par. It is not silent.
    expect(r.suggestedPar).toBe(BUDGET_EXPECTED.suggestedPar);
    expect(r.generationId).toBe(BUDGET_EXPECTED.generationId);
    expect(SILENCING_REASONS.has("budget_spent")).toBe(false);
  });

  it("the delta really is INSIDE the band — this is a budget verdict, not a band one", () => {
    const delta = Math.abs(r.suggestedPar! - r.currentPar!);
    expect(delta).toBeLessThanOrEqual(
      Math.max(DYNAMIC_PARS.BAND_PCT * r.currentPar!, r.terms.parStep),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("SCENARIO 8 — graduation day", () => {
  it("both gates, in order, and a revert counts against standing", () => {
    for (const c of GRADUATION_CASES) {
      const s = trustRampState(c.input);
      expect({ netAccepted: s.netAccepted, met: s.met, blockedBy: s.blockedBy }).toEqual({
        netAccepted: c.expected.netAccepted,
        met: c.expected.met,
        blockedBy: c.expected.blockedBy,
      });
    }
    expect(GRADUATION_EXPECTED.rampAccepts).toBe(10);
  });

  it("the count anchor is the gate no location can pass today", () => {
    // Live: `sku_count_events` is 0 at both shops, so `hasDirectCountAnchor` is false
    // everywhere and graduation is unreachable by construction — not by a feature flag.
    const s = trustRampState({
      offered: 99, accepted: 99, reverts: 0, hasDirectCountAnchor: false,
    });
    expect(s.met).toBe(false);
    expect(s.blockedBy).toBe("count_anchor");
  });

  it("GRADUATION WIDENS THE TRIGGER, NEVER THE WRITE SET (r2-3)", () => {
    // A fully graduated location, and a SKU whose demand is prep-mediated while production
    // capture is dark. The location's standing changes nothing about this row: the per-SKU
    // lane gate is not relaxed by graduation, it is a different question entirely.
    expect(trustRampState(GRADUATION_CASES[3]!.input).met).toBe(true);
    const dark = simulateNight(graduatedButDarkNight());
    expect(dark.reasonCode).toBe(GRADUATION_EXPECTED.darkSkuReason);
    expect(dark.suggestedPar).toBe(GRADUATION_EXPECTED.darkSkuSuggestedPar);
    expect(dark.base.laneComplete).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("SCENARIO 9 — a count arrives mid-shadow", () => {
  const before = simulateNight(countArrivesNight());
  const after = simulateNight(countArrivesNight());

  it("the base does not recompute: a count is not a demand term", () => {
    expect(before.suggestedPar).toBe(COUNT_EXPECTED.suggestedPar);
    expect(before.suppressedBy).toBe(COUNT_EXPECTED.suppressedBy);
    expect(before.generationId).toBe(COUNT_EXPECTED.generationId);
    // Byte-identical, term for term. The night a count lands, the ledger row is the row it
    // would have been anyway — which is what makes the suggestion trustworthy on that day.
    expect(after.terms).toEqual(before.terms);
    expect(after.baseRateOzPerDay).toBe(before.baseRateOzPerDay);
    expect(after.peakFloorOz).toBe(before.peakFloorOz);
    expect(after.targetUnits).toBe(before.targetUnits);
    expect(after.generationId).toBe(before.generationId);
  });

  it("and the walker's read over those terms is unchanged too", () => {
    const read = (t: typeof before.terms) =>
      resolveWalkerSuggestion({
        locationId: LOCATION, skuId: "sku-counted", dayClass: "weekday", terms: t,
        coveredDays: ["2026-08-26", "2026-08-27"], coverThroughDate: "2026-08-28", canAct: true,
      });
    expect(read(after.terms)).toEqual(read(before.terms));
    expect(read(before.terms)!.suggestedPar).toBe(COUNT_EXPECTED.suggestedPar);
  });

  it("what the count DOES move is the other engine — and only that one", () => {
    expect(COUNT_EXPECTED.rampBefore.met).toBe(false);
    expect(COUNT_EXPECTED.rampBefore.blockedBy).toBe("count_anchor");
    expect(COUNT_EXPECTED.rampAfter.met).toBe(true);
    expect(COUNT_EXPECTED.rampAfter.blockedBy).toBeNull();
    // Same accepts, same reverts — the ONLY input that changed is the anchor.
    expect(COUNT_EXPECTED.rampAfter.netAccepted).toBe(COUNT_EXPECTED.rampBefore.netAccepted);
  });

  it("STRUCTURALLY: the demand core has no reference to a count anywhere in it", () => {
    // The tempting wrong model is "a count re-anchors on-hand, so surely the suggestion
    // changes". It does not, and the reason is not discipline — it is that `sku_count_*`
    // is not in this module's vocabulary at all. Asserted against the source so a future
    // edit that quietly wires one in fails here rather than in a kitchen.
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "lib", "dynamic-pars-shared.ts"), "utf8");
    expect(src).not.toMatch(/sku_count|countEvent|onHand|on_hand/);
    // The one place a count IS allowed to matter, and it is a graduation gate, not a term.
    expect(src).toContain("hasDirectCountAnchor");
  });
});
