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
 *   "expired"  — nobody can pay it: we expired it just now, or it had already lapsed, or
 *                this account has never heard of it (404 — it cannot be paid through
 *                credentials that do not own it).
 *   "complete" — the customer already finished it; the money is landing or has landed.
 *                The caller must NOT offer another checkout.
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
  if (expire.status === 404) return "expired";
  // Only a request-level 4xx can mean "not in an expirable state" (Stripe documents the
  // refusal, not its status code). A 5xx, an auth failure or a rate limit is OUR problem
  // and says nothing about the session.
  const refusal = expire.status >= 400 && expire.status < 500 && ![401, 403, 429].includes(expire.status);
  if (!refusal) throw stripeErrorFrom(expire.status, expire.json);

  const read = await stripeSessionCall(secretKey, "GET", sessionUrl);
  if (read.status === 404) return "expired";
  if (!read.ok) throw stripeErrorFrom(read.status, read.json);
  const status = typeof read.json?.status === "string" ? read.json.status : null;
  if (status === "expired") return "expired";
  if (status === "complete") return "complete";
  throw new StripeError(409, "session_still_open", "The Checkout Session could not be expired and is not complete");
}

/** What a Checkout Session is right now, as far as a payment decision needs to know. */
export interface CheckoutSessionState {
  /** `gone` = this account has never heard of the id (404): nobody can pay it here. */
  status: "open" | "complete" | "expired" | "gone";
  /** The hosted Checkout URL. Stripe only returns one while the session is `open`. */
  url: string | null;
  /** `amount_total`, integer cents. */
  amountTotal: number | null;
  /** `metadata.quote_id` / `metadata.payment_id` exactly as we wrote them at creation. */
  quoteId: string | null;
  paymentId: string | null;
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
 * does not know. The caller fails closed: its next step is to mint a way to pay.
 */
export async function retrieveCheckoutSession(secretKey: string, sessionId: string): Promise<CheckoutSessionState> {
  if (!secretKey) throw new StripeError(500, "not_configured", "Stripe secret key is not set");
  // A stored id that is not a session id names nothing Stripe could let anyone pay.
  if (!CHECKOUT_SESSION_ID_RE.test(sessionId)) {
    return { status: "gone", url: null, amountTotal: null, quoteId: null, paymentId: null };
  }
  const read = await stripeSessionCall(secretKey, "GET", `${CHECKOUT_SESSIONS_URL}/${sessionId}`);
  if (read.status === 404) return { status: "gone", url: null, amountTotal: null, quoteId: null, paymentId: null };
  if (!read.ok) throw stripeErrorFrom(read.status, read.json);

  const status = read.json?.status;
  if (status !== "open" && status !== "complete" && status !== "expired") {
    throw new StripeError(502, "bad_payload", "Stripe returned a Checkout Session with no usable status");
  }
  const metadata = (read.json?.metadata ?? null) as Record<string, unknown> | null;
  const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const amount = read.json?.amount_total;
  return {
    status,
    url: status === "open" ? text(read.json?.url) : null,
    amountTotal: typeof amount === "number" && Number.isInteger(amount) ? amount : null,
    quoteId: text(metadata?.quote_id),
    paymentId: text(metadata?.payment_id),
  };
}
