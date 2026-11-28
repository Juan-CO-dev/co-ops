/**
 * A small STATEFUL fake of the three Stripe Checkout calls the portal makes (audit wave W02,
 * review r1). The always-successful `mockResolvedValue({ id: "cs_new" })` the first spine
 * used could not see two real regressions, because both live in Stripe's own memory:
 *
 *   - IDEMPOTENCY KEYS (docs.stripe.com/api/idempotent_requests). A key replays the
 *     ORIGINAL response for at least 24 hours — whatever has happened to the session since — and a
 *     key re-used with different parameters is an error, not a new object. So "mint again
 *     under the same key" hands back an EXPIRED session, and "same key, new quote" is a 400.
 *   - SESSION STATUS. A session is `open`, `complete` or `expired`; only an open one can be
 *     expired, and only an open one has a hosted URL worth sending anyone to.
 *   - AN ID THIS ACCOUNT DOES NOT KNOW (review r4) is not "expired": retiring it THROWS
 *     `session_not_found` and reading it answers `not_found`, exactly as the real client
 *     does for Stripe's 404. This fake is ONE account; tests/stripe-http-fake.ts models two.
 *
 * Both are modelled here and nothing else is. Never a network call. The functions have the
 * signatures of lib/stripe/client.ts so a test wires them in with `mockImplementation`.
 *
 * ── REFUNDS (catering refunds Part B1, plan B1.6) ───────────────────────────────────────────────────
 * The strict evidence reads (`retrievePaymentIntentOwner`, `listRefundsPageStrict`, `retrieveRefundStrict`) and
 * `createRefund`, with the client's signatures, over the SAME in-memory model tests/stripe-http-fake.ts serves
 * (`refundWorld`: accounts and keys, rotation, PaymentIntents, refunds newest first, idempotent creates, scripted
 * steps). Unlike the session calls above, the refund surface IS account-aware: a key sees only its own account's
 * objects (404 = `not_found`), an unregistered key THROWS (a test bug), a rotated-out key is 401
 * `api_key_expired`. Knobs: `refundWorld.script(endpoint, step)` / `persist` with `delay` / `status` /
 * `networkError` / `malformed` from tests/stripe-http-fake.ts; a delay honours the per-call deadline exactly as
 * the client's AbortSignal does (StripeError status 0), and a deadline under 250 ms refuses a read before anything.
 * Each strict read MIRRORS the real client's validation of the same body; tests/stripe-refund-evidence-client
 * .test.ts pins the mirror equal to the real client over the HTTP fake for every malformed kind. `down` is the
 * session calls' switch only.
 */
import {
  parseStrictRefund,
  REFUND_EVIDENCE_MALFORMED,
  StripeError,
  type CreateRefundInput,
  type PaymentIntentOwner,
  type RefundListPage,
  type StrictRefund,
  type StripeRefund,
} from "@/lib/stripe/client";
import { checkoutSessionParams, encodeForm, type CheckoutSessionParamsInput } from "@/lib/stripe/shared";
import { refundWorld, sleepHonouringSignal, stepBody, type RefundEndpoint, type RefundWorld, type RefundWorldOptions, type Step } from "./stripe-http-fake";

export interface FakeSession {
  id: string;
  url: string;
  status: "open" | "complete" | "expired";
  amountCents: number;
  quoteId: string;
  paymentId: string;
  /** The idempotency key it was minted under. */
  key: string;
  /** The `expires_at` it was minted with (epoch seconds); undefined = Stripe's default. */
  expiresAtSec?: number;
}

export interface StripeFake {
  sessions: Map<string, FakeSession>;
  /** Every create call, in order: the key, and whether Stripe REPLAYED an earlier response. */
  creates: Array<{ key: string; replayed: boolean; sessionId: string }>;
  retires: string[];
  retrieves: string[];
  /** When true, every expire call fails the way an unreachable Stripe does. */
  down: boolean;
  create: (secretKey: string, input: CheckoutSessionParamsInput, idempotencyKey: string) => Promise<{ id: string; url: string }>;
  retire: (secretKey: string, sessionId: string) => Promise<"expired" | "complete">;
  retrieve: (
    secretKey: string,
    sessionId: string,
  ) => Promise<{ status: "open" | "complete" | "expired" | "not_found" | "gone"; url: string | null; amountTotal: number | null; quoteId: string | null; paymentId: string | null; expiresAt?: number | null }>;
  /** The customer finishes a checkout. */
  complete: (sessionId: string) => void;
  /** A session lapses on its own (24 h). */
  lapse: (sessionId: string) => void;
  /** The session a hosted URL belongs to. */
  byUrl: (url: string) => FakeSession | undefined;
  // ── refunds ──
  refundWorld: RefundWorld;
  /** Every refund-surface call that reached the provider, in order. */
  refundCalls: Array<{ endpoint: RefundEndpoint; secretKey: string; accountId: string; idempotencyKey: string | null }>;
  retrievePaymentIntentOwner: (secretKey: string, paymentIntentId: string, timeoutMs?: number) => Promise<PaymentIntentOwner>;
  listRefundsPageStrict: (secretKey: string, paymentIntentId: string, startingAfter: string | null, timeoutMs?: number) => Promise<RefundListPage>;
  retrieveRefundStrict: (secretKey: string, refundId: string, timeoutMs?: number) => Promise<{ status: "found"; refund: StrictRefund } | { status: "not_found" }>;
  createRefund: (secretKey: string, input: CreateRefundInput, idempotencyKey: string, timeoutMs?: number) => Promise<StripeRefund>;
}

const PAYMENT_INTENT_ID_RE = /^pi_[A-Za-z0-9_]+$/;
const REFUND_ID_RE = /^(re|pyr)_[A-Za-z0-9_]+$/;
const OPAQUE_STRIPE_ID_RE = /^[A-Za-z0-9_]{1,255}$/;

/** lib/stripe/client.ts `stripeErrorFrom`, in behaviour. */
function errorFrom(status: number, json: unknown): StripeError {
  const err = ((json as { error?: unknown } | null)?.error ?? null) as { message?: unknown; code?: unknown; type?: unknown } | null;
  const code = typeof err?.code === "string" ? err.code : typeof err?.type === "string" ? err.type : `http_${status}`;
  const message = typeof err?.message === "string" ? err.message : `Stripe returned ${status}`;
  return new StripeError(status, code, message);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ok = (n: number) => n >= 200 && n < 300;

export function stripeFake(refundOptions: RefundWorldOptions = {}): StripeFake {
  const world = refundWorld(refundOptions);
  const sessions = new Map<string, FakeSession>();
  const keys = new Map<string, { fingerprint: string; sessionId: string }>();
  let n = 0;

  const fake: StripeFake = {
    sessions,
    creates: [],
    retires: [],
    retrieves: [],
    down: false,

    create: async (_secretKey, input, idempotencyKey) => {
      if (fake.down) throw new StripeError(502, "network_error", "socket hang up");
      const fingerprint = JSON.stringify(checkoutSessionParams(input));
      const seen = keys.get(idempotencyKey);
      if (seen) {
        if (seen.fingerprint !== fingerprint) {
          throw new StripeError(
            400,
            "idempotency_error",
            "Keys for idempotent requests can only be used with the same parameters they were first used with.",
          );
        }
        // A replay is the ORIGINAL response. Stripe does not look at the session again.
        const original = sessions.get(seen.sessionId)!;
        fake.creates.push({ key: idempotencyKey, replayed: true, sessionId: original.id });
        return { id: original.id, url: original.url };
      }
      const id = `cs_test_${++n}`;
      const session: FakeSession = {
        id,
        url: `https://checkout.stripe.test/${id}`,
        status: "open",
        amountCents: input.amountCents,
        quoteId: input.quoteId,
        paymentId: input.paymentId,
        key: idempotencyKey,
        expiresAtSec: input.expiresAtSec,
      };
      sessions.set(id, session);
      keys.set(idempotencyKey, { fingerprint, sessionId: id });
      fake.creates.push({ key: idempotencyKey, replayed: false, sessionId: id });
      return { id, url: session.url };
    },

    retire: async (_secretKey, sessionId) => {
      fake.retires.push(sessionId);
      if (fake.down) throw new StripeError(502, "network_error", "socket hang up");
      const s = sessions.get(sessionId);
      // THIS ACCOUNT HAS NEVER HEARD OF IT. That is a 404, and a 404 is not a retirement
      // (review r4): the real client throws `session_not_found`, so this fake does too.
      if (!s) throw new StripeError(404, "session_not_found", "This Stripe account has no such Checkout Session");
      if (s.status === "complete") return "complete";
      s.status = "expired";
      return "expired";
    },

    retrieve: async (_secretKey, sessionId) => {
      fake.retrieves.push(sessionId);
      if (fake.down) throw new StripeError(502, "network_error", "socket hang up");
      const s = sessions.get(sessionId);
      if (!s) return { status: "not_found", url: null, amountTotal: null, quoteId: null, paymentId: null };
      return {
        status: s.status,
        url: s.status === "open" ? s.url : null,
        amountTotal: s.amountCents,
        quoteId: s.quoteId,
        paymentId: s.paymentId,
        expiresAt: s.expiresAtSec ?? null,
      };
    },

    complete: (sessionId) => {
      sessions.get(sessionId)!.status = "complete";
    },
    lapse: (sessionId) => {
      sessions.get(sessionId)!.status = "expired";
    },
    byUrl: (url) => [...sessions.values()].find((s) => s.url === url),

    refundWorld: world,
    refundCalls: [],

    retrievePaymentIntentOwner: async (secretKey, paymentIntentId, timeoutMs = 20_000) => {
      if (!PAYMENT_INTENT_ID_RE.test(paymentIntentId)) throw new StripeError(400, "bad_payment_intent_id", "Not a PaymentIntent id");
      const read = await strictGet("payment_intent", secretKey, timeoutMs, (accountId) => {
        const pi = world.paymentIntents.get(paymentIntentId);
        return pi && pi.account === accountId ? { status: 200, body: world.paymentIntentBody(pi) } : { status: 404, body: null };
      });
      if (read.status === 404) return { status: "not_found", chargeId: null, currency: null, livemode: null, amountCapturedCents: null };
      if (!ok(read.status)) throw errorFrom(read.status, read.body);
      const json = isObj(read.body) ? read.body : null;
      if (!json || json.id !== paymentIntentId) throw new StripeError(502, REFUND_EVIDENCE_MALFORMED, "Stripe answered with another PaymentIntent");
      const charge = json.latest_charge;
      const c = isObj(charge) ? charge : null;
      const id = typeof charge === "string" ? charge : c?.id;
      const captured = c && typeof c.amount_captured === "number" && Number.isSafeInteger(c.amount_captured) && c.amount_captured >= 0 ? c.amount_captured : null;
      return {
        status: "found",
        chargeId: typeof id === "string" && OPAQUE_STRIPE_ID_RE.test(id) ? id : null,
        currency: typeof json.currency === "string" && /^[a-z]{3}$/.test(json.currency) ? json.currency : null,
        livemode: typeof json.livemode === "boolean" ? json.livemode : null,
        amountCapturedCents: captured,
      };
    },

    listRefundsPageStrict: async (secretKey, paymentIntentId, startingAfter, timeoutMs = 20_000) => {
      if (!PAYMENT_INTENT_ID_RE.test(paymentIntentId)) throw new StripeError(400, "bad_payment_intent_id", "Not a PaymentIntent id");
      if (startingAfter !== null && !OPAQUE_STRIPE_ID_RE.test(startingAfter)) throw new StripeError(400, "bad_cursor", "Not a list cursor");
      const read = await strictGet("list", secretKey, timeoutMs, (accountId) => world.listPage(accountId, paymentIntentId, startingAfter, 100), startingAfter);
      if (!ok(read.status)) throw errorFrom(read.status, read.body);
      const malformed = (why: string) => new StripeError(502, REFUND_EVIDENCE_MALFORMED, why);
      const json = isObj(read.body) ? read.body : null;
      if (!json || !Array.isArray(json.data) || typeof json.has_more !== "boolean") throw malformed("The refund list has no data array or no has_more");
      const refunds: StrictRefund[] = [];
      const seen = new Set<string>();
      for (const d of json.data as unknown[]) {
        const r = parseStrictRefund(d);
        if (!r) throw malformed("The refund list carries a malformed refund");
        if (r.paymentIntentId !== paymentIntentId) throw malformed("The refund list carries a refund of another PaymentIntent");
        if (seen.has(r.id)) throw malformed("The refund list repeats an id");
        seen.add(r.id);
        refunds.push(r);
      }
      const lastId = refunds.length > 0 ? refunds[refunds.length - 1]!.id : null;
      if (json.has_more && (!lastId || lastId === startingAfter)) throw malformed("A non-terminal page has no advancing cursor");
      return { refunds, hasMore: json.has_more as boolean, lastId };
    },

    retrieveRefundStrict: async (secretKey, refundId, timeoutMs = 20_000) => {
      if (!OPAQUE_STRIPE_ID_RE.test(refundId)) throw new StripeError(400, "bad_refund_id", "Not a refund id");
      const read = await strictGet("refund", secretKey, timeoutMs, (accountId) => {
        const r = world.refunds.find((x) => x.id === refundId && x.account === accountId);
        return r ? { status: 200, body: world.refundBody(r) } : { status: 404, body: null };
      });
      if (read.status === 404) return { status: "not_found" };
      if (!ok(read.status)) throw errorFrom(read.status, read.body);
      const refund = parseStrictRefund(read.body);
      if (!refund || refund.id !== refundId) throw new StripeError(502, REFUND_EVIDENCE_MALFORMED, "Stripe answered with a malformed or different refund");
      return { status: "found", refund };
    },

    createRefund: async (secretKey, input, idempotencyKey, timeoutMs = 20_000) => {
      if (!secretKey) throw new StripeError(500, "not_configured", "Stripe secret key is not set");
      if (!PAYMENT_INTENT_ID_RE.test(input.paymentIntentId)) throw new StripeError(400, "bad_payment_intent_id", "Not a PaymentIntent id");
      if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new StripeError(400, "bad_amount", "A refund amount is a positive integer");
      const form = encodeForm({
        payment_intent: input.paymentIntentId,
        amount: input.amountCents,
        reason: input.reason ?? undefined,
        "metadata[refund_request_id]": input.metadata.refund_request_id,
        "metadata[quote_id]": input.metadata.quote_id,
        "metadata[payment_id]": input.metadata.payment_id,
      });
      const signal = AbortSignal.timeout(Math.min(Math.max(timeoutMs, 1), 20_000));
      const accountId = admit("create", secretKey, idempotencyKey);
      const step = world.nextStep("create", accountId);
      const out = world.create(secretKey, accountId, idempotencyKey, form, step);
      if ("network" in out) throw new StripeError(0, "network_error", "fetch failed");
      try {
        if (step?.delayMs) await sleepHonouringSignal(step.delayMs, signal);
      } catch (e) {
        throw new StripeError(0, "network_error", e instanceof Error ? e.message : String(e));
      }
      if (out.lost) throw new StripeError(0, "network_error", "fetch failed");
      if (!ok(out.status)) throw errorFrom(out.status, out.body);
      const json = isObj(out.body) ? out.body : null;
      const id = typeof json?.id === "string" && REFUND_ID_RE.test(json.id) ? json.id : null;
      if (!json || !id) throw new StripeError(502, "bad_payload", "Stripe returned no refund id");
      const metadata = isObj(json.metadata) ? json.metadata : null;
      return {
        id,
        status: typeof json.status === "string" ? json.status : null,
        amountCents: typeof json.amount === "number" && Number.isInteger(json.amount) ? json.amount : null,
        requestId: typeof metadata?.refund_request_id === "string" ? metadata.refund_request_id : null,
      };
    },
  };

  /** Resolve the key (unregistered = a test bug: THROW), log the call, refuse a rotated-out key with a 401. */
  function admit(endpoint: RefundEndpoint, secretKey: string, idempotencyKey: string | null): string {
    const resolved = world.resolve(secretKey);
    if (resolved.kind === "unknown") throw new Error("stripe-fake: a refund call with a key no test registered");
    fake.refundCalls.push({ endpoint, secretKey, accountId: resolved.accountId, idempotencyKey });
    if (resolved.kind === "expired") throw new StripeError(401, "api_key_expired", "Expired API Key provided");
    return resolved.accountId;
  }

  /** The client's `stripeGet` + the scripted step: deadline first, then the answer (late, refused, bent, or normal). */
  async function strictGet(
    endpoint: RefundEndpoint,
    secretKey: string,
    timeoutMs: number,
    normal: (accountId: string) => { status: number; body: unknown },
    startingAfter: string | null = null,
  ): Promise<{ status: number; body: unknown }> {
    if (!secretKey) throw new StripeError(500, "not_configured", "Stripe secret key is not set");
    if (!Number.isFinite(timeoutMs) || timeoutMs < 250) throw new StripeError(0, "deadline_exhausted", "No time left for this Stripe read");
    const signal = AbortSignal.timeout(Math.min(timeoutMs, 20_000));
    const accountId = admit(endpoint, secretKey, null);
    const step: Step | null = world.nextStep(endpoint, accountId);
    if (step?.network) throw new StripeError(0, "network_error", "fetch failed");
    let answer = step?.status !== undefined ? { status: step.status, body: stepBody(step.status, step.body) } : normal(accountId);
    if (step?.malformed) {
      if (answer.status !== 200) throw new Error(`stripe-fake: malformed(${step.malformed}) on a ${answer.status} answer`);
      answer = { status: 200, body: world.bend(endpoint, step.malformed, answer.body as Record<string, unknown>, { accountId, startingAfter }) };
    }
    try {
      if (step?.delayMs) await sleepHonouringSignal(step.delayMs, signal);
    } catch (e) {
      throw new StripeError(0, "network_error", e instanceof Error ? e.message : String(e));
    }
    return answer;
  }

  return fake;
}
