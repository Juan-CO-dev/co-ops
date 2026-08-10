/**
 * Three-way match — the SERVER loader (Vendor Ordering V2 §5). SERVER-ONLY,
 * service-role client; authorization is APP-LAYER (KH+ read via loadPoDetail's own
 * gate + location-bind IDOR). Derives, NEVER writes — there is no three-way schema.
 *
 * It fetches the three legs of a purchase order and hands them to the PURE brain
 * (lib/po-match-shared.buildThreeWayLines):
 *   ORDERED  = the frozen `confirmed_snapshot.lines` (confirmPO's authoritative freeze).
 *   RECEIVED = the linked delivery's `vendor_delivery_items` (door count, keyed by
 *              vendor_item_id = skuId; qty = received_qty_at_level ?? qty_received).
 *   BILLED   = the newest linked INVOICE receipt's `parsed_json.extraction.lines`
 *              (email_receipts where linked_po_id = poId AND doc_kind = 'invoice').
 *
 * ── ADVISORY / DORMANT ─────────────────────────────────────────────────────────
 * Every leg is optional. A pre-confirm PO (no snapshot) returns the EMPTY view
 * ({lines:[], hasInvoice:false, hasDelivery:false}) — the section only renders on a
 * confirmed+ PO's detail (spec §5). A missing invoice/delivery is a null leg, never a
 * fabricated zero (advisory-null law). The whole derivation is wrapped by the route
 * in try/catch (a three-way failure never breaks the PO detail load).
 *
 * ── UNTRUSTED VENDOR CONTENT ────────────────────────────────────────────────────
 * The invoice lines are an LLM parse of an untrusted vendor document
 * (lib/receipt-parse.ts, which already validated numbers finite/≥0 before storage).
 * We read them as DATA only and pass opaque strings/numbers to the pure brain; the
 * panel renders every string as text (no markup, no href/src) — house untrusted law.
 *
 * ── BATCHED ─────────────────────────────────────────────────────────────────────
 * All queries are batched (no per-line/per-delivery I/O). The received-but-not-ordered
 * SKU rows the pure brain emits carry the skuId as a placeholder name; we resolve the
 * real vendor_items.name for exactly those SKUs in ONE extra batch and patch the view.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadPoDetail } from "@/lib/purchase-orders";
import type { AuthContext } from "@/lib/session";
import {
  buildThreeWayLines,
  type ThreeWayView,
  type SnapshotLineInput,
  type DeliveryLineInput,
  type InvoiceLineInput,
} from "@/lib/po-match-shared";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/** Canonical UUID — line keys are interpolated into a PostgREST `.in()` filter, so guard them. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The empty view returned for a pre-confirm PO (no snapshot to compare against yet). */
const EMPTY_VIEW: ThreeWayView = { lines: [], totals: { orderedCents: null, billedCents: null }, hasInvoice: false, hasDelivery: false };

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** The frozen snapshot's line shape (confirmPO's SnapshotLine — see lib/purchase-orders.ts).
 *  Read defensively: the column is jsonb `unknown`; we validate each field's type. */
interface RawSnapshotLine {
  skuId?: unknown;
  name?: unknown;
  itemNumber?: unknown;
  qty?: unknown;
  unitLabel?: unknown;
  priceCents?: unknown;
}

/** Coerce the jsonb confirmed_snapshot into typed ORDERED lines (advisory-null on any
 *  malformed field). A snapshot with no usable lines → []. Never throws on bad shape. */
function readSnapshotLines(snapshot: unknown): SnapshotLineInput[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const rawLines = (snapshot as { lines?: unknown }).lines;
  if (!Array.isArray(rawLines)) return [];
  const out: SnapshotLineInput[] = [];
  for (const raw of rawLines) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as RawSnapshotLine;
    if (typeof l.skuId !== "string" || !l.skuId) continue; // a line with no SKU can't join — skip.
    out.push({
      skuId: l.skuId,
      name: typeof l.name === "string" ? l.name : "(sku)",
      itemNumber: typeof l.itemNumber === "string" ? l.itemNumber : null,
      qty: num(l.qty as number | string | null),
      unitLabel: typeof l.unitLabel === "string" ? l.unitLabel : null,
      priceCents: num(l.priceCents as number | string | null),
    });
  }
  return out;
}

/**
 * Build the three-way view for one PO (spec §5). KH+ + location-bind are enforced by
 * loadPoDetail (reused for its gate + snapshot + linked delivery ids). A pre-confirm
 * PO (status draft, no snapshot) → EMPTY_VIEW. Otherwise loads the received + billed
 * legs (batched) and delegates the compare to the pure brain. NEVER writes.
 */
export async function buildThreeWayView(actor: AuthContext, poId: string): Promise<ThreeWayView> {
  // loadPoDetail is the single gate + bind authority (KH+; 404-masks an out-of-location
  // PO) and already returns the frozen snapshot + linked delivery ids we need.
  const detail = await loadPoDetail(actor, poId);

  const snapshotLines = readSnapshotLines(detail.confirmedSnapshot);
  // Pre-confirm PO: nothing was frozen, so there is no ORDERED leg to compare. The
  // section only renders on a confirmed+ PO (spec §5) — return the empty view.
  if (snapshotLines.length === 0) return EMPTY_VIEW;

  const sb = getServiceRoleClient();

  // The two remaining legs, in parallel (batched — no per-line I/O).
  const [deliveryLines, invoiceLeg] = await Promise.all([
    loadDeliveryLines(sb, detail.deliveryIds),
    loadInvoiceLeg(sb, poId),
  ]);

  const view = buildThreeWayLines(snapshotLines, deliveryLines, invoiceLeg.lines, invoiceLeg.hasInvoice);

  // The pure brain fills a received-but-not-ordered row's `name` with the skuId as a
  // placeholder (it has no snapshot name for a SKU that wasn't ordered). Resolve the
  // real vendor_items.name for exactly those rows in one batch and patch them.
  await resolveUnorderedRowNames(sb, view);

  return view;
}

/**
 * The RECEIVED leg: every linked delivery's line items (batched over all delivery ids),
 * keyed by vendor_item_id (= skuId). qty = received_qty_at_level when a level was named,
 * else qty_received (mirrors the credit-derivation qty rule in lib/receiving.ts). A PO
 * with no linked delivery → []. When multiple deliveries link one PO (V2.5 territory —
 * a non-goal today) we take the LAST line per SKU rather than summing, so a re-open never
 * double-counts; the pure brain treats one line per SKU.
 */
async function loadDeliveryLines(sb: ServiceClient, deliveryIds: string[]): Promise<DeliveryLineInput[]> {
  if (deliveryIds.length === 0) return [];
  const { data: rows, error } = await sb.from("vendor_delivery_items")
    .select("vendor_item_id, qty_received, received_qty_at_level, received_level_label")
    .in("delivery_id", deliveryIds)
    .order("created_at", { ascending: true })
    .returns<Array<{ vendor_item_id: string; qty_received: number | string | null; received_qty_at_level: number | string | null; received_level_label: string | null }>>();
  if (error) throw new Error(`buildThreeWayView delivery lines: ${error.message}`);

  // One line per SKU (last write wins on the ascending-created order → the latest count).
  const bySku = new Map<string, DeliveryLineInput>();
  for (const r of rows ?? []) {
    bySku.set(r.vendor_item_id, {
      skuId: r.vendor_item_id,
      qty: num(r.received_qty_at_level) ?? num(r.qty_received),
      level: r.received_level_label,
    });
  }
  return [...bySku.values()];
}

/**
 * The BILLED leg: the NEWEST linked INVOICE receipt's parsed lines. Finds the most
 * recent email_receipts row where linked_po_id = poId AND doc_kind = 'invoice' (an
 * invoice classification is the only doc_kind that bills — a confirmation/statement is
 * not a bill), reads parsed_json.extraction.lines (Task 5's shape; tolerant of a legacy
 * top-level `.lines`), and validates each field. hasInvoice is TRUE whenever such a
 * receipt EXISTS even if it parsed zero lines (so `not_billed` still applies).
 */
async function loadInvoiceLeg(sb: ServiceClient, poId: string): Promise<{ lines: InvoiceLineInput[]; hasInvoice: boolean }> {
  const { data: rows, error } = await sb.from("email_receipts")
    .select("id, parsed_json, received_at")
    .eq("linked_po_id", poId).eq("doc_kind", "invoice")
    .order("received_at", { ascending: false })
    .limit(1)
    .returns<Array<{ id: string; parsed_json: unknown; received_at: string }>>();
  if (error) throw new Error(`buildThreeWayView invoice: ${error.message}`);
  const row = (rows ?? [])[0];
  if (!row) return { lines: [], hasInvoice: false };

  return { lines: readInvoiceLines(row.parsed_json), hasInvoice: true };
}

/** The invoice-line shape from a parse row's parsed_json. Task 5 nests the extraction
 *  under `.extraction`; a defensive top-level `.lines` fallback tolerates any legacy row. */
interface RawInvoiceLine {
  description?: unknown;
  qty?: unknown;
  unit?: unknown;
  unitPriceCents?: unknown;
  extendedCents?: unknown;
}

/** Coerce a receipt's parsed_json into typed BILLED lines (advisory-null per field).
 *  Untrusted-LLM content: numbers accepted only when finite (the parse engine already
 *  bounded them ≥0); strings copied opaquely. Never throws on a malformed jsonb. */
function readInvoiceLines(parsedJson: unknown): InvoiceLineInput[] {
  if (!parsedJson || typeof parsedJson !== "object") return [];
  const pj = parsedJson as { extraction?: { lines?: unknown }; lines?: unknown };
  const rawLines = pj.extraction?.lines ?? pj.lines; // Task 5 shape first, legacy top-level fallback.
  if (!Array.isArray(rawLines)) return [];
  const out: InvoiceLineInput[] = [];
  for (const raw of rawLines) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as RawInvoiceLine;
    out.push({
      description: typeof l.description === "string" ? l.description : null,
      qty: num(l.qty as number | string | null),
      unit: typeof l.unit === "string" ? l.unit : null,
      unitPriceCents: num(l.unitPriceCents as number | string | null),
      extendedCents: num(l.extendedCents as number | string | null),
    });
  }
  return out;
}

/**
 * Patch the real vendor_items.name onto any received-but-not-ordered rows (the pure
 * brain seeds their name with the skuId, since it has no snapshot name for a SKU that
 * wasn't ordered). A row is "unordered" iff its key is a UUID skuId AND its name still
 * equals that key. One batch query; a missing SKU row leaves the placeholder untouched.
 */
async function resolveUnorderedRowNames(sb: ServiceClient, view: ThreeWayView): Promise<void> {
  // The UUID test is load-bearing, not cosmetic: keys are line identities from the pure
  // brain, and a non-UUID one reaching `.in("id", …)` makes Postgres raise 22P02 and takes
  // the whole three-way view down. Non-UUID keys keep their fallback name instead.
  const unresolved = view.lines.filter((l) => l.name === l.key && UUID_RE.test(l.key));
  if (unresolved.length === 0) return;
  const skuIds = [...new Set(unresolved.map((l) => l.key))];
  const { data: skus, error } = await sb.from("vendor_items")
    .select("id, name, item_number").in("id", skuIds)
    .returns<Array<{ id: string; name: string; item_number: string | null }>>();
  if (error) throw new Error(`buildThreeWayView unordered names: ${error.message}`);
  const byId = new Map((skus ?? []).map((s) => [s.id, s]));
  for (const l of unresolved) {
    const sku = byId.get(l.key);
    if (sku) {
      l.name = sku.name;
      l.itemNumber = sku.item_number;
    }
  }
}

// Re-export the view types so server consumers can import from the server module path
// (client components import the client-safe leaf lib/po-match-shared directly).
export type { ThreeWayView, ThreeWayLine, ThreeWayFlag } from "@/lib/po-match-shared";
