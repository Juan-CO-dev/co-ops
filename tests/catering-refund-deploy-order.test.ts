/**
 * Refund round 2, Part A — BOTH deploy orders (plan A2: "Deploy order is safe both ways … Nothing opens until both
 * are in"). The permission has two homes: the app's role list (`REFUND_ROLES` / `canRequestRefund`,
 * lib/catering/refunds-shared.ts) and the SQL actor rule (`catering_refund_actor_ok`, re-emitted by migration 0358).
 * This file runs the REAL lib and the REAL routes over the four combinations for a GM / AGM who is an active member of
 * the order's shop:
 *
 *   app      SQL rule   what happens
 *   old      0357       refused by the app before the database is asked          (main today)
 *   old      0358       refused by the app before the database is asked          (the migration applied first)
 *   new      0357       the app lets it through; the reserve answers `forbidden`  (the app deployed first)  → 403
 *   new      0358       the reserve is reached and does not refuse the actor      (both in)
 *
 * THE OLD APP is modelled by replacing ONE function — the app's role gate — with main's four-role list; every other
 * line under test is this branch's. That list is pinned equal to 0357's own roles (what main's gate was held to).
 * THE NEW APP is the REAL gate, untouched: with nothing switched the mock hands every call to the module's own
 * `canRequestRefund` (review, Astra P3: a re-implemented "new" gate could admit someone the real one refuses).
 * THE SQL RULE is the same TS stand-in tests/catering-refunds-flow.test.ts uses, pinned there and here to the two
 * real files; the real SQL of each rule is proven by scripts/sql-harness-0357.mjs and scripts/sql-harness-0358.mjs.
 * Stripe is never reachable from this file: every Stripe function throws.
 *
 * PART B1 (migration 0359) ADAPTATION. The new lib reaches the database through 0359's protected functions only
 * (`catering_refund_epoch_state`, `catering_refund_reserve_admitted`, `catering_refund_summary`,
 * `catering_refund_claim_admitted`), and 0359's pre-flight refuses a database without 0358's actor rule. So the row
 * "new app + 0357" can no longer reach a reserve that asks 0357's rule: on a database without 0359 (0357 alone, or
 * 0357 + 0358) the new app finds no epoch / no stored summary and answers 503 `refunds_unavailable` before any reserve,
 * claim, write or Stripe call — still "nothing opens until both are in". That is what the route-level rows below now
 * pin for "0357". The 0357 ACTOR RULE itself (gm / agm refused at the shop) is kept as a PURE-RULE case over the SQL
 * stand-in, pinned to the real 0357 file (see "the two models are the real things" and the pure-rule case below);
 * the real SQL is proven by scripts/sql-harness-0357.mjs / -0358.mjs / -0359.mjs. "0358" here = 0358 with 0359 on top.
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeDb } from "./fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeDb,
  /** null = this branch's list; an array = the OLD app's list. */
  appRoles: null as readonly string[] | null,
  sqlRule: "0358" as "0357" | "0358",
  rpcCalls: [] as string[],
  stripeCalls: 0,
  actor: null as unknown,
  session: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/session", async (original) => ({ ...await original<typeof import("@/lib/session")>(), requireSession: h.session }));
vi.mock("@/lib/stripe/session-owner", () => ({ stripeAccountsForShop: () => { h.stripeCalls += 1; throw new Error("no Stripe call is expected in this file"); } }));
vi.mock("@/lib/stripe/client", async (original) => {
  const real = await original<typeof import("@/lib/stripe/client")>();
  const never = async () => { h.stripeCalls += 1; throw new Error("no Stripe call is expected in this file"); };
  return { ...real, createRefund: never, listRefundsForPaymentIntent: never, retrievePaymentIntentCharge: never, retrieveRefund: never };
});
vi.mock("@/lib/catering/refunds-shared", async (original) => {
  const real = await original<typeof import("@/lib/catering/refunds-shared")>();
  // OLD app: main's list. NEW app: the module's OWN function, called as it is (never a copy of its rule).
  return { ...real, canRequestRefund: (role: RoleCode) => (h.appRoles ? h.appRoles.includes(role) : real.canRequestRefund(role)) };
});

import { REFUND_ROLES, actorMayRefund, canRequestRefund, requestRefund, retryRefundRequest, type RefundRequestBody } from "@/lib/catering/refunds";
import { POST } from "@/app/api/catering/quotes/[id]/refunds/route";
import { POST as RETRY } from "@/app/api/catering/quotes/[id]/refunds/[requestId]/retry/route";
import type { AuthContext } from "@/lib/session";
import { ROLES, type RoleCode } from "@/lib/roles";

/** Main's app gate before this PR (and 0357's rule: pinned below). */
const OLD_APP_ROLES = ["catering_mgr", "moo", "owner", "cgs"] as const;
const SQL_ANY_SHOP = ["owner", "cgs"];
const SQL_MEMBER_SHOP = { "0357": ["moo", "catering_mgr"], "0358": ["moo", "catering_mgr", "gm", "agm"] } as const;

const ORIGIN = "http://localhost";
const SHOP = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const QUOTE = "00000000-0000-4000-8000-0000000000b1";
const REQUEST = "00000000-0000-4000-8000-0000000000d1";
const PAYMENT = "00000000-0000-4000-8000-0000000000c1";
const ACTOR = "00000000-0000-4000-8000-0000000000aa";
const EPOCH = "00000000-0000-4000-8000-0000000000e0";
const MISSING = (fn: string) => ({ data: null, error: { message: `Could not find the function public.${fn}`, code: "PGRST202" } });
const BODY: RefundRequestBody = { clientToken: "11111111-1111-4111-8111-111111111111", amountCents: 100000, reasonCode: "event_lost", reasonNote: null, trigger: "lost" };

function sqlActorOk(db: FakeDb, actorId: unknown, shopId: unknown): boolean {
  const u = (db.tables.users ?? []).find((x) => x.id === actorId);
  if (!u || u.active !== true) return false; // SQL: `and u.active` — NULL is not active
  const role = String(u.role);
  if (SQL_ANY_SHOP.includes(role)) return true;
  return (SQL_MEMBER_SHOP[h.sqlRule] as readonly string[]).includes(role) && shopId != null
    && (db.tables.user_locations ?? []).some((m) => m.user_id === actorId && m.location_id === shopId && m.active === true);
}

/** A signed-in member of `locations`, the database agreeing with the session. `fresh` = a password typed just now. */
function actor(role: string, locations: string[] = [SHOP], fresh = true): AuthContext {
  h.db.tables.users = [{ id: ACTOR, role, name: "Kim", active: true }];
  h.db.tables.user_locations = locations.map((location_id) => ({ user_id: ACTOR, location_id, active: true }));
  const ctx = {
    user: { id: ACTOR, role, active: true, language: "en", name: "Kim" }, locations,
    session: { stepUpUnlocked: fresh, stepUpUnlockedAt: fresh ? new Date().toISOString() : null, catalogEditUnlockedAt: null },
  } as unknown as AuthContext;
  h.actor = ctx;
  return ctx;
}

const post = (path: string, body: unknown) =>
  new NextRequest(`${ORIGIN}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: ORIGIN } });
const confirmPath = `/api/catering/quotes/${QUOTE}/refunds`;
const retryPath = `${confirmPath}/${REQUEST}/retry`;
const confirm = () => POST(post(confirmPath, BODY), { params: Promise.resolve({ id: QUOTE }) });
const retry = (body: unknown = {}) => RETRY(post(retryPath, body), { params: Promise.resolve({ id: QUOTE, requestId: REQUEST }) });
const answer = async (res: Response) => [res.status, ((await res.json()) as { code?: string }).code];

beforeEach(() => {
  vi.stubEnv("CATERING_REFUNDS", "1");
  h.db = fakeSupabase(
    {
      catering_quotes: [{ id: QUOTE, location_id: SHOP, root_id: null }],
      // One Stripe-paid payment and one request someone else left pending: what Retry / Release act on.
      catering_payments: [{ id: PAYMENT, quote_id: QUOTE, kind: "deposit", amount_cents: 30000, status: "paid", provider: "stripe", provider_ref: "pi_dep", paid_at: "2026-11-01T10:00:00Z", created_at: "2026-11-01T09:00:00Z" }],
      catering_refund_requests: [{
        id: REQUEST, payment_id: PAYMENT, quote_id: QUOTE, location_id: SHOP, client_token: "33333333-3333-4333-8333-333333333333", amount_cents: 2000,
        reason_code: "event_lost", reason_note: null, trigger_kind: "lost", status: "pending", stripe_refund_id: null, stripe_status: null, last_error_code: "network_error",
        last_error_message: null, attempts: 1, first_attempt_at: new Date().toISOString(), requested_by: "00000000-0000-4000-8000-0000000000ab",
        requested_at: new Date().toISOString(), updated_at: new Date().toISOString(), settled_at: null, claim_token: null, claimed_until: null,
      }],
      users: [], user_locations: [],
    },
    {
      // 0359's protected functions exist only on top of 0358 (0359's pre-flight refuses a database without it): under
      // the "0357" model they are MISSING, exactly as PostgREST answers a function it cannot find.
      catering_refund_epoch_state: () => (h.sqlRule === "0357" ? MISSING("catering_refund_epoch_state") : { data: { state: "live", epoch_id: EPOCH, caller_ok: true }, error: null }),
      catering_refund_summary: (args) => (h.sqlRule === "0357" ? MISSING("catering_refund_summary") : {
        data: { epoch: { state: "live", epoch_id: EPOCH, caller_ok: true }, quotes: (args.p_quote_ids as string[]).includes(QUOTE) ? [{ quote_id: QUOTE, location_id: SHOP, payments: [{ id: PAYMENT }], requests: [], issues: [] }] : [] },
        error: null,
      }),
      // The reserve as far as this file needs it: the actor rule first (as 0357 / 0358 / 0359 order it), then "nothing to refund".
      catering_refund_reserve_admitted: (args, db) => (h.sqlRule === "0357" ? MISSING("catering_refund_reserve_admitted") : { data: null, error: { message: sqlActorOk(db, args.p_actor_id, SHOP) ? "nothing_refundable" : "forbidden" } }),
      catering_refund_actor_ok: (args, db) => ({ data: sqlActorOk(db, args.p_actor_id, args.p_shop_id), error: null }),
    },
  );
  const client = h.db.client as unknown as { rpc: (name: string, args: Record<string, unknown>) => unknown };
  const rpc = client.rpc;
  client.rpc = (name, args) => { h.rpcCalls.push(name); return rpc(name, args); };
  h.rpcCalls = [];
  h.stripeCalls = 0;
  h.appRoles = null;
  h.sqlRule = "0358";
  h.session.mockReset();
  h.session.mockImplementation(async () => h.actor);
});
afterEach(() => vi.unstubAllEnvs());

describe("the two models are the real things", () => {
  const sqlLists = (file: string) => {
    const code = readFileSync(`supabase/migrations/${file}`, "utf8").replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
    const fn = code.match(/function public\.catering_refund_actor_ok\([\s\S]*?\nend \$\$;/);
    if (!fn) throw new Error(`catering_refund_actor_ok not found in ${file}`);
    return [...fn[0].matchAll(/v_role in \(([^)]*)\)/g)].map((m) => [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!));
  };
  it("the SQL stand-in's lists are the two files' own", () => {
    expect(sqlLists("0357_catering_refund_requests.sql")).toEqual([SQL_ANY_SHOP, [...SQL_MEMBER_SHOP["0357"]]]);
    expect(sqlLists("0358_catering_refund_roles.sql")).toEqual([SQL_ANY_SHOP, [...SQL_MEMBER_SHOP["0358"]]]);
  });
  it("the OLD app's list is 0357's roles (what main's gate was pinned to), and the NEW list adds exactly gm and agm", () => {
    expect([...OLD_APP_ROLES].sort()).toEqual(sqlLists("0357_catering_refund_requests.sql").flat().sort());
    expect([...REFUND_ROLES].sort()).toEqual([...OLD_APP_ROLES, "gm", "agm"].sort());
    // With nothing switched the gate under test is the module's own function (see the mock): every role, against the
    // list the module exports.
    for (const role of Object.keys(ROLES) as RoleCode[]) {
      expect([role, canRequestRefund(role)]).toEqual([role, (REFUND_ROLES as readonly string[]).includes(role)]);
    }
    h.appRoles = OLD_APP_ROLES;
    expect([canRequestRefund("gm"), canRequestRefund("agm"), canRequestRefund("catering_mgr")]).toEqual([false, false, true]);
  });
});

describe.each(["gm", "agm"] as const)("a member %s, app x SQL", (role) => {
  it.each([["0357"], ["0358"]] as const)("OLD app + %s: refused by the app (403) before the database or Stripe is asked", async (sqlRule) => {
    h.appRoles = OLD_APP_ROLES;
    h.sqlRule = sqlRule;
    const a = actor(role);
    // Under 0358 the database WOULD say yes; under 0357 it would say no. Either way it is not asked.
    expect(sqlActorOk(h.db, ACTOR, SHOP)).toBe(sqlRule === "0358");
    expect(actorMayRefund(a, SHOP)).toBe(false);
    await expect(requestRefund(a, QUOTE, BODY)).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(retryRefundRequest(a, QUOTE, REQUEST)).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(retryRefundRequest(a, QUOTE, REQUEST, Date.now(), "release")).rejects.toMatchObject({ status: 403, code: "forbidden" });
    // The routes: refused by role BEFORE the password is asked for (a stale unlock still answers `forbidden`).
    expect(await answer(await confirm())).toEqual([403, "forbidden"]);
    actor(role, [SHOP], false);
    expect(await answer(await confirm())).toEqual([403, "forbidden"]);
    expect(await answer(await retry())).toEqual([403, "forbidden"]);
    expect(await answer(await retry({ release: true }))).toEqual([403, "forbidden"]);
    expect(h.rpcCalls).toEqual([]);
    expect(h.stripeCalls).toBe(0);
    expect(h.db.writes).toEqual([]);
  });

  it("NEW app + 0357 (the app deployed first; no 0359): refused 503 refunds_unavailable before any reserve; nothing written, nothing sent", async () => {
    h.sqlRule = "0357";
    const a = actor(role);
    expect(actorMayRefund(a, SHOP)).toBe(true);
    await expect(requestRefund(a, QUOTE, BODY)).rejects.toMatchObject({ status: 503, code: "refunds_unavailable" });
    expect(h.rpcCalls).toEqual(["catering_refund_epoch_state"]);
    // Through the route, with the password typed: the same 503 by name; the reserve is never asked.
    h.rpcCalls = [];
    expect(await answer(await confirm())).toEqual([503, "refunds_unavailable"]);
    expect(h.rpcCalls).toEqual(["catering_refund_epoch_state"]);
    // …and without the password the route stops at Tier B, like any refunder (the database is not asked).
    h.rpcCalls = [];
    actor(role, [SHOP], false);
    expect(await answer(await confirm())).toEqual([403, "step_up_required"]);
    expect(h.rpcCalls).toEqual([]);
    expect(h.stripeCalls).toBe(0);
    expect(h.db.writes).toEqual([]);
  });

  it("NEW app + 0357 (no 0359), Retry and Release THROUGH THE ROUTE: no stored summary → 503 refunds_unavailable before the actor re-check or any claim; nothing claimed, written or sent", async () => {
    h.sqlRule = "0357";
    for (const body of [{}, { release: true }, { release: true, staffVerified: true }]) {
      h.rpcCalls = [];
      actor(role, [SHOP], false); // the retry path asks for no password
      expect(await answer(await retry(body))).toEqual([503, "refunds_unavailable"]);
      expect(h.rpcCalls).toEqual(["catering_refund_summary"]); // catering_refund_claim_admitted never reached
    }
    expect(h.stripeCalls).toBe(0);
    expect(h.db.writes).toEqual([]);
    expect(h.db.tables.catering_refund_requests![0]).toMatchObject({ status: "pending", attempts: 1, claim_token: null });
    // The control for this test: under 0358 (+ 0359) the same press gets PAST the SQL re-check (it then reaches the
    // sender claim, which this file does not model: the fake throws by name).
    h.sqlRule = "0358";
    h.rpcCalls = [];
    actor(role, [SHOP], false);
    await expect(retry()).rejects.toThrow(/no fake for rpc catering_refund_claim_admitted/);
    expect(h.rpcCalls).toEqual(["catering_refund_summary", "catering_refund_actor_ok", "catering_refund_claim_admitted"]);
    expect(h.stripeCalls).toBe(0);
  });

  it("NEW app + 0358 (both in): the actor passes both homes; the reserve is reached and refuses nothing about WHO", async () => {
    const a = actor(role);
    expect(actorMayRefund(a, SHOP)).toBe(true);
    // The stand-in reserve has nothing to refund on this empty order: 409, not 403. The actor was accepted.
    await expect(requestRefund(a, QUOTE, BODY)).rejects.toMatchObject({ status: 409, code: "nothing_refundable" });
    expect(h.rpcCalls).toEqual(["catering_refund_epoch_state", "catering_refund_reserve_admitted"]);
    expect(await answer(await confirm())).toEqual([409, "nothing_refundable"]);
    expect(h.stripeCalls).toBe(0);
  });

  it("both in, but NOT a member of the order's shop: 404 from the app (and the SQL rule would refuse too)", async () => {
    const a = actor(role, [OTHER]);
    expect(sqlActorOk(h.db, ACTOR, SHOP)).toBe(false);
    expect(actorMayRefund(a, SHOP)).toBe(false);
    await expect(requestRefund(a, QUOTE, BODY)).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(await answer(await confirm())).toEqual([404, "not_found"]);
    expect(h.rpcCalls).toEqual([]);
  });

  it("PURE RULE (no longer expressible through the route: the B1 app needs 0359, which needs 0358): 0357's actor rule refuses a member gm / agm at the shop, 0358's admits them", () => {
    actor(role);
    h.sqlRule = "0357";
    expect(sqlActorOk(h.db, ACTOR, SHOP)).toBe(false);
    h.sqlRule = "0358";
    expect(sqlActorOk(h.db, ACTOR, SHOP)).toBe(true);
    // ...and neither admits a non-member, nor an inactive user.
    expect(sqlActorOk(h.db, ACTOR, OTHER)).toBe(false);
    h.db.tables.users![0]!.active = false;
    expect(sqlActorOk(h.db, ACTOR, SHOP)).toBe(false);
  });

  it("in every combination the switch comes first: CATERING_REFUNDS unset = 503 refunds_off, nothing asked", async () => {
    vi.stubEnv("CATERING_REFUNDS", "");
    for (const appRoles of [OLD_APP_ROLES, null]) {
      for (const sqlRule of ["0357", "0358"] as const) {
        h.appRoles = appRoles;
        h.sqlRule = sqlRule;
        actor(role);
        expect(await answer(await confirm())).toEqual([503, "refunds_off"]);
        expect(await answer(await retry())).toEqual([503, "refunds_off"]);
      }
    }
    expect(h.rpcCalls).toEqual([]);
    expect(h.stripeCalls).toBe(0);
  });
});

describe("the roles that could already refund are unaffected by either order", () => {
  it.each([["catering_mgr", [SHOP]], ["moo", [SHOP]], ["owner", []], ["cgs", []]] as const)("%s passes the app gate in all four combinations: the reserve on 0358 + 0359, 503 refunds_unavailable (no reserve) without 0359", async (role, locations) => {
    for (const appRoles of [OLD_APP_ROLES, null]) {
      for (const sqlRule of ["0357", "0358"] as const) {
        h.appRoles = appRoles;
        h.sqlRule = sqlRule;
        h.rpcCalls = [];
        if (sqlRule === "0358") {
          await expect(requestRefund(actor(role, [...locations]), QUOTE, BODY)).rejects.toMatchObject({ status: 409, code: "nothing_refundable" });
          expect(h.rpcCalls).toEqual(["catering_refund_epoch_state", "catering_refund_reserve_admitted"]);
        } else {
          await expect(requestRefund(actor(role, [...locations]), QUOTE, BODY)).rejects.toMatchObject({ status: 503, code: "refunds_unavailable" });
          expect(h.rpcCalls).toEqual(["catering_refund_epoch_state"]);
        }
      }
    }
    expect(h.stripeCalls).toBe(0);
    expect(h.db.writes).toEqual([]);
  });
  it("…and the roles outside both lists are refused by the app in all four", async () => {
    for (const role of ["prep_mgr", "social_media_mgr", "shift_lead"]) {
      for (const appRoles of [OLD_APP_ROLES, null]) {
        for (const sqlRule of ["0357", "0358"] as const) {
          h.appRoles = appRoles;
          h.sqlRule = sqlRule;
          await expect(requestRefund(actor(role), QUOTE, BODY)).rejects.toMatchObject({ status: 403, code: "forbidden" });
        }
      }
    }
    expect(h.rpcCalls).toEqual([]);
  });
});
