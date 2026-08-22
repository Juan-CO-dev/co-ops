/**
 * Dynamic Pars — the pure demand/guard core (client-safe, zero I/O, no server imports;
 * the `*-shared.ts` pattern, AGENTS.md).
 *
 * ⚠ PHASE 1 SEEDS THIS FILE WITH FOUR THINGS AND NOTHING ELSE. Task 1.6 (cushion-class +
 * par-step authoring on the SKU admin) needs the cushion vocabulary for its datalist and
 * the par-step inference for its placeholder. Rather than invent a Phase-1 copy that
 * Phase 2 would then have to reconcile — a second opinion about the par quantum is exactly
 * the drift this arc exists to end — the four functions below are authored HERE, verbatim
 * as the plan's Task 2.1 specifies them. Phase 2 fills in the rest of the module around
 * them (dayClassForDate, computeBaseRate, computeVelocityRatio, cushionFor,
 * computeCoverageSuggestion, applyGuardStack, stabilizeSuggestion, generationIdFor,
 * observedPeakCoverageOz, suggestedOrderQty, classifyParSilence, shouldBadgeSilencePerRow,
 * trustRampState, siblingBlendWeight) and adds their tests.
 */

/**
 * The cushion percentage per policy class. The CLASS is tenant data (a nullable,
 * deliberately un-enumerated `vendor_items.cushion_class` — plan D6, the 0177 precedent);
 * only these PERCENTAGES live in code.
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
