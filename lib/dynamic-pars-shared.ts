/**
 * DYNAMIC PARS — the pure demand, coverage and guard core.
 *
 * PURE: client-safe, zero I/O, no server imports (the `*-shared.ts` pattern, AGENTS.md).
 * Both the nightly engine (lib/dynamic-pars.ts) and the walker's read path import from here,
 * so there is exactly ONE spelling of every rule.
 *
 * ── THE TWO HALVES, AND WHY THEY ARE SPLIT (head ruling R3-A) ──────────────────
 *   computeBaseRate / computeVelocityRatio  — HEAVY (21 days x 141 SKUs x 2 lanes).
 *                                             Nightly only; the terms are persisted.
 *   computeCoverage / guards                — TRIVIAL (arithmetic over ~10 numbers).
 *                                             Nightly AND at walk-time render.
 * The coverage horizon is a READ-TIME pure SELECTION over persisted terms. That is what
 * makes the 9:58 and the 10:02 walk render different, both-correct numbers from one ledger
 * row, and it is why the walker's read path costs one batched query and no re-derivation.
 *
 * ── THE DOUBLE-COUNT LAW IS NOT IN PLAY, AND THAT IS DELIBERATE ────────────────
 * Consumed oz = production_inputs.input_oz + toast_daily_depletion.direct_oz. NEVER
 * flattened_oz. This module reads flattened oz for exactly ONE purpose — detecting that a
 * SKU's demand is PREP-MEDIATED, i.e. that its true consumption lives in a lane that is
 * currently dark — and never sums it into anything. Same two lanes as loadSkuUsageRank
 * (lib/ordering.ts:314-395) and the counts drift consumed term.
 *
 * ── EVERYTHING IS PER-LOCATION AND PER-DAY-CLASS ───────────────────────────────
 * There is no global par math anywhere in this module. "day-class" is weekday | weekend
 * with the SHIPPED boundary (weekend = Fri/Sat/Sun, lib/et-day-shared.ts isWeekendParDow):
 * the base, the par columns, the band, the budget and the PIN all share one boundary.
 * r2 called this grain "day-slot"; r3 renamed it "day-class" throughout. Two values, ever.
 *
 * ── PROVENANCE ─────────────────────────────────────────────────────────────────
 * Phase 1 seeded CUSHION_BY_CLASS / CUSHION_DEFAULT / roundToStep / parStepFor here (Task 1.6
 * needed the cushion vocabulary and the par-step inference for the SKU admin). Phase 2 filled
 * in the rest of the module around them; those four are unchanged.
 */
import { etDayFromDate } from "@/lib/et-day-shared";

export type DayClass = "weekday" | "weekend";

/**
 * Every tunable this arc owns, with the reason it has the value it has. Config-in-code by
 * spec instruction: these are BEHAVIOUR, and behaviour lives in code (AGENTS.md tenant law).
 * Only the cushion CLASS and the par STEP are per-SKU data.
 */
export const DYNAMIC_PARS = {
  /** Trailing base window. Deliberately different from usageRank's 30-day sort window
   *  (lib/ordering.ts:337) — that ranks what to walk first, this estimates a rate.
   *  21 days at CO's shipped boundary = 12 weekday + 9 weekend points (probed live). */
  BASE_WINDOW_DAYS: 21,
  /** Per-day-class thin thresholds. A weekday rate wants ~2/3 of its 12 points; a weekend
   *  rate wants ~2/3 of its 9. Below this the base is advisory-null, never a thin guess. */
  MIN_OBSERVED_DAYS: { weekday: 8, weekend: 6 } as Record<DayClass, number>,

  /** Velocity is a bounded, dimensionless RATIO on the residual above trend — never an oz
   *  term, so it cannot enter an oz sum by construction (r1-6, opus). */
  VELOCITY_CAP: 0.25,
  /** A residual smaller than this is noise, not momentum. */
  VELOCITY_DEADBAND: 0.1,
  /** Consecutive same-sign days required before momentum is believed (r1-6). */
  VELOCITY_MIN_PERSISTENCE_DAYS: 3,
  /** How far back the residual run may be sought. */
  VELOCITY_LOOKBACK_DAYS: 7,
  /** The volume floor, in ORDER UNITS PER DAY (r2-10: "a sustained 3-item/day +200% ratio
   *  passes time but not volume"). Expressed in the SKU's own terms so it is dimensionally
   *  honest and needs no new data. Live check: Oregano 0.40 u/d and Prosciutto 1.21 u/d
   *  clear it; Thyme 0.075 u/d and Salt 0.008 u/d do not — which is the intended verdict. */
  VELOCITY_MIN_UNITS_PER_DAY: 0.1,

  /** The band's percentage half. The magnitude is max(1 step, BAND_PCT x par), and the cap
   *  clamps AFTER rounding (projects r3 P2-2). */
  BAND_PCT: 0.25,
  /** Pars below this many STEPS are below the band's resolution: manual-only, suggestion
   *  labelled as such (r3). At CO this is 108 of 141 pars, and that is the honest answer. */
  MIN_STEPS_FOR_AUTO: 4,

  /** ONE non-manual par write per (sku, location, day-class) per rolling window. Consumed by
   *  auto-writes and by reverts; a human ACCEPT is free — the incentive must never punish
   *  engagement (r2-8, final form). */
  BUDGET_WINDOW_DAYS: 7,
  BUDGET_MOVES: 1,

  /** Integer/step rounding of a continuous target oscillates forever without this: the
   *  direction must be confirmed across two consecutive nightly runs (r1-6). */
  HYSTERESIS_CONFIRM_RUNS: 2,
  /** A standing SUGGESTION only changes when the new candidate is this many steps away —
   *  the walker may not read 12 -> 1 Monday and 12 -> 2 Tuesday (r3). */
  SUGGESTION_DEADBAND_STEPS: 1,

  /** The Fresh-Mozz eaches-vs-cases bomb: a target outside this multiple of the standing par
   *  is a UNIT problem, not a demand problem. Reason row, never a number (r3). */
  UNIT_SUSPECT_LOW: 0.5,
  UNIT_SUSPECT_HIGH: 2.0,

  /** The peak-coverage floor: a percentage on a mean is not a service level (the Prosciutto
   *  proof — mean+20% suggested a par the worst observed weekend cleared by 2%). Until the
   *  statistical socket is filled, a suggestion may never fall below the observed peak run
   *  over the horizon length. Quantile, with max() when there are too few runs to rank. */
  PEAK_QUANTILE: 0.9,
  PEAK_MIN_RUNS_FOR_QUANTILE: 5,

  /** Trust ramp: N accepted of M offered inside the window, counted in DISTINCT GENERATIONS
   *  (r2-2 + r3). A post-graduation revert counts against standing. */
  TRUST_RAMP_ACCEPTS: 10,
  TRUST_RAMP_WINDOW_DAYS: 90,

  /** Sibling prior (NOT WIRED IN v1 — the seam only; Add-a-Location owns the rest). */
  SIBLING_QUALIFYING_DAYS: 21,
} as const;

/**
 * The cushion percentage per policy class. The CLASS is tenant data (a nullable,
 * deliberately un-enumerated `vendor_items.cushion_class` — plan D6, the 0177 precedent);
 * only these PERCENTAGES live in code. Cushion is POLICY, not statistic.
 */
export const CUSHION_BY_CLASS: Readonly<Record<string, number>> = {
  protein: 0.20,
  produce: 0.30,
  dairy: 0.25,
  bakery: 0.30,
  dry: 0.15,
  frozen: 0.10,
};
/** Used when a SKU has no class yet. Conservative, and it NEVER silences a suggestion —
 *  cushion is third on the data critical path, behind weight and rhythm (r2-13). */
export const CUSHION_DEFAULT = 0.20;

/** Kill float drift at the step grain (0.1 + 0.2 must not become 0.30000000000000004). */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Round a value to the nearest multiple of `step`. `step` must be > 0. */
export function roundToStep(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return value;
  return round6(Math.round(value / step) * step);
}

/** The day-class of an ET calendar date, through the SHIPPED boundary. One home, forever. */
export function dayClassForDate(dateEt: string): DayClass {
  return etDayFromDate(dateEt).weekend ? "weekend" : "weekday";
}

/**
 * The SKU's par quantum in order units (plan D7).
 *   explicit `parStep` (authored) ?? inferred from the standing pars' observed grain.
 * Inference: a .25/.75 fraction on either par => 0.25 · a .5 fraction => 0.5 · else 1.
 * 36 par'd SKUs are deliberately fractional, so the inference is what makes the band correct
 * on day one with zero data entry; the column is the override.
 */
export function parStepFor(input: {
  parStep: number | null;
  weekdayPar: number | null;
  weekendPar: number | null;
}): number {
  if (input.parStep != null && input.parStep > 0) return input.parStep;
  const fracs = [input.weekdayPar, input.weekendPar]
    .filter((p): p is number => p != null)
    .map((p) => round6(Math.abs(p % 1)));
  if (fracs.some((f) => f > 0 && Math.abs(f - 0.5) > 1e-6)) return 0.25;
  if (fracs.some((f) => Math.abs(f - 0.5) <= 1e-6)) return 0.5;
  return 1;
}

/**
 * Order-up-to-par quantity from a par and an advisory on-hand in order units.
 * BYTE-IDENTICAL to lib/ordering.ts buildRow's suggestion math (`:728`) — lifted here so the
 * client can live-recompute it after an accept without minting a second opinion (r1: the
 * numeric suggestion and the order qty are ONE engine, and accepting recomputes the qty).
 */
export function suggestedOrderQty(par: number, advisoryOrderUnits: number | null): number | null {
  if (advisoryOrderUnits == null) return null;
  return Math.max(Math.ceil(par - advisoryOrderUnits), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// The base rate (Task 2.2)
// ─────────────────────────────────────────────────────────────────────────────

/** One calendar day of the window, with the two observability oracles resolved. */
export interface WindowDay {
  dateEt: string;
  dayClass: DayClass;
  /** The register produced ANY selection that day at this location — the full-gap oracle
   *  (plan D10). A day with events but no depletion row for this SKU is a TRUE ZERO. */
  salesObserved: boolean;
  /** A live production was recorded that day at this location. */
  productionObserved: boolean;
}

export interface BaseRateInput {
  /** Oldest first, one entry per calendar day in the window. */
  window: ReadonlyArray<WindowDay>;
  /** PRODUCT-grain direct-lane oz keyed by ET date (twins already rolled up — a primary flip
   *  must not read as demand collapse, r1-3). */
  directOzByDate: ReadonlyMap<string, number>;
  /** PRODUCT-grain production-lane oz (production_inputs.input_oz) keyed by ET date. */
  productionOzByDate: ReadonlyMap<string, number>;
  /** Flattened oz — read ONLY to detect prep-mediation. NEVER summed. The double-count law. */
  flattenedOzByDate: ReadonlyMap<string, number>;
  /** The first ET date this SKU's lane could produce data at this location. null = never. */
  laneStartAt: string | null;
}

export interface DayClassRate {
  ozPerDay: number | null;
  observedDays: number;
  gapDays: number;
  thin: boolean;
}

export interface BaseRateResult {
  byDayClass: Record<DayClass, DayClassRate>;
  /** False when this SKU's demand is prep-mediated and the production lane is dark — a
   *  HALF-SEEN base, which is silently low and therefore worse than null (r1 V5). */
  laneComplete: boolean;
  /** True when no lane has ever started here — the honest-null root cause (r3). */
  laneNeverStarted: boolean;
  /** The observed daily series, oldest first — the velocity layer and the peak floor read it. */
  series: Array<{ dateEt: string; dayClass: DayClass; oz: number }>;
}

const EMPTY_RATE: DayClassRate = { ozPerDay: null, observedDays: 0, gapDays: 0, thin: true };

/**
 * The trailing base rate, per day-class, over OBSERVED days only.
 *
 * Three exclusions, each for a different reason and each counted separately:
 *   · before `laneStartAt`     — the lane did not exist; those days are structural zeros,
 *                                not measurements (r2-5, the LONGITUDINAL clamp).
 *   · full-gap days            — neither oracle fired; the shop's data is missing, not its
 *                                demand. EXCLUDE the day, never null the window (r3).
 *   · nothing else             — a day the register ran and this SKU did not move is a TRUE
 *                                ZERO and belongs in the denominator AND the numerator.
 */
export function computeBaseRate(input: BaseRateInput): BaseRateResult {
  const byDayClass: Record<DayClass, DayClassRate> = {
    weekday: { ...EMPTY_RATE },
    weekend: { ...EMPTY_RATE },
  };
  const series: BaseRateResult["series"] = [];
  if (input.laneStartAt == null) {
    return { byDayClass, laneComplete: false, laneNeverStarted: true, series };
  }

  const sums: Record<DayClass, number> = { weekday: 0, weekend: 0 };
  let flattenedSeen = 0;
  let productionSeen = 0;

  for (const day of input.window) {
    if (day.dateEt < input.laneStartAt) continue; // longitudinal clamp — not a zero.
    if (!day.salesObserved && !day.productionObserved) {
      byDayClass[day.dayClass].gapDays += 1;
      continue; // full gap — the data is missing, not the demand.
    }
    const direct = input.directOzByDate.get(day.dateEt) ?? 0;
    const production = input.productionOzByDate.get(day.dateEt) ?? 0;
    flattenedSeen += input.flattenedOzByDate.get(day.dateEt) ?? 0;
    productionSeen += production;
    const oz = direct + production; // the two lanes. flattened_oz is NEVER here.
    sums[day.dayClass] += oz;
    byDayClass[day.dayClass].observedDays += 1;
    series.push({ dateEt: day.dateEt, dayClass: day.dayClass, oz });
  }

  for (const dc of ["weekday", "weekend"] as const) {
    const seen = byDayClass[dc].observedDays;
    byDayClass[dc].thin = seen < DYNAMIC_PARS.MIN_OBSERVED_DAYS[dc];
    byDayClass[dc].ozPerDay = seen > 0 ? round6(sums[dc] / seen) : null;
  }

  // Prep-mediated demand with a dark production lane = a half-seen base. Live today this is
  // EVERY prep-mediated SKU, because production_inputs has 0 rows.
  const prepMediated = flattenedSeen > 0;
  return {
    byDayClass,
    laneComplete: !prepMediated || productionSeen > 0,
    laneNeverStarted: false,
    series,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The peak-coverage floor (Task 2.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The observed PEAK coverage over a horizon of `runLength` days, in oz.
 *
 * WHY: a percentage on a mean is not a service level. The council's Prosciutto walk showed
 * mean + 20% producing a par the WORST observed weekend cleared by 2% — i.e. a cushion that
 * covers the average and fails the day it was bought for. Until the statistical socket
 * (z x sigma x sqrt(lead)) has variance-worthy history to fill it, the floor is empirical:
 * whatever the shop has actually had to survive over a window this long.
 *
 * p90 rather than max once there are enough runs to rank, so one catering-shaped outlier
 * cannot permanently inflate a par; max below that, because with 4 runs a "p90" is a max
 * wearing a costume.
 */
export function observedPeakCoverageOz(
  dailyOz: ReadonlyArray<number>,
  runLength: number,
): number | null {
  if (runLength <= 0 || dailyOz.length < runLength) return null;
  const runs: number[] = [];
  for (let i = 0; i + runLength <= dailyOz.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < runLength; j += 1) sum += dailyOz[i + j] ?? 0;
    runs.push(sum);
  }
  if (runs.length === 0) return null;
  runs.sort((a, b) => a - b);
  if (runs.length < DYNAMIC_PARS.PEAK_MIN_RUNS_FOR_QUANTILE) return round6(runs[runs.length - 1]!);
  const idx = Math.min(runs.length - 1, Math.ceil(DYNAMIC_PARS.PEAK_QUANTILE * runs.length) - 1);
  return round6(runs[Math.max(idx, 0)]!);
}

// ─────────────────────────────────────────────────────────────────────────────
// Velocity (Task 2.4)
// ─────────────────────────────────────────────────────────────────────────────

export type VelocityGateReason =
  | "no_base"
  | "no_persistence"
  | "volume_floor"
  | "recipe_edited"
  | "signals_too_new";

export interface VelocityDay {
  dateEt: string;
  dayClass: DayClass;
  oz: number;
  /** The day's catering-suspicion marker (plan D4). Unknown days are `false` + clamped out. */
  suspect: boolean;
}

export interface VelocityInput {
  /** Oldest first — normally BaseRateResult.series enriched with the suspect flag. */
  series: ReadonlyArray<VelocityDay>;
  baseByDayClass: Record<DayClass, number | null>;
  /** oz of one order unit — the volume floor's denominator. */
  perOrderUnitOz: number | null;
  /**
   * ET date of the most recent recipe edit whose effect could reach this SKU — the series
   * before it is a different signal, so it is dropped.
   *
   * ⚠ THE RESET ORACLE MAY BE COARSER THAN PER-SKU, AND IN v1 IT IS (LEAD RULING F6).
   * v1's loader (`loadLatestRecipeEditAt`, lib/dynamic-pars.ts) supplies the latest recipe
   * edit GLOBALLY, so ANY recipe edit anywhere resets velocity for EVERY SKU for
   * `VELOCITY_MIN_PERSISTENCE_DAYS`. That is a conservative OVER-reset — it can only
   * withhold a velocity nudge, never invent one — and velocity is suggestion-lane-only, so
   * the error direction is safe. It is stated here rather than implied because this field's
   * doc previously promised a per-SKU grain the loader does not deliver, and a pure core
   * that describes a contract its caller cannot meet is how a wrong assumption gets built
   * on. Per-SKU attribution needs flatten-aware audit parsing; the upgrade lands here with
   * no signature change.
   */
  recipeEditedAt: string | null;
  /** First ET date a sales-signal row exists at this location (plan D4's clamp). */
  signalsStartAt: string | null;
}

export interface VelocitySignal {
  /** 1.0 = no momentum. Bounded to [1 - CAP, 1 + CAP]. DIMENSIONLESS by construction. */
  ratio: number;
  applied: boolean;
  persistedDays: number;
  reason: VelocityGateReason | null;
}

const NO_VELOCITY = (reason: VelocityGateReason): VelocitySignal => ({
  ratio: 1,
  applied: false,
  persistedDays: 0,
  reason,
});

/**
 * Momentum as a bounded RESIDUAL above trend — never a level term.
 *
 * WHY RESIDUAL (aggie r1, unanimous): recent Toast sales are ALREADY inside the trailing
 * base window, so a velocity term expressed as a level double-counts the very days it is
 * meant to lead. The only honest form is "how far above its own day-class trend has this
 * SKU been running, consistently, in the last few days" — a multiplier on the base.
 *
 * TWO GATES, BOTH REQUIRED (r2-10): time (a run of same-signed residuals) AND volume (the
 * SKU actually moves). A sustained 3-item/day +200% passes time and fails volume, and it
 * should: tripling a par on three items a day is how a par teaches a manager to ignore pars.
 */
export function computeVelocityRatio(input: VelocityInput): VelocitySignal {
  if (input.perOrderUnitOz == null || input.perOrderUnitOz <= 0) return NO_VELOCITY("volume_floor");

  const need = DYNAMIC_PARS.VELOCITY_MIN_PERSISTENCE_DAYS;

  let series = [...input.series];
  const beforeFilters = series.length;
  if (input.signalsStartAt != null) {
    series = series.filter((d) => d.dateEt >= input.signalsStartAt!);
  } else {
    return NO_VELOCITY("signals_too_new"); // no marker at all => nothing is vettable yet.
  }
  const afterSignals = series.length;
  if (input.recipeEditedAt != null) {
    // A recipe edit changes what this SKU MEANS; the series before it is a different signal.
    series = series.filter((d) => d.dateEt > input.recipeEditedAt!);
  }
  const afterRecipe = series.length;
  series = series.filter((d) => !d.suspect).slice(-DYNAMIC_PARS.VELOCITY_LOOKBACK_DAYS);

  // STAGE ATTRIBUTION (LEAD RULING F3, Phase-2 close). When the series ends up too short to
  // judge, name the FIRST filter stage that took it below `need` — i.e. the stage whose input
  // was sufficient and whose output was not. A series that arrived thin was nobody's fault but
  // the data's, and a suspect-day exclusion that breaks a run is a genuine persistence verdict.
  // The ledger's velocity reasons are read as errands, so a wrong cause here is a wrong errand.
  if (series.length < need) {
    if (beforeFilters >= need && afterSignals < need) return NO_VELOCITY("signals_too_new");
    if (afterSignals >= need && afterRecipe < need) return NO_VELOCITY("recipe_edited");
    return NO_VELOCITY("no_persistence");
  }

  // Residual per day against its OWN day-class trend.
  const residuals: number[] = [];
  for (const d of series) {
    const base = input.baseByDayClass[d.dayClass];
    if (base == null || base <= 0) return NO_VELOCITY("no_base");
    residuals.push(round6(d.oz / base - 1));
  }

  // The run must be the MOST RECENT `need` days, all past the deadband, all the same sign.
  const run = residuals.slice(-need);
  const first = run[0]!;
  const sign = Math.sign(first);
  if (sign === 0) return NO_VELOCITY("no_persistence");
  const persisted = run.every(
    (r) => Math.sign(r) === sign && Math.abs(r) >= DYNAMIC_PARS.VELOCITY_DEADBAND,
  );
  if (!persisted) return NO_VELOCITY("no_persistence");

  // Volume floor, in the SKU's own order units per day, over the same run.
  const runDays = series.slice(-need);
  const meanUnitsPerDay = runDays.reduce((n, d) => n + d.oz, 0) / need / input.perOrderUnitOz;
  if (meanUnitsPerDay < DYNAMIC_PARS.VELOCITY_MIN_UNITS_PER_DAY) return NO_VELOCITY("volume_floor");

  const mean = run.reduce((n, r) => n + r, 0) / need;
  const bounded = Math.max(-DYNAMIC_PARS.VELOCITY_CAP, Math.min(DYNAMIC_PARS.VELOCITY_CAP, mean));
  return { ratio: round6(1 + bounded), applied: true, persistedDays: need, reason: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cushion — the C-socket (Task 2.5)
// ─────────────────────────────────────────────────────────────────────────────

/** What the future statistical implementation will need. Pinned NOW, unused NOW (r1-9). */
export interface DemandStats {
  ozPerDay: number | null;
  observedDays: number;
  /** Reserved for the service-level implementation (z x sigma x sqrt(lead)). */
  stdDevOzPerDay?: number | null;
}

export interface CushionResult {
  pct: number;
  classUsed: string | null;
  isDefault: boolean;
}

/**
 * THE C-SOCKET. Cushion is POLICY, not statistic — a tunable percentage per SKU class,
 * explainable in kitchen terms ("4 covers you to Friday's truck plus 20%").
 *
 * `demandStats` is DELIBERATELY UNUSED. The signature is pinned now so that when a year of
 * per-location variance history exists, a service-level implementation (z x sigma x
 * sqrt(lead-time)) screws into this exact seam without touching a single caller. Building it
 * today on thin data would be confident nonsense — the documented upgrade path, not a TODO.
 */
export function cushionFor(
  sku: { cushionClass: string | null },
  _location: { id: string },
  demandStats: DemandStats,
): CushionResult {
  void demandStats; // the socket: see the doc block above.
  const key = sku.cushionClass?.trim().toLowerCase() ?? null;
  const pct = key != null ? CUSHION_BY_CLASS[key] : undefined;
  if (pct == null) return { pct: CUSHION_DEFAULT, classUsed: key, isDefault: true };
  return { pct, classUsed: key, isDefault: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Coverage (Task 2.6)
// ─────────────────────────────────────────────────────────────────────────────

export interface CoverageInput {
  /** From vendor-rhythm-shared.coverageWindow — every ET day the par must survive, as
   *  "YYYY-MM-DD". The day-class is derived HERE via dayClassForDate so the caller cannot
   *  hand in a second opinion about where the weekend starts. */
  coveredDays: ReadonlyArray<string>;
  baseOzPerDay: Record<DayClass, number | null>;
  /** From computeVelocityRatio. 1 when velocity did not apply. */
  velocityRatio: number;
  cushionPct: number;
  /** oz of ONE order unit (lib/ordering.ts perOrderUnitOz). null/0 => no honest unit target. */
  perOrderUnitOz: number | null;
  /** From observedPeakCoverageOz over the horizon length. null => no floor claim. */
  peakFloorOz: number | null;
}

export interface CoverageResult {
  demandOz: number;
  coveredOz: number;
  targetUnits: number;
  flooredByPeak: boolean;
}

/**
 * Par target = SUM over covered days of (that day's day-class rate x velocity), plus cushion,
 * floored at the observed peak — expressed in ORDER UNITS.
 *
 * SUM PER COVERED DAY, NEVER rate x days (r1-2, projects). A horizon that crosses Thursday
 * into Friday spans two demand regimes; multiplying one rate by a day count silently averages
 * a busy Friday into a quiet Tuesday, and at CO the weekend IS the volume.
 */
export function computeCoverage(input: CoverageInput): CoverageResult | null {
  if (input.coveredDays.length === 0) return null;
  if (input.perOrderUnitOz == null || input.perOrderUnitOz <= 0) return null;
  let demandOz = 0;
  for (const dateEt of input.coveredDays) {
    const rate = input.baseOzPerDay[dayClassForDate(dateEt)];
    if (rate == null) return null; // an unknown day-class cannot be summed. Honest null.
    demandOz += rate * input.velocityRatio;
  }
  demandOz = round6(demandOz);
  const withCushion = round6(demandOz * (1 + input.cushionPct));
  const floored = input.peakFloorOz != null && input.peakFloorOz > withCushion;
  const coveredOz = floored ? input.peakFloorOz! : withCushion;
  return {
    demandOz,
    coveredOz,
    targetUnits: round6(coveredOz / input.perOrderUnitOz),
    flooredByPeak: floored,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The reason vocabulary (Task 2.7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WHY A PAR IS (OR IS NOT) SPEAKING — the closed vocabulary, and the flagship deliverable.
 *
 * v1 ships an engine that can honestly answer for ~14 rows out of ~282. The other ~268 are
 * the product: each one names the errand that would wake it. "no production capture" is a
 * capture gap, "no weight basis" is a trip to the scale, "no vendor rhythm" is five minutes
 * on the vendor page — and the system generating that list live is the thesis ("the system
 * recognizes what's going on before the human does") applied to its own readiness.
 *
 * CLOSED, and the compiler enforces it: this union is the only spelling of a reason anywhere
 * in the arc. Same posture as AuditAction — a bare string is never a reason code.
 */
export type ParReasonCode =
  /** A number was produced. */
  | "ok"
  /** Packaging / cleaning supplies. Their pars were never demand-derived. NOT a fault. */
  | "inventory_only"
  /** The product was discontinued — the par is suppressed upstream (#283). NOT a fault. */
  | "product_retired"
  /** No lane has ever produced data for this SKU here. */
  | "no_lane_start"
  /** Demand is prep-mediated and production capture is dark: a HALF-SEEN base. */
  | "no_production_capture"
  /** oz-per-order-unit is unresolvable — no weight, no chain, no honest denominator. */
  | "no_weight_basis"
  /** The pack chain exists but cannot resolve to a root container. */
  | "unresolvable_pack"
  /** No order->delivery rhythm authored for this vendor at this location. */
  | "no_vendor_rhythm"
  /** Too few observed days in this day-class. */
  | "thin_history"
  /** The depletion ledger is not current for this location tonight. */
  | "stale_depletion"
  /** A brand-new location with no local history (the sibling-prior seam; NOT wired in v1). */
  | "no_local_history"
  /** The computed target is zero. A zero par is never a suggestion (r3). */
  | "zero_target"
  /** The target is <50% or >200% of the standing par: the UNIT looks wrong, not the demand. */
  | "par_unit_suspect"
  /** The par is <= 3 steps: below the band's resolution. Suggestion renders, auto never. */
  | "below_band_resolution"
  /** A within-band delta on a slot whose weekly budget is spent (projects r3 P2-3). */
  | "budget_spent"
  /** A human reverted this slot; the machine may not re-apply while the pin stands. */
  | "pinned"
  /** The day-class has no par slot: suggestion-only forever, aggregate-only in v1. */
  | "slot_creation"
  /** Informational only — never silences. */
  | "cushion_class_missing";

export const PAR_REASON_CODES: ReadonlyArray<ParReasonCode> = [
  "ok", "inventory_only", "product_retired", "no_lane_start", "no_production_capture",
  "no_weight_basis", "unresolvable_pack", "no_vendor_rhythm", "thin_history",
  "stale_depletion", "no_local_history", "zero_target", "par_unit_suspect",
  "below_band_resolution", "budget_spent", "pinned", "slot_creation", "cushion_class_missing",
];

/** Codes that mean NO NUMBER RENDERS. The rest annotate a number that did render. */
export const SILENCING_REASONS: ReadonlySet<ParReasonCode> = new Set<ParReasonCode>([
  "inventory_only", "product_retired", "no_lane_start", "no_production_capture",
  "no_weight_basis", "unresolvable_pack", "no_vendor_rhythm", "thin_history",
  "stale_depletion", "no_local_history", "zero_target", "par_unit_suspect", "slot_creation",
]);

/** Which errands a human can actually run, in the order r2-13 names the critical path. */
export const ERRAND_REASONS: ReadonlyArray<ParReasonCode> = [
  "no_weight_basis", "unresolvable_pack", "no_vendor_rhythm", "no_production_capture",
  "par_unit_suspect", "cushion_class_missing",
];

export interface ParReasonInput {
  inventoryOnly: boolean;
  productRetired: boolean;
  depletionCurrent: boolean;
  laneNeverStarted: boolean;
  laneComplete: boolean;
  perOrderUnitOz: number | null;
  hasPackChain: boolean;
  hasRhythm: boolean;
  thin: boolean;
  slotExists: boolean;
  /** Location has zero observed days at all — the cold-start seam. */
  noLocalHistory: boolean;
}

/**
 * FIRST CAUSE WINS, and the order is the whole point — exactly the walkDisposition /
 * parReviewAdvisory precedent (lib/location-sku-shared.ts).
 *
 * `inventory_only` ranks FIRST for the same reason it does in parReviewAdvisory: 57 of the
 * 141 par'd SKUs are packaging, every one has no demand lane by design, and reporting an
 * errand for them would put 57 false chores at the top of Juan's list on day one.
 */
export function classifyParReason(input: ParReasonInput): ParReasonCode {
  if (input.inventoryOnly) return "inventory_only";
  if (input.productRetired) return "product_retired";
  if (!input.depletionCurrent) return "stale_depletion";
  if (input.perOrderUnitOz == null) return input.hasPackChain ? "unresolvable_pack" : "no_weight_basis";
  if (input.noLocalHistory) return "no_local_history";
  if (input.laneNeverStarted) return "no_lane_start";
  if (!input.laneComplete) return "no_production_capture";
  if (!input.hasRhythm) return "no_vendor_rhythm";
  if (input.thin) return "thin_history";
  if (!input.slotExists) return "slot_creation";
  return "ok";
}

/** In v1 ~94-100% of rows are silent, so a per-row badge is worse than the 94% the r2 rename
 *  was commissioned to fix (aggie r3 P1). The lane lights ITSELF when silence stops being the
 *  norm — shipped now, returning false now, no future PR and no flag. */
export function shouldBadgeSilencePerRow(silentRows: number, totalRows: number): boolean {
  if (totalRows <= 0) return false;
  return silentRows / totalRows < 0.5;
}

// ─────────────────────────────────────────────────────────────────────────────
// The guard stack + generation identity (Task 2.8)
// ─────────────────────────────────────────────────────────────────────────────

export type GuardName =
  | "band" | "budget" | "hysteresis" | "pin" | "slot_creation" | "below_band_resolution";

export interface GuardInput {
  locationId: string;
  skuId: string;
  dayClass: DayClass;
  /** The resolved par for this day-class today. null = the slot does not exist. */
  currentPar: number | null;
  /** From computeCoverage. */
  targetUnits: number;
  parStep: number;
  /** The last ledger row's rendered suggestion for this (sku, location, day-class). */
  priorSuggestedPar: number | null;
  priorGenerationId: string | null;
  /** True when the PREVIOUS run proposed a move in the same direction (r1-6 hysteresis). */
  directionConfirmed: boolean;
  budgetSpent: boolean;
  pinned: boolean;
  mode: "shadow" | "live";
}

export interface GuardOutcome {
  tier: "auto" | "suggestion" | "none";
  suggestedPar: number | null;
  outcome: "would_apply" | "applied" | "suppressed" | "advisory_null";
  suppressedBy: GuardName | null;
  reasonCode: ParReasonCode;
  generationId: string | null;
  slotCreation: boolean;
}

/** Deterministic, human-readable, and STABLE while both numbers are stable. No hashing: the
 *  identity IS the pair of numbers, so a re-offer keeps its generation and a changed offer
 *  cannot accidentally reuse one. The trust ramp counts these, so this is load-bearing. */
export function generationIdFor(
  locationId: string,
  skuId: string,
  dayClass: DayClass,
  currentPar: number | null,
  suggestedPar: number,
): string {
  return `${locationId}:${skuId}:${dayClass}:${currentPar ?? "none"}>${suggestedPar}`;
}

/**
 * Keep a standing suggestion unless the candidate is MORE than `SUGGESTION_DEADBAND_STEPS`
 * steps away from it. Suggestion-lane hysteresis (r3): a number that wobbles nightly is a
 * number a manager learns to ignore, which is the same failure as a thrashing par.
 *
 * The comparison is `<=`, so a ONE-step wobble is damped (LEAD RULING F2, Phase-2 close).
 * r3's sentence is behavioural, not colour: "the walker may not read 12 -> 1 Monday and
 * 12 -> 2 Tuesday" — that is exactly a one-step wobble, and it must not render.
 *
 * ACCEPTED COST, stated: a PERMANENT one-step drift stays unrendered until it grows to two
 * steps. That is inherent to any deadband wide enough to damp one-step wobble; r3 chose
 * legibility, and one step is inside the band's own noise floor anyway.
 */
export function stabilizeSuggestion(
  priorSuggestedPar: number | null,
  candidate: number,
  parStep: number,
): number {
  if (priorSuggestedPar == null) return candidate;
  const deadband = DYNAMIC_PARS.SUGGESTION_DEADBAND_STEPS * parStep;
  return Math.abs(candidate - priorSuggestedPar) <= deadband ? priorSuggestedPar : candidate;
}

/**
 * THE GUARD STACK — one function, one order, simulated in shadow and executed in live.
 *
 * r2-7 is the design's best idea: shadow runs the SAME code with a mode flag and records
 * would-apply-vs-suppressed-by-WHICH-guard, so every guard is battle-tested on real nightly
 * data before the write bit is ever flipped. Do not fork this function for shadow.
 */
export function applyGuardStack(input: GuardInput): GuardOutcome {
  const step = input.parStep;
  const slotCreation = input.currentPar == null;

  // Round the target to the step FIRST; the step grain is the resolution of the whole system.
  const roundedTarget = Math.max(roundToStep(input.targetUnits, step), 0);

  // A zero target is NEVER a suggestion — a zeroed par silently exits every notice, and
  // "stop stocking this" is a human decision, not an arithmetic one (r3).
  if (roundedTarget <= 0) {
    return {
      tier: "none", suggestedPar: null, outcome: "advisory_null", suppressedBy: null,
      reasonCode: "zero_target", generationId: null, slotCreation,
    };
  }

  // Slot creation: compute, ledger, render in the AGGREGATE only. Suggestion-only forever —
  // the machine may not decide that Fri/Sat/Sun should stop following the weekday number.
  if (slotCreation) {
    const gen = generationIdFor(input.locationId, input.skuId, input.dayClass, null, roundedTarget);
    return {
      tier: "suggestion", suggestedPar: roundedTarget, outcome: "suppressed",
      suppressedBy: "slot_creation", reasonCode: "slot_creation", generationId: gen,
      slotCreation: true,
    };
  }

  const current = input.currentPar!;

  // The unit-sanity quarantine, BEFORE any band arithmetic: a target this far from the
  // standing par is a pack/weight problem wearing a demand costume (the Fresh-Mozz bomb).
  if (
    current > 0 &&
    (roundedTarget < current * DYNAMIC_PARS.UNIT_SUSPECT_LOW ||
      roundedTarget > current * DYNAMIC_PARS.UNIT_SUSPECT_HIGH)
  ) {
    return {
      tier: "none", suggestedPar: null, outcome: "advisory_null", suppressedBy: null,
      reasonCode: "par_unit_suspect", generationId: null, slotCreation: false,
    };
  }

  const stabilized = stabilizeSuggestion(input.priorSuggestedPar, roundedTarget, step);
  const generationId = generationIdFor(
    input.locationId, input.skuId, input.dayClass, current, stabilized,
  );

  // No movement worth rendering.
  if (Math.abs(stabilized - current) < step) {
    return {
      tier: "none", suggestedPar: null, outcome: "advisory_null", suppressedBy: null,
      reasonCode: "ok", generationId: null, slotCreation: false,
    };
  }

  // Pars below the band's resolution are MANUAL-ONLY. max(1 step, 25%) silently overrode the
  // cap upward exactly where +-1 step is the largest relative swing (r3). At CO this is 108 of
  // 141 pars, and saying so is the honest answer, not a bug.
  const steps = current / step;
  if (steps < DYNAMIC_PARS.MIN_STEPS_FOR_AUTO) {
    return {
      tier: "suggestion", suggestedPar: stabilized, outcome: "suppressed",
      suppressedBy: "below_band_resolution", reasonCode: "below_band_resolution",
      generationId, slotCreation: false,
    };
  }

  // THE BAND, in par steps. Magnitude = max(1 step, 25% of par). Two facts, both load-bearing
  // (LEAD RULING F1, Phase-2 close):
  //
  //  1. THE BAND TEST RUNS ON THE ROUNDED DELTA, and that IS "the cap clamps AFTER rounding"
  //     (projects r3 P2-2). `stabilized` is already step-rounded, so `delta` below is the
  //     delta that would actually be written. P2-2's hazard was testing the RAW delta: par 10
  //     with a raw target of 12.5 gives a raw delta of 2.5 which passes a <=2.5 cap, and only
  //     THEN rounds to 13 — a 30% move that slipped a 25% cap. Rounding first structurally
  //     closes that hole; there is nothing left to clip afterwards.
  //  2. BEYOND THE BAND IS A SUGGESTION AT THE FULL, UN-CLIPPED TARGET. "Bigger moves are
  //     suggestions… Nothing beyond the band ever moves itself" (spec, original layer) —
  //     the machine does not part-apply toward a target it may not reach, and the manager
  //     sees the honest number rather than a clipped one.
  const maxDelta = Math.max(step, DYNAMIC_PARS.BAND_PCT * current);
  const delta = stabilized - current;
  const withinBand = Math.abs(delta) <= maxDelta + 1e-9;

  if (!withinBand) {
    return {
      tier: "suggestion", suggestedPar: stabilized, outcome: "suppressed",
      suppressedBy: "band", reasonCode: "ok", generationId, slotCreation: false,
    };
  }

  // Within the band the target IS the move — no clipping, by fact 2 above. Floored so a par
  // never lands below one positive step, and never on zero.
  const candidate = Math.max(stabilized, step);
  if (candidate === current) {
    return {
      tier: "none", suggestedPar: null, outcome: "advisory_null", suppressedBy: null,
      reasonCode: "ok", generationId: null, slotCreation: false,
    };
  }

  // A human reverted this slot. The pin stops the MACHINE; the suggestion still renders,
  // because the conversation is not over — only the unilateral write is.
  if (input.pinned) {
    return {
      tier: "suggestion", suggestedPar: stabilized, outcome: "suppressed",
      suppressedBy: "pin", reasonCode: "pinned", generationId, slotCreation: false,
    };
  }

  // Direction must be confirmed across two consecutive runs, or step-rounding of a continuous
  // target oscillates 2.49 <-> 2.51 forever.
  if (!input.directionConfirmed) {
    return {
      tier: "suggestion", suggestedPar: stabilized, outcome: "suppressed",
      suppressedBy: "hysteresis", reasonCode: "ok", generationId, slotCreation: false,
    };
  }

  // A within-band delta on a spent budget gets its OWN cause. Without it this row is neither
  // auto nor suggestion and renders as a silently stale par (projects r3 P2-3).
  if (input.budgetSpent) {
    return {
      tier: "suggestion", suggestedPar: stabilized, outcome: "suppressed",
      suppressedBy: "budget", reasonCode: "budget_spent", generationId, slotCreation: false,
    };
  }

  return {
    tier: "auto",
    suggestedPar: candidate,
    // THE MODE FLAG, and the only place it matters. Shadow records the verdict it WOULD have
    // executed; live executes it. Same code path, so the guards are proven before the flip.
    outcome: input.mode === "shadow" ? "would_apply" : "applied",
    suppressedBy: null,
    reasonCode: "ok",
    generationId,
    slotCreation: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trust ramp + the sibling seam (Task 2.9) — both ship, neither is wired
// ─────────────────────────────────────────────────────────────────────────────

export interface TrustRampInput {
  /** DISTINCT generations offered at this location inside the window. */
  offered: number;
  /** DISTINCT generations accepted inside the window. */
  accepted: number;
  /** Reverts inside the window — a post-graduation revert counts AGAINST standing (r2-2). */
  reverts: number;
  /**
   * A physical count exists at this location with `allocated_from_product_id IS NULL`
   * (r3): a product-level count allocates a line to EVERY member, so accepting allocated
   * lines would let one physical count anchor an entire product at once.
   */
  hasDirectCountAnchor: boolean;
}

export interface TrustRampState {
  netAccepted: number;
  offered: number;
  met: boolean;
  blockedBy: "ramp" | "count_anchor" | null;
}

/** Graduation WIDENS THE TRIGGER, NEVER THE WRITE SET (r2-3): a graduated location still
 *  auto-writes only lane-lit SKUs. This function answers "may this location's auto lane run
 *  at all"; the per-SKU lane gate answers "for which SKUs", and it is never relaxed. */
export function trustRampState(input: TrustRampInput): TrustRampState {
  const netAccepted = Math.max(0, input.accepted - input.reverts);
  const rampOk = netAccepted >= DYNAMIC_PARS.TRUST_RAMP_ACCEPTS;
  if (!rampOk) return { netAccepted, offered: input.offered, met: false, blockedBy: "ramp" };
  if (!input.hasDirectCountAnchor) {
    return { netAccepted, offered: input.offered, met: false, blockedBy: "count_anchor" };
  }
  return { netAccepted, offered: input.offered, met: true, blockedBy: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// The par-write authority's PURE half (Task 3.8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The floor for every par write, human or machine (plan D1).
 *
 * r3 §Authz wrote "GM >= 6". Live, `gm` is level 7 and level 6 is agm / catering_mgr /
 * prep_mgr / **social_media_mgr** — so the r3 spelling would have handed par authority to
 * the Social Media Manager. 7 is what "GM" means in this codebase and is exactly today's
 * only par-write floor (`SKU_WRITE_MIN`, lib/admin/skus.ts).
 *
 * Declared in the PURE core, not imported from lib/admin/skus.ts, for two reasons: that
 * module is server-only so a vitest case cannot reach it, and importing it into
 * lib/dynamic-pars.ts would make the two mutually recursive (the admin overlay writer
 * calls the authority). The drift guard is real instead of nominal —
 * tests/dynamic-pars-write.test.ts asserts this equals `getRoleLevel("gm")`, so a role
 * renumber fails the build rather than silently widening who may move a par.
 */
export const PAR_WRITE_MIN = 7;

/** Who is writing. A REVERT is its own kind here even though it is an "accept"-class
 *  human write, because its pin and budget effects are the opposite ones. */
export type ParWriteActorKind = "admin" | "accept" | "revert" | "machine";

export interface ParActionEffects {
  writesPar: boolean;
  setsPin: boolean;
  clearsPin: boolean;
  consumesBudget: boolean;
}

/**
 * What each HUMAN verb on a suggestion does. The plan's Task 3.8 effect table, in code.
 *
 *   accept  — takes the machine's number. Clears the pin (a direct human write at this
 *             grain IS the human re-engaging) and is FREE: the budget must never punish
 *             engagement (r2-8).
 *   revert  — undoes an applied auto-move. SETS the pin, and DOES consume the budget:
 *             reverts are non-manual-origin par writes and the budget is what stops a
 *             revert war (r2-8 final form). The act that sets a pin never clears it (r3).
 *   dismiss — declines. Nothing changes; it exists so the trust ramp has a denominator
 *             and the ledger can tell "offered and refused" from "offered and ignored".
 */
export function parActionEffects(action: "accept" | "dismiss" | "revert"): ParActionEffects {
  switch (action) {
    case "accept":
      return { writesPar: true, setsPin: false, clearsPin: true, consumesBudget: false };
    case "revert":
      return { writesPar: true, setsPin: true, clearsPin: false, consumesBudget: true };
    case "dismiss":
      return { writesPar: false, setsPin: false, clearsPin: false, consumesBudget: false };
  }
}

export interface ParWriteColumnsInput {
  kind: ParWriteActorKind;
  dayClass: DayClass;
  /** The new HUMAN-lane value for this slot. null = blank-to-global. Ignored by "machine". */
  value: number | null;
  /** "machine" only: the number the engine is applying. */
  autoValue?: number | null;
  /** "machine" only: the global par it was computed against (r2-6 self-invalidation). */
  baselinePar?: number | null;
  /**
   * ISO stamp for `auto_*_applied_at` ("machine") or `pinned_*_at` ("revert").
   *
   * TIME ENTERS A PURE FUNCTION AS A PARAMETER — never as `new Date()` inside it. For
   * kind "revert" it is REQUIRED and its absence THROWS (see the doc block below).
   */
  appliedAt?: string | null;
}

export interface ParWriteColumnEffect {
  /** Columns that exist TODAY. Always safe to write, pre- or post-0183. */
  human: Record<string, number | null>;
  /** Columns migration 0183 adds. The server includes these ONLY when the 0183 probe is
   *  true — which is why the two halves are returned separately rather than merged. */
  autoLane: Record<string, number | string | null>;
}

/**
 * THE ONE PLACE THAT DECIDES WHAT A PAR WRITE DOES TO EACH COLUMN.
 *
 * Every par write in the system — the SKU admin's overlay editor, the walker's one-tap
 * accept, a revert, and the graduated nightly engine — resolves its column patch here.
 * That is the safety property r3 asked for: not that one FUNCTION performs every write
 * (the admin path also owns `active_override` and the insert-vs-update dance on the same
 * row), but that one place decides what a write does to the machine lane, the pin and the
 * baseline. A second opinion about that is how the machine ends up masquerading as an
 * operator.
 *
 * THE MACHINE-LANE BYPASS IS CLOSED STRUCTURALLY, not by validation: for `kind: "admin"`
 * every value this function puts in `autoLane` is NULL, for every input. There is no
 * operator payload that reaches a non-null auto write, which is stronger than the field
 * list on the admin route (that too, but this holds even if the route changes).
 *
 * PER-SLOT, NOT PER-ROW: only the named day-class's columns appear. A weekday move must
 * never stamp the weekend slot's history (aggie r3).
 *
 * THROWS on a "revert" with no `appliedAt` (LEAD RULING F4). This module's header promises
 * "PURE: client-safe, zero I/O", and a `new Date()` fallback inside it would break that —
 * the same input would stop producing the same output, and every test of the pin would be
 * asserting against the clock. The alternative silent form, `?? null`, is worse: it would
 * DROP THE PIN on a caller that forgot the stamp, silently, on the one column whose entire
 * job is to stand until a human clears it. Loud beats silent, and time enters a pure
 * function as a parameter.
 */
export function parWriteColumns(input: ParWriteColumnsInput): ParWriteColumnEffect {
  const dc = input.dayClass;
  const humanCol = dc === "weekend" ? "weekend_par" : "weekday_par";
  const autoCol = `auto_${dc}_par`;
  const baselineCol = `auto_${dc}_baseline_par`;
  const appliedCol = `auto_${dc}_applied_at`;
  const pinCol = `pinned_${dc}_at`;

  if (input.kind === "machine") {
    // Writes the AUTO lane ONLY. Never the human lane, never the pin, never the global
    // vendor_items par. actor null. The baseline rides along so the read-time
    // self-invalidation rule has something to compare against.
    return {
      human: {},
      autoLane: {
        [autoCol]: input.autoValue ?? null,
        [baselineCol]: input.baselinePar ?? null,
        [appliedCol]: input.appliedAt ?? null,
      },
    };
  }

  // A revert SETS the pin, so it MUST be handed the instant to set it to (see above).
  if (input.kind === "revert" && input.appliedAt == null) {
    throw new Error("parWriteColumns: revert requires appliedAt");
  }

  // Every human write moves the par, so the machine's standing opinion about the OLD par
  // is stale by construction: value, baseline and stamp all go on this slot.
  const autoLane: Record<string, number | string | null> = {
    [autoCol]: null,
    [baselineCol]: null,
    [appliedCol]: null,
    // admin + accept CLEAR the pin (a direct human edit at this exact grain is the only
    // thing that does). A revert SETS it — and the act that sets a pin never clears it.
    [pinCol]: input.kind === "revert" ? input.appliedAt! : null,
  };
  return { human: { [humanCol]: input.value }, autoLane };
}

/**
 * SIBLING PRIOR — the seam only. NOT WIRED IN v1, by spec ("the Add-a-Location arc, SEPARATE").
 * Blend weight on the SIBLING's rate, decaying linearly to zero as local observed days
 * accumulate. Whole-pattern only: the depletion ledger has no channel grain, so a
 * delivery-only prior is structurally infeasible without a ledger extension (r1-11).
 *
 * When it IS wired, inheritance must carry per-SKU lane-lit/dark status (projects r3 P2-5):
 * a sibling's DARKNESS must not launder into the new shop as a number.
 */
export function siblingBlendWeight(
  observedDays: number,
  qualifyingDays: number = DYNAMIC_PARS.SIBLING_QUALIFYING_DAYS,
): number {
  if (qualifyingDays <= 0) return 0;
  return round6(Math.max(0, Math.min(1, 1 - observedDays / qualifyingDays)));
}

// ─────────────────────────────────────────────────────────────────────────────
// The WALKER's read-time half (Task 4.1) — pure, client-safe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What ONE walker row needs to render a suggestion and act on it.
 *
 * Everything here is either PERSISTED on the nightly ledger row or RE-SELECTED live at the
 * walk instant; nothing is re-derived from history. Declared in the pure core (not in
 * lib/dynamic-pars.ts) so the client island can import the type without pulling a
 * server-only module into the bundle — the `*-shared.ts` law.
 */
export interface WalkerParSuggestion {
  currentPar: number;
  suggestedPar: number;
  /** The identity the accept/dismiss routes echo back — the 409 idempotency key (plan D14). */
  generationId: string;
  tier: "auto" | "suggestion";
  reasonCode: ParReasonCode;
  /** RE-SELECTED AT THIS WALK'S INSTANT (R3-A) — named in the reason string. */
  coverThroughDate: string;
  coveredDayCount: number;
  cushionPct: number;
  flooredByPeak: boolean;
  velocityApplied: boolean;
  /** True for a day-class with no par slot: aggregate-only, never a row-level number (D16). */
  slotCreation: boolean;
  /** The level-7 check, resolved SERVER-side so the client renders authority without ever
   *  knowing the role model (plan D1). */
  canAct: boolean;
}

/**
 * The nightly ledger row's DEMAND TERMS, in the shape the walk-time re-selection consumes.
 * One camelCase mirror of the `par_auto_moves` columns this rule reads — the pure core must
 * not learn the DB's spellings (the `toTallyRows` precedent, Task 3.6).
 */
export interface PersistedDemandTerms {
  /** The par the NIGHTLY resolved. The identity is keyed on it, so it is not re-resolved. */
  currentPar: number | null;
  parStep: number;
  baseOzPerDay: Record<DayClass, number | null>;
  velocityRatio: number;
  velocityApplied: boolean;
  cushionPct: number | null;
  perOrderUnitOz: number | null;
  peakFloorOz: number | null;
  /** The nightly's own hysteresis prior (`detail.prior_suggested_par`) — NOT its own
   *  rendered suggestion, or the deadband would damp the live horizon away (R3-A). */
  priorSuggestedPar: number | null;
  /** `detail.prior_direction`: sign(suggested - current) on the run BEFORE the nightly. */
  priorDirection: number;
  /** The nightly's ladder verdict. A SILENCING code means no number may render. */
  reasonCode: ParReasonCode;
  /** The nightly's guard verdict tier — the walk-time tier is never richer than it. */
  ledgerTier: "auto" | "suggestion" | "none";
  /** Which guard fired last night, if any. The only window we have onto pin/budget state. */
  suppressedBy: GuardName | null;
}

export interface WalkerSuggestionInput {
  locationId: string;
  skuId: string;
  dayClass: DayClass;
  terms: PersistedDemandTerms;
  /** From coverageWindow, RE-SELECTED at the walk instant (R3-A). */
  coveredDays: ReadonlyArray<string>;
  coverThroughDate: string;
  /** Resolved from the request's actor by the server, never by the component (plan D1). */
  canAct: boolean;
}

/**
 * THE WALK-TIME RE-SELECTION (head ruling R3-A), as a pure function.
 *
 * The nightly persists the demand TERMS and the horizon IT computed with. This rule re-runs
 * the two TRIVIAL halves — `computeCoverage` and `applyGuardStack` — over those persisted
 * terms against the horizon selected at the REAL walk instant. It never recomputes demand:
 * no window, no lanes, no 21 days of history. That is what makes a 9:58 and a 10:02 walk
 * render different, both-correct numbers out of one ledger row for one indexed query.
 *
 * Returns null whenever no number may render, and every way that happens is honest-null,
 * never a fabricated number:
 *   · the nightly's reason ladder already silenced the row (packaging, no weight basis,
 *     no rhythm, thin history, slot creation — every member of SILENCING_REASONS);
 *   · a term the coverage arithmetic needs is absent (cushion / per-order-unit oz);
 *   · coverage itself declines (an unknown day-class rate inside the live horizon);
 *   · the guard stack finds no movement worth rendering AT THIS HORIZON — the honest
 *     answer, not a bug: the 10:02 walk really is ordering against a later truck.
 *
 * ── TWO STATED LIMITATIONS OF RE-RUNNING GUARDS OVER A LEDGER ROW ─────────────
 * (1) `applyGuardStack` short-circuits at the FIRST guard that fires, so `suppressed_by`
 *     tells us about that guard and nothing about the ones behind it. Pin and budget state
 *     are therefore reconstructed from it, and are known only when they were the guard that
 *     actually fired. The consequence is bounded by (2).
 * (2) THE WALK-TIME TIER IS NEVER RICHER THAN THE LEDGER'S. If the live horizon pulls a
 *     beyond-band target back inside the band, the re-run's "auto" is downgraded to
 *     "suggestion" — the machine may not acquire an auto verdict on a read path that cannot
 *     see the guards it would have to clear. The NUMBER is still the live, honest one.
 */
export function resolveWalkerSuggestion(input: WalkerSuggestionInput): WalkerParSuggestion | null {
  const t = input.terms;
  if (SILENCING_REASONS.has(t.reasonCode)) return null;
  if (t.cushionPct == null || t.perOrderUnitOz == null || t.perOrderUnitOz <= 0) return null;
  if (t.currentPar == null) return null; // slot creation renders in the aggregate only (D16).
  if (!(t.parStep > 0)) return null;

  const coverage = computeCoverage({
    coveredDays: input.coveredDays,
    baseOzPerDay: t.baseOzPerDay,
    velocityRatio: t.velocityRatio,
    cushionPct: t.cushionPct,
    perOrderUnitOz: t.perOrderUnitOz,
    peakFloorOz: t.peakFloorOz,
  });
  if (coverage == null) return null;

  const roundedTarget = roundToStep(coverage.targetUnits, t.parStep);
  const priorDirection = t.priorSuggestedPar != null ? t.priorDirection : 0;
  const verdict = applyGuardStack({
    locationId: input.locationId,
    skuId: input.skuId,
    dayClass: input.dayClass,
    currentPar: t.currentPar,
    targetUnits: coverage.targetUnits,
    parStep: t.parStep,
    priorSuggestedPar: t.priorSuggestedPar,
    priorGenerationId: null,
    directionConfirmed:
      priorDirection !== 0 && priorDirection === Math.sign(roundedTarget - t.currentPar),
    budgetSpent: t.suppressedBy === "budget",
    pinned: t.suppressedBy === "pin",
    // A READ PATH NEVER RUNS IN LIVE MODE. Even after the write bit is flipped this rule
    // only renders; "shadow" is what makes applyGuardStack's auto branch say `would_apply`
    // instead of claiming a write this code path will never perform.
    mode: "shadow",
  });
  if (verdict.suggestedPar == null || verdict.generationId == null) return null;
  if (verdict.tier === "none") return null;

  return {
    currentPar: t.currentPar,
    suggestedPar: verdict.suggestedPar,
    generationId: verdict.generationId,
    // Limitation (2) above: the ledger's tier is the ceiling.
    tier: verdict.tier === "auto" && t.ledgerTier === "auto" ? "auto" : "suggestion",
    reasonCode: verdict.reasonCode,
    coverThroughDate: input.coverThroughDate,
    coveredDayCount: input.coveredDays.length,
    cushionPct: t.cushionPct,
    flooredByPeak: coverage.flooredByPeak,
    velocityApplied: t.velocityApplied,
    slotCreation: verdict.slotCreation,
    canAct: input.canAct,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The reason lane's aggregate (Task 4.6) — pure, client-safe
// ─────────────────────────────────────────────────────────────────────────────

/** One cause of silence, with a capped sample of the SKUs it is speaking about. */
export interface ParSilenceCauseRow {
  cause: ParReasonCode;
  count: number;
  /** Capped at SILENCE_SAMPLE_CAP; the copy says "and N more" for the rest. */
  sampleSkuNames: string[];
}

/**
 * THE FLAGSHIP DELIVERABLE, as a payload. v1's engine can honestly speak for ~14 rows of
 * ~282; the other ~268 are the product, and this is how they reach a human — one aggregate
 * line plus a per-cause errand list, never a badge on 94% of the rows (plan D15).
 */
export interface ParSilenceSummary {
  /** Rows the engine could speak for. */
  speaking: number;
  /** Rows silenced, per cause, in ERRAND_REASONS order then the rest. */
  byCause: ParSilenceCauseRow[];
  /** True when a per-row badge is warranted — false today, and it flips itself (D15). */
  badgePerRow: boolean;
  /** Suggestions offered but not yet actioned, and auto-moves in the last 7 days. */
  suggestionsWaiting: number;
  autoMovesThisWeek: number;
  /** The run these numbers are about. null = the engine has never run here. */
  runDate: string | null;
  /**
   * Did the run that produced these numbers APPLY anything, or only watch?
   *
   * An OBSERVED fact — the ledger's own `mode` column — not a re-read of the build's
   * write bit, and deliberately so: the banner claims something about what happened at
   * this shop, and the honest source for that is the row the engine wrote. It rides on
   * this summary rather than on its own query because it comes off the same head read.
   * `WalkerData.shadowMode` is set from it. False when the engine has never run here —
   * nothing is watching, so there is nothing to announce.
   */
  shadowMode: boolean;
}

/** Named SKUs per cause, capped — the named-when-few discipline the products admin's
 *  retirement warning already uses. Beyond the cap the copy counts instead of naming. */
export const SILENCE_SAMPLE_CAP = 3;

/**
 * The two causes that are NOT errands and never will be: packaging was never
 * demand-derived, and a retired product's par is suppressed on purpose (#283). They are
 * still listed — a bucket that reads "other" is a bug — but they sort LAST, and the panel
 * renders them in its quieter group.
 */
export const NOT_A_FAULT_REASONS: ReadonlySet<ParReasonCode> = new Set<ParReasonCode>([
  "inventory_only", "product_retired",
]);

/** The empty summary: what a location with no ledger rows at all honestly reports. */
export const EMPTY_PAR_SILENCE: ParSilenceSummary = {
  speaking: 0, byCause: [], badgePerRow: false,
  suggestionsWaiting: 0, autoMovesThisWeek: 0, runDate: null, shadowMode: false,
};

/** One `par_auto_moves` row, as much of it as the silence rollup reads. */
export interface SilenceLedgerRow {
  skuId: string;
  reasonCode: ParReasonCode;
  skuName: string | null;
}

/**
 * Roll the latest run's rows into the errand list. PURE, so the ordering rule is stated
 * once and unit-tested instead of living inside a query's `.order()`.
 *
 * `ok` is not a cause: a row the engine spoke for is counted in `speaking`, never listed.
 * Every other reason code IS listed, including the two not-a-fault ones — the panel groups
 * them visually, but a cause bucket that reads "other" is a bug (Task 4.6's success
 * criterion), so nothing is swallowed here.
 */
export function rollupParSilence(
  rows: ReadonlyArray<SilenceLedgerRow>,
  extras: {
    suggestionsWaiting: number;
    autoMovesThisWeek: number;
    runDate: string | null;
    shadowMode: boolean;
  },
): ParSilenceSummary {
  let speaking = 0;
  const byCause = new Map<ParReasonCode, { count: number; names: string[] }>();
  for (const r of rows) {
    if (r.reasonCode === "ok") { speaking += 1; continue; }
    const entry = byCause.get(r.reasonCode) ?? { count: 0, names: [] };
    entry.count += 1;
    if (r.skuName != null && entry.names.length < SILENCE_SAMPLE_CAP) entry.names.push(r.skuName);
    byCause.set(r.reasonCode, entry);
  }
  // THREE TIERS, and the bottom one is why: 114 of CO's silent rows are packaging, and a
  // plain vocabulary order would put `inventory_only` above every real errand and bury the
  // list this panel exists for (Task 4.6). Errands in the r2-13 critical-path order · then
  // the remaining faults · then the two NOT-A-FAULT causes, last, always.
  const rank = (c: ParReasonCode): number => {
    const errand = ERRAND_REASONS.indexOf(c);
    if (errand >= 0) return errand;
    return (NOT_A_FAULT_REASONS.has(c) ? 2000 : 1000) + PAR_REASON_CODES.indexOf(c);
  };
  const ordered: ParSilenceCauseRow[] = [...byCause.entries()]
    .map(([cause, e]) => ({ cause, count: e.count, sampleSkuNames: e.names }))
    .sort((a, b) => rank(a.cause) - rank(b.cause));
  const silent = rows.length - speaking;
  return {
    speaking,
    byCause: ordered,
    badgePerRow: shouldBadgeSilencePerRow(silent, rows.length),
    suggestionsWaiting: extras.suggestionsWaiting,
    autoMovesThisWeek: extras.autoMovesThisWeek,
    runDate: extras.runDate,
    shadowMode: extras.shadowMode,
  };
}
