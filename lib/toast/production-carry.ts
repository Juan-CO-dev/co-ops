import "server-only";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { carryDaysFor } from "@/lib/depletion-shared";

type Client = ReturnType<typeof getServiceRoleClient>;

/**
 * W16/B092 — how many days a logged production of each prep item covers later sales at a shop: the
 * shelf life (recipes.shelf_life_days, 0215) of the ACTIVE recipes that output the item and that the shop
 * sees (global, or its own), the longest one, else 5, capped at CARRY_CAP_DAYS. Two paged reads per window
 * (no id lists); a failed read throws — a smaller answer would be a double count.
 */
export async function loadProductionCarryDays(sb: Client): Promise<(locationId: string, itemId: string) => number> {
  const [recipes, outputs] = await Promise.all([
    selectAllRows<{ id: string; shelf_life_days: number | string | null; location_id: string | null }>(async (from, to) => {
      const { data, error } = await sb.from("recipes").select("id,shelf_life_days,location_id").eq("active", true)
        .order("id").range(from, to);
      if (error) throw new Error("production_carry_recipes_unavailable");
      return { data };
    }),
    selectAllRows<{ recipe_id: string; output_item_id: string | null }>(async (from, to) => {
      const { data, error } = await sb.from("recipe_outputs").select("recipe_id,output_item_id").not("output_item_id", "is", null)
        .order("id").range(from, to);
      if (error) throw new Error("production_carry_outputs_unavailable");
      return { data };
    }),
  ]);
  const byRecipe = new Map(recipes.map((r) => [r.id, r]));
  // item → [{ shop the recipe belongs to (null = every shop), shelf life }]
  const byItem = new Map<string, Array<{ locationId: string | null; days: number }>>();
  for (const o of outputs) {
    const r = o.output_item_id ? byRecipe.get(o.recipe_id) : undefined;
    if (!r || !o.output_item_id) continue;
    const list = byItem.get(o.output_item_id) ?? [];
    list.push({ locationId: r.location_id, days: Number(r.shelf_life_days) });
    byItem.set(o.output_item_id, list);
  }
  const memo = new Map<string, number>();
  return (locationId, itemId) => {
    const k = `${locationId}:${itemId}`;
    let v = memo.get(k);
    if (v === undefined) {
      v = carryDaysFor((byItem.get(itemId) ?? []).filter((e) => e.locationId === null || e.locationId === locationId).map((e) => e.days));
      memo.set(k, v);
    }
    return v;
  };
}

/** location → item → the ET dates it was produced on (live productions only, as the callers read them). */
export function productionDaysByLocation(rows: ReadonlyArray<{ location_id: string; output_item_id: string | null; produced_at: string }>,
  etDate: (iso: string) => string): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>();
  for (const row of rows) {
    if (!row.output_item_id) continue;
    const byItem = out.get(row.location_id) ?? new Map<string, string[]>();
    const dates = byItem.get(row.output_item_id) ?? [];
    dates.push(etDate(row.produced_at));
    byItem.set(row.output_item_id, dates);
    out.set(row.location_id, byItem);
  }
  return out;
}
