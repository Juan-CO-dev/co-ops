/**
 * "May the customer still pay this quote from the portal?" — the ONE pure rule, shared by
 * every surface that has to answer it (audit wave W02, B037 + B038):
 *
 *   lib/portal/quotes.ts   `loadPayableQuote` — the server gate in front of every intent
 *                          and every Checkout Session.
 *   app/order/quote/[id]   the pay panel — a button is only drawn for a quote the server
 *                          would accept, so the page and the gate cannot drift apart.
 *   lib/portal/account.ts  the account list's "Review & pay" call to action.
 *
 * PURE: no I/O, no server imports (the `*-shared.ts` law), `now` is a parameter. Three
 * callers reading one function is the point — the bugs this closes were all a rule that
 * existed in one place and not in another.
 *
 * ── EXPIRY IS A CLOCK, NOT ONLY A STATUS (B037) ──────────────────────────────────────
 * `status = 'expired'` is written only when a manager marks a quote expired by hand.
 * Nothing sweeps `expires_at`, so a quote past its date kept `status = 'sent'` and stayed
 * payable at its old price indefinitely. A quote is therefore expired when EITHER the
 * status says so OR it is still an open offer (`sent`, or a self-serve `submitted` order —
 * `submitDraft` stamps the same 14-day window on those) whose `expires_at` has passed.
 * `accepted` is not an open offer any more — the team has confirmed it — and `draft` has
 * not been offered yet, so neither is judged by the clock.
 *
 * ── A DRAFT IS NOT AN OFFER (B038) ───────────────────────────────────────────────────
 * Only three statuses are payable: `submitted` (the customer completed a self-serve
 * order), `sent` (the team offered a quote) and `accepted` (the team confirmed it). A
 * `draft` is neither priced for good nor offered: a self-serve draft's deposit moves with
 * every line the customer adds, and a staff draft is a working revision nobody has sent.
 * The gate used to let a draft raise a `due` intent at whatever the deposit happened to be
 * that minute. The allow-list is closed on purpose — a status this code does not know is
 * not payable either.
 */

export type QuoteUnpayableReason =
  | "draft" // not offered yet: still being built (self-serve) or prepared (staff)
  | "superseded" // a newer revision replaced this one
  | "declined"
  | "expired"; // the status, or the clock on an open offer

export type QuotePayability = { payable: true } | { payable: false; reason: QuoteUnpayableReason };

export interface QuotePayabilityInput {
  status: string;
  supersededAt: string | null;
  expiresAt: string | null;
}

/**
 * True when an OPEN OFFER has run past its `expires_at`. Payment-agnostic on purpose: a
 * deposit paid inside the window means the offer was taken up, and the callers that know
 * about payments (the page, `customerOrderStatus`) apply that themselves.
 */
export function quoteTimeExpired(status: string, expiresAt: string | null, now: number = Date.now()): boolean {
  const deadline = offerDeadlineMs(status, expiresAt);
  return deadline != null && deadline < now;
}

/**
 * The instant an OPEN OFFER stops being one, in epoch milliseconds — or null when this
 * quote is not judged by the clock at all (not `sent` / `submitted`, or no usable
 * `expires_at`). `quoteTimeExpired` above is "that instant has passed"; the checkout path
 * reads the instant itself, so the session it mints ends when the offer does.
 */
export function offerDeadlineMs(status: string, expiresAt: string | null): number | null {
  if (status !== "sent" && status !== "submitted") return null;
  if (!expiresAt) return null;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) ? at : null;
}

/**
 * "Was this offer TAKEN UP IN TIME?" — the one exemption to an expired offer (audit W02,
 * review r2). A lapsed offer the customer paid toward INSIDE its window is an order, not a
 * dead quote, and the team may still confirm it. But "a paid row exists" is not that fact:
 * a checkout opened before the date can be completed after it, and staff can record a
 * payment by hand any day. So a payment counts only when it is `paid` AND its `paid_at` is
 * not after the offer's `expires_at`. A paid row that cannot say when it was paid proves
 * nothing. With no usable `expires_at` there is no deadline to be late for.
 *
 * A payment that settled late is not lost or hidden — it is on the quote, flagged for
 * review (`paid_after_expiry`, lib/stripe/webhook.ts) — it just does not re-open the offer
 * by itself: a person revises the quote (the payment follows it) or refunds the money.
 */
export function offerTakenUpInTime(
  expiresAt: string | null,
  payments: ReadonlyArray<{ status: string; paidAt: string | null }>,
): boolean {
  const deadline = expiresAt ? Date.parse(expiresAt) : NaN;
  const paid = payments.filter((p) => p.status === "paid");
  if (!Number.isFinite(deadline)) return paid.length > 0;
  return paid.some((p) => {
    const at = p.paidAt ? Date.parse(p.paidAt) : NaN;
    return Number.isFinite(at) && at <= deadline;
  });
}

export function quotePayability(quote: QuotePayabilityInput, now: number = Date.now()): QuotePayability {
  if (quote.supersededAt != null) return { payable: false, reason: "superseded" };
  if (quote.status === "declined") return { payable: false, reason: "declined" };
  if (quote.status === "expired" || quoteTimeExpired(quote.status, quote.expiresAt, now)) {
    return { payable: false, reason: "expired" };
  }
  if (quote.status !== "submitted" && quote.status !== "sent" && quote.status !== "accepted") {
    return { payable: false, reason: "draft" };
  }
  return { payable: true };
}

/**
 * What the quote page's pay area should do, from the server facts alone.
 *
 *   showOptions — draw the pay buttons. Never once anything is paid (both of the plan's
 *                 options are priced for an UNPAID quote), and never for a quote the server
 *                 gate would refuse.
 *   notice      — why there is nothing to pay, when that is the quote's own state. An
 *                 expiry that passed AFTER a payment landed is not a notice: the customer
 *                 took the offer up in time, and telling them it "expired" would be false.
 */
export function payPanelState(input: { payability: QuotePayability; paidCount: number }): {
  showOptions: boolean;
  notice: QuoteUnpayableReason | null;
} {
  const { payability, paidCount } = input;
  if (payability.payable) return { showOptions: paidCount === 0, notice: null };
  const quiet = payability.reason === "expired" && paidCount > 0;
  return { showOptions: false, notice: quiet ? null : payability.reason };
}
