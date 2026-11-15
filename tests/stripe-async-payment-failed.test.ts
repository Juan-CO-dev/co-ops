/**
 * Unit spine — A DELAYED PAYMENT THAT FAILED FREES ITS INTENT (audit wave W02, review r5 P2:
 * "failed asynchronous payments permanently block another attempt").
 *
 * Checkout is minted with no `payment_method_types`, so it offers whatever the Stripe
 * account has switched on — bank debits included. Stripe (docs.stripe.com/checkout/
 * fulfillment): "Some payment methods aren't instant, such as ACH direct debit and other
 * bank transfers. This means, funds won't be immediately available when Checkout
 * completes." The session is then `complete` with `payment_status: unpaid`, and the answer
 * arrives later as `checkout.session.async_payment_succeeded` ("Occurs when a payment intent
 * using a delayed payment method finally succeeds.") or `checkout.session.
 * async_payment_failed` ("Occurs when a payment intent using a delayed payment method
 * fails." — docs.stripe.com/api/events/types).
 *
 * While the money is pending, refusing a second checkout is RIGHT (409
 * `payment_in_progress`). But the failure event changed nothing: the dead session stayed on
 * the due row, a `complete` session can never be expired, and so every later pay tap — the
 * same option or the other one — was refused for good.
 *
 * What is pinned here:
 *   - FAILURE → RETRY. The failure event clears the failed session from its intent; the
 *     next tap mints a fresh checkout. The intent's status and amount are never written.
 *   - A STALE FAILURE NEVER CLEARS A NEWER CHECKOUT. The clear is guarded on the exact
 *     session the event names: a late or repeated failure for the OLD session leaves the
 *     new one alone.
 *   - PENDING IS STILL IN PROGRESS. Until Stripe says it failed, nothing new is offered.
 *   - A `paid` row's id is history; another shop's endpoint cannot clear this shop's row.
 *   - THE FAILED ATTEMPT IS RECORDED (`catering.payment.provider_payment_failed`).
 *
 * The real `initiatePayment` + `createQuoteCheckout` and the real webhook processor, against
 * tests/payments-fake-client.ts and tests/stripe-fake.ts. No DB, no network, no real Stripe.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";
import { stripeFake, type StripeFake } from "./stripe-fake";

let db: PaymentsFake;
let stripe: StripeFake;

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
import { createQuoteCheckout, initiatePayment, PortalQuoteError } from "@/lib/portal/quotes";
import * as stripeClient from "@/lib/stripe/client";
import { processStripeEvent, type StripeWebhookContext } from "@/lib/stripe/webhook";

const auditMock = vi.mocked(audit);
const createSessionMock = vi.mocked(stripeClient.createCheckoutSession);
const retireMock = vi.mocked(stripeClient.retireCheckoutSession);
const retrieveMock = vi.mocked(stripeClient.retrieveCheckoutSession);

const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const QUOTE = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const OTHER_LOCATION = "b0000000-0000-4000-8000-000000000002";

const SINGLE: StripeWebhookContext = { locationId: null, locationCode: null };
const notifyPaid = vi.fn(async (_args: unknown) => {});
const deps = { notifyPaid, retireSession: (id: string) => stripe.retire("sk_shop", id) };

function quoteRow(over: Row = {}): Row {
  return {
    id: QUOTE,
    root_id: null,
    customer_id: CUSTOMER,
    location_id: LOCATION,
    origin: "staff",
    status: "sent",
    superseded_at: null,
    event_date: "2099-06-01", // far enough out that a staff quote offers deposit OR full
    expires_at: "2099-01-01T00:00:00.000Z",
    deposit_cents: 20000,
    total_cents: 100000,
    pipeline_id: null,
    ...over,
  };
}

const payments = () => db.tables.catering_payments!;
const intent = (kind: string) => payments().find((p) => p.kind === kind)!;
const failedAudits = () =>
  auditMock.mock.calls.map((c) => c[0]).filter((a) => a.action === "catering.payment.provider_payment_failed");

/** The pay route's two steps, exactly as app/api/portal/quote/[id]/pay/route.ts runs them. */
async function tapPay(kind: "deposit" | "full"): Promise<string> {
  const raised = await initiatePayment(CUSTOMER, QUOTE, kind);
  const checkout = await createQuoteCheckout({
    customerId: CUSTOMER,
    customerEmail: "customer@example.com",
    quoteId: QUOTE,
    kind,
    paymentId: raised.paymentId,
    amountCents: raised.amountCents,
    appOrigin: "https://portal.example.com",
  });
  return checkout.url;
}

async function refusal(p: Promise<unknown>): Promise<PortalQuoteError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PortalQuoteError) return e;
    throw e;
  }
  throw new Error("expected a PortalQuoteError, but the call succeeded");
}

/** A Checkout Session event for one of our intents, as Stripe sends it. */
function sessionEvent(type: string, sessionId: string, kind: "deposit" | "full", eventId: string, paymentStatus = "unpaid") {
  const p = intent(kind);
  return {
    id: eventId,
    type,
    livemode: false,
    data: {
      object: {
        id: sessionId,
        payment_status: paymentStatus,
        payment_intent: `pi_${sessionId}`,
        amount_total: p.amount_cents,
        metadata: { quote_id: QUOTE, payment_id: p.id, kind },
      },
    },
  };
}
const asyncFailed = (sessionId: string, kind: "deposit" | "full" = "deposit", eventId = `evt_failed_${sessionId}`) =>
  sessionEvent("checkout.session.async_payment_failed", sessionId, kind, eventId);

/** The customer opens the deposit checkout and pays it by bank debit: the session is
 *  `complete`, the money is PENDING. Returns that session's id. */
async function payDepositByBankDebit(): Promise<string> {
  const url = await tapPay("deposit");
  const session = stripe.byUrl(url)!;
  stripe.complete(session.id);
  return session.id;
}

beforeEach(() => {
  auditMock.mockClear();
  notifyPaid.mockClear();
  stripe = stripeFake();
  createSessionMock.mockReset();
  createSessionMock.mockImplementation(stripe.create);
  retireMock.mockReset();
  retireMock.mockImplementation(stripe.retire);
  retrieveMock.mockReset();
  retrieveMock.mockImplementation(stripe.retrieve);
  db = paymentsFake({
    catering_quotes: [quoteRow()],
    locations: [{ id: LOCATION, code: "EM" }],
    catering_payments: [],
    stripe_events: [],
  });
});

describe("W02 review r5 — while a delayed payment is PENDING, nothing new is offered", () => {
  it("the same option and the other option are both refused `payment_in_progress`, and the completed-but-unpaid event writes nothing", async () => {
    const pending = await payDepositByBankDebit();

    const completedUnpaid = await processStripeEvent(db.client, sessionEvent("checkout.session.completed", pending, "deposit", "evt_completed"), SINGLE, deps);
    expect(completedUnpaid.result).toBe("ignored");
    expect(intent("deposit")).toMatchObject({ status: "due", provider_session_id: pending });

    expect(await refusal(tapPay("deposit"))).toMatchObject({ status: 409, code: "payment_in_progress" });
    expect(await refusal(tapPay("full"))).toMatchObject({ status: 409, code: "payment_in_progress" });
    expect(stripe.creates).toHaveLength(1);
  });
});

describe("W02 review r5 — failure → retry", () => {
  it("the failure event clears the failed session from its intent, and the next tap mints a fresh checkout", async () => {
    const failedSession = await payDepositByBankDebit();

    const out = await processStripeEvent(db.client, asyncFailed(failedSession), SINGLE, deps);

    expect(out.result).toBe("async_failed");
    // The intent is still owed, at its amount, and is no longer tied to the dead session.
    expect(intent("deposit")).toMatchObject({ status: "due", amount_cents: 20000, provider_session_id: null });
    expect(notifyPaid).not.toHaveBeenCalled();

    // The bug: 409 `payment_in_progress`, for good.
    const retry = await tapPay("deposit");

    const fresh = stripe.byUrl(retry)!;
    expect(fresh.id).not.toBe(failedSession);
    expect(fresh).toMatchObject({ status: "open", amountCents: 20000, quoteId: QUOTE });
    expect(intent("deposit")).toMatchObject({ status: "due", provider_session_id: fresh.id });
    expect(payments()).toHaveLength(1);
  });

  it("…and the OTHER option is payable again too (it was refused while the failed session sat on the deposit)", async () => {
    const failedSession = await payDepositByBankDebit();
    await processStripeEvent(db.client, asyncFailed(failedSession), SINGLE, deps);

    const url = await tapPay("full");

    expect(stripe.byUrl(url)).toMatchObject({ status: "open", amountCents: 100000 });
    expect(intent("full").provider_session_id).toBe(stripe.byUrl(url)!.id);
    expect(intent("deposit").provider_session_id ?? null).toBeNull();
  });

  it("the failed attempt is RECORDED: an audit row naming the intent, the session, and that it was released", async () => {
    const failedSession = await payDepositByBankDebit();
    auditMock.mockClear();

    await processStripeEvent(db.client, asyncFailed(failedSession), SINGLE, deps);

    expect(failedAudits()).toHaveLength(1);
    expect(failedAudits()[0]).toMatchObject({
      actorId: null,
      resourceTable: "catering_payments",
      resourceId: intent("deposit").id,
      metadata: {
        actor_context: "stripe_webhook",
        quote_id: QUOTE,
        kind: "deposit",
        amount_cents: 20000,
        row_status: "due",
        session_id: failedSession,
        session_cleared: true,
        stripe_event_id: `evt_failed_${failedSession}`,
        location_id: LOCATION,
      },
    });
    expect(db.tables.stripe_events!.find((e) => e.id === `evt_failed_${failedSession}`)).toMatchObject({ outcome: "async_failed" });
  });

  it("a VOIDED intent's failed session is released the same way (it was an unresolved checkout blocking the order)", async () => {
    const failedSession = await payDepositByBankDebit();
    intent("deposit").status = "void"; // closed on our books while the debit was pending

    await processStripeEvent(db.client, asyncFailed(failedSession), SINGLE, deps);

    expect(intent("deposit")).toMatchObject({ status: "void", provider_session_id: null });
    // Nothing unresolved is left on the order: the full amount can be collected.
    expect(stripe.byUrl(await tapPay("full"))).toMatchObject({ status: "open", amountCents: 100000 });
  });
});

describe("W02 review r5 — a stale failure never clears a NEWER checkout", () => {
  it("a second failure event for the OLD session, after the customer has a new checkout: the new session stays on the row", async () => {
    const failedSession = await payDepositByBankDebit();
    await processStripeEvent(db.client, asyncFailed(failedSession), SINGLE, deps);
    const retryUrl = await tapPay("deposit");
    const newSession = stripe.byUrl(retryUrl)!.id;
    auditMock.mockClear();

    // The same failure reaches us again under another event id (or simply late).
    const out = await processStripeEvent(db.client, asyncFailed(failedSession, "deposit", "evt_failed_again"), SINGLE, deps);

    expect(out.result).toBe("async_failed");
    expect(intent("deposit")).toMatchObject({ status: "due", provider_session_id: newSession });
    // Recorded as what it was: about a session the row no longer names.
    expect(failedAudits()[0]!.metadata).toMatchObject({ session_id: failedSession, session_cleared: false });
    // The customer's open checkout is untouched: a second tap hands the SAME one back.
    expect(await tapPay("deposit")).toBe(retryUrl);
    expect(stripe.byUrl(retryUrl)!.status).toBe("open");
  });

  it("a REDELIVERY of the processed failure event is a ledger duplicate and touches nothing", async () => {
    const failedSession = await payDepositByBankDebit();
    await processStripeEvent(db.client, asyncFailed(failedSession), SINGLE, deps);
    const newSession = stripe.byUrl(await tapPay("deposit"))!.id;
    auditMock.mockClear();

    const out = await processStripeEvent(db.client, asyncFailed(failedSession), SINGLE, deps);

    expect(out.result).toBe("duplicate");
    expect(intent("deposit").provider_session_id).toBe(newSession);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("a failure event that names NO session clears nothing", async () => {
    const failedSession = await payDepositByBankDebit();
    const event = asyncFailed(failedSession);
    delete (event.data.object as Record<string, unknown>).id;

    const out = await processStripeEvent(db.client, event, SINGLE, deps);

    expect(out.result).toBe("async_failed");
    expect(intent("deposit").provider_session_id).toBe(failedSession);
    expect(failedAudits()[0]!.metadata).toMatchObject({ session_id: null, session_cleared: false });
  });
});

describe("W02 review r5 — what a failure event must NOT touch", () => {
  it("a PAID row's session id is history: a failure event for it clears nothing", async () => {
    const session = await payDepositByBankDebit();
    Object.assign(intent("deposit"), { status: "paid", provider_ref: `pi_${session}` });

    const out = await processStripeEvent(db.client, asyncFailed(session), SINGLE, deps);

    expect(out.result).toBe("async_failed");
    expect(intent("deposit")).toMatchObject({ status: "paid", provider_session_id: session });
    expect(failedAudits()[0]!.metadata).toMatchObject({ row_status: "paid", session_cleared: false });
  });

  it("PER-LOCATION: another shop's endpoint cannot release this shop's intent", async () => {
    const session = await payDepositByBankDebit();
    auditMock.mockClear();

    const out = await processStripeEvent(db.client, asyncFailed(session), { locationId: OTHER_LOCATION, locationCode: "MEP" }, deps);

    expect(out.result).toBe("location_mismatch");
    expect(intent("deposit").provider_session_id).toBe(session);
    expect(failedAudits()).toEqual([]);
  });

  it("a clear that FAILS is `processing_failed` (500, Stripe redelivers) and the redelivery releases the intent", async () => {
    const session = await payDepositByBankDebit();
    db.beforeOp = (op) => {
      if (op.table === "catering_payments" && op.kind === "update") {
        db.beforeOp = null;
        db.failUpdate.push("catering_payments");
      }
    };

    const first = await processStripeEvent(db.client, asyncFailed(session), SINGLE, deps);
    expect(first.result).toBe("processing_failed");
    expect(intent("deposit").provider_session_id).toBe(session);

    const again = await processStripeEvent(db.client, asyncFailed(session), SINGLE, deps);
    expect(again.result).toBe("async_failed");
    expect(intent("deposit")).toMatchObject({ status: "due", provider_session_id: null });
  });
});

describe("W02 review r5 — if a 'failed' session is ever paid after all, the money is still recorded", () => {
  // The Stripe pages quoted above do not say whether a `complete` session can be paid after
  // its delayed payment failed (UNVERIFIED). Nothing depends on it: the row is found by
  // `metadata.payment_id`, not by the cleared session id.
  it("a success for the released session flips the intent to paid, and closes the NEWER checkout the customer was given", async () => {
    const failedSession = await payDepositByBankDebit();
    await processStripeEvent(db.client, asyncFailed(failedSession), SINGLE, deps);
    const retryUrl = await tapPay("deposit");

    const out = await processStripeEvent(
      db.client,
      sessionEvent("checkout.session.async_payment_succeeded", failedSession, "deposit", "evt_late_success"),
      SINGLE,
      deps,
    );

    expect(out.result).toBe("paid");
    expect(intent("deposit")).toMatchObject({ status: "paid", provider_ref: `pi_${failedSession}`, provider_session_id: null });
    // The checkout opened after the failure is a second way to pay the same money: closed.
    expect(stripe.byUrl(retryUrl)!.status).toBe("expired");
  });
});
