/**
 * Batch vs bottle — SERVER-ONLY context loader (plan S r4, Phase A; migration 0215).
 *
 * The TS mirror of the SQL `prep_batch_context(template_item_id)` (0215): for each registry
 * item, its producing recipe (ACTIVE production recipes, first-wins by created_at NULLS FIRST,
 * id — the same order loadRecipeGraph indexes producers), the recipe's `batch_mode` and
 * `shelf_life_days`, how many outputs it has, and the item's own yield. `isBatch` is the
 * eligibility the RPCs enforce: batch_mode AND exactly one output AND it is this item AND
 * yield > 0. The forms use it to pick the row shape (two boxes / batch row); the RPCs
 * re-derive it under the recipe row lock and are the authority, so a disagreement here can
 * only ever produce a refused save, never a wrong one.
 *
 * Pure math over the loaded rows lives in lib/batch-prep-shared.ts (client-safe).
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { batchSkuOzForItemFromGraph, type RecipeGraph } from "@/lib/prep-consumption-graph";
import { batchEligibility, type BatchItemContext } from "@/lib/batch-prep-shared";

export type { BatchItemContext };

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * Per registry item → its batch context. Items with no ACTIVE production recipe are ABSENT
 * (callers treat absent as single-box: there is nothing to count by batch). Every read
 * throws on `error` (the lib/prep-consumption.ts posture: a smaller answer is a wrong answer).
 */
export async function loadBatchContextForItems(itemIds: string[], graphIn?: RecipeGraph): Promise<Map<string, BatchItemContext>> {
  const out = new Map<string, BatchItemContext>();
  const uniq = [...new Set(itemIds.filter(Boolean))];
  if (uniq.length === 0) return out;
  const sb = getServiceRoleClient();
  // Astra P2 #5 (BC-031): resolvability comes from the SAME graph the fold will read — a
  // single-output recipe with an unconvertible ingredient is NOT usable, whatever its flags
  // say, and the row/save say so instead of committing a completion the fold then refuses.
  const graph = graphIn ?? (await loadRecipeGraph());

  // 1. Every output row naming one of our items → candidate producer recipes.
  const myOutputs = await selectAllRows<{ recipe_id: string; output_item_id: string; yield: number | string | null }>((from, to) =>
    sb.from("recipe_outputs").select("recipe_id, output_item_id, yield").in("output_item_id", uniq)
      .order("id", { ascending: true }).range(from, to));
  const recipeIds = [...new Set(myOutputs.map((o) => o.recipe_id))];
  if (recipeIds.length === 0) return out;

  // 2. The recipes themselves — ACTIVE production only, in first-wins order.
  const { data: recipes, error: recErr } = await sb.from("recipes")
    .select("id, name, recipe_type, active, batch_mode, shelf_life_days, created_at")
    .in("id", recipeIds).eq("active", true).eq("recipe_type", "production")
    .order("created_at", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true })
    .returns<Array<{ id: string; name: string; recipe_type: string; active: boolean; batch_mode: boolean | null; shelf_life_days: number | string | null; created_at: string | null }>>();
  if (recErr) throw new Error(`loadBatchContextForItems recipes: ${recErr.message}`);
  const liveRecipeIds = (recipes ?? []).map((r) => r.id);
  if (liveRecipeIds.length === 0) return out;

  // 3. ALL outputs of those recipes (the count is over every output, not just ours).
  const allOutputs = await selectAllRows<{ recipe_id: string; output_item_id: string | null }>((from, to) =>
    sb.from("recipe_outputs").select("recipe_id, output_item_id").in("recipe_id", liveRecipeIds)
      .order("id", { ascending: true }).range(from, to));
  const outputCount = new Map<string, number>();
  for (const o of allOutputs) outputCount.set(o.recipe_id, (outputCount.get(o.recipe_id) ?? 0) + 1);

  // 4. First-wins per item, walking recipes in their deterministic order.
  const yieldByRecipeItem = new Map<string, number | null>();
  for (const o of myOutputs) yieldByRecipeItem.set(`${o.recipe_id}:${o.output_item_id}`, num(o.yield));
  for (const r of recipes ?? []) {
    for (const o of myOutputs) {
      if (o.recipe_id !== r.id || out.has(o.output_item_id)) continue;
      const yieldPerBatch = yieldByRecipeItem.get(`${r.id}:${o.output_item_id}`) ?? null;
      const count = outputCount.get(r.id) ?? 0;
      const batchMode = r.batch_mode === true;
      const usableYield = yieldPerBatch !== null && yieldPerBatch > 0 ? yieldPerBatch : null;
      const resolvable = batchMode ? batchSkuOzForItemFromGraph(graph, o.output_item_id) !== null : true;
      const eligibility = batchEligibility({ batchMode, outputCount: count, yieldPerBatch: usableYield, resolvable });
      const blockedReason: BatchItemContext["blockedReason"] =
        eligibility !== "blocked" ? null : count !== 1 ? "multi_output" : usableYield === null ? "no_yield" : "unresolved";
      out.set(o.output_item_id, {
        itemId: o.output_item_id,
        recipeId: r.id,
        recipeName: r.name,
        batchMode,
        shelfLifeDays: num(r.shelf_life_days) ?? 5,
        outputCount: count,
        yieldPerBatch: usableYield,
        isBatch: eligibility === "batched",
        eligibility,
        blockedReason,
      });
    }
  }
  return out;
}
