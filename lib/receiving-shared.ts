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
 * dedupeKey prevents double-filing the same delivery when a driver hands
 * amended paperwork: vendor + invoice (normalised) + date is the identity.
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

export function dedupeKey(
  vendorId: string,
  invoiceNumber: string | null,
  deliveryDate: string,
): string {
  return `${vendorId}|${(invoiceNumber ?? "").trim().toLowerCase()}|${deliveryDate}`;
}
