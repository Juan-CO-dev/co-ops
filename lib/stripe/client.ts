/**
 * Stripe REST client — SERVER-ONLY, no SDK. Three calls: create a Checkout Session, retire
 * one (`retireCheckoutSession`, audit W02/B035) and read one (`retrieveCheckoutSession`).
 *
 * package.json carries no `stripe` package and this file is why that is fine: the request
 * is a form POST with a bearer token, exactly the shape lib/receipt-parse.ts uses for the
 * Anthropic Messages API and lib/ezcater/client.ts uses for ezCater's GraphQL. Adding an
 * SDK would buy us retries and typings we already have, at the cost of a dependency that
 * ships its own HTTP stack into a Vercel function.
 *
 * ── DORMANT BY DEFAULT ───────────────────────────────────────────────────────────────
 * With no keys set, `stripeConfigured()` is false everywhere and nothing in this module is
 * ever called: the pay route records the intent and shows the stub message, exactly as it
 * did before. That is the same posture the ezCater webhook takes (503 until its secret is
 * present) and the receipt-parse cron takes (dormant until ANTHROPIC_API_KEY is present).
 *
 * ── CREDENTIALS RESOLVE PER SHOP, WITH A SINGLE-ACCOUNT DEFAULT ──────────────────────
 * The DEFAULT deployment is ONE Stripe account serving every shop: `STRIPE_SECRET_KEY` +
 * `STRIPE_WEBHOOK_SECRET`, one webhook endpoint at `/api/webhooks/stripe`. A business
 * whose shops are separate connected accounts (one per storefront, as a platform like
 * Tripleseat provisions them) sets `STRIPE_SECRET_KEY__<CODE>` /
 * `STRIPE_WEBHOOK_SECRET__<CODE>` per shop and registers
 * `/api/webhooks/stripe/<code>` for each. `<CODE>` is the `locations.code` value read from
 * the DB at runtime — there are NO shop codes in this file, per the tenant-vocabulary law.
 *
 * …SO THE ACCOUNT A SHOP USES CAN CHANGE, AND A SESSION STAYS IN THE ACCOUNT THAT MINTED IT
 * (review r4). Adding, replacing or removing a shop's own pair changes where NEW money
 * goes; a Checkout Session already open is still open in the old account, and the new
 * account's key gets a 404 for it. Nothing in this file treats that 404 as the session
 * being closed (`retireCheckoutSession`, `retrieveCheckoutSession`); lib/stripe/
 * session-owner.ts asks each account the shop is configured with. Giving a shop its own
 * pair beside the shared one needs no care: the shared account stays reachable. A change
 * that takes an account's key OUT of the configuration (a shop's pair replaced by another
 * account's, or removed) puts any checkout still open in that account beyond our reach, and
 * its row stays an unresolved checkout until it is closed some other way — session-owner.ts
 * says how, and has the live-check to run before and after such a change.
 *
 * THE PAIR IS ALL-OR-NOTHING, AND THAT IS THE POINT. If either per-location variable is
 * present, BOTH must be, and the default pair is not consulted. Falling back per-VARIABLE
 * would let a shop's own secret key be paired with the platform's webhook secret — two
 * different Stripe accounts inside one payment's lifecycle, where the charge lands in one
 * account and the webhook that marks it paid is signed by another. That mis-wiring is
 * silent and it is exactly what "configured" must refuse to report.
 *
 * NEVER LOG A KEY. No branch of this module puts `secretKey`, the webhook secret, or the
 * `Stripe-Signature` header into a message, an error, or an audit row. StripeError carries
 * Stripe's own `error.message`, which is about the REQUEST, never about the credential.
 */
import "server-only";

import { checkoutSessionParams, encodeForm, stripeEnvSuffix, type CheckoutSessionParamsInput } from "@/lib/stripe/shared";

const CHECKOUT_SESSIONS_URL = "https://api.stripe.com/v1/checkout/sessions";

/**
 * Pinned Stripe API version. Pinning means a Stripe-side default-version bump cannot
 * change a response shape under a running deployment — the same reason
 * lib/receipt-parse.ts pins `anthropic-version`.
 *
 * VERIFY BEFORE THE LEG GOES LIVE: the value must be a version this account recognises
 * (Stripe dashboard → Developers → API version). `STRIPE_API_VERSION` overrides it so a
 * correction is one Vercel variable rather than a redeploy. The params this module sends
 * (`mode`, `line_items[0][price_data]`, `metadata`, `payment_intent_data`) are stable
 * across every GA version, so the pin is about response shape, not request shape.
 */
const DEFAULT_STRIPE_API_VERSION = "2024-06-20";

function apiVersion(): string {
  return process.env.STRIPE_API_VERSION?.trim() || DEFAULT_STRIPE_API_VERSION;
}

export class StripeError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "StripeError";
  }
}

/** The `StripeError.code` for "this account's key cannot see that Checkout Session" (a 404). */
export const SESSION_NOT_FOUND = "session_not_found";

/**
 * Is this the error `retireCheckoutSession` throws when the account it asked does not know
 * the session? It is NOT a statement about the session — see `retireCheckoutSession`.
 */
export function isSessionNotFound(e: unknown): boolean {
  return e instanceof StripeError && e.code === SESSION_NOT_FOUND;
}

export interface StripeCredentials {
  secretKey: string;
  webhookSecret: string;
  /** Which pair answered — `location` = this shop's own account, `default` = the shared one. */
  source: "location" | "default";
}

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/**
 * Resolve the Stripe credentials for one shop. Returns null when neither a complete
 * per-location pair nor a complete default pair exists — which is the dormant state.
 *
 * `locationCode` is the `locations.code` value of the quote's shop (null/absent = ask for
 * the default pair directly, which is what the single-account webhook does).
 */
export function stripeCredentialsFor(locationCode?: string | null): StripeCredentials | null {
  const suffix = stripeEnvSuffix(locationCode);
  if (suffix) {
    const secretKey = env(`STRIPE_SECRET_KEY__${suffix}`);
    const webhookSecret = env(`STRIPE_WEBHOOK_SECRET__${suffix}`);
    // All-or-nothing (see header): a half-configured shop is NOT silently completed from
    // the shared account's other half.
    if (secretKey || webhookSecret) {
      return secretKey && webhookSecret ? { secretKey, webhookSecret, source: "location" } : null;
    }
  }
  const secretKey = env("STRIPE_SECRET_KEY");
  const webhookSecret = env("STRIPE_WEBHOOK_SECRET");
  return secretKey && webhookSecret ? { secretKey, webhookSecret, source: "default" } : null;
}

/** True when a complete credential pair resolves for this shop (or, with no code, the
 *  shared pair). This is THE dormancy gate every caller asks. */
export function stripeConfigured(locationCode?: string | null): boolean {
  return stripeCredentialsFor(locationCode) !== null;
}

/** Presence-only readiness for the admin integrations panel. Never returns key material. */
export interface StripeReadinessRow {
  locationId: string;
  locationCode: string;
  configured: boolean;
  /** True when this shop has its OWN pair; false when it rides the shared account. */
  ownAccount: boolean;
}
export interface StripeReadiness {
  /** The shared pair — `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, both present. */
  defaultConfigured: boolean;
  defaultSecretKeyPresent: boolean;
  defaultWebhookSecretPresent: boolean;
  locations: StripeReadinessRow[];
}

export function stripeReadiness(
  locations: ReadonlyArray<{ id: string; code: string }>,
): StripeReadiness {
  return {
    defaultConfigured: stripeCredentialsFor(null) !== null,
    defaultSecretKeyPresent: env("STRIPE_SECRET_KEY").length > 0,
    defaultWebhookSecretPresent: env("STRIPE_WEBHOOK_SECRET").length > 0,
    locations: locations.map((l) => {
      const creds = stripeCredentialsFor(l.code);
      return {
        locationId: l.id,
        locationCode: l.code,
        configured: creds !== null,
        ownAccount: creds?.source === "location",
      };
    }),
  };
}

export interface CreateCheckoutSessionResult {
  /** `cs_…` — persisted on the due row as `provider_session_id`. */
  id: string;
  /** The hosted Checkout URL the customer is redirected to. */
  url: string;
}

/**
 * Create a hosted Checkout Session.
 *
 * `idempotencyKey` protects ONE HTTP REQUEST: if the transport retries it, Stripe replays
 * the original response instead of minting twice. It must NOT be used to mean "the same
 * checkout attempt" (audit W02/B035, review r1). Stripe replays a key's ORIGINAL response
 * for at least 24 hours — whatever has happened to the session since — and refuses a key re-used
 * with different parameters (docs.stripe.com/api/idempotent_requests). A key derived from
 * the payment row therefore handed customers a session we had already retired, and 400'd
 * a revised quote for a day. The caller passes a key no request has used before
 * (`<payment id>:<uuid>`) and decides "same attempt" itself, from the row's stored session
 * (`retrieveCheckoutSession`, lib/portal/quotes.ts `createQuoteCheckout`).
 *
 * Throws StripeError on any non-2xx, carrying Stripe's own `error.message` (which describes
 * the request, never the credential) so the route can log something actionable without
 * putting a key anywhere.
 */
export async function createCheckoutSession(
  secretKey: string,
  input: CheckoutSessionParamsInput,
  idempotencyKey: string,
): Promise<CreateCheckoutSessionResult> {
  if (!secretKey) throw new StripeError(500, "not_configured", "Stripe secret key is not set");

  const body = encodeForm(checkoutSessionParams(input));

  let res: Response;
  try {
    res = await fetch(CHECKOUT_SESSIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
        "Stripe-Version": apiVersion(),
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    // A transport failure is NOT a payment failure — the customer simply never left our
    // page. Surface it as its own code so the route can say "try again" honestly.
    throw new StripeError(502, "network_error", e instanceof Error ? e.message : String(e));
  }

  const json = (await res.json().catch(() => null)) as
    | { id?: unknown; url?: unknown; error?: { message?: unknown; code?: unknown; type?: unknown } }
    | null;

  if (!res.ok) {
    const err = json?.error;
    const code = typeof err?.code === "string" ? err.code : typeof err?.type === "string" ? err.type : `http_${res.status}`;
    const message = typeof err?.message === "string" ? err.message : `Stripe returned ${res.status}`;
    throw new StripeError(res.status, code, message);
  }

  const id = typeof json?.id === "string" ? json.id : null;
  const url = typeof json?.url === "string" ? json.url : null;
  // A 2xx with no `url` means Stripe accepted the session but there is nowhere to send the
  // customer (a non-hosted UI mode). Refuse rather than redirect to `undefined`.
  if (!id || !url) throw new StripeError(502, "bad_payload", "Stripe returned no session url");
  return { id, url };
}

// ── Retiring and reading a Checkout Session (audit W02/B035) ────────────────────────

/** A session nobody can pay any more, or one whose payment is already under way. */
export type RetiredCheckoutSession = "expired" | "complete";

/** `cs_test_…` / `cs_live_…`. The id is interpolated into a URL path, so its shape is
 *  checked first — it is our own stored value, and it is still not trusted with a path. */
const CHECKOUT_SESSION_ID_RE = /^cs_[A-Za-z0-9_]+$/;

async function stripeSessionCall(
  secretKey: string,
  method: "GET" | "POST",
  url: string,
): Promise<{ status: number; ok: boolean; json: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Stripe-Version": apiVersion(),
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new StripeError(502, "network_error", e instanceof Error ? e.message : String(e));
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, ok: res.ok, json };
}

function stripeErrorFrom(status: number, json: Record<string, unknown> | null): StripeError {
  const err = (json?.error ?? null) as { message?: unknown; code?: unknown; type?: unknown } | null;
  const code = typeof err?.code === "string" ? err.code : typeof err?.type === "string" ? err.type : `http_${status}`;
  const message = typeof err?.message === "string" ? err.message : `Stripe returned ${status}`;
  return new StripeError(status, code, message);
}

/**
 * Make a Checkout Session UNPAYABLE, or learn that it is too late.
 *
 * WHY THIS EXISTS. A quote can offer two ways to pay (a deposit, or the full amount) and
 * each `catering_payments` row gets its own hosted session. Nothing closed the first
 * session when the customer opened the second, so both stayed payable for 24 hours and
 * both charges were accepted — a deposit AND the full total for one order. The same hole
 * opens when an intent is re-priced: the session at the old amount is still out there.
 * The portal therefore retires every other open session of a quote before it hands the
 * customer a new one (lib/portal/quotes.ts `createQuoteCheckout`).
 *
 * THE ANSWER IS ONE OF TWO FACTS, AND ANYTHING ELSE THROWS:
 *   "expired"  — nobody can pay it: we expired it just now, or it had already lapsed. THE
 *                ACCOUNT THAT OWNS THE SESSION SAID SO.
 *   "complete" — the customer already finished it; the money is landing or has landed.
 *                The caller must NOT offer another checkout.
 *
 * A 404 IS NEITHER (review r4). The first cut read "this account has never heard of it" as
 * `expired`, on the reasoning that it cannot be paid through credentials that do not own
 * it. True — and beside the point: it can still be paid through the account that DOES own
 * it. A secret key sees only its own account's objects ("Stripe uses API keys to
 * authenticate requests from your integration and determine which Stripe resources it can
 * access" — docs.stripe.com/keys), and a shop's key can change (the per-shop override
 * above). So a 404 ("The requested resource doesn't exist" — docs.stripe.com/api/errors)
 * means "THIS KEY cannot see that session" and nothing about the session: it THROWS
 * `session_not_found`, which every caller treats like any other failure to confirm — the
 * session id stays on its row and no replacement checkout is offered. Finding the account
 * that does know it is lib/stripe/session-owner.ts's job (`retireSessionInOwningAccount`).
 *
 * Stripe's contract (docs.stripe.com/api/checkout/sessions/expire): "A Checkout Session
 * can be expired when it is in one of these statuses: open", and it "returns an error if
 * the Checkout Session has already expired or isn't in an expireable state". The error does
 * not say which, so a 4xx refusal is followed by a read of the session's own `status`
 * (`open` | `complete` | `expired`). A 5xx, a transport failure, or a session that still
 * reads `open` after a refused expire THROWS: this function fails closed, because the
 * caller's next step is to mint a second way to pay.
 */
export async function retireCheckoutSession(secretKey: string, sessionId: string): Promise<RetiredCheckoutSession> {
  if (!secretKey) throw new StripeError(500, "not_configured", "Stripe secret key is not set");
  if (!CHECKOUT_SESSION_ID_RE.test(sessionId)) {
    throw new StripeError(400, "bad_session_id", "Not a Checkout Session id");
  }
  const sessionUrl = `${CHECKOUT_SESSIONS_URL}/${sessionId}`;

  const expire = await stripeSessionCall(secretKey, "POST", `${sessionUrl}/expire`);
  if (expire.ok) return "expired";
  if (expire.status === 404) throw sessionNotFound();
  // Only a request-level 4xx can mean "not in an expirable state" (Stripe documents the
  // refusal, not its status code). A 5xx, an auth failure or a rate limit is OUR problem
  // and says nothing about the session.
  const refusal = expire.status >= 400 && expire.status < 500 && ![401, 403, 429].includes(expire.status);
  if (!refusal) throw stripeErrorFrom(expire.status, expire.json);

  const read = await stripeSessionCall(secretKey, "GET", sessionUrl);
  if (read.status === 404) throw sessionNotFound();
  if (!read.ok) throw stripeErrorFrom(read.status, read.json);
  const status = typeof read.json?.status === "string" ? read.json.status : null;
  if (status === "expired") return "expired";
  if (status === "complete") return "complete";
  throw new StripeError(409, "session_still_open", "The Checkout Session could not be expired and is not complete");
}

/** The 404 of a session call: this account's key cannot see that session (see `retireCheckoutSession`). */
function sessionNotFound(): StripeError {
  return new StripeError(404, SESSION_NOT_FOUND, "This Stripe account has no such Checkout Session");
}

/** What a Checkout Session is right now, as far as a payment decision needs to know. */
export interface CheckoutSessionState {
  /**
   * `open` / `complete` / `expired` are Stripe's own statuses, from the account that owns it.
   * `not_found` = the account asked does not know the id (404). That is NOT "nobody can pay
   *   it": the session may be open in another account (review r4 — see
   *   `retireCheckoutSession`). The caller must have its owner retire it, or refuse.
   * `gone` = the stored value is not shaped like a Checkout Session id at all, so no account
   *   could have minted it. Decided from the value itself; Stripe is not asked.
   */
  status: "open" | "complete" | "expired" | "not_found" | "gone";
  /** The hosted Checkout URL. Stripe only returns one while the session is `open`. */
  url: string | null;
  /** `amount_total`, integer cents. */
  amountTotal: number | null;
  /** `metadata.quote_id` / `metadata.payment_id` exactly as we wrote them at creation. */
  quoteId: string | null;
  paymentId: string | null;
  /** The session's own `expires_at`, epoch seconds — when it stops being payable. */
  expiresAt?: number | null;
}

/**
 * Read a Checkout Session we created (review r1 of audit W02/B035).
 *
 * WHY THIS EXISTS. "Is this tap the same checkout attempt?" used to be answered by an
 * idempotency key, which cannot answer it (see `createCheckoutSession`). The row's stored
 * session id can: the caller reads the session and hands the SAME checkout back only while
 * it is still open for this quote, this intent and this amount. The metadata compared is
 * our own, written by `checkoutSessionParams`; a session whose metadata does not match is
 * simply not reused.
 *
 * THROWS StripeError on a transport failure, any non-404 refusal, or a status this code
 * does not know. The caller fails closed: its next step is to mint a way to pay. A 404 is
 * returned as `not_found` rather than thrown because the caller has a next step for it —
 * ask the session's owning account — but it is never a reason to forget the session.
 */
export async function retrieveCheckoutSession(secretKey: string, sessionId: string): Promise<CheckoutSessionState> {
  if (!secretKey) throw new StripeError(500, "not_configured", "Stripe secret key is not set");
  // A stored id that is not a session id names nothing Stripe could let anyone pay.
  if (!CHECKOUT_SESSION_ID_RE.test(sessionId)) {
    return { status: "gone", url: null, amountTotal: null, quoteId: null, paymentId: null };
  }
  const read = await stripeSessionCall(secretKey, "GET", `${CHECKOUT_SESSIONS_URL}/${sessionId}`);
  if (read.status === 404) return { status: "not_found", url: null, amountTotal: null, quoteId: null, paymentId: null };
  if (!read.ok) throw stripeErrorFrom(read.status, read.json);

  const status = read.json?.status;
  if (status !== "open" && status !== "complete" && status !== "expired") {
    throw new StripeError(502, "bad_payload", "Stripe returned a Checkout Session with no usable status");
  }
  const metadata = (read.json?.metadata ?? null) as Record<string, unknown> | null;
  const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const amount = read.json?.amount_total;
  const expiresAt = read.json?.expires_at;
  return {
    status,
    url: status === "open" ? text(read.json?.url) : null,
    amountTotal: typeof amount === "number" && Number.isInteger(amount) ? amount : null,
    quoteId: text(metadata?.quote_id),
    paymentId: text(metadata?.payment_id),
    expiresAt: typeof expiresAt === "number" && Number.isInteger(expiresAt) ? expiresAt : null,
  };
}

// ── Refunds (catering refund step, migration 0357) ──────────────────────────────────────────────────
//
// Four calls, and only these: locate the PaymentIntent's charge (GET), create a refund (POST, idempotent), list the
// refunds of a PaymentIntent (GET, to find one carrying our request id after an unknown outcome), read one refund
// (GET). Every rule cited is from Stripe's own reference:
//   · POST /v1/refunds takes `payment_intent`, `amount` ("Can refund only up to the remaining, unrefunded amount of the
//     charge"), `reason` (`duplicate` | `fraudulent` | `requested_by_customer`) and `metadata`; it "will raise an error
//     when called on an already-refunded charge, or when trying to refund more money than is left on a charge"
//     (docs.stripe.com/api/refunds/create).
//   · GET /v1/refunds?payment_intent=… lists "refunds for the PaymentIntent specified by this ID", newest first,
//     `limit` 1–100, paged by `starting_after` (docs.stripe.com/api/refunds/list).
//   · A PaymentIntent's `latest_charge` is expandable; the Charge carries `amount_captured` and `amount_refunded`
//     (docs.stripe.com/api/payment_intents/object, docs.stripe.com/api/charges/object).
// A secret key sees only its own account (see `retireCheckoutSession`), so a 404 on the PaymentIntent means "not in
// THIS account" and the caller asks the shop's other configured account (lib/stripe/session-owner.ts
// `stripeAccountsForShop`).

const STRIPE_API = "https://api.stripe.com/v1";
const PAYMENT_INTENT_ID_RE = /^pi_[A-Za-z0-9_]+$/;
const REFUND_ID_RE = /^(re|pyr)_[A-Za-z0-9_]+$/;

export interface StripeRefund {
  id: string;
  /** Stripe's own status: pending | requires_action | succeeded | failed | canceled (or null). */
  status: string | null;
  amountCents: number | null;
  /** `metadata.refund_request_id` exactly as we wrote it. */
  requestId: string | null;
}

function parseRefund(json: Record<string, unknown> | null): StripeRefund | null {
  const id = typeof json?.id === "string" && REFUND_ID_RE.test(json.id) ? json.id : null;
  if (!id) return null;
  const metadata = (json?.metadata ?? null) as Record<string, unknown> | null;
  return {
    id,
    status: typeof json?.status === "string" ? json.status : null,
    amountCents: typeof json?.amount === "number" && Number.isInteger(json.amount) ? json.amount : null,
    requestId: typeof metadata?.refund_request_id === "string" ? metadata.refund_request_id : null,
  };
}

export interface PaymentIntentCharge {
  /** `found` = this account owns the PaymentIntent. `not_found` = it does not (a 404): ask the next account. */
  status: "found" | "not_found";
  amountCapturedCents: number | null;
  amountRefundedCents: number | null;
}

/** Read a PaymentIntent with its latest charge expanded. THROWS StripeError on anything but 2xx / 404. */
export async function retrievePaymentIntentCharge(secretKey: string, paymentIntentId: string): Promise<PaymentIntentCharge> {
  if (!secretKey) throw new StripeError(500, "not_configured", "Stripe secret key is not set");
  if (!PAYMENT_INTENT_ID_RE.test(paymentIntentId)) throw new StripeError(400, "bad_payment_intent_id", "Not a PaymentIntent id");
  const read = await stripeSessionCall(secretKey, "GET", `${STRIPE_API}/payment_intents/${paymentIntentId}?expand%5B%5D=latest_charge`);
  if (read.status === 404) return { status: "not_found", amountCapturedCents: null, amountRefundedCents: null };
  if (!read.ok) throw stripeErrorFrom(read.status, read.json);
  const charge = read.json?.latest_charge;
  const c = charge && typeof charge === "object" ? (charge as Record<string, unknown>) : null;
  const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);
  return { status: "found", amountCapturedCents: int(c?.amount_captured), amountRefundedCents: int(c?.amount_refunded) };
}

export interface CreateRefundInput {
  paymentIntentId: string;
  amountCents: number;
  reason: "duplicate" | "requested_by_customer" | null;
  /** Written to the refund's metadata; `refund_request_id` is how a later list finds it. Deterministic per row. */
  metadata: { refund_request_id: string; quote_id: string; payment_id: string };
}

/**
 * Create a refund. The SAME `idempotencyKey` and the SAME parameters on every attempt of one request row: Stripe
 * "saves the status code and body of the first request made with a given idempotency key after endpoint execution
 * begins. Retries with the same key return the saved response, including `500` errors", and "compares incoming
 * parameters to those of the original request and errors if they're not the same" (docs.stripe.com/api/idempotent_requests).
 * No response throws StripeError(0, "network_error"); every non-2xx throws with its HTTP status.
 */
export async function createRefund(secretKey: string, input: CreateRefundInput, idempotencyKey: string): Promise<StripeRefund> {
  if (!secretKey) throw new StripeError(500, "not_configured", "Stripe secret key is not set");
  if (!PAYMENT_INTENT_ID_RE.test(input.paymentIntentId)) throw new StripeError(400, "bad_payment_intent_id", "Not a PaymentIntent id");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new StripeError(400, "bad_amount", "A refund amount is a positive integer");
  const params: Record<string, string | number | undefined> = {
    payment_intent: input.paymentIntentId,
    amount: input.amountCents,
    reason: input.reason ?? undefined,
    "metadata[refund_request_id]": input.metadata.refund_request_id,
    "metadata[quote_id]": input.metadata.quote_id,
    "metadata[payment_id]": input.metadata.payment_id,
  };
  let res: Response;
  try {
    res = await fetch(`${STRIPE_API}/refunds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
        "Stripe-Version": apiVersion(),
      },
      body: encodeForm(params),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    // No response: Stripe may or may not have executed it. The caller keeps the row pending.
    throw new StripeError(0, "network_error", e instanceof Error ? e.message : String(e));
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw stripeErrorFrom(res.status, json);
  const refund = parseRefund(json);
  if (!refund) throw new StripeError(502, "bad_payload", "Stripe returned no refund id");
  return refund;
}

/** Every refund of a PaymentIntent (newest first), up to `maxPages` pages of 100. THROWS on anything but 2xx. */
export async function listRefundsForPaymentIntent(secretKey: string, paymentIntentId: string, maxPages = 5): Promise<StripeRefund[]> {
  if (!secretKey) throw new StripeError(500, "not_configured", "Stripe secret key is not set");
  if (!PAYMENT_INTENT_ID_RE.test(paymentIntentId)) throw new StripeError(400, "bad_payment_intent_id", "Not a PaymentIntent id");
  const out: StripeRefund[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const cursor = after ? `&starting_after=${encodeURIComponent(after)}` : "";
    const read = await stripeSessionCall(secretKey, "GET", `${STRIPE_API}/refunds?payment_intent=${encodeURIComponent(paymentIntentId)}&limit=100${cursor}`);
    if (!read.ok) throw stripeErrorFrom(read.status, read.json);
    const data = Array.isArray(read.json?.data) ? (read.json.data as Array<Record<string, unknown>>) : [];
    for (const d of data) {
      const r = parseRefund(d);
      if (r) out.push(r);
    }
    const last = data[data.length - 1];
    if (read.json?.has_more !== true || !last || typeof last.id !== "string") return out;
    after = last.id;
  }
  // More refunds than we look through: refuse rather than answer "none of them is ours" from a partial list.
  throw new StripeError(502, "refund_list_incomplete", "Too many refunds on this payment to check");
}

/** Read one refund. THROWS on anything but 2xx. */
export async function retrieveRefund(secretKey: string, refundId: string): Promise<StripeRefund> {
  if (!secretKey) throw new StripeError(500, "not_configured", "Stripe secret key is not set");
  if (!REFUND_ID_RE.test(refundId)) throw new StripeError(400, "bad_refund_id", "Not a refund id");
  const read = await stripeSessionCall(secretKey, "GET", `${STRIPE_API}/refunds/${refundId}`);
  if (!read.ok) throw stripeErrorFrom(read.status, read.json);
  const refund = parseRefund(read.json);
  if (!refund) throw new StripeError(502, "bad_payload", "Stripe returned no refund id");
  return refund;
}
