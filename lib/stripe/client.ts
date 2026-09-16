/**
 * Stripe REST client — SERVER-ONLY, no SDK. One call: create a Checkout Session.
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
 * `idempotencyKey` makes a double-tap (or a Vercel retry) return the SAME session instead
 * of a second one: Stripe replays the original response for 24 hours. The caller keys it
 * on the `catering_payments` row id PLUS the amount — the id alone would make a legitimately
 * re-priced intent collide with its own earlier session and 400, and the amount is the one
 * field of the request that can honestly change for a given payment row.
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
