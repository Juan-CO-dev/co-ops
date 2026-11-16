/**
 * Refund EVENTS (audit W26/B140, review r1; migration 0333 `catering_payment_refund_events`).
 *
 * Stripe sends `charge.refunded` once per refund, carrying the charge's CUMULATIVE
 * `amount_refunded`. The webhook appends ONE row per event (keyed by the Stripe event id, so a
 * redelivery adds nothing) holding that cumulative figure and the event's own time. What a
 * single refund gave back is derived here, never stored: the event's cumulative minus the
 * highest cumulative of the same payment's EARLIER events (by time, then event id). Ordering
 * by the event's time — not by when it was delivered — keeps a late delivery from swallowing
 * an earlier refund: $10 on Tuesday then the remaining $90 on Wednesday is $10 on Tuesday and
 * $90 on Wednesday whichever arrives first. A figure that does not rise (a repeat of the same
 * total under another event id) is 0, never negative.
 *
 * Pure: no I/O. The digest (lib/report-digests.ts) loads the rows and asks this.
 */
export interface RefundEventRow {
  stripe_event_id: string;
  payment_id: string;
  refunded_at: string;
  cumulative_refunded_cents: number;
}

/** event id → cents that event's refund gave back. Every row given gets an entry. */
export function refundEventAmounts(rows: readonly RefundEventRow[]): Map<string, number> {
  const byPayment = new Map<string, RefundEventRow[]>();
  for (const r of rows) byPayment.set(r.payment_id, [...(byPayment.get(r.payment_id) ?? []), r]);
  const out = new Map<string, number>();
  for (const list of byPayment.values()) {
    const ordered = [...list].sort((a, b) => {
      const t = Date.parse(a.refunded_at) - Date.parse(b.refunded_at);
      if (t !== 0) return t;
      return a.stripe_event_id < b.stripe_event_id ? -1 : a.stripe_event_id > b.stripe_event_id ? 1 : 0;
    });
    let seen = 0;
    for (const r of ordered) {
      const cum = Number(r.cumulative_refunded_cents);
      out.set(r.stripe_event_id, Math.max(0, cum - seen));
      seen = Math.max(seen, cum);
    }
  }
  return out;
}
