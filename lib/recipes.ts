/**
 * Recipe stage data layer (Derivation Spine #1). SERVER-ONLY, service-role;
 * authority re-checked per action (the lib is the authority). Two tiers via
 * recipe_type: 'production' (→ items) | 'consumer' (→ menu_items). See spec §3.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

export const RECIPE_READ_MIN = 6;
export const RECIPE_WRITE_MIN = 7;
export const MENU_PRICE_MIN = 8;

export type RecipeType = "production" | "consumer";

export interface RecipeInputView {
  id: string; componentSkuId: string | null; componentItemId: string | null;
  componentName: string; quantity: number; unit: string | null;
  eachContainerLabel: string | null; portioned: boolean; displayOrder: number;
}
export interface RecipeOutputView {
  id: string; outputItemId: string | null; outputMenuItemId: string | null;
  outputName: string; yield: number; outputContainerLabel: string | null;
  ozAllocShare: number | null; displayOrder: number;
}
export interface RecipeView {
  id: string; name: string; nameEs: string | null; recipeType: RecipeType;
  batchYield: number; directions: string | null; directionsEs: string | null;
  active: boolean; inputs: RecipeInputView[]; outputs: RecipeOutputView[];
}
export interface RecipeListRow {
  id: string; name: string; recipeType: RecipeType; active: boolean;
  outputNames: string[]; hasInputs: boolean; hasOutputs: boolean;
}

export class RecipeError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code); this.name = "RecipeError";
  }
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new RecipeError(403, "forbidden");
}
function num(v: number | string | null): number | null {
  if (v === null) return null; const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function normStr(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null; const t = s.trim(); return t || null;
}

/** List recipes (>=6), optional type filter, with hydrated output names + completeness flags. */
export async function loadRecipes(actor: AuthContext, type?: RecipeType): Promise<RecipeListRow[]> {
  requireLevel(actor, RECIPE_READ_MIN);
  const sb = getServiceRoleClient();
  let q = sb.from("recipes").select("id, name, recipe_type, active").eq("active", true).order("name");
  if (type) q = q.eq("recipe_type", type);
  const { data, error } = await q.returns<Array<{ id: string; name: string; recipe_type: RecipeType; active: boolean }>>();
  if (error) throw new Error(`loadRecipes: ${error.message}`);
  const ids = (data ?? []).map((r) => r.id);
  const outNames = await outputNamesByRecipe(ids);
  const hasIn = await recipeIdsWithInputs(ids);
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, recipeType: r.recipe_type, active: r.active, outputNames: outNames.get(r.id) ?? [], hasInputs: hasIn.has(r.id), hasOutputs: (outNames.get(r.id) ?? []).length > 0 }));
}

async function recipeIdsWithInputs(recipeIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (recipeIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data } = await sb.from("recipe_inputs").select("recipe_id").in("recipe_id", recipeIds).returns<Array<{ recipe_id: string }>>();
  for (const r of data ?? []) out.add(r.recipe_id);
  return out;
}
async function outputNamesByRecipe(recipeIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (recipeIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data: rows } = await sb.from("recipe_outputs").select("recipe_id, output_item_id, output_menu_item_id")
    .in("recipe_id", recipeIds).returns<Array<{ recipe_id: string; output_item_id: string | null; output_menu_item_id: string | null }>>();
  const itemIds = [...new Set((rows ?? []).map((r) => r.output_item_id).filter((v): v is string => !!v))];
  const menuIds = [...new Set((rows ?? []).map((r) => r.output_menu_item_id).filter((v): v is string => !!v))];
  const itemNames = await namesById("items", itemIds);
  const menuNames = await namesById("menu_items", menuIds);
  for (const r of rows ?? []) {
    const list = out.get(r.recipe_id) ?? [];
    list.push(r.output_item_id ? (itemNames.get(r.output_item_id) ?? "(item)") : (menuNames.get(r.output_menu_item_id ?? "") ?? "(menu item)"));
    out.set(r.recipe_id, list);
  }
  return out;
}
async function namesById(table: "items" | "menu_items" | "vendor_items", ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>(); if (ids.length === 0) return m;
  const sb = getServiceRoleClient();
  const { data } = await sb.from(table).select("id, name").in("id", ids).returns<Array<{ id: string; name: string }>>();
  for (const r of data ?? []) m.set(r.id, r.name); return m;
}

/** Full recipe with hydrated inputs + outputs (>=6). */
export async function loadRecipe(actor: AuthContext, recipeId: string): Promise<RecipeView | null> {
  requireLevel(actor, RECIPE_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: r } = await sb.from("recipes").select("id, name, name_es, recipe_type, batch_yield, directions, directions_es, active").eq("id", recipeId)
    .maybeSingle<{ id: string; name: string; name_es: string | null; recipe_type: RecipeType; batch_yield: number | string; directions: string | null; directions_es: string | null; active: boolean }>();
  if (!r) return null;
  const { data: inRows } = await sb.from("recipe_inputs").select("*").eq("recipe_id", recipeId).order("display_order")
    .returns<Array<{ id: string; component_sku_id: string | null; component_item_id: string | null; quantity: number | string; unit: string | null; each_container_label: string | null; portioned: boolean; display_order: number }>>();
  const { data: outRows } = await sb.from("recipe_outputs").select("*").eq("recipe_id", recipeId).order("display_order")
    .returns<Array<{ id: string; output_item_id: string | null; output_menu_item_id: string | null; yield: number | string; output_container_label: string | null; oz_alloc_share: number | string | null; display_order: number }>>();
  const skuNames = await namesById("vendor_items", (inRows ?? []).map((x) => x.component_sku_id).filter((v): v is string => !!v));
  const subNames = await namesById("items", (inRows ?? []).map((x) => x.component_item_id).filter((v): v is string => !!v));
  const outItemNames = await namesById("items", (outRows ?? []).map((x) => x.output_item_id).filter((v): v is string => !!v));
  const outMenuNames = await namesById("menu_items", (outRows ?? []).map((x) => x.output_menu_item_id).filter((v): v is string => !!v));
  return {
    id: r.id, name: r.name, nameEs: r.name_es, recipeType: r.recipe_type, batchYield: num(r.batch_yield) ?? 1,
    directions: r.directions, directionsEs: r.directions_es, active: r.active,
    inputs: (inRows ?? []).map((x) => ({ id: x.id, componentSkuId: x.component_sku_id, componentItemId: x.component_item_id,
      componentName: x.component_sku_id ? (skuNames.get(x.component_sku_id) ?? "(sku)") : (subNames.get(x.component_item_id ?? "") ?? "(item)"),
      quantity: num(x.quantity) ?? 0, unit: x.unit, eachContainerLabel: x.each_container_label, portioned: x.portioned, displayOrder: x.display_order })),
    outputs: (outRows ?? []).map((x) => ({ id: x.id, outputItemId: x.output_item_id, outputMenuItemId: x.output_menu_item_id,
      outputName: x.output_item_id ? (outItemNames.get(x.output_item_id) ?? "(item)") : (outMenuNames.get(x.output_menu_item_id ?? "") ?? "(menu item)"),
      yield: num(x.yield) ?? 1, outputContainerLabel: x.output_container_label, ozAllocShare: num(x.oz_alloc_share), displayOrder: x.display_order })),
  };
}

export async function createRecipe(actor: AuthContext, input: { name: string; nameEs?: string | null; recipeType: RecipeType; batchYield: number; directions?: string | null; directionsEs?: string | null }): Promise<{ id: string }> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  if (!normStr(input.name)) throw new RecipeError(400, "invalid_name");
  if (!Number.isFinite(input.batchYield) || input.batchYield <= 0) throw new RecipeError(400, "invalid_batch_yield");
  if (input.recipeType !== "production" && input.recipeType !== "consumer") throw new RecipeError(400, "invalid_type");
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("recipes").insert({ name: normStr(input.name), name_es: normStr(input.nameEs), recipe_type: input.recipeType, batch_yield: input.batchYield, directions: normStr(input.directions), directions_es: normStr(input.directionsEs), active: true, created_by: actor.user.id })
    .select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`createRecipe: ${error.message}`);
  if (!data) throw new Error("createRecipe returned no row");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe.create", resourceTable: "recipes", resourceId: data.id, metadata: { name: input.name, recipe_type: input.recipeType, batch_yield: input.batchYield }, ipAddress: null, userAgent: null });
  return { id: data.id };
}

export interface RecipeDraftInput { componentSkuId?: string | null; componentItemId?: string | null; quantity: number; unit?: string | null; eachContainerLabel?: string | null; portioned?: boolean; }
export interface RecipeDraftOutput { outputItemId?: string | null; outputMenuItemId?: string | null; yield: number; outputContainerLabel?: string | null; }
export interface RecipeDraft {
  name: string; nameEs?: string | null; recipeType: RecipeType; batchYield: number;
  directions?: string | null; directionsEs?: string | null;
  inputs: RecipeDraftInput[]; outputs: RecipeDraftOutput[];
}

/** Validate a full recipe draft in TS, then insert header + inputs + outputs atomically
 * via the create_recipe_full RPC (draft-then-save-once). Exactly-one component/output +
 * cycle guard enforced here; table CHECK constraints are the backstop. */
export async function createRecipeFull(actor: AuthContext, draft: RecipeDraft): Promise<{ id: string }> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  if (!normStr(draft.name)) throw new RecipeError(400, "invalid_name");
  if (!(draft.batchYield > 0)) throw new RecipeError(400, "invalid_batch_yield");
  if (draft.recipeType !== "production" && draft.recipeType !== "consumer") throw new RecipeError(400, "invalid_type");
  if (draft.inputs.length === 0 || draft.outputs.length === 0) throw new RecipeError(400, "incomplete_recipe");
  for (const i of draft.inputs) {
    const sku = i.componentSkuId ?? null, it = i.componentItemId ?? null;
    if ((sku === null) === (it === null)) throw new RecipeError(400, "invalid_component");
    if (!(i.quantity > 0)) throw new RecipeError(400, "invalid_quantity");
  }
  for (const o of draft.outputs) {
    const it = o.outputItemId ?? null, mi = o.outputMenuItemId ?? null;
    if ((it === null) === (mi === null)) throw new RecipeError(400, "invalid_output");
    if (!(o.yield > 0)) throw new RecipeError(400, "invalid_yield");
    if (it !== null) {
      for (const i of draft.inputs) {
        if (i.componentItemId && await itemConsumesTransitively(i.componentItemId, it)) {
          throw new RecipeError(400, "would_create_cycle");
        }
      }
    }
  }
  const sb = getServiceRoleClient();
  const { data, error } = await sb.rpc("create_recipe_full", {
    p_header: { name: normStr(draft.name), name_es: normStr(draft.nameEs), recipe_type: draft.recipeType, batch_yield: draft.batchYield, directions: normStr(draft.directions), directions_es: normStr(draft.directionsEs) },
    p_inputs: draft.inputs.map((i, idx) => ({ component_sku_id: i.componentSkuId ?? null, component_item_id: i.componentItemId ?? null, quantity: i.quantity, unit: normStr(i.unit), each_container_label: normStr(i.eachContainerLabel), portioned: i.portioned ?? false, display_order: idx })),
    p_outputs: draft.outputs.map((o, idx) => ({ output_item_id: o.outputItemId ?? null, output_menu_item_id: o.outputMenuItemId ?? null, yield: o.yield, output_container_label: normStr(o.outputContainerLabel), display_order: idx })),
    p_created_by: actor.user.id,
  });
  if (error) throw new Error(`createRecipeFull rpc: ${error.message}`);
  const id = typeof data === "string" ? data : (data as { id?: string } | null)?.id;
  if (!id) throw new Error("createRecipeFull returned no id");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe.create", resourceTable: "recipes", resourceId: id, metadata: { name: draft.name, recipe_type: draft.recipeType, batch_yield: draft.batchYield, input_count: draft.inputs.length, output_count: draft.outputs.length, atomic: true }, ipAddress: null, userAgent: null });
  return { id };
}

export async function updateRecipe(actor: AuthContext, id: string, patch: { name?: string; nameEs?: string | null; batchYield?: number; directions?: string | null; directionsEs?: string | null }): Promise<void> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: actor.user.id };
  if (patch.name !== undefined) { if (!normStr(patch.name)) throw new RecipeError(400, "invalid_name"); upd.name = normStr(patch.name); }
  if (patch.nameEs !== undefined) upd.name_es = normStr(patch.nameEs);
  if (patch.batchYield !== undefined) { if (!(patch.batchYield > 0)) throw new RecipeError(400, "invalid_batch_yield"); upd.batch_yield = patch.batchYield; }
  if (patch.directions !== undefined) upd.directions = normStr(patch.directions);
  if (patch.directionsEs !== undefined) upd.directions_es = normStr(patch.directionsEs);
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("recipes").update(upd, { count: "exact" }).eq("id", id);
  if (error) throw new Error(`updateRecipe: ${error.message}`);
  if (count === 0) throw new RecipeError(404, "recipe_not_found");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe.update", resourceTable: "recipes", resourceId: id, metadata: { patch }, ipAddress: null, userAgent: null });
}

export async function deactivateRecipe(actor: AuthContext, id: string): Promise<void> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("recipes").update({ active: false, updated_at: new Date().toISOString(), updated_by: actor.user.id }, { count: "exact" }).eq("id", id);
  if (error) throw new Error(`deactivateRecipe: ${error.message}`);
  if (count === 0) throw new RecipeError(404, "recipe_not_found");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe.deactivate", resourceTable: "recipes", resourceId: id, metadata: {}, ipAddress: null, userAgent: null });
}

export async function createMenuItem(actor: AuthContext, input: { name: string; nameEs?: string | null; menuPrice?: number | null }): Promise<{ id: string }> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  if (input.menuPrice != null) requireLevel(actor, MENU_PRICE_MIN);
  if (!normStr(input.name)) throw new RecipeError(400, "invalid_name");
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("menu_items").insert({ name: normStr(input.name), name_es: normStr(input.nameEs), menu_price: input.menuPrice ?? null, active: true, created_by: actor.user.id })
    .select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`createMenuItem: ${error.message}`);
  if (!data) throw new Error("createMenuItem returned no row");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "menu_item.create", resourceTable: "menu_items", resourceId: data.id, metadata: { name: input.name }, ipAddress: null, userAgent: null });
  return { id: data.id };
}

/** Load the item-level recipe graph: item -> its producing recipe (by output),
 * recipe -> its input items. Shared by the cycle-guard walks below. */
async function loadItemRecipeGraph(): Promise<{ recipeOfItem: Map<string, string>; inputItemsOfRecipe: Map<string, string[]> }> {
  const sb = getServiceRoleClient();
  const { data: outs } = await sb.from("recipe_outputs").select("recipe_id, output_item_id").not("output_item_id", "is", null).returns<Array<{ recipe_id: string; output_item_id: string }>>();
  const { data: ins } = await sb.from("recipe_inputs").select("recipe_id, component_item_id").not("component_item_id", "is", null).returns<Array<{ recipe_id: string; component_item_id: string }>>();
  const recipeOfItem = new Map<string, string>(); for (const o of outs ?? []) recipeOfItem.set(o.output_item_id, o.recipe_id);
  const inputItemsOfRecipe = new Map<string, string[]>(); for (const i of ins ?? []) { const l = inputItemsOfRecipe.get(i.recipe_id) ?? []; l.push(i.component_item_id); inputItemsOfRecipe.set(i.recipe_id, l); }
  return { recipeOfItem, inputItemsOfRecipe };
}

/** Does `recipeId` (transitively) consume `targetItemId` as an input? BFS over the
 * item-recipe graph: recipe -> input items -> each input item's producing recipe -> … */
function recipeConsumesItem(recipeId: string, targetItemId: string, recipeOfItem: Map<string, string>, inputItemsOfRecipe: Map<string, string[]>): boolean {
  const seen = new Set<string>(); const queue = [recipeId];
  while (queue.length) { const r = queue.shift()!; if (seen.has(r)) continue; seen.add(r);
    for (const it of inputItemsOfRecipe.get(r) ?? []) { if (it === targetItemId) return true; const cr = recipeOfItem.get(it); if (cr) queue.push(cr); } }
  return false;
}

/** True if, starting from the recipe that OUTPUTS `startItemId`, following
 * input-item → its-recipe → input-items… you reach `targetItemId` as an input
 * (or startItemId === targetItemId). Used by createRecipeFull to detect that
 * consuming `startItemId` while producing `targetItemId` would close a loop. */
async function itemConsumesTransitively(startItemId: string, targetItemId: string): Promise<boolean> {
  if (startItemId === targetItemId) return true;
  const { recipeOfItem, inputItemsOfRecipe } = await loadItemRecipeGraph();
  const startRecipe = recipeOfItem.get(startItemId);
  if (!startRecipe) return false; // startItemId isn't produced by any recipe → no chain to walk
  return recipeConsumesItem(startRecipe, targetItemId, recipeOfItem, inputItemsOfRecipe);
}

/** Adding output item `childItemId` to recipe R would cycle iff a SKU-free walk of
 * the recipe graph from childItemId's recipe reaches an input item already feeding R.
 * Simplified guard: reject if childItemId is (transitively) an input of the recipe. */
async function outputWouldCycle(recipeId: string, childItemId: string): Promise<boolean> {
  const { recipeOfItem, inputItemsOfRecipe } = await loadItemRecipeGraph();
  return recipeConsumesItem(recipeId, childItemId, recipeOfItem, inputItemsOfRecipe);
}

export async function addRecipeInput(actor: AuthContext, input: { recipeId: string; componentSkuId?: string | null; componentItemId?: string | null; quantity: number; unit?: string | null; eachContainerLabel?: string | null; portioned?: boolean }): Promise<{ id: string }> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  const skuId = input.componentSkuId ?? null, itemId = input.componentItemId ?? null;
  if ((skuId === null) === (itemId === null)) throw new RecipeError(400, "invalid_component");
  if (!(input.quantity > 0)) throw new RecipeError(400, "invalid_quantity");
  const sb = getServiceRoleClient();
  const { data: max } = await sb.from("recipe_inputs").select("display_order").eq("recipe_id", input.recipeId).order("display_order", { ascending: false }).limit(1).maybeSingle<{ display_order: number }>();
  const { data, error } = await sb.from("recipe_inputs").insert({ recipe_id: input.recipeId, component_sku_id: skuId, component_item_id: itemId, quantity: input.quantity, unit: normStr(input.unit), each_container_label: normStr(input.eachContainerLabel), portioned: input.portioned ?? false, display_order: (max?.display_order ?? 0) + 1, created_by: actor.user.id })
    .select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`addRecipeInput: ${error.message}`);
  if (!data) throw new Error("addRecipeInput returned no row");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe_input.add", resourceTable: "recipe_inputs", resourceId: data.id, metadata: { recipe_id: input.recipeId, component_sku_id: skuId, component_item_id: itemId, quantity: input.quantity }, ipAddress: null, userAgent: null });
  return { id: data.id };
}

export async function addRecipeOutput(actor: AuthContext, input: { recipeId: string; outputItemId?: string | null; outputMenuItemId?: string | null; yield: number; outputContainerLabel?: string | null }): Promise<{ id: string }> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  const itemId = input.outputItemId ?? null, menuId = input.outputMenuItemId ?? null;
  if ((itemId === null) === (menuId === null)) throw new RecipeError(400, "invalid_output");
  if (!(input.yield > 0)) throw new RecipeError(400, "invalid_yield");
  if (itemId !== null && await outputWouldCycle(input.recipeId, itemId)) throw new RecipeError(400, "would_create_cycle");
  const sb = getServiceRoleClient();
  const { data: max } = await sb.from("recipe_outputs").select("display_order").eq("recipe_id", input.recipeId).order("display_order", { ascending: false }).limit(1).maybeSingle<{ display_order: number }>();
  const { data, error } = await sb.from("recipe_outputs").insert({ recipe_id: input.recipeId, output_item_id: itemId, output_menu_item_id: menuId, yield: input.yield, output_container_label: normStr(input.outputContainerLabel), display_order: (max?.display_order ?? 0) + 1, created_by: actor.user.id })
    .select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`addRecipeOutput: ${error.message}`);
  if (!data) throw new Error("addRecipeOutput returned no row");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "recipe_output.add", resourceTable: "recipe_outputs", resourceId: data.id, metadata: { recipe_id: input.recipeId, output_item_id: itemId, output_menu_item_id: menuId, yield: input.yield }, ipAddress: null, userAgent: null });
  return { id: data.id };
}

export async function removeRecipeEdge(actor: AuthContext, args: { table: "recipe_inputs" | "recipe_outputs"; id: string }): Promise<void> {
  requireLevel(actor, RECIPE_WRITE_MIN);
  const sb = getServiceRoleClient();
  const { data: before } = await sb.from(args.table).select("*").eq("id", args.id).maybeSingle<Record<string, unknown>>();
  if (!before) throw new RecipeError(404, "edge_not_found");
  const { error, count } = await sb.from(args.table).delete({ count: "exact" }).eq("id", args.id);
  if (error) throw new Error(`removeRecipeEdge: ${error.message}`);
  if (count === 0) throw new RecipeError(404, "edge_not_found");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: `${args.table === "recipe_inputs" ? "recipe_input" : "recipe_output"}.remove`, resourceTable: args.table, resourceId: args.id, metadata: { before }, ipAddress: null, userAgent: null });
}

export const SOLD_DIRECT_WRITE_MIN = 7;

/** Flag a production item as sold-directly (antipasta-side model): set sold_directly +
 * optional sell portion/unit; clearing the flag nulls the portion fields. menu_price is
 * MoO+-gated (MENU_PRICE_MIN) when provided. GM+ (SOLD_DIRECT_WRITE_MIN) for the flag itself. */
export async function setItemSoldDirectly(actor: AuthContext, args: { itemId: string; soldDirectly: boolean; sellPortion?: number | null; sellPortionUnit?: string | null; menuPrice?: number | null }): Promise<void> {
  requireLevel(actor, SOLD_DIRECT_WRITE_MIN);
  if (args.menuPrice != null) requireLevel(actor, MENU_PRICE_MIN);
  const upd: Record<string, unknown> = { sold_directly: args.soldDirectly, updated_at: new Date().toISOString(), updated_by: actor.user.id };
  if (args.soldDirectly) {
    if (args.sellPortion != null && !(args.sellPortion > 0)) throw new RecipeError(400, "invalid_sell_portion");
    upd.sell_portion = args.sellPortion ?? null;
    upd.sell_portion_unit = normStr(args.sellPortionUnit);
    if (args.menuPrice !== undefined) upd.menu_price = args.menuPrice;
  } else {
    upd.sell_portion = null; upd.sell_portion_unit = null;
  }
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("items").update(upd, { count: "exact" }).eq("id", args.itemId);
  if (error) throw new Error(`setItemSoldDirectly: ${error.message}`);
  if (count === 0) throw new RecipeError(404, "not_found");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "item.set_sold_directly", resourceTable: "items", resourceId: args.itemId, metadata: { sold_directly: args.soldDirectly, sell_portion: args.sellPortion ?? null, sell_portion_unit: args.sellPortionUnit ?? null }, ipAddress: null, userAgent: null });
}
