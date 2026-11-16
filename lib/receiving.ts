import { loadEffectiveSalesWindow, type SalesCoverage } from "@/lib/toast/effective-depletion";
import { auditOperationalTaskOverride, canDoOperationalTask } from "@/lib/operational-task-access";
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
 * seam, mirroring the checklist photo stub). photoUrl/receiptUrl are accepted only as the
 * canonical `/api/photos/<id>` of a photo at the delivery's shop (bindDeliveryPhotos, W08/B162).
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
import { attemptReceivingAutoLink } from "@/lib/email-receipts";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { trailingEtWindow } from "@/lib/operational-day";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { isPulseReadActor, requirePulseReadScope, type PulseScopedReadActor } from "@/lib/pulse/read-actor";
import { loadMeasures, loadSkuPackChains } from "@/lib/prep-consumption";
import { ozForRecipeInput, skuContentOz, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import {
  AVG_FOLD_WEIGHT_CLASS,
  avgFoldSourceNote,
  deriveLineCreditDrafts,
  deriveMissingCreditDrafts,
  disposeAvgFold,
  findVendorMismatch,
  receivingPriceRows,
  storeRootPackPrice,
  isDuplicateOfAnyBatch,
  photoIdFromRef,
  priorAppendBatches,
  rpcNotInstalled,
  sameInvoiceNumber,
  type AppendLine,
  type DatedAppendLine,
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
  if (isPulseReadActor(actor)) throw new ReceivingError(403, "read_only_actor");
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
  /** W04/B046: `chainLabels[i]` holds `chainCounts[i]` of `chainLabels[i + 1]` (walk order);
   *  empty when the chain is malformed. Lets the door rescale an expectation on a level change. */
  chainCounts?: number[];
  packFormat: string | null;
  /** Trailing-30-day consumed oz for this SKU at this location = production_inputs.input_oz
   *  (live productions) + effective capture sales direct_oz. Higher = more used → ranked first
   *  when a vendor has no last-delivery template. null = no usage in the window (a SKU never
   *  consumed here → not offered as a pre-filled line; only reachable via the Add-item picker). */
  usageRank: number | null;
  /** Product names are aliases for searching the store's all-SKU picker. */
  searchTerms?: string[];
  locationId?: string | null;
  pendingReview?: boolean;
}
export interface ReceivingFormData {
  salesCoverage?: SalesCoverage;
  vendors: Array<{ id: string; name: string; sourceKind: "vendor" | "store" }>;
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
  if (!(await canDoOperationalTask(actor, locationId, "receiving"))) throw new ReceivingError(403, "forbidden");
  const sb = getServiceRoleClient();
  const vendors = await selectAllRows<{ id: string; name: string; source_kind: "vendor" | "store" }>(async (from, to) => {
    const { data, error } = await sb.from("vendors").select("id, name, source_kind")
      .eq("active", true).order("name").order("id").range(from, to);
    if (error) throw new Error(`loadReceivingFormData vendors: ${error.message}`);
    return { data };
  });
  const skuList = await selectAllRows<{ id: string; name: string; vendor_id: string | null; pack_format: string | null; product_id: string | null; location_id: string | null; pending_review: boolean }>(async (from, to) => {
    const { data, error } = await sb.from("vendor_items").select("id, name, vendor_id, pack_format, product_id, location_id, pending_review")
      .eq("active", true).or(`location_id.is.null,location_id.eq.${locationId}`).order("name").order("id").range(from, to);
    if (error) throw new Error(`loadReceivingFormData skus: ${error.message}`);
    return { data };
  });
  const products = await selectAllRows<{ id: string; name: string; name_es: string | null }>(async (from, to) => {
    const { data, error } = await sb.from("products").select("id, name, name_es")
      .eq("active", true).order("id").range(from, to);
    if (error) throw new Error(`loadReceivingFormData products: ${error.message}`);
    return { data };
  });
  const productNames = new Map(products.map((p) => [p.id, [p.name, ...(p.name_es ? [p.name_es] : [])]]));
  // Stores are shared identities, but the picker only exposes stores used here.
  // A newly created store is returned directly by the create endpoint.
  const deliveries: Array<{ id: string; vendor_id: string }> = [];
  const storeIds = vendors.filter((vendor) => vendor.source_kind === "store").map((vendor) => vendor.id);
  for (let start = 0; start < storeIds.length; start += 100) {
    const ids = storeIds.slice(start, start + 100);
    deliveries.push(...await selectAllRows<{ id: string; vendor_id: string }>(async (from, to) => {
      const { data, error } = await sb.from("vendor_deliveries").select("id, vendor_id")
        .eq("location_id", locationId).in("vendor_id", ids).order("id").range(from, to);
      if (error) throw new Error(`loadReceivingFormData store scope: ${error.message}`);
      return { data };
    }));
  }
  const localStoreIds = new Set([
    ...skuList.filter((sku) => sku.location_id === locationId).map((sku) => sku.vendor_id),
    ...deliveries.map((delivery) => delivery.vendor_id),
  ]);
  // ONE batch query for every active SKU's chain levels (loadRecipeGraph law).
  // Chain labels are ordered root→leaf for the level picker (display_ordinal).
  // Usage rank is a SECOND batch pair (production + sales lanes) — never per-SKU.
  const [chainsBySku, usageBySku] = await Promise.all([
    loadReceivingChains(skuList.map((s) => s.id), locationId),
    loadSkuUsageRank(sb, locationId),
  ]);
  return {
    salesCoverage: usageBySku.coverage,
    vendors: vendors.filter((v) => v.source_kind === "vendor" || localStoreIds.has(v.id))
      .map((v) => ({ id: v.id, name: v.name, sourceKind: v.source_kind })),
    skus: skuList.map((s) => ({
      id: s.id,
      name: s.name,
      vendorId: s.vendor_id,
      packFormat: s.pack_format,
      chainLabels: chainLabelsInWalkOrder(chainsBySku.get(s.id) ?? []),
      chainCounts: chainCountsInWalkOrder(chainsBySku.get(s.id) ?? []),
      usageRank: usageBySku.usage.get(s.id) ?? null,
      searchTerms: s.product_id ? productNames.get(s.product_id) ?? [] : [],
      locationId: s.location_id,
      pendingReview: s.pending_review,
    })),
  };
}

// Stores grow the catalog across vendors. Bound request lines and response sizes
// when loading the full picker universe (paging SKU rows alone is insufficient).
async function loadReceivingChains(ids: string[], locationId: string): Promise<Map<string, PackChainLevel[]>> {
  const out = new Map<string, PackChainLevel[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = await loadSkuPackChains(ids.slice(i, i + 100), locationId);
    for (const [id, chain] of chunk) out.set(id, chain);
  }
  return out;
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
 *   sales lane      = SUM(effective capture sales direct_oz) at this location for
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
): Promise<{ usage: Map<string, number>; coverage: SalesCoverage }> {
  const usage = new Map<string, number>();
  const add = (skuId: string, oz: number) => {
    if (!Number.isFinite(oz) || oz <= 0) return;
    usage.set(skuId, (usage.get(skuId) ?? 0) + oz);
  };

  // 30-day window. Productions compare on produced_at (timestamptz); the depletion
  // ledger compares on business_date (a bare ET date). W20/B200: both bounds come from ONE ET
  // business day (today's ET date minus 30, and the instant that day starts). The old bound
  // was the UTC date of "now minus 30 days", a day ahead of the Eastern date every evening,
  // so the sales lane lost a business day the production lane kept.
  const { fromDate, startIso } = trailingEtWindow(new Date().toISOString(), 30);

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
        .gte("produced_at", startIso)
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
  const sales = await loadEffectiveSalesWindow(sb, { locationId, fromDate });
  for (const r of sales.rows) add(r.sku_id, num(r.direct_oz) ?? 0);

  return { usage, coverage: sales.coverage };
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

/** The counts between consecutive levels of `chainLabelsInWalkOrder` (W04/B046). Empty unless
 *  the chain is one well-formed root → leaf path that covers every level. */
function chainCountsInWalkOrder(levels: PackChainLevel[]): number[] {
  const labels = chainLabelsInWalkOrder(levels);
  if (labels.length !== levels.length) return [];
  const byLabel = new Map(levels.map((l) => [l.label, l]));
  const counts: number[] = [];
  for (let i = 0; i < labels.length - 1; i++) {
    const level = byLabel.get(labels[i]!);
    const next = byLabel.get(labels[i + 1]!);
    if (!level || !next || level.containsLevelId !== next.id) return [];
    counts.push(level.containsQty);
  }
  return counts;
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
  if (!(await canDoOperationalTask(actor, input.locationId, "receiving"))) throw new ReceivingError(403, "forbidden");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate) || Number.isNaN(Date.parse(input.deliveryDate))) {
    throw new ReceivingError(400, "invalid_date", "Delivery date must be YYYY-MM-DD");
  }
  // Line validation + SKU-active check + oz resolution is shared with addDeliveryLines.
  // A-WB4-02: the header invoice total was written unvalidated (line prices were validated). Bound it.
  if (input.invoiceTotal != null && (!Number.isFinite(input.invoiceTotal) || input.invoiceTotal < 0)) {
    throw new ReceivingError(400, "invalid_invoice_total", "Invoice total must be zero or greater");
  }
  const sb = getServiceRoleClient();

  const { data: vend, error: vendorError } = await sb.from("vendors").select("id, source_kind").eq("id", input.vendorId).eq("active", true).maybeSingle<{ id: string; source_kind: "vendor" | "store" }>();
  if (vendorError) throw new Error(`recordDelivery vendor: ${vendorError.message}`);
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
  //
  // W20/B198: compared EXACTLY (case-insensitive), in code. The old `.ilike(invoice_number, raw)`
  // made `_` and `%` wildcards (and PostgREST rewrites `*` to `%`, which no escaping can undo), so
  // "INV_1001" was refused as a duplicate of "INV-1001", and a pattern matching two rows was a
  // 500 from maybeSingle. One vendor's deliveries at one shop on one day is a handful of rows;
  // the identity is the 0169 index key lower(invoice_number), and that index stays the arbiter.
  const invoiceNumber = input.invoiceNumber?.trim() || null;
  if (invoiceNumber) {
    const { data: sameDay, error: dupErr } = await sb.from("vendor_deliveries")
      .select("id, delivery_status, invoice_number")
      .eq("vendor_id", input.vendorId).eq("location_id", input.locationId).eq("delivery_date", input.deliveryDate)
      .not("invoice_number", "is", null)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .returns<Array<{ id: string; delivery_status: string | null; invoice_number: string | null }>>();
    if (dupErr) throw new Error(`recordDelivery dedupe: ${dupErr.message}`);
    const dup = (sameDay ?? []).find((d) => sameInvoiceNumber(d.invoice_number, invoiceNumber));
    if (dup) {
      const msg = dup.delivery_status === "in_progress"
        ? "This delivery is already in progress — continue it instead."
        : "This invoice was already received for this vendor today.";
      throw new ReceivingError(409, "duplicate_delivery", `${msg} (delivery ${dup.id})`);
    }
  }

  const resolved = await validateAndResolveDeliveryLines(sb, input.lines, input.vendorId, vend.source_kind, input.locationId);

  // Missing-item honesty gate (PO-LINKED ONLY). An expectation is a vendor DEBT only when
  // the vendor was ordered the item; a last-delivery prefill is a habit, not an order. The
  // form only offers the affordance on a PO-linked intake — this is the enforcement.
  const missingExpected = input.missingLines ?? [];
  if (missingExpected.length > 0 && !poId) {
    throw new ReceivingError(400, "missing_requires_po", "Missing-item shorts can only be filed against a purchase order");
  }
  // Validate the entire missing-credit payload before the delivery header or any line is
  // written. A forged foreign-shop SKU must leave no partial delivery behind.
  const missingCreditDrafts = await prepareMissingExpectedCredits(
    sb, input.vendorId, input.locationId, missingExpected, new Set(input.lines.map((l) => l.skuId)), poId,
  );
  // W08/B162: the receipt and line photos must be this shop's photos from the uploader — validated
  // before any write, and stored in the canonical form only (never the caller's raw string).
  const photos = await bindDeliveryPhotos(sb, input.locationId, input.receiptUrl, input.lines.map((l) => l.photoUrl));

  // 0160 columns — apply 0160 BEFORE deploying this code (additive; old code unaffected).
  // The 0160 `note` columns are the brief-canonical fields; the legacy `notes`
  // columns stay populated so the existing detail reader keeps working (no split-
  // brain — both mirror the same operator input this PR; a future pass can retire
  // the legacy `notes` once every reader moves to `note`).
  const headerNote = input.notes?.trim() || null;
  const headerRow = {
    vendor_id: input.vendorId, location_id: input.locationId, delivery_date: input.deliveryDate,
    invoice_number: invoiceNumber, invoice_total: input.invoiceTotal ?? null,
    notes: headerNote, note: headerNote, receipt_url: photos.receiptUrl, received_by: actor.user.id,
    delivery_status: input.deliveryStatus ?? "complete",
    purchase_order_id: poId,
  };
  const lineRows = buildLineRows(input.lines, resolved.resolvedOzByLineIdx, actor.user.id, resolved.vendorIdBySku, photos.lineUrls);

  // ── THE WRITE: ONE TRANSACTION (W20/B197, migration 0327) ────────────────────────────
  // The header, its lines, the lined credits and the line-less credits used to be four
  // requests. A failure after the first left a delivery with no lines, and with an invoice
  // number the retry then answered "already received" (the 0169 index). record_delivery_atomic
  // writes all of it or none of it. The lined credits are derived HERE, from the request's own
  // lines, by the same rule the read-back path uses (deriveLineCreditDrafts): a line's values
  // are exactly what is about to be stored, and each credit names its line by position.
  const lineCredits = deriveLineCreditDrafts(
    input.lines.map((l, i) => ({
      deliveryItemId: String(i + 1),
      skuId: l.skuId,
      qtyReceived: l.qtyReceived,
      expectedQty: l.expectedQty ?? null,
      unitPrice: l.unitPrice ?? null,
      discrepancyType: l.discrepancyType ?? null,
      receivedLevelLabel: l.receivedLevelLabel?.trim() || null,
    })),
    { chains: resolved.chainsBySku, packFormat: resolved.packFormatBySku, store: vend.source_kind === "store" },
  );
  const duplicateDelivery = () => new ReceivingError(409, "duplicate_delivery", "This invoice was already received for this vendor today.");
  let deliveryId: string;
  let missingCreditCount = missingCreditDrafts.length;
  const atomic = await sb.rpc("record_delivery_atomic", {
    p_header: headerRow,
    p_lines: lineRows,
    p_line_credits: lineCredits.map((d) => ({ line_index: Number(d.deliveryItemId), reason: d.reason, sku_id: d.skuId, qty: d.qty, amount_cents: d.amountCents })),
    p_missing_credits: missingCreditDrafts.map((d) => ({ reason: d.reason, sku_id: d.skuId, qty: d.qty, amount_cents: d.amountCents })),
  });
  if (!atomic.error) {
    const id = (atomic.data as { delivery_id?: unknown } | null)?.delivery_id;
    if (typeof id !== "string" || id === "") throw new Error("recordDelivery: the atomic writer returned no delivery id");
    deliveryId = id;
  } else if (!rpcNotInstalled(atomic.error)) {
    // Rolled back whole: nothing was written. The app-level dedupe guard above is the fast
    // path (friendly message) but races under concurrent POSTs; migration 0169's partial
    // unique index (vendor_deliveries_dedupe_uq) is the real arbiter → 409.
    if (atomic.error.code === "23505" && !/vendor_credits/.test(atomic.error.message ?? "")) throw duplicateDelivery();
    throw new Error(`recordDelivery write: ${atomic.error.message}`);
  } else {
    // 0327 IS NOT APPLIED YET: the previous four-step write, unchanged, so the door keeps
    // working. It is not atomic (that is the bug); the shape check both routes now run and
    // the validation above already refuse the bad lines that used to trigger it.
    const { data: header, error: hErr } = await sb.from("vendor_deliveries").insert(headerRow).select("id, created_at").maybeSingle<{ id: string; created_at: string | null }>();
    if (hErr) {
      if (hErr.code === "23505" || /vendor_deliveries_dedupe_uq/.test(hErr.message ?? "")) throw duplicateDelivery();
      throw new Error(`recordDelivery header: ${hErr.message}`);
    }
    if (!header) throw new Error("recordDelivery header returned no row");
    deliveryId = header.id;

    // The creation lines carry the HEADER's instant (review W20-r1): this second request can run any
    // time after the first, and the append guard must still know these are the lines the delivery was
    // created with (priorAppendBatches reads that identity; it infers nothing from latency). It is also
    // what one transaction writes (0327 stamps the same value), so the lot instant does not depend on
    // which path saved the delivery.
    const creationStamp = header.created_at ? { created_at: header.created_at } : {};
    const { error: lErr } = await sb.from("vendor_delivery_items").insert(lineRows.map((row) => ({ delivery_id: deliveryId, ...row, ...creationStamp })));
    if (lErr) throw new Error(`recordDelivery lines: ${lErr.message}`);

    // Idempotent vendor credits from any discrepancy-flagged lines (spec D1: the
    // intake unit_price is the credit price authority). Retry-safe via an app-side pre-read
    // of the existing (delivery_item_id, reason) pairs, backed by the 0168 partial unique
    // index — a derive that loses the race gets 23505 and no-ops.
    await deriveAndUpsertCredits(sb, deliveryId, input.vendorId, input.locationId, actor.user.id);

    // Line-less `short` credits for ordered items that never came off the truck.
    missingCreditCount = await insertMissingExpectedCredits(
      sb, deliveryId, input.vendorId, input.locationId, missingCreditDrafts, actor.user.id,
    );
  }

  const priced = resolved.priceLines;
  if (priced.length > 0) {
    // CATALOG PHASE 2a: lane-or-global is decided UNDER THE SKU LOCK in SQL (record_receiving_prices).
    const { error: pErr } = await sb.rpc("record_receiving_prices", { p_location: input.locationId, p_rows: receivingPriceRows(priced, input.deliveryDate, actor.user.id, vend.source_kind) });
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
    // The current delivery's own lines were written above, before this loop, so the
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

  await auditOperationalTaskOverride(actor, input.locationId, "receiving", "recordDelivery");
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "delivery.received", resourceTable: "vendor_deliveries", resourceId: deliveryId,
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
      const closure = await resolveCreditsRedelivered(actor, deliveryId, makeUpIds);
      resolvedCredits = closure.resolved;
      skippedCredits = closure.skipped;
    } catch (e) {
      creditClosureError = true;
      console.error(`recordDelivery credit closure failed (delivery ${deliveryId}):`, e instanceof Error ? e.message : e);
    }
  }

  await attemptReceivingAutoLink(deliveryId).catch(() => { /* Advisory matching cannot fail a durable save. */ });
  return { deliveryId, resolvedCredits, skippedCredits, creditClosureError };
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
  priceLines: Array<{ skuId: string; unitPrice: number }>;
  /** The pack chains and pack formats this pass already loaded (W20/B197): what credit pricing
   *  needs (deriveLineCreditDrafts), so a new delivery's credits are derived with no second read. */
  chainsBySku: Map<string, PackChainLevel[]>;
  packFormatBySku: Map<string, string | null>;
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
  sourceKind: "vendor" | "store" = "vendor",
  deliveryLocationId?: string,
): Promise<ResolvedLines> {
  if (!Array.isArray(lines) || lines.length === 0) throw new ReceivingError(400, "no_lines", "At least one line is required");
  for (const l of lines) {
    if (!Number.isFinite(l.qtyReceived) || l.qtyReceived <= 0) throw new ReceivingError(400, "invalid_qty", "Quantity must be positive");
    if (l.unitPrice != null && (!Number.isFinite(l.unitPrice) || l.unitPrice <= 0)) throw new ReceivingError(400, "invalid_price", "Price must be positive");
    if (l.observedOzPerEach != null && (!Number.isFinite(l.observedOzPerEach) || l.observedOzPerEach <= 0)) throw new ReceivingError(400, "invalid_observed", "Observed oz must be positive");
    if (l.expectedQty != null && (!Number.isFinite(l.expectedQty) || l.expectedQty < 0)) throw new ReceivingError(400, "invalid_expected", "Expected qty must be zero or greater");
  }
  const skuIds = [...new Set(lines.map((l) => l.skuId))];
  const { data: activeSkus, error: skuError } = await sb.from("vendor_items")
    .select("id, vendor_id, location_id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each, weight_class")
    .in("id", skuIds).eq("active", true)
    .returns<Array<{ id: string; vendor_id: string | null; location_id: string | null; pack_format: string | null; each_container_label: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null; weight_class: string | null }>>();
  if (skuError) throw new Error(`validateAndResolveDeliveryLines skus: ${skuError.message}`);
  const activeSet = new Set((activeSkus ?? []).map((s) => s.id));
  for (const id of skuIds) if (!activeSet.has(id)) throw new ReceivingError(400, "invalid_sku", "A SKU is not found or inactive");
  if ((activeSkus ?? []).some((sku) => sku.location_id != null && sku.location_id !== deliveryLocationId)) {
    throw new ReceivingError(404, "not_found");
  }

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
  const mismatch = findVendorMismatch(deliveryVendorId, (activeSkus ?? []).map((s) => ({ id: s.id, vendorId: s.vendor_id })), sourceKind);
  if (mismatch) {
    throw new ReceivingError(400, "sku_vendor_mismatch", "An item belongs to a different vendor than this delivery");
  }

  const [measures, chainsBySku] = await Promise.all([loadMeasures(), loadSkuPackChains(skuIds, deliveryLocationId ?? null)]);
  const skuById = new Map((activeSkus ?? []).map((s) => [s.id, s]));
  const chained = new Set([...chainsBySku.entries()].filter(([, lv]) => lv.length > 0).map(([id]) => id));
  const resolvedOzByLineIdx = lines.map((l) => resolveReceivedOz(l, skuById.get(l.skuId), chainsBySku.get(l.skuId) ?? null, measures));
  const vendorIdBySku = new Map((activeSkus ?? []).map((s) => [s.id, s.vendor_id]));
  const weightClassBySku = new Map((activeSkus ?? []).map((s) => [s.id, s.weight_class]));
  const priceLines = lines.filter((l) => l.unitPrice != null).map((l) => {
    const unitPrice = sourceKind === "store"
      ? storeRootPackPrice(l.unitPrice!, l.receivedLevelLabel ?? null,
          chainsBySku.get(l.skuId) ?? null, skuById.get(l.skuId)?.pack_format ?? null)
      : l.unitPrice!;
    if (unitPrice == null) throw new ReceivingError(400, "store_price_conversion", "The received level cannot be converted to a root-pack price");
    return { skuId: l.skuId, unitPrice };
  });
  const packFormatBySku = new Map((activeSkus ?? []).map((s) => [s.id, s.pack_format]));
  return { resolvedOzByLineIdx, chained, vendorIdBySku, weightClassBySku, priceLines, chainsBySku, packFormatBySku };
}

/**
 * W08/B162: bind a delivery's receipt and line photo references. Each ref must be the canonical
 * `/api/photos/<uuid>` (or empty): anything else is 400 `invalid_photo`, refused BEFORE any read.
 * Every referenced photo must exist with `location_id` = the delivery's shop (the attachDeliveryReceipt
 * rule), else 404 `photo_not_found`. Returns the canonical strings to store, index-aligned with lineRefs.
 */
async function bindDeliveryPhotos(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  receiptRef: unknown,
  lineRefs: readonly unknown[],
): Promise<{ receiptUrl: string | null; lineUrls: Array<string | null> }> {
  const parse = (ref: unknown): string | null => {
    const r = photoIdFromRef(ref);
    if (!r.ok) throw new ReceivingError(400, "invalid_photo", "Photos must come from the photo uploader");
    return r.photoId;
  };
  const receiptId = parse(receiptRef);
  const lineIds = lineRefs.map(parse);
  const ids = [...new Set([receiptId, ...lineIds].filter((x): x is string => x !== null))];
  if (ids.length > 0) {
    const found = new Map<string, string | null>();
    for (let start = 0; start < ids.length; start += 100) {
      const { data, error } = await sb.from("photos").select("id, location_id").in("id", ids.slice(start, start + 100))
        .returns<Array<{ id: string; location_id: string | null }>>();
      if (error) throw new Error(`bindDeliveryPhotos: ${error.message}`);
      for (const p of data ?? []) found.set(String(p.id).toLowerCase(), p.location_id);
    }
    for (const id of ids) {
      if (!found.has(id) || found.get(id) !== locationId) throw new ReceivingError(404, "photo_not_found", "Photo not found");
    }
  }
  const url = (id: string | null) => (id === null ? null : `/api/photos/${id}`);
  return { receiptUrl: url(receiptId), lineUrls: lineIds.map(url) };
}

/** Build the vendor_delivery_items rows for a set of input lines (shared shape for
 *  recordDelivery + addDeliveryLines), WITHOUT delivery_id: a new delivery's lines are written
 *  with their header in one transaction (W20/B197), an append adds its delivery id.
 *  resolvedOzByLineIdx is index-aligned with lines. vendorIdBySku carries each SKU's own vendor
 *  onto the row (P3 / migration 0178). */
function buildLineRows(lines: DeliveryLineInput[], resolvedOzByLineIdx: Array<number | null>, createdBy: string, vendorIdBySku: Map<string, string | null>, photoUrls: ReadonlyArray<string | null>) {
  return lines.map((l, i) => ({
    vendor_item_id: l.skuId, qty_received: l.qtyReceived,
    vendor_id: vendorIdBySku.get(l.skuId) ?? null,
    unit_price: l.unitPrice ?? null, observed_oz_per_each: l.observedOzPerEach ?? null,
    notes: l.notes?.trim() || null, created_by: createdBy,
    received_level_label: l.receivedLevelLabel?.trim() || null,
    received_qty_at_level: l.receivedLevelLabel?.trim() ? l.qtyReceived : null,
    resolved_oz: resolvedOzByLineIdx[i] ?? null,
    note: l.notes?.trim() || null,
    photo_url: photoUrls[i] ?? null,
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
 * A NEW DELIVERY NO LONGER COMES THROUGH HERE once migration 0327 is applied (W20/B197):
 * recordDelivery derives its credits from the request's lines with the same rule
 * (deriveLineCreditDrafts) and writes them in the header's transaction, so a credit failure
 * rolls the delivery back and the retry works. This function remains the path for
 * addDeliveryLines, and for recordDelivery only while 0327 is not applied (where the old gap
 * stands: a credit-write 500 leaves the delivery + lines durable and the retry is a 409).
 */
async function deriveAndUpsertCredits(
  sb: ServiceClient, deliveryId: string, vendorId: string, locationId: string, createdBy: string,
): Promise<void> {
  const { data: itemRows, error: iErr } = await sb.from("vendor_delivery_items")
    .select("id, vendor_item_id, received_qty_at_level, qty_received, expected_qty, unit_price, discrepancy_type, received_level_label")
    .eq("delivery_id", deliveryId)
    .returns<Array<{ id: string; vendor_item_id: string; received_qty_at_level: number | string | null; qty_received: number | string | null; expected_qty: number | string | null; unit_price: number | string | null; discrepancy_type: "short" | "over" | "damaged" | "substitution" | null; received_level_label: string | null }>>();
  if (iErr) throw new Error(`deriveAndUpsertCredits select: ${iErr.message}`);
  const flagged = (itemRows ?? []).filter((r) => r.discrepancy_type != null);
  // W04/B046: a credit counts LEVEL units, but a vendor line's price is per ROOT pack. For a
  // line received at a named level, price the credit per that level (creditUnitPrice, inside
  // deriveLineCreditDrafts); a store run's price is already per level. A level the chain cannot
  // place leaves the amount null. The chains are only needed when some flagged line names a level.
  const levelled = flagged.filter((r) => r.received_level_label?.trim());
  let chains = new Map<string, PackChainLevel[]>();
  let packFormat = new Map<string, string | null>();
  let store = false;
  if (levelled.length > 0) {
    const skuIds = [...new Set(levelled.map((r) => r.vendor_item_id))];
    const [loadedChains, { data: vendorRow, error: vErr }, { data: skuRows, error: sErr }] = await Promise.all([
      loadSkuPackChains(skuIds, locationId),
      sb.from("vendors").select("source_kind").eq("id", vendorId).maybeSingle<{ source_kind: string | null }>(),
      sb.from("vendor_items").select("id, pack_format").in("id", skuIds).returns<Array<{ id: string; pack_format: string | null }>>(),
    ]);
    if (vErr) throw new Error(`deriveAndUpsertCredits vendor: ${vErr.message}`);
    if (sErr) throw new Error(`deriveAndUpsertCredits skus: ${sErr.message}`);
    chains = loadedChains;
    store = vendorRow?.source_kind === "store";
    packFormat = new Map((skuRows ?? []).map((s) => [s.id, s.pack_format]));
  }
  // ONE rule for lined credits (W20/B197): the same function prices a new delivery's credits
  // from its request lines inside recordDelivery's single transaction.
  const drafts = deriveLineCreditDrafts(flagged.map((r) => ({
    deliveryItemId: r.id,
    skuId: r.vendor_item_id,
    // received_qty_at_level is the level-unit qty when a level was named; fall back to qty_received.
    qtyReceived: num(r.received_qty_at_level) ?? num(r.qty_received) ?? 0,
    expectedQty: num(r.expected_qty),
    unitPrice: num(r.unit_price),
    discrepancyType: r.discrepancy_type,
    receivedLevelLabel: r.received_level_label,
  })), { chains, packFormat, store });
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
 *   • W04/B148: the SKU must be ON the linked PO (`missing_not_on_po`), and the claimed qty is
 *     capped at the qty that PO ordered (a whole missing item is at most what was ordered)
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
async function prepareMissingExpectedCredits(
  sb: ServiceClient,
  vendorId: string,
  locationId: string,
  missing: MissingExpectedLine[],
  deliveredSkuIds: Set<string>,
  poId: string | null,
): Promise<ReturnType<typeof deriveMissingCreditDrafts>> {
  if (missing.length === 0) return [];
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
  if (usable.length === 0) return [];

  const skuIds = usable.map((m) => m.skuId);
  const { data: activeSkus, error: sErr } = await sb.from("vendor_items")
    .select("id, vendor_id, location_id").in("id", skuIds).eq("active", true)
    .returns<Array<{ id: string; vendor_id: string | null; location_id: string | null }>>();
  if (sErr) throw new Error(`insertMissingExpectedCredits skus: ${sErr.message}`);
  const activeSet = new Set((activeSkus ?? []).map((s) => s.id));
  for (const id of skuIds) if (!activeSet.has(id)) throw new ReceivingError(400, "invalid_sku", "A SKU is not found or inactive");
  if ((activeSkus ?? []).some((sku) => sku.location_id != null && sku.location_id !== locationId)) {
    throw new ReceivingError(404, "not_found");
  }

  // Vendor binding (P3) — mirrors validateAndResolveDeliveryLines. A short credit is a
  // DEBT claim against `vendorId`; claiming another vendor's twin invents a debt the
  // named vendor never owed.
  const mismatch = findVendorMismatch(vendorId, (activeSkus ?? []).map((s) => ({ id: s.id, vendorId: s.vendor_id })));
  if (mismatch) {
    throw new ReceivingError(400, "sku_vendor_mismatch", "A missing item belongs to a different vendor than this delivery");
  }

  // W04/B148: a missing-item short is a debt for something this PO ORDERED. recordDelivery
  // already refuses missing lines without a PO; the PO's own lines bound what can be claimed.
  if (!poId) throw new ReceivingError(400, "missing_requires_po", "Missing-item shorts can only be filed against a purchase order");
  const { data: poLines, error: plErr } = await sb.from("po_lines")
    .select("sku_id, order_qty").eq("po_id", poId).in("sku_id", skuIds)
    .returns<Array<{ sku_id: string; order_qty: number | string | null }>>();
  if (plErr) throw new Error(`insertMissingExpectedCredits po lines: ${plErr.message}`);
  const orderedBySku = new Map<string, number>();
  for (const l of poLines ?? []) {
    const q = num(l.order_qty);
    if (q != null && q > 0) orderedBySku.set(l.sku_id, (orderedBySku.get(l.sku_id) ?? 0) + q);
  }
  for (const m of usable) {
    if (!orderedBySku.has(m.skuId)) throw new ReceivingError(400, "missing_not_on_po", "A missing item was not on this purchase order");
  }
  return deriveMissingCreditDrafts(usable.map((m) => ({ ...m, expectedQty: Math.min(m.expectedQty, orderedBySku.get(m.skuId)!) })));
}

async function insertMissingExpectedCredits(
  sb: ServiceClient,
  deliveryId: string,
  vendorId: string,
  locationId: string,
  drafts: ReturnType<typeof deriveMissingCreditDrafts>,
  createdBy: string,
): Promise<number> {
  if (drafts.length === 0) return 0;
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

type DeliveryListRow = { id: string; vendor_id: string; delivery_date: string; invoice_number: string | null; received_by: string | null; match_state: DeliveryMatchState; delivery_status: DeliveryStatus; receipt_url: string | null; email_receipt_id: string | null; created_at: string; purchase_order_id: string | null };

export async function loadRecentDeliveries(actor: AuthContext | PulseScopedReadActor, locationId: string, limit = 20): Promise<DeliveryView[]> {
  if (isPulseReadActor(actor)) {
    requirePulseReadScope(actor, locationId, RECEIVE_MIN);
  } else {
    requireReceive(actor);
    if (!lockLocationContext(actorLoc(actor), locationId)) throw new ReceivingError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb.from("vendor_deliveries")
    .select("id, vendor_id, delivery_date, invoice_number, received_by, match_state, delivery_status, receipt_url, email_receipt_id, created_at, purchase_order_id")
    .eq("location_id", locationId).order("delivery_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit)
    .returns<Array<{ id: string; vendor_id: string; delivery_date: string; invoice_number: string | null; received_by: string | null; match_state: DeliveryMatchState; delivery_status: DeliveryStatus; receipt_url: string | null; email_receipt_id: string | null; created_at: string; purchase_order_id: string | null }>>();
  if (error) throw new Error(`loadRecentDeliveries: ${error.message}`);
  return hydrateDeliveryList(sb, rows ?? []);
}

/** Export the entire requested date window, never a capped lifetime prefix. */
export async function loadDeliveriesForExport(
  actor: AuthContext, locationId: string, range: { from: string; to: string },
): Promise<DeliveryView[]> {
  requireReceive(actor);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new ReceivingError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<DeliveryListRow>((from, to) => sb.from("vendor_deliveries")
    .select("id, vendor_id, delivery_date, invoice_number, received_by, match_state, delivery_status, receipt_url, email_receipt_id, created_at, purchase_order_id")
    .eq("location_id", locationId).gte("delivery_date", range.from).lte("delivery_date", range.to)
    .order("delivery_date", { ascending: false }).order("created_at", { ascending: false }).order("id")
    .range(from, to).returns<DeliveryListRow[]>(), 500);
  return hydrateDeliveryList(sb, rows);
}

async function hydrateDeliveryList(sb: ServiceClient, list: DeliveryListRow[]): Promise<DeliveryView[]> {
  if (list.length === 0) return [];
  const vendorIds = [...new Set(list.map((r) => r.vendor_id))];
  const userIds = [...new Set(list.map((r) => r.received_by).filter((v): v is string => v !== null))];
  const deliveryIds = list.map((r) => r.id);
  const poIds = [...new Set(list.map((r) => r.purchase_order_id).filter((v): v is string => v !== null))];
  // Bound both the request line (UUID chunks) and response size (ordered pages).
  // All pages must succeed: a failed child read is not a zero-line delivery.
  async function related<T>(table: string, columns: string, column: string, ids: string[]): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const chunk = ids.slice(offset, offset + 100);
      rows.push(...await selectAllRows<T>((from, to) => sb.from(table).select(columns)
        .in(column, chunk).order("id").range(from, to).returns<T[]>(), 500));
    }
    return rows;
  }
  const [vs, us, lines, pos] = await Promise.all([
    related<{ id: string; name: string }>("vendors", "id, name", "id", vendorIds),
    related<{ id: string; name: string }>("users", "id, name", "id", userIds),
    related<{ delivery_id: string }>("vendor_delivery_items", "id, delivery_id", "delivery_id", deliveryIds),
    related<{ id: string; display_code: string }>("purchase_orders", "id, display_code", "id", poIds),
  ]);
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
    // The PO's own snapshot order (V3-A: section*1000+line, frozen at draft time) — the door
    // reads the order the way it was keyed, never the live guide.
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
  const chainsBySku = await loadSkuPackChains(poSkuIds, locationId);
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
    .select("id, vendor_id, location_id, delivery_date, delivery_status, created_at")
    .eq("id", deliveryId)
    .maybeSingle<{ id: string; vendor_id: string; location_id: string; delivery_date: string; delivery_status: string | null; created_at: string | null }>();
  if (error) throw new Error(`addDeliveryLines header: ${error.message}`);
  if (!h) throw new ReceivingError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), h.location_id)) throw new ReceivingError(404, "not_found", "Delivery not found");
  if (!(await canDoOperationalTask(actor, h.location_id, "receiving"))) throw new ReceivingError(403, "forbidden");
  if (h.delivery_status !== "in_progress") throw new ReceivingError(409, "delivery_complete", "This delivery is complete — reopen or start a new one");

  const { data: source, error: sourceError } = await sb.from("vendors").select("source_kind")
    .eq("id", h.vendor_id).maybeSingle<{ source_kind: "vendor" | "store" }>();
  if (sourceError) throw new Error(`addDeliveryLines source: ${sourceError.message}`);
  if (!source) throw new ReceivingError(400, "invalid_vendor");
  const resolved = await validateAndResolveDeliveryLines(sb, lines, h.vendor_id, source.source_kind, h.location_id);
  // W08/B162: line photos bound to this delivery's shop before any write (see recordDelivery).
  const photos = await bindDeliveryPhotos(sb, h.location_id, null, lines.map((l) => l.photoUrl));

  // Double-submit guard (P1 pragmatic window): a network retry / double-tap on the
  // append route would duplicate every line (and each dup spawns its own credit).
  // If the incoming batch is an EXACT multiset match of ONE batch already appended to
  // THIS delivery in the last 60s, reject it. No UI drives this route yet
  // (continue-mode deferred); a proper client idempotency token ships with that UI.
  //
  // W20/B199: "one batch" is one earlier APPEND (the lines of one insert share one
  // created_at), never the union of every line in the window, and never the lines the
  // delivery was CREATED with. The union refused a real second pallet identical to the
  // first one, added within a minute of creating the delivery, and it missed a repeat of
  // an earlier append once a different append had followed it.
  // The creation lines are the ones that carry the header's own created_at (written by
  // recordDelivery / record_delivery_atomic): an identity, never a guess from timing.
  const appendCutoff = new Date(Date.now() - 60_000).toISOString();
  const { data: recentRows, error: rErr } = await sb.from("vendor_delivery_items")
    .select("vendor_item_id, received_level_label, received_qty_at_level, qty_received, created_at")
    .eq("delivery_id", h.id).gte("created_at", appendCutoff)
    .returns<Array<{ vendor_item_id: string; received_level_label: string | null; received_qty_at_level: number | string | null; qty_received: number | string | null; created_at: string }>>();
  if (rErr) throw new Error(`addDeliveryLines recent: ${rErr.message}`);
  const recentAppend: DatedAppendLine[] = (recentRows ?? []).map((r) => ({
    skuId: r.vendor_item_id, level: r.received_level_label,
    qty: num(r.received_qty_at_level) ?? num(r.qty_received) ?? 0,
    createdAt: r.created_at,
  }));
  const incomingAppend: AppendLine[] = lines.map((l) => ({
    skuId: l.skuId, level: l.receivedLevelLabel?.trim() || null, qty: l.qtyReceived,
  }));
  if (isDuplicateOfAnyBatch(incomingAppend, priorAppendBatches(recentAppend, h.created_at))) {
    throw new ReceivingError(409, "duplicate_append", "These lines were just added to this delivery — refresh before appending again.");
  }

  const { error: lErr } = await sb.from("vendor_delivery_items").insert(
    buildLineRows(lines, resolved.resolvedOzByLineIdx, actor.user.id, resolved.vendorIdBySku, photos.lineUrls)
      .map((row) => ({ delivery_id: h.id, ...row })),
  );
  if (lErr) throw new Error(`addDeliveryLines lines: ${lErr.message}`);

  const priced = resolved.priceLines;
  if (priced.length > 0) {
    const { error: pErr } = await sb.rpc("record_receiving_prices", { p_location: h.location_id, p_rows: receivingPriceRows(priced, h.delivery_date, actor.user.id, source.source_kind) });
    if (pErr) throw new Error(`addDeliveryLines prices: ${pErr.message}`);
  }

  await deriveAndUpsertCredits(sb, h.id, h.vendor_id, h.location_id, actor.user.id);

  await auditOperationalTaskOverride(actor, h.location_id, "receiving", "addDeliveryLines");
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "delivery.received", resourceTable: "vendor_deliveries", resourceId: h.id,
    metadata: { location_id: h.location_id, added_lines: lines.length, partial: true },
    ipAddress: null, userAgent: null,
  });

  await attemptReceivingAutoLink(h.id).catch(() => { /* Advisory matching cannot fail a durable save. */ });
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
  if (!(await canDoOperationalTask(actor, h.location_id, "receiving"))) throw new ReceivingError(403, "forbidden");
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

  await auditOperationalTaskOverride(actor, h.location_id, "receiving", "completeDelivery");
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
  await attemptReceivingAutoLink(deliveryId).catch(() => { /* Advisory matching cannot fail a durable save. */ });
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
  if (!(await canDoOperationalTask(actor, h.location_id, "receiving"))) throw new ReceivingError(403, "forbidden");
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

  await auditOperationalTaskOverride(actor, h.location_id, "receiving", "attachDeliveryReceipt");
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "delivery.receipt_attached", resourceTable: "vendor_deliveries", resourceId: deliveryId,
    metadata: { location_id: h.location_id, photo_id: photoId, receipt_url: receiptUrl },
    ipAddress: null, userAgent: null,
  });

  await attemptReceivingAutoLink(deliveryId).catch(() => { /* Advisory matching cannot fail a durable save. */ });
  return { receiptUrl };
}
