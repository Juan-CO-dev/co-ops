/**
 * END-TO-END reproduction of audit W02/B006 — "Revising a quote orphans its payments: the
 * paid deposit is not credited and the customer is asked to pay again."
 *
 *   1. a customer submits a self-serve order (v1) and pays the deposit;
 *   2. staff revise the order — v2 is a NEW row with a NEW id;
 *   3. the customer opens v2: no payment is shown, and the pay route takes a second deposit.
 *
 * This drives the real `reviseQuote`, then the real portal loaders and the real pay gate,
 * against tests/payments-fake-client.ts (predicate-aware, in memory). `audit` and the one
 * Stripe call are mocked. No database, no network. What each kind of payment row does on a
 * revise is pinned row by row in tests/catering-payment-carry.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";

let db: PaymentsFake;

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ id: "email_1" })), teamFrom: () => "Team <team@example.com>" }));
vi.mock("@/lib/stripe/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe/client")>();
  return { ...actual, stripeCredentialsFor: vi.fn(() => null), retireCheckoutSession: vi.fn(async () => "expired") };
});

import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { CateringQuoteError, reviseQuote, sendQuote, setQuoteStatus } from "@/lib/catering/quotes";
import { loadPaymentsForQuote } from "@/lib/catering/payments";
import { initiatePayment, loadCustomerQuoteDetail, PortalQuoteError } from "@/lib/portal/quotes";
import type { AuthContext } from "@/lib/session";

const auditMock = vi.mocked(audit);
const sendEmailMock = vi.mocked(sendEmail);

const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const V1 = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "b0000000-0000-4000-8000-000000000001";

const owner = { user: { id: "u1", role: "owner" }, locations: [LOCATION] } as unknown as AuthContext;

/** One line of 4 trays at $300: subtotal = total $1,200; deposit 25% = $300. */
const REVISION = { eventDate: "2099-06-01", headcount: 40, lines: [{ description: "Sub tray", quantity: 4, unitPriceCents: 30000 }] };

function v1(over: Row = {}): Row {
  return {
    id: V1,
    root_id: null,
    version: 1,
    pipeline_id: null,
    customer_id: CUSTOMER,
    location_id: LOCATION,
    status: "submitted",
    origin: "self_serve",
    event_date: "2099-06-01",
    headcount: 30,
    is_delivery: false,
    delivery_zone_id: null,
    subtotal_cents: 100000,
    delivery_fee_cents: 0,
    service_charge_cents: 0,
    gratuity_cents: 0,
    tax_cents: 0,
    total_cents: 100000,
    deposit_cents: 20000,
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
    sent_at: null,
    sent_by: null,
    superseded_at: null,
    ...over,
  };
}

function deposit(over: Row = {}): Row {
  return {
    id: "d0000000-0000-4000-8000-000000000001",
    quote_id: V1,
    customer_id: CUSTOMER,
    kind: "deposit",
    amount_cents: 20000,
    currency: "usd",
    status: "paid",
    provider: "manual",
    provider_ref: null,
    provider_session_id: null,
    created_at: "2026-11-01T00:00:01.000Z",
    paid_at: "2026-11-02T00:00:00.000Z",
    created_by: CUSTOMER,
    ...over,
  };
}

const payments = () => db.tables.catering_payments!;
const quoteById = (id: string) => db.tables.catering_quotes!.find((q) => q.id === id)!;

beforeEach(() => {
  auditMock.mockClear();
  sendEmailMock.mockClear();
  db = paymentsFake({
    catering_quotes: [v1()],
    catering_quote_items: [],
    catering_pricing_rules: [
      { location_id: LOCATION, active: true, tax_rate_bps: 0, gratuity_bps: 0, service_charge_bps: 0, deposit_pct_bps: 2500, tax_on_delivery: true, tax_on_gratuity: false },
    ],
    catering_delivery_zones: [],
    catering_payments: [],
    locations: [{ id: LOCATION, code: "EM" }],
  });
});

describe("W02/B006 — a paid deposit survives a revise", () => {
  it("the deposit is on the NEW revision, the customer sees it, and the pay gate refuses a second one", async () => {
    payments().push(deposit());

    const revised = await reviseQuote(owner, V1, REVISION);

    expect(revised.version).toBe(2);
    expect(quoteById(V1).superseded_at).not.toBeNull();
    expect(quoteById(revised.id)).toMatchObject({ root_id: V1, status: "draft", total_cents: 120000, deposit_cents: 30000 });

    // 1. The payment followed the quote.
    expect(payments()).toHaveLength(1);
    expect(payments()[0]).toMatchObject({ quote_id: revised.id, status: "paid", amount_cents: 20000 });

    // 2. The customer's page for the new revision shows the payment they made.
    const detail = await loadCustomerQuoteDetail(CUSTOMER, revised.id);
    expect(detail?.payments).toEqual([{ kind: "deposit", status: "paid", amountCents: 20000, paidAt: "2026-11-02T00:00:00.000Z" }]);

    // 3. The team sends the revision; the customer taps "pay". This used to mint a SECOND deposit.
    quoteById(revised.id).status = "sent";
    const err = await initiatePayment(CUSTOMER, revised.id, "deposit").catch((e) => e as PortalQuoteError);
    expect(err).toBeInstanceOf(PortalQuoteError);
    expect((err as PortalQuoteError).code).toBe("already_paid");
    expect(payments()).toHaveLength(1);

    // 4. The staff payments panel on the new revision lists it too.
    const staffView = await loadPaymentsForQuote(owner, revised.id);
    expect(staffView.map((p) => [p.kind, p.status])).toEqual([["deposit", "paid"]]);
  });

  it("the revision keeps the order's ORIGIN — a self-serve order does not silently become a staff quote", async () => {
    const revised = await reviseQuote(owner, V1, REVISION);
    // `origin` drives the payment plan. Left to the column default it flipped to 'staff',
    // which swaps "deposit required" for "pay in full" on a customer's own order.
    expect(quoteById(revised.id).origin).toBe("self_serve");
  });

  it("a staff quote stays a staff quote", async () => {
    db.tables.catering_quotes = [v1({ origin: "staff", status: "sent" })];
    const revised = await reviseQuote(owner, V1, REVISION);
    expect(quoteById(revised.id).origin).toBe("staff");
  });
});

describe("W02/B006 — an UNPAID deposit intent follows the quote at the new price", () => {
  it("the due deposit moves to the new revision, re-priced, and is the row the customer then pays", async () => {
    payments().push(deposit({ status: "due", provider: null, paid_at: null }));

    const revised = await reviseQuote(owner, V1, REVISION);

    expect(payments()).toHaveLength(1);
    expect(payments()[0]).toMatchObject({ quote_id: revised.id, status: "due", amount_cents: 30000 });

    quoteById(revised.id).status = "sent";
    const out = await initiatePayment(CUSTOMER, revised.id, "deposit");
    expect(out).toMatchObject({ paymentId: payments()[0]!.id, amountCents: 30000 });
    expect(payments()).toHaveLength(1);
  });
});

describe("W02/B006 — the move is recorded, and a failed carry never fails the revise", () => {
  it("`catering.quote.revise` audits which payments moved and from where", async () => {
    payments().push(deposit());

    const revised = await reviseQuote(owner, V1, REVISION);

    const row = auditMock.mock.calls.map((c) => c[0]).find((a) => a.action === "catering.quote.revise" && a.resourceId === revised.id);
    expect(row?.metadata).toMatchObject({
      from_quote_id: V1,
      payments_carried: true,
      payments: {
        moved: [{ paymentId: payments()[0]!.id, fromQuoteId: V1 }],
        carriedDue: [],
        voided: [],
      },
    });
  });

  it("a carry that fails is audited as `payments_carry_failed` and the revision still stands", async () => {
    payments().push(deposit());
    db.failUpdate.push("catering_payments");

    const revised = await reviseQuote(owner, V1, REVISION);

    // The revision is live; failing the request here would have the manager retry into a 409.
    expect(quoteById(revised.id).superseded_at ?? null).toBeNull();
    expect(payments()[0]!.quote_id).toBe(V1);
    const failure = auditMock.mock.calls.map((c) => c[0]).find((a) => (a.metadata as Record<string, unknown>).outcome === "payments_carry_failed");
    expect(failure).toMatchObject({ action: "catering.quote.revise", resourceId: revised.id });
    expect(failure?.metadata).toMatchObject({ from_quote_id: V1, root_id: V1 });
  });

  it("…and the NEXT revise heals the family", async () => {
    payments().push(deposit());
    db.failUpdate.push("catering_payments");
    const v2 = await reviseQuote(owner, V1, REVISION);
    expect(payments()[0]!.quote_id).toBe(V1);

    const v3 = await reviseQuote(owner, v2.id, REVISION);

    expect(v3.version).toBe(3);
    expect(payments()[0]!.quote_id).toBe(v3.id);
  });

  it("when the revision's ITEMS fail to save (strand B), the revise fails — and the payment is still on the live revision", async () => {
    payments().push(deposit());
    db.failInsert.push("catering_quote_items");

    await expect(reviseQuote(owner, V1, REVISION)).rejects.toThrow();

    // The empty revision is the live one all the same, so that is where the money must show.
    const live = db.tables.catering_quotes!.find((q) => q.root_id === V1 && (q.superseded_at ?? null) === null)!;
    expect(live.version).toBe(2);
    expect(payments()[0]).toMatchObject({ quote_id: live.id, status: "paid" });
    const failure = auditMock.mock.calls.map((c) => c[0]).find((a) => (a.metadata as Record<string, unknown>).outcome === "items_insert_failed");
    expect(failure?.metadata).toMatchObject({ payments_carried: true, payments: { moved: [{ fromQuoteId: V1 }] } });
  });
});

/**
 * Review r1, P1: "Failed carries still allow double collection." The carry is best-effort
 * (the revision is already live), and a failure used to leave a revision staff could SEND
 * and a customer could PAY with the paid deposit still sitting on the superseded row: the
 * already-paid gate saw nothing. Recovery took another manual revise.
 *
 * The rule now: A REVISION WHOSE FAMILY STILL HAS PAYMENTS ON AN EARLIER REVISION CANNOT BE
 * SENT, ACCEPTED OR PAID. Each of those doors first re-runs the carry (it is idempotent);
 * if a payment is still stranded afterwards, the door stays shut.
 */
describe("W02/B006 review r1 — a failed carry never leaves a revision that can be sent or paid as if unpaid", () => {
  const refusalOf = async (p: Promise<unknown>) =>
    p.then(
      () => {
        throw new Error("expected a refusal, but the call succeeded");
      },
      (e: unknown) => e as CateringQuoteError | PortalQuoteError,
    );
  /** Revise while the payments table refuses the move: the deposit stays on v1. */
  async function reviseWithFailedCarry() {
    payments().push(deposit());
    db.failUpdate.push("catering_payments");
    const v2 = await reviseQuote(owner, V1, REVISION);
    expect(payments()[0]!.quote_id).toBe(V1);
    return v2;
  }
  const auditWith = (outcome: string) =>
    auditMock.mock.calls.map((c) => c[0]).find((a) => (a.metadata as Record<string, unknown>).outcome === outcome);

  it("staff cannot SEND the revision while the paid deposit is stranded and still cannot be moved", async () => {
    const v2 = await reviseWithFailedCarry();
    db.failUpdate.push("catering_payments"); // the retry at send fails too

    const err = await refusalOf(sendQuote(owner, v2.id));

    expect(err).toBeInstanceOf(CateringQuoteError);
    expect(err).toMatchObject({ status: 409, code: "payments_unreconciled" });
    // Nothing was offered to the customer.
    expect(quoteById(v2.id).status).toBe("draft");
    expect(sendEmailMock).not.toHaveBeenCalled();
    const failed = auditWith("payments_reconcile_failed");
    expect(failed).toMatchObject({ action: "catering.quote.revise", resourceId: v2.id });
    expect(failed?.metadata).toMatchObject({ context: "send", root_id: V1, stranded: [payments()[0]!.id] });
  });

  it("SEND heals it once the database is back: the deposit is on the revision before the customer ever sees a pay button", async () => {
    const v2 = await reviseWithFailedCarry();

    await sendQuote(owner, v2.id);

    expect(quoteById(v2.id).status).toBe("sent");
    expect(payments()[0]).toMatchObject({ quote_id: v2.id, status: "paid", amount_cents: 20000 });
    expect(auditWith("payments_reconciled")?.metadata).toMatchObject({ context: "send", payments: { moved: [{ fromQuoteId: V1 }] } });
    // The pay gate now sees it.
    const err = await refusalOf(initiatePayment(CUSTOMER, v2.id, "deposit"));
    expect(err).toMatchObject({ code: "already_paid" });
    expect(payments()).toHaveLength(1);
  });

  it("ACCEPTING the revision is held to the same rule", async () => {
    const v2 = await reviseWithFailedCarry();
    db.failUpdate.push("catering_payments");

    const err = await refusalOf(setQuoteStatus(owner, v2.id, "accepted"));

    expect(err).toMatchObject({ status: 409, code: "payments_unreconciled" });
    expect(quoteById(v2.id).status).toBe("draft");

    // Healthy again: the accept goes through and the deposit is where the gate reads it.
    await setQuoteStatus(owner, v2.id, "accepted");
    expect(quoteById(v2.id).status).toBe("accepted");
    expect(payments()[0]!.quote_id).toBe(v2.id);
  });

  it("the accept's own `was anything paid?` reading sees a deposit that had to be healed first", async () => {
    // A revision past its date, whose family's PAID deposit is still on v1. Read before the
    // heal, it would look like an expired offer nobody took up; it was taken up, on v1.
    const V2 = "a0000000-0000-4000-8000-000000000002";
    db.tables.catering_quotes = [
      v1({ superseded_at: "2026-11-05T00:00:00.000Z" }),
      v1({ id: V2, root_id: V1, version: 2, status: "sent", expires_at: "2020-01-01T00:00:00.000Z" }),
    ];
    payments().push(deposit());

    await setQuoteStatus(owner, V2, "accepted");

    expect(quoteById(V2).status).toBe("accepted");
    expect(payments()[0]!.quote_id).toBe(V2);
  });

  it("DECLINING or expiring a revision is not held up by stranded payments", async () => {
    const v2 = await reviseWithFailedCarry();
    db.failUpdate.push("catering_payments");

    await setQuoteStatus(owner, v2.id, "declined");

    expect(quoteById(v2.id).status).toBe("declined");
    // The failure entry was never consumed: closing a quote does not touch the payments.
    expect(db.failUpdate).toEqual(["catering_payments"]);
  });

  it("FAILURE INJECTION — a payment attempted on the new revision is refused while its paid deposit is stranded", async () => {
    const v2 = await reviseWithFailedCarry();
    // However the revision came to be payable (a revise made before this fix, a status set
    // by hand): the pay gate is the last door, and it does not open.
    quoteById(v2.id).status = "sent";
    db.failUpdate.push("catering_payments");

    const err = await refusalOf(initiatePayment(CUSTOMER, v2.id, "deposit"));

    expect(err).toBeInstanceOf(PortalQuoteError);
    expect(err).toMatchObject({ status: 409, code: "payment_reconciling" });
    // No second deposit intent, nothing charged, the paid deposit untouched.
    expect(payments()).toHaveLength(1);
    expect(payments()[0]).toMatchObject({ quote_id: V1, status: "paid" });
    expect(auditWith("payments_reconcile_failed")?.metadata).toMatchObject({ context: "portal_pay" });
  });

  it("on the next tap, with the database back, the gate HEALS the family and answers already_paid", async () => {
    const v2 = await reviseWithFailedCarry();
    quoteById(v2.id).status = "sent";

    const err = await refusalOf(initiatePayment(CUSTOMER, v2.id, "deposit"));

    expect(err).toMatchObject({ code: "already_paid" });
    expect(payments()).toHaveLength(1);
    expect(payments()[0]).toMatchObject({ quote_id: v2.id, status: "paid" });
    // The customer's page now shows the payment they made.
    const detail = await loadCustomerQuoteDetail(CUSTOMER, v2.id);
    expect(detail?.payments.map((p) => [p.kind, p.status])).toEqual([["deposit", "paid"]]);
  });

  it("a family orphaned BEFORE this fix (no revise to heal it) is healed by the pay tap, not by a second charge", async () => {
    // v1 superseded by a v2 that an older build created without carrying anything.
    const V2 = "a0000000-0000-4000-8000-000000000002";
    db.tables.catering_quotes = [v1({ superseded_at: "2026-11-05T00:00:00.000Z" }), v1({ id: V2, root_id: V1, version: 2, status: "sent" })];
    payments().push(deposit());

    const err = await refusalOf(initiatePayment(CUSTOMER, V2, "deposit"));

    expect(err).toMatchObject({ code: "already_paid" });
    expect(payments()).toEqual([expect.objectContaining({ quote_id: V2, status: "paid" })]);
  });

  it("a stranded UNPAID intent is healed onto the revision and is the row the customer then pays, never a duplicate", async () => {
    const V2 = "a0000000-0000-4000-8000-000000000002";
    db.tables.catering_quotes = [
      v1({ superseded_at: "2026-11-05T00:00:00.000Z" }),
      v1({ id: V2, root_id: V1, version: 2, status: "sent", total_cents: 120000, deposit_cents: 30000 }),
    ];
    payments().push(deposit({ status: "due", provider: null, paid_at: null }));

    const out = await initiatePayment(CUSTOMER, V2, "deposit");

    expect(payments()).toHaveLength(1);
    expect(out).toMatchObject({ paymentId: payments()[0]!.id, amountCents: 30000 });
    expect(payments()[0]).toMatchObject({ quote_id: V2, status: "due", amount_cents: 30000 });
  });

  it("a failed read of the family refuses the door rather than guessing it is clean", async () => {
    const v2 = await reviseWithFailedCarry();
    db.failSelect.push("catering_payments");

    await expect(sendQuote(owner, v2.id)).rejects.toThrow(/strandedFamilyPayments/);
    expect(quoteById(v2.id).status).toBe("draft");
  });

  it("a quote that was never revised pays exactly as before: no family reads, no write it did not make before", async () => {
    quoteById(V1).status = "sent";
    db.ops.length = 0;

    await initiatePayment(CUSTOMER, V1, "deposit");

    expect(db.ops.filter((o) => o.table === "catering_quotes")).toHaveLength(1);
    expect(db.ops.filter((o) => o.table === "catering_payments" && o.kind === "update")).toEqual([]);
  });

  it("both refusals have a sentence a person can act on, in both languages", async () => {
    const { readFileSync } = await import("node:fs");
    const en = JSON.parse(readFileSync("lib/i18n/en.json", "utf8")) as Record<string, string>;
    const es = JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>;
    for (const key of ["order.quote.error_reconciling", "catering.quotes.error.payments_unreconciled"]) {
      expect(en[key], key).toBeTruthy();
      expect(es[key], key).toBeTruthy();
      expect(es[key]).not.toBe(en[key]);
    }
    // The customer is told they do not need to pay twice; staff are told nothing was sent.
    expect(en["order.quote.error_reconciling"]).toMatch(/don't need to pay again/);
    expect(en["catering.quotes.error.payments_unreconciled"]).toMatch(/nothing was sent/);
    expect(readFileSync("app/order/quote/[id]/pay-buttons.tsx", "utf8")).toContain('payment_reconciling: "order.quote.error_reconciling"');
    expect(readFileSync("components/catering/quotes/shared.ts", "utf8")).toContain('"payments_unreconciled"');
  });
});
