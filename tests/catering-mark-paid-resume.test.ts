/**
 * Unit spine — A HAND-RECORDED PAYMENT THAT WAS CUT OFF IS FINISHED BY PRESSING IT AGAIN
 * (audit wave W02, review r5 — the same interruption the webhook had, on the staff seam).
 *
 * `markPaymentPaid` is: flip the row to `paid`, then close the order's checkouts (the
 * intent's own hosted page, and the other option's). A request cut off between the two left
 * the row paid and those pages payable. The webhook has Stripe's redelivery to finish its
 * settlements; a person's request has only the person. Pressing "Mark paid" again answered
 * 409 `not_due` and did nothing.
 *
 * THE RULE: asked to mark a payment that is ALREADY paid by hand, the function still
 * refuses (409 `not_due` — nothing is recorded twice, and the answer the screen gets is the
 * one it always got) but FIRST runs the idempotent cleanup again, from the row as it is
 * now. An audit row is written only when that pass did or found something.
 *
 * The real `markPaymentPaid` and `closeQuoteCheckouts` against tests/payments-fake-client.ts
 * and tests/stripe-fake.ts. "Cut off" is a statement that never answers. No DB, no network.
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
import { CateringPaymentError, markPaymentPaid } from "@/lib/catering/payments";
import * as stripeClient from "@/lib/stripe/client";
import type { AuthContext } from "@/lib/session";

const auditMock = vi.mocked(audit);
const retireMock = vi.mocked(stripeClient.retireCheckoutSession);

const QUOTE = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const DEPOSIT = "d0000000-0000-4000-8000-000000000001";
const FULL = "d0000000-0000-4000-8000-000000000002";

const owner = { user: { id: "u1", role: "owner" }, locations: [LOCATION] } as unknown as AuthContext;

const row = (id: string) => db.tables.catering_payments!.find((r) => r.id === id)!;
const markAudits = () => auditMock.mock.calls.map((c) => c[0]).filter((a) => a.action === "catering.payment.mark_paid");

function pay(over: Row): Row {
  return {
    quote_id: QUOTE,
    customer_id: null,
    kind: "deposit",
    amount_cents: 20000,
    currency: "usd",
    status: "due",
    provider: null,
    provider_ref: null,
    provider_session_id: null,
    paid_at: null,
    ...over,
  };
}

/** An open hosted checkout at the fake Stripe, as if the pay path had minted it. */
async function openCheckout(paymentId: string, amountCents: number): Promise<string> {
  const { id } = await stripe.create(
    "sk_shop",
    {
      quoteId: QUOTE,
      paymentId,
      kind: "deposit",
      amountCents,
      currency: "usd",
      productName: "Catering",
      description: "Catering",
      customerEmail: "customer@example.com",
      successUrl: "https://portal.example.com/ok",
      cancelUrl: "https://portal.example.com/cancel",
    },
    `${paymentId}:test`,
  );
  return id;
}

async function refusal(p: Promise<unknown>): Promise<CateringPaymentError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CateringPaymentError) return e;
    throw e;
  }
  throw new Error("expected a CateringPaymentError, but the call succeeded");
}

/** Press "Mark paid" and KILL the request at the first statement after its flip landed. */
function markPaidAndCutOffAfterTheFlip(paymentId: string): Promise<void> {
  return new Promise<void>((cutHappened, failed) => {
    db.beforeOp = () => {
      if (row(paymentId).status !== "paid") return;
      db.beforeOp = null;
      cutHappened();
      return "cut";
    };
    markPaymentPaid(owner, paymentId, QUOTE).then(() => failed(new Error("the request finished — it was never cut off")), failed);
  });
}

let depositSession: string;
let fullSession: string;

beforeEach(async () => {
  auditMock.mockClear();
  stripe = stripeFake();
  retireMock.mockReset();
  retireMock.mockImplementation(stripe.retire);
  db = paymentsFake({
    catering_quotes: [{ id: QUOTE, root_id: null, location_id: LOCATION, status: "sent", superseded_at: null }],
    locations: [{ id: LOCATION, code: "EM" }],
    catering_payments: [],
  });
  depositSession = await openCheckout(DEPOSIT, 20000);
  fullSession = await openCheckout(FULL, 100000);
  db.tables.catering_payments!.push(
    pay({ id: DEPOSIT, provider: "stripe", provider_session_id: depositSession }),
    pay({ id: FULL, kind: "full", amount_cents: 100000, provider: "stripe", provider_session_id: fullSession }),
  );
});

describe("W02 review r5 — a hand mark cut off after its flip", () => {
  it("leaves the row paid and BOTH hosted pages payable — and pressing Mark paid again closes them (still answering 409 not_due)", async () => {
    await markPaidAndCutOffAfterTheFlip(DEPOSIT);
    expect(row(DEPOSIT)).toMatchObject({ status: "paid", provider: "manual", provider_session_id: depositSession });
    expect(stripe.sessions.get(depositSession)!.status).toBe("open");
    expect(stripe.sessions.get(fullSession)!.status).toBe("open");
    expect(markAudits()).toEqual([]);

    const err = await refusal(markPaymentPaid(owner, DEPOSIT, QUOTE));

    // Nothing is recorded twice, and the screen is told what it was always told…
    expect(err).toMatchObject({ status: 409, code: "not_due" });
    expect(row(DEPOSIT)).toMatchObject({ status: "paid", provider: "manual" });
    // …but the cleanup the first press never reached has now run.
    expect(stripe.sessions.get(depositSession)!.status).toBe("expired");
    expect(stripe.sessions.get(fullSession)!.status).toBe("expired");
    expect(row(DEPOSIT).provider_session_id).toBeNull();
    expect(row(FULL)).toMatchObject({ status: "due", provider_session_id: null });
    expect(markAudits()).toHaveLength(1);
    expect(markAudits()[0]!.metadata).toMatchObject({
      resumed: true,
      provider: "manual",
      closed_checkouts: { retired: [DEPOSIT, FULL], stillOpen: [], completing: [] },
    });
  });

  it("Stripe unreachable on the second press too: still 409, the ids stay on their rows, and the audit row says what is still open", async () => {
    await markPaidAndCutOffAfterTheFlip(DEPOSIT);
    stripe.down = true;

    const err = await refusal(markPaymentPaid(owner, DEPOSIT, QUOTE));

    expect(err.code).toBe("not_due");
    expect(row(DEPOSIT).provider_session_id).toBe(depositSession);
    expect(row(FULL).provider_session_id).toBe(fullSession);
    expect(markAudits()[0]!.metadata).toMatchObject({ resumed: true, closed_checkouts: { retired: [], stillOpen: [DEPOSIT, FULL] } });
  });
});

describe("W02 review r5 — pressing Mark paid on a payment that is already paid changes nothing it should not", () => {
  it("a mark that FINISHED: pressing again is 409 not_due, asks Stripe nothing and writes no audit row", async () => {
    await markPaymentPaid(owner, DEPOSIT, QUOTE);
    expect(markAudits()).toHaveLength(1);
    retireMock.mockClear();
    auditMock.mockClear();

    const err = await refusal(markPaymentPaid(owner, DEPOSIT, QUOTE));

    expect(err).toMatchObject({ status: 409, code: "not_due" });
    expect(retireMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("a payment STRIPE recorded is the webhook's to finish, not this function's: 409, nothing retired", async () => {
    Object.assign(row(DEPOSIT), { status: "paid", provider: "stripe", provider_ref: "pi_1" });

    const err = await refusal(markPaymentPaid(owner, DEPOSIT, QUOTE));

    expect(err).toMatchObject({ status: 409, code: "not_due" });
    expect(retireMock).not.toHaveBeenCalled();
    expect(stripe.sessions.get(fullSession)!.status).toBe("open");
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("a VOID or REFUNDED payment is refused as before, with no cleanup", async () => {
    row(DEPOSIT).status = "void";
    expect((await refusal(markPaymentPaid(owner, DEPOSIT, QUOTE))).code).toBe("not_due");
    Object.assign(row(DEPOSIT), { status: "refunded", provider: "manual" });
    expect((await refusal(markPaymentPaid(owner, DEPOSIT, QUOTE))).code).toBe("not_due");
    expect(retireMock).not.toHaveBeenCalled();
  });

  it("someone who may not write this shop's payments gets 403 and no cleanup, whatever the row's state", async () => {
    await markPaidAndCutOffAfterTheFlip(DEPOSIT);
    const stranger = { user: { id: "u2", role: "catering_mgr" }, locations: ["b0000000-0000-4000-8000-0000000000ff"] } as unknown as AuthContext;

    const err = await refusal(markPaymentPaid(stranger, DEPOSIT, QUOTE));

    expect(err.status).toBe(403);
    expect(retireMock).not.toHaveBeenCalled();
    expect(stripe.sessions.get(depositSession)!.status).toBe("open");
  });
});
