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

import { buildPackChain, chainRootLabel, type PackChainLevel } from "@/lib/pack-chain-shared";

/** The variance flags a three-way line may carry (spec §5). */
export type ThreeWayFlag =
  | "billed_over_received" // billedQty > receivedQty (both known): the invoice charges for more than arrived.
  | "short_received" // receivedQty < orderedQty (both known): the door count came in under the order.
  | "unmatched_invoice_line" // an invoice line joined no ordered/received SKU — its own row.
  | "invoice_credit" // a credit/return line (negative qty or amount) — its own row, never joined (W04/B044).
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
  /** The invoice line's own unit, as printed (W04/B045: shown beside the billed qty). */
  billedUnit: string | null;
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
 *  Numbers are already validated finite by the parse engine (untrusted-LLM law); qty and
 *  extendedCents are SIGNED, negative on a credit/return line (W04/B044). */
export interface InvoiceLineInput {
  description: string | null;
  qty: number | null;
  unit: string | null;
  unitPriceCents: number | null;
  extendedCents: number | null;
}

/**
 * A multi-level SKU's units (W04/B045): how many LEAF containers one of each level holds
 * (case = 12 x each, each = 32 oz → case 12, each 1), keyed by normalized label. Built only
 * for chains with 2+ levels: a single-level SKU has no inner unit to confuse, so it keeps
 * the raw comparison it always had.
 */
export interface SkuUnitScale {
  rootLabel: string;
  leafPerLevel: ReadonlyMap<string, number>;
}

/** The scale of an active pack chain, or null (single-level, malformed or cyclic chain). */
export function unitScaleFromChain(levels: readonly PackChainLevel[] | null | undefined): SkuUnitScale | null {
  if (!levels || levels.length < 2) return null;
  const chain = buildPackChain([...levels]);
  const root = chainRootLabel(chain);
  if (root == null) return null;
  const path: PackChainLevel[] = [];
  const seen = new Set<string>();
  let node = chain.byLabel.get(root);
  while (node) {
    if (seen.has(node.id)) return null;
    seen.add(node.id);
    path.push(node);
    node = node.containsLevelId ? chain.byId.get(node.containsLevelId) : undefined;
  }
  if (path.length < 2) return null;
  const leafPerLevel = new Map<string, number>();
  let factor = 1;
  for (let i = path.length - 1; i >= 0; i--) {
    if (i < path.length - 1) {
      const qty = path[i]!.containsQty;
      if (!Number.isFinite(qty) || qty <= 0) return null;
      factor *= qty;
    }
    const key = norm(path[i]!.label);
    if (key != null && !leafPerLevel.has(key)) leafPerLevel.set(key, factor);
  }
  const rootKey = norm(root);
  return rootKey == null ? null : { rootLabel: rootKey, leafPerLevel: new Map([...leafPerLevel].reverse()) };
}

/** Vendor case codes: the root is the vendor's shipping pack (seed 38). */
const CASE_CODES = new Set(["cs", "ca"]);

/** Leaf containers in ONE `unit` of this SKU, or null when the unit cannot be resolved.
 *  `nullIsRoot`: a door count / order line with no level is in root packs (legacy rule);
 *  an invoice line with no unit is unknown. */
function leafFactor(unit: string | null, scale: SkuUnitScale, nullIsRoot: boolean): number | null {
  const key = norm(unit);
  if (key == null) return nullIsRoot ? scale.leafPerLevel.get(scale.rootLabel) ?? null : null;
  const direct = scale.leafPerLevel.get(key) ?? (key.endsWith("s") ? scale.leafPerLevel.get(key.slice(0, -1)) : undefined);
  if (direct != null) return direct;
  return CASE_CODES.has(key) ? scale.leafPerLevel.get(scale.rootLabel) ?? null : null;
}

/** Two quantities in one unit, or null (the flag stays off: advisory-null). Without a scale the
 *  raw numbers compare, exactly as before W04/B045. */
function inOneUnit(
  a: { qty: number | null; unit: string | null; nullIsRoot: boolean },
  b: { qty: number | null; unit: string | null; nullIsRoot: boolean },
  scale: SkuUnitScale | undefined,
): [number, number] | null {
  if (a.qty == null || b.qty == null) return null;
  if (!scale) return [a.qty, b.qty];
  const fa = leafFactor(a.unit, scale, a.nullIsRoot);
  const fb = leafFactor(b.unit, scale, b.nullIsRoot);
  return fa == null || fb == null ? null : [a.qty * fa, b.qty * fb];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** A finite number or null (advisory-null: anything non-finite is treated as unknown,
 *  never as 0). Guards every comparison so a NaN/Infinity can't fire a false flag. */
function fin(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Trim + lowercase for case-insensitive key/name comparison; empty → null. */
export function norm(s: string | null | undefined): string | null {
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
  /** Per-SKU units of multi-level chains (W04/B045); absent = raw comparison. */
  unitScales: ReadonlyMap<string, SkuUnitScale> = new Map(),
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
      billedUnit: null,
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
      billedUnit: null,
      billedCents: null,
      flags: [],
    });
  }

  // ── (2) Fuzzy-join each invoice line onto a row (itemNumber, then name-contains). ─
  // A row already carrying a billed leg is NOT a candidate again (one invoice line per
  // row — a second match would clobber the first; leave the extra as unmatched).
  const billedRowKeys = new Set<string>();
  for (const inv of invoiceLines) {
    // W04/B044: a credit (negative qty or amount) is never a SKU's billed leg, and a line with
    // no billed number at all (a legacy row whose credit amount was dropped) cannot take one
    // either: either would leave the real charge line with no free row to join.
    const credit = (fin(inv.qty) ?? 0) < 0 || (fin(inv.extendedCents) ?? 0) < 0;
    const joinable = !credit && (fin(inv.qty) != null || fin(inv.extendedCents) != null);
    const matchKey = joinable ? joinInvoiceLine(inv, rows, billedRowKeys) : null;
    if (matchKey != null) {
      const row = rows.find((r) => r.key === matchKey)!;
      row.billedQty = fin(inv.qty);
      row.billedUnit = inv.unit;
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
        billedUnit: inv.unit,
        billedCents: fin(inv.extendedCents),
        flags: [credit ? "invoice_credit" : "unmatched_invoice_line"],
      });
    }
  }

  // ── (3) Fire the comparison flags (both-sides-known law). ─────────────────────
  for (const row of rows) {
    if (row.flags.includes("unmatched_invoice_line") || row.flags.includes("invoice_credit")) continue; // its own row; no cross-leg compare.

    // W04/B045: each comparison is made in ONE unit through the SKU's pack chain; a unit
    // that cannot be resolved leaves its flag off.
    const scale = unitScales.get(row.key);
    const received = { qty: row.receivedQty, unit: row.receivedLevel, nullIsRoot: true };
    // billed_over_received: the invoice charges for more than the door counted.
    const billedVsReceived = inOneUnit({ qty: row.billedQty, unit: row.billedUnit, nullIsRoot: false }, received, scale);
    if (billedVsReceived && billedVsReceived[0] > billedVsReceived[1]) {
      row.flags.push("billed_over_received");
    }
    // short_received: the door count came in under what was ordered.
    const receivedVsOrdered = inOneUnit(received, { qty: row.orderedQty, unit: row.orderedUnit, nullIsRoot: true }, scale);
    if (receivedVsOrdered && receivedVsOrdered[0] < receivedVsOrdered[1]) {
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
    (r) => !taken.has(r.key) && !r.flags.includes("unmatched_invoice_line") && !r.flags.includes("invoice_credit"),
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
