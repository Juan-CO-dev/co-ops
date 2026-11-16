/**
 * THE PAR'D-SKU UNIVERSE — one definition for the walk, the nightly engine and the suggestion /
 * silence lane (audit W18/B025). SERVER-ONLY, service role; authorization is the caller's.
 *
 * A SKU is par'd at a shop when it has a GLOBAL par (`vendor_items.weekday_par` /
 * `weekend_par`) OR a HUMAN par at THAT shop (`location_sku_settings.weekday_par` /
 * `weekend_par`). Before this module the three loaders each read the global predicate only, so
 * a par set for one shop (the catalog New-item job writes only the shop overlay) never reached
 * the walk, the Suggest chips or the shadow ledger, even though the Pars page showed it.
 *
 * The MACHINE lane (`auto_*_par`) does NOT bring a SKU in: "the machine's lane is never the
 * bottom rung" (AGENTS.md, Dynamic pars) — a SKU with no human and no global par has no par a
 * machine value could be measured against.
 *
 * This returns ROWS only. Every filter (shop scope, store vendors, `resolveActive`,
 * `resolvePar`, `walkDisposition`) stays where it was, in the callers. An overlay with
 * `active_override = false` and no pars is not pulled in (an off-here SKU stays out).
 *
 * Kept OUT of lib/ordering.ts on purpose: lib/dynamic-pars-walker.ts must not import ordering
 * (see the recursion note at its header). This module imports no consumer.
 */
import "server-only";

import type { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/** Id chunk for the overlay-only SKU read: a long id list in the GET line is a 414 (8 KB). */
const ID_CHUNK = 100;

/** The global-par predicate, ONE spelling. */
export const GLOBAL_PAR_FILTER = "weekday_par.not.is.null,weekend_par.not.is.null";

/**
 * The par'd SKUs that can be par'd at `locationId`: every global-par row (unchanged predicate,
 * unchanged columns), plus the `vendor_items` rows of SKUs whose only par is this shop's human
 * override. De-duplicated by id; the global rows keep their order, the overlay-only rows follow.
 */
export async function loadParSkuUniverse<T extends { id: string }>(
  sb: ServiceClient,
  locationId: string,
  columns: string,
): Promise<T[]> {
  const { data: globalRows, error } = await sb.from("vendor_items")
    .select(columns)
    .or(GLOBAL_PAR_FILTER)
    .returns<T[]>();
  if (error) throw new Error(`loadParSkuUniverse skus: ${error.message}`);
  const out: T[] = [...(globalRows ?? [])];
  const seen = new Set(out.map((r) => r.id));

  const overlayRows = await selectAllRows<{ id: string; sku_id: string }>((from, to) =>
    sb.from("location_sku_settings")
      .select("id, sku_id")
      .eq("location_id", locationId)
      .or(GLOBAL_PAR_FILTER)
      .order("id", { ascending: true })
      .range(from, to)
      .returns<Array<{ id: string; sku_id: string }>>());
  const extraIds = [...new Set(overlayRows.map((r) => r.sku_id))].filter((id) => !seen.has(id)).sort();
  for (let i = 0; i < extraIds.length; i += ID_CHUNK) {
    const chunk = extraIds.slice(i, i + ID_CHUNK);
    const { data, error: xErr } = await sb.from("vendor_items")
      .select(columns)
      .in("id", chunk)
      .returns<T[]>();
    if (xErr) throw new Error(`loadParSkuUniverse shop pars: ${xErr.message}`);
    for (const r of data ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}
