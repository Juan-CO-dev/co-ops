/**
 * Catering refunds — BOTH deploy orders are safe.
 *
 * Part A (round 2, KEPT): the permission has two homes, the app's role list (`REFUND_ROLES` / `canRequestRefund`,
 * lib/catering/refunds-shared.ts) and the SQL actor rule (`catering_refund_actor_ok`, 0357, re-emitted by 0358). The two
 * models those deploy-order cases were built on are still pinned to the two files here. (The four app x SQL cases
 * themselves drove 0357's sender — `catering_refund_reserve` / `retryRefundRequest` — which Part B1 v2 retired: 0359
 * revokes its grants, and no app code calls it any more, pinned below.)
 *
 * Part B1 v2 (migration 0359), the two orders, on the REAL SQL (PGlite) under the REAL lib and the REAL routes:
 *   APP FIRST  (0359 not applied, both switches ON, every part built): every lib entry point and every route answers
 *              503 `refunds_unavailable`, the sweep answers 503 and writes `cron.failure`; nothing falls back to 0357's
 *              sender (no call to it is made, although 0357's functions are present), and nothing reaches Stripe.
 *   SQL FIRST  (0359 applied, both switches UNSET: main's app): no route calls an RPC (every refund route answers
 *              `refunds_off` before the lib; the sweep skips with no client); the lib's own gated entry points refuse
 *              `refunds_off` without a call; and no caller of 0357's sender remains anywhere in lib/ or app/.
 * SYNTHETIC rows, fake keys, no network.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";

const h = vi.hoisted(() => ({
  sb: null as unknown,
  factory: vi.fn(),
  actor: null as unknown,
  audit: vi.fn<(input: { action: string; metadata?: Record<string, unknown> }) => Promise<void>>(async () => {}),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: h.factory, createAuthedClient: h.factory }));
vi.mock("@/lib/audit", () => ({ audit: h.audit, auditChecked: async () => ({ ok: true }) }));
vi.mock("@/lib/session", async (original) => ({ ...await original<typeof import("@/lib/session")>(), requireSession: async () => h.actor }));
vi.mock("@/lib/catering/refunds-shared", async (original) => {
  const real = await original<typeof import("@/lib/catering/refunds-shared")>();
  // Every part BUILT: so the only thing between the app and the database is the database.
  return { ...real, REFUND_PARTS_BUILT: true, refundCreateBlock: (env: Record<string, string | undefined>, built?: boolean) => real.refundCreateBlock(env, built ?? true) };
});

import {
  REFUND_ROLES,
  attachRefund,
  canRequestRefund,
  checkRefunds,
  loadLeadRefundables,
  loadRefundSummary,
  releaseRefund,
  requestRefund,
  type RefundRequestBody,
} from "@/lib/catering/refunds";
import { RefundsUnavailableError, runRefundRead, runRefundSweep } from "@/lib/catering/refund-observe";
import { GET as QUOTE_GET, POST as QUOTE_POST } from "@/app/api/catering/quotes/[id]/refunds/route";
import { POST as CHECK } from "@/app/api/catering/quotes/[id]/refunds/check/route";
import { POST as RETRY } from "@/app/api/catering/quotes/[id]/refunds/[requestId]/retry/route";
import { POST as RELEASE } from "@/app/api/catering/quotes/[id]/refunds/[requestId]/release/route";
import { POST as ATTACH } from "@/app/api/catering/quotes/[id]/refunds/[requestId]/attach/route";
import { GET as LEAD_GET } from "@/app/api/catering/pipeline/[id]/refunds/route";
import { GET as SWEEP } from "@/app/api/cron/catering-refund-sweep/route";
import { ROLES, type RoleCode } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import { harnessKit as kit, harnessLib, refundClient, refundDb, type KitPayment, type RefundCall } from "./helpers/refund-pglite";
import { stripeHttpFake, type StripeHttpFake } from "./stripe-http-fake";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/** Main's app gate before refund round 2 (and 0357's rule). */
const OLD_APP_ROLES = ["catering_mgr", "moo", "owner", "cgs"] as const;
const SQL_ANY_SHOP = ["owner", "cgs"];
const SQL_MEMBER_SHOP = { "0357": ["moo", "catering_mgr"], "0358": ["moo", "catering_mgr", "gm", "agm"] } as const;
/** 0357's sender: retired by 0359 (grants revoked) and called by nothing. */
const SENDER_0357 = ["catering_refund_reserve", "catering_refund_claim", "catering_refund_record_snapshot"];

const ORIGIN = "http://localhost";
const KEY = "sk_test_fake_refund_deploy_order_S1";
const SECRET = "test-only-deploy-order-cron";

describe("Part A (kept): the two homes of the refund role rule are still the two files' own", () => {
  const sqlLists = (file: string) => {
    const code = readFileSync(`supabase/migrations/${file}`, "utf8").replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
    const fn = code.match(/function public\.catering_refund_actor_ok\([\s\S]*?\nend \$\$;/);
    if (!fn) throw new Error(`catering_refund_actor_ok not found in ${file}`);
    return [...fn[0].matchAll(/v_role in \(([^)]*)\)/g)].map((m) => [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!));
  };
  it("0357's and 0358's actor rules", () => {
    expect(sqlLists("0357_catering_refund_requests.sql")).toEqual([SQL_ANY_SHOP, [...SQL_MEMBER_SHOP["0357"]]]);
    expect(sqlLists("0358_catering_refund_roles.sql")).toEqual([SQL_ANY_SHOP, [...SQL_MEMBER_SHOP["0358"]]]);
  });
  it("the OLD app's list is 0357's roles, the app's list adds exactly gm and agm, and canRequestRefund is that list for every role", () => {
    expect([...OLD_APP_ROLES].sort()).toEqual(sqlLists("0357_catering_refund_requests.sql").flat().sort());
    expect([...REFUND_ROLES].sort()).toEqual([...OLD_APP_ROLES, "gm", "agm"].sort());
    expect([...REFUND_ROLES].sort()).toEqual(sqlLists("0358_catering_refund_roles.sql").flat().sort());
    for (const role of Object.keys(ROLES) as RoleCode[]) {
      expect([role, canRequestRefund(role)]).toEqual([role, (REFUND_ROLES as readonly string[]).includes(role)]);
    }
  });
});

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n).replace(/\\/g, "/");
  if (statSync(p).isDirectory()) return n === "node_modules" ? [] : sourceFiles(p);
  return /\.(ts|tsx|mts|js|mjs)$/.test(p) ? [p] : [];
});

describe("nothing falls back to 0357's sender (static)", () => {
  it("no file under lib/ or app/ names catering_refund_reserve / _claim / _record_snapshot (0359's own `_reserve_fresh` is not one of them)", () => {
    const files = [...sourceFiles("lib"), ...sourceFiles("app")];
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const f of files) {
      const raw = readFileSync(f, "utf8");
      if (!SENDER_0357.some((name) => raw.includes(name))) continue; // the cheap pass; the exact rule below
      const src = strip(raw);
      for (const name of SENDER_0357) if (new RegExp(`\\b${name}(?![a-z_])`).test(src)) hits.push(`${f}: ${name}`);
    }
    expect(hits).toEqual([]);
    // The lib's sender path is 0359's only: the reserve it calls is `catering_refund_reserve_fresh`.
    expect(readFileSync("lib/catering/refunds.ts", "utf8")).toContain('"catering_refund_reserve_fresh"');
  }, 420_000); // ~1,350 files: seconds on CI, minutes on a loaded laptop
});

// ── The two orders, on the real SQL ──────────────────────────────────────────────────────────────────────
interface World { db: PGlite; calls: RefundCall[]; stripe: StripeHttpFake; quote: string; lead: string; pay: KitPayment; request: string; owner: string; shop: string }

async function world(upTo: "0358" | "0359"): Promise<World> {
  const db = upTo === "0359" ? await refundDb() : await harnessLib.base({ upTo: "0358" });
  const w = await kit.world(db);
  const owner = await w.user("owner", { member: null });
  const lead = (await harnessLib.one(db, "insert into public.catering_pipeline (contact_name, stage) values ('Synthetic lead', 'lost') returning id")).id as string;
  const quote = await w.quote();
  await db.query("update public.catering_quotes set pipeline_id = $1 where id = $2", [lead, quote]);
  const pay = await w.pay(quote, "full", 15_000);
  // A request row as 0357's sender left it (pending, attempted): what Release / Attach / Retry would act on.
  const request = (await harnessLib.one(db,
    `insert into public.catering_refund_requests (payment_id, quote_id, location_id, client_token, amount_cents, reason_code, trigger_kind, status, attempts, requested_by)
     values ($1, $2, $3, gen_random_uuid(), 5000, 'event_lost', 'lost', 'pending', 1, $4) returning id`, [pay.id, quote, w.shop, owner])).id as string;
  const calls: RefundCall[] = [];
  h.sb = refundClient(db, { calls });
  const stripe = stripeHttpFake();
  stripe.account(KEY);
  stripe.world.addPaymentIntent({ id: pay.pi, account: KEY, chargeId: pay.charge, amountCaptured: 15_000 });
  return { db, calls, stripe, quote, lead, pay, request, owner, shop: w.shop };
}
function enter(wd: World) {
  h.factory.mockReset();
  h.factory.mockImplementation(() => h.sb);
  h.audit.mockClear();
  h.sb = refundClient(wd.db, { calls: wd.calls });
  wd.calls.length = 0;
  vi.stubEnv("STRIPE_SECRET_KEY__S1", KEY);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET__S1", "whsec_fake_deploy_order_s1");
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubGlobal("fetch", wd.stripe.fetch);
  h.actor = { user: { id: wd.owner, role: "owner", active: true, language: "en" }, locations: [], session: { stepUpUnlocked: true, stepUpUnlockedAt: new Date().toISOString(), catalogEditUnlockedAt: null } };
}
const actor = () => h.actor as AuthContext;
const BODY: RefundRequestBody = { clientToken: "55555555-5555-4555-8555-000000000001", amountCents: 15_000, seenRefundableCents: 15_000, reasonCode: "event_lost", reasonNote: null, trigger: "panel" };
const post = (path: string, body: unknown) =>
  new NextRequest(`${ORIGIN}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: ORIGIN } });
const answer = async (res: Response) => {
  const b = (await res.json()) as { code?: string; skipped?: string };
  return [res.status, b.code ?? b.skipped];
};
const routeCalls = (wd: World) => {
  const q = wd.quote, r = wd.request;
  return [
    ["GET quote", () => QUOTE_GET(new NextRequest(`${ORIGIN}/api/catering/quotes/${q}/refunds`), { params: Promise.resolve({ id: q }) })],
    ["POST create", () => QUOTE_POST(post(`/api/catering/quotes/${q}/refunds`, BODY), { params: Promise.resolve({ id: q }) })],
    ["POST check", () => CHECK(post(`/api/catering/quotes/${q}/refunds/check`, {}), { params: Promise.resolve({ id: q }) })],
    ["POST retry", () => RETRY(post(`/api/catering/quotes/${q}/refunds/${r}/retry`, {}), { params: Promise.resolve({ id: q, requestId: r }) })],
    ["POST release", () => RELEASE(post(`/api/catering/quotes/${q}/refunds/${r}/release`, { finding: "no_request", accountSlot: "location", livemode: false }), { params: Promise.resolve({ id: q, requestId: r }) })],
    ["POST attach", () => ATTACH(post(`/api/catering/quotes/${q}/refunds/${r}/attach`, { refundId: "re_fake_deploy_1" }), { params: Promise.resolve({ id: q, requestId: r }) })],
    ["GET lead", () => LEAD_GET(new NextRequest(`${ORIGIN}/api/catering/pipeline/${wd.lead}/refunds`), { params: Promise.resolve({ id: wd.lead }) })],
  ] as const;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("APP FIRST: 0359 not applied (0357 + 0358 only), both switches ON, every part built", () => {
  let wd: World;
  beforeAll(async () => { wd = await world("0358"); });
  beforeEach(() => {
    enter(wd);
    vi.stubEnv("CATERING_REFUNDS", "1");
    vi.stubEnv("CATERING_REFUNDS_OBSERVE", "1");
  });
  const noFallback = () => {
    const rpcs = wd.calls.filter((x) => x.kind === "rpc").map((x) => x.name);
    for (const name of rpcs) expect(SENDER_0357).not.toContain(name);
    expect(wd.calls.filter((x) => x.kind !== "select")).toEqual(wd.calls.filter((x) => x.kind === "rpc")); // no table write
    expect(wd.stripe.calls).toHaveLength(0);
  };

  it("every lib entry point answers 503 refunds_unavailable (or throws RefundsUnavailableError); none falls back", async () => {
    const unavailable = { status: 503, code: "refunds_unavailable" };
    await expect(loadRefundSummary(actor(), wd.quote)).rejects.toMatchObject(unavailable);
    await expect(loadLeadRefundables(actor(), wd.lead)).rejects.toMatchObject(unavailable);
    await expect(requestRefund(actor(), wd.quote, BODY)).rejects.toMatchObject(unavailable);
    await expect(checkRefunds(actor(), wd.quote)).rejects.toMatchObject(unavailable);
    await expect(releaseRefund(actor(), wd.quote, wd.request, { finding: "no_request", accountSlot: "location", livemode: false, note: null })).rejects.toMatchObject(unavailable);
    await expect(attachRefund(actor(), wd.quote, wd.request, { refundId: "re_fake_deploy_1", note: null })).rejects.toMatchObject(unavailable);
    const sb = h.sb as Parameters<typeof runRefundRead>[0];
    await expect(runRefundRead(sb, wd.pay.id, { deadlineMs: Date.now() + 10_000 })).rejects.toBeInstanceOf(RefundsUnavailableError);
    await expect(runRefundSweep(sb, { deadlineMs: Date.now() + 10_000 })).rejects.toBeInstanceOf(RefundsUnavailableError);
    noFallback();
    expect((await wd.db.query("select status, attempts from public.catering_refund_requests where id = $1", [wd.request])).rows[0]).toEqual({ status: "pending", attempts: 1 });
  });

  it("every route answers 503 refunds_unavailable; the sweep answers 503 and writes ONE cron.failure; none falls back", async () => {
    for (const [name, call] of routeCalls(wd)) expect([name, ...await answer(await call())]).toEqual([name, 503, "refunds_unavailable"]);
    const res = await SWEEP(new NextRequest(`${ORIGIN}/api/cron/catering-refund-sweep`, { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(await answer(res)).toEqual([503, "refunds_unavailable"]);
    expect(h.audit.mock.calls.map(([a]) => [a.action, a.metadata])).toEqual([["cron.failure", { job: "catering-refund-sweep", error: "refunds_unavailable" }]]);
    noFallback();
  });
});

describe("SQL FIRST: 0359 applied, both switches UNSET (main's app on the new schema)", () => {
  let wd: World;
  beforeAll(async () => { wd = await world("0359"); });
  beforeEach(() => {
    enter(wd);
    vi.stubEnv("CATERING_REFUNDS", "");
    vi.stubEnv("CATERING_REFUNDS_OBSERVE", "");
  });

  it("no route calls an RPC or reads a table: every refund route answers refunds_off; the sweep skips with no client", async () => {
    for (const [name, call] of routeCalls(wd)) expect([name, ...await answer(await call())]).toEqual([name, 503, "refunds_off"]);
    const res = await SWEEP(new NextRequest(`${ORIGIN}/api/cron/catering-refund-sweep`, { headers: { authorization: `Bearer ${SECRET}` } }));
    expect([res.status, await res.json()]).toEqual([200, { skipped: "observe_off" }]);
    expect(wd.calls).toEqual([]);
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
    expect(wd.stripe.calls).toHaveLength(0);
  });

  it("the lib's gated entry points refuse refunds_off on their own, before any call", async () => {
    const off = { status: 503, code: "refunds_off" };
    await expect(requestRefund(actor(), wd.quote, BODY)).rejects.toMatchObject(off);
    await expect(checkRefunds(actor(), wd.quote)).rejects.toMatchObject(off);
    await expect(releaseRefund(actor(), wd.quote, wd.request, { finding: "no_request", accountSlot: "location", livemode: false, note: null })).rejects.toMatchObject(off);
    await expect(attachRefund(actor(), wd.quote, wd.request, { refundId: "re_fake_deploy_1", note: null })).rejects.toMatchObject(off);
    expect(wd.calls).toEqual([]);
    expect(wd.stripe.calls).toHaveLength(0);
  });

  it("OBSERVE alone (the GETs-only switch): the existing and new refund routes still answer refunds_off, with no call", async () => {
    vi.stubEnv("CATERING_REFUNDS_OBSERVE", "1");
    for (const [name, call] of routeCalls(wd)) expect([name, ...await answer(await call())]).toEqual([name, 503, "refunds_off"]);
    expect(wd.calls).toEqual([]);
  });
});
