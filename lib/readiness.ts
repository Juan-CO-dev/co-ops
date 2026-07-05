/**
 * Readiness rules (verify → go-live soft-gate, spine sub-project #2).
 * CLIENT-SAFE + PURE — no I/O, no supabase. Single source of truth for what
 * "Ready" means per entity. Server composition lives in lib/admin/readiness-load.ts.
 *
 * Vocabulary: 'ready' (no badge) | 'incomplete' (own fields missing — red)
 * | 'upstream_gaps' (own fields fine, something consumed isn't ready — amber).
 * Red wins display precedence; reasons may carry both.
 * NOTE: deliberately NOT named "verify" — items.opening_verify owns that word.
 */

export type ReadinessStatus = "ready" | "incomplete" | "upstream_gaps";

/** Closed reason vocabulary — reconcile against readiness.reason.* i18n keys
 * in BOTH en.json and es.json (interpolated keys are grep-invisible). */
export const KNOWN_REASONS = [
  "missing_pack", "missing_price", "no_delivery",
  "no_inputs", "no_outputs", "no_batch_yield",
  "not_ready_skus", "not_ready_subitems",
  "no_recipe", "no_oz_per_par_unit", "sell_incomplete", "upstream_recipe",
] as const;
export type ReasonCode = (typeof KNOWN_REASONS)[number];

export interface Reason { code: ReasonCode; count?: number }
export interface Readiness { status: ReadinessStatus; reasons: Reason[] }

const READY: Readiness = { status: "ready", reasons: [] };

/** Pack definition complete: units_per_pack + each_size + each_measure all set. */
export function skuPackComplete(s: {
  unitsPerPack: number | null; eachSize: number | null; eachMeasure: string | null;
}): boolean {
  return (s.unitsPerPack ?? 0) > 0 && (s.eachSize ?? 0) > 0 && !!s.eachMeasure;
}

/** SKU is the graph root — own signals only. Inactive → null (no badge, excluded from rollups). */
export function skuReadiness(s: {
  active: boolean; packComplete: boolean; hasPrice: boolean; deliveryCount: number;
}): Readiness | null {
  if (!s.active) return null;
  const reasons: Reason[] = [];
  if (!s.packComplete) reasons.push({ code: "missing_pack" });
  if (!s.hasPrice) reasons.push({ code: "missing_price" });
  if (s.deliveryCount < 1) reasons.push({ code: "no_delivery" });
  return reasons.length === 0 ? READY : { status: "incomplete", reasons };
}

/** Recipe OWN fields only (inputs/outputs/batch_yield). */
export function recipeOwnReadiness(r: {
  hasInputs: boolean; hasOutputs: boolean; batchYield: number | null;
}): Readiness {
  const reasons: Reason[] = [];
  if (!r.hasInputs) reasons.push({ code: "no_inputs" });
  if (!r.hasOutputs) reasons.push({ code: "no_outputs" });
  if (!((r.batchYield ?? 0) > 0)) reasons.push({ code: "no_batch_yield" });
  return reasons.length === 0 ? READY : { status: "incomplete", reasons };
}

/** Two-level compose: own red wins; else any not-ready input → amber.
 * inputSkuStatuses / inputSubItemStatuses = readiness statuses of the recipe's
 * SKU inputs and sub-item-input CHAINS respectively (sub-item chain status =
 * that item's itemReadiness status, transitively computed by the loader). */
export function composeRecipeReadiness(
  own: Readiness,
  inputSkuStatuses: ReadinessStatus[],
  inputSubItemStatuses: ReadinessStatus[],
): Readiness {
  const badSkus = inputSkuStatuses.filter((s) => s !== "ready").length;
  const badSubs = inputSubItemStatuses.filter((s) => s !== "ready").length;
  const upstreamReasons: Reason[] = [];
  if (badSkus > 0) upstreamReasons.push({ code: "not_ready_skus", count: badSkus });
  if (badSubs > 0) upstreamReasons.push({ code: "not_ready_subitems", count: badSubs });
  if (own.status === "incomplete") {
    return { status: "incomplete", reasons: [...own.reasons, ...upstreamReasons] };
  }
  if (upstreamReasons.length > 0) return { status: "upstream_gaps", reasons: upstreamReasons };
  return READY;
}

/** Item: own gaps (no producing recipe / no oz basis / sold-directly incomplete),
 * else inherits amber from its producing recipe's status. */
export function itemReadiness(
  it: {
    hasProducingRecipe: boolean; ozPerParUnit: number | null;
    soldDirectly: boolean; sellPortionComplete: boolean;
  },
  producingRecipeStatus: ReadinessStatus | null,
): Readiness {
  const reasons: Reason[] = [];
  if (!it.hasProducingRecipe) reasons.push({ code: "no_recipe" });
  if (!((it.ozPerParUnit ?? 0) > 0)) reasons.push({ code: "no_oz_per_par_unit" });
  if (it.soldDirectly && !it.sellPortionComplete) reasons.push({ code: "sell_incomplete" });
  if (reasons.length > 0) return { status: "incomplete", reasons };
  if (producingRecipeStatus !== null && producingRecipeStatus !== "ready") {
    return { status: "upstream_gaps", reasons: [{ code: "upstream_recipe" }] };
  }
  return READY;
}
