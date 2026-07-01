/**
 * Prep-consumption engine (Item/Inventory Spine — production-in-prep fold). SERVER-ONLY,
 * service-role. Recursively flattens an item's item_components recipe to leaf-SKU oz consumed
 * per par-unit, mirroring lib/recipe-math.ts itemPerUnitOz's per-batch ÷ batch_yield semantics —
 * but ACCUMULATING PER LEAF SKU instead of summing. Returns oz-per-output-unit; callers scale.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ozFromMeasure, skuContentOz, type MeasureUnitFactor } from "@/lib/recipe-math";
import { audit } from "@/lib/audit";
import type { RoleCode } from "@/lib/roles";

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

/** One leaf SKU's derived (per-one-output-unit) consumption, hydrated for the panel UI. */
export interface DerivedSku { skuId: string; skuName: string; perUnitOz: number; unitsPerPack: number | null; contentOz: number | null; }
/** A confirmed/edited consumption line coming back from the panel. */
export interface ConfirmedInput { skuId: string; qtyOz: number; qtyEntered: number | null; unitEntered: string | null; derivedOz: number | null; }
export interface RecordFromPrepInput {
  locationId: string; instanceId: string; templateItemId: string;
  outputItemId: string; outputQty: number;
  confirmedConsumption: ConfirmedInput[];
  source: "opening_p2" | "mid_day_p2";
}

/**
 * Per convertible item, the hydrated per-one-output-unit leaf-SKU consumption (for the
 * panel's live-scaled "Uses:" summary + editable rows). Items whose recipe is incomplete
 * (empty perUnitSkuOzForItem) map to [] = non-convertible (no panel). Batches the SKU
 * name/pack loads across all items.
 */
export async function loadDerivedForItems(itemIds: string[]): Promise<Map<string, DerivedSku[]>> {
  const out = new Map<string, DerivedSku[]>();
  const uniq = [...new Set(itemIds.filter(Boolean))];
  if (uniq.length === 0) return out;
  const sb = getServiceRoleClient();
  const perItem = new Map<string, Map<string, number>>();
  const allSkuIds = new Set<string>();
  for (const id of uniq) {
    const m = await perUnitSkuOzForItem(id);
    perItem.set(id, m);
    for (const sku of m.keys()) allSkuIds.add(sku);
  }
  const measures = await (async () => {
    const { data } = await sb.from("measure_units").select("label, dimension, to_base_factor").eq("active", true).returns<Array<{ label: string; dimension: "weight" | "volume" | "count"; to_base_factor: number | string }>>();
    return new Map<string, MeasureUnitFactor>((data ?? []).map((m) => [m.label, { dimension: m.dimension, toBaseFactor: num(m.to_base_factor) ?? 0 }]));
  })();
  const skuInfo = new Map<string, { name: string; unitsPerPack: number | null; contentOz: number | null }>();
  if (allSkuIds.size > 0) {
    const { data: skus } = await sb.from("vendor_items").select("id, name, units_per_pack, each_size, each_measure, avg_oz_per_each").in("id", [...allSkuIds])
      .returns<Array<{ id: string; name: string; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
    for (const s of skus ?? []) {
      const contentOz = skuContentOz({ unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each) }, measures);
      skuInfo.set(s.id, { name: s.name, unitsPerPack: s.units_per_pack, contentOz });
    }
  }
  for (const id of uniq) {
    const m = perItem.get(id) ?? new Map();
    const list: DerivedSku[] = [];
    for (const [skuId, perUnitOz] of m) {
      const info = skuInfo.get(skuId);
      list.push({ skuId, skuName: info?.name ?? "(sku)", perUnitOz, unitsPerPack: info?.unitsPerPack ?? null, contentOz: info?.contentOz ?? null });
    }
    out.set(id, list);
  }
  return out;
}

/**
 * Record a prep conversion idempotently, keyed by (instanceId, templateItemId):
 * supersede any live production header for that key, then insert a fresh header +
 * one production_inputs line per confirmed SKU. Empty confirmedConsumption still
 * supersedes the prior (a corrected prep with no convertible inputs clears the old
 * depletion) and inserts nothing. Authorization is the CALLER's (the prep-save gate) —
 * this helper does NOT re-gate role.
 */
export async function recordProductionFromPrep(actor: { userId: string; role: RoleCode }, input: RecordFromPrepInput): Promise<{ productionId: string | null }> {
  const sb = getServiceRoleClient();
  await sb.from("productions").update({ superseded_at: new Date().toISOString() })
    .eq("instance_id", input.instanceId).eq("template_item_id", input.templateItemId)
    .is("superseded_at", null).is("revoked_at", null);
  const positive = input.confirmedConsumption.filter((c) => Number.isFinite(c.qtyOz) && c.qtyOz > 0);
  if (positive.length === 0) return { productionId: null };
  const { data: hdr, error: hErr } = await sb.from("productions").insert({
    location_id: input.locationId, output_item_id: input.outputItemId, output_qty: input.outputQty,
    source: input.source, instance_id: input.instanceId, template_item_id: input.templateItemId, created_by: actor.userId,
  }).select("id").maybeSingle<{ id: string }>();
  if (hErr) throw new Error(`recordProductionFromPrep header: ${hErr.message}`);
  if (!hdr) throw new Error("recordProductionFromPrep header returned no row");
  const { error: lErr } = await sb.from("production_inputs").insert(positive.map((c) => ({
    production_id: hdr.id, input_sku_id: c.skuId, input_oz: c.qtyOz,
    qty_entered: c.qtyEntered, unit_entered: c.unitEntered, derived_oz: c.derivedOz,
  })));
  if (lErr) throw new Error(`recordProductionFromPrep lines: ${lErr.message}`);
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "production.recorded", resourceTable: "productions", resourceId: hdr.id, metadata: { source: input.source, instance_id: input.instanceId, template_item_id: input.templateItemId, output_item_id: input.outputItemId, output_qty: input.outputQty, sku_count: positive.length }, ipAddress: null, userAgent: null });
  return { productionId: hdr.id };
}

/** Reverse (revoke) the live production for a prep (instance, template_item). No-op if none live. */
export async function reverseProductionForPrep(actor: { userId: string; role: RoleCode }, args: { instanceId: string; templateItemId: string }): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: live } = await sb.from("productions").select("id").eq("instance_id", args.instanceId).eq("template_item_id", args.templateItemId).is("superseded_at", null).is("revoked_at", null).maybeSingle<{ id: string }>();
  if (!live) return;
  await sb.from("productions").update({ revoked_at: new Date().toISOString() }).eq("id", live.id);
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "production.revoked", resourceTable: "productions", resourceId: live.id, metadata: { instance_id: args.instanceId, template_item_id: args.templateItemId }, ipAddress: null, userAgent: null });
}
