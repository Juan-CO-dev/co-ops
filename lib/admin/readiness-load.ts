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
import { loadSkus } from "@/lib/admin/skus";
import { loadCurrentSkuPrices } from "@/lib/admin/cost";
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

/** Readiness per ACTIVE SKU (inactive → absent from the map = no badge). */
export async function loadSkuReadinessMap(actor: AuthContext): Promise<Map<string, Readiness>> {
  const skus = await loadSkus(actor);
  const active = skus.filter((s) => s.active);
  const ids = active.map((s) => s.id);
  const [prices, deliveries] = await Promise.all([
    loadCurrentSkuPrices(ids), loadSkuDeliveryCounts(ids),
  ]);
  const out = new Map<string, Readiness>();
  for (const s of active) {
    const r = skuReadiness({
      active: true,
      packComplete: skuPackComplete(s),
      hasPrice: prices.has(s.id),
      deliveryCount: deliveries.get(s.id) ?? 0,
    });
    if (r) out.set(s.id, r);
  }
  return out;
}

interface GraphRows {
  recipes: Array<{ id: string; batch_yield: number | string | null }>;
  inputs: Array<{ recipe_id: string; component_sku_id: string | null; component_item_id: string | null }>;
  outputs: Array<{ recipe_id: string; output_item_id: string | null; output_menu_item_id: string | null }>;
  items: Array<{ id: string; oz_per_par_unit: number | string | null; sold_directly: boolean; sell_portion: number | string | null; sell_portion_unit: string | null; menu_price: number | string | null }>;
}

async function loadGraphRows(): Promise<GraphRows> {
  const sb = getServiceRoleClient();
  const [rRes, iRes, oRes, itRes] = await Promise.all([
    sb.from("recipes").select("id, batch_yield").eq("active", true)
      .returns<GraphRows["recipes"]>(),
    sb.from("recipe_inputs").select("recipe_id, component_sku_id, component_item_id")
      .returns<GraphRows["inputs"]>(),
    sb.from("recipe_outputs").select("recipe_id, output_item_id, output_menu_item_id")
      .returns<GraphRows["outputs"]>(),
    sb.from("items").select("id, oz_per_par_unit, sold_directly, sell_portion, sell_portion_unit, menu_price").eq("active", true)
      .returns<GraphRows["items"]>(),
  ]);
  for (const [label, res] of [["recipes", rRes], ["recipe_inputs", iRes], ["recipe_outputs", oRes], ["items", itRes]] as const) {
    if (res.error) throw new Error(`loadGraphRows ${label}: ${res.error.message}`);
  }
  return { recipes: rRes.data ?? [], inputs: iRes.data ?? [], outputs: oRes.data ?? [], items: itRes.data ?? [] };
}

/**
 * Compute recipe + item readiness over the whole (small) graph in one pass.
 * Memoized recursion with a visiting-set cycle guard (graph is cycle-guarded
 * at write time via outputWouldCycle, but belt-and-braces here).
 */
export async function loadGraphReadiness(actor: AuthContext): Promise<{
  recipeReadiness: Map<string, Readiness>;
  itemReadiness: Map<string, Readiness>;
}> {
  const [skuStatus, g] = await Promise.all([loadSkuReadinessMap(actor), loadGraphRows()]);

  const inputsOfRecipe = new Map<string, GraphRows["inputs"]>();
  for (const i of g.inputs) {
    const l = inputsOfRecipe.get(i.recipe_id) ?? []; l.push(i); inputsOfRecipe.set(i.recipe_id, l);
  }
  // Only ACTIVE recipes exist in g.recipes; edges from inactive recipes are
  // out of play — an item produced only by an inactive recipe reads "no recipe".
  const activeRecipeIds = new Set(g.recipes.map((r) => r.id));
  const outputsOfRecipe = new Map<string, number>();
  const recipeOfItem = new Map<string, string>();
  for (const o of g.outputs) {
    if (!activeRecipeIds.has(o.recipe_id)) continue;
    outputsOfRecipe.set(o.recipe_id, (outputsOfRecipe.get(o.recipe_id) ?? 0) + 1);
    if (o.output_item_id) recipeOfItem.set(o.output_item_id, o.recipe_id);
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
    });
    const skuStatuses: ReadinessStatus[] = [];
    const subStatuses: ReadinessStatus[] = [];
    for (const i of ins) {
      if (i.component_sku_id) {
        // inactive SKU is absent from skuStatus → treat as not ready (it's out of play)
        skuStatuses.push(skuStatus.get(i.component_sku_id)?.status ?? "incomplete");
      } else if (i.component_item_id) {
        subStatuses.push(itemStatus(i.component_item_id).status);
      }
    }
    const composed = composeRecipeReadiness(own, skuStatuses, subStatuses);
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
  skus: number; recipes: number; items: number;
}> {
  const [skuMap, graph] = await Promise.all([
    loadSkuReadinessMap(actor), loadGraphReadiness(actor),
  ]);
  const countBad = (m: Map<string, Readiness>) =>
    [...m.values()].filter((r) => r.status !== "ready").length;
  return {
    skus: countBad(skuMap),
    recipes: countBad(graph.recipeReadiness),
    items: countBad(graph.itemReadiness),
  };
}
