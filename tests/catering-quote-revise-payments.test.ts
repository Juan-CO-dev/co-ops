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
vi.mock("@/lib/stripe/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe/client")>();
  return { ...actual, stripeCredentialsFor: vi.fn(() => null), retireCheckoutSession: vi.fn(async () => "expired") };
});

import { audit } from "@/lib/audit";
import { reviseQuote } from "@/lib/catering/quotes";
import { loadPaymentsForQuote } from "@/lib/catering/payments";
import { initiatePayment, loadCustomerQuoteDetail, PortalQuoteError } from "@/lib/portal/quotes";
import type { AuthContext } from "@/lib/session";

const auditMock = vi.mocked(audit);

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
