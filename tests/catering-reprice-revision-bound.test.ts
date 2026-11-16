/**
 * Unit spine — A RE-PRICE IS BOUND TO THE REVISION IT WAS DECIDED ON (audit wave W02,
 * review r5 P2: "stale repricing overwrites a newer revision's amount").
 *
 * `syncDuePaymentAmount` brings a reused due intent to the amount the quote asks for now.
 * It was guarded on `status = 'due'` and on the row's Checkout Session — and on nothing that
 * says WHICH QUOTE the amount was computed from. So:
 *
 *   1. the customer taps "pay deposit" on v1. `initiatePayment` reads v1's due intent ($150,
 *      stale) and decides to re-price it to v1's deposit, $200;
 *   2. a manager revises: v2's deposit is $300. The carry moves the intent to v2 and
 *      re-prices it to $300;
 *   3. step 1 resumes and writes $200 — onto v2's intent.
 *
 * v2 now asks $300 and its intent says $200; staff can mark that $200 paid as the deposit.
 *
 * THE RULE (AGENTS.md, "every write to a due intent is a compare-and-set on the row as it
 * was read"): the re-price names the quote its amount came from, and applies only while the
 * intent is still on that quote. Pinned for BOTH callers — the portal's pay tap and
 * `createPaymentDue`'s reuse of an existing intent — with the revise landing between the
 * read and the write, driven for real (`reviseQuote` and its carry).
 *
 * Also pinned here (the same rule, for the one INSERT on the pay path): an intent a pay tap
 * raises on a revision that was superseded while the tap was in flight is closed again, and
 * the tap is refused — the customer was looking at an offer that no longer exists.
 *
 * tests/payments-fake-client.ts `beforeOp` runs the revise between the two statements. No
 * DB, no network, no real Stripe.
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
    // No Stripe for this shop: the pay path stops at the intent (`stub`), which is all this
    // file is about. Nothing here can reach a network.
    stripeCredentialsFor: vi.fn(() => null),
    createCheckoutSession: vi.fn(),
    retireCheckoutSession: vi.fn(),
    retrieveCheckoutSession: vi.fn(),
  };
});

import { reviseQuote } from "@/lib/catering/quotes";
import { createPaymentDue, syncDuePaymentAmount } from "@/lib/catering/payments";
import { initiatePayment, PortalQuoteError } from "@/lib/portal/quotes";
import type { AuthContext } from "@/lib/session";

const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const V1 = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const DEPOSIT = "d0000000-0000-4000-8000-000000000001";

const owner = { user: { id: "u1", role: "owner" }, locations: [LOCATION] } as unknown as AuthContext;

/** The revision: 6 trays at $200 = $1,200 total; deposit 25% = $300 (v1 asks $200). */
const BIGGER = { eventDate: "2099-06-01", headcount: 60, lines: [{ description: "Sub tray", quantity: 6, unitPriceCents: 20000 }] };

/** v1: $800 total, $200 deposit. */
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
    subtotal_cents: 80000,
    delivery_fee_cents: 0,
    service_charge_cents: 0,
    gratuity_cents: 0,
    tax_cents: 0,
    total_cents: 80000,
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
    sent_at: "2026-11-01T00:00:00.000Z",
    sent_by: "u1",
    superseded_at: null,
  };
}

/** A due deposit intent on v1 at a STALE amount ($150; v1 asks $200), with no checkout. */
function staleDeposit(over: Row = {}): Row {
  return {
    id: DEPOSIT,
    quote_id: V1,
    customer_id: CUSTOMER,
    kind: "deposit",
    amount_cents: 15000,
    currency: "usd",
    status: "due",
    provider: null,
    provider_ref: null,
    provider_session_id: null,
    created_at: "2026-11-01T00:00:01.000Z",
    paid_at: null,
    created_by: CUSTOMER,
    ...over,
  };
}

const payments = () => db.tables.catering_payments!;
const deposit = () => payments().find((p) => p.id === DEPOSIT)!;
const liveQuote = () => db.tables.catering_quotes!.find((q) => q.superseded_at == null)!;

type Op = { table: string; kind: "select" | "insert" | "update"; payload: unknown };

/**
 * Let a manager's revise (v1 → v2, deposit $300) run TO COMPLETION immediately before the
 * first statement `at` matches — i.e. between the caller's read and that write.
 */
function reviseJustBefore(at: (op: Op) => boolean): { revised: () => boolean } {
  let done = false;
  db.beforeOp = async (op) => {
    if (!at(op)) return;
    db.beforeOp = null; // the revise's own statements run free
    await reviseQuote(owner, V1, BIGGER);
    done = true;
  };
  return { revised: () => done };
}

const isReprice = (op: Op) => op.table === "catering_payments" && op.kind === "update" && "amount_cents" in (op.payload as Row);
const isIntentInsert = (op: Op) => op.table === "catering_payments" && op.kind === "insert";

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
  db = paymentsFake({
    catering_quotes: [v1()],
    catering_quote_items: [],
    catering_pricing_rules: [
      { location_id: LOCATION, active: true, tax_rate_bps: 0, gratuity_bps: 0, service_charge_bps: 0, deposit_pct_bps: 2500, tax_on_delivery: true, tax_on_gratuity: false },
    ],
    catering_delivery_zones: [],
    catering_payments: [staleDeposit()],
    locations: [{ id: LOCATION, code: "EM" }],
    stripe_events: [],
  });
});

describe("W02 review r5 — a re-price decided on one revision never lands on another", () => {
  it("the pay tap: a revise between the read and the re-price — v2's $300 is NOT overwritten with v1's $200, and the tap is refused", async () => {
    const race = reviseJustBefore(isReprice);

    const err = await refusal(initiatePayment(CUSTOMER, V1, "deposit"));

    expect(race.revised()).toBe(true);
    const v2 = liveQuote();
    expect(v2.id).not.toBe(V1);
    expect(v2.deposit_cents).toBe(30000);
    // The carry moved the intent to v2 and priced it for v2. That is the amount that stands.
    // The bug: $200 — v1's deposit — written onto v2's intent by the resumed pay tap.
    expect(deposit()).toMatchObject({ quote_id: v2.id, status: "due", amount_cents: 30000 });
    // The customer was looking at an offer that no longer exists.
    expect(err).toMatchObject({ status: 409, code: "not_payable" });
    expect(payments()).toHaveLength(1);
  });

  it("`createPaymentDue` reusing an existing intent: a revise between its read and its re-price leaves v2's amount alone, and it throws", async () => {
    const race = reviseJustBefore(isReprice);

    // The (quote, kind) due intent already exists, so the insert is refused (0130) and the
    // helper re-prices the existing row instead — from v1's amount, read before the revise.
    await expect(
      createPaymentDue(db.client, { quoteId: V1, customerId: CUSTOMER, kind: "deposit", amountCents: 20000, createdBy: CUSTOMER }),
    ).rejects.toThrow(/createPaymentDue re-price/);

    expect(race.revised()).toBe(true);
    expect(deposit()).toMatchObject({ quote_id: liveQuote().id, status: "due", amount_cents: 30000 });
    expect(payments()).toHaveLength(1);
  });

  it("…and with no revise in between, both still re-price the intent on the quote they read (the guard costs nothing)", async () => {
    const tap = await initiatePayment(CUSTOMER, V1, "deposit");
    expect(tap).toMatchObject({ paymentId: DEPOSIT, amountCents: 20000 });
    expect(deposit()).toMatchObject({ quote_id: V1, status: "due", amount_cents: 20000 });

    deposit().amount_cents = 15000;
    await createPaymentDue(db.client, { quoteId: V1, customerId: CUSTOMER, kind: "deposit", amountCents: 20000, createdBy: CUSTOMER });
    expect(deposit()).toMatchObject({ quote_id: V1, status: "due", amount_cents: 20000 });
  });

  it("`syncDuePaymentAmount` itself: the write names the quote, and matches nothing once the intent is on another one", async () => {
    // On the quote the amount was computed from: written.
    expect(await syncDuePaymentAmount(db.client, { paymentId: DEPOSIT, quoteId: V1, amountCents: 20000 })).toBe(true);
    expect(deposit().amount_cents).toBe(20000);

    // The intent has moved (a revise's carry): the same call writes nothing.
    await reviseQuote(owner, V1, BIGGER);
    expect(deposit().amount_cents).toBe(30000);
    expect(await syncDuePaymentAmount(db.client, { paymentId: DEPOSIT, quoteId: V1, amountCents: 20000 })).toBe(false);
    expect(deposit()).toMatchObject({ quote_id: liveQuote().id, amount_cents: 30000 });

    // The retired-session form is bound to the quote in exactly the same way.
    Object.assign(deposit(), { provider_session_id: "cs_gone" });
    expect(await syncDuePaymentAmount(db.client, { paymentId: DEPOSIT, quoteId: V1, amountCents: 20000, retiredSessionId: "cs_gone" })).toBe(false);
    expect(deposit()).toMatchObject({ amount_cents: 30000, provider_session_id: "cs_gone" });
    expect(
      await syncDuePaymentAmount(db.client, { paymentId: DEPOSIT, quoteId: liveQuote().id as string, amountCents: 31000, retiredSessionId: "cs_gone" }),
    ).toBe(true);
    expect(deposit()).toMatchObject({ amount_cents: 31000, provider_session_id: null });
  });
});

describe("W02 review r5 — an intent raised on a revision superseded under the pay tap", () => {
  beforeEach(() => {
    db.tables.catering_payments = []; // no intent yet: the pay tap raises one
  });

  it("a revise between the payability read and the insert: the intent the tap raised is closed, and the tap is refused `not_payable`", async () => {
    const race = reviseJustBefore(isIntentInsert);

    const err = await refusal(initiatePayment(CUSTOMER, V1, "deposit"));

    expect(race.revised()).toBe(true);
    expect(err).toMatchObject({ status: 409, code: "not_payable" });
    // The bug: `{ ok: true }` for a $200 deposit on v1 — an offer that had been replaced.
    // Nothing is left due on the superseded revision.
    expect(payments().filter((p) => p.status === "due")).toEqual([]);
    expect(payments()).toHaveLength(1);
    expect(payments()[0]).toMatchObject({ quote_id: V1, status: "void" });
    expect(payments()[0]!.provider_session_id ?? null).toBeNull();
  });

  it("with no revise, the tap raises its intent on the live quote as before", async () => {
    const tap = await initiatePayment(CUSTOMER, V1, "deposit");
    expect(tap).toMatchObject({ amountCents: 20000, stub: true });
    expect(payments()).toHaveLength(1);
    expect(payments()[0]).toMatchObject({ quote_id: V1, status: "due", amount_cents: 20000 });
  });
});
