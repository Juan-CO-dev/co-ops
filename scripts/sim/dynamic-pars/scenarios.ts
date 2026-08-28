/**
 * DYNAMIC PARS — the council's scenario walks, frozen as PERMANENT REGRESSION FIXTURES
 * (plan Task 5.1, `docs/superpowers/plans/2026-08-22-dynamic-pars.md`).
 *
 * ── WHY THIS IS A FIXTURE FILE AND NOT A LIVE-DB HARNESS ───────────────────────
 * Every scenario the r3 council walked is ARITHMETIC over the pure core. Arithmetic
 * belongs in CI, not on a manual harness against prod: a harness proves the numbers once,
 * a fixture proves them on every push forever. So this file holds hand-built inputs plus
 * the expected verdict for each, and `tests/dynamic-pars-scenarios.test.ts` asserts them.
 * (`scripts/sim/product-identity/*` remains the pattern for scenarios that genuinely need
 * live rows; none of these do.)
 *
 * ── `simulateNight` IS A MIRROR, NOT A SECOND ENGINE ───────────────────────────
 * The composition below reproduces `runParShadowForLocation`'s per-(SKU, day-class) order
 * (`lib/dynamic-pars.ts`, the ①..⑤ comments) and adds NO rule of its own: every decision is
 * delegated to a shipped pure function. That is deliberate and it is the point — an
 * end-to-end regression that re-implemented a rule would pass while the shipped rule broke.
 * If the engine's ORDER ever changes, this mirror changes with it in the same PR; if a RULE
 * changes, this mirror does not change at all and the fixtures below catch it.
 *
 * The one structural difference from the engine, stated: the engine reaches the horizon
 * through `coverageWindow` at `optimizationWalkDate(dayClass, runDate)`, so a horizon moves
 * as the run date moves. The mirror takes the horizon as an INPUT, because most scenarios
 * hold it constant on purpose to isolate their own subject. `horizonFor` below is the same
 * `coverageWindow` call, exported for the two scenarios whose subject IS the horizon (the
 * primary-flip week's rhythm skip, and the 9:58 / 10:02 pair).
 *
 * ── SOURCES ────────────────────────────────────────────────────────────────────
 * Scenarios 1-5 are the plan's Task-5.1 table (aggie r3 · r3 quarantines · r3 peak floor ·
 * R3-B / projects P2-1 · R3-A). 6-7 are the same task's two "cheap and high-value" adds
 * (cold start · projects P2-3). 8-9 were named by the lead at the Phase-5 brief: the
 * graduation gate, and the count that arrives mid-shadow.
 */
import {
  DYNAMIC_PARS,
  applyGuardStack,
  classifyParReason,
  computeBaseRate,
  computeCoverage,
  computeVelocityRatio,
  cushionFor,
  observedPeakCoverageOz,
  roundToStep,
  siblingBlendWeight,
  trustRampState,
  type BaseRateResult,
  type DayClass,
  type GuardName,
  type GuardOutcome,
  type ParReasonCode,
  type PersistedDemandTerms,
  type VelocityDay,
  type VelocitySignal,
  type WindowDay,
} from "@/lib/dynamic-pars-shared";
import {
  derivePriorAndBudget,
  directionConfirmed,
  rollupPerDate,
  slotKey,
  type LedgerPrior,
} from "@/lib/dynamic-pars-run-shared";
import {
  addDaysEt,
  coverageWindow,
  type CoverageWindow,
  type CutoffRow,
  type RhythmRow,
  type RhythmSkip,
} from "@/lib/vendor-rhythm-shared";
import { etDayFromDate } from "@/lib/et-day-shared";

// ─────────────────────────────────────────────────────────────────────────────
// Calendar helpers — pure, and the only place these fixtures know about dates
// ─────────────────────────────────────────────────────────────────────────────

/** Every ET date from `from` to `to`, inclusive, oldest first. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysEt(d, 1)) out.push(d);
  return out;
}

/** The engine's window: `BASE_WINDOW_DAYS` calendar days ENDING on the run date
 *  (`loadDemandInputs`: `windowStart = runDate - (BASE_WINDOW_DAYS - 1)`). */
export function windowEndingOn(
  runDateEt: string,
  observed: (dateEt: string) => { salesObserved: boolean; productionObserved: boolean } = () => ({
    salesObserved: true,
    productionObserved: false,
  }),
): WindowDay[] {
  const start = addDaysEt(runDateEt, -(DYNAMIC_PARS.BASE_WINDOW_DAYS - 1));
  return datesBetween(start, runDateEt).map((dateEt) => ({
    dateEt,
    dayClass: etDayFromDate(dateEt).weekend ? ("weekend" as DayClass) : ("weekday" as DayClass),
    ...observed(dateEt),
  }));
}

/** The horizon, through the ONE shipped selector. Exported so a scenario whose subject is
 *  the horizon (S4's skip, S5's cutoff) reaches it by the same path the engine does. */
export function horizonFor(args: {
  rhythm: ReadonlyArray<RhythmRow>;
  cutoffs: ReadonlyArray<CutoffRow>;
  skips: ReadonlyArray<RhythmSkip>;
  locationId: string;
  walkDateEt: string;
  walkMinutesEt: number;
}): CoverageWindow | null {
  return coverageWindow(args);
}

// ─────────────────────────────────────────────────────────────────────────────
// The mirror
// ─────────────────────────────────────────────────────────────────────────────

/** The per-SKU facts `loadDemandInputs` resolves before the day-class loop. */
export interface ScenarioSku {
  skuId: string;
  /** `product_id ?? id` — the grain the rates are computed at (r1-3). */
  grainKey: string;
  /** R3-B: the DESIGNATED primary's slot, never the runtime carrier's. */
  primarySkuId: string | null;
  perOrderUnitOz: number | null;
  parStep: number;
  cushionClass: string | null;
  inventoryOnly: boolean;
  productRetired: boolean;
  hasPackChain: boolean;
}

export interface NightInput {
  locationId: string;
  runDateEt: string;
  dayClass: DayClass;
  sku: ScenarioSku;
  window: ReadonlyArray<WindowDay>;
  directOzByDate: ReadonlyMap<string, number>;
  productionOzByDate?: ReadonlyMap<string, number>;
  flattenedOzByDate?: ReadonlyMap<string, number>;
  laneStartAt: string | null;
  suspectDays?: ReadonlySet<string>;
  signalsStartAt: string | null;
  recipeEditedAt?: string | null;
  /** The resolved par for this day-class. null = the slot does not exist (D16). */
  currentPar: number | null;
  coveredDays: ReadonlyArray<string>;
  coverThroughDate: string;
  hasRhythm: boolean;
  prior?: LedgerPrior | null;
  budgetSpent?: boolean;
  pinned?: boolean;
  /** The cron gates on the watermark BEFORE calling the engine; only S-cases that are
   *  ABOUT the stale gate set this false. */
  depletionCurrent?: boolean;
  /**
   * ⚠ FIXTURE-ONLY COUNTERFACTUAL — NOT A KNOB THE ENGINE HAS. There is no way to run the
   * shipped nightly without the peak-coverage floor, and there should not be.
   *
   * It exists because attribution needs it: a scenario that claims "the FLOOR raised this
   * number" or "the BASE moved this number" can only prove it by re-running the identical
   * night with that one term withheld. Every scenario that uses it asserts BOTH runs, and
   * the as-shipped run is always the one that pins the product's behaviour.
   */
  counterfactualNoPeakFloor?: boolean;
}

/** One `par_auto_moves` row, in the shape these fixtures assert against. */
export interface NightResult {
  runDate: string;
  dayClass: DayClass;
  /** R3-B. The auto lane is homed here, never on the carrier that happened to sell. */
  writeHomeSkuId: string;
  tier: "auto" | "suggestion" | "none";
  outcome: "would_apply" | "applied" | "suppressed" | "advisory_null";
  suppressedBy: GuardName | null;
  reasonCode: ParReasonCode;
  generationId: string | null;
  slotCreation: boolean;
  currentPar: number | null;
  suggestedPar: number | null;
  targetUnits: number | null;
  /** The two terms Task 5.1 requires on EVERY row, every night, so the step latency is
   *  visible rather than silent. */
  baseRateOzPerDay: number | null;
  velocityRatio: number;
  velocityApplied: boolean;
  velocityReason: VelocitySignal["reason"];
  observedDays: number;
  gapDays: number;
  thin: boolean;
  cushionPct: number | null;
  perOrderUnitOz: number | null;
  peakFloorOz: number | null;
  demandOz: number | null;
  coveredOz: number | null;
  flooredByPeak: boolean;
  coverageDays: number;
  coverThroughDate: string | null;
  /** What the ledger row hands the walker's read-time re-selection (R3-A). */
  terms: PersistedDemandTerms;
  /** The whole base result, for scenarios that assert on the series itself. */
  base: BaseRateResult;
}

const EMPTY_MAP: ReadonlyMap<string, number> = new Map();

/**
 * ONE NIGHT for ONE (SKU, day-class), composed exactly as `runParShadowForLocation` does:
 *   ① the reason ladder, short-circuiting to a full advisory-null ledger row
 *      (the D16 slot-creation carve-out included — it is NOT a reason to stop computing);
 *   ② the horizon (an input here — see the header);
 *   ③④ cushion · peak floor · coverage;
 *   ⑤ the guard stack, in `shadow` mode, which is the only mode v1 has.
 */
export function simulateNight(input: NightInput): NightResult {
  const sku = input.sku;
  const directOzByDate = input.directOzByDate;
  const productionOzByDate = input.productionOzByDate ?? EMPTY_MAP;
  const flattenedOzByDate = input.flattenedOzByDate ?? EMPTY_MAP;

  const base = computeBaseRate({
    window: input.window,
    directOzByDate,
    productionOzByDate,
    flattenedOzByDate,
    laneStartAt: input.laneStartAt,
  });

  const suspectDays = input.suspectDays ?? new Set<string>();
  const velocitySeries: VelocityDay[] = base.series.map((d) => ({
    dateEt: d.dateEt,
    dayClass: d.dayClass,
    oz: d.oz,
    suspect: suspectDays.has(d.dateEt),
  }));
  const velocity = computeVelocityRatio({
    series: velocitySeries,
    baseByDayClass: {
      weekday: base.byDayClass.weekday.ozPerDay,
      weekend: base.byDayClass.weekend.ozPerDay,
    },
    perOrderUnitOz: sku.perOrderUnitOz,
    recipeEditedAt: input.recipeEditedAt ?? null,
    signalsStartAt: input.signalsStartAt,
  });

  const rate = base.byDayClass[input.dayClass];
  const baseOzPerDay = {
    weekday: base.byDayClass.weekday.ozPerDay,
    weekend: base.byDayClass.weekend.ozPerDay,
  };
  const writeHomeSkuId = sku.primarySkuId ?? sku.skuId;

  const shell = (over: Partial<NightResult> = {}): NightResult => ({
    runDate: input.runDateEt,
    dayClass: input.dayClass,
    writeHomeSkuId,
    tier: "none",
    outcome: "advisory_null",
    suppressedBy: null,
    reasonCode: "ok",
    generationId: null,
    slotCreation: input.currentPar == null,
    currentPar: input.currentPar,
    suggestedPar: null,
    targetUnits: null,
    baseRateOzPerDay: rate.ozPerDay,
    velocityRatio: velocity.ratio,
    velocityApplied: velocity.applied,
    velocityReason: velocity.reason,
    observedDays: rate.observedDays,
    gapDays: rate.gapDays,
    thin: rate.thin,
    cushionPct: null,
    perOrderUnitOz: sku.perOrderUnitOz,
    peakFloorOz: null,
    demandOz: null,
    coveredOz: null,
    flooredByPeak: false,
    coverageDays: 0,
    coverThroughDate: null,
    terms: {
      currentPar: input.currentPar,
      parStep: sku.parStep,
      baseOzPerDay,
      velocityRatio: velocity.ratio,
      velocityApplied: velocity.applied,
      cushionPct: null,
      perOrderUnitOz: sku.perOrderUnitOz,
      peakFloorOz: null,
      priorSuggestedPar: input.prior?.suggestedPar ?? null,
      priorDirection: input.prior?.direction ?? 0,
      reasonCode: "ok",
      ledgerTier: "none",
      suppressedBy: null,
    },
    base,
    ...over,
  });

  // ① THE REASON LADDER. A silenced par is still a WRITE — the reason lane IS the product.
  const reason = classifyParReason({
    inventoryOnly: sku.inventoryOnly,
    productRetired: sku.productRetired,
    depletionCurrent: input.depletionCurrent ?? true,
    laneNeverStarted: base.laneNeverStarted,
    laneComplete: base.laneComplete,
    perOrderUnitOz: sku.perOrderUnitOz,
    hasPackChain: sku.hasPackChain,
    hasRhythm: input.hasRhythm,
    thin: rate.thin,
    slotExists: input.currentPar != null,
    // The engine's own spelling: no day in the window produced anything in either lane.
    noLocalHistory: input.window.every((d) => !d.salesObserved && !d.productionObserved),
  });
  // D16's carve-out: `slot_creation` silences the WALKER, never the computation.
  const silencing = new Set<ParReasonCode>([
    "inventory_only", "product_retired", "no_lane_start", "no_production_capture",
    "no_weight_basis", "unresolvable_pack", "no_vendor_rhythm", "thin_history",
    "stale_depletion", "no_local_history", "zero_target", "par_unit_suspect",
  ]);
  if (silencing.has(reason)) {
    const r = shell({ reasonCode: reason });
    return { ...r, terms: { ...r.terms, reasonCode: reason } };
  }

  // ③④ the terms and the coverage.
  const cushion = cushionFor(
    { cushionClass: sku.cushionClass },
    { id: input.locationId },
    { ozPerDay: rate.ozPerDay, observedDays: rate.observedDays },
  );
  const peakFloorOz = input.counterfactualNoPeakFloor === true
    ? null
    : observedPeakCoverageOz(base.series.map((d) => d.oz), input.coveredDays.length);
  const coverage = computeCoverage({
    coveredDays: input.coveredDays,
    baseOzPerDay,
    velocityRatio: velocity.ratio,
    cushionPct: cushion.pct,
    perOrderUnitOz: sku.perOrderUnitOz,
    peakFloorOz,
  });
  if (coverage == null) {
    // The engine's cause attribution: the ladder already proved perOrderUnitOz non-null,
    // so a null here is a day-class inside the horizon with no rate — thin history.
    const cause: ParReasonCode = sku.perOrderUnitOz == null ? "no_weight_basis" : "thin_history";
    const r = shell({
      reasonCode: cause,
      cushionPct: cushion.pct,
      peakFloorOz,
      coverageDays: input.coveredDays.length,
      coverThroughDate: input.coverThroughDate,
    });
    return { ...r, terms: { ...r.terms, reasonCode: cause, cushionPct: cushion.pct, peakFloorOz } };
  }

  // ⑤ the guard stack — the SAME code live mode runs, with a mode flag (r2-7).
  const roundedTarget = roundToStep(coverage.targetUnits, sku.parStep);
  const verdict: GuardOutcome = applyGuardStack({
    locationId: input.locationId,
    skuId: sku.skuId,
    dayClass: input.dayClass,
    currentPar: input.currentPar,
    targetUnits: coverage.targetUnits,
    parStep: sku.parStep,
    priorSuggestedPar: input.prior?.suggestedPar ?? null,
    priorGenerationId: input.prior?.generationId ?? null,
    directionConfirmed: directionConfirmed(input.prior ?? null, input.currentPar, roundedTarget),
    budgetSpent: input.budgetSpent ?? false,
    pinned: input.pinned ?? false,
    mode: "shadow",
  });

  const r = shell({
    tier: verdict.tier,
    outcome: verdict.outcome,
    suppressedBy: verdict.suppressedBy,
    reasonCode: verdict.reasonCode,
    generationId: verdict.generationId,
    slotCreation: verdict.slotCreation,
    suggestedPar: verdict.suggestedPar,
    targetUnits: coverage.targetUnits,
    cushionPct: cushion.pct,
    peakFloorOz,
    demandOz: coverage.demandOz,
    coveredOz: coverage.coveredOz,
    flooredByPeak: coverage.flooredByPeak,
    coverageDays: input.coveredDays.length,
    coverThroughDate: input.coverThroughDate,
  });
  return {
    ...r,
    terms: {
      ...r.terms,
      cushionPct: cushion.pct,
      peakFloorOz,
      reasonCode: verdict.reasonCode,
      ledgerTier: verdict.tier,
      suppressedBy: verdict.suppressedBy,
    },
  };
}

/**
 * The hysteresis prior a run hands the NEXT run — `derivePriorAndBudget`'s ① rule, in the
 * shape a night-by-night fixture threads. Direction is `sign(suggested − current)`, and a
 * night that proposed nothing confirms nothing.
 */
export function priorFrom(result: NightResult): LedgerPrior {
  return {
    suggestedPar: result.suggestedPar,
    generationId: result.generationId,
    direction:
      result.suggestedPar != null && result.currentPar != null
        ? Math.sign(result.suggestedPar - result.currentPar)
        : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture furniture
// ─────────────────────────────────────────────────────────────────────────────

export const LOCATION = "loc-scenario";

/** PFG's real shape: order Mon/Wed/Fri, one-day lead, a 10:00 ET deadline on each. */
export const PFG_RHYTHM: RhythmRow[] = [1, 3, 5].map((orderDow) => ({
  vendorId: "vendor-pfg",
  locationId: LOCATION,
  orderDow,
  leadDays: 1,
}));
export const PFG_CUTOFFS: CutoffRow[] = [1, 3, 5].map((orderDay) => ({
  locationId: LOCATION,
  orderDay,
  cutoffTime: "10:00",
}));

/** A SKU with every lane lit and nothing exotic: the control against which each scenario
 *  changes exactly one thing. 12 oz per order unit, no cushion class (→ the 20% default). */
export function litSku(over: Partial<ScenarioSku> = {}): ScenarioSku {
  return {
    skuId: "sku-lit",
    grainKey: "sku-lit",
    primarySkuId: null,
    perOrderUnitOz: 12,
    parStep: 1,
    cushionClass: null,
    inventoryOnly: false,
    productRetired: false,
    hasPackChain: true,
    ...over,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 1 — THE HAM WEEK: demand steps +40% (a new sandwich)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Source: aggie r3 · plan Task 5.1 row 1.
 *
 * THE ASSERTION THAT MUST NEVER REGRESS. A trailing 21-day mean is a SLOW instrument, and
 * the arc's answer to that is not to speed it up — it is to make the slowness VISIBLE.
 * Every night's ledger row carries both the base rate and the velocity ratio, so the whole
 * three-week absorption is readable off the ledger rather than inferred from a par that
 * did not move. This is the behaviour aggie's r3 P1 demanded be documented, not hidden.
 *
 * The fixture holds the horizon constant (2 weekday covered days) so the ONLY thing moving
 * is demand — S5 is the scenario whose subject is the horizon.
 *
 * PRE-STEP CALIBRATION: 40 oz/day weekday × 2 covered days = 80 oz, +20% cushion = 96 oz,
 * ÷ 12 oz per order unit = EXACTLY the standing par of 8. The par is correct on the night
 * before the step, which is what makes every later night's delta attributable to demand.
 */
export const STEP_DATE = "2026-08-03"; // a Monday — see REFERENCE_WEEK_SUNDAY arithmetic.
const HAM_WEEKDAY_OZ = 40;
const HAM_WEEKEND_OZ = 60;
export const HAM_STEP_MULTIPLIER = 1.4;
export const HAM_PAR = 8;

/** Night `k` is the run whose 21-day window ends on `STEP_DATE + (k-1)` — i.e. the window
 *  contains exactly `k` stepped days. Night 1 is the night of the step itself. */
export function hamNightRunDate(k: number): string {
  return addDaysEt(STEP_DATE, k - 1);
}

function hamOzFor(dateEt: string): number {
  const weekend = etDayFromDate(dateEt).weekend;
  const flat = weekend ? HAM_WEEKEND_OZ : HAM_WEEKDAY_OZ;
  return dateEt >= STEP_DATE ? flat * HAM_STEP_MULTIPLIER : flat;
}

/** Every date any of the 21 nights can see, with its oz. Built once, sliced per night. */
export function hamSeries(): Map<string, number> {
  const first = addDaysEt(hamNightRunDate(1), -(DYNAMIC_PARS.BASE_WINDOW_DAYS - 1));
  const last = hamNightRunDate(21);
  return new Map(datesBetween(first, last).map((d) => [d, hamOzFor(d)]));
}

/**
 * @param velocityLive  false reproduces TODAY's live state — `toast_daily_sales_signals`
 *   has no row for this location yet, so velocity is gated off at `signals_too_new` and
 *   the suggestion is driven by the flat 21-day base ALONE. That is the track the council
 *   walked when it said the base "crosses the band at ~day 18".
 * @param noFloor  the attribution counterfactual (see `NightInput`). The as-shipped track
 *   runs with the floor ON and is asserted too.
 */
export function hamNight(
  k: number,
  opts: { velocityLive: boolean; noFloor: boolean },
  prior: LedgerPrior | null,
): NightInput {
  const runDateEt = hamNightRunDate(k);
  return {
    locationId: LOCATION,
    runDateEt,
    dayClass: "weekday",
    sku: litSku({ skuId: "sku-ham" }),
    window: windowEndingOn(runDateEt),
    directOzByDate: hamSeries(),
    laneStartAt: "2026-06-01",
    // A signals row that predates the window: velocity's clamp is satisfied, so the gate
    // that decides is PERSISTENCE, not availability.
    signalsStartAt: opts.velocityLive ? "2026-06-01" : null,
    currentPar: HAM_PAR,
    // Tue + Wed off a Monday walk on PFG's Mon/Wed/Fri rhythm — held constant on purpose.
    coveredDays: ["2026-08-04", "2026-08-05"],
    coverThroughDate: "2026-08-06",
    hasRhythm: true,
    prior,
    counterfactualNoPeakFloor: opts.noFloor,
  };
}

/** Run all 21 nights, threading the hysteresis prior exactly as the nightly job does. */
export function hamWeekRun(opts: { velocityLive: boolean; noFloor: boolean }): NightResult[] {
  const out: NightResult[] = [];
  let prior: LedgerPrior | null = null;
  for (let k = 1; k <= 21; k += 1) {
    const r = simulateNight(hamNight(k, opts, prior));
    out.push(r);
    prior = priorFrom(r);
  }
  return out;
}

export const HAM_WEEK_EXPECTED = {
  /**
   * THE BASE ALONE (velocity gated off, peak floor withheld) — the council's own track.
   *
   * ⚠ DEVIATION FROM THE TASK'S "~day 18", ARGUED. With the band's own arithmetic — par 8,
   * step 1, `max(1 step, 25%)` = 2, so the band breaks at a rounded target of 11 — a +40%
   * step needs ~78% of the window's 12 weekday points to be post-step, which lands on
   * night 16, not 18. "~day 18" was an estimate on this same model; the DURABLE claim it
   * was making is what is pinned: over two weeks of latency, and every night says so.
   */
  baseOnly: {
    /** Night 1 says nothing at all, and correctly: the par was RIGHT the day before the
     *  step, and one stepped day inside a 21-day mean does not move a rounded target. */
    firstSilentNight: 1,
    firstRenderedNight: 2,
    firstRenderedSuggestion: 9,
    firstWouldApplyNight: 3,
    /** The deadband holds the rendered suggestion at 9 from night 2 to night 15 while the
     *  underlying target climbs 8.53 → 10.40 — the accepted cost of damping a one-step
     *  wobble (LEAD RULING F2), made visible rather than argued about. */
    deadbandHeldSuggestion: 9,
    deadbandHeldThroughNight: 15,
    bandCrossNight: 16,
    bandCrossSuggestion: 11,
    finalSuggestion: 11,
  },
  /** Velocity is a RESIDUAL and needs `VELOCITY_MIN_PERSISTENCE_DAYS` = 3 same-signed days
   *  past the deadband, so it sees the step on the third stepped day — inside the first
   *  week, against sixteen nights for the base. The council said "day 4" counting the day
   *  before the step as day 1; the fact is the same one. */
  velocityOnly: {
    firstAppliedNight: 3,
    bandCrossNight: 3,
    bandCrossSuggestion: 11,
    /** Bounded and dimensionless: the cap is what stops a residual becoming a par. */
    cappedRatio: 1 + DYNAMIC_PARS.VELOCITY_CAP,
    /** And it hands itself back once the base has absorbed the step: the residual falls
     *  inside the deadband and velocity stops claiming momentum that is now just trend. */
    lastAppliedNight: 14,
  },
  /**
   * AS SHIPPED — and it carries a finding worth stating in the fixture rather than
   * discovering in a year: THE PEAK-COVERAGE FLOOR IS THIS ARC'S FAST RESPONDER.
   *
   * The floor asks "what is the worst run this shop has actually had over a horizon this
   * long", and two days after a step that answer is already the NEW level, while the
   * 21-day mean is still three weeks from it. So on the composed engine the floor breaks
   * the band on night 7 — before velocity's own band break would have mattered and nine
   * nights before the base gets there. That is the floor doing exactly its job (a
   * percentage on a mean is not a service level), not a defect; it is pinned here so a
   * later reader does not mistake it for one, and so the ~3-week base latency is measured
   * against the right baseline.
   */
  asShipped: {
    bandCrossNight: 7,
    bandCrossSuggestion: 12,
    finalSuggestion: 14,
    /** And a second fact that falls out of the same arithmetic: while the floor is the
     *  binding term, velocity changes the target but NOT the rendered suggestion — the
     *  one-step deadband absorbs its early nudge, because the floor has already moved the
     *  number velocity was trying to move. Two safety terms, no double-count. */
    velocityChangesNoRenderedSuggestion: true,
  },
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 2 — THE MOZZ UNIT BOMB: eaches read as cases
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Source: r3 quarantines · plan Task 5.1 row 2.
 *
 * A target 4× the standing par is a PACK problem wearing a demand costume. The quarantine
 * runs BEFORE any band arithmetic and emits NO NUMBER — because a suggestion here would be
 * a confident number with nothing behind it, and the errand it should have raised (fix the
 * SKU's pack chain) would never be raised at all.
 */
export function mozzUnitBombNight(): NightInput {
  const runDateEt = "2026-08-25";
  // The pack chain says one order unit is 2 oz (an EACH) when the shop actually orders
  // 24-each CASES. ~120 oz of coverage therefore comes back as ~60 ORDER UNITS against a
  // standing par of 4 — fifteen times the par, from a SKU whose demand never changed.
  const series = new Map(
    windowEndingOn(runDateEt).map((d) => [d.dateEt, d.dayClass === "weekend" ? 60 : 48]),
  );
  return {
    locationId: LOCATION,
    runDateEt,
    dayClass: "weekday",
    sku: litSku({ skuId: "sku-mozz", perOrderUnitOz: 2 }),
    window: windowEndingOn(runDateEt),
    directOzByDate: series,
    laneStartAt: "2026-06-01",
    signalsStartAt: null,
    currentPar: 4,
    coveredDays: ["2026-08-26", "2026-08-27"],
    coverThroughDate: "2026-08-28",
    hasRhythm: true,
  };
}

export const MOZZ_EXPECTED = {
  reasonCode: "par_unit_suspect" as ParReasonCode,
  /** 15x the standing par. The quarantine runs BEFORE the band, so this never even
   *  reaches the arithmetic that would have rendered it as a demand move. */
  targetUnits: 60,
  suggestedPar: null,
  tier: "none" as const,
  outcome: "advisory_null" as const,
  generationId: null,
  /** It is an ERRAND, not a fault to be scrolled past: the cause is in ERRAND_REASONS and
   *  the panel names the SKU. */
  errandNamesTheSku: "sku-mozz",
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 3 — THE PROSCIUTTO FLOOR: mean + 20% under the worst observed run
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Source: r3 peak floor · plan Task 5.1 row 3.
 *
 * THE PROSCIUTTO PROOF: a percentage on a MEAN is not a service level. Live, Prosciutto
 * (Boar's Head) moves ~435 oz over the ledger's 30 days — 14.5 oz/day — and it is violently
 * weekend-shaped. Mean + 20% produced a par the worst observed weekend cleared by 2%: a
 * cushion that covers the average and fails the day it was bought for.
 *
 * The fixture reproduces that SHAPE on the engine's own 21-day window (12 weekday + 9
 * weekend points, exactly as the live probe found), scaled to the live 14.5 oz/day mean:
 * 305 oz over 21 days. Weekends run 12-13-12, 44-46-45, 16-17-16 — one genuinely heavy
 * week and two quiet ones, which is what makes a mean lie.
 *
 * Without the floor the arithmetic says "no change"; with it, the par must rise. That is
 * the whole point of the floor and it is why the assertion runs BOTH ways.
 */
const PROSCIUTTO_RUN_DATE = "2026-08-25";
const PROSCIUTTO_WEEKDAY_OZ = 7;
const PROSCIUTTO_WEEKEND_OZ: Record<string, number> = {
  "2026-08-07": 12, "2026-08-08": 13, "2026-08-09": 12,
  "2026-08-14": 44, "2026-08-15": 46, "2026-08-16": 45,
  "2026-08-21": 16, "2026-08-22": 17, "2026-08-23": 16,
};

export function prosciuttoSeries(): Map<string, number> {
  return new Map(
    windowEndingOn(PROSCIUTTO_RUN_DATE).map((d) => [
      d.dateEt,
      PROSCIUTTO_WEEKEND_OZ[d.dateEt] ?? PROSCIUTTO_WEEKDAY_OZ,
    ]),
  );
}

/** @param noFloor re-runs the IDENTICAL night with the peak floor withheld, which is the
 *  only honest way to assert "the floor is what raised the number". */
export function prosciuttoNight(
  prior: LedgerPrior | null = null,
  noFloor = false,
): NightInput {
  return {
    counterfactualNoPeakFloor: noFloor,
    locationId: LOCATION,
    runDateEt: PROSCIUTTO_RUN_DATE,
    dayClass: "weekend",
    sku: litSku({ skuId: "sku-prosciutto", perOrderUnitOz: 14, cushionClass: "protein" }),
    window: windowEndingOn(PROSCIUTTO_RUN_DATE),
    directOzByDate: prosciuttoSeries(),
    laneStartAt: "2026-06-01",
    signalsStartAt: null,
    currentPar: 6, // Prosciutto's live weekend par.
    // The Friday walk optimises the weekend slot (r3, the longest gap): Fri/Sat/Sun.
    coveredDays: ["2026-08-28", "2026-08-29", "2026-08-30"],
    coverThroughDate: "2026-08-31",
    hasRhythm: true,
    prior,
  };
}

export const PROSCIUTTO_EXPECTED = {
  /** The live figure the shape is scaled from, asserted so the fixture cannot silently
   *  drift off the series it claims to reproduce. */
  seriesTotalOz: 305,
  weekendObservedDays: 9,
  weekdayObservedDays: 12,
  /** p90 of the nineteen 3-day runs. Not the max (135) — one catering-shaped weekend must
   *  not permanently inflate a par — and not the mean either. */
  peakFloorOz: 98,
  /** mean weekend rate 221/9 = 24.5556 × 3 days × 1.20 = 88.40 oz. */
  cushionedMeanOz: 88.400002,
  flooredByPeak: true,
  suggestedPar: 7,
  /** The counterfactual: mean + cushion alone rounds back to the standing par, so the
   *  engine would have said NOTHING on the very SKU the floor exists for. */
  unflooredSuggestedPar: null,
  unflooredTier: "none" as const,
  /** Night two, once the direction is confirmed, is the earliest a within-band move can
   *  reach the auto tier — and in shadow that is `would_apply`, never `applied`. */
  secondNightOutcome: "would_apply" as const,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 4 — THE PRIMARY FLIP WEEK: PFG down Tue-Thu, Baldor carries the par
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Source: head ruling R3-B · projects P2-1 · plan Task 5.1 row 4.
 *
 * TWO THINGS MUST HOLD THROUGH A FLIP, and they fail in opposite directions:
 *
 *  ① THE RATE MUST NOT COLLAPSE. Depletion rows are stamped with the RESOLVED member, so
 *     at SKU grain a flip reads as demand collapse on one twin and a spike on the other.
 *     `rollupPerDate` nets them at PRODUCT grain PER DATE — per date, because rolling the
 *     whole window would fix the total and leave the daily series (which velocity and the
 *     peak floor read) wrong on exactly the days the flip straddles.
 *
 *  ② THE WRITE-HOME MUST NOT MOVE. The auto lane is homed on the DESIGNATED primary's
 *     slot, never on the carrier that happened to sell that week — otherwise the tuned par
 *     evaporates the moment PFG comes back (R3-B).
 *
 * And the outage itself is attributed to the RHYTHM, not to demand: a vendor-down skip
 * lengthens the horizon, so the par is asked to cover more days rather than being read as
 * a vendor whose numbers disagree.
 */
export const PRIMARY_SKU = "sku-ham-pfg";
export const CARRIER_SKU = "sku-ham-baldor";
export const HAM_PRODUCT = "product-ham";
const FLIP_RUN_DATE = "2026-08-25";
const FLIP_OUTAGE = ["2026-08-18", "2026-08-19", "2026-08-20"]; // Tue-Thu.

/** Raw depletion rows, exactly as the ledger stamps them: the RESOLVED member carries the
 *  oz, so the twin that was down has literally no row on the outage days.
 *
 *  A FLAT 40 oz/day — ham moves the same every day of the week — so the peak-coverage
 *  floor does not bind and the only thing that can move this scenario's number is the
 *  rollup. (Give it S3's weekend shape and the floor masks the collapse, which would make
 *  this fixture pass for the wrong reason.) */
export function flipDepletionRows(): Array<{ date: string; skuId: string; oz: number }> {
  const rows: Array<{ date: string; skuId: string; oz: number }> = [];
  for (const day of windowEndingOn(FLIP_RUN_DATE)) {
    const carried = FLIP_OUTAGE.includes(day.dateEt);
    rows.push({ date: day.dateEt, skuId: carried ? CARRIER_SKU : PRIMARY_SKU, oz: 40 });
  }
  return rows;
}

export const FLIP_PRODUCT_BY_SKU: ReadonlyMap<string, string> = new Map([
  [PRIMARY_SKU, HAM_PRODUCT],
  [CARRIER_SKU, HAM_PRODUCT],
]);

/** The ONE shipped rollup, applied per date — never re-expressed here. */
export function flipRolledSeries(productBySku: ReadonlyMap<string, string>): Map<string, number> {
  const byDate = rollupPerDate(
    flipDepletionRows(),
    (r) => r.date,
    (r) => r.skuId,
    (r) => r.oz,
    productBySku,
  );
  const out = new Map<string, number>();
  for (const [date, perSku] of byDate) {
    const v = perSku.get(PRIMARY_SKU);
    if (v != null) out.set(date, v);
  }
  return out;
}

export function flipNight(rolled: boolean): NightInput {
  return {
    locationId: LOCATION,
    runDateEt: FLIP_RUN_DATE,
    dayClass: "weekday",
    sku: litSku({
      skuId: PRIMARY_SKU,
      grainKey: HAM_PRODUCT,
      primarySkuId: PRIMARY_SKU, // the DESIGNATED primary — R3-B's whole subject.
    }),
    window: windowEndingOn(FLIP_RUN_DATE),
    // `rolled: false` is the counterfactual — what the SKU-grain read would have produced.
    directOzByDate: flipRolledSeries(rolled ? FLIP_PRODUCT_BY_SKU : new Map()),
    laneStartAt: "2026-06-01",
    signalsStartAt: null,
    currentPar: 8,
    coveredDays: ["2026-08-26", "2026-08-27"],
    coverThroughDate: "2026-08-28",
    hasRhythm: true,
  };
}

/** The vendor-down window as the rhythm sees it: PFG delivers nothing Tue-Thu. */
export const PFG_OUTAGE_SKIP: RhythmSkip[] = [
  { vendorId: "vendor-pfg", skipFrom: "2026-08-18", skipThrough: "2026-08-20" },
];

export const FLIP_EXPECTED = {
  /** Product-grain: every observed weekday carries the same 40 oz, outage or not. */
  rolledWeekdayRate: 40,
  /** SKU-grain, the bug this rollup exists to prevent: three weekday points fall to a TRUE
   *  ZERO in the numerator while the register-ran denominator keeps counting them. */
  unrolledWeekdayRate: 30,
  /** 2 covered days x 40 oz x 1.20 = 96 oz / 12 = exactly the standing par of 8. The par
   *  is right, so the honest answer through a flip is NO MOVEMENT. */
  rolledSuggestedPar: null,
  rolledTier: "none" as const,
  /** …and at SKU grain a vendor outage invents a par CUT on the twin that stayed up. Note
   *  the peak floor partly cushions it (72 oz of cushioned mean is floored back up to the
   *  80 oz of a real observed 2-day run) — and the par still comes down a step. A safety
   *  term that softens a wrong number is not a substitute for the right number. */
  unrolledSuggestedPar: 7,
  unrolledTier: "suggestion" as const,
  writeHomeSkuId: PRIMARY_SKU,
  /** The outage is a RHYTHM fact, and it is attributed to the rhythm. A Monday 2026-08-17
   *  walk normally covers to Thursday's truck; with PFG's trucks skipped Tue-Thu the same
   *  walk must survive to the following Monday. The par is asked to cover more DAYS — it
   *  is never read as a vendor whose demand disagrees. */
  skip: {
    walkDateEt: "2026-08-17",
    normalCoverThrough: "2026-08-20",
    normalCoveredDayCount: 2,
    skippedNextDelivery: "2026-08-22",
    skippedCoverThrough: "2026-08-25",
    skippedCoveredDayCount: 7,
  },
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 5 — 9:58 / 10:02: one ledger row, two walks across a 10:00 cutoff
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Source: head ruling R3-A · plan Task 5.1 row 5.
 *
 * The nightly persists the DEMAND TERMS; the walk re-selects only the HORIZON. Four
 * minutes either side of PFG's 10:00 deadline is the difference between catching tomorrow's
 * truck and ordering against Wednesday's — so the same ledger row must render two different
 * numbers, both correct, and must itself be UNCHANGED by either read.
 *
 * Monday 2026-08-24, PFG Mon/Wed/Fri + 1 day lead:
 *   09:58 → order Mon, truck Tue; next order Wed, truck Thu ⇒ cover Tue+Wed (2 days).
 *   10:02 → Monday is missed; order Wed, truck Thu; next order Fri, truck Sat ⇒ cover
 *           Tue..Fri (4 days) — and Friday is a WEEKEND day, so the read needs the weekend
 *           rate off the ledger's OTHER half. That is the Phase-4 both-day-classes ruling,
 *           reproduced end to end.
 */
export const CUTOFF_WALK_DATE = "2026-08-24"; // a Monday.
export const CUTOFF_BEFORE_MINUTES = 9 * 60 + 58;
export const CUTOFF_AFTER_MINUTES = 10 * 60 + 2;

/** The persisted terms of ONE nightly row. Frozen: a read that mutates it is the bug. */
export function cutoffTerms(): PersistedDemandTerms {
  return {
    currentPar: 10,
    parStep: 1,
    baseOzPerDay: { weekday: 40, weekend: 60 },
    velocityRatio: 1,
    velocityApplied: false,
    cushionPct: 0.2,
    perOrderUnitOz: 12,
    peakFloorOz: null,
    priorSuggestedPar: null,
    priorDirection: 0,
    reasonCode: "ok",
    ledgerTier: "suggestion",
    suppressedBy: null,
  };
}

export const CUTOFF_EXPECTED = {
  before: {
    coverThroughDate: "2026-08-27",
    coveredDayCount: 2,
    // 40 + 40 = 80 oz, +20% = 96, ÷ 12 = 8.
    suggestedPar: 8,
    generationId: `${LOCATION}:sku-lit:weekday:10>8`,
  },
  after: {
    coverThroughDate: "2026-08-29",
    coveredDayCount: 4,
    // 40 + 40 + 40 + 60 (Friday is weekend) = 180 oz, +20% = 216, ÷ 12 = 18.
    suggestedPar: 18,
    generationId: `${LOCATION}:sku-lit:weekday:10>18`,
  },
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 6 — COLD START: a ghost kitchen on day one
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Source: plan Task 5.1's first "cheap and high-value" add · original §Scale-readiness.
 *
 * A location with zero observed days gets `no_local_history` and NO NUMBER — and, the part
 * that matters, NO SIBLING NUMBER EITHER. `siblingBlendWeight` ships (it is tested, and at
 * zero observed days it returns a full 1.0 weight), but it is NOT WIRED: the Add-a-Location
 * arc owns the rest. Asserting the weight AND the silence together is what stops a future
 * reader concluding from the live function that the prior must already be in play — the
 * delta-honesty the whole reason lane rests on.
 */
export function coldStartNight(): NightInput {
  const runDateEt = "2026-08-25";
  return {
    locationId: "loc-ghost-kitchen",
    runDateEt,
    dayClass: "weekday",
    sku: litSku({ skuId: "sku-cold" }),
    // The register has never run here: neither oracle has ever fired.
    window: windowEndingOn(runDateEt, () => ({
      salesObserved: false,
      productionObserved: false,
    })),
    directOzByDate: new Map(),
    // The engine derives `laneStartAt` as the first window day this identity produced
    // anything in EITHER lane. At a shop that has never opened the register, that is null.
    laneStartAt: null,
    signalsStartAt: null,
    currentPar: 8,
    coveredDays: ["2026-08-26", "2026-08-27"],
    coverThroughDate: "2026-08-28",
    hasRhythm: true,
  };
}

export const COLD_START_EXPECTED = {
  /** THE LADDER'S ORDER IS THE ERRAND. `no_local_history` outranks `no_lane_start`, and it
   *  has to: both are true here, but only one of them tells a new shop the honest thing —
   *  "nothing has happened here yet", not "this SKU's lane is broken". */
  reasonCode: "no_local_history" as ParReasonCode,
  suggestedPar: null,
  tier: "none" as const,
  baseRateOzPerDay: null,
  observedDays: 0,
  gapDays: 0, // laneStartAt null short-circuits before any day is even classified.
  laneNeverStarted: true,
  /** The seam is live and returns a full-strength weight — and it still buys no number. */
  siblingWeightAtZeroDays: siblingBlendWeight(0),
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 7 — BUDGET-BLOCKED SUNDAY: a within-band delta on a spent budget
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Source: projects r3 P2-3 · plan Task 5.1's second "cheap and high-value" add.
 *
 * A delta INSIDE the band on a slot whose one weekly move is already spent is neither an
 * auto-move nor a plain suggestion. Without its own cause it would render as a silently
 * stale par — the failure mode the reason lane exists to end. It gets `budget_spent`, it
 * still RENDERS ITS NUMBER, and the human can take it with one tap (an accept is free —
 * the incentive must never punish engagement).
 */
const BUDGET_RUN_DATE = "2026-08-30"; // a Sunday — the weekend slot.
export const BUDGET_SLOT = slotKey("sku-lit", "weekend");

/** The ledger as `derivePriorAndBudget` reads it: one simulated move four nights ago,
 *  inside the 7-day window, from an EARLIER run than this one. */
export function budgetLedgerRows() {
  return [
    {
      skuId: "sku-lit", dayClass: "weekend", runDate: "2026-08-29", outcome: "advisory_null",
      currentPar: 6, suggestedPar: 7, generationId: `${LOCATION}:sku-lit:weekend:6>7`,
    },
    {
      skuId: "sku-lit", dayClass: "weekend", runDate: "2026-08-26", outcome: "would_apply",
      currentPar: 6, suggestedPar: 7, generationId: `${LOCATION}:sku-lit:weekend:6>7`,
    },
  ];
}

export function budgetPriorAndBudget() {
  return derivePriorAndBudget(budgetLedgerRows(), [], {
    runDateEt: BUDGET_RUN_DATE,
    budgetFrom: addDaysEt(BUDGET_RUN_DATE, -DYNAMIC_PARS.BUDGET_WINDOW_DAYS),
  });
}

export function budgetBlockedNight(): NightInput {
  const { priorBySlot, budgetSpentBySlot } = budgetPriorAndBudget();
  // 45 oz/day weekend over 3 covered days = 135 oz, +20% = 162, ÷ 24 = 6.75 → a rounded
  // target of 7 against a standing weekend par of 6: ONE step, comfortably inside the
  // band's `max(1 step, 25%)` = 1.5. Exactly the delta the machine would have taken.
  const series = new Map(
    windowEndingOn(BUDGET_RUN_DATE).map((d) => [d.dateEt, d.dayClass === "weekend" ? 45 : 20]),
  );
  return {
    locationId: LOCATION,
    runDateEt: BUDGET_RUN_DATE,
    dayClass: "weekend",
    sku: litSku({ perOrderUnitOz: 24 }),
    window: windowEndingOn(BUDGET_RUN_DATE),
    directOzByDate: series,
    laneStartAt: "2026-06-01",
    signalsStartAt: null,
    currentPar: 6,
    coveredDays: ["2026-09-04", "2026-09-05", "2026-09-06"],
    coverThroughDate: "2026-09-07",
    hasRhythm: true,
    prior: priorBySlot.get(BUDGET_SLOT) ?? null,
    budgetSpent: budgetSpentBySlot.has(BUDGET_SLOT),
  };
}

export const BUDGET_EXPECTED = {
  budgetSpent: true,
  reasonCode: "budget_spent" as ParReasonCode,
  suppressedBy: "budget" as GuardName,
  tier: "suggestion" as const,
  outcome: "suppressed" as const,
  /** THE POINT: the number still renders. A budget-blocked par is not a silent par. */
  suggestedPar: 7,
  /** …and it is offered with a real generation id, so the human's one tap is arbitrable. */
  generationId: `${LOCATION}:sku-lit:weekend:6>7`,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 8 — GRADUATION DAY: the trust ramp and the count anchor
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Source: r1 · r2-2 · r2-3 · r3 (the ramp counts DISTINCT GENERATIONS).
 *
 * TWO GATES, AND THE SECOND ONE IS THE REASON NO LOCATION CAN GRADUATE TODAY: N net
 * accepts inside the window, AND a DIRECT physical count anchor (`allocated_from_product_id
 * IS NULL` — a product-level count allocates a line to every member, so accepting allocated
 * lines would let one count anchor an entire product at once). Live, `sku_count_events` is
 * 0 at both shops, so the second gate is unreachable by construction.
 *
 * AND THE LAW THAT MATTERS MOST: GRADUATION WIDENS THE TRIGGER, NEVER THE WRITE SET (r2-3).
 * A graduated location still auto-writes only lane-lit SKUs — so the fixture pairs a fully
 * met ramp with a SKU the reason ladder silences, and asserts the silence is untouched.
 */
export const GRADUATION_CASES = [
  {
    name: "short of the ramp",
    input: { offered: 14, accepted: 9, reverts: 0, hasDirectCountAnchor: true },
    expected: { netAccepted: 9, met: false, blockedBy: "ramp" as const },
  },
  {
    name: "ramp met, no direct count anchor — today's live state at both shops",
    input: { offered: 20, accepted: 10, reverts: 0, hasDirectCountAnchor: false },
    expected: { netAccepted: 10, met: false, blockedBy: "count_anchor" as const },
  },
  {
    name: "a post-graduation revert counts AGAINST standing",
    input: { offered: 20, accepted: 11, reverts: 2, hasDirectCountAnchor: true },
    expected: { netAccepted: 9, met: false, blockedBy: "ramp" as const },
  },
  {
    name: "graduation day",
    input: { offered: 20, accepted: 10, reverts: 0, hasDirectCountAnchor: true },
    expected: { netAccepted: 10, met: true, blockedBy: null },
  },
] as const;

/** A SKU whose demand is prep-mediated while production capture is dark. A graduated
 *  location must still say NOTHING about it. */
export function graduatedButDarkNight(): NightInput {
  const runDateEt = "2026-08-25";
  const window = windowEndingOn(runDateEt);
  return {
    locationId: LOCATION,
    runDateEt,
    dayClass: "weekday",
    sku: litSku({ skuId: "sku-prep-mediated" }),
    window,
    directOzByDate: new Map(),
    productionOzByDate: new Map(),
    // Flattened oz WITHOUT production oz = prep-mediated demand with a dark lane. Read to
    // DETECT the mediation and never summed — the double-count law is not in play.
    flattenedOzByDate: new Map(window.map((d) => [d.dateEt, 30])),
    laneStartAt: "2026-06-01",
    signalsStartAt: null,
    currentPar: 8,
    coveredDays: ["2026-08-26", "2026-08-27"],
    coverThroughDate: "2026-08-28",
    hasRhythm: true,
  };
}

export const GRADUATION_EXPECTED = {
  rampAccepts: DYNAMIC_PARS.TRUST_RAMP_ACCEPTS,
  darkSkuReason: "no_production_capture" as ParReasonCode,
  darkSkuSuggestedPar: null,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 9 — A COUNT ARRIVES MID-SHADOW
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Source: the lead's Phase-5 brief.
 *
 * Juan's first physical count is the arc's most anticipated event, and it is worth pinning
 * exactly what it does and does not do. IT IS NOT A DEMAND INPUT. `computeBaseRate` reads
 * three oz lanes and two observability oracles; a `sku_count_events` row is none of them.
 * So the night the first count lands, every persisted term — base rate, velocity, cushion,
 * peak floor, target, verdict, generation id — is BYTE-IDENTICAL to the night before, and
 * the walker renders the same number.
 *
 * What the count DOES move is the OTHER engine: `trustRampState`'s second gate. The two
 * stay separate, and this fixture is the proof — because the tempting wrong model ("a count
 * re-anchors on-hand, so surely the suggestion changes") would have the machine quietly
 * re-deriving demand from an inventory event, which is a different arc entirely.
 */
export function countArrivesNight(): NightInput {
  const runDateEt = "2026-08-25";
  // Flat 40 oz/day, so the peak floor does not bind and the number on the ledger is the
  // demand arithmetic and nothing else — which is what makes "unchanged" mean something.
  const series = new Map(windowEndingOn(runDateEt).map((d) => [d.dateEt, 40]));
  return {
    locationId: LOCATION,
    runDateEt,
    dayClass: "weekday",
    sku: litSku({ skuId: "sku-counted" }),
    window: windowEndingOn(runDateEt),
    directOzByDate: series,
    laneStartAt: "2026-06-01",
    signalsStartAt: null,
    currentPar: 6,
    coveredDays: ["2026-08-26", "2026-08-27"],
    coverThroughDate: "2026-08-28",
    hasRhythm: true,
  };
}

export const COUNT_EXPECTED = {
  /** 2 x 40 oz x 1.20 = 96 oz / 12 = 8 against a par of 6 — a two-step move, beyond the
   *  band's `max(1 step, 25%)` = 1.5, so a suggestion at the full honest target (F1). */
  suggestedPar: 8,
  suppressedBy: "band" as GuardName,
  generationId: `${LOCATION}:sku-counted:weekday:6>8`,
  /** Before the count and after it — the same object, because a count is not a demand term. */
  rampBefore: trustRampState({
    offered: 20, accepted: 10, reverts: 0, hasDirectCountAnchor: false,
  }),
  rampAfter: trustRampState({
    offered: 20, accepted: 10, reverts: 0, hasDirectCountAnchor: true,
  }),
} as const;
