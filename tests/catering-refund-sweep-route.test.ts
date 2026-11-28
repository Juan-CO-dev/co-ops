/**
 * GET /api/cron/catering-refund-sweep (plan section 6, [R1] [R10] [S10] [T6]): THE REAL ROUTE through THE REAL WORKER
 * (`runRefundSweep`, lib/catering/refund-observe.ts) and THE REAL SQL (PGlite, 0357 -> 0358 -> 0359) against the Stripe
 * HTTP fake. Nothing between them is mocked: the service-client factory hands the route the PGlite-backed client, and
 * Stripe's `fetch` is the fake. The heartbeat (`audit()`) is captured to be read. SYNTHETIC rows, fake keys, no network.
 *
 *   one invocation = exactly ONE claim (F13, made by the worker; the route never claims), at least one exact GET, the
 *     result recorded; a second invocation while the first is running answers `{ skipped: "busy" }` and makes no GET
 *   OBSERVE unset = `{ skipped }` with NO client created (the factory is never called), no claim, no heartbeat
 *   ON not recorded = `{ skipped: "observe_not_recorded" }`, no GET, no heartbeat
 *   slow class-A reads ahead of a day-100 `succeeded` refund, over repeated runs: the re-read goes first and the fake
 *     records the exact GET for that refund in the first run; after Stripe reverses it the mirror records the reversal
 *   the heartbeat carries COUNTS and no id; the pass-end stamp is written; a run killed before the end leaves its claim
 *     newer than the last finished pass [T6]
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

const h = vi.hoisted(() => ({
  sb: null as unknown,
  factory: vi.fn(),
  audit: vi.fn<(input: { action: string; metadata?: Record<string, unknown> }) => Promise<void>>(async () => {}),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.factory, createAuthedClient: h.factory }));
vi.mock("@/lib/audit", () => ({ audit: h.audit, auditChecked: async () => ({ ok: true }) }));

import { GET, maxDuration } from "@/app/api/cron/catering-refund-sweep/route";
import { harnessKit as kit, refundClient, refundDb, type KitPayment, type KitWorld, type RefundCall } from "./helpers/refund-pglite";
import { delay, stripeHttpFake, type StripeHttpFake } from "./stripe-http-fake";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

const SECRET = "test-only-refund-sweep-cron-secret";
const KEY = "sk_test_fake_refund_sweep_route_S1";

interface Ctx { db: PGlite; sb: SupabaseClient; calls: RefundCall[]; stripe: StripeHttpFake; w: KitWorld; quote: string }

async function setup({ observe = true } = {}): Promise<Ctx> {
  const db = await refundDb();
  const w = await kit.world(db);
  if (observe) await kit.observing(db);
  const calls: RefundCall[] = [];
  const sb = refundClient(db, { calls });
  const stripe = stripeHttpFake();
  stripe.account(KEY);
  vi.stubGlobal("fetch", stripe.fetch);
  h.sb = sb;
  return { db, sb, calls, stripe, w, quote: await w.quote() };
}
async function pay(c: Ctx, amount: number, quote = c.quote): Promise<KitPayment> {
  const p = await c.w.pay(quote, "full", amount);
  c.stripe.world.addPaymentIntent({ id: p.pi, account: KEY, chargeId: p.charge, amountCaptured: amount });
  return p;
}
const tick = (auth: string | null = `Bearer ${SECRET}`) =>
  GET(new NextRequest("http://localhost/api/cron/catering-refund-sweep", { headers: auth ? { authorization: auth } : {} }));
const rpc = (c: Ctx, name: string) => c.calls.filter((x) => x.kind === "rpc" && x.name === name);
const heartbeats = () => h.audit.mock.calls.map(([a]) => a).filter((a) => a.action === "cron.success" || a.action === "cron.failure");
const ID_SHAPED = /\b(pi|re|pyr|ch|py)_[A-Za-z0-9_]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

beforeEach(() => {
  h.factory.mockReset();
  h.factory.mockImplementation(() => h.sb);
  h.audit.mockClear();
  h.sb = null;
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("CATERING_SCAN_SECRET", "");
  vi.stubEnv("CATERING_REFUNDS_OBSERVE", "1");
  vi.stubEnv("CATERING_REFUNDS", "");
  vi.stubEnv("STRIPE_SECRET_KEY__S1", KEY);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET__S1", "whsec_fake_sweep_route_s1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the gates before any work", () => {
  it("maxDuration is 120; the route names no sender, no lease helper, no job registry, no watch, no mail", () => {
    expect(maxDuration).toBe(120);
    const src = readFileSync("app/api/cron/catering-refund-sweep/route.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const banned of ["createRefund", "requestRefund", "claimCronRoute", "cron-route-lease", "jobs-registry", "job-watch", "watchSiblings", "@/lib/email", "sendEmail", "notify"]) {
      expect([banned, src.includes(banned)]).toEqual([banned, false]);
    }
  });
  it("a missing or wrong secret is 401 before anything (no client, no heartbeat, no fetch)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const auth of [null, "Bearer wrong"]) expect((await tick(auth)).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await tick()).status).toBe(503);
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("OBSERVE unset: { skipped } with NO service client created, no claim, no heartbeat, no fetch (CATERING_REFUNDS alone changes nothing)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const refunds of ["", "1"]) {
      vi.stubEnv("CATERING_REFUNDS_OBSERVE", "");
      vi.stubEnv("CATERING_REFUNDS", refunds);
      const res = await tick();
      expect([res.status, await res.json()]).toEqual([200, { skipped: "observe_off" }]);
    }
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("observation ON but NOT recorded (no operator statement)", () => {
  it("{ skipped: observe_not_recorded }: F13 once, no GET, no state row, no heartbeat", async () => {
    const c = await setup({ observe: false });
    await pay(c, 1_000);
    const res = await tick();
    expect([res.status, await res.json()]).toEqual([200, { skipped: "observe_not_recorded" }]);
    expect(h.factory).toHaveBeenCalledTimes(1);
    expect(c.calls.map((x) => x.name)).toEqual(["catering_refund_sweep_begin"]);
    expect(c.stripe.calls).toHaveLength(0);
    expect((await c.db.query("select count(*)::int as n from public.catering_refund_payment_state")).rows[0]).toEqual({ n: 0 });
    expect(heartbeats()).toEqual([]);
  });
});

describe("one run, a concurrent run, the heartbeat and the pass-end stamp", () => {
  it("ONE claim, an exact GET, the result recorded; a run started meanwhile is busy and makes no GET; counts only; the pass end stamped; a killed run leaves its claim newer than the last finished pass", async () => {
    const c = await setup();
    const p = await pay(c, 8_000);
    const r = c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 1_500 });
    // The second invocation starts while the first is inside its reads (at its first Stripe request).
    let second: Promise<Response> | null = null;
    let getsBeforeSecond = -1;
    let getsAfterSecond = -1;
    c.stripe.onRequest = async () => {
      if (second) return;
      getsBeforeSecond = c.stripe.calls.length;
      second = tick();
      const res = await second;
      getsAfterSecond = c.stripe.calls.length;
      expect([res.status, await res.json()]).toEqual([200, { skipped: "busy" }]);
    };
    const res = await tick();
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; counts: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(second).not.toBeNull();
    expect(getsAfterSecond).toBe(getsBeforeSecond); // the busy run made no GET
    // Exactly one claim per invocation: two invocations, two F13 calls, ONE claimed.
    expect(rpc(c, "catering_refund_sweep_begin")).toHaveLength(2);
    expect(c.stripe.calls.filter((x) => x.method === "GET" && x.path === `/v1/refunds/${r.id}`)).toHaveLength(1);
    expect(c.stripe.httpRequests("POST")).toBe(0);
    expect(rpc(c, "catering_refund_record_read")).toHaveLength(1);
    expect((await kit.stateRow(c.db, p.id))?.last_attempt_result).toBe("complete");
    expect((await kit.mirror(c.db, p.id)).map((m) => m.refund_id)).toEqual([r.id]);
    // The heartbeat: ONE cron.success, counts only (the busy run wrote none).
    const beats = heartbeats();
    expect(beats.map((b) => b.action)).toEqual(["cron.success"]);
    const meta = beats[0]!.metadata!;
    expect(meta).toMatchObject({ job: "catering-refund-sweep", passes: 1, complete: 1, pass_end_stamped: true, bound: 0 });
    expect(Object.keys(meta).sort()).toEqual([
      "begin_failed", "bound", "cancelled_unarmed", "complete", "dirty", "gets", "ineligible", "job", "ledger_rows_read", "left_a", "left_c",
      "left_stale_unarmed", "never_read", "not_complete", "oldest_unchecked_at", "pass_end_stamped", "passes", "record_failed", "replaced",
      "resumed", "resumed_rows", "transitions", "unconfirmed"]);
    for (const text of [JSON.stringify(meta), JSON.stringify(body)]) {
      expect(text).not.toMatch(ID_SHAPED);
      for (const id of [p.id, p.pi, p.charge, r.id, c.quote]) expect(text).not.toContain(id);
      expect(text).not.toContain(KEY);
    }
    expect(body.counts).toEqual(meta);
    // [T6] the pass-end stamp.
    const obs1 = (await c.db.query<{ last_claim_at: Date; last_pass_ended_at: Date | null; last_pass_reads: number }>("select last_claim_at, last_pass_ended_at, last_pass_reads from public.catering_refund_observation")).rows[0]!;
    expect(obs1.last_pass_ended_at).not.toBeNull();
    expect(obs1.last_pass_reads).toBe(1);

    // A run that claims and is KILLED before its end (the process dies at F18): its claim is newer than the last
    // finished pass, which is exactly what the inventory page shows ("last claim" vs "last finished pass").
    await kit.elapse(c.db, "6 minutes"); // past the 330-second lease
    c.stripe.onRequest = null;
    h.audit.mockClear();
    const killed = refundClient(c.db, { calls: c.calls, rpc: { catering_refund_sweep_end: () => { throw new Error("the function instance was killed"); } } });
    h.sb = killed;
    const dead = await tick();
    expect([dead.status, ((await dead.json()) as { code: string }).code]).toEqual([500, "sweep_failed"]);
    expect(heartbeats().map((b) => [b.action, b.metadata])).toEqual([["cron.failure", { job: "catering-refund-sweep", error: "sweep_failed" }]]);
    const obs2 = (await c.db.query<{ last_claim_at: Date; last_pass_ended_at: Date }>("select last_claim_at, last_pass_ended_at from public.catering_refund_observation")).rows[0]!;
    expect(new Date(obs2.last_claim_at).getTime()).toBeGreaterThan(new Date(obs2.last_pass_ended_at).getTime());
    expect(new Date(obs2.last_pass_ended_at).getTime()).toBe(new Date(obs1.last_pass_ended_at!).getTime() - 6 * 60_000); // untouched (moved by elapse only)
  });
});

describe("[R10] the daily-window re-read is not starved by slow class-A reads, over repeated runs", () => {
  it("a day-100 `succeeded` refund: the re-read goes FIRST and the exact GET is made in the first run; Stripe reverses it; the next run's mirror records failed <- succeeded", async () => {
    const c = await setup();
    const pc = await pay(c, 20_000);
    const dayMs = 24 * 60 * 60 * 1000;
    const old = c.stripe.world.addRefund({ paymentIntentId: pc.pi, amount: 5_000, status: "succeeded", created: Math.floor((Date.now() - 100 * dayMs) / 1000) });
    await kit.backdate(c.db, "catering_payments", "paid_at", pc.id, "100 days");
    // Run 0 (setup): pc is never read (class A); it is read and becomes known.
    const r0 = await tick();
    expect(r0.status).toBe(200);
    expect((await kit.mirror(c.db, pc.id)).map((m) => [m.refund_id, m.status])).toEqual([[old.id, "succeeded"]]);

    // Slow class-A work arrives: three never-read payments whose PaymentIntent reads take 1.5 s each.
    const slow: KitPayment[] = [];
    for (let i = 0; i < 3; i++) slow.push(await pay(c, 1_000 + i, await c.w.quote()));
    const slowPis = new Set(slow.map((p) => p.pi));
    c.stripe.persist("payment_intent", delay(1_500), { match: (q) => slowPis.has(q.path.split("/").pop()!) });
    await kit.elapse(c.db, "46 minutes"); // pc's read is 46 minutes old: due again [T3]; the claim is still live

    // Run 1: the re-read of pc goes FIRST, ahead of the slow class-A reads; its exact GET of the day-100 refund is made.
    c.calls.length = 0;
    const firstStripe = c.stripe.calls.length;
    const r1 = await tick();
    expect(r1.status).toBe(200);
    const begins = rpc(c, "catering_refund_read_begin").map((x) => (x.args as { p_payment_id: string }).p_payment_id);
    expect(begins[0]).toBe(pc.id);
    expect(new Set(begins)).toEqual(new Set([pc.id, ...slow.map((p) => p.id)]));
    const run1 = c.stripe.calls.slice(firstStripe);
    expect(run1.filter((x) => x.method === "GET" && x.path === `/v1/refunds/${old.id}`)).toHaveLength(1);
    const firstSlow = run1.findIndex((x) => slowPis.has(x.path.split("/").pop()!));
    const exact = run1.findIndex((x) => x.path === `/v1/refunds/${old.id}`);
    expect(exact).toBeLessThan(firstSlow); // the re-read's exact GET came before any slow class-A request
    expect((await (await tick()).json()) as unknown).toEqual({ skipped: "busy" }); // and a tick inside the lease waits

    // Stripe reverses the refund (no webhook: B1 does not subscribe to refund.updated / refund.failed).
    c.stripe.world.setRefundStatus(old.id, "failed");
    await kit.elapse(c.db, "46 minutes");
    c.calls.length = 0;
    const r2 = await tick();
    expect(r2.status).toBe(200);
    expect(rpc(c, "catering_refund_read_begin").map((x) => (x.args as { p_payment_id: string }).p_payment_id)[0]).toBe(pc.id);
    const m = await kit.mirror(c.db, pc.id);
    expect(m.map((x) => [x.refund_id, x.status, x.previous_status])).toEqual([[old.id, "failed", "succeeded"]]);
    expect(c.stripe.httpRequests("POST")).toBe(0);
    for (const b of heartbeats()) expect(JSON.stringify(b.metadata)).not.toMatch(ID_SHAPED);
  });
});
