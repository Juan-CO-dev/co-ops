/**
 * Pure recipe-math engine (Item/Inventory Spine — R1). No I/O, client-safe.
 *
 * Two oz-conversions (see spec §2): SKU→oz (content_oz, via avg_oz_per_each) and
 * the recipe per-unit math (per-batch ÷ batch_yield, in oz). Weight measures
 * convert via the registry's to_base_factor; count/volume measures use the SKU's
 * entered avg_oz_per_each. Consumed by the SKU content_oz readout now (R1) and by
 * cost/yield (R2). Every function returns null when an input is missing rather
 * than guessing — callers render "—".
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

/** oz of a SKU component consumed per ONE par-unit = (component oz ÷ batch_yield). */
export function componentPerUnitOz(
  args: { quantity: number; unit: string | null; batchYield: number; skuAvgOzPerEach: number | null },
  measuresByLabel: Map<string, MeasureUnitFactor>,
): number | null {
  if (!Number.isFinite(args.batchYield) || args.batchYield <= 0) return null;
  const oz = ozFromMeasure(args.quantity, args.unit, measuresByLabel, args.skuAvgOzPerEach);
  return oz == null ? null : oz / args.batchYield;
}

/**
 * oz of inputs consumed per ONE par-unit of `item` = Σ component per-unit oz.
 * Sub-item components resolve via `resolveSubItemPerUnitOz` (the caller handles
 * recursion + memoization; R2 wires this). Returns null if any component is
 * unresolved (so the caller can show "incomplete recipe").
 */
export function itemPerUnitOz(
  batchYield: number,
  components: Array<{
    quantity: number;
    unit: string | null;
    componentSkuId: string | null;
    componentItemId: string | null;
    skuAvgOzPerEach: number | null;
  }>,
  measuresByLabel: Map<string, MeasureUnitFactor>,
  resolveSubItemPerUnitOz: (itemId: string) => number | null,
): number | null {
  if (!Number.isFinite(batchYield) || batchYield <= 0) return null;
  let sum = 0;
  for (const c of components) {
    let oz: number | null;
    if (c.componentSkuId != null) {
      oz = componentPerUnitOz(
        { quantity: c.quantity, unit: c.unit, batchYield, skuAvgOzPerEach: c.skuAvgOzPerEach },
        measuresByLabel,
      );
    } else if (c.componentItemId != null) {
      const sub = resolveSubItemPerUnitOz(c.componentItemId);
      oz = sub == null || !Number.isFinite(batchYield) ? null : (c.quantity * sub) / batchYield;
    } else {
      oz = null;
    }
    if (oz == null) return null;
    sum += oz;
  }
  return sum;
}

/** "This pack makes ≈ N par-units" = content_oz ÷ per-unit oz. Null if perUnitOz ≤ 0. */
export function packYieldForComponent(contentOz: number | null, perUnitOz: number | null): number | null {
  if (contentOz == null || perUnitOz == null || perUnitOz <= 0) return null;
  return contentOz / perUnitOz;
}

// ── Cost (R2) — ride the same per-batch ÷ batch_yield math as the oz functions. ──

/** Cost of ONE oz of a SKU = pack price ÷ content_oz. Null if price/content missing. */
export function skuCostPerOz(packPrice: number | null, contentOz: number | null): number | null {
  if (packPrice == null || contentOz == null || contentOz <= 0) return null;
  const v = packPrice / contentOz;
  return Number.isFinite(v) ? v : null;
}

/**
 * Cost of a SKU component per ONE par-unit = componentPerUnitOz × cost/oz.
 * (componentPerUnitOz already divides per-batch quantity by batch_yield.)
 */
export function componentPerUnitCost(
  args: {
    quantity: number;
    unit: string | null;
    batchYield: number;
    skuAvgOzPerEach: number | null;
    skuCostPerOz: number | null;
  },
  measuresByLabel: Map<string, MeasureUnitFactor>,
): number | null {
  if (args.skuCostPerOz == null) return null;
  const perUnitOz = componentPerUnitOz(
    { quantity: args.quantity, unit: args.unit, batchYield: args.batchYield, skuAvgOzPerEach: args.skuAvgOzPerEach },
    measuresByLabel,
  );
  return perUnitOz == null ? null : perUnitOz * args.skuCostPerOz;
}

/**
 * Cost of inputs consumed per ONE par-unit of `item` = Σ component costs.
 * SKU components cost via `skuCostPerOzById`; sub-item components recurse via
 * `resolveSubItemPerUnitCost` and divide by `batchYield` — the SAME per-batch
 * semantics as `itemPerUnitOz` (component quantities are per-batch; this resolves
 * the R1 spec-prose carry-forward — the code was correct). Null if any component
 * cost is unresolved (UI shows "— incomplete").
 */
export function itemPerUnitCost(
  batchYield: number,
  components: Array<{
    quantity: number;
    unit: string | null;
    componentSkuId: string | null;
    componentItemId: string | null;
    skuAvgOzPerEach: number | null;
  }>,
  measuresByLabel: Map<string, MeasureUnitFactor>,
  skuCostPerOzById: Map<string, number | null>,
  resolveSubItemPerUnitCost: (itemId: string) => number | null,
): number | null {
  if (!Number.isFinite(batchYield) || batchYield <= 0) return null;
  let sum = 0;
  for (const c of components) {
    let cost: number | null;
    if (c.componentSkuId != null) {
      cost = componentPerUnitCost(
        {
          quantity: c.quantity,
          unit: c.unit,
          batchYield,
          skuAvgOzPerEach: c.skuAvgOzPerEach,
          skuCostPerOz: skuCostPerOzById.get(c.componentSkuId) ?? null,
        },
        measuresByLabel,
      );
    } else if (c.componentItemId != null) {
      const sub = resolveSubItemPerUnitCost(c.componentItemId);
      cost = sub == null ? null : (c.quantity * sub) / batchYield;
    } else {
      cost = null;
    }
    if (cost == null) return null;
    sum += cost;
  }
  return sum;
}

/** Food-cost fraction = per-unit cost ÷ sell price (caller ×100 for %). */
export function foodCostPct(perUnitCost: number | null, menuPrice: number | null): number | null {
  if (perUnitCost == null || menuPrice == null || menuPrice <= 0) return null;
  return perUnitCost / menuPrice;
}
