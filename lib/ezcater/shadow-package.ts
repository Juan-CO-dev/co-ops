import "server-only";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import type { RecipeGraph } from "@/lib/prep-consumption-graph";
import { evenMixPerOption, selectAssortmentPool } from "@/lib/toast/platter-shared";
import { shadowAmounts, type ProductionEvidence, type TransferEvidence, type ShadowAmount } from "./pass2-shared";

/** Reviewed package target follows the existing Toast full-assortment doctrine.
 * Incomplete package composition refuses the whole line, never a partial total. */
export async function packageShadowAmounts(sb: ReturnType<typeof getServiceRoleClient>, graph: RecipeGraph,
  packageId: string, quantity: number, locationId: string, eventDate: string,
  productions: ProductionEvidence[], transfers: TransferEvidence[], signal: AbortSignal): Promise<ShadowAmount[]> {
  type Line = { id: string; slot_type: string; item_id: string | null; menu_item_id: string | null; quantity: number | string };
  const lines = await selectAllRows<Line>((from, to) => sb.from("catering_package_items")
    .select("id,slot_type,item_id,menu_item_id,quantity").eq("package_id", packageId).eq("active", true)
    .order("id").range(from, to).abortSignal(signal));
  if (!lines.length) return [];
  const totals = new Map<string, ShadowAmount>();
  for (const line of lines) {
    const units = Number(line.quantity) * quantity;
    if (!Number.isFinite(units) || units < 0) return [];
    let targets: Array<{ item_id: string | null; menu_item_id: string | null; units: number }>;
    if (line.slot_type === "choice") {
      const options = await selectAllRows<{ item_id: string | null; menu_item_id: string | null; classic: boolean }>((from, to) => sb.from("catering_package_slot_options")
        .select("item_id,menu_item_id,classic").eq("package_item_id", line.id).eq("active", true)
        .order("id").range(from, to).abortSignal(signal));
      const pool = selectAssortmentPool(options, "full");
      if (!pool.length) return [];
      targets = pool.map((target) => ({ ...target, units: evenMixPerOption(units, pool.length) }));
    } else targets = [{ ...line, units }];
    for (const target of targets) {
      if (!target.item_id && !target.menu_item_id) return [];
      const amounts = shadowAmounts(graph, target, target.units, locationId, eventDate, productions, transfers);
      if (target.units > 0 && !amounts.length) return [];
      for (const amount of amounts) {
        const previous = totals.get(amount.sku_id) ?? { sku_id: amount.sku_id, sales_oz: 0, suppressed_oz: 0, shadow_oz: 0, flattened_oz: 0 };
        totals.set(amount.sku_id, { sku_id: amount.sku_id, sales_oz: previous.sales_oz + amount.sales_oz,
          suppressed_oz: previous.suppressed_oz + amount.suppressed_oz, shadow_oz: previous.shadow_oz + amount.shadow_oz,
          flattened_oz: previous.flattened_oz + amount.flattened_oz });
      }
    }
  }
  return [...totals.values()];
}
