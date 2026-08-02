/**
 * Door-ceremony math — PURE (client-safe, zero I/O, no server imports;
 * fully unit-testable). The `*-shared.ts` pattern (AGENTS.md): the receiving
 * server lib and its vitest suite both import from here.
 *
 * Credit derivation follows spec D1: the intake's recorded unit_price is the
 * price authority for vendor credit amounts — never a live catalogue lookup.
 * qty is in level units (cases, packs, each — whatever the delivery line
 * carries); null qty means the full line is in question and a human judgment
 * call is required before submitting the credit claim.
 *
 * Dedupe identity for a whole delivery = (vendor, location, date, lower(invoice)),
 * enforced by the partial unique index vendor_deliveries_dedupe_uq (migration 0169).
 * Null-invoice deliveries are INTENTIONALLY exempt (same-day COD / no-invoice drops
 * are legitimate). The old string-key helper (dedupeKey) was never called in
 * production — the real dedupe is the app-level select guard + that index — so it
 * was removed. isDuplicateAppend (below) is the separate line-append double-submit
 * guard for addDeliveryLines.
 *
 * Everything returns null rather than guessing when an input is missing:
 * a null amount is an advisory, never a fabricated number.
 */

export interface IntakeLineForCredits {
  deliveryItemId: string;
  skuId: string;
  qtyReceived: number;
  expectedQty: number | null;
  unitPrice: number | null;
  discrepancyType: "short" | "over" | "damaged" | "substitution" | null;
}

export interface CreditDraft {
  deliveryItemId: string;
  skuId: string;
  reason: "short" | "over" | "damaged" | "substitution";
  qty: number | null;          // level units; null = whole-line judgment call
  amountCents: number | null;  // qty * intake unit_price; intake price is price authority (spec D1)
}

export function deriveCreditDrafts(lines: IntakeLineForCredits[]): CreditDraft[] {
  const out: CreditDraft[] = [];
  for (const l of lines) {
    if (!l.discrepancyType) continue;
    let qty: number | null = null;
    if (l.expectedQty != null) {
      const delta =
        l.discrepancyType === "over"
          ? l.qtyReceived - l.expectedQty
          : l.expectedQty - l.qtyReceived;
      qty = delta > 0 ? delta : null;
    }
    const amountCents =
      qty != null && l.unitPrice != null
        ? Math.round(qty * l.unitPrice * 100)
        : null;
    out.push({
      deliveryItemId: l.deliveryItemId,
      skuId: l.skuId,
      reason: l.discrepancyType,
      qty,
      amountCents,
    });
  }
  return out;
}

/** A single line as it lands in a delivery-append batch (identity tuple only). */
export interface AppendLine {
  skuId: string;
  level: string | null;
  qty: number;
}

/**
 * Double-submit guard for addDeliveryLines: is `incoming` an EXACT multiset match of
 * some `recent` batch already appended in the last window? Compares on the identity
 * tuple (skuId, level ?? null, qty) as a MULTISET — same tuples AND same per-tuple
 * counts. Returns true only on an exact match (a network retry / double-tap re-sends
 * the identical batch); a differing qty, a subset, a superset, or an empty recent
 * window → false (a legitimately different append proceeds).
 *
 * NOTE: this is a pragmatic 60s window guard for P1 (no UI drives the append route
 * yet — continue-mode is deferred). A proper client-supplied idempotency token ships
 * with the continue-mode UI; this guard retires when that lands.
 */
export function isDuplicateAppend(incoming: AppendLine[], recent: AppendLine[]): boolean {
  if (incoming.length === 0 || recent.length === 0) return false;
  if (incoming.length !== recent.length) return false;
  const key = (l: AppendLine) => `${l.skuId}|${l.level ?? ""}|${l.qty}`;
  const counts = new Map<string, number>();
  for (const l of recent) counts.set(key(l), (counts.get(key(l)) ?? 0) + 1);
  for (const l of incoming) {
    const k = key(l);
    const c = counts.get(k);
    if (!c) return false; // a tuple in incoming not present (or over-consumed) in recent
    counts.set(k, c - 1);
  }
  return true; // exact multiset match (equal lengths + every incoming tuple consumed)
}
