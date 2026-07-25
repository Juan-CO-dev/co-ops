/**
 * Prep-consumption graph resolver — PURE (no I/O, no server imports; fully unit-testable).
 *
 * Extracted from lib/prep-consumption.ts on 2026-07-23 (council finding: the
 * recursive flatten fired sequential DB queries per recipe node — an N+1 latent
 * cliff for the first real catering volume). The math here is byte-faithful to
 * the original recursive implementation; only the DATA ACCESS moved (the caller
 * now loads the whole recipe graph in a fixed number of queries — see
 * loadRecipeGraph in prep-consumption.ts — and this module resolves in memory).
 *
 * ONE deliberate math change vs the original (Wave 1.5, 2026-07-23): item-ref
 * input lines with a WEIGHT-dimension unit now convert honestly to par-units
 * of the sub-item (see itemRefParUnits) instead of reading the quantity AS
 * par-units — prod data had 65 consumer-build lines like "2 oz Marinara"
 * being counted as 2 QUARTS (~32× overstated SKU demand / cost).
 *
 * Preserved semantics (load-bearing, do not "simplify"):
 *  - Cycle detection via a `visiting` set → cycle = unresolvable = null.
 *  - Any unresolvable input (unknown SKU pack, un-convertible unit, dangling
 *    component) poisons the WHOLE flatten → null/empty (never partial results).
 *  - Fan-out allocation for multi-output recipes: share = my ozWeight / total
 *    ozWeight, where ozWeight = yield × oz_per_par_unit when known-positive,
 *    else plain yield; zero-total falls back to equal split.
 *  - ITEM-engine asymmetry: an item's fan-out weight universe is ITEM outputs
 *    only; the MENU engine's share universe is ALL outputs (items + menu_items,
 *    menu outputs weighted by yield since they carry no oz_per_par_unit).
 */
import { ozForRecipeInput, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";

export interface GraphInput {
  quantity: number;
  unit: string | null;
  componentSkuId: string | null;
  componentItemId: string | null;
}
export interface GraphOutput {
  outputItemId: string | null;
  outputMenuItemId: string | null;
  yield: number;
  /** items.oz_per_par_unit for item outputs (null when unset/unknown). */
  ozPerParUnit: number | null;
}
export interface GraphRecipe {
  recipeId: string;
  batchYield: number | null;
  inputs: GraphInput[];
  outputs: GraphOutput[];
}

/** The whole (small) recipe universe, pre-indexed for resolution. */
export interface RecipeGraph {
  /** First recipe producing a given ITEM (mirrors the original limit-1 lookup). */
  byOutputItem: Map<string, GraphRecipe>;
  /** First recipe producing a given MENU_ITEM. */
  byOutputMenuItem: Map<string, GraphRecipe>;
  /** SKU pack info for every SKU referenced by any input. */
  skuPack: Map<string, RecipeInputSku>;
  measures: Map<string, MeasureUnitFactor>;
}

/**
 * Par-units of a sub-ITEM consumed by an item-ref input line (Wave 1.5 math
 * fix — prod had 65 oz-denominated consumer-build lines read as par-units,
 * e.g. "2 oz Marinara" counted as 2 QUARTS, "3.5 oz Turkey" as 3.5 THIRD-PANS).
 *
 *  - unit null / unregistered / count-dimension → quantity IS par-units of the
 *    sub-item (the seed convention for "each"/"handful"-style lines).
 *  - WEIGHT-dimension unit → convert: oz = quantity × toBaseFactor; par-units
 *    = oz ÷ oz-per-par-unit of the sub-item. oz-per-par-unit prefers
 *    items.oz_per_par_unit (human-entered ground truth) and falls back to the
 *    sub's per-par-unit INPUT mass (Σ of its flattened SKU-oz map) — exact for
 *    mixes/salads, UNDERSTATES cook-down items (caramelized onions, jus)
 *    until oz_per_par_unit is filled. Neither known-positive → null.
 *  - VOLUME-dimension unit → null (unresolvable): volume→weight needs density
 *    we don't have — same doctrine as recipe-math's ozPerMeasureUnit. Zero
 *    prod rows carry volume-denominated item refs today.
 */
export function itemRefParUnits(
  graph: RecipeGraph,
  input: GraphInput,
  subPerUnitSkuOz: Map<string, number>,
): number | null {
  const m = input.unit != null ? graph.measures.get(input.unit) : undefined;
  if (!m || m.dimension === "count") return input.quantity;
  if (m.dimension === "volume") return null;
  const oz = input.quantity * m.toBaseFactor;
  const node = input.componentItemId != null ? graph.byOutputItem.get(input.componentItemId) : undefined;
  const registered = node?.outputs.find((o) => o.outputItemId === input.componentItemId)?.ozPerParUnit ?? null;
  let perParOz = registered != null && registered > 0 ? registered : 0;
  if (perParOz <= 0) {
    for (const v of subPerUnitSkuOz.values()) perParOz += v;
  }
  return perParOz > 0 ? oz / perParOz : null;
}

function itemOzWeight(o: GraphOutput): number {
  const w = o.ozPerParUnit;
  return w != null && w > 0 ? o.yield * w : o.yield;
}

/**
 * Per-one-unit leaf-SKU oz for an ITEM. Empty map when the item has no recipe
 * or the flatten is unresolvable. (Faithful port of perUnitSkuOzForItem's
 * batchOz/perUnitFromNode pair, including the item-outputs-only weight universe.)
 */
export function perUnitSkuOzForItemFromGraph(graph: RecipeGraph, itemId: string): Map<string, number> {
  return perUnitFromNode(graph, itemId, new Set()) ?? new Map();
}

function batchOz(graph: RecipeGraph, outItemId: string, visiting: Set<string>): Map<string, number> | null {
  if (visiting.has(outItemId)) return null;
  const node = graph.byOutputItem.get(outItemId) ?? null;
  if (!node || node.batchYield == null || node.batchYield <= 0) return null;
  const next = new Set(visiting).add(outItemId);
  const out = new Map<string, number>();
  for (const c of node.inputs) {
    if (c.componentSkuId != null) {
      const sku = graph.skuPack.get(c.componentSkuId);
      const oz = sku ? ozForRecipeInput(c.quantity, c.unit, sku, graph.measures) : null;
      if (oz == null) return null;
      out.set(c.componentSkuId, (out.get(c.componentSkuId) ?? 0) + oz);
    } else if (c.componentItemId != null) {
      const subPerUnit = perUnitFromNode(graph, c.componentItemId, next);
      if (subPerUnit == null) return null;
      const parUnits = itemRefParUnits(graph, c, subPerUnit);
      if (parUnits == null) return null;
      for (const [sku, oz] of subPerUnit) out.set(sku, (out.get(sku) ?? 0) + oz * parUnits);
    } else return null;
  }
  return out;
}

function perUnitFromNode(graph: RecipeGraph, outItemId: string, visiting: Set<string>): Map<string, number> | null {
  const node = graph.byOutputItem.get(outItemId) ?? null;
  if (!node) return null;
  const batch = batchOz(graph, outItemId, visiting);
  if (batch == null) return null;
  // ITEM engine: weight universe = ITEM outputs only (original filtered
  // .not("output_item_id","is",null) at load time).
  const itemOuts = node.outputs.filter((o) => o.outputItemId != null);
  const totalWeight = itemOuts.reduce((s, o) => {
    const w = itemOzWeight(o);
    return s + (w > 0 ? w : 0);
  }, 0);
  const me = itemOuts.find((o) => o.outputItemId === outItemId);
  if (!me || me.yield <= 0) return null;
  const myW = itemOzWeight(me);
  const share = totalWeight > 0 ? (myW > 0 ? myW : 0) / totalWeight : 1 / Math.max(itemOuts.length, 1);
  const out = new Map<string, number>();
  for (const [sku, oz] of batch) out.set(sku, (oz * share) / me.yield);
  return out;
}

/**
 * Per-one-unit leaf-SKU oz for a MENU_ITEM (sub). Empty map when the sub has no
 * recipe or any input is unresolvable. (Faithful port of perUnitSkuOzForMenuItem:
 * share universe = ALL outputs; component sub-ITEMS flatten via the item engine.)
 */
export function perUnitSkuOzForMenuItemFromGraph(graph: RecipeGraph, menuItemId: string): Map<string, number> {
  const node = graph.byOutputMenuItem.get(menuItemId) ?? null;
  if (!node) return new Map();
  const meOut = node.outputs.find((o) => o.outputMenuItemId === menuItemId);
  const myYield = meOut?.yield ?? 0;
  if (myYield <= 0) return new Map();
  if (node.batchYield == null || node.batchYield <= 0) return new Map();

  // Share: ALL outputs (items weighted by yield×ozPerPar when known; menu outputs by yield).
  let totalWeight = 0;
  let myWeight = 0;
  for (const o of node.outputs) {
    const w = o.outputItemId != null ? itemOzWeight(o) : o.yield;
    if (w > 0) totalWeight += w;
    if (o.outputMenuItemId === menuItemId) myWeight = w > 0 ? w : 0;
  }
  const share = totalWeight > 0 ? myWeight / totalWeight : 1 / Math.max(node.outputs.length, 1);

  const batch = new Map<string, number>();
  for (const c of node.inputs) {
    if (c.componentSkuId != null) {
      const sku = graph.skuPack.get(c.componentSkuId);
      const oz = sku ? ozForRecipeInput(c.quantity, c.unit, sku, graph.measures) : null;
      if (oz == null) return new Map();
      batch.set(c.componentSkuId, (batch.get(c.componentSkuId) ?? 0) + oz);
    } else if (c.componentItemId != null) {
      const subPerUnit = perUnitSkuOzForItemFromGraph(graph, c.componentItemId);
      if (subPerUnit.size === 0) return new Map();
      const parUnits = itemRefParUnits(graph, c, subPerUnit);
      if (parUnits == null) return new Map();
      for (const [sku, oz] of subPerUnit) batch.set(sku, (batch.get(sku) ?? 0) + oz * parUnits);
    } else {
      return new Map();
    }
  }

  const out = new Map<string, number>();
  for (const [sku, oz] of batch) out.set(sku, (oz * share) / myYield);
  return out;
}

/** Index raw recipe rows into a RecipeGraph (first-wins per output, mirroring the original limit-1 lookups). */
export function buildRecipeGraph(
  recipes: GraphRecipe[],
  skuPack: Map<string, RecipeInputSku>,
  measures: Map<string, MeasureUnitFactor>,
): RecipeGraph {
  const byOutputItem = new Map<string, GraphRecipe>();
  const byOutputMenuItem = new Map<string, GraphRecipe>();
  for (const r of recipes) {
    for (const o of r.outputs) {
      if (o.outputItemId != null && !byOutputItem.has(o.outputItemId)) byOutputItem.set(o.outputItemId, r);
      if (o.outputMenuItemId != null && !byOutputMenuItem.has(o.outputMenuItemId)) byOutputMenuItem.set(o.outputMenuItemId, r);
    }
  }
  return { byOutputItem, byOutputMenuItem, skuPack, measures };
}

/**
 * FIRST-LEVEL prep-item consumption per ONE unit of a MENU_ITEM (read-track 2,
 * sales→depletion): the consumer recipe's direct item-ref inputs converted to
 * par-units by the SAME itemRefParUnits weight-honest semantics, share-scaled
 * and ÷ myYield exactly like the menu engine. SKU-ref inputs are ignored here
 * (they're the leaf engine's job); an unresolvable item-ref poisons the whole
 * map to empty (per-entity poisoning, consistent with the flatten engines).
 */
export function firstLevelItemConsumption(graph: RecipeGraph, menuItemId: string): Map<string, number> {
  const node = graph.byOutputMenuItem.get(menuItemId) ?? null;
  if (!node || node.batchYield == null || node.batchYield <= 0) return new Map();
  const meOut = node.outputs.find((o) => o.outputMenuItemId === menuItemId);
  const myYield = meOut?.yield ?? 0;
  if (myYield <= 0) return new Map();
  let totalWeight = 0;
  let myWeight = 0;
  for (const o of node.outputs) {
    const w = o.outputItemId != null ? itemOzWeight(o) : o.yield;
    if (w > 0) totalWeight += w;
    if (o.outputMenuItemId === menuItemId) myWeight = w > 0 ? w : 0;
  }
  const share = totalWeight > 0 ? myWeight / totalWeight : 1 / Math.max(node.outputs.length, 1);
  const out = new Map<string, number>();
  for (const c of node.inputs) {
    if (c.componentItemId == null) continue;
    const subPerUnit = perUnitSkuOzForItemFromGraph(graph, c.componentItemId);
    const parUnits = itemRefParUnits(graph, c, subPerUnit);
    if (parUnits == null) return new Map();
    out.set(c.componentItemId, (out.get(c.componentItemId) ?? 0) + (parUnits * share) / myYield);
  }
  return out;
}
