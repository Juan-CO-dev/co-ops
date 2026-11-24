/**
 * Catering refunds — the pure rules (lib/catering/refunds-shared.ts): the switch, the gate, the figures (the TS twin of
 * 0357 `catering_refund_figures`), the allocation (0357's order), Stripe's statuses and failures, the strict body parse,
 * the typed-dollars parse, the retry window. Stripe rules cited are from docs.stripe.com (see the module).
 */
import { describe, expect, it } from "vitest";

import {
  allocateRefund,
  canRequestRefund,
  cateringRefundsOn,
  parseRefundBody,
  refundDollarsToCents,
  refundFigures,
  refundIdempotencyKey,
  refundStatusFromStripe,
  requestRetryState,
  stripeCreateFailure,
  stripeRefundReason,
  summarizeTotals,
  REFUND_RETRY_WINDOW_MS,
} from "@/lib/catering/refunds-shared";
import { ROLES, type RoleCode } from "@/lib/roles";

const PAID = { amountCents: 30000, status: "paid", provider: "stripe", providerRef: "pi_123" };

describe("the switch", () => {
  it("only CATERING_REFUNDS=1 turns it on", () => {
    expect(cateringRefundsOn({})).toBe(false);
    expect(cateringRefundsOn({ CATERING_REFUNDS: "0" })).toBe(false);
    expect(cateringRefundsOn({ CATERING_REFUNDS: "true" })).toBe(false);
    expect(cateringRefundsOn({ CATERING_REFUNDS: "1" })).toBe(true);
  });
});

describe("who may refund (the conservative gate)", () => {
  it("catering manager, MoO, owner, CGS — never GM, AGM, prep or social media manager, never by level", () => {
    const allowed = (Object.keys(ROLES) as RoleCode[]).filter(canRequestRefund).sort();
    expect(allowed).toEqual(["catering_mgr", "cgs", "moo", "owner"]);
  });
});

describe("refundFigures — the twin of 0357", () => {
  it("a Stripe-paid row is refundable in full", () => {
    expect(refundFigures(PAID, [], [])).toEqual({ capturedCents: 30000, refundedCents: 0, inFlightCents: 0, refundableCents: 30000, eligible: true });
  });
  it("hand-marked, due, refunded and PaymentIntent-less rows refund nothing here", () => {
    for (const p of [{ ...PAID, provider: "manual" }, { ...PAID, status: "due" }, { ...PAID, status: "refunded" }, { ...PAID, providerRef: null }, { ...PAID, providerRef: "cs_test_x" }]) {
      expect(refundFigures(p, [], []).refundableCents).toBe(0);
    }
  });
  it("Stripe's cumulative refund and a smaller charge amount reduce it; our own rows count by status", () => {
    const f = refundFigures(PAID, [{ cumulativeRefundedCents: 5000, chargeAmountCents: 29000 }, { cumulativeRefundedCents: 2000, chargeAmountCents: null }], [
      { amountCents: 1000, status: "pending" },
      { amountCents: 3000, status: "succeeded" },
      { amountCents: 500, status: "submitted" },
      { amountCents: 9999, status: "failed" },
    ]);
    // captured = min(30000, 29000); refunded = max(5000, 3000 + 500); in flight = 1000.
    expect(f).toEqual({ capturedCents: 29000, refundedCents: 5000, inFlightCents: 1000, refundableCents: 23000, eligible: true });
  });
  it("never below zero", () => {
    expect(refundFigures(PAID, [{ cumulativeRefundedCents: 40000, chargeAmountCents: 30000 }], []).refundableCents).toBe(0);
  });
});

describe("allocateRefund — balance, then full, then deposit; newest first", () => {
  const pays = [
    { id: "d", kind: "deposit" as const, paidAt: "2026-11-01T00:00:00Z", refundableCents: 30000 },
    { id: "b", kind: "balance" as const, paidAt: "2026-11-05T00:00:00Z", refundableCents: 70000 },
  ];
  it("takes the balance first", () => {
    expect(allocateRefund(pays, 80000)).toEqual([{ id: "b", amountCents: 70000 }, { id: "d", amountCents: 10000 }]);
    expect(allocateRefund(pays, 100)).toEqual([{ id: "b", amountCents: 100 }]);
  });
  it("skips a payment with nothing left", () => {
    expect(allocateRefund([{ ...pays[1]!, refundableCents: 0 }, pays[0]!], 500)).toEqual([{ id: "d", amountCents: 500 }]);
  });
});

describe("Stripe's answers", () => {
  it("a refund's status maps onto ours (docs.stripe.com/api/refunds/object)", () => {
    expect(refundStatusFromStripe("succeeded")).toBe("succeeded");
    expect(refundStatusFromStripe("pending")).toBe("submitted");
    expect(refundStatusFromStripe("requires_action")).toBe("submitted");
    expect(refundStatusFromStripe("failed")).toBe("failed");
    expect(refundStatusFromStripe("canceled")).toBe("failed");
    expect(refundStatusFromStripe("weird")).toBeNull();
    expect(refundStatusFromStripe(null)).toBeNull();
  });
  it("a failed create: no response / 5xx / 409 / 429 are unknown (stay pending); any other 4xx is refused", () => {
    for (const s of [0, 500, 502, 503, 504, 409, 429]) expect(stripeCreateFailure(s)).toBe("unknown");
    for (const s of [400, 401, 402, 403, 404]) expect(stripeCreateFailure(s)).toBe("refused");
  });
  it("our reasons map onto Stripe's enum (duplicate | fraudulent | requested_by_customer); never fraudulent", () => {
    expect(stripeRefundReason("duplicate_charge")).toBe("duplicate");
    expect(stripeRefundReason("customer_cancelled")).toBe("requested_by_customer");
    expect(stripeRefundReason("quote_declined")).toBe("requested_by_customer");
    expect(stripeRefundReason("event_lost")).toBe("requested_by_customer");
    expect(stripeRefundReason("service_issue")).toBeNull();
    expect(stripeRefundReason("other")).toBeNull();
  });
  it("the idempotency key is the request row's id, the same on every attempt", () => {
    expect(refundIdempotencyKey("abc")).toBe("catering-refund:abc");
  });
});

describe("parseRefundBody — strict", () => {
  const ok = { clientToken: "11111111-1111-4111-8111-111111111111", amountCents: 1000, reasonCode: "event_lost", reasonNote: " lost it ", trigger: "lost" };
  it("accepts a good body and trims the note", () => {
    expect(parseRefundBody(ok)).toEqual({ ...ok, reasonNote: "lost it" });
    expect(parseRefundBody({ ...ok, amountCents: null, reasonNote: null })).toMatchObject({ amountCents: null, reasonNote: null });
  });
  it("refuses unknown keys, bad tokens, reasons and triggers", () => {
    expect(parseRefundBody({ ...ok, extra: 1 })).toBe("invalid_request");
    expect(parseRefundBody({ ...ok, clientToken: "nope" })).toBe("invalid_request");
    expect(parseRefundBody({ ...ok, reasonCode: "because" })).toBe("invalid_request");
    expect(parseRefundBody({ ...ok, trigger: "constructor" })).toBe("invalid_request");
    expect(parseRefundBody(null)).toBe("invalid_request");
    expect(parseRefundBody([ok])).toBe("invalid_request");
    expect(parseRefundBody({ ...ok, reasonNote: "x".repeat(501) })).toBe("invalid_request");
  });
  it("refuses a non-integer, zero, negative or huge amount", () => {
    for (const a of [10.5, 0, -1, "100", 10_000_001]) expect(parseRefundBody({ ...ok, amountCents: a })).toBe("invalid_amount");
  });
  it("`other` needs a note", () => {
    expect(parseRefundBody({ ...ok, reasonCode: "other", reasonNote: "   " })).toBe("note_required");
    expect(parseRefundBody({ ...ok, reasonCode: "other", reasonNote: "card charged twice" })).toMatchObject({ reasonCode: "other" });
  });
});

describe("refundDollarsToCents", () => {
  it("reads dollars without float maths", () => {
    expect(refundDollarsToCents("12.34")).toBe(1234);
    expect(refundDollarsToCents("$0.1")).toBe(10);
    expect(refundDollarsToCents("19.99")).toBe(1999);
    expect(refundDollarsToCents(" 300 ")).toBe(30000);
    for (const bad of ["", "0", "0.00", "1.234", "-5", "abc", "1,000"]) expect(refundDollarsToCents(bad)).toBeNull();
  });
});

describe("the retry window (docs.stripe.com/error-low-level: 24 hours, then reconcile)", () => {
  const at = "2026-11-23T10:00:00Z";
  const t0 = Date.parse(at);
  it("a pending row is retryable inside 24 h and needs a person after", () => {
    expect(requestRetryState({ status: "pending", firstAttemptAt: at, requestedAt: at }, t0 + 1000)).toEqual({ needsReconcile: false, retryable: true });
    expect(requestRetryState({ status: "pending", firstAttemptAt: at, requestedAt: at }, t0 + REFUND_RETRY_WINDOW_MS + 1)).toEqual({ needsReconcile: true, retryable: false });
  });
  it("submitted can be refreshed; succeeded and failed are finished", () => {
    expect(requestRetryState({ status: "submitted", firstAttemptAt: at, requestedAt: at }, t0 + REFUND_RETRY_WINDOW_MS * 3)).toEqual({ needsReconcile: false, retryable: true });
    for (const s of ["succeeded", "failed"] as const) expect(requestRetryState({ status: s, firstAttemptAt: at, requestedAt: at }, t0)).toEqual({ needsReconcile: false, retryable: false });
  });
});

describe("summarizeTotals", () => {
  it("adds the Stripe-paid figures; a whole-charge refunded row counts as paid and refunded; a hand payment is outside", () => {
    const f = (over: Partial<ReturnType<typeof refundFigures>>) => ({ ...refundFigures(PAID, [], []), ...over });
    const totals = summarizeTotals([
      { id: "a", kind: "deposit", status: "paid", provider: "stripe", amountCents: 30000, paidAt: null, figures: f({ refundedCents: 1000, refundableCents: 29000 }) },
      { id: "b", kind: "balance", status: "refunded", provider: "stripe", amountCents: 5000, paidAt: null, figures: { ...refundFigures({ ...PAID, amountCents: 5000, status: "refunded" }, [], []) } },
      { id: "c", kind: "full", status: "paid", provider: "manual", amountCents: 700, paidAt: null, figures: refundFigures({ ...PAID, provider: "manual" }, [], []) },
      { id: "d", kind: "full", status: "due", provider: null, amountCents: 900, paidAt: null, figures: refundFigures({ ...PAID, status: "due" }, [], []) },
    ]);
    expect(totals).toEqual({ paidCents: 35000, refundedCents: 6000, inFlightCents: 0, refundableCents: 29000, outsideAppCents: 700 });
  });
});
