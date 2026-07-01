/**
 * Operational receiving data layer (Item/Inventory Spine — R3). SERVER-ONLY,
 * service-role client; authorization is APP-LAYER (KH+ gate + location-bind IDOR)
 * — this is an OPERATIONAL surface (not lib/admin/). Captures what physically
 * arrived per SKU; feeds R2's vendor_price_history + refines R1's avg_oz_per_each.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

export const RECEIVE_MIN = 4; // key_holder+

export class ReceivingError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "ReceivingError";
  }
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function requireReceive(actor: AuthContext): void {
  if (getRoleLevel(actor.user.role) < RECEIVE_MIN) {
    throw new ReceivingError(403, "forbidden", "Insufficient role level to receive");
  }
}
function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

export interface DeliveryLineInput {
  skuId: string;
  qtyReceived: number;
  unitPrice?: number | null;
  observedOzPerEach?: number | null;
  notes?: string | null;
}
export interface RecordDeliveryInput {
  vendorId: string;
  locationId: string;
  deliveryDate: string; // YYYY-MM-DD
  invoiceNumber?: string | null;
  invoiceTotal?: number | null;
  notes?: string | null;
  lines: DeliveryLineInput[];
}
export interface ReceivingFormData {
  vendors: Array<{ id: string; name: string }>;
  skus: Array<{ id: string; name: string; vendorId: string | null }>;
}
export interface DeliveryView {
  id: string;
  vendorName: string;
  deliveryDate: string;
  invoiceNumber: string | null;
  lineCount: number;
  receivedByName: string | null;
}
export interface DeliveryDetail extends DeliveryView {
  locationId: string;
  invoiceTotal: number | null;
  notes: string | null;
  lines: Array<{ skuName: string; qtyReceived: number; unitPrice: number | null; observedOzPerEach: number | null; notes: string | null }>;
}

export async function loadReceivingFormData(actor: AuthContext, locationId: string): Promise<ReceivingFormData> {
  requireReceive(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ReceivingError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: vendors, error: vErr } = await sb.from("vendors").select("id, name").eq("active", true).order("name", { ascending: true }).returns<Array<{ id: string; name: string }>>();
  if (vErr) throw new Error(`loadReceivingFormData vendors: ${vErr.message}`);
  const { data: skus, error: sErr } = await sb.from("vendor_items").select("id, name, vendor_id").eq("active", true).order("name", { ascending: true }).returns<Array<{ id: string; name: string; vendor_id: string | null }>>();
  if (sErr) throw new Error(`loadReceivingFormData skus: ${sErr.message}`);
  return {
    vendors: vendors ?? [],
    skus: (skus ?? []).map((s) => ({ id: s.id, name: s.name, vendorId: s.vendor_id })),
  };
}

export async function recordDelivery(actor: AuthContext, input: RecordDeliveryInput): Promise<{ deliveryId: string }> {
  requireReceive(actor);
  if (!lockLocationContext(actorLoc(actor), input.locationId)) throw new ReceivingError(404, "not_found", "Location not found");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate) || Number.isNaN(Date.parse(input.deliveryDate))) {
    throw new ReceivingError(400, "invalid_date", "Delivery date must be YYYY-MM-DD");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new ReceivingError(400, "no_lines", "At least one line is required");
  for (const l of input.lines) {
    if (!Number.isFinite(l.qtyReceived) || l.qtyReceived <= 0) throw new ReceivingError(400, "invalid_qty", "Quantity must be positive");
    if (l.unitPrice != null && (!Number.isFinite(l.unitPrice) || l.unitPrice <= 0)) throw new ReceivingError(400, "invalid_price", "Price must be positive");
    if (l.observedOzPerEach != null && (!Number.isFinite(l.observedOzPerEach) || l.observedOzPerEach <= 0)) throw new ReceivingError(400, "invalid_observed", "Observed oz must be positive");
  }
  const sb = getServiceRoleClient();

  const { data: vend } = await sb.from("vendors").select("id").eq("id", input.vendorId).eq("active", true).maybeSingle<{ id: string }>();
  if (!vend) throw new ReceivingError(400, "invalid_vendor", "Vendor not found or inactive");
  const skuIds = [...new Set(input.lines.map((l) => l.skuId))];
  const { data: activeSkus } = await sb.from("vendor_items").select("id").in("id", skuIds).eq("active", true).returns<Array<{ id: string }>>();
  const activeSet = new Set((activeSkus ?? []).map((s) => s.id));
  for (const id of skuIds) if (!activeSet.has(id)) throw new ReceivingError(400, "invalid_sku", "A SKU is not found or inactive");

  const { data: header, error: hErr } = await sb.from("vendor_deliveries").insert({
    vendor_id: input.vendorId, location_id: input.locationId, delivery_date: input.deliveryDate,
    invoice_number: input.invoiceNumber?.trim() || null, invoice_total: input.invoiceTotal ?? null,
    notes: input.notes?.trim() || null, received_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (hErr) throw new Error(`recordDelivery header: ${hErr.message}`);
  if (!header) throw new Error("recordDelivery header returned no row");

  const { error: lErr } = await sb.from("vendor_delivery_items").insert(
    input.lines.map((l) => ({
      delivery_id: header.id, vendor_item_id: l.skuId, qty_received: l.qtyReceived,
      unit_price: l.unitPrice ?? null, observed_oz_per_each: l.observedOzPerEach ?? null,
      notes: l.notes?.trim() || null, created_by: actor.user.id,
    })),
  );
  if (lErr) throw new Error(`recordDelivery lines: ${lErr.message}`);

  const priced = input.lines.filter((l) => l.unitPrice != null);
  if (priced.length > 0) {
    const { error: pErr } = await sb.from("vendor_price_history").insert(
      priced.map((l) => ({ vendor_item_id: l.skuId, unit_price: l.unitPrice, effective_date: input.deliveryDate, recorded_by: actor.user.id })),
    );
    if (pErr) throw new Error(`recordDelivery prices: ${pErr.message}`);
  }

  const observedSkuIds = [...new Set(input.lines.filter((l) => l.observedOzPerEach != null).map((l) => l.skuId))];
  const avgUpdated: string[] = [];
  for (const id of observedSkuIds) {
    const { data: obs } = await sb.from("vendor_delivery_items").select("observed_oz_per_each").eq("vendor_item_id", id).not("observed_oz_per_each", "is", null).returns<Array<{ observed_oz_per_each: number | string }>>();
    const vals = (obs ?? []).map((o) => num(o.observed_oz_per_each)).filter((v): v is number => v != null);
    if (vals.length === 0) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const { error: uErr } = await sb.from("vendor_items").update({ avg_oz_per_each: mean, updated_by: actor.user.id, updated_at: new Date().toISOString() }).eq("id", id);
    if (uErr) throw new Error(`recordDelivery avg update: ${uErr.message}`);
    avgUpdated.push(id);
  }

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "delivery.received", resourceTable: "vendor_deliveries", resourceId: header.id,
    metadata: { vendor_id: input.vendorId, location_id: input.locationId, line_count: input.lines.length, priced_lines: priced.length, avg_oz_updated: avgUpdated },
    ipAddress: null, userAgent: null,
  });

  return { deliveryId: header.id };
}

export async function loadRecentDeliveries(actor: AuthContext, locationId: string, limit = 20): Promise<DeliveryView[]> {
  requireReceive(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ReceivingError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb.from("vendor_deliveries")
    .select("id, vendor_id, delivery_date, invoice_number, received_by")
    .eq("location_id", locationId).order("delivery_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit)
    .returns<Array<{ id: string; vendor_id: string; delivery_date: string; invoice_number: string | null; received_by: string | null }>>();
  if (error) throw new Error(`loadRecentDeliveries: ${error.message}`);
  const list = rows ?? [];
  if (list.length === 0) return [];
  const vendorIds = [...new Set(list.map((r) => r.vendor_id))];
  const userIds = [...new Set(list.map((r) => r.received_by).filter((v): v is string => v !== null))];
  const deliveryIds = list.map((r) => r.id);
  const [{ data: vs }, { data: us }, { data: lines }] = await Promise.all([
    sb.from("vendors").select("id, name").in("id", vendorIds).returns<Array<{ id: string; name: string }>>(),
    userIds.length ? sb.from("users").select("id, name").in("id", userIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    sb.from("vendor_delivery_items").select("delivery_id").in("delivery_id", deliveryIds).returns<Array<{ delivery_id: string }>>(),
  ]);
  const vName = new Map((vs ?? []).map((v) => [v.id, v.name]));
  const uName = new Map((us ?? []).map((u) => [u.id, u.name]));
  const lineCount = new Map<string, number>();
  for (const l of lines ?? []) lineCount.set(l.delivery_id, (lineCount.get(l.delivery_id) ?? 0) + 1);
  return list.map((r) => ({
    id: r.id, vendorName: vName.get(r.vendor_id) ?? "(vendor)", deliveryDate: r.delivery_date,
    invoiceNumber: r.invoice_number, lineCount: lineCount.get(r.id) ?? 0,
    receivedByName: r.received_by ? (uName.get(r.received_by) ?? null) : null,
  }));
}

export async function loadDeliveryDetail(actor: AuthContext, deliveryId: string): Promise<DeliveryDetail> {
  requireReceive(actor);
  const sb = getServiceRoleClient();
  const { data: h, error } = await sb.from("vendor_deliveries")
    .select("id, vendor_id, location_id, delivery_date, invoice_number, invoice_total, notes, received_by")
    .eq("id", deliveryId)
    .maybeSingle<{ id: string; vendor_id: string; location_id: string; delivery_date: string; invoice_number: string | null; invoice_total: number | string | null; notes: string | null; received_by: string | null }>();
  if (error) throw new Error(`loadDeliveryDetail: ${error.message}`);
  if (!h) throw new ReceivingError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), h.location_id)) throw new ReceivingError(404, "not_found", "Delivery not found");
  const { data: lineRows } = await sb.from("vendor_delivery_items").select("vendor_item_id, qty_received, unit_price, observed_oz_per_each, notes").eq("delivery_id", deliveryId).order("created_at", { ascending: true }).returns<Array<{ vendor_item_id: string; qty_received: number | string; unit_price: number | string | null; observed_oz_per_each: number | string | null; notes: string | null }>>();
  const [{ data: vend }, { data: rx }] = await Promise.all([
    sb.from("vendors").select("name").eq("id", h.vendor_id).maybeSingle<{ name: string }>(),
    h.received_by ? sb.from("users").select("name").eq("id", h.received_by).maybeSingle<{ name: string }>() : Promise.resolve({ data: null }),
  ]);
  const skuIds = [...new Set((lineRows ?? []).map((l) => l.vendor_item_id))];
  const { data: skus } = skuIds.length ? await sb.from("vendor_items").select("id, name").in("id", skuIds).returns<Array<{ id: string; name: string }>>() : { data: [] as Array<{ id: string; name: string }> };
  const skuName = new Map((skus ?? []).map((s) => [s.id, s.name]));
  return {
    id: h.id, vendorName: vend?.name ?? "(vendor)", deliveryDate: h.delivery_date, invoiceNumber: h.invoice_number,
    lineCount: (lineRows ?? []).length, receivedByName: rx?.name ?? null, locationId: h.location_id,
    invoiceTotal: num(h.invoice_total), notes: h.notes,
    lines: (lineRows ?? []).map((l) => ({ skuName: skuName.get(l.vendor_item_id) ?? "(sku)", qtyReceived: num(l.qty_received) ?? 0, unitPrice: num(l.unit_price), observedOzPerEach: num(l.observed_oz_per_each), notes: l.notes })),
  };
}
