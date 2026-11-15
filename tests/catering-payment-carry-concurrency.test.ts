/**
 * Unit spine — TWO reconciliations of one quote family at once (audit wave W02, review r2's
 * P1 "Concurrent reconciliation can erase a new checkout").
 *
 * The doors (`sendQuote`, an accept, the portal's pay gate) re-run the payment carry when a
 * payment is stranded on an earlier revision. Two customer requests can therefore both read
 * the same stranded intent:
 *
 *   A  reads the intent · carries it onto the live revision · attaches checkout S1
 *   B  read the same intent · resumes its STALE pass · writes `provider_session_id: null`
 *      (its write was guarded on `id` + `status = 'due'` only) · attaches checkout S2
 *
 * S1 is still open at Stripe and nothing of ours names it any more: two payable checkouts
 * for one order, and migration 0303's index cannot help because S1's reference is gone.
 *
 * THE RULE PINNED HERE: a carry write is a COMPARE-AND-SET on the row as that pass read it
 * (status, quote id AND checkout session). A write that matches nothing re-reads; a row
 * another request moved or gave a checkout is never rewritten from the stale read, and the
 * pass is run again from a fresh one. A session another request attached is never cleared.
 *
 * The interleaving is real: two fake "connections" (tests/payments-fake-client.ts) share
 * one set of rows, and request B is held at its first payment write while request A runs
 * to the end. Stripe is tests/stripe-fake.ts. No DB, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";
import { stripeFake, type StripeFake } from "./stripe-fake";

let db: PaymentsFake;
/** The connection the NEXT `getServiceRoleClient()` call hands out. */
let current: PaymentsFake;
let stripe: StripeFake;

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => current.client }));
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

import { carryPaymentsToRevision, reconcileFamilyPayments } from "@/lib/catering/payment-carry";
import { createQuoteCheckout, initiatePayment, PortalQuoteError } from "@/lib/portal/quotes";
import * as stripeClient from "@/lib/stripe/client";

const createSessionMock = vi.mocked(stripeClient.createCheckoutSession);
const retireMock = vi.mocked(stripeClient.retireCheckoutSession);
const retrieveMock = vi.mocked(stripeClient.retrieveCheckoutSession);

const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const V1 = "a0000000-0000-4000-8000-000000000001"; // the root, superseded
const V2 = "a0000000-0000-4000-8000-000000000002"; // the live revision
const V3 = "a0000000-0000-4000-8000-000000000003";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const INTENT = "d0000000-0000-4000-8000-000000000001";

function quoteRow(over: Row = {}): Row {
  return {
    id: V2,
    root_id: V1,
    customer_id: CUSTOMER,
    location_id: LOCATION,
    origin: "staff",
    status: "sent",
    superseded_at: null,
    event_date: "2099-06-01",
    expires_at: "2099-01-01T00:00:00.000Z",
    deposit_cents: 25000,
    total_cents: 120000,
    ...over,
  };
}

/** A due deposit raised on v1 at v1's price, still stranded there. */
function strandedDeposit(over: Row = {}): Row {
  return {
    id: INTENT,
    quote_id: V1,
    customer_id: CUSTOMER,
    kind: "deposit",
    amount_cents: 20000,
    currency: "usd",
    status: "due",
    provider: null,
    provider_ref: null,
    provider_session_id: null,
    created_at: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

const payments = () => db.tables.catering_payments!;
const intent = () => payments().find((p) => p.id === INTENT)!;
const openSessions = () => [...stripe.sessions.values()].filter((s) => s.status === "open");

/**
 * Hold a connection at its FIRST write to `catering_payments`: the write is built and then
 * waits. `reached` resolves when the request has got that far (so it has done all its
 * reads); `release()` lets the write — and everything after it — run.
 */
function holdFirstPaymentWrite(fake: PaymentsFake): { reached: Promise<void>; release: () => void } {
  let signalReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((r) => (signalReached = r));
  const gate = new Promise<void>((r) => (release = r));
  const client = fake.client as unknown as { from: (t: string) => Record<string, unknown> };
  const realFrom = client.from;
  let armed = true;
  client.from = (table: string) => {
    const q = realFrom(table);
    if (table !== "catering_payments") return q;
    const update = q.update as (p: unknown, o?: unknown) => unknown;
    q.update = (p: unknown, o?: unknown) => {
      const built = update(p, o);
      if (armed) {
        armed = false;
        const then = q.then as (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>;
        q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          signalReached();
          return gate.then(() => then(res, rej));
        };
      }
      return built;
    };
    return q;
  };
  return { reached, release };
}

/** The pay route's two steps, exactly as app/api/portal/quote/[id]/pay/route.ts runs them. */
async function checkoutFor(intentResult: { paymentId: string; amountCents: number }, kind: "deposit" | "full" = "deposit"): Promise<string> {
  const checkout = await createQuoteCheckout({
    customerId: CUSTOMER,
    customerEmail: "customer@example.com",
    quoteId: V2,
    kind,
    paymentId: intentResult.paymentId,
    amountCents: intentResult.amountCents,
    appOrigin: "https://portal.example.com",
  });
  return checkout.url;
}
async function tapPay(): Promise<string> {
  return checkoutFor(await initiatePayment(CUSTOMER, V2, "deposit"));
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

beforeEach(() => {
  stripe = stripeFake();
  createSessionMock.mockReset();
  createSessionMock.mockImplementation(stripe.create);
  retireMock.mockReset();
  retireMock.mockImplementation(stripe.retire);
  retrieveMock.mockReset();
  retrieveMock.mockImplementation(stripe.retrieve);
  db = paymentsFake({
    catering_quotes: [
      { ...quoteRow(), id: V1, root_id: null, superseded_at: "2026-11-10T00:00:00.000Z", deposit_cents: 20000, total_cents: 100000 },
      quoteRow(),
    ],
    locations: [{ id: LOCATION, code: "EM" }],
    catering_payments: [],
  });
  current = db;
});

describe("W02 review r2 (P1) — two pay requests reconcile the same stranded intent", () => {
  /**
   * Run request B up to its first payment write (it has read the stranded intent), run
   * request A to the end, then let B finish. Returns both requests' checkout URLs.
   */
  async function interleave(): Promise<{ urlA: string; urlB: string }> {
    const connB = paymentsFake(db.tables); // a second connection over the SAME rows
    const hold = holdFirstPaymentWrite(connB);

    current = connB;
    const bIntent = initiatePayment(CUSTOMER, V2, "deposit"); // takes connB synchronously
    current = db;
    await hold.reached; // B has read the family and is about to write its stale carry

    const urlA = await tapPay(); // A: reconcile → intent → checkout, start to finish

    hold.release();
    const urlB = await checkoutFor(await bIntent);
    return { urlA, urlB };
  }

  it("the stale request never erases the checkout the other attached: ONE open checkout, and the row names it", async () => {
    payments().push(strandedDeposit());

    const { urlA, urlB } = await interleave();

    // Exactly one way to pay exists at Stripe, and it is the one our row points at.
    const open = openSessions();
    expect(open).toHaveLength(1);
    expect(intent()).toMatchObject({ quote_id: V2, status: "due", amount_cents: 25000, provider_session_id: open[0]!.id });
    // Both taps were for the same attempt, so both customers' tabs hold the SAME checkout.
    expect(stripe.byUrl(urlA)!.id).toBe(open[0]!.id);
    expect(urlB).toBe(urlA);
    expect(stripe.creates).toHaveLength(1);
  });

  it("…also when the stranded intent still pointed at a checkout from the old revision", async () => {
    const old = await stripe.create("sk_shop", {
      quoteId: V1, paymentId: INTENT, kind: "deposit", amountCents: 20000, currency: "usd",
      productName: "x", description: "x", customerEmail: "customer@example.com", successUrl: "https://x/s", cancelUrl: "https://x/c",
    }, "old-key");
    payments().push(strandedDeposit({ provider: "stripe", provider_session_id: old.id }));

    const { urlA, urlB } = await interleave();

    expect(stripe.sessions.get(old.id)!.status).toBe("expired"); // the old-price checkout is gone
    const open = openSessions();
    expect(open).toHaveLength(1);
    expect(open[0]!.amountCents).toBe(25000);
    expect(intent().provider_session_id).toBe(open[0]!.id);
    expect(urlB).toBe(urlA);
  });

  it("with migration 0303's index in force the outcome is the same", async () => {
    db.enforceOneOpenCheckout = true;
    payments().push(strandedDeposit());

    await interleave();

    expect(openSessions()).toHaveLength(1);
    expect(intent().provider_session_id).toBe(openSessions()[0]!.id);
  });
});

describe("W02 review r2 (P1) — a carry write is a compare-and-set on what the pass read", () => {
  const toV2 = { rootId: V1, newQuoteId: V2, depositCents: 25000, totalCents: 120000 };
  const retire = vi.fn(async (id: string) => stripe.retire("sk_shop", id));

  /** The next write to catering_payments is preceded by `mutate()` — another request winning. */
  function beforeNextPaymentWrite(mutate: () => void) {
    const client = db.client as unknown as { from: (t: string) => Record<string, unknown> };
    const realFrom = client.from;
    let armed = true;
    client.from = (table: string) => {
      const q = realFrom(table);
      if (table === "catering_payments" && armed) {
        const update = q.update as (p: unknown, o?: unknown) => unknown;
        q.update = (p: unknown, o?: unknown) => {
          armed = false;
          mutate();
          return update(p, o);
        };
      }
      return q;
    };
  }

  // Braces on purpose: `mockClear()` returns the mock, and a FUNCTION returned from a hook is
  // run by vitest as that hook's cleanup — i.e. `retire(undefined)` after every test.
  beforeEach(() => {
    retire.mockClear();
  });

  it("an intent another request already carried AND gave a checkout is left exactly as it is", async () => {
    payments().push(strandedDeposit());
    beforeNextPaymentWrite(() => {
      Object.assign(intent(), { quote_id: V2, amount_cents: 25000, provider: "stripe", provider_session_id: "cs_theirs" });
    });

    const out = await carryPaymentsToRevision(db.client, toV2, retire);

    expect(intent()).toMatchObject({ quote_id: V2, status: "due", amount_cents: 25000, provider_session_id: "cs_theirs" });
    // We moved nothing and re-priced nothing: it was the other request's work.
    expect(out.moved).toEqual([]);
    expect(out.carriedDue).toEqual([]);
    expect(out.voided).toEqual([]);
  });

  it("an intent headed for a VOID that another request carried first is not voided from the stale read", async () => {
    // A paid full payment in the family means the stale due deposit would be voided…
    payments().push(strandedDeposit({ id: "paid-full", kind: "full", status: "paid", amount_cents: 100000 }), strandedDeposit());
    // …but another request has already moved it and attached a checkout the customer may be paying.
    beforeNextPaymentWrite(() => {
      Object.assign(intent(), { quote_id: V2, provider: "stripe", provider_session_id: "cs_theirs" });
    });

    const out = await carryPaymentsToRevision(db.client, toV2, retire);

    expect(intent()).toMatchObject({ status: "due", provider_session_id: "cs_theirs" });
    expect(out.voided).toEqual([]);
  });

  it("a checkout attached to the STRANDED intent after our read is retired before the intent is carried — never just forgotten", async () => {
    payments().push(strandedDeposit());
    const late = await stripe.create("sk_shop", {
      quoteId: V1, paymentId: INTENT, kind: "deposit", amountCents: 20000, currency: "usd",
      productName: "x", description: "x", customerEmail: "customer@example.com", successUrl: "https://x/s", cancelUrl: "https://x/c",
    }, "late-key");
    // A request that loaded v1 before it was superseded records its checkout now.
    beforeNextPaymentWrite(() => {
      Object.assign(intent(), { provider: "stripe", provider_session_id: late.id });
    });

    const out = await carryPaymentsToRevision(db.client, toV2, retire);

    // The fresh pass saw the session, closed it at Stripe, and only then re-priced the row.
    expect(retire).toHaveBeenCalledWith(late.id);
    expect(stripe.sessions.get(late.id)!.status).toBe("expired");
    expect(intent()).toMatchObject({ quote_id: V2, status: "due", amount_cents: 25000, provider_session_id: null });
    expect(out.carriedDue).toEqual([{ paymentId: INTENT, kind: "deposit", fromCents: 20000, toCents: 25000 }]);
  });

  it("…and if that late checkout is already COMPLETE, the intent moves untouched: the money is landing", async () => {
    payments().push(strandedDeposit());
    const late = await stripe.create("sk_shop", {
      quoteId: V1, paymentId: INTENT, kind: "deposit", amountCents: 20000, currency: "usd",
      productName: "x", description: "x", customerEmail: "customer@example.com", successUrl: "https://x/s", cancelUrl: "https://x/c",
    }, "late-key");
    beforeNextPaymentWrite(() => {
      Object.assign(intent(), { provider: "stripe", provider_session_id: late.id });
      stripe.complete(late.id);
    });

    const out = await carryPaymentsToRevision(db.client, toV2, retire);

    expect(intent()).toMatchObject({ quote_id: V2, status: "due", amount_cents: 20000, provider_session_id: late.id });
    expect(out.inFlight).toEqual([INTENT]);
  });

  it("a settled row a newer pass already moved on is not pulled back", async () => {
    db.tables.catering_quotes!.push(quoteRow({ id: V3, root_id: V1, superseded_at: "2026-11-12T00:00:00.000Z" }));
    payments().push(strandedDeposit({ status: "paid", paid_at: "2026-11-02T00:00:00.000Z" }));
    beforeNextPaymentWrite(() => {
      intent().quote_id = V3;
    });

    const out = await carryPaymentsToRevision(db.client, toV2, retire);

    expect(intent().quote_id).toBe(V3);
    expect(out.moved).toEqual([]);
  });

  it("a family that keeps changing under the carry is given up on loudly, not looped on", async () => {
    payments().push(strandedDeposit());
    // Every pass finds the stranded intent with yet another session attached after its read.
    let n = 0;
    const client = db.client as unknown as { from: (t: string) => Record<string, unknown> };
    const realFrom = client.from;
    client.from = (table: string) => {
      const q = realFrom(table);
      if (table === "catering_payments") {
        const update = q.update as (p: unknown, o?: unknown) => unknown;
        q.update = (p: unknown, o?: unknown) => {
          intent().provider_session_id = `cs_churn_${++n}`;
          return update(p, o);
        };
      }
      return q;
    };

    await expect(carryPaymentsToRevision(db.client, toV2, retire)).rejects.toThrow(/kept changing/);
    expect(intent()).toMatchObject({ quote_id: V1, status: "due", amount_cents: 20000 });
  });
});

describe("W02 review r2 (P1) — a carry only writes onto the revision that is still live", () => {
  const toV2 = { rootId: V1, newQuoteId: V2, depositCents: 25000, totalCents: 120000 };

  it("a carry whose target was superseded in the meantime moves nothing", async () => {
    payments().push(strandedDeposit({ status: "paid" }), strandedDeposit({ id: "due-full", kind: "full", amount_cents: 100000 }));
    // A manager made revision 3 after this request loaded revision 2.
    db.tables.catering_quotes!.find((q) => q.id === V2)!.superseded_at = "2026-11-12T00:00:00.000Z";
    db.tables.catering_quotes!.push(quoteRow({ id: V3, root_id: V1 }));

    await expect(carryPaymentsToRevision(db.client, toV2, vi.fn(async () => "expired" as const))).rejects.toThrow(/no longer the live revision/);

    expect(payments().every((p) => p.quote_id === V1)).toBe(true);
    expect(payments().find((p) => p.id === "due-full")!.status).toBe("due");
  });

  it("the door reports it as NOT reconciled — the stale revision takes no money", async () => {
    payments().push(strandedDeposit({ status: "paid" }));
    db.tables.catering_quotes!.find((q) => q.id === V2)!.superseded_at = "2026-11-12T00:00:00.000Z";

    const out = await reconcileFamilyPayments(db.client, { id: V2, rootId: V1, locationId: LOCATION, depositCents: 25000, totalCents: 120000 });

    expect(out.reconciled).toBe(false);
    expect(out.error).toMatch(/no longer the live revision/);
  });
});

describe("W02 review r2 (P1) — a checkout is only attached to the intent it was minted for", () => {
  it("an intent a revise moved and re-priced while our session was at Stripe does not get that session", async () => {
    db.tables.catering_quotes = [quoteRow({ root_id: null })];
    const first = await initiatePayment(CUSTOMER, V2, "deposit");
    // While our mint is at Stripe, a manager revises: the carry moves the intent to v3 at v3's price.
    createSessionMock.mockImplementationOnce(async (key, input, idem) => {
      const mine = await stripe.create(key, input, idem);
      Object.assign(payments().find((p) => p.id === first.paymentId)!, { quote_id: V3, amount_cents: 30000 });
      return mine;
    });

    const err = await refusal(checkoutFor(first));

    expect(err.status).toBe(409);
    expect(err.code).toBe("not_payable");
    // The session priced for the old revision was closed, and the moved intent never named it.
    expect(openSessions()).toHaveLength(0);
    expect(payments().find((p) => p.id === first.paymentId)!.provider_session_id ?? null).toBeNull();
  });
});
