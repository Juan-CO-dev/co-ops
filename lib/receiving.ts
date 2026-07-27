/**
 * Operational receiving data layer (Item/Inventory Spine — R3). SERVER-ONLY,
 * service-role client; authorization is APP-LAYER (KH+ gate + location-bind IDOR)
 * — this is an OPERATIONAL surface (not lib/admin/). Captures what physically
 * arrived per SKU; feeds R2's vendor_price_history + refines R1's avg_oz_per_each.
 *
 * ── PACK-HIERARCHY UPGRADE (PR 2, migration 0160) ──────────────────────────────
 * A delivery line may now be entered at ANY pack-chain level by label ("case",
 * "log", …) with a qty. At write time we resolve that (level, qty) through the
 * SKU's pack chain (lib/pack-chain-shared via ozForRecipeInput) into oz and
 * PERSIST it on the line (resolved_oz — council L3 "persist resolved_oz at write";
 * consumers read stored oz, the spine is date-blind). Unchained SKUs keep the
 * legacy pack semantics: resolved_oz derives from skuContentOz × qty when
 * computable, else stays NULL (advisory — never a fabricated number, A3).
 *
 * Per-line note + PHOTO and a delivery-level receipt + note also land here. The
 * photo/receipt COLUMNS + persistence plumbing are wired (0160); the UI affordance
 * is a DISABLED Phase-6 stub (no storage bucket, no uploader this PR — a one-swap
 * seam, mirroring the checklist photo stub). Callers may pass photoUrl/receiptUrl
 * through, but the shipped form never sets them.
 *
 * ── A2: avg_oz_per_each REFINEMENT GATING (council L8) ─────────────────────────
 * The legacy refinement (feed observed oz/each into vendor_items.avg_oz_per_each)
 * is now GATED: we only fold an observation into the SKU-level average when the
 * line's entered level is the SKU's LEGACY each/no-chain semantics — i.e. the SKU
 * has NO active pack chain. For a CHAINED SKU observed at some level, the mean
 * would corrupt the count/volume-leaf avg the chain depends on, so we DO NOT touch
 * avg_oz_per_each — the observation is level-scoped and persisted on the line
 * (via observed_oz_per_each + received_level_label). We NEVER mutate
 * sku_pack_levels from receiving.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { loadMeasures, loadSkuPackChains } from "@/lib/prep-consumption";
import { ozForRecipeInput, skuContentOz, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";

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
  /** Pack-chain (or legacy pack) level this qty was entered at, e.g. "case".
   *  Optional — legacy callers omit it and qtyReceived is treated as packs. */
  receivedLevelLabel?: string | null;
  /** Per-line receiving photo url. Plumbing only this PR — the UI is a disabled
   *  Phase-6 stub; the shipped form never sets this. */
  photoUrl?: string | null;
}
export interface RecordDeliveryInput {
  vendorId: string;
  locationId: string;
  deliveryDate: string; // YYYY-MM-DD
  invoiceNumber?: string | null;
  invoiceTotal?: number | null;
  notes?: string | null;
  /** Delivery receipt attachment url. Plumbing only this PR — disabled UI stub. */
  receiptUrl?: string | null;
  lines: DeliveryLineInput[];
}
/** One SKU option for the receiving form, carrying its active chain-level labels
 *  (root → leaf) so the line UI can offer a level picker. Empty chainLabels →
 *  the SKU has no chain; the qty is entered as legacy packs. */
export interface ReceivingSkuOption {
  id: string;
  name: string;
  vendorId: string | null;
  chainLabels: string[];
  packFormat: string | null;
}
export interface ReceivingFormData {
  vendors: Array<{ id: string; name: string }>;
  skus: ReceivingSkuOption[];
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
  receiptUrl: string | null;
  lines: Array<{
    skuName: string;
    qtyReceived: number;
    unitPrice: number | null;
    observedOzPerEach: number | null;
    notes: string | null;
    receivedLevelLabel: string | null;
    resolvedOz: number | null;
    photoUrl: string | null;
  }>;
}

export async function loadReceivingFormData(actor: AuthContext, locationId: string): Promise<ReceivingFormData> {
  requireReceive(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ReceivingError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: vendors, error: vErr } = await sb.from("vendors").select("id, name").eq("active", true).order("name", { ascending: true }).returns<Array<{ id: string; name: string }>>();
  if (vErr) throw new Error(`loadReceivingFormData vendors: ${vErr.message}`);
  const { data: skus, error: sErr } = await sb.from("vendor_items").select("id, name, vendor_id, pack_format").eq("active", true).order("name", { ascending: true }).returns<Array<{ id: string; name: string; vendor_id: string | null; pack_format: string | null }>>();
  if (sErr) throw new Error(`loadReceivingFormData skus: ${sErr.message}`);
  const skuList = skus ?? [];
  // ONE batch query for every active SKU's chain levels (loadRecipeGraph law).
  // Chain labels are ordered root→leaf for the level picker (display_ordinal).
  const chainsBySku = await loadSkuPackChains(skuList.map((s) => s.id));
  return {
    vendors: vendors ?? [],
    skus: skuList.map((s) => ({
      id: s.id,
      name: s.name,
      vendorId: s.vendor_id,
      packFormat: s.pack_format,
      chainLabels: chainLabelsInWalkOrder(chainsBySku.get(s.id) ?? []),
    })),
  };
}

/** Chain level labels ordered root→leaf by following contains_level_id (falls back
 *  to display_ordinal when the pointer chain is malformed). Root-first is the
 *  natural "biggest container first" order for a receiving level picker. */
function chainLabelsInWalkOrder(levels: PackChainLevel[]): string[] {
  if (levels.length === 0) return [];
  const byId = new Map(levels.map((l) => [l.id, l]));
  const pointedAt = new Set<string>();
  for (const l of levels) if (l.containsLevelId != null) pointedAt.add(l.containsLevelId);
  const roots = levels.filter((l) => !pointedAt.has(l.id));
  if (roots.length !== 1 || !roots[0]) {
    // Malformed (no unique root): fall back to display order, still usable.
    return [...levels].sort((a, b) => a.displayOrdinal - b.displayOrdinal).map((l) => l.label);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: PackChainLevel | undefined = roots[0];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur.label);
    cur = cur.containsLevelId != null ? byId.get(cur.containsLevelId) : undefined;
  }
  return out;
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
  // A-WB4-02: the header invoice total was written unvalidated (line prices were validated). Bound it.
  if (input.invoiceTotal != null && (!Number.isFinite(input.invoiceTotal) || input.invoiceTotal < 0)) {
    throw new ReceivingError(400, "invalid_invoice_total", "Invoice total must be zero or greater");
  }
  const sb = getServiceRoleClient();

  const { data: vend } = await sb.from("vendors").select("id").eq("id", input.vendorId).eq("active", true).maybeSingle<{ id: string }>();
  if (!vend) throw new ReceivingError(400, "invalid_vendor", "Vendor not found or inactive");
  const skuIds = [...new Set(input.lines.map((l) => l.skuId))];
  const { data: activeSkus } = await sb.from("vendor_items")
    .select("id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("id", skuIds).eq("active", true)
    .returns<Array<{ id: string; pack_format: string | null; each_container_label: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  const activeSet = new Set((activeSkus ?? []).map((s) => s.id));
  for (const id of skuIds) if (!activeSet.has(id)) throw new ReceivingError(400, "invalid_sku", "A SKU is not found or inactive");

  // Resolve each line's received oz at write time (council L3): (level, qty) walked
  // through the SKU's pack chain (or legacy content-oz × qty). Batch-load measures +
  // chains once for the whole delivery (loadRecipeGraph law). A chained SKU without
  // an active chain OR an unresolvable line → resolved_oz null (advisory, A3).
  const [measures, chainsBySku] = await Promise.all([loadMeasures(), loadSkuPackChains(skuIds)]);
  const skuById = new Map((activeSkus ?? []).map((s) => [s.id, s]));
  const chained = new Set([...chainsBySku.entries()].filter(([, lv]) => lv.length > 0).map(([id]) => id));
  const resolvedOzByLineIdx = input.lines.map((l) => resolveReceivedOz(l, skuById.get(l.skuId), chainsBySku.get(l.skuId) ?? null, measures));

  // 0160 columns — apply 0160 BEFORE deploying this code (additive; old code unaffected).
  // The 0160 `note` columns are the brief-canonical fields; the legacy `notes`
  // columns stay populated so the existing detail reader keeps working (no split-
  // brain — both mirror the same operator input this PR; a future pass can retire
  // the legacy `notes` once every reader moves to `note`).
  const headerNote = input.notes?.trim() || null;
  const { data: header, error: hErr } = await sb.from("vendor_deliveries").insert({
    vendor_id: input.vendorId, location_id: input.locationId, delivery_date: input.deliveryDate,
    invoice_number: input.invoiceNumber?.trim() || null, invoice_total: input.invoiceTotal ?? null,
    notes: headerNote, note: headerNote, receipt_url: input.receiptUrl?.trim() || null, received_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (hErr) throw new Error(`recordDelivery header: ${hErr.message}`);
  if (!header) throw new Error("recordDelivery header returned no row");

  const { error: lErr } = await sb.from("vendor_delivery_items").insert(
    input.lines.map((l, i) => ({
      delivery_id: header.id, vendor_item_id: l.skuId, qty_received: l.qtyReceived,
      unit_price: l.unitPrice ?? null, observed_oz_per_each: l.observedOzPerEach ?? null,
      notes: l.notes?.trim() || null, created_by: actor.user.id,
      received_level_label: l.receivedLevelLabel?.trim() || null,
      received_qty_at_level: l.receivedLevelLabel?.trim() ? l.qtyReceived : null,
      resolved_oz: resolvedOzByLineIdx[i],
      note: l.notes?.trim() || null,
      photo_url: l.photoUrl?.trim() || null,
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

  // A2 (council L8): fold an observation into the SKU-level avg_oz_per_each ONLY
  // for UNCHAINED SKUs (legacy each/no-chain semantics). For a chained SKU the
  // observation is level-scoped and stays on the line (observed_oz_per_each +
  // received_level_label) — mutating the SKU average would corrupt the
  // count/volume-leaf avg the chain depends on. We NEVER mutate sku_pack_levels.
  const observedSkuIds = [...new Set(input.lines.filter((l) => l.observedOzPerEach != null).map((l) => l.skuId))];
  const avgUpdated: string[] = [];
  const avgSkippedChained: string[] = [];
  for (const id of observedSkuIds) {
    if (chained.has(id)) { avgSkippedChained.push(id); continue; }
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
    metadata: { vendor_id: input.vendorId, location_id: input.locationId, line_count: input.lines.length, priced_lines: priced.length, avg_oz_updated: avgUpdated, avg_skipped_chained: avgSkippedChained },
    ipAddress: null, userAgent: null,
  });

  return { deliveryId: header.id };
}

/**
 * Resolve a delivery line's received oz at write time (council L3), advisory-null
 * on anything unresolvable (A3 — never a fabricated number):
 *  - a chained SKU with a named level → ozForRecipeInput(qty, level, sku, measures)
 *    walks the chain (pointer-directed); an unresolvable level → null.
 *  - a chained SKU with NO named level → we can't know which container the qty
 *    means → null (the form requires a level for chained SKUs).
 *  - an unchained SKU → qty × content_oz (legacy pack semantics) when computable,
 *    else null.
 */
function resolveReceivedOz(
  line: DeliveryLineInput,
  sku: { pack_format: string | null; each_container_label: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null } | undefined,
  chain: PackChainLevel[] | null,
  measures: Map<string, MeasureUnitFactor>,
): number | null {
  if (!sku || !Number.isFinite(line.qtyReceived) || line.qtyReceived <= 0) return null;
  const avg = num(sku.avg_oz_per_each);
  const hasChain = chain != null && chain.length > 0;

  if (hasChain) {
    const level = line.receivedLevelLabel?.trim();
    if (!level) return null; // chained SKU but no level named → can't resolve the container.
    const recipeSku: RecipeInputSku = {
      packFormat: sku.pack_format, eachContainerLabel: sku.each_container_label,
      unitsPerPack: sku.units_per_pack, eachSize: num(sku.each_size), eachMeasure: sku.each_measure,
      avgOzPerEach: avg, packChain: chain,
    };
    return ozForRecipeInput(line.qtyReceived, level, recipeSku, measures);
  }

  // Unchained: qty (packs) × content oz per pack, when computable.
  const contentOz = skuContentOz(
    { unitsPerPack: sku.units_per_pack, eachSize: num(sku.each_size), eachMeasure: sku.each_measure, avgOzPerEach: avg },
    measures,
  );
  return contentOz == null ? null : line.qtyReceived * contentOz;
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
    .select("id, vendor_id, location_id, delivery_date, invoice_number, invoice_total, notes, receipt_url, received_by")
    .eq("id", deliveryId)
    .maybeSingle<{ id: string; vendor_id: string; location_id: string; delivery_date: string; invoice_number: string | null; invoice_total: number | string | null; notes: string | null; receipt_url: string | null; received_by: string | null }>();
  if (error) throw new Error(`loadDeliveryDetail: ${error.message}`);
  if (!h) throw new ReceivingError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), h.location_id)) throw new ReceivingError(404, "not_found", "Delivery not found");
  const { data: lineRows } = await sb.from("vendor_delivery_items").select("vendor_item_id, qty_received, unit_price, observed_oz_per_each, notes, received_level_label, resolved_oz, photo_url").eq("delivery_id", deliveryId).order("created_at", { ascending: true }).returns<Array<{ vendor_item_id: string; qty_received: number | string; unit_price: number | string | null; observed_oz_per_each: number | string | null; notes: string | null; received_level_label: string | null; resolved_oz: number | string | null; photo_url: string | null }>>();
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
    invoiceTotal: num(h.invoice_total), notes: h.notes, receiptUrl: h.receipt_url,
    lines: (lineRows ?? []).map((l) => ({
      skuName: skuName.get(l.vendor_item_id) ?? "(sku)", qtyReceived: num(l.qty_received) ?? 0,
      unitPrice: num(l.unit_price), observedOzPerEach: num(l.observed_oz_per_each), notes: l.notes,
      receivedLevelLabel: l.received_level_label, resolvedOz: num(l.resolved_oz), photoUrl: l.photo_url,
    })),
  };
}
