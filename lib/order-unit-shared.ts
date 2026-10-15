/**
 * The ORDER UNIT of a SKU — PURE, client-safe (catalog Phase 2b moved these out of lib/ordering.ts
 * so the item page's preview can import them; lib/ordering.ts imports AND re-exports perOrderUnitOz,
 * so the walker and the nightly pars engine keep ONE spelling of the denominator).
 *
 * oz of ONE order unit for a SKU. The order unit is the chain ROOT container (chained) or one
 * pack_format pack (unchained). Advisory-null when the conversion can't resolve (A3 — never
 * fabricate):
 *   chained  → ozForRecipeInput(1, rootLabel, skuShape, measures) (walks the chain).
 *              A malformed / count-terminated-unresolvable chain → null.
 *   unchained→ skuContentOz(skuShape, measures) = oz of one pack (the pack_format unit).
 * Pure over the passed shapes; the caller batch-loads chains + measures once.
 *
 * The order-unit denominator is the whole coverage layer's arithmetic — a second spelling of it
 * would let the engine suggest a par in units the walker does not mean. Pars are stored in these units.
 */
import { buildPackChain, chainRootLabel, type PackChainLevel } from "@/lib/pack-chain-shared";
import { ozForRecipeInput, skuContentOz, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";

export function perOrderUnitOz(
  sku: RecipeInputSku,
  chain: PackChainLevel[] | null,
  measures: Map<string, MeasureUnitFactor>,
): number | null {
  const hasChain = chain != null && chain.length > 0;
  if (hasChain) {
    const root = chainRootLabel(buildPackChain(chain));
    if (root == null) return null; // no unique root → can't name the order unit → advisory-null.
    return ozForRecipeInput(1, root, sku, measures);
  }
  // Unchained: the order unit is one pack_format pack; its oz is the pack content.
  return skuContentOz(sku, measures);
}

/** The order-unit label = chain root label (chained) else pack_format else null. */
export function orderUnitLabel(packFormat: string | null, chain: PackChainLevel[] | null): string | null {
  if (chain != null && chain.length > 0) {
    const root = chainRootLabel(buildPackChain(chain));
    if (root != null) return root;
  }
  return packFormat;
}
