/**
 * Catering refunds Part B1 — the webhook's ON ingress and settlement, the rollback handoff to main, over the REAL
 * webhook module (lib/stripe/webhook.ts) and the REAL route handler (app/api/webhooks/stripe/_handler.ts) on the
 * REAL SQL (PGlite: 0357 -> 0358 -> 0359, tests/helpers/refund-pglite.ts) as `service_role`.
 *
 * Plan B1.3 (Webhook / Settlement and recovery), Activation 6-7, "Rollback proof"; addendum A2, Opus P3 (a).
 *
 * "Stripe is down": EVERY function export of `@/lib/stripe/client` throws and records the call, except
 * `stripeCredentialsFor` (a configuration read the route's signature check needs: it returns a fixture pair, never
 * a real key). Signed deliveries are signed here with a fixture-only webhook secret. No network, no email, synthetic
 * rows only.
 */
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PGliteInterface as PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { harnessKit, harnessLib, refundClient, refundDb, type KitWorld, type RefundClientOpts } from "./helpers/refund-pglite";

const h = vi.hoisted(() => ({
  client: null as unknown,
  stripeCalls: [] as string[],
  /** The current test's ordered call log (table calls + RPCs from the client, plus `audit` / `notify` markers). */
  log: null as null | Array<{ kind: string; name: string; args?: unknown }>,
}));
const WEBHOOK_SECRET = "whsec_fixture_only_not_a_real_secret";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.client }));
vi.mock("@/lib/portal/rate-limit", () => ({ checkAndRecord: vi.fn(async () => true) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ id: "email_fixture" })), teamFrom: () => "Team <team@example.com>" }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (input: { action: string }) => {
    h.log?.push({ kind: "audit", name: input.action });
  }),
}));
vi.mock("@/lib/stripe/client", async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(real)) {
    // Classes / constants (StripeError, REFUND_EVIDENCE_MALFORMED, ...) stay; every function is "Stripe is down".
    out[k] = typeof v === "function" && !/^[A-Z]/.test(k)
      ? (..._a: unknown[]) => {
          h.stripeCalls.push(k);
          throw new Error(`Stripe is down (${k})`);
        }
      : v;
  }
  out.stripeCredentialsFor = () => ({ secretKey: "sk_test_fixture_only", webhookSecret: WEBHOOK_SECRET, source: "default" });
  return out;
});

import { audit } from "@/lib/audit";
import { handleStripeWebhook } from "@/app/api/webhooks/stripe/_handler";
import { parseRefundIngress, REFUND_INGRESS_TYPES } from "@/lib/stripe/shared";
import { isRetryableLedgerOutcome, isRetryableResult, processStripeEvent, type NotifyPaidArgs, type StripeProcessingResult } from "@/lib/stripe/webhook";
import { loadCustomerAccount } from "@/lib/portal/account";
import { loadCateringFacts } from "@/lib/report-digests";

const auditMock = vi.mocked(audit);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SINGLE = { locationId: null, locationCode: null };
const now = () => Math.floor(Date.now() / 1000);

type Calls = NonNullable<RefundClientOpts["calls"]>;
/** The client's own calls plus the audit / notify marks this suite pushes into the same ordered log. */
type LogEntry = { kind: string; name: string; args?: unknown };

let BASE: PGlite;
beforeAll(async () => {
  BASE = await refundDb();
}, 120_000);

interface T {
  db: PGlite;
  w: KitWorld;
  calls: Calls;
  sb: ReturnType<typeof refundClient>;
}
let t: T | null = null;

/**
 * PRODUCTION'S service_role PRIVILEGES ON MAIN'S TABLES. The offline base (scripts/sql-harness-0359-lib.mjs) copies
 * only the CREATE TABLE of the main-era tables, so service_role holds nothing on them there; on Supabase it holds the
 * platform's default grants (ALL) on them, and 0333 narrows its own table to SELECT + INSERT (0333:217-218). The
 * webhook runs as service_role, so the fixture owner restores exactly that before any test runs. 0359's own tables
 * are left as 0359 left them.
 */
async function productionGrants(db: PGlite): Promise<void> {
  await db.exec(`grant all on public.stripe_events, public.catering_payments, public.catering_quotes, public.locations,
                   public.catering_customers, public.catering_pipeline, public.users, public.user_locations, public.audit_log to service_role;
                 grant usage on all sequences in schema public to service_role;
                 revoke all on public.catering_payment_refund_events from service_role;
                 grant select, insert on public.catering_payment_refund_events to service_role;`);
}

async function setup(opts: { db?: PGlite; rpc?: RefundClientOpts["rpc"] } = {}): Promise<T> {
  const db = opts.db ?? (await BASE.clone());
  await productionGrants(db);
  const w = await harnessKit.world(db);
  const calls: Calls = [];
  h.log = calls as Array<{ kind: string; name: string; args?: unknown }>;
  const sb = refundClient(db, { calls, rpc: opts.rpc });
  h.client = sb;
  const made: T = { db, w, calls, sb };
  t = made;
  return made;
}

beforeEach(() => {
  process.env.CATERING_REFUNDS = "1";
  h.stripeCalls = [];
  auditMock.mockClear();
});
afterEach(async () => {
  delete process.env.CATERING_REFUNDS;
  await t?.db.close().catch(() => {});
  t = null;
  h.log = null;
});

// ── Signed deliveries ──────────────────────────────────────────────────────────────────────────────────
async function deliver(event: unknown, locationCode: string | null = null): Promise<{ status: number; body: Record<string, unknown> }> {
  const raw = JSON.stringify(event);
  const ts = now();
  const sig = createHmac("sha256", WEBHOOK_SECRET).update(`${ts}.${raw}`).digest("hex");
  const req = new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body: raw,
    headers: { "stripe-signature": `t=${ts},v1=${sig}`, "content-type": "application/json" },
  });
  const res = await handleStripeWebhook(req, locationCode);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let evtN = 0;
const evId = () => `evt_ing${++evtN}_${randomUUID().slice(0, 8)}`;

function chargeRefunded(o: { pi: string | null; cumulative?: number | null; amount?: number; full?: boolean | null; expanded?: boolean; embedded?: Array<{ id: string; status: string }> | null; id?: string; created?: number | null; charge?: string }) {
  const ch = o.charge ?? `ch_${(o.pi ?? "none").slice(3)}`;
  const object: Record<string, unknown> = {
    id: ch,
    object: "charge",
    payment_intent: o.pi === null ? null : o.expanded ? { id: o.pi, object: "payment_intent" } : o.pi,
    amount: o.amount ?? 30000,
    ...(o.cumulative === null ? {} : { amount_refunded: o.cumulative ?? 100 }),
    ...(o.full === null ? {} : { refunded: o.full ?? false }),
    ...(o.embedded ? { refunds: { object: "list", data: o.embedded.map((r) => ({ ...r, object: "refund" })) } } : {}),
  };
  return { id: o.id ?? evId(), object: "event", type: "charge.refunded", livemode: false, ...(o.created === null ? {} : { created: o.created ?? now() - 30 }), data: { object } };
}
function refundObjectEvent(type: string, o: { pi: string; refundId: string; status?: string; expanded?: boolean; id?: string; charge?: string }) {
  const ch = o.charge ?? `ch_${o.pi.slice(3)}`;
  return {
    id: o.id ?? evId(), object: "event", type, livemode: false, created: now() - 20,
    data: { object: { id: o.refundId, object: "refund", status: o.status ?? "pending", amount: 100,
      payment_intent: o.expanded ? { id: o.pi, object: "payment_intent" } : o.pi,
      charge: o.expanded ? { id: ch, object: "charge" } : ch } },
  };
}
function checkoutCompleted(o: { paymentId: string; quoteId: string; pi: string; amount: number; session?: string; id?: string }) {
  return {
    id: o.id ?? evId(), object: "event", type: "checkout.session.completed", livemode: false, created: now() - 5,
    data: { object: { id: o.session ?? `cs_${randomUUID().slice(0, 8)}`, object: "checkout.session", payment_status: "paid",
      payment_intent: o.pi, amount_total: o.amount, metadata: { quote_id: o.quoteId, payment_id: o.paymentId, kind: "deposit" } } },
  };
}

const ledger = async (db: PGlite, id: string): Promise<string | null> =>
  ((await harnessLib.one(db, "select outcome from public.stripe_events where id = $1", [id]))?.outcome as string | null | undefined) ?? null;
const payRow = (db: PGlite, id: string) => harnessLib.one(db, "select status, provider_ref, settlement_cleanup_at from public.catering_payments where id = $1", [id]);
const work = (db: PGlite, id: string) => harnessLib.one(db, "select state, floor_state, floor_cents::int as floor_cents, payment_id, restamped_at from public.catering_refund_event_work where event_id = $1", [id]);
const history = (db: PGlite, paymentId: string) => harnessLib.count(db, "select count(*) n from public.catering_payment_refund_events where payment_id = $1", [paymentId]);
const paymentWrites = (calls: Calls) => calls.filter((c) => c.kind === "update" && c.name === "catering_payments");
const legacyRefundAudits = () => auditMock.mock.calls.filter((c) => (c[0] as { action: string }).action === "catering.payment.provider_refunded");
const drain = async (db: PGlite) => {
  const st = await harnessKit.rpc(db, "catering_refund_epoch_state", [harnessLib.CALLER]);
  const d = await harnessKit.rpc(db, "catering_refund_start_drain", [st.epoch_id, st.generation, "cc"]);
  return { epoch: st.epoch_id as string, generation: d.generation as number };
};
const finishDrain = (db: PGlite, d: { epoch: string; generation: number }) => harnessKit.rpc(db, "catering_refund_finish_drain", [d.epoch, d.generation, "cc"]);
/** The kit's stateful Stripe stand-in and its one discovery pass (the same objects harnessKit wraps). */
interface FakeStripeLike {
  charge(pi: string, o?: { captured?: number }): unknown;
  refund(pi: string, amount: number, status: string, o?: { id?: string; created?: number }): string;
}
const kit = harnessKit as unknown as {
  FakeStripe: new () => FakeStripeLike;
  pass(db: PGlite, paymentId: string, stripe: FakeStripeLike): Promise<{ result: string; payment_status?: string }>;
};
const etDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("refund ingress with CATERING_REFUNDS ON", () => {
  it("refund_burst_provider_down_checkout_still_settles: 50 refund events while Stripe is down all answer refund_state_owed (2xx), durable work, zero Stripe calls; checkouts inside the burst settle, a failed DB attach holds the marker open and the redelivery attaches report-before-marker", async () => {
    let attachFailures = 1;
    let failFor: string | null = null;
    const x = await setup({
      rpc: {
        catering_refund_settlement_attach: (args) => {
          if (attachFailures > 0 && args.p_payment_id === failFor) {
            attachFailures -= 1;
            return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
          }
          return undefined;
        },
      },
    });
    const q1 = await x.w.quote();
    const p1 = await x.w.pay(q1, "deposit", 30000); // settled, carries its PaymentIntent
    const q2 = await x.w.quote();
    const p2 = await x.w.pay(q2, "deposit", 20000, { status: "due" }); // an ordinary checkout lands mid-burst
    const q3 = await x.w.quote();
    const p3 = await x.w.pay(q3, "deposit", 25000, { status: "due" }); // its refund is seen FIRST
    failFor = p3.id; // its FIRST database attachment fails
    // Each quote asks for the deposit its payment carries (an ordinary order: no `amount_not_current`).
    await x.db.query("update public.catering_quotes set deposit_cents = 20000, total_cents = 80000 where id = $1", [q2]);
    await x.db.query("update public.catering_quotes set deposit_cents = 25000, total_cents = 80000 where id = $1", [q3]);
    const piSeen = `pi_seenfirst_${randomUUID().slice(0, 8)}`;

    const types = REFUND_INGRESS_TYPES;
    const burst: Array<{ id: string; pi: string; matched: boolean }> = [];
    const answers: Array<{ status: number; result: unknown }> = [];
    let checkoutAnswer: { status: number; body: Record<string, unknown> } | null = null;
    for (let i = 0; i < 50; i++) {
      const type = types[i % types.length]!;
      const expanded = i % 2 === 1;
      const foreign = i % 7 === 3;
      const seen = i === 10; // the seen-first refund of p3's charge (a charge.refunded: i % 5 === 0)
      const pi = seen ? piSeen : foreign ? `pi_foreign_${i}_${randomUUID().slice(0, 6)}` : p1.pi;
      const refundId = `re_burst_${i}_${randomUUID().slice(0, 6)}`;
      const ev = type === "charge.refunded"
        ? chargeRefunded({ pi, cumulative: seen ? 5000 : 100 * (i + 1), amount: seen ? 25000 : 30000, full: false, expanded,
            embedded: i % 3 === 0 ? [{ id: refundId, status: "succeeded" }] : null })
        : refundObjectEvent(type, { pi, refundId, status: ["pending", "succeeded", "failed"][i % 3], expanded });
      burst.push({ id: ev.id, pi, matched: pi === p1.pi });
      const r = await deliver(ev);
      answers.push({ status: r.status, result: r.body.result });
      if (i === 25) checkoutAnswer = await deliver(checkoutCompleted({ paymentId: p2.id, quoteId: q2, pi: `pi_ordinary_${randomUUID().slice(0, 8)}`, amount: 20000 }));
    }
    // Every one answers refund_state_owed, 2xx through the route's own mapping.
    expect(answers.every((a) => a.status === 200 && a.result === "refund_state_owed"), JSON.stringify(answers.filter((a) => a.status !== 200 || a.result !== "refund_state_owed"))).toBe(true);
    expect(isRetryableResult("refund_state_owed")).toBe(false);
    // Durable work, one row per event, stamped with the terminal verdict.
    const ids = burst.map((b) => b.id);
    expect(await harnessLib.count(x.db, "select count(*) n from public.catering_refund_event_work where event_id = any($1)", [ids])).toBe(50);
    expect(await harnessLib.count(x.db, "select count(*) n from public.stripe_events where id = any($1) and outcome = 'refund_state_owed'", [ids])).toBe(50);
    for (const b of burst) expect((await work(x.db, b.id)).state, b.id).toBe(b.matched ? "attached" : "unmatched");
    // The ordinary checkout in the middle of the burst still settled, with its ordinary result.
    expect(checkoutAnswer).toMatchObject({ status: 200, body: { result: "paid" } });
    expect((await payRow(x.db, p2.id)).status).toBe("paid");
    expect((await payRow(x.db, p2.id)).settlement_cleanup_at).not.toBeNull();
    // ON never ran the legacy writer for any of the 50.
    expect(legacyRefundAudits()).toHaveLength(0);
    expect(paymentWrites(x.calls).filter((c) => (c.args as Record<string, unknown>)?.status === "refunded")).toHaveLength(0);

    // ── Settlement of the payment whose refund was seen FIRST (inside the burst): the DB attachment fails once. ──
    const notified: NotifyPaidArgs[] = [];
    const deps = {
      notifyPaid: async (a: NotifyPaidArgs) => { notified.push(a); h.log?.push({ kind: "notify", name: a.paymentId }); },
      retireSession: async () => { h.stripeCalls.push("retireSession"); throw new Error("Stripe is down"); },
    };
    const seenCheckout = checkoutCompleted({ paymentId: p3.id, quoteId: q3, pi: piSeen, amount: 25000 });
    const first = await processStripeEvent(x.sb as never, seenCheckout, SINGLE, deps);
    expect(first.result).toBe("settlement_incomplete");
    expect(isRetryableResult(first.result)).toBe(true); // the route answers it 500
    expect((await payRow(x.db, p3.id))).toMatchObject({ status: "paid", provider_ref: piSeen, settlement_cleanup_at: null });
    const seenEvent = burst[10]!.id;
    expect((await work(x.db, seenEvent)).state).toBe("unmatched");
    expect(await ledger(x.db, seenCheckout.id)).toBe("settlement_incomplete");

    // The redelivery succeeds: attaches the event with its floor, stamps the marker, and reports BEFORE the marker.
    const mark0 = x.calls.length;
    const second = await processStripeEvent(x.sb as never, seenCheckout, SINGLE, deps);
    expect(second.result).toBe("paid_needs_review");
    expect(isRetryableResult(second.result)).toBe(false);
    expect(await work(x.db, seenEvent)).toMatchObject({ state: "attached", floor_state: "outstanding", floor_cents: 5000, payment_id: p3.id });
    expect((await payRow(x.db, p3.id)).settlement_cleanup_at).not.toBeNull();
    expect((await harnessKit.figures(x.db, p3.id)).o_floor).toBe(5000);
    const tail = (x.calls as LogEntry[]).slice(mark0);
    const attachAt = tail.findIndex((c) => c.kind === "rpc" && c.name === "catering_refund_settlement_attach");
    const auditAt = tail.findIndex((c) => c.kind === "audit" && c.name === "catering.payment.provider_paid");
    const notifyAt = tail.findIndex((c) => c.kind === "notify");
    const markerAt = tail.findIndex((c) => c.kind === "update" && c.name === "catering_payments" && "settlement_cleanup_at" in ((c.args as Record<string, unknown>) ?? {}));
    expect(attachAt).toBeGreaterThanOrEqual(0);
    expect(auditAt).toBeGreaterThan(attachAt);
    expect(notifyAt).toBeGreaterThan(attachAt);
    expect(markerAt).toBeGreaterThan(auditAt);
    expect(markerAt).toBeGreaterThan(notifyAt);
    expect(notified.at(-1)?.reviewReasons).toContain("refund_seen_first");

    // ZERO Stripe calls over the whole burst, both checkouts included.
    expect(h.stripeCalls).toEqual([]);
  }, 120_000);

  it("ingress_commit_failure_is_retryable: the register RPC missing (0358-only database) or a thrown database error is processing_failed (non-2xx), the ledger stays retryable, the redelivery after the schema exists registers (2xx); never the legacy writer", async () => {
    // (1) The function does not exist: a database at 0358 (stripe_events and the payments are there).
    const old = await harnessLib.base({ upTo: "0358" });
    const x = await setup({ db: old });
    const q = await x.w.quote();
    const p = await x.w.pay(q, "deposit", 30000);
    const ev = chargeRefunded({ pi: p.pi, cumulative: 30000, amount: 30000, full: true });
    const r1 = await deliver(ev);
    expect(r1.status).toBe(500);
    expect(r1.body.code).toBe("processing_failed");
    expect(isRetryableLedgerOutcome(await ledger(x.db, ev.id))).toBe(true);
    expect([null, "processing_failed"]).toContain(await ledger(x.db, ev.id));
    expect(paymentWrites(x.calls)).toHaveLength(0);
    expect(legacyRefundAudits()).toHaveLength(0);
    expect((await payRow(x.db, p.id)).status).toBe("paid");
    // The schema arrives (0359 applied to the same database); the redelivery registers and answers 2xx.
    await x.db.exec(harnessLib.M0359);
    await harnessLib.withStandIns(x.db);
    const r2 = await deliver(ev);
    expect(r2).toMatchObject({ status: 200, body: { result: "refund_state_owed" } });
    expect(await ledger(x.db, ev.id)).toBe("refund_state_owed");
    expect((await work(x.db, ev.id)).state).toBe("attached");
    expect(paymentWrites(x.calls)).toHaveLength(0);
    expect(legacyRefundAudits()).toHaveLength(0);
    expect((await payRow(x.db, p.id)).status).toBe("paid"); // the sweep owns the money, never the webhook
    await x.db.close();
    t = null;

    // (2) A database error: answered as an error, and thrown outright.
    for (const mode of ["error", "throw"] as const) {
      let fail = true;
      const y = await setup({
        rpc: {
          catering_refund_event_register: () => {
            if (!fail) return undefined;
            fail = false;
            if (mode === "throw") throw new Error("connection terminated unexpectedly");
            return { data: null, error: { code: "40001", message: "could not serialize access" } };
          },
        },
      });
      const qq = await y.w.quote();
      const pp = await y.w.pay(qq, "deposit", 30000);
      const e2 = chargeRefunded({ pi: pp.pi, cumulative: 30000, amount: 30000, full: true });
      const a = await deliver(e2);
      expect(a.status, mode).toBe(500);
      expect(a.body.code, mode).toBe("processing_failed");
      expect(await ledger(y.db, e2.id), mode).toBe("processing_failed");
      expect(await harnessLib.count(y.db, "select count(*) n from public.catering_refund_event_work where event_id = $1", [e2.id])).toBe(0);
      const b = await deliver(e2);
      expect(b, mode).toMatchObject({ status: 200, body: { result: "refund_state_owed" } });
      expect(await ledger(y.db, e2.id)).toBe("refund_state_owed");
      expect(paymentWrites(y.calls), mode).toHaveLength(0);
      expect(legacyRefundAudits(), mode).toHaveLength(0);
      expect((await payRow(y.db, pp.id)).status).toBe("paid");
      await y.db.close();
      t = null;
    }
    expect(h.stripeCalls).toEqual([]);
  }, 120_000);

  it("refund_state_owed_classifications_pinned: terminal for the ledger and the route, and absent from LEDGER_UNFINISHED and REFUND_NOT_APPLIED", () => {
    expect(isRetryableLedgerOutcome("refund_state_owed")).toBe(false);
    expect(isRetryableResult("refund_state_owed" as StripeProcessingResult)).toBe(false);
    const src = readFileSync(join(ROOT, "lib/stripe/webhook.ts"), "utf8");
    const constant = (name: string) => {
      const m = new RegExp(`const ${name} = "([^"]*)";`).exec(src);
      expect(m, `${name} is declared as one string literal`).not.toBeNull();
      return m![1]!;
    };
    const unfinished = constant("LEDGER_UNFINISHED");
    const notApplied = constant("REFUND_NOT_APPLIED");
    expect(unfinished).toBe("outcome.is.null,outcome.eq.processing_failed,outcome.eq.settlement_incomplete");
    expect(notApplied).toBe("outcome.is.null,outcome.eq.processing_failed,outcome.eq.payment_not_found");
    expect(unfinished).not.toContain("refund_state_owed");
    expect(notApplied).not.toContain("refund_state_owed");
  });

  it("duplicates: a duplicate whose work committed answers duplicate (2xx) with no second 0333 row; a delivery carrying an OFF-era terminal verdict answers duplicate and registers nothing", async () => {
    const x = await setup();
    const q = await x.w.quote();
    const p = await x.w.pay(q, "deposit", 30000);
    const ev = chargeRefunded({ pi: p.pi, cumulative: 10000, amount: 30000, full: false, embedded: [{ id: "re_dup_1", status: "succeeded" }] });
    expect(await deliver(ev)).toMatchObject({ status: 200, body: { result: "refund_state_owed" } });
    expect(await history(x.db, p.id)).toBe(1);
    const registers = () => x.calls.filter((c) => c.kind === "rpc" && c.name === "catering_refund_event_register").length;
    const before = registers();
    expect(await deliver(ev)).toMatchObject({ status: 200, body: { result: "duplicate" } });
    expect(registers()).toBe(before);
    expect(await history(x.db, p.id)).toBe(1);

    for (const verdict of ["payment_not_found", "refunded", "ignored"]) {
      const old = chargeRefunded({ pi: p.pi, cumulative: 30000, amount: 30000, full: true });
      await x.db.query("insert into public.stripe_events (id, type, livemode, payload, outcome, processed_at) values ($1, 'charge.refunded', false, $2, $3, now())",
        [old.id, JSON.stringify(old), verdict]);
      const r = await deliver(old);
      expect(r, verdict).toMatchObject({ status: 200, body: { result: "duplicate" } });
      expect(await harnessLib.count(x.db, "select count(*) n from public.catering_refund_event_work where event_id = $1", [old.id]), verdict).toBe(0);
      expect(await ledger(x.db, old.id), verdict).toBe(verdict);
    }
    expect(registers()).toBe(before);
    expect(paymentWrites(x.calls)).toHaveLength(0);
    expect(legacyRefundAudits()).toHaveLength(0);
  }, 60_000);

  it("location context: an event from another shop's per-location endpoint is quarantined: acknowledged, no floor, no hint, no 0333 history, no money effect", async () => {
    const x = await setup();
    const q = await x.w.quote(); // the first shop's quote
    const p = await x.w.pay(q, "deposit", 30000);
    const before = await harnessKit.figures(x.db, p.id);
    const ev = chargeRefunded({ pi: p.pi, cumulative: 29000, amount: 30000, full: false, embedded: [{ id: "re_wrongshop", status: "succeeded" }] });
    const r = await deliver(ev, "S2"); // the OTHER shop's endpoint
    expect(r).toMatchObject({ status: 200, body: { result: "refund_state_owed" } });
    expect((await work(x.db, ev.id))).toMatchObject({ state: "quarantined", floor_state: "none" });
    expect(await history(x.db, p.id)).toBe(0);
    expect(await harnessLib.count(x.db, "select count(*) n from public.catering_refund_identities where refund_id = 're_wrongshop'")).toBe(0);
    const after = await harnessKit.figures(x.db, p.id);
    expect([after.o_floor, after.o_returned, after.o_available]).toEqual([before.o_floor, before.o_returned, before.o_available]);
    expect((await payRow(x.db, p.id)).status).toBe("paid");
    expect(paymentWrites(x.calls)).toHaveLength(0);
  }, 60_000);

  it("actual_checkout_attach_while_stale_whole_charge_event_is_parked: a parked whole-charge event, then the real settlement: o_held is true in between, the floor is attached before any refund admission is possible", async () => {
    const x = await setup();
    await harnessKit.goLive(x.db);
    const q = await x.w.quote();
    const p = await x.w.pay(q, "deposit", 30000, { status: "due" });
    const pi = `pi_parked_${randomUUID().slice(0, 8)}`;
    const ev = chargeRefunded({ pi, cumulative: 30000, amount: 30000, full: true, created: now() - 3 * 86400 });
    expect(await deliver(ev)).toMatchObject({ status: 200, body: { result: "refund_state_owed" } });
    await harnessKit.backdate(x.db, "catering_refund_event_work", "received_at", ev.id, "3 days", "event_id");
    await harnessKit.rpc(x.db, "catering_refund_sweep_housekeeping", [harnessLib.CALLER]);
    expect((await work(x.db, ev.id)).state).toBe("no_payment");

    // Hold the settlement AT its attach: the row is paid and carries the PaymentIntent; nothing is attached yet.
    let between: Record<string, number | boolean> | null = null;
    h.client = refundClient(x.db, {
      calls: x.calls,
      rpc: {
        catering_refund_settlement_attach: async () => {
          between = await harnessKit.figures(x.db, p.id);
          return undefined; // then the real function runs
        },
      },
    });
    const sb = h.client as ReturnType<typeof refundClient>;
    const res = await processStripeEvent(sb as never, checkoutCompleted({ paymentId: p.id, quoteId: q, pi, amount: 30000 }), SINGLE, { notifyPaid: async () => {}, retireSession: async () => "expired" });
    expect(between).not.toBeNull();
    expect(between!.o_held).toBe(true); // a seen-first event for this PaymentIntent is waiting: no admission
    expect(res.result).toBe("paid_needs_review");
    expect(await work(x.db, ev.id)).toMatchObject({ state: "attached", floor_state: "outstanding", floor_cents: 30000, payment_id: p.id });
    const fig = await harnessKit.figures(x.db, p.id);
    expect([fig.o_floor, fig.o_available]).toEqual([30000, 0]);
    expect((await payRow(x.db, p.id)).status).toBe("paid"); // the sweep applies it, not the settlement
    expect(legacyRefundAudits()).toHaveLength(0);
    expect(h.stripeCalls).toEqual([]);
  }, 60_000);

  it("parseRefundIngress: bare and expanded ids, missing created, embedded refunds bounded to 100, non-refund types and over-long ids are null", () => {
    const bare = parseRefundIngress(chargeRefunded({ id: "evt_bare", pi: "pi_bare_1", cumulative: 500, amount: 900, full: false, charge: "ch_bare_1", embedded: [{ id: "re_b1", status: "succeeded" }] }));
    const exp = parseRefundIngress(chargeRefunded({ id: "evt_exp", pi: "pi_bare_1", cumulative: 500, amount: 900, full: false, charge: "ch_bare_1", expanded: true, embedded: [{ id: "re_b1", status: "succeeded" }] }));
    expect(bare).toMatchObject({ eventId: "evt_bare", type: "charge.refunded", paymentIntentId: "pi_bare_1", chargeId: "ch_bare_1", cumulativeCents: 500, chargeAmountCents: 900, fullyRefunded: false, hints: [{ id: "re_b1", status: "succeeded" }] });
    expect({ ...exp, eventId: "evt_bare" }).toEqual(bare);
    for (const type of ["refund.created", "refund.updated", "refund.failed", "charge.refund.updated"]) {
      const a = parseRefundIngress(refundObjectEvent(type, { id: "evt_r", pi: "pi_obj_1", refundId: "re_obj_1", status: "failed", charge: "ch_obj_1" }));
      const b = parseRefundIngress(refundObjectEvent(type, { id: "evt_r", pi: "pi_obj_1", refundId: "re_obj_1", status: "failed", charge: "ch_obj_1", expanded: true }));
      expect(a, type).toMatchObject({ type, paymentIntentId: "pi_obj_1", chargeId: "ch_obj_1", cumulativeCents: null, chargeAmountCents: null, fullyRefunded: null, hints: [{ id: "re_obj_1", status: "failed" }] });
      expect(b, type).toEqual(a);
    }
    expect(parseRefundIngress(chargeRefunded({ pi: "pi_x_1", created: null }))?.createdSec).toBeNull();
    const many = Array.from({ length: 250 }, (_, i) => ({ id: `re_many_${i}`, status: "succeeded" }));
    expect(parseRefundIngress(chargeRefunded({ pi: "pi_x_1", embedded: many }))?.hints).toHaveLength(100);
    expect(parseRefundIngress({ id: "evt_c", type: "checkout.session.completed", data: { object: {} } })).toBeNull();
    expect(parseRefundIngress({ id: "evt_c", type: "charge.succeeded", data: { object: {} } })).toBeNull();
    expect(parseRefundIngress(chargeRefunded({ id: `evt_${"x".repeat(252)}`, pi: "pi_x_1" }))).toBeNull(); // 256 chars
    expect(parseRefundIngress(chargeRefunded({ id: `evt_${"x".repeat(251)}`, pi: "pi_x_1" }))).not.toBeNull(); // 255 chars
    expect(parseRefundIngress(null)).toBeNull();
    expect(parseRefundIngress("charge.refunded")).toBeNull();
  });

  it("ON: a refund event the ingress parser refuses (an event id over 255 chars) never reaches the legacy whole-charge writer", async () => {
    const x = await setup();
    const q = await x.w.quote();
    const p = await x.w.pay(q, "deposit", 30000);
    // A whole-charge refund (Stripe's `refunded: true`) with no `amount_refunded`, so main's 0333 append is skipped and
    // nothing upstream of the status flip can fail: if this delivery reaches `refund`, the row moves.
    const ev = chargeRefunded({ id: `evt_${"y".repeat(252)}`, pi: p.pi, cumulative: null, amount: 30000, full: true });
    expect(parseRefundIngress(ev)).toBeNull();
    await deliver(ev);
    expect(legacyRefundAudits()).toHaveLength(0);
    expect(paymentWrites(x.calls)).toHaveLength(0);
    expect((await payRow(x.db, p.id)).status).toBe("paid");
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
describe("the rollback handoff to main (app halves)", () => {
  it("ingress_racing_stop_is_applied_or_retryable: after finish_drain sealed the epoch, the ON instance's NEW refund event is processing_failed (non-2xx) with a retryable ledger verdict; the SAME event under OFF is applied by main's legacy writer", async () => {
    const x = await setup();
    const q = await x.w.quote();
    const p = await x.w.pay(q, "deposit", 30000);
    await harnessKit.goLive(x.db);
    const d = await drain(x.db);
    expect((await finishDrain(x.db, d)).closed).toBe(true);
    expect((await harnessKit.rpc(x.db, "catering_refund_epoch_state", [harnessLib.CALLER])).state).toBe("sealed");

    const late = chargeRefunded({ pi: p.pi, cumulative: 30000, amount: 30000, full: true });
    const on = await deliver(late);
    expect(on.status).toBe(500);
    expect(on.body.code).toBe("processing_failed");
    const verdict = await ledger(x.db, late.id);
    expect([null, "processing_failed"]).toContain(verdict); // Opus P3 (a): never a final verdict
    expect(isRetryableLedgerOutcome(verdict)).toBe(true);
    expect(await harnessLib.count(x.db, "select count(*) n from public.catering_refund_event_work where event_id = $1", [late.id])).toBe(0);
    expect((await payRow(x.db, p.id)).status).toBe("paid");

    // The SAME event, delivered to the OFF code path (switch off, same database): main's legacy writer applies it.
    delete process.env.CATERING_REFUNDS;
    const off = await deliver(late);
    expect(off).toMatchObject({ status: 200, body: { result: "refunded" } });
    expect((await payRow(x.db, p.id)).status).toBe("refunded");
    expect(await ledger(x.db, late.id)).toBe("refunded");
    expect(await history(x.db, p.id)).toBe(1);
    expect(legacyRefundAudits()).toHaveLength(1);
    expect(h.stripeCalls).toEqual([]);
  }, 60_000);

  it("on_ingress_then_off_rollback_whole_refund_not_lost: whole refund ingress (2xx), a premature drain lists it, one pass applies it, seal, OFF: the portal's payment read and the digest's refund loader see `refunded` and one 0333 event", async () => {
    const x = await setup();
    const q = await x.w.quote();
    const p = await x.w.pay(q, "deposit", 30000);
    const stripe = new kit.FakeStripe();
    stripe.charge(p.pi, { captured: 30000 });
    await harnessKit.goLive(x.db);
    stripe.refund(p.pi, 30000, "succeeded", { id: "re_whole_1", created: now() - 60 });
    const ev = chargeRefunded({ pi: p.pi, cumulative: 30000, amount: 30000, full: true, created: now() - 50, embedded: [{ id: "re_whole_1", status: "succeeded" }] });
    expect(await deliver(ev)).toMatchObject({ status: 200, body: { result: "refund_state_owed" } });
    expect((await payRow(x.db, p.id)).status).toBe("paid"); // acknowledged, not applied

    const d = await drain(x.db);
    const early = await finishDrain(x.db, d);
    expect(early.closed).toBe(false);
    expect(early.report.outstanding_events.map((o: { event_id: string; payment_id: string }) => [o.event_id, o.payment_id])).toEqual([[ev.id, p.id]]);
    expect((await harnessKit.rpc(x.db, "catering_refund_epoch_state", [harnessLib.CALLER])).state).toBe("draining");

    const applied = await kit.pass(x.db, p.id, stripe);
    expect([applied.result, applied.payment_status]).toEqual(["applied", "refunded"]);
    const done = await finishDrain(x.db, d);
    expect([done.closed, done.report.counts.still_owed]).toEqual([true, 0]);
    delete process.env.CATERING_REFUNDS;

    // The portal's payment read (OFF consumer): the customer's own order shows the payment refunded.
    const customer = (await harnessLib.one(x.db, "insert into public.catering_customers (name, email) values ('Fixture Customer', 'fixture@example.test') returning id")).id as string;
    await x.db.query("update public.catering_quotes set customer_id = $2, status = 'accepted' where id = $1", [q, customer]);
    const account = await loadCustomerAccount(customer);
    const pays = account.orders.flatMap((o) => o.payments);
    expect(pays.map((pp) => [pp.id, pp.status])).toEqual([[p.id, "refunded"]]);

    // The digest's refund loader (lib/report-digests.ts loadRefundsYesterday, through loadCateringFacts): one event.
    const digestSb = digestClient(x.db);
    const tomorrow = etDate(Date.now() + 86_400_000);
    const facts = await loadCateringFacts(digestSb as never, tomorrow, new Date(Date.now() + 86_400_000));
    expect(facts.refundsYesterday).toEqual([{ locationId: x.w.shop, amountCents: 30000 }]);
    expect(await history(x.db, p.id)).toBe(1);
    expect(legacyRefundAudits()).toHaveLength(0);
    expect(h.stripeCalls).toEqual([]);
  }, 90_000);

  for (const mode of ["whole", "partial"] as const) {
    it(`parked_event_restamped_at_seal_settles_under_off (${mode}): a refund for a PaymentIntent with no payment row is acknowledged ON, re-stamped payment_not_found at the seal; under OFF the payment's own checkout replays it through main's seen-first path`, async () => {
      const x = await setup();
      await harnessKit.goLive(x.db);
      const q = await x.w.quote();
      const p = await x.w.pay(q, "deposit", 30000, { status: "due" });
      const pi = `pi_parked_off_${randomUUID().slice(0, 8)}`;
      const ev = chargeRefunded({ pi, cumulative: mode === "whole" ? 30000 : 5000, amount: 30000, full: mode === "whole" });
      expect(await deliver(ev)).toMatchObject({ status: 200, body: { result: "refund_state_owed" } });
      expect((await work(x.db, ev.id)).state).toBe("unmatched");
      const d = await drain(x.db);
      const done = await finishDrain(x.db, d);
      expect([done.closed, done.report.restamped]).toEqual([true, 1]);
      expect(await ledger(x.db, ev.id)).toBe("payment_not_found");

      delete process.env.CATERING_REFUNDS;
      auditMock.mockClear();
      const r = await processStripeEvent(x.sb as never, checkoutCompleted({ paymentId: p.id, quoteId: q, pi, amount: 30000 }), SINGLE, { notifyPaid: async () => {}, retireSession: async () => "expired" });
      expect(r.result).toBe("paid_needs_review");
      const refundedAudits = legacyRefundAudits().map((c) => (c[0] as { metadata: Record<string, unknown> }).metadata);
      expect(refundedAudits).toHaveLength(1);
      if (mode === "whole") {
        expect((await payRow(x.db, p.id)).status).toBe("refunded");
        expect(refundedAudits[0]).toMatchObject({ partial: false, stripe_event_id: ev.id });
        expect(await ledger(x.db, ev.id)).toBe("refunded");
      } else {
        expect((await payRow(x.db, p.id)).status).toBe("paid");
        expect(refundedAudits[0]).toMatchObject({ partial: true, refunded_amount_cents: 5000, stripe_event_id: ev.id });
        expect(await ledger(x.db, ev.id)).toBe("partially_refunded");
      }
      expect(await history(x.db, p.id)).toBe(1);
      expect(x.calls.filter((c) => c.kind === "rpc" && c.name === "catering_refund_settlement_attach")).toHaveLength(0);
      expect(h.stripeCalls).toEqual([]);
    }, 60_000);
  }

  it("pending_whole_refund_at_drain_listed_and_legacy_settles: a whole refund pending at the drain is listed, the payment stays paid; under OFF a NEW charge.refunded (refunded: true) moves it through main's legacy writer", async () => {
    const x = await setup();
    const q = await x.w.quote();
    const p = await x.w.pay(q, "deposit", 30000);
    const stripe = new kit.FakeStripe();
    stripe.charge(p.pi, { captured: 30000 });
    await harnessKit.goLive(x.db);
    stripe.refund(p.pi, 30000, "pending", { id: "re_pending_1", created: now() - 60 });
    const ev = refundObjectEvent("refund.created", { pi: p.pi, refundId: "re_pending_1", status: "pending" });
    expect(await deliver(ev)).toMatchObject({ status: 200, body: { result: "refund_state_owed" } });
    await kit.pass(x.db, p.id, stripe);
    const d = await drain(x.db);
    const done = await finishDrain(x.db, d);
    expect(done.closed).toBe(true);
    expect(done.report.pending_whole_refunds.map((r: { payment_id: string; reserved_cents: number }) => [r.payment_id, Number(r.reserved_cents)])).toEqual([[p.id, 30000]]);
    expect((await payRow(x.db, p.id)).status).toBe("paid");

    delete process.env.CATERING_REFUNDS;
    const settled = chargeRefunded({ pi: p.pi, cumulative: 30000, amount: 30000, full: true, embedded: [{ id: "re_pending_1", status: "succeeded" }] });
    expect(await deliver(settled)).toMatchObject({ status: 200, body: { result: "refunded" } });
    expect((await payRow(x.db, p.id)).status).toBe("refunded");
    expect(legacyRefundAudits()).toHaveLength(1);
    expect(h.stripeCalls).toEqual([]);
  }, 60_000);
});

/**
 * The digest's catering facts read many tables this offline schema does not carry (leads, pipeline events, prep
 * demand, ezCater reconciliation). Those answer EMPTY here; the four tables the refund line reads (locations,
 * catering_payment_refund_events, catering_payments, catering_quotes) go to the real SQL.
 */
function digestClient(db: PGlite) {
  const real = refundClient(db);
  const REAL = new Set(["locations", "catering_payment_refund_events", "catering_payments", "catering_quotes"]);
  const empty = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "is", "not", "gte", "lte", "gt", "lt", "or", "order", "limit", "range", "returns", "abortSignal"]) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.single = () => Promise.resolve({ data: null, error: null });
    q.then = (resolve: (a: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
    return q;
  };
  return {
    from: (table: string) => (REAL.has(table) ? real.from(table) : empty()),
    rpc: () => Promise.resolve({ data: [], error: null }),
  };
}
