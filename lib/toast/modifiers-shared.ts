/**
 * Toast modifier semantics (spec 2026-07-24, Part 1). PURE, client-safe —
 * fully unit-tested. The three-way disposition model, evidence-grounded:
 * BYO parents carry plain toppings (modifiers ARE the build → deplete);
 * signature parents carry deltas ("Extra X" → deplete, "No X" → remove —
 * Juan: removals COUNT NEGATIVELY, "we do not count that as consumed").
 *
 * Portion guard (the 32×-trap): a modifier application must never deplete a
 * whole PAR UNIT. Default portion derives from the signature consumer builds
 * the team already authored (median qty in the modal unit across all
 * consumer-recipe inputs referencing the item), converted at read time by the
 * same weight-honest `itemRefParUnits` math from Wave 1.5.
 */
import {
  itemRefParUnits,
  itemOzWeight,
  perUnitSkuOzForItemFromGraph,
  type RecipeGraph,
} from "@/lib/prep-consumption-graph";

export type ModifierDisposition = "deplete" | "remove" | "ignore";

export interface ModifierClass {
  disposition: ModifierDisposition;
  /** The name to match against CO entities ("No Pickles" → "Pickles"). */
  matchName: string;
}

const REMOVE_RE = /^no\s+/i;
const ADD_RE = /^(?:add|extra|more)\s+/i;

export function classifyModifier(name: string): ModifierClass {
  const trimmed = name.trim();
  if (REMOVE_RE.test(trimmed)) return { disposition: "remove", matchName: trimmed.replace(REMOVE_RE, "").trim() };
  if (ADD_RE.test(trimmed)) return { disposition: "deplete", matchName: trimmed.replace(ADD_RE, "").trim() };
  return { disposition: "deplete", matchName: trimmed };
}

export interface Portion {
  qty: number;
  unit: string | null;
}

/**
 * Default per-application portion for an item = how the signature builds use
 * it: modal unit across all consumer-recipe inputs referencing the item, then
 * median qty within that unit. Null when no consumer build references it.
 */
export function derivePortion(graph: RecipeGraph, itemId: string): Portion | null {
  const samples: Array<{ qty: number; unit: string | null }> = [];
  const seenRecipes = new Set<string>();
  for (const node of graph.byOutputMenuItem.values()) {
    if (seenRecipes.has(node.recipeId)) continue; // multi-menu-output recipes sample once
    seenRecipes.add(node.recipeId);
    for (const input of node.inputs) {
      if (input.componentItemId === itemId && Number.isFinite(input.quantity) && input.quantity > 0) {
        samples.push({ qty: input.quantity, unit: input.unit });
      }
    }
  }
  if (samples.length === 0) return null;
  const byUnit = new Map<string, number[]>();
  for (const s of samples) {
    const key = s.unit ?? "";
    const arr = byUnit.get(key) ?? [];
    arr.push(s.qty);
    byUnit.set(key, arr);
  }
  let modalUnit = "";
  let best = -1;
  for (const [unit, qtys] of [...byUnit.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (qtys.length > best) { best = qtys.length; modalUnit = unit; }
  }
  const qtys = byUnit.get(modalUnit)!.slice().sort((a, b) => a - b);
  const mid = Math.floor(qtys.length / 2);
  const median = qtys.length % 2 === 1 ? qtys[mid]! : (qtys[mid - 1]! + qtys[mid]!) / 2;
  return { qty: median, unit: modalUnit === "" ? null : modalUnit };
}

/** Par-units of `itemId` for one modifier application at `portion`. Null = unconvertible. */
export function modifierParUnits(graph: RecipeGraph, itemId: string, portion: Portion): number | null {
  const subPerUnit = perUnitSkuOzForItemFromGraph(graph, itemId);
  return itemRefParUnits(
    graph,
    { quantity: portion.qty, unit: portion.unit, componentSkuId: null, componentItemId: itemId },
    subPerUnit,
  );
}

/**
 * PARENT-AWARE removal amount: what the parent menu_item's consumer recipe
 * says one sub contributes of `itemId`, in par-units (share/yield-scaled like
 * firstLevelItemConsumption). Null when the parent has no recipe or no input
 * for the item — caller falls back to the row portion.
 */
export function removalAmount(graph: RecipeGraph, parentMenuItemId: string, itemId: string): number | null {
  const node = graph.byOutputMenuItem.get(parentMenuItemId) ?? null;
  if (!node || node.batchYield == null || node.batchYield <= 0) return null;
  const meOut = node.outputs.find((o) => o.outputMenuItemId === parentMenuItemId);
  const myYield = meOut?.yield ?? 0;
  if (myYield <= 0) return null;
  let total = 0;
  let found = false;
  for (const input of node.inputs) {
    if (input.componentItemId !== itemId) continue;
    const subPerUnit = perUnitSkuOzForItemFromGraph(graph, itemId);
    const par = itemRefParUnits(graph, input, subPerUnit);
    if (par == null) return null;
    total += par;
    found = true;
  }
  if (!found) return null;
  // EXACT share/yield parity with firstLevelItemConsumption (review finding #2):
  // item outputs weight by itemOzWeight, menu outputs by yield.
  let totalWeight = 0;
  let myWeight = 0;
  for (const o of node.outputs) {
    const w = o.outputItemId != null ? itemOzWeight(o) : o.yield;
    if (w > 0) totalWeight += w;
    if (o.outputMenuItemId === parentMenuItemId) myWeight = w > 0 ? w : 0;
  }
  const share = totalWeight > 0 ? myWeight / totalWeight : 1 / Math.max(node.outputs.length, 1);
  return (total * share) / myYield;
}
