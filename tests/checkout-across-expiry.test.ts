/**
 * Unit spine — a checkout OPENED before an offer expires and COMPLETED after it (audit wave
 * W02, review r2's P2 "An existing checkout bypasses clock expiry without a review flag").
 *
 * B037 closed the pay gate on the clock: an offer past its `expires_at` cannot raise an
 * intent or mint a session. But a session minted five minutes BEFORE the date stayed
 * payable for Stripe's default 24 hours, the gate is never asked again, and the webhook
 * recorded the late payment as an ordinary one — after which the staff accept treated
 * "there is a paid row" as proof the offer had been taken up in time.
 *
 * THE RULES PINNED HERE:
 *   1. THE SESSION DOES NOT OUTLIVE THE OFFER. `createQuoteCheckout` sets the session's
 *      `expires_at` to the offer's own deadline — inside the range Stripe allows:
 *      "It can be anywhere from 30 minutes to 24 hours after Checkout Session creation.
 *      By default, this value is 24 hours from creation."
 *      (docs.stripe.com/api/checkout/sessions/create, `expires_at`.) An offer with less
 *      than that minimum left still gets a checkout, at the minimum — and rule 2 covers the
 *      overhang.
 *   2. MONEY RECEIVED IS ALWAYS RECORDED, AND A LATE SETTLEMENT SAYS SO. A payment whose
 *      settlement time (the Stripe event's `created`) is after the offer's deadline is
 *      marked paid AND flagged `paid_after_expiry` → `paid_needs_review`, in the audit row
 *      and the staff email. The row's `paid_at` is that settlement time, not the moment a
 *      retried webhook happened to be processed.
 *   3. ONLY A PAYMENT SETTLED IN TIME TAKES AN EXPIRED OFFER UP. The staff accept counts a
 *      paid row only when its `paid_at` is not after the offer's `expires_at`; a late one
 *      leaves the offer expired, so a person has to look (and revise) before confirming.
 *
 * Real `initiatePayment` + `createQuoteCheckout` + `processStripeEvent` + `setQuoteStatus`
 * against tests/payments-fake-client.ts and tests/stripe-fake.ts; only `Date` is faked.
 * No DB, no network, no Stripe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { sendEmail } from "@/lib/email";
import { CateringQuoteError, setQuoteStatus } from "@/lib/catering/quotes";
import { offerTakenUpInTime } from "@/lib/portal/payability-shared";
import { createQuoteCheckout, initiatePayment } from "@/lib/portal/quotes";
import type { AuthContext } from "@/lib/session";
import * as stripeClient from "@/lib/stripe/client";
import {
  checkoutSessionExpiry,
  checkoutSessionParams,
  encodeForm,
  parseCheckoutEvent,
  STRIPE_SESSION_MAX_TTL_SEC,
  STRIPE_SESSION_MIN_TTL_SEC,
} from "@/lib/stripe/shared";
import { notifyPaymentPaid, processStripeEvent, type StripeWebhookContext } from "@/lib/stripe/webhook";

const auditMock = vi.mocked(audit);
const sendEmailMock = vi.mocked(sendEmail);
const createSessionMock = vi.mocked(stripeClient.createCheckoutSession);
const retireMock = vi.mocked(stripeClient.retireCheckoutSession);
const retrieveMock = vi.mocked(stripeClient.retrieveCheckoutSession);

const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const QUOTE = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const SINGLE: StripeWebhookContext = { locationId: null, locationCode: null };
const owner = { user: { id: "u1", role: "owner" }, locations: [LOCATION] } as unknown as AuthContext;

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse("2026-11-20T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const sec = (ms: number) => Math.floor(ms / 1000);

function quoteRow(over: Row = {}): Row {
  return {
    id: QUOTE,
    root_id: null,
    customer_id: CUSTOMER,
    location_id: LOCATION,
    origin: "staff",
    status: "sent",
    superseded_at: null,
    pipeline_id: null,
    event_date: "2099-06-01",
    expires_at: iso(T0 + 2 * HOUR),
    deposit_cents: 20000,
    total_cents: 100000,
    ...over,
  };
}

const quote = () => db.tables.catering_quotes![0]!;
const payments = () => db.tables.catering_payments!;
const notifyPaid = vi.fn(async () => {});

async function tapPay(kind: "deposit" | "full" = "deposit"): Promise<string> {
  const intent = await initiatePayment(CUSTOMER, QUOTE, kind);
  const checkout = await createQuoteCheckout({
    customerId: CUSTOMER,
    customerEmail: "customer@example.com",
    quoteId: QUOTE,
    kind,
    paymentId: intent.paymentId,
    amountCents: intent.amountCents,
    appOrigin: "https://portal.example.com",
  });
  return checkout.url;
}

/** The `expires_at` our code asked Stripe for on the last mint (undefined = Stripe's default). */
const lastRequestedExpiry = () => createSessionMock.mock.calls.at(-1)![1].expiresAtSec;

/** `checkout.session.completed` (paid) for the session behind `url`, created at `atMs`. */
function completedEvent(url: string, atMs: number, eventId = "evt_1") {
  const s = stripe.byUrl(url)!;
  stripe.complete(s.id);
  return {
    id: eventId,
    type: "checkout.session.completed",
    created: sec(atMs),
    livemode: false,
    data: {
      object: {
        id: s.id,
        payment_status: "paid",
        payment_intent: "pi_1",
        amount_total: s.amountCents,
        metadata: { quote_id: s.quoteId, payment_id: s.paymentId, kind: "deposit" },
      },
    },
  };
}

const lastAuditMeta = (action: string) =>
  auditMock.mock.calls.filter((c) => c[0].action === action).at(-1)![0].metadata as Record<string, unknown>;

async function acceptRefusal(): Promise<CateringQuoteError> {
  try {
    await setQuoteStatus(owner, QUOTE, "accepted");
  } catch (e) {
    if (e instanceof CateringQuoteError) return e;
    throw e;
  }
  throw new Error("expected the accept to be refused, but it succeeded");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  auditMock.mockClear();
  sendEmailMock.mockClear();
  notifyPaid.mockClear();
  stripe = stripeFake();
  createSessionMock.mockReset();
  createSessionMock.mockImplementation(stripe.create);
  retireMock.mockReset();
  retireMock.mockImplementation(stripe.retire);
  retrieveMock.mockReset();
  retrieveMock.mockImplementation(stripe.retrieve);
  db = paymentsFake({
    stripe_events: [],
    catering_quotes: [quoteRow()],
    locations: [{ id: LOCATION, code: "EM" }],
    catering_payments: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("W02 review r2 (P2) — the pure rule for a session's expiry", () => {
  const now = sec(T0);

  it("Stripe's range is 30 minutes to 24 hours after creation", () => {
    expect(STRIPE_SESSION_MIN_TTL_SEC).toBe(30 * 60);
    expect(STRIPE_SESSION_MAX_TTL_SEC).toBe(24 * 60 * 60);
  });

  it("no deadline, or one beyond Stripe's own 24 hours: nothing is sent (the default already ends inside the offer)", () => {
    expect(checkoutSessionExpiry(now, null)).toBeUndefined();
    expect(checkoutSessionExpiry(now, now + 25 * 3600)).toBeUndefined();
    expect(checkoutSessionExpiry(now, now + STRIPE_SESSION_MAX_TTL_SEC)).toBeUndefined();
  });

  it("a deadline inside the range IS the session's expiry", () => {
    expect(checkoutSessionExpiry(now, now + 2 * 3600)).toBe(now + 2 * 3600);
    expect(checkoutSessionExpiry(now, now + 23 * 3600 + 59 * 60)).toBe(now + 23 * 3600 + 59 * 60);
  });

  it("a deadline sooner than Stripe's minimum gets the minimum, with a margin for clock skew — never a value Stripe would refuse", () => {
    const floor = checkoutSessionExpiry(now, now + 10 * 60)!;
    expect(floor).toBeGreaterThan(now + STRIPE_SESSION_MIN_TTL_SEC);
    expect(floor).toBeLessThanOrEqual(now + STRIPE_SESSION_MIN_TTL_SEC + 120);
    // …and a deadline already behind us is treated the same way (the gate refuses those first).
    expect(checkoutSessionExpiry(now, now - 60)).toBe(floor);
  });

  it("it rides to Stripe as `expires_at`, and is absent from the request when undefined", () => {
    const base = {
      quoteId: QUOTE, paymentId: "p", kind: "deposit" as const, amountCents: 20000, currency: "usd",
      productName: "n", description: "d", customerEmail: "c@example.com", successUrl: "https://x/s", cancelUrl: "https://x/c",
    };
    expect(checkoutSessionParams({ ...base, expiresAtSec: now + 3600 }).expires_at).toBe(now + 3600);
    expect(encodeForm(checkoutSessionParams({ ...base, expiresAtSec: now + 3600 }))).toContain(`expires_at=${now + 3600}`);
    expect(encodeForm(checkoutSessionParams(base))).not.toContain("expires_at");
  });

  it("an event's own `created` time is read as its settlement time", () => {
    expect(parseCheckoutEvent({ id: "evt", type: "checkout.session.completed", created: now, data: { object: { id: "cs_1", payment_status: "paid" } } }).createdSec).toBe(now);
    expect(parseCheckoutEvent({ id: "evt", type: "checkout.session.completed", created: "soon", data: { object: { id: "cs_1" } } }).createdSec).toBeUndefined();
  });
});

describe("W02 review r2 (P2) — a Checkout Session does not outlive the offer it pays", () => {
  it("a SENT quote expiring in two hours: the session expires when the offer does", async () => {
    await tapPay();
    expect(lastRequestedExpiry()).toBe(sec(T0 + 2 * HOUR));
  });

  it("a self-serve SUBMITTED order is on the same clock", async () => {
    Object.assign(quote(), { origin: "self_serve", status: "submitted", expires_at: iso(T0 + 90 * MIN) });
    await tapPay();
    expect(lastRequestedExpiry()).toBe(sec(T0 + 90 * MIN));
  });

  it("an offer further out than a day keeps Stripe's default 24 hours — already inside the window", async () => {
    quote().expires_at = iso(T0 + 72 * HOUR);
    await tapPay();
    expect(lastRequestedExpiry()).toBeUndefined();
  });

  it("a team-CONFIRMED order is not on the offer's clock: no expiry is imposed", async () => {
    Object.assign(quote(), { status: "accepted", expires_at: iso(T0 + 2 * HOUR) });
    await tapPay();
    expect(lastRequestedExpiry()).toBeUndefined();
  });

  it("an offer with LESS than Stripe's 30-minute minimum left still gets a checkout, at the minimum", async () => {
    quote().expires_at = iso(T0 + 10 * MIN);
    await tapPay();
    const asked = lastRequestedExpiry()!;
    expect(asked).toBeGreaterThan(sec(T0) + STRIPE_SESSION_MIN_TTL_SEC);
    expect(asked).toBeLessThanOrEqual(sec(T0) + STRIPE_SESSION_MIN_TTL_SEC + 120);
  });

  it("a second tap hands back the SAME bounded checkout", async () => {
    const first = await tapPay();
    vi.setSystemTime(T0 + 30 * MIN);
    expect(await tapPay()).toBe(first);
    expect(stripe.creates).toHaveLength(1);
  });

  it("an open checkout that would OUTLIVE the offer (minted before this rule) is not handed back: it is retired and replaced", async () => {
    await initiatePayment(CUSTOMER, QUOTE, "deposit");
    const row = payments()[0]!;
    // A session minted the old way: Stripe's default 24 hours, well past the offer's two.
    const old = await stripe.create("sk_shop", {
      quoteId: QUOTE, paymentId: row.id as string, kind: "deposit", amountCents: 20000, currency: "usd",
      productName: "x", description: "x", customerEmail: "customer@example.com", successUrl: "https://x/s", cancelUrl: "https://x/c",
    }, "old-key");
    stripe.sessions.get(old.id)!.expiresAtSec = sec(T0 + 24 * HOUR);
    row.provider_session_id = old.id;

    const url = await tapPay();

    expect(stripe.sessions.get(old.id)!.status).toBe("expired");
    expect(stripe.byUrl(url)!.id).not.toBe(old.id);
    expect(stripe.byUrl(url)!.expiresAtSec).toBe(sec(T0 + 2 * HOUR));
  });
});

describe("W02 review r2 (P2) — opened before expiry, COMPLETED after it", () => {
  beforeEach(() => {
    // Twenty minutes left on the offer: Stripe's minimum makes the session outlive it.
    quote().expires_at = iso(T0 + 20 * MIN);
  });

  it("the money is recorded as paid AND flagged for review, with the settlement time on the row", async () => {
    const url = await tapPay(); // inside the window: the gate lets it through
    const paidAt = T0 + 25 * MIN; // the customer finishes five minutes after the offer lapsed
    vi.setSystemTime(paidAt + 5_000);

    const out = await processStripeEvent(db.client, completedEvent(url, paidAt), SINGLE, { notifyPaid });

    expect(out.result).toBe("paid_needs_review");
    expect(payments()[0]).toMatchObject({ status: "paid", provider_ref: "pi_1", paid_at: iso(paidAt) });
    expect(db.tables.stripe_events![0]!.outcome).toBe("paid_needs_review");
    const meta = lastAuditMeta("catering.payment.provider_paid");
    expect(meta.needs_review).toEqual(["paid_after_expiry"]);
    expect(meta).toMatchObject({ settled_at: iso(paidAt), offer_expires_at: iso(T0 + 20 * MIN) });
    expect(notifyPaid).toHaveBeenCalledWith(expect.objectContaining({ reviewReasons: ["paid_after_expiry"] }));
  });

  it("…and that late payment does NOT take the expired offer up: the accept is refused until someone revises it", async () => {
    const url = await tapPay();
    const paidAt = T0 + 25 * MIN;
    vi.setSystemTime(paidAt + 5_000);
    await processStripeEvent(db.client, completedEvent(url, paidAt), SINGLE, { notifyPaid });

    const err = await acceptRefusal();

    expect(err.status).toBe(409);
    expect(err.code).toBe("quote_expired");
    expect(quote().status).toBe("sent");
  });

  it("a payment SETTLED in time is an ordinary payment, however late its webhook is delivered", async () => {
    const url = await tapPay();
    const paidAt = T0 + 10 * MIN; // inside the window
    vi.setSystemTime(T0 + 3 * HOUR); // …but Stripe's delivery reaches us hours after the offer lapsed

    const out = await processStripeEvent(db.client, completedEvent(url, paidAt), SINGLE, { notifyPaid });

    expect(out.result).toBe("paid");
    expect(payments()[0]).toMatchObject({ status: "paid", paid_at: iso(paidAt) });
    expect(lastAuditMeta("catering.payment.provider_paid").needs_review).toEqual([]);

    // …and the offer WAS taken up in time, so the team can still confirm it after its date.
    await setQuoteStatus(owner, QUOTE, "accepted");
    expect(quote().status).toBe("accepted");
  });

  it("an event with no usable `created` is timed by when we processed it — late is late", async () => {
    const url = await tapPay();
    vi.setSystemTime(T0 + 25 * MIN);
    const event = completedEvent(url, 0) as Record<string, unknown>;
    delete event.created;

    const out = await processStripeEvent(db.client, event, SINGLE, { notifyPaid });

    expect(out.result).toBe("paid_needs_review");
    expect(payments()[0]!.paid_at).toBe(iso(T0 + 25 * MIN));
  });

  it("a `created` in the FUTURE cannot make a late payment look early: it is capped at now", async () => {
    const url = await tapPay();
    vi.setSystemTime(T0 + 25 * MIN);

    await processStripeEvent(db.client, completedEvent(url, T0 + 90 * 24 * HOUR), SINGLE, { notifyPaid });

    expect(payments()[0]!.paid_at).toBe(iso(T0 + 25 * MIN));
  });

  it("an order the team CONFIRMED before the customer paid is not on the clock, and is not flagged", async () => {
    const url = await tapPay();
    quote().status = "accepted";
    vi.setSystemTime(T0 + 26 * MIN);

    const out = await processStripeEvent(db.client, completedEvent(url, T0 + 25 * MIN), SINGLE, { notifyPaid });

    expect(out.result).toBe("paid");
  });

  it("the staff email has a plain sentence for it", async () => {
    db.tables.catering_quotes![0]!.pipeline_id = null;
    db.tables.users = [{ id: "u1", email: "mgr@example.com", active: true }];
    db.tables.catering_pipeline = [];
    // resolveCateringManager is not under test: address the mail through the lead's assignee.
    Object.assign(quote(), { pipeline_id: "lead1" });
    db.tables.catering_pipeline = [{ id: "lead1", assigned_to: "u1" }];

    await notifyPaymentPaid(db.client, {
      paymentId: "p1", quoteId: QUOTE, locationId: LOCATION, kind: "deposit", amountCents: 20000, reviewReasons: ["paid_after_expiry"],
    });

    const mail = sendEmailMock.mock.calls.at(-1)![0];
    expect(mail.subject).toMatch(/NEEDS REVIEW/);
    expect(mail.text).toMatch(/after this quote(?:'s| had) (?:offer )?expired/i);
  });
});

describe("W02 review r2 (P2) — only a payment settled in time takes an expired offer up", () => {
  const EXPIRED = iso(T0 - HOUR);

  it("the pure rule: a paid row counts only when its paid_at is not after the deadline", () => {
    expect(offerTakenUpInTime(EXPIRED, [{ status: "paid", paidAt: iso(T0 - 2 * HOUR) }])).toBe(true);
    expect(offerTakenUpInTime(EXPIRED, [{ status: "paid", paidAt: EXPIRED }])).toBe(true);
    expect(offerTakenUpInTime(EXPIRED, [{ status: "paid", paidAt: iso(T0 - 30 * MIN) }])).toBe(false);
    // One in time is enough, whatever came later.
    expect(offerTakenUpInTime(EXPIRED, [{ status: "paid", paidAt: iso(T0) }, { status: "paid", paidAt: iso(T0 - 3 * HOUR) }])).toBe(true);
    // A paid row that cannot say WHEN proves nothing; neither does anything not paid.
    expect(offerTakenUpInTime(EXPIRED, [{ status: "paid", paidAt: null }])).toBe(false);
    expect(offerTakenUpInTime(EXPIRED, [{ status: "refunded", paidAt: iso(T0 - 2 * HOUR) }])).toBe(false);
    expect(offerTakenUpInTime(EXPIRED, [])).toBe(false);
    // No deadline at all: nothing to be late for.
    expect(offerTakenUpInTime(null, [{ status: "paid", paidAt: iso(T0) }])).toBe(true);
  });

  it("a deposit marked paid by hand AFTER the date does not re-open the lapsed offer", async () => {
    quote().expires_at = EXPIRED;
    payments().push({ id: "p1", quote_id: QUOTE, kind: "deposit", status: "paid", amount_cents: 20000, paid_at: iso(T0 - 10 * MIN) });

    expect((await acceptRefusal()).code).toBe("quote_expired");
  });

  it("a deposit paid BEFORE the date still lets the team confirm afterwards", async () => {
    quote().expires_at = EXPIRED;
    payments().push({ id: "p1", quote_id: QUOTE, kind: "deposit", status: "paid", amount_cents: 20000, paid_at: iso(T0 - 2 * HOUR) });

    await setQuoteStatus(owner, QUOTE, "accepted");

    expect(quote().status).toBe("accepted");
  });

  it("a late payment beside an in-time one does not take the in-time one's standing away", async () => {
    quote().expires_at = EXPIRED;
    payments().push(
      { id: "p1", quote_id: QUOTE, kind: "deposit", status: "paid", amount_cents: 20000, paid_at: iso(T0 - 2 * HOUR) },
      { id: "p2", quote_id: QUOTE, kind: "balance", status: "paid", amount_cents: 80000, paid_at: iso(T0 - 5 * MIN) },
    );

    await setQuoteStatus(owner, QUOTE, "accepted");

    expect(quote().status).toBe("accepted");
  });
});
