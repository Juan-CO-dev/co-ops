/**
 * Audit W06/B012 fix round 5 — a logout response can never clear a cookie it did not end.
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
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
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

  it("no logout response carries a Set-Cookie", async () => {
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

describe("the explicit Log out button (no session named)", () => {
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
