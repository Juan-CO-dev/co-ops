/**
 * Audit W06/B012 fix rounds 5 + 6 — a CONFIRMED logout can never clear a cookie it did not end; an UNCONFIRMED one
 * fails closed (503 + cleared cookie; round 6, at the bottom).
 *
 * The race (review r5): two tabs reach the shared idle deadline together and each POSTs /api/auth/logout. Tab A's
 * response lands, A goes to the login page, someone signs in there, and then tab B's LATE response — which used to carry
 * an unconditional cookie-clearing Set-Cookie — wiped the NEW session's cookie. A browser applies a Set-Cookie whenever
 * the response arrives, and the server cannot know what the jar holds by then, so the fix is server-side and total:
 * POST /api/auth/logout is REVOKE-ONLY. It revokes the session its request carried (idempotent) and never emits a
 * Set-Cookie at all. A cookie for a revoked session is already worthless (dual verification denies it, the next
 * protected route answers 401 and clears it, 0200 current_user_id ignores it) and a new sign-in overwrites it.
 *
 * The idle sign-out also names the session it means to end (`sessionId` in the body): a logout whose request goes out
 * after a NEW sign-in (a background tab on its own clock) finds a different session on the cookie and leaves it alone.
 *
 * The real route + the real lib/session over the predicate-aware fake (tests/fake-supabase). A small cookie jar applies
 * each response's Set-Cookie when it "arrives", exactly as a browser would.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeDb,
  audits: [] as Array<{ action: string; resourceId: string | null; metadata: Record<string, unknown> }>,
  /** Round 6: runs just before the route's revoke UPDATE (e.g. a concurrent logout landing first). */
  beforeRevoke: null as null | (() => void),
  /** Round 6: the revoke UPDATE "succeeds" but matches no row. */
  revokeNoop: false,
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...actual,
    revokeSession: async (id: string) => {
      h.beforeRevoke?.();
      if (h.revokeNoop) return { rowsAffected: 0 };
      return actual.revokeSession(id);
    },
  };
});
vi.mock("@/lib/audit", () => ({
  audit: async (row: { action: string; resourceId: string | null; metadata: Record<string, unknown> }) => {
    h.audits.push(row);
  },
}));
// The same person signing back in is the hardest case: only the session id tells the two cookies apart.
const SESSIONS: Record<string, string> = { "jwt-s1": "session-1", "jwt-s2": "session-2" };
vi.mock("@/lib/auth", () => ({
  verifyJwt: async (jwt: string) => {
    const sessionId = SESSIONS[jwt];
    if (!sessionId) throw new Error("bad jwt");
    return { user_id: "user-1", app_role: "gm", role_level: 6, session_id: sessionId, locations: [] };
  },
  hashToken: async (jwt: string) => `hash-${jwt}`,
  signJwt: async () => "jwt",
}));

import { POST as logout } from "@/app/api/auth/logout/route";
import { requestSignOut } from "@/lib/logout-client";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";

const sessionRow = (id: string, jwt: string) => ({
  id, user_id: "user-1", token_hash: `hash-${jwt}`, auth_method: "pin",
  step_up_unlocked: false, step_up_unlocked_at: null, catalog_edit_unlocked_at: null,
  created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3_600_000).toISOString(), revoked_at: null, ip_address: null, user_agent: null,
});
const row = (id: string) => h.db.tables.sessions!.find((r) => r.id === id)!;

/** The browser's cookie jar for the staff origin. */
let jar: string | null = null;
/** A request is built (and its cookie attached) when it is SENT — like fetch. */
const send = (body?: unknown) =>
  new NextRequest("http://localhost/api/auth/logout", {
    method: "POST",
    headers: { ...(jar ? { cookie: `${SESSION_COOKIE_NAME}=${jar}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
/** The response ARRIVES: apply its Set-Cookie (if any) to the jar, as a browser does. */
const arrive = (res: Response) => {
  const set = res.headers.get("set-cookie");
  if (!set) return;
  const m = new RegExp(`${SESSION_COOKIE_NAME}=([^;]*)`).exec(set);
  if (!m) return;
  jar = m[1] && !/max-age=0/i.test(set) ? m[1] : null;
};
/** Someone signs in through the login page: a new session row and a new cookie. */
const signIn = () => {
  h.db.tables.sessions!.push(sessionRow("session-2", "jwt-s2"));
  jar = "jwt-s2";
};
const nextRequest = () =>
  requireSession(
    new NextRequest("http://localhost/api/x", { headers: jar ? { cookie: `${SESSION_COOKIE_NAME}=${jar}` } : {} }),
    "/api/x",
  );
const outcomes = () => h.audits.filter((a) => a.action === "auth_logout").map((a) => a.metadata.outcome);

beforeEach(() => {
  h.audits = [];
  h.beforeRevoke = null;
  h.revokeNoop = false;
  jar = "jwt-s1";
  h.db = fakeSupabase({
    sessions: [sessionRow("session-1", "jwt-s1")],
    users: [{ id: "user-1", name: "GM", email: "gm@example.test", role: "gm", active: true, language: "en" }],
    user_locations: [],
  });
});

describe("two concurrent idle logouts, settled separately around a new sign-in", () => {
  it("the late response does not clear the new session's cookie, and the new session works", async () => {
    const reqA = send({ sessionId: "session-1" }); // both tabs hit the deadline together
    const reqB = send({ sessionId: "session-1" });
    const resA = await logout(reqA);
    arrive(resA); // A settles, A goes to the login page…
    signIn(); // …and someone signs in there
    const resB = await logout(reqB);
    arrive(resB); // B's late response lands only now

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(jar).toBe("jwt-s2");
    const ctx = await nextRequest();
    expect(ctx).not.toBeInstanceOf(Response);
    expect((ctx as { session: { id: string } }).session.id).toBe("session-2");
    expect(row("session-1").revoked_at).not.toBeNull();
    expect(row("session-2").revoked_at).toBeNull();
    expect(outcomes()).toEqual(["revoked", "already_revoked"]);
  });

  it("a confirmed logout response carries no Set-Cookie", async () => {
    const res = await logout(send({ sessionId: "session-1" }));
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("a logout sent after the new sign-in, for the session it observed", () => {
  it("finds a different session on the cookie and leaves it alone", async () => {
    signIn(); // a background tab on its own clock fires its idle logout only now
    const res = await logout(send({ sessionId: "session-1" }));
    arrive(res);
    expect(row("session-2").revoked_at).toBeNull();
    expect(jar).toBe("jwt-s2");
    expect(await nextRequest()).not.toBeInstanceOf(Response);
    expect(outcomes()).toEqual(["session_superseded"]);
  });
});

describe("a request that names no session (no in-app caller sends one since round 7; the route keeps the cookie fallback)", () => {
  it("revokes the session its request carried and sets no cookie", async () => {
    const res = await logout(send());
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(row("session-1").revoked_at).not.toBeNull();
    expect(outcomes()).toEqual(["revoked"]);
  });

  it("a slow manual logout landing after a new sign-in leaves the new cookie working", async () => {
    const req = send();
    signIn();
    arrive(await logout(req));
    expect(jar).toBe("jwt-s2");
    expect(await nextRequest()).not.toBeInstanceOf(Response);
    expect(row("session-1").revoked_at).not.toBeNull();
  });
});

describe("the revoked session's cookie after a sign-out", () => {
  it("gets a 401 that clears it on its next request (back button / reopened app go to sign in)", async () => {
    arrive(await logout(send({ sessionId: "session-1" })));
    expect(jar).toBe("jwt-s1"); // the worthless cookie is still in the jar…
    const res = await nextRequest();
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
    arrive(res as Response);
    expect(jar).toBeNull(); // …until the next protected request clears it
  });
});

describe("the idempotent edges stay 200 without a Set-Cookie", () => {
  it("no cookie", async () => {
    jar = null;
    const res = await logout(send());
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(outcomes()).toEqual(["no_cookie"]);
  });

  it("an invalid JWT", async () => {
    jar = "garbage";
    const res = await logout(send());
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(outcomes()).toEqual(["jwt_invalid"]);
  });

  it("a body that is not JSON is ignored (the cookie's session is revoked, as before)", async () => {
    const req = new NextRequest("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE_NAME}=jwt-s1`, "content-type": "text/plain" },
      body: "not json",
    });
    const res = await logout(req);
    expect(res.status).toBe(200);
    expect(row("session-1").revoked_at).not.toBeNull();
  });
});

// ── Fix round 6 (review W06-r6 P1) — an unconfirmed end fails CLOSED ─────────────────────────────────────────────────
// A sessions read error used to read as "session not found": nothing was revoked, the route answered 200 and, being
// revoke-only, left the cookie too — so once the database came back the old cookie opened /dashboard again. Now only a
// successful read or write confirms an end; anything else is 503 logout_unconfirmed WITH a cookie-clearing Set-Cookie.
const reasons = () => h.audits.filter((a) => a.action === "auth_logout").map((a) => a.metadata.reason);
const restoreDb = () => {
  h.db.failSelectTables = [];
  h.db.failUpdates = 0;
};

describe("round 6 — a logout the server cannot confirm fails closed", () => {
  it("a sessions READ failure: 503 + cleared cookie; after the DB recovers the old cookie opens nothing", async () => {
    h.db.failSelectTables = ["sessions"];
    const res = await logout(send({ sessionId: "session-1" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "logout_unconfirmed", sessionId: "session-1" });
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE_NAME}=;`));
    arrive(res);
    expect(jar).toBeNull();
    expect(outcomes()).toEqual(["unconfirmed"]);
    expect(reasons()).toEqual(["session_read_failed"]);

    restoreDb();
    const next = await nextRequest(); // /dashboard on the shared tablet
    expect(next).toBeInstanceOf(Response);
    expect((next as Response).status).toBe(401);
  });

  it("the read failure is never 'session not found' (no 200 and no silent skip)", async () => {
    h.db.failSelectTables = ["sessions"];
    const res = await logout(send()); // the Log out button
    expect(res.status).not.toBe(200);
    expect(outcomes()).not.toContain("session_not_found");
  });

  it("a revoke UPDATE failure: 503 + cleared cookie; after the DB recovers the old cookie opens nothing", async () => {
    h.db.failUpdates = 1;
    const res = await logout(send());
    expect(res.status).toBe(503);
    expect(row("session-1").revoked_at).toBeNull(); // the row really is still live…
    arrive(res);
    expect(jar).toBeNull(); // …so the browser must stop carrying it
    expect(reasons()).toEqual(["revoke_failed"]);

    restoreDb();
    const next = await nextRequest();
    expect(next).toBeInstanceOf(Response);
    expect((next as Response).status).toBe(401);
  });

  it("the UPDATE matched nothing and the confirming read fails: 503 confirm_read_failed", async () => {
    h.beforeRevoke = () => {
      row("session-1").revoked_at = new Date().toISOString(); // a concurrent logout landed first…
      h.db.failSelectTables = ["sessions"]; // …and the database then blips
    };
    const res = await logout(send({ sessionId: "session-1" }));
    expect(res.status).toBe(503);
    expect(reasons()).toEqual(["confirm_read_failed"]);
    arrive(res);
    expect(jar).toBeNull();
  });

  it("the UPDATE matched nothing on a row still live: 503 revoke_not_applied", async () => {
    h.revokeNoop = true; // an UPDATE that silently applies to nothing (the silent-denial shape), the row staying live
    const res = await logout(send());
    expect(res.status).toBe(503);
    expect(row("session-1").revoked_at).toBeNull();
    expect(reasons()).toEqual(["revoke_not_applied"]);
    arrive(res);
    expect(jar).toBeNull();
  });

  it("a concurrent logout that ended it first, CONFIRMED by the second read: 200 already_revoked, no Set-Cookie", async () => {
    h.beforeRevoke = () => {
      row("session-1").revoked_at = new Date().toISOString();
    };
    const res = await logout(send({ sessionId: "session-1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(outcomes()).toEqual(["already_revoked"]);
  });

  it("the confirmed paths still set no cookie (revoked, already revoked, not found)", async () => {
    const first = await logout(send({ sessionId: "session-1" }));
    const again = await logout(send({ sessionId: "session-1" }));
    h.db.tables.sessions = [];
    const gone = await logout(send({ sessionId: "session-1" }));
    for (const res of [first, again, gone]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(outcomes()).toEqual(["revoked", "already_revoked", "session_not_found"]);
  });

  it("the superseded path is unchanged even while the database is down (it reads nothing)", async () => {
    signIn();
    h.db.failSelectTables = ["sessions"];
    const res = await logout(send({ sessionId: "session-1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(outcomes()).toEqual(["session_superseded"]);
    expect(jar).toBe("jwt-s2");
  });
});

// ── Fix round 7 (review W06-r7 P2 #1) — every attempt and every retry names the session ──────────────────────────────
// The real client helper (lib/logout-client.ts) over the real route and the cookie jar. The dashboard and opening-page
// Log out buttons used to send no session id: when the first request failed without a 503 naming one (a network error,
// a 504) and someone signed in through another tab during the backoff, the unnamed retry revoked that NEW session.
describe("round 7 — a retried sign-out after a failed first attempt and a sign-in in another tab", () => {
  const wireFetch = (firstAttempt: "network" | "gateway") => {
    let n = 0;
    return vi.fn(async (url: string, init: RequestInit) => {
      if (n++ === 0) {
        if (firstAttempt === "network") throw new TypeError("Failed to fetch"); // never reached the route
        return new Response(null, { status: 504 }); // the gateway gave up before the route answered
      }
      const headers = new Headers(init.headers);
      if (jar) headers.set("cookie", `${SESSION_COOKIE_NAME}=${jar}`); // the cookie is attached when the retry is SENT
      const res = await logout(new NextRequest(`http://localhost${url}`, { method: init.method, headers, body: init.body }));
      arrive(res);
      return res;
    });
  };

  it.each(["network", "gateway"] as const)("first attempt %s failure → the retry leaves the new session alone (session_superseded)", async (first) => {
    vi.useFakeTimers();
    const fetchMock = wireFetch(first);
    vi.stubGlobal("fetch", fetchMock);
    try {
      const p = requestSignOut("session-1"); // the served session, as every caller now passes it
      await vi.advanceTimersByTimeAsync(0); // the first attempt failed without naming anything
      signIn(); // another tab signs in during the backoff
      await vi.runAllTimersAsync();
      expect(await p).toEqual({ ended: true, attempts: 2 });
      for (const c of fetchMock.mock.calls) expect((c[1] as RequestInit).body).toBe(JSON.stringify({ sessionId: "session-1" }));
      expect(outcomes()).toEqual(["session_superseded"]);
      expect(row("session-2").revoked_at).toBeNull(); // the new sign-in survives…
      expect(jar).toBe("jwt-s2");
      const ctx = await nextRequest(); // …and keeps working
      expect(ctx).not.toBeInstanceOf(Response);
      expect((ctx as { session: { id: string } }).session.id).toBe("session-2");
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
