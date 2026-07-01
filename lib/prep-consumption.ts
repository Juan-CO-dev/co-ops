/**
 * Prep-consumption engine (Item/Inventory Spine — production-in-prep fold). SERVER-ONLY,
 * service-role. Recursively flattens an item's item_components recipe to leaf-SKU oz consumed
 * per par-unit, mirroring lib/recipe-math.ts itemPerUnitOz's per-batch ÷ batch_yield semantics —
 * but ACCUMULATING PER LEAF SKU instead of summing. Returns oz-per-output-unit; callers scale.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ozFromMeasure, type MeasureUnitFactor } from "@/lib/recipe-math";

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

interface ItemNode { batchYield: number | null; components: Array<{ quantity: number; unit: string | null; componentSkuId: string | null; componentItemId: string | null }>; }

async function loadMeasures(): Promise<Map<string, MeasureUnitFactor>> {
  const sb = getServiceRoleClient();
  const { data } = await sb.from("measure_units").select("label, dimension, to_base_factor").eq("active", true).returns<Array<{ label: string; dimension: "weight" | "volume" | "count"; to_base_factor: number | string }>>();
  return new Map((data ?? []).map((m) => [m.label, { dimension: m.dimension, toBaseFactor: num(m.to_base_factor) ?? 0 }]));
}

async function loadSkuAvg(skuIds: string[]): Promise<Map<string, number | null>> {
  if (skuIds.length === 0) return new Map();
  const sb = getServiceRoleClient();
  const { data } = await sb.from("vendor_items").select("id, avg_oz_per_each").in("id", skuIds).returns<Array<{ id: string; avg_oz_per_each: number | string | null }>>();
  return new Map((data ?? []).map((s) => [s.id, num(s.avg_oz_per_each)]));
}

export async function perUnitSkuOzForItem(itemId: string): Promise<Map<string, number>> {
  const sb = getServiceRoleClient();
  const measures = await loadMeasures();
  const nodeCache = new Map<string, ItemNode | null>();

  async function loadNode(id: string): Promise<ItemNode | null> {
    if (nodeCache.has(id)) return nodeCache.get(id) ?? null;
    const { data: item } = await sb.from("items").select("batch_yield").eq("id", id).maybeSingle<{ batch_yield: number | string | null }>();
    const { data: comps } = await sb.from("item_components").select("quantity, unit, component_sku_id, component_item_id").eq("item_id", id).returns<Array<{ quantity: number | string; unit: string | null; component_sku_id: string | null; component_item_id: string | null }>>();
    const node: ItemNode = {
      batchYield: item ? num(item.batch_yield) : null,
      components: (comps ?? []).map((c) => ({ quantity: num(c.quantity) ?? 0, unit: c.unit, componentSkuId: c.component_sku_id, componentItemId: c.component_item_id })),
    };
    nodeCache.set(id, node);
    return node;
  }

  const skuIds = new Set<string>();
  async function collectSkus(id: string, seen: Set<string>): Promise<void> {
    if (seen.has(id)) return;
    seen.add(id);
    const node = await loadNode(id);
    if (!node) return;
    for (const c of node.components) {
      if (c.componentSkuId) skuIds.add(c.componentSkuId);
      else if (c.componentItemId) await collectSkus(c.componentItemId, seen);
    }
  }
  await collectSkus(itemId, new Set());
  const skuAvg = await loadSkuAvg([...skuIds]);

  function recurse(id: string, visiting: Set<string>): Map<string, number> | null {
    if (visiting.has(id)) return null;
    const node = nodeCache.get(id) ?? null;
    if (!node || node.batchYield == null || node.batchYield <= 0) return null;
    const out = new Map<string, number>();
    const nextVisiting = new Set(visiting).add(id);
    for (const c of node.components) {
      if (c.componentSkuId != null) {
        const oz = ozFromMeasure(c.quantity, c.unit, measures, skuAvg.get(c.componentSkuId) ?? null);
        if (oz == null) return null;
        out.set(c.componentSkuId, (out.get(c.componentSkuId) ?? 0) + oz / node.batchYield);
      } else if (c.componentItemId != null) {
        const subMap = recurse(c.componentItemId, nextVisiting);
        if (subMap == null) return null;
        const scale = c.quantity / node.batchYield;
        for (const [sku, oz] of subMap) out.set(sku, (out.get(sku) ?? 0) + oz * scale);
      } else {
        return null;
      }
    }
    return out;
  }

  return recurse(itemId, new Set()) ?? new Map();
}

export async function skuConsumptionForItem(itemId: string, outputQty: number): Promise<Map<string, number>> {
  if (!Number.isFinite(outputQty) || outputQty <= 0) return new Map();
  const perUnit = await perUnitSkuOzForItem(itemId);
  const out = new Map<string, number>();
  for (const [sku, oz] of perUnit) out.set(sku, oz * outputQty);
  return out;
}
