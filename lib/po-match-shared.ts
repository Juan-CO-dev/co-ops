/**
 * Three-way match — the PURE join/compare brain (Vendor Ordering V2 §5).
 *
 * Client-safe LEAF module: zero I/O, no server imports (no supabase-server, no
 * "server-only"). It joins the three legs of a purchase order — what was ORDERED
 * (the frozen confirmed_snapshot), what was RECEIVED (the door count), and what was
 * BILLED (the linked invoice's parsed lines) — into one advisory line table with
 * per-line variance flags. The server loader (lib/po-match.ts) fetches the three
 * legs; this module is the deterministic compare so it can be unit-tested in
 * isolation (vitest spine law) and typed by the panel without importing the
 * service-role module.
 *
 * ── ADVISORY-NULL LAW (spec §5, house A3) ──────────────────────────────────────
 * A missing leg is `null`, NEVER a fabricated 0. A flag fires ONLY when BOTH sides
 * of its comparison are known finite numbers — a null on either side SUPPRESSES the
 * flag (we never accuse a vendor of over-billing a leg we never received, nor call a
 * leg "short" when nothing was ordered). The three-way view is the manager's
 * EVIDENCE; the human stays the judge (V1 thesis) — nothing here gates or blocks.
 *
 * ── UNTRUSTED VENDOR CONTENT ────────────────────────────────────────────────────
 * Invoice descriptions/units come from an LLM parse of an untrusted vendor document
 * (lib/receipt-parse.ts). They flow through here as OPAQUE DATA (strings copied onto
 * rows, numbers only after the server validated them finite/≥0). This module does no
 * markup, no href/src derivation — the consumer renders every string as text only.
 *
 * ── THE JOIN ────────────────────────────────────────────────────────────────────
 * Snapshot↔delivery join deterministically by skuId (both legs carry the SKU id).
 * Invoice lines carry NO skuId (the vendor's document doesn't know our ids), so they
 * FUZZY-join onto an already-joined row:
 *   (1) exact itemNumber match (case-insensitive, trimmed) — the strongest key, or
 *   (2) name-contains (invoice description contains the SKU name OR vice versa,
 *       case-insensitive) — ONLY when UNAMBIGUOUS (exactly one candidate row).
 * An invoice line that joins nothing becomes its OWN row flagged
 * `unmatched_invoice_line`. Every ordered/received SKU row appears even when no
 * invoice line matched (so a `not_billed` gap is visible when an invoice exists).
 */

/** The variance flags a three-way line may carry (spec §5). */
export type ThreeWayFlag =
  | "billed_over_received" // billedQty > receivedQty (both known): the invoice charges for more than arrived.
  | "short_received" // receivedQty < orderedQty (both known): the door count came in under the order.
  | "unmatched_invoice_line" // an invoice line joined no ordered/received SKU — its own row.
  | "not_billed"; // ordered+received but NO invoice line matched, AND an invoice exists on the PO.

/** One reconciled line across the three legs. Any leg absent from a line is null
 *  (advisory — never fabricated). `key` is stable for React (skuId, or a synthetic
 *  key for an unmatched invoice row). */
export interface ThreeWayLine {
  key: string;
  name: string;
  itemNumber: string | null;
  /** ORDERED leg (confirmed snapshot). Null on an unmatched-invoice-only row. */
  orderedQty: number | null;
  orderedUnit: string | null;
  /** RECEIVED leg (door count). Null when no delivery line matched this SKU. */
  receivedQty: number | null;
  receivedLevel: string | null;
  /** BILLED leg (invoice parse). Null when no invoice line matched this row. */
  billedQty: number | null;
  billedCents: number | null;
  flags: ThreeWayFlag[];
}

/** The full three-way payload for one PO. `hasInvoice`/`hasDelivery` drive the
 *  advisory "no invoice yet" / "no delivery yet" notes (advisory-null law — an
 *  absent leg is stated, never implied as zero). */
export interface ThreeWayView {
  lines: ThreeWayLine[];
  totals: {
    /** Sum of ordered price×qty across snapshot lines, when computable (null when
     *  no line carried both a price and a qty — never a false $0.00). */
    orderedCents: number | null;
    /** Sum of invoice extended cents across billed lines, when any carried it. */
    billedCents: number | null;
  };
  hasInvoice: boolean;
  hasDelivery: boolean;
}

// ── Leg input shapes (the server loader shapes the three legs into these) ─────────

/** One ORDERED line (from confirmed_snapshot.lines — see confirmPO's SnapshotLine). */
export interface SnapshotLineInput {
  skuId: string;
  name: string;
  itemNumber: string | null;
  qty: number | null;
  unitLabel: string | null;
  /** The frozen unit price in cents (advisory-null; already validated by the loader). */
  priceCents: number | null;
}

/** One RECEIVED line (from vendor_delivery_items — keyed by vendor_item_id = skuId). */
export interface DeliveryLineInput {
  skuId: string;
  /** The door-count qty in the LEVEL units the manager entered (received_qty_at_level
   *  when a level was named, else qty_received) — the loader resolves this. Advisory-null. */
  qty: number | null;
  /** The pack level the qty was entered at (e.g. "case"); null on a chainless SKU. */
  level: string | null;
}

/** One BILLED line (from email_receipts.parsed_json.extraction.lines). The vendor's
 *  document carries NO skuId; the fuzzy-join matches on itemNumber/description.
 *  Numbers are already validated finite/≥0 by the parse engine (untrusted-LLM law). */
export interface InvoiceLineInput {
  description: string | null;
  qty: number | null;
  unit: string | null;
  unitPriceCents: number | null;
  extendedCents: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** A finite number or null (advisory-null: anything non-finite is treated as unknown,
 *  never as 0). Guards every comparison so a NaN/Infinity can't fire a false flag. */
function fin(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Trim + lowercase for case-insensitive key/name comparison; empty → null. */
function norm(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/** True when either string contains the other (case-insensitive, both non-empty).
 *  The name-contains fuzzy rule: an invoice description "SUB ROLL 12CT" contains the
 *  SKU name "Sub Roll", or the SKU name contains a short invoice code. */
function nameContains(a: string | null, b: string | null): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na == null || nb == null) return false;
  return na.includes(nb) || nb.includes(na);
}

/**
 * Build the three-way line table + totals from the three legs (spec §5). Pure over
 * its inputs; deterministic; every rule documented at the type above.
 *
 * hasInvoice is TRUE when the PO has a linked invoice AT ALL — passed by the loader
 * (an invoice can exist with ZERO parsed lines; `not_billed` still applies then). We
 * accept it as a param rather than infer `invoiceLines.length > 0` so an
 * empty-but-present invoice still drives the "no invoice yet" note correctly.
 */
export function buildThreeWayLines(
  snapshotLines: SnapshotLineInput[],
  deliveryLines: DeliveryLineInput[],
  invoiceLines: InvoiceLineInput[],
  hasInvoice: boolean,
): ThreeWayView {
  // Received qty by skuId (last write wins if a SKU somehow appears twice — a delivery
  // has one line per SKU in practice; we don't sum to avoid double-counting a re-open).
  const deliveryBySku = new Map<string, DeliveryLineInput>();
  for (const d of deliveryLines) deliveryBySku.set(d.skuId, d);
  const hasDelivery = deliveryLines.length > 0;

  // ── (1) One row per ordered SKU, joined to its delivery leg. ──────────────────
  const rows: ThreeWayLine[] = snapshotLines.map((s) => {
    const d = deliveryBySku.get(s.skuId);
    return {
      key: s.skuId,
      name: s.name,
      itemNumber: s.itemNumber,
      orderedQty: fin(s.qty),
      orderedUnit: s.unitLabel,
      receivedQty: d ? fin(d.qty) : null,
      receivedLevel: d ? d.level : null,
      billedQty: null,
      billedCents: null,
      flags: [],
    };
  });

  // A delivery line whose SKU wasn't on the order still deserves a row (received but
  // not ordered — e.g. a substitution). It carries a received leg + null ordered leg.
  const orderedSkuIds = new Set(snapshotLines.map((s) => s.skuId));
  for (const d of deliveryLines) {
    if (orderedSkuIds.has(d.skuId)) continue;
    rows.push({
      key: d.skuId,
      name: d.skuId, // the loader has no snapshot name for an unordered SKU; it fills the real name.
      itemNumber: null,
      orderedQty: null,
      orderedUnit: null,
      receivedQty: fin(d.qty),
      receivedLevel: d.level,
      billedQty: null,
      billedCents: null,
      flags: [],
    });
  }

  // ── (2) Fuzzy-join each invoice line onto a row (itemNumber, then name-contains). ─
  // A row already carrying a billed leg is NOT a candidate again (one invoice line per
  // row — a second match would clobber the first; leave the extra as unmatched).
  const billedRowKeys = new Set<string>();
  for (const inv of invoiceLines) {
    const matchKey = joinInvoiceLine(inv, rows, billedRowKeys);
    if (matchKey != null) {
      const row = rows.find((r) => r.key === matchKey)!;
      row.billedQty = fin(inv.qty);
      row.billedCents = fin(inv.extendedCents);
      billedRowKeys.add(matchKey);
    } else {
      // Unmatched invoice line → its own advisory row (untrusted description as text).
      rows.push({
        key: `inv:${rows.length}`,
        name: inv.description ?? "(invoice line)",
        itemNumber: null,
        orderedQty: null,
        orderedUnit: null,
        receivedQty: null,
        receivedLevel: null,
        billedQty: fin(inv.qty),
        billedCents: fin(inv.extendedCents),
        flags: ["unmatched_invoice_line"],
      });
    }
  }

  // ── (3) Fire the comparison flags (both-sides-known law). ─────────────────────
  for (const row of rows) {
    if (row.flags.includes("unmatched_invoice_line")) continue; // its own row; no cross-leg compare.

    // billed_over_received: the invoice charges for more than the door counted.
    if (row.billedQty != null && row.receivedQty != null && row.billedQty > row.receivedQty) {
      row.flags.push("billed_over_received");
    }
    // short_received: the door count came in under what was ordered.
    if (row.receivedQty != null && row.orderedQty != null && row.receivedQty < row.orderedQty) {
      row.flags.push("short_received");
    }
    // not_billed: an ordered+received SKU with no invoice line, but an invoice exists.
    if (
      hasInvoice &&
      row.billedQty == null &&
      row.billedCents == null &&
      row.orderedQty != null &&
      row.receivedQty != null
    ) {
      row.flags.push("not_billed");
    }
  }

  // ── (4) Totals (null-safe sums; null when no line carried the value). ─────────
  let orderedCents: number | null = null;
  for (const s of snapshotLines) {
    const price = fin(s.priceCents);
    const qty = fin(s.qty);
    if (price != null && qty != null) orderedCents = (orderedCents ?? 0) + price * qty;
  }
  let billedCents: number | null = null;
  for (const inv of invoiceLines) {
    const ext = fin(inv.extendedCents);
    if (ext != null) billedCents = (billedCents ?? 0) + ext;
  }

  return {
    lines: rows,
    totals: { orderedCents, billedCents },
    hasInvoice,
    hasDelivery,
  };
}

/**
 * Resolve which row an invoice line joins to, or null (→ its own unmatched row).
 * Precedence: (1) exact itemNumber, then (2) UNAMBIGUOUS name-contains. A row already
 * billed (in `taken`) is not a candidate. Ambiguity in either pass (2+ candidates) →
 * null: we never guess which of several SKUs the vendor billed (advisory-null law —
 * a wrong join is worse than an honest "unmatched invoice line").
 */
function joinInvoiceLine(
  inv: InvoiceLineInput,
  rows: ThreeWayLine[],
  taken: Set<string>,
): string | null {
  const candidates = rows.filter(
    (r) => !taken.has(r.key) && !r.flags.includes("unmatched_invoice_line"),
  );

  // (1) exact itemNumber (case-insensitive, trimmed). The invoice carries no itemNumber
  // field of its own, but its description often IS the vendor item number — so we test
  // the description against each row's itemNumber for an EXACT normalized equality.
  const invDesc = norm(inv.description);
  if (invDesc != null) {
    const byItem = candidates.filter((r) => {
      const rn = norm(r.itemNumber);
      return rn != null && rn === invDesc;
    });
    if (byItem.length === 1) return byItem[0]!.key;
    if (byItem.length > 1) return null; // ambiguous exact — never guess.
  }

  // (2) name-contains — ONLY when exactly one candidate matches (unambiguous).
  const byName = candidates.filter((r) => nameContains(r.name, inv.description));
  if (byName.length === 1) return byName[0]!.key;
  return null; // zero or ambiguous → unmatched invoice line.
}
