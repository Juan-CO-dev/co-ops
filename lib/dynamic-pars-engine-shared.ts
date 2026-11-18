/**
 * DYNAMIC PARS — the nightly engine as ONE PURE FUNCTION (item 4 PR 1, 2026-11-17).
 *
 * PURE: zero I/O, no server imports. `computeParLedger` is the body of the nightly run, MOVED here
 * verbatim from lib/dynamic-pars.ts so that the demand-signal replay harness (lib/demand-signals) runs
 * the very engine the shop runs, over a stored copy of its inputs, and never a second spelling of it.
 * `runParShadowForLocation` loads the inputs, calls this, and writes the rows; nothing else changed.
 * tests/dynamic-pars-engine-equivalence.test.ts pins the move against a golden produced by the loop
 * text as it stood before it (ba3e603c).
 *
 * `DemandInputs` is everything the engine reads. It is plain data (maps, sets, numbers, dates), which
 * is what makes a night replayable: store the inputs, and the rows can be recomputed at any later time.
 */
import { resolveParSlot, type LocationSkuOverlay } from "@/lib/location-sku-shared";
import {
  coverageWindow, optimizationWalkDate,
  type CutoffRow, type RhythmRow, type RhythmSkip,
} from "@/lib/vendor-rhythm-shared";
import {
  SILENCING_REASONS,
  applyGuardStack, classifyParReason, computeBaseRate, computeCoverage,
  computeVelocityRatio, cushionFor, observedPeakCoverageOz, roundToStep,
  type DayClass, type GuardOutcome, type ParReasonCode, type VelocityDay, type WindowDay,
} from "@/lib/dynamic-pars-shared";
import { directionConfirmed, perSkuSeries, slotKey, type LedgerPrior } from "@/lib/dynamic-pars-run-shared";

/**
 * The nightly run evaluates the horizon AS IF walking at the start of the optimisation
 * day, so every cutoff on that day is still catchable. That is the LONGEST-reach reading
 * and it is what `detail.horizon_basis` records; the walker always overrides it with the
 * real instant, which is exactly R3-A. An "end of order day" spelling would be a lie
 * about the value.
 */
export const NIGHTLY_HORIZON_WALK_MINUTES = 0;

/** One par'd SKU, with everything the engine needs about it resolved ONCE. */
export interface DemandSku {
  skuId: string;
  name: string;
  vendorId: string;
  productId: string | null;
  /** The key the demand series is rolled to: the product when there is one, else the
   *  SKU itself (a SKU with product_id NULL is an implicit singleton — AGENTS.md). */
  grainKey: string;
  inventoryOnly: boolean;
  productRetired: boolean;
  cushionClass: string | null;
  parStep: number;
  globalWeekdayPar: number | null;
  globalWeekendPar: number | null;
  perOrderUnitOz: number | null;
  hasPackChain: boolean;
  /**
   * R3-B: auto values are conceptually product-grain but physically home on the STABLE
   * PRIMARY's slot — the DESIGNATED primary (`product_primaries`, location row over
   * global), never the ladder's transient runtime answer. A write to a backup carrier
   * orphans on restore, taking the tuned par with it.
   */
  writeHomeSkuId: string;
}

export interface DemandInputs {
  locationId: string;
  runDateEt: string;
  window: WindowDay[];
  skus: DemandSku[];
  overlayBySku: Map<string, ParOverlayRow>;
  /** date → (skuId → oz), already rolled to product grain. */
  directOzByDate: Map<string, Map<string, number>>;
  productionOzByDate: Map<string, Map<string, number>>;
  flattenedOzByDate: Map<string, Map<string, number>>;
  /** grainKey → the first ET date any of this SKU's three lanes was alive here
   *  (`deriveLaneStart`). Null = none of them ever was. */
  laneStartByGrain: Map<string, string | null>;
  /** ET dates the catering detector flagged (plan D4). */
  suspectDays: Set<string>;
  signalsStartAt: string | null;
  rhythmByVendor: Map<string, RhythmRow[]>;
  skipsByVendor: Map<string, RhythmSkip[]>;
  cutoffsByVendor: Map<string, CutoffRow[]>;
  /** `${skuId}:${dayClass}` → the previous run's rendered opinion. */
  priorBySlot: Map<string, LedgerPrior>;
  /** `${skuId}:${dayClass}` → non-manual par writes inside the budget window. */
  budgetSpentBySlot: Set<string>;
  recipeEditedAt: string | null;
  /** No observed day at all at this location — the cold-start seam (not wired in v1). */
  noLocalHistory: boolean;
  /** skuId → this shop's current pack epoch (absent = 0). Stamped on every ledger row (W18/B106). */
  packEpochBySku?: ReadonlyMap<string, number>;
}

/** The per-slot overlay the engine reads: the human lane, the machine lane, the pin. */
export interface ParOverlayRow extends LocationSkuOverlay {
  /** The per-location activation override. Read for the SAME reason loadWalkerData reads
   *  it: `resolveActive(activeOverride, sku.active)` decides whether this SKU is part of
   *  THIS shop's walk at all, and the ledger's universe must be the walker's universe. */
  activeOverride: boolean | null;
  pinnedWeekdayAt: string | null;
  pinnedWeekendAt: string | null;
}

/** One `par_auto_moves` row, exactly as the table spells it. */
export interface ParLedgerRow {
  run_date: string;
  location_id: string;
  sku_id: string;
  day_class: DayClass;
  mode: "shadow" | "live";
  tier: "auto" | "suggestion" | "none";
  outcome: "would_apply" | "applied" | "suppressed" | "advisory_null";
  suppressed_by: string | null;
  reason_code: ParReasonCode;
  generation_id: string | null;
  current_par: number | null;
  target_par: number | null;
  suggested_par: number | null;
  par_step: number | null;
  slot_creation: boolean;
  base_rate_oz_per_day: number | null;
  observed_days: number | null;
  gap_days: number | null;
  velocity_ratio: number | null;
  cushion_pct: number | null;
  per_order_unit_oz: number | null;
  peak_floor_oz: number | null;
  coverage_days: number | null;
  next_delivery_date: string | null;
  cover_through_date: string | null;
  detail: Record<string, unknown>;
}

/**
 * ONE NIGHT for one location: every (SKU, day-class) row the ledger gets, in the nightly run's own order.
 * The ORDER and the SHORT-CIRCUITS are the function; every rule it applies lives in the pure core.
 */
export function computeParLedger(inputs: DemandInputs, mode: "shadow" | "live"): ParLedgerRow[] {
  const { locationId, runDateEt } = inputs;
  const ledger: ParLedgerRow[] = [];

  for (const sku of inputs.skus) {
    // The demand terms are computed ONCE per SKU — they are day-class-split internally,
    // and they are the expensive half (21 days x 2 lanes).
    const base = computeBaseRate({
      window: inputs.window,
      directOzByDate: perSkuSeries(inputs.directOzByDate, sku.skuId),
      productionOzByDate: perSkuSeries(inputs.productionOzByDate, sku.skuId),
      flattenedOzByDate: perSkuSeries(inputs.flattenedOzByDate, sku.skuId),
      laneStartAt: inputs.laneStartByGrain.get(sku.grainKey) ?? null,
      salesFallbackComplete: true,
    });

    const velocitySeries: VelocityDay[] = base.series.map((d) => ({
      dateEt: d.dateEt,
      dayClass: d.dayClass,
      oz: d.oz,
      suspect: inputs.suspectDays.has(d.dateEt),
    }));
    const velocity = computeVelocityRatio({
      series: velocitySeries,
      baseByDayClass: {
        weekday: base.byDayClass.weekday.ozPerDay,
        weekend: base.byDayClass.weekend.ozPerDay,
      },
      perOrderUnitOz: sku.perOrderUnitOz,
      recipeEditedAt: inputs.recipeEditedAt,
      signalsStartAt: inputs.signalsStartAt,
    });

    const rhythm = inputs.rhythmByVendor.get(sku.vendorId) ?? [];
    const overlay = inputs.overlayBySku.get(sku.skuId) ?? null;

    for (const dayClass of ["weekday", "weekend"] as const) {
      const rate = base.byDayClass[dayClass];
      const slot = resolveParSlot(
        overlay,
        { weekdayPar: sku.globalWeekdayPar, weekendPar: sku.globalWeekendPar },
        dayClass,
      );
      const currentPar = slot.value;
      const push = (row: ParLedgerRow) => ledger.push(row);
      const shell = (): ParLedgerRow => ({
        run_date: runDateEt, location_id: locationId, sku_id: sku.skuId, day_class: dayClass,
        mode, tier: "none", outcome: "advisory_null", suppressed_by: null,
        reason_code: "ok", generation_id: null,
        current_par: currentPar, target_par: null, suggested_par: null, par_step: sku.parStep,
        slot_creation: currentPar == null,
        base_rate_oz_per_day: rate.ozPerDay, observed_days: rate.observedDays,
        gap_days: rate.gapDays, velocity_ratio: velocity.ratio,
        cushion_pct: null, per_order_unit_oz: sku.perOrderUnitOz, peak_floor_oz: null,
        coverage_days: null, next_delivery_date: null, cover_through_date: null,
        detail: {
          lane: slot.lane,
          lane_complete: base.laneComplete,
          lane_start_at: inputs.laneStartByGrain.get(sku.grainKey) ?? null,
          velocity_reason: velocity.reason,
          velocity_applied: velocity.applied,
          write_home_sku_id: sku.writeHomeSkuId,
          grain_key: sku.grainKey,
          horizon_basis: "nightly_start_of_order_day",
          // The pack epoch these order-unit terms were computed in (W18/B106). NOT part of the
          // generation id: the trust ramp counts distinct generations, and a format change would
          // mint a new one for every standing suggestion overnight.
          pack_epoch: inputs.packEpochBySku?.get(sku.skuId) ?? 0,
        },
      });
      const advisoryNullRow = (reason: ParReasonCode): ParLedgerRow => ({
        ...shell(), reason_code: reason,
      });

      // ① THE REASON LADDER RUNS FIRST AND SHORT-CIRCUITS. A silenced row still gets a
      //    FULL ledger row — the reason lane IS the product, so a silent par is a WRITE.
      const reason = classifyParReason({
        inventoryOnly: sku.inventoryOnly,
        productRetired: sku.productRetired,
        depletionCurrent: true, // the cron gates on the watermark BEFORE calling this.
        laneNeverStarted: base.laneNeverStarted,
        laneComplete: base.laneComplete,
        perOrderUnitOz: sku.perOrderUnitOz,
        hasPackChain: sku.hasPackChain,
        hasRhythm: rhythm.length > 0,
        thin: rate.thin,
        slotExists: currentPar != null,
        noLocalHistory: inputs.noLocalHistory,
      });
      // THE ONE CARVE-OUT, and it is D16's: `slot_creation` is a SILENCING reason on the
      // WALKER (never a row-level number) but it is NOT a reason to stop computing. D16
      // requires the weekend day-class to be "always computed and always ledgered with
      // slot_creation = true" so the aggregate can say "N SKUs look like they want a
      // separate weekend par" — and applyGuardStack already carries a slot-creation branch
      // that produces exactly that number. Short-circuiting here would make that branch
      // dead code and blind the aggregate to its own subject.
      if (SILENCING_REASONS.has(reason) && reason !== "slot_creation") {
        push(advisoryNullRow(reason));
        continue;
      }

      // ② The horizon THIS RUN computes with. The weekend day-class optimises the FRIDAY
      //    walk (the longest gap, r3); the rendered suggestion re-selects live (R3-A).
      const walkDateEt = optimizationWalkDate(dayClass, runDateEt);
      const window = coverageWindow({
        rhythm,
        cutoffs: inputs.cutoffsByVendor.get(sku.vendorId) ?? [],
        skips: inputs.skipsByVendor.get(sku.vendorId) ?? [],
        locationId,
        walkDateEt,
        walkMinutesEt: NIGHTLY_HORIZON_WALK_MINUTES,
      });
      if (window == null) { push(advisoryNullRow("no_vendor_rhythm")); continue; }

      // ③ + ④ the terms and the coverage — all pure, all persisted.
      const cushion = cushionFor(
        { cushionClass: sku.cushionClass },
        { id: locationId },
        { ozPerDay: rate.ozPerDay, observedDays: rate.observedDays },
      );
      // Like-for-like (Juan 2026-11-17): only history runs with the horizon's own
      // weekday/weekend mix may floor it.
      const peakFloorOz = observedPeakCoverageOz(base.series, window.coveredDays);
      const coverage = computeCoverage({
        coveredDays: window.coveredDays,
        baseOzPerDay: {
          weekday: base.byDayClass.weekday.ozPerDay,
          weekend: base.byDayClass.weekend.ozPerDay,
        },
        velocityRatio: velocity.ratio,
        cushionPct: cushion.pct,
        perOrderUnitOz: sku.perOrderUnitOz,
        peakFloorOz,
      });
      const horizon = {
        cushion_class: cushion.classUsed,
        cushion_is_default: cushion.isDefault,
        optimisation_walk_date: walkDateEt,
        order_date: window.orderDateEt,
      };
      if (coverage == null) {
        // CAUSE ATTRIBUTION, not a default (LEAD RULING F3's principle: the ledger's
        // reasons are read as ERRANDS, so a wrong cause is a wrong errand). The ladder
        // already proved perOrderUnitOz is non-null, so a null coverage here means a day
        // in the horizon belongs to a day-class with NO rate — which is thin history in
        // the OTHER day-class, not a missing weight.
        const cause: ParReasonCode = sku.perOrderUnitOz == null ? "no_weight_basis" : "thin_history";
        push({
          ...advisoryNullRow(cause),
          cushion_pct: cushion.pct,
          peak_floor_oz: peakFloorOz,
          coverage_days: window.coveredDays.length,
          next_delivery_date: window.nextDeliveryDate,
          cover_through_date: window.coverThroughDate,
          detail: { ...shell().detail, ...horizon },
        });
        continue;
      }

      // ⑤ the guard stack — the SAME code live mode runs, with a mode flag (r2-7).
      const prior = inputs.priorBySlot.get(slotKey(sku.skuId, dayClass)) ?? null;
      const roundedTarget = roundToStep(coverage.targetUnits, sku.parStep);
      const verdict: GuardOutcome = applyGuardStack({
        locationId,
        skuId: sku.skuId,
        dayClass,
        currentPar,
        targetUnits: coverage.targetUnits,
        parStep: sku.parStep,
        priorSuggestedPar: prior?.suggestedPar ?? null,
        priorGenerationId: prior?.generationId ?? null,
        // Two consecutive runs must agree on the DIRECTION, or step-rounding of a
        // continuous target oscillates 2.49 <-> 2.51 forever (r1-6).
        directionConfirmed: directionConfirmed(prior, currentPar, roundedTarget),
        budgetSpent: inputs.budgetSpentBySlot.has(slotKey(sku.skuId, dayClass)),
        pinned: (dayClass === "weekend" ? overlay?.pinnedWeekendAt : overlay?.pinnedWeekdayAt) != null,
        mode,
      });

      push({
        ...shell(),
        tier: verdict.tier,
        outcome: verdict.outcome,
        suppressed_by: verdict.suppressedBy,
        reason_code: verdict.reasonCode,
        generation_id: verdict.generationId,
        target_par: coverage.targetUnits,
        suggested_par: verdict.suggestedPar,
        slot_creation: verdict.slotCreation,
        cushion_pct: cushion.pct,
        peak_floor_oz: peakFloorOz,
        coverage_days: window.coveredDays.length,
        next_delivery_date: window.nextDeliveryDate,
        cover_through_date: window.coverThroughDate,
        detail: {
          ...shell().detail,
          ...horizon,
          demand_oz: coverage.demandOz,
          covered_oz: coverage.coveredOz,
          floored_by_peak: coverage.flooredByPeak,
          prior_suggested_par: prior?.suggestedPar ?? null,
          prior_direction: prior?.direction ?? 0,
        },
      });
    }
  }

  return ledger;
}
