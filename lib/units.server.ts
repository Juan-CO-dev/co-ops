/**
 * Server-only units-registry loader (Item/Inventory Spine — Units Registry slice).
 *
 * SERVER-ONLY. Keeps DB access out of any client-safe module. Reads migration
 * 0084's `units` table — the first-class source for par-unit display labels that
 * back the unit dropdowns. The unit is an ITEM-GLOBAL attribute
 * (items.default_par_unit); this loader just surfaces the pool of canonical
 * labels to choose from.
 *
 * NOTE: the `server-only` package is NOT a dependency in this repo — the
 * convention is enforced by review (mirrors lib/prep-sections.server.ts and
 * lib/supabase-server.ts). The `.server.ts` suffix + this header are the
 * boundary marker. Add an `import "server-only";` only once the package lands.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Load active units ordered by display_order (the dropdown order). Service-role
 * client (admin authorization is enforced by the calling routes; `units` denies
 * all end-user DML so reads go through service-role). Throws on error.
 */
export async function loadUnits(
  service: SupabaseClient,
): Promise<Array<{ label: string }>> {
  const { data, error } = await service
    .from("units")
    .select("label")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<Array<{ label: string }>>();
  if (error) throw new Error(`loadUnits failed: ${error.message}`);
  return (data ?? []).map((r) => ({ label: r.label }));
}
