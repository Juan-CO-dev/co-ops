/**
 * The recipe GRAPH write law — CLIENT-SAFE pure surface (catalog Phase 1, Astra full-branch
 * review #3). A recipe line naming a prep ITEM is a graph edge; two concurrent writes could each
 * pass a read-then-write cycle check and together close a loop across recipes. So every recipe
 * line write runs inside ONE database transaction (migration 0258: add_recipe_input_atomic /
 * update_recipe_input_atomic) that first takes the graph-wide advisory lock below, then checks
 * the cycle with a recursive CTE, then writes.
 *
 * `itemLineWouldCycle` is the CTE's semantics, mirrored exactly so they can be tested here
 * (tests/recipe-input-write-atomic.test.ts) and used by the test fakes of the two RPCs:
 *   targets = every item recipe R outputs;
 *   reach   = the new item, then — repeatedly — every input item of every recipe that OUTPUTS a
 *             reached item (ALL producers of an item, not one: the conservative reading of the
 *             TS guard's last-wins map), skipping the line being edited (its old value is about
 *             to be replaced);
 *   cycle   ⇔ reach ∩ targets ≠ ∅   (the new item itself counts: R consuming its own output).
 */

/** pg_advisory_xact_lock key every recipe-graph writer in 0258 takes (bigint). */
export const RECIPE_GRAPH_LOCK_KEY = "7258025800";

export interface GraphOutputRow {
  recipe_id: string;
  output_item_id: string | null;
}
export interface GraphInputRow {
  id: string;
  recipe_id: string;
  component_item_id: string | null;
}

export function itemLineWouldCycle(
  args: { recipeId: string; itemId: string; excludeInputId?: string | null },
  outputs: readonly GraphOutputRow[],
  inputs: readonly GraphInputRow[],
): boolean {
  const targets = new Set(
    outputs.filter((o) => o.recipe_id === args.recipeId && o.output_item_id !== null).map((o) => o.output_item_id as string),
  );
  const reach = new Set<string>([args.itemId]);
  const queue = [args.itemId];
  while (queue.length > 0) {
    const item = queue.shift() as string;
    if (targets.has(item)) return true;
    const producers = new Set(outputs.filter((o) => o.output_item_id === item).map((o) => o.recipe_id));
    for (const i of inputs) {
      if (i.component_item_id === null || !producers.has(i.recipe_id)) continue;
      if (args.excludeInputId && i.id === args.excludeInputId) continue;
      if (!reach.has(i.component_item_id)) {
        reach.add(i.component_item_id);
        queue.push(i.component_item_id);
      }
    }
  }
  return false;
}
