/**
 * Catering refunds — the server flow (lib/catering/refunds.ts) over a predicate-aware fake database and a STATEFUL fake
 * of Stripe's refund endpoints. NEVER a network call: lib/stripe/client.ts's refund functions are replaced, and the
 * fake models exactly what decides "one refund, never two" (docs.stripe.com/api/idempotent_requests,
 * docs.stripe.com/error-low-level):
 *   · a key replays its FIRST response — a saved 500 included — and a key re-used with other parameters is an error;
 *   · a refund carries our `metadata.refund_request_id`, so a list can find a send whose answer was lost;
 *   · a refund above what is left on the charge is refused.
 * The reserve RPC is a TS stand-in that keeps 0357's contract (the real SQL is proven by scripts/sql-harness-0357.mjs,
 * run in CI by tests/catering-refund-0357-migration.test.ts): token replay, figures from refundFigures, allocation,
 * named refusals.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeDb, type Row } from "./fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeDb,
  accounts: [{ secretKey: "sk_test_fake_A", webhookSecret: "whsec_fake", source: "default" }] as Array<{ secretKey: string; webhookSecret: string; source: string }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/stripe/session-owner", () => ({ stripeAccountsForShop: () => h.accounts }));

// ── The Stripe refund fake ───────────────────────────────────────────────────────────────────────────
interface FakeRefund { id: string; status: string; amount: number; paymentIntent: string; requestId: string; account: string }
const stripe = vi.hoisted(() => {
  const state = {
    charges: new Map<string, { account: string; captured: number; refunded: number }>(),
    refunds: [] as FakeRefund[],
    keys: new Map<string, { params: string; response: { ok: true; refund: FakeRefund } | { ok: false; status: number; code: string } }>(),
    /** Next create calls answer like this BEFORE executing (no result saved) or AFTER (saved, like a 500). */
    nextCreate: [] as Array<"network_lost_after_executing" | "network_before" | "500_saved" | "429">,
    creates: [] as Array<{ key: string; account: string; params: string }>,
    seq: 0,
  };
  return state;
});

vi.mock("@/lib/stripe/client", async (original) => {
  const real = await original<typeof import("@/lib/stripe/client")>();
  const { StripeError } = real;
  return {
    ...real,
    retrievePaymentIntentCharge: vi.fn(async (key: string, pi: string) => {
      const c = stripe.charges.get(pi);
      if (!c || c.account !== key) return { status: "not_found", amountCapturedCents: null, amountRefundedCents: null };
      return { status: "found", amountCapturedCents: c.captured, amountRefundedCents: c.refunded };
    }),
    listRefundsForPaymentIntent: vi.fn(async (key: string, pi: string) =>
      stripe.refunds.filter((r) => r.paymentIntent === pi && r.account === key).map((r) => ({ id: r.id, status: r.status, amountCents: r.amount, requestId: r.requestId }))),
    retrieveRefund: vi.fn(async (key: string, id: string) => {
      const r = stripe.refunds.find((x) => x.id === id && x.account === key);
      if (!r) throw new StripeError(404, "resource_missing");
      return { id: r.id, status: r.status, amountCents: r.amount, requestId: r.requestId };
    }),
    createRefund: vi.fn(async (key: string, input: { paymentIntentId: string; amountCents: number; reason: string | null; metadata: { refund_request_id: string } }, idem: string) => {
      const params = JSON.stringify(input);
      stripe.creates.push({ key: idem, account: key, params });
      const saved = stripe.keys.get(`${key}|${idem}`);
      if (saved) {
        if (saved.params !== params) throw new StripeError(400, "idempotency_error", "Keys for idempotent requests can only be used with the same parameters");
        if (saved.response.ok) return { id: saved.response.refund.id, status: saved.response.refund.status, amountCents: saved.response.refund.amount, requestId: saved.response.refund.requestId };
        throw new StripeError(saved.response.status, saved.response.code);
      }
      const mode = stripe.nextCreate.shift();
      if (mode === "network_before") throw new StripeError(0, "network_error");
      if (mode === "429") throw new StripeError(429, "rate_limit");
      if (mode === "500_saved") {
        stripe.keys.set(`${key}|${idem}`, { params, response: { ok: false, status: 500, code: "api_error" } });
        throw new StripeError(500, "api_error");
      }
      const c = stripe.charges.get(input.paymentIntentId);
      if (!c || c.account !== key) {
        stripe.keys.set(`${key}|${idem}`, { params, response: { ok: false, status: 400, code: "resource_missing" } });
        throw new StripeError(400, "resource_missing");
      }
      if (input.amountCents > c.captured - c.refunded) {
        stripe.keys.set(`${key}|${idem}`, { params, response: { ok: false, status: 400, code: "charge_already_refunded" } });
        throw new StripeError(400, "charge_already_refunded");
      }
      c.refunded += input.amountCents;
      const refund: FakeRefund = { id: `re_fake_${++stripe.seq}`, status: "succeeded", amount: input.amountCents, paymentIntent: input.paymentIntentId, requestId: input.metadata.refund_request_id, account: key };
      stripe.refunds.push(refund);
      stripe.keys.set(`${key}|${idem}`, { params, response: { ok: true, refund } });
      if (mode === "network_lost_after_executing") throw new StripeError(0, "network_error");
      return { id: refund.id, status: refund.status, amountCents: refund.amount, requestId: refund.requestId };
    }),
  };
});

import { createRefund } from "@/lib/stripe/client";
import { audit } from "@/lib/audit";
import {
  CateringRefundError,
  loadRefundSummary,
  refundFigures,
  requestRefund,
  retryRefundRequest,
  REFUND_RETRY_WINDOW_MS,
  type RefundRequestBody,
} from "@/lib/catering/refunds";
import type { AuthContext } from "@/lib/session";

const SHOP = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const QUOTE = "00000000-0000-4000-8000-0000000000b1";
const DEP = "00000000-0000-4000-8000-0000000000c1";
const BAL = "00000000-0000-4000-8000-0000000000c2";
const ACTOR = "00000000-0000-4000-8000-0000000000aa";

function actor(role: string, locations: string[] = [SHOP]): AuthContext {
  return { user: { id: ACTOR, role, active: true, language: "en", name: "Kim" }, locations, session: { stepUpUnlocked: true, stepUpUnlockedAt: new Date().toISOString() } } as unknown as AuthContext;
}

let reqSeq = 0;
let claimSeq = 0;
/** 0357's contract in TS: token replay, figures under "the lock", allocation, named refusals. */
function reserve(args: Record<string, unknown>, db: FakeDb) {
  const t = db.tables;
  const quote = (t.catering_quotes ?? []).find((q) => q.id === args.p_quote_id);
  if (!quote) return { data: null, error: { message: "quote_not_found" } };
  const role = (t.users ?? []).find((u) => u.id === args.p_actor_id)?.role as string | undefined;
  if (!role || !["owner", "cgs", "moo", "catering_mgr"].includes(role)) return { data: null, error: { message: "forbidden" } };
  const pays = (t.catering_payments ?? []).filter((p) => p.quote_id === quote.id);
  const existing = (t.catering_refund_requests ?? []).filter((r) => r.client_token === args.p_client_token);
  if (existing.length > 0) {
    const total = existing.reduce((s, r) => s + Number(r.amount_cents), 0);
    if (args.p_amount_cents !== total) return { data: null, error: { message: "token_reused" } };
    return { data: { replay: true, location_id: quote.location_id, requests: existing.map((r) => ({ id: r.id, payment_id: r.payment_id, amount_cents: r.amount_cents, status: r.status })) }, error: null };
  }
  const fig = (p: Row) => refundFigures(
    { amountCents: Number(p.amount_cents), status: String(p.status), provider: p.provider as string | null, providerRef: p.provider_ref as string | null },
    [],
    (t.catering_refund_requests ?? []).filter((r) => r.payment_id === p.id).map((r) => ({ amountCents: Number(r.amount_cents), status: r.status as "pending" })),
  );
  const total = pays.reduce((s, p) => s + fig(p).refundableCents, 0);
  if (total <= 0) return { data: null, error: { message: "nothing_refundable" } };
  if (args.p_amount_cents == null || Number(args.p_amount_cents) <= 0) return { data: null, error: { message: "invalid_amount" } };
  const want = Number(args.p_amount_cents);
  if (want > total) return { data: null, error: { message: "over_refundable", details: String(total) } };
  let left = want;
  const out: Row[] = [];
  for (const p of [...pays].sort((a, b) => (a.kind === "balance" ? -1 : b.kind === "balance" ? 1 : 0))) {
    if (left <= 0) break;
    const take = Math.min(left, fig(p).refundableCents);
    if (take <= 0) continue;
    const row = {
      id: `00000000-0000-4000-8000-${String(++reqSeq).padStart(12, "0")}`, payment_id: p.id, quote_id: quote.id, location_id: quote.location_id,
      client_token: args.p_client_token, amount_cents: take, reason_code: args.p_reason_code, reason_note: args.p_reason_note, trigger_kind: args.p_trigger,
      status: "pending", stripe_refund_id: null, stripe_status: null, last_error_code: null, last_error_message: null, attempts: 0, first_attempt_at: null,
      requested_by: args.p_actor_id, requested_at: new Date().toISOString(), updated_at: new Date().toISOString(), settled_at: null,
    };
    (t.catering_refund_requests ??= []).push(row);
    out.push({ id: row.id, payment_id: row.payment_id, amount_cents: take, status: "pending" });
    left -= take;
  }
  return { data: { replay: false, location_id: quote.location_id, requests: out }, error: null };
}

function seed() {
  h.db = fakeSupabase(
    {
      catering_quotes: [{ id: QUOTE, location_id: SHOP, root_id: null, pipeline_id: "lead-1", superseded_at: null }],
      catering_payments: [
        { id: DEP, quote_id: QUOTE, kind: "deposit", amount_cents: 30000, status: "paid", provider: "stripe", provider_ref: "pi_dep", paid_at: "2026-11-01T10:00:00Z", created_at: "2026-11-01T09:00:00Z" },
        { id: BAL, quote_id: QUOTE, kind: "balance", amount_cents: 70000, status: "paid", provider: "stripe", provider_ref: "pi_bal", paid_at: "2026-11-05T10:00:00Z", created_at: "2026-11-05T09:00:00Z" },
      ],
      catering_payment_refund_events: [],
      catering_refund_requests: [],
      locations: [{ id: SHOP, code: "S1" }],
      users: [{ id: ACTOR, role: "catering_mgr", name: "Kim" }],
    },
    {
      catering_refund_reserve: reserve,
      catering_refund_claim: (args, db) => {
        const r = (db.tables.catering_refund_requests ?? []).find((x) => x.id === args.p_request_id);
        const live = r && r.claimed_until && Date.parse(String(r.claimed_until)) > Date.now();
        if (!r || !["pending", "submitted"].includes(String(r.status)) || live) return { data: null, error: null };
        r.claim_token = `claim-${++claimSeq}`;
        r.claimed_until = new Date(Date.now() + 180_000).toISOString();
        if (r.status === "pending") {
          r.attempts = Number(r.attempts) + 1;
          r.first_attempt_at ??= new Date().toISOString();
        }
        return { data: { claim_token: r.claim_token, attempts: r.attempts, first_attempt_at: r.first_attempt_at, status: r.status }, error: null };
      },
      catering_refund_actor_ok: (args, db) => ({ data: ["owner", "cgs", "moo", "catering_mgr"].includes(String(db.tables.users?.find((u) => u.id === args.p_actor_id)?.role)), error: null }),
    },
  );
  stripe.charges = new Map([
    ["pi_dep", { account: "sk_test_fake_A", captured: 30000, refunded: 0 }],
    ["pi_bal", { account: "sk_test_fake_A", captured: 70000, refunded: 0 }],
  ]);
  stripe.refunds = [];
  stripe.keys = new Map();
  stripe.nextCreate = [];
  stripe.creates = [];
  h.accounts = [{ secretKey: "sk_test_fake_A", webhookSecret: "whsec_fake", source: "default" }];
}

const body = (over: Partial<RefundRequestBody> = {}): RefundRequestBody => ({
  clientToken: "11111111-1111-4111-8111-111111111111", amountCents: 100000, reasonCode: "event_lost", reasonNote: null, trigger: "lost", ...over,
});
const rows = () => h.db.tables.catering_refund_requests as Row[];

beforeEach(() => {
  seed();
  vi.mocked(createRefund).mockClear();
  vi.mocked(audit).mockClear();
});

describe("the confirm tap", () => {
  it("a full refund: one Stripe refund per paid payment, each under its own row's key, and the rows succeed", async () => {
    const out = await requestRefund(actor("catering_mgr"), QUOTE, body());
    expect(out.replay).toBe(false);
    expect(out.results.map((r) => [r.paymentId, r.amountCents, r.status])).toEqual([[BAL, 70000, "succeeded"], [DEP, 30000, "succeeded"]]);
    expect(stripe.creates.map((c) => c.key)).toEqual(rows().map((r) => `catering-refund:${r.id}`));
    expect(stripe.refunds).toHaveLength(2);
    expect(rows().every((r) => r.status === "succeeded" && typeof r.stripe_refund_id === "string" && r.attempts === 1)).toBe(true);
    // The metadata carries the row id (how a later list finds a lost answer) and the reason maps onto Stripe's enum.
    const sent = JSON.parse(stripe.creates[0]!.params) as { reason: string; metadata: Record<string, string> };
    expect(sent.reason).toBe("requested_by_customer");
    expect(sent.metadata.refund_request_id).toBe(rows()[0]!.id);
  });

  it("review r1: a payment that lands between the screen and the tap never grows a Full refund (the confirmed number is sent)", async () => {
    (h.db.tables.catering_payments as Row[]).push({ id: "00000000-0000-4000-8000-0000000000c9", quote_id: QUOTE, kind: "full", amount_cents: 50000, status: "paid", provider: "stripe", provider_ref: "pi_late", paid_at: "2026-11-06T10:00:00Z", created_at: "2026-11-06T09:00:00Z" });
    stripe.charges.set("pi_late", { account: "sk_test_fake_A", captured: 50000, refunded: 0 });
    // The person saw (and confirmed) $1,000.00; $500 more landed meanwhile.
    const out = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 100000 }));
    expect(out.results.reduce((s, r) => s + r.amountCents, 0)).toBe(100000);
    expect(stripe.refunds.reduce((s, r) => s + r.amount, 0)).toBe(100000);
  });

  it("a double tap (the same token) is the same request: no second Stripe call, no second row", async () => {
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 5000 }));
    const again = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 5000 }));
    expect(again.replay).toBe(true);
    expect(stripe.creates).toHaveLength(1);
    expect(rows()).toHaveLength(1);
    expect(stripe.refunds.reduce((s, r) => s + r.amount, 0)).toBe(5000);
  });

  it("a partial refund takes the balance first", async () => {
    const out = await requestRefund(actor("owner", []), QUOTE, body({ amountCents: 1234 }));
    expect(out.results).toEqual([expect.objectContaining({ paymentId: BAL, amountCents: 1234, status: "succeeded" })]);
  });

  it("over-refund is refused by name with the refundable total, and nothing reaches Stripe", async () => {
    await expect(requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 100001 }))).rejects.toMatchObject({ status: 409, code: "over_refundable", detail: { refundableCents: 100000 } });
    expect(stripe.creates).toHaveLength(0);
  });

  it("a GM, an AGM and a catering manager of another shop are refused before the database is asked", async () => {
    for (const a of [actor("gm"), actor("agm"), actor("prep_mgr"), actor("catering_mgr", [OTHER])]) {
      await expect(requestRefund(a, QUOTE, body())).rejects.toBeInstanceOf(CateringRefundError);
    }
    expect(rows()).toHaveLength(0);
    expect(stripe.creates).toHaveLength(0);
  });

  it("the live cap: less left on the charge than the row asks for fails it before any send, releasing the amount", async () => {
    // Stripe already gave back part of the balance (a dashboard refund the webhook has not reported): the live cap.
    stripe.charges.get("pi_bal")!.refunded = 69000;
    const out = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 5000 }));
    expect(out.results[0]).toMatchObject({ status: "failed", errorCode: "over_charge_remaining" });
    expect(stripe.creates).toHaveLength(0);
    const s = await loadRefundSummary(actor("catering_mgr"), QUOTE);
    expect(s.totals.refundableCents).toBe(100000); // the failed row counts for nothing
  });

  it("a 400 at create (Stripe refused) is terminal: failed, amount released", async () => {
    stripe.charges.set("pi_dep", { account: "sk_test_fake_A", captured: 30000, refunded: 0 });
    stripe.nextCreate = [];
    // Make Stripe refuse: the charge was fully refunded between our live read and the create.
    const spy = vi.mocked(createRefund);
    spy.mockImplementationOnce(async () => { const { StripeError } = await import("@/lib/stripe/client"); throw new StripeError(400, "charge_already_refunded"); });
    const out = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 100 }));
    expect(out.results[0]).toMatchObject({ status: "failed", errorCode: "charge_already_refunded" });
  });
});

describe("unknown outcomes stay pending and are retried safely", () => {
  it("the answer was lost but the refund landed: Retry finds it by request id and sends nothing again", async () => {
    stripe.nextCreate = ["network_lost_after_executing"];
    const out = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 }));
    expect(out.results[0]).toMatchObject({ status: "pending", errorCode: "network_error" });
    const s1 = await loadRefundSummary(actor("catering_mgr"), QUOTE);
    expect(s1.totals.inFlightCents).toBe(2000);
    expect(s1.totals.refundableCents).toBe(98000); // the pending row counts against what is refundable
    expect(s1.requests[0]).toMatchObject({ retryable: true, needsReconcile: false });

    const id = rows()[0]!.id as string;
    const r = await retryRefundRequest(actor("catering_mgr"), QUOTE, id);
    expect(r.status).toBe("succeeded");
    expect(stripe.creates).toHaveLength(1); // found, not re-sent
    expect(stripe.refunds).toHaveLength(1);
  });

  it("no response and nothing landed: Retry re-sends the SAME key and parameters once", async () => {
    stripe.nextCreate = ["network_before"];
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 }));
    const id = rows()[0]!.id as string;
    const r = await retryRefundRequest(actor("catering_mgr"), QUOTE, id);
    expect(r.status).toBe("succeeded");
    expect(stripe.creates.map((c) => c.key)).toEqual([`catering-refund:${id}`, `catering-refund:${id}`]);
    expect(stripe.creates[0]!.params).toBe(stripe.creates[1]!.params);
    expect(stripe.refunds).toHaveLength(1);
  });

  it("a saved 500 stays pending on retry (Stripe replays it); nothing is ever sent under a new key", async () => {
    stripe.nextCreate = ["500_saved"];
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 }));
    const id = rows()[0]!.id as string;
    const r = await retryRefundRequest(actor("catering_mgr"), QUOTE, id);
    expect(r).toMatchObject({ status: "pending", errorCode: "api_error" });
    expect(new Set(stripe.creates.map((c) => c.key))).toEqual(new Set([`catering-refund:${id}`]));
    expect(stripe.refunds).toHaveLength(0);
  });

  it("a 429 stays pending and is retryable", async () => {
    stripe.nextCreate = ["429"];
    const out = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 }));
    expect(out.results[0]).toMatchObject({ status: "pending", errorCode: "rate_limit" });
  });

  it("past Stripe's 24-hour window a press RECONCILES: it lists, never sends, and says when Stripe shows nothing", async () => {
    stripe.nextCreate = ["network_before"];
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 }));
    const id = rows()[0]!.id as string;
    const later = Date.now() + REFUND_RETRY_WINDOW_MS + 60_000;
    const r = await retryRefundRequest(actor("catering_mgr"), QUOTE, id, later);
    expect(r).toMatchObject({ status: "pending", errorCode: "needs_reconcile" });
    expect(stripe.creates).toHaveLength(1); // never a second send
    const s = await loadRefundSummary(actor("catering_mgr"), QUOTE, later);
    expect(s.requests[0]).toMatchObject({ needsReconcile: true, retryable: false });
  });

  it("review r2: a lost answer that landed, its webhook recorded, nobody retried for 24 h: Check Stripe adopts it and the money is no longer double-held", async () => {
    stripe.nextCreate = ["network_lost_after_executing"];
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 40000 }));
    const row = rows()[0]!;
    // The webhook's charge.refunded event for the balance (cumulative $400 of $700).
    (h.db.tables.catering_payment_refund_events as Row[]).push({ payment_id: BAL, cumulative_refunded_cents: 40000, charge_amount_cents: 70000 });
    const later = Date.now() + REFUND_RETRY_WINDOW_MS + 60_000;
    const before = await loadRefundSummary(actor("catering_mgr"), QUOTE, later);
    expect(before.totals.refundableCents).toBe(30000); // the balance shows 0: $400 refunded AND $400 still held as in flight
    const r = await retryRefundRequest(actor("catering_mgr"), QUOTE, row.id as string, later);
    expect(r.status).toBe("succeeded");
    expect(stripe.creates).toHaveLength(1);
    const after = await loadRefundSummary(actor("catering_mgr"), QUOTE, later);
    expect(after.totals.refundableCents).toBe(60000); // $1,000 - $400
  });

  it("review r2: Release closes a past-window row only after a fresh look finds no refund; before the window it is refused", async () => {
    stripe.nextCreate = ["network_before"];
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 }));
    const row = rows()[0]!;
    await expect(retryRefundRequest(actor("catering_mgr"), QUOTE, row.id as string, Date.now(), "release")).rejects.toMatchObject({ status: 409, code: "not_releasable" });
    const later = Date.now() + REFUND_RETRY_WINDOW_MS + 60_000;
    const r = await retryRefundRequest(actor("catering_mgr"), QUOTE, row.id as string, later, "release");
    expect(r).toMatchObject({ status: "failed", errorCode: "released_no_refund" });
    expect(stripe.creates).toHaveLength(1);
    expect((await loadRefundSummary(actor("catering_mgr"), QUOTE, later)).totals.refundableCents).toBe(100000);
  });

  it("review r2: Release never closes a row whose refund IS at Stripe: it adopts it instead", async () => {
    stripe.nextCreate = ["network_lost_after_executing"];
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 }));
    const row = rows()[0]!;
    const later = Date.now() + REFUND_RETRY_WINDOW_MS + 60_000;
    const r = await retryRefundRequest(actor("catering_mgr"), QUOTE, row.id as string, later, "release");
    expect(r.status).toBe("succeeded");
    expect(row.stripe_refund_id).toMatch(/^re_fake_/);
  });

  it("review r1: a press while another holds the claim sends nothing; a press that outlived its claim writes nothing", async () => {
    stripe.nextCreate = ["network_before"];
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 }));
    const row = rows()[0]!;
    // Press B takes the claim (for example its Stripe call is slow).
    row.claim_token = "claim-B";
    row.claimed_until = new Date(Date.now() + 60_000).toISOString();
    const a = await retryRefundRequest(actor("catering_mgr"), QUOTE, row.id as string);
    expect(a).toMatchObject({ status: "pending", errorCode: "in_progress" });
    expect(stripe.creates).toHaveLength(1); // only the first tap's send

    // B's claim expires; press C claims, and B (holding the OLD token) comes back with "failed": fenced out.
    row.claimed_until = new Date(Date.now() - 1000).toISOString();
    const c = await retryRefundRequest(actor("catering_mgr"), QUOTE, row.id as string);
    expect(c.status).toBe("succeeded");
    const { error, count } = await h.db.client.from("catering_refund_requests").update({ status: "failed" }, { count: "exact" }).eq("id", row.id).eq("status", "pending").eq("claim_token", "claim-B");
    expect([error, count]).toEqual([null, 0]);
    expect(row.status).toBe("succeeded");
    expect(row.claim_token).toBeNull(); // released by the outcome write
    expect(stripe.refunds).toHaveLength(1);
  });

  it("review r1: even a FIRST attempt lists first, and adopts a refund already carrying this row's id instead of sending", async () => {
    // A reserved row nobody has sent yet, and a Stripe refund that names it (a press that outlived its claim).
    reserve({ p_actor_id: ACTOR, p_quote_id: QUOTE, p_client_token: "22222222-2222-4222-8222-222222222222", p_amount_cents: 2000, p_reason_code: "event_lost", p_reason_note: null, p_trigger: "lost" }, h.db);
    const row = rows()[0]!;
    expect(row.attempts).toBe(0);
    stripe.refunds.push({ id: "re_ghost", status: "succeeded", amount: 2000, paymentIntent: "pi_bal", requestId: row.id as string, account: "sk_test_fake_A" });
    const r = await retryRefundRequest(actor("catering_mgr"), QUOTE, row.id as string);
    expect(r.status).toBe("succeeded");
    expect(row.stripe_refund_id).toBe("re_ghost");
    expect(stripe.creates).toHaveLength(0);
  });

  it("a payment Stripe does not know in any configured account fails before anything is sent", async () => {
    h.accounts = [{ secretKey: "sk_test_fake_B", webhookSecret: "whsec_fake", source: "location" }];
    const out = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 100 }));
    expect(out.results[0]).toMatchObject({ status: "failed", errorCode: "payment_not_in_stripe" });
    expect(stripe.creates).toHaveLength(0);
  });

  it("the shop's own account is asked first, then the shared one (the PaymentIntent lives where it was minted)", async () => {
    h.accounts = [
      { secretKey: "sk_test_fake_B", webhookSecret: "whsec_fake", source: "location" },
      { secretKey: "sk_test_fake_A", webhookSecret: "whsec_fake", source: "default" },
    ];
    const out = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 100 }));
    expect(out.results[0]!.status).toBe("succeeded");
    expect(stripe.creates[0]!.account).toBe("sk_test_fake_A");
  });

  it("review r3: an account that cannot be asked does not hide the one that owns the payment", async () => {
    h.accounts = [
      { secretKey: "sk_test_fake_BROKEN", webhookSecret: "whsec_fake", source: "location" },
      { secretKey: "sk_test_fake_A", webhookSecret: "whsec_fake", source: "default" },
    ];
    const { retrievePaymentIntentCharge } = await import("@/lib/stripe/client");
    const real = vi.mocked(retrievePaymentIntentCharge).getMockImplementation()!;
    vi.mocked(retrievePaymentIntentCharge).mockImplementation(async (key: string, pi: string) => {
      if (key === "sk_test_fake_BROKEN") {
        const { StripeError } = await import("@/lib/stripe/client");
        throw new StripeError(401, "api_key_expired");
      }
      return real(key, pi);
    });
    const out = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 100 }));
    vi.mocked(retrievePaymentIntentCharge).mockImplementation(real);
    expect(out.results[0]!.status).toBe("succeeded");
    expect(stripe.creates[0]!.account).toBe("sk_test_fake_A");
  });

  it("review r3: when no account owns it and one could not be asked, the row stays pending (never failed)", async () => {
    h.accounts = [{ secretKey: "sk_test_fake_BROKEN", webhookSecret: "whsec_fake", source: "location" }];
    const { retrievePaymentIntentCharge, StripeError } = await import("@/lib/stripe/client");
    const real = vi.mocked(retrievePaymentIntentCharge).getMockImplementation()!;
    vi.mocked(retrievePaymentIntentCharge).mockImplementation(async () => { throw new StripeError(401, "api_key_expired"); });
    const out = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 100 }));
    vi.mocked(retrievePaymentIntentCharge).mockImplementation(real);
    expect(out.results[0]).toMatchObject({ status: "pending", errorCode: "stripe_unreachable" });
    expect(stripe.creates).toHaveLength(0);
  });

  it("no Stripe account configured: the first attempt fails by name (nothing was sent)", async () => {
    h.accounts = [];
    const out = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 100 }));
    expect(out.results[0]).toMatchObject({ status: "failed", errorCode: "stripe_not_configured" });
  });
});

describe("review r4: mixed dashboard and app refunds", () => {
  it("a dashboard refund (reported) plus an app refund (not reported yet) leave exactly what is left", async () => {
    // $100 refunded on the deposit in the Stripe dashboard; the webhook recorded it.
    stripe.charges.get("pi_dep")!.refunded = 10000;
    (h.db.tables.catering_payment_refund_events as Row[]).push({ payment_id: DEP, cumulative_refunded_cents: 10000, charge_amount_cents: 30000 });
    // Our $50 on the deposit: take the balance out of the way so the allocation lands on the deposit.
    (h.db.tables.catering_payments as Row[]).find((p) => p.id === BAL)!.status = "refunded";
    const out = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 5000 }));
    expect(out.results[0]).toMatchObject({ paymentId: DEP, status: "succeeded" });
    expect(rows()[0]!.charge_refunded_seen_cents).toBe(15000);
    const s = await loadRefundSummary(actor("catering_mgr"), QUOTE);
    expect(s.payments.find((p) => p.id === DEP)!.figures).toMatchObject({ refundedCents: 15000, refundableCents: 15000 });
  });
});

describe("a submitted (Stripe pending) refund is refreshed, never re-sent", () => {
  it("Check status reads the refund again", async () => {
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 100 }));
    const row = rows()[0]!;
    stripe.refunds[0]!.status = "pending";
    row.status = "submitted";
    row.stripe_status = "pending";
    stripe.refunds[0]!.status = "succeeded";
    const r = await retryRefundRequest(actor("catering_mgr"), QUOTE, row.id as string);
    expect(r.status).toBe("succeeded");
    expect(stripe.creates).toHaveLength(1);
  });

  it("a finished row is not retryable", async () => {
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 100 }));
    await expect(retryRefundRequest(actor("catering_mgr"), QUOTE, rows()[0]!.id as string)).rejects.toMatchObject({ status: 409, code: "not_retryable" });
  });
});

describe("the read model", () => {
  it("names what was paid, refunded, in flight and refundable; a hand-marked payment is outside the app", async () => {
    (h.db.tables.catering_payments as Row[]).push({ id: "00000000-0000-4000-8000-0000000000c3", quote_id: QUOTE, kind: "full", amount_cents: 5000, status: "paid", provider: "manual", provider_ref: null, paid_at: null, created_at: "2026-11-06T00:00:00Z" });
    (h.db.tables.catering_payment_refund_events as Row[]).push({ payment_id: DEP, cumulative_refunded_cents: 1000, charge_amount_cents: 30000 });
    const s = await loadRefundSummary(actor("shift_lead"), QUOTE);
    expect(s.totals).toEqual({ paidCents: 100000, refundedCents: 1000, inFlightCents: 0, refundableCents: 99000, outsideAppCents: 5000 });
    expect(s.canRefund).toBe(false); // a shift lead sees, never refunds
    expect((await loadRefundSummary(actor("catering_mgr"), QUOTE)).canRefund).toBe(true);
  });

  it("before 0357 is applied the panel says so and offers nothing", async () => {
    h.db.failSelectTables = [];
    const client = h.db.client as unknown as { from: (t: string) => unknown };
    const real = client.from;
    client.from = (t: string) => (t === "catering_refund_requests"
      ? { select: () => ({ in: () => ({ order: () => ({ returns: async () => ({ data: null, error: { code: "PGRST205", message: "Could not find the table" } }) }) }) }) }
      : real(t));
    const s = await loadRefundSummary(actor("catering_mgr"), QUOTE);
    client.from = real;
    expect(s.installed).toBe(false);
    expect(s.canRefund).toBe(false);
  });

  it("another shop's order is a 404, never a leak", async () => {
    await expect(loadRefundSummary(actor("shift_lead", [OTHER]), QUOTE)).rejects.toMatchObject({ status: 404 });
  });
});
