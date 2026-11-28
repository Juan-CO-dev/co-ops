/**
 * The REAL strict refund-evidence client (lib/stripe/client.ts, "Strict refund evidence") over the account-aware
 * HTTP fake (tests/stripe-http-fake.ts). Never a network call: `fetch` IS the fake, every key is a fake string, all
 * data is synthetic. Plan B1.2 "Discovery" / "Coverage", B1.6; one `it` per rule.
 *
 * Every GET test also asserts the fake saw ZERO POSTs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createRefund,
  listRefundsPageStrict,
  REFUND_EVIDENCE_MALFORMED,
  retrievePaymentIntentOwner,
  retrieveRefundStrict,
  StripeError,
  type StrictRefund,
} from "@/lib/stripe/client";
import {
  delay,
  KEPT_MALFORMED,
  LIST_MALFORMED,
  malformed,
  networkError,
  REFUND_MALFORMED,
  status,
  stripeHttpFake,
  type MalformedKind,
  type StripeHttpFake,
} from "./stripe-http-fake";
import { stripeFake } from "./stripe-fake";

const KEY_A = "sk_test_fake_A";
const KEY_B = "sk_test_fake_B";
const KEY_A2 = "sk_test_fake_A_rotated";
const PI = "pi_fake_dep";
const REQ = "11111111-1111-4111-8111-111111111111";
const QUOTE = "22222222-2222-4222-8222-222222222222";
const PAY = "33333333-3333-4333-8333-333333333333";

let stripe: StripeHttpFake;

function seed(fake: StripeHttpFake, refunds = 1) {
  fake.account(KEY_A);
  fake.account(KEY_B);
  fake.world.addPaymentIntent({ id: PI, account: KEY_A, amountCaptured: 30_000, chargeId: "ch_fake_dep" });
  for (let i = 0; i < refunds; i++) {
    fake.world.addRefund({ paymentIntentId: PI, amount: 100 + i, metadata: { refund_request_id: REQ, quote_id: QUOTE, payment_id: PAY } });
  }
}

function mount(fake: StripeHttpFake) {
  stripe = fake;
  vi.stubGlobal("fetch", fake.fetch);
}

beforeEach(() => {
  const f = stripeHttpFake();
  seed(f);
  mount(f);
});
afterEach(() => vi.unstubAllGlobals());

const noPosts = () => expect(stripe.counts().posts).toBe(0);
const malformedErr = { status: 502, code: REFUND_EVIDENCE_MALFORMED };
const firstRefundId = () => stripe.world.refunds[0]!.id;

/** Drive a kind on the endpoint it belongs to (repeated_cursor / truncated need a cursor / the end of the list). */
async function readBent(kind: MalformedKind): Promise<unknown> {
  if (kind === "repeated_cursor") {
    // Two refunds, page size 1: page one is honest, page two repeats the cursor it was sent.
    const f = stripeHttpFake({ pageSize: 1 });
    seed(f, 2);
    mount(f);
    const p1 = await listRefundsPageStrict(KEY_A, PI, null);
    f.script("list", malformed(kind));
    return listRefundsPageStrict(KEY_A, PI, p1.lastId);
  }
  if (kind === "truncated") {
    // has_more true forever: the honest page claims more, and the page past the end has nothing to advance by.
    stripe.persist("list", malformed(kind));
    const p1 = await listRefundsPageStrict(KEY_A, PI, null);
    expect(p1.hasMore).toBe(true);
    return listRefundsPageStrict(KEY_A, PI, p1.lastId);
  }
  stripe.script("list", malformed(kind));
  return listRefundsPageStrict(KEY_A, PI, null);
}

describe("listRefundsPageStrict: the shape of a page", () => {
  it("requires a real `data` array (no_data_array is refund_evidence_malformed)", async () => {
    await expect(readBent("no_data_array")).rejects.toMatchObject(malformedErr);
    stripe.script("list", status(200, { object: "list", data: { 0: {} }, has_more: false }));
    await expect(listRefundsPageStrict(KEY_A, PI, null)).rejects.toMatchObject(malformedErr);
    noPosts();
  });

  it("requires a boolean `has_more` (has_more_not_boolean is refund_evidence_malformed)", async () => {
    await expect(readBent("has_more_not_boolean")).rejects.toMatchObject(malformedErr);
    stripe.script("list", status(200, { object: "list", data: [] }));
    await expect(listRefundsPageStrict(KEY_A, PI, null)).rejects.toMatchObject(malformedErr);
    noPosts();
  });

  const refused = [...LIST_MALFORMED, ...REFUND_MALFORMED].filter((k) => !KEPT_MALFORMED.includes(k));
  it.each(refused)("malformed(%s) is refund_evidence_malformed (502), never a partial answer", async (kind) => {
    await expect(readBent(kind)).rejects.toMatchObject(malformedErr);
    noPosts();
  });

  it("unknown_status parses and is KEPT verbatim", async () => {
    const page = (await readBent("unknown_status")) as Awaited<ReturnType<typeof listRefundsPageStrict>>;
    expect(page.refunds[0]!.status).toBe("under_review_fake");
    noPosts();
  });

  it("unknown_prefix parses and is KEPT as an opaque id (and is the cursor)", async () => {
    const page = (await readBent("unknown_prefix")) as Awaited<ReturnType<typeof listRefundsPageStrict>>;
    expect(page.refunds[0]!.id).toMatch(/^zzr_/);
    expect(page.lastId).toBe(page.refunds[0]!.id);
    noPosts();
  });

  it("expanded_ids (payment_intent / charge as objects) still parse to their ids", async () => {
    const page = (await readBent("expanded_ids")) as Awaited<ReturnType<typeof listRefundsPageStrict>>;
    expect(page.refunds[0]).toMatchObject({ paymentIntentId: PI, chargeId: "ch_fake_dep" });
    noPosts();
  });

  it("amounts are safe positive integer cents: 0, negative, fractional, unsafe and string amounts are refused", async () => {
    const base = stripe.world.refundBody(stripe.world.refunds[0]!);
    for (const amount of [0, -1, 1.5, 2 ** 53, "100", null]) {
      stripe.script("list", status(200, { object: "list", data: [{ ...base, amount }], has_more: false }));
      await expect(listRefundsPageStrict(KEY_A, PI, null), `amount ${String(amount)}`).rejects.toMatchObject(malformedErr);
    }
    stripe.script("list", status(200, { object: "list", data: [{ ...base, amount: Number.MAX_SAFE_INTEGER }], has_more: false }));
    expect((await listRefundsPageStrict(KEY_A, PI, null)).refunds[0]!.amountCents).toBe(Number.MAX_SAFE_INTEGER);
    noPosts();
  });

  it("a refund of another PaymentIntent in the list is refused", async () => {
    await expect(readBent("refund_other_payment_intent")).rejects.toMatchObject(malformedErr);
    const base = stripe.world.refundBody(stripe.world.refunds[0]!);
    stripe.script("list", status(200, { object: "list", data: [{ ...base, payment_intent: null }], has_more: false }));
    await expect(listRefundsPageStrict(KEY_A, PI, null)).rejects.toMatchObject(malformedErr);
    noPosts();
  });

  it("a non-terminal page needs an advancing cursor (empty non-terminal page; last id = the cursor sent)", async () => {
    await expect(readBent("non_terminal_without_cursor")).rejects.toMatchObject(malformedErr);
    await expect(readBent("repeated_cursor")).rejects.toMatchObject(malformedErr);
    // A terminal empty page is fine: "If false, this set comprises the end of the list".
    stripe.script("list", status(200, { object: "list", data: [], has_more: false }));
    expect(await listRefundsPageStrict(KEY_A, PI, null)).toEqual({ refunds: [], hasMore: false, lastId: null });
    noPosts();
  });

  it("a cursor that is not a bounded opaque id is refused before any fetch", async () => {
    await expect(listRefundsPageStrict(KEY_A, PI, "re_x/../y")).rejects.toMatchObject({ code: "bad_cursor" });
    await expect(listRefundsPageStrict(KEY_A, PI, "r".repeat(256))).rejects.toMatchObject({ code: "bad_cursor" });
    await expect(listRefundsPageStrict(KEY_A, "ch_not_a_pi", null)).rejects.toMatchObject({ code: "bad_payment_intent_id" });
    expect(stripe.calls).toHaveLength(0);
  });
});

describe("listRefundsPageStrict: pagination", () => {
  it("3 pages return every id exactly once, newest first, with has_more false only on the last", async () => {
    const f = stripeHttpFake({ pageSize: 2 });
    seed(f, 5);
    mount(f);
    const seen: StrictRefund[] = [];
    const hasMore: boolean[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page = await listRefundsPageStrict(KEY_A, PI, cursor);
      seen.push(...page.refunds);
      hasMore.push(page.hasMore);
      if (!page.hasMore) break;
      cursor = page.lastId;
    }
    expect(hasMore).toEqual([true, true, false]);
    const ids = seen.map((r) => r.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual([...f.world.refunds].reverse().map((r) => r.id));
    expect(seen.every((r) => r.requestId === REQ && r.metaQuoteId === QUOTE && r.metaPaymentId === PAY)).toBe(true);
    expect(f.calls.map((c) => c.query)).toEqual([
      `?payment_intent=${PI}&limit=100`,
      `?payment_intent=${PI}&limit=100&starting_after=${ids[1]}`,
      `?payment_intent=${PI}&limit=100&starting_after=${ids[3]}`,
    ]);
    expect(f.counts(KEY_A)).toEqual({ gets: 3, posts: 0 });
  });
});

describe("accounts: a 404 from one account says nothing", () => {
  it("another account's key gets not_found while the owning account answers", async () => {
    expect(await retrievePaymentIntentOwner(KEY_B, PI)).toEqual({ status: "not_found", chargeId: null, currency: null, livemode: null, amountCapturedCents: null });
    expect(await retrieveRefundStrict(KEY_B, firstRefundId())).toEqual({ status: "not_found" });
    expect(await retrievePaymentIntentOwner(KEY_A, PI)).toEqual({ status: "found", chargeId: "ch_fake_dep", currency: "usd", livemode: false, amountCapturedCents: 30_000 });
    expect(await retrieveRefundStrict(KEY_A, firstRefundId())).toMatchObject({ status: "found", refund: { id: firstRefundId(), amountCents: 100, paymentIntentId: PI } });
    // A list asked of the wrong account THROWS (never an empty list that would read as "no refunds").
    await expect(listRefundsPageStrict(KEY_B, PI, null)).rejects.toMatchObject({ status: 400, code: "resource_missing" });
    expect(stripe.counts(KEY_B)).toEqual({ gets: 3, posts: 0 });
    noPosts();
  });
});

describe("failures to ask THROW with their status", () => {
  const reads = {
    payment_intent: () => retrievePaymentIntentOwner(KEY_A, PI),
    list: () => listRefundsPageStrict(KEY_A, PI, null),
    refund: () => retrieveRefundStrict(KEY_A, firstRefundId()),
  } as const;
  for (const [endpoint, read] of Object.entries(reads) as Array<[keyof typeof reads, () => Promise<unknown>]>) {
    it.each([401, 403, 429, 500, 502, 503])(`${endpoint}: a %i throws with its status preserved`, async (n) => {
      stripe.script(endpoint, status(n));
      await expect(read()).rejects.toMatchObject({ status: n });
      noPosts();
    });
  }
  it("a network failure is StripeError status 0 network_error", async () => {
    stripe.script("refund", networkError());
    await expect(retrieveRefundStrict(KEY_A, firstRefundId())).rejects.toMatchObject({ status: 0, code: "network_error" });
    noPosts();
  });
});

describe("deadlines", () => {
  it("the per-call deadline (timeoutMs) aborts a delayed answer as StripeError status 0", async () => {
    for (const [endpoint, read] of [
      ["payment_intent", () => retrievePaymentIntentOwner(KEY_A, PI, 300)],
      ["list", () => listRefundsPageStrict(KEY_A, PI, null, 300)],
      ["refund", () => retrieveRefundStrict(KEY_A, firstRefundId(), 300)],
    ] as const) {
      stripe.script(endpoint, delay(5_000));
      const t0 = Date.now();
      const err = await read().then(() => null, (e: unknown) => e);
      expect(err, endpoint).toBeInstanceOf(StripeError);
      expect(err).toMatchObject({ status: 0, code: "network_error" });
      expect(Date.now() - t0).toBeLessThan(2_500);
    }
    noPosts();
  });

  it("a late answer inside the deadline is still the answer", async () => {
    stripe.script("refund", delay(20));
    expect((await retrieveRefundStrict(KEY_A, firstRefundId(), 2_000)).status).toBe("found");
    noPosts();
  });

  it("a deadline under 250 ms refuses before any fetch (deadline_exhausted)", async () => {
    for (const ms of [249, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(retrievePaymentIntentOwner(KEY_A, PI, ms)).rejects.toMatchObject({ status: 0, code: "deadline_exhausted" });
      await expect(listRefundsPageStrict(KEY_A, PI, null, ms)).rejects.toMatchObject({ status: 0, code: "deadline_exhausted" });
      await expect(retrieveRefundStrict(KEY_A, firstRefundId(), ms)).rejects.toMatchObject({ status: 0, code: "deadline_exhausted" });
    }
    expect(stripe.calls).toHaveLength(0);
  });
});

describe("retrieveRefundStrict", () => {
  it("URL-encodes and bounds the id: a slash or 300 chars is refused with NO fetch; 255 chars is asked", async () => {
    for (const bad of ["re_a/b", "../re_x", "re_a%2Fb", "re_a?x=1", "r".repeat(300), ""]) {
      await expect(retrieveRefundStrict(KEY_A, bad)).rejects.toMatchObject({ status: 400, code: "bad_refund_id" });
    }
    expect(stripe.calls).toHaveLength(0);
    const long = "r".repeat(255);
    expect(await retrieveRefundStrict(KEY_A, long)).toEqual({ status: "not_found" });
    expect(stripe.calls.map((c) => c.path)).toEqual([`/v1/refunds/${long}`]);
    noPosts();
  });

  it("refuses a malformed refund or an answer for another refund id", async () => {
    // retrieveRefundStrict is told only a refund id, so it cannot judge the PaymentIntent: it REPORTS the one the
    // answer names and the caller (lib/catering/refund-reconcile.ts -> 0359's evidence contract) verifies it.
    stripe.script("refund", malformed("refund_other_payment_intent"));
    expect(await retrieveRefundStrict(KEY_A, firstRefundId())).toMatchObject({ status: "found", refund: { paymentIntentId: "pi_fake_other_intent" } });
    for (const kind of REFUND_MALFORMED.filter((k) => !KEPT_MALFORMED.includes(k) && k !== "refund_other_payment_intent")) {
      stripe.script("refund", malformed(kind));
      await expect(retrieveRefundStrict(KEY_A, firstRefundId()), kind).rejects.toMatchObject(malformedErr);
    }
    // unknown_prefix rewrites the id, so the answer is about ANOTHER refund than the one asked for.
    stripe.script("refund", malformed("unknown_prefix"));
    await expect(retrieveRefundStrict(KEY_A, firstRefundId())).rejects.toMatchObject(malformedErr);
    noPosts();
  });

  it("keeps an unfamiliar status, an unfamiliar id prefix and expanded ids", async () => {
    stripe.script("refund", malformed("unknown_status"));
    expect(await retrieveRefundStrict(KEY_A, firstRefundId())).toMatchObject({ status: "found", refund: { status: "under_review_fake" } });
    stripe.script("refund", malformed("expanded_ids"));
    expect(await retrieveRefundStrict(KEY_A, firstRefundId())).toMatchObject({ refund: { paymentIntentId: PI, chargeId: "ch_fake_dep" } });
    const odd = stripe.world.addRefund({ id: "zzr_fake_opaque_1", paymentIntentId: PI, amount: 5 });
    expect(await retrieveRefundStrict(KEY_A, odd.id)).toMatchObject({ status: "found", refund: { id: "zzr_fake_opaque_1" } });
    noPosts();
  });
});

describe("retrievePaymentIntentOwner", () => {
  it("refuses an answer for another PaymentIntent", async () => {
    stripe.script("payment_intent", malformed("pi_other_id"));
    await expect(retrievePaymentIntentOwner(KEY_A, PI)).rejects.toMatchObject(malformedErr);
    stripe.script("payment_intent", status(200, null));
    await expect(retrievePaymentIntentOwner(KEY_A, PI)).rejects.toMatchObject(malformedErr);
    noPosts();
  });

  it("an unexpanded charge keeps the charge id and has no usable captured amount", async () => {
    stripe.script("payment_intent", malformed("pi_charge_unexpanded"));
    expect(await retrievePaymentIntentOwner(KEY_A, PI)).toMatchObject({ status: "found", chargeId: "ch_fake_dep", amountCapturedCents: null });
    expect(stripe.calls[0]!.query).toBe("?expand%5B%5D=latest_charge");
    noPosts();
  });
});

describe("createRefund", () => {
  const INPUT = { paymentIntentId: PI, amountCents: 2_500, reason: "requested_by_customer" as const, metadata: { refund_request_id: REQ, quote_id: QUOTE, payment_id: PAY } };
  const IDEM = `catering-refund:${REQ}`;
  const posts = () => stripe.calls.filter((c) => c.method === "POST");

  it("sends the same Idempotency-Key and form parameters on every attempt; a saved 500 replays", async () => {
    const bodies: string[] = [];
    const realFetch = stripe.fetch;
    vi.stubGlobal("fetch", (u: unknown, init: { body?: string }) => {
      bodies.push(String(init.body));
      return realFetch(u, init);
    });
    stripe.script("create", [networkError("before"), status(500)]);
    await expect(createRefund(KEY_A, INPUT, IDEM)).rejects.toMatchObject({ status: 0, code: "network_error" });
    await expect(createRefund(KEY_A, INPUT, IDEM)).rejects.toMatchObject({ status: 500 });
    // The 500 was saved under the key: Stripe replays it, the refund is never made by this key.
    await expect(createRefund(KEY_A, INPUT, IDEM)).rejects.toMatchObject({ status: 500 });
    expect(posts().map((c) => c.idempotencyKey)).toEqual([IDEM, IDEM, IDEM]);
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toBe(`payment_intent=${PI}&amount=2500&reason=requested_by_customer&metadata%5Brefund_request_id%5D=${REQ}&metadata%5Bquote_id%5D=${QUOTE}&metadata%5Bpayment_id%5D=${PAY}`);
    expect(stripe.world.refunds).toHaveLength(1); // only the seeded one
  });

  it("a lost response after execution: the retry with the same key replays the ORIGINAL refund", async () => {
    stripe.script("create", networkError("after_executing"));
    await expect(createRefund(KEY_A, INPUT, IDEM)).rejects.toMatchObject({ status: 0 });
    const r = await createRefund(KEY_A, INPUT, IDEM);
    expect(r).toMatchObject({ amountCents: 2_500, requestId: REQ, status: "succeeded" });
    expect(stripe.world.refunds.filter((x) => x.amount === 2_500)).toHaveLength(1);
    expect(stripe.world.creates.map((c) => c.replayed)).toEqual([false, true]);
  });

  it("honours timeoutMs: a late answer aborts as status 0, and the refund it made is replayed by the retry", async () => {
    stripe.script("create", delay(5_000));
    const t0 = Date.now();
    await expect(createRefund(KEY_A, INPUT, IDEM, 100)).rejects.toMatchObject({ status: 0, code: "network_error" });
    expect(Date.now() - t0).toBeLessThan(2_500);
    const again = await createRefund(KEY_A, INPUT, IDEM, 2_000);
    expect(stripe.world.refunds.filter((x) => x.id === again.id)).toHaveLength(1);
    expect(stripe.world.refunds).toHaveLength(2);
  });

  it("the same key with other parameters is a 400 idempotency_error; over-refund is charge_already_refunded (saved)", async () => {
    await createRefund(KEY_A, INPUT, IDEM);
    await expect(createRefund(KEY_A, { ...INPUT, amountCents: 2_501 }, IDEM)).rejects.toMatchObject({ status: 400, code: "idempotency_error" });
    const big = { ...INPUT, amountCents: 30_000 };
    await expect(createRefund(KEY_A, big, "k-over")).rejects.toMatchObject({ status: 400, code: "charge_already_refunded" });
    await expect(createRefund(KEY_A, big, "k-over")).rejects.toMatchObject({ status: 400, code: "charge_already_refunded" });
    expect(stripe.world.creates.filter((c) => c.idempotencyKey === "k-over").map((c) => c.replayed)).toEqual([false, true]);
  });

  it("another account's key cannot refund this PaymentIntent", async () => {
    await expect(createRefund(KEY_B, INPUT, IDEM)).rejects.toMatchObject({ status: 400, code: "resource_missing" });
    expect(stripe.world.refunds).toHaveLength(1);
  });
});

describe("rotated credentials (same account, new key)", () => {
  const INPUT = { paymentIntentId: PI, amountCents: 700, reason: null, metadata: { refund_request_id: REQ, quote_id: QUOTE, payment_id: PAY } };

  it("the old key is 401 api_key_expired; the new key sees the same objects", async () => {
    stripe.rotateKey(KEY_A, KEY_A2);
    await expect(retrievePaymentIntentOwner(KEY_A, PI)).rejects.toMatchObject({ status: 401, code: "api_key_expired" });
    expect((await retrievePaymentIntentOwner(KEY_A2, PI)).status).toBe("found");
    expect((await listRefundsPageStrict(KEY_A2, PI, null)).refunds.map((r) => r.id)).toEqual([firstRefundId()]);
    expect(stripe.counts(KEY_A)).toEqual({ gets: 3, posts: 0 }); // both keys are one account
    noPosts();
  });

  it("DEFAULT idempotencyAcrossRotation \"lost\": a re-POST with the rotated key creates a SECOND refund (why the app discovers and adopts first)", async () => {
    await createRefund(KEY_A, INPUT, "k-rot");
    stripe.rotateKey(KEY_A, KEY_A2);
    await createRefund(KEY_A2, INPUT, "k-rot");
    expect(stripe.world.refunds.filter((r) => r.amount === 700)).toHaveLength(2);
    // Discovery by PaymentIntent with the new key sees the first one, so an app that lists first can adopt it.
    expect((await listRefundsPageStrict(KEY_A2, PI, null)).refunds.filter((r) => r.amountCents === 700)).toHaveLength(2);
  });

  it("idempotencyAcrossRotation \"kept\": the rotated key replays the original create", async () => {
    const f = stripeHttpFake({ idempotencyAcrossRotation: "kept" });
    seed(f);
    mount(f);
    const first = await createRefund(KEY_A, INPUT, "k-rot");
    f.rotateKey(KEY_A, KEY_A2);
    expect(await createRefund(KEY_A2, INPUT, "k-rot")).toEqual(first);
    expect(f.world.refunds.filter((r) => r.amount === 700)).toHaveLength(1);
  });
});

describe("the fake itself never leaves the process", () => {
  it("an unknown host, path or key THROWS", async () => {
    await expect(stripe.fetch("https://example.test/v1/refunds", {})).rejects.toThrow(/left for/);
    await expect(stripe.fetch("https://api.stripe.com/v1/charges/ch_1", { headers: { Authorization: `Bearer ${KEY_A}` } })).rejects.toThrow(/unmodelled/);
    await expect(retrieveRefundStrict("sk_test_fake_never_registered", "re_x")).rejects.toThrow(/no test registered/);
  });
});

describe("tests/stripe-fake.ts (function level) agrees with the real client over the HTTP fake", () => {
  type Outcome = { ok: unknown } | { err: { status: number; code: string } };
  const outcome = (p: Promise<unknown>): Promise<Outcome> =>
    p.then((ok) => ({ ok }), (e: unknown) => {
      if (e instanceof StripeError) return { err: { status: e.status, code: e.code } };
      throw e;
    });

  const lists: MalformedKind[] = [...LIST_MALFORMED.filter((k) => k !== "repeated_cursor" && k !== "truncated"), ...REFUND_MALFORMED];
  it.each(lists)("list + malformed(%s): same outcome", async (kind) => {
    const fn = stripeFake();
    fn.refundWorld.addPaymentIntent({ id: PI, account: KEY_A, amountCaptured: 30_000, chargeId: "ch_fake_dep" });
    // Same ids and `created` in both worlds.
    for (const r of stripe.world.refunds) fn.refundWorld.addRefund({ ...r });
    stripe.script("list", malformed(kind));
    fn.refundWorld.script("list", malformed(kind));
    expect(await outcome(fn.listRefundsPageStrict(KEY_A, PI, null))).toEqual(await outcome(listRefundsPageStrict(KEY_A, PI, null)));
  });

  it("repeated_cursor, truncated, statuses, 404s, deadlines and rotation: same outcomes", async () => {
    const h = stripeHttpFake({ pageSize: 1 });
    seed(h, 2);
    mount(h);
    const fn = stripeFake({ pageSize: 1 });
    fn.refundWorld.account(KEY_B);
    fn.refundWorld.addPaymentIntent({ id: PI, account: KEY_A, amountCaptured: 30_000, chargeId: "ch_fake_dep" });
    for (const r of h.world.refunds) fn.refundWorld.addRefund({ ...r });
    const both = async (setup: (w: typeof h.world) => void, call: (api: { list: typeof listRefundsPageStrict; pi: typeof retrievePaymentIntentOwner; one: typeof retrieveRefundStrict }) => Promise<unknown>) => {
      setup(h.world);
      setup(fn.refundWorld);
      const real = await outcome(call({ list: listRefundsPageStrict, pi: retrievePaymentIntentOwner, one: retrieveRefundStrict }));
      const mirror = await outcome(call({ list: fn.listRefundsPageStrict, pi: fn.retrievePaymentIntentOwner, one: fn.retrieveRefundStrict }));
      expect(mirror).toEqual(real);
      h.world.clearScripts();
      fn.refundWorld.clearScripts();
      return real;
    };
    const p1 = await both(() => {}, (a) => a.list(KEY_A, PI, null));
    const cursor = ((p1 as { ok: { lastId: string } }).ok).lastId;
    await both((w) => w.script("list", malformed("repeated_cursor")), (a) => a.list(KEY_A, PI, cursor));
    await both((w) => w.persist("list", malformed("truncated")), async (a) => {
      const last = await a.list(KEY_A, PI, cursor);
      return a.list(KEY_A, PI, (last as { lastId: string }).lastId);
    });
    for (const n of [401, 403, 429, 500]) await both((w) => w.script("payment_intent", status(n)), (a) => a.pi(KEY_A, PI));
    await both(() => {}, (a) => a.pi(KEY_B, PI));
    await both(() => {}, (a) => a.one(KEY_B, h.world.refunds[0]!.id));
    await both(() => {}, (a) => a.list(KEY_B, PI, null));
    await both((w) => w.script("payment_intent", malformed("pi_other_id")), (a) => a.pi(KEY_A, PI));
    await both((w) => w.script("refund", delay(3_000)), (a) => a.one(KEY_A, h.world.refunds[0]!.id, 300));
    await both(() => {}, (a) => a.one(KEY_A, h.world.refunds[0]!.id, 100));
    h.rotateKey(KEY_A, KEY_A2);
    fn.refundWorld.rotateKey(KEY_A, KEY_A2);
    await both(() => {}, (a) => a.pi(KEY_A, PI));
    await both(() => {}, (a) => a.pi(KEY_A2, PI));
  });

  it("function-level createRefund: idempotent replay, lost rotation default, deadline", async () => {
    const fn = stripeFake();
    fn.refundWorld.addPaymentIntent({ id: PI, account: KEY_A, amountCaptured: 1_000 });
    const input = { paymentIntentId: PI, amountCents: 400, reason: null, metadata: { refund_request_id: REQ, quote_id: QUOTE, payment_id: PAY } };
    fn.refundWorld.script("create", delay(2_000));
    await expect(fn.createRefund(KEY_A, input, "k", 100)).rejects.toMatchObject({ status: 0, code: "network_error" });
    const replay = await fn.createRefund(KEY_A, input, "k");
    expect(fn.refundWorld.refunds).toHaveLength(1);
    expect(replay).toMatchObject({ id: fn.refundWorld.refunds[0]!.id, amountCents: 400, requestId: REQ });
    fn.refundWorld.rotateKey(KEY_A, KEY_A2);
    await expect(fn.createRefund(KEY_A, input, "k")).rejects.toMatchObject({ status: 401, code: "api_key_expired" });
    await fn.createRefund(KEY_A2, input, "k");
    expect(fn.refundWorld.refunds).toHaveLength(2);
    await expect(fn.createRefund(KEY_A2, { ...input, amountCents: 300 }, "k2")).rejects.toMatchObject({ status: 400, code: "charge_already_refunded" });
    expect(fn.refundCalls.every((c) => c.endpoint === "create")).toBe(true);
  });
});
