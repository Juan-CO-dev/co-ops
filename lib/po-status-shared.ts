/**
 * Purchase-order status sets shared by client and server (zero I/O).
 *
 * `PO_AT_OR_BEYOND_CONFIRMED`: the order is in flight or done, so a vendor's cutoff for the
 * day is MET. `invoiced` belongs here: receiving moves a `placed` PO to `invoiced`
 * (`applyReceiptPoEffects`), and leaving it out made a received order read "missed cutoff,
 * call the vendor" again (audit W18/B104). The walk's cutoff attention and the report digest
 * read this one set. (`PO_LINKABLE_STATUSES` in lib/email-receipts.ts has the same members
 * but a different meaning, "a receipt may link to it", and stays its own constant.)
 */
export const PO_AT_OR_BEYOND_CONFIRMED: ReadonlySet<string> = new Set([
  "confirmed",
  "placed",
  "invoiced",
  "received",
  "reconciled",
]);
