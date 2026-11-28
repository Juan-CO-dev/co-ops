/**
 * The READ and the sweep worker (lib/catering/refund-observe.ts, plan 3.2 + section 15) on the REAL SQL: PGlite with
 * the real 0357 -> 0358 -> 0359 (tests/helpers/refund-pglite.ts) under the REAL Stripe client over the HTTP fake
 * (tests/stripe-http-fake.ts). Nothing between them is mocked. SYNTHETIC rows and fake keys only; never a network
 * call. Every test asserts the read made ZERO POSTs.
 *
 * Plan names: the strict owner [R14] · list strictness [R16] · 41+ refunds with one unreadable id · a refund with no
 * PaymentIntent · F5 before the first GET · every provider failure reaches F6 with a named reason [R3] · the read
 * never POSTs · the fingerprint and the key [T5] · the sweep worker: one claim [R1], `s10_reads_before_cleanup`
 * [S10], C-then-A time sharing [R10], the pass-end stamp [T6], not claimed -> no GET.
 */
import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => {
    throw new Error("catering-refund-read.test: no real service client here");
  },
}));

import {
  credentialFingerprint,
  REFUND_READ_REASONS,
  RefundCredential,
  runRefundRead,
  runRefundSweep,
  type RefundReadOutcome,
} from "@/lib/catering/refund-observe";
import { harnessKit as kit, refundClient, refundDb, type KitPayment, type KitWorld, type RefundCall } from "./helpers/refund-pglite";
import { delay, malformed, networkError, status, stripeHttpFake, type StripeHttpFake } from "./stripe-http-fake";
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const KEY_LOC = "sk_test_fake_refund_read_location_S1";
const KEY_DEF = "sk_test_fake_refund_read_default";
const KEYS = [KEY_LOC, KEY_DEF];

interface Ctx {
  db: PGlite;
  sb: SupabaseClient;
  calls: RefundCall[];
  log: string[];
  stripe: StripeHttpFake;
  w: KitWorld;
  quote: string;
  /** A paid Stripe payment of the shop, known to `account` at Stripe. */
  pay: (amount: number, account?: string, opts?: { status?: string }) => Promise<KitPayment>;
}

type Slots = "both" | "location" | "default" | "same";
function setEnv(slots: Slots) {
  if (slots === "both" || slots === "location") {
    vi.stubEnv("STRIPE_SECRET_KEY__S1", KEY_LOC);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET__S1", "whsec_fake_loc");
  }
  if (slots === "both" || slots === "default") {
    vi.stubEnv("STRIPE_SECRET_KEY", KEY_DEF);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_fake_def");
  }
  if (slots === "same") {
    vi.stubEnv("STRIPE_SECRET_KEY__S1", KEY_LOC);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET__S1", "whsec_fake_same");
    vi.stubEnv("STRIPE_SECRET_KEY", KEY_LOC);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_fake_same");
  }
}

let consoleSeen: string[] = [];
beforeEach(() => {
  consoleSeen = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { consoleSeen.push(a.map((x) => (typeof x === "string" ? x : inspect(x))).join(" ")); });
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup({ slots = "both" as Slots, observe = true, partsReady = false, pageSize = 100 } = {}): Promise<Ctx> {
  setEnv(slots);
  const db = await refundDb({ partsReady });
  const w = await kit.world(db);
  if (observe) await kit.observing(db);
  const stripe = stripeHttpFake({ pageSize });
  for (const k of KEYS) stripe.account(k);
  vi.stubGlobal("fetch", stripe.fetch);
  const calls: RefundCall[] = [];
  const log: string[] = [];
  const sb = refundClient(db, { calls, onCall: (c) => { if (c.phase === "before") log.push(`${c.kind}:${c.name}`); } });
  stripe.onRequest = (c) => { log.push(`${c.method}:${c.path}`); };
  const quote = await w.quote();
  const pay = async (amount: number, account = KEY_LOC, opts: { status?: string } = {}) => {
    const p = await w.pay(quote, "full", amount, opts);
    stripe.world.addPaymentIntent({ id: p.pi, account, chargeId: p.charge, amountCaptured: amount });
    return p;
  };
  return { db, sb, calls, log, stripe, w, quote, pay };
}

const deadline = (ms = 20_000) => ({ deadlineMs: Date.now() + ms });
const rpcCalls = (c: Ctx, name: string) => c.calls.filter((x) => x.kind === "rpc" && x.name === name);
const noPosts = (c: Ctx) => expect(c.stripe.httpRequests("POST")).toBe(0);
const refundGets = (c: Ctx, id: string) => c.stripe.calls.filter((x) => x.method === "GET" && x.path === `/v1/refunds/${id}`).length;

/** The read ended not complete with `reason`, F6 was called exactly once with it, the payment is not known. */
async function expectNotComplete(c: Ctx, p: KitPayment, out: RefundReadOutcome, reason: string) {
  expect(out.result).toBe("not_complete");
  expect(out.reason).toBe(reason);
  expect(out.readToken).toBeNull();
  const rec = rpcCalls(c, "catering_refund_record_read");
  expect(rec).toHaveLength(1);
  expect((rec[0]!.args as Record<string, unknown>).p_result).toBe(reason);
  const st = await kit.stateRow(c.db, p.id);
  expect(st?.last_attempt_result).toBe(reason);
  expect(st?.open_read_id).toBeNull();
  expect((await kit.figures(c.db, p.id)).known).toBe(false);
  noPosts(c);
}

describe("a complete read", () => {
  it("F5 BEFORE the first GET, both lists, one retrieve per id, ONE F6: complete with a token; never a POST", async () => {
    const c = await setup();
    const p = await c.pay(30_000);
    const r = c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 1_000 });
    const out = await runRefundRead(c.sb, p.id, deadline());
    expect(out.result).toBe("complete");
    expect(out.readToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.owner).toMatchObject({ paymentIntentId: p.pi, chargeId: p.charge, currency: "usd", livemode: false, capturedCents: 30_000 });
    // The order: F5, then GETs only, then exactly one F6.
    expect(c.log[0]).toBe("rpc:catering_refund_read_begin");
    const firstGet = c.log.findIndex((x) => x.startsWith("GET:"));
    expect(firstGet).toBeGreaterThan(0);
    expect(c.log.slice(firstGet).filter((x) => x.startsWith("rpc:"))).toEqual(["rpc:catering_refund_record_read"]);
    expect(c.log.filter((x) => x.startsWith("rpc:catering_refund_record_read"))).toHaveLength(1);
    expect(c.stripe.calls.filter((x) => x.path === "/v1/refunds").map((x) => x.query).sort()).toEqual(
      [`?charge=${p.charge}&limit=100`, `?payment_intent=${p.pi}&limit=100`]);
    // The same id in both lists is normal: retrieved ONCE [R16].
    expect(refundGets(c, r.id)).toBe(1);
    const args = rpcCalls(c, "catering_refund_record_read")[0]!.args as Record<string, unknown>;
    expect(args.p_lists).toEqual([
      { by: "payment_intent", terminal: true, ids: [r.id] },
      { by: "charge", terminal: true, ids: [r.id] },
    ]);
    expect(args.p_refunds).toEqual([{ id: r.id, amount: 1_000, currency: "usd", payment_intent: p.pi, charge: p.charge, status: "succeeded", created: r.created, request_id: null }]);
    expect(args.p_owner).toEqual({ payment_intent: p.pi, charge: p.charge, currency: "usd", livemode: false, captured: 30_000, account_slot: "location", credential_fp: credentialFingerprint(KEY_LOC) });
    expect((await kit.mirror(c.db, p.id)).map((m) => m.refund_id)).toEqual([r.id]);
    expect(await kit.figures(c.db, p.id)).toMatchObject({ known: true, captured: 30_000, counted: 1_000, refundable: 29_000 });
    noPosts(c);
  });

  it("a refund with NO PaymentIntent is found by the charge list, mirrored and counted", async () => {
    const c = await setup();
    const p = await c.pay(10_000);
    const orphan = c.stripe.world.addRefund({ paymentIntentId: null, chargeId: p.charge, amount: 2_500 });
    const out = await runRefundRead(c.sb, p.id, deadline());
    expect(out.result).toBe("complete");
    const args = rpcCalls(c, "catering_refund_record_read")[0]!.args as { p_lists: Array<{ by: string; ids: string[] }> };
    expect(args.p_lists.find((l) => l.by === "payment_intent")!.ids).toEqual([]);
    expect(args.p_lists.find((l) => l.by === "charge")!.ids).toEqual([orphan.id]);
    const m = await kit.mirror(c.db, p.id);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ refund_id: orphan.id, payment_intent_id: null, charge_id: p.charge });
    expect((await kit.figures(c.db, p.id)).refundable).toBe(7_500);
    noPosts(c);
  });

  it("an id already MIRRORED and no longer listed is retrieved again (and a failure there is not complete)", async () => {
    const c = await setup();
    const p = await c.pay(10_000);
    const r = c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 500 });
    expect((await runRefundRead(c.sb, p.id, deadline())).result).toBe("complete");
    // Stripe's lists no longer show it (UNVERIFIED list consistency): the mirror still names it.
    c.stripe.persist("list", status(200, { object: "list", data: [], has_more: false }));
    c.calls.length = 0;
    const again = await runRefundRead(c.sb, p.id, deadline());
    expect(again.result).toBe("complete");
    expect(refundGets(c, r.id)).toBe(2);
    c.stripe.script("refund", status(404), { match: (q) => q.path.endsWith(r.id) });
    c.calls.length = 0;
    await expectNotComplete(c, p, await runRefundRead(c.sb, p.id, deadline()), "retrieve_not_found");
  });
});

describe("the strict owner [R14]", () => {
  it("one account UNREACHABLE beside one that knows the payment = not complete (owner_unreachable)", async () => {
    const c = await setup({ slots: "both" });
    const p = await c.pay(20_000, KEY_LOC);
    c.stripe.down.add(KEY_DEF);
    const out = await runRefundRead(c.sb, p.id, deadline());
    await expectNotComplete(c, p, out, "owner_unreachable");
    expect(out.owner).toBeNull();
    // No list was asked once the owner could not be proven.
    expect(c.stripe.calls.filter((x) => x.path === "/v1/refunds")).toHaveLength(0);
  });

  it("two accounts know it and differ ONLY in the captured amount = owner_conflict", async () => {
    const c = await setup({ slots: "both" });
    const p = await c.pay(20_000, KEY_LOC);
    const body = c.stripe.world.paymentIntentBody(c.stripe.world.paymentIntents.get(p.pi)!);
    const charge = body.latest_charge as Record<string, unknown>;
    c.stripe.persist("payment_intent", status(200, { ...body, latest_charge: { ...charge, amount_captured: 19_999 } }), { account: KEY_DEF });
    await expectNotComplete(c, p, await runRefundRead(c.sb, p.id, deadline()), "owner_conflict");
  });

  it("two accounts that agree on charge, currency, mode and captured amount resolve through the shop's own", async () => {
    const c = await setup({ slots: "both" });
    const p = await c.pay(20_000, KEY_LOC);
    const body = c.stripe.world.paymentIntentBody(c.stripe.world.paymentIntents.get(p.pi)!);
    c.stripe.persist("payment_intent", status(200, body), { account: KEY_DEF });
    const out = await runRefundRead(c.sb, p.id, deadline());
    expect(out.result).toBe("complete");
    expect(out.owner!.credential.slot).toBe("location");
  });

  it("every account answers 404 = owner_indeterminate", async () => {
    const c = await setup({ slots: "both" });
    const p = await c.w.pay(c.quote, "full", 5_000); // known to no account
    await expectNotComplete(c, p, await runRefundRead(c.sb, p.id, deadline()), "owner_indeterminate");
  });

  it("ONE key configured in BOTH slots is one credential: asked once, reported as the shop's own slot, complete", async () => {
    const c = await setup({ slots: "same" });
    const p = await c.pay(8_000, KEY_LOC);
    const out = await runRefundRead(c.sb, p.id, deadline());
    expect(out.result).toBe("complete");
    expect(out.owner!.credential.slot).toBe("location");
    expect(c.stripe.calls.filter((x) => x.path.startsWith("/v1/payment_intents/"))).toHaveLength(1);
    expect((await kit.stateRow(c.db, p.id))?.account_slot).toBe("location");
  });

  it("only the shared account configured: the slot is `default`", async () => {
    const c = await setup({ slots: "default" });
    const p = await c.pay(8_000, KEY_DEF);
    const out = await runRefundRead(c.sb, p.id, deadline());
    expect(out.result).toBe("complete");
    expect(out.owner!.credential.slot).toBe("default");
  });

  it("no credential at all = no_credentials (recorded)", async () => {
    const c = await setup({ slots: "both" });
    const p = await c.pay(8_000, KEY_LOC);
    vi.unstubAllEnvs();
    await expectNotComplete(c, p, await runRefundRead(c.sb, p.id, deadline()), "no_credentials");
  });
});

describe("list strictness", () => {
  it("a repeated id INSIDE one list (across its pages) = not complete (list_repeated_id)", async () => {
    const c = await setup({ pageSize: 1 });
    const p = await c.pay(9_000);
    const r1 = c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 100 });
    const r2 = c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 200 });
    // Page 2 of the PaymentIntent list repeats page 1's id (r2, newest) beside r1.
    c.stripe.script("list", status(200, { object: "list", data: [c.stripe.world.refundBody(r2), c.stripe.world.refundBody(r1)], has_more: false }),
      { match: (q) => q.query.includes("payment_intent=") && q.query.includes("starting_after=") });
    await expectNotComplete(c, p, await runRefundRead(c.sb, p.id, deadline()), "list_repeated_id");
  });

  it("the same id in BOTH lists is normal: united and retrieved once", async () => {
    const c = await setup({ pageSize: 2 });
    const p = await c.pay(9_000);
    const ids = [1, 2, 3, 4, 5].map((i) => c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: i * 10 }).id);
    const out = await runRefundRead(c.sb, p.id, deadline());
    expect(out.result).toBe("complete");
    for (const id of ids) expect(refundGets(c, id), id).toBe(1);
    noPosts(c);
  });

  it("more than 20 pages of one list = list_too_long", async () => {
    const c = await setup({ pageSize: 1 });
    const p = await c.pay(90_000);
    for (let i = 0; i < 22; i++) c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 10 + i });
    await expectNotComplete(c, p, await runRefundRead(c.sb, p.id, deadline(60_000)), "list_too_long");
  });

  it("an id 0359 does not store (an unknown prefix) is never handed over: refund_id_unrecognised", async () => {
    const c = await setup();
    const p = await c.pay(9_000);
    c.stripe.world.addRefund({ id: "zzr_fake_opaque_1", paymentIntentId: p.pi, amount: 10 });
    const out = await runRefundRead(c.sb, p.id, deadline());
    await expectNotComplete(c, p, out, "refund_id_unrecognised");
    const args = rpcCalls(c, "catering_refund_record_read")[0]!.args as { p_lists: Array<{ ids: string[] }> };
    expect(args.p_lists.flatMap((l) => l.ids)).not.toContain("zzr_fake_opaque_1");
  });
});

describe("41+ refunds with one unreadable id, from a KNOWN payment", () => {
  it("not complete (retrieve_not_found), the figures go away, every other id is mirrored", async () => {
    const c = await setup();
    const p = await c.pay(900_000);
    const refunds = Array.from({ length: 45 }, (_, i) => c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 100 + i }));
    expect((await runRefundRead(c.sb, p.id, deadline(60_000))).result).toBe("complete");
    await kit.elapse(c.db, "6 minutes");
    expect((await kit.figures(c.db, p.id)).known).toBe(true);
    const bad = refunds[17]!.id;
    c.stripe.script("refund", status(404), { match: (q) => q.path === `/v1/refunds/${bad}` });
    c.calls.length = 0;
    const out = await runRefundRead(c.sb, p.id, deadline(60_000));
    await expectNotComplete(c, p, out, "retrieve_not_found");
    const handed = (rpcCalls(c, "catering_refund_record_read")[0]!.args as { p_refunds: Array<{ id: string }> }).p_refunds.map((r) => r.id);
    expect(handed.length).toBeLessThan(45); // retrieves stop at the first batch that fails: the read is not complete anyway
    expect(handed).not.toContain(bad);
    expect(await kit.mirror(c.db, p.id)).toHaveLength(45);
  });
});

describe("every provider failure still reaches F6 with a named reason [R3]", () => {
  type Case = [string, (c: Ctx, p: KitPayment) => void, string, number?];
  const cases: Case[] = [
    ["the owner read answers 503", (c) => c.stripe.persist("payment_intent", status(503)), "owner_unreachable"],
    ["the owner read times out", (c) => c.stripe.persist("payment_intent", delay(5_000)), "owner_unreachable", 2_500],
    ["the owner read drops the connection", (c) => c.stripe.persist("payment_intent", networkError()), "owner_unreachable"],
    ["the owner answer has no captured amount", (c) => c.stripe.persist("payment_intent", malformed("pi_charge_unexpanded")), "owner_malformed"],
    ["the owner answer names another PaymentIntent", (c) => c.stripe.persist("payment_intent", malformed("pi_other_id")), "owner_unreachable"],
    ["a list answers 500", (c) => c.stripe.persist("list", status(500), { match: (q) => q.query.includes("charge=") }), "list_failed"],
    ["a list is malformed", (c) => c.stripe.persist("list", malformed("no_data_array")), "list_malformed"],
    ["a retrieve is refused (401)", (c) => c.stripe.persist("refund", status(401)), "retrieve_denied"],
    ["a retrieve answers 500", (c) => c.stripe.persist("refund", status(500)), "retrieve_failed"],
    ["a retrieve is malformed", (c) => c.stripe.persist("refund", malformed("refund_missing_amount")), "retrieve_malformed"],
    ["a retrieve times out", (c) => c.stripe.persist("refund", delay(5_000)), "retrieve_failed", 3_000],
    ["no time left before the first GET", () => {}, "deadline_exhausted", 100],
  ];
  it.each(cases)("%s -> %s", async (_name, arrange, reason, ms) => {
    const c = await setup({ slots: "location" });
    const p = await c.pay(10_000);
    c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 300 });
    arrange(c, p);
    expect(REFUND_READ_REASONS as readonly string[]).toContain(reason);
    const out = await runRefundRead(c.sb, p.id, deadline(ms ?? 20_000));
    await expectNotComplete(c, p, out, reason);
    expect(rpcCalls(c, "catering_refund_read_begin")).toHaveLength(1);
  });

  it("a replaced read hands over nothing, answers read_replaced, and the payment is not known [T2]", async () => {
    const c = await setup();
    const p = await c.pay(10_000);
    // A second begin lands between this read's F5 and its F6.
    c.stripe.onRequest = async (call) => {
      if (call.path.startsWith("/v1/payment_intents/") && rpcCalls(c, "catering_refund_read_begin").length === 1) {
        c.stripe.onRequest = null;
        await kit.begin(c.db, p.id);
      }
    };
    const out = await runRefundRead(c.sb, p.id, deadline());
    expect(out.result).toBe("read_replaced");
    expect(out.readToken).toBeNull();
    expect((await kit.stateRow(c.db, p.id))?.last_attempt_result).toBe("read_replaced");
    expect((await kit.figures(c.db, p.id)).known).toBe(false);
    noPosts(c);
  });

  it("an ineligible payment is not read at all (F5 answers eligible: false; no GET, no F6)", async () => {
    const c = await setup();
    const due = await c.w.pay(c.quote, "balance", 5_000, { status: "due" });
    const out = await runRefundRead(c.sb, due.id, deadline());
    expect(out.result).toBe("ineligible");
    expect(c.stripe.calls).toHaveLength(0);
    expect(rpcCalls(c, "catering_refund_record_read")).toHaveLength(0);
  });

  it("a missing schema is refunds_unavailable (thrown), never a fallback", async () => {
    const c = await setup();
    const p = await c.pay(1_000);
    const sb = refundClient(c.db, { rpc: { catering_refund_read_begin: () => ({ data: null, error: { code: "42883", message: "function does not exist" } }) } });
    await expect(runRefundRead(sb, p.id, deadline())).rejects.toMatchObject({ name: "RefundsUnavailableError", message: "refunds_unavailable" });
    expect(c.stripe.calls).toHaveLength(0);
  });
});

describe("the credential fingerprint and the key [T5]", () => {
  it("16 hex characters of sha256(prefix + key); deterministic; one per key", () => {
    const fp = credentialFingerprint(KEY_LOC);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(fp).toBe(createHash("sha256").update("co-ops:catering-refund:credential:v1\n" + KEY_LOC).digest("hex").slice(0, 16));
    expect(credentialFingerprint(KEY_DEF)).not.toBe(fp);
    expect(fp).not.toContain(KEY_LOC.slice(-6));
  });

  it("the key is in no RPC argument, no log line, no serialized or inspected outcome, no thrown message", async () => {
    const c = await setup({ slots: "both" });
    const p = await c.pay(10_000, KEY_LOC);
    c.stripe.world.addRefund({ paymentIntentId: p.pi, amount: 100 });
    const ok = await runRefundRead(c.sb, p.id, deadline());
    c.stripe.down.add(KEY_DEF);
    const bad = await runRefundRead(c.sb, p.id, deadline());
    const cred = new RefundCredential({ secretKey: KEY_LOC, source: "location" });
    const surfaces = [
      JSON.stringify(c.calls),
      JSON.stringify(ok), JSON.stringify(bad), inspect(ok, { depth: 10 }), inspect(bad, { depth: 10 }),
      JSON.stringify(cred), inspect(cred), String(cred), `${cred}`,
      consoleSeen.join("\n"),
      JSON.stringify(await kit.stateRow(c.db, p.id)),
    ];
    for (const s of surfaces) for (const k of KEYS) expect(s).not.toContain(k);
    expect(JSON.stringify(ok.owner)).toContain(credentialFingerprint(KEY_LOC));
    expect((await kit.stateRow(c.db, p.id))?.credential_fp).toBe(credentialFingerprint(KEY_LOC));
    expect(cred.secretKey()).toBe(KEY_LOC);
    // A schema refusal's message names the function, never the key.
    const sb = refundClient(c.db, { rpc: { catering_refund_record_read: () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) } });
    const err = await runRefundRead(sb, p.id, deadline()).then(() => null, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    for (const k of KEYS) expect(`${err!.message} ${err!.stack ?? ""}`).not.toContain(k);
  });
});

describe("the sweep worker", () => {
  it("observation not recorded: not claimed, NO GET, F13 once and nothing else", async () => {
    const c = await setup({ observe: false });
    await c.pay(1_000);
    const out = await runRefundSweep(c.sb, deadline());
    expect(out).toMatchObject({ claimed: false, reason: "observe_not_recorded", passes: 0, passEndStamped: false });
    expect(c.stripe.calls).toHaveLength(0);
    expect(c.calls.map((x) => x.name)).toEqual(["catering_refund_sweep_begin"]);
  });

  it("one claim per run; a second run inside the lease is `busy` and makes no GET; counts only, never an id", async () => {
    const c = await setup();
    const p = await c.pay(4_000);
    const first = await runRefundSweep(c.sb, deadline(30_000));
    expect(first).toMatchObject({ claimed: true, passes: 1, complete: 1, passEndStamped: true });
    expect(rpcCalls(c, "catering_refund_sweep_begin")).toHaveLength(1);
    const gets = c.stripe.calls.length;
    const second = await runRefundSweep(c.sb, deadline(30_000));
    expect(second).toMatchObject({ claimed: false, reason: "busy", passes: 0 });
    expect(c.stripe.calls).toHaveLength(gets);
    const text = JSON.stringify([first, second]);
    expect(text).not.toContain(p.id);
    expect(text).not.toContain(p.pi);
    noPosts(c);
  });

  it("s10_reads_before_cleanup: F13 -> the reads -> F11 for each stale unarmed row -> F18; and F11 waits for time", async () => {
    const c = await setup({ partsReady: true });
    const gm = await c.w.user("gm");
    const p1 = await c.pay(6_000);
    await kit.press(c.db, { actor: gm, quoteId: c.quote, amount: 6_000, seen: 6_000, payments: [p1] });
    const q2 = await c.w.quote();
    const p2 = await c.w.pay(q2, "full", 3_000);
    c.stripe.world.addPaymentIntent({ id: p2.pi, account: KEY_LOC, chargeId: p2.charge, amountCaptured: 3_000 });
    await kit.elapse(c.db, "16 minutes");
    const out = await runRefundSweep(c.sb, deadline(30_000));
    expect(out).toMatchObject({ claimed: true, cancelledUnarmed: 1, passEndStamped: true });
    expect(out.passes).toBeGreaterThanOrEqual(1);
    const order = c.calls.filter((x) => x.kind === "rpc").map((x) => x.name);
    const lastRead = order.lastIndexOf("catering_refund_record_read");
    const cancel = order.indexOf("catering_refund_cancel_unarmed");
    expect(order[0]).toBe("catering_refund_sweep_begin");
    expect(lastRead).toBeGreaterThan(0);
    expect(cancel).toBeGreaterThan(lastRead);
    expect(order.at(-1)).toBe("catering_refund_sweep_end");
    const req = await harnessLibRow(c.db, "select status, last_error_code from public.catering_refund_requests where payment_id = $1", [p1.id]);
    expect(req).toMatchObject({ status: "failed", last_error_code: "never_sent" });
    noPosts(c);
  });

  it("[S10] no F11 starts without its own budget left; F18 is still stamped", async () => {
    const c = await setup({ partsReady: true });
    const gm = await c.w.user("gm");
    const p1 = await c.pay(6_000);
    await kit.press(c.db, { actor: gm, quoteId: c.quote, amount: 6_000, seen: 6_000, payments: [p1] });
    await kit.elapse(c.db, "16 minutes");
    const out = await runRefundSweep(c.sb, { deadlineMs: Date.now() + 2_000, cancelBudgetMs: 10_000 });
    expect(out).toMatchObject({ claimed: true, cancelledUnarmed: 0, leftStaleUnarmed: 1, passEndStamped: true });
    expect(rpcCalls(c, "catering_refund_cancel_unarmed")).toHaveLength(0);
    expect(rpcCalls(c, "catering_refund_sweep_end")).toHaveLength(1);
  });

  it("C then A by TIME [R10]: slow class-A reads still leave a re-read its turn, first; [T6] the pass end carries the counts", async () => {
    const c = await setup();
    const pc = await c.pay(5_000);
    expect((await runRefundRead(c.sb, pc.id, deadline())).result).toBe("complete");
    const as: KitPayment[] = [];
    for (let i = 0; i < 3; i++) {
      const q = await c.w.quote();
      const p = await c.w.pay(q, "full", 1_000 + i);
      c.stripe.world.addPaymentIntent({ id: p.pi, account: KEY_LOC, chargeId: p.charge, amountCaptured: 1_000 + i });
      as.push(p);
    }
    await kit.elapse(c.db, "46 minutes"); // pc's read is 46 minutes old (due hourly [T3]); the claim is 56 minutes old (live)
    const slow = new Set(as.map((p) => p.pi));
    c.stripe.persist("payment_intent", delay(1_500), { match: (q) => slow.has(q.path.split("/").pop()!) });
    c.calls.length = 0;
    // 4 s in all; a read starts only while 3 s are left: the re-read (fast), then ONE slow class-A read, then no time.
    const out = await runRefundSweep(c.sb, { deadlineMs: Date.now() + 4_000, readBudgetMs: 3_800, minLeftMs: 3_000 });
    expect(out.claimed).toBe(true);
    expect(out.resumed).toBe(false);
    const begins = rpcCalls(c, "catering_refund_read_begin").map((x) => (x.args as { p_payment_id: string }).p_payment_id);
    expect(begins[0]).toBe(pc.id); // the re-read goes FIRST
    expect(begins).toHaveLength(2);
    expect(out.leftA).toBe(2);
    expect(out.leftC).toBe(0);
    const obs = await harnessLibRow(c.db, "select last_pass_reads, last_pass_complete, last_pass_ended_at from public.catering_refund_observation", []);
    expect(obs.last_pass_reads).toBe(out.passes);
    expect(obs.last_pass_complete).toBe(out.complete);
    expect(obs.last_pass_ended_at).not.toBeNull();
    expect(out.passEndStamped).toBe(true);
    noPosts(c);
  });
});

async function harnessLibRow(db: PGlite, sql: string, params: unknown[]): Promise<Record<string, unknown>> {
  return (await db.query<Record<string, unknown>>(sql, params)).rows[0] ?? {};
}
