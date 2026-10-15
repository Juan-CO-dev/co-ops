/**
 * FROZEN PRE-2a READ PATH — the shop-versions snapshot proof's BASELINE (catalog Phase 2a, Astra
 * full-branch r1 P2). A VERBATIM copy of origin/main 984346e6's pack + graph loaders
 * (lib/prep-consumption.ts: loadMeasures … loadRecipeGraph) and its price loader
 * (lib/admin/cost.ts loadCurrentSkuPrices), cut at the read path. The house precedent is
 * tests/fixtures/counts-v0-oracle.ts. NEVER edit this file to make a comparison pass: it IS the
 * "before". Product resolution (lib/products.ts loadProductIndex) is imported live — it is
 * unchanged by 2a, and over a snapshot without shop versions it reads exactly what main read.
 *
 * ── origin/main 984346e6 lib/prep-consumption.ts (header + read path, verbatim below) ──
 */
/**
 * Prep-consumption engine (Item/Inventory Spine — production-in-prep fold). SERVER-ONLY,
 * service-role.
 *
 * EVERY READ IN THIS MODULE THROWS ON `error` (audit v2 P1-3, BC-032). This graph is the
 * inventory moat's foundation — depletion, ordering suggestions, readiness and counts all
 * compute on it — and a dropped `error` here does not produce an obvious failure, it
 * produces a SMALLER GRAPH: fewer recipes, fewer edges, a SKU with no pack basis, an item
 * with no par basis. Every consumer then reports a confident, plausible, wrong number, and
 * nothing downstream can tell that graph from a correct one. A partial recipe graph must
 * never exist, so a failed read is fatal to the whole build rather than survivable by it.
 * Recursively flattens an item's item_components recipe to leaf-SKU oz consumed
 * per par-unit, mirroring recipe-math's per-batch ÷ output-yield semantics (the divisor is
 * the output row's `yield` on the graph, not `recipes.batch_yield`) — but ACCUMULATING PER
 * LEAF SKU instead of summing. Returns oz-per-output-unit; callers scale. 0215's batch fold
 * (recordBatchProductionFromPrep below) reads the SAME graph and multiplies by that yield.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import {
  buildRecipeGraph,
  type GraphRecipe,
  type RecipeGraph,
} from "@/lib/prep-consumption-graph";
import { loadProductIndex } from "@/lib/products";

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

export async function loadMeasures(): Promise<Map<string, MeasureUnitFactor>> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("measure_units").select("label, dimension, to_base_factor").eq("active", true).returns<Array<{ label: string; dimension: "weight" | "volume" | "count"; to_base_factor: number | string }>>();
  // A missing unit is not a missing conversion — it is a SILENT ZERO. `toBaseFactor`
  // defaults to 0 below, so a dropped registry read turns every recipe quantity into 0 oz.
  if (error) throw new Error(`loadMeasures: ${error.message}`);
  return new Map((data ?? []).map((m) => [m.label, { dimension: m.dimension, toBaseFactor: num(m.to_base_factor) ?? 0 }]));
}

async function loadSkuPack(skuIds: string[]): Promise<Map<string, RecipeInputSku>> {
  if (skuIds.length === 0) return new Map();
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("vendor_items")
    .select("id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("id", skuIds)
    .returns<Array<{ id: string; pack_format: string | null; each_container_label: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  // A SKU absent from this map has no pack basis, which reads downstream as "we cannot
  // weigh this" — the honest answer for a genuinely unweighed SKU and a lie for a
  // weighed one the read simply failed to return.
  if (error) throw new Error(`loadSkuPack: ${error.message}`);
  // ONE batch query for the whole universe's active chain levels (loadRecipeGraph
  // law — never per-SKU). Pack-hierarchy 0159; SKUs without a chain get [].
  const chainsBySku = await loadSkuPackChains(skuIds);
  return new Map((data ?? []).map((s) => [s.id, {
    packFormat: s.pack_format, eachContainerLabel: s.each_container_label,
    unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure,
    avgOzPerEach: num(s.avg_oz_per_each),
    packChain: chainsBySku.get(s.id) ?? null,
  }]));
}

/**
 * Batch-load active pack-chain levels for a set of SKUs into per-SKU level arrays
 * (pack-hierarchy 0159). ONE query regardless of SKU count (loadRecipeGraph law).
 * Returns an empty map when there are no chains — every consumer treats a missing
 * entry as "no chain → legacy flat-field path".
 */
export async function loadSkuPackChains(skuIds: string[]): Promise<Map<string, PackChainLevel[]>> {
  const out = new Map<string, PackChainLevel[]>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("sku_pack_levels")
    .select("id, sku_id, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal")
    .in("sku_id", skuIds)
    .eq("active", true)
    .order("display_ordinal", { ascending: true })
    .returns<PackLevelRow[]>();
  // "No chain" is a MEANINGFUL answer here (it routes the SKU to the legacy flat-field
  // path), so a swallowed failure silently re-denominates every chained SKU in the graph.
  if (error) throw new Error(`loadSkuPackChains: ${error.message}`);
  return groupPackLevels(data ?? []);
}

/**
 * EVERY active pack-chain level, grouped per SKU (B9: the counts render needs chains for
 * nearly the whole catalog — the sheet's level pickers, the count rows, the product index —
 * and a ~200-id `.in()` list sits at the request-line ceiling). Per SKU this is exactly
 * what loadSkuPackChains returns. PAGED under (display_ordinal, id).
 */
export async function loadAllSkuPackChains(): Promise<Map<string, PackChainLevel[]>> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<PackLevelRow>(async (from, to) => {
    const { data, error } = await sb.from("sku_pack_levels")
      .select("id, sku_id, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal")
      .eq("active", true)
      .order("display_ordinal", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
      .returns<PackLevelRow[]>();
    if (error) throw new Error(`loadAllSkuPackChains: ${error.message}`);
    return { data };
  });
  return groupPackLevels(rows);
}

type PackLevelRow = { id: string; sku_id: string; label: string; contains_qty: number | string; contains_level_id: string | null; contains_measure_unit: string | null; display_ordinal: number };
function groupPackLevels(rows: PackLevelRow[]): Map<string, PackChainLevel[]> {
  const out = new Map<string, PackChainLevel[]>();
  for (const r of rows) {
    const list = out.get(r.sku_id) ?? [];
    list.push({
      id: r.id, label: r.label, containsQty: num(r.contains_qty) ?? 0,
      containsLevelId: r.contains_level_id, containsMeasureUnit: r.contains_measure_unit,
      displayOrdinal: r.display_ordinal,
    });
    out.set(r.sku_id, list);
  }
  return out;
}

/**
 * Per-item par BASIS: `oz_per_par_unit` (fan-out allocation weight) plus
 * `default_par_unit` (the label a recipe line may legitimately spell instead of
 * a measure — see itemRefParUnits' unknown-unit refusal). One query, both
 * fields; they come off the same row and are read by the same resolver.
 */
async function loadItemParBasis(
  itemIds: string[],
): Promise<Map<string, { ozPerParUnit: number | null; parUnitLabel: string | null }>> {
  if (itemIds.length === 0) return new Map();
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("items").select("id, oz_per_par_unit, default_par_unit").in("id", itemIds)
    .returns<Array<{ id: string; oz_per_par_unit: number | string | null; default_par_unit: string | null }>>();
  // A missing basis nulls the output's fan-out weight AND its par-unit label, which is how
  // a recipe line denominated in the item's own par unit becomes an unknown-unit refusal.
  if (error) throw new Error(`loadItemParBasis: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.id, {
    ozPerParUnit: num(r.oz_per_par_unit),
    parUnitLabel: r.default_par_unit,
  }]));
}

/**
 * Load the WHOLE recipe universe in a fixed number of queries (6), regardless of
 * how many items/menu_items are subsequently resolved (+1 when a product pin resolves
 * to a member SKU no recipe names directly — LRA-231). Replaces the former
 * per-recipe-node recursive loading (4+ queries per node — the N+1 the
 * 2026-07-23 council review flagged as a latent cliff for real catering volume).
 * The graph is small (dozens of recipes / a few hundred rows); resolution is
 * pure + in-memory via lib/prep-consumption-graph.ts. Loops (W4b sku-demand,
 * surplus, loadDerivedForItems) load ONE graph and resolve every line against it.
 *
 * PRODUCT PINS RESOLVE HERE, ONCE (0179). A recipe_inputs row may name a PRODUCT
 * instead of a vendor's SKU; lib/products.ts loadProductIndex runs the ONE ladder
 * (resolveProductMember) and builds each product's measure-only basis, and the graph
 * carries the ANSWER. Every downstream consumer keeps its SKU-keyed output and gains
 * failover for free — one seam, nine callers. The product reads are SKIPPED entirely
 * when no input names a product (`productIds.length === 0`), so the query count stays
 * at 6 for a system with no products and rises to 8-11 only where plurality exists.
 *
 * `opts.locationId` (deviation D7) scopes the resolution: the per-location primary
 * row, that location's activation overlay, and that location's receipt history.
 * Location-aware callers (toast-sales, sku-demand, surplus) pass theirs; costing,
 * catalog, toast-map, readiness and the scripts pass nothing and resolve against the
 * GLOBAL primary row — the honest org-level replacement cost the board prices at.
 */
export async function loadRecipeGraph(opts?: { locationId?: string | null }): Promise<RecipeGraph> {
  const locationId = opts?.locationId ?? null;
  const sb = getServiceRoleClient();
  const measures = await loadMeasures();
  const [{ data: recRows, error: recErr }, { data: inRows, error: inErr }, { data: outRows, error: outErr }] = await Promise.all([
    // ACTIVE ONLY (multi-vendor audit P5, second half — 2026-08-20). An inactive
    // recipe is a RETIRED one: `active = false` is how this codebase deactivates
    // config rows, and nothing else in the app treats a retired recipe as live
    // (lib/admin/readiness-load.ts has filtered on it since it shipped). Without
    // the filter, first-wins indexing plus created_at ordering handed the slot to
    // whichever producer was created FIRST — which is systematically the OLDER,
    // retired one. Live that was not hypothetical: the 2026-07-01 `Hot Peppers`
    // recipe (retired, Baldor, 512 oz) beat the active `Hot Peppers (portioned)`,
    // and the 2026-07-06 `AntiPasta2` (retired) beat `Antipasto Pasta
    // (approximate)`. A deactivated recipe was silently defining two items' costs
    // and depletion, and disagreeing with the readiness map about which recipe
    // even produces them.
    //
    // DETERMINISTIC ORDER still matters for the ACTIVE duplicates the filter
    // cannot resolve. buildRecipeGraph indexes producers FIRST-WINS per output, so
    // when two ACTIVE recipes produce the same item the winner is decided purely by
    // row order, and an unordered select gives no guarantee. Ordering makes that
    // repeatable, not correct — nothing here knows which producer is operationally
    // right, which is why duplicate ACTIVE producers now raise a readiness warning
    // (lib/readiness.ts, `duplicate_producers`). created_at is nullable, so `id`
    // (PK, never null) is the tiebreak that makes the order total rather than
    // merely mostly-stable.
    sb.from("recipes").select("id, batch_yield").eq("active", true)
      .order("created_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .returns<Array<{ id: string; batch_yield: number | string | null }>>(),
    sb.from("recipe_inputs").select("recipe_id, quantity, unit, component_sku_id, component_item_id, component_product_id")
      .returns<Array<{ recipe_id: string; quantity: number | string; unit: string | null; component_sku_id: string | null; component_item_id: string | null; component_product_id: string | null }>>(),
    sb.from("recipe_outputs").select("recipe_id, output_item_id, output_menu_item_id, yield")
      .returns<Array<{ recipe_id: string; output_item_id: string | null; output_menu_item_id: string | null; yield: number | string }>>(),
  ]);
  // FAIL LOUD, BEFORE ANY INDEXING. These three reads ARE the graph: a dropped recipes read
  // yields a graph with no producers ("nothing has a recipe"), a dropped inputs read yields
  // recipes that consume nothing (every cost 0, every depletion 0), and a dropped outputs
  // read yields recipes that produce nothing. All three are silent, all three are plausible,
  // and none of them is distinguishable downstream from a genuinely sparse catalog.
  for (const [label, err] of [
    ["recipes", recErr], ["recipe_inputs", inErr], ["recipe_outputs", outErr],
  ] as const) {
    if (err) throw new Error(`loadRecipeGraph ${label}: ${err.message}`);
  }
  const outputItemIds = [...new Set((outRows ?? []).filter((o) => o.output_item_id).map((o) => o.output_item_id!))];
  const skuIds = [...new Set((inRows ?? []).filter((c) => c.component_sku_id).map((c) => c.component_sku_id!))];
  const productIds = [...new Set((inRows ?? []).filter((c) => c.component_product_id).map((c) => c.component_product_id!))];
  const [parBasis, skuPack, productIndex] = await Promise.all([
    loadItemParBasis(outputItemIds),
    loadSkuPack(skuIds),
    // Zero product-pinned rows → zero queries (loadProductIndex returns early).
    loadProductIndex(productIds, locationId),
  ]);
  // THE RESOLVED MEMBER IS A LEAF TOO (LRA-231, 2026-09-11). A product pin resolves to one
  // member SKU and the flatten emits THAT id as the leaf (productLineOz), but `skuIds` above
  // only names the SKUs recipes pin directly — so the member's pack never reached
  // `graph.skuPack`, and every consumer that prices a leaf off its pack (the menu costing
  // board's costPerOzFromGraph, computeSkuCostPerOz) saw a priced, packed Turkey as
  // "unpriced". Live: every deli sub on the board. One more query, only when a product
  // resolved to a member the recipes did not already name.
  const memberIds = [...new Set([...productIndex.index.resolution.values()]
    .map((r) => r.skuId)
    .filter((id): id is string => id != null && !skuPack.has(id)))];
  if (memberIds.length > 0) {
    for (const [id, pack] of await loadSkuPack(memberIds)) skuPack.set(id, pack);
  }

  const inputsByRecipe = new Map<string, GraphRecipe["inputs"]>();
  for (const c of inRows ?? []) {
    const list = inputsByRecipe.get(c.recipe_id) ?? [];
    list.push({ quantity: num(c.quantity) ?? 0, unit: c.unit, componentSkuId: c.component_sku_id, componentItemId: c.component_item_id, componentProductId: c.component_product_id });
    inputsByRecipe.set(c.recipe_id, list);
  }
  const outputsByRecipe = new Map<string, GraphRecipe["outputs"]>();
  for (const o of outRows ?? []) {
    const list = outputsByRecipe.get(o.recipe_id) ?? [];
    const basis = o.output_item_id ? parBasis.get(o.output_item_id) : undefined;
    list.push({
      outputItemId: o.output_item_id, outputMenuItemId: o.output_menu_item_id,
      yield: num(o.yield) ?? 0,
      ozPerParUnit: basis?.ozPerParUnit ?? null,
      parUnitLabel: basis?.parUnitLabel ?? null,
    });
    outputsByRecipe.set(o.recipe_id, list);
  }
  const recipes: GraphRecipe[] = (recRows ?? []).map((r) => ({
    recipeId: r.id, batchYield: num(r.batch_yield),
    inputs: inputsByRecipe.get(r.id) ?? [], outputs: outputsByRecipe.get(r.id) ?? [],
  }));
  return buildRecipeGraph(recipes, skuPack, measures, productIndex.index);
}

// ── origin/main 984346e6 lib/admin/cost.ts loadCurrentSkuPrices (verbatim) ──
/** Current pack price per SKU = latest vendor_price_history row (effective_date desc, recorded_at desc). */
export async function loadCurrentSkuPrices(skuIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  // Paginate past PostgREST's 1000-row cap: vendor_price_history is append-only
  // and grows per delivery line, so a raw scan silently drops SKUs whose latest
  // price row falls past row 1000 → they read "unpriced" (wrong readiness/cost).
  // `id` is the unique tiebreaker that makes the newest-first order a total order.
  // (Follow-up: a DISTINCT ON (vendor_item_id) RPC avoids loading history at all.)
  const data = await selectAllRows<{ vendor_item_id: string; unit_price: number | string; effective_date: string; recorded_at: string | null }>(
    (from, to) => sb
      .from("vendor_price_history")
      .select("vendor_item_id, unit_price, effective_date, recorded_at")
      .in("vendor_item_id", skuIds)
      .order("effective_date", { ascending: false })
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );
  for (const r of data) {
    if (!out.has(r.vendor_item_id)) {
      const p = num(r.unit_price);
      if (p != null) out.set(r.vendor_item_id, p);
    }
  }
  return out;
}
