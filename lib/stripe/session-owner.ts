/**
 * Which Stripe account OWNS a Checkout Session — and retiring a session through it (audit
 * wave W02, review r4 P2). SERVER-ONLY.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────
 * A shop's credentials resolve per shop, with a shared default (lib/stripe/client.ts): the
 * account a shop takes NEW money through can change — an override is added, replaced or
 * removed. A Checkout Session opened before the change lives on in the OLD account, open and
 * payable. A secret key reaches its own account's objects ("Stripe uses API keys to
 * authenticate requests from your integration and determine which Stripe resources it can
 * access" — docs.stripe.com/keys; a request acts on the key's own account unless a
 * `Stripe-Account` header names a connected one — docs.stripe.com/connect/authentication —
 * and this codebase sends none), so the NEW account's key is answered 404 for that session
 * ("404 Not Found: The requested resource doesn't exist" — docs.stripe.com/api/errors).
 * WHAT IS NOT ASSUMED: the docs do not spell out the status for "another account's object",
 * and nothing here depends on it — the rule below is only that a 404 proves nothing. That
 * 404 was read as "expired": the id was cleared from its row and a second checkout was
 * opened beside a first that anyone holding its link could still pay.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────
 * A 404 MEANS "THIS KEY CANNOT SEE IT". ONLY AN ACCOUNT THAT KNOWS A SESSION CAN SAY IT IS
 * CLOSED. So a session is retired by asking each account the shop is configured with
 * (`stripeAccountsForShop`), the one new money goes to first:
 *   · an account that KNOWS the session answers `expired` or `complete` — that is the
 *     owner speaking, and it is the answer;
 *   · an account that does not know it (`session_not_found`) says nothing; the next is asked;
 *   · when NO account gives an answer, this THROWS. Every caller already treats a throw as
 *     "not confirmed closed": the id stays on its row as an unresolved checkout, the pay
 *     path refuses to open another (502), a settlement reports it `stillOpen`, a revise
 *     moves the intent as it is (lib/catering/payment-sessions.ts has the rule).
 *
 * ── WHY THE OWNER IS FOUND BY ASKING, NOT STORED ON THE ROW ──────────────────────────
 * The account a session was minted in IS recorded — `catering.payment.checkout_created`
 * audits `credential_source` (`location` | `default`) beside the session id. It is not used
 * to pick a key, and no column was added for it, because that label is not an identity: it
 * names a SLOT, and the key in the slot is exactly what changes (an override replaced by
 * another account's keys is still `location`). The session id is the identity — it resolves
 * in one account and no other — so asking each configured account is the check a stored
 * label could only approximate, and it also covers every session opened before this fix.
 * What neither can do is retire a session whose account's key is no longer configured
 * anywhere; that one stays unresolved (below).
 *
 * ── WHEN NOBODY CAN CONFIRM IT: HOW AN UNRESOLVED ID IS CLEARED ──────────────────────
 * Giving a shop its own pair BESIDE the shared one strands nothing: the shared account is
 * still listed below and closes what it owns. What strands a checkout is a change that
 * takes its account's key OUT of the configuration — a shop's pair replaced by another
 * account's keys, or removed. That checkout's row stays unresolved (and the pay path
 * refuses on that order) until one of two things happens:
 *   · Stripe's own `checkout.session.expired` event for it arrives (or, for a session whose
 *     delayed payment failed, `checkout.session.async_payment_failed`) and the webhook clears
 *     the id (lib/stripe/webhook.ts) — which needs the old account's webhook endpoint and
 *     signing secret to be still configured. A session expires by itself at most 24 hours
 *     after it was created ("It can be anywhere from 30 minutes to 24 hours after Checkout
 *     Session creation" — docs.stripe.com/api/checkout/sessions/create, `expires_at`);
 *   · a person expires the session in the old account's Stripe dashboard and then sets that
 *     row's `provider_session_id` to null.
 * So run the LIVE-CHECK before taking a key out of the configuration (nothing listed for
 * the shop = nothing to strand) and after it (anything listed is the second bullet's work):
 *   select p.id, p.quote_id, p.status, p.provider_session_id, q.location_id
 *     from catering_payments p join catering_quotes q on q.id = p.quote_id
 *    where p.status in ('due','void') and p.provider_session_id is not null;
 *
 * NEVER LOG A KEY. Nothing here puts key material in a message; a StripeError carries
 * Stripe's description of the request.
 */
import "server-only";

import {
  isSessionNotFound,
  retireCheckoutSession,
  stripeCredentialsFor,
  StripeError,
  type RetiredCheckoutSession,
  type StripeCredentials,
} from "@/lib/stripe/client";

/**
 * Every Stripe account this shop's Checkout Sessions may live in, as far as the deployment
 * is configured to reach: the pair NEW money goes to first (the shop's own, or the shared
 * one), then the shared pair when it is a different account. Complete pairs only, each
 * account once. Empty = this shop cannot reach Stripe at all.
 *
 * A shop whose own pair is HALF configured takes no new money (the all-or-nothing rule of
 * `stripeCredentialsFor`), but the shared account is still listed: closing a checkout it
 * owns moves no money and pairs no account with another's webhook secret.
 *
 * `locationCode` is the shop's `locations.code` AS READ (null = a shop with no code, which
 * rides the shared account, exactly as `stripeCredentialsFor` reads it). A caller whose READ
 * of the shop FAILED must not call this at all (audit W02/B146): "we do not know the shop"
 * is not "the shared account".
 */
export function stripeAccountsForShop(locationCode: string | null): StripeCredentials[] {
  const accounts: StripeCredentials[] = [];
  for (const creds of [stripeCredentialsFor(locationCode), stripeCredentialsFor(null)]) {
    if (creds && !accounts.some((a) => a.secretKey === creds.secretKey)) accounts.push(creds);
  }
  return accounts;
}

/**
 * Make a Checkout Session unpayable THROUGH THE ACCOUNT THAT OWNS IT, or learn that its
 * payment is already under way. THROWS when no listed account confirms either (see the
 * header) — including when none of them knows the session.
 *
 * Every account is asked even after one fails for a reason of its own (an outage, a revoked
 * key): the session may live in another, and a definite answer from the account that knows
 * it is the truth whatever the others said. When nobody answers, the error thrown is the
 * most useful one: an account we could not ASK outranks an account that did not KNOW —
 * "Stripe was unreachable" must not be reported as "no such session".
 */
export async function retireSessionInOwningAccount(
  accounts: ReadonlyArray<Pick<StripeCredentials, "secretKey">>,
  sessionId: string,
): Promise<RetiredCheckoutSession> {
  if (accounts.length === 0) throw new StripeError(500, "not_configured", "No Stripe account is configured for this shop");
  let notKnown: unknown = null;
  let couldNotAsk: unknown = null;
  for (const account of accounts) {
    try {
      return await retireCheckoutSession(account.secretKey, sessionId);
    } catch (e) {
      if (isSessionNotFound(e)) notKnown ??= e;
      else couldNotAsk ??= e;
    }
  }
  throw couldNotAsk ?? notKnown;
}
