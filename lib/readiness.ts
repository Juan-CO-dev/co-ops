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

import {
  buildPackChain,
  isChainUnverified,
  type PackChainLevel,
  type PackChainSkuClass,
} from "@/lib/pack-chain-shared";
import type { MeasureUnitFactor } from "@/lib/recipe-math";

export type ReadinessStatus = "ready" | "incomplete" | "upstream_gaps";

/** Closed reason vocabulary — reconcile against readiness.reason.* i18n keys
 * in BOTH en.json and es.json (interpolated keys are grep-invisible). */
export const KNOWN_REASONS = [
  "missing_pack", "missing_price", "no_delivery",
  "no_inputs", "no_outputs", "no_batch_yield",
  "not_ready_skus", "not_ready_subitems",
  "no_recipe", "no_oz_per_par_unit", "sell_incomplete", "upstream_recipe",
  "duplicate_producers",
  // A recipe line pins a PRODUCT that cannot be resolved to a member SKU today, or
  // whose unit cannot be denominated without a products.unit_oz (0179). Either way
  // the flatten poisons and the recipe genuinely cannot be costed — a RED fault,
  // not the amber ambiguity duplicate_producers describes.
  "unresolved_product",
] as const;
export type ReasonCode = (typeof KNOWN_REASONS)[number];

export interface Reason { code: ReasonCode; count?: number }
export interface Readiness { status: ReadinessStatus; reasons: Reason[] }

const READY: Readiness = { status: "ready", reasons: [] };

/**
 * Pack definition complete (SKU top-tier PR-C — chain-aware by DELEGATION).
 *
 * When the SKU carries an active pack CHAIN, "pack-complete" ⇔ the chain is NOT
 * unverified — i.e. it delegates to the SAME single badge predicate the catalog
 * uses (isChainUnverified: structural validity for every class, plus
 * oz-resolvability only for raw). A non-raw count-terminated chain is complete by
 * design; a raw chain that can't reach ounces is not. There is NO third rule.
 *
 * When there is NO chain, the LEGACY flat-trio rule is unchanged
 * (units_per_pack + each_size + each_measure all set). The chain/measures/class
 * params are OPTIONAL so flat-only callers (scripts, any un-migrated site) keep
 * their exact behavior with no call-site change.
 */
export function skuPackComplete(
  s: { unitsPerPack: number | null; eachSize: number | null; eachMeasure: string | null; avgOzPerEach?: number | null },
  chain?: PackChainLevel[] | null,
  measuresByLabel?: Map<string, MeasureUnitFactor>,
  skuClass?: PackChainSkuClass,
): boolean {
  if (chain && chain.length > 0 && measuresByLabel) {
    return !isChainUnverified(buildPackChain(chain), measuresByLabel, s.avgOzPerEach ?? null, skuClass ?? "raw");
  }
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
  /**
   * How many PRODUCT-pinned inputs cannot resolve today (0179). RED, not amber: an
   * unresolved product poisons the flatten, so the recipe has no cost and no
   * depletion at all — the same grade of fault as a missing batch yield. Optional
   * so every caller that predates products keeps its exact behavior (0 = none).
   */
  unresolvedProducts = 0,
): Readiness {
  const badSkus = inputSkuStatuses.filter((s) => s !== "ready").length;
  const badSubs = inputSubItemStatuses.filter((s) => s !== "ready").length;
  const upstreamReasons: Reason[] = [];
  if (badSkus > 0) upstreamReasons.push({ code: "not_ready_skus", count: badSkus });
  if (badSubs > 0) upstreamReasons.push({ code: "not_ready_subitems", count: badSubs });
  const ownReasons = unresolvedProducts > 0
    ? [...own.reasons, { code: "unresolved_product" as const, count: unresolvedProducts }]
    : own.reasons;
  if (own.status === "incomplete" || unresolvedProducts > 0) {
    return { status: "incomplete", reasons: [...ownReasons, ...upstreamReasons] };
  }
  if (upstreamReasons.length > 0) return { status: "upstream_gaps", reasons: upstreamReasons };
  return READY;
}

/**
 * Item: own gaps (no producing recipe / no oz basis / sold-directly incomplete),
 * else inherits amber from its producing recipe's status.
 *
 * DUPLICATE ACTIVE PRODUCERS (multi-vendor audit P5, 2026-08-20). `activeProducerCount`
 * > 1 means two or more ACTIVE recipes claim to produce this item, and the costing graph
 * indexes producers first-wins — so one of them silently defines what the item costs and
 * depletes, and nothing in the data says which one is right. That is not a missing field,
 * so it never makes a row RED on its own; it is an ambiguity in the graph above the item,
 * which is exactly what the amber `upstream_gaps` bucket is for. It also RIDES ALONG on a
 * red row rather than being swallowed by it: an item can be both incomplete and ambiguous,
 * and the second fact does not stop mattering because the first one is louder.
 *
 * The parameter is optional so callers that cannot count producers keep their exact
 * behavior — an absent count is "unknown", which warns about nothing.
 */
export function itemReadiness(
  it: {
    hasProducingRecipe: boolean; ozPerParUnit: number | null;
    soldDirectly: boolean; sellPortionComplete: boolean;
    /** How many ACTIVE recipes produce this item. > 1 → the graph picks arbitrarily. */
    activeProducerCount?: number;
  },
  producingRecipeStatus: ReadinessStatus | null,
): Readiness {
  const producers = it.activeProducerCount ?? 0;
  const duplicate: Reason[] = producers > 1 ? [{ code: "duplicate_producers", count: producers }] : [];

  const reasons: Reason[] = [];
  if (!it.hasProducingRecipe) reasons.push({ code: "no_recipe" });
  if (!((it.ozPerParUnit ?? 0) > 0)) reasons.push({ code: "no_oz_per_par_unit" });
  if (it.soldDirectly && !it.sellPortionComplete) reasons.push({ code: "sell_incomplete" });
  if (reasons.length > 0) return { status: "incomplete", reasons: [...reasons, ...duplicate] };

  const upstream: Reason[] = [...duplicate];
  if (producingRecipeStatus !== null && producingRecipeStatus !== "ready") {
    upstream.push({ code: "upstream_recipe" });
  }
  if (upstream.length > 0) return { status: "upstream_gaps", reasons: upstream };
  return READY;
}
