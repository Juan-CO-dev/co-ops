/**
 * The draft PO panel's PATCH payload — PURE (client-safe, zero I/O, no server imports). The
 * `*-shared.ts` pattern (AGENTS.md): components/ordering/PoPanel.tsx and its vitest suite both
 * import from here.
 *
 * Every edited line goes out at its (possibly edited) qty, with two exclusions:
 *   - a qty that is not a finite number >= 0 (the panel blocks Save on those anyway), and
 *   - W08/B056 r2: an UNSAVED new line (picked in "Add item", not yet on the PO) at qty 0.
 *     Setting a pick to 0 means "never mind", so nothing is sent for it. This is also the recovery
 *     path when a picked SKU stops fitting the PO before Save (switched off at the shop, say): the
 *     manager zeroes it and saves the rest without reloading.
 * A SAVED line at qty 0 is still sent — that is how an existing line is removed (append-only:
 * the lib stores qty 0, transmission skips it).
 */

export interface DraftEditState {
  qty: string;
  note: string | null;
  orderUnitLabel?: string | null;
}

export interface DraftEditPayloadLine {
  skuId: string;
  orderQty: number;
  note: string | null;
  orderUnitLabel: string | null | undefined;
}

export function buildDraftEditPayload(
  edits: Readonly<Record<string, DraftEditState>>,
  savedSkuIds: ReadonlySet<string>,
): DraftEditPayloadLine[] {
  return Object.entries(edits)
    .map(([skuId, e]) => ({ skuId, orderQty: Number(e.qty), note: e.note, orderUnitLabel: e.orderUnitLabel }))
    .filter((l) => Number.isFinite(l.orderQty) && l.orderQty >= 0)
    .filter((l) => l.orderQty > 0 || savedSkuIds.has(l.skuId));
}
