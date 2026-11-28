/**
 * Catering refunds Part B1 v2 — B1 SENDS NOTHING: no email, no SMS, no notification, no job-watch mail (plan 3.5,
 * section 10 `tests/catering-refund-sends-nothing.test.ts`; DR12).
 *
 * RUNTIME: the REAL sweep route (app/api/cron/catering-refund-sweep) through the REAL worker on the REAL SQL (PGlite,
 * 0357 -> 0358 -> 0359) against the Stripe HTTP fake, with EVERY export of the repo's mail / notification layer
 * replaced by a recording spy (vi.mock resolves the module, so the spy sits on the real call graph whatever path a
 * B1 module would reach it by; a spy never calls through, so nothing could leave even if one were reached). Four
 * runs: the first sweep over existing payments (the backfill), a reversal, a resumed sweep, a failing sweep (a
 * provider outage, and a missing schema). Asserted: zero deliveries, zero POSTs, and the only table write B1 made is an
 * `audit_log` append (the heartbeat / failure row).
 *
 * STATIC: no B1 module (the lib, the read model, the inventory, every refund route, the sweep cron route, the
 * inventory page) imports the mail layer or `watchSiblings`, directly or through one hop.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const deliveries: string[] = [];
  /** Every function export of a mail-layer module becomes a recording spy that never calls through. */
  const spyAll = (name: string, mod: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(mod)) {
      out[k] = typeof v === "function"
        ? (...args: unknown[]) => { deliveries.push(`${name}.${k}(${args.length} args)`); return undefined; }
        : v;
    }
    return out;
  };
  return { sb: null as unknown, deliveries, spyAll };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => {
    if (!h.sb) throw new Error("catering-refund-sends-nothing.test: no client handed out");
    return h.sb;
  },
}));
// The mail / notification layer (every module that delivers or queues a message, and the job watch's sibling mail).
vi.mock("@/lib/email", async (o) => h.spyAll("email", await o()));
vi.mock("@/lib/sim-email", async (o) => h.spyAll("sim-email", await o()));
vi.mock("@/lib/notifications", async (o) => h.spyAll("notifications", await o()));
vi.mock("@/lib/po-email", async (o) => h.spyAll("po-email", await o()));
vi.mock("@/lib/po-sms", async (o) => h.spyAll("po-sms", await o()));
vi.mock("@/lib/sms-messages", async (o) => h.spyAll("sms-messages", await o()));
vi.mock("@/lib/vendor-mail", async (o) => h.spyAll("vendor-mail", await o()));
vi.mock("@/lib/vendor-mail-forward", async (o) => h.spyAll("vendor-mail-forward", await o()));
vi.mock("@/lib/job-watch-run", async (o) => h.spyAll("job-watch-run", await o()));

import { GET as SWEEP } from "@/app/api/cron/catering-refund-sweep/route";
import { harnessKit as kit, refundClient, type RefundCall } from "./helpers/refund-pglite";
import { flowDb, KEY_LOC, type FlowDb } from "./helpers/refund-flow-kit";
import { stripeHttpFake, type StripeHttpFake } from "./stripe-http-fake";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const SECRET = "fake_cron_secret_sends_nothing";
const call = () => SWEEP(new NextRequest("http://localhost/api/cron/catering-refund-sweep", { headers: { authorization: `Bearer ${SECRET}` } }));

describe("runtime: the sweep route over the real worker and the real SQL delivers nothing", () => {
  let f: FlowDb;
  let stripe: StripeHttpFake;
  const calls: RefundCall[] = [];
  const rpc: Record<string, (a: Record<string, unknown>) => { data: unknown; error: { code: string; message: string } } | undefined> = {};
  const refunds: string[] = [];
  const pays: Array<{ id: string; pi: string; charge: string }> = [];

  beforeAll(async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("CATERING_REFUNDS_OBSERVE", "1");
    vi.stubEnv("CATERING_REFUNDS", "1");
    vi.stubEnv("STRIPE_SECRET_KEY__S1", KEY_LOC);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET__S1", "whsec_fake_sends_nothing");
    f = await flowDb();
    stripe = stripeHttpFake();
    stripe.account(KEY_LOC);
    const tag = randomUUID().slice(0, 8);
    let rn = 0;
    const add = stripe.world.addRefund;
    stripe.world.addRefund = (r) => add({ ...r, id: r.id ?? `re_fake_${tag}_${++rn}` });
    vi.stubGlobal("fetch", stripe.fetch);
    h.sb = refundClient(f.db, { calls, rpc: new Proxy({}, { get: (_t, n: string) => rpc[n] }) as never });
    // Existing payments (the backfill): three orders, refunds already at Stripe.
    for (const amount of [30_000, 12_000, 8_000]) {
      const quote = await f.w.quote();
      const p = await f.w.pay(quote, "full", amount);
      stripe.world.addPaymentIntent({ id: p.pi, account: KEY_LOC, chargeId: p.charge, amountCaptured: amount });
      refunds.push(stripe.world.addRefund({ paymentIntentId: p.pi, amount: 1_000 }).id);
      pays.push(p);
    }
    await kit.elapse(f.db, "6 minutes"); // observing()'s claim lease runs out
  });
  afterAll(() => {
    h.sb = null;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const counts = async () => {
    const res = await call();
    const json = (await res.json()) as Record<string, unknown>;
    return { status: res.status, json };
  };

  it("the first sweep over existing payments (the backfill)", async () => {
    const r = await counts();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, counts: { passes: 3, complete: 3 } });
    for (const p of pays) expect((await kit.mirror(f.db, p.id))).toHaveLength(1);
  });

  it("a reversal (the webhook's ledger row, then a sweep)", async () => {
    stripe.world.setRefundStatus(refunds[0]!, "failed");
    await kit.ledger(f.db, { pi: pays[0]!.pi, charge: pays[0]!.charge });
    await kit.elapse(f.db, "6 minutes");
    const r = await counts();
    expect(r.status).toBe(200);
    expect((await kit.mirror(f.db, pays[0]!.id))[0]).toMatchObject({ status: "failed", previous_status: "succeeded" });
  });

  it("a resumed sweep (the last claim is over 60 minutes old: every payment is stamped and re-read)", async () => {
    await kit.elapse(f.db, "61 minutes");
    const r = await counts();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, counts: { resumed: true } });
  });

  it("a failing sweep: the provider is down (every read is not complete), then the schema is missing (503 + cron.failure)", async () => {
    stripe.down.add(KEY_LOC);
    await kit.elapse(f.db, "50 minutes"); // the payments are due again (class A after the resume's stamp; class C hourly)
    const r = await counts();
    expect(r.status).toBe(200);
    expect((r.json.counts as { not_complete: Record<string, number> }).not_complete.owner_unreachable).toBeGreaterThanOrEqual(1);
    rpc.catering_refund_sweep_begin = () => ({ data: null, error: { code: "42883", message: "function public.catering_refund_sweep_begin does not exist" } });
    const missing = await counts();
    expect(missing.status).toBe(503);
    delete rpc.catering_refund_sweep_begin;
  });

  it("over all four runs: ZERO deliveries, ZERO POSTs, and the only table write is an audit_log append (heartbeat / failure)", async () => {
    expect(h.deliveries).toEqual([]);
    expect(stripe.httpRequests("POST")).toBe(0);
    const writes = calls.filter((c) => c.kind === "insert" || c.kind === "update" || c.kind === "delete");
    expect(writes.length).toBeGreaterThan(0);
    expect([...new Set(writes.map((w) => `${w.kind}:${w.name}`))]).toEqual(["insert:audit_log"]);
    const actions = new Set(writes.map((w) => String((w.args as { action?: string }).action)));
    expect([...actions].sort()).toEqual(["cron.failure", "cron.success"]);
  });
});

// ── Static: no B1 module reaches the mail layer or watchSiblings, directly or through one hop ─────────────
const ROOT = resolve(__dirname, "..");
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

/** The B1 modules: the lib, the read model, the inventory, every refund route, the sweep route, the inventory page. */
function b1Modules(): string[] {
  const fixed = ["lib/catering/refunds.ts", "lib/catering/refund-observe.ts", "lib/catering/refunds-shared.ts", "lib/catering/refund-inventory.ts",
    "app/api/cron/catering-refund-sweep/route.ts", "app/api/catering/pipeline/[id]/refunds/route.ts", "app/admin/catering/refunds/page.tsx"]
    .map((p) => join(ROOT, p)).filter((p) => existsSync(p));
  return [...new Set([...fixed, ...walk(join(ROOT, "app/api/catering/quotes/[id]/refunds"))])];
}

/** Every module specifier a file imports or re-exports (static, side-effect, dynamic, require), with its statement. */
function importsOf(file: string): Array<{ spec: string; statement: string }> {
  const src = readFileSync(file, "utf8");
  const out: Array<{ spec: string; statement: string }> = [];
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[^;]*?\sfrom\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) for (const m of src.matchAll(re)) out.push({ spec: m[1]!, statement: m[0] });
  return out;
}

/** A specifier resolved to a repo file (or null for a package). */
function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

const MAIL_FILE = /^lib\/(email|sim-email|notifications|po-email|po-sms|sms-messages|vendor-mail[a-z-]*|job-watch|job-watch-run)\.tsx?$|^lib\/email-templates\//;
const MAIL_PACKAGE = /^(resend|nodemailer|twilio|@sendgrid\/|web-push|@vercel\/email)/;

function violations(file: string): string[] {
  const out: string[] = [];
  for (const { spec, statement } of importsOf(file)) {
    const target = resolveSpec(file, spec);
    if (target ? MAIL_FILE.test(rel(target)) : MAIL_PACKAGE.test(spec)) out.push(`${rel(file)} imports ${spec}`);
    if (/\bwatchSiblings\b/.test(statement)) out.push(`${rel(file)} imports watchSiblings (${spec})`);
  }
  if (/\bwatchSiblings\b/.test(readFileSync(file, "utf8")) && !rel(file).startsWith("lib/job-watch")) out.push(`${rel(file)} names watchSiblings`);
  return out;
}

describe("static: no B1 module imports the mail layer or watchSiblings (directly or through one hop)", () => {
  const modules = b1Modules();

  it("the B1 module set is the one the plan names (the lib, the inventory, the refund routes, the sweep route, the page)", () => {
    const names = modules.map(rel);
    for (const must of ["lib/catering/refunds.ts", "lib/catering/refund-observe.ts", "lib/catering/refunds-shared.ts", "app/api/cron/catering-refund-sweep/route.ts"]) {
      expect(names).toContain(must);
    }
    expect(names.filter((n) => n.startsWith("app/api/catering/quotes/[id]/refunds/")).length).toBeGreaterThanOrEqual(1);
  });

  it.each(b1Modules().map((m) => [rel(m), m]))("%s: directly", (_name, file) => {
    expect(violations(file)).toEqual([]);
  });

  it.each(b1Modules().map((m) => [rel(m), m]))("%s: through one hop", (_name, file) => {
    const hop = [...new Set(importsOf(file).map((i) => resolveSpec(file, i.spec)).filter((p): p is string => p !== null))];
    expect(hop.length).toBeGreaterThan(0);
    expect(hop.flatMap(violations)).toEqual([]);
  });

  it("the scanner sees a mail import when there is one (it is not blind)", () => {
    const watch = join(ROOT, "lib/job-watch-run.ts");
    expect(existsSync(watch)).toBe(true);
    expect(importsOf(watch).some((i) => { const t = resolveSpec(watch, i.spec); return t ? MAIL_FILE.test(rel(t)) : MAIL_PACKAGE.test(i.spec); })).toBe(true);
  });
});
