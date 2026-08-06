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
import { deriveCreditDrafts, isDuplicateAppend, type AppendLine, type IntakeLineForCredits } from "@/lib/receiving-shared";
import { advanceToReceived } from "@/lib/purchase-orders";

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
  /** Qty pre-filled at the door from the PO/ordered list (level units); null =
   *  unexpected/added line. Feeds credit derivation (short/over). */
  expectedQty?: number | null;
  /** Operator-flagged discrepancy on this line. Drives idempotent credit drafts
   *  (deriveCreditDrafts); null = no discrepancy. */
  discrepancyType?: "short" | "over" | "damaged" | "substitution" | null;
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
  /** Door-ceremony lifecycle. "in_progress" = a partial delivery still being built
   *  (addDeliveryLines / completeDelivery); defaults to "complete" at write. */
  deliveryStatus?: "in_progress" | "complete";
  lines: DeliveryLineInput[];
  /**
   * When the intake is being received against an open PO (spec §3 "received"),
   * the form carries the PO id here. Validated: PO must exist, be `placed`, and
   * have matching vendor_id + location_id. On success the delivery links
   * vendor_deliveries.purchase_order_id; completing the delivery advances the PO
   * to `received` via advanceToReceived. 409 codes: `po_mismatch` |
   * `po_not_placed` | `po_already_received`.
   */
  purchaseOrderId?: string | null;
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
  /** Trailing-30-day consumed oz for this SKU at this location = production_inputs.input_oz
   *  (live productions) + toast_daily_depletion.direct_oz. Higher = more used → ranked first
   *  when a vendor has no last-delivery template. null = no usage in the window (a SKU never
   *  consumed here → not offered as a pre-filled line; only reachable via the Add-item picker). */
  usageRank: number | null;
}
export interface ReceivingFormData {
  vendors: Array<{ id: string; name: string }>;
  skus: ReceivingSkuOption[];
}
export type DeliveryMatchState = "counted_only" | "matched" | "discrepant" | "override";
export type DeliveryStatus = "in_progress" | "complete";

export interface DeliveryView {
  id: string;
  vendorName: string;
  deliveryDate: string;
  invoiceNumber: string | null;
  lineCount: number;
  receivedByName: string | null;
  /** Two-way-match lifecycle (0168); 'discrepant' drives the list warn badge. */
  matchState: DeliveryMatchState;
  /** Door lifecycle (0168); 'in_progress' drives the continue-intake affordance. */
  deliveryStatus: DeliveryStatus;
  /** Null → the missing-receipt-photo badge (photo-later / no attachment). */
  receiptUrl: string | null;
  /** Linked email-receipt id (0170); null → no vendor claim on file. Feeds the
   *  derived "missing email" badge on the list (complete + counted_only + null +
   *  aged past 48h). */
  emailReceiptId: string | null;
  /** Row creation timestamp (ISO); the age input for the 48h missing-email window. */
  createdAt: string;
}
export interface DeliveryDetail extends DeliveryView {
  locationId: string;
  invoiceTotal: number | null;
  notes: string | null;
  lines: Array<{
    skuName: string;
    qtyReceived: number;
    unitPrice: number | null;
    observedOzPerEach: number | null;
    notes: string | null;
    receivedLevelLabel: string | null;
    resolvedOz: number | null;
    photoUrl: string | null;
    /** Operator-flagged discrepancy (0168); null = clean line. Drives per-line chips. */
    discrepancyType: "short" | "over" | "damaged" | "substitution" | null;
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
  // Usage rank is a SECOND batch pair (production + sales lanes) — never per-SKU.
  const [chainsBySku, usageBySku] = await Promise.all([
    loadSkuPackChains(skuList.map((s) => s.id)),
    loadSkuUsageRank(sb, locationId),
  ]);
  return {
    vendors: vendors ?? [],
    skus: skuList.map((s) => ({
      id: s.id,
      name: s.name,
      vendorId: s.vendor_id,
      packFormat: s.pack_format,
      chainLabels: chainLabelsInWalkOrder(chainsBySku.get(s.id) ?? []),
      usageRank: usageBySku.get(s.id) ?? null,
    })),
  };
}

/**
 * Trailing-30-day consumed oz per SKU at a location (the "most used per the depletion
 * mechanic" rank — Juan's door refinement). Mirrors the counts drift consumed term
 * (lib/counts.ts) EXACTLY — the SAME two tables/columns the double-count law sums:
 *   production lane = SUM(production_inputs.input_oz) over LIVE productions
 *                     (superseded_at/revoked_at NULL) at this location, produced in
 *                     the last 30 days (raw SKU depletes at production, BC-026 oz-native).
 *   sales lane      = SUM(toast_daily_depletion.direct_oz) at this location for
 *                     business_dates in the last 30 days (the ONLY sales lane that
 *                     depletes raw stock; flattened_oz is production-covered, never summed).
 * Two grouped queries (batch, date-filtered server-side), summed in memory. A SKU with
 * no consumption in either lane is absent from the map → its usageRank reads null (never
 * offered as a pre-filled line; still reachable via the Add-item picker). This is a
 * RANK ONLY — advisory, never a fabricated on-hand number.
 */
async function loadSkuUsageRank(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<Map<string, number>> {
  const usage = new Map<string, number>();
  const add = (skuId: string, oz: number) => {
    if (!Number.isFinite(oz) || oz <= 0) return;
    usage.set(skuId, (usage.get(skuId) ?? 0) + oz);
  };

  // 30-day window. Productions compare on produced_at (timestamptz); the depletion
  // ledger compares on business_date (a bare date) — derive both from the same instant.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();
  const cutoffDate = cutoffIso.slice(0, 10); // YYYY-MM-DD for the business_date filter.

  // Production lane — live productions at this location in the window, then their inputs.
  const { data: prodHdrs, error: phErr } = await sb.from("productions")
    .select("id")
    .eq("location_id", locationId)
    .is("superseded_at", null).is("revoked_at", null)
    .gt("produced_at", cutoffIso)
    .returns<Array<{ id: string }>>();
  if (phErr) throw new Error(`loadSkuUsageRank productions: ${phErr.message}`);
  const prodIds = (prodHdrs ?? []).map((h) => h.id);
  if (prodIds.length > 0) {
    const { data: inputs, error: piErr } = await sb.from("production_inputs")
      .select("input_sku_id, input_oz")
      .in("production_id", prodIds)
      .returns<Array<{ input_sku_id: string; input_oz: number | string | null }>>();
    if (piErr) throw new Error(`loadSkuUsageRank production_inputs: ${piErr.message}`);
    for (const r of inputs ?? []) add(r.input_sku_id, num(r.input_oz) ?? 0);
  }

  // Sales direct lane — the materialized depletion ledger over the window (0166).
  const { data: sales, error: sErr } = await sb.from("toast_daily_depletion")
    .select("sku_id, direct_oz")
    .eq("location_id", locationId)
    .gte("business_date", cutoffDate)
    .returns<Array<{ sku_id: string; direct_oz: number | string }>>();
  if (sErr) throw new Error(`loadSkuUsageRank toast_daily_depletion: ${sErr.message}`);
  for (const r of sales ?? []) add(r.sku_id, num(r.direct_oz) ?? 0);

  return usage;
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
  // Line validation + SKU-active check + oz resolution is shared with addDeliveryLines.
  // A-WB4-02: the header invoice total was written unvalidated (line prices were validated). Bound it.
  if (input.invoiceTotal != null && (!Number.isFinite(input.invoiceTotal) || input.invoiceTotal < 0)) {
    throw new ReceivingError(400, "invalid_invoice_total", "Invoice total must be zero or greater");
  }
  const sb = getServiceRoleClient();

  const { data: vend } = await sb.from("vendors").select("id").eq("id", input.vendorId).eq("active", true).maybeSingle<{ id: string }>();
  if (!vend) throw new ReceivingError(400, "invalid_vendor", "Vendor not found or inactive");

  // ── PO linkage validation (spec §3 "received"; optional) ─────────────────
  // When purchaseOrderId is supplied: the PO must exist, be in `placed` status,
  // and its vendor_id + location_id must match the delivery. Error codes are the
  // three 409s the form maps: po_mismatch | po_not_placed | po_already_received.
  const poId = input.purchaseOrderId?.trim() || null;
  if (poId) {
    const { data: po, error: poValErr } = await sb.from("purchase_orders")
      .select("id, vendor_id, location_id, status")
      .eq("id", poId)
      .maybeSingle<{ id: string; vendor_id: string; location_id: string; status: string }>();
    if (poValErr) throw new Error(`recordDelivery PO validation: ${poValErr.message}`);
    if (!po) throw new ReceivingError(404, "po_not_found", "Purchase order not found");
    if (po.vendor_id !== input.vendorId || po.location_id !== input.locationId) {
      throw new ReceivingError(409, "po_mismatch", "Purchase order does not match this vendor or location");
    }
    if (po.status === "received" || po.status === "reconciled") {
      throw new ReceivingError(409, "po_already_received", "This purchase order has already been received");
    }
    if (po.status !== "placed") {
      throw new ReceivingError(409, "po_not_placed", "Purchase order must be in placed status to receive against it");
    }
  }

  // Dedupe guard (spec D1 dedupeKey): vendor + location + date + case-insensitive
  // invoice identity. A driver re-handing amended paperwork must NOT double-file.
  // An in-progress hit means "continue that one", a complete hit means "already received".
  const invoiceNumber = input.invoiceNumber?.trim() || null;
  if (invoiceNumber) {
    const { data: dup, error: dupErr } = await sb.from("vendor_deliveries")
      .select("id, delivery_status")
      .eq("vendor_id", input.vendorId).eq("location_id", input.locationId).eq("delivery_date", input.deliveryDate)
      .ilike("invoice_number", invoiceNumber)
      .maybeSingle<{ id: string; delivery_status: string | null }>();
    if (dupErr) throw new Error(`recordDelivery dedupe: ${dupErr.message}`);
    if (dup) {
      const msg = dup.delivery_status === "in_progress"
        ? "This delivery is already in progress — continue it instead."
        : "This invoice was already received for this vendor today.";
      throw new ReceivingError(409, "duplicate_delivery", `${msg} (delivery ${dup.id})`);
    }
  }

  const resolved = await validateAndResolveDeliveryLines(sb, input.lines);

  // 0160 columns — apply 0160 BEFORE deploying this code (additive; old code unaffected).
  // The 0160 `note` columns are the brief-canonical fields; the legacy `notes`
  // columns stay populated so the existing detail reader keeps working (no split-
  // brain — both mirror the same operator input this PR; a future pass can retire
  // the legacy `notes` once every reader moves to `note`).
  const headerNote = input.notes?.trim() || null;
  const { data: header, error: hErr } = await sb.from("vendor_deliveries").insert({
    vendor_id: input.vendorId, location_id: input.locationId, delivery_date: input.deliveryDate,
    invoice_number: invoiceNumber, invoice_total: input.invoiceTotal ?? null,
    notes: headerNote, note: headerNote, receipt_url: input.receiptUrl?.trim() || null, received_by: actor.user.id,
    delivery_status: input.deliveryStatus ?? "complete",
    purchase_order_id: poId,
  }).select("id").maybeSingle<{ id: string }>();
  if (hErr) {
    // The app-level dedupe guard above is the fast path (friendly message), but it
    // races under concurrent POSTs — migration 0169's partial unique index
    // (vendor_deliveries_dedupe_uq) is the real arbiter. A 23505 on it means another
    // request already inserted this (vendor, location, date, lower(invoice)) → 409.
    if (hErr.code === "23505" || /vendor_deliveries_dedupe_uq/.test(hErr.message ?? "")) {
      throw new ReceivingError(409, "duplicate_delivery", "This invoice was already received for this vendor today.");
    }
    throw new Error(`recordDelivery header: ${hErr.message}`);
  }
  if (!header) throw new Error("recordDelivery header returned no row");

  const { error: lErr } = await sb.from("vendor_delivery_items").insert(
    buildLineRows(header.id, input.lines, resolved.resolvedOzByLineIdx, actor.user.id),
  );
  if (lErr) throw new Error(`recordDelivery lines: ${lErr.message}`);

  // Idempotent vendor credits from any discrepancy-flagged lines (spec D1: the
  // intake unit_price is the credit price authority). Retry-safe via the 0168
  // (delivery_item_id, reason) unique index — ignoreDuplicates on re-run.
  await deriveAndUpsertCredits(sb, header.id, input.vendorId, input.locationId, actor.user.id);

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
    if (resolved.chained.has(id)) { avgSkippedChained.push(id); continue; }
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
    metadata: { vendor_id: input.vendorId, location_id: input.locationId, line_count: input.lines.length, priced_lines: priced.length, avg_oz_updated: avgUpdated, avg_skipped_chained: avgSkippedChained, purchase_order_id: poId },
    ipAddress: null, userAgent: null,
  });

  // Advance the linked PO to `received` when the delivery is complete (spec §3).
  // For in_progress deliveries the PO stays at placed until completeDelivery fires.
  if (poId && (input.deliveryStatus ?? "complete") === "complete") {
    await advanceToReceived(sb, poId);
  }

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

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

interface ResolvedLines {
  /** resolved_oz per input line, index-aligned with the passed lines (advisory-null). */
  resolvedOzByLineIdx: Array<number | null>;
  /** SKU ids that have an active pack chain (avg-refinement gate, council L8). */
  chained: Set<string>;
}

/**
 * Shared line-validation + oz-resolution path for recordDelivery AND addDeliveryLines
 * (item 6 — one resolution path, no duplication). Validates each line's qty/price/
 * observed, confirms every referenced SKU is active, then batch-loads measures +
 * chains once (loadRecipeGraph law) and resolves each line's received oz (council L3).
 * Throws ReceivingError on any validation failure; the caller owns the header/insert.
 */
async function validateAndResolveDeliveryLines(sb: ServiceClient, lines: DeliveryLineInput[]): Promise<ResolvedLines> {
  if (!Array.isArray(lines) || lines.length === 0) throw new ReceivingError(400, "no_lines", "At least one line is required");
  for (const l of lines) {
    if (!Number.isFinite(l.qtyReceived) || l.qtyReceived <= 0) throw new ReceivingError(400, "invalid_qty", "Quantity must be positive");
    if (l.unitPrice != null && (!Number.isFinite(l.unitPrice) || l.unitPrice <= 0)) throw new ReceivingError(400, "invalid_price", "Price must be positive");
    if (l.observedOzPerEach != null && (!Number.isFinite(l.observedOzPerEach) || l.observedOzPerEach <= 0)) throw new ReceivingError(400, "invalid_observed", "Observed oz must be positive");
    if (l.expectedQty != null && (!Number.isFinite(l.expectedQty) || l.expectedQty < 0)) throw new ReceivingError(400, "invalid_expected", "Expected qty must be zero or greater");
  }
  const skuIds = [...new Set(lines.map((l) => l.skuId))];
  const { data: activeSkus } = await sb.from("vendor_items")
    .select("id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("id", skuIds).eq("active", true)
    .returns<Array<{ id: string; pack_format: string | null; each_container_label: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  const activeSet = new Set((activeSkus ?? []).map((s) => s.id));
  for (const id of skuIds) if (!activeSet.has(id)) throw new ReceivingError(400, "invalid_sku", "A SKU is not found or inactive");

  const [measures, chainsBySku] = await Promise.all([loadMeasures(), loadSkuPackChains(skuIds)]);
  const skuById = new Map((activeSkus ?? []).map((s) => [s.id, s]));
  const chained = new Set([...chainsBySku.entries()].filter(([, lv]) => lv.length > 0).map(([id]) => id));
  const resolvedOzByLineIdx = lines.map((l) => resolveReceivedOz(l, skuById.get(l.skuId), chainsBySku.get(l.skuId) ?? null, measures));
  return { resolvedOzByLineIdx, chained };
}

/** Build the vendor_delivery_items rows for a set of input lines (shared shape for
 *  recordDelivery + addDeliveryLines). resolvedOzByLineIdx is index-aligned with lines. */
function buildLineRows(deliveryId: string, lines: DeliveryLineInput[], resolvedOzByLineIdx: Array<number | null>, createdBy: string) {
  return lines.map((l, i) => ({
    delivery_id: deliveryId, vendor_item_id: l.skuId, qty_received: l.qtyReceived,
    unit_price: l.unitPrice ?? null, observed_oz_per_each: l.observedOzPerEach ?? null,
    notes: l.notes?.trim() || null, created_by: createdBy,
    received_level_label: l.receivedLevelLabel?.trim() || null,
    received_qty_at_level: l.receivedLevelLabel?.trim() ? l.qtyReceived : null,
    resolved_oz: resolvedOzByLineIdx[i] ?? null,
    note: l.notes?.trim() || null,
    photo_url: l.photoUrl?.trim() || null,
    expected_qty: l.expectedQty ?? null,
    discrepancy_type: l.discrepancyType ?? null,
  }));
}

/**
 * Idempotent vendor-credit derivation for a delivery's lines (spec D1). Selects the
 * persisted lines back (so credits key off real delivery_item_ids), feeds the pure
 * deriveCreditDrafts, and UPSERTs into vendor_credits with the 0168 (delivery_item_id,
 * reason) unique index → ignoreDuplicates makes an intake re-run a no-op. On any
 * write error we surface a 500 (credit_write_failed) — a swallowed credit is a real loss.
 */
async function deriveAndUpsertCredits(
  sb: ServiceClient, deliveryId: string, vendorId: string, locationId: string, createdBy: string,
): Promise<void> {
  const { data: itemRows, error: iErr } = await sb.from("vendor_delivery_items")
    .select("id, vendor_item_id, received_qty_at_level, qty_received, expected_qty, unit_price, discrepancy_type")
    .eq("delivery_id", deliveryId)
    .returns<Array<{ id: string; vendor_item_id: string; received_qty_at_level: number | string | null; qty_received: number | string | null; expected_qty: number | string | null; unit_price: number | string | null; discrepancy_type: "short" | "over" | "damaged" | "substitution" | null }>>();
  if (iErr) throw new Error(`deriveAndUpsertCredits select: ${iErr.message}`);
  const forCredits: IntakeLineForCredits[] = (itemRows ?? [])
    .filter((r) => r.discrepancy_type != null)
    .map((r) => ({
      deliveryItemId: r.id,
      skuId: r.vendor_item_id,
      // received_qty_at_level is the level-unit qty when a level was named; fall back to qty_received.
      qtyReceived: num(r.received_qty_at_level) ?? num(r.qty_received) ?? 0,
      expectedQty: num(r.expected_qty),
      unitPrice: num(r.unit_price),
      discrepancyType: r.discrepancy_type,
    }));
  const drafts = deriveCreditDrafts(forCredits);
  if (drafts.length === 0) return;
  const { error: cErr } = await sb.from("vendor_credits").upsert(
    drafts.map((d) => ({
      location_id: locationId, vendor_id: vendorId, delivery_id: deliveryId, delivery_item_id: d.deliveryItemId,
      reason: d.reason, sku_id: d.skuId, qty: d.qty, amount_cents: d.amountCents, created_by: createdBy,
    })),
    { onConflict: "delivery_item_id,reason", ignoreDuplicates: true },
  );
  if (cErr) throw new ReceivingError(500, "credit_write_failed", `Credit write failed: ${cErr.message}`);
}

export async function loadRecentDeliveries(actor: AuthContext, locationId: string, limit = 20): Promise<DeliveryView[]> {
  requireReceive(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ReceivingError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb.from("vendor_deliveries")
    .select("id, vendor_id, delivery_date, invoice_number, received_by, match_state, delivery_status, receipt_url, email_receipt_id, created_at")
    .eq("location_id", locationId).order("delivery_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit)
    .returns<Array<{ id: string; vendor_id: string; delivery_date: string; invoice_number: string | null; received_by: string | null; match_state: DeliveryMatchState; delivery_status: DeliveryStatus; receipt_url: string | null; email_receipt_id: string | null; created_at: string }>>();
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
    matchState: r.match_state, deliveryStatus: r.delivery_status, receiptUrl: r.receipt_url,
    emailReceiptId: r.email_receipt_id, createdAt: r.created_at,
  }));
}

export async function loadDeliveryDetail(actor: AuthContext, deliveryId: string): Promise<DeliveryDetail> {
  requireReceive(actor);
  const sb = getServiceRoleClient();
  const { data: h, error } = await sb.from("vendor_deliveries")
    .select("id, vendor_id, location_id, delivery_date, invoice_number, invoice_total, notes, receipt_url, received_by, match_state, delivery_status, email_receipt_id, created_at")
    .eq("id", deliveryId)
    .maybeSingle<{ id: string; vendor_id: string; location_id: string; delivery_date: string; invoice_number: string | null; invoice_total: number | string | null; notes: string | null; receipt_url: string | null; received_by: string | null; match_state: DeliveryMatchState; delivery_status: DeliveryStatus; email_receipt_id: string | null; created_at: string }>();
  if (error) throw new Error(`loadDeliveryDetail: ${error.message}`);
  if (!h) throw new ReceivingError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), h.location_id)) throw new ReceivingError(404, "not_found", "Delivery not found");
  const { data: lineRows } = await sb.from("vendor_delivery_items").select("vendor_item_id, qty_received, unit_price, observed_oz_per_each, notes, received_level_label, resolved_oz, photo_url, discrepancy_type").eq("delivery_id", deliveryId).order("created_at", { ascending: true }).returns<Array<{ vendor_item_id: string; qty_received: number | string; unit_price: number | string | null; observed_oz_per_each: number | string | null; notes: string | null; received_level_label: string | null; resolved_oz: number | string | null; photo_url: string | null; discrepancy_type: "short" | "over" | "damaged" | "substitution" | null }>>();
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
    matchState: h.match_state, deliveryStatus: h.delivery_status,
    emailReceiptId: h.email_receipt_id, createdAt: h.created_at,
    lines: (lineRows ?? []).map((l) => ({
      skuName: skuName.get(l.vendor_item_id) ?? "(sku)", qtyReceived: num(l.qty_received) ?? 0,
      unitPrice: num(l.unit_price), observedOzPerEach: num(l.observed_oz_per_each), notes: l.notes,
      receivedLevelLabel: l.received_level_label, resolvedOz: num(l.resolved_oz), photoUrl: l.photo_url,
      discrepancyType: l.discrepancy_type,
    })),
  };
}

// ── Last-delivery template (prefill the door form from the vendor's last drop) ──────
export interface LastDeliveryTemplate {
  lines: Array<{ skuId: string; level: string | null; qty: number }>;
}

/**
 * Latest delivery for this vendor+location, projected into a prefill template
 * (skuId + received level + qty in level units). Returns null when the vendor has
 * no prior delivery here. RECEIVE_MIN + location-bind, mirroring the other loaders.
 */
export async function loadLastDeliveryTemplate(
  actor: AuthContext, locationId: string, vendorId: string,
): Promise<LastDeliveryTemplate | null> {
  requireReceive(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ReceivingError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: h, error } = await sb.from("vendor_deliveries")
    .select("id")
    .eq("location_id", locationId).eq("vendor_id", vendorId)
    .order("delivery_date", { ascending: false }).order("created_at", { ascending: false }).limit(1)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`loadLastDeliveryTemplate header: ${error.message}`);
  if (!h) return null;
  const { data: lineRows, error: lErr } = await sb.from("vendor_delivery_items")
    .select("vendor_item_id, received_level_label, received_qty_at_level, qty_received")
    .eq("delivery_id", h.id).order("created_at", { ascending: true })
    .returns<Array<{ vendor_item_id: string; received_level_label: string | null; received_qty_at_level: number | string | null; qty_received: number | string | null }>>();
  if (lErr) throw new Error(`loadLastDeliveryTemplate lines: ${lErr.message}`);
  return {
    lines: (lineRows ?? []).map((l) => ({
      skuId: l.vendor_item_id, level: l.received_level_label,
      qty: num(l.received_qty_at_level) ?? num(l.qty_received) ?? 0,
    })),
  };
}

// ── Open-PO template (top-of-hierarchy prefill from the latest placed PO) ─────────
export interface OpenPoTemplate {
  poId: string;
  displayCode: string;
  lines: Array<{ skuId: string; level: string | null; qty: number }>;
}

/**
 * Latest `placed` PO for this vendor+location, projected into a prefill template.
 * Returns null when no placed PO exists. PLACED-ONLY: a confirmed-but-not-placed PO
 * hasn't been transmitted to the vendor — receiving against it would be premature.
 * Lines with orderQty ≤ 0 are omitted (0-qty lines are "removed" in the draft-edit
 * convention and should not pre-fill the door form). Same RECEIVE_MIN + location-bind
 * gates as the sibling loadLastDeliveryTemplate.
 */
export async function loadOpenPoTemplate(
  actor: AuthContext, locationId: string, vendorId: string,
): Promise<OpenPoTemplate | null> {
  requireReceive(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ReceivingError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();

  // Latest placed PO for this vendor+location (most recently placed).
  const { data: po, error: poErr } = await sb.from("purchase_orders")
    .select("id, display_code")
    .eq("location_id", locationId)
    .eq("vendor_id", vendorId)
    .eq("status", "placed")
    .order("placed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; display_code: string }>();
  if (poErr) throw new Error(`loadOpenPoTemplate po: ${poErr.message}`);
  if (!po) return null;

  const { data: lineRows, error: lErr } = await sb.from("po_lines")
    .select("sku_id, order_qty, order_unit_label")
    .eq("po_id", po.id)
    .order("guide_position_snapshot", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .returns<Array<{ sku_id: string; order_qty: number | string; order_unit_label: string | null }>>();
  if (lErr) throw new Error(`loadOpenPoTemplate lines: ${lErr.message}`);

  const usableLines = (lineRows ?? [])
    .map((l) => ({
      skuId: l.sku_id,
      // The PO stores the ordered unit label (e.g. "case") so the form knows
      // which level to pre-select on the line. It maps to receivedLevelLabel.
      level: l.order_unit_label,
      qty: Number(l.order_qty),
    }))
    .filter((l) => Number.isFinite(l.qty) && l.qty > 0);

  if (usableLines.length === 0) return null;

  return { poId: po.id, displayCode: po.display_code, lines: usableLines };
}

// ── Partial deliveries (build a delivery across multiple visits) ────────────────────

/**
 * Append lines to an IN-PROGRESS delivery (partial-receiving). The delivery must
 * exist, be location-bound to the actor, and carry delivery_status 'in_progress'
 * (409 delivery_complete otherwise — a completed delivery is closed). Reuses the
 * shared validation/oz-resolution path (no duplicated resolution logic), appends the
 * rows, records price history, and derives+upserts credits for the whole delivery
 * (idempotent — prior lines' credits ignoreDuplicate on the unique index).
 */
export async function addDeliveryLines(
  actor: AuthContext, deliveryId: string, lines: DeliveryLineInput[],
): Promise<{ added: number }> {
  requireReceive(actor);
  const sb = getServiceRoleClient();
  const { data: h, error } = await sb.from("vendor_deliveries")
    .select("id, vendor_id, location_id, delivery_date, delivery_status")
    .eq("id", deliveryId)
    .maybeSingle<{ id: string; vendor_id: string; location_id: string; delivery_date: string; delivery_status: string | null }>();
  if (error) throw new Error(`addDeliveryLines header: ${error.message}`);
  if (!h) throw new ReceivingError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), h.location_id)) throw new ReceivingError(404, "not_found", "Delivery not found");
  if (h.delivery_status !== "in_progress") throw new ReceivingError(409, "delivery_complete", "This delivery is complete — reopen or start a new one");

  const resolved = await validateAndResolveDeliveryLines(sb, lines);

  // Double-submit guard (P1 pragmatic window): a network retry / double-tap on the
  // append route would duplicate every line (and each dup spawns its own credit).
  // If the incoming batch is an EXACT multiset match of a batch already appended to
  // THIS delivery in the last 60s, reject it. No UI drives this route yet
  // (continue-mode deferred); a proper client idempotency token ships with that UI.
  const appendCutoff = new Date(Date.now() - 60_000).toISOString();
  const { data: recentRows, error: rErr } = await sb.from("vendor_delivery_items")
    .select("vendor_item_id, received_level_label, received_qty_at_level, qty_received")
    .eq("delivery_id", h.id).gte("created_at", appendCutoff)
    .returns<Array<{ vendor_item_id: string; received_level_label: string | null; received_qty_at_level: number | string | null; qty_received: number | string | null }>>();
  if (rErr) throw new Error(`addDeliveryLines recent: ${rErr.message}`);
  const recentAppend: AppendLine[] = (recentRows ?? []).map((r) => ({
    skuId: r.vendor_item_id, level: r.received_level_label,
    qty: num(r.received_qty_at_level) ?? num(r.qty_received) ?? 0,
  }));
  const incomingAppend: AppendLine[] = lines.map((l) => ({
    skuId: l.skuId, level: l.receivedLevelLabel?.trim() || null, qty: l.qtyReceived,
  }));
  if (isDuplicateAppend(incomingAppend, recentAppend)) {
    throw new ReceivingError(409, "duplicate_append", "These lines were just added to this delivery — refresh before appending again.");
  }

  const { error: lErr } = await sb.from("vendor_delivery_items").insert(
    buildLineRows(h.id, lines, resolved.resolvedOzByLineIdx, actor.user.id),
  );
  if (lErr) throw new Error(`addDeliveryLines lines: ${lErr.message}`);

  const priced = lines.filter((l) => l.unitPrice != null);
  if (priced.length > 0) {
    const { error: pErr } = await sb.from("vendor_price_history").insert(
      priced.map((l) => ({ vendor_item_id: l.skuId, unit_price: l.unitPrice, effective_date: h.delivery_date, recorded_by: actor.user.id })),
    );
    if (pErr) throw new Error(`addDeliveryLines prices: ${pErr.message}`);
  }

  await deriveAndUpsertCredits(sb, h.id, h.vendor_id, h.location_id, actor.user.id);

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "delivery.received", resourceTable: "vendor_deliveries", resourceId: h.id,
    metadata: { location_id: h.location_id, added_lines: lines.length, partial: true },
    ipAddress: null, userAgent: null,
  });

  return { added: lines.length };
}

/**
 * Flip an in-progress delivery to 'complete'. Location-bound; checks rowcount
 * (silent-UPDATE law) and 404s on zero rows. When the delivery is linked to a
 * placed PO (purchase_order_id set), advances the PO to `received` after the
 * status flip (spec §3 — partial deliveries keep the PO at placed until complete).
 */
export async function completeDelivery(actor: AuthContext, deliveryId: string): Promise<void> {
  requireReceive(actor);
  const sb = getServiceRoleClient();
  const { data: h, error } = await sb.from("vendor_deliveries")
    .select("id, location_id, delivery_status, purchase_order_id")
    .eq("id", deliveryId)
    .maybeSingle<{ id: string; location_id: string; delivery_status: string | null; purchase_order_id: string | null }>();
  if (error) throw new Error(`completeDelivery load: ${error.message}`);
  if (!h) throw new ReceivingError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), h.location_id)) throw new ReceivingError(404, "not_found", "Delivery not found");
  if (h.delivery_status === "complete") throw new ReceivingError(409, "already_complete", "This delivery is already complete");
  const { error: uErr, count } = await sb.from("vendor_deliveries")
    .update({ delivery_status: "complete" }, { count: "exact" })
    .eq("id", deliveryId);
  if (uErr) throw new Error(`completeDelivery update: ${uErr.message}`);
  if (count === 0) throw new ReceivingError(404, "not_found", "Delivery not found");

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "delivery.completed", resourceTable: "vendor_deliveries", resourceId: deliveryId,
    metadata: { location_id: h.location_id, purchase_order_id: h.purchase_order_id },
    ipAddress: null, userAgent: null,
  });

  // Advance the linked PO to `received` now that the delivery is complete.
  // advanceToReceived is a silent no-op when the PO is already received (race-safe).
  if (h.purchase_order_id) {
    await advanceToReceived(sb, h.purchase_order_id);
  }
}
