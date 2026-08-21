/**
 * W4b catering SKU-demand — SERVER-ONLY, service-role. The SKU layer of the catering↔inventory
 * moat: flattens W4a's reserved prep-demand (items + subs) into the raw SKUs it consumes, aggregates
 * per (SKU, date) + a window rollup, and compares to computed on-hand for an advisory "order more"
 * signal. Advisory only (on-hand is received−used, not a count). DORMANT until catering recipes exist.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { PORTION_FRACTION, type Portion } from "@/lib/catering/pricing-derivation";
import { PREP_DEMAND_READ_MIN } from "@/lib/catering/prep-demand";
import { loadRecipeGraph, loadMeasures, loadSkuPackChains } from "@/lib/prep-consumption";
import { perUnitSkuOzForItemFromGraph, perUnitSkuOzForMenuItemFromGraph } from "@/lib/prep-consumption-graph";
import { loadInStockPacks } from "@/lib/production";
import { skuContentOz } from "@/lib/recipe-math";

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new Error("sku-demand: insufficient role level");
}
function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

export interface SkuDemandCell {
  needDate: string;
  oz: number;
}
export interface SkuDemandRow {
  skuId: string;
  skuName: string;
  contentOz: number | null; // null when pack fields incomplete → oz-only display
  byDate: SkuDemandCell[]; // per-date demand oz (the "when")
  totalOz: number; // window rollup demand (the "how much")
  totalPacks: number | null; // totalOz / contentOz
  onHandPacks: number; // computed on-hand (advisory, received − used)
  onHandOz: number | null; // onHandPacks × contentOz
  shortfallOz: number | null; // max(0, totalOz − onHandOz); null when contentOz unknown
  suggestOrderPacks: number | null; // ceil(shortfallOz / contentOz)
  short: boolean; // shortfallOz > 0
}
export interface CateringSkuDemand {
  rows: SkuDemandRow[];
  unresolvedChoiceLines: number; // choice slots — can't flatten (caption)
  noRecipeLines: number; // item/sub refs with no/incomplete recipe (caption)
}

/**
 * Flatten a location's reserved catering prep-demand (over [from,to]) into raw SKU demand, with an
 * advisory on-hand shortfall / order-more signal. Read-only, level ≥ PREP_DEMAND_READ_MIN.
 */
export async function loadCateringSkuDemand(
  actor: AuthContext,
  args: { locationId: string; from: string; to: string },
): Promise<CateringSkuDemand> {
  requireLevel(actor, PREP_DEMAND_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb
    .from("catering_prep_demand")
    .select("item_id, menu_item_id, choice_package_item_id, portion, qty, need_date")
    .eq("location_id", args.locationId)
    .eq("status", "reserved")
    .gte("need_date", args.from)
    .lte("need_date", args.to)
    .returns<Array<{ item_id: string | null; menu_item_id: string | null; choice_package_item_id: string | null; portion: Portion | null; qty: number | string; need_date: string }>>();
  if (error) throw new Error(`loadCateringSkuDemand: ${error.message}`);
  const demandRows = rows ?? [];

  // Flatten each line to SKU oz, memoized per distinct item/sub ref (the flatten is per-ref).
  const perUnitCache = new Map<string, Map<string, number>>();
  let recipeGraph: Awaited<ReturnType<typeof loadRecipeGraph>> | null = null; // "item:id" | "menu_item:id" -> {sku -> oz/unit}
  const skuOzByDate = new Map<string, Map<string, number>>(); // skuId -> (need_date -> oz)
  let unresolvedChoiceLines = 0;
  let noRecipeLines = 0;

  for (const r of demandRows) {
    if (r.choice_package_item_id) {
      unresolvedChoiceLines++;
      continue;
    }
    const isItem = r.item_id != null;
    const refId = (r.item_id ?? r.menu_item_id)!;
    const cacheKey = `${isItem ? "item" : "menu_item"}:${refId}`;
    let perUnit = perUnitCache.get(cacheKey);
    if (!perUnit) {
      // ONE graph load for the whole pass (see loadRecipeGraph); resolution is pure/in-memory.
      recipeGraph ??= await loadRecipeGraph({ locationId: args.locationId });
      perUnit = isItem ? perUnitSkuOzForItemFromGraph(recipeGraph, refId) : perUnitSkuOzForMenuItemFromGraph(recipeGraph, refId);
      perUnitCache.set(cacheKey, perUnit);
    }
    if (perUnit.size === 0) {
      noRecipeLines++;
      continue;
    }
    const qty = num(r.qty) ?? 0;
    const scale = qty * (r.portion ? PORTION_FRACTION[r.portion] : 1);
    if (scale <= 0) continue;
    for (const [sku, ozPerUnit] of perUnit) {
      const byDate = skuOzByDate.get(sku) ?? new Map<string, number>();
      byDate.set(r.need_date, (byDate.get(r.need_date) ?? 0) + ozPerUnit * scale);
      skuOzByDate.set(sku, byDate);
    }
  }

  const skuIds = [...skuOzByDate.keys()];
  if (skuIds.length === 0) return { rows: [], unresolvedChoiceLines, noRecipeLines };

  // Resolve SKU name + content-oz + on-hand. PR-C: pass the active pack CHAIN so
  // content-oz reflects the chain (chain-first in skuContentOz) — a newly-chained
  // SKU now feeds reorder without waiting on the legacy flat-field sync. ONE batch
  // chain load for all skuIds (loadRecipeGraph law — zero per-row queries).
  const [measures, chainsBySku] = await Promise.all([loadMeasures(), loadSkuPackChains(skuIds)]);
  const { data: skuRows } = await sb
    .from("vendor_items")
    .select("id, name, pack_format, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("id", skuIds)
    .returns<Array<{ id: string; name: string; pack_format: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  const skuMeta = new Map<string, { name: string; contentOz: number | null }>();
  for (const s of skuRows ?? []) {
    const contentOz = skuContentOz(
      {
        unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure,
        avgOzPerEach: num(s.avg_oz_per_each), packChain: chainsBySku.get(s.id) ?? null,
      },
      measures,
    );
    skuMeta.set(s.id, { name: s.name, contentOz });
  }
  const onHand = await loadInStockPacks(skuIds, args.locationId); // packs (advisory)

  const out: SkuDemandRow[] = [];
  for (const [skuId, byDateMap] of skuOzByDate) {
    const meta = skuMeta.get(skuId);
    const skuName = meta?.name ?? "SKU";
    const contentOz = meta?.contentOz ?? null;
    const byDate: SkuDemandCell[] = [...byDateMap.entries()]
      .map(([needDate, oz]) => ({ needDate, oz }))
      .sort((a, b) => a.needDate.localeCompare(b.needDate));
    const totalOz = byDate.reduce((s, c) => s + c.oz, 0);
    const onHandPacks = onHand.get(skuId) ?? 0;
    const hasContent = contentOz != null && contentOz > 0;
    const totalPacks = hasContent ? totalOz / contentOz! : null;
    const onHandOz = hasContent ? onHandPacks * contentOz! : null;
    const shortfallOz = onHandOz != null ? Math.max(0, totalOz - onHandOz) : null;
    const suggestOrderPacks = shortfallOz != null && shortfallOz > 0 && hasContent ? Math.ceil(shortfallOz / contentOz!) : null;
    out.push({
      skuId,
      skuName,
      contentOz,
      byDate,
      totalOz,
      totalPacks,
      onHandPacks,
      onHandOz,
      shortfallOz,
      suggestOrderPacks,
      short: shortfallOz != null && shortfallOz > 0,
    });
  }
  out.sort((a, b) => a.skuName.localeCompare(b.skuName));
  return { rows: out, unresolvedChoiceLines, noRecipeLines };
}
