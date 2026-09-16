/**
 * Stripe PURE surface — zero I/O, no server imports, no SDK. Unit-tested in the vitest
 * spine (tests/stripe-shared.test.ts) and imported by the server client
 * (lib/stripe/client.ts) and the webhook processor (lib/stripe/webhook.ts).
 *
 * NO SDK IS A DELIBERATE CHOICE, not an omission. package.json carries no `stripe`
 * package; the two calls we make (create a Checkout Session, verify a webhook signature)
 * are a form POST and an HMAC, and both are fully specified. This is the same posture
 * lib/receipt-parse.ts takes with the Anthropic Messages API and lib/ezcater/client.ts
 * takes with ezCater's GraphQL: a direct `fetch`, a pinned wire version, and the request
 * shape written out where a reviewer can read it.
 *
 * ── THE FOUR THINGS THAT LIVE HERE ───────────────────────────────────────────────────
 *   verifyStripeSignature  — the `Stripe-Signature` scheme (see below).
 *   encodeForm             — Stripe's application/x-www-form-urlencoded dialect.
 *   checkoutSessionParams  — the exact param map for POST /v1/checkout/sessions.
 *   parseCheckoutEvent     — the untrusted-JSON boundary: an event → a typed outcome.
 *
 * ── SIGNATURE SCHEME (Stripe "Verify webhook signatures manually") ───────────────────
 *   Header  : `Stripe-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>][,v0=<hex>]`
 *   Signed  : `${t}.${rawBody}` — the RAW body bytes, before any JSON round-trip.
 *   Expected: hex(HMAC-SHA256(endpointSecret, signedPayload)).
 *   Accept  : ANY `v1` entry matching, compared timing-safely. Multiple v1 entries are
 *             what an endpoint-secret ROLL looks like mid-flight, so "any match" is the
 *             contract, not a convenience. `v0` is Stripe's test-mode-only scheme and is
 *             deliberately never accepted.
 *   Freshness: |now − t| > tolerance → reject. Without it, a captured body + header stays
 *             valid forever and can be re-posted to re-drive the ledger.
 *
 * THE RAW BODY MATTERS. `JSON.parse` then `JSON.stringify` re-orders nothing in V8 but
 * changes whitespace, and the HMAC is over bytes: the route must hand this function
 * `await req.text()`, never a re-serialized object. That is why verification lives at the
 * route's front door and the parsed event is only produced afterwards.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Stripe's documented default tolerance for webhook timestamps. */
export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300;

/** Canonical UUID. The webhook's `metadata` values are attacker-shaped until proven
 *  otherwise — an unguarded value reaches PostgREST as a uuid cast that raises 22P02
 *  instead of taking the not-found branch (the lib/portal/quotes.ts idiom). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ── Signature verification ──────────────────────────────────────────────────────────

export interface ParsedStripeSignature {
  timestampSec: number;
  /** Every `v1=` value in header order. Empty when the header carried none. */
  v1: string[];
}

/**
 * Parse `t=…,v1=…[,v1=…]` into its parts. Returns null when the header is absent or
 * carries no usable timestamp — fail-closed, never a partially-trusted shape.
 * Unknown schemes (`v0`, future `vN`) are dropped here rather than at the compare, so
 * there is exactly one place that decides which schemes this codebase honours.
 */
export function parseStripeSignature(header: string | null): ParsedStripeSignature | null {
  if (!header) return null;
  let timestampSec: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (value.length === 0) continue;
    if (key === "t") {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) timestampSec = Math.trunc(n);
    } else if (key === "v1") {
      v1.push(value);
    }
  }
  if (timestampSec == null) return null;
  return { timestampSec, v1 };
}

/**
 * Verify a `Stripe-Signature` header against the raw request body.
 *
 * Returns true iff the timestamp is inside `toleranceSec` AND at least one `v1` entry is
 * the hex HMAC-SHA256 of `${t}.${rawBody}` under `secret`. Every candidate is compared
 * with `timingSafeEqual` over decoded BYTES (the lib/webhook-verify-shared.ts lesson: a
 * length mismatch means a different digest algorithm, so it short-circuits before the
 * constant-time compare rather than being a timing oracle).
 */
export function verifyStripeSignature(
  secret: string,
  header: string | null,
  rawBody: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec: number = STRIPE_SIGNATURE_TOLERANCE_SEC,
): boolean {
  if (!secret) return false;
  const parsed = parseStripeSignature(header);
  if (!parsed || parsed.v1.length === 0) return false;
  if (Math.abs(nowSec - parsed.timestampSec) > toleranceSec) return false;

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestampSec}.${rawBody}`)
    .digest();

  for (const candidate of parsed.v1) {
    // Hex is the wire format here (unlike svix's base64). A non-hex candidate decodes to
    // a short/empty buffer and fails the length guard — no throw, no special case.
    if (!/^[0-9a-f]+$/i.test(candidate)) continue;
    const candidateBuf = Buffer.from(candidate.toLowerCase(), "hex");
    if (candidateBuf.length === expected.length && timingSafeEqual(candidateBuf, expected)) {
      return true;
    }
  }
  return false;
}

// ── Form encoding ───────────────────────────────────────────────────────────────────

/**
 * Stripe's request bodies are `application/x-www-form-urlencoded` with BRACKETED keys for
 * nesting — `line_items[0][price_data][unit_amount]=2500`. There is no JSON body on
 * /v1/checkout/sessions, so the nesting is expressed in the key and this function's only
 * job is to encode a FLAT map of already-bracketed keys.
 *
 * `undefined` values are SKIPPED, not encoded as the string "undefined": an optional
 * Stripe param is absent, never empty, and an empty string is a meaningful value to
 * Stripe for several fields. Numbers stringify (integer cents stay integers — this
 * function never rounds; the caller owns the arithmetic).
 *
 * Space encodes as `+` and `+` encodes as `%2B`, which is what form-urlencoded means.
 * Key order is insertion order, which makes the request body deterministic and therefore
 * diffable in a test.
 */
export function encodeForm(params: Record<string, string | number | undefined>): string {
  const esc = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    parts.push(`${esc(key)}=${esc(String(value))}`);
  }
  return parts.join("&");
}

// ── Checkout Session params ─────────────────────────────────────────────────────────

export type StripePaymentKind = "deposit" | "balance" | "full";

export interface CheckoutSessionParamsInput {
  /** Our `catering_quotes.id`. */
  quoteId: string;
  /** Our `catering_payments.id` — the row the webhook will advance. */
  paymentId: string;
  kind: StripePaymentKind;
  /** Integer cents. Stripe rejects a non-integer `unit_amount`. */
  amountCents: number;
  /** ISO-4217 lower-case, from the payment row (`catering_payments.currency`, default 'usd'). */
  currency: string;
  /** What the customer sees on the Checkout page and on the receipt. */
  productName: string;
  /** Rides on the PaymentIntent — this is what shows in the Stripe dashboard's list. */
  description: string;
  /** Prefills Checkout's email field so the receipt lands where the portal session lives. */
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * The exact param map for `POST /v1/checkout/sessions`.
 *
 * ── WHY THE METADATA IS WRITTEN TWICE ────────────────────────────────────────────────
 * `metadata[…]` lands on the Checkout Session; `payment_intent_data[metadata][…]` lands
 * on the PaymentIntent, and Stripe copies a PaymentIntent's metadata onto its Charge. The
 * refund leg arrives as `charge.refunded` — a CHARGE event, which never carries the
 * session's metadata — so without the second copy a refund would have no way back to the
 * `catering_payments` row except a Stripe API round-trip. The three keys are identical in
 * both places on purpose; a reader should never have to ask which copy is authoritative,
 * because neither is: both are HINTS, and every value is re-validated and re-looked-up
 * server-side before a row is touched.
 *
 * `mode=payment` is a one-time charge. No `customer` is created and no card is stored —
 * the deposit/balance model has no recurring leg, and storing a card we do not need is a
 * liability rather than a feature.
 *
 * Kept as a pure function so the wire shape is a unit-test assertion rather than something
 * a reviewer has to reconstruct from a live request.
 */
export function checkoutSessionParams(
  input: CheckoutSessionParamsInput,
): Record<string, string | number | undefined> {
  return {
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.customerEmail,
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": input.currency,
    "line_items[0][price_data][unit_amount]": input.amountCents,
    "line_items[0][price_data][product_data][name]": input.productName,
    "metadata[quote_id]": input.quoteId,
    "metadata[payment_id]": input.paymentId,
    "metadata[kind]": input.kind,
    "payment_intent_data[metadata][quote_id]": input.quoteId,
    "payment_intent_data[metadata][payment_id]": input.paymentId,
    "payment_intent_data[metadata][kind]": input.kind,
    "payment_intent_data[description]": input.description,
  };
}

// ── Event parsing (the untrusted-JSON boundary) ─────────────────────────────────────

/**
 * What one delivery MEANS to this codebase. Deliberately smaller than Stripe's event
 * vocabulary: everything we do not act on collapses to `ignored`, and the ledger keeps
 * the verbatim payload so a future handler can be written against real traffic.
 */
export type CheckoutEventKind =
  | "completed"        // checkout.session.completed AND already paid → advance the row
  | "async_succeeded"  // checkout.session.async_payment_succeeded → advance the row
  | "async_failed"     // checkout.session.async_payment_failed → leave it 'due'
  | "expired"          // checkout.session.expired → leave it 'due'
  | "refunded"         // charge.refunded → move 'paid' → 'refunded'
  | "ignored";         // everything else, INCLUDING a completed-but-unpaid session

export interface CheckoutEventOutcome {
  kind: CheckoutEventKind;
  /** Stripe event id — the ledger's primary key. Null when the payload has no usable id. */
  eventId: string | null;
  /** Stripe event type, verbatim, even for `ignored`. */
  type: string | null;
  livemode: boolean;
  sessionId?: string;
  paymentIntentId?: string;
  /** From `metadata.quote_id` — a HINT, UUID-validated here, re-checked at the DB. */
  quoteId?: string;
  /** From `metadata.payment_id` — same posture. */
  paymentId?: string;
  /** Session `amount_total`, or a charge's `amount_refunded`. Integer cents, or absent. */
  amountCents?: number;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** A Stripe id field is either the id string or, when expanded, an object carrying `id`. */
function idOf(v: unknown): string | undefined {
  if (typeof v === "string") return v.length > 0 ? v : undefined;
  const obj = asRecord(v);
  return obj ? str(obj.id) : undefined;
}

function cents(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0
    ? v
    : undefined;
}

/**
 * Read one webhook event into a typed outcome. NEVER THROWS — the argument is untrusted
 * JSON that has passed a signature check and nothing more, and a parser that throws on a
 * shape surprise turns a recoverable "ignored" into a 500 and an infinite Stripe retry.
 * Every field is read defensively and every unknown shape collapses to `ignored`.
 *
 * ── THE ONE SUBTLETY: `completed` IS NOT THE SAME AS `paid` ──────────────────────────
 * `checkout.session.completed` fires when the customer finishes the Checkout flow, which
 * for a delayed-notification method (a bank debit) happens BEFORE the money arrives —
 * the session's `payment_status` is then `unpaid` and the real answer comes later as
 * `checkout.session.async_payment_succeeded` or `…_failed`. Treating every `completed` as
 * paid would mark a catering deposit received on the strength of an intention. So this
 * function returns `completed` ONLY for `paid` / `no_payment_required`, and a
 * completed-but-unpaid session returns `ignored` — the ledger still records the delivery
 * with its type, so the wait is visible rather than invented.
 */
export function parseCheckoutEvent(event: unknown): CheckoutEventOutcome {
  const root = asRecord(event);
  const eventId = root ? (str(root.id) ?? null) : null;
  const type = root ? (str(root.type) ?? null) : null;
  const livemode = root?.livemode === true;
  const base: CheckoutEventOutcome = { kind: "ignored", eventId, type, livemode };
  if (!root || !type) return base;

  const object = asRecord(asRecord(root.data)?.object);
  if (!object) return base;

  if (type === "charge.refunded") {
    const metadata = asRecord(object.metadata);
    return {
      ...base,
      kind: "refunded",
      paymentIntentId: idOf(object.payment_intent),
      quoteId: isUuid(metadata?.quote_id) ? (metadata?.quote_id as string) : undefined,
      paymentId: isUuid(metadata?.payment_id) ? (metadata?.payment_id as string) : undefined,
      amountCents: cents(object.amount_refunded),
    };
  }

  const sessionKinds: Record<string, CheckoutEventKind> = {
    "checkout.session.completed": "completed",
    "checkout.session.async_payment_succeeded": "async_succeeded",
    "checkout.session.async_payment_failed": "async_failed",
    "checkout.session.expired": "expired",
  };
  const kind = sessionKinds[type];
  if (!kind) return base;

  // See the header: a completed session whose money has not landed is NOT a payment.
  const paymentStatus = str(object.payment_status);
  const settled = paymentStatus === "paid" || paymentStatus === "no_payment_required";
  const effective: CheckoutEventKind = kind === "completed" && !settled ? "ignored" : kind;

  const metadata = asRecord(object.metadata);
  return {
    ...base,
    kind: effective,
    sessionId: str(object.id),
    paymentIntentId: idOf(object.payment_intent),
    quoteId: isUuid(metadata?.quote_id) ? (metadata?.quote_id as string) : undefined,
    paymentId: isUuid(metadata?.payment_id) ? (metadata?.payment_id as string) : undefined,
    amountCents: cents(object.amount_total),
  };
}

// ── Per-location credential suffixes ────────────────────────────────────────────────

/**
 * The env-var suffix for a location's OWN Stripe credentials, or null when the code
 * cannot name one.
 *
 * WHY THIS IS A FUNCTION AND NOT A MAP. The tenant-vocabulary law (AGENTS.md T0) forbids
 * location literals in code: there is no list of shop codes here, and there never will be
 * — the code arrives from the `locations` row at runtime and is turned into
 * `STRIPE_SECRET_KEY__<CODE>`. A second restaurant adds a row and two Vercel variables,
 * and changes no TypeScript.
 *
 * Codes are upper-cased and must be `[A-Z0-9_]+` to be usable: anything else could not be
 * an env-var name, and quietly mangling it into one would resolve a shop's payments to a
 * key nobody meant to give it. An unusable code returns null, which the caller reads as
 * "no override" and falls back to the single-account keys.
 */
export function stripeEnvSuffix(locationCode: string | null | undefined): string | null {
  if (typeof locationCode !== "string") return null;
  const upper = locationCode.trim().toUpperCase();
  if (upper.length === 0 || upper.length > 40) return null;
  return /^[A-Z0-9_]+$/.test(upper) ? upper : null;
}
