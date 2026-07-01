/**
 * Operational production-capture data layer (Item/Inventory Spine — S1, reshaped to
 * the header + production_inputs lines model, migration 0102). SERVER-ONLY,
 * service-role; app-layer KH+ (≥4) gate + location-bind IDOR (mirrors lib/receiving.ts).
 * Records SKU→item conversions: a `productions` header credits the item; one
 * `production_inputs` line per consumed SKU depletes it (consumption signal) and
 * feeds the running-average yield prediction. The standalone form still sends a
 * single input+output, so recordProduction writes exactly one input line.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { skuContentOz, type MeasureUnitFactor } from "@/lib/recipe-math";
import type { MeasureDimension } from "@/lib/recipe-math";

export const PRODUCE_MIN = 4; // key_holder+

export class ProductionError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "ProductionError";
  }
}
function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function requireProduce(actor: AuthContext): void {
  if (getRoleLevel(actor.user.role) < PRODUCE_MIN) throw new ProductionError(403, "forbidden", "Insufficient role level to log production");
}
function actorLoc(actor: AuthContext): LocationActor { return { role: actor.user.role, locations: actor.locations }; }

/**
 * Load the active measure-unit registry as a label→factor map, directly via
 * service-role. NOT via lib/admin/skus.loadMeasureUnits, which gates at AGM+ (≥6);
 * recordProduction runs at KH+ (≥4), so the gated helper would throw for a
 * key-holder. Same select shape as loadMeasureUnits.
 */
async function loadMeasuresMap(): Promise<Map<string, MeasureUnitFactor>> {
  const sb = getServiceRoleClient();
  const { data } = await sb
    .from("measure_units")
    .select("label, dimension, to_base_factor")
    .eq("active", true)
    .returns<Array<{ label: string; dimension: MeasureDimension; to_base_factor: number | string }>>();
  return new Map<string, MeasureUnitFactor>((data ?? []).map((m) => [m.label, { dimension: m.dimension, toBaseFactor: Number(m.to_base_factor) }]));
}

/** content_oz (oz per pack) for one SKU, or null if not configured. */
async function skuContentOzById(skuId: string): Promise<number | null> {
  const sb = getServiceRoleClient();
  const { data: sku } = await sb.from("vendor_items").select("units_per_pack, each_size, each_measure, avg_oz_per_each").eq("id", skuId)
    .maybeSingle<{ units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>();
  if (!sku) return null;
  const measures = await loadMeasuresMap();
  return skuContentOz({ unitsPerPack: sku.units_per_pack, eachSize: num(sku.each_size), eachMeasure: sku.each_measure, avgOzPerEach: num(sku.avg_oz_per_each) }, measures);
}

export interface RecordProductionInput {
  locationId: string;
  inputSkuId: string;
  inputQty: number;
  outputItemId: string;
  outputQty: number;
  notes?: string | null;
}
export interface ProductionFormData {
  skus: Array<{ id: string; name: string; inStockPacks: number }>;
  /** SKU id → the items makeable from it (direct item_components reverse edge). */
  skuToItems: Record<string, Array<{ itemId: string; name: string }>>;
}
export interface ProductionView {
  id: string;
  producedAt: string;
  skuName: string;
  itemName: string;
  inputQty: number;
  outputQty: number;
}

/** Items makeable from each SKU = item_components rows with component_sku_id set. */
async function loadSkuToItems(skuIds: string[]): Promise<Record<string, Array<{ itemId: string; name: string }>>> {
  const out: Record<string, Array<{ itemId: string; name: string }>> = {};
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data: edges } = await sb.from("item_components").select("item_id, component_sku_id").in("component_sku_id", skuIds).not("component_sku_id", "is", null)
    .returns<Array<{ item_id: string; component_sku_id: string }>>();
  const itemIds = [...new Set((edges ?? []).map((e) => e.item_id))];
  const nameById = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: items } = await sb.from("items").select("id, name").in("id", itemIds).eq("active", true).returns<Array<{ id: string; name: string }>>();
    for (const it of items ?? []) nameById.set(it.id, it.name);
  }
  for (const e of edges ?? []) {
    const name = nameById.get(e.item_id);
    if (!name) continue; // inactive item
    const list = out[e.component_sku_id] ?? (out[e.component_sku_id] = []);
    if (!list.some((x) => x.itemId === e.item_id)) list.push({ itemId: e.item_id, name });
  }
  return out;
}

/** received packs − consumed packs, per SKU (for the form's in-stock hint). Consumed = Σ qty_entered over LIVE headers only. */
async function loadInStockPacks(skuIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data: recv } = await sb.from("vendor_delivery_items").select("vendor_item_id, qty_received").in("vendor_item_id", skuIds).returns<Array<{ vendor_item_id: string; qty_received: number | string }>>();
  const { data: liveHdr } = await sb.from("productions").select("id").is("superseded_at", null).is("revoked_at", null).returns<Array<{ id: string }>>();
  const liveIds = new Set((liveHdr ?? []).map((h) => h.id));
  const { data: lines } = await sb.from("production_inputs").select("production_id, input_sku_id, qty_entered").in("input_sku_id", skuIds).returns<Array<{ production_id: string; input_sku_id: string; qty_entered: number | string | null }>>();
  for (const id of skuIds) out.set(id, 0);
  for (const r of recv ?? []) out.set(r.vendor_item_id, (out.get(r.vendor_item_id) ?? 0) + (num(r.qty_received) ?? 0));
  for (const l of lines ?? []) {
    if (!liveIds.has(l.production_id)) continue;
    out.set(l.input_sku_id, (out.get(l.input_sku_id) ?? 0) - (num(l.qty_entered) ?? 0));
  }
  return out;
}

export async function loadProductionFormData(actor: AuthContext, locationId: string): Promise<ProductionFormData> {
  requireProduce(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ProductionError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: skus, error } = await sb.from("vendor_items").select("id, name").eq("active", true).order("name", { ascending: true }).returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`loadProductionFormData skus: ${error.message}`);
  const ids = (skus ?? []).map((s) => s.id);
  const [skuToItems, inStock] = await Promise.all([loadSkuToItems(ids), loadInStockPacks(ids)]);
  return {
    skus: (skus ?? []).map((s) => ({ id: s.id, name: s.name, inStockPacks: inStock.get(s.id) ?? 0 })),
    skuToItems,
  };
}

/** Advisory: predicted output for a (sku→item) pair at inputQty = inputQty × mean(output/input) over past productions; null if none. */
export async function predictOutput(actor: AuthContext, args: { inputSkuId: string; outputItemId: string; inputQty: number }): Promise<{ predicted: number | null }> {
  requireProduce(actor);
  if (!Number.isFinite(args.inputQty) || args.inputQty <= 0) return { predicted: null };
  const sb = getServiceRoleClient();
  // Live headers producing this item, each with its input line(s) for this SKU.
  const { data: hdrs } = await sb.from("productions").select("id, output_qty").eq("output_item_id", args.outputItemId).is("superseded_at", null).is("revoked_at", null)
    .returns<Array<{ id: string; output_qty: number | string }>>();
  const hdrList = hdrs ?? [];
  if (hdrList.length === 0) return { predicted: null };
  const outputById = new Map(hdrList.map((h) => [h.id, num(h.output_qty) ?? 0]));
  const { data: lines } = await sb.from("production_inputs").select("production_id, qty_entered").eq("input_sku_id", args.inputSkuId).in("production_id", [...outputById.keys()])
    .returns<Array<{ production_id: string; qty_entered: number | string | null }>>();
  // Sum this SKU's input qty per header, pair with that header's output.
  const inByHdr = new Map<string, number>();
  for (const l of lines ?? []) inByHdr.set(l.production_id, (inByHdr.get(l.production_id) ?? 0) + (num(l.qty_entered) ?? 0));
  const ratios: number[] = [];
  for (const [hid, i] of inByHdr) { const o = outputById.get(hid) ?? 0; if (i > 0) ratios.push(o / i); }
  if (ratios.length === 0) return { predicted: null };
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return { predicted: args.inputQty * mean };
}

export async function recordProduction(actor: AuthContext, input: RecordProductionInput): Promise<{ productionId: string }> {
  requireProduce(actor);
  if (!lockLocationContext(actorLoc(actor), input.locationId)) throw new ProductionError(404, "not_found", "Location not found");
  if (!Number.isFinite(input.inputQty) || input.inputQty <= 0) throw new ProductionError(400, "invalid_input_qty", "Input qty must be positive");
  if (!Number.isFinite(input.outputQty) || input.outputQty <= 0) throw new ProductionError(400, "invalid_output_qty", "Output qty must be positive");
  const sb = getServiceRoleClient();
  const { data: sku } = await sb.from("vendor_items").select("id").eq("id", input.inputSkuId).eq("active", true).maybeSingle<{ id: string }>();
  if (!sku) throw new ProductionError(400, "invalid_sku", "SKU not found or inactive");
  const { data: item } = await sb.from("items").select("id").eq("id", input.outputItemId).eq("active", true).maybeSingle<{ id: string }>();
  if (!item) throw new ProductionError(400, "invalid_item", "Item not found or inactive");
  const { data: edge } = await sb.from("item_components").select("id").eq("item_id", input.outputItemId).eq("component_sku_id", input.inputSkuId).maybeSingle<{ id: string }>();
  if (!edge) throw new ProductionError(400, "invalid_conversion", "That item is not made from that SKU");

  // Resolve consumed oz for the single SKU line: inputQty (packs) × content_oz (oz/pack).
  const contentOz = await skuContentOzById(input.inputSkuId);
  if (contentOz == null) throw new ProductionError(400, "invalid_conversion", "SKU has no oz content configured");
  const inputOz = input.inputQty * contentOz;

  // 1) header
  const { data: row, error } = await sb.from("productions").insert({
    location_id: input.locationId, output_item_id: input.outputItemId, output_qty: input.outputQty,
    source: "manual", notes: input.notes?.trim() || null, created_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`recordProduction header insert: ${error.message}`);
  if (!row) throw new Error("recordProduction returned no row");

  // 2) one input line
  const { error: lineErr } = await sb.from("production_inputs").insert({
    production_id: row.id, input_sku_id: input.inputSkuId, input_oz: inputOz,
    qty_entered: input.inputQty, unit_entered: null, derived_oz: null,
  });
  if (lineErr) throw new Error(`recordProduction line insert: ${lineErr.message}`);

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "production.recorded",
    resourceTable: "productions", resourceId: row.id,
    metadata: { location_id: input.locationId, source: "manual", input_sku_id: input.inputSkuId, input_qty: input.inputQty, input_oz: inputOz, output_item_id: input.outputItemId, output_qty: input.outputQty, observed_yield: input.outputQty / input.inputQty },
    ipAddress: null, userAgent: null,
  });
  return { productionId: row.id };
}

export async function loadRecentProductions(actor: AuthContext, locationId: string, limit = 20): Promise<ProductionView[]> {
  requireProduce(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ProductionError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb.from("productions").select("id, produced_at, output_item_id, output_qty")
    .eq("location_id", locationId).is("superseded_at", null).is("revoked_at", null)
    .order("produced_at", { ascending: false }).limit(limit)
    .returns<Array<{ id: string; produced_at: string; output_item_id: string; output_qty: number | string }>>();
  if (error) throw new Error(`loadRecentProductions: ${error.message}`);
  const list = rows ?? [];
  if (list.length === 0) return [];

  // Input lines for these headers → skuName (comma-join) + summed input qty.
  const prodIds = list.map((r) => r.id);
  const { data: lines } = await sb.from("production_inputs").select("production_id, input_sku_id, qty_entered").in("production_id", prodIds)
    .returns<Array<{ production_id: string; input_sku_id: string; qty_entered: number | string | null }>>();
  const lineList = lines ?? [];
  const skuIds = [...new Set(lineList.map((l) => l.input_sku_id))];
  const itemIds = [...new Set(list.map((r) => r.output_item_id))];
  const [{ data: skus }, { data: items }] = await Promise.all([
    skuIds.length ? sb.from("vendor_items").select("id, name").in("id", skuIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    sb.from("items").select("id, name").in("id", itemIds).returns<Array<{ id: string; name: string }>>(),
  ]);
  const skuName = new Map((skus ?? []).map((s) => [s.id, s.name]));
  const itemName = new Map((items ?? []).map((i) => [i.id, i.name]));

  // Per-header: unique sku names (comma-joined) + summed qty_entered.
  const namesByHdr = new Map<string, string[]>();
  const qtyByHdr = new Map<string, number>();
  for (const l of lineList) {
    const nm = skuName.get(l.input_sku_id) ?? "(sku)";
    const arr = namesByHdr.get(l.production_id) ?? [];
    if (!arr.includes(nm)) arr.push(nm);
    namesByHdr.set(l.production_id, arr);
    qtyByHdr.set(l.production_id, (qtyByHdr.get(l.production_id) ?? 0) + (num(l.qty_entered) ?? 0));
  }

  return list.map((r) => ({
    id: r.id, producedAt: r.produced_at,
    skuName: (namesByHdr.get(r.id) ?? []).join(", ") || "(sku)",
    itemName: itemName.get(r.output_item_id) ?? "(item)",
    inputQty: qtyByHdr.get(r.id) ?? 0, outputQty: num(r.output_qty) ?? 0,
  }));
}
