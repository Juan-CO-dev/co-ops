/**
 * Unit spine — lib/stripe/shared.ts. Pins the four pure pieces the Stripe leg rests on:
 * the `Stripe-Signature` contract, the form dialect, the exact Checkout param map, and the
 * untrusted-event parser.
 *
 * WHY EACH ONE IS PINNED:
 *   - The signature verifier is SECURITY-CRITICAL and the house has already shipped one
 *     broken (lib/webhook-verify-shared.ts's base64-vs-utf8 bug, which rejected every
 *     valid Resend signature because it had no test). The `verifies a correctly signed
 *     body` case here must pass against a signature computed the way Stripe computes it.
 *   - `checkoutSessionParams` is the MONEY WIRE SHAPE. A renamed key does not throw, it
 *     silently drops a field — a missing `metadata[payment_id]` would strand every webhook
 *     on the fallback lookup, and a missing `payment_intent_data[metadata]` would make
 *     refunds unmatchable. So the whole key set is asserted exactly.
 *   - `parseCheckoutEvent` reads attacker-shaped JSON and MUST NOT THROW, ever: a throw on
 *     a shape surprise becomes a 500 and an infinite Stripe retry.
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";

import {
  STRIPE_SIGNATURE_TOLERANCE_SEC,
  checkoutSessionParams,
  encodeForm,
  isUuid,
  parseCheckoutEvent,
  parseStripeSignature,
  stripeEnvSuffix,
  verifyStripeSignature,
} from "@/lib/stripe/shared";

// A fake endpoint secret in the real `whsec_` shape. NOT a credential.
const SECRET = "whsec_test";
const NOW = 1789_000_000;
const BODY = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

function sign(body: string, secret = SECRET, ts = NOW): string {
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${sig}`;
}

describe("parseStripeSignature", () => {
  it("reads t and every v1 entry, in header order", () => {
    expect(parseStripeSignature("t=123,v1=aa,v1=bb")).toEqual({ timestampSec: 123, v1: ["aa", "bb"] });
  });

  it("drops schemes this codebase does not honour (v0 is Stripe's test-mode-only scheme)", () => {
    expect(parseStripeSignature("t=123,v0=zz,v1=aa")).toEqual({ timestampSec: 123, v1: ["aa"] });
  });

  it("fails closed on a header with no usable timestamp", () => {
    for (const h of [null, "", "v1=aa", "t=,v1=aa", "t=notanumber,v1=aa", "t=-5,v1=aa"]) {
      expect(parseStripeSignature(h), String(h)).toBeNull();
    }
  });
});

describe("verifyStripeSignature", () => {
  it("verifies a correctly signed body (the regression guard — see the header)", () => {
    expect(verifyStripeSignature(SECRET, sign(BODY), BODY, NOW)).toBe(true);
  });

  it("accepts when ANY v1 entry matches — that is what an endpoint-secret roll looks like", () => {
    const good = sign(BODY).split("v1=")[1]!;
    const header = `t=${NOW},v1=${"0".repeat(64)},v1=${good}`;
    expect(verifyStripeSignature(SECRET, header, BODY, NOW)).toBe(true);
  });

  it("rejects a tampered body, the wrong secret, and a garbage header", () => {
    expect(verifyStripeSignature(SECRET, sign(BODY), `${BODY} `, NOW)).toBe(false);
    expect(verifyStripeSignature("whsec_other", sign(BODY), BODY, NOW)).toBe(false);
    expect(verifyStripeSignature(SECRET, "garbage", BODY, NOW)).toBe(false);
    expect(verifyStripeSignature(SECRET, `t=${NOW},v1=nothex!!`, BODY, NOW)).toBe(false);
    expect(verifyStripeSignature("", sign(BODY), BODY, NOW)).toBe(false);
  });

  it("rejects outside the tolerance window in BOTH directions (the replay vector)", () => {
    const at = (t: number) => verifyStripeSignature(SECRET, sign(BODY), BODY, t);
    expect(at(NOW + STRIPE_SIGNATURE_TOLERANCE_SEC)).toBe(true);
    expect(at(NOW - STRIPE_SIGNATURE_TOLERANCE_SEC)).toBe(true);
    expect(at(NOW + STRIPE_SIGNATURE_TOLERANCE_SEC + 1)).toBe(false);
    expect(at(NOW - STRIPE_SIGNATURE_TOLERANCE_SEC - 1)).toBe(false);
  });

  it("rejects a v1-less header even when the timestamp is fresh", () => {
    expect(verifyStripeSignature(SECRET, `t=${NOW}`, BODY, NOW)).toBe(false);
  });
});

describe("encodeForm", () => {
  it("encodes bracketed nesting without mangling the brackets' meaning", () => {
    expect(encodeForm({ "line_items[0][price_data][unit_amount]": 2500 })).toBe(
      "line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=2500",
    );
  });

  it("SKIPS undefined rather than encoding the string 'undefined'", () => {
    expect(encodeForm({ a: "1", b: undefined, c: 2 })).toBe("a=1&c=2");
  });

  it("keeps an empty string, which is a meaningful value to Stripe", () => {
    expect(encodeForm({ a: "" })).toBe("a=");
  });

  it("is form-urlencoded: space is + and a literal + is %2B", () => {
    expect(encodeForm({ name: "Deposit + tax" })).toBe("name=Deposit+%2B+tax");
  });

  it("preserves insertion order, so a request body is diffable", () => {
    expect(encodeForm({ z: 1, a: 2 })).toBe("z=1&a=2");
  });
});

describe("checkoutSessionParams — the money wire shape", () => {
  const params = checkoutSessionParams({
    quoteId: "11111111-2222-4333-8444-555555555555",
    paymentId: "66666666-7777-4888-8999-000000000000",
    kind: "deposit",
    amountCents: 12_500,
    currency: "usd",
    productName: "Tenant — Catering deposit (2026-10-01)",
    description: "Tenant catering deposit",
    customerEmail: "customer@example.com",
    successUrl: "https://app.example/order/quote/q?checkout=success",
    cancelUrl: "https://app.example/order/quote/q?checkout=cancel",
  });

  it("carries EXACTLY the keys Stripe is sent — nothing more, nothing renamed", () => {
    expect(Object.keys(params).sort()).toEqual([
      "cancel_url",
      "customer_email",
      "line_items[0][price_data][currency]",
      "line_items[0][price_data][product_data][name]",
      "line_items[0][price_data][unit_amount]",
      "line_items[0][quantity]",
      "metadata[kind]",
      "metadata[payment_id]",
      "metadata[quote_id]",
      "mode",
      "payment_intent_data[description]",
      "payment_intent_data[metadata][kind]",
      "payment_intent_data[metadata][payment_id]",
      "payment_intent_data[metadata][quote_id]",
      "success_url",
    ]);
  });

  it("is a one-time payment for exactly one line at the integer-cent amount", () => {
    expect(params.mode).toBe("payment");
    expect(params["line_items[0][quantity]"]).toBe(1);
    expect(params["line_items[0][price_data][unit_amount]"]).toBe(12_500);
    expect(params["line_items[0][price_data][currency]"]).toBe("usd");
  });

  it("writes the three ids on the SESSION and on the PAYMENT INTENT — the refund path needs the second copy", () => {
    for (const key of ["quote_id", "payment_id", "kind"] as const) {
      expect(params[`metadata[${key}]`]).toBe(params[`payment_intent_data[metadata][${key}]`]);
    }
    expect(params["metadata[payment_id]"]).toBe("66666666-7777-4888-8999-000000000000");
    expect(params["metadata[kind]"]).toBe("deposit");
  });
});

describe("parseCheckoutEvent — the untrusted-JSON boundary", () => {
  const session = (over: Record<string, unknown> = {}, type = "checkout.session.completed") => ({
    id: "evt_1",
    type,
    livemode: true,
    data: {
      object: {
        id: "cs_1",
        payment_status: "paid",
        payment_intent: "pi_1",
        amount_total: 2500,
        metadata: {
          quote_id: "11111111-2222-4333-8444-555555555555",
          payment_id: "66666666-7777-4888-8999-000000000000",
          kind: "deposit",
        },
        ...over,
      },
    },
  });

  it("reads a completed+paid session into `completed` with every id", () => {
    const out = parseCheckoutEvent(session());
    expect(out.kind).toBe("completed");
    expect(out.eventId).toBe("evt_1");
    expect(out.livemode).toBe(true);
    expect(out.sessionId).toBe("cs_1");
    expect(out.paymentIntentId).toBe("pi_1");
    expect(out.paymentId).toBe("66666666-7777-4888-8999-000000000000");
    expect(out.amountCents).toBe(2500);
  });

  it("a completed-but-UNPAID session is `ignored` — completed is not paid (async methods)", () => {
    expect(parseCheckoutEvent(session({ payment_status: "unpaid" })).kind).toBe("ignored");
    expect(parseCheckoutEvent(session({ payment_status: "no_payment_required" })).kind).toBe("completed");
  });

  it("maps the async + expiry types", () => {
    expect(parseCheckoutEvent(session({}, "checkout.session.async_payment_succeeded")).kind).toBe("async_succeeded");
    // async_failed / expired never carry payment_status 'paid' in the wild; the mapping is
    // by TYPE for these, so the payment_status of the fixture must not matter.
    expect(parseCheckoutEvent(session({ payment_status: "unpaid" }, "checkout.session.async_payment_failed")).kind).toBe("async_failed");
    expect(parseCheckoutEvent(session({ payment_status: "unpaid" }, "checkout.session.expired")).kind).toBe("expired");
  });

  it("reads charge.refunded from the CHARGE, whose metadata Stripe copies off the PaymentIntent", () => {
    const out = parseCheckoutEvent({
      id: "evt_r",
      type: "charge.refunded",
      livemode: false,
      data: {
        object: {
          id: "ch_1",
          payment_intent: "pi_1",
          amount_refunded: 2500,
          metadata: { payment_id: "66666666-7777-4888-8999-000000000000" },
        },
      },
    });
    expect(out.kind).toBe("refunded");
    expect(out.paymentIntentId).toBe("pi_1");
    expect(out.amountCents).toBe(2500);
  });

  it("accepts an EXPANDED payment_intent object as well as the id string", () => {
    expect(parseCheckoutEvent(session({ payment_intent: { id: "pi_x" } })).paymentIntentId).toBe("pi_x");
  });

  it("REFUSES a non-UUID id from metadata — it never reaches a query", () => {
    const out = parseCheckoutEvent(session({ metadata: { payment_id: "'; drop table --", quote_id: "1" } }));
    expect(out.paymentId).toBeUndefined();
    expect(out.quoteId).toBeUndefined();
  });

  it("NEVER THROWS on garbage, and collapses every unknown shape to `ignored`", () => {
    for (const bad of [null, undefined, 0, "", "nope", [], {}, { type: 1 }, { id: "e", type: "x" }, { id: "e", type: "charge.refunded", data: 5 }]) {
      expect(() => parseCheckoutEvent(bad)).not.toThrow();
      expect(parseCheckoutEvent(bad).kind).toBe("ignored");
    }
  });

  it("keeps the event type on an ignored event, so the ledger can still answer 'did Stripe send X?'", () => {
    const out = parseCheckoutEvent({ id: "evt_9", type: "invoice.paid", livemode: false, data: { object: {} } });
    expect(out).toMatchObject({ kind: "ignored", eventId: "evt_9", type: "invoice.paid" });
  });

  it("rejects a non-integer / negative amount rather than carrying it forward", () => {
    expect(parseCheckoutEvent(session({ amount_total: 25.5 })).amountCents).toBeUndefined();
    expect(parseCheckoutEvent(session({ amount_total: -1 })).amountCents).toBeUndefined();
  });
});

describe("isUuid / stripeEnvSuffix", () => {
  it("isUuid accepts a canonical uuid and refuses anything else", () => {
    expect(isUuid("11111111-2222-4333-8444-555555555555")).toBe(true);
    expect(isUuid("11111111222243338444555555555555")).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  it("upper-cases a usable location code into an env-var suffix", () => {
    expect(stripeEnvSuffix("em")).toBe("EM");
    expect(stripeEnvSuffix(" mep ")).toBe("MEP");
    expect(stripeEnvSuffix("CAP_HILL")).toBe("CAP_HILL");
  });

  it("refuses a code that could not name an env var — mangling one would resolve the WRONG account", () => {
    for (const bad of [null, undefined, "", "   ", "cap-hill", "a b", "shop!", "x".repeat(41), 7 as unknown as string]) {
      expect(stripeEnvSuffix(bad as string), String(bad)).toBeNull();
    }
  });
});
