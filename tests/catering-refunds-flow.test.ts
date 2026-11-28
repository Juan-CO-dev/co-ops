/**
 * Catering refunds Part B1 — the staff press and the reads END TO END: the app's REAL code (lib/catering/refunds.ts,
 * lib/catering/refund-reconcile.ts) over the REAL SQL (PGlite: 0357 -> 0358 -> 0359, tests/helpers/refund-pglite.ts)
 * as `service_role`, with ONE in-memory fake of Stripe (tests/helpers/refund-flow-stripe.ts: accounts by secret key,
 * an idempotency table that replays a key's first executed answer, scriptable failures, `gets` / `posts`).
 * No network, no key, synthetic rows only. Every flow test asserts the fake's POST count explicitly.
 *
 * Tests whose title starts with `LEAD_MUST_FIX` are DEFECTS this suite found in lead-owned code: they are left
 * failing on purpose (see the report) and must not be weakened to pass.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";

import { refundClient, refundDb, harnessKit, harnessLib, type RefundClientOpts } from "./helpers/refund-pglite";
import {
  KEY_A, KEY_ROTATED, KEY_SHARED, account, actorFor, flowWorld, grantAppTables, openIssues, req, reqs, rpcNames, work, writes,
  type Account, type Flow,
} from "./helpers/refund-flow-world";

const h = vi.hoisted(() => ({
  client: null as unknown,
  accounts: [] as Array<{ secretKey: string; webhookSecret: string; source: string }>,
  shopCodes: [] as Array<string | null>,
  stripe: null as unknown as import("./helpers/refund-flow-stripe").FlowStripe,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/stripe/session-owner", () => ({
  stripeAccountsForShop: (code: string | null) => {
    h.shopCodes.push(code);
    return h.accounts;
  },
}));
vi.mock("@/lib/stripe/client", async (orig) => {
  const real = await orig<typeof import("@/lib/stripe/client")>();
  return {
    ...real,
    retrievePaymentIntentOwner: (...a: Parameters<typeof real.retrievePaymentIntentOwner>) => h.stripe.retrievePaymentIntentOwner(...a),
    listRefundsPageStrict: (...a: Parameters<typeof real.listRefundsPageStrict>) => h.stripe.listRefundsPageStrict(...a),
    retrieveRefundStrict: (...a: Parameters<typeof real.retrieveRefundStrict>) => h.stripe.retrieveRefundStrict(...a),
    createRefund: (...a: Parameters<typeof real.createRefund>) => h.stripe.createRefund(...a),
  };
});

import {
  loadLeadRefundables,
  loadRefundSummary,
  requestRefund,
  retryRefundRequest,
  CateringRefundError,
  type RefundRequestBody,
} from "@/lib/catering/refunds";
import { runRefundPass, runRefundSweep } from "@/lib/catering/refund-reconcile";
import { UNEXECUTED_REFUSAL_CODES, classifyCreateFailure } from "@/lib/catering/refund-outcomes-shared";

// ── Bases (built once per file) ─────────────────────────────────────────────────────────────────────────────
let BASE: PGlite; // 0357 -> 0358 -> 0359 + the isolated fixture's B2 / B3 stand-ins
let BARE: PGlite; // a genuine 0359-only database
/** A PREEXISTING pending row reserved through 0357's own function BEFORE 0359 was applied (no epoch yet). */
let LEGACY: PGlite;
let legacy: { quote: string; payment: string; pi: string; request: string };
beforeAll(async () => {
  BASE = await grantAppTables(await refundDb());
  BARE = await grantAppTables(await refundDb({ standIns: false }));
  const db = await harnessLib.base({ upTo: "0358" });
  const w = await harnessKit.world(db);
  const owner = await w.user("owner", { member: null });
  const quote = await w.quote();
  const p = await w.pay(quote, "deposit", 30000);
  const r = (await harnessLib.one(db, "select public.catering_refund_reserve($1, $2, $3, 10000, 'customer_cancelled', null, 'panel') as r", [owner, quote, crypto.randomUUID()])).r as { requests: Array<{ id: string }> };
  await db.exec(harnessLib.M0359);
  await harnessLib.withStandIns(db);
  LEGACY = await grantAppTables(db);
  legacy = { quote, payment: p.id, pi: p.pi, request: r.requests[0]!.id };
}, 120_000);

type Calls = NonNullable<RefundClientOpts["calls"]>;
let calls: Calls;
let x: Flow;
let raw: ReturnType<typeof refundClient>;

function wire(db: PGlite, opts: { accounts?: Account[]; rpc?: RefundClientOpts["rpc"] } = {}) {
  calls = [];
  h.client = refundClient(db, { calls, rpc: opts.rpc });
  raw = refundClient(db); // the same database, no trace, no override: what an override calls through to
  h.accounts = opts.accounts ?? [account(KEY_A)];
  h.shopCodes = [];
}
/** Wire the app to a fresh clone: the client every module asks for, the shop's accounts, the fake. */
async function setup(opts: { live?: boolean; captured?: number; accounts?: Account[]; rpc?: RefundClientOpts["rpc"] } = {}): Promise<Flow> {
  const db = await BASE.clone();
  x = await flowWorld(db, { live: opts.live, captured: opts.captured });
  wire(db, opts);
  h.stripe = x.stripe;
  return x;
}
const body = (amountCents: number, clientToken: string = crypto.randomUUID()): RefundRequestBody => ({ clientToken, amountCents, reasonCode: "customer_cancelled", reasonNote: null, trigger: "panel" });
const DEADLINE = () => Date.now() + 100_000;
const through = async (fn: string, args: Record<string, unknown>) => (await (raw.rpc(fn, args) as unknown as Promise<{ data: unknown; error: unknown }>));
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof CateringRefundError) return { status: e.status, code: e.code, detail: e.detail };
    return { thrown: e instanceof Error ? e.message : String(e) };
  }
  return null;
};

beforeEach(() => {
  process.env.CATERING_REFUNDS = "1";
});
afterEach(async () => {
  await x?.db.close().catch(() => {});
});

// ═══════════════════════════════ The ordinary lifecycle ═══════════════════════════════════════════════════════
describe("the ordinary live lifecycle", () => {
  it("b1_sim_live_claim_arm_post_without_prod_bypass: open_recovery -> seed -> promote; Confirm = one claim, one arm, ONE POST under the request's key; finish; apply", async () => {
    // FIRST: a genuine 0359-only database (no B2 / B3 install records) refuses to open recovery at all.
    const bare = await BARE.clone();
    await expect(harnessKit.rpc(bare, "catering_refund_open_recovery", ["cc"])).rejects.toThrow(/install_incomplete/);
    expect(await harnessLib.count(bare, "select count(*) n from public.catering_refund_epochs")).toBe(0);
    await bare.close();

    // The ordinary operator lifecycle (goLive = open_recovery -> seed -> promote), then the app as service_role.
    await setup();
    expect((await harnessLib.one(x.db, "select state from public.catering_refund_epochs where state <> 'closed'")).state).toBe("live");
    const owner = await actorFor(x.w, "owner");
    const out = await requestRefund(owner, x.quote, body(10000), DEADLINE());
    expect(out.replay).toBe(false);
    expect(out.results).toHaveLength(1);
    const r = out.results[0]!;
    expect(r.status).toBe("succeeded");

    const names = rpcNames(calls);
    const n = (fn: string) => names.filter((m) => m === fn).length;
    expect([n("catering_refund_reserve_admitted"), n("catering_refund_claim_admitted"), n("catering_refund_arm"), n("catering_refund_finish")]).toEqual([1, 1, 1, 1]);
    // claim -> the discovery apply -> arm -> finish -> the post-create apply, in that order.
    let at = -1;
    for (const fn of ["catering_refund_claim_admitted", "catering_refund_apply", "catering_refund_arm", "catering_refund_finish", "catering_refund_apply"]) {
      at = names.indexOf(fn, at + 1);
      expect(at, `${fn} in order`).toBeGreaterThanOrEqual(0);
    }

    expect(x.stripe.posts).toBe(1);
    const post = x.stripe.creates()[0]!;
    expect(post.key).toBe(KEY_A);
    expect(post.idem).toBe(`catering-refund:${r.id}`);
    expect(JSON.parse(post.params!)).toEqual({
      paymentIntentId: x.pay.pi, amountCents: 10000, reason: "requested_by_customer",
      metadata: { refund_request_id: r.id, quote_id: x.quote, payment_id: x.pay.id },
    });
    const row = await req(x.db, r.id);
    expect([row.status, row.stripe_refund_id, row.create_armed_at != null, row.arm_count, row.claim_token]).toEqual(["succeeded", x.stripe.refundsOf(x.pay.pi)[0]!.id, true, 1, null]);
    expect(x.stripe.refundsOf(x.pay.pi)).toHaveLength(1);

    // The fake answers `pending`: the request ends `submitted`.
    await x.db.close();
    await setup();
    x.stripe.createStatus = "pending";
    const o2 = await requestRefund(await actorFor(x.w, "owner"), x.quote, body(5000), DEADLINE());
    expect(o2.results[0]!.status).toBe("submitted");
    expect(x.stripe.posts).toBe(1);
    // No bypass anywhere: the switch is the only refund env the press reads, and no entry point has a force argument.
    expect(Object.keys(process.env).filter((k) => /REFUND/i.test(k))).toEqual(["CATERING_REFUNDS"]);
    expect([requestRefund.length, retryRefundRequest.length]).toEqual([3, 3]); // (actor, quote, body[, deadline]) / (actor, quote, id[, ...])
  });

  it("the switch OFF at the moment before network I/O: armed, but nothing is POSTed", async () => {
    await setup({
      rpc: {
        catering_refund_arm: async (args) => {
          const a = await through("catering_refund_arm", args);
          process.env.CATERING_REFUNDS = "0"; // the switch is turned off between the arm and the POST
          return a as never;
        },
      },
    });
    const out = await requestRefund(await actorFor(x.w, "owner"), x.quote, body(10000), DEADLINE());
    expect([out.results[0]!.status, out.results[0]!.errorCode]).toEqual(["pending", "needs_reconcile"]);
    expect(x.stripe.posts).toBe(0);
    const row = await req(x.db, out.results[0]!.id);
    expect([row.status, row.create_armed_at != null, row.claim_token]).toEqual(["pending", true, null]);
  });
});

// ═══════════════════════════════ Part A coverage that still applies ════════════════════════════════════════════
describe("Part A gates and replays on the real SQL", () => {
  it("role gate, shop gate, 404 for a quote the viewer cannot see; nothing reaches the reserve or Stripe", async () => {
    await setup();
    const prep = await actorFor(x.w, "prep_mgr");
    expect(await refusal(requestRefund(prep, x.quote, body(1000), DEADLINE()))).toMatchObject({ status: 403, code: "forbidden" });
    const sl = await actorFor(x.w, "shift_lead");
    expect(await refusal(requestRefund(sl, x.quote, body(1000), DEADLINE()))).toMatchObject({ status: 403, code: "forbidden" });
    const otherShop = await actorFor(x.w, "catering_mgr", { member: x.w.other });
    expect(await refusal(requestRefund(otherShop, x.quote, body(1000), DEADLINE()))).toMatchObject({ status: 404, code: "not_found" });
    expect(await refusal(loadRefundSummary(otherShop, x.quote))).toMatchObject({ status: 404, code: "not_found" });
    const kh = await actorFor(x.w, "key_holder");
    expect(await refusal(loadRefundSummary(kh, x.quote))).toMatchObject({ status: 403, code: "forbidden" });
    expect(await refusal(requestRefund(await actorFor(x.w, "owner"), crypto.randomUUID(), body(1000), DEADLINE()))).toMatchObject({ status: 404, code: "not_found" });
    expect(rpcNames(calls).filter((fn) => fn === "catering_refund_reserve_admitted")).toEqual([]);
    expect([x.stripe.gets, x.stripe.posts]).toEqual([0, 0]);
    expect(await reqs(x.db)).toEqual([]);
  });

  it("the SQL actor rule decides under the lock: a GM whose membership is switched off is refused, nothing sent", async () => {
    await setup();
    const gm = await actorFor(x.w, "gm");
    await x.db.query("update public.user_locations set active = false where user_id = $1", [gm.user.id]);
    expect(await refusal(requestRefund(gm, x.quote, body(1000), DEADLINE()))).toMatchObject({ status: 403, code: "forbidden" });
    expect([x.stripe.posts, (await reqs(x.db)).length]).toEqual([0, 0]);
  });

  it("token replay = the same request: no second Stripe call, no second row", async () => {
    await setup();
    const owner = await actorFor(x.w, "owner");
    const b = body(10000);
    const first = await requestRefund(owner, x.quote, b, DEADLINE());
    const again = await requestRefund(owner, x.quote, b, DEADLINE());
    expect(again.replay).toBe(true);
    expect(again.results.map((r) => r.id)).toEqual(first.results.map((r) => r.id));
    expect(x.stripe.posts).toBe(1);
    expect(await reqs(x.db)).toHaveLength(1);
    // The same token with another amount is refused by name.
    expect(await refusal(requestRefund(owner, x.quote, { ...b, amountCents: 5000 }, DEADLINE()))).toMatchObject({ status: 409, code: "token_reused" });
    expect(x.stripe.posts).toBe(1);
  });

  it("an over-refund is refused by name before anything reaches Stripe", async () => {
    await setup();
    const owner = await actorFor(x.w, "owner");
    const r = await refusal(requestRefund(owner, x.quote, body(30001), DEADLINE()));
    expect(r).toMatchObject({ status: 409, code: "over_refundable" });
    expect([x.stripe.posts, (await reqs(x.db)).length]).toEqual([0, 0]);
  });

  it("LEAD_MUST_FIX over_refundable_keeps_its_refundable_total: Part A answered over_refundable WITH the refundable total; the B1 press drops it", async () => {
    // DEFECT (left failing on purpose): 0359's reserve raises `over_refundable` with DETAIL = the refundable total,
    // but `refundRpc` throws a plain Error for a name outside REFUND_B1_SQL_REFUSALS (lib/catering/refund-reconcile.ts:76,
    // the details are dropped) and requestRefund's fallback (lib/catering/refunds.ts:293-295) builds the error with no
    // detail. Part A's panel showed "only $X can be refunded" from `detail.refundableCents`.
    await setup();
    const r = await refusal(requestRefund(await actorFor(x.w, "owner"), x.quote, body(30001), DEADLINE()));
    expect(r).toMatchObject({ status: 409, code: "over_refundable", detail: { refundableCents: 30000 } });
    expect(x.stripe.posts).toBe(0);
  });
});

// ═══════════════════════════════ Rotation, owner, charge ═══════════════════════════════════════════════════════
describe("the owner and the key", () => {
  it("same_pi_new_key_inside_window_reuses_original_create: (a) a landed create whose answer was lost, then the key ROTATED: Retry adopts it (zero new POSTs)", async () => {
    // Cross-key provider deduplication (one idempotency key under two secret keys of the same account) is UNVERIFIED:
    // the fake scopes idempotency by SECRET KEY, so ONLY our discovery can stop a second refund. This proves what OUR
    // code sends, nothing about what Stripe would deduplicate.
    await setup();
    const owner = await actorFor(x.w, "owner");
    x.stripe.failNext("create", "lost_after_executing");
    const first = await requestRefund(owner, x.quote, body(10000), DEADLINE());
    const id = first.results[0]!.id;
    expect([first.results[0]!.status, x.stripe.posts, x.stripe.refundsOf(x.pay.pi).length]).toEqual(["pending", 1, 1]);
    expect((await req(x.db, id)).create_armed_at).not.toBeNull();

    h.accounts = [account(KEY_ROTATED)]; // the shop's key is rotated: a different secret key, the same account
    const rotatedAt = x.stripe.log.length;
    const retry = await retryRefundRequest(owner, x.quote, id, Date.now(), "retry", false, DEADLINE());
    expect(retry.status).toBe("succeeded");
    expect(x.stripe.posts).toBe(1); // ZERO new POSTs
    expect(x.stripe.refundsOf(x.pay.pi)).toHaveLength(1);
    expect(x.stripe.log.slice(rotatedAt).every((l) => l.key === KEY_ROTATED)).toBe(true);
    const row = await req(x.db, id);
    expect([row.status, row.stripe_refund_id]).toEqual(["succeeded", x.stripe.refundsOf(x.pay.pi)[0]!.id]);
  });

  it("same_pi_new_key_inside_window_reuses_original_create: (b) nothing landed: Retry inside the window re-POSTs with the ORIGINAL key string and byte-identical parameters", async () => {
    await setup();
    const owner = await actorFor(x.w, "owner");
    x.stripe.failNext("create", "network");
    const first = await requestRefund(owner, x.quote, body(10000), DEADLINE());
    const id = first.results[0]!.id;
    expect([first.results[0]!.status, x.stripe.posts, x.stripe.refundsOf(x.pay.pi).length]).toEqual(["pending", 1, 0]);

    h.accounts = [account(KEY_ROTATED)];
    const retry = await retryRefundRequest(owner, x.quote, id, Date.now(), "retry", false, DEADLINE());
    expect(retry.status).toBe("succeeded");
    expect(x.stripe.posts).toBe(2);
    const [a, b] = x.stripe.creates();
    expect([a!.key, b!.key]).toEqual([KEY_A, KEY_ROTATED]);
    expect(b!.idem).toBe(a!.idem);
    expect(b!.idem).toBe(`catering-refund:${id}`);
    expect(b!.params).toBe(a!.params); // byte-identical
    expect(x.stripe.refundsOf(x.pay.pi)).toHaveLength(1);
    expect((await req(x.db, id)).arm_count).toBe(2);
  });

  it("a saved 500 is replayed by the key: the row stays pending and a Retry sends the SAME key again (never a new key)", async () => {
    await setup();
    const owner = await actorFor(x.w, "owner");
    x.stripe.failNext("create", "500_saved");
    const first = await requestRefund(owner, x.quote, body(10000), DEADLINE());
    expect([first.results[0]!.status, x.stripe.posts]).toEqual(["pending", 1]);
    const retry = await retryRefundRequest(owner, x.quote, first.results[0]!.id, Date.now(), "retry", false, DEADLINE());
    expect(retry.status).toBe("pending");
    expect(x.stripe.posts).toBe(2);
    expect(new Set(x.stripe.creates().map((c) => c.idem)).size).toBe(1);
    expect(x.stripe.refundsOf(x.pay.pi)).toHaveLength(0);
  });

  it("key_rotation_no_account_lookup: only stripeAccountsForShop's accounts are asked, by the shop's code; no credential label is stored; a failed shop read never defaults to the shared account", async () => {
    await setup({ accounts: [account(KEY_SHARED, "default"), account(KEY_A)] });
    const r = await runRefundPass(h.client as never, x.pay.id, { deadlineMs: DEADLINE() });
    expect(r.result).toBe("applied");
    expect(h.shopCodes).toEqual(["S1"]);
    const asked = x.stripe.log.filter((l) => l.op === "owner").map((l) => l.key);
    expect(asked).toEqual([KEY_SHARED, KEY_A]); // every permitted account, nothing else
    expect(x.stripe.log.every((l) => [KEY_SHARED, KEY_A].includes(l.key))).toBe(true);
    // Credentials are never an identity: nothing stored names a key, an account or which pair answered.
    const stored = JSON.stringify([await work(x.db, x.pay.id), await harnessLib.rows(x.db, "select * from public.catering_refund_identities")]);
    for (const needle of [KEY_A, KEY_SHARED, "acct_", "\"location\"", "\"default\""]) expect(stored.includes(needle), needle).toBe(false);
    const workCols = (await harnessLib.rows(x.db, "select column_name from information_schema.columns where table_name = 'catering_refund_payment_work'")).map((c) => c.column_name);
    expect(workCols.filter((c) => /account|secret|credential|api_key|stripe_key|key_label/.test(String(c)))).toEqual([]);

    // A rotated key alone resolves the same PaymentIntent and charge: the owner.
    h.accounts = [account(KEY_ROTATED)];
    expect((await runRefundPass(h.client as never, x.pay.id, { deadlineMs: DEADLINE() })).result).toBe("applied");

    // A FAILED shop read: no account is asked at all (never "the shared account by default"), nothing published.
    await x.db.close();
    await setup({ accounts: [account(KEY_SHARED, "default")] });
    await x.db.exec("revoke select on public.locations from service_role");
    const failed = await runRefundPass(h.client as never, x.pay.id, { deadlineMs: DEADLINE() });
    expect(failed.result).toBe("incomplete_evidence");
    expect(h.shopCodes).toEqual([]);
    expect([x.stripe.gets, x.stripe.posts]).toEqual([0, 0]);
    expect((await work(x.db, x.pay.id)).last_complete_pass_at).toBeNull();
    // And the press: the claim is released, nothing is sent.
    const press = await requestRefund(await actorFor(x.w, "owner"), x.quote, body(1000), DEADLINE());
    expect([press.results[0]!.status, press.results[0]!.errorCode, x.stripe.posts]).toEqual(["pending", "stripe_unreachable", 0]);
  });

  it("wrong_charge_rejected: the PaymentIntent's latest charge differs from the verified one: a wrong_charge hold, the arm is never reached, zero POSTs", async () => {
    await setup();
    const owner = await actorFor(x.w, "owner");
    expect((await runRefundPass(h.client as never, x.pay.id, { deadlineMs: DEADLINE() })).result).toBe("applied"); // ch_ verified
    x.stripe.charges.get(x.pay.pi)!.charge = "ch_flow_other_latest";
    const out = await requestRefund(owner, x.quote, body(10000), DEADLINE());
    expect([out.results[0]!.status, out.results[0]!.errorCode]).toEqual(["pending", "payment_held"]);
    expect(rpcNames(calls)).not.toContain("catering_refund_arm");
    expect(x.stripe.posts).toBe(0);
    expect((await openIssues(x.db, x.pay.id)).map((i) => [i.code, i.blocking])).toContainEqual(["wrong_charge", true]);
    expect((await req(x.db, out.results[0]!.id)).create_armed_at).toBeNull();
  });

  it("wrong_charge_rejected: the arm itself refuses a charge other than the verified one (zero POSTs, never armed, the reservation released)", async () => {
    // The press hands the arm another charge than the one the pass verified (the PaymentIntent's latest charge moved
    // between the pass and the arm): the arm's own check refuses.
    await setup({
      rpc: { catering_refund_arm: (args) => through("catering_refund_arm", { ...args, p_charge: "ch_flow_other_latest" }) as never },
    });
    const out = await requestRefund(await actorFor(x.w, "owner"), x.quote, body(10000), DEADLINE());
    expect(x.stripe.posts).toBe(0);
    const row = await req(x.db, out.results[0]!.id);
    expect([row.create_armed_at, row.status, row.last_error_code]).toEqual([null, "failed", "wrong_charge"]);
    expect(out.results[0]!.status).toBe("failed");
  });
});

// ═══════════════════════════════ Reads are stored state ════════════════════════════════════════════════════════
describe("reads", () => {
  async function leadWorld(n: number) {
    await setup();
    const lead = (await harnessLib.one(x.db, "insert into public.catering_pipeline (contact_name, stage) values ('Synthetic lead', 'inquiry') returning id")).id as string;
    for (let i = 0; i < n; i++) {
      const q = (await harnessLib.one(x.db, "insert into public.catering_quotes (location_id, version, status, pipeline_id) values ($1, 1, 'accepted', $2) returning id", [x.w.shop, lead])).id as string;
      const p = await x.w.pay(q, "deposit", 1000 + i);
      x.stripe.charge(p.pi, { account: "acct_flow_shop", captured: 1000 + i });
    }
    return lead;
  }

  it("level5_many_quote_banner_zero_provider_calls: 1, 10, 30 quotes = one quotes read + ONE summary; 55 = two summaries; zero Stripe, no enqueue, no apply", async () => {
    for (const n of [1, 10, 30, 55]) {
      const lead = await leadWorld(n);
      const viewer = await actorFor(x.w, "shift_lead");
      calls.length = 0;
      const out = await loadLeadRefundables(viewer, lead);
      expect(out).toHaveLength(n);
      expect(out.every((q) => q.stripeUnchecked && q.refundableCents > 0)).toBe(true);
      const trace = calls.map((c) => `${c.kind}:${c.name}`);
      expect(trace, `${n} quotes`).toEqual(["select:catering_quotes", ...Array(Math.ceil(n / 50)).fill("rpc:catering_refund_summary")]);
      expect([x.stripe.gets, x.stripe.posts]).toEqual([0, 0]);
      await x.db.close();
    }
  });

  it("quote_get_reads_only: quote read + ONE summary RPC (+ names), zero Stripe, zero writes; an unchecked payment is labelled, a held one is labelled and gives 0", async () => {
    await setup();
    const sl = await actorFor(x.w, "shift_lead");
    const s = await loadRefundSummary(sl, x.quote);
    expect(calls.map((c) => `${c.kind}:${c.name}`)).toEqual(["select:catering_quotes", "rpc:catering_refund_summary"]);
    expect(writes(calls)).toEqual([]);
    expect([x.stripe.gets, x.stripe.posts]).toEqual([0, 0]);
    expect([s.installed, s.epoch?.state, s.stripeUnchecked, s.payments[0]!.verified, s.payments[0]!.figures.refundableCents, s.canRefund]).toEqual([true, "live", true, false, 30000, false]);

    // A held payment: an ID-less floor nobody can explain yet, then one pass.
    await harnessKit.ingest(x.db, { pi: x.pay.pi, created: Math.floor(Date.now() / 1000) - 60, cumulative: 10000, chargeAmount: 30000, full: false });
    await runRefundPass(h.client as never, x.pay.id, { deadlineMs: DEADLINE() });
    const gets = x.stripe.gets;
    calls.length = 0;
    const owner = await actorFor(x.w, "owner");
    const held = await loadRefundSummary(owner, x.quote);
    expect(writes(calls)).toEqual([]);
    expect(rpcNames(calls)).toEqual(["catering_refund_summary"]);
    expect([x.stripe.gets - gets, x.stripe.posts]).toEqual([0, 0]);
    const p = held.payments[0]!;
    expect([p.held, p.verified, p.figures.refundableCents, p.floorCents, held.totals.refundableCents]).toEqual([true, true, 0, 10000, 0]);
    expect(held.issues?.map((i) => [i.code, i.blocking])).toEqual([["awaiting_identity", true]]);
    expect(held.stripeUnchecked).toBe(false);
  });

  it("confirm_and_retry_reload_stored_summary (lib half): after Confirm and after Retry, loadRefundSummary reflects the stored state with no provider call", async () => {
    await setup();
    const owner = await actorFor(x.w, "owner");
    x.stripe.failNext("create", "network");
    const first = await requestRefund(owner, x.quote, body(10000), DEADLINE());
    const id = first.results[0]!.id;
    let gets = x.stripe.gets;
    let s = await loadRefundSummary(owner, x.quote);
    expect(x.stripe.gets).toBe(gets);
    expect(s.requests.map((r) => [r.id, r.status, r.armed, r.state])).toEqual([[id, "pending", true, expect.any(String)]]);
    expect(s.payments[0]!.figures.inFlightCents).toBe(10000);
    expect(s.payments[0]!.figures.refundableCents).toBe(20000);

    await retryRefundRequest(owner, x.quote, id, Date.now(), "retry", false, DEADLINE());
    gets = x.stripe.gets;
    const posts = x.stripe.posts;
    s = await loadRefundSummary(owner, x.quote);
    expect([x.stripe.gets, x.stripe.posts]).toEqual([gets, posts]);
    expect(s.requests.map((r) => [r.id, r.status])).toEqual([[id, "succeeded"]]);
    expect([s.payments[0]!.returnedCents, s.payments[0]!.figures.inFlightCents, s.payments[0]!.figures.refundableCents]).toEqual([10000, 0, 20000]);
    expect(posts).toBe(2);
  });
});

// ═══════════════════════════════ The epoch admits the press ════════════════════════════════════════════════════
describe("epoch admission", () => {
  it("recovering_confirm_zero_reservations_and_claims: Confirm and Retry-create answer 503 refunds_recovering BEFORE reserve or claim; zero rows, zero POSTs", async () => {
    await setup({ live: false });
    await harnessKit.rpc(x.db, "catering_refund_open_recovery", ["cc"]);
    const owner = await actorFor(x.w, "owner");
    expect(await refusal(requestRefund(owner, x.quote, body(1000), DEADLINE()))).toMatchObject({ status: 503, code: "refunds_recovering" });
    expect(rpcNames(calls).filter((n) => /reserve|claim/.test(n))).toEqual([]);
    expect(await reqs(x.db)).toEqual([]);
    expect(x.stripe.posts).toBe(0);
    await x.db.close();

    // Retry-create on a PREEXISTING pending row, while recovering.
    const db = await LEGACY.clone();
    const w = await harnessKit.world(db);
    x = { db, w, stripe: x.stripe, quote: legacy.quote, pay: { id: legacy.payment, pi: legacy.pi } };
    x.stripe.charge(legacy.pi, { account: "acct_flow_shop" });
    wire(db);
    await harnessKit.rpc(db, "catering_refund_open_recovery", ["cc"]);
    const o = await actorFor(w, "owner");
    expect(await refusal(retryRefundRequest(o, legacy.quote, legacy.request, Date.now(), "retry", false, DEADLINE()))).toMatchObject({ status: 503, code: "refunds_recovering" });
    expect(rpcNames(calls).filter((n) => /reserve|claim|arm|apply/.test(n))).toEqual([]);
    expect([x.stripe.gets, x.stripe.posts]).toEqual([0, 0]);
    expect((await req(db, legacy.request)).attempts).toBe(0);
    expect(await harnessLib.count(db, "select count(*) n from public.catering_refund_requests")).toBe(1);
  });

  it("on_no_epoch_entrypoint_matrix: ON with no epoch, Confirm / Retry answer refunds_no_epoch; summary reads work and show the epoch; no reserve, claim, apply", async () => {
    const db = await LEGACY.clone();
    const w = await harnessKit.world(db);
    x = { db, w, stripe: (await setupStripeOnly()), quote: legacy.quote, pay: { id: legacy.payment, pi: legacy.pi } };
    wire(db);
    const owner = await actorFor(w, "owner");
    expect(await refusal(requestRefund(owner, legacy.quote, body(1000), DEADLINE()))).toMatchObject({ status: 503, code: "refunds_no_epoch" });
    expect(await refusal(retryRefundRequest(owner, legacy.quote, legacy.request, Date.now(), "retry", false, DEADLINE()))).toMatchObject({ status: 503, code: "refunds_no_epoch" });
    expect(await refusal(retryRefundRequest(owner, legacy.quote, legacy.request, Date.now(), "release", true, DEADLINE()))).toMatchObject({ status: 503, code: "refunds_no_epoch" });
    const s = await loadRefundSummary(owner, legacy.quote);
    expect([s.installed, s.epoch?.state, s.canRefund, s.requests.map((r) => r.id)]).toEqual([true, "none", false, [legacy.request]]);
    expect(rpcNames(calls).filter((n) => /reserve|claim|arm|apply|pass_begin|finish|release/.test(n))).toEqual([]);
    expect([x.stripe.gets, x.stripe.posts]).toEqual([0, 0]);
    expect(await harnessLib.count(db, "select count(*) n from public.catering_refund_requests")).toBe(1);
  });
});
async function setupStripeOnly() {
  const { FlowStripe } = await import("./helpers/refund-flow-stripe");
  h.stripe = new FlowStripe().account(KEY_A, "acct_flow_shop");
  h.stripe.charge(legacy.pi, { account: "acct_flow_shop" });
  return h.stripe;
}

// ═══════════════════════════════ Arms, sends and deaths ════════════════════════════════════════════════════════
describe("what may have left", () => {
  it("prior_claim_without_arm_is_not_a_prior_send: a claim whose pass was incomplete never armed; a later clean local refusal closes the row", async () => {
    await setup();
    const owner = await actorFor(x.w, "owner");
    x.stripe.failNext("list", "network"); // the discovery pass cannot finish: claim released, never armed
    const first = await requestRefund(owner, x.quote, body(25000), DEADLINE());
    const id = first.results[0]!.id;
    expect([first.results[0]!.status, first.results[0]!.errorCode, x.stripe.posts]).toEqual(["pending", "stripe_unreachable", 0]);
    let row = await req(x.db, id);
    expect([row.attempts, row.create_armed_at, row.claim_token]).toEqual([1, null, null]);
    // A refund made elsewhere meanwhile leaves less than the row asks for: the arm refuses ON OUR SIDE and the row,
    // never armed, closes with its amount released.
    x.stripe.refund(x.pay.pi, 10000, "succeeded");
    const retry = await retryRefundRequest(owner, x.quote, id, Date.now(), "retry", false, DEADLINE());
    expect(x.stripe.posts).toBe(0);
    row = await req(x.db, id);
    expect([row.status, row.last_error_code, row.create_armed_at]).toEqual(["failed", "over_charge_remaining", null]);
    expect(retry.status).toBe("failed");
  });

  it("prior_claim_without_arm_is_not_a_prior_send: an ARMED row whose POST timed out stays pending and reserved through an EMPTY list", async () => {
    await setup();
    const owner = await actorFor(x.w, "owner");
    x.stripe.failNext("create", "network");
    const first = await requestRefund(owner, x.quote, body(10000), DEADLINE());
    const id = first.results[0]!.id;
    expect([first.results[0]!.status, x.stripe.posts]).toEqual(["pending", 1]);
    expect((await runRefundPass(h.client as never, x.pay.id, { deadlineMs: DEADLINE() })).result).toBe("applied"); // the list is EMPTY
    const row = await req(x.db, id);
    expect([row.status, row.create_armed_at != null]).toEqual(["pending", true]);
    expect((await harnessKit.figures(x.db, x.pay.id)).o_reservations).toBe(10000);
    expect(x.stripe.posts).toBe(1);
  });

  it("split_tap_dies_after_first_row_second_is_raised_never_posted: one POST; after 15 minutes the sweep raises reserved_not_sent and NEVER posts it", async () => {
    let claims = 0;
    await setup({
      rpc: {
        catering_refund_claim_admitted: () => (++claims === 2 ? { data: null, error: { message: "terminating connection due to administrator command" } } : undefined),
      },
    });
    const p2 = await x.w.pay(x.quote, "balance", 20000);
    x.stripe.charge(p2.pi, { account: "acct_flow_shop", captured: 20000 });
    const owner = await actorFor(x.w, "owner");
    await expect(requestRefund(owner, x.quote, body(40000), DEADLINE())).rejects.toThrow(/terminating connection/);
    expect(x.stripe.posts).toBe(1);
    const rows = await reqs(x.db);
    expect(rows.map((r) => [r.payment_id, r.amount_cents, r.status])).toEqual(expect.arrayContaining([[p2.id, 20000, "succeeded"], [x.pay.id, 20000, "pending"]]));
    const second = rows.find((r) => r.payment_id === x.pay.id)!;
    expect([second.create_armed_at, second.attempts]).toEqual([null, 0]);

    // 15 minutes later, the sweep (the death is over: an ordinary client again).
    wire(x.db);
    await harnessKit.backdate(x.db, "catering_refund_requests", "requested_at", String(second.id), "16 minutes");
    const sweep = await runRefundSweep(h.client as never, { deadlineMs: DEADLINE() });
    expect(sweep.ran).toBe(true);
    expect((sweep.housekeeping as { reserved_not_sent?: number }).reserved_not_sent).toBe(1);
    expect((await openIssues(x.db)).filter((i) => i.code === "reserved_not_sent").map((i) => i.request_id)).toEqual([second.id]);
    await runRefundSweep(h.client as never, { deadlineMs: DEADLINE() });
    const after = await req(x.db, String(second.id));
    expect([after.status, after.create_armed_at, after.arm_count, after.attempts]).toEqual(["pending", null, 0, 0]);
    expect(rpcNames(calls).filter((n) => /claim|arm|reserve|finish/.test(n))).toEqual([]);
    expect(x.stripe.posts).toBe(1);
  });

  it("slow_preflight_never_posts_after_deadline: the discovery reads take the row past the window minus margin: the arm refuses, zero POSTs, the row needs reconcile", async () => {
    await setup();
    const owner = await actorFor(x.w, "owner");
    let moved = false;
    x.stripe.onCall = async (op) => {
      if (op === "list" && !moved) {
        moved = true;
        const r = await reqs(x.db);
        await harnessKit.backdate(x.db, "catering_refund_requests", "first_attempt_at", String(r[0]!.id), "23 hours 59 minutes 30 seconds");
        await harnessKit.backdate(x.db, "catering_refund_requests", "requested_at", String(r[0]!.id), "23 hours 59 minutes 30 seconds");
      }
    };
    const out = await requestRefund(owner, x.quote, body(10000), DEADLINE());
    expect([out.results[0]!.status, out.results[0]!.errorCode]).toEqual(["pending", "needs_reconcile"]);
    expect(x.stripe.posts).toBe(0);
    expect((await req(x.db, out.results[0]!.id)).create_armed_at).toBeNull();
  });

  it("slow_preflight_never_posts_after_deadline: time passing between the arm and the POST is caught by the last check before network I/O", async () => {
    await setup({
      rpc: {
        catering_refund_arm: async (args) => {
          const a = await through("catering_refund_arm", args);
          await harnessKit.backdate(x.db, "catering_refund_requests", "first_attempt_at", String(args.p_request_id), "23 hours 59 minutes 30 seconds");
          await harnessKit.backdate(x.db, "catering_refund_requests", "requested_at", String(args.p_request_id), "23 hours 59 minutes 30 seconds");
          const row = await req(x.db, String(args.p_request_id));
          return { data: { ...(a.data as object), first_attempt_at: new Date(row.first_attempt_at as string).toISOString() }, error: null } as never;
        },
      },
    });
    const out = await requestRefund(await actorFor(x.w, "owner"), x.quote, body(10000), DEADLINE());
    expect([out.results[0]!.status, out.results[0]!.errorCode]).toEqual(["pending", "needs_reconcile"]);
    expect(x.stripe.posts).toBe(0);
  });

  it("past the 24-hour window a Retry is Check Stripe: GETs only, never a send", async () => {
    await setup();
    const owner = await actorFor(x.w, "owner");
    x.stripe.failNext("create", "network");
    const id = (await requestRefund(owner, x.quote, body(10000), DEADLINE())).results[0]!.id;
    for (const col of ["first_attempt_at", "requested_at", "create_armed_at"]) await harnessKit.backdate(x.db, "catering_refund_requests", col, id, "25 hours");
    const gets = x.stripe.gets;
    const r = await retryRefundRequest(owner, x.quote, id, Date.now(), "retry", false, DEADLINE());
    expect([r.status, r.errorCode]).toEqual(["pending", "needs_reconcile"]);
    expect(x.stripe.gets).toBeGreaterThan(gets);
    expect(x.stripe.posts).toBe(1);
    expect(rpcNames(calls).filter((n) => n === "catering_refund_arm")).toHaveLength(1); // the first press's only
  });

  it("a press with no route budget left sends nothing (the pass defers, the claim is released)", async () => {
    await setup();
    const out = await requestRefund(await actorFor(x.w, "owner"), x.quote, body(10000), Date.now() + 2_000);
    expect(out.results[0]!.status).toBe("pending");
    expect(x.stripe.posts).toBe(0);
    const row = await req(x.db, out.results[0]!.id);
    expect([row.create_armed_at, row.claim_token]).toEqual([null, null]);
  });

  it("released_request_late_success_staff_review_no_second_create: Release after the window, then the late refund appears: hold, no second create", async () => {
    await setup();
    const owner = await actorFor(x.w, "owner");
    const gm = await actorFor(x.w, "gm");
    x.stripe.failNext("create", "network");
    const first = await requestRefund(owner, x.quote, body(10000), DEADLINE());
    const id = first.results[0]!.id;
    expect(x.stripe.posts).toBe(1);
    // Inside the window ordinary Release is refused.
    expect(await refusal(retryRefundRequest(gm, x.quote, id, Date.now(), "release", true, DEADLINE()))).toMatchObject({ status: 409, code: "not_releasable" });
    for (const col of ["first_attempt_at", "requested_at", "create_armed_at"]) await harnessKit.backdate(x.db, "catering_refund_requests", col, id, "25 hours");
    // Without staff verification of the owning charge: refused.
    expect(await refusal(retryRefundRequest(gm, x.quote, id, Date.now(), "release", false, DEADLINE()))).toMatchObject({ status: 409, code: "staff_verification_required" });
    const rel = await retryRefundRequest(gm, x.quote, id, Date.now(), "release", true, DEADLINE());
    expect(rel.status).toBe("failed"); // (its errorCode: see LEAD_MUST_FIX release_reports_released_no_refund)
    expect((await req(x.db, id)).last_error_code).toBe("released_no_refund");
    expect((await harnessKit.figures(x.db, x.pay.id)).o_available).toBe(30000);
    expect(x.stripe.posts).toBe(1);

    // The create HAD landed after all (the list had not caught up): the late matching refund appears.
    x.stripe.refund(x.pay.pi, 10000, "succeeded", { requestId: id, metaPayment: x.pay.id, metaQuote: x.quote, created: Math.floor(Date.now() / 1000) - 86000 });
    const a = await runRefundPass(h.client as never, x.pay.id, { deadlineMs: DEADLINE() });
    expect([a.returned_cents ?? null, a.held]).toEqual([10000, true]);
    const row = await req(x.db, id);
    expect([row.status, row.last_error_code, row.binding_hold]).toEqual(["failed", "released_no_refund", "released_request_has_refund"]);
    expect((await openIssues(x.db, x.pay.id)).map((i) => i.code)).toContain("released_request_has_refund");
    // No second create: the released row is not retryable and a new Confirm is held.
    expect(await refusal(retryRefundRequest(owner, x.quote, id, Date.now(), "retry", false, DEADLINE()))).toMatchObject({ status: 409, code: "not_retryable" });
    expect(await refusal(requestRefund(owner, x.quote, body(10000), DEADLINE()))).toMatchObject({ status: 409, code: "payment_held" });
    expect(x.stripe.posts).toBe(1);
    expect(x.stripe.refundsOf(x.pay.pi)).toHaveLength(1);
  });

  it("LEAD_MUST_FIX release_reports_released_no_refund: an ordinary Release answers errorCode `released_no_refund` (the panel's 'released' message keys on it)", async () => {
    // DEFECT (left failing on purpose): retryRefundRequest's release branch returns `reread(sb, row, "released_no_refund")`
    // (lib/catering/refunds.ts:491), and `reread` (:345-348) replaces the code with `updated_by_stripe` because the
    // status moved pending -> failed. RefundPanel (components/catering/quotes/RefundPanel.tsx:264) shows "released"
    // only for errorCode `released_no_refund`, so every successful Release is shown as "failed: updated_by_stripe".
    await setup();
    const gm = await actorFor(x.w, "gm");
    x.stripe.failNext("create", "network");
    const id = (await requestRefund(await actorFor(x.w, "owner"), x.quote, body(10000), DEADLINE())).results[0]!.id;
    for (const col of ["first_attempt_at", "requested_at", "create_armed_at"]) await harnessKit.backdate(x.db, "catering_refund_requests", col, id, "25 hours");
    const rel = await retryRefundRequest(gm, x.quote, id, Date.now(), "release", true, DEADLINE());
    expect(x.stripe.posts).toBe(1);
    expect([rel.status, rel.errorCode]).toEqual(["failed", "released_no_refund"]);
  });

  /** The process "dies" the moment the create returned: from then on every database call of the dead press fails. */
  const DEAD = { catering_refund_finish: () => ({ data: null, error: { message: "server closed the connection unexpectedly" } }) };

  it("accepted_post_then_immediate_process_death: the create succeeds, the process dies before finish; the next Retry finds it by PaymentIntent and adopts it; ONE refund at the fake", async () => {
    await setup({ rpc: DEAD });
    const owner = await actorFor(x.w, "owner");
    await expect(requestRefund(owner, x.quote, body(10000), DEADLINE())).rejects.toThrow(/server closed the connection/);
    expect([x.stripe.posts, x.stripe.refundsOf(x.pay.pi).length]).toEqual([1, 1]);
    const [row] = await reqs(x.db);
    expect([row!.status, row!.stripe_refund_id, row!.create_armed_at != null]).toEqual(["pending", null, true]);
    wire(x.db); // a new process
    // A Retry while the dead press's claim is still live sends nothing.
    const early = await retryRefundRequest(owner, x.quote, String(row!.id), Date.now(), "retry", false, DEADLINE());
    expect([early.status, early.errorCode, x.stripe.posts]).toEqual(["pending", "in_progress", 1]);
    await harnessKit.backdate(x.db, "catering_refund_requests", "claimed_until", String(row!.id), "10 minutes");
    const retry = await retryRefundRequest(owner, x.quote, String(row!.id), Date.now(), "retry", false, DEADLINE());
    expect(retry.status).toBe("succeeded");
    expect([x.stripe.posts, x.stripe.refundsOf(x.pay.pi).length]).toEqual([1, 1]);
    expect((await req(x.db, String(row!.id))).stripe_refund_id).toBe(x.stripe.refundsOf(x.pay.pi)[0]!.id);
  });

  it("LEAD_MUST_FIX finish_failure_after_create_is_not_a_stripe_failure: a database error recording a SUCCESSFUL create is reported as a network failure of the create and the returned id is dropped", async () => {
    // DEFECT (left failing on purpose): in submitRefundRow (lib/catering/refunds.ts:417-438) `finish(..., "created",
    // refund.id)` and the second pass sit INSIDE the try whose catch classifies every Error as a create failure. When
    // that finish throws (one transient database error, the process alive), the catch records `uncertain` with
    // last_error_code `network_error` / http 0 and audits the attempt as a pending Stripe failure, and the refund id
    // Stripe RETURNED is never registered (no `create_response` hint): recovery then depends on the list alone. With a
    // lagging list and a rotated key (cross-key deduplication UNVERIFIED) a Retry would POST again.
    let once = false;
    await setup({ rpc: { catering_refund_finish: () => (once ? undefined : ((once = true), { data: null, error: { message: "could not serialize access" } })) } });
    const out = await requestRefund(await actorFor(x.w, "owner"), x.quote, body(10000), DEADLINE());
    expect(x.stripe.posts).toBe(1);
    const rid = x.stripe.refundsOf(x.pay.pi)[0]!.id;
    const row = await req(x.db, out.results[0]!.id);
    expect(row.last_error_code).not.toBe("network_error");
    expect(await harnessLib.count(x.db, "select count(*) n from public.catering_refund_identities where refund_id = $1", [rid])).toBe(1);
  });

  async function deadPress() {
    await setup({ rpc: DEAD });
    await expect(requestRefund(await actorFor(x.w, "owner"), x.quote, body(10000), DEADLINE())).rejects.toThrow();
    wire(x.db); // a new process
    const [dead] = await reqs(x.db);
    await harnessKit.backdate(x.db, "catering_refund_requests", "claimed_until", String(dead!.id), "10 minutes"); // its claim expired
    return String(dead!.id);
  }

  it("accepted_post_then_immediate_process_death: once the payment is due, the SWEEP finds the refund by PaymentIntent and adopts it (GETs only)", async () => {
    await deadPress();
    await harnessKit.backdate(x.db, "catering_refund_payment_work", "next_due_at", x.pay.id, "8 days", "payment_id");
    const sweep = await runRefundSweep(h.client as never, { deadlineMs: DEADLINE() });
    expect(sweep.applied).toBeGreaterThanOrEqual(1);
    const [row] = await reqs(x.db);
    expect([row!.status, row!.stripe_refund_id]).toEqual(["succeeded", x.stripe.refundsOf(x.pay.pi)[0]!.id]);
    expect([x.stripe.posts, x.stripe.refundsOf(x.pay.pi).length]).toEqual([1, 1]);
  });

  it("accepted_post_then_immediate_process_death: LEAD_MUST_FIX the sweep revisits an armed, unfinished row within the hour (not at the healthy 7-day poll)", async () => {
    // DEFECT (left failing on purpose): the press's discovery pass runs BEFORE the arm, so `catering_refund_apply`
    // schedules the payment's healthy poll (+7 days, 0359 ~line 2150: no armed request exists yet), and
    // `catering_refund_arm` (~line 1430) never moves next_due_at. A process that dies after the POST and before
    // `finish` leaves an armed row the sweep's `armed_unbound` list (which requires next_due_at <= now) will not see
    // for a week: the refund Stripe made is unadopted and the money reads pending / reserved until then (only a person's
    // Retry finds it). The arm (or the claim) should bring next_due_at to about the claim's expiry.
    await deadPress();
    await harnessKit.backdate(x.db, "catering_refund_payment_work", "next_due_at", x.pay.id, "1 hour", "payment_id"); // an hour of sweeps
    const sweep = await runRefundSweep(h.client as never, { deadlineMs: DEADLINE() });
    expect(sweep.passes).toBeGreaterThanOrEqual(1);
    const [row] = await reqs(x.db);
    expect([row!.status, row!.stripe_refund_id]).toEqual(["succeeded", x.stripe.refundsOf(x.pay.pi)[0]!.id]);
    expect(x.stripe.posts).toBe(1);
  });

  it("uncited_refusal_is_possibly_executed (CC ruling R5): a create refused with a code Stripe's docs do not state as \"no refund was created\" keeps the row pending and reserved, reports THAT code, goes to staff, and a retry can never make a second refund", async () => {
    // `charge_already_refunded` (docs.stripe.com/error-codes: "... Inspect its existing refunds to confirm whether the
    // intended refund is complete.") and `charge_disputed` cannot be cited as "no refund was created": neither closes a row.
    expect(UNEXECUTED_REFUSAL_CODES).toEqual([]);
    for (const code of ["charge_already_refunded", "charge_disputed", "some_future_code"]) expect([code, classifyCreateFailure(400, code)]).toEqual([code, "uncertain"]);
    await setup();
    const owner = await actorFor(x.w, "owner");
    const dash = x.stripe.refund(x.pay.pi, 25000, "succeeded"); // made elsewhere; the list has not caught up
    x.stripe.hidden.add(dash);
    const out = await requestRefund(owner, x.quote, body(10000), DEADLINE());
    expect(x.stripe.posts).toBe(1);
    const id = out.results[0]!.id;
    let row = await req(x.db, id);
    // POSSIBLY EXECUTED: still pending, armed, reserved; the press reports the code Stripe named.
    expect([row.status, row.last_error_code, row.create_armed_at != null]).toEqual(["pending", "charge_already_refunded", true]);
    expect([out.results[0]!.status, out.results[0]!.errorCode]).toEqual(["pending", "charge_already_refunded"]);
    expect((await harnessKit.figures(x.db, x.pay.id)).o_reservations).toBe(10000);
    // STAFF REVIEW: an armed row with no confirmed outcome is raised by the sweep's housekeeping.
    await harnessKit.backdate(x.db, "catering_refund_requests", "create_armed_at", id, "10 minutes");
    await harnessKit.rpc(x.db, "catering_refund_sweep_housekeeping", [harnessLib.CALLER]);
    expect((await openIssues(x.db, x.pay.id)).map((i) => [i.code, i.request_id])).toContainEqual(["submission_unconfirmed", id]);
    // NO SECOND CREATE: a Retry re-sends the SAME idempotency key with the same parameters; Stripe answers the saved
    // refusal; no refund object is made by us, ever.
    await retryRefundRequest(owner, x.quote, id, Date.now(), "retry", false, DEADLINE());
    const creates = x.stripe.creates();
    expect(creates.length).toBeGreaterThanOrEqual(1);
    expect(new Set(creates.map((c) => c.idem)).size).toBe(1);
    expect(new Set(creates.map((c) => c.params)).size).toBe(1);
    expect(x.stripe.refundsOf(x.pay.pi).map((r) => r.id)).toEqual([dash]);
    row = await req(x.db, id);
    expect([row.status, row.stripe_refund_id]).toEqual(["pending", null]);
  });

  it("LEAD_MUST_FIX clean_success_has_no_error_code: a press that created and verified its own refund reports errorCode null", async () => {
    // DEFECT (left failing on purpose): see refused_create_keeps_its_name — the press's own success is reported as
    // overtaken (`updated_by_stripe`).
    await setup();
    const out = await requestRefund(await actorFor(x.w, "owner"), x.quote, body(10000), DEADLINE());
    expect(x.stripe.posts).toBe(1);
    expect([out.results[0]!.status, out.results[0]!.errorCode]).toEqual(["succeeded", null]);
  });
});

// ═══════════════════════════════ Interleavings ═════════════════════════════════════════════════════════════════
describe("two presses, one row", () => {
  it("released_armed_race: a second press while the first holds the claim gets in_progress and sends nothing; ONE POST", async () => {
    await setup();
    const owner = await actorFor(x.w, "owner");
    const gm = await actorFor(x.w, "gm");
    let second: Awaited<ReturnType<typeof retryRefundRequest>> | null = null;
    x.stripe.onCall = async (op) => {
      if (op === "list" && !second) {
        second = { id: "", paymentId: "", amountCents: 0, status: "pending", errorCode: "running" };
        const [row] = await reqs(x.db);
        second = await retryRefundRequest(gm, x.quote, String(row!.id), Date.now(), "retry", false, DEADLINE());
      }
    };
    const out = await requestRefund(owner, x.quote, body(10000), DEADLINE());
    expect(second).toMatchObject({ status: "pending", errorCode: "in_progress" });
    expect(out.results[0]!.status).toBe("succeeded");
    expect([x.stripe.posts, x.stripe.refundsOf(x.pay.pi).length]).toEqual([1, 1]);
  });

  it("equal_clock_competing_applies: a second pass while one is staged is `busy`; the first one's apply commits; nothing is sent by either", async () => {
    await setup();
    let competing: string | null = null;
    x.stripe.onCall = async (op) => {
      if (op === "list" && competing === null) {
        competing = "running";
        competing = (await runRefundPass(h.client as never, x.pay.id, { deadlineMs: DEADLINE() })).result;
      }
    };
    const first = await runRefundPass(h.client as never, x.pay.id, { deadlineMs: DEADLINE() });
    expect([competing, first.result]).toEqual(["busy", "applied"]);
    expect(x.stripe.posts).toBe(0);
  });

  it("equal_clock_competing_applies: new evidence between the pass and the arm makes the arm stale: nothing is sent, the row stays pending, never armed", async () => {
    await setup({
      rpc: {
        catering_refund_arm: async (args) => {
          await harnessKit.ingest(x.db, { pi: x.pay.pi, created: Math.floor(Date.now() / 1000) - 5, cumulative: 1000, chargeAmount: 30000, full: false });
          return through("catering_refund_arm", args) as never;
        },
      },
    });
    const out = await requestRefund(await actorFor(x.w, "owner"), x.quote, body(10000), DEADLINE());
    expect(x.stripe.posts).toBe(0);
    const row = await req(x.db, out.results[0]!.id);
    expect([row.status, row.create_armed_at, row.claim_token]).toEqual(["pending", null, null]);
    expect(out.results[0]!.status).toBe("pending");
  });

  it("stale_defer: a defer under a token that is not the staged one writes nothing; nothing is sent", async () => {
    await setup();
    const begun = await harnessKit.rpc(x.db, "catering_refund_pass_begin", [harnessLib.CALLER, x.pay.id, crypto.randomUUID()]);
    const before = await work(x.db, x.pay.id);
    expect((await harnessKit.rpc(x.db, "catering_refund_defer", [harnessLib.CALLER, x.pay.id, crypto.randomUUID(), "contention", 600])).result).toBe("stale_generation");
    const after = await work(x.db, x.pay.id);
    expect([after.deferrals, String(after.next_due_at), after.pass_token]).toEqual([before.deferrals, String(before.next_due_at), begun.pass_token]);
    expect(x.stripe.posts).toBe(0);
  });

  it("LEAD_MUST_FIX stale_defer_after_new_evidence: a pass whose list fails AFTER new event evidence moved the generation must not push the new work's due time back", async () => {
    // DEFECT (left failing on purpose): `catering_refund_defer` (0359 ~line 2190) is fenced on the pass TOKEN only, not
    // on the generation, and ingress bumps the generation without clearing the staged token. So a pass that went stale
    // (a signed event arrived mid-pass and made its work due AT ONCE) still writes its defer: deferrals + 1 and
    // next_due_at = now + retry seconds — the stale read overwrites the newer evidence's due time (the reconciler's
    // header: "a read that went stale in between [is] a named stale_generation, never an overwrite").
    await setup();
    await runRefundPass(h.client as never, x.pay.id, { deadlineMs: DEADLINE() });
    const before = await work(x.db, x.pay.id);
    let dueAfterEvent: unknown = null;
    x.stripe.onCall = async (op) => {
      if (op === "list") {
        x.stripe.onCall = null;
        await harnessKit.ingest(x.db, { pi: x.pay.pi, created: Math.floor(Date.now() / 1000) - 5, cumulative: 1000, chargeAmount: 30000, full: false });
        dueAfterEvent = (await work(x.db, x.pay.id)).next_due_at;
        x.stripe.failNext("list", "network");
      }
    };
    const r = await runRefundPass(h.client as never, x.pay.id, { deadlineMs: DEADLINE() });
    expect(r.result).toBe("deferred");
    const after = await work(x.db, x.pay.id);
    expect(x.stripe.posts).toBe(0);
    expect(after.deferrals).toBe(before.deferrals);
    expect(String(after.next_due_at)).toBe(String(dueAfterEvent));
  });
});
