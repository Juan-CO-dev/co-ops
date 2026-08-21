/**
 * Admin cost — the PURE half (zero I/O, no server imports), split out per the
 * house `*-shared.ts` law so the derivation that decides what a SKU costs can be
 * test-pinned instead of only being reachable through a service-role page load.
 *
 * lib/admin/cost.ts re-exports everything here, so existing server consumers keep
 * their import paths unchanged.
 *
 * ── WHY THE CHAIN IS A REQUIRED ARGUMENT ────────────────────────────────────
 *
 * `skuContentOz` resolves ounces from a SKU's active PACK CHAIN when it has one,
 * and falls back to the legacy flat trio (units_per_pack × each_size ×
 * oz-per-measure) only when it does not. This function used to call it WITHOUT a
 * chain, so /admin/skus and /admin/vendors/[id] rode the legacy path while the
 * menu-costing board derived from `graph.skuPack`, which carries the chain.
 *
 * The flat trio is a MIRROR, not a source of truth: `replaceSkuPackChain` derives
 * and writes it on every chain save, explicitly as a stopgap, and explicitly
 * NON-FATALLY ("chain saved; flat fields stale"). The ordinary SKU edit path
 * writes `units_per_pack` directly without touching the chain. So the two
 * derivations agree only for as long as that mirror stays in sync — verified
 * true across all 182 live SKUs on 2026-08-21, and one failed sync away from
 * silently splitting the cost board from the catalog screens.
 *
 * Passing the chain is therefore not an optimization, it is the correctness
 * condition — and the argument is REQUIRED rather than optional because an
 * optional one is exactly how the blindness returns the first time a new caller
 * forgets it.
 */
import type { MeasureUnitOption } from "@/lib/admin/skus";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import { skuContentOz, skuCostPerOz, type MeasureUnitFactor } from "@/lib/recipe-math";

/** The chain map both admin pages already load (ONE query, the loadRecipeGraph law). */
export type SkuChainMap = ReadonlyMap<string, PackChainLevel[]>;

/** The flat pack fields a SkuView carries, as `skuContentOz` wants them. */
export interface SkuCostShape {
  id: string;
  unitsPerPack: number | null;
  eachSize: number | null;
  eachMeasure: string | null;
  avgOzPerEach: number | null;
}

/** measure label → factor, the lookup `skuContentOz` resolves units through. */
export function measureFactorMap(measures: MeasureUnitOption[]): Map<string, MeasureUnitFactor> {
  return new Map<string, MeasureUnitFactor>(
    measures.map((x) => [x.label, { dimension: x.dimension, toBaseFactor: x.toBaseFactor }]),
  );
}

/**
 * cost/oz per SKU = current price ÷ content_oz, CHAIN-AWARE.
 *
 * null when the SKU has no current price OR no resolvable content_oz — the two
 * are indistinguishable downstream and both mean "this line cannot be costed",
 * which is the same contract lib/admin/menu-costing.ts's board states.
 */
export function computeSkuCostPerOz(
  skus: SkuCostShape[],
  prices: Map<string, number>,
  measures: MeasureUnitOption[],
  chains: SkuChainMap,
): Map<string, number | null> {
  const m = measureFactorMap(measures);
  const out = new Map<string, number | null>();
  for (const s of skus) {
    out.set(s.id, skuCostPerOz(prices.get(s.id) ?? null, contentOzForSku(s, chains.get(s.id) ?? null, m)));
  }
  return out;
}

/**
 * content_oz for ONE SKU — the single derivation every dollar figure on the admin
 * cost surfaces rides ($/oz, the received-oz ledger, consumed dollars).
 *
 * Kept as one named function rather than three inline `skuContentOz` calls
 * because the three numbers must move together: a $/oz that is chain-aware while
 * consumed-dollars is not would put two disagreeing figures in the SAME drawer.
 */
export function contentOzForSku(
  sku: Omit<SkuCostShape, "id">,
  chain: PackChainLevel[] | null,
  measuresByLabel: Map<string, MeasureUnitFactor>,
): number | null {
  return skuContentOz(
    {
      unitsPerPack: sku.unitsPerPack,
      eachSize: sku.eachSize,
      eachMeasure: sku.eachMeasure,
      avgOzPerEach: sku.avgOzPerEach,
      packChain: chain,
    },
    measuresByLabel,
  );
}
