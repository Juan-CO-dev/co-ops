/**
 * Operational production-capture data layer (Item/Inventory Spine — S1). SERVER-ONLY,
 * service-role; app-layer KH+ (≥4) gate + location-bind IDOR (mirrors lib/receiving.ts).
 * Records SKU→item conversions: depletes the SKU (consumption signal), credits the item,
 * and feeds the running-average yield prediction.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

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

/** received packs − consumed packs, per SKU (for the form's in-stock hint). */
async function loadInStockPacks(skuIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data: recv } = await sb.from("vendor_delivery_items").select("vendor_item_id, qty_received").in("vendor_item_id", skuIds).returns<Array<{ vendor_item_id: string; qty_received: number | string }>>();
  const { data: cons } = await sb.from("productions").select("input_sku_id, input_qty").in("input_sku_id", skuIds).returns<Array<{ input_sku_id: string; input_qty: number | string }>>();
  for (const id of skuIds) out.set(id, 0);
  for (const r of recv ?? []) out.set(r.vendor_item_id, (out.get(r.vendor_item_id) ?? 0) + (num(r.qty_received) ?? 0));
  for (const c of cons ?? []) out.set(c.input_sku_id, (out.get(c.input_sku_id) ?? 0) - (num(c.input_qty) ?? 0));
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
  const { data: past } = await sb.from("productions").select("input_qty, output_qty").eq("input_sku_id", args.inputSkuId).eq("output_item_id", args.outputItemId)
    .returns<Array<{ input_qty: number | string; output_qty: number | string }>>();
  const ratios = (past ?? []).map((p) => { const i = num(p.input_qty) ?? 0; const o = num(p.output_qty) ?? 0; return i > 0 ? o / i : null; }).filter((r): r is number => r != null);
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

  const { data: row, error } = await sb.from("productions").insert({
    location_id: input.locationId, input_sku_id: input.inputSkuId, input_qty: input.inputQty,
    output_item_id: input.outputItemId, output_qty: input.outputQty, notes: input.notes?.trim() || null, created_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`recordProduction insert: ${error.message}`);
  if (!row) throw new Error("recordProduction returned no row");

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "production.recorded",
    resourceTable: "productions", resourceId: row.id,
    metadata: { location_id: input.locationId, input_sku_id: input.inputSkuId, input_qty: input.inputQty, output_item_id: input.outputItemId, output_qty: input.outputQty, observed_yield: input.outputQty / input.inputQty },
    ipAddress: null, userAgent: null,
  });
  return { productionId: row.id };
}

export async function loadRecentProductions(actor: AuthContext, locationId: string, limit = 20): Promise<ProductionView[]> {
  requireProduce(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ProductionError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb.from("productions").select("id, produced_at, input_sku_id, input_qty, output_item_id, output_qty")
    .eq("location_id", locationId).order("produced_at", { ascending: false }).limit(limit)
    .returns<Array<{ id: string; produced_at: string; input_sku_id: string; input_qty: number | string; output_item_id: string; output_qty: number | string }>>();
  if (error) throw new Error(`loadRecentProductions: ${error.message}`);
  const list = rows ?? [];
  if (list.length === 0) return [];
  const skuIds = [...new Set(list.map((r) => r.input_sku_id))];
  const itemIds = [...new Set(list.map((r) => r.output_item_id))];
  const [{ data: skus }, { data: items }] = await Promise.all([
    sb.from("vendor_items").select("id, name").in("id", skuIds).returns<Array<{ id: string; name: string }>>(),
    sb.from("items").select("id, name").in("id", itemIds).returns<Array<{ id: string; name: string }>>(),
  ]);
  const skuName = new Map((skus ?? []).map((s) => [s.id, s.name]));
  const itemName = new Map((items ?? []).map((i) => [i.id, i.name]));
  return list.map((r) => ({
    id: r.id, producedAt: r.produced_at, skuName: skuName.get(r.input_sku_id) ?? "(sku)", itemName: itemName.get(r.output_item_id) ?? "(item)",
    inputQty: num(r.input_qty) ?? 0, outputQty: num(r.output_qty) ?? 0,
  }));
}
