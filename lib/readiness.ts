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
  // ── Retirement (Juan's ruling A+, 2026-08-21; sim P1-9) ───────────────────
  // A recipe line pins a RETIRED product (`products.active = false`). RED, and
  // deliberately SEPARATE from unresolved_product: that one says "no vendor sells
  // this right now / nobody weighed it" and the errand is the SKU catalog or a
  // scale; this one says "we do not buy this identity any more" and the errand is
  // the RECIPE — re-point the line. One word covering both would point half the
  // repairs at the wrong shelf.
  "retired_product",
  // A recipe line pins a vendor SKU that has been DEACTIVATED. LOUDNESS ONLY: it
  // never changes a status, because such a line's resolution behavior is unchanged
  // by this rule (loadSkuPack includes inactive SKUs deliberately, for historical
  // replay — flipping that moves live numbers and is its own decision). The line
  // ALREADY reads amber through not_ready_skus; this names WHY that SKU is not
  // ready, so the author sees "discontinued" instead of a bare count.
  "retired_sku",
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

/**
 * RETIREMENT PINS on one recipe (Juan's ruling A+, 2026-08-21). Both counts are
 * optional and default to 0, so every caller that predates retirement keeps its
 * exact behavior. They are an OBJECT rather than two more positional parameters:
 * six positional args, four of them numbers, is a call site nobody can read.
 */
export interface RecipeRetirementPins {
  /**
   * How many inputs pin a RETIRED product. RED and counted alongside — never
   * folded into — `unresolvedProducts`: both poison the flatten identically, but
   * they send an author to different places (re-point this line vs fix the SKU
   * catalog), and the loader classifies each pin into exactly one of them.
   */
  retiredProducts?: number;
  /**
   * How many inputs pin a DEACTIVATED vendor SKU. An AMBER RIDER, never a red
   * fault — that is the scope line of the ruling: for a deactivated SKU pin this
   * PR buys LOUDNESS only, because such a pin's resolution behavior is
   * deliberately unchanged (lib/prep-consumption.ts loadSkuPack includes inactive
   * SKUs for historical replay; flipping that moves live numbers and is its own
   * decision). Making the row RED would assert a refusal that does not exist.
   *
   * In the live loader it changes the status not at all: an inactive SKU is absent
   * from the readiness map, so the SAME pin already contributes a not-ready status
   * to `inputSkuStatuses` and the row is amber with or without this count. All the
   * rider adds is the WHY — "discontinued" instead of a bare not-ready tally.
   */
  retiredSkus?: number;
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
  pins: RecipeRetirementPins = {},
): Readiness {
  const retiredProducts = pins.retiredProducts ?? 0;
  const retiredSkus = pins.retiredSkus ?? 0;

  const badSkus = inputSkuStatuses.filter((s) => s !== "ready").length;
  const badSubs = inputSubItemStatuses.filter((s) => s !== "ready").length;
  const upstreamReasons: Reason[] = [];
  if (badSkus > 0) upstreamReasons.push({ code: "not_ready_skus", count: badSkus });
  if (badSubs > 0) upstreamReasons.push({ code: "not_ready_subitems", count: badSubs });
  // The SKU-retirement rider, in the AMBER bucket beside the count it explains —
  // never in `ownReasons`, so it can never make a row red (see the type's doc).
  if (retiredSkus > 0) upstreamReasons.push({ code: "retired_sku", count: retiredSkus });

  const ownReasons: Reason[] = [...own.reasons];
  if (unresolvedProducts > 0) ownReasons.push({ code: "unresolved_product", count: unresolvedProducts });
  if (retiredProducts > 0) ownReasons.push({ code: "retired_product", count: retiredProducts });

  if (own.status === "incomplete" || unresolvedProducts > 0 || retiredProducts > 0) {
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
