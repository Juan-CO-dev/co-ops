/**
 * Unit spine — SETTLEMENT racing a second CHECKOUT, and a checkout nobody confirmed closed
 * (audit wave W02, review r3's two P1s).
 *
 * ── P1 (1): "settlement can race a second checkout" ──────────────────────────────────
 * A staff quote far enough out offers a deposit OR the full amount. The already-paid gate
 * in `initiatePayment` is a read; the intent insert and the checkout come after it:
 *
 *   full request   passes the already-paid gate (nothing is paid yet)
 *   deposit        its webhook lands: the deposit is `paid`; there is no `full` intent yet
 *                  for the webhook to void
 *   full request   resumes: inserts its intent, mints a checkout, attaches it
 *
 * `createQuoteCheckout` looked only at DUE rows that hold a session, so the paid deposit
 * neither blocked the checkout nor collided with migration 0303's index: the customer could
 * pay the deposit AND the whole total.
 *
 * THE RULE PINNED HERE: settlement and checkout eligibility are decided per QUOTE, at the
 * moment a checkout is reserved and again at the moment it is attached. A paid row on the
 * quote refuses both (409 `already_paid`), the session minted for the refused request is
 * closed, and the intent raised for it is voided. With migration 0303 applied the attach is
 * `catering_payment_attach_checkout`, which decides under the quote's row lock; before it
 * is applied the app re-reads after its own write (each side writes, then reads the other's
 * write — at least one of them always sees the other). And the other direction is closed
 * too: a settlement that lands AFTER a checkout was attached closes that checkout.
 *
 * ── P1 (2): "voiding an intent does not close its Stripe session" ────────────────────
 * A revise that makes the deposit requirement zero voids the deposit intent. If retiring
 * its Checkout Session failed, the row was moved as `void` WITH the session id — still
 * payable at Stripe — and the next full-payment request ignored it (it only looked at `due`
 * rows) and opened a second checkout.
 *
 * THE RULE PINNED HERE: a session id on a `due` OR `void` row is an UNRESOLVED checkout.
 * It blocks every new collection on the quote until Stripe confirms it retired (502 when
 * Stripe will not, 409 when its money is already landing); only then is its id cleared and
 * a replacement offered.
 *
 * The interleavings are real: two fake "connections" (tests/payments-fake-client.ts) share
 * one set of rows, and one request is HELD at a chosen write while the other side runs to
 * the end. Stripe is tests/stripe-fake.ts. No DB, no network, no Stripe.
 */
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { apply0303, paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";
import { stripeFake, type StripeFake } from "./stripe-fake";

let db: PaymentsFake;
/** The connection the NEXT `getServiceRoleClient()` call hands out. */
let current: PaymentsFake;
let stripe: StripeFake;

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => current.client }));
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
import { carryPaymentsToRevision } from "@/lib/catering/payment-carry";
import { closeQuoteCheckouts } from "@/lib/catering/payment-sessions";
import { markPaymentPaid } from "@/lib/catering/payments";
import { createQuoteCheckout, initiatePayment, PortalQuoteError } from "@/lib/portal/quotes";
import type { AuthContext } from "@/lib/session";
import * as stripeClient from "@/lib/stripe/client";
import { processStripeEvent, type StripeWebhookContext } from "@/lib/stripe/webhook";

const auditMock = vi.mocked(audit);
const createSessionMock = vi.mocked(stripeClient.createCheckoutSession);
const retireMock = vi.mocked(stripeClient.retireCheckoutSession);
const retrieveMock = vi.mocked(stripeClient.retrieveCheckoutSession);

const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const V1 = "a0000000-0000-4000-8000-000000000001"; // the root, superseded (the revise tests)
const QUOTE = "a0000000-0000-4000-8000-000000000002"; // the live quote
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const DEPOSIT = "d0000000-0000-4000-8000-000000000001";
const SINGLE: StripeWebhookContext = { locationId: null, locationCode: null };
const owner = { user: { id: "u1", role: "owner" }, locations: [LOCATION] } as unknown as AuthContext;
const notifyPaid = vi.fn(async () => {});

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
    event_date: "2099-06-01", // far out: a staff quote offers the deposit AND the full amount
    expires_at: "2099-01-01T00:00:00.000Z",
    deposit_cents: 20000,
    total_cents: 100000,
    ...over,
  };
}

function depositRow(over: Row = {}): Row {
  return {
    id: DEPOSIT,
    quote_id: QUOTE,
    customer_id: CUSTOMER,
    kind: "deposit",
    amount_cents: 20000,
    currency: "usd",
    status: "due",
    provider: null,
    provider_ref: null,
    provider_session_id: null,
    paid_at: null,
    created_at: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

const payments = () => db.tables.catering_payments!;
const rowOf = (id: string) => payments().find((p) => p.id === id)!;
const byKind = (kind: string) => payments().filter((p) => p.kind === kind);
const openSessions = () => [...stripe.sessions.values()].filter((s) => s.status === "open");
/** Rows that still name a checkout a customer could pay: `due` or `void` with a session id. */
const unresolvedRows = () => payments().filter((p) => (p.status === "due" || p.status === "void") && p.provider_session_id != null);
const lastAuditMeta = (action: string) =>
  auditMock.mock.calls.filter((c) => c[0].action === action).at(-1)![0].metadata as Record<string, unknown>;

/** A Checkout Session that exists at Stripe for one of our intents (minted outside the test's flow). */
async function sessionAtStripe(paymentId: string, quoteId: string, amountCents: number, kind: "deposit" | "full" = "deposit"): Promise<string> {
  const s = await stripe.create(
    "sk_shop",
    {
      quoteId,
      paymentId,
      kind,
      amountCents,
      currency: "usd",
      productName: "x",
      description: "x",
      customerEmail: "customer@example.com",
      successUrl: "https://x/s",
      cancelUrl: "https://x/c",
    },
    `seed-${paymentId}-${stripe.creates.length}`,
  );
  return s.id;
}

/** `checkout.session.completed` (paid) for a session of the Stripe fake; completes it there too. */
function completedEvent(sessionId: string, eventId = "evt_1") {
  const s = stripe.sessions.get(sessionId)!;
  stripe.complete(sessionId);
  return {
    id: eventId,
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: s.id,
        payment_status: "paid",
        payment_intent: `pi_${s.id}`,
        amount_total: s.amountCents,
        metadata: { quote_id: s.quoteId, payment_id: s.paymentId, kind: "deposit" },
      },
    },
  };
}

type HeldOp = { table: string; kind: "insert" | "update" | "rpc"; payload: unknown };

/**
 * Hold a connection at its FIRST operation that `when` picks: the operation is built and
 * then waits. `reached` resolves when the request has got that far (so everything before it
 * — every read, every earlier write — has run); `release()` lets it, and all after it, run.
 */
function holdWhen(fake: PaymentsFake, when: (op: HeldOp) => boolean): { reached: Promise<void>; release: () => void } {
  let signalReached!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((r) => (signalReached = r));
  const gate = new Promise<void>((r) => (release = r));
  let armed = true;
  type Thenable = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>;
  const client = fake.client as unknown as {
    from: (t: string) => Record<string, unknown>;
    rpc: (name: string, args: unknown) => Promise<unknown>;
  };

  const realFrom = client.from;
  client.from = (table: string) => {
    const q = realFrom(table);
    for (const kind of ["insert", "update"] as const) {
      const build = q[kind] as (p: unknown, o?: unknown) => unknown;
      q[kind] = (p: unknown, o?: unknown) => {
        const built = build(p, o);
        if (armed && when({ table, kind, payload: p })) {
          armed = false;
          for (const settle of ["then", "single", "maybeSingle"] as const) {
            const real = q[settle] as (...a: unknown[]) => unknown;
            q[settle] = (...a: unknown[]) => {
              signalReached();
              return settle === "then"
                ? gate.then(() => (real as unknown as Thenable)(a[0] as (v: unknown) => unknown, a[1] as (e: unknown) => unknown))
                : gate.then(() => real(...a));
            };
          }
        }
        return built;
      };
    }
    return q;
  };

  const realRpc = client.rpc;
  client.rpc = (name: string, args: unknown) => {
    if (armed && when({ table: `rpc:${name}`, kind: "rpc", payload: args })) {
      armed = false;
      signalReached();
      return gate.then(() => realRpc(name, args));
    }
    return realRpc(name, args);
  };
  return { reached, release };
}

/** A second connection over the SAME rows, with the same migration state. */
function secondConnection(): PaymentsFake {
  const conn = paymentsFake(db.tables);
  conn.enforceOneOpenCheckout = db.enforceOneOpenCheckout;
  conn.attachFunction = db.attachFunction;
  return conn;
}

/** The pay route's second step, exactly as app/api/portal/quote/[id]/pay/route.ts runs it. */
async function checkoutFor(intent: { paymentId: string; amountCents: number }, kind: "deposit" | "full"): Promise<string> {
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
/** The whole pay route for one tap. */
async function tapPay(kind: "deposit" | "full"): Promise<string> {
  return checkoutFor(await initiatePayment(CUSTOMER, QUOTE, kind), kind);
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

/** The two database states the app must be right in: before 0303 is applied, and after. */
const MIGRATION_STATES = [
  { name: "before migration 0303 (the app's own re-checks)", applied: false },
  { name: "with migration 0303 applied (index + attach function)", applied: true },
] as const;

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
    stripe_events: [],
    catering_quotes: [quoteRow()],
    locations: [{ id: LOCATION, code: "EM" }],
    catering_payments: [],
  });
  current = db;
});

describe.each(MIGRATION_STATES)("W02 review r3 (P1) — settlement racing a second checkout · $name", ({ applied }) => {
  beforeEach(() => {
    if (applied) apply0303(db);
  });

  it("THE REPORTED INTERLEAVING: a full request past the already-paid gate, the deposit settles, the request resumes — refused, nothing left payable", async () => {
    // The customer is in the deposit checkout…
    const depositUrl = await tapPay("deposit");
    const depositSession = stripe.byUrl(depositUrl)!;

    // …and a second tab asks to pay in full. It passes the already-paid gate and is held at
    // the INSERT of its intent.
    const connB = secondConnection();
    const hold = holdWhen(connB, (op) => op.table === "catering_payments" && op.kind === "insert");
    current = connB;
    const fullRequest = (async () => checkoutFor(await initiatePayment(CUSTOMER, QUOTE, "full"), "full"))();
    current = db;
    await hold.reached;

    // The deposit webhook finishes. There is no `full` intent yet for it to void.
    const settled = await processStripeEvent(db.client, completedEvent(depositSession.id), SINGLE, { notifyPaid });
    expect(settled.result).toBe("paid");
    expect(rowOf(DEPOSIT_ID()).status).toBe("paid");

    hold.release();
    const err = await refusal(fullRequest);

    expect(err.status).toBe(409);
    expect(err.code).toBe("already_paid");
    // No second way to pay exists anywhere: not at Stripe, not on a row.
    expect(openSessions()).toEqual([]);
    expect(stripe.creates.map((c) => c.sessionId)).toEqual([depositSession.id]);
    expect(unresolvedRows()).toEqual([]);
    // The intent raised for the refused request is closed, not left as money "due".
    expect(byKind("full").map((p) => p.status)).toEqual(["void"]);
  });

  it("the same race one step later: the settlement lands while the full checkout is being ATTACHED — refused, and the minted session is closed", async () => {
    payments().push(depositRow()); // a due deposit nobody has opened a checkout for
    const intent = await initiatePayment(CUSTOMER, QUOTE, "full");

    // Held at the attach: every read of createQuoteCheckout has passed, the session exists at Stripe.
    const connB = secondConnection();
    const hold = holdWhen(connB, (op) =>
      applied
        ? op.kind === "rpc"
        : op.table === "catering_payments" && op.kind === "update" && (op.payload as Row).provider_session_id != null,
    );
    current = connB;
    const fullRequest = checkoutFor(intent, "full");
    current = db;
    await hold.reached;
    expect(openSessions()).toHaveLength(1);

    // The team records the deposit by hand (the customer paid it by phone).
    await markPaymentPaid(owner, DEPOSIT);
    expect(rowOf(DEPOSIT).status).toBe("paid");

    hold.release();
    const err = await refusal(fullRequest);

    expect(err.status).toBe(409);
    expect(err.code).toBe("already_paid");
    expect(openSessions()).toEqual([]);
    expect(unresolvedRows()).toEqual([]);
  });

  it("THE OTHER ORDER: the full checkout is attached FIRST, then a deposit settles — the open full checkout is closed and its intent voided", async () => {
    payments().push(depositRow());
    // A deposit checkout our rows lost track of (a session minted and never recorded).
    const strayDeposit = await sessionAtStripe(DEPOSIT, QUOTE, 20000);

    const fullUrl = await tapPay("full");
    const fullSession = stripe.byUrl(fullUrl)!;
    expect(fullSession.status).toBe("open");

    const settled = await processStripeEvent(db.client, completedEvent(strayDeposit), SINGLE, { notifyPaid });

    // The deposit is recorded; nothing about it needs a person, because the other checkout
    // was closed before anyone could pay it.
    expect(settled.result).toBe("paid");
    expect(rowOf(DEPOSIT).status).toBe("paid");
    expect(fullSession.status).toBe("expired");
    expect(byKind("full")[0]).toMatchObject({ status: "void", provider_session_id: null });
    expect(openSessions()).toEqual([]);
    const meta = lastAuditMeta("catering.payment.provider_paid");
    expect(meta.needs_review).toEqual([]);
    expect(meta.closed_checkouts).toEqual({ retired: [byKind("full")[0]!.id], stillOpen: [], completing: [] });
  });

  it("…and when Stripe will NOT confirm that checkout closed, the payment is flagged and the checkout stays on the record as unresolved", async () => {
    payments().push(depositRow());
    const strayDeposit = await sessionAtStripe(DEPOSIT, QUOTE, 20000);
    const fullUrl = await tapPay("full");
    const fullSession = stripe.byUrl(fullUrl)!;
    const event = completedEvent(strayDeposit);

    stripe.down = true; // Stripe cannot be reached when the webhook tries to close it
    const settled = await processStripeEvent(db.client, event, SINGLE, { notifyPaid });

    expect(settled.result).toBe("paid_needs_review");
    expect(rowOf(DEPOSIT).status).toBe("paid"); // the money is always recorded
    expect(lastAuditMeta("catering.payment.provider_paid").needs_review).toEqual(["sibling_checkout_open"]);
    expect(notifyPaid).toHaveBeenCalledWith(expect.objectContaining({ reviewReasons: ["sibling_checkout_open"] }));
    // The voided intent still NAMES the checkout it could not close: nothing forgets it.
    expect(byKind("full")[0]).toMatchObject({ status: "void", provider_session_id: fullSession.id });
  });

  it("a deposit request racing a settled FULL payment is refused the same way", async () => {
    const fullUrl = await tapPay("full");
    const fullSession = stripe.byUrl(fullUrl)!;

    const connB = secondConnection();
    const hold = holdWhen(connB, (op) => op.table === "catering_payments" && op.kind === "insert");
    current = connB;
    const depositRequest = (async () => checkoutFor(await initiatePayment(CUSTOMER, QUOTE, "deposit"), "deposit"))();
    current = db;
    await hold.reached;

    await processStripeEvent(db.client, completedEvent(fullSession.id), SINGLE, { notifyPaid });

    hold.release();
    const err = await refusal(depositRequest);
    expect(err.code).toBe("already_paid");
    expect(openSessions()).toEqual([]);
    expect(unresolvedRows()).toEqual([]);
    expect(byKind("deposit").map((p) => p.status)).toEqual(["void"]);
  });

  it("an intent that was already there when the settlement landed is not voided by the refused request — only the one it raised itself", async () => {
    // A due `full` intent from an earlier visit, and a deposit the team then marks paid by
    // hand between this request's gate and its checkout.
    payments().push(depositRow());
    const first = await initiatePayment(CUSTOMER, QUOTE, "full");

    const connB = secondConnection();
    // Held at the audit-free moment after the gate: the first UPDATE/RPC of the checkout step.
    const hold = holdWhen(connB, (op) => op.kind === "rpc" || (op.table === "catering_payments" && op.kind === "update"));
    current = connB;
    const again = checkoutFor(first, "full");
    current = db;
    await hold.reached;
    await markPaymentPaid(owner, DEPOSIT);
    hold.release();

    expect((await refusal(again)).code).toBe("already_paid");
    expect(openSessions()).toEqual([]);
    expect(unresolvedRows()).toEqual([]);
    // It was the team's settlement, by hand: what happens to the other intent is theirs to decide.
    expect(rowOf(first.paymentId).status).toBe("due");
    expect(rowOf(first.paymentId).provider_session_id ?? null).toBeNull();
  });

  it("the ordinary paths are unchanged: one tap opens one checkout, a second tap hands the same one back", async () => {
    const url = await tapPay("deposit");
    expect(await tapPay("deposit")).toBe(url);
    expect(openSessions()).toHaveLength(1);
    expect(rowOf(DEPOSIT_ID()).provider_session_id).toBe(openSessions()[0]!.id);
    // Switching to the full amount retires the deposit checkout and opens exactly one other.
    const fullUrl = await tapPay("full");
    expect(openSessions().map((s) => s.url)).toEqual([fullUrl]);
  });

  it("a deposit already paid refuses a full request at the gate, as before", async () => {
    payments().push(depositRow({ status: "paid", paid_at: "2026-11-02T00:00:00.000Z" }));
    expect((await refusal(tapPay("full"))).code).toBe("already_paid");
    expect(stripe.creates).toEqual([]);
    expect(byKind("full")).toEqual([]);
  });
});

/** The deposit intent `tapPay("deposit")` raised (its id is generated by the fake). */
function DEPOSIT_ID(): string {
  return byKind("deposit")[0]!.id as string;
}

describe.each(MIGRATION_STATES)("W02 review r3 (P1) — a checkout nobody confirmed closed blocks new collection · $name", ({ applied }) => {
  const OLD_DEPOSIT = "d0000000-0000-4000-8000-0000000000aa";

  beforeEach(() => {
    if (applied) apply0303(db);
    // v1 (superseded) asked for a $200 deposit; the live revision asks for none.
    db.tables.catering_quotes = [
      { ...quoteRow(), id: V1, superseded_at: "2026-11-10T00:00:00.000Z" },
      quoteRow({ root_id: V1, deposit_cents: 0, total_cents: 120000 }),
    ];
  });

  /** v1's due deposit, with a checkout the customer has open at the old price. */
  async function strandedDepositWithOpenCheckout(): Promise<string> {
    const old = await sessionAtStripe(OLD_DEPOSIT, V1, 20000);
    payments().push(depositRow({ id: OLD_DEPOSIT, quote_id: V1, provider: "stripe", provider_session_id: old }));
    return old;
  }

  /** The revise's carry, with Stripe unreachable: the intent is voided but its checkout is not closed. */
  async function carryWithStripeDown(): Promise<void> {
    stripe.down = true;
    await carryPaymentsToRevision(
      db.client,
      { rootId: V1, newQuoteId: QUOTE, depositCents: 0, totalCents: 120000 },
      (id: string) => stripe.retire("sk_shop", id),
    );
  }

  it("FAILED RETIREMENT → VOID → a new checkout is REFUSED while Stripe will not confirm the old one closed", async () => {
    const old = await strandedDepositWithOpenCheckout();
    await carryWithStripeDown();
    // The carry's own outcome: the intent is closed, on the live revision, still naming its checkout.
    expect(rowOf(OLD_DEPOSIT)).toMatchObject({ status: "void", quote_id: QUOTE, provider_session_id: old });
    expect(stripe.sessions.get(old)!.status).toBe("open");

    // Minting works again, but an expire call still fails: the old checkout cannot be confirmed closed.
    stripe.down = false;
    retireMock.mockRejectedValue(new stripeClient.StripeError(502, "network_error", "socket hang up"));

    const err = await refusal(tapPay("full"));

    expect(err.status).toBe(502);
    expect(err.code).toBe("provider_error");
    // Nothing new was offered: the only payable checkout is still the old one, and it is still on the record.
    expect(stripe.creates.map((c) => c.sessionId)).toEqual([old]);
    expect(openSessions().map((s) => s.id)).toEqual([old]);
    expect(rowOf(OLD_DEPOSIT).provider_session_id).toBe(old);
    expect(byKind("full").every((p) => p.provider_session_id == null)).toBe(true);
  });

  it("…and the replacement is offered only AFTER the old checkout is confirmed retired", async () => {
    const old = await strandedDepositWithOpenCheckout();
    await carryWithStripeDown();
    stripe.down = false; // Stripe is back

    const url = await tapPay("full");

    expect(stripe.sessions.get(old)!.status).toBe("expired");
    expect(rowOf(OLD_DEPOSIT)).toMatchObject({ status: "void", provider_session_id: null });
    const open = openSessions();
    expect(open.map((s) => s.url)).toEqual([url]);
    expect(open[0]!.amountCents).toBe(120000);
    expect(unresolvedRows().map((p) => p.kind)).toEqual(["full"]);
  });

  it("the customer already PAID the old checkout: the new one is refused — that money is landing", async () => {
    const old = await strandedDepositWithOpenCheckout();
    await carryWithStripeDown();
    stripe.down = false;
    stripe.complete(old);

    const err = await refusal(tapPay("full"));

    expect(err.status).toBe(409);
    expect(err.code).toBe("payment_in_progress");
    expect(stripe.creates.map((c) => c.sessionId)).toEqual([old]);
  });

  it("the door heals the family itself (no revise-time carry): a tap with Stripe down voids, keeps the session on the record, and refuses", async () => {
    const old = await strandedDepositWithOpenCheckout();
    stripe.down = true;

    const err = await refusal(tapPay("full"));

    expect(err.status).toBe(502);
    expect(rowOf(OLD_DEPOSIT)).toMatchObject({ status: "void", quote_id: QUOTE, provider_session_id: old });
    expect(openSessions().map((s) => s.id)).toEqual([old]);
  });

  it("an unresolved checkout that APPEARS while ours is at Stripe is caught at the attach: ours is closed, the request refused", async () => {
    const intent = await initiatePayment(CUSTOMER, QUOTE, "full");
    const connB = secondConnection();
    const hold = holdWhen(connB, (op) =>
      applied
        ? op.kind === "rpc"
        : op.table === "catering_payments" && op.kind === "update" && (op.payload as Row).provider_session_id != null,
    );
    current = connB;
    const request = checkoutFor(intent, "full");
    current = db;
    await hold.reached;
    const minted = openSessions()[0]!;

    // Meanwhile another request's carry lands a voided intent whose checkout it could not close.
    const old = await sessionAtStripe(OLD_DEPOSIT, V1, 20000);
    payments().push(depositRow({ id: OLD_DEPOSIT, status: "void", provider: "stripe", provider_session_id: old }));

    hold.release();
    const err = await refusal(request);

    expect(err.status).toBe(409);
    expect(err.code).toBe("payment_in_progress");
    expect(minted.status).toBe("expired"); // the session we minted is not left payable
    expect(rowOf(intent.paymentId).provider_session_id ?? null).toBeNull();
    expect(openSessions().map((s) => s.id)).toEqual([old]);
  });

  it("a void row with NO session id (its checkout was confirmed retired) blocks nothing", async () => {
    payments().push(depositRow({ id: OLD_DEPOSIT, status: "void", provider_session_id: null }));
    const url = await tapPay("full");
    expect(openSessions().map((s) => s.url)).toEqual([url]);
    expect(retireMock).not.toHaveBeenCalled();
  });

  it("a PAID or REFUNDED row keeps its session id as history and is never treated as an open checkout", async () => {
    payments().push(depositRow({ id: OLD_DEPOSIT, status: "refunded", provider: "stripe", provider_ref: "pi_old", provider_session_id: "cs_history" }));
    const url = await tapPay("full");
    expect(openSessions().map((s) => s.url)).toEqual([url]);
    expect(retireMock).not.toHaveBeenCalled();
    expect(rowOf(OLD_DEPOSIT).provider_session_id).toBe("cs_history");
  });
});

describe("W02 review r3 (P1) — recording a payment by hand closes the quote's open checkouts", () => {
  it("the paid intent's own checkout is retired and cleared, so the customer cannot also pay it by card", async () => {
    const url = await tapPay("deposit");
    const session = stripe.byUrl(url)!;

    await markPaymentPaid(owner, DEPOSIT_ID());

    expect(rowOf(DEPOSIT_ID())).toMatchObject({ status: "paid", provider: "manual", provider_session_id: null });
    expect(session.status).toBe("expired");
    expect(lastAuditMeta("catering.payment.mark_paid").closed_checkouts).toEqual({ retired: [DEPOSIT_ID()], stillOpen: [], completing: [] });
  });

  it("the OTHER intent's open checkout is retired too — and that intent is left for the team (still due, no session)", async () => {
    payments().push(depositRow());
    const fullUrl = await tapPay("full");
    const fullSession = stripe.byUrl(fullUrl)!;

    await markPaymentPaid(owner, DEPOSIT);

    expect(fullSession.status).toBe("expired");
    expect(byKind("full")[0]).toMatchObject({ status: "due", provider_session_id: null });
  });

  it("Stripe unreachable: the payment is STILL recorded (a person received real money) and the open checkout is on the audit row", async () => {
    const url = await tapPay("deposit");
    const session = stripe.byUrl(url)!;
    stripe.down = true;

    await markPaymentPaid(owner, DEPOSIT_ID());

    expect(rowOf(DEPOSIT_ID())).toMatchObject({ status: "paid", provider_session_id: session.id });
    expect(lastAuditMeta("catering.payment.mark_paid").closed_checkouts).toEqual({ retired: [], stillOpen: [DEPOSIT_ID()], completing: [] });
  });

  it("a quote with no checkout anywhere asks Stripe nothing", async () => {
    payments().push(depositRow());
    await markPaymentPaid(owner, DEPOSIT);
    expect(retireMock).not.toHaveBeenCalled();
    expect(lastAuditMeta("catering.payment.mark_paid").closed_checkouts).toEqual({ retired: [], stillOpen: [], completing: [] });
  });
});

describe("W02 review r3 (P1) — closing checkouts after a settlement never holds the settlement up", () => {
  const OTHER = "d0000000-0000-4000-8000-0000000000f1";
  /** A paid deposit, and another intent of the quote that still names a checkout at Stripe. */
  async function paidDepositBeside(over: Row): Promise<string> {
    const sessionId = await sessionAtStripe(OTHER, QUOTE, 100000, "full");
    payments().push(
      depositRow({ status: "paid" }),
      depositRow({ id: OTHER, kind: "full", amount_cents: 100000, provider: "stripe", provider_session_id: sessionId, ...over }),
    );
    return sessionId;
  }
  const close = (over: Record<string, unknown> = {}) =>
    closeQuoteCheckouts(db.client, { quoteId: QUOTE, locationId: LOCATION, settledPaymentId: DEPOSIT, ...over });

  it("a Stripe call that hangs is given up on inside the budget, and the checkout is reported still open", async () => {
    const sessionId = await paidDepositBeside({ status: "void" });
    const hangs = vi.fn(() => new Promise<"expired">(() => {})); // never settles

    const started = Date.now();
    const closed = await close({ retire: hangs, budgetMs: 40 });

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(hangs).toHaveBeenCalledWith(sessionId);
    expect(closed).toEqual({ retired: [], stillOpen: [OTHER], completing: [] });
    // The row still names the checkout: the pay path goes on treating it as unresolved.
    expect(rowOf(OTHER).provider_session_id).toBe(sessionId);
  });

  it("with no budget left, Stripe is not called at all — nothing is started that nobody waits for", async () => {
    await paidDepositBeside({ status: "void" });
    const retire = vi.fn(async () => "expired" as const);
    expect(await close({ retire, budgetMs: 0 })).toEqual({ retired: [], stillOpen: [OTHER], completing: [] });
    expect(retire).not.toHaveBeenCalled();
  });

  it("a shop that cannot reach Stripe at all (no credentials) reports every checkout still open and calls nothing", async () => {
    await paidDepositBeside({ status: "void" });
    expect(await close({ retire: null })).toEqual({ retired: [], stillOpen: [OTHER], completing: [] });
    expect(retireMock).not.toHaveBeenCalled();
  });

  it("a due BALANCE intent's checkout is the next step, not a duplicate: it is never closed", async () => {
    const sessionId = await paidDepositBeside({ kind: "balance", amount_cents: 80000 });
    expect(await close()).toEqual({ retired: [], stillOpen: [], completing: [] });
    expect(retireMock).not.toHaveBeenCalled();
    expect(rowOf(OTHER).provider_session_id).toBe(sessionId);
  });

  it("a checkout that is already COMPLETE is reported as landing, and its id is left for its own webhook event", async () => {
    const sessionId = await paidDepositBeside({ status: "void" });
    stripe.complete(sessionId);
    expect(await close()).toEqual({ retired: [], stillOpen: [], completing: [OTHER] });
    expect(rowOf(OTHER).provider_session_id).toBe(sessionId);
  });

  it("a failed read of the quote's rows is never `clean`: the settled payment is reported for a person to check", async () => {
    await paidDepositBeside({ status: "void" });
    db.failSelect.push("catering_payments");
    expect((await close()).stillOpen).toEqual([DEPOSIT]);
  });
});

describe("W02 review r3 (P1) — Stripe's own `checkout.session.expired` is a confirmed retirement", () => {
  const OLD = "d0000000-0000-4000-8000-0000000000e1";
  const expiredEvent = (sessionId: string, paymentId: string, eventId = "evt_exp") => ({
    id: eventId,
    type: "checkout.session.expired",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: { id: sessionId, payment_status: "unpaid", metadata: { quote_id: QUOTE, payment_id: paymentId, kind: "deposit" } } },
  });

  it("a VOID intent's unresolved checkout stops blocking the moment Stripe says it expired — no retire call needed", async () => {
    const old = await sessionAtStripe(OLD, QUOTE, 20000);
    payments().push(depositRow({ id: OLD, status: "void", provider: "stripe", provider_session_id: old }));
    // This shop cannot retire anything right now, so a pay tap is refused…
    retireMock.mockRejectedValue(new stripeClient.StripeError(502, "network_error", "socket hang up"));
    expect((await refusal(tapPay("full"))).code).toBe("provider_error");

    // …until Stripe itself reports the old session expired.
    stripe.lapse(old);
    const out = await processStripeEvent(db.client, expiredEvent(old, OLD), SINGLE, { notifyPaid });

    expect(out.result).toBe("expired");
    expect(rowOf(OLD)).toMatchObject({ status: "void", provider_session_id: null });
    const url = await tapPay("full");
    expect(openSessions().map((s) => s.url)).toEqual([url]);
  });

  it("a DUE intent keeps its status; only the dead session id goes", async () => {
    const url = await tapPay("deposit");
    const session = stripe.byUrl(url)!;
    stripe.lapse(session.id);

    await processStripeEvent(db.client, expiredEvent(session.id, DEPOSIT_ID()), SINGLE, { notifyPaid });

    expect(rowOf(DEPOSIT_ID())).toMatchObject({ status: "due", provider_session_id: null });
  });

  it("an expiry for an OLDER session never clears the checkout the row names now", async () => {
    const stale = await sessionAtStripe(OLD, QUOTE, 20000);
    payments().push(depositRow({ id: OLD, provider: "stripe", provider_session_id: "cs_test_current" }));

    await processStripeEvent(db.client, expiredEvent(stale, OLD), SINGLE, { notifyPaid });

    expect(rowOf(OLD).provider_session_id).toBe("cs_test_current");
  });

  it("a PAID row's session id is history: an expiry event does not touch it", async () => {
    payments().push(depositRow({ id: OLD, status: "paid", provider: "stripe", provider_ref: "pi_1", provider_session_id: "cs_test_paid" }));
    await processStripeEvent(db.client, expiredEvent("cs_test_paid", OLD), SINGLE, { notifyPaid });
    expect(rowOf(OLD).provider_session_id).toBe("cs_test_paid");
  });
});

describe("W02 review r3 — the rules are written where the next reader will look", () => {
  const read = (rel: string) => readFileSync(rel, "utf8").replace(/\r\n/g, "\n");

  it("the attach goes through 0303's function and falls back, by name, when it is not there", () => {
    const lib = read("lib/portal/quotes.ts");
    expect(lib).toMatch(/\.rpc\("catering_payment_attach_checkout"/);
    expect(lib).toMatch(/PGRST202/);
    // Nothing queries the catalog to find out whether the migration is applied.
    expect(lib).not.toMatch(/pg_indexes|to_regclass|pg_proc/);
  });

  it("the customer sees a sentence, not a code, when the provider cannot confirm a checkout closed", () => {
    const buttons = read("app/order/quote/[id]/pay-buttons.tsx");
    expect(buttons).toMatch(/provider_error: "order\.quote\.error_unavailable"/);
  });

  it("the staff email has a plain sentence for a checkout that could not be closed", () => {
    const webhook = read("lib/stripe/webhook.ts");
    expect(webhook).toMatch(/sibling_checkout_open:\s*\n?\s*"/);
  });
});
