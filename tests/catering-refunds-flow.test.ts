/**
 * Catering refunds Part B1 v2 — the END-TO-END FLOW of the server lib (lib/catering/refunds.ts,
 * lib/catering/refund-observe.ts) on the REAL SQL: PGlite carrying the real 0357 -> 0358 -> 0359
 * (tests/helpers/refund-pglite.ts), the REAL Stripe client over the HTTP fake (tests/stripe-http-fake.ts). Nothing
 * between them is mocked except the service-client factory (it hands the PGlite client out), `server-only`, and the
 * build constant `REFUND_PARTS_BUILT` (true here: B2 / B3 are "built"; the database half of the gate is the isolated
 * readiness fixture `withPartsReady()`). SYNTHETIC rows, FAKE keys, no network.
 *
 * OUTBOUND POSTS ARE COUNTED BY THE FAKE (`calls`, HTTP requests: a followed redirect would be a second one), never
 * inferred from the lib's answer. Every test ends with the INVARIANT SWEEP (plan 10, item 20; the top-level
 * `afterEach`): at most ONE POST per idempotency key; every POST names a request row that was ARMED when it left
 * (checked at the moment the fake received it); main's five tables carry exactly the rows the scenario itself wrote
 * "as main" (payments, ledger rows), whatever B1 did.
 *
 * Scenario names follow plan section 10 (the `tests/catering-refunds-flow.test.ts` bullet) and section 15
 * ([T1]..[T5], [S9], [S11]); the numbers in the describe names are the build brief's.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

const h = vi.hoisted(() => ({ sb: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => {
    if (!h.sb) throw new Error("catering-refunds-flow.test: no client handed out");
    return h.sb;
  },
}));
// B2 / B3 "built" (the build half of the gate); the database half is `withPartsReady()`.
vi.mock("@/lib/catering/refunds-shared", async (original) => {
  const real = await original<typeof import("@/lib/catering/refunds-shared")>();
  return {
    ...real,
    REFUND_PARTS_BUILT: true,
    refundCreateBlock: (env: Record<string, string | undefined>, partsBuilt = true) => real.refundCreateBlock(env, partsBuilt),
  };
});

import {
  attachRefund,
  CateringRefundError,
  checkRefunds,
  loadRefundSummary,
  REFUND_RPC_REFUSALS,
  releaseRefund,
  requestRefund,
  type RefundPressResult,
  type RefundRequestBody,
  type RefundRowOutcome,
} from "@/lib/catering/refunds";
import { credentialFingerprint, runRefundRead, runRefundSweep } from "@/lib/catering/refund-observe";
import { harnessKit as kit, harnessLib as lib, refundClient, type RefundCall, type RefundClientOpts } from "./helpers/refund-pglite";
import {
  actorOf,
  armedEpoch,
  auditOf,
  claimsOf,
  flowDb,
  inventory,
  KEY_DEF,
  KEY_LOC,
  KEY_LOC_ROTATED,
  elapseBoth,
  live,
  mainDigest,
  owned,
  requestRow,
  requestsOf,
  type FlowDb,
  type KitPayment,
} from "./helpers/refund-flow-kit";
import { delay, networkError, redirect, status, stripeHttpFake, type HttpFakeCall, type StripeHttpFake } from "./stripe-http-fake";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

// ── The wiring ───────────────────────────────────────────────────────────────────────────────────────────
type HookCall = Parameters<NonNullable<RefundClientOpts["onCall"]>>[0];
type Hook = (call: HookCall) => void | Promise<void>;
type Overrides = NonNullable<RefundClientOpts["rpc"]>;

/** One PostgREST-shaped client over the database, with its own call log, hook and RPC answers. */
interface Client { sb: SupabaseClient; calls: RefundCall[]; onCall: Hook | null; rpc: Overrides }
function makeClient(db: PGlite, wrap?: Hook): Client {
  const c: Client = { sb: null as unknown as SupabaseClient, calls: [], onCall: null, rpc: {} };
  c.sb = refundClient(db, {
    calls: c.calls,
    rpc: new Proxy({}, { get: (_t, name: string) => c.rpc[name] }) as Overrides,
    onCall: async (call) => {
      await wrap?.(call);
      await c.onCall?.(call);
    },
  });
  return c;
}

interface Ctx {
  f: FlowDb;
  db: PGlite;
  stripe: StripeHttpFake;
  /** The default client (press "A"). */
  main: Client;
  /** A fresh client (press "B", a sweep, a read) with no hook. */
  client(): Client;
  /** Awaited before every refund-surface request the fake answers (after the invariant bookkeeping). */
  onStripe: ((call: HttpFakeCall) => void | Promise<void>) | null;
  /** `created` (epoch seconds) of a refund the POST makes = the arm's own second + this. 0 = the arm's own second. */
  armOffsetSec: number;
  /** Rewrites the 2xx body the POST answers (the refund itself is made as Stripe would). */
  bendPost: ((body: Record<string, unknown>) => unknown) | null;
  /** When set, the POST of this press gets a short timeout (the clock is moved after the arm; see `shortPost`). */
  postTimeoutDeadline: number | null;
  restoreNow: (() => void) | null;
  violations: string[];
  baseline: Record<string, string>;
  /** A write "as main" (a payment, a ledger row, a status): the main-table baseline moves with it. */
  mainWrite<T>(fn: () => Promise<T>): Promise<T>;
}

let current: Ctx | null = null;

async function ctx(f: FlowDb, opts: { slots?: "location" | "both" } = {}): Promise<Ctx> {
  vi.stubEnv("CATERING_REFUNDS", "1");
  vi.stubEnv("CATERING_REFUNDS_OBSERVE", "1");
  vi.stubEnv("STRIPE_SECRET_KEY__S1", KEY_LOC);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET__S1", "whsec_fake_flow_location");
  if (opts.slots === "both") {
    vi.stubEnv("STRIPE_SECRET_KEY", KEY_DEF);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_fake_flow_default");
  }
  const stripe = stripeHttpFake();
  stripe.account(KEY_LOC);
  stripe.account(KEY_DEF);
  // Stripe's refund ids are unique everywhere; the fake numbers them per instance, and tests here share a database.
  const tag = randomUUID().slice(0, 8);
  let rn = 0;
  const addRefund = stripe.world.addRefund;
  stripe.world.addRefund = (r) => addRefund({ ...r, id: r.id ?? `re_fake_${tag}_${++rn}` });
  const db = f.db;
  const c: Ctx = {
    f, db, stripe,
    main: null as unknown as Client,
    client: () => makeClient(db),
    onStripe: null,
    armOffsetSec: 0,
    bendPost: null,
    postTimeoutDeadline: null,
    restoreNow: null,
    violations: [],
    baseline: {},
    mainWrite: (fn) => owned(db, async () => {
      const out = await fn();
      c.baseline = await mainDigest(db);
      return out;
    }),
  };
  // The press's own client: after its arm, a short POST timeout when the test asked for one.
  c.main = makeClient(db, (call) => {
    if (c.postTimeoutDeadline !== null && call.phase === "after" && call.kind === "rpc" && call.name === "catering_refund_arm" && !c.restoreNow) {
      const realNow = Date.now.bind(Date);
      const offset = c.postTimeoutDeadline - realNow() - 6_500; // the lib's POST budget = deadline - now - 5 s = 1.5 s
      const spy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
      c.restoreNow = () => spy.mockRestore();
    }
  });
  stripe.onRequest = async (call) => {
    if (call.method === "POST" && call.path === "/v1/refunds") {
      c.restoreNow?.();
      c.restoreNow = null;
      const id = new URLSearchParams(call.body ?? "").get("metadata[refund_request_id]") ?? "";
      if (call.idempotencyKey !== `catering-refund:${id}`) c.violations.push(`a POST whose key ${call.idempotencyKey} is not its request's`);
      const armed = /^[0-9a-f-]{36}$/.test(id) ? await owned(db, () => armedEpoch(db, id)) : null;
      if (armed === null) c.violations.push(`a POST for ${id || "no request id"} whose request row was not armed when it left`);
      else stripe.world.opts.createdAt = () => Math.floor(armed) + c.armOffsetSec;
    }
    await c.onStripe?.(call);
  };
  vi.stubGlobal("fetch", async (url: unknown, init?: unknown) => {
    const res = await stripe.fetch(url, init);
    const i = (init ?? {}) as { method?: string };
    if (c.bendPost && i.method === "POST" && res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      const bent = c.bendPost(body);
      return { ...res, json: async () => bent };
    }
    return res;
  });
  await live(db, (i) => elapseBoth(db, stripe.world.refunds, i));
  c.baseline = await mainDigest(db);
  current = c;
  return c;
}

afterEach(async () => {
  const c = current;
  current = null;
  try {
    if (c) {
      c.restoreNow?.();
      // ── THE INVARIANT SWEEP (item 20) ──
      const posts = c.stripe.calls.filter((x) => x.method === "POST" && x.path === "/v1/refunds");
      const perKey = new Map<string, number>();
      for (const p of posts) perKey.set(String(p.idempotencyKey), (perKey.get(String(p.idempotencyKey)) ?? 0) + 1);
      for (const [key, n] of perKey) expect(n, `POSTs carrying ${key}`).toBe(1);
      expect(c.violations, "every POST names a request row armed before it left").toEqual([]);
      expect(await owned(c.db, () => mainDigest(c.db)), "main's five tables: only the scenario's own writes as main").toEqual(c.baseline);
    }
  } finally {
    h.sb = null;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────────────
const gmOf = (c: Ctx, id = c.f.gm) => actorOf(id, "gm", [c.f.w.shop]);
const mooOf = (c: Ctx) => actorOf(c.f.moo, "moo", [c.f.w.shop]);

function body(amountCents: number, seenRefundableCents: number, clientToken: string = randomUUID()): RefundRequestBody {
  return { clientToken, amountCents, seenRefundableCents, reasonCode: "customer_cancelled", reasonNote: null, trigger: "panel" };
}

/** One order (a quote) with Stripe payments the shop's own account knows. One amount = a `full` payment. */
async function order(c: Ctx, amounts: number[], opts: { kinds?: string[] } = {}): Promise<{ quote: string; pays: KitPayment[] }> {
  const quote = await c.f.w.quote();
  const kinds = opts.kinds ?? (amounts.length === 1 ? ["full"] : ["deposit", "balance"]);
  const pays: KitPayment[] = [];
  for (let i = 0; i < amounts.length; i++) {
    const p = await c.mainWrite(() => c.f.w.pay(quote, kinds[i]!, amounts[i]!));
    c.stripe.world.addPaymentIntent({ id: p.pi, account: KEY_LOC, chargeId: p.charge, amountCaptured: amounts[i]! });
    pays.push(p);
  }
  return { quote, pays };
}

/** A press through the lib, on `client` (default: the context's own). The client is captured at the call. */
function press(c: Ctx, quote: string, b: RefundRequestBody, o: { client?: Client; actor?: string; deadlineMs?: number } = {}): Promise<RefundPressResult> {
  h.sb = (o.client ?? c.main).sb;
  return requestRefund(gmOf(c, o.actor), quote, b, o.deadlineMs !== undefined ? { deadlineMs: o.deadlineMs } : {});
}
function pressed(r: RefundPressResult): RefundRowOutcome[] {
  expect(r.kind).toBe("pressed");
  return r.kind === "pressed" ? r.rows : [];
}
type Settled = { ok: true; value: RefundPressResult } | { ok: false; error: unknown };
async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}
async function refused(p: Promise<unknown>, statusCode: number, code: string): Promise<CateringRefundError> {
  const r = await settle(p);
  expect(r.ok, `expected the refusal ${code}`).toBe(false);
  const e = (r as { error: unknown }).error;
  expect(e).toBeInstanceOf(CateringRefundError);
  expect(e).toMatchObject({ status: statusCode, code });
  return e as CateringRefundError;
}
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const never = () => new Promise<never>(() => {});
const isRpc = (call: HookCall, name: string) => call.kind === "rpc" && call.name === name;
const argsOf = (call: { args?: unknown }) => (call.args ?? {}) as Record<string, unknown>;
const isReserveWithReads = (call: HookCall) => isRpc(call, "catering_refund_reserve_fresh") && argsOf(call).p_reads != null;
const rpcNames = (cl: Client) => cl.calls.filter((x) => x.kind === "rpc").map((x) => x.name);
const postsOf = (c: Ctx, pi?: string) =>
  c.stripe.calls.filter((x) => x.method === "POST" && x.path === "/v1/refunds" && (!pi || new URLSearchParams(x.body ?? "").get("payment_intent") === pi));
const getsOf = (c: Ctx) => c.stripe.calls.filter((x) => x.method === "GET").length;

/** A read through the lib on a fresh client (what Check Stripe, a release or the sweep would make). */
function readNow(c: Ctx, paymentId: string) {
  return runRefundRead(c.client().sb, paymentId, { deadlineMs: Date.now() + 20_000 });
}
/** One sweep run through the lib (6 minutes pass first, so no earlier lease is held). */
async function sweep(c: Ctx, cl: Client = c.client()) {
  await elapse(c, "6 minutes");
  return runRefundSweep(cl.sb, { deadlineMs: Date.now() + 60_000 });
}
/** Time passes for the database AND for Stripe's clock in the fake (see `elapseBoth`). */
const elapse = (c: Ctx, interval: string) => owned(c.db, () => elapseBoth(c.db, c.stripe.world.refunds, interval));
/** Observation live now (see `live`), with Stripe's clock moving with the database's. */
const relive = (c: Ctx) => owned(c.db, () => live(c.db, (i) => elapseBoth(c.db, c.stripe.world.refunds, i)));
const figures = (c: Ctx, paymentId: string) => owned(c.db, () => kit.figures(c.db, paymentId));
const ledgerFor = (c: Ctx, p: KitPayment, type = "charge.refund.updated") => c.mainWrite(() => kit.ledger(c.db, { type, pi: p.pi, charge: p.charge }));

// ── 1, 2. The happy path and the duplicate tap ─────────────────────────────────────────────────────────────
describe("1-2 happy path and the duplicate tap", () => {
  let f: FlowDb;
  beforeAll(async () => { f = await flowDb(); });

  it("happy path, one payment: one POST (its key, its metadata), the row created, the audit rows, the follow-up read mirrors and links; figures withheld 5 minutes, then the new refundable", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    const rows = pressed(await press(c, o.quote, body(10_000, 30_000)));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ paymentId: p.id, amountCents: 10_000, outcome: "created", posted: true, cause: null, accountSlot: "location", httpStatus: 200, alreadyBound: false });
    const posts = postsOf(c);
    expect(posts).toHaveLength(1);
    expect(c.stripe.httpRequests("POST")).toBe(1);
    expect(posts[0]!.idempotencyKey).toBe(`catering-refund:${row.requestId}`);
    expect(posts[0]!.redirectMode).toBe("manual");
    const form = new URLSearchParams(posts[0]!.body);
    expect(form.get("metadata[refund_request_id]")).toBe(row.requestId);
    expect(form.get("payment_intent")).toBe(p.pi);
    expect(form.get("amount")).toBe("10000");
    const r = await requestRow(c.db, row.requestId);
    expect(r).toMatchObject({ status: "submitted", stripe_refund_id: row.stripeRefundId, arm_account_slot: "location", arm_livemode: false, arm_credential_fp: credentialFingerprint(KEY_LOC), arm_payment_intent: p.pi });
    expect(r.create_armed_at).not.toBeNull();
    // The audit rows: the reserve's (SQL, destructive) and the app's stripe_result with the account slot.
    const audits = await auditOf(c.db, row.requestId);
    expect(audits.map((a) => a.action)).toEqual(["catering.refund.request", "catering.refund.stripe_result"]);
    expect(audits[0]!.destructive).toBe(true);
    expect(audits[1]!.metadata).toMatchObject({ outcome: "created", posted: true, account_slot: "location", stripe_refund_id: row.stripeRefundId, payment_id: p.id });
    // Step 6: the follow-up read mirrored the refund and linked it to the request.
    const m = await kit.mirror(c.db, p.id);
    expect(m.map((x) => [x.refund_id, x.request_id])).toEqual([[row.stripeRefundId, row.requestId]]);
    // Our own arm / finish are changes: no figure for 5 minutes.
    expect(await figures(c, p.id)).toMatchObject({ known: false, refundable: null });
    await elapse(c, "6 minutes");
    expect((await readNow(c, p.id)).result).toBe("complete");
    expect(await figures(c, p.id)).toMatchObject({ known: true, captured: 30_000, counted: 10_000, in_flight: 0, refundable: 20_000, blocked: false });
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });

  it("happy path, two payments: one POST per reserved row (balance first), each with its own key and metadata", async () => {
    const c = await ctx(f);
    const o = await order(c, [10_000, 20_000]); // deposit, balance
    const [dep, bal] = o.pays as [KitPayment, KitPayment];
    const rows = pressed(await press(c, o.quote, body(30_000, 30_000)));
    expect(rows.map((r) => [r.paymentId, r.amountCents, r.outcome, r.posted])).toEqual([
      [bal.id, 20_000, "created", true],
      [dep.id, 10_000, "created", true],
    ]);
    const posts = postsOf(c);
    expect(posts).toHaveLength(2);
    expect(posts.map((x) => x.idempotencyKey)).toEqual(rows.map((r) => `catering-refund:${r.requestId}`));
    expect(posts.map((x) => new URLSearchParams(x.body).get("metadata[refund_request_id]"))).toEqual(rows.map((r) => r.requestId));
    for (const r of rows) expect((await requestRow(c.db, r.requestId)).status).toBe("submitted");
  });

  it("a duplicate tap (the same client token) after completion: the original rows; NO read, NO POST", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const b = body(5_000, 30_000);
    const first = pressed(await press(c, o.quote, b));
    expect(first[0]!.outcome).toBe("created");
    const getsBefore = getsOf(c);
    const callsBefore = c.main.calls.length;
    const again = await press(c, o.quote, b);
    expect(again.kind).toBe("replay");
    expect(again.kind === "replay" && again.requests.map((r) => [r.id, r.status, r.armed, r.stripeRefundId])).toEqual([[first[0]!.requestId, "submitted", true, first[0]!.stripeRefundId]]);
    expect(c.main.calls.slice(callsBefore).filter((x) => x.kind === "rpc").map((x) => x.name)).toEqual(["catering_refund_reserve_fresh"]);
    expect(getsOf(c)).toBe(getsBefore);
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });
});

// ── 3. [R7] A concurrent duplicate whose read loses ───────────────────────────────────────────────────────
describe("3 [R7] [T2] a concurrent duplicate (same token) whose read loses", () => {
  let f: FlowDb;
  beforeAll(async () => { f = await flowDb(); });

  /** Copy B runs its probe and its read, then waits before its reserve until `go` resolves. */
  function holdBBeforeReserve(c: Ctx, quote: string, b: RefundRequestBody) {
    const bClient = c.client();
    const atReserve = deferred();
    const go = deferred();
    bClient.onCall = async (call) => {
      if (call.phase === "before" && isReserveWithReads(call)) {
        atReserve.resolve();
        await go.promise;
      }
    };
    const result = settle(press(c, quote, b, { client: bClient }));
    return { bClient, atReserve: atReserve.promise, go: go.resolve, result };
  }

  it("B's last look runs AFTER the winner's reserve: B returns the original rows; ONE POST in total", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const b = body(10_000, 30_000);
    const B = holdBBeforeReserve(c, o.quote, b);
    await B.atReserve; // B read (its token is now stale-to-be)
    c.main.onCall = async (call) => {
      if (call.phase === "after" && isReserveWithReads(call)) {
        c.main.onCall = null;
        B.go();
        await B.result; // B's reserve runs now, after A reserved and before A arms
      }
    };
    const a = pressed(await press(c, o.quote, b));
    const bOut = await B.result;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ outcome: "created", posted: true });
    expect(bOut.ok).toBe(true);
    const bRes = (bOut as { value: RefundPressResult }).value;
    expect(bRes.kind).toBe("replay");
    expect(bRes.kind === "replay" && bRes.requests.map((r) => r.id)).toEqual([a[0]!.requestId]);
    // B's answer says only what the row was when B looked: reserved, not armed. It never claims a refund was sent.
    expect(bRes.kind === "replay" && bRes.requests[0]).toMatchObject({ status: "pending", armed: false, stripeRefundId: null });
    expect(rpcNames(B.bClient)).not.toContain("catering_refund_arm");
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });

  it("B's last look runs BEFORE the winner's reserve: B gets 409 stripe_unchecked (the S11 code) naming the payment; a fresh summary then shows the winner's row; ONE POST in total", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    const b = body(10_000, 30_000);
    const B = holdBBeforeReserve(c, o.quote, b);
    await B.atReserve; // B read: token tB
    c.main.onCall = async (call) => {
      if (call.phase === "before" && isReserveWithReads(call)) {
        c.main.onCall = null;
        B.go();
        await B.result; // A has read (tA replaced tB as the payment's token); B's reserve runs before A's
      }
    };
    const a = pressed(await press(c, o.quote, b));
    expect(a[0]).toMatchObject({ outcome: "created", posted: true });
    const e = await refused(B.result.then((r) => { if (r.ok) return r.value; throw r.error; }), 409, "stripe_unchecked");
    expect(e.detail).toEqual({ paymentId: p.id });
    // The S11 code: figures_stale on the create maps to stripe_unchecked (the text is the S11 sentence; its copy
    // lives with the routes / panel pieces).
    expect(REFUND_RPC_REFUSALS.reserve.figures_stale).toEqual({ status: 409, code: "stripe_unchecked" });
    expect(e.message).not.toMatch(/not sent|nothing was sent|no refund was sent/i);
    // The code's copy IS the S11 sentence (en + es).
    const t = (lang: string) => (JSON.parse(readFileSync(join(process.cwd(), "lib", "i18n", `${lang}.json`), "utf8")) as Record<string, string>)[`catering.refunds.error.${e.code}`];
    expect(t("en")).toBe("This copy of your press did not send a refund. Check the list below before you try again.");
    expect(t("es")).toBe("Esta copia de tu toque no envió un reembolso. Revisa la lista de abajo antes de intentarlo otra vez.");
    h.sb = c.client().sb;
    const summary = await loadRefundSummary(gmOf(c), o.quote);
    expect(summary.requests.map((r) => [r.id, r.status])).toEqual([[a[0]!.requestId, "submitted"]]);
    expect(rpcNames(B.bClient)).not.toContain("catering_refund_arm");
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });

  it("[T2] B's read REPLACES A's open read: both copies answer 409 stripe_unchecked ('check the list'); NOTHING reserved, ZERO POSTs", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    const b = body(10_000, 30_000);
    const bClient = c.client();
    const B: { out: Settled | null } = { out: null };
    c.main.onCall = async (call) => {
      if (call.phase === "after" && isRpc(call, "catering_refund_read_begin")) {
        c.main.onCall = null;
        B.out = await settle(press(c, o.quote, b, { client: bClient })); // B whole, while A's read is OPEN
      }
    };
    const aOut = await settle(press(c, o.quote, b));
    // A: its record answers read_replaced (and stamps dirty); its reserve has no token.
    expect(aOut.ok).toBe(false);
    expect((aOut as { error: unknown }).error).toMatchObject({ status: 409, code: "stripe_unchecked", detail: { paymentId: p.id } });
    // B: its own read was complete, but began while A's was open -> the payment was stamped dirty -> not known.
    expect(B.out).not.toBeNull();
    expect(B.out!.ok).toBe(false);
    expect((B.out! as { error: unknown }).error).toMatchObject({ status: 409, code: "stripe_unchecked" });
    const recA = c.main.calls.filter((x) => isRpc({ ...x, phase: "before" }, "catering_refund_record_read"));
    expect(recA).toHaveLength(1);
    expect(await requestsOf(c.db, p.id)).toHaveLength(0);
    expect(await figures(c, p.id)).toMatchObject({ known: false, refundable: null });
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("B's whole press (its probe) after the winner's reserve: replay at the probe, no read, no POST from B", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const b = body(10_000, 30_000);
    const bClient = c.client();
    const B: { out: Settled | null } = { out: null };
    c.main.onCall = async (call) => {
      if (call.phase === "after" && isReserveWithReads(call)) {
        c.main.onCall = null;
        B.out = await settle(press(c, o.quote, b, { client: bClient }));
      }
    };
    const a = pressed(await press(c, o.quote, b));
    expect(a[0]!.outcome).toBe("created");
    expect(B.out!.ok).toBe(true);
    expect((B.out! as { value: RefundPressResult }).value.kind).toBe("replay");
    expect(rpcNames(bClient)).toEqual(["catering_refund_reserve_fresh"]);
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });
});

// ── 4. Concurrent presses by two staff, interleaved at every RPC boundary ───────────────────────────────
describe("4 concurrent presses by two different staff (different tokens), B injected before each RPC of A", () => {
  let f: FlowDb;
  beforeAll(async () => { f = await flowDb(); });

  it("never more than the refundable total reserved; one unresolved request per payment; POSTs = rows armed and sent", async () => {
    const c = await ctx(f);
    // The dry run: A alone, to enumerate its RPC sequence.
    const dry = await order(c, [30_000]);
    pressed(await press(c, dry.quote, body(20_000, 30_000)));
    const seq = rpcNames(c.main);
    expect(seq.slice(0, 6)).toEqual([
      "catering_refund_reserve_fresh", "catering_refund_read_begin", "catering_refund_record_read",
      "catering_refund_reserve_fresh", "catering_refund_arm", "catering_refund_finish",
    ]);
    const boundaries = [...seq.map((name, k) => ({ k, name })), { k: -1, name: "the POST" }];
    const report: string[] = [];
    for (const at of boundaries) {
      const o = await order(c, [30_000]);
      const p = o.pays[0]!;
      const bClient = c.client();
      let n = 0;
      const B: { out: Settled | null } = { out: null };
      const runB = async () => { B.out = await settle(press(c, o.quote, body(20_000, 30_000), { client: bClient, actor: c.f.gm2 })); };
      c.main.calls.length = 0;
      c.main.onCall = async (call) => {
        if (call.phase !== "before" || call.kind !== "rpc") return;
        if (n++ === at.k) await runB();
      };
      c.onStripe = async (call) => {
        if (at.k === -1 && call.method === "POST" && !B.out && new URLSearchParams(call.body ?? "").get("payment_intent") === p.pi) {
          c.onStripe = null;
          await runB();
        }
      };
      const aOut = await settle(press(c, o.quote, body(20_000, 30_000)));
      c.main.onCall = null;
      c.onStripe = null;
      const bOut = B.out;
      expect(bOut, `B ran before ${at.name}#${at.k}`).not.toBeNull();
      const rows = await requestsOf(c.db, p.id);
      const held = rows.filter((r) => r.status !== "failed").reduce((s, r) => s + Number(r.amount_cents), 0);
      const pendingN = rows.filter((r) => r.status === "pending").length;
      const armed = rows.filter((r) => r.create_armed_at !== null);
      const posts = postsOf(c, p.pi);
      report.push(`${at.name}#${at.k}: A ${aOut.ok ? (aOut.value.kind === "pressed" ? aOut.value.rows.map((r) => r.outcome).join(",") : "replay") : (aOut.error as CateringRefundError).code}; `
        + `B ${bOut!.ok ? (bOut!.value.kind === "pressed" ? bOut!.value.rows.map((r) => r.outcome).join(",") : "replay") : (bOut!.error as CateringRefundError).code}; held ${held}; posts ${posts.length}`);
      expect(held, report.at(-1)).toBeLessThanOrEqual(30_000);
      expect(pendingN, report.at(-1)).toBeLessThanOrEqual(1);
      expect(posts.length, report.at(-1)).toBe(armed.length);
      expect(new Set(posts.map((x) => x.idempotencyKey)).size).toBe(posts.length);
      expect(c.stripe.world.refundedOn(p.pi), report.at(-1)).toBeLessThanOrEqual(30_000);
      // No POST reached Stripe asking for more than the charge had left.
      const keys = new Set(posts.map((x) => String(x.idempotencyKey)));
      expect(c.stripe.world.creates.filter((x) => keys.has(x.idempotencyKey) && x.status !== 200), report.at(-1)).toEqual([]);
    }
    // What each interleaving came to (printed for the record; the invariants above are the assertions).
    console.info(`[4] B injected before each boundary of A:\n${report.join("\n")}`);
    expect(report).toHaveLength(boundaries.length);
  });
});

// ── 5. Crashes ────────────────────────────────────────────────────────────────────────────────────────────
describe("5 a crash at each step", () => {
  let f: FlowDb;
  beforeAll(async () => { f = await flowDb(); });

  /** Start a press that will hang forever at `where`; resolves once it got there. */
  async function crashAt(c: Ctx, quote: string, b: RefundRequestBody, where: (call: HookCall) => boolean) {
    const reached = deferred();
    c.main.onCall = async (call) => {
      if (where(call)) {
        reached.resolve();
        await never();
      }
    };
    void press(c, quote, b).catch(() => {});
    await reached.promise;
    c.main.onCall = null;
  }

  it("after the reserve, before the arm: the sweep cancels the row (stale_unarmed) after 15 minutes; nothing sent", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    await crashAt(c, o.quote, body(10_000, 30_000), (call) => call.phase === "before" && isRpc(call, "catering_refund_arm"));
    const [r0] = await requestsOf(c.db, p.id);
    expect(r0).toMatchObject({ status: "pending", create_armed_at: null });
    await elapse(c, "16 minutes");
    const s = await runRefundSweep(c.client().sb, { deadlineMs: Date.now() + 60_000 });
    expect(s.claimed).toBe(true);
    expect(s.cancelledUnarmed).toBeGreaterThanOrEqual(1);
    expect(await requestRow(c.db, r0!.id)).toMatchObject({ status: "failed", last_error_code: "never_sent", create_armed_at: null });
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("after the POST, before finish: the next read binds it by metadata when Stripe's created is AFTER the arm [T1]", async () => {
    const c = await ctx(f);
    c.armOffsetSec = 1;
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    await crashAt(c, o.quote, body(10_000, 30_000), (call) => call.phase === "before" && isRpc(call, "catering_refund_finish"));
    expect(c.stripe.httpRequests("POST")).toBe(1);
    const [r0] = await requestsOf(c.db, p.id);
    expect(r0).toMatchObject({ status: "pending", stripe_refund_id: null });
    expect(r0!.create_armed_at).not.toBeNull();
    const refund = c.stripe.world.refunds.find((x) => x.metadata.refund_request_id === r0!.id)!;
    const read = await readNow(c, p.id);
    expect(read.result).toBe("complete");
    expect(read.bound).toEqual([{ requestId: r0!.id, refundId: refund.id }]);
    expect(await requestRow(c.db, r0!.id)).toMatchObject({ status: "submitted", stripe_refund_id: refund.id });
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });

  it("after the POST, before finish, Stripe's created in the arm's OWN second [T1]: NOT bound; attachable; still unconfirmed", async () => {
    const c = await ctx(f);
    c.armOffsetSec = 0;
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    await crashAt(c, o.quote, body(10_000, 30_000), (call) => call.phase === "before" && isRpc(call, "catering_refund_finish"));
    const [r0] = await requestsOf(c.db, p.id);
    const armed = (await armedEpoch(c.db, r0!.id))!;
    expect(armed % 1, "the arm did not fall on a whole second").not.toBe(0);
    const refund = c.stripe.world.refunds.find((x) => x.metadata.refund_request_id === r0!.id)!;
    expect(refund.created).toBe(Math.floor(armed));
    const read = await readNow(c, p.id);
    expect(read.result).toBe("complete");
    expect(read.bound).toEqual([]);
    expect(await requestRow(c.db, r0!.id)).toMatchObject({ status: "pending", stripe_refund_id: null });
    expect(await claimsOf(c.db, p.id)).toEqual([{ refund_id: refund.id, kind: "mismatch", attachable_to: r0!.id }]);
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });

  it("after the arm, before the POST: armed, never sent; unconfirmed, blocks, zero POSTs from the sweep or a new press; released after 24 h with `no_request`", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    await crashAt(c, o.quote, body(10_000, 30_000), (call) => call.phase === "after" && isRpc(call, "catering_refund_arm"));
    const [r0] = await requestsOf(c.db, p.id);
    expect(r0).toMatchObject({ status: "pending", stripe_refund_id: null });
    expect(r0!.create_armed_at).not.toBeNull();
    expect(c.stripe.httpRequests("POST")).toBe(0);
    // The sweep looks for it (class A every run) and never POSTs.
    const s = await sweep(c);
    expect(s.claimed).toBe(true);
    expect(s.passes).toBeGreaterThanOrEqual(1);
    await relive(c);
    expect(await figures(c, p.id)).toMatchObject({ blocked: true, refundable: 0 });
    // A new press on that payment is refused; nothing is sent.
    await refused(press(c, o.quote, body(1_000, 0)), 409, "nothing_refundable");
    // Not before 24 hours.
    h.sb = c.client().sb;
    await refused(releaseRefund(mooOf(c), o.quote, r0!.id, { finding: "no_request", accountSlot: "location", livemode: false, note: null }), 409, "not_releasable_yet");
    await elapse(c, "24 hours 1 minute");
    await relive(c);
    h.sb = c.client().sb;
    const rel = await releaseRefund(mooOf(c), o.quote, r0!.id, { finding: "no_request", accountSlot: "location", livemode: false, note: null });
    expect(rel).toMatchObject({ result: "released", requestId: r0!.id });
    expect(await requestRow(c.db, r0!.id)).toMatchObject({ status: "failed", last_error_code: "released_no_refund", resolved_by: c.f.moo });
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });
});

// ── 6. Each ambiguous answer = unconfirmed with exactly one POST ───────────────────────────────────────────
describe("6 each ambiguous answer is UNCONFIRMED with exactly one POST; Check / the sweep / a replay never POST; a new press is refused", () => {
  let f: FlowDb;
  beforeAll(async () => { f = await flowDb(); });

  type Case = [name: string, arrange: (c: Ctx) => void, http: number | null, code: string];
  const cases: Case[] = [
    ["a 500 (saved under the key)", (c) => c.stripe.script("create", status(500)), 500, "api_error"],
    ["a 409", (c) => c.stripe.script("create", status(409)), 409, "invalid_request_error"],
    ["a 429", (c) => c.stripe.script("create", status(429)), 429, "rate_limit"],
    ["a 400", (c) => c.stripe.script("create", status(400)), 400, "invalid_request_error"],
    ["a timeout (Stripe executed; the answer came too late)", (c) => c.stripe.script("create", delay(5_000)), null, "timeout"],
    ["a network error after Stripe executed", (c) => c.stripe.script("create", networkError("after_executing")), null, "network_error"],
    ["a 307 (never followed)", (c) => c.stripe.script("create", redirect(307)), 307, "redirect_not_followed"],
    ["an unparseable 2xx", (c) => c.stripe.script("create", status(200, { object: "refund", id: "re_fake_half" })), 200, "unparseable_2xx"],
  ];

  it.each(cases)("%s", async (name, arrange, http, code) => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    arrange(c);
    const deadlineMs = Date.now() + 100_000;
    if (name.startsWith("a timeout")) c.postTimeoutDeadline = deadlineMs;
    const b = body(10_000, 30_000);
    const rows = pressed(await press(c, o.quote, b, { deadlineMs }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "unconfirmed", posted: true, httpStatus: http });
    expect(c.stripe.httpRequests("POST")).toBe(1);
    const r0 = await requestRow(c.db, rows[0]!.requestId);
    expect(r0).toMatchObject({ status: "pending", stripe_refund_id: null });
    expect(r0.create_armed_at).not.toBeNull();
    if (code) expect(r0.last_error_code).toBe(code);
    // Check Stripe: GETs only.
    h.sb = c.client().sb;
    const checks = await checkRefunds(gmOf(c), o.quote);
    expect(checks.map((x) => x.paymentId)).toEqual([p.id]);
    // The sweep: reads it (unconfirmed = class A every run), never POSTs.
    const s = await sweep(c);
    expect(s.claimed).toBe(true);
    // A replay of the same token: the original row, nothing read, nothing sent.
    const again = await press(c, o.quote, b);
    expect(again.kind).toBe("replay");
    expect(c.stripe.httpRequests("POST")).toBe(1);
    // A NEW press on that payment (once its figures are known again): the payment is blocked, nothing to allocate.
    await relive(c);
    expect(await figures(c, p.id)).toMatchObject({ blocked: true, refundable: 0 });
    await refused(press(c, o.quote, body(1_000, 0)), 409, "nothing_refundable");
    expect(await requestsOf(c.db, p.id)).toHaveLength(1);
    expect(c.stripe.httpRequests("POST")).toBe(1);
    expect(postsOf(c)[0]!.idempotencyKey).toBe(`catering-refund:${rows[0]!.requestId}`);
  });
});

// ── 7, 8. Answers that do not match; a timeout after a read bound the row ───────────────────────────────
describe("7-8 [R8] [S9] 2xx answers that do not match; a lost answer after a read bound the row", () => {
  let f: FlowDb;
  beforeAll(async () => { f = await flowDb(); });

  type Bend = [name: string, bend: (b: Record<string, unknown>) => Record<string, unknown>];
  const bends: Bend[] = [
    ["another PaymentIntent", (b) => ({ ...b, payment_intent: "pi_fake_another_intent" })],
    ["another amount", (b) => ({ ...b, amount: Number(b.amount) + 1 })],
    ["another currency", (b) => ({ ...b, currency: "eur" })],
    ["another charge", (b) => ({ ...b, charge: "ch_fake_another_charge" })],
    ["no metadata", (b) => ({ ...b, metadata: {} })],
  ];

  it.each(bends)("a 2xx naming %s: answer_mismatch, the row stays unconfirmed, the next tender is NOT armed", async (_n, bend) => {
    const c = await ctx(f);
    const o = await order(c, [10_000, 20_000]);
    const [dep, bal] = o.pays as [KitPayment, KitPayment];
    c.bendPost = bend;
    const rows = pressed(await press(c, o.quote, body(30_000, 30_000)));
    expect(rows.map((r) => [r.paymentId, r.outcome, r.posted, r.cause])).toEqual([
      [bal.id, "answer_mismatch", true, null],
      [dep.id, "never_sent", false, "stopped"],
    ]);
    expect(await requestRow(c.db, rows[0]!.requestId)).toMatchObject({ status: "pending", stripe_refund_id: null, last_error_code: "answer_mismatch" });
    expect(await requestRow(c.db, rows[1]!.requestId)).toMatchObject({ status: "failed", last_error_code: "never_sent", create_armed_at: null });
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });

  it("[R8] a TIMEOUT delivered to finish after a read already bound the row: already_bound_unconfirmed_answer, the row bound, its audit row, the next tender not armed, one POST", async () => {
    const c = await ctx(f);
    c.armOffsetSec = 1;
    const o = await order(c, [10_000, 20_000]);
    const [dep, bal] = o.pays as [KitPayment, KitPayment];
    const deadlineMs = Date.now() + 100_000;
    c.postTimeoutDeadline = deadlineMs;
    c.stripe.script("create", delay(5_000)); // executed at Stripe; the answer is lost to the timeout
    const R: { bound: Array<{ requestId: string; refundId: string }> } = { bound: [] };
    c.main.onCall = async (call) => {
      if (call.phase === "before" && isRpc(call, "catering_refund_finish")) {
        c.main.onCall = null;
        R.bound = (await readNow(c, bal.id)).bound; // the sweep / Check Stripe got there first
      }
    };
    const rows = pressed(await press(c, o.quote, body(30_000, 30_000), { deadlineMs }));
    const bound = R.bound;
    expect(bound).toHaveLength(1);
    expect(rows[0]).toMatchObject({ paymentId: bal.id, outcome: "already_bound_unconfirmed_answer", posted: true, httpStatus: null, stripeRefundId: bound[0]!.refundId });
    expect(rows[1]).toMatchObject({ paymentId: dep.id, outcome: "never_sent", posted: false, cause: "stopped" });
    expect(await requestRow(c.db, rows[0]!.requestId)).toMatchObject({ status: "submitted", stripe_refund_id: bound[0]!.refundId });
    const audit = (await auditOf(c.db, rows[0]!.requestId)).find((a) => a.action === "catering.refund.stripe_result");
    expect(audit?.metadata).toMatchObject({ outcome: "already_bound_unconfirmed_answer", posted: true, row_status: "submitted" });
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });

  it("[S9] an already-bound row whose 2xx (the SAME refund) fails verification: answer_mismatch, next tender not armed", async () => {
    const c = await ctx(f);
    c.armOffsetSec = 1;
    const o = await order(c, [10_000, 20_000]);
    const [dep, bal] = o.pays as [KitPayment, KitPayment];
    c.bendPost = (b) => ({ ...b, amount: Number(b.amount) - 1 });
    c.main.onCall = async (call) => {
      if (call.phase === "before" && isRpc(call, "catering_refund_finish")) {
        c.main.onCall = null;
        expect((await readNow(c, bal.id)).bound).toHaveLength(1);
      }
    };
    const rows = pressed(await press(c, o.quote, body(30_000, 30_000)));
    expect(rows[0]).toMatchObject({ paymentId: bal.id, outcome: "answer_mismatch", posted: true, alreadyBound: true });
    expect(rows[1]).toMatchObject({ paymentId: dep.id, outcome: "never_sent", cause: "stopped", posted: false });
    expect((await requestRow(c.db, rows[0]!.requestId)).status).toBe("submitted"); // the read's binding stands
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });
});

// ── 9-12. Events, budgets, the arm in transport, multi-payment, a read binding first ─────────────────────
describe("9-12 events in between, the budgets, the arm's transport, a multi-payment press, a read binding first", () => {
  let f: FlowDb;
  beforeAll(async () => { f = await flowDb(); });

  it("9a an event between the read and the reserve: 409 stripe_unchecked, nothing reserved, zero POSTs", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    c.main.onCall = async (call) => {
      if (call.phase === "before" && isReserveWithReads(call)) {
        c.main.onCall = null;
        await ledgerFor(c, p);
      }
    };
    const b = body(10_000, 30_000);
    await refused(press(c, o.quote, b), 409, "stripe_unchecked");
    expect(await lib.count(c.db, "select count(*) n from public.catering_refund_requests where client_token = $1", [b.clientToken])).toBe(0);
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("9b an event between the reserve and the arm: the arm answers figures_stale, the row is cancelled never_sent, zero POSTs", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    c.main.onCall = async (call) => {
      if (call.phase === "before" && isRpc(call, "catering_refund_arm")) {
        c.main.onCall = null;
        await ledgerFor(c, p);
      }
    };
    const rows = pressed(await press(c, o.quote, body(10_000, 30_000)));
    expect(rows[0]).toMatchObject({ outcome: "never_sent", posted: false, cause: "figures_stale" });
    expect(await requestRow(c.db, rows[0]!.requestId)).toMatchObject({ status: "failed", last_error_code: "never_sent", create_armed_at: null });
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("10a the 35-second budget: a row with less than 35 s left is cancelled, never armed", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const rows = pressed(await press(c, o.quote, body(10_000, 30_000), { deadlineMs: Date.now() + 30_000 }));
    expect(rows[0]).toMatchObject({ outcome: "never_sent", posted: false, cause: "deadline" });
    expect(rpcNames(c.main)).not.toContain("catering_refund_arm");
    expect((await requestRow(c.db, rows[0]!.requestId)).status).toBe("failed");
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("10b [R9] an arm that waited past its budget (`deadline_passed`): the lib cancels once and does not POST", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    c.main.rpc.catering_refund_arm = () => ({ data: { result: "deadline_passed", status: "pending", armed: false }, error: null });
    const rows = pressed(await press(c, o.quote, body(10_000, 30_000)));
    expect(rows[0]).toMatchObject({ outcome: "never_sent", posted: false, cause: "deadline_passed" });
    expect(rpcNames(c.main).filter((n) => n === "catering_refund_cancel_unarmed")).toHaveLength(1);
    expect((await requestRow(c.db, rows[0]!.requestId)).status).toBe("failed");
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("10c the arm call fails in transport BEFORE it ran (15.1 P3-e): no POST, cancel once, `never_sent`", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    c.main.onCall = (call) => {
      if (call.phase === "before" && isRpc(call, "catering_refund_arm")) throw new TypeError("fetch failed");
    };
    const rows = pressed(await press(c, o.quote, body(10_000, 30_000)));
    expect(rows[0]).toMatchObject({ outcome: "never_sent", posted: false, cause: "arm_unanswered", rowState: { status: "failed", armed: false } });
    expect(rpcNames(c.main).filter((n) => n === "catering_refund_cancel_unarmed")).toHaveLength(1);
    expect(await requestRow(c.db, rows[0]!.requestId)).toMatchObject({ status: "failed", create_armed_at: null });
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("10d the arm call fails in transport AFTER it ran (committed): no POST, cancel once, `armed_unsent` (the row's real state)", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    c.main.onCall = (call) => {
      if (call.phase === "after" && isRpc(call, "catering_refund_arm")) throw new TypeError("fetch failed");
    };
    const rows = pressed(await press(c, o.quote, body(10_000, 30_000)));
    expect(rows[0]).toMatchObject({ outcome: "armed_unsent", posted: false, cause: "arm_unanswered", rowState: { status: "pending", armed: true } });
    expect(rpcNames(c.main).filter((n) => n === "catering_refund_cancel_unarmed")).toHaveLength(1);
    const r0 = await requestRow(c.db, rows[0]!.requestId);
    expect(r0.status).toBe("pending");
    expect(r0.create_armed_at).not.toBeNull();
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("11a a multi-payment press whose first POST is ambiguous: the second row is cancelled; one POST", async () => {
    const c = await ctx(f);
    const o = await order(c, [10_000, 20_000]);
    const [dep, bal] = o.pays as [KitPayment, KitPayment];
    c.stripe.script("create", status(500));
    const rows = pressed(await press(c, o.quote, body(30_000, 30_000)));
    expect(rows.map((r) => [r.paymentId, r.outcome, r.posted, r.cause])).toEqual([
      [bal.id, "unconfirmed", true, null],
      [dep.id, "never_sent", false, "stopped"],
    ]);
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });

  it("11b [P3-9] the payment's PaymentIntent changes after the reserve, before the arm: never_sent (the arm's own re-check), zero POSTs", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    c.main.onCall = async (call) => {
      if (call.phase === "before" && isRpc(call, "catering_refund_arm")) {
        c.main.onCall = null;
        await c.mainWrite(() => c.db.query("update public.catering_payments set provider_ref = $2 where id = $1", [p.id, `${p.pi}_moved`]));
      }
    };
    const rows = pressed(await press(c, o.quote, body(10_000, 30_000)));
    expect(rows[0]).toMatchObject({ outcome: "never_sent", posted: false, cause: "figures_stale" });
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("11c [P3-9] the lib's own PaymentIntent compare: the reserve names another PaymentIntent than the read proved -> never_sent, no arm, zero POSTs", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const real = c.client();
    c.main.rpc.catering_refund_reserve_fresh = async (args) => {
      if (args.p_reads == null) return undefined;
      const a = await real.sb.rpc("catering_refund_reserve_fresh", args);
      const data = a.data as { requests?: Array<Record<string, unknown>> } | null;
      for (const r of data?.requests ?? []) r.payment_intent = "pi_fake_moved_elsewhere";
      return { data, error: a.error as never };
    };
    const rows = pressed(await press(c, o.quote, body(10_000, 30_000)));
    expect(rows[0]).toMatchObject({ outcome: "never_sent", posted: false, cause: "payment_intent_changed" });
    expect(rpcNames(c.main)).not.toContain("catering_refund_arm");
    expect((await requestRow(c.db, rows[0]!.requestId)).status).toBe("failed");
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("12 a read binds before finish (the sweep runs between the POST and finish): finish answers created + already bound; one POST", async () => {
    const c = await ctx(f);
    c.armOffsetSec = 1;
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    const S: { out: Awaited<ReturnType<typeof runRefundSweep>> | null } = { out: null };
    c.main.onCall = async (call) => {
      if (call.phase === "before" && isRpc(call, "catering_refund_finish")) {
        c.main.onCall = null;
        S.out = await sweep(c);
      }
    };
    const rows = pressed(await press(c, o.quote, body(10_000, 30_000)));
    expect(S.out!.claimed).toBe(true);
    expect(S.out!.bound).toBeGreaterThanOrEqual(1);
    expect(rows[0]).toMatchObject({ outcome: "created", alreadyBound: true, posted: true });
    expect(await requestRow(c.db, rows[0]!.requestId)).toMatchObject({ status: "submitted", stripe_refund_id: rows[0]!.stripeRefundId });
    expect(postsOf(c, p.pi)).toHaveLength(1);
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });
});

// ── 13, 14. The two staff exits ──────────────────────────────────────────────────────────────────────────
describe("13 [R6] [T5] release with two permitted accounts; each finding; released then found", () => {
  let f: FlowDb;
  beforeAll(async () => { f = await flowDb(); });

  it("the wrong slot / mode refuses; before 24 h refuses; each finding; the right account releases; the refund appears later and is counted as a `released` claim", async () => {
    const c = await ctx(f, { slots: "both" });
    const unconfirmed = async () => {
      const o = await order(c, [30_000]);
      c.stripe.script("create", status(500));
      const rows = pressed(await press(c, o.quote, body(10_000, 30_000)));
      expect(rows[0]!.outcome).toBe("unconfirmed");
      return { ...o, p: o.pays[0]!, req: rows[0]!.requestId };
    };
    const o1 = await unconfirmed();
    const o2 = await unconfirmed();
    const rel = (o: { quote: string; req: string }, over: Partial<{ finding: string; accountSlot: string; livemode: boolean }> = {}) => {
      h.sb = c.client().sb;
      return releaseRefund(mooOf(c), o.quote, o.req, { finding: "no_request", accountSlot: "location", livemode: false, note: null, ...over } as never);
    };
    const early = await refused(rel(o1), 409, "not_releasable_yet");
    expect(early.detail).toMatchObject({ releasableAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/) });
    await elapse(c, "24 hours 1 minute");
    await relive(c);
    // The payment's own account is the shop's slot (the shared account answered 404): the other slot, or the other
    // mode, is refused by name.
    await refused(rel(o1, { accountSlot: "default" }), 409, "wrong_account");
    await refused(rel(o1, { livemode: true }), 409, "wrong_account");
    await refused(rel(o1, { finding: "request_succeeded" }), 409, "use_attach");
    await refused(rel(o1, { finding: "unclear" }), 400, "finding_not_releasable");
    h.sb = c.client().sb;
    await refused(releaseRefund(gmOf(c), o1.quote, o1.req, { finding: "no_request", accountSlot: "location", livemode: false, note: null }), 403, "forbidden");
    expect((await requestRow(c.db, o1.req)).status).toBe("pending");
    expect(await rel(o1)).toMatchObject({ result: "released", requestId: o1.req });
    expect(await rel(o2, { finding: "request_failed" })).toMatchObject({ result: "released" });
    expect(await requestRow(c.db, o1.req)).toMatchObject({ status: "failed", last_error_code: "released_no_refund", resolved_by: c.f.moo });
    const audit = (await auditOf(c.db, o1.req)).find((a) => a.action === "catering.refund.release");
    expect(audit).toMatchObject({ destructive: true });
    expect(audit!.metadata).toMatchObject({ finding: "no_request", account_slot: "location", livemode: false, credential_fp: credentialFingerprint(KEY_LOC) });
    // Released, then found: the POST had landed after all. Mirrored, counted, reported as a `released` claim.
    const late = c.stripe.world.addRefund({ paymentIntentId: o1.p.pi, amount: 10_000, metadata: { refund_request_id: o1.req }, created: Math.floor(Date.now() / 1000) });
    expect((await readNow(c, o1.p.id)).result).toBe("complete");
    expect(await claimsOf(c.db, o1.p.id)).toEqual([{ refund_id: late.id, kind: "released", attachable_to: null }]);
    expect(await figures(c, o1.p.id)).toMatchObject({ known: true, counted: 10_000, in_flight: 0, refundable: 20_000, blocked: false });
    expect((await owned(c.db, () => inventory(c.db))).counts.released_with_refund).toBeGreaterThanOrEqual(1);
    expect(c.stripe.httpRequests("POST")).toBe(2);
  });

  it("[T5] the credential changed since the arm (the slot's key swapped: another fingerprint): release AND attach refuse `credential_changed`; the request stays reserved", async () => {
    const c = await ctx(f, { slots: "both" });
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    c.stripe.script("create", status(500));
    const rows = pressed(await press(c, o.quote, body(10_000, 30_000)));
    const req = rows[0]!.requestId;
    expect((await requestRow(c.db, req)).arm_credential_fp).toBe(credentialFingerprint(KEY_LOC));
    await elapse(c, "24 hours 1 minute");
    await relive(c);
    c.stripe.rotateKey(KEY_LOC, KEY_LOC_ROTATED);
    vi.stubEnv("STRIPE_SECRET_KEY__S1", KEY_LOC_ROTATED);
    h.sb = c.client().sb;
    await refused(releaseRefund(mooOf(c), o.quote, req, { finding: "no_request", accountSlot: "location", livemode: false, note: null }), 409, "credential_changed");
    h.sb = c.client().sb;
    await refused(attachRefund(mooOf(c), o.quote, req, { refundId: "re_fake_absent_1", note: null }), 409, "credential_changed");
    expect((await kit.stateRow(c.db, p.id))?.credential_fp).toBe(credentialFingerprint(KEY_LOC_ROTATED));
    expect(await requestRow(c.db, req)).toMatchObject({ status: "pending", stripe_refund_id: null });
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });
});

describe("14 [Q4] [T1] attach: a refund whose metadata was removed, and one created in the arm's own second", () => {
  let f: FlowDb;
  beforeAll(async () => { f = await flowDb(); });

  it("metadata removed: never auto-bound; a GM is refused; a MoO attaches it; no POST", async () => {
    const c = await ctx(f);
    c.armOffsetSec = 1; // created AFTER the arm: only the missing metadata keeps a read from binding it
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    c.stripe.script("create", networkError("after_executing"));
    c.main.onCall = (call) => {
      if (call.phase === "before" && isRpc(call, "catering_refund_finish")) {
        c.main.onCall = null;
        const r = c.stripe.world.refunds.find((x) => x.metadata.refund_request_id === argsOf(call).p_request_id)!;
        r.metadata = {}; // someone removed it at Stripe
      }
    };
    const rows = pressed(await press(c, o.quote, body(10_000, 30_000)));
    const req = rows[0]!.requestId;
    expect(rows[0]).toMatchObject({ outcome: "unconfirmed", posted: true });
    const refund = c.stripe.world.refunds.find((x) => x.paymentIntentId === p.pi)!;
    await relive(c);
    expect((await readNow(c, p.id)).bound).toEqual([]);
    expect(await claimsOf(c.db, p.id)).toEqual([{ refund_id: refund.id, kind: "none", attachable_to: req }]);
    expect((await requestRow(c.db, req)).status).toBe("pending");
    h.sb = c.client().sb;
    await refused(attachRefund(gmOf(c), o.quote, req, { refundId: refund.id, note: null }), 403, "forbidden");
    h.sb = c.client().sb;
    expect(await attachRefund(mooOf(c), o.quote, req, { refundId: refund.id, note: null })).toMatchObject({ result: "attached", refundId: refund.id });
    expect(await requestRow(c.db, req)).toMatchObject({ status: "submitted", stripe_refund_id: refund.id, resolved_by: c.f.moo });
    const audit = (await auditOf(c.db, req)).find((a) => a.action === "catering.refund.attach");
    expect(audit).toMatchObject({ destructive: true });
    expect(audit!.metadata).toMatchObject({ refund_id: refund.id, metadata_named_request: false });
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });

  it("[T1] a refund created in the arm's own second (metadata intact): not auto-bound, attachable, attached by a MoO", async () => {
    const c = await ctx(f);
    c.armOffsetSec = 0;
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    c.stripe.script("create", networkError("after_executing"));
    const rows = pressed(await press(c, o.quote, body(10_000, 30_000)));
    const req = rows[0]!.requestId;
    const refund = c.stripe.world.refunds.find((x) => x.paymentIntentId === p.pi)!;
    expect(refund.metadata.refund_request_id).toBe(req);
    await relive(c);
    expect((await readNow(c, p.id)).bound).toEqual([]);
    expect(await claimsOf(c.db, p.id)).toEqual([{ refund_id: refund.id, kind: "mismatch", attachable_to: req }]);
    h.sb = c.client().sb;
    expect(await attachRefund(mooOf(c), o.quote, req, { refundId: refund.id, note: null })).toMatchObject({ result: "attached" });
    expect(await requestRow(c.db, req)).toMatchObject({ status: "submitted", stripe_refund_id: refund.id });
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });
});

// ── 15-19. Settlement order, a late reversal, the switches, a reversal with no webhook, the residual ─────
describe("15-19 settlement order, a late reversal, the switches, the hourly re-read, the [Q6] residual", () => {
  let f: FlowDb;
  beforeAll(async () => { f = await flowDb(); });

  it("15 a refund event before its payment is recorded: the checkout counts as NOT covered meanwhile; after main records it paid, the first read finds the refund", async () => {
    const c = await ctx(f);
    const quote = await c.f.w.quote();
    const p = await c.mainWrite(() => c.f.w.pay(quote, "full", 30_000, { status: "due", session: `cs_test_fake_open_${randomUUID().slice(0, 8)}` }));
    c.stripe.world.addPaymentIntent({ id: p.pi, account: KEY_LOC, chargeId: p.charge, amountCaptured: 30_000 });
    const refund = c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 5_000 });
    await ledgerFor(c, p);
    const inv = await owned(c.db, () => inventory(c.db));
    expect(inv.lists.unsettled_checkouts).toContainEqual({ payment_id: p.id, status: "due" });
    expect((await readNow(c, p.id)).result).toBe("ineligible");
    // main's settlement path (not B1's to run): the row turns paid with its PaymentIntent.
    await c.mainWrite(() => c.db.query(
      "update public.catering_payments set status = 'paid', provider_ref = $2, paid_at = now(), provider_session_id = null where id = $1", [p.id, p.pi]));
    expect((await readNow(c, p.id)).result).toBe("complete");
    expect((await kit.mirror(c.db, p.id)).map((m) => m.refund_id)).toEqual([refund.id]);
    expect(await figures(c, p.id)).toMatchObject({ known: false }); // the delivery is inside the read's window
    await elapse(c, "6 minutes");
    expect((await readNow(c, p.id)).result).toBe("complete");
    expect(await figures(c, p.id)).toMatchObject({ known: true, captured: 30_000, counted: 5_000, refundable: 25_000 });
    expect((await owned(c.db, () => inventory(c.db))).lists.unsettled_checkouts).not.toContainEqual({ payment_id: p.id, status: "due" });
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("16 a late reversal with an open sibling checkout: the mirror shows the failure, the disagreement is reported, the payment row and the sibling are byte-identical", async () => {
    const c = await ctx(f);
    const quote = await c.f.w.quote();
    const p = await c.mainWrite(() => c.f.w.pay(quote, "deposit", 30_000, { status: "refunded" }));
    const sib = await c.mainWrite(() => c.f.w.pay(quote, "balance", 20_000, { status: "due", session: `cs_test_fake_sibling_${randomUUID().slice(0, 8)}` }));
    c.stripe.world.addPaymentIntent({ id: p.pi, account: KEY_LOC, chargeId: p.charge, amountCaptured: 30_000 });
    const whole = c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 30_000 });
    const snap = () => lib.rows(c.db, "select p::text as t from public.catering_payments p where p.id in ($1, $2) order by p.id", [p.id, sib.id]);
    const before = await snap();
    expect((await readNow(c, p.id)).result).toBe("complete");
    expect(await figures(c, p.id)).toMatchObject({ known: true, stripe_whole: true, disagrees: false, refundable: 0 });
    // The late reversal (Stripe tells us with an event, as main records every signed delivery).
    c.stripe.world.setRefundStatus(whole.id, "failed");
    await ledgerFor(c, p);
    await elapse(c, "6 minutes");
    expect((await readNow(c, p.id)).result).toBe("complete");
    const [m] = await kit.mirror(c.db, p.id);
    expect(m).toMatchObject({ refund_id: whole.id, status: "failed", previous_status: "succeeded" });
    expect(await figures(c, p.id)).toMatchObject({ known: true, stripe_whole: false, disagrees: true, counted: 0, refundable: 30_000 });
    h.sb = c.client().sb;
    const view = (await loadRefundSummary(gmOf(c), quote)).payments.find((x) => x.id === p.id)!;
    expect(view).toMatchObject({ status: "refunded", disagrees: true, known: true });
    expect(await snap()).toEqual(before);
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("17 creates stopped while observation continues; observation off with creates on: refunds_unavailable, no GET, no POST", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    vi.stubEnv("CATERING_REFUNDS", "");
    await refused(press(c, o.quote, body(1_000, 30_000)), 503, "refunds_off");
    const s = await sweep(c);
    expect(s.claimed).toBe(true);
    expect(s.passes).toBeGreaterThanOrEqual(1);
    expect(getsOf(c)).toBeGreaterThan(0);
    vi.stubEnv("CATERING_REFUNDS", "1");
    vi.stubEnv("CATERING_REFUNDS_OBSERVE", "");
    const n = c.stripe.calls.length;
    await refused(press(c, o.quote, body(1_000, 30_000)), 503, "refunds_unavailable");
    h.sb = c.client().sb;
    await refused(checkRefunds(gmOf(c), o.quote), 503, "refunds_unavailable");
    expect(c.stripe.calls).toHaveLength(n);
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("18 [T3] a reversal found with NO webhook: 45+ minutes after the last complete read the sweep's class C makes the exact GET for that refund", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    const r = c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 4_000 });
    expect((await readNow(c, p.id)).result).toBe("complete");
    expect(await figures(c, p.id)).toMatchObject({ known: true, refundable: 26_000 });
    c.stripe.world.setRefundStatus(r.id, "failed"); // no event: nothing reaches the ledger
    await elapse(c, "40 minutes");
    const n = c.stripe.calls.length;
    const s = await sweep(c); // + 6 minutes: the read is 46 minutes old
    expect(s.claimed).toBe(true);
    expect(c.stripe.calls.slice(n).filter((x) => x.method === "GET" && x.path === `/v1/refunds/${r.id}`)).toHaveLength(1);
    expect((await kit.mirror(c.db, p.id))[0]).toMatchObject({ refund_id: r.id, status: "failed", previous_status: "succeeded" });
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });

  it("19 [R15] [Q6] ACCEPTED RESIDUAL, documented: a delivered event whose refund the lists do not show yet — no figure for 5 minutes; after them the reserve trusts a read that cannot see it", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    expect((await readNow(c, p.id)).result).toBe("complete");
    // A refund made at Stripe (outside the app); its event is delivered; the lists and retrieves do not show it yet.
    const hidden = c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 20_000, created: Math.floor(Date.now() / 1000) });
    c.stripe.world.hidden.add(hidden.id);
    await ledgerFor(c, p);
    expect(await figures(c, p.id)).toMatchObject({ known: false, refundable: null });
    await elapse(c, "4 minutes");
    expect((await readNow(c, p.id)).result).toBe("complete");
    expect(await figures(c, p.id)).toMatchObject({ known: false, refundable: null }); // inside the 5 minutes: no figure
    await elapse(c, "2 minutes");
    // After the 5 minutes the press's own read is complete and known WITHOUT the hidden refund: the reserve accepts
    // the whole 30,000 although only 10,000 is left at Stripe. What stops a second refund of the same money is
    // Stripe's own cap: the ONE POST is refused (400, saved under the key) and the row is unconfirmed.
    const rows = pressed(await press(c, o.quote, body(30_000, 30_000)));
    expect(rows[0]).toMatchObject({ outcome: "unconfirmed", posted: true, httpStatus: 400 });
    expect((await requestRow(c.db, rows[0]!.requestId)).last_error_code).toBe("charge_already_refunded");
    expect(c.stripe.world.refundedOn(p.pi)).toBe(20_000);
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });

  it("19b [R15] [Q6] ACCEPTED RESIDUAL, documented: inside the charge's cap the same blind window lets a second partial land", async () => {
    const c = await ctx(f);
    const o = await order(c, [30_000]);
    const p = o.pays[0]!;
    expect((await readNow(c, p.id)).result).toBe("complete");
    const hidden = c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 20_000, created: Math.floor(Date.now() / 1000) });
    c.stripe.world.hidden.add(hidden.id);
    await ledgerFor(c, p);
    await elapse(c, "6 minutes");
    const rows = pressed(await press(c, o.quote, body(10_000, 30_000)));
    expect(rows[0]).toMatchObject({ outcome: "created", posted: true });
    expect(c.stripe.world.refundedOn(p.pi)).toBe(30_000); // the charge is whole; never above it
    expect(c.stripe.httpRequests("POST")).toBe(1);
  });
});
