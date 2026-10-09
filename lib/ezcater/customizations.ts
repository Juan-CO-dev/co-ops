import "server-only";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import type { CustomizationMap } from "./customizations-shared";

/** Bounded, fail-closed config reads. A SKU added by an effect may not occur in
 * any recipe, so its each weight must not depend on the graph's input universe. */
export async function loadCustomizationContext(sb: ReturnType<typeof getServiceRoleClient>, locationId?: string, signal?: AbortSignal) {
  const maps = await selectAllRows<CustomizationMap>((from, to) => {
    let query = sb.from("ezcater_customization_map").select("location_id,customization_id,status,effects,pick_menu_item_id")
      .order("location_id").order("customization_id").range(from, to);
    if (locationId) query = query.eq("location_id", locationId);
    return signal ? query.abortSignal(signal) : query;
  }, 250);
  const ids = [...new Set(maps.flatMap((map) => map.effects.filter((effect) => effect.targetKind === "sku").map((effect) => effect.targetId)))];
  const skuWeights = new Map<string, number | null>();
  for (let start = 0; start < ids.length; start += 100) {
    const rows = await selectAllRows<{ id: string; avg_oz_per_each: number | string | null }>((from, to) => {
      const query = sb.from("vendor_items").select("id,avg_oz_per_each").in("id", ids.slice(start, start + 100)).order("id").range(from, to);
      return signal ? query.abortSignal(signal) : query;
    }, 250);
    for (const row of rows) skuWeights.set(row.id, row.avg_oz_per_each == null ? null : Number(row.avg_oz_per_each));
  }
  return { maps, skuWeights };
}
