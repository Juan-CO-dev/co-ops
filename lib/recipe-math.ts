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

/** Total usable ounces per pack. Null if any required input is missing. */
export function skuContentOz(
  sku: {
    unitsPerPack: number | null;
    eachSize: number | null;
    eachMeasure: string | null;
    avgOzPerEach: number | null;
  },
  measuresByLabel: Map<string, MeasureUnitFactor>,
): number | null {
  const { unitsPerPack, eachSize, eachMeasure, avgOzPerEach } = sku;
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
}

/**
 * oz consumed by `quantity` of a SKU expressed in `unit`, resolving SKU pack levels:
 *  - unit === sku.packFormat         → quantity × unitsPerPack × eachSize × ozPerMeasureUnit(eachMeasure)
 *  - unit === sku.eachContainerLabel → quantity × eachSize × ozPerMeasureUnit(eachMeasure)
 *  - else (a measure_units label like "oz") → ozFromMeasure(quantity, unit, measures, avgOzPerEach)
 * Returns null if a required field is missing.
 */
export function ozForRecipeInput(
  quantity: number,
  unit: string | null,
  sku: RecipeInputSku,
  measuresByLabel: Map<string, MeasureUnitFactor>,
): number | null {
  if (!Number.isFinite(quantity) || unit == null) return null;
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
  return ozFromMeasure(quantity, unit, measuresByLabel, sku.avgOzPerEach);
}

// ── Cost (R2) — ride the same per-batch ÷ batch_yield math as the oz functions. ──

/** Cost of ONE oz of a SKU = pack price ÷ content_oz. Null if price/content missing. */
export function skuCostPerOz(packPrice: number | null, contentOz: number | null): number | null {
  if (packPrice == null || contentOz == null || contentOz <= 0) return null;
  const v = packPrice / contentOz;
  return Number.isFinite(v) ? v : null;
}
