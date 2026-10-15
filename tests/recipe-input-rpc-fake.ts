/**
 * Test fakes of the two 0258 RPCs (add_recipe_input_atomic / update_recipe_input_atomic) over the
 * predicate-aware fake. They follow the SQL statement by statement — the same cycle rule
 * (itemLineWouldCycle, the CTE's mirror), the same compare-and-set predicate, the same named
 * P0001 refusals — so the lib's behaviour can be tested without a database. Never a real DB.
 */
import { itemLineWouldCycle, type GraphInputRow, type GraphOutputRow } from "@/lib/recipe-graph-shared";
import type { FakeDb, FakeRpc, Row } from "./fake-supabase";

const refuse = (message: string) => ({ data: null, error: { code: "P0001", message } });
const graph = (db: FakeDb) => ({
  outputs: (db.tables.recipe_outputs ?? []) as unknown as GraphOutputRow[],
  inputs: (db.tables.recipe_inputs ?? []) as unknown as GraphInputRow[],
});
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
let seq = 0;

export const recipeInputRpcs: Record<string, FakeRpc> = {
  add_recipe_input_atomic: (a, db) => {
    const recipes = (db.tables.recipes ?? []) as Row[];
    if (recipes.length > 0 && !recipes.some((r) => r.id === a.p_recipe_id)) return refuse("recipe_not_found");
    if (a.p_component_item_id) {
      const { outputs, inputs } = graph(db);
      if (itemLineWouldCycle({ recipeId: a.p_recipe_id as string, itemId: a.p_component_item_id as string }, outputs, inputs)) {
        return refuse("would_create_cycle");
      }
    }
    const rows = (db.tables.recipe_inputs ??= []);
    const order = Math.max(0, ...rows.filter((r) => r.recipe_id === a.p_recipe_id).map((r) => Number(r.display_order ?? 0))) + 1;
    const row: Row = {
      id: `rpc-line-${++seq}`, recipe_id: a.p_recipe_id, component_sku_id: a.p_component_sku_id ?? null,
      component_item_id: a.p_component_item_id ?? null, component_product_id: a.p_component_product_id ?? null,
      quantity: a.p_quantity, unit: a.p_unit ?? null, each_container_label: a.p_each_container_label ?? null,
      portioned: a.p_portioned ?? false, display_order: order, created_by: a.p_created_by ?? null,
    };
    rows.push(row);
    db.writes.push({ table: "recipe_inputs", op: "insert", payload: row, matched: 1 });
    return { data: row.id, error: null };
  },

  update_recipe_input_atomic: (a, db) => {
    if (a.p_component_item_id) {
      const { outputs, inputs } = graph(db);
      if (itemLineWouldCycle({ recipeId: a.p_recipe_id as string, itemId: a.p_component_item_id as string, excludeInputId: a.p_input_id as string }, outputs, inputs)) {
        return refuse("would_create_cycle");
      }
    }
    const rows = (db.tables.recipe_inputs ?? []) as Row[];
    const hit = rows.filter((r) =>
      r.id === a.p_input_id && r.recipe_id === a.p_recipe_id &&
      same(r.component_sku_id, a.p_expected_component_sku_id) &&
      same(r.component_item_id, a.p_expected_component_item_id) &&
      same(r.component_product_id, a.p_expected_component_product_id) &&
      Number(r.quantity) === Number(a.p_expected_quantity) &&
      same(r.unit, a.p_expected_unit) &&
      same(r.each_container_label, a.p_expected_each_container_label) &&
      same(r.portioned, a.p_expected_portioned));
    const patch = {
      component_sku_id: a.p_component_sku_id ?? null, component_item_id: a.p_component_item_id ?? null,
      component_product_id: a.p_component_product_id ?? null, quantity: a.p_quantity, unit: a.p_unit ?? null,
      each_container_label: a.p_each_container_label ?? null, portioned: a.p_portioned,
    };
    for (const r of hit) Object.assign(r, patch);
    db.writes.push({ table: "recipe_inputs", op: "update", payload: patch, matched: hit.length });
    if (hit.length === 0) {
      return refuse(rows.some((r) => r.id === a.p_input_id && r.recipe_id === a.p_recipe_id) ? "line_changed" : "edge_not_found");
    }
    return { data: hit.map((r) => ({ ...patch, quantity: r.quantity })), error: null };
  },
};
