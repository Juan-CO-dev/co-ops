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
 * is GATED: we only fold an observation into the SKU-level average when the
 * line's entered level is the SKU's LEGACY each/no-chain semantics — i.e. the SKU
 * has NO active pack chain. For a CHAINED SKU observed at some level, the mean
 * would corrupt the count/volume-leaf avg the chain depends on, so we DO NOT touch
 * avg_oz_per_each — the observation is level-scoped and persisted on the line
 * (via observed_oz_per_each + received_level_label). We NEVER mutate
 * sku_pack_levels from receiving.
 *
 * ── A2 PROVENANCE GATE (2026-08-29, the second half of that same fold) ─────────
 * The fold also answers to migration 0179's provenance quartet, which landed after
 * it: a fold now REFUSES to overwrite a weight class it may not overrule (today,
 * `OPERATIONAL` — a GM's scale reading, written at WEIGHT_WRITE_MIN = 7 while this
 * door runs at RECEIVE_MIN = 4), and when it DOES write it stamps the quartet so
 * the weight board attributes the number to the fold instead of to whoever last
 * weighed the SKU. `disposeAvgFold` (lib/receiving-shared.ts) is the one place
 * that policy lives; the long why is in its comment block.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { loadMeasures, loadSkuPackChains } from "@/lib/prep-consumption";
import { ozForRecipeInput, skuContentOz, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import {
  AVG_FOLD_WEIGHT_CLASS,
  avgFoldSourceNote,
  deriveCreditDrafts,
  deriveMissingCreditDrafts,
  disposeAvgFold,
  findVendorMismatch,
  isDuplicateAppend,
  type AppendLine,
  type IntakeLineForCredits,
  type MissingExpectedLine,
} from "@/lib/receiving-shared";
import { advanceToReceived } from "@/lib/purchase-orders";
import { resolveCreditsRedelivered, loadOpenCreditRowsForVendor, type OpenCreditRow } from "@/lib/credits";

export const RECEIVE_MIN = 4; // key_holder+

/**
 * Trailing window, in days, for the invoice-derived `avg_oz_per_each` fold.
 *
 * MIRRORS `USAGE_WINDOW_DAYS` in lib/weights.ts (30), deliberately and by the same
 * reasoning it states: a weight belief wants RECENT evidence, not lifetime evidence, or a
 * pack the vendor stopped shipping outvotes the one on today's truck forever. The value is
 * MIRRORED rather than imported because lib/weights.ts is a heavy `server-only` board
 * module and the 6 AM receiving path should not pull it in for one integer;
 * `tests/receiving-fold-window.test.ts` asserts the two numbers stay equal, so the mirror
 * cannot drift silently.
 *
 * LEAD-APPROVED DESIGN CALL, stated for veto at merge: the audit named the unbounded mean
 * as a weight-arc design question rather than a wiring fix, and this arc's brief
 * pre-approved the flag's own suggested remedy. It changes a live number the moment a SKU
 * has observations older than 30 days — today exactly ONE observed_oz_per_each line exists
 * in all of prod history (PR #299's read-only probe), so the immediate blast radius is nil.
 */
const OBSERVED_FOLD_WINDOW_DAYS = 30;

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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  /**
   * V2-D4 redelivery closure: ids of the vendor's OPEN credits this delivery makes up
   * ("makes up a short"). AFTER the delivery is durably recorded, each is closed
   * `resolved_redelivered` with resolved_by_delivery_id = the new delivery (KH+ gate,
   * evidence-backed by the delivery itself). Best-effort: a closure failure NEVER
   * fails the intake (walk-data-sacred) — it surfaces as creditClosureError on the
   * result. Empty/absent = no closure attempted.
   */
  makeUpCreditIds?: string[];
  /**
   * MISSING-ITEM HONESTY GATE: expected items the operator marked SHORT at the door
   * because they never came off the truck. These carry NO delivery line — nothing
   * physically arrived, and a delivery line cannot say so (`qty_received > 0` CHECK,
   * migration 0100; validateAndResolveDeliveryLines rejects qty <= 0). Each becomes a
   * line-less open `short` credit against THIS delivery (full constraint note on
   * MissingExpectedLine in lib/receiving-shared.ts).
   *
   * PO-LINKED ONLY (enforced in recordDelivery, 400 `missing_requires_po`): an
   * expectation only becomes a vendor DEBT when the vendor was actually ordered the
   * item. A last-delivery prefill is "what they usually bring", not an order — filing
   * a credit off it would invent a debt, so the server refuses it regardless of what
   * the client sends (server = authority).
   */
  missingLines?: MissingExpectedLine[];
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
  /** Linked PO's human code (EM-20260810-BALDOR) — the ONE id thread that starts at the
   *  draft and runs to receiving. null = a walk-in drop with no order behind it. */
  purchaseOrderCode: string | null;
}
export interface DeliveryDetail extends DeliveryView {
  locationId: string;
  /** Linked PO id — powers the cross-link back to the ordering board's panel. */
  purchaseOrderId: string | null;
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
 * How many production ids may ride ONE `.in()` filter. Mirrors lib/dynamic-pars.ts and
 * lib/ordering.ts: 150 uuids is ~5.6 KB of request line against the conservative 8 KB
 * budget (lib/supabase-paginate.ts), comfortably inside the ~220-uuid 414 cliff.
 */
const PRODUCTION_ID_CHUNK = 150;

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
  // PAGED (the PR #63 lesson; mirrors lib/ordering.ts's twin of this function): 30 days
  // of rows overrun the 1000-row cap and a truncated page silently under-ranks. All
  // three reads are order-insensitive sums — `id` (the PK) is the stable total order.
  const prodHdrs = await selectAllRows<{ id: string }>(
    async (from, to) => {
      const { data, error } = await sb.from("productions")
        .select("id")
        .eq("location_id", locationId)
        .is("superseded_at", null).is("revoked_at", null)
        .gt("produced_at", cutoffIso)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ id: string }>>();
      if (error) throw new Error(`loadSkuUsageRank productions: ${error.message}`);
      return { data };
    },
  );
  const prodIds = prodHdrs.map((h) => h.id);
  //
  // ⚠ THE ID LIST IS WINDOWED, NOT SPENT WHOLE — identical to lib/ordering.ts's twin of
  // this function, and to lib/dynamic-pars.ts `loadDemandInputs` before it. 30 days of live
  // productions is unbounded by design, and one `.in()` over the whole list meets the 414
  // request-line cliff at ~220 uuids (lib/supabase-paginate.ts `requestLineBytesForInList`),
  // failing on page 0 with zero rows where `selectAllRows` cannot help — it pages the
  // RESPONSE, not the REQUEST. Disjoint chunks whose union is exactly the one-shot result:
  // no parity question, no behaviour change (order-insensitive sums into the same map).
  //
  // Fixed in the SAME commit as the ordering twin on purpose. That function's header
  // declares the two "mirror ... EXACTLY"; repairing one and leaving the other would make
  // the mirror a lie and leave /receiving carrying the fault /ordering just shed.
  for (let i = 0; i < prodIds.length; i += PRODUCTION_ID_CHUNK) {
    const chunk = prodIds.slice(i, i + PRODUCTION_ID_CHUNK);
    const inputs = await selectAllRows<{ input_sku_id: string; input_oz: number | string | null }>(
      async (from, to) => {
        const { data, error } = await sb.from("production_inputs")
          .select("input_sku_id, input_oz")
          .in("production_id", chunk)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<Array<{ input_sku_id: string; input_oz: number | string | null }>>();
        if (error) throw new Error(`loadSkuUsageRank production_inputs: ${error.message}`);
        return { data };
      },
    );
    for (const r of inputs) add(r.input_sku_id, num(r.input_oz) ?? 0);
  }

  // Sales direct lane — the materialized depletion ledger over the window (0166).
  const sales = await selectAllRows<{ sku_id: string; direct_oz: number | string }>(
    async (from, to) => {
      const { data, error } = await sb.from("toast_daily_depletion")
        .select("sku_id, direct_oz")
        .eq("location_id", locationId)
        .gte("business_date", cutoffDate)
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ sku_id: string; direct_oz: number | string }>>();
      if (error) throw new Error(`loadSkuUsageRank toast_daily_depletion: ${error.message}`);
      return { data };
    },
  );
  for (const r of sales) add(r.sku_id, num(r.direct_oz) ?? 0);

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

export interface RecordDeliveryResult {
  deliveryId: string;
  /** V2-D4: credit ids closed `resolved_redelivered` by this delivery. */
  resolvedCredits: string[];
  /** V2-D4: credit ids that could not close (raced/already-resolved/mismatched). */
  skippedCredits: string[];
  /** V2-D4: true when the closure PASS itself errored (best-effort; the intake still
   *  succeeded). The form shows a non-blocking advisory. */
  creditClosureError: boolean;
}

export async function recordDelivery(actor: AuthContext, input: RecordDeliveryInput): Promise<RecordDeliveryResult> {
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
    // `invoiced` is receivable: V2's inbound-email leg flips placed→invoiced when the
    // vendor's invoice lands BEFORE the truck (routine for Baldor/Boar's Head). The
    // paperwork arriving first must never lock the door ceremony out of its own PO.
    if (po.status !== "placed" && po.status !== "invoiced") {
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

  const resolved = await validateAndResolveDeliveryLines(sb, input.lines, input.vendorId);

  // Missing-item honesty gate (PO-LINKED ONLY). An expectation is a vendor DEBT only when
  // the vendor was ordered the item; a last-delivery prefill is a habit, not an order. The
  // form only offers the affordance on a PO-linked intake — this is the enforcement.
  const missingExpected = input.missingLines ?? [];
  if (missingExpected.length > 0 && !poId) {
    throw new ReceivingError(400, "missing_requires_po", "Missing-item shorts can only be filed against a purchase order");
  }

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
    buildLineRows(header.id, input.lines, resolved.resolvedOzByLineIdx, actor.user.id, resolved.vendorIdBySku),
  );
  if (lErr) throw new Error(`recordDelivery lines: ${lErr.message}`);

  // Idempotent vendor credits from any discrepancy-flagged lines (spec D1: the
  // intake unit_price is the credit price authority). Retry-safe via an app-side pre-read
  // of the existing (delivery_item_id, reason) pairs, backed by the 0168 partial unique
  // index — a derive that loses the race gets 23505 and no-ops.
  await deriveAndUpsertCredits(sb, header.id, input.vendorId, input.locationId, actor.user.id);

  // Line-less `short` credits for ordered items that never came off the truck. Filed
  // right beside the lined credits so both halves of "what the vendor owes us for this
  // drop" land in the same write phase.
  const missingCreditCount = await insertMissingExpectedCredits(
    sb, header.id, input.vendorId, input.locationId,
    missingExpected, new Set(input.lines.map((l) => l.skuId)), actor.user.id,
  );

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
  //
  // AND it answers to the provenance quartet (0179): `disposeAvgFold` refuses a SKU
  // whose live weight_class this door may not overrule, and a fold that DOES run
  // stamps class + note + established_at/_by so the weight board never attributes a
  // delivery average to the person who last put the SKU on a scale.
  const observedSkuIds = [...new Set(input.lines.filter((l) => l.observedOzPerEach != null).map((l) => l.skuId))];
  const avgUpdated: string[] = [];
  const avgSkippedChained: string[] = [];
  const avgSkippedProtected: string[] = [];
  const avgSkippedMissing: string[] = [];
  for (const id of observedSkuIds) {
    const disposition = disposeAvgFold({
      chained: resolved.chained.has(id),
      liveWeightClass: resolved.weightClassBySku.get(id) ?? null,
    });
    if (disposition === "SKIP_CHAINED") { avgSkippedChained.push(id); continue; }
    // A measured-here weight is PRESENTED, never overwritten (lib/tub-weights.ts's
    // CONFLICT_PRESENT_ONLY). The line's observed_oz_per_each is already persisted
    // above, so the weight board's invoice-drift advisory renders the disagreement —
    // which it could not do while the fold kept overwriting the believed value with
    // the observed mean and driving the delta to a permanent 0.
    if (disposition === "SKIP_PROTECTED_CLASS") { avgSkippedProtected.push(id); continue; }
    // THE MEAN IS BOUNDED TO A TRAILING WINDOW (audit flag, PR #299 → this cleanup arc).
    // It used to span EVERY historical observation, so a year-old invoice weight never
    // aged out and a vendor who changed their pack a season ago kept dragging the number
    // toward a fact that stopped being true. `created_at` is the lot instant (the same
    // column FIFO attribution uses, AGENTS.md § Product identity), so no join is needed.
    //
    // The current delivery's own lines were inserted above, before this loop, so the
    // window always contains at least this observation — bounding can never turn the fold
    // into a silent no-op, it can only stop old evidence outvoting new.
    const foldWindowStart = new Date(Date.now() - OBSERVED_FOLD_WINDOW_DAYS * 86_400_000).toISOString();
    const { data: obs } = await sb.from("vendor_delivery_items").select("observed_oz_per_each").eq("vendor_item_id", id).not("observed_oz_per_each", "is", null).gte("created_at", foldWindowStart).returns<Array<{ observed_oz_per_each: number | string }>>();
    const vals = (obs ?? []).map((o) => num(o.observed_oz_per_each)).filter((v): v is number => v != null);
    if (vals.length === 0) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const foldAt = new Date().toISOString();
    const { error: uErr, count } = await sb.from("vendor_items").update({
      avg_oz_per_each: mean,
      // The quartet moves WITH the number, always — a value whose provenance columns
      // describe a different value is the defect this branch was written to end.
      weight_class: AVG_FOLD_WEIGHT_CLASS,
      weight_source_note: avgFoldSourceNote(vals.length),
      weight_established_at: foldAt,
      weight_established_by: actor.user.id,
      updated_by: actor.user.id,
      updated_at: foldAt,
    }, { count: "exact" }).eq("id", id);
    if (uErr) throw new Error(`recordDelivery avg update: ${uErr.message}`);
    // Silent-UPDATE law: rowcount is the only signal. 0 here means the SKU vanished
    // between validation and this write — recorded in the audit row rather than
    // thrown, because the delivery is already durably written and a bookkeeping
    // refinement must never fail an intake the manager already counted.
    if (count === 0) { avgSkippedMissing.push(id); continue; }
    avgUpdated.push(id);
  }

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "delivery.received", resourceTable: "vendor_deliveries", resourceId: header.id,
    // avg_skipped_protected = SKUs whose weight_class this door may not overrule.
    // It is the forensic answer to "why didn't the average move after that intake",
    // and the only record that the disagreement exists at all.
    metadata: { vendor_id: input.vendorId, location_id: input.locationId, line_count: input.lines.length, priced_lines: priced.length, avg_oz_updated: avgUpdated, avg_skipped_chained: avgSkippedChained, avg_skipped_protected: avgSkippedProtected, avg_skipped_missing: avgSkippedMissing, purchase_order_id: poId, missing_expected_credits: missingCreditCount },
    ipAddress: null, userAgent: null,
  });

  // Advance the linked PO to `received` when the delivery is complete (spec §3).
  // For in_progress deliveries the PO stays at placed until completeDelivery fires.
  if (poId && (input.deliveryStatus ?? "complete") === "complete") {
    await advanceToReceived(sb, poId);
  }

  // ── V2-D4 REDELIVERY CLOSURE (best-effort, walk-data-sacred) ─────────────────
  // The delivery is now durably recorded (header + lines + credits + audit above).
  // Close any credits this truck makes up. This runs LAST and in try/catch: a
  // closure failure must NEVER fail an intake that already succeeded — the manager's
  // count is sacred. Failure → creditClosureError flag + console.error; the credit
  // stays open for a later manual resolve.
  let resolvedCredits: string[] = [];
  let skippedCredits: string[] = [];
  let creditClosureError = false;
  const makeUpIds = input.makeUpCreditIds ?? [];
  if (makeUpIds.length > 0) {
    try {
      const closure = await resolveCreditsRedelivered(actor, header.id, makeUpIds);
      resolvedCredits = closure.resolved;
      skippedCredits = closure.skipped;
    } catch (e) {
      creditClosureError = true;
      console.error(`recordDelivery credit closure failed (delivery ${header.id}):`, e instanceof Error ? e.message : e);
    }
  }

  return { deliveryId: header.id, resolvedCredits, skippedCredits, creditClosureError };
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
  /**
   * Each referenced SKU's LIVE `weight_class` (0179's provenance quartet), null when
   * the row carries none. Read here rather than in the fold loop because this select
   * already touches every referenced SKU — a second round trip for a column one
   * query away is the per-node read the loadRecipeGraph law exists to prevent.
   */
  weightClassBySku: Map<string, string | null>;
  /**
   * Each referenced SKU's OWN vendor_id (P3) — persisted onto the line so migration
   * 0178's composite FKs can hold the binding at the DB floor. Deliberately the SKU's
   * vendor, not the delivery's: for a vendorless SKU this is null, which is exactly
   * what makes the MATCH SIMPLE FKs skip the (unbindable) row instead of rejecting it.
   * The guard above has already proven a non-null value equals the delivery's vendor.
   */
  vendorIdBySku: Map<string, string | null>;
}

/**
 * Shared line-validation + oz-resolution path for recordDelivery AND addDeliveryLines
 * (item 6 — one resolution path, no duplication). Validates each line's qty/price/
 * observed, confirms every referenced SKU is active, then batch-loads measures +
 * chains once (loadRecipeGraph law) and resolves each line's received oz (council L3).
 * Throws ReceivingError on any validation failure; the caller owns the header/insert.
 *
 * MULTI-VENDOR AUDIT P3: `deliveryVendorId` binds every line to the truck that brought
 * it. The picker's vendor scoping is browser-side UX; THIS is the enforcement (see
 * findVendorMismatch in receiving-shared for the null-tolerance rule and the why).
 */
async function validateAndResolveDeliveryLines(
  sb: ServiceClient, lines: DeliveryLineInput[], deliveryVendorId: string | null,
): Promise<ResolvedLines> {
  if (!Array.isArray(lines) || lines.length === 0) throw new ReceivingError(400, "no_lines", "At least one line is required");
  for (const l of lines) {
    if (!Number.isFinite(l.qtyReceived) || l.qtyReceived <= 0) throw new ReceivingError(400, "invalid_qty", "Quantity must be positive");
    if (l.unitPrice != null && (!Number.isFinite(l.unitPrice) || l.unitPrice <= 0)) throw new ReceivingError(400, "invalid_price", "Price must be positive");
    if (l.observedOzPerEach != null && (!Number.isFinite(l.observedOzPerEach) || l.observedOzPerEach <= 0)) throw new ReceivingError(400, "invalid_observed", "Observed oz must be positive");
    if (l.expectedQty != null && (!Number.isFinite(l.expectedQty) || l.expectedQty < 0)) throw new ReceivingError(400, "invalid_expected", "Expected qty must be zero or greater");
  }
  const skuIds = [...new Set(lines.map((l) => l.skuId))];
  const { data: activeSkus } = await sb.from("vendor_items")
    .select("id, vendor_id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each, weight_class")
    .in("id", skuIds).eq("active", true)
    .returns<Array<{ id: string; vendor_id: string | null; pack_format: string | null; each_container_label: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null; weight_class: string | null }>>();
  const activeSet = new Set((activeSkus ?? []).map((s) => s.id));
  for (const id of skuIds) if (!activeSet.has(id)) throw new ReceivingError(400, "invalid_sku", "A SKU is not found or inactive");

  // PRODUCT RETIREMENT DOES NOT REACH HERE, DELIBERATELY (Juan's ruling, 2026-08-21).
  //
  // This gate reads `vendor_items.active`, and retiring a PRODUCT does not deactivate
  // its member SKUs — so a truck carrying the last case of a discontinued product
  // still receives normally, which is the point: BURNING DOWN A FINAL ORDER IS REAL,
  // and refusing the door would strand paid-for stock outside the ledger. The
  // retirement effect lives one step upstream, in the par pass, which stops
  // SUGGESTING the product (loadWalkerData's `productRetired` lane). Ordering stops;
  // receiving what was already ordered does not.
  //
  // NO WARNING BADGE YET, and that is a scope call rather than an oversight: neither
  // this module nor lib/purchase-orders.ts reads `products` at all, so a "belongs to a
  // discontinued product" notice is a NEW loader integration on two product-unaware
  // modules, not a widening of an existing read. Filed as debt in docs/ROADMAP.md;
  // zero live triggers today (no product is retired).

  // Vendor binding (P3) — a line for another vendor's twin would write this delivery's
  // price + observed-oz onto a SKU the truck never carried.
  const mismatch = findVendorMismatch(deliveryVendorId, (activeSkus ?? []).map((s) => ({ id: s.id, vendorId: s.vendor_id })));
  if (mismatch) {
    throw new ReceivingError(400, "sku_vendor_mismatch", "An item belongs to a different vendor than this delivery");
  }

  const [measures, chainsBySku] = await Promise.all([loadMeasures(), loadSkuPackChains(skuIds)]);
  const skuById = new Map((activeSkus ?? []).map((s) => [s.id, s]));
  const chained = new Set([...chainsBySku.entries()].filter(([, lv]) => lv.length > 0).map(([id]) => id));
  const resolvedOzByLineIdx = lines.map((l) => resolveReceivedOz(l, skuById.get(l.skuId), chainsBySku.get(l.skuId) ?? null, measures));
  const vendorIdBySku = new Map((activeSkus ?? []).map((s) => [s.id, s.vendor_id]));
  const weightClassBySku = new Map((activeSkus ?? []).map((s) => [s.id, s.weight_class]));
  return { resolvedOzByLineIdx, chained, vendorIdBySku, weightClassBySku };
}

/** Build the vendor_delivery_items rows for a set of input lines (shared shape for
 *  recordDelivery + addDeliveryLines). resolvedOzByLineIdx is index-aligned with lines.
 *  vendorIdBySku carries each SKU's own vendor onto the row (P3 / migration 0178). */
function buildLineRows(deliveryId: string, lines: DeliveryLineInput[], resolvedOzByLineIdx: Array<number | null>, createdBy: string, vendorIdBySku: Map<string, string | null>) {
  return lines.map((l, i) => ({
    delivery_id: deliveryId, vendor_item_id: l.skuId, qty_received: l.qtyReceived,
    vendor_id: vendorIdBySku.get(l.skuId) ?? null,
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
 * deriveCreditDrafts, and inserts the drafts that are not already filed.
 *
 * IDEMPOTENCY IS APP-SIDE, WITH THE INDEX AS THE BACKSTOP. There is no upsert: the SIM-6
 * find (2026-08-11) was that `vendor_credits_line_reason_uq` (0168) is a PARTIAL unique
 * index, Postgres refuses a partial index as a bare ON CONFLICT arbiter, and supabase-js
 * cannot emit the index predicate — so the upsert 500'd on every lined-discrepancy credit
 * while the delivery itself saved. The pre-read replaced it, and the index still enforces
 * the pair, so a CONCURRENT or repeated derive can lose the race and get 23505. That is
 * the row the pre-read wanted: it no-ops (audit v2 F10). Every other write error surfaces
 * a 500 (credit_write_failed) — a swallowed credit is a real loss.
 *
 * KNOWN, NOT FIXED HERE: the recordDelivery path is not self-healing. A credit-write 500
 * at that call site leaves the delivery + lines durable, and a retry hits
 * `vendor_deliveries_dedupe_uq` → 409 duplicate_delivery, so the credits are never
 * re-derived. That needs a re-derive affordance, and it is a named follow-up.
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
  // SIM-DAY FIND (2026-08-11, P1 — live since V1): vendor_credits_line_reason_uq is a
  // PARTIAL unique index (WHERE delivery_item_id IS NOT NULL) and Postgres refuses a
  // partial index as a bare ON CONFLICT (cols) arbiter — so this upsert 500'd on EVERY
  // lined-discrepancy credit while the delivery itself saved (operator saw
  // credit_write_failed; the vendor debt was silently lost). supabase-js cannot emit
  // the index predicate, so idempotency moves app-side: read existing (line, reason)
  // pairs for this delivery, insert only the missing drafts. Same re-run no-op
  // semantics the upsert intended.
  const { data: existingRows, error: exErr } = await sb.from("vendor_credits")
    .select("delivery_item_id, reason")
    .eq("delivery_id", deliveryId)
    .not("delivery_item_id", "is", null)
    .returns<Array<{ delivery_item_id: string; reason: string }>>();
  if (exErr) throw new ReceivingError(500, "credit_write_failed", `Credit pre-read failed: ${exErr.message}`);
  const have = new Set((existingRows ?? []).map((r) => `${r.delivery_item_id}|${r.reason}`));
  const toInsert = drafts.filter((d) => !have.has(`${d.deliveryItemId}|${d.reason}`));
  if (toInsert.length === 0) return;
  const { error: cErr } = await sb.from("vendor_credits").insert(
    toInsert.map((d) => ({
      location_id: locationId, vendor_id: vendorId, delivery_id: deliveryId, delivery_item_id: d.deliveryItemId,
      reason: d.reason, sku_id: d.skuId, qty: d.qty, amount_cents: d.amountCents, created_by: createdBy,
    })),
  );
  if (cErr) {
    // 23505 IS THE STATE THE PRE-READ WAS LOOKING FOR (audit v2 F10, BC-037). The read
    // above is a check-then-act and `vendor_credits_line_reason_uq` (0168) is still
    // enforced, so two derives against ONE delivery — reachable via addDeliveryLines, which
    // appends to an in-progress delivery and then re-derives credits for the WHOLE delivery
    // — both see an empty `have` and the loser trips the index. Raising credit_write_failed
    // for that re-raises the exact 500 the SIM-6 fix was written to remove, on a delivery
    // whose own lines already committed. The row exists; that is the desired outcome, so
    // the only honest answer is a no-op. Every OTHER error still throws.
    if (cErr.code === "23505") return;
    throw new ReceivingError(500, "credit_write_failed", `Credit write failed: ${cErr.message}`);
  }
}

/**
 * Validate the missing-expected batch and file its line-less `short` credits (the door's
 * missing-item honesty gate). Runs AFTER the delivery header + lines exist, alongside
 * deriveAndUpsertCredits, so the credit's `delivery_id` points at the truck that came
 * without the item.
 *
 * VALIDATION (server = authority — the form's own gating is UX, not enforcement):
 *   • every skuId must name an ACTIVE vendor_item (mirrors validateAndResolveDeliveryLines)
 *   • expectedQty > 0 and finite; unitPrice, when given, > 0 and finite
 *   • a SKU that ALSO has a real delivery line is dropped: it arrived, so the lined
 *     discrepancy path owns it (and a double credit for one SKU would be a false debt)
 *   • duplicate skuIds collapse to one credit
 *
 * IDEMPOTENCY NOTE: the 0168 unique index is `(delivery_item_id, reason) WHERE
 * delivery_item_id IS NOT NULL`, so these line-less rows have no index-level dedupe.
 * The protection is one level up: they are written exactly once, inside the same
 * recordDelivery call that CREATED the delivery, and a retry of that call is stopped by
 * the delivery dedupe guard + vendor_deliveries_dedupe_uq (0169).
 *
 * A write failure THROWS (500 credit_write_failed) — mirroring deriveAndUpsertCredits,
 * because a swallowed credit is a real loss.
 */
async function insertMissingExpectedCredits(
  sb: ServiceClient,
  deliveryId: string,
  vendorId: string,
  locationId: string,
  missing: MissingExpectedLine[],
  deliveredSkuIds: Set<string>,
  createdBy: string,
): Promise<number> {
  if (missing.length === 0) return 0;
  for (const m of missing) {
    if (typeof m.skuId !== "string" || m.skuId === "") throw new ReceivingError(400, "invalid_missing_sku", "A missing item named no SKU");
    if (!Number.isFinite(m.expectedQty) || m.expectedQty <= 0) throw new ReceivingError(400, "invalid_expected", "Expected qty must be greater than zero");
    if (m.unitPrice != null && (!Number.isFinite(m.unitPrice) || m.unitPrice <= 0)) throw new ReceivingError(400, "invalid_price", "Price must be positive");
  }
  // Drop anything that actually arrived, then collapse duplicates (first wins).
  const bySku = new Map<string, MissingExpectedLine>();
  for (const m of missing) {
    if (deliveredSkuIds.has(m.skuId)) continue;
    if (!bySku.has(m.skuId)) bySku.set(m.skuId, m);
  }
  const usable = [...bySku.values()];
  if (usable.length === 0) return 0;

  const skuIds = usable.map((m) => m.skuId);
  const { data: activeSkus, error: sErr } = await sb.from("vendor_items")
    .select("id, vendor_id").in("id", skuIds).eq("active", true)
    .returns<Array<{ id: string; vendor_id: string | null }>>();
  if (sErr) throw new Error(`insertMissingExpectedCredits skus: ${sErr.message}`);
  const activeSet = new Set((activeSkus ?? []).map((s) => s.id));
  for (const id of skuIds) if (!activeSet.has(id)) throw new ReceivingError(400, "invalid_sku", "A SKU is not found or inactive");

  // Vendor binding (P3) — mirrors validateAndResolveDeliveryLines. A short credit is a
  // DEBT claim against `vendorId`; claiming another vendor's twin invents a debt the
  // named vendor never owed.
  const mismatch = findVendorMismatch(vendorId, (activeSkus ?? []).map((s) => ({ id: s.id, vendorId: s.vendor_id })));
  if (mismatch) {
    throw new ReceivingError(400, "sku_vendor_mismatch", "A missing item belongs to a different vendor than this delivery");
  }

  const drafts = deriveMissingCreditDrafts(usable);
  const { error: cErr } = await sb.from("vendor_credits").insert(
    drafts.map((d) => ({
      location_id: locationId, vendor_id: vendorId, delivery_id: deliveryId,
      // NULL by construction: nothing arrived, so there is no vendor_delivery_items row
      // to point at (the column is nullable per 0168).
      delivery_item_id: null,
      reason: d.reason, sku_id: d.skuId, qty: d.qty, amount_cents: d.amountCents, created_by: createdBy,
    })),
  );
  if (cErr) throw new ReceivingError(500, "credit_write_failed", `Missing-item credit write failed: ${cErr.message}`);
  return drafts.length;
}

export async function loadRecentDeliveries(actor: AuthContext, locationId: string, limit = 20): Promise<DeliveryView[]> {
  requireReceive(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ReceivingError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb.from("vendor_deliveries")
    .select("id, vendor_id, delivery_date, invoice_number, received_by, match_state, delivery_status, receipt_url, email_receipt_id, created_at, purchase_order_id")
    .eq("location_id", locationId).order("delivery_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit)
    .returns<Array<{ id: string; vendor_id: string; delivery_date: string; invoice_number: string | null; received_by: string | null; match_state: DeliveryMatchState; delivery_status: DeliveryStatus; receipt_url: string | null; email_receipt_id: string | null; created_at: string; purchase_order_id: string | null }>>();
  if (error) throw new Error(`loadRecentDeliveries: ${error.message}`);
  const list = rows ?? [];
  if (list.length === 0) return [];
  const vendorIds = [...new Set(list.map((r) => r.vendor_id))];
  const userIds = [...new Set(list.map((r) => r.received_by).filter((v): v is string => v !== null))];
  const deliveryIds = list.map((r) => r.id);
  // PO codes for the id-thread column: ONE batched .in() over the distinct linked POs
  // (never a per-row lookup — loadRecipeGraph law). Empty when nothing on this page is
  // PO-linked, in which case the query is skipped entirely.
  const poIds = [...new Set(list.map((r) => r.purchase_order_id).filter((v): v is string => v !== null))];
  const [{ data: vs }, { data: us }, { data: lines }, { data: pos, error: pErr }] = await Promise.all([
    sb.from("vendors").select("id, name").in("id", vendorIds).returns<Array<{ id: string; name: string }>>(),
    userIds.length ? sb.from("users").select("id, name").in("id", userIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    sb.from("vendor_delivery_items").select("delivery_id").in("delivery_id", deliveryIds).returns<Array<{ delivery_id: string }>>(),
    poIds.length
      ? sb.from("purchase_orders").select("id, display_code").in("id", poIds).returns<Array<{ id: string; display_code: string }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; display_code: string }>, error: null }),
  ]);
  if (pErr) throw new Error(`loadRecentDeliveries purchase_orders: ${pErr.message}`);
  const vName = new Map((vs ?? []).map((v) => [v.id, v.name]));
  const uName = new Map((us ?? []).map((u) => [u.id, u.name]));
  const poCode = new Map((pos ?? []).map((p) => [p.id, p.display_code]));
  const lineCount = new Map<string, number>();
  for (const l of lines ?? []) lineCount.set(l.delivery_id, (lineCount.get(l.delivery_id) ?? 0) + 1);
  return list.map((r) => ({
    id: r.id, vendorName: vName.get(r.vendor_id) ?? "(vendor)", deliveryDate: r.delivery_date,
    invoiceNumber: r.invoice_number, lineCount: lineCount.get(r.id) ?? 0,
    receivedByName: r.received_by ? (uName.get(r.received_by) ?? null) : null,
    matchState: r.match_state, deliveryStatus: r.delivery_status, receiptUrl: r.receipt_url,
    emailReceiptId: r.email_receipt_id, createdAt: r.created_at,
    purchaseOrderCode: r.purchase_order_id != null ? (poCode.get(r.purchase_order_id) ?? null) : null,
  }));
}

export async function loadDeliveryDetail(actor: AuthContext, deliveryId: string): Promise<DeliveryDetail> {
  requireReceive(actor);
  const sb = getServiceRoleClient();
  const { data: h, error } = await sb.from("vendor_deliveries")
    .select("id, vendor_id, location_id, delivery_date, invoice_number, invoice_total, notes, receipt_url, received_by, match_state, delivery_status, email_receipt_id, created_at, purchase_order_id")
    .eq("id", deliveryId)
    .maybeSingle<{ id: string; vendor_id: string; location_id: string; delivery_date: string; invoice_number: string | null; invoice_total: number | string | null; notes: string | null; receipt_url: string | null; received_by: string | null; match_state: DeliveryMatchState; delivery_status: DeliveryStatus; email_receipt_id: string | null; created_at: string; purchase_order_id: string | null }>();
  if (error) throw new Error(`loadDeliveryDetail: ${error.message}`);
  if (!h) throw new ReceivingError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), h.location_id)) throw new ReceivingError(404, "not_found", "Delivery not found");
  const { data: lineRows, error: lErr } = await sb.from("vendor_delivery_items").select("vendor_item_id, qty_received, unit_price, observed_oz_per_each, notes, received_level_label, resolved_oz, photo_url, discrepancy_type").eq("delivery_id", deliveryId).order("created_at", { ascending: true }).returns<Array<{ vendor_item_id: string; qty_received: number | string; unit_price: number | string | null; observed_oz_per_each: number | string | null; notes: string | null; received_level_label: string | null; resolved_oz: number | string | null; photo_url: string | null; discrepancy_type: "short" | "over" | "damaged" | "substitution" | null }>>();
  // A dropped line read renders the delivery with ZERO lines and lineCount 0 — a receipt
  // that reads as reconciled and empty, on the surface used to dispute an invoice.
  if (lErr) throw new Error(`loadDeliveryDetail lines: ${lErr.message}`);
  const [{ data: vend, error: vErr }, { data: rx, error: rxErr }, { data: po, error: poErr }] = await Promise.all([
    sb.from("vendors").select("name").eq("id", h.vendor_id).maybeSingle<{ name: string }>(),
    h.received_by ? sb.from("users").select("name").eq("id", h.received_by).maybeSingle<{ name: string }>() : Promise.resolve({ data: null, error: null }),
    // The id thread: the linked PO's human code, shown on the detail header and used to
    // link back to the ordering board's panel. Null when this was a walk-in drop.
    h.purchase_order_id
      ? sb.from("purchase_orders").select("display_code").eq("id", h.purchase_order_id).maybeSingle<{ display_code: string }>()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (vErr) throw new Error(`loadDeliveryDetail vendor: ${vErr.message}`);
  if (rxErr) throw new Error(`loadDeliveryDetail receiver: ${rxErr.message}`);
  if (poErr) throw new Error(`loadDeliveryDetail purchase_order: ${poErr.message}`);
  const skuIds = [...new Set((lineRows ?? []).map((l) => l.vendor_item_id))];
  const { data: skus, error: sErr } = skuIds.length
    ? await sb.from("vendor_items").select("id, name").in("id", skuIds).returns<Array<{ id: string; name: string }>>()
    : { data: [] as Array<{ id: string; name: string }>, error: null };
  // Lower stakes than the lines (a missed name renders "(sku)") but the same law — and
  // leaving untouched drops inside a fixed function is how this class grew in the first place.
  if (sErr) throw new Error(`loadDeliveryDetail sku names: ${sErr.message}`);
  const skuName = new Map((skus ?? []).map((s) => [s.id, s.name]));
  return {
    id: h.id, vendorName: vend?.name ?? "(vendor)", deliveryDate: h.delivery_date, invoiceNumber: h.invoice_number,
    lineCount: (lineRows ?? []).length, receivedByName: rx?.name ?? null, locationId: h.location_id,
    invoiceTotal: num(h.invoice_total), notes: h.notes, receiptUrl: h.receipt_url,
    matchState: h.match_state, deliveryStatus: h.delivery_status,
    emailReceiptId: h.email_receipt_id, createdAt: h.created_at,
    purchaseOrderId: h.purchase_order_id, purchaseOrderCode: po?.display_code ?? null,
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

  // Latest receivable PO for this vendor+location (most recently placed).
  // `invoiced` included: an invoice email arriving before the truck must not
  // hide the PO from the door ceremony (same law as recordDelivery's guard).
  const { data: po, error: poErr } = await sb.from("purchase_orders")
    .select("id, display_code")
    .eq("location_id", locationId)
    .eq("vendor_id", vendorId)
    .in("status", ["placed", "invoiced"])
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

  // LEVEL CONTRACT (matches the sibling loadLastDeliveryTemplate): the door form's
  // level picker for a SKU is EXACTLY its chain labels (chainLabelsInWalkOrder →
  // ReceivingForm.levelsFor), which is EMPTY for an UNCHAINED SKU. The PO stores
  // order_unit_label = the chain ROOT label for chained SKUs but the SKU's
  // pack_format for UNCHAINED ones (orderUnitLabelFor). Pre-filling a pack_format
  // level on an unchained SKU would seed a value that isn't in the (empty) picker —
  // an orphaned selection, and it would submit received_level_label on a chainless
  // SKU (loadLastDeliveryTemplate correctly nulls that case). So: level =
  // order_unit_label ONLY when the SKU has an active chain (its root label is
  // guaranteed to be the first member of chainLabelsInWalkOrder), else null.
  const poSkuIds = [...new Set((lineRows ?? []).map((l) => l.sku_id))];
  const chainsBySku = await loadSkuPackChains(poSkuIds);
  const isChained = (skuId: string): boolean => (chainsBySku.get(skuId)?.length ?? 0) > 0;

  const usableLines = (lineRows ?? [])
    .map((l) => ({
      skuId: l.sku_id,
      // Chained → the PO's ordered unit label (the chain root) pre-selects that level;
      // unchained → null (no chain, no level picker), matching loadLastDeliveryTemplate.
      level: isChained(l.sku_id) ? l.order_unit_label : null,
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
 * rows, records price history, and re-derives credits for the whole delivery.
 *
 * IDEMPOTENT, BUT NOT THE WAY THIS COMMENT USED TO SAY (audit v2 F10). There is no upsert
 * and no conflict-ignoring clause — both went away with the SIM-6 fix, because
 * `vendor_credits_line_reason_uq` is a PARTIAL index and Postgres refuses one as a bare
 * ON CONFLICT arbiter. Idempotency is `deriveAndUpsertCredits`' app-side pre-read of the
 * existing (line, reason) pairs, backed by that same index: a concurrent or repeated derive
 * that loses the race gets 23505, which the insert treats as a benign no-op.
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

  const resolved = await validateAndResolveDeliveryLines(sb, lines, h.vendor_id);

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
    buildLineRows(h.id, lines, resolved.resolvedOzByLineIdx, actor.user.id, resolved.vendorIdBySku),
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
 * Flip an in-progress delivery to 'complete'. Location-bound; 404s when the delivery
 * doesn't exist or isn't the actor's, 409s when it is already complete (pre-read) or was
 * completed concurrently (guarded rowcount, silent-UPDATE law). When the delivery is linked to a
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
  // Guard on the expected prior status, not just the id (silent-UPDATE law): the row must
  // still be 'in_progress' for THIS call to be the one that completed it. Not-found and
  // already-complete are both ruled out by the pre-read above, so count 0 can only mean a
  // rival completed it between the read and the write → 409, never 404.
  const { error: uErr, count } = await sb.from("vendor_deliveries")
    .update({ delivery_status: "complete" }, { count: "exact" })
    .eq("id", deliveryId)
    .eq("delivery_status", "in_progress");
  if (uErr) throw new Error(`completeDelivery update: ${uErr.message}`);
  if (count === 0) throw new ReceivingError(409, "already_complete", "This delivery is already complete");

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

/**
 * "PHOTO LATER" FINALLY GETS A LATER (Phase-3 UX pair, Juan-approved 2026-08-19).
 *
 * The door ceremony lets an operator submit an intake without the receipt photo;
 * `receipt_url IS NULL` then IS the badge state — "Photo missing" on the receiving
 * list and on the delivery detail header (report-B bug 6). Until now nothing could
 * clear it: the only writer was recordDelivery, at intake time. This is the later.
 *
 * Takes a PHOTO ID, not a URL — the canonical /api/photos/{id} form is built HERE,
 * so no caller can park an arbitrary string in a column the detail page renders as
 * an href. The photo must already exist and be bound to the SAME location as the
 * delivery; a photo from another shop is a 404, never a cross-location link.
 *
 * WRITE-ONCE. A receipt already attached is a 409, not an overwrite — the photo is
 * evidence of what came off the truck, and silently replacing it would destroy the
 * prior attachment with no forensic trail (append-only law; a wrong photo is a
 * different, deliberate correction path). The 409 is decided twice: once on the
 * pre-read for a clear message, and once by the guarded UPDATE (`.is(receipt_url,
 * null)` + exact rowcount) so a rival attach between read and write loses honestly
 * rather than clobbering (silent-UPDATE law).
 *
 * GATE: RECEIVE_MIN (4, KH+) — the same floor lib/email-receipts.ts sets as
 * RECEIPT_MIN for the vendor-claim receipt surfaces. Same value, same operator:
 * whoever may work the door may finish the door's paperwork.
 */
export async function attachDeliveryReceipt(
  actor: AuthContext,
  deliveryId: string,
  photoId: string,
): Promise<{ receiptUrl: string }> {
  requireReceive(actor);
  if (!UUID_RE.test(photoId)) {
    throw new ReceivingError(400, "invalid_photo", "photoId must be a photo registry id");
  }
  const sb = getServiceRoleClient();

  const { data: h, error } = await sb.from("vendor_deliveries")
    .select("id, location_id, receipt_url")
    .eq("id", deliveryId)
    .maybeSingle<{ id: string; location_id: string; receipt_url: string | null }>();
  if (error) throw new Error(`attachDeliveryReceipt load: ${error.message}`);
  if (!h) throw new ReceivingError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), h.location_id)) throw new ReceivingError(404, "not_found", "Delivery not found");
  if (h.receipt_url !== null) {
    throw new ReceivingError(409, "receipt_already_attached", "This delivery already has a receipt photo");
  }

  // Location-bind the PHOTO too. /api/photos/[id] re-checks on every read, so a
  // mismatched link would only ever 404 for its readers — refuse to write it.
  const { data: photo, error: pErr } = await sb.from("photos")
    .select("id, location_id")
    .eq("id", photoId)
    .maybeSingle<{ id: string; location_id: string }>();
  if (pErr) throw new Error(`attachDeliveryReceipt photo load: ${pErr.message}`);
  if (!photo || photo.location_id !== h.location_id) {
    throw new ReceivingError(404, "photo_not_found", "Photo not found");
  }

  const receiptUrl = `/api/photos/${photoId}`;
  const { error: uErr, count } = await sb.from("vendor_deliveries")
    .update({ receipt_url: receiptUrl }, { count: "exact" })
    .eq("id", deliveryId)
    .is("receipt_url", null);
  if (uErr) throw new Error(`attachDeliveryReceipt update: ${uErr.message}`);
  if (count === 0) {
    // Not-found and already-set are both ruled out by the pre-read, so a zero
    // rowcount can only mean a rival attached one first → 409, never 404.
    throw new ReceivingError(409, "receipt_already_attached", "This delivery already has a receipt photo");
  }

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "delivery.receipt_attached", resourceTable: "vendor_deliveries", resourceId: deliveryId,
    metadata: { location_id: h.location_id, photo_id: photoId, receipt_url: receiptUrl },
    ipAddress: null, userAgent: null,
  });

  return { receiptUrl };
}
