/**
 * Pure recipe-math engine (Item/Inventory Spine — R1). No I/O, client-safe.
 *
 * SKU-level oz + cost conversions (see spec §2): SKU→oz (content_oz, via
 * avg_oz_per_each) and cost/oz. Weight measures convert via the registry's
 * to_base_factor; count/volume measures use the SKU's entered avg_oz_per_each.
 * Every function returns null when an input is missing rather than guessing —
 * callers render "—".
 *
 * DESIGN DECISION — volume units deliberately IGNORE to_base_factor: a volume
 * base (fl oz) cannot convert to our weight-oz universe without a density we
 * don't store, so volume-measured SKUs convert through the human-entered
 * avg_oz_per_each exactly like count units. The registry's to_base_factor for
 * volume rows is intentionally unused data, NOT a bug (locked by test).
 *
 * The old item-level aggregate functions (itemPerUnitOz/itemPerUnitCost etc.,
 * the item_components-era component-shape API) were deleted 2026-07-23 (Wave
 * 1.5) — zero callers; the live per-item flatten is lib/prep-consumption-graph.ts.
 */

import { buildPackChain, walkChainToOz, chainRootLabel, type PackChainLevel } from "@/lib/pack-chain-shared";

export type MeasureDimension = "weight" | "volume" | "count";

export interface MeasureUnitFactor {
  dimension: MeasureDimension;
  /** Factor to the dimension's canonical base (weight→oz, volume→fl oz, count→each). */
  toBaseFactor: number;
}

/** oz contributed by ONE each_measure unit: weight → factor (→oz); count/volume → the SKU's avg. */
function ozPerMeasureUnit(
  measure: MeasureUnitFactor,
  avgOzPerEach: number | null,
): number | null {
  if (measure.dimension === "weight") return measure.toBaseFactor;
  return avgOzPerEach != null && Number.isFinite(avgOzPerEach) ? avgOzPerEach : null;
}

/**
 * Total usable ounces per pack. Null if any required input is missing.
 *
 * CHAIN-AWARE (pack hierarchy, 0159): when the SKU carries active pack-chain
 * levels, content_oz = oz of ONE ROOT container, walked POINTER-directed
 * (lib/pack-chain-shared). The chain is consulted FIRST; the legacy flat-field
 * math (units_per_pack × each_size × oz-per-measure) is the fallback for SKUs
 * without a chain (back-compat until backfill completes — nothing breaks
 * pre-backfill). The two agree byte-for-byte on the 56 clean backfills (L7
 * parity invariant, test-pinned).
 */
export function skuContentOz(
  sku: {
    unitsPerPack: number | null;
    eachSize: number | null;
    eachMeasure: string | null;
    avgOzPerEach: number | null;
    /** Active pack-chain levels (0159). Omit/empty → legacy flat-field path. */
    packChain?: PackChainLevel[] | null;
  },
  measuresByLabel: Map<string, MeasureUnitFactor>,
): number | null {
  const { unitsPerPack, eachSize, eachMeasure, avgOzPerEach } = sku;

  // Chain path (preferred): content = oz of one root container.
  if (sku.packChain && sku.packChain.length > 0) {
    const chain = buildPackChain(sku.packChain);
    const root = chainRootLabel(chain);
    if (root != null) {
      const walk = walkChainToOz(chain, root, measuresByLabel, avgOzPerEach);
      if (walk.ok) return Number.isFinite(walk.oz) ? walk.oz : null;
      return null; // malformed chain → null loudly (never fall through to guess)
    }
    return null;
  }

  // Legacy flat-field path (SKUs without a chain).
  if (unitsPerPack == null || eachSize == null || eachMeasure == null) return null;
  const m = measuresByLabel.get(eachMeasure);
  if (!m) return null;
  const ozPerUnit = ozPerMeasureUnit(m, avgOzPerEach);
  if (ozPerUnit == null) return null;
  const total = unitsPerPack * eachSize * ozPerUnit;
  return Number.isFinite(total) ? total : null;
}

/** Convert a quantity in `unit` to oz; weight → ×factor, count/volume → ×avgFallback. */
export function ozFromMeasure(
  quantity: number,
  unit: string | null,
  measuresByLabel: Map<string, MeasureUnitFactor>,
  avgFallback: number | null,
): number | null {
  if (!Number.isFinite(quantity) || unit == null) return null;
  const m = measuresByLabel.get(unit);
  if (!m) return null;
  const ozPerUnit = ozPerMeasureUnit(m, avgFallback);
  if (ozPerUnit == null) return null;
  return quantity * ozPerUnit;
}

export interface RecipeInputSku {
  packFormat: string | null;
  eachContainerLabel: string | null;
  unitsPerPack: number | null;
  eachSize: number | null;
  eachMeasure: string | null;
  avgOzPerEach: number | null;
  /** Active pack-chain levels (0159). Omit/empty → legacy flat-field resolution. */
  packChain?: PackChainLevel[] | null;
}

/**
 * oz consumed by `quantity` of a SKU expressed in `unit`, resolving SKU pack levels.
 *
 * Resolution order (chain FIRST, then legacy, then measure registry — L2/back-compat):
 *  1. CHAIN: unit matches an active chain label → quantity × walkChainToOz(unit)
 *     (pointer-directed; the pack-hierarchy path — Capicola "case"/"log"/…).
 *  2. LEGACY flat fields (SKUs without a chain, until backfill completes):
 *       - unit === sku.packFormat         → quantity × unitsPerPack × eachSize × ozPerMeasureUnit(eachMeasure)
 *       - unit === sku.eachContainerLabel → quantity × eachSize × ozPerMeasureUnit(eachMeasure)
 *  3. MEASURE registry: a measure_units label like "oz"/"each" → ozFromMeasure(...).
 * Returns null if a required field is missing (never guesses).
 *
 * A chain label always wins over the same-named measure label — but L1 forbids a
 * chain label from equaling any measure_units label, so no collision arises in
 * practice; step 3 handles genuine measure-unit inputs ("oz", "each", "gram").
 */
export function ozForRecipeInput(
  quantity: number,
  unit: string | null,
  sku: RecipeInputSku,
  measuresByLabel: Map<string, MeasureUnitFactor>,
): number | null {
  if (!Number.isFinite(quantity) || unit == null) return null;

  // 1. Chain path (preferred): the unit names a chain level → walk it.
  if (sku.packChain && sku.packChain.length > 0) {
    const chain = buildPackChain(sku.packChain);
    if (chain.byLabel.has(unit)) {
      const walk = walkChainToOz(chain, unit, measuresByLabel, sku.avgOzPerEach);
      return walk.ok && Number.isFinite(quantity * walk.oz) ? quantity * walk.oz : null;
    }
    // unit isn't a chain label → fall through to the measure registry (step 3).
    // (A chained SKU deliberately does NOT honor the legacy pack/container labels;
    //  its chain is the source of truth for container units.)
    return ozFromMeasure(quantity, unit, measuresByLabel, sku.avgOzPerEach);
  }

  // 2. Legacy flat-field path (SKUs without a chain).
  const perEachOz = (): number | null => {
    if (sku.eachSize == null || sku.eachMeasure == null) return null;
    const m = measuresByLabel.get(sku.eachMeasure);
    if (!m) return null;
    const per = ozPerMeasureUnit(m, sku.avgOzPerEach);
    return per == null ? null : sku.eachSize * per;
  };
  if (unit === sku.packFormat) {
    const each = perEachOz();
    if (each == null || sku.unitsPerPack == null) return null;
    return quantity * sku.unitsPerPack * each;
  }
  if (unit === sku.eachContainerLabel) {
    const each = perEachOz();
    return each == null ? null : quantity * each;
  }
  // 3. Measure registry.
  return ozFromMeasure(quantity, unit, measuresByLabel, sku.avgOzPerEach);
}

// ── Cost (R2) — ride the same per-batch ÷ batch_yield math as the oz functions. ──

/** Cost of ONE oz of a SKU = pack price ÷ content_oz. Null if price/content missing. */
export function skuCostPerOz(packPrice: number | null, contentOz: number | null): number | null {
  if (packPrice == null || contentOz == null || contentOz <= 0) return null;
  const v = packPrice / contentOz;
  return Number.isFinite(v) ? v : null;
}
