/**
 * Unit spine — a CHECKOUT ATTEMPT is one hosted session, and a retired one never comes back
 * (audit wave W02, B035 — review r1's P2 "Retired sessions retain reusable idempotency keys").
 *
 * The first cut keyed Stripe's idempotency on `<payment id>:<amount>`. Stripe replays the
 * ORIGINAL response for a key for 24 hours and refuses a key re-used with other parameters
 * (docs.stripe.com/api/idempotent_requests), so:
 *   - deposit → full → back to deposit: the deposit's key had not changed, and Stripe
 *     handed back the deposit session we had just RETIRED — a dead checkout link;
 *   - a revise that did not change the amount moved the row to a new quote id: same key,
 *     different metadata and return links — a 400 for a day.
 *
 * THE RULE NOW:
 *   - within an attempt, the row's stored session IS the attempt: a second tap asks Stripe
 *     about it and, while it is still open for this quote at this amount, hands the SAME
 *     checkout back and mints nothing;
 *   - anything else — retired, lapsed, another amount, another quote — is closed for good
 *     (fail closed) and the next mint uses a key no request has ever used.
 *
 * Runs the real `initiatePayment` + `createQuoteCheckout` (the pay route's two steps) against
 * tests/payments-fake-client.ts and tests/stripe-fake.ts, which models Stripe's idempotency
 * and session status. No DB, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";
import { stripeFake, type StripeFake } from "./stripe-fake";

let db: PaymentsFake;
let stripe: StripeFake;

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
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
import { carryPaymentsToRevision } from "@/lib/catering/payment-carry";
import { createQuoteCheckout, initiatePayment, PortalQuoteError } from "@/lib/portal/quotes";
import * as stripeClient from "@/lib/stripe/client";

const auditMock = vi.mocked(audit);
const createSessionMock = vi.mocked(stripeClient.createCheckoutSession);
const retireMock = vi.mocked(stripeClient.retireCheckoutSession);
// Read through the namespace so this file also loads against a client that predates it.
const retrieveMock = vi.mocked(
  (stripeClient as unknown as { retrieveCheckoutSession: StripeFake["retrieve"] }).retrieveCheckoutSession,
);

const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const QUOTE = "a0000000-0000-4000-8000-000000000001";
const QUOTE_V2 = "a0000000-0000-4000-8000-000000000002";
const LOCATION = "b0000000-0000-4000-8000-000000000001";

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
    ...over,
  };
}

const payments = () => db.tables.catering_payments!;
const due = (kind: string, quoteId = QUOTE) => payments().find((p) => p.kind === kind && p.status === "due" && p.quote_id === quoteId)!;

/** The pay route's two steps, exactly as app/api/portal/quote/[id]/pay/route.ts runs them. */
async function tapPay(kind: "deposit" | "full", quoteId = QUOTE): Promise<string> {
  const intent = await initiatePayment(CUSTOMER, quoteId, kind);
  const checkout = await createQuoteCheckout({
    customerId: CUSTOMER,
    customerEmail: "customer@example.com",
    quoteId,
    kind,
    paymentId: intent.paymentId,
    amountCents: intent.amountCents,
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

const openSessions = () => [...stripe.sessions.values()].filter((s) => s.status === "open");

beforeEach(() => {
  auditMock.mockClear();
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
  });
});

describe("W02/B035 review r1 — a retired checkout is never handed back", () => {
  it("deposit → full → back to deposit: the customer gets a NEW, open deposit checkout", async () => {
    const first = await tapPay("deposit");
    await tapPay("full"); // retires the deposit checkout
    expect(stripe.byUrl(first)!.status).toBe("expired");

    const again = await tapPay("deposit");

    // The bug: the deposit's idempotency key had not changed, so Stripe replayed the
    // session we had just retired and the customer was sent to a dead link.
    expect(again).not.toBe(first);
    expect(stripe.byUrl(again)).toMatchObject({ status: "open", amountCents: 20000, quoteId: QUOTE });
    expect(due("deposit").provider_session_id).toBe(stripe.byUrl(again)!.id);
    // …and it is the ONLY way left to pay this quote.
    expect(openSessions().map((s) => s.url)).toEqual([again]);
    expect(due("full").provider_session_id ?? null).toBeNull();
  });

  it("a revise that does NOT change the amount: the first checkout on the new revision is minted, not refused", async () => {
    const first = await tapPay("deposit");
    // Staff revise: v2 is a new row, same deposit. The carry retires the open checkout and
    // moves the intent (lib/catering/payment-carry.ts — driven for real).
    db.tables.catering_quotes![0]!.superseded_at = "2026-11-10T00:00:00.000Z";
    db.tables.catering_quotes!.push(quoteRow({ id: QUOTE_V2, root_id: QUOTE }));
    await carryPaymentsToRevision(db.client, { rootId: QUOTE, newQuoteId: QUOTE_V2, depositCents: 20000, totalCents: 100000 }, (id) =>
      stripe.retire("sk_shop", id),
    );
    expect(due("deposit", QUOTE_V2)).toMatchObject({ amount_cents: 20000, provider_session_id: null });

    // The bug: same row id, same amount ⇒ same key, but the quote id and the return links
    // are different parameters — Stripe answers 400 and the customer cannot pay for a day.
    const url = await tapPay("deposit", QUOTE_V2);

    expect(url).not.toBe(first);
    expect(stripe.byUrl(url)).toMatchObject({ status: "open", quoteId: QUOTE_V2, amountCents: 20000 });
    expect(openSessions()).toHaveLength(1);
  });

  it("…and when the carry could NOT retire it, the first tap on the revision closes the old checkout before a new one exists", async () => {
    const first = await tapPay("deposit");
    db.tables.catering_quotes![0]!.superseded_at = "2026-11-10T00:00:00.000Z";
    db.tables.catering_quotes!.push(quoteRow({ id: QUOTE_V2, root_id: QUOTE }));
    await carryPaymentsToRevision(db.client, { rootId: QUOTE, newQuoteId: QUOTE_V2, depositCents: 20000, totalCents: 100000 }, null);
    expect(due("deposit", QUOTE_V2).provider_session_id).toBe(stripe.byUrl(first)!.id);

    const url = await tapPay("deposit", QUOTE_V2);

    // The old checkout names the superseded quote: it is not this attempt, so it is retired.
    expect(stripe.byUrl(first)!.status).toBe("expired");
    expect(stripe.byUrl(url)).toMatchObject({ status: "open", quoteId: QUOTE_V2 });
    expect(openSessions()).toHaveLength(1);
  });

  it("a checkout that lapsed on its own is replaced by a fresh one", async () => {
    const first = await tapPay("deposit");
    stripe.lapse(stripe.byUrl(first)!.id);

    const again = await tapPay("deposit");

    expect(again).not.toBe(first);
    expect(stripe.byUrl(again)!.status).toBe("open");
    expect(due("deposit").provider_session_id).toBe(stripe.byUrl(again)!.id);
  });

  it("a session Stripe has never heard of (404) is treated as gone, and a fresh one is minted", async () => {
    await initiatePayment(CUSTOMER, QUOTE, "deposit");
    due("deposit").provider_session_id = "cs_test_unknown";

    const url = await tapPay("deposit");

    expect(stripe.byUrl(url)!.status).toBe("open");
    expect(due("deposit").provider_session_id).toBe(stripe.byUrl(url)!.id);
  });

  it("no idempotency key is ever used for two mints", async () => {
    await tapPay("deposit");
    await tapPay("full");
    await tapPay("deposit");
    await tapPay("full");

    const keys = stripe.creates.map((c) => c.key);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    expect(stripe.creates.every((c) => !c.replayed)).toBe(true);
    // Each key still names the intent it was minted for (findable in the Stripe dashboard).
    for (const c of stripe.creates) expect(c.key.startsWith(`${stripe.sessions.get(c.sessionId)!.paymentId}:`)).toBe(true);
  });
});

describe("W02/B035 review r1 — within an attempt, the same checkout comes back", () => {
  it("a second tap on the same option returns the SAME open checkout and mints nothing", async () => {
    const first = await tapPay("deposit");
    auditMock.mockClear();

    const second = await tapPay("deposit");

    expect(second).toBe(first);
    expect(stripe.creates).toHaveLength(1);
    expect(stripe.retires).toEqual([]);
    expect(stripe.byUrl(first)!.status).toBe("open");
    // No second `checkout_created` row: nothing was created.
    expect(auditMock.mock.calls.map((c) => c[0].action)).not.toContain("catering.payment.checkout_created");
  });

  it("if the customer already FINISHED that checkout, nothing new is offered: 409 payment_in_progress", async () => {
    const first = await tapPay("deposit");
    stripe.complete(stripe.byUrl(first)!.id);

    const err = await refusal(tapPay("deposit"));

    expect(err.status).toBe(409);
    expect(err.code).toBe("payment_in_progress");
    expect(stripe.creates).toHaveLength(1);
    // The row still names the checkout being paid, so the webhook's fallback lookup finds it.
    expect(due("deposit").provider_session_id).toBe(stripe.byUrl(first)!.id);
  });

  it("if Stripe cannot be asked about the stored checkout, it FAILS CLOSED: 502, and nothing is minted", async () => {
    const first = await tapPay("deposit");
    stripe.down = true;

    const err = await refusal(tapPay("deposit"));

    expect(err.status).toBe(502);
    expect(err.code).toBe("provider_error");
    expect(stripe.creates).toHaveLength(1);
    expect(due("deposit").provider_session_id).toBe(stripe.byUrl(first)!.id);
  });

  it("a stored checkout at ANOTHER amount is not this attempt: it is retired, and only then replaced", async () => {
    const first = await tapPay("deposit");
    // A legacy row: the amount moved under an open checkout (the pre-fix re-price).
    stripe.sessions.get(stripe.byUrl(first)!.id)!.amountCents = 15000;

    const again = await tapPay("deposit");

    expect(stripe.byUrl(first)!.status).toBe("expired");
    expect(stripe.byUrl(again)).toMatchObject({ status: "open", amountCents: 20000 });
    expect(openSessions()).toHaveLength(1);
  });
});

describe("W02/B035 review r1 — two requests minting at once", () => {
  it("the second to record its session loses, closes its own checkout, and is told a payment is in progress", async () => {
    await initiatePayment(CUSTOMER, QUOTE, "deposit");
    // Another request records ITS session on the same intent while ours is at Stripe.
    createSessionMock.mockImplementation(async (key, input, idem) => {
      const mine = await stripe.create(key, input, idem);
      const theirs = await stripe.create(key, input, "racer-key");
      due("deposit").provider_session_id = theirs.id;
      return mine;
    });

    const err = await refusal(tapPay("deposit"));

    expect(err.status).toBe(409);
    expect(err.code).toBe("payment_in_progress");
    // Ours is closed again; theirs is the one open checkout, and the row names it.
    const open = openSessions();
    expect(open).toHaveLength(1);
    expect(open[0]!.key).toBe("racer-key");
    expect(due("deposit").provider_session_id).toBe(open[0]!.id);
  });

  it("a checkout we minted and then had to abandon is not handed out on the next try", async () => {
    db.enforceOneOpenCheckout = true; // 0303 applied
    await initiatePayment(CUSTOMER, QUOTE, "deposit");
    await initiatePayment(CUSTOMER, QUOTE, "full");
    // While our FULL checkout is at Stripe, another request attaches one to the DEPOSIT intent.
    createSessionMock.mockImplementationOnce(async (key, input, idem) => {
      const mine = await stripe.create(key, input, idem);
      due("deposit").provider_session_id = "cs_test_racer";
      return mine;
    });
    expect((await refusal(tapPay("full"))).code).toBe("payment_in_progress");
    const abandoned = stripe.creates[0]!.sessionId;
    expect(stripe.sessions.get(abandoned)!.status).toBe("expired");

    // The customer tries the full payment again a moment later.
    const url = await tapPay("full");

    expect(stripe.byUrl(url)!.id).not.toBe(abandoned);
    expect(stripe.byUrl(url)).toMatchObject({ status: "open", amountCents: 100000 });
  });
});
