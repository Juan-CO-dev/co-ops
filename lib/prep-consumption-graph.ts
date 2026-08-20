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
  /**
   * `items.default_par_unit` for item outputs — the sub-item's OWN par-unit
   * label ("Quart", "1/3 Pan", "Bottle"). Null for menu outputs and when unset.
   *
   * Load-bearing only for `itemRefParUnits`: it is the one non-measure spelling
   * a recipe line may legitimately use for an item ref ("2 Quart of Marinara"),
   * and naming it explicitly is what lets every OTHER unregistered label be
   * refused instead of silently read as par-units. Optional so the many
   * fixtures/constructors that predate it keep compiling — absent means
   * "unknown", which refuses, never guesses.
   */
  parUnitLabel?: string | null;
}
export interface GraphRecipe {
  recipeId: string;
  /**
   * ⚠ TRIPWIRE — `recipes.batch_yield` is LOADED AND VALIDATED HERE BUT NEVER
   * DIVIDED BY. Do not trust it as a divisor, a scale factor, or a batch size.
   *
   * Every engine below reads it exactly once, as a GUARD (`== null || <= 0` →
   * unresolvable) and never again; the per-unit division is always by the
   * OUTPUT's own `yield` (`recipe_outputs.yield`), which is the number that
   * actually says how many par-units one batch makes. Two fields that sound
   * like the same fact are not: live, the `Hot Peppers` recipe carries
   * batch_yield = 1 against an output yield of 10, and the flatten is right to
   * use the 10. A future "simplification" that divides batch oz by batchYield —
   * or that multiplies an input by it to get a batch — would silently rescale
   * every cost and depletion number in the app by whatever ratio those two
   * fields happen to sit at, per recipe, with no error anywhere.
   *
   * If you need a real batch size, derive it: Σ(output.yield × ozPerParUnit).
   * If you want to make batch_yield meaningful, that is a data + migration
   * arc (reconcile all 60-odd recipes first), not an arithmetic edit here.
   * (Debug finding D5, 2026-08-20.)
   */
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

/** The sub-item's own `default_par_unit` label, from the recipe that produces it. */
function subItemParUnitLabel(graph: RecipeGraph, itemId: string): string | null {
  const node = graph.byOutputItem.get(itemId);
  return node?.outputs.find((o) => o.outputItemId === itemId)?.parUnitLabel ?? null;
}

/** Case/whitespace-insensitive label equality (`"Quart"` ≡ `"quart "`). */
function labelsMatch(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Par-units of a sub-ITEM consumed by an item-ref input line (Wave 1.5 math
 * fix — prod had 65 oz-denominated consumer-build lines read as par-units,
 * e.g. "2 oz Marinara" counted as 2 QUARTS, "3.5 oz Turkey" as 3.5 THIRD-PANS).
 *
 *  - unit NULL → quantity IS par-units (the seed convention for bare lines).
 *  - COUNT-dimension measure → quantity IS par-units ("each"/"handful"-style).
 *  - the sub-item's OWN par-unit label ("2 Quart of Marinara") → quantity IS
 *    par-units. This is the only non-measure spelling that means anything, and
 *    it is now checked EXPLICITLY rather than reached by falling through.
 *  - WEIGHT-dimension measure → convert: oz = quantity × toBaseFactor; par-units
 *    = oz ÷ oz-per-par-unit of the sub-item. oz-per-par-unit prefers
 *    items.oz_per_par_unit (human-entered ground truth) and falls back to the
 *    sub's per-par-unit INPUT mass (Σ of its flattened SKU-oz map) — exact for
 *    mixes/salads, UNDERSTATES cook-down items (caramelized onions, jus)
 *    until oz_per_par_unit is filled. Neither known-positive → null.
 *  - VOLUME-dimension measure → null (unresolvable): volume→weight needs density
 *    we don't have — same doctrine as recipe-math's ozPerMeasureUnit. Zero
 *    prod rows carry volume-denominated item refs today.
 *  - ANYTHING ELSE → null. See below.
 *
 * ── THE UNKNOWN-UNIT REFUSAL (2026-08-20 costing cleanup) ────────────────────
 * This function used to read an UNREGISTERED label as par-units, alongside the
 * two conventions above. That is how prod's one `1 ladle` line on Our French Dip
 * came to mean one QUART of jus: `ladle` is in no `measure_units` row, so it fell
 * into the par-unit branch and silently re-denominated the line by ~8x, with no
 * error anywhere and a perfectly plausible dollar figure on the board.
 *
 * A typo'd or unregistered unit is now a REFUSAL (null), which poisons the
 * flatten to the honest `unresolved` status — the same posture the whole module
 * already takes for an unknown SKU pack or an un-convertible unit, and the same
 * one the D2 mass-balance guard took for a wrong-but-confident number. The rule
 * this encodes: a unit the system does not know may never decide what a line
 * means. Register it (measure_units) or spell the sub-item's par unit; there is
 * no third way to be understood.
 */
export function itemRefParUnits(
  graph: RecipeGraph,
  input: GraphInput,
  subPerUnitSkuOz: Map<string, number>,
): number | null {
  if (input.unit == null) return input.quantity;
  const m = graph.measures.get(input.unit);
  if (!m) {
    // Not a measure. The sub-item's own par-unit label is the one legitimate
    // alternative; anything else is unknown and must not be interpreted.
    const parLabel = input.componentItemId != null ? subItemParUnitLabel(graph, input.componentItemId) : null;
    return labelsMatch(parLabel, input.unit) ? input.quantity : null;
  }
  if (m.dimension === "count") return input.quantity;
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

export function itemOzWeight(o: GraphOutput): number {
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

/**
 * Total leaf-SKU ounces going INTO one whole batch of the recipe that produces
 * `itemId` — i.e. the flatten BEFORE the fan-out share and the ÷ yield. Null
 * when the recipe is missing or the flatten is unresolvable (same all-or-nothing
 * poisoning as everything else here).
 *
 * Exposed for the mass-balance consistency check (lib/menu-costing-shared.ts,
 * debug finding D2), which compares this against what the recipe's outputs
 * DECLARE they weigh. It is deliberately the engine's own `batchOz` rather than
 * a re-implementation: a consistency check computed by a second, subtly
 * different flatten would report on a recipe nobody is actually costing.
 */
export function batchInputOzForItem(graph: RecipeGraph, itemId: string): number | null {
  const batch = batchOz(graph, itemId, new Set());
  if (batch == null) return null;
  let total = 0;
  for (const oz of batch.values()) total += oz;
  return Number.isFinite(total) ? total : null;
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

/**
 * Index raw recipe rows into a RecipeGraph (first-wins per output, mirroring the original
 * limit-1 lookups).
 *
 * DUAL-PRODUCER CAVEAT (multi-vendor audit P5 —
 * docs/audits/2026-08-20-multivendor-semantics-audit.md): when two ACTIVE recipes produce
 * the SAME output, first-wins silently picks one and the other becomes invisible to every
 * costing/depletion consumer. Because the losing recipe may pin a different vendor's SKU
 * with a different pack basis, the choice can swing both vendor attribution and the oz
 * math — live, the two Hot Peppers recipes pin Baldor (512 oz) vs Boar's Head (1 unit).
 *
 * The caller (loadRecipeGraph in lib/prep-consumption.ts) now orders its `recipes` select
 * deterministically, so "first" is at least STABLE and repeatable. It is still arbitrary:
 * nothing here knows which producer is operationally correct. Making that ambiguity
 * visible to an admin is the audit's follow-up; do not mistake the stable order for a
 * resolution of it.
 */
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

/**
 * DIRECT-SKU-only flatten for a MENU_ITEM (PR #180 review finding #1 — the
 * SKU-double-count guard): identical share/yield/poison semantics to
 * perUnitSkuOzForMenuItemFromGraph, but item-ref inputs contribute NOTHING
 * here — their SKUs flow exclusively through the item-units lane (which the
 * modifier lane adjusts before the clamp + item-grain flatten). Item-refs are
 * still VALIDATED (unresolvable → poison), so both lanes agree on whether the
 * sub resolves at all. Invariant (test-pinned): direct(M) + Σ firstLevel(M)[i]
 * × perUnitItem(i) === perUnitSkuOzForMenuItemFromGraph(M).
 */
export function perUnitDirectSkuOzForMenuItem(graph: RecipeGraph, menuItemId: string): Map<string, number> {
  const node = graph.byOutputMenuItem.get(menuItemId) ?? null;
  if (!node) return new Map();
  const meOut = node.outputs.find((o) => o.outputMenuItemId === menuItemId);
  const myYield = meOut?.yield ?? 0;
  if (myYield <= 0) return new Map();
  if (node.batchYield == null || node.batchYield <= 0) return new Map();

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
      const skuInfo = graph.skuPack.get(c.componentSkuId);
      const oz = skuInfo ? ozForRecipeInput(c.quantity, c.unit, skuInfo, graph.measures) : null;
      if (oz == null) return new Map();
      batch.set(c.componentSkuId, (batch.get(c.componentSkuId) ?? 0) + oz);
    } else if (c.componentItemId != null) {
      // Validate resolvability (poison parity with the full flatten) — contribute nothing.
      const subPerUnit = perUnitSkuOzForItemFromGraph(graph, c.componentItemId);
      if (subPerUnit.size === 0) return new Map();
      if (itemRefParUnits(graph, c, subPerUnit) == null) return new Map();
    } else {
      return new Map();
    }
  }
  const out = new Map<string, number>();
  for (const [skuId, oz] of batch) out.set(skuId, (oz * share) / myYield);
  return out;
}
