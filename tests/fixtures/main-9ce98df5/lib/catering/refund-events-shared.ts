// FROZEN COPY of main @ 9ce98df5 — never edit
/**
 * Refund EVENTS (audit W26/B140, review r1; migration 0333 `catering_payment_refund_events`).
 *
 * Stripe sends `charge.refunded` once per refund, carrying the charge's CUMULATIVE
 * `amount_refunded`. The webhook appends ONE row per event (keyed by the Stripe event id, so a
 * redelivery adds nothing) holding that cumulative figure and the event's own time. What a
 * single refund gave back is derived here, never stored: the event's cumulative minus the
 * cumulative of the event BEFORE it in the charge's history.
 *
 * "Before" is the CUMULATIVE figure's order, never the stored time's (review r2): a charge's
 * `amount_refunded` only ever rises, so it orders the refunds on its own, while the stored time
 * can come from two sources (Stripe's event time on a live or payload-backfilled row; the
 * delivery time on an approximate backfilled row — migration 0333) and mixing them must not be
 * able to reorder history. Time (then event id) is only the tiebreak among equal figures, so a
 * repeat of the same total under another event id is 0 on the later one. $10 then the remaining
 * $90 is 10 and 90 whatever times are stored. Never negative.
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
      const c = Number(a.cumulative_refunded_cents) - Number(b.cumulative_refunded_cents);
      if (c !== 0) return c;
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
