/**
 * Unit spine — TWO STRIPE ACCOUNTS (audit wave W02, review r4 P2).
 *
 * ── THE BUG ──────────────────────────────────────────────────────────────────────────
 * A shop's Stripe credentials resolve per shop, with a shared default (lib/stripe/client.ts):
 * `STRIPE_SECRET_KEY__<CODE>` overrides `STRIPE_SECRET_KEY`. So the account a shop takes
 * NEW money through can change — and a Checkout Session opened before the change lives in
 * the OLD account. Asked about that session, the new account's key answers 404: it cannot
 * see it. The client read that 404 as "expired" (and a read as "gone"), so:
 *
 *   customer    opens a deposit checkout          → session S, minted in shared account A
 *   admin       gives the shop its own account B  → the shop's key is now B's
 *   customer    taps "pay in full"                → S is "retired" with B's key: 404 → "expired"
 *                                                   → S's id is CLEARED → a full checkout opens
 *   …and S is still open in account A. Two payable checkouts for one order, one of them
 *   unknown to every row we hold.
 *
 * THE RULE PINNED HERE: a 404 is "this key cannot see that session". It is never a
 * retirement. A session is confirmed closed only by an account that KNOWS it; the accounts
 * a shop is configured with are each asked (`lib/stripe/session-owner.ts`); and when none of
 * them knows it, the id STAYS on its row as an unresolved checkout and no replacement is
 * offered.
 *
 * The whole stack runs: lib/portal/quotes.ts, payment-carry, payment-sessions, the REAL
 * lib/stripe/client.ts — over tests/stripe-http-fake.ts, a `fetch` that models accounts.
 * No DB, no network: a request to anything but that fake throws.
 */
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apply0303, paymentsFake, type PaymentsFake, type Row } from "./payments-fake-client";
import { stripeHttpFake, type StripeHttpFake } from "./stripe-http-fake";

let db: PaymentsFake;
let stripe: StripeHttpFake;

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

import { audit } from "@/lib/audit";
import { carryPaymentsToRevision, retireSessionFor } from "@/lib/catering/payment-carry";
import { markPaymentPaid } from "@/lib/catering/payments";
import { createQuoteCheckout, initiatePayment, PortalQuoteError } from "@/lib/portal/quotes";
import type { AuthContext } from "@/lib/session";
import { isSessionNotFound, retireCheckoutSession, retrieveCheckoutSession, StripeError } from "@/lib/stripe/client";
import { retireSessionInOwningAccount, stripeAccountsForShop } from "@/lib/stripe/session-owner";

const auditMock = vi.mocked(audit);

/** Fake keys. A = the shared account every shop starts on; B = the shop's own, added later. */
const KEY_A = "sk_test_sharedA";
const KEY_B = "sk_test_shopB";

const CUSTOMER = "c0000000-0000-4000-8000-000000000001";
const V1 = "a0000000-0000-4000-8000-000000000001";
const QUOTE = "a0000000-0000-4000-8000-000000000002";
const LOCATION = "b0000000-0000-4000-8000-000000000001";
const owner = { user: { id: "u1", role: "owner" }, locations: [LOCATION] } as unknown as AuthContext;

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
    expires_at: "2099-01-01T00:00:00.000Z",
    deposit_cents: 20000,
    total_cents: 100000,
    ...over,
  };
}

const payments = () => db.tables.catering_payments!;
const byKind = (kind: string) => payments().filter((p) => p.kind === kind);
const deposit = () => byKind("deposit")[0]!;
const lastAuditMeta = (action: string) =>
  auditMock.mock.calls.filter((c) => c[0].action === action).at(-1)![0].metadata as Record<string, unknown>;

/** The shop is on the shared account A (no override). */
function shopOnSharedAccount(): void {
  vi.stubEnv("STRIPE_SECRET_KEY", KEY_A);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_shared_fake");
  vi.stubEnv("STRIPE_SECRET_KEY__EM", "");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET__EM", "");
}
/** The shop is given its OWN account B. `keepShared` = account A is still configured as the default. */
function shopMovesToOwnAccount({ keepShared }: { keepShared: boolean }): void {
  vi.stubEnv("STRIPE_SECRET_KEY__EM", KEY_B);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET__EM", "whsec_shop_fake");
  if (!keepShared) {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
  }
}

/** The whole pay route for one tap. Returns the hosted URL. */
async function tapPay(kind: "deposit" | "full"): Promise<string> {
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

async function refusal(p: Promise<unknown>): Promise<PortalQuoteError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PortalQuoteError) return e;
    throw e;
  }
  throw new Error("expected a PortalQuoteError, but the call succeeded");
}

/** A session minted directly in an account (outside any flow of ours). */
async function sessionIn(account: string): Promise<string> {
  const res = await stripe.fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${account}` },
    body: "line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=20000",
  });
  return ((await res.json()) as { id: string }).id;
}

beforeEach(() => {
  auditMock.mockClear();
  stripe = stripeHttpFake();
  stripe.account(KEY_A);
  stripe.account(KEY_B);
  vi.stubGlobal("fetch", stripe.fetch);
  shopOnSharedAccount();
  db = paymentsFake({
    catering_quotes: [quoteRow()],
    locations: [{ id: LOCATION, code: "EM" }],
    catering_payments: [],
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("W02 review r4 (P2) — the client: a 404 under one account's key is not a retirement", () => {
  it("retiring account A's session with account B's key THROWS `session_not_found` — and the session is still open in A", async () => {
    const s = await sessionIn(KEY_A);

    const err: unknown = await retireCheckoutSession(KEY_B, s).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(StripeError);
    expect(err).toMatchObject({ status: 404, code: "session_not_found" });
    expect(isSessionNotFound(err)).toBe(true);
    expect(stripe.sessions.get(s)!.status).toBe("open");
  });

  it("reading it with account B's key answers `not_found` — not `gone`, not `expired`", async () => {
    const s = await sessionIn(KEY_A);
    expect(await retrieveCheckoutSession(KEY_B, s)).toMatchObject({ status: "not_found", url: null });
    expect(await retrieveCheckoutSession(KEY_A, s)).toMatchObject({ status: "open" });
  });

  it("the OWNING account's key retires it", async () => {
    const s = await sessionIn(KEY_A);
    expect(await retireCheckoutSession(KEY_A, s)).toBe("expired");
    expect(stripe.sessions.get(s)!.status).toBe("expired");
  });
});

describe("W02 review r4 (P2) — a session is retired by the account that owns it", () => {
  const accounts = (...keys: string[]) => keys.map((secretKey) => ({ secretKey }));

  it("the shop's current account does not know it; the other configured account does, and retires it", async () => {
    const s = await sessionIn(KEY_A);

    expect(await retireSessionInOwningAccount(accounts(KEY_B, KEY_A), s)).toBe("expired");

    expect(stripe.sessions.get(s)!.status).toBe("expired");
    // B was asked first (it is where new money goes), then A.
    expect(stripe.calls.filter((c) => c.path.endsWith("/expire")).map((c) => c.account)).toEqual([KEY_B, KEY_A]);
  });

  it("NO configured account knows it: THROWS `session_not_found` — unresolved, never `expired`", async () => {
    const s = await sessionIn(KEY_A);
    const err: unknown = await retireSessionInOwningAccount(accounts(KEY_B), s).catch((e: unknown) => e);
    expect(isSessionNotFound(err)).toBe(true);
    expect(stripe.sessions.get(s)!.status).toBe("open");
  });

  it("the owning account says it is already COMPLETE: `complete`, whatever the other account thinks", async () => {
    const s = await sessionIn(KEY_A);
    stripe.complete(s);
    expect(await retireSessionInOwningAccount(accounts(KEY_B, KEY_A), s)).toBe("complete");
  });

  it("one account cannot be reached and the other does not know it: the OUTAGE is the answer, not `not found`", async () => {
    const s = await sessionIn(KEY_A);
    stripe.down.add(KEY_A);
    const err: unknown = await retireSessionInOwningAccount(accounts(KEY_B, KEY_A), s).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StripeError);
    expect(isSessionNotFound(err)).toBe(false);
    expect((err as StripeError).status).toBe(503);
  });

  it("no account at all: THROWS (a shop that cannot reach Stripe confirms nothing)", async () => {
    await expect(retireSessionInOwningAccount([], "cs_test_x")).rejects.toMatchObject({ code: "not_configured" });
    expect(stripe.calls).toEqual([]);
  });

  it("`stripeAccountsForShop`: the account new money goes to first, then the shared one — complete pairs only, each once", () => {
    shopOnSharedAccount();
    expect(stripeAccountsForShop("EM").map((a) => a.secretKey)).toEqual([KEY_A]);

    shopMovesToOwnAccount({ keepShared: true });
    expect(stripeAccountsForShop("EM").map((a) => [a.secretKey, a.source])).toEqual([
      [KEY_B, "location"],
      [KEY_A, "default"],
    ]);

    shopMovesToOwnAccount({ keepShared: false });
    expect(stripeAccountsForShop("EM").map((a) => a.secretKey)).toEqual([KEY_B]);

    // A HALF-configured override takes no new money (the all-or-nothing rule), but the
    // shared account can still be asked to close a checkout it owns.
    shopOnSharedAccount();
    vi.stubEnv("STRIPE_SECRET_KEY__EM", KEY_B);
    expect(stripeAccountsForShop("EM").map((a) => a.secretKey)).toEqual([KEY_A]);

    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(stripeAccountsForShop("EM")).toEqual([]);
  });
});

describe.each([
  { name: "before migration 0303", applied: false },
  { name: "with migration 0303 applied", applied: true },
])("W02 review r4 (P2) — the pay path across an account change · $name", ({ applied }) => {
  beforeEach(() => {
    if (applied) apply0303(db);
  });

  it("THE REPORTED SEQUENCE: a deposit checkout in shared account A, the shop moves to its own account B, the customer taps `pay in full` — A's checkout is closed BY A before anything new exists", async () => {
    const old = stripe.byUrl(await tapPay("deposit"))!;
    expect(old.account).toBe(KEY_A);

    shopMovesToOwnAccount({ keepShared: true });
    const fullUrl = await tapPay("full");

    // Exactly one payable checkout exists anywhere, in any account: the new one, in B.
    expect(old.status).toBe("expired");
    expect(stripe.open().map((s) => [s.url, s.account])).toEqual([[fullUrl, KEY_B]]);
    expect(deposit().provider_session_id).toBeNull();
  });

  it("…and when account A's key is NO LONGER CONFIGURED, nobody can confirm that checkout closed: the tap is refused, its id stays on the record, nothing new is minted", async () => {
    const old = stripe.byUrl(await tapPay("deposit"))!;

    shopMovesToOwnAccount({ keepShared: false });
    const err = await refusal(tapPay("full"));

    expect(err.status).toBe(502);
    expect(err.code).toBe("provider_error");
    // The bug was the opposite of every line below: B's 404 read as "expired".
    expect(old.status).toBe("open");
    expect(deposit().provider_session_id).toBe(old.id);
    expect(stripe.open().map((s) => s.id)).toEqual([old.id]);
    expect(stripe.calls.filter((c) => c.method === "POST" && c.path === "/v1/checkout/sessions")).toHaveLength(1);
    expect(byKind("full").every((p) => p.provider_session_id == null)).toBe(true);
  });

  it("the intent's OWN stored checkout, read with the new account's key, is `not found` — it is retired by its owner, then replaced", async () => {
    const old = stripe.byUrl(await tapPay("deposit"))!;

    shopMovesToOwnAccount({ keepShared: true });
    const again = stripe.byUrl(await tapPay("deposit"))!;

    expect(old.status).toBe("expired");
    expect(again).toMatchObject({ account: KEY_B, status: "open" });
    expect(deposit().provider_session_id).toBe(again.id);
    expect(stripe.open().map((s) => s.id)).toEqual([again.id]);
  });

  it("…and with its owner out of reach it is neither cleared nor replaced", async () => {
    const old = stripe.byUrl(await tapPay("deposit"))!;

    shopMovesToOwnAccount({ keepShared: false });
    const err = await refusal(tapPay("deposit"));

    expect(err.status).toBe(502);
    expect(deposit().provider_session_id).toBe(old.id);
    expect(stripe.open().map((s) => s.id)).toEqual([old.id]);
  });

  it("a stale amount is NOT re-priced under a checkout no configured account can close", async () => {
    const old = stripe.byUrl(await tapPay("deposit"))!;
    db.tables.catering_quotes![0]!.deposit_cents = 25000; // the order's deposit moved

    shopMovesToOwnAccount({ keepShared: false });
    const err = await refusal(tapPay("deposit"));

    expect(err.status).toBe(502);
    // The row still says what that open checkout charges.
    expect(deposit()).toMatchObject({ amount_cents: 20000, provider_session_id: old.id });
  });

  it("the ordinary single-account shop is unchanged: one key, one call per retirement", async () => {
    const depositSession = stripe.byUrl(await tapPay("deposit"))!;
    const fullUrl = await tapPay("full");

    expect(depositSession.status).toBe("expired");
    expect(stripe.open().map((s) => s.url)).toEqual([fullUrl]);
    expect(new Set(stripe.calls.map((c) => c.account))).toEqual(new Set([KEY_A]));
    expect(stripe.calls.filter((c) => c.path.endsWith("/expire"))).toHaveLength(1);
  });
});

describe("W02 review r4 (P2) — settlement and revise across an account change", () => {
  it("a payment recorded by hand: its checkout in the OLD account is closed by the old account when that account is still configured", async () => {
    const old = stripe.byUrl(await tapPay("deposit"))!;
    shopMovesToOwnAccount({ keepShared: true });

    await markPaymentPaid(owner, deposit().id as string, QUOTE);

    expect(old.status).toBe("expired");
    expect(deposit()).toMatchObject({ status: "paid", provider_session_id: null });
    expect(lastAuditMeta("catering.payment.mark_paid").closed_checkouts).toEqual({ retired: [deposit().id], stillOpen: [], completing: [] });
  });

  it("…and is reported STILL OPEN, with its id kept, when no configured account knows it — never `retired`", async () => {
    const old = stripe.byUrl(await tapPay("deposit"))!;
    shopMovesToOwnAccount({ keepShared: false });

    await markPaymentPaid(owner, deposit().id as string, QUOTE);

    expect(deposit()).toMatchObject({ status: "paid", provider_session_id: old.id }); // the money is recorded
    expect(old.status).toBe("open");
    expect(lastAuditMeta("catering.payment.mark_paid").closed_checkouts).toEqual({ retired: [], stillOpen: [deposit().id], completing: [] });
  });

  it("a revise: an intent whose checkout no configured account can close is moved AS IT IS — not re-priced, its session kept", async () => {
    // v1 holds the due deposit and its open checkout (account A); v2 asks for a larger deposit.
    db.tables.catering_quotes = [quoteRow({ id: V1 })];
    const intent = await initiatePayment(CUSTOMER, V1, "deposit");
    const { url } = await createQuoteCheckout({
      customerId: CUSTOMER,
      customerEmail: "customer@example.com",
      quoteId: V1,
      kind: "deposit",
      paymentId: intent.paymentId,
      amountCents: intent.amountCents,
      appOrigin: "https://portal.example.com",
    });
    const old = stripe.byUrl(url)!;
    db.tables.catering_quotes![0]!.superseded_at = "2026-11-12T00:00:00.000Z";
    db.tables.catering_quotes!.push(quoteRow({ root_id: V1, deposit_cents: 25000 }));

    shopMovesToOwnAccount({ keepShared: false });
    const out = await carryPaymentsToRevision(
      db.client,
      { rootId: V1, newQuoteId: QUOTE, depositCents: 25000, totalCents: 100000 },
      await retireSessionFor(db.client, LOCATION),
    );

    expect(out.sessionsNotRetired).toEqual([intent.paymentId]);
    expect(out.sessionsRetired).toBe(0);
    expect(deposit()).toMatchObject({ quote_id: QUOTE, status: "due", amount_cents: 20000, provider_session_id: old.id });
    expect(old.status).toBe("open");
  });
});

describe("W02 review r4 — the rules are written where the next reader will look", () => {
  const read = (rel: string) => readFileSync(rel, "utf8").replace(/\r\n/g, "\n");

  it("no 404 in the client is answered with a session status that means closed", () => {
    const client = read("lib/stripe/client.ts");
    expect(client).not.toMatch(/status === 404\) return "expired"/);
    expect(client).not.toMatch(/status === 404\) return \{ status: "(gone|expired)"/);
    expect(client.match(/status === 404\) throw sessionNotFound\(\)/g)).toHaveLength(2);
  });

  it("a STORED session is only ever retired through its owning account", () => {
    // The carry, the settlement cleanup and the doors resolve their retire function here…
    const carry = read("lib/catering/payment-carry.ts");
    expect(carry).toMatch(/retireSessionInOwningAccount\(accounts, sessionId\)/);
    expect(carry).not.toMatch(/retireCheckoutSession\(/);
    // …and the pay path keeps exactly ONE direct retire: the session it minted a moment ago
    // with the very key it is holding (`abandonSession`).
    const portal = read("lib/portal/quotes.ts");
    expect(portal.match(/await retireCheckoutSession\(/g)).toHaveLength(1);
    expect(portal).toMatch(/async function abandonSession\(secretKey: string, sessionId: string\)[\s\S]{0,120}await retireCheckoutSession\(secretKey, sessionId\)/);
  });

  it("both settlement flips read back the row they wrote, and the hand-recorded one is guarded on the revision it read", () => {
    const manual = read("lib/catering/payments.ts");
    expect(manual).toMatch(/\.eq\("status", "due"\)\s*\.eq\("quote_id", quoteId\)\s*\.select\("id, quote_id, provider_session_id"\)/);
    const webhook = read("lib/stripe/webhook.ts");
    expect(webhook).toMatch(/\.in\("status", \["due", "void"\]\)\s*\.select\("id, quote_id, provider_session_id"\)/);
    // Neither hands the cleanup a quote id from an earlier read.
    expect(manual).toMatch(/quoteId: paid\.quote_id/);
    expect(webhook).toMatch(/quoteId: flipped\.quote_id/);
  });
});
