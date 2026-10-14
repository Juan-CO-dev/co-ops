/**
 * B9 (2026-10-14) — the Counts page's RENDER-SCOPED reference reads.
 *
 * One page render used to read the same reference data three times over: the active SKU
 * roster (the count sheet, the par tier, the inferred tier), the measure registry and pack
 * chains (the sheet, the count rows, the product index), the vendor list, and — twice —
 * the product index and its receipt lots (the sheet's product rows, then the on-hand
 * product rollup). This object reads each ONCE per render and hands the same answer to
 * every consumer. Created per request by the page (never module-level, never across
 * requests: it holds the render's view of the data and nothing else).
 *
 * PRODUCT IDENTITY LAW (AGENTS.md "resolution happens once"): the sheet and the rollup
 * now read ONE product index — one resolution per product per render, never a second
 * opinion. Each product's index entry and lots depend only on that product's own rows,
 * so a consumer asking for a subset gets exactly what a read of that subset returns.
 *
 * Every memoized promise carries a no-op rejection handler so a read that fails before
 * anyone awaits it can never surface as an unhandled rejection; the consumer that awaits
 * it still sees the error.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadAllSkuPackChains, loadMeasures } from "@/lib/prep-consumption";
import { loadProductIndex, loadProductLots, type ProductIndexLoad, type ProductLotLoad } from "@/lib/products";
import type { MeasureUnitFactor } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";

export interface RosterSku { id: string; name: string; pack_format: string | null; vendor_id: string | null; product_id: string | null }
export interface VendorRef { id: string; name: string; source_kind: "vendor" | "store"; active: boolean }

export interface CountsReadRefs {
  /** Active vendor_items, ordered by name (the count sheet's order). Throws on failure. */
  roster(): Promise<RosterSku[]>;
  /** Every vendor (a small table), by id. Throws on failure — label readers catch. */
  vendors(): Promise<Map<string, VendorRef>>;
  measures(): Promise<Map<string, MeasureUnitFactor>>;
  /** Active pack-chain levels for these SKUs — what loadSkuPackChains(ids) returns. */
  packChains(skuIds: readonly string[]): Promise<Map<string, PackChainLevel[]>>;
  /** loadProductIndex(productIds, locationId), shared: one read per product per render. */
  productIndex(productIds: readonly string[], locationId: string): Promise<ProductIndexLoad>;
  /** loadProductLots(locationId, members), shared per product. */
  productLots(locationId: string, memberSkuIdsByProduct: ReadonlyMap<string, ReadonlyArray<string>>): Promise<ProductLotLoad>;
}

function quiet<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  return p;
}
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= quiet(load()));
}

export function createCountsReadRefs(): CountsReadRefs {
  const roster = once(async () => {
    const sb = getServiceRoleClient();
    // The sheet's own order (name) — the par and inferred tiers filter the same rows. PAGED
    // (B9 r1): every tier now stands on this one read, so past 1000 active SKUs a truncated
    // page would decide WHICH SKUs exist for all of them; `id` breaks name ties so the order
    // is total and page boundaries are stable.
    return selectAllRows<RosterSku>(async (from, to) => {
      const { data, error } = await sb.from("vendor_items").select("id, name, pack_format, vendor_id, product_id").eq("active", true)
        .order("name", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<RosterSku[]>();
      if (error) throw new Error(`counts roster (active SKUs): ${error.message}`);
      return { data };
    });
  });
  const vendors = once(async () => {
    const sb = getServiceRoleClient();
    const rows = await selectAllRows<VendorRef>(async (from, to) => {
      const { data, error } = await sb.from("vendors").select("id, name, source_kind, active")
        .order("id", { ascending: true }).range(from, to).returns<VendorRef[]>();
      if (error) throw new Error(`counts vendors: ${error.message}`);
      return { data };
    });
    return new Map(rows.map((v) => [v.id, v]));
  });
  const measures = once(() => loadMeasures());
  const allChains = once(() => loadAllSkuPackChains());
  const packChains = async (skuIds: readonly string[]) => {
    const all = await allChains();
    const out = new Map<string, PackChainLevel[]>();
    for (const id of skuIds) { const levels = all.get(id); if (levels) out.set(id, levels); }
    return out;
  };
  const shared = {
    vendors: async (ids: string[]) => {
      const byId = await vendors();
      return ids.flatMap((id) => { const v = byId.get(id); return v ? [v] : []; });
    },
    measures,
    packChains: (ids: string[]) => packChains(ids),
  };

  // Product index: one load per product id per location; a request is the merge of the
  // loads that cover it, narrowed back to exactly the ids asked for.
  const indexLoads = new Map<string, Map<string, Promise<ProductIndexLoad>>>();
  const productIndex = async (productIds: readonly string[], locationId: string): Promise<ProductIndexLoad> => {
    const ids = [...new Set(productIds.filter(Boolean))];
    let byId = indexLoads.get(locationId);
    if (!byId) { byId = new Map(); indexLoads.set(locationId, byId); }
    const missing = ids.filter((id) => !byId!.has(id));
    if (missing.length > 0) {
      const p = quiet(loadProductIndex(missing, locationId, shared));
      for (const id of missing) byId.set(id, p);
    }
    const loads = await Promise.all([...new Set(ids.map((id) => byId!.get(id)!))]);
    const wanted = new Set(ids);
    type Res = ProductIndexLoad["index"]["resolution"] extends ReadonlyMap<string, infer V> ? V : never;
    type Basis = ProductIndexLoad["index"]["basis"] extends ReadonlyMap<string, infer V> ? V : never;
    const resolution = new Map<string, Res>();
    const basis = new Map<string, Basis>();
    const out: ProductIndexLoad = { index: { resolution, basis }, byProduct: new Map(), productBySku: new Map() };
    for (const load of loads) {
      for (const [id, entry] of load.byProduct) if (wanted.has(id)) out.byProduct.set(id, entry);
      for (const [id, res] of load.index.resolution) if (wanted.has(id)) resolution.set(id, res);
      for (const [id, b] of load.index.basis) if (wanted.has(id)) basis.set(id, b);
      for (const [sku, id] of load.productBySku) if (wanted.has(id)) out.productBySku.set(sku, id);
    }
    return out;
  };

  // Lots: one load per product (keyed with its member list — the same index answers both
  // consumers, so the lists agree; a different list is simply a different key).
  const lotLoads = new Map<string, Promise<ProductLotLoad>>();
  const lotKey = (locationId: string, productId: string, members: ReadonlyArray<string>) => `${locationId}|${productId}|${members.join(",")}`;
  const productLots = async (locationId: string, memberSkuIdsByProduct: ReadonlyMap<string, ReadonlyArray<string>>): Promise<ProductLotLoad> => {
    const missing = new Map<string, ReadonlyArray<string>>();
    for (const [productId, members] of memberSkuIdsByProduct) if (!lotLoads.has(lotKey(locationId, productId, members))) missing.set(productId, members);
    if (missing.size > 0) {
      const p = quiet(loadProductLots(locationId, missing));
      for (const [productId, members] of missing) lotLoads.set(lotKey(locationId, productId, members), p);
    }
    const out: ProductLotLoad = { lotsByProduct: new Map(), nullOzLotCountByProduct: new Map() };
    for (const [productId, members] of memberSkuIdsByProduct) {
      const load = await lotLoads.get(lotKey(locationId, productId, members))!;
      const lots = load.lotsByProduct.get(productId);
      if (lots) out.lotsByProduct.set(productId, lots);
      const nulls = load.nullOzLotCountByProduct.get(productId);
      if (nulls != null) out.nullOzLotCountByProduct.set(productId, nulls);
    }
    return out;
  };

  return { roster, vendors, measures, packChains, productIndex, productLots };
}
