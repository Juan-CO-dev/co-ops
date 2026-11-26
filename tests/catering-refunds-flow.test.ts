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
 * The SQL ACTOR RULE (`catering_refund_actor_ok`) is a TS stand-in too (`sqlActorOk`): an active user, owner / cgs at
 * any shop, a membership-branch role only with an ACTIVE membership at that shop. It answers as migration 0358 wrote
 * it (GM and AGM in the membership branch) or, for the deploy-order tests, as 0357 did (`h.sqlRule`); its role lists
 * are held equal to the two real files below, and the real SQL is proven by scripts/sql-harness-0358.mjs.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeDb, type Row } from "./fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeDb,
  accounts: [{ secretKey: "sk_test_fake_A", webhookSecret: "whsec_fake", source: "default" }] as Array<{ secretKey: string; webhookSecret: string; source: string }>,
  /** Which migration's actor rule the fake database answers with (the deploy-order tests set "0357"). */
  sqlRule: "0358" as "0357" | "0358",
  /** Every RPC the code under test called, by name, in order. */
  rpcCalls: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/stripe/session-owner", () => ({ stripeAccountsForShop: () => h.accounts }));

// ── The Stripe refund fake ───────────────────────────────────────────────────────────────────────────
interface FakeRefund { id: string; status: string; amount: number; paymentIntent: string; requestId: string | null; account: string }
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
  actorMayRefund,
  loadLeadRefundables,
  loadRefundSummary,
  refundFigures,
  requestRefund,
  retryRefundRequest,
  REFUND_RETRY_WINDOW_MS,
  type RefundRequestBody,
} from "@/lib/catering/refunds";
import type { AuthContext } from "@/lib/session";
import { ROLES, type RoleCode } from "@/lib/roles";

const SHOP = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const QUOTE = "00000000-0000-4000-8000-0000000000b1";
const DEP = "00000000-0000-4000-8000-0000000000c1";
const BAL = "00000000-0000-4000-8000-0000000000c2";
const ACTOR = "00000000-0000-4000-8000-0000000000aa";

/**
 * A signed-in person. The fake database is made to AGREE with the session (the role, and an ACTIVE membership at each
 * of the session's shops), as it does while a session is fresh. A test of a STALE session changes the tables after
 * calling this.
 */
function actor(role: string, locations: string[] = [SHOP]): AuthContext {
  const t = h.db.tables;
  const user = (t.users ??= []).find((u) => u.id === ACTOR);
  if (user) Object.assign(user, { role, active: true });
  t.user_locations = locations.map((location_id) => ({ user_id: ACTOR, location_id, active: true }));
  return { user: { id: ACTOR, role, active: true, language: "en", name: "Kim" }, locations, session: { stepUpUnlocked: true, stepUpUnlockedAt: new Date().toISOString() } } as unknown as AuthContext;
}

/** `catering_refund_actor_ok` in TS, as 0357 or 0358 wrote it (see the header). */
const SQL_ANY_SHOP = ["owner", "cgs"];
const SQL_MEMBER_SHOP = { "0357": ["moo", "catering_mgr"], "0358": ["moo", "catering_mgr", "gm", "agm"] } as const;
function sqlActorOk(db: FakeDb, actorId: unknown, shopId: unknown): boolean {
  const u = (db.tables.users ?? []).find((x) => x.id === actorId);
  if (!u || u.active !== true) return false; // SQL: `and u.active` — NULL is not active
  const role = String(u.role);
  if (SQL_ANY_SHOP.includes(role)) return true;
  return (SQL_MEMBER_SHOP[h.sqlRule] as readonly string[]).includes(role) && shopId != null
    && (db.tables.user_locations ?? []).some((m) => m.user_id === actorId && m.location_id === shopId && m.active === true);
}

let reqSeq = 0;
let claimSeq = 0;
/** 0357's contract in TS: token replay, figures under "the lock", allocation, named refusals. */
function reserve(args: Record<string, unknown>, db: FakeDb) {
  const t = db.tables;
  const quote = (t.catering_quotes ?? []).find((q) => q.id === args.p_quote_id);
  if (!quote) return { data: null, error: { message: "quote_not_found" } };
  if (!sqlActorOk(db, args.p_actor_id, quote.location_id)) return { data: null, error: { message: "forbidden" } };
  const pays = (t.catering_payments ?? []).filter((p) => p.quote_id === quote.id);
  const existing = (t.catering_refund_requests ?? []).filter((r) => r.client_token === args.p_client_token);
  if (existing.length > 0) {
    const total = existing.reduce((s, r) => s + Number(r.amount_cents), 0);
    if (args.p_amount_cents !== total) return { data: null, error: { message: "token_reused" } };
    return { data: { replay: true, location_id: quote.location_id, requests: existing.map((r) => ({ id: r.id, payment_id: r.payment_id, amount_cents: r.amount_cents, status: r.status })) }, error: null };
  }
  // The same inputs 0357's catering_refund_figures reads: events, own rows, the newest snapshot.
  const fig = (p: Row) => {
    const snap = (t.catering_refund_stripe_snapshots ?? []).find((x) => x.payment_id === p.id);
    return refundFigures(
      { amountCents: Number(p.amount_cents), status: String(p.status), provider: p.provider as string | null, providerRef: p.provider_ref as string | null },
      (t.catering_payment_refund_events ?? []).filter((e) => e.payment_id === p.id).map((e) => ({
        cumulativeRefundedCents: Number(e.cumulative_refunded_cents), chargeAmountCents: e.charge_amount_cents == null ? null : Number(e.charge_amount_cents), refundedAt: (e.refunded_at as string | undefined) ?? null,
      })),
      (t.catering_refund_requests ?? []).filter((r) => r.payment_id === p.id).map((r) => ({
        id: r.id as string, amountCents: Number(r.amount_cents), status: r.status as "pending", stripeRefundId: (r.stripe_refund_id as string | null) ?? null,
      })),
      snap ? {
        listedAt: String(snap.listed_at), capturedCents: snap.captured_cents == null ? null : Number(snap.captured_cents),
        refunds: (snap.refunds as Array<{ id: string; amount: number; status: string | null; request_id: string | null }>).map((x) => ({ id: x.id, amountCents: x.amount, status: x.status, requestId: x.request_id })),
      } : null,
    );
  };
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
      catering_refund_stripe_snapshots: [],
      locations: [{ id: SHOP, code: "S1" }],
      users: [{ id: ACTOR, role: "catering_mgr", name: "Kim", active: true }],
      user_locations: [{ user_id: ACTOR, location_id: SHOP, active: true }],
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
      catering_refund_record_snapshot: (args, db) => {
        const t = (db.tables.catering_refund_stripe_snapshots ??= []);
        const cur = t.find((x) => x.payment_id === args.p_payment_id);
        if (cur && String(cur.listed_at) > String(args.p_listed_at)) return { data: false, error: null };
        const row = { payment_id: args.p_payment_id, listed_at: args.p_listed_at, captured_cents: args.p_captured_cents, refunds: args.p_refunds };
        if (cur) Object.assign(cur, row);
        else t.push(row);
        return { data: true, error: null };
      },
      catering_refund_actor_ok: (args, db) => ({ data: sqlActorOk(db, args.p_actor_id, args.p_shop_id), error: null }),
    },
  );
  h.sqlRule = "0358";
  h.rpcCalls = [];
  const client = h.db.client as unknown as { rpc: (name: string, args: Record<string, unknown>) => unknown };
  const rpc = client.rpc;
  client.rpc = (name, args) => { h.rpcCalls.push(name); return rpc(name, args); };
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

  it("a prep manager at the shop (403) and a catering manager, GM or AGM of another shop (404) are refused before the database is asked", async () => {
    for (const role of ["prep_mgr", "social_media_mgr", "shift_lead", "key_holder", "employee"]) {
      await expect(requestRefund(actor(role), QUOTE, body()), role).rejects.toMatchObject({ status: 403, code: "forbidden" });
    }
    // Another shop's people cannot see this order at all: 404, never a leak (unchanged; the role is not even looked at).
    for (const role of ["catering_mgr", "gm", "agm", "moo", "prep_mgr"]) {
      await expect(requestRefund(actor(role, [OTHER]), QUOTE, body()), role).rejects.toMatchObject({ status: 404, code: "not_found" });
      await expect(requestRefund(actor(role, []), QUOTE, body()), role).rejects.toMatchObject({ status: 404, code: "not_found" });
    }
    expect(h.rpcCalls).toEqual([]);
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
    // Opening the panel asked Stripe: the landed refund is listed under this row id, so it counts once, as refunded.
    expect([s1.totals.inFlightCents, s1.totals.refundedCents]).toEqual([0, 2000]);
    expect(s1.totals.refundableCents).toBe(98000);
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

  it("review r10: a retry that reaches the send inside the window's last minute is not sent: needs_reconcile", async () => {
    stripe.nextCreate = ["network_before"];
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 }));
    const row = rows()[0]!;
    // 30 seconds before the window ends: the first check passes, the send-time check (60 s margin) does not.
    const at = Date.parse(String(row.first_attempt_at)) + REFUND_RETRY_WINDOW_MS - 30_000;
    const r = await retryRefundRequest(actor("catering_mgr"), QUOTE, row.id as string, at);
    expect(r).toMatchObject({ status: "pending", errorCode: "needs_reconcile" });
    expect(stripe.creates).toHaveLength(1); // the first send only
    expect(row.claim_token).toBeNull(); // released; the reservation stays
  });

  it("review r10: the clock crosses the deadline DURING the Stripe reads: nothing is sent", async () => {
    stripe.nextCreate = ["network_before"];
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 }));
    const row = rows()[0]!;
    const at = Date.parse(String(row.first_attempt_at)) + REFUND_RETRY_WINDOW_MS - 120_000; // 2 minutes left
    const { listRefundsForPaymentIntent } = await import("@/lib/stripe/client");
    const realList = vi.mocked(listRefundsForPaymentIntent).getMockImplementation()!;
    const realNow = Date.now.bind(Date);
    let skew = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);
    vi.mocked(listRefundsForPaymentIntent).mockImplementation(async (k: string, pi: string) => {
      skew += 90_000; // the listing took 90 seconds
      return realList(k, pi);
    });
    const r = await retryRefundRequest(actor("catering_mgr"), QUOTE, row.id as string, at);
    nowSpy.mockRestore();
    vi.mocked(listRefundsForPaymentIntent).mockImplementation(realList);
    expect(r).toMatchObject({ status: "pending", errorCode: "needs_reconcile" });
    expect(stripe.creates).toHaveLength(1);
  });

  it("review r11: the clock crosses the deadline during the CALLER's database reads: nothing is sent", async () => {
    stripe.nextCreate = ["network_before"];
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 }));
    const row = rows()[0]!;
    const at = Date.parse(String(row.first_attempt_at)) + REFUND_RETRY_WINDOW_MS - 120_000; // 2 minutes left
    const realNow = Date.now.bind(Date);
    let skew = 0;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);
    const db = h.db as unknown as { client: { rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> } };
    const realRpc = db.client.rpc;
    db.client.rpc = async (n: string, a: Record<string, unknown>) => {
      if (n === "catering_refund_actor_ok") skew += 130_000; // the actor check took 130 seconds
      return realRpc(n, a);
    };
    const r = await retryRefundRequest(actor("catering_mgr"), QUOTE, row.id as string, at);
    db.client.rpc = realRpc;
    nowSpy.mockRestore();
    expect(r).toMatchObject({ status: "pending", errorCode: "needs_reconcile" });
    expect(stripe.creates).toHaveLength(1);
  });

  it("review r2: a lost answer that landed, its webhook recorded, nobody retried for 24 h: Check Stripe adopts it and the money is no longer double-held", async () => {
    stripe.nextCreate = ["network_lost_after_executing"];
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 40000 }));
    const row = rows()[0]!;
    // The webhook's charge.refunded event for the balance (cumulative $400 of $700).
    (h.db.tables.catering_payment_refund_events as Row[]).push({ payment_id: BAL, cumulative_refunded_cents: 40000, charge_amount_cents: 70000 });
    const later = Date.now() + REFUND_RETRY_WINDOW_MS + 60_000;
    const before = await loadRefundSummary(actor("catering_mgr"), QUOTE, later);
    // Opening the panel asks Stripe (review r6): the landed refund is LISTED under this row's id, so it already
    // counts once (refunded), not twice (refunded and in flight).
    expect(before.totals.refundableCents).toBe(60000);
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

describe("review r4-r6: mixed dashboard and app refunds, by identity and current status", () => {
  const setup = () => {
    // $100 refunded on the deposit in the Stripe dashboard (no CO-OPS id), still pending; the webhook recorded it.
    stripe.charges.get("pi_dep")!.refunded = 10000;
    stripe.refunds.push({ id: "re_dash", status: "pending", amount: 10000, paymentIntent: "pi_dep", requestId: null, account: "sk_test_fake_A" });
    (h.db.tables.catering_payment_refund_events as Row[]).push({ payment_id: DEP, cumulative_refunded_cents: 10000, charge_amount_cents: 30000, refunded_at: new Date(Date.now() - 600_000).toISOString() });
    (h.db.tables.catering_payments as Row[]).find((p) => p.id === BAL)!.status = "refunded";
  };
  const dep = async () => (await loadRefundSummary(actor("catering_mgr"), QUOTE)).payments.find((p) => p.id === DEP)!.figures;

  it("r4: a dashboard refund plus an app refund leave exactly what is left", async () => {
    setup();
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 5000 }));
    expect(await dep()).toMatchObject({ refundedCents: 15000, refundableCents: 15000 });
  });

  it("r5: two separate app refunds: the dashboard refund counts once and both of ours count", async () => {
    setup();
    await requestRefund(actor("catering_mgr"), QUOTE, body({ clientToken: "33333333-3333-4333-8333-333333333333", amountCents: 5000 }));
    await requestRefund(actor("catering_mgr"), QUOTE, body({ clientToken: "44444444-4444-4444-8444-444444444444", amountCents: 5000 }));
    expect(await dep()).toMatchObject({ refundedCents: 20000, refundableCents: 10000 });
  });

  it("r6: the dashboard refund is CANCELED: opening the panel asks Stripe again and the amount is refundable again", async () => {
    setup();
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 5000 }));
    expect(await dep()).toMatchObject({ refundableCents: 15000 });
    stripe.refunds.find((r) => r.id === "re_dash")!.status = "canceled";
    stripe.charges.get("pi_dep")!.refunded -= 10000;
    await new Promise((r) => setTimeout(r, 5)); // a later listing
    expect(await dep()).toMatchObject({ refundedCents: 5000, refundableCents: 25000 });
  });

  it("r7: a whole-charge refund the webhook recorded, later CANCELED at Stripe: the payment is refundable again", async () => {
    const bal = (h.db.tables.catering_payments as Row[]).find((p) => p.id === BAL)!;
    bal.status = "refunded"; // the webhook's flip on charge.refunded (whole charge)
    (h.db.tables.catering_payment_refund_events as Row[]).push({ payment_id: BAL, cumulative_refunded_cents: 70000, charge_amount_cents: 70000, refunded_at: new Date(Date.now() - 600_000).toISOString() });
    stripe.refunds.push({ id: "re_full", status: "canceled", amount: 70000, paymentIntent: "pi_bal", requestId: null, account: "sk_test_fake_A" });
    const s = await loadRefundSummary(actor("catering_mgr"), QUOTE);
    expect(s.payments.find((p) => p.id === BAL)!.figures).toMatchObject({ eligible: true, refundedCents: 0, refundableCents: 70000 });
    expect(s.totals.refundableCents).toBe(100000);
    // …and the reserve agrees: the balance can be refunded (the live cap at Stripe has the last word).
    const out = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 70000 }));
    expect(out.results[0]).toMatchObject({ paymentId: BAL, status: "succeeded" });
  });

  it("r7: Stripe answered but the snapshot could not be stored: the summary says the figures may be out of date", async () => {
    setup();
    const db = h.db as unknown as { client: { rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> } };
    const real = db.client.rpc;
    db.client.rpc = async (n: string, a: Record<string, unknown>) =>
      n === "catering_refund_record_snapshot" ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } : real(n, a);
    const s = await loadRefundSummary(actor("catering_mgr"), QUOTE);
    db.client.rpc = real;
    expect(s.stripeUnchecked).toBe(true);
  });

  it("r8: the lead read carries 'could not check' through, even for an order showing $0 refundable", async () => {
    setup();
    (h.db.tables.catering_payments as Row[]).find((p) => p.id === DEP)!.status = "refunded";
    h.accounts = [];
    const rows = await loadLeadRefundables(actor("catering_mgr"), "lead-1");
    expect(rows).toEqual([expect.objectContaining({ quoteId: QUOTE, refundableCents: 0, stripeUnchecked: true })]);
  });

  it("r6: Stripe cannot be asked: the last snapshot stands and the summary says the figures may be out of date", async () => {
    setup();
    h.accounts = [];
    const s = await loadRefundSummary(actor("catering_mgr"), QUOTE);
    expect(s.stripeUnchecked).toBe(true);
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
    stripe.refunds.push({ id: "re_ev", status: "succeeded", amount: 1000, paymentIntent: "pi_dep", requestId: null, account: "sk_test_fake_A" });
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

// ── Refund round 2, Part A (Juan 2026-11-25): GM and AGM refund at a shop they belong to ───────────────
describe("the stand-in actor rule is the SQL's", () => {
  const sqlLists = (file: string) => {
    const code = readFileSync(`supabase/migrations/${file}`, "utf8").replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
    const fn = code.match(/function public\.catering_refund_actor_ok\([\s\S]*?\nend \$\$;/);
    if (!fn) throw new Error(`catering_refund_actor_ok not found in ${file}`);
    return [...fn[0].matchAll(/v_role in \(([^)]*)\)/g)].map((m) => [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!));
  };
  it("its role lists are the two files' own, in the same branches", () => {
    expect(sqlLists("0357_catering_refund_requests.sql")).toEqual([SQL_ANY_SHOP, [...SQL_MEMBER_SHOP["0357"]]]);
    expect(sqlLists("0358_catering_refund_roles.sql")).toEqual([SQL_ANY_SHOP, [...SQL_MEMBER_SHOP["0358"]]]);
  });
  it("NULL is not active (as in SQL): a user or a membership whose `active` is missing is refused", () => {
    actor("gm");
    expect(sqlActorOk(h.db, ACTOR, SHOP)).toBe(true);
    delete (h.db.tables.user_locations as Row[])[0]!.active;
    expect(sqlActorOk(h.db, ACTOR, SHOP)).toBe(false);
    actor("owner", []);
    expect(sqlActorOk(h.db, ACTOR, SHOP)).toBe(true);
    (h.db.tables.users as Row[])[0]!.active = null;
    expect(sqlActorOk(h.db, ACTOR, SHOP)).toBe(false);
  });
  it("for a fresh session the app gate and the SQL rule give the SAME answer, every role x member / other shop / no shop", () => {
    for (const role of Object.keys(ROLES) as RoleCode[]) {
      for (const locations of [[SHOP], [OTHER], [], [SHOP, OTHER]]) {
        const a = actor(role, locations);
        expect([role, locations.length, actorMayRefund(a, SHOP)]).toEqual([role, locations.length, sqlActorOk(h.db, ACTOR, SHOP)]);
        expect([role, locations.length, actorMayRefund(a, OTHER)]).toEqual([role, locations.length, sqlActorOk(h.db, ACTOR, OTHER)]);
      }
    }
  });
});

describe("Part A: a GM and an AGM refund at a shop they belong to", () => {
  it("the confirm tap: reserved, sent to Stripe once under the row's key, succeeded, audited", async () => {
    for (const role of ["gm", "agm"]) {
      seed();
      vi.mocked(audit).mockClear();
      const out = await requestRefund(actor(role), QUOTE, body({ amountCents: 5000 }));
      expect(out.results).toEqual([expect.objectContaining({ paymentId: BAL, amountCents: 5000, status: "succeeded" })]);
      expect(stripe.creates.map((c) => c.key)).toEqual([`catering-refund:${rows()[0]!.id}`]);
      expect(stripe.refunds).toHaveLength(1);
      expect(rows()[0]).toMatchObject({ requested_by: ACTOR, status: "succeeded", location_id: SHOP });
      expect(h.rpcCalls[0]).toBe("catering_refund_reserve");
      expect(vi.mocked(audit).mock.calls.some(([a]) => a.action === "catering.refund.stripe_result" && a.actorRole === role)).toBe(true);
    }
  });

  it("a full refund of the order by a GM is one Stripe refund per payment, like every other refunder's", async () => {
    const out = await requestRefund(actor("gm"), QUOTE, body());
    expect(out.results.map((r) => [r.paymentId, r.amountCents, r.status])).toEqual([[BAL, 70000, "succeeded"], [DEP, 30000, "succeeded"]]);
    await expect(requestRefund(actor("gm"), QUOTE, body({ clientToken: "22222222-2222-4222-8222-222222222222", amountCents: 1 }))).rejects.toMatchObject({ status: 409, code: "nothing_refundable" });
  });

  it("summary.canRefund follows the same rule: member GM / AGM yes, other level-6 managers no, another shop never sees it", async () => {
    for (const role of ["gm", "agm", "catering_mgr", "moo"]) expect([role, (await loadRefundSummary(actor(role), QUOTE)).canRefund]).toEqual([role, true]);
    for (const role of ["owner", "cgs"]) expect([role, (await loadRefundSummary(actor(role, []), QUOTE)).canRefund]).toEqual([role, true]);
    for (const role of ["prep_mgr", "social_media_mgr", "shift_lead"]) expect([role, (await loadRefundSummary(actor(role), QUOTE)).canRefund]).toEqual([role, false]);
    for (const role of ["gm", "agm", "catering_mgr", "moo"]) {
      await expect(loadRefundSummary(actor(role, [OTHER]), QUOTE), role).rejects.toMatchObject({ status: 404 });
    }
  });

  it("a GM of BOTH shops refunds this shop's order; the row is this shop's", async () => {
    const out = await requestRefund(actor("gm", [OTHER, SHOP]), QUOTE, body({ amountCents: 700 }));
    expect(out.results[0]).toMatchObject({ status: "succeeded", amountCents: 700 });
    expect(rows()[0]!.location_id).toBe(SHOP);
  });

  it("a STALE session: a GM whose membership was switched off is refused by the SQL rule (403), and nothing is sent", async () => {
    for (const role of ["gm", "agm"]) {
      seed();
      const a = actor(role); // the session still lists the shop…
      (h.db.tables.user_locations as Row[])[0]!.active = false; // …the membership row no longer does
      await expect(requestRefund(a, QUOTE, body()), role).rejects.toMatchObject({ status: 403, code: "forbidden" });
      expect(h.rpcCalls).toEqual(["catering_refund_reserve"]); // the app let it through; the database refused
      expect(rows()).toHaveLength(0);
      expect(stripe.creates).toHaveLength(0);
    }
  });

  it("a STALE session: a membership moved to another shop, or a deactivated GM, is refused the same way", async () => {
    const a = actor("gm");
    (h.db.tables.user_locations as Row[])[0]!.location_id = OTHER;
    await expect(requestRefund(a, QUOTE, body())).rejects.toMatchObject({ status: 403, code: "forbidden" });
    const b = actor("gm");
    (h.db.tables.users as Row[])[0]!.active = false;
    await expect(requestRefund(b, QUOTE, body())).rejects.toMatchObject({ status: 403, code: "forbidden" });
    // A session that says GM for a person the database now calls a prep manager (demoted since sign-in).
    const c = actor("gm");
    (h.db.tables.users as Row[])[0]!.role = "prep_mgr";
    await expect(requestRefund(c, QUOTE, body())).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(rows()).toHaveLength(0);
    expect(stripe.creates).toHaveLength(0);
  });

  it("Retry / Check Stripe by a GM or an AGM: a lost answer is found and nothing is sent twice", async () => {
    for (const role of ["gm", "agm"]) {
      seed();
      stripe.nextCreate = ["network_lost_after_executing"];
      const out = await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 }));
      expect(out.results[0]).toMatchObject({ status: "pending", errorCode: "network_error" });
      const r = await retryRefundRequest(actor(role), QUOTE, rows()[0]!.id as string);
      expect(r.status).toBe("succeeded");
      expect(stripe.creates).toHaveLength(1);
      expect(stripe.refunds).toHaveLength(1);
      expect(h.rpcCalls).toContain("catering_refund_actor_ok");
    }
  });

  it("Retry re-sends the SAME key for a GM when nothing landed", async () => {
    stripe.nextCreate = ["network_before"];
    await requestRefund(actor("agm"), QUOTE, body({ amountCents: 2000 }));
    const id = rows()[0]!.id as string;
    const r = await retryRefundRequest(actor("gm"), QUOTE, id);
    expect(r.status).toBe("succeeded");
    expect(stripe.creates.map((c) => c.key)).toEqual([`catering-refund:${id}`, `catering-refund:${id}`]);
    expect(stripe.refunds).toHaveLength(1);
  });

  it("Retry and Release with a STALE session are refused by the SQL re-check before any claim: 403, nothing sent", async () => {
    stripe.nextCreate = ["network_before"];
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 }));
    const id = rows()[0]!.id as string;
    for (const mode of ["retry", "release"] as const) {
      const a = actor("gm");
      (h.db.tables.user_locations as Row[])[0]!.active = false;
      h.rpcCalls = [];
      await expect(retryRefundRequest(a, QUOTE, id, Date.now(), mode), mode).rejects.toMatchObject({ status: 403, code: "forbidden" });
      expect(h.rpcCalls).toEqual(["catering_refund_actor_ok"]);
    }
    expect(stripe.creates).toHaveLength(1); // only the first tap's send
    expect(rows()[0]).toMatchObject({ status: "pending", attempts: 1 });
    // A refused role at the shop, and another shop's GM, never reach the database on this path either.
    h.rpcCalls = [];
    await expect(retryRefundRequest(actor("prep_mgr"), QUOTE, id)).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(retryRefundRequest(actor("gm", [OTHER]), QUOTE, id)).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(h.rpcCalls).toEqual([]);
  });
});

describe("deploy order: the NEW app on 0357's SQL rule (the app deployed before migration 0358)", () => {
  beforeEach(() => { h.sqlRule = "0357"; });

  it("a GM / AGM passes the app's gate and the database refuses: 403 forbidden, no row, nothing reaches Stripe", async () => {
    for (const role of ["gm", "agm"]) {
      seed();
      h.sqlRule = "0357";
      await expect(requestRefund(actor(role), QUOTE, body()), role).rejects.toMatchObject({ status: 403, code: "forbidden" });
      expect(h.rpcCalls).toEqual(["catering_refund_reserve"]);
      expect(rows()).toHaveLength(0);
      expect(stripe.creates).toHaveLength(0);
      expect(stripe.refunds).toHaveLength(0);
    }
  });

  it("Retry and Release on someone else's pending row: refused by the SQL re-check, nothing claimed or sent", async () => {
    stripe.nextCreate = ["network_before"];
    await requestRefund(actor("catering_mgr"), QUOTE, body({ amountCents: 2000 })); // 0357 still lets a catering manager
    const id = rows()[0]!.id as string;
    for (const role of ["gm", "agm"]) {
      for (const mode of ["retry", "release"] as const) {
        h.rpcCalls = [];
        await expect(retryRefundRequest(actor(role), QUOTE, id, Date.now(), mode), `${role} ${mode}`).rejects.toMatchObject({ status: 403, code: "forbidden" });
        expect(h.rpcCalls).toEqual(["catering_refund_actor_ok"]);
      }
    }
    expect(stripe.creates).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("stated consequence: the panel offers the button (the app's list) and the press answers 403 until 0358 is applied", async () => {
    expect((await loadRefundSummary(actor("gm"), QUOTE)).canRefund).toBe(true);
    await expect(requestRefund(actor("gm"), QUOTE, body())).rejects.toMatchObject({ status: 403 });
  });

  it("everyone 0357 allowed still refunds", async () => {
    for (const [role, locations] of [["catering_mgr", [SHOP]], ["moo", [SHOP]], ["owner", []], ["cgs", []]] as const) {
      seed();
      h.sqlRule = "0357";
      const out = await requestRefund(actor(role, [...locations]), QUOTE, body({ amountCents: 300 }));
      expect([role, out.results[0]!.status]).toEqual([role, "succeeded"]);
    }
  });
});
