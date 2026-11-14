/**
 * Unit spine — lib/portal/quotes.ts, the customer's side of the money path (audit wave W02).
 *
 * NO DB, NO NETWORK: `getServiceRoleClient` is replaced by tests/payments-fake-client.ts (a
 * predicate-aware in-memory client that really applies every filter and reports rowcounts),
 * `audit` is mocked, and the three Stripe calls are mocked at the module boundary. What is
 * left under test is exactly the part that decides: which quotes may be paid, what amount an
 * intent carries, which Stripe account a checkout lands in, and how many checkouts one
 * quote may have open at a time.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";

let db: PaymentsFake;

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/stripe/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe/client")>();
  return {
    ...actual,
    stripeCredentialsFor: vi.fn(),
    createCheckoutSession: vi.fn(),
    retireCheckoutSession: vi.fn(),
  };
});

import { createCheckoutSession, retireCheckoutSession, stripeCredentialsFor, StripeError } from "@/lib/stripe/client";
import {
  createQuoteCheckout,
  initiatePayment,
  paymentsOnlineForLocation,
  PortalQuoteError,
} from "@/lib/portal/quotes";

const credsMock = vi.mocked(stripeCredentialsFor);
const createSessionMock = vi.mocked(createCheckoutSession);
const retireMock = vi.mocked(retireCheckoutSession);

const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const QUOTE = "a0000000-0000-4000-8000-000000000001";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const PAYMENT = "d0000000-0000-4000-8000-000000000001";

const FAR_EVENT = "2099-06-01"; // far enough out that a staff quote offers deposit OR full
const FUTURE = "2099-01-01T00:00:00.000Z";

function quoteRow(over: Row = {}): Row {
  return {
    id: QUOTE,
    root_id: null,
    customer_id: CUSTOMER,
    location_id: LOCATION,
    origin: "staff",
    status: "sent",
    superseded_at: null,
    event_date: FAR_EVENT,
    expires_at: FUTURE,
    deposit_cents: 20000,
    total_cents: 100000,
    ...over,
  };
}

function dueRow(over: Row = {}): Row {
  return {
    id: PAYMENT,
    quote_id: QUOTE,
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

/** A shop with its OWN Stripe account (code EM) beside a shared default pair. */
function twoAccounts() {
  credsMock.mockImplementation((code?: string | null) =>
    code === "EM"
      ? { secretKey: "sk_shop", webhookSecret: "whsec_shop", source: "location" }
      : { secretKey: "sk_shared", webhookSecret: "whsec_shared", source: "default" },
  );
}

const checkoutInput = (over: Record<string, unknown> = {}) => ({
  customerId: CUSTOMER,
  customerEmail: "customer@example.com",
  quoteId: QUOTE,
  kind: "deposit" as const,
  paymentId: PAYMENT,
  amountCents: 20000,
  appOrigin: "https://portal.example.com",
  ...over,
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
  credsMock.mockReset();
  createSessionMock.mockReset();
  createSessionMock.mockResolvedValue({ id: "cs_new", url: "https://checkout.stripe.test/cs_new" });
  retireMock.mockReset();
  retireMock.mockResolvedValue("expired");
  twoAccounts();
  db = paymentsFake({
    catering_quotes: [quoteRow()],
    locations: [{ id: LOCATION, code: "EM" }],
    catering_payments: [],
  });
});

describe("W02/B146 — a FAILED shop lookup never resolves the shared Stripe account", () => {
  it("createQuoteCheckout: a locations read error is a 503, and no session is minted anywhere", async () => {
    db.tables.catering_payments!.push(dueRow());
    db.failSelect.push("locations");

    const err = await refusal(createQuoteCheckout(checkoutInput()));

    expect(err.status).toBe(503);
    expect(err.code).toBe("payment_unavailable");
    expect(createSessionMock).not.toHaveBeenCalled();
    // The bug: the failed read became `null`, and `stripeCredentialsFor(null)` handed back
    // the SHARED pair for a shop that has its own account.
    expect(credsMock).not.toHaveBeenCalled();
    expect(db.tables.catering_payments![0]).toMatchObject({ provider_session_id: null, status: "due" });
  });

  it("createQuoteCheckout: the healthy path still charges the SHOP's own account", async () => {
    db.tables.catering_payments!.push(dueRow());

    await createQuoteCheckout(checkoutInput());

    expect(credsMock).toHaveBeenCalledWith("EM");
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock.mock.calls[0]![0]).toBe("sk_shop");
  });

  it("initiatePayment: a locations read error is a 503 — it does not report `stub` from a guess", async () => {
    db.failSelect.push("locations");

    const err = await refusal(initiatePayment(CUSTOMER, QUOTE, "deposit"));

    expect(err.status).toBe(503);
    expect(err.code).toBe("payment_unavailable");
    expect(credsMock).not.toHaveBeenCalled();
  });

  it("a location row that is MISSING is a failure too, not a shop with no code", async () => {
    db.tables.catering_payments!.push(dueRow());
    db.tables.locations = [];

    const err = await refusal(createQuoteCheckout(checkoutInput()));
    expect(err.status).toBe(503);
    expect(credsMock).not.toHaveBeenCalled();
  });

  it("ONLY a successful read of a row whose code is null falls back to the shared pair", async () => {
    db.tables.catering_payments!.push(dueRow());
    db.tables.locations = [{ id: LOCATION, code: null }];

    await createQuoteCheckout(checkoutInput());

    expect(credsMock).toHaveBeenCalledWith(null);
    expect(createSessionMock.mock.calls[0]![0]).toBe("sk_shared");
  });

  it("paymentsOnlineForLocation: an unknown shop makes NO payment promise (false), from no credential read", async () => {
    db.failSelect.push("locations");
    expect(await paymentsOnlineForLocation(LOCATION)).toBe(false);
    expect(credsMock).not.toHaveBeenCalled();

    // …and the healthy read still answers from the shop's own pair.
    expect(await paymentsOnlineForLocation(LOCATION)).toBe(true);
    expect(credsMock).toHaveBeenCalledWith("EM");
  });
});

describe("W02/B037 — an expired quote cannot be paid", () => {
  const PAST = "2020-01-01T00:00:00.000Z";

  it("a SENT quote past its expires_at is refused 409 quote_expired, and no intent is written", async () => {
    db.tables.catering_quotes = [quoteRow({ status: "sent", expires_at: PAST })];

    const err = await refusal(initiatePayment(CUSTOMER, QUOTE, "deposit"));

    expect(err.status).toBe(409);
    expect(err.code).toBe("quote_expired");
    expect(db.tables.catering_payments).toEqual([]);
  });

  it("a self-serve SUBMITTED order past its window is refused the same way", async () => {
    db.tables.catering_quotes = [quoteRow({ status: "submitted", origin: "self_serve", expires_at: PAST })];
    expect((await refusal(initiatePayment(CUSTOMER, QUOTE, "deposit"))).code).toBe("quote_expired");
  });

  it("a quote a manager marked `expired` answers quote_expired too", async () => {
    db.tables.catering_quotes = [quoteRow({ status: "expired" })];
    expect((await refusal(initiatePayment(CUSTOMER, QUOTE, "deposit"))).code).toBe("quote_expired");
  });

  it("the CHECKOUT step re-checks it: an intent raised in time cannot mint a session after the date", async () => {
    db.tables.catering_quotes = [quoteRow({ status: "sent", expires_at: PAST })];
    db.tables.catering_payments!.push(dueRow());

    const err = await refusal(createQuoteCheckout(checkoutInput()));

    expect(err.code).toBe("quote_expired");
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("an offer still inside its window pays as before", async () => {
    const out = await initiatePayment(CUSTOMER, QUOTE, "deposit");
    expect(out).toMatchObject({ ok: true, amountCents: 20000, stub: false });
    expect(db.tables.catering_payments).toHaveLength(1);
  });

  it("a team-CONFIRMED order is not judged by the offer's clock", async () => {
    db.tables.catering_quotes = [quoteRow({ status: "accepted", expires_at: PAST })];
    expect((await initiatePayment(CUSTOMER, QUOTE, "deposit")).ok).toBe(true);
  });

  it("superseded and declined keep their existing refusal", async () => {
    db.tables.catering_quotes = [quoteRow({ superseded_at: PAST })];
    expect((await refusal(initiatePayment(CUSTOMER, QUOTE, "deposit"))).code).toBe("not_payable");
    db.tables.catering_quotes = [quoteRow({ status: "declined" })];
    expect((await refusal(initiatePayment(CUSTOMER, QUOTE, "deposit"))).code).toBe("not_payable");
  });
});

describe("W02/B038 — a draft cannot be paid, and a reused intent carries the CURRENT amount", () => {
  it("a DRAFT is refused 409 not_payable and no intent is written", async () => {
    db.tables.catering_quotes = [quoteRow({ status: "draft", origin: "self_serve", expires_at: null })];

    const err = await refusal(initiatePayment(CUSTOMER, QUOTE, "deposit"));

    expect(err.status).toBe(409);
    expect(err.code).toBe("not_payable");
    expect(db.tables.catering_payments).toEqual([]);
  });

  it("a status this code does not know is not payable either — only submitted / sent / accepted are", async () => {
    db.tables.catering_quotes = [quoteRow({ status: "something_new" })];
    expect((await refusal(initiatePayment(CUSTOMER, QUOTE, "deposit"))).code).toBe("not_payable");
  });

  it("REUSING a due intent re-prices it to the quote's current snapshot", async () => {
    // The intent was raised when the deposit was $150; the order has since grown to $200.
    db.tables.catering_payments!.push(dueRow({ amount_cents: 15000 }));

    const out = await initiatePayment(CUSTOMER, QUOTE, "deposit");

    expect(out.paymentId).toBe(PAYMENT);
    expect(out.amountCents).toBe(20000);
    expect(db.tables.catering_payments).toHaveLength(1);
    // The ROW is what the webhook and the staff board read — it must say what is owed now.
    expect(db.tables.catering_payments![0]!.amount_cents).toBe(20000);
  });

  it("a due intent already at the current amount is reused without a write", async () => {
    db.tables.catering_payments!.push(dueRow());

    await initiatePayment(CUSTOMER, QUOTE, "deposit");

    expect(db.ops.filter((o) => o.table === "catering_payments" && o.kind === "update")).toEqual([]);
  });

  it("a re-price that loses the race to a payment is refused, never silently skipped", async () => {
    const row = dueRow({ amount_cents: 15000 });
    db.tables.catering_payments!.push(row);
    // The row is read as `due`, then advanced before the guarded re-price lands.
    const client = db.client as unknown as { from: (t: string) => Record<string, unknown> };
    const realFrom = client.from;
    let armed = true;
    client.from = (table: string) => {
      const q = realFrom(table);
      if (table === "catering_payments" && armed) {
        const update = q.update as (p: unknown, o?: unknown) => unknown;
        q.update = (p: unknown, o?: unknown) => {
          armed = false;
          row.status = "paid";
          return update(p, o);
        };
      }
      return q;
    };

    const err = await refusal(initiatePayment(CUSTOMER, QUOTE, "deposit"));

    expect(err.code).toBe("not_due");
    expect(row.amount_cents).toBe(15000);
  });
});

describe("W02/B035 — one open checkout per quote", () => {
  const FULL = "d0000000-0000-4000-8000-000000000002";
  const fullRow = (over: Row = {}) => dueRow({ id: FULL, kind: "full", amount_cents: 100000, ...over });
  const fullInput = (over: Record<string, unknown> = {}) =>
    checkoutInput({ kind: "full" as const, paymentId: FULL, amountCents: 100000, ...over });
  const byId = (id: string) => db.tables.catering_payments!.find((r) => r.id === id)!;

  it("opening the FULL checkout retires the DEPOSIT session first — it can no longer be paid", async () => {
    db.tables.catering_payments!.push(dueRow({ provider: "stripe", provider_session_id: "cs_dep" }), fullRow());
    const order: string[] = [];
    retireMock.mockImplementation(async (_key, id) => {
      order.push(`retire:${id}`);
      return "expired";
    });
    createSessionMock.mockImplementation(async () => {
      order.push("mint");
      return { id: "cs_new", url: "https://checkout.stripe.test/cs_new" };
    });

    const out = await createQuoteCheckout(fullInput());

    expect(out.url).toBe("https://checkout.stripe.test/cs_new");
    // Retired with the SHOP's key, and BEFORE a second way to pay exists.
    expect(retireMock).toHaveBeenCalledWith("sk_shop", "cs_dep");
    expect(order).toEqual(["retire:cs_dep", "mint"]);
    // The deposit intent stays `due` (the customer may still choose it later) but points at nothing.
    expect(byId(PAYMENT)).toMatchObject({ status: "due", provider_session_id: null });
    expect(byId(FULL)).toMatchObject({ status: "due", provider: "stripe", provider_session_id: "cs_new" });
  });

  it("if the other checkout is already COMPLETE, no second checkout is offered: 409 payment_in_progress", async () => {
    db.tables.catering_payments!.push(dueRow({ provider: "stripe", provider_session_id: "cs_dep" }), fullRow());
    retireMock.mockResolvedValue("complete");

    const err = await refusal(createQuoteCheckout(fullInput()));

    expect(err.status).toBe(409);
    expect(err.code).toBe("payment_in_progress");
    expect(createSessionMock).not.toHaveBeenCalled();
    // The completing session keeps its id, so the webhook's fallback lookup still finds its row.
    expect(byId(PAYMENT).provider_session_id).toBe("cs_dep");
    expect(byId(FULL).provider_session_id).toBeNull();
  });

  it("if the other checkout cannot be retired, it FAILS CLOSED: 502, and nothing is minted", async () => {
    db.tables.catering_payments!.push(dueRow({ provider: "stripe", provider_session_id: "cs_dep" }), fullRow());
    retireMock.mockRejectedValue(new StripeError(502, "network_error", "socket hang up"));

    const err = await refusal(createQuoteCheckout(fullInput()));

    expect(err.status).toBe(502);
    expect(err.code).toBe("provider_error");
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(byId(PAYMENT).provider_session_id).toBe("cs_dep");
  });

  it("a RE-PRICED intent retires its own earlier session (the one at the old amount)", async () => {
    db.tables.catering_payments!.push(dueRow({ provider: "stripe", provider_session_id: "cs_old" }));

    await createQuoteCheckout(checkoutInput());

    expect(retireMock).toHaveBeenCalledWith("sk_shop", "cs_old");
    expect(byId(PAYMENT).provider_session_id).toBe("cs_new");
  });

  it("the SAME session coming back (an idempotent replay) is not retired from under the customer", async () => {
    db.tables.catering_payments!.push(dueRow({ provider: "stripe", provider_session_id: "cs_new" }));

    const out = await createQuoteCheckout(checkoutInput());

    expect(out.url).toBe("https://checkout.stripe.test/cs_new");
    expect(retireMock).not.toHaveBeenCalled();
  });

  it("if the intent's own earlier session is COMPLETE, the new one is abandoned and nothing is offered", async () => {
    db.tables.catering_payments!.push(dueRow({ provider: "stripe", provider_session_id: "cs_old" }));
    retireMock.mockImplementation(async (_key, id) => (id === "cs_old" ? "complete" : "expired"));

    const err = await refusal(createQuoteCheckout(checkoutInput()));

    expect(err.code).toBe("payment_in_progress");
    // The session we just minted is closed again, and the row still names the one being paid.
    expect(retireMock).toHaveBeenCalledWith("sk_shop", "cs_new");
    expect(byId(PAYMENT).provider_session_id).toBe("cs_old");
  });

  it("a quote with no other open checkout is untouched by any of this", async () => {
    db.tables.catering_payments!.push(dueRow(), fullRow());

    await createQuoteCheckout(fullInput());

    expect(retireMock).not.toHaveBeenCalled();
    expect(byId(FULL).provider_session_id).toBe("cs_new");
  });

  it("a PAID or VOID sibling's old session id is not chased — only `due` rows can still be paid into", async () => {
    db.tables.catering_payments!.push(
      dueRow({ status: "void", provider: "stripe", provider_session_id: "cs_void" }),
      fullRow(),
    );

    await createQuoteCheckout(fullInput());

    expect(retireMock).not.toHaveBeenCalled();
  });

  it("with migration 0303's index, a RACING second checkout loses at the database and is abandoned", async () => {
    db.enforceOneOpenCheckout = true;
    db.tables.catering_payments!.push(dueRow(), fullRow());
    // Another request attaches a session to the deposit intent while ours is at Stripe.
    createSessionMock.mockImplementation(async () => {
      byId(PAYMENT).provider_session_id = "cs_racer";
      return { id: "cs_new", url: "https://checkout.stripe.test/cs_new" };
    });

    const err = await refusal(createQuoteCheckout(fullInput()));

    expect(err.status).toBe(409);
    expect(err.code).toBe("payment_in_progress");
    expect(retireMock).toHaveBeenCalledWith("sk_shop", "cs_new");
    expect(byId(FULL).provider_session_id).toBeNull();
    expect(byId(PAYMENT).provider_session_id).toBe("cs_racer");
  });

  it("the pay buttons have a sentence for the new refusal, in both languages", async () => {
    const { readFileSync } = await import("node:fs");
    const en = JSON.parse(readFileSync("lib/i18n/en.json", "utf8")) as Record<string, string>;
    const es = JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>;
    expect(en["order.quote.error_in_progress"]).toBeTruthy();
    expect(es["order.quote.error_in_progress"]).toBeTruthy();
    expect(readFileSync("app/order/quote/[id]/pay-buttons.tsx", "utf8")).toContain('payment_in_progress: "order.quote.error_in_progress"');
  });
});
