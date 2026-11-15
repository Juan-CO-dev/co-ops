/**
 * Audit W06/B048 — a transient database error while LOOKING UP the session is not "signed out".
 *
 * Before: `if (error || !rowRaw) return { denied: true }` (and the same for the users read) turned one PostgREST 503 or
 * timeout into a 401 that also cleared the session cookie, so a working operator was signed out by a blip. Now a READ
 * ERROR is `unavailable`: the route wrapper answers 503 `session_unavailable` and KEEPS the cookie, and the Server
 * Component wrapper throws (the error page's "Try again") instead of redirecting to sign in. A missing row is still a
 * denial (401 + cleared cookie) — the test is not vacuous.
 *
 * Audit W06/B154 — `unauthorized()` carries a machine code, so clients can tell a dead session from a wrong password.
 *
 * Unmocked requireSession over the predicate-aware fake (tests/fake-supabase).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeDb,
  cookie: null as string | null,
  headers: new Map<string, string>(),
  redirect: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (h.cookie && name === "co_ops_session" ? { value: h.cookie } : undefined) }),
  headers: async () => ({ get: (name: string) => h.headers.get(name.toLowerCase()) ?? null }),
}));
vi.mock("next/navigation", async () => {
  const { vi: v } = await import("vitest");
  h.redirect = v.fn((target: string) => { throw new Error(`NEXT_REDIRECT ${target}`); });
  return { redirect: h.redirect };
});

import { requireSession, requireSessionFromHeaders, SESSION_COOKIE_NAME } from "@/lib/session";

const LOC = "1c000000-0000-4000-8000-000000000002";
const req = (withCookie = true) => new NextRequest("http://localhost/api/x", {
  headers: withCookie ? { cookie: `${SESSION_COOKIE_NAME}=jwt` } : {},
});
const sessionRow = () => ({
  id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password",
  step_up_unlocked: false, step_up_unlocked_at: null, catalog_edit_unlocked_at: null,
  created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3_600_000).toISOString(), revoked_at: null, ip_address: null, user_agent: null,
});
const clearsCookie = (res: Response) => /co_ops_session=;/.test(res.headers.get("set-cookie") ?? "");

beforeEach(() => {
  h.cookie = "jwt";
  h.headers = new Map();
  h.redirect?.mockClear();
  h.db = fakeSupabase({
    sessions: [sessionRow()],
    users: [{ id: "user-1", name: "GM", email: "gm@example.test", role: "gm", active: true, language: "en" }],
    user_locations: [{ user_id: "user-1", location_id: LOC, active: true }],
  });
});

describe("a transient session-read error is not a sign-out (B048)", () => {
  it("a sessions read error is a 503 that keeps the cookie", async () => {
    h.db.failSelectTables = ["sessions"];
    const res = await requireSession(req(), "/api/x");
    expect(res).toBeInstanceOf(Response);
    const r = res as Response;
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ code: "session_unavailable" });
    expect(clearsCookie(r)).toBe(false);
  });

  it("a users read error is a 503 too", async () => {
    h.db.failSelectTables = ["users"];
    const r = (await requireSession(req(), "/api/x")) as Response;
    expect(r.status).toBe(503);
    expect(clearsCookie(r)).toBe(false);
  });

  it("a missing session row is still a 401 with the cookie cleared (not vacuous)", async () => {
    h.db.tables.sessions = [];
    const r = (await requireSession(req(), "/api/x")) as Response;
    expect(r.status).toBe(401);
    expect(clearsCookie(r)).toBe(true);
  });

  it("a healthy session still passes", async () => {
    const ctx = await requireSession(req(), "/api/x");
    expect(ctx).not.toBeInstanceOf(Response);
  });

  it("requireSessionFromHeaders throws instead of redirecting on a read error", async () => {
    h.db.failSelectTables = ["sessions"];
    await expect(requireSessionFromHeaders("/dashboard")).rejects.toThrow("session_unavailable");
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("requireSessionFromHeaders still redirects to sign in on a real denial", async () => {
    h.db.tables.sessions = [];
    await expect(requireSessionFromHeaders("/dashboard")).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirect).toHaveBeenCalledTimes(1);
  });
});

