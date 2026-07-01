/**
 * Admin cost/yield data layer (Item/Inventory Spine — R2). SERVER-ONLY,
 * service-role; authority re-checked per write. Composes R1's pure recipe-math
 * with prices from the append-only vendor_price_history ledger.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import type { MeasureUnitOption } from "@/lib/admin/skus";
import { loadMeasureUnits } from "@/lib/admin/skus";
import type { ComponentView } from "@/lib/admin/item-components";
import {
  skuContentOz,
  skuCostPerOz,
  itemPerUnitCost,
  foodCostPct,
  packYieldForComponent,
  componentPerUnitOz,
  type MeasureUnitFactor,
} from "@/lib/recipe-math";

export const COST_READ_MIN = 6;  // AGM+ — view cost/yield
export const PRICE_WRITE_MIN = 6; // AGM+ — record a SKU price (operational invoice logging)

export class AdminCostError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminCostError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new AdminCostError(403, "forbidden", "Insufficient role level for this action");
  }
}
function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** Current pack price per SKU = latest vendor_price_history row (effective_date desc, recorded_at desc). */
export async function loadCurrentSkuPrices(skuIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendor_price_history")
    .select("vendor_item_id, unit_price, effective_date, recorded_at")
    .in("vendor_item_id", skuIds)
    .order("effective_date", { ascending: false })
    .order("recorded_at", { ascending: false })
    .returns<Array<{ vendor_item_id: string; unit_price: number | string; effective_date: string; recorded_at: string | null }>>();
  if (error) throw new Error(`loadCurrentSkuPrices failed: ${error.message}`);
  for (const r of data ?? []) {
    if (!out.has(r.vendor_item_id)) {
      const p = num(r.unit_price);
      if (p != null) out.set(r.vendor_item_id, p);
    }
  }
  return out;
}

/** Recent prices for one SKU (for the panel's history list). */
export async function loadSkuPriceHistory(actor: AuthContext, skuId: string, limit = 5): Promise<Array<{ unitPrice: number; effectiveDate: string }>> {
  requireLevel(actor, COST_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendor_price_history")
    .select("unit_price, effective_date")
    .eq("vendor_item_id", skuId)
    .order("effective_date", { ascending: false })
    .limit(limit)
    .returns<Array<{ unit_price: number | string; effective_date: string }>>();
  if (error) throw new Error(`loadSkuPriceHistory failed: ${error.message}`);
  return (data ?? []).map((r) => ({ unitPrice: num(r.unit_price) ?? 0, effectiveDate: r.effective_date }));
}

/** cost/oz per SKU = current price ÷ content_oz (content_oz from SkuView inputs + measures). */
export function computeSkuCostPerOz(
  skus: Array<{ id: string; unitsPerPack: number | null; eachSize: number | null; eachMeasure: string | null; avgOzPerEach: number | null }>,
  prices: Map<string, number>,
  measures: MeasureUnitOption[],
): Map<string, number | null> {
  const m = new Map<string, MeasureUnitFactor>(measures.map((x) => [x.label, { dimension: x.dimension, toBaseFactor: x.toBaseFactor }]));
  const out = new Map<string, number | null>();
  for (const s of skus) {
    const content = skuContentOz({ unitsPerPack: s.unitsPerPack, eachSize: s.eachSize, eachMeasure: s.eachMeasure, avgOzPerEach: s.avgOzPerEach }, m);
    out.set(s.id, skuCostPerOz(prices.get(s.id) ?? null, content));
  }
  return out;
}

/**
 * Annotate components with perUnitCost + packYield, and compute per-item cost.
 * Memoized + visited-set guarded recursion over sub-items. Returns NEW
 * ComponentView[] (optional cost fields filled) + a per-item cost map.
 */
export function annotateComponentCosts(args: {
  components: ComponentView[];
  items: Array<{ itemId: string; batchYield: number; menuPrice: number | null }>;
  skuCostPerOzById: Map<string, number | null>;
  skuContentOzById: Map<string, number | null>;
  skuAvgOzById: Map<string, number | null>;
  measures: MeasureUnitOption[];
}): { components: ComponentView[]; itemCosts: Map<string, { perUnitCost: number | null; foodCostPct: number | null }> } {
  const m = new Map<string, MeasureUnitFactor>(args.measures.map((x) => [x.label, { dimension: x.dimension, toBaseFactor: x.toBaseFactor }]));
  const byItem = new Map<string, ComponentView[]>();
  for (const c of args.components) {
    const list = byItem.get(c.itemId) ?? [];
    list.push(c);
    byItem.set(c.itemId, list);
  }
  const itemMeta = new Map(args.items.map((i) => [i.itemId, i]));
  const memo = new Map<string, number | null>();
  const visiting = new Set<string>();

  const perUnitCostOf = (itemId: string): number | null => {
    const cached = memo.get(itemId);
    if (cached !== undefined) return cached;
    if (visiting.has(itemId)) return null; // defensive cycle guard
    visiting.add(itemId);
    const meta = itemMeta.get(itemId);
    const comps = byItem.get(itemId) ?? [];
    const cost = meta == null ? null : itemPerUnitCost(
      meta.batchYield,
      comps.map((c) => ({
        quantity: c.quantity,
        unit: c.unit,
        componentSkuId: c.componentSkuId,
        componentItemId: c.componentItemId,
        skuAvgOzPerEach: c.componentSkuId ? (args.skuAvgOzById.get(c.componentSkuId) ?? null) : null,
      })),
      m,
      args.skuCostPerOzById,
      perUnitCostOf,
    );
    visiting.delete(itemId);
    memo.set(itemId, cost);
    return cost;
  };

  const itemCosts = new Map<string, { perUnitCost: number | null; foodCostPct: number | null }>();
  for (const i of args.items) {
    const c = perUnitCostOf(i.itemId);
    itemCosts.set(i.itemId, { perUnitCost: c, foodCostPct: foodCostPct(c, i.menuPrice) });
  }

  const annotated = args.components.map((c) => {
    if (c.componentSkuId == null) return { ...c, perUnitCost: null, packYield: null };
    const batchYield = itemMeta.get(c.itemId)?.batchYield ?? 1;
    const costPerOz = args.skuCostPerOzById.get(c.componentSkuId) ?? null;
    const perUnitOz = componentPerUnitOz({ quantity: c.quantity, unit: c.unit, batchYield, skuAvgOzPerEach: args.skuAvgOzById.get(c.componentSkuId) ?? null }, m);
    const perUnitCost = costPerOz == null || perUnitOz == null ? null : perUnitOz * costPerOz;
    const packYield = packYieldForComponent(args.skuContentOzById.get(c.componentSkuId) ?? null, perUnitOz);
    return { ...c, perUnitCost, packYield };
  });

  return { components: annotated, itemCosts };
}

/** Transitive reverse: every item that uses `skuId` directly or through a sub-item. Names only. */
export async function loadSkuUsageMap(): Promise<Map<string, string[]>> {
  const sb = getServiceRoleClient();
  const { data: edges, error } = await sb
    .from("item_components")
    .select("item_id, component_sku_id, component_item_id")
    .returns<Array<{ item_id: string; component_sku_id: string | null; component_item_id: string | null }>>();
  if (error) throw new Error(`loadSkuUsageMap edges failed: ${error.message}`);
  const parentsOfItem = new Map<string, string[]>();
  const skuDirect = new Map<string, Set<string>>();
  for (const e of edges ?? []) {
    if (e.component_item_id) {
      const list = parentsOfItem.get(e.component_item_id) ?? [];
      list.push(e.item_id);
      parentsOfItem.set(e.component_item_id, list);
    }
    if (e.component_sku_id) {
      const set = skuDirect.get(e.component_sku_id) ?? new Set<string>();
      set.add(e.item_id);
      skuDirect.set(e.component_sku_id, set);
    }
  }
  const allItemIds = new Set<string>();
  for (const set of skuDirect.values()) for (const id of set) allItemIds.add(id);
  for (const list of parentsOfItem.values()) for (const id of list) allItemIds.add(id);
  for (const k of parentsOfItem.keys()) allItemIds.add(k);
  const itemIdsToNames = new Map<string, string>();
  if (allItemIds.size > 0) {
    const { data: items, error: iErr } = await sb.from("items").select("id, name").in("id", [...allItemIds]).returns<Array<{ id: string; name: string }>>();
    if (iErr) throw new Error(`loadSkuUsageMap names failed: ${iErr.message}`);
    for (const it of items ?? []) itemIdsToNames.set(it.id, it.name);
  }
  const out = new Map<string, string[]>();
  for (const [skuId, directParents] of skuDirect) {
    const reached = new Set<string>();
    const queue = [...directParents];
    while (queue.length) {
      const cur = queue.shift()!;
      if (reached.has(cur)) continue;
      reached.add(cur);
      for (const p of parentsOfItem.get(cur) ?? []) queue.push(p);
    }
    out.set(skuId, [...reached].map((id) => itemIdsToNames.get(id) ?? "(item)").sort());
  }
  return out;
}

/** Record a SKU price into the append-only ledger (AGM+). */
export async function recordSkuPrice(
  actor: AuthContext,
  args: { skuId: string; unitPrice: number; effectiveDate: string },
): Promise<{ id: string }> {
  requireLevel(actor, PRICE_WRITE_MIN);
  if (!Number.isFinite(args.unitPrice) || args.unitPrice <= 0) {
    throw new AdminCostError(400, "invalid_price", "Price must be a positive number");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.effectiveDate) || Number.isNaN(Date.parse(args.effectiveDate))) {
    throw new AdminCostError(400, "invalid_date", "Effective date must be YYYY-MM-DD");
  }
  const sb = getServiceRoleClient();
  const { data: sku, error: sErr } = await sb.from("vendor_items").select("id").eq("id", args.skuId).eq("active", true).maybeSingle<{ id: string }>();
  if (sErr) throw new Error(`recordSkuPrice sku check failed: ${sErr.message}`);
  if (!sku) throw new AdminCostError(400, "invalid_sku", "SKU not found or inactive");

  const { data: inserted, error } = await sb
    .from("vendor_price_history")
    .insert({ vendor_item_id: args.skuId, unit_price: args.unitPrice, effective_date: args.effectiveDate, recorded_by: actor.user.id })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`recordSkuPrice insert failed: ${error.message}`);
  if (!inserted) throw new Error("recordSkuPrice returned no row");

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "vendor_item.price_recorded", resourceTable: "vendor_price_history", resourceId: inserted.id,
    metadata: { vendor_item_id: args.skuId, unit_price: args.unitPrice, effective_date: args.effectiveDate },
    ipAddress: null, userAgent: null,
  });
  return { id: inserted.id };
}

export interface SkuReceivingLedger {
  receivedDollars: number;
  receivedOz: number;
  unpricedLineCount: number;
  missingOzLineCount: number;
  deliveries: Array<{ deliveryId: string; date: string; vendorName: string; qty: number; unitPrice: number | null }>;
}

/**
 * Per-SKU RECEIVED ledger (R3.5, AGM+): running $ + oz received to date + delivery
 * history. $ = Σ qty × (line price ?? current SKU price); oz = Σ qty × content_oz.
 * Lines missing a price / an oz basis are excluded and counted (honest under-count).
 * Received-to-date, NOT true on-hand (R4 = received − counted).
 */
export async function loadSkuReceivingLedger(actor: AuthContext, skuIds: string[]): Promise<Map<string, SkuReceivingLedger>> {
  requireLevel(actor, COST_READ_MIN);
  const out = new Map<string, SkuReceivingLedger>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();

  const { data: lineRows, error } = await sb
    .from("vendor_delivery_items")
    .select("vendor_item_id, delivery_id, qty_received, unit_price")
    .in("vendor_item_id", skuIds)
    .returns<Array<{ vendor_item_id: string; delivery_id: string; qty_received: number | string; unit_price: number | string | null }>>();
  if (error) throw new Error(`loadSkuReceivingLedger lines: ${error.message}`);
  const lines = lineRows ?? [];

  const prices = await loadCurrentSkuPrices(skuIds);
  const measures = await loadMeasureUnits(actor);
  const measuresMap = new Map<string, MeasureUnitFactor>(measures.map((m) => [m.label, { dimension: m.dimension, toBaseFactor: m.toBaseFactor }]));
  const { data: skuRows } = await sb.from("vendor_items").select("id, units_per_pack, each_size, each_measure, avg_oz_per_each").in("id", skuIds)
    .returns<Array<{ id: string; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  const contentOzById = new Map<string, number | null>(
    (skuRows ?? []).map((s) => [s.id, skuContentOz({ unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each) }, measuresMap)]),
  );

  const deliveryIds = [...new Set(lines.map((l) => l.delivery_id))];
  const delMeta = new Map<string, { date: string; vendorName: string }>();
  if (deliveryIds.length > 0) {
    const { data: dels } = await sb.from("vendor_deliveries").select("id, delivery_date, vendor_id").in("id", deliveryIds).returns<Array<{ id: string; delivery_date: string; vendor_id: string }>>();
    const vendorIds = [...new Set((dels ?? []).map((d) => d.vendor_id))];
    const { data: vends } = vendorIds.length ? await sb.from("vendors").select("id, name").in("id", vendorIds).returns<Array<{ id: string; name: string }>>() : { data: [] as Array<{ id: string; name: string }> };
    const vName = new Map((vends ?? []).map((v) => [v.id, v.name]));
    for (const d of dels ?? []) delMeta.set(d.id, { date: d.delivery_date, vendorName: vName.get(d.vendor_id) ?? "(vendor)" });
  }

  for (const id of skuIds) out.set(id, { receivedDollars: 0, receivedOz: 0, unpricedLineCount: 0, missingOzLineCount: 0, deliveries: [] });

  for (const l of lines) {
    const led = out.get(l.vendor_item_id);
    if (!led) continue;
    const qty = num(l.qty_received) ?? 0;
    const linePrice = num(l.unit_price) ?? prices.get(l.vendor_item_id) ?? null;
    if (linePrice == null) led.unpricedLineCount += 1;
    else led.receivedDollars += qty * linePrice;
    const contentOz = contentOzById.get(l.vendor_item_id) ?? null;
    if (contentOz == null) led.missingOzLineCount += 1;
    else led.receivedOz += qty * contentOz;
    const meta = delMeta.get(l.delivery_id);
    led.deliveries.push({ deliveryId: l.delivery_id, date: meta?.date ?? "", vendorName: meta?.vendorName ?? "(vendor)", qty, unitPrice: num(l.unit_price) });
  }
  for (const led of out.values()) led.deliveries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}
