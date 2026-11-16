/**
 * END-TO-END reproduction of review r1's P1 on audit W02 (B036 + B038): "Repricing can
 * recreate the partial-refund bug."
 *
 *   1. a customer has an open checkout for a $300 deposit (session `cs_old`);
 *   2. staff revise the quote — the deposit is now $200 — while Stripe cannot be reached,
 *      so `cs_old` cannot be retired and is still payable at $300;
 *   3. the customer pays `cs_old`: $300 is captured;
 *   4. staff refund $200 of it.
 *
 * Before: step 2 rewrote the row to $200 with `cs_old` still open, so step 4's
 * `amount_refunded (200) >= amount_cents (200)` marked the payment FULLY refunded with $100
 * still captured — the portal then showed nothing paid and took a second deposit.
 *
 * Two rules close it, and each is pinned here and on its own below:
 *   · AN INTENT WITH AN OPEN CHECKOUT IS NEVER RE-PRICED. The row's `amount_cents` is what
 *     its session will charge. Re-pricing happens only after the session is retired.
 *   · "FULLY REFUNDED" IS THE CHARGE'S OWN FACT — Stripe's `refunded` flag, or
 *     `amount_refunded` against the charge's `amount`. Never the row's amount.
 *
 * Drives the real `reviseQuote`, the real webhook processor and the real portal pay gate
 * against tests/payments-fake-client.ts. The Stripe client is mocked at the module boundary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";

let db: PaymentsFake;

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ id: "email_1" })),
  teamFrom: () => "Team <team@example.com>",
}));
vi.mock("@/lib/stripe/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe/client")>();
  return {
    ...actual,
    stripeCredentialsFor: vi.fn(() => ({ secretKey: "sk_shop", webhookSecret: "whsec_shop", source: "location" })),
    createCheckoutSession: vi.fn(),
    retireCheckoutSession: vi.fn(),
    retrieveCheckoutSession: vi.fn(),
  };
});

import { audit } from "@/lib/audit";
import { reviseQuote } from "@/lib/catering/quotes";
import { createPaymentDue } from "@/lib/catering/payments";
import { initiatePayment, PortalQuoteError } from "@/lib/portal/quotes";
import { createCheckoutSession, retireCheckoutSession, StripeError } from "@/lib/stripe/client";
import { processStripeEvent, type StripeWebhookContext } from "@/lib/stripe/webhook";
import type { AuthContext } from "@/lib/session";

const auditMock = vi.mocked(audit);
const retireMock = vi.mocked(retireCheckoutSession);
const createSessionMock = vi.mocked(createCheckoutSession);

const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const V1 = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const DEPOSIT = "d0000000-0000-4000-8000-000000000001";
const SINGLE: StripeWebhookContext = { locationId: null, locationCode: null };
const notifyPaid = vi.fn(async () => {});

const owner = { user: { id: "u1", role: "owner" }, locations: [LOCATION] } as unknown as AuthContext;

/** The revision: 4 trays at $200 = $800 total; deposit 25% = $200 (it was $300). */
const CHEAPER = { eventDate: "2099-06-01", headcount: 40, lines: [{ description: "Sub tray", quantity: 4, unitPriceCents: 20000 }] };

function v1(): Row {
  return {
    id: V1,
    root_id: null,
    version: 1,
    pipeline_id: null,
    customer_id: CUSTOMER,
    location_id: LOCATION,
    status: "sent",
    origin: "staff",
    event_date: "2099-06-01",
    headcount: 40,
    is_delivery: false,
    delivery_zone_id: null,
    subtotal_cents: 120000,
    delivery_fee_cents: 0,
    service_charge_cents: 0,
    gratuity_cents: 0,
    tax_cents: 0,
    total_cents: 120000,
    deposit_cents: 30000,
    tax_rate_bps: 0,
    gratuity_bps: 0,
    service_charge_bps: 0,
    deposit_pct_bps: 2500,
    tax_on_delivery: true,
    tax_on_gratuity: false,
    expires_at: "2099-01-01T00:00:00.000Z",
    notes: null,
    created_at: "2026-11-01T00:00:00.000Z",
    created_by: null,
    sent_at: "2026-11-01T00:00:00.000Z",
    sent_by: "u1",
    superseded_at: null,
  };
}

/** The customer's open checkout: a due $300 deposit pointing at `cs_old`. */
function openDeposit(over: Row = {}): Row {
  return {
    id: DEPOSIT,
    quote_id: V1,
    customer_id: CUSTOMER,
    kind: "deposit",
    amount_cents: 30000,
    currency: "usd",
    status: "due",
    provider: "stripe",
    provider_ref: null,
    provider_session_id: "cs_old",
    created_at: "2026-11-01T00:00:01.000Z",
    paid_at: null,
    created_by: CUSTOMER,
    ...over,
  };
}

const deposit = () => db.tables.catering_payments!.find((p) => p.id === DEPOSIT)!;
const quoteById = (id: string) => db.tables.catering_quotes!.find((q) => q.id === id)!;
const stripeDown = () => retireMock.mockRejectedValue(new StripeError(502, "network_error", "socket hang up"));

/** The customer finishes the OLD checkout: Stripe captured `amount`. */
const oldCheckoutPaid = (amount: number) => ({
  id: "evt_paid",
  type: "checkout.session.completed",
  livemode: false,
  data: {
    object: {
      id: "cs_old",
      payment_status: "paid",
      payment_intent: "pi_old",
      amount_total: amount,
      metadata: { quote_id: V1, payment_id: DEPOSIT, kind: "deposit" },
    },
  },
});

/** `charge.refunded` exactly as Stripe sends it: the charge's own amount, total refunded, and flag. */
const refunded = (charge: { amount: number; amount_refunded: number; refunded: boolean }, id = "evt_refund") => ({
  id,
  type: "charge.refunded",
  livemode: false,
  data: { object: { id: "ch_old", payment_intent: "pi_old", metadata: {}, ...charge } },
});

async function refusal(p: Promise<unknown>): Promise<PortalQuoteError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PortalQuoteError) return e;
    throw e;
  }
  throw new Error("expected a PortalQuoteError, but the call succeeded");
}

beforeEach(() => {
  auditMock.mockClear();
  notifyPaid.mockClear();
  retireMock.mockReset();
  retireMock.mockResolvedValue("expired");
  createSessionMock.mockReset();
  db = paymentsFake({
    catering_quotes: [v1()],
    catering_quote_items: [],
    catering_pricing_rules: [
      { location_id: LOCATION, active: true, tax_rate_bps: 0, gratuity_bps: 0, service_charge_bps: 0, deposit_pct_bps: 2500, tax_on_delivery: true, tax_on_gratuity: false },
    ],
    catering_delivery_zones: [],
    catering_payments: [openDeposit()],
    locations: [{ id: LOCATION, code: "EM" }],
    stripe_events: [],
  });
});

describe("W02 review r1 — revise → late payment at the OLD price → partial refund", () => {
  it("the whole sequence: $300 captured, $200 refunded ⇒ the payment is still PAID and the order cannot be charged again", async () => {
    // 2. The revise, with Stripe unreachable: `cs_old` is still open at $300.
    stripeDown();
    const v2 = await reviseQuote(owner, V1, CHEAPER);
    expect(quoteById(v2.id)).toMatchObject({ deposit_cents: 20000, total_cents: 80000 });
    // The intent followed the quote — but its amount is what its OPEN checkout will charge.
    expect(deposit()).toMatchObject({ quote_id: v2.id, status: "due", amount_cents: 30000, provider_session_id: "cs_old" });

    // 3. The team sends v2; the customer pays the checkout they already had open.
    quoteById(v2.id).status = "sent";
    const paid = await processStripeEvent(db.client, oldCheckoutPaid(30000), SINGLE, { notifyPaid });

    // The row says what was captured…
    expect(deposit()).toMatchObject({ status: "paid", amount_cents: 30000, provider_ref: "pi_old" });
    // …and that it is not what this revision asks for: a person is told.
    expect(paid.result).toBe("paid_needs_review");
    expect(notifyPaid).toHaveBeenCalledWith(expect.objectContaining({ paymentId: DEPOSIT, amountCents: 30000, reviewReasons: ["amount_not_current"] }));

    // 4. Staff refund $200 of the $300.
    const out = await processStripeEvent(db.client, refunded({ amount: 30000, amount_refunded: 20000, refunded: false }), SINGLE, { notifyPaid });

    expect(out.result).toBe("partially_refunded");
    expect(deposit().status).toBe("paid");
    // $100 is still captured, so the portal must not take a second deposit.
    expect((await refusal(initiatePayment(CUSTOMER, v2.id, "deposit"))).code).toBe("already_paid");
    expect(db.tables.catering_payments).toHaveLength(1);
  });

  it("refunding the REST of the charge is what moves the row to `refunded`", async () => {
    stripeDown();
    const v2 = await reviseQuote(owner, V1, CHEAPER);
    quoteById(v2.id).status = "sent";
    await processStripeEvent(db.client, oldCheckoutPaid(30000), SINGLE, { notifyPaid });
    await processStripeEvent(db.client, refunded({ amount: 30000, amount_refunded: 20000, refunded: false }), SINGLE, { notifyPaid });

    const out = await processStripeEvent(db.client, refunded({ amount: 30000, amount_refunded: 30000, refunded: true }, "evt_refund_2"), SINGLE, { notifyPaid });

    expect(out.result).toBe("refunded");
    expect(deposit().status).toBe("refunded");
  });
});

describe("W02 review r1 — an intent with an OPEN checkout is never re-priced", () => {
  it("the pay tap on the revision retires the old checkout FIRST, and only then re-prices the intent", async () => {
    stripeDown();
    const v2 = await reviseQuote(owner, V1, CHEAPER);
    quoteById(v2.id).status = "sent";
    expect(deposit()).toMatchObject({ amount_cents: 30000, provider_session_id: "cs_old" });

    // Stripe is back. The customer taps "pay deposit" on the revision.
    const order: string[] = [];
    retireMock.mockReset();
    retireMock.mockImplementation(async (_key, id) => {
      order.push(`retire:${id}@${deposit().amount_cents}`);
      return "expired";
    });

    const out = await initiatePayment(CUSTOMER, v2.id, "deposit");

    // Retired with the SHOP's key while the row still said $300 — never the other way round.
    expect(retireMock).toHaveBeenCalledWith("sk_shop", "cs_old");
    expect(order).toEqual(["retire:cs_old@30000"]);
    expect(out).toMatchObject({ paymentId: DEPOSIT, amountCents: 20000 });
    expect(deposit()).toMatchObject({ status: "due", amount_cents: 20000, provider_session_id: null });
  });

  it("if the old checkout STILL cannot be retired, the tap fails closed: 502, and the row keeps the amount its checkout charges", async () => {
    stripeDown();
    const v2 = await reviseQuote(owner, V1, CHEAPER);
    quoteById(v2.id).status = "sent";

    const err = await refusal(initiatePayment(CUSTOMER, v2.id, "deposit"));

    expect(err.status).toBe(502);
    expect(err.code).toBe("provider_error");
    expect(deposit()).toMatchObject({ status: "due", amount_cents: 30000, provider_session_id: "cs_old" });
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("if the old checkout turns out to be COMPLETE, nothing is re-priced: 409 payment_in_progress", async () => {
    stripeDown();
    const v2 = await reviseQuote(owner, V1, CHEAPER);
    quoteById(v2.id).status = "sent";
    retireMock.mockReset();
    retireMock.mockResolvedValue("complete");

    const err = await refusal(initiatePayment(CUSTOMER, v2.id, "deposit"));

    expect(err.code).toBe("payment_in_progress");
    expect(deposit()).toMatchObject({ amount_cents: 30000, provider_session_id: "cs_old" });
  });

  it("a revise that DOES retire the checkout re-prices the intent as before", async () => {
    const v2 = await reviseQuote(owner, V1, CHEAPER);

    expect(retireMock).toHaveBeenCalledWith("sk_shop", "cs_old");
    expect(deposit()).toMatchObject({ quote_id: v2.id, status: "due", amount_cents: 20000, provider_session_id: null });
  });

  it("createPaymentDue's idempotent path leaves an intent with an open checkout at its amount", async () => {
    // (quote, kind) already has a due intent — at $300, with `cs_old` open. Asking for $200
    // returns that intent; it is re-priced when its checkout is retired, not before.
    const out = await createPaymentDue(db.client, { quoteId: V1, customerId: CUSTOMER, kind: "deposit", amountCents: 20000, createdBy: CUSTOMER });

    expect(out.id).toBe(DEPOSIT);
    expect(deposit()).toMatchObject({ amount_cents: 30000, provider_session_id: "cs_old" });
  });
});

describe("W02 review r1 — `fully refunded` is read from the CHARGE, never from the row", () => {
  // The row's amount can be anything a person or an old bug left there; the charge is the money.
  const paidRow = (amountOnRow: number) => openDeposit({ status: "paid", amount_cents: amountOnRow, provider_ref: "pi_old", paid_at: "2026-11-02T00:00:00.000Z" });

  it("a refund that covers the ROW's amount but not the CHARGE's is partial", async () => {
    db.tables.catering_payments = [paidRow(20000)];

    const out = await processStripeEvent(db.client, refunded({ amount: 30000, amount_refunded: 20000, refunded: false }), SINGLE, { notifyPaid });

    expect(out.result).toBe("partially_refunded");
    expect(deposit().status).toBe("paid");
  });

  it("…also when the payload carries no `refunded` flag: amount_refunded is weighed against the charge's amount", async () => {
    db.tables.catering_payments = [paidRow(20000)];
    const event = refunded({ amount: 30000, amount_refunded: 20000, refunded: false });
    delete (event.data.object as Record<string, unknown>).refunded;

    expect((await processStripeEvent(db.client, event, SINGLE, { notifyPaid })).result).toBe("partially_refunded");
    expect(deposit().status).toBe("paid");
  });

  it("a refund of the whole CHARGE is full even when the row's amount is higher", async () => {
    db.tables.catering_payments = [paidRow(30000)];
    const event = refunded({ amount: 20000, amount_refunded: 20000, refunded: true });
    delete (event.data.object as Record<string, unknown>).refunded;

    expect((await processStripeEvent(db.client, event, SINGLE, { notifyPaid })).result).toBe("refunded");
    expect(deposit().status).toBe("refunded");
  });

  it("Stripe's own `refunded: false` wins over any arithmetic", async () => {
    db.tables.catering_payments = [paidRow(20000)];

    const out = await processStripeEvent(db.client, refunded({ amount: 20000, amount_refunded: 20000, refunded: false }), SINGLE, { notifyPaid });

    expect(out.result).toBe("partially_refunded");
    expect(deposit().status).toBe("paid");
  });
});
