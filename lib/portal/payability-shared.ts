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
 */

export type QuoteUnpayableReason =
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
  if (status !== "sent" && status !== "submitted") return false;
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at < now;
}

export function quotePayability(quote: QuotePayabilityInput, now: number = Date.now()): QuotePayability {
  if (quote.supersededAt != null) return { payable: false, reason: "superseded" };
  if (quote.status === "declined") return { payable: false, reason: "declined" };
  if (quote.status === "expired" || quoteTimeExpired(quote.status, quote.expiresAt, now)) {
    return { payable: false, reason: "expired" };
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
