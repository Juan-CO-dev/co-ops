import "server-only";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { lockLocationContext } from "@/lib/locations";
import { isShopId } from "@/lib/shop-context-shared";
import { canDoOperationalTask } from "@/lib/operational-task-access";
import { loadPackAwareOverlay, loadWalkerData, OrderingError } from "@/lib/ordering";
import { loadMeasures } from "@/lib/prep-consumption";
import { orderUnitLabel, perOrderUnitOz } from "@/lib/order-unit-shared";
import { resolveActive } from "@/lib/location-sku-shared";
import { loadProductIndex } from "@/lib/products";
import { guideKeysFor } from "@/lib/order-guides";
import { canViewPars, filterPars, parSlots, type ParsRow, type ParsView } from "./pars-shared";

interface SkuRow {
  id: string; name: string; vendor_id: string | null; location_id: string | null;
  active: boolean; product_id: string | null;
  weekday_par: number | string | null; weekend_par: number | string | null;
  pack_format: string | null; each_container_label: string | null;
  units_per_pack: number | null; each_size: number | string | null;
  each_measure: string | null; avg_oz_per_each: number | string | null;
}
const numeric = (v: number | string | null): number | null => v == null || !Number.isFinite(Number(v)) ? null : Number(v);

/** The catalog includes un-parred SKUs too. Bound guide id lists below the GET URL and
 * response row caps; each batch still uses the guide's one canonical key loader. */
async function loadGuides(ids: string[]) {
  const guides: Awaited<ReturnType<typeof guideKeysFor>> = new Map();
  for (let start = 0; start < ids.length; start += 100) {
    for (const [id, key] of await guideKeysFor(ids.slice(start, start + 100))) guides.set(id, key);
  }
  return guides;
}

/** Same operational shop bind as ordering (level 6 is membership-bound in either catalog rule).
 * Refuse roles and foreign shops BEFORE any I/O. The task gate stays inside the loader.
 * Suggestions and silence come from the FINAL walk: retirement, dedupe and backup routing
 * have already run. No second suggestion universe and no per-row database reads.
 */
export async function loadPars(actor: AuthContext, locationId: string): Promise<ParsView> {
  if (!canViewPars(actor.user.role)) throw new OrderingError(403, "forbidden");
  if (!isShopId(locationId) || !lockLocationContext({ role: actor.user.role, locations: actor.locations }, locationId)) throw new OrderingError(404, "not_found");
  if (!(await canDoOperationalTask(actor, locationId, "ordering"))) throw new OrderingError(403, "forbidden");
  const sb = getServiceRoleClient();
  const [skus, vendors, walk] = await Promise.all([
    selectAllRows<SkuRow>(async (from, to) => {
      const { data, error } = await sb.from("vendor_items")
        .select("id, name, vendor_id, location_id, active, product_id, weekday_par, weekend_par, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
        .or(`location_id.is.null,location_id.eq.${locationId}`).order("id").range(from, to).returns<SkuRow[]>();
      if (error) throw new Error(`loadPars skus: ${error.message}`);
      return { data };
    }),
    selectAllRows<{ id: string; name: string }>(async (from, to) => {
      const { data, error } = await sb.from("vendors").select("id, name").eq("active", true).eq("source_kind", "vendor")
        .order("id").range(from, to).returns<Array<{ id: string; name: string }>>();
      if (error) throw new Error(`loadPars vendors: ${error.message}`);
      return { data };
    }),
    loadWalkerData(actor, locationId),
  ]);
  const owned = skus.filter((s) => s.location_id == null || s.location_id === locationId);
  const ids = owned.map((s) => s.id);
  const [packs, measures, guides, products] = await Promise.all([
    loadPackAwareOverlay(sb, locationId, ids), loadMeasures(), loadGuides(ids),
    loadProductIndex([...new Set(owned.flatMap((s) => s.product_id ? [s.product_id] : []))], locationId),
  ]);
  const vendorNames = new Map(vendors.map((v) => [v.id, v.name]));
  const walkRows = new Map(walk.vendors.flatMap((v) => v.skus.map((s) => [s.skuId, s] as const)));
  const names = new Map(skus.map((s) => [s.id, s.name]));
  const rows: ParsRow[] = [];
  for (const s of owned) {
    const overlay = packs.overlayBySku.get(s.id) ?? null;
    if (!s.vendor_id || !vendorNames.has(s.vendor_id) || !resolveActive(overlay?.activeOverride, s.active)) continue;
    if (s.product_id && products.byProduct.get(s.product_id)?.resolution.reason === "retired_product") continue;
    const chain = packs.chainsBySku.get(s.id) ?? null;
    const oz = perOrderUnitOz({ packFormat: s.pack_format, eachContainerLabel: s.each_container_label,
      unitsPerPack: s.units_per_pack, eachSize: numeric(s.each_size), eachMeasure: s.each_measure,
      avgOzPerEach: numeric(s.avg_oz_per_each), packChain: chain }, chain, measures);
    const walked = walkRows.get(s.id);
    rows.push({ skuId: s.id, name: s.name, vendorId: s.vendor_id, vendorName: vendorNames.get(s.vendor_id)!,
      unit: orderUnitLabel(s.pack_format, chain), position: guides.get(s.id)?.position ?? null, section: guides.get(s.id)?.section ?? null,
      ...parSlots(overlay, { weekdayPar: numeric(s.weekday_par), weekendPar: numeric(s.weekend_par) }, oz),
      suggestion: walked?.parSuggestion && !walked.parSuggestion.slotCreation ? { ...walked.parSuggestion, canAct: false } : null,
      reroutedFromName: walked?.reroutedFromSkuId ? names.get(walked.reroutedFromSkuId) ?? walked.reroutedFromSkuId : null,
    });
  }
  return { rows: filterPars(rows, "", ""), silence: walk.parSilence };
}
