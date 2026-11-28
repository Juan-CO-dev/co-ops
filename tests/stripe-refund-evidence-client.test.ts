/**
 * The REAL refund calls of lib/stripe/client.ts (Part B1 v2, plan 3.1) over the account-aware HTTP fake
 * (tests/stripe-http-fake.ts). Never a network call: `fetch` IS the fake, every key is a fake string, all data is
 * synthetic. Carried from 71b7e316 (the strict parse, the owner read, the exact retrieve, the per-call deadline) and
 * extended for v2: the two list filters and their membership rule, redirects never followed, and
 * `create_refund_is_one_outbound_post` (the fake counts HTTP REQUESTS, not `fetch` calls). Static [Q3]: nothing in
 * the client or the refund libs reads the charge's refunded total.
 */
import { readFileSync } from "node:fs";
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
import { refundIdempotencyKey } from "@/lib/catering/refunds-shared";
import {
  delay,
  KEPT_MALFORMED,
  LIST_MALFORMED,
  malformed,
  networkError,
  redirect,
  REFUND_MALFORMED,
  status,
  stripeHttpFake,
  type MalformedKind,
  type Step,
  type StripeHttpFake,
} from "./stripe-http-fake";

const KEY_A = "sk_test_fake_A";
const KEY_B = "sk_test_fake_B";
const KEY_A2 = "sk_test_fake_A_rotated";
const PI = "pi_fake_dep";
const CH = "ch_fake_dep";
const REQ = "11111111-1111-4111-8111-111111111111";
const QUOTE = "22222222-2222-4222-8222-222222222222";
const PAY = "33333333-3333-4333-8333-333333333333";
const BY_PI = { paymentIntentId: PI, ownerChargeId: CH } as const;
const BY_CH = { chargeId: CH, ownerPaymentIntentId: PI } as const;

let stripe: StripeHttpFake;

function seed(fake: StripeHttpFake, refunds = 1) {
  fake.account(KEY_A);
  fake.account(KEY_B);
  fake.world.addPaymentIntent({ id: PI, account: KEY_A, amountCaptured: 30_000, chargeId: CH });
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
    const f = stripeHttpFake({ pageSize: 1 });
    seed(f, 2);
    mount(f);
    const p1 = await listRefundsPageStrict(KEY_A, BY_PI, null);
    f.script("list", malformed(kind));
    return listRefundsPageStrict(KEY_A, BY_PI, p1.lastId);
  }
  if (kind === "truncated") {
    stripe.persist("list", malformed(kind));
    const p1 = await listRefundsPageStrict(KEY_A, BY_PI, null);
    expect(p1.hasMore).toBe(true);
    return listRefundsPageStrict(KEY_A, BY_PI, p1.lastId);
  }
  stripe.script("list", malformed(kind));
  return listRefundsPageStrict(KEY_A, BY_PI, null);
}

describe("listRefundsPageStrict: the shape of a page (carried)", () => {
  it("requires a real `data` array", async () => {
    await expect(readBent("no_data_array")).rejects.toMatchObject(malformedErr);
    stripe.script("list", status(200, { object: "list", data: { 0: {} }, has_more: false }));
    await expect(listRefundsPageStrict(KEY_A, BY_PI, null)).rejects.toMatchObject(malformedErr);
    noPosts();
  });

  it("requires a boolean `has_more`", async () => {
    await expect(readBent("has_more_not_boolean")).rejects.toMatchObject(malformedErr);
    stripe.script("list", status(200, { object: "list", data: [] }));
    await expect(listRefundsPageStrict(KEY_A, BY_PI, null)).rejects.toMatchObject(malformedErr);
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
  });

  it("unknown_prefix parses and is KEPT as an opaque id (the read refuses to hand it to 0359: refund_id_unrecognised)", async () => {
    const page = (await readBent("unknown_prefix")) as Awaited<ReturnType<typeof listRefundsPageStrict>>;
    expect(page.refunds[0]!.id).toMatch(/^zzr_/);
    expect(page.lastId).toBe(page.refunds[0]!.id);
  });

  it("expanded_ids (payment_intent / charge as objects) still parse to their ids", async () => {
    const page = (await readBent("expanded_ids")) as Awaited<ReturnType<typeof listRefundsPageStrict>>;
    expect(page.refunds[0]).toMatchObject({ paymentIntentId: PI, chargeId: CH });
  });

  it("amounts are safe positive integer cents", async () => {
    const base = stripe.world.refundBody(stripe.world.refunds[0]!);
    for (const amount of [0, -1, 1.5, 2 ** 53, "100", null]) {
      stripe.script("list", status(200, { object: "list", data: [{ ...base, amount }], has_more: false }));
      await expect(listRefundsPageStrict(KEY_A, BY_PI, null), `amount ${String(amount)}`).rejects.toMatchObject(malformedErr);
    }
    stripe.script("list", status(200, { object: "list", data: [{ ...base, amount: Number.MAX_SAFE_INTEGER }], has_more: false }));
    expect((await listRefundsPageStrict(KEY_A, BY_PI, null)).refunds[0]!.amountCents).toBe(Number.MAX_SAFE_INTEGER);
    noPosts();
  });

  it("a non-terminal page needs an advancing cursor; a terminal empty page is the end", async () => {
    await expect(readBent("non_terminal_without_cursor")).rejects.toMatchObject(malformedErr);
    await expect(readBent("repeated_cursor")).rejects.toMatchObject(malformedErr);
    stripe.script("list", status(200, { object: "list", data: [], has_more: false }));
    expect(await listRefundsPageStrict(KEY_A, BY_PI, null)).toEqual({ refunds: [], hasMore: false, lastId: null });
  });

  it("a cursor or id that is not a bounded opaque id is refused before any fetch", async () => {
    await expect(listRefundsPageStrict(KEY_A, BY_PI, "re_x/../y")).rejects.toMatchObject({ code: "bad_cursor" });
    await expect(listRefundsPageStrict(KEY_A, BY_PI, "r".repeat(256))).rejects.toMatchObject({ code: "bad_cursor" });
    await expect(listRefundsPageStrict(KEY_A, { paymentIntentId: "ch_not_a_pi", ownerChargeId: CH }, null)).rejects.toMatchObject({ code: "bad_payment_intent_id" });
    await expect(listRefundsPageStrict(KEY_A, { chargeId: "ch/../x", ownerPaymentIntentId: PI }, null)).rejects.toMatchObject({ code: "bad_charge_id" });
    expect(stripe.calls).toHaveLength(0);
  });
});

describe("listRefundsPageStrict: the two filters and the membership rule (v2)", () => {
  it("by PaymentIntent and by charge ask Stripe with exactly that filter", async () => {
    await listRefundsPageStrict(KEY_A, BY_PI, null);
    await listRefundsPageStrict(KEY_A, BY_CH, null);
    expect(stripe.calls.map((c) => c.query)).toEqual([`?payment_intent=${PI}&limit=100`, `?charge=${CH}&limit=100`]);
    expect(stripe.calls.every((c) => c.redirectMode === "error")).toBe(true);
    noPosts();
  });

  it("a refund with NO PaymentIntent is found by the charge list (and belongs there)", async () => {
    const orphan = stripe.world.addRefund({ paymentIntentId: null, chargeId: CH, amount: 77 });
    const byCh = await listRefundsPageStrict(KEY_A, BY_CH, null);
    expect(byCh.refunds.map((r) => r.id)).toContain(orphan.id);
    expect(byCh.refunds.find((r) => r.id === orphan.id)).toMatchObject({ paymentIntentId: null, chargeId: CH });
    const byPi = await listRefundsPageStrict(KEY_A, BY_PI, null);
    expect(byPi.refunds.map((r) => r.id)).not.toContain(orphan.id);
  });

  it("PaymentIntent list: an item with no PaymentIntent belongs only when its charge is the owner's", async () => {
    const base = stripe.world.refundBody(stripe.world.refunds[0]!);
    stripe.script("list", status(200, { object: "list", data: [{ ...base, payment_intent: null, charge: CH }], has_more: false }));
    expect((await listRefundsPageStrict(KEY_A, BY_PI, null)).refunds).toHaveLength(1);
    stripe.script("list", status(200, { object: "list", data: [{ ...base, payment_intent: null, charge: "ch_fake_other" }], has_more: false }));
    await expect(listRefundsPageStrict(KEY_A, BY_PI, null)).rejects.toMatchObject(malformedErr);
    stripe.script("list", status(200, { object: "list", data: [{ ...base, payment_intent: null }], has_more: false }));
    await expect(listRefundsPageStrict(KEY_A, { paymentIntentId: PI, ownerChargeId: null }, null)).rejects.toMatchObject(malformedErr);
    stripe.script("list", status(200, { object: "list", data: [{ ...base, payment_intent: "pi_fake_other" }], has_more: false }));
    await expect(listRefundsPageStrict(KEY_A, BY_PI, null)).rejects.toMatchObject(malformedErr);
  });

  it("charge list: an item with no charge belongs only when its PaymentIntent is the owner's; another charge never", async () => {
    const base = stripe.world.refundBody(stripe.world.refunds[0]!);
    stripe.script("list", status(200, { object: "list", data: [{ ...base, charge: null }], has_more: false }));
    expect((await listRefundsPageStrict(KEY_A, BY_CH, null)).refunds).toHaveLength(1);
    stripe.script("list", status(200, { object: "list", data: [{ ...base, charge: null, payment_intent: "pi_fake_other" }], has_more: false }));
    await expect(listRefundsPageStrict(KEY_A, BY_CH, null)).rejects.toMatchObject(malformedErr);
    stripe.script("list", malformed("refund_other_charge"));
    await expect(listRefundsPageStrict(KEY_A, BY_CH, null)).rejects.toMatchObject(malformedErr);
  });

  it("a list asked of the wrong account THROWS (never an empty list that would read as `no refunds`)", async () => {
    await expect(listRefundsPageStrict(KEY_B, BY_PI, null)).rejects.toMatchObject({ status: 400, code: "resource_missing" });
    await expect(listRefundsPageStrict(KEY_B, BY_CH, null)).rejects.toMatchObject({ status: 400, code: "resource_missing" });
  });

  it("3 pages return every id exactly once, newest first, with has_more false only on the last", async () => {
    const f = stripeHttpFake({ pageSize: 2 });
    seed(f, 5);
    mount(f);
    const seen: StrictRefund[] = [];
    const hasMore: boolean[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page = await listRefundsPageStrict(KEY_A, BY_CH, cursor);
      seen.push(...page.refunds);
      hasMore.push(page.hasMore);
      if (!page.hasMore) break;
      cursor = page.lastId;
    }
    expect(hasMore).toEqual([true, true, false]);
    const ids = seen.map((r) => r.id);
    expect(ids).toEqual([...f.world.refunds].reverse().map((r) => r.id));
    expect(seen.every((r) => r.requestId === REQ && r.metaQuoteId === QUOTE && r.metaPaymentId === PAY)).toBe(true);
  });
});

describe("accounts and failures (carried)", () => {
  it("another account's key gets not_found while the owning account answers", async () => {
    expect(await retrievePaymentIntentOwner(KEY_B, PI)).toEqual({ status: "not_found", chargeId: null, currency: null, livemode: null, amountCapturedCents: null });
    expect(await retrieveRefundStrict(KEY_B, firstRefundId())).toEqual({ status: "not_found" });
    expect(await retrievePaymentIntentOwner(KEY_A, PI)).toEqual({ status: "found", chargeId: CH, currency: "usd", livemode: false, amountCapturedCents: 30_000 });
    expect(await retrieveRefundStrict(KEY_A, firstRefundId())).toMatchObject({ status: "found", refund: { id: firstRefundId(), amountCents: 100, paymentIntentId: PI } });
    noPosts();
  });

  const reads = {
    payment_intent: () => retrievePaymentIntentOwner(KEY_A, PI),
    list: () => listRefundsPageStrict(KEY_A, BY_PI, null),
    refund: () => retrieveRefundStrict(KEY_A, firstRefundId()),
  } as const;
  for (const [endpoint, read] of Object.entries(reads) as Array<[keyof typeof reads, () => Promise<unknown>]>) {
    it.each([401, 403, 429, 500, 502, 503])(`${endpoint}: a %i throws with its status preserved`, async (n) => {
      stripe.script(endpoint, status(n));
      await expect(read()).rejects.toMatchObject({ status: n });
      noPosts();
    });
    it(`${endpoint}: a 307 is NOT followed (redirect: "error"): one request, status 0`, async () => {
      stripe.script(endpoint, redirect(307));
      await expect(read()).rejects.toMatchObject({ status: 0, code: "network_error" });
      expect(stripe.httpRequests()).toBe(1);
      expect(stripe.calls.some((c) => c.followed)).toBe(false);
    });
  }

  it("a network failure is StripeError status 0 network_error", async () => {
    stripe.script("refund", networkError());
    await expect(retrieveRefundStrict(KEY_A, firstRefundId())).rejects.toMatchObject({ status: 0, code: "network_error" });
  });

  it("the old key of a rotated account is 401; the new key sees the same objects", async () => {
    stripe.rotateKey(KEY_A, KEY_A2);
    await expect(retrievePaymentIntentOwner(KEY_A, PI)).rejects.toMatchObject({ status: 401, code: "api_key_expired" });
    expect((await retrievePaymentIntentOwner(KEY_A2, PI)).status).toBe("found");
  });
});

describe("deadlines (carried)", () => {
  it("the per-call deadline aborts a delayed answer as StripeError status 0", async () => {
    for (const [endpoint, read] of [
      ["payment_intent", () => retrievePaymentIntentOwner(KEY_A, PI, 300)],
      ["list", () => listRefundsPageStrict(KEY_A, BY_PI, null, 300)],
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

  it("a deadline under 250 ms refuses before any fetch (deadline_exhausted)", async () => {
    for (const ms of [249, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(retrievePaymentIntentOwner(KEY_A, PI, ms)).rejects.toMatchObject({ status: 0, code: "deadline_exhausted" });
      await expect(listRefundsPageStrict(KEY_A, BY_PI, null, ms)).rejects.toMatchObject({ status: 0, code: "deadline_exhausted" });
      await expect(retrieveRefundStrict(KEY_A, firstRefundId(), ms)).rejects.toMatchObject({ status: 0, code: "deadline_exhausted" });
    }
    expect(stripe.calls).toHaveLength(0);
  });
});

describe("retrieveRefundStrict / retrievePaymentIntentOwner (carried)", () => {
  it("URL-encodes and bounds the id: a slash or 300 chars is refused with NO fetch; 255 chars is asked", async () => {
    for (const bad of ["re_a/b", "../re_x", "re_a%2Fb", "re_a?x=1", "r".repeat(300), ""]) {
      await expect(retrieveRefundStrict(KEY_A, bad)).rejects.toMatchObject({ status: 400, code: "bad_refund_id" });
    }
    expect(stripe.calls).toHaveLength(0);
    const long = "r".repeat(255);
    expect(await retrieveRefundStrict(KEY_A, long)).toEqual({ status: "not_found" });
  });

  it("refuses a malformed refund or an answer for another refund id; REPORTS another PaymentIntent (0359 verifies it)", async () => {
    stripe.script("refund", malformed("refund_other_payment_intent"));
    expect(await retrieveRefundStrict(KEY_A, firstRefundId())).toMatchObject({ status: "found", refund: { paymentIntentId: "pi_fake_other_intent" } });
    for (const kind of REFUND_MALFORMED.filter((k) => !KEPT_MALFORMED.includes(k) && k !== "refund_other_payment_intent" && k !== "refund_other_charge")) {
      stripe.script("refund", malformed(kind));
      await expect(retrieveRefundStrict(KEY_A, firstRefundId()), kind).rejects.toMatchObject(malformedErr);
    }
    stripe.script("refund", malformed("unknown_prefix"));
    await expect(retrieveRefundStrict(KEY_A, firstRefundId())).rejects.toMatchObject(malformedErr);
  });

  it("the owner read refuses an answer for another PaymentIntent; an unexpanded charge has no captured amount", async () => {
    stripe.script("payment_intent", malformed("pi_other_id"));
    await expect(retrievePaymentIntentOwner(KEY_A, PI)).rejects.toMatchObject(malformedErr);
    stripe.script("payment_intent", malformed("pi_charge_unexpanded"));
    expect(await retrievePaymentIntentOwner(KEY_A, PI)).toMatchObject({ status: "found", chargeId: CH, amountCapturedCents: null });
    expect(stripe.calls.at(-1)!.query).toBe("?expand%5B%5D=latest_charge");
  });

  it("[Q3] the owner answer carries NO refunded total, whatever the charge says", async () => {
    stripe.world.addRefund({ paymentIntentId: PI, amount: 9_999 });
    const owner = await retrievePaymentIntentOwner(KEY_A, PI);
    expect(Object.keys(owner).sort()).toEqual(["amountCapturedCents", "chargeId", "currency", "livemode", "status"]);
  });
});

describe("createRefund", () => {
  const INPUT = { paymentIntentId: PI, amountCents: 2_500, reason: "requested_by_customer" as const, metadata: { refund_request_id: REQ, quote_id: QUOTE, payment_id: PAY } };
  const posts = () => stripe.calls.filter((c) => c.method === "POST");

  it("sends the request's own Idempotency-Key and metadata, and returns the parsed strict refund", async () => {
    const out = await createRefund(KEY_A, INPUT);
    expect(out.kind).toBe("created");
    if (out.kind !== "created") throw new Error("unreachable");
    expect(out.refund).toMatchObject({ amountCents: 2_500, requestId: REQ, paymentIntentId: PI, chargeId: CH, currency: "usd", status: "succeeded" });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.idempotencyKey).toBe(refundIdempotencyKey(REQ));
    expect(posts()[0]!.idempotencyKey).toBe(`catering-refund:${REQ}`);
    expect(posts()[0]!.redirectMode).toBe("manual");
    expect(posts()[0]!.body).toBe(`payment_intent=${PI}&amount=2500&reason=requested_by_customer&metadata%5Brefund_request_id%5D=${REQ}&metadata%5Bquote_id%5D=${QUOTE}&metadata%5Bpayment_id%5D=${PAY}`);
  });

  it("no reason is omitted, not sent empty", async () => {
    await createRefund(KEY_A, { ...INPUT, reason: null });
    expect(posts()[0]!.body).not.toContain("reason=");
  });

  describe("create_refund_is_one_outbound_post", () => {
    const cases: Array<[string, Step, string, number?]> = [
      ["500", status(500), "refused"],
      ["409", status(409), "refused"],
      ["429", status(429), "refused"],
      ["400", status(400, { error: { code: "charge_already_refunded", message: "x" } }), "refused"],
      ["timeout", delay(5_000), "no_response", 150],
      ["network error before", networkError("before"), "no_response"],
      ["network error after executing", networkError("after_executing"), "no_response"],
      ["307 (not followed)", redirect(307), "refused"],
      ["308 (not followed)", redirect(308), "refused"],
      ["2xx unparseable", status(200, { id: "re_x" }), "unparseable"],
    ];
    it.each(cases)("%s: exactly ONE HTTP request, the outcome is not `created`", async (_name, step, kind, timeoutMs) => {
      stripe.script("create", step);
      const out = await createRefund(KEY_A, INPUT, timeoutMs ?? 20_000);
      expect(out.kind).toBe(kind);
      expect(stripe.httpRequests("POST")).toBe(1);
      expect(stripe.httpRequests()).toBe(1);
      expect(stripe.calls.some((c) => c.followed)).toBe(false);
      if (out.kind === "refused") expect(out.httpStatus).toBe(Number(_name.slice(0, 3)) || out.httpStatus);
    });

    it("the 307 / 308 are named, and the refusal keeps Stripe's code", async () => {
      stripe.script("create", redirect(308));
      expect(await createRefund(KEY_A, INPUT)).toMatchObject({ kind: "refused", httpStatus: 308, code: "redirect_not_followed" });
      stripe.script("create", status(400, { error: { code: "charge_already_refunded", message: "x" } }));
      expect(await createRefund(KEY_A, INPUT)).toMatchObject({ kind: "refused", httpStatus: 400, code: "charge_already_refunded" });
    });

    it("the timeout is named `timeout`; a dropped connection `network_error`", async () => {
      stripe.script("create", delay(5_000));
      expect(await createRefund(KEY_A, INPUT, 100)).toEqual({ kind: "no_response", code: "timeout" });
      stripe.script("create", networkError("before"));
      expect(await createRefund(KEY_A, INPUT)).toEqual({ kind: "no_response", code: "network_error" });
    });

    it("the fake DOES follow a 307 for a default-mode fetch (so the counts above would catch a followed redirect)", async () => {
      stripe.script("create", redirect(307));
      await stripe.fetch("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY_A}`, "Idempotency-Key": "k-follow" },
        body: `payment_intent=${PI}&amount=1`,
      });
      expect(stripe.httpRequests("POST")).toBe(2);
      expect(stripe.calls[1]!.followed).toBe(true);
    });

    it("a refusal before any request is `not_sent` and makes NO request", async () => {
      expect(await createRefund("", INPUT)).toEqual({ kind: "not_sent", code: "not_configured" });
      expect(await createRefund(KEY_A, { ...INPUT, paymentIntentId: "ch_x" })).toEqual({ kind: "not_sent", code: "bad_payment_intent_id" });
      for (const amountCents of [0, -1, 1.5, Number.NaN]) {
        expect(await createRefund(KEY_A, { ...INPUT, amountCents })).toEqual({ kind: "not_sent", code: "bad_amount" });
      }
      expect(await createRefund(KEY_A, { ...INPUT, metadata: { ...INPUT.metadata, refund_request_id: "not-a-uuid" } })).toEqual({ kind: "not_sent", code: "bad_request_id" });
      expect(stripe.calls).toHaveLength(0);
    });

    it("statically: createRefund makes ONE fetch, has no loop, and sends redirect: \"manual\"", () => {
      const src = readFileSync("lib/stripe/client.ts", "utf8");
      const start = src.indexOf("export async function createRefund(");
      expect(start).toBeGreaterThan(0);
      const body = src.slice(start, src.indexOf("\n}\n", start));
      expect(body.match(/\bfetch\(/g)).toHaveLength(1);
      expect(body).not.toMatch(/\b(for|while|do)\s*[({]/);
      expect(body).toContain('redirect: "manual"');
      expect(body.match(/createRefund\(/g)).toHaveLength(1); // its own signature: it never calls itself
    });
  });

  it("the money: a 2xx carries the refund the fake made, exactly once", async () => {
    await createRefund(KEY_A, INPUT);
    expect(stripe.world.refunds.filter((r) => r.amount === 2_500)).toHaveLength(1);
    expect(stripe.world.creates.map((c) => c.idempotencyKey)).toEqual([`catering-refund:${REQ}`]);
  });
});

describe("[Q3] the charge's refunded total is not parsed, carried or compared anywhere", () => {
  it.each(["lib/stripe/client.ts", "lib/catering/refund-observe.ts", "lib/catering/refunds.ts", "lib/catering/refunds-shared.ts"])("%s never names amount_refunded", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/amount_refunded|amountRefunded|refundedCents\b/);
  });
});

describe("the fake itself never leaves the process", () => {
  it("an unknown host, path or key THROWS", async () => {
    await expect(stripe.fetch("https://example.test/v1/refunds", {})).rejects.toThrow(/left for/);
    await expect(stripe.fetch("https://api.stripe.com/v1/charges/ch_1", { headers: { Authorization: `Bearer ${KEY_A}` } })).rejects.toThrow(/unmodelled/);
    await expect(retrieveRefundStrict("sk_test_fake_never_registered", "re_x")).rejects.toThrow(/no test registered/);
  });
});
