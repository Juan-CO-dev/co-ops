/**
 * Readiness server composition (soft-gate) — composes EXISTING loaders into
 * per-page readiness maps. SERVER-ONLY. Read-only; callers are pages already
 * behind their own role gates (admin layout ≥6 + per-page re-gate).
 * Rules live in lib/readiness.ts (pure). NO new schema.
 *
 * Failure posture: pages call these inside try/catch and render WITHOUT
 * badges on error — nudges must never take down a working admin page.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import type { AuthContext } from "@/lib/session";
import { loadSkus, loadMeasureUnits } from "@/lib/admin/skus";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
import { loadResolvedRecipeInputs, loadResolvedRecipeInputsByScope, loadSkuPackChains } from "@/lib/prep-consumption";
import type { VersionScope } from "@/lib/sku-versions-shared";
import type { ResolvedRecipeInput } from "@/lib/recipe-versions-shared";
import { attributeNotReady, type ReadinessByScope } from "@/lib/admin/readiness-scope-shared";
import { loadProductIndex } from "@/lib/products";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import {
  skuPackComplete, skuReadiness, recipeOwnReadiness, composeRecipeReadiness,
  itemReadiness, type Readiness, type ReadinessStatus,
} from "@/lib/readiness";

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** Lightweight per-SKU delivery-line count (do NOT hydrate full ledgers for a count). */
export async function loadSkuDeliveryCounts(skuIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  // Paginate past the 1000-row cap: without it, once total delivery lines exceed
  // 1000 a SKU whose rows fall past the cap under-counts to 0 and wrongly badges
  // "no deliveries yet". Order by the unique `id` for a stable total order.
  // (Follow-up: readiness only needs count>=1 — a GROUP BY / exists RPC would
  //  avoid hydrating the whole ledger for a boolean-ish signal.)
  const data = await selectAllRows<{ vendor_item_id: string }>(
    (from, to) => sb
      .from("vendor_delivery_items")
      .select("vendor_item_id")
      .in("vendor_item_id", skuIds)
      .order("id", { ascending: true })
      .range(from, to),
  );
  for (const r of data) out.set(r.vendor_item_id, (out.get(r.vendor_item_id) ?? 0) + 1);
  return out;
}

/** Readiness per ACTIVE SKU AT `scope` (catalog Phase 3a): that shop's price lane and pack versions (2a's one
 *  resolver), else the global ones; null = the global default. Delivery history stays org-wide (a SKU delivered
 *  anywhere has been delivered). Inactive → absent from the map = no badge. */
export async function loadSkuReadinessMap(actor: AuthContext, scope: VersionScope): Promise<Map<string, Readiness>> {
  return (await loadSkuReadinessMaps(actor, [scope])).get(scope ?? "global")!;
}

/**
 * The SKU readiness map for several scopes, sharing every read that does not depend on the scope — the SKU list,
 * the delivery counts and the measure registry — and reading only prices and chains per scope (chunk-2 review P3c:
 * the hub never rebuilds the same map N+2 times). Keyed by scope id; the global default is "global".
 */
export async function loadSkuReadinessMaps(actor: AuthContext, scopes: readonly VersionScope[]): Promise<Map<string, Map<string, Readiness>>> {
  const skus = await loadSkus(actor);
  const active = skus.filter((s) => s.active);
  const ids = active.map((s) => s.id);
  const unique = [...new Set(scopes.map((s) => s ?? null))];
  // PR-C: pack-complete is chain-aware. Batch-load active chains + the measure
  // registry so skuPackComplete delegates to the chain badge predicate for chained
  // SKUs (ONE query each — loadRecipeGraph law; never per-SKU).
  const [deliveries, measureUnits, perScope] = await Promise.all([
    loadSkuDeliveryCounts(ids), loadMeasureUnits(actor),
    Promise.all(unique.map((s) => Promise.all([loadCurrentSkuPrices(ids, s), loadSkuPackChains(ids, s)]))),
  ]);
  const measuresByLabel = new Map<string, MeasureUnitFactor>(
    measureUnits.map((m) => [m.label, { dimension: m.dimension, toBaseFactor: m.toBaseFactor }]),
  );
  const maps = new Map<string, Map<string, Readiness>>();
  unique.forEach((scope, i) => {
    const [prices, chainsBySku] = perScope[i]!;
    const out = new Map<string, Readiness>();
    for (const s of active) {
      const r = skuReadiness({
        active: true,
        packComplete: skuPackComplete(s, chainsBySku.get(s.id) ?? null, measuresByLabel, s.skuClass),
        hasPrice: prices.has(s.id),
        deliveryCount: deliveries.get(s.id) ?? 0,
      });
      if (r) out.set(s.id, r);
    }
    maps.set(scope ?? "global", out);
  });
  return maps;
}

interface GraphRows {
  recipes: Array<{ id: string; batch_yield: number | string | null; batch_mode?: boolean | null }>;
  inputs: Array<{ recipe_id: string; component_sku_id: string | null; component_item_id: string | null; component_product_id: string | null; unit: string | null }>;
  outputs: Array<{ recipe_id: string; output_item_id: string | null; output_menu_item_id: string | null }>;
  items: Array<{ id: string; oz_per_par_unit: number | string | null; sold_directly: boolean; sell_portion: number | string | null; sell_portion_unit: string | null; menu_price: number | string | null }>;
}

/** Exported for tests/recipe-consumers-shop-scope.test.ts. */
export async function loadGraphRows(scope: VersionScope): Promise<GraphRows> {
  const [base, inputs] = await Promise.all([loadGraphBaseRows(), loadResolvedRecipeInputs(scope)]);
  return { ...base, inputs: toGraphInputs(inputs) };
}

function toGraphInputs(rows: readonly ResolvedRecipeInput[]): GraphRows["inputs"] {
  return rows.map((r) => ({
    recipe_id: r.recipe_id, component_sku_id: r.component_sku_id, component_item_id: r.component_item_id,
    component_product_id: r.component_product_id, unit: r.unit,
  }));
}

/** The scope-independent graph reads (recipes, outputs, items) — shared across scopes by countNotReady. */
async function loadGraphBaseRows(): Promise<Omit<GraphRows, "inputs">> {
  const sb = getServiceRoleClient();
  // Paginate past the 1000-row cap on every whole-graph read — as recipes/edges/
  // items grow past 1000 a truncated read would silently drop nodes and corrupt
  // readiness. Order by the stable primary key `id` for deterministic ranging.
  const [recipes, outputs, items] = await Promise.all([
    selectAllRows<GraphRows["recipes"][number]>((from, to) =>
      sb.from("recipes").select("id, batch_yield, batch_mode").eq("active", true)
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<GraphRows["outputs"][number]>((from, to) =>
      sb.from("recipe_outputs").select("recipe_id, output_item_id, output_menu_item_id")
        .order("id", { ascending: true }).range(from, to)),
    selectAllRows<GraphRows["items"][number]>((from, to) =>
      sb.from("items").select("id, oz_per_par_unit, sold_directly, sell_portion, sell_portion_unit, menu_price").eq("active", true)
        .order("id", { ascending: true }).range(from, to)),
  ]);
  // The INPUTS are the scope's (catalog Phase 3a, lead decision 4: a shop's live version replaces its recipe's
  // rows — loadResolvedRecipeInputs); component_product_id rides along (0179 — the quiet reader).
  return { recipes, outputs, items };
}

/**
 * Compute recipe + item readiness over the whole (small) graph in one pass.
 * Memoized recursion with a visiting-set cycle guard (graph is cycle-guarded
 * at write time via outputWouldCycle, but belt-and-braces here).
 */
export async function loadGraphReadiness(actor: AuthContext, scope: VersionScope, pre: {
  /** Reads a caller already holds for this scope (countNotReady shares them across scopes). */
  skuStatus?: Map<string, Readiness>; rows?: GraphRows; measureUnits?: Awaited<ReturnType<typeof loadMeasureUnits>>;
} = {}): Promise<{
  recipeReadiness: Map<string, Readiness>;
  itemReadiness: Map<string, Readiness>;
}> {
  const [skuStatus, g, measureUnits] = await Promise.all([
    pre.skuStatus ?? loadSkuReadinessMap(actor, scope), pre.rows ?? loadGraphRows(scope), pre.measureUnits ?? loadMeasureUnits(actor),
  ]);

  // PRODUCT-pinned inputs (0179). Resolution is the SCOPE's (catalog Phase 3a: a shop's readiness
  // resolves products as that shop does; null = the global one, deviation D7), and a line is ready iff the product resolves to a member
  // AND the quantity can be denominated: either the product knows what one unit
  // weighs, or the line is weight-denominated and needs no unit_oz at all.
  const pinnedProductIds = [...new Set(g.inputs.map((i) => i.component_product_id).filter((v): v is string => v != null))];
  const { byProduct } = await loadProductIndex(pinnedProductIds, scope);
  const weightUnits = new Set(measureUnits.filter((m) => m.dimension === "weight").map((m) => m.label));

  /**
   * How a product-pinned line reads today. THREE outcomes, and the split between the
   * last two is the retirement ruling (2026-08-21): both poison the flatten, but they
   * are different errands. `retired` sends the author to THIS recipe to re-point the
   * line; `unresolved` sends them to the SKU catalog or a scale. Every pin lands in
   * exactly one bucket, so the two counts can never double-report one line.
   */
  const productPinState = (i: GraphRows["inputs"][number]): "ok" | "retired" | "unresolved" => {
    const entry = i.component_product_id != null ? byProduct.get(i.component_product_id) ?? null : null;
    if (entry == null) return "unresolved"; // dangling pin — nothing to name.
    if (entry.resolution.reason === "retired_product") return "retired";
    if (entry.resolution.skuId == null) return "unresolved";
    return entry.unitOz != null || (i.unit != null && weightUnits.has(i.unit)) ? "ok" : "unresolved";
  };

  /**
   * SKU pins whose vendor_item is DEACTIVATED (Juan's "discontinued sku in the
   * recipe"). LOUDNESS ONLY — nothing about resolution changes here; this is the set
   * that turns the existing bare `not_ready_skus` tally into a named cause.
   *
   * A targeted read rather than a widened `loadSkuReadinessMap`: absence from that
   * map is ambiguous (inactive SKU vs dangling id vs a SKU the loader filtered), and
   * "discontinued" is a specific accusation that needs a specific fact behind it.
   * Scoped to the ids recipes actually pin, so it stays one small query.
   */
  const pinnedSkuIds = [...new Set(g.inputs.map((i) => i.component_sku_id).filter((v): v is string => v != null))];
  const retiredSkuIds = new Set<string>();
  if (pinnedSkuIds.length > 0) {
    const sb = getServiceRoleClient();
    // THROWS on a page error rather than taking selectAllRows' silent `data ?? []`
    // (which ignores `error` entirely). The sibling loaders in this file can afford
    // that posture; this one cannot. A swallowed failure here yields an EMPTY set,
    // which reads as "nothing is discontinued" and silently deletes the exact
    // loudness this rule exists to buy — a failure that looks like good news.
    const rows = await selectAllRows<{ id: string }>(async (from, to) => {
      const { data, error } = await sb.from("vendor_items").select("id").in("id", pinnedSkuIds)
        .eq("active", false).order("id", { ascending: true }).range(from, to)
        .returns<Array<{ id: string }>>();
      if (error) throw new Error(`loadGraphReadiness retired SKU pins: ${error.message}`);
      return { data };
    });
    for (const r of rows) retiredSkuIds.add(r.id);
  }

  const inputsOfRecipe = new Map<string, GraphRows["inputs"]>();
  for (const i of g.inputs) {
    const l = inputsOfRecipe.get(i.recipe_id) ?? []; l.push(i); inputsOfRecipe.set(i.recipe_id, l);
  }
  // Only ACTIVE recipes exist in g.recipes; edges from inactive recipes are
  // out of play — an item produced only by an inactive recipe reads "no recipe".
  const activeRecipeIds = new Set(g.recipes.map((r) => r.id));
  const outputsOfRecipe = new Map<string, number>();
  const recipeOfItem = new Map<string, string>();
  // How many DISTINCT active recipes produce each item (audit P5). The costing
  // graph indexes producers first-wins, so a count > 1 means one of them silently
  // owns the item's cost; `recipeOfItem` above keeps its historic last-wins pick,
  // which is precisely the arbitrariness this count exists to surface.
  const producersOfItem = new Map<string, Set<string>>();
  for (const o of g.outputs) {
    if (!activeRecipeIds.has(o.recipe_id)) continue;
    outputsOfRecipe.set(o.recipe_id, (outputsOfRecipe.get(o.recipe_id) ?? 0) + 1);
    if (o.output_item_id) {
      recipeOfItem.set(o.output_item_id, o.recipe_id);
      const set = producersOfItem.get(o.output_item_id) ?? new Set<string>();
      set.add(o.recipe_id);
      producersOfItem.set(o.output_item_id, set);
    }
  }
  const itemById = new Map(g.items.map((it) => [it.id, it]));
  const recipeRowById = new Map(g.recipes.map((r) => [r.id, r]));

  const recipeMemo = new Map<string, Readiness>();
  const itemMemo = new Map<string, Readiness>();
  const visiting = new Set<string>(); // "r:<id>" / "i:<id>"

  function recipeStatus(recipeId: string, batchYield: number | null): Readiness {
    const memod = recipeMemo.get(recipeId);
    if (memod) return memod;
    const key = `r:${recipeId}`;
    if (visiting.has(key)) return { status: "ready", reasons: [] }; // cycle guard: don't recurse
    visiting.add(key);
    const ins = inputsOfRecipe.get(recipeId) ?? [];
    const own = recipeOwnReadiness({
      hasInputs: ins.length > 0,
      hasOutputs: (outputsOfRecipe.get(recipeId) ?? 0) > 0,
      batchYield,
      // 0215: a batch_mode recipe must have exactly one output (display detector only).
      batchMode: recipeRowById.get(recipeId)?.batch_mode === true,
      outputCount: outputsOfRecipe.get(recipeId) ?? 0,
    });
    const skuStatuses: ReadinessStatus[] = [];
    const subStatuses: ReadinessStatus[] = [];
    let unresolvedProducts = 0;
    let retiredProducts = 0;
    let retiredSkus = 0;
    for (const i of ins) {
      if (i.component_product_id) {
        const state = productPinState(i);
        if (state === "retired") retiredProducts += 1;
        else if (state === "unresolved") unresolvedProducts += 1;
      } else if (i.component_sku_id) {
        // inactive SKU is absent from skuStatus → treat as not ready (it's out of play)
        skuStatuses.push(skuStatus.get(i.component_sku_id)?.status ?? "incomplete");
        // …and NAME why it is out of play when the reason is that it was retired.
        // The status above is unchanged; this only adds the word "discontinued".
        if (retiredSkuIds.has(i.component_sku_id)) retiredSkus += 1;
      } else if (i.component_item_id) {
        subStatuses.push(itemStatus(i.component_item_id).status);
      }
    }
    const composed = composeRecipeReadiness(own, skuStatuses, subStatuses, unresolvedProducts, {
      retiredProducts,
      retiredSkus,
    });
    visiting.delete(key);
    recipeMemo.set(recipeId, composed);
    return composed;
  }

  function itemStatus(itemId: string): Readiness {
    const memod = itemMemo.get(itemId);
    if (memod) return memod;
    const key = `i:${itemId}`;
    if (visiting.has(key)) return { status: "ready", reasons: [] };
    visiting.add(key);
    const it = itemById.get(itemId);
    const producingRecipeId = recipeOfItem.get(itemId) ?? null;
    let producing: Readiness | null = null;
    if (producingRecipeId) {
      const rRow = recipeRowById.get(producingRecipeId);
      producing = rRow ? recipeStatus(producingRecipeId, num(rRow.batch_yield)) : null;
    }
    const sellPortionComplete = it
      ? (num(it.sell_portion) ?? 0) > 0 && !!it.sell_portion_unit && (num(it.menu_price) ?? 0) > 0
      : false;
    const result = itemReadiness(
      {
        hasProducingRecipe: producingRecipeId !== null,
        ozPerParUnit: it ? num(it.oz_per_par_unit) : null,
        soldDirectly: it?.sold_directly ?? false,
        sellPortionComplete,
        activeProducerCount: producersOfItem.get(itemId)?.size ?? 0,
      },
      producing?.status ?? null,
    );
    visiting.delete(key);
    itemMemo.set(itemId, result);
    return result;
  }

  const recipeReadiness = new Map<string, Readiness>();
  for (const r of g.recipes) recipeReadiness.set(r.id, recipeStatus(r.id, num(r.batch_yield)));
  const itemReadinessMap = new Map<string, Readiness>();
  for (const it of g.items) itemReadinessMap.set(it.id, itemStatus(it.id));
  return { recipeReadiness, itemReadiness: itemReadinessMap };
}

/** Hub rollups — computed ONLY for sections the viewer can see (caller filters). */
export async function countNotReady(actor: AuthContext): Promise<{
  skus: number; recipes: number; items: number; byScope: ReadinessByScope[];
}> {
  // CATALOG PHASE 3a: not ready for the default OR for ANY active shop (each shop's resolved recipe — lead
  // decision 4), ATTRIBUTED per scope (lead decision (c)). One graph read per scope, never per recipe.
  // Every scope-independent read happens ONCE (chunk-2 review P3c): the SKU list / deliveries / measures, the
  // recipe / output / item rows and recipe_inputs; only prices, chains and the recipe overlay are per scope.
  const shops = await loadActiveShopsForReadiness();
  const scopes: Array<{ id: string | null; name: string | null }> = [{ id: null, name: null }, ...shops];
  const ids = scopes.map((s) => s.id);
  const [skuMaps, base, inputsByScope, measureUnits] = await Promise.all([
    loadSkuReadinessMaps(actor, ids), loadGraphBaseRows(), loadResolvedRecipeInputsByScope(ids), loadMeasureUnits(actor),
  ]);
  const skuMap = skuMaps.get("global")!;
  const graphs = await Promise.all(scopes.map((s) => loadGraphReadiness(actor, s.id, {
    skuStatus: skuMaps.get(s.id ?? "global")!, measureUnits,
    rows: { ...base, inputs: toGraphInputs(inputsByScope.get(s.id ?? "global") ?? []) },
  })));
  const attributed = attributeNotReady(graphs.map((g, i) => ({
    scope: scopes[i]!.id, scopeName: scopes[i]!.name, recipeReadiness: g.recipeReadiness, itemReadiness: g.itemReadiness,
  })));
  const countBad = (m: Map<string, Readiness>) =>
    [...m.values()].filter((r) => r.status !== "ready").length;
  return {
    skus: countBad(skuMap),
    recipes: attributed.recipes,
    items: attributed.items,
    byScope: attributed.byScope,
  };
}

/** The active shops a readiness view can be scoped to (the hub's attribution, the lists' ?location=). Fails loud. */
export async function loadActiveShopsForReadiness(): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await getServiceRoleClient().from("locations").select("id, name").eq("active", true)
    .order("name", { ascending: true }).order("id", { ascending: true }).returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`readiness shops: ${error.message}`);
  return data ?? [];
}
