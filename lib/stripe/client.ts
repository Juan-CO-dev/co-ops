/**
 * Stripe REST client — SERVER-ONLY, no SDK. Checkout Sessions: create one, retire one
 * (`retireCheckoutSession`, audit W02/B035) and read one (`retrieveCheckoutSession`). Refunds (catering refunds
 * Part B1 v2): the strict evidence reads and the ONE create POST, in the section at the end.
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

// ── Refunds (catering refunds Part B1 v2, migration 0359; lib/catering/refund-observe.ts, lib/catering/refunds.ts) ─
//
// Five calls, and only these. Four GETs that hand over EVIDENCE (strictly parsed: a malformed answer is refused by
// name, `refund_evidence_malformed`, never read around) and ONE POST:
//   · GET /v1/payment_intents/:id?expand[]=latest_charge — the owner facts: "ID of the latest Charge object created by
//     this PaymentIntent"; the Charge's `amount_captured` is "Amount in the smallest currency unit captured"
//     (docs.stripe.com/api/payment_intents/object, docs.stripe.com/api/charges/object). The charge's own refunded
//     total is NOT parsed, carried or compared anywhere [Q3]: whether it counts a pending refund, or drops one that
//     later failed, is not documented.
//   · GET /v1/refunds?payment_intent=… and GET /v1/refunds?charge=… — ONE page each: "Only return refunds for the
//     PaymentIntent specified by this ID." · "Only return refunds for the charge specified by this charge ID." ·
//     `has_more`: "If `false`, this set comprises the end of the list" (docs.stripe.com/api/refunds/list,
//     docs.stripe.com/api/pagination). Cross-page rules (a repeated id or cursor, a page limit) are the caller's.
//   · GET /v1/refunds/:id — "Retrieves the details of an existing refund" (docs.stripe.com/api/refunds/retrieve).
//   · POST /v1/refunds — exactly ONE request per call, no retry, redirects never followed (below).
// A 404 means "THIS key cannot see it" and nothing more (see `retireCheckoutSession`).
//
// REDIRECTS ARE NEVER FOLLOWED. A default `fetch` follows a 307 / 308 by RE-SENDING the request, body included, so a
// POST could be made twice by the transport. The create therefore uses `redirect: "manual"` (a 3xx is a non-2xx
// answer = unconfirmed) and every GET uses `redirect: "error"` (a 3xx is a failure to ask).

const STRIPE_API = "https://api.stripe.com/v1";
const PAYMENT_INTENT_ID_RE = /^pi_[A-Za-z0-9_]+$/;
/** A provider id this build does not have to recognise: bounded, URL-safe, never interpolated unencoded. */
const OPAQUE_STRIPE_ID_RE = /^[A-Za-z0-9_]{1,255}$/;
const UUID_META_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The `StripeError.code` of an answer that is not well-formed evidence. */
export const REFUND_EVIDENCE_MALFORMED = "refund_evidence_malformed";
/** The longest a single Stripe refund call may take (main's 20 s). */
export const STRIPE_REFUND_CALL_MAX_MS = 20_000;

export interface StrictRefund {
  id: string;
  paymentIntentId: string | null;
  chargeId: string | null;
  /** A safe positive integer of cents. */
  amountCents: number;
  currency: string;
  /** Stripe's own status, verbatim (an unfamiliar value is kept, bounded). */
  status: string | null;
  /** The refund's own `created`, epoch seconds ("Measured in seconds since the Unix epoch"). */
  createdSec: number;
  /** `metadata.refund_request_id` / `payment_id` / `quote_id` exactly as written, when each is a UUID. A CLAIM, never proof. */
  requestId: string | null;
  metaPaymentId: string | null;
  metaQuoteId: string | null;
}

function strictId(v: unknown): string | null {
  const id = typeof v === "string" ? v : v && typeof v === "object" && !Array.isArray(v) ? (v as { id?: unknown }).id : null;
  return typeof id === "string" && OPAQUE_STRIPE_ID_RE.test(id) ? id : null;
}

/** One Refund object, or null when ANY required fact is missing or ill-formed. Bare or expanded ids both read. */
export function parseStrictRefund(json: unknown): StrictRefund | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (o.object !== undefined && o.object !== "refund") return null;
  const id = strictId(o.id);
  if (!id) return null;
  if (typeof o.amount !== "number" || !Number.isSafeInteger(o.amount) || o.amount <= 0) return null;
  if (typeof o.currency !== "string" || !/^[a-z]{3}$/.test(o.currency)) return null;
  if (typeof o.created !== "number" || !Number.isSafeInteger(o.created) || o.created <= 0) return null;
  if (o.status !== null && o.status !== undefined && (typeof o.status !== "string" || o.status.length === 0 || o.status.length > 40)) return null;
  // Present-but-unreadable ids are malformed; absent ones are simply absent.
  const pi = o.payment_intent === null || o.payment_intent === undefined ? null : strictId(o.payment_intent);
  if (o.payment_intent !== null && o.payment_intent !== undefined && !pi) return null;
  const charge = o.charge === null || o.charge === undefined ? null : strictId(o.charge);
  if (o.charge !== null && o.charge !== undefined && !charge) return null;
  if (o.metadata !== null && o.metadata !== undefined && (typeof o.metadata !== "object" || Array.isArray(o.metadata))) return null;
  const meta = (o.metadata ?? {}) as Record<string, unknown>;
  const uuid = (v: unknown) => (typeof v === "string" && UUID_META_RE.test(v) ? v.toLowerCase() : null);
  return {
    id, paymentIntentId: pi, chargeId: charge, amountCents: o.amount, currency: o.currency,
    status: typeof o.status === "string" ? o.status : null, createdSec: o.created,
    requestId: uuid(meta.refund_request_id), metaPaymentId: uuid(meta.payment_id), metaQuoteId: uuid(meta.quote_id),
  };
}

function errorFrom(status: number, json: Record<string, unknown> | null): StripeError {
  const err = (json?.error ?? null) as { message?: unknown; code?: unknown; type?: unknown } | null;
  const code = typeof err?.code === "string" ? err.code : typeof err?.type === "string" ? err.type : `http_${status}`;
  const message = typeof err?.message === "string" ? err.message : `Stripe returned ${status}`;
  return new StripeError(status, code, message);
}

/** A GET with a per-call deadline. Redirects are an error (see the section header). */
async function stripeGet(secretKey: string, url: string, timeoutMs: number): Promise<{ status: number; ok: boolean; json: Record<string, unknown> | null }> {
  if (!secretKey) throw new StripeError(500, "not_configured", "Stripe secret key is not set");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 250) throw new StripeError(0, "deadline_exhausted", "No time left for this Stripe read");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}`, "Stripe-Version": apiVersion() },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(timeoutMs, STRIPE_REFUND_CALL_MAX_MS)),
    });
  } catch (e) {
    throw new StripeError(0, "network_error", e instanceof Error ? e.message : String(e));
  }
  if (res.status >= 300 && res.status < 400) throw new StripeError(res.status, "redirect_refused", "Stripe answered with a redirect");
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, ok: res.ok, json };
}

export interface PaymentIntentOwner {
  status: "found" | "not_found";
  chargeId: string | null;
  currency: string | null;
  livemode: boolean | null;
  /** The latest charge's `amount_captured`; null when the answer does not carry a usable one. */
  amountCapturedCents: number | null;
}

/** Does THIS account own the PaymentIntent, and what are its immutable facts? THROWS StripeError on anything but 2xx / 404. */
export async function retrievePaymentIntentOwner(secretKey: string, paymentIntentId: string, timeoutMs = STRIPE_REFUND_CALL_MAX_MS): Promise<PaymentIntentOwner> {
  if (!PAYMENT_INTENT_ID_RE.test(paymentIntentId)) throw new StripeError(400, "bad_payment_intent_id", "Not a PaymentIntent id");
  const read = await stripeGet(secretKey, `${STRIPE_API}/payment_intents/${paymentIntentId}?expand%5B%5D=latest_charge`, timeoutMs);
  if (read.status === 404) return { status: "not_found", chargeId: null, currency: null, livemode: null, amountCapturedCents: null };
  if (!read.ok) throw errorFrom(read.status, read.json);
  if (!read.json || read.json.id !== paymentIntentId) throw new StripeError(502, REFUND_EVIDENCE_MALFORMED, "Stripe answered with another PaymentIntent");
  const charge = read.json.latest_charge;
  const c = charge && typeof charge === "object" && !Array.isArray(charge) ? (charge as Record<string, unknown>) : null;
  const currency = typeof read.json.currency === "string" && /^[a-z]{3}$/.test(read.json.currency) ? read.json.currency : null;
  const captured = c && typeof c.amount_captured === "number" && Number.isSafeInteger(c.amount_captured) && c.amount_captured >= 0 ? c.amount_captured : null;
  return {
    status: "found", chargeId: strictId(charge), currency,
    livemode: typeof read.json.livemode === "boolean" ? read.json.livemode : null, amountCapturedCents: captured,
  };
}

/**
 * Which list, and the membership rule its items must obey:
 *   by PaymentIntent  an item's PaymentIntent is the filter's, or it has none and its charge is the owner's;
 *   by charge         an item's charge is the filter's, or it has none and its PaymentIntent is the owner's.
 * An item that does not belong makes the page `refund_evidence_malformed`.
 */
export type RefundListFilter =
  | { paymentIntentId: string; ownerChargeId: string | null }
  | { chargeId: string; ownerPaymentIntentId: string | null };

export interface RefundListPage {
  refunds: StrictRefund[];
  /** Stripe's own `has_more`: false = an EXPLICIT terminal page. */
  hasMore: boolean;
  /** The cursor for the next page (the last object's id). Null on an empty page. */
  lastId: string | null;
}

/**
 * ONE page of a PaymentIntent's or a charge's refunds. THROWS `refund_evidence_malformed` unless the answer has a real
 * `data` array, a boolean `has_more`, and every object is a well-formed refund that belongs to the filter (above),
 * with no id repeated in the page; a non-terminal page must carry an advancing cursor.
 */
export async function listRefundsPageStrict(secretKey: string, filter: RefundListFilter, startingAfter: string | null, timeoutMs = STRIPE_REFUND_CALL_MAX_MS): Promise<RefundListPage> {
  let query: string;
  let belongs: (r: StrictRefund) => boolean;
  if ("paymentIntentId" in filter) {
    if (!PAYMENT_INTENT_ID_RE.test(filter.paymentIntentId)) throw new StripeError(400, "bad_payment_intent_id", "Not a PaymentIntent id");
    query = `payment_intent=${encodeURIComponent(filter.paymentIntentId)}`;
    belongs = (r) => r.paymentIntentId === filter.paymentIntentId || (r.paymentIntentId === null && filter.ownerChargeId !== null && r.chargeId === filter.ownerChargeId);
  } else {
    if (!OPAQUE_STRIPE_ID_RE.test(filter.chargeId)) throw new StripeError(400, "bad_charge_id", "Not a charge id");
    query = `charge=${encodeURIComponent(filter.chargeId)}`;
    belongs = (r) => r.chargeId === filter.chargeId || (r.chargeId === null && filter.ownerPaymentIntentId !== null && r.paymentIntentId === filter.ownerPaymentIntentId);
  }
  if (startingAfter !== null && !OPAQUE_STRIPE_ID_RE.test(startingAfter)) throw new StripeError(400, "bad_cursor", "Not a list cursor");
  const cursor = startingAfter ? `&starting_after=${encodeURIComponent(startingAfter)}` : "";
  const read = await stripeGet(secretKey, `${STRIPE_API}/refunds?${query}&limit=100${cursor}`, timeoutMs);
  if (!read.ok) throw errorFrom(read.status, read.json);
  const malformed = (why: string) => new StripeError(502, REFUND_EVIDENCE_MALFORMED, why);
  if (!read.json || !Array.isArray(read.json.data) || typeof read.json.has_more !== "boolean") throw malformed("The refund list has no data array or no has_more");
  const refunds: StrictRefund[] = [];
  const seen = new Set<string>();
  for (const d of read.json.data as unknown[]) {
    const r = parseStrictRefund(d);
    if (!r) throw malformed("The refund list carries a malformed refund");
    if (!belongs(r)) throw malformed("The refund list carries a refund that does not belong to its filter");
    if (seen.has(r.id)) throw malformed("The refund list repeats an id");
    seen.add(r.id);
    refunds.push(r);
  }
  const lastId = refunds.length > 0 ? refunds[refunds.length - 1]!.id : null;
  if (read.json.has_more && (!lastId || lastId === startingAfter)) throw malformed("A non-terminal page has no advancing cursor");
  return { refunds, hasMore: read.json.has_more, lastId };
}

/** An EXACT read of one refund by a bounded, safely encoded opaque id. `not_found` = this key cannot see it. */
export async function retrieveRefundStrict(secretKey: string, refundId: string, timeoutMs = STRIPE_REFUND_CALL_MAX_MS): Promise<{ status: "found"; refund: StrictRefund } | { status: "not_found" }> {
  if (!OPAQUE_STRIPE_ID_RE.test(refundId)) throw new StripeError(400, "bad_refund_id", "Not a refund id");
  const read = await stripeGet(secretKey, `${STRIPE_API}/refunds/${encodeURIComponent(refundId)}`, timeoutMs);
  if (read.status === 404) return { status: "not_found" };
  if (!read.ok) throw errorFrom(read.status, read.json);
  const refund = parseStrictRefund(read.json);
  if (!refund || refund.id !== refundId) throw new StripeError(502, REFUND_EVIDENCE_MALFORMED, "Stripe answered with a malformed or different refund");
  return { status: "found", refund };
}

export interface CreateRefundInput {
  paymentIntentId: string;
  amountCents: number;
  reason: "duplicate" | "requested_by_customer" | null;
  /**
   * Written to the refund's metadata. `refund_request_id` is also the ONE Idempotency-Key spelling
   * (`catering-refund:<request id>`), so the key and the metadata can never name different requests.
   */
  metadata: { refund_request_id: string; quote_id: string; payment_id: string };
}

/**
 * What ONE POST /v1/refunds came to. Only `created` carries a refund; every other kind is UNCONFIRMED (the caller
 * records it as such and never sends again), except `not_sent`, which made no request at all.
 *   created      a 2xx whose body is a well-formed refund (the caller still verifies it is THIS request's: F10)
 *   unparseable  a 2xx whose body is not a well-formed refund
 *   refused      any non-2xx answer, a 3xx included (redirects are not followed)
 *   no_response  the request may have left; no answer came back (`timeout`: the deadline; `network_error`: anything else)
 *   not_sent     refused BEFORE any request (no key, a bad id or amount)
 */
export type CreateRefundOutcome =
  | { kind: "created"; httpStatus: number; refund: StrictRefund }
  | { kind: "unparseable"; httpStatus: number }
  | { kind: "refused"; httpStatus: number; code: string; message: string }
  | { kind: "no_response"; code: "timeout" | "network_error" }
  | { kind: "not_sent"; code: "not_configured" | "bad_payment_intent_id" | "bad_amount" | "bad_request_id" };

/** The one Stripe Idempotency-Key spelling for a request row (held equal to refunds-shared `refundIdempotencyKey`). */
const idempotencyKeyFor = (requestId: string) => `catering-refund:${requestId}`;

/**
 * Create a refund: EXACTLY ONE `fetch`, no retry loop, `redirect: "manual"`, the request's own Idempotency-Key and
 * `metadata[refund_request_id]`. It never throws for a Stripe or transport problem: the outcome says what happened
 * (above). Stripe: "Treat the outcome of a request that returns `500` as indeterminate" and "If the outcome is still
 * unknown after that window, don't retry with either the old key or a new one" (docs.stripe.com/error-low-level), so
 * the caller never asks again, by any path.
 */
export async function createRefund(secretKey: string, input: CreateRefundInput, timeoutMs: number = STRIPE_REFUND_CALL_MAX_MS): Promise<CreateRefundOutcome> {
  if (!secretKey) return { kind: "not_sent", code: "not_configured" };
  if (!PAYMENT_INTENT_ID_RE.test(input.paymentIntentId)) return { kind: "not_sent", code: "bad_payment_intent_id" };
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) return { kind: "not_sent", code: "bad_amount" };
  if (!UUID_META_RE.test(input.metadata.refund_request_id)) return { kind: "not_sent", code: "bad_request_id" };
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
        "Idempotency-Key": idempotencyKeyFor(input.metadata.refund_request_id),
        "Stripe-Version": apiVersion(),
      },
      body: encodeForm(params),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(Math.min(Math.max(Number.isFinite(timeoutMs) ? timeoutMs : 1, 1), STRIPE_REFUND_CALL_MAX_MS)),
    });
  } catch (e) {
    // The request may have reached Stripe: unconfirmed, never "not sent".
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { kind: "no_response", code: timedOut ? "timeout" : "network_error" };
  }
  // A browser-style manual redirect is an opaque response with status 0; Node answers the 3xx itself. Both are
  // non-2xx answers.
  if (res.type === "opaqueredirect" || res.status < 200 || res.status >= 300) {
    const json = res.status >= 400 ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : null;
    const err = (res.status >= 300 && res.status < 400) || res.type === "opaqueredirect"
      ? new StripeError(res.status, "redirect_not_followed", "Stripe answered with a redirect")
      : errorFrom(res.status, json);
    return { kind: "refused", httpStatus: res.status, code: err.code, message: err.message };
  }
  const json = (await res.json().catch(() => null)) as unknown;
  const refund = parseStrictRefund(json);
  if (!refund) return { kind: "unparseable", httpStatus: res.status };
  return { kind: "created", httpStatus: res.status, refund };
}
