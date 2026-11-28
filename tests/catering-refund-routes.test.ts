/**
 * Catering refund routes, Part B1 v2 (plan 4.1, section 5's four switch rows, section 15 [S11]).
 *
 * THREE LAYERS:
 *  1. THE GATE ORDER of every route over a mocked session and a mocked lib (the lib's own flow is
 *     tests/catering-refunds-flow.test.ts): unauthenticated, bad origin, the switch, the body, the role, Tier B, then
 *     the lib, each refusing before the next is asked.
 *       POST .../refunds                          same-origin -> session -> switch -> parse -> ids -> role -> Tier B -> lib
 *       POST .../refunds/check                    same-origin -> session -> switch -> `{}` -> id -> refund roles -> lib
 *       POST .../refunds/[requestId]/retry        same-origin -> session -> switch -> ids -> `{}` -> refund roles -> lib (= Check)
 *       POST .../refunds/[requestId]/release      same-origin -> session -> switch -> parse -> ids -> RELEASE roles -> Tier B -> lib
 *       POST .../refunds/[requestId]/attach       same-origin -> session -> switch -> parse -> ids -> RELEASE roles -> Tier B -> lib
 *       GET  .../refunds, GET pipeline/[id]/refunds   session -> switch -> read floor -> id -> lib
 *  2. THE REAL LIB over the REAL SQL (PGlite, 0357 -> 0358 -> 0359) and the Stripe HTTP fake: the panel GET makes
 *     zero Stripe calls; ON without OBSERVE; the build gate and the database gate; Check; the retry path never POSTs;
 *     Release and Attach (the release roles, a GM refused, the findings, the account and mode); [S11].
 *  3. THE PASSWORD UNLOCK survives until the confirm / release / attach: the REAL lib/session.ts path rule, and the real
 *     requireSession over a fake sessions table, proving which refund paths keep and which clear the unlock.
 * SYNTHETIC rows and fake keys only; never a network call.
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";

const h = vi.hoisted(() => ({
  actor: null as unknown,
  /** true = the route gets the mocked session below; false = the REAL requireSession. */
  mockSession: true,
  session: vi.fn(),
  /** true = the route reaches the mocked lib functions below; false = the REAL lib. */
  mockLib: true,
  request: vi.fn(), check: vi.fn(), release: vi.fn(), attach: vi.fn(), summary: vi.fn(), lead: vi.fn(),
  /** The BUILD half of the B2 / B3 gate as this test states it (the module's own constant is false). */
  partsBuilt: false,
  sb: null as unknown,
  audit: vi.fn(async () => {}),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.sb, createAuthedClient: () => h.sb }));
vi.mock("@/lib/audit", () => ({ audit: h.audit, auditChecked: async () => ({ ok: true }) }));
vi.mock("@/lib/auth", async (original) => ({
  ...await original<typeof import("@/lib/auth")>(),
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
}));
vi.mock("@/lib/session", async (original) => {
  const real = await original<typeof import("@/lib/session")>();
  return { ...real, requireSession: (...a: Parameters<typeof real.requireSession>) => (h.mockSession ? h.session(...a) : real.requireSession(...a)) };
});
vi.mock("@/lib/catering/refunds-shared", async (original) => {
  const real = await original<typeof import("@/lib/catering/refunds-shared")>();
  return {
    ...real,
    get REFUND_PARTS_BUILT() { return h.partsBuilt; },
    refundCreateBlock: (env: Record<string, string | undefined>, partsBuilt?: boolean) => real.refundCreateBlock(env, partsBuilt ?? h.partsBuilt),
  };
});
vi.mock("@/lib/catering/refunds", async (original) => {
  const real = await original<typeof import("@/lib/catering/refunds")>();
  const pick = <F extends (...a: never[]) => unknown>(mock: F, fn: F) => ((...a: Parameters<F>) => (h.mockLib ? mock(...a) : fn(...a))) as F;
  return {
    ...real,
    requestRefund: pick(h.request as unknown as typeof real.requestRefund, real.requestRefund),
    checkRefunds: pick(h.check as unknown as typeof real.checkRefunds, real.checkRefunds),
    releaseRefund: pick(h.release as unknown as typeof real.releaseRefund, real.releaseRefund),
    attachRefund: pick(h.attach as unknown as typeof real.attachRefund, real.attachRefund),
    loadRefundSummary: pick(h.summary as unknown as typeof real.loadRefundSummary, real.loadRefundSummary),
    loadLeadRefundables: pick(h.lead as unknown as typeof real.loadLeadRefundables, real.loadLeadRefundables),
  };
});

import { isStepUpSurface, requireSession, SESSION_COOKIE_NAME, unlockStepUp } from "@/lib/session";
import { CateringRefundError } from "@/lib/catering/refunds";
import { RefundsUnavailableError } from "@/lib/catering/refund-observe";
import { GET, POST, maxDuration as createMaxDuration } from "@/app/api/catering/quotes/[id]/refunds/route";
import { POST as CHECK } from "@/app/api/catering/quotes/[id]/refunds/check/route";
import { POST as RETRY } from "@/app/api/catering/quotes/[id]/refunds/[requestId]/retry/route";
import { POST as RELEASE } from "@/app/api/catering/quotes/[id]/refunds/[requestId]/release/route";
import { POST as ATTACH } from "@/app/api/catering/quotes/[id]/refunds/[requestId]/attach/route";
import { GET as LEAD_GET } from "@/app/api/catering/pipeline/[id]/refunds/route";
import { fakeSupabase, type FakeDb } from "./fake-supabase";
import { harnessKit as kit, refundClient, refundDb, type KitPayment, type KitWorld, type RefundCall } from "./helpers/refund-pglite";
import { status, stripeHttpFake, type StripeHttpFake } from "./stripe-http-fake";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const ORIGIN = "http://localhost";
const Q = "00000000-0000-4000-8000-0000000000b1";
const R = "00000000-0000-4000-8000-0000000000c1";
const TOKEN = "11111111-1111-4111-8111-111111111111";
const BODY = { clientToken: TOKEN, amountCents: 100000, seenRefundableCents: 100000, reasonCode: "event_lost", reasonNote: null, trigger: "lost" };
const RELEASE_BODY = { finding: "no_request", accountSlot: "location", livemode: false };
const ATTACH_BODY = { refundId: "re_fake_attach_1" };

const post = (path: string, body: unknown, origin: string | null = ORIGIN, extra: Record<string, string> = {}) =>
  new NextRequest(`${ORIGIN}${path}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...extra } });
const get = (path: string, extra: Record<string, string> = {}) => new NextRequest(`${ORIGIN}${path}`, { headers: extra });
const as = (role: string, fresh = true, id = "u1", locations: string[] = []) => {
  h.actor = { user: { id, role, active: true, language: "en" }, locations, session: { stepUpUnlocked: fresh, stepUpUnlockedAt: fresh ? new Date().toISOString() : null, catalogEditUnlockedAt: null } };
};
const answer = async (res: Response) => [res.status, ((await res.json()) as { code?: string }).code];
const qParams = (id = Q) => ({ params: Promise.resolve({ id }) });
const rParams = (id = Q, requestId = R) => ({ params: Promise.resolve({ id, requestId }) });

function resetMocks() {
  for (const f of [h.session, h.request, h.check, h.release, h.attach, h.summary, h.lead, h.audit]) f.mockReset();
  h.session.mockImplementation(async () => h.actor);
  h.request.mockResolvedValue({ kind: "pressed", rows: [] });
  h.check.mockResolvedValue([]);
  h.release.mockResolvedValue({ result: "released" });
  h.attach.mockResolvedValue({ result: "attached" });
  h.summary.mockResolvedValue({ quoteId: Q });
  h.lead.mockResolvedValue([]);
  h.mockSession = true;
  h.mockLib = true;
  h.partsBuilt = false;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ── 1. The gate order (mocked session, mocked lib) ─────────────────────────────────────────────────────────
describe("1. the gate order of every route", () => {
  const unauth = () => h.session.mockResolvedValueOnce(Response.json({ error: "unauthorized", code: "unauthorized" }, { status: 401 }));
  beforeEach(() => {
    resetMocks();
    vi.stubEnv("CATERING_REFUNDS", "1");
    vi.stubEnv("CATERING_REFUNDS_OBSERVE", "1");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("no network in the gate-order tests"); }));
    as("catering_mgr");
  });
  const libCalls = () => h.request.mock.calls.length + h.check.mock.calls.length + h.release.mock.calls.length + h.attach.mock.calls.length;

  type Mut = { name: string; path: string; call: (req: NextRequest) => Promise<Response>; good: unknown; lib: ReturnType<typeof vi.fn>; tier: boolean; roles: "refund" | "release" };
  const muts: Mut[] = [
    { name: "create", path: `/api/catering/quotes/${Q}/refunds`, call: (r) => POST(r, qParams()), good: BODY, lib: h.request, tier: true, roles: "refund" },
    { name: "check", path: `/api/catering/quotes/${Q}/refunds/check`, call: (r) => CHECK(r, qParams()), good: {}, lib: h.check, tier: false, roles: "refund" },
    { name: "retry", path: `/api/catering/quotes/${Q}/refunds/${R}/retry`, call: (r) => RETRY(r, rParams()), good: {}, lib: h.check, tier: false, roles: "refund" },
    { name: "release", path: `/api/catering/quotes/${Q}/refunds/${R}/release`, call: (r) => RELEASE(r, rParams()), good: RELEASE_BODY, lib: h.release, tier: true, roles: "release" },
    { name: "attach", path: `/api/catering/quotes/${Q}/refunds/${R}/attach`, call: (r) => ATTACH(r, rParams()), good: ATTACH_BODY, lib: h.attach, tier: true, roles: "release" },
  ];
  const allowedRole = (m: Mut) => (m.roles === "release" ? "moo" : "catering_mgr");

  describe.each(muts)("POST $name", (m) => {
    it("a cross-origin POST is 403 bad_origin before the session is read", async () => {
      const res = await m.call(post(m.path, m.good, "https://evil.test"));
      expect([res.status, await res.json()]).toEqual([403, { error: "bad_origin" }]);
      expect(h.session).not.toHaveBeenCalled();
      expect(libCalls()).toBe(0);
    });
    it("unauthenticated: the session's own 401, nothing else asked", async () => {
      unauth();
      expect(await answer(await m.call(post(m.path, m.good)))).toEqual([401, "unauthorized"]);
      expect(h.session).toHaveBeenCalledWith(expect.anything(), m.path); // the session on the route's OWN path
      expect(libCalls()).toBe(0);
    });
    it("switch off: 503 refunds_off BEFORE the body is read (a broken body still answers refunds_off); OBSERVE alone changes nothing", async () => {
      for (const observe of ["", "1"]) {
        vi.stubEnv("CATERING_REFUNDS", "");
        vi.stubEnv("CATERING_REFUNDS_OBSERVE", observe);
        as(allowedRole(m), true);
        const req = post(m.path, "{not json");
        const json = vi.spyOn(req, "json");
        expect(await answer(await m.call(req))).toEqual([503, "refunds_off"]);
        expect(json).not.toHaveBeenCalled();
      }
      expect(libCalls()).toBe(0);
    });
    it("a bad body is 400 by name, before the role and the password", async () => {
      as("employee", false);
      const bad = m.name === "create" ? { ...BODY, extra: 1 } : m.name === "release" ? { ...RELEASE_BODY, livemode: "no" } : m.name === "attach" ? { refundId: "x" } : { release: true };
      expect(await answer(await m.call(post(m.path, bad)))).toEqual([400, "invalid_request"]);
      expect(libCalls()).toBe(0);
    });
    it("an id that is not a uuid is 400 invalid_request", async () => {
      const bad = m.path.replace(Q, "not-a-uuid");
      const res = m.name === "create" ? await POST(post(bad, m.good), qParams("not-a-uuid"))
        : m.name === "check" ? await CHECK(post(bad, m.good), qParams("not-a-uuid"))
          : await (m.name === "retry" ? RETRY : m.name === "release" ? RELEASE : ATTACH)(post(bad, m.good), rParams("not-a-uuid"));
      expect(await answer(res)).toEqual([400, "invalid_request"]);
      expect(libCalls()).toBe(0);
    });
    it("the wrong role is 403 forbidden BEFORE the password is asked for (a fresh password does not change it)", async () => {
      const refused = m.roles === "release"
        ? ["gm", "agm", "catering_mgr", "prep_mgr", "social_media_mgr", "shift_lead", "employee"]
        : ["prep_mgr", "social_media_mgr", "shift_lead", "key_holder", "trainer", "employee"];
      for (const role of refused) {
        for (const fresh of [false, true]) {
          as(role, fresh);
          expect([role, ...await answer(await m.call(post(m.path, m.good)))]).toEqual([role, 403, "forbidden"]);
        }
      }
      expect(libCalls()).toBe(0);
    });
    it(m.tier ? "Tier B: no fresh password = step_up_required; a stale one = step_up_stale; nothing reaches the lib" : "no step-up: an allowed role without a password reaches the lib", async () => {
      as(allowedRole(m), false);
      if (m.tier) {
        expect(await answer(await m.call(post(m.path, m.good)))).toEqual([403, "step_up_required"]);
        h.actor = { ...(h.actor as object), session: { stepUpUnlocked: true, stepUpUnlockedAt: new Date(Date.now() - 10 * 60_000).toISOString(), catalogEditUnlockedAt: null } };
        expect(await answer(await m.call(post(m.path, m.good)))).toEqual([403, "step_up_stale"]);
        expect(libCalls()).toBe(0);
      } else {
        expect((await m.call(post(m.path, m.good))).status).toBe(200);
        expect(m.lib).toHaveBeenCalledTimes(1);
      }
    });
    it("with everything in order the lib is asked ONCE with the parsed body; the success body is the contract's", async () => {
      const roles = m.roles === "release" ? ["moo", "owner", "cgs"] : ["catering_mgr", "agm", "gm", "moo", "owner", "cgs"];
      for (const role of roles) {
        m.lib.mockClear();
        as(role, true);
        const res = await m.call(post(m.path, m.good));
        expect([role, res.status]).toEqual([role, 200]);
        expect(m.lib).toHaveBeenCalledTimes(1);
        const body = await res.json();
        if (m.name === "check" || m.name === "retry") expect(body).toEqual({ checks: [], summary: { quoteId: Q } });
        else expect(body).toEqual({ result: m.name === "create" ? { kind: "pressed", rows: [] } : { result: m.name === "release" ? "released" : "attached" }, summary: { quoteId: Q } });
      }
      const args = m.lib.mock.calls[0]!;
      if (m.name === "create") expect(args.slice(1)).toEqual([Q, { ...BODY, reasonNote: null }]);
      if (m.name === "check" || m.name === "retry") expect(args.slice(1)).toEqual([Q]);
      if (m.name === "release") expect(args.slice(1)).toEqual([Q, R, { ...RELEASE_BODY, note: null }]);
      if (m.name === "attach") expect(args.slice(1)).toEqual([Q, R, { ...ATTACH_BODY, note: null }]);
    });
    it("a lib refusal passes through by name, status and detail; a 409 carries a FRESH summary; unavailable is 503 by name", async () => {
      as(allowedRole(m), true);
      m.lib.mockRejectedValueOnce(new CateringRefundError(409, "figures_changed", { refundableCents: 500 }));
      h.summary.mockResolvedValueOnce({ quoteId: Q, fresh: true });
      const res = await m.call(post(m.path, m.good));
      expect([res.status, await res.json()]).toEqual([409, { error: "figures_changed", code: "figures_changed", refundableCents: 500, summary: { quoteId: Q, fresh: true } }]);
      // A summary that cannot be read is null, never a failed refusal.
      m.lib.mockRejectedValueOnce(new CateringRefundError(409, "stripe_unchecked", { paymentId: R }));
      h.summary.mockRejectedValueOnce(new Error("down"));
      const res2 = await m.call(post(m.path, m.good));
      expect([res2.status, await res2.json()]).toEqual([409, { error: "stripe_unchecked", code: "stripe_unchecked", paymentId: R, summary: null }]);
      // A non-409 refusal carries no summary (main's shape exactly).
      h.summary.mockClear();
      m.lib.mockRejectedValueOnce(new CateringRefundError(404, "not_found"));
      const res3 = await m.call(post(m.path, m.good));
      expect([res3.status, await res3.json()]).toEqual([404, { error: "not_found", code: "not_found" }]);
      expect(h.summary).not.toHaveBeenCalled();
      for (const e of [new CateringRefundError(503, "refunds_unavailable"), new RefundsUnavailableError("catering_refund_x")]) {
        m.lib.mockRejectedValueOnce(e);
        expect(await answer(await m.call(post(m.path, m.good)))).toEqual([503, "refunds_unavailable"]);
      }
    });
    it("an unknown error is NOT swallowed into a 2xx: it propagates (a 500)", async () => {
      as(allowedRole(m), true);
      m.lib.mockRejectedValueOnce(new Error("defect"));
      await expect(m.call(post(m.path, m.good))).rejects.toThrow("defect");
    });
  });

  it("release: the findings are refused by name before the role and the password (use_attach 409, unclear 400)", async () => {
    as("employee", false);
    const path = `/api/catering/quotes/${Q}/refunds/${R}/release`;
    expect(await answer(await RELEASE(post(path, { ...RELEASE_BODY, finding: "request_succeeded" }), rParams()))).toEqual([409, "use_attach"]);
    expect(await answer(await RELEASE(post(path, { ...RELEASE_BODY, finding: "unclear" }), rParams()))).toEqual([400, "finding_not_releasable"]);
    for (const bad of [{ ...RELEASE_BODY, accountSlot: "other" }, { finding: "no_request", accountSlot: "location" }, { ...RELEASE_BODY, extra: 1 }, { ...RELEASE_BODY, note: "x".repeat(501) }]) {
      expect(await answer(await RELEASE(post(path, bad), rParams()))).toEqual([400, "invalid_request"]);
    }
    expect(h.release).not.toHaveBeenCalled();
  });
  it("create: `other` without a note is note_required; a fractional amount is invalid_amount; seenRefundableCents is required", async () => {
    const path = `/api/catering/quotes/${Q}/refunds`;
    expect(await answer(await POST(post(path, { ...BODY, reasonCode: "other" }), qParams()))).toEqual([400, "note_required"]);
    expect(await answer(await POST(post(path, { ...BODY, amountCents: 1.5 }), qParams()))).toEqual([400, "invalid_amount"]);
    const noSeen = Object.fromEntries(Object.entries(BODY).filter(([key]) => key !== "seenRefundableCents"));
    expect(await answer(await POST(post(path, noSeen), qParams()))).toEqual([400, "invalid_request"]);
    expect(h.request).not.toHaveBeenCalled();
  });
  it("the create route has maxDuration 120 (the lib keeps 20 s of it back)", () => {
    expect(createMaxDuration).toBe(120);
  });

  describe("the GETs: session -> switch -> read floor -> id -> lib (stored state only)", () => {
    const qPath = `/api/catering/quotes/${Q}/refunds`;
    const lPath = `/api/catering/pipeline/${Q}/refunds`;
    it("the quote summary and the lead banner", async () => {
      unauth();
      expect(await answer(await GET(get(qPath), qParams()))).toEqual([401, "unauthorized"]);
      as("employee");
      expect(await answer(await GET(get(qPath), qParams()))).toEqual([403, "forbidden"]);
      as("shift_lead");
      expect([(await GET(get(qPath), qParams())).status]).toEqual([200]);
      expect(await (await LEAD_GET(get(lPath), qParams())).json()).toEqual({ quotes: [] });
      expect(await answer(await GET(get("/api/catering/quotes/x/refunds"), qParams("x")))).toEqual([400, "invalid_request"]);
      h.lead.mockRejectedValueOnce(new RefundsUnavailableError("catering_refund_summary"));
      expect(await answer(await LEAD_GET(get(lPath), qParams()))).toEqual([503, "refunds_unavailable"]);
      for (const observe of ["", "1"]) {
        vi.stubEnv("CATERING_REFUNDS", "");
        vi.stubEnv("CATERING_REFUNDS_OBSERVE", observe);
        expect(await answer(await GET(get(qPath), qParams()))).toEqual([503, "refunds_off"]);
        expect(await answer(await LEAD_GET(get(lPath), qParams()))).toEqual([503, "refunds_off"]);
      }
      expect(h.summary).toHaveBeenCalledTimes(1);
      expect(h.lead).toHaveBeenCalledTimes(2);
    });
    it("ON without OBSERVE: the GETs still read stored state (no refusal of their own)", async () => {
      vi.stubEnv("CATERING_REFUNDS_OBSERVE", "");
      as("shift_lead");
      expect((await GET(get(qPath), qParams())).status).toBe(200);
      expect((await LEAD_GET(get(lPath), qParams())).status).toBe(200);
    });
  });
});

describe("1b. the retry route can never send (static pin)", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  it("app/api/catering/quotes/[id]/refunds/[requestId]/retry/route.ts imports no sender and names none", () => {
    const src = strip(readFileSync("app/api/catering/quotes/[id]/refunds/[requestId]/retry/route.ts", "utf8"));
    expect(src).not.toMatch(/\bcreateRefund\b/);
    expect(src).not.toMatch(/\brequestRefund\b/);
    expect(src).not.toMatch(/\bretryRefundRequest\b/);
    expect(src).not.toMatch(/@\/lib\/stripe\//);
    const imported = [...src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"([^"]+)"/g)].map((m) => [m[2], m[1]!.split(",").map((x) => x.trim()).filter(Boolean).sort()]);
    expect(imported).toEqual([
      ["next/server", ["type NextRequest"]],
      ["@/lib/portal/csrf", ["assertSameOrigin"]],
      ["@/lib/session", ["requireSession"]],
      ["@/lib/api-helpers", ["jsonError", "jsonOk", "parseJsonBody"]],
      ["@/lib/catering/refunds", ["CateringRefundError", "canRequestRefund", "cateringRefundsOn", "checkRefunds", "isUuid", "loadRefundSummary", "parseCheckBody"]],
      ["@/lib/catering/refund-observe", ["RefundsUnavailableError"]],
    ]);
  });
  it("…and the check route the same", () => {
    const src = strip(readFileSync("app/api/catering/quotes/[id]/refunds/check/route.ts", "utf8"));
    for (const name of ["createRefund", "requestRefund", "retryRefundRequest"]) expect(src).not.toMatch(new RegExp(`\\b${name}\\b`));
    expect(src).not.toMatch(/@\/lib\/stripe\//);
  });
});

// ── 2. The real lib over the real SQL ─────────────────────────────────────────────────────────────────────
const KEY = "sk_test_fake_refund_routes_location_S1";

interface Real {
  db: PGlite;
  sb: SupabaseClient;
  calls: RefundCall[];
  stripe: StripeHttpFake;
  w: KitWorld;
  users: Record<"owner" | "moo" | "gm" | "catering_mgr" | "prep_mgr", string>;
}
async function realWorld(partsReady: boolean): Promise<Real> {
  const db = await refundDb({ partsReady });
  const w = await kit.world(db);
  await kit.observing(db);
  const calls: RefundCall[] = [];
  const sb = refundClient(db, { calls });
  const stripe = stripeHttpFake();
  stripe.account(KEY);
  const users = {
    owner: await w.user("owner", { member: null }),
    moo: await w.user("moo"),
    gm: await w.user("gm"),
    catering_mgr: await w.user("catering_mgr"),
    prep_mgr: await w.user("prep_mgr"),
  };
  return { db, sb, calls, stripe, w, users };
}
function enter(c: Real) {
  resetMocks();
  h.mockLib = false;
  h.sb = c.sb;
  c.calls.length = 0;
  vi.stubEnv("CATERING_REFUNDS", "1");
  vi.stubEnv("CATERING_REFUNDS_OBSERVE", "1");
  vi.stubEnv("STRIPE_SECRET_KEY__S1", KEY);
  vi.stubEnv("STRIPE_WEBHOOK_SECRET__S1", "whsec_fake_routes_s1");
  vi.stubGlobal("fetch", c.stripe.fetch);
}
const actAs = (c: Real, role: keyof Real["users"], fresh = true) => as(role, fresh, c.users[role], role === "owner" ? [] : [c.w.shop]);
async function paidOrder(c: Real, amount: number, opts: { atStripe?: boolean } = {}): Promise<{ quote: string; pay: KitPayment }> {
  const quote = await c.w.quote();
  const pay = await c.w.pay(quote, "full", amount);
  if (opts.atStripe !== false) c.stripe.world.addPaymentIntent({ id: pay.pi, account: KEY, chargeId: pay.charge, amountCaptured: amount });
  return { quote, pay };
}
const press = (quote: string, amount: number, token: string) =>
  POST(post(`/api/catering/quotes/${quote}/refunds`, { clientToken: token, amountCents: amount, seenRefundableCents: amount, reasonCode: "event_lost", reasonNote: null, trigger: "panel" }), qParams(quote));
const rpcNames = (c: Real) => c.calls.filter((x) => x.kind === "rpc").map((x) => x.name);

describe("2a. the real lib, B2 / B3 NOT in the database (only B1 applied)", () => {
  let c: Real;
  let order: { quote: string; pay: KitPayment };
  beforeAll(async () => {
    c = await realWorld(false);
    order = await paidOrder(c, 25_000);
  });
  beforeEach(() => enter(c));

  it("the panel GET reads stored state: 200 { summary }, ZERO Stripe calls, only F7 (and names) asked", async () => {
    actAs(c, "catering_mgr");
    const res = await GET(get(`/api/catering/quotes/${order.quote}/refunds`), qParams(order.quote));
    expect(res.status).toBe(200);
    const body = await res.json() as { summary: { quoteId: string; payments: Array<{ id: string; refundableCents: number | null }> } };
    expect(Object.keys(body)).toEqual(["summary"]);
    expect(body.summary.quoteId).toBe(order.quote);
    expect(body.summary.payments.map((p) => p.id)).toEqual([order.pay.id]);
    expect(body.summary.payments[0]!.refundableCents).toBeNull(); // never read: no figure
    expect(c.stripe.calls).toHaveLength(0);
    expect(rpcNames(c)).toEqual(["catering_refund_summary"]);
    const lead = await LEAD_GET(get(`/api/catering/pipeline/${Q}/refunds`), qParams(Q));
    expect(await lead.json()).toEqual({ quotes: [] });
    expect(c.stripe.calls).toHaveLength(0);
  });

  it("the BUILD gate: REFUND_PARTS_BUILT false = 503 refunds_not_activated, nothing asked of the database or Stripe", async () => {
    actAs(c, "catering_mgr");
    expect(await answer(await press(order.quote, 25_000, "22222222-2222-4222-8222-000000000001"))).toEqual([503, "refunds_not_activated"]);
    expect(c.calls).toEqual([]);
    expect(c.stripe.calls).toHaveLength(0);
  });

  it("the DATABASE gate: every part built, only B1 applied = 503 refunds_not_activated from F8, no GET, no POST, no row", async () => {
    h.partsBuilt = true;
    actAs(c, "catering_mgr");
    const res = await press(order.quote, 25_000, "22222222-2222-4222-8222-000000000002");
    expect(await answer(res)).toEqual([503, "refunds_not_activated"]);
    expect(rpcNames(c)).toEqual(["catering_refund_reserve_fresh"]);
    expect(c.stripe.calls).toHaveLength(0);
    expect(c.stripe.httpRequests("POST")).toBe(0);
    expect((await c.db.query("select count(*)::int as n from public.catering_refund_requests")).rows[0]).toEqual({ n: 0 });
  });

  it("ON without OBSERVE: create / check / retry / release / attach are 503 refunds_unavailable; the GET reads stored state; nothing reaches Stripe", async () => {
    vi.stubEnv("CATERING_REFUNDS_OBSERVE", "");
    h.partsBuilt = true;
    actAs(c, "owner");
    const q = order.quote;
    expect((await GET(get(`/api/catering/quotes/${q}/refunds`), qParams(q))).status).toBe(200);
    expect(await answer(await press(q, 25_000, "22222222-2222-4222-8222-000000000003"))).toEqual([503, "refunds_unavailable"]);
    expect(await answer(await CHECK(post(`/api/catering/quotes/${q}/refunds/check`, {}), qParams(q)))).toEqual([503, "refunds_unavailable"]);
    expect(await answer(await RETRY(post(`/api/catering/quotes/${q}/refunds/${R}/retry`, {}), rParams(q)))).toEqual([503, "refunds_unavailable"]);
    expect(await answer(await RELEASE(post(`/api/catering/quotes/${q}/refunds/${R}/release`, RELEASE_BODY), rParams(q)))).toEqual([503, "refunds_unavailable"]);
    expect(await answer(await ATTACH(post(`/api/catering/quotes/${q}/refunds/${R}/attach`, ATTACH_BODY), rParams(q)))).toEqual([503, "refunds_unavailable"]);
    expect(rpcNames(c)).toEqual(["catering_refund_summary"]); // the GET's F7 and nothing else
    expect(c.stripe.calls).toHaveLength(0);
  });

  it("Check: refund roles + shop; GETs only; { checks, summary }; a prep manager is refused; another shop's manager is 404", async () => {
    actAs(c, "catering_mgr");
    const res = await CHECK(post(`/api/catering/quotes/${order.quote}/refunds/check`, {}), qParams(order.quote));
    expect(res.status).toBe(200);
    const body = await res.json() as { checks: Array<Record<string, unknown>>; summary: { quoteId: string } };
    expect(body.checks).toEqual([{ paymentId: order.pay.id, result: "complete", reason: null, bound: 0 }]);
    expect(body.summary.quoteId).toBe(order.quote);
    expect(c.stripe.httpRequests("GET")).toBeGreaterThan(0);
    expect(c.stripe.httpRequests("POST")).toBe(0);
    actAs(c, "prep_mgr");
    expect(await answer(await CHECK(post(`/api/catering/quotes/${order.quote}/refunds/check`, {}), qParams(order.quote)))).toEqual([403, "forbidden"]);
    as("catering_mgr", true, c.users.catering_mgr, [c.w.other]);
    expect(await answer(await CHECK(post(`/api/catering/quotes/${order.quote}/refunds/check`, {}), qParams(order.quote)))).toEqual([404, "not_found"]);
    expect(c.stripe.httpRequests("POST")).toBe(0);
  });
});

describe("2b. the real lib, B2 / B3 in (the isolated fixture), every part built", () => {
  let c: Real;
  beforeAll(async () => { c = await realWorld(true); });
  beforeEach(() => { enter(c); h.partsBuilt = true; });

  it("[S11] a press whose read does not end complete: 409 stripe_unchecked WITH a fresh summary; nothing reserved, nothing POSTed", async () => {
    const order = await paidOrder(c, 12_000, { atStripe: false }); // Stripe does not know the PaymentIntent: the read is not complete
    actAs(c, "gm");
    const res = await press(order.quote, 12_000, "33333333-3333-4333-8333-000000000001");
    expect(res.status).toBe(409);
    const body = await res.json() as { code: string; error: string; summary: { quoteId: string } | null };
    expect(body.code).toBe("stripe_unchecked");
    expect(body.summary?.quoteId).toBe(order.quote);
    expect(rpcNames(c).filter((n) => n === "catering_refund_reserve_fresh")).toHaveLength(2); // probe, then ONE reserve [R7]
    expect(rpcNames(c)).not.toContain("catering_refund_arm");
    expect(c.stripe.httpRequests("POST")).toBe(0);
    expect((await c.db.query("select count(*)::int as n from public.catering_refund_requests r join public.catering_payments p on p.id = r.payment_id where p.quote_id = $1", [order.quote])).rows[0]).toEqual({ n: 0 });
  });

  describe("an unconfirmed request (the ONE POST answered 500), then the retry route, Attach and Release", () => {
    let attachOrder: { quote: string; pay: KitPayment };
    let releaseOrder: { quote: string; pay: KitPayment };
    let attachReq: string;
    let releaseReq: string;
    const requestOf = async (payment: string) =>
      (await c.db.query<{ id: string }>("select id from public.catering_refund_requests where payment_id = $1", [payment])).rows[0]!.id;

    beforeAll(async () => {
      enter(c);
      h.partsBuilt = true;
      attachOrder = await paidOrder(c, 7_000);
      releaseOrder = await paidOrder(c, 9_000);
      actAs(c, "catering_mgr");
      for (const [o, token] of [[attachOrder, "44444444-4444-4444-8444-000000000001"], [releaseOrder, "44444444-4444-4444-8444-000000000002"]] as const) {
        c.stripe.script("create", status(500));
        const res = await press(o.quote, o.pay.amount, token);
        expect(res.status).toBe(200);
        const body = await res.json() as { result: { kind: string; rows: Array<{ outcome: string; posted: boolean }> }; summary: unknown };
        expect(body.result.kind).toBe("pressed");
        expect(body.result.rows.map((r) => [r.outcome, r.posted])).toEqual([["unconfirmed", true]]);
        expect(body.summary).not.toBeNull();
      }
      expect(c.stripe.httpRequests("POST")).toBe(2);
      attachReq = await requestOf(attachOrder.pay.id);
      releaseReq = await requestOf(releaseOrder.pay.id);
    });

    it("the retry route on an unconfirmed request NEVER POSTs: it checks (GETs only) and answers { checks, summary }", async () => {
      const posts = c.stripe.httpRequests("POST");
      const gets = c.stripe.httpRequests("GET");
      actAs(c, "catering_mgr", false); // no password: the retry path takes no tier
      const res = await RETRY(post(`/api/catering/quotes/${attachOrder.quote}/refunds/${attachReq}/retry`, {}), rParams(attachOrder.quote, attachReq));
      expect(res.status).toBe(200);
      const body = await res.json() as { checks: Array<{ paymentId: string; result: string }>; summary: { requests: Array<{ id: string; view: string }> } };
      expect(body.checks.map((x) => x.paymentId)).toEqual([attachOrder.pay.id]);
      expect(body.summary.requests.find((r) => r.id === attachReq)?.view).toBe("unconfirmed");
      expect(c.stripe.httpRequests("POST")).toBe(posts);
      expect(c.stripe.httpRequests("GET")).toBeGreaterThan(gets);
      // The body is {} exactly: main's { release: true } is now invalid, and nothing is asked.
      expect(await answer(await RETRY(post(`/api/catering/quotes/${attachOrder.quote}/refunds/${attachReq}/retry`, { release: true }), rParams(attachOrder.quote, attachReq)))).toEqual([400, "invalid_request"]);
      expect(c.stripe.httpRequests("POST")).toBe(posts);
      expect(await kit.requestRow(c.db, attachReq)).toMatchObject({ status: "pending", stripe_refund_id: null });
    });

    it("Attach: a GM is refused by role; the read must be fresh and known; a refund that is not attachable is refused; the retrieved one attaches; nothing POSTed", async () => {
      const path = `/api/catering/quotes/${attachOrder.quote}/refunds/${attachReq}/attach`;
      const ctx = rParams(attachOrder.quote, attachReq);
      const posts = c.stripe.httpRequests("POST");
      actAs(c, "gm");
      expect(await answer(await ATTACH(post(path, ATTACH_BODY), ctx))).toEqual([403, "forbidden"]);
      actAs(c, "moo", false);
      expect(await answer(await ATTACH(post(path, ATTACH_BODY), ctx))).toEqual([403, "step_up_required"]);
      actAs(c, "moo");
      // Within 5 minutes of the arm's own stamp the payment is not known: figures_stale, with a fresh summary.
      const stale = await ATTACH(post(path, ATTACH_BODY), ctx);
      const staleBody = await stale.json() as { code: string; summary: { quoteId: string } | null };
      expect([stale.status, staleBody.code, staleBody.summary?.quoteId]).toEqual([409, "figures_stale", attachOrder.quote]);
      await kit.elapse(c.db, "6 minutes");
      // The refund DID land at Stripe, with no metadata (nothing can bind it by itself) [Q4].
      const landed = c.stripe.world.addRefund({ paymentIntentId: attachOrder.pay.pi, amount: attachOrder.pay.amount, created: Math.floor(Date.now() / 1000) });
      expect(await answer(await ATTACH(post(path, { refundId: "re_fake_not_there" }), ctx))).toEqual([409, "refund_not_attachable"]);
      await kit.elapse(c.db, "6 minutes");
      const ok = await ATTACH(post(path, { refundId: landed.id, note: "seen in the request log" }), ctx);
      expect(ok.status).toBe(200);
      const body = await ok.json() as { result: Record<string, unknown>; summary: { requests: Array<{ id: string; view: string }> } };
      expect(body.result).toMatchObject({ result: "attached", requestId: attachReq, paymentId: attachOrder.pay.id, refundId: landed.id });
      expect(body.summary.requests.find((r) => r.id === attachReq)?.view).toBe("bound");
      expect(await kit.requestRow(c.db, attachReq)).toMatchObject({ status: "submitted", stripe_refund_id: landed.id });
      const audit = (await c.db.query<{ action: string; metadata: Record<string, unknown> }>("select action, metadata from public.audit_log where resource_id = $1 and action like 'catering.refund.%'", [attachReq])).rows;
      expect(audit.map((a) => a.action)).toContain("catering.refund.attach");
      expect(c.stripe.httpRequests("POST")).toBe(posts);
    });

    it("Release: a GM refused; before 24 h not_releasable_yet (with releasableAt); the account and the mode must be the ones the read resolved; then released; nothing POSTed", async () => {
      const path = `/api/catering/quotes/${releaseOrder.quote}/refunds/${releaseReq}/release`;
      const ctx = rParams(releaseOrder.quote, releaseReq);
      const posts = c.stripe.httpRequests("POST");
      actAs(c, "gm");
      expect(await answer(await RELEASE(post(path, RELEASE_BODY), ctx))).toEqual([403, "forbidden"]);
      actAs(c, "moo");
      const early = await RELEASE(post(path, RELEASE_BODY), ctx);
      const earlyBody = await early.json() as { code: string; releasableAt?: string; summary: unknown };
      expect([early.status, earlyBody.code]).toEqual([409, "not_releasable_yet"]);
      expect(earlyBody.releasableAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(earlyBody.summary).not.toBeNull();
      // 24 hours later. The sweep's claim is then stale: the next claim resumes (every payment dirty), 6 minutes pass.
      await kit.elapse(c.db, "25 hours");
      expect((await kit.rpc(c.db, "catering_refund_sweep_begin", [50])).claimed).toBe(true);
      await kit.elapse(c.db, "6 minutes");
      // The findings the person may not release with are refused by name before the database is asked.
      expect(await answer(await RELEASE(post(path, { ...RELEASE_BODY, finding: "request_succeeded" }), ctx))).toEqual([409, "use_attach"]);
      expect(await answer(await RELEASE(post(path, { ...RELEASE_BODY, finding: "unclear" }), ctx))).toEqual([400, "finding_not_releasable"]);
      // The other account, or the other mode, than the one the read resolved (this shop's own, test mode).
      expect(await answer(await RELEASE(post(path, { ...RELEASE_BODY, accountSlot: "default" }), ctx))).toEqual([409, "wrong_account"]);
      await kit.elapse(c.db, "6 minutes");
      expect(await answer(await RELEASE(post(path, { ...RELEASE_BODY, livemode: true }), ctx))).toEqual([409, "wrong_account"]);
      await kit.elapse(c.db, "6 minutes");
      const ok = await RELEASE(post(path, { ...RELEASE_BODY, finding: "request_failed" }), ctx);
      expect(ok.status).toBe(200);
      const body = await ok.json() as { result: Record<string, unknown>; summary: { requests: Array<{ id: string; view: string }> } };
      expect(body.result).toMatchObject({ result: "released", requestId: releaseReq, paymentId: releaseOrder.pay.id, refundId: null });
      expect(body.summary.requests.find((r) => r.id === releaseReq)?.view).toBe("released");
      expect(await kit.requestRow(c.db, releaseReq)).toMatchObject({ status: "failed", last_error_code: "released_no_refund" });
      const audit = (await c.db.query<{ metadata: Record<string, unknown> }>("select metadata from public.audit_log where resource_id = $1 and action = 'catering.refund.release'", [releaseReq])).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0]!.metadata).toMatchObject({ finding: "request_failed", account_slot: "location", livemode: false });
      expect(String(audit[0]!.metadata.credential_fp)).toMatch(/^[0-9a-f]{16}$/);
      expect(JSON.stringify(audit)).not.toContain(KEY);
      expect(c.stripe.httpRequests("POST")).toBe(posts);
    });
  });
});

// ── 3. The password unlock survives until the confirm ─────────────────────────────────────────────────────
describe("3. the password unlock survives until the confirm / release / attach (the REAL lib/session.ts rule)", () => {
  const paths = {
    create: `/api/catering/quotes/${Q}/refunds`,
    release: `/api/catering/quotes/${Q}/refunds/${R}/release`,
    attach: `/api/catering/quotes/${Q}/refunds/${R}/attach`,
    check: `/api/catering/quotes/${Q}/refunds/check`,
    retry: `/api/catering/quotes/${Q}/refunds/${R}/retry`,
    lead: `/api/catering/pipeline/${Q}/refunds`,
  };
  let fake: FakeDb;
  const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
  const row = () => (fake.tables.sessions as Array<Record<string, unknown>>)[0]!;
  const visit = async (path: string) => {
    const ctx = await requireSession(new NextRequest(`${ORIGIN}${path}`, { headers: cookie }), path);
    if (ctx instanceof Response) throw new Error(`denied on ${path}`);
  };

  beforeEach(() => {
    resetMocks();
    h.mockSession = false; // the REAL requireSession
    vi.stubEnv("CATERING_REFUNDS", "1");
    vi.stubEnv("CATERING_REFUNDS_OBSERVE", "1");
    const now = new Date().toISOString();
    fake = fakeSupabase({
      sessions: [{ id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password", step_up_unlocked: false, step_up_unlocked_at: null,
        catalog_edit_unlocked_at: null, created_at: now, last_activity_at: now, expires_at: new Date(Date.now() + 3_600_000).toISOString(), revoked_at: null, ip_address: null, user_agent: null }],
      users: [{ id: "user-1", name: "Ops", email: "ops@example.test", role: "moo", active: true, language: "en" }],
      user_locations: [],
    });
    h.sb = fake.client;
  });

  it("the three Tier B paths are step-up surfaces; Check, the retry route and the lead GET are not; nothing else under a quote is admitted", () => {
    for (const p of [paths.create, paths.release, paths.attach]) expect([p, isStepUpSurface(p)]).toEqual([p, true]);
    for (const p of [paths.check, paths.retry, paths.lead]) expect([p, isStepUpSurface(p)]).toEqual([p, false]);
    for (const p of [`${paths.create}x`, `${paths.release}x`, `${paths.attach}/x`, `/api/catering/quotes/${Q}/refunds/${R}`, `/api/catering/quotes/${Q}/refunds/${R}/x/release`,
      `/api/catering/quotes/${Q}/refunds/${R}/releases`, `/api/catering/quotes/${Q}/xrefunds/${R}/release`, `/api/catering/pipeline/${Q}/refunds/${R}/release`]) {
      expect([p, isStepUpSurface(p)]).toEqual([p, false]);
    }
  });

  it("the rule itself: the unlock is KEPT by the Tier B paths (and the panel GET, the same path as the confirm) and CLEARED by Check, retry and the lead GET", async () => {
    for (const p of [paths.create, paths.release, paths.attach]) {
      await unlockStepUp("session-1");
      await visit(p);
      expect([p, row().step_up_unlocked]).toEqual([p, true]);
    }
    for (const p of [paths.check, paths.retry, paths.lead]) {
      await unlockStepUp("session-1");
      await visit(p);
      expect([p, row().step_up_unlocked]).toEqual([p, false]);
    }
  });

  it.each([["create", BODY], ["release", RELEASE_BODY], ["attach", ATTACH_BODY]] as const)(
    "%s: password then confirm reaches the lib through the route's OWN requireSession; a Check in between costs the password (step_up_required)",
    async (name, body) => {
      const call = (req: NextRequest) => (name === "create" ? POST(req, qParams()) : name === "release" ? RELEASE(req, rParams()) : ATTACH(req, rParams()));
      const lib = name === "create" ? h.request : name === "release" ? h.release : h.attach;
      await unlockStepUp("session-1");
      const res = await call(post(paths[name], body, ORIGIN, cookie));
      expect(res.status).toBe(200);
      expect(lib).toHaveBeenCalledTimes(1);
      expect(row().step_up_unlocked).toBe(true);
      // The panel must call nothing between the unlock and the act: a Check does clear it.
      await unlockStepUp("session-1");
      const between = await CHECK(post(paths.check, {}, ORIGIN, cookie), qParams());
      expect(between.status).toBe(200);
      expect(row().step_up_unlocked).toBe(false);
      expect(await answer(await call(post(paths[name], body, ORIGIN, cookie)))).toEqual([403, "step_up_required"]);
      expect(lib).toHaveBeenCalledTimes(1);
    },
  );
});

afterAll(() => {
  h.sb = null;
});
