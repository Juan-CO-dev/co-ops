/**
 * Audit W06/B155 + owner decision W06-2 — a server-side session denial (idle server session, revoked, inactive user)
 * redirects to sign in with the page actually SERVED (proxy x-co-path), not the layout's hub path, and binds the
 * return link to the user the JWT named (the same person returns there; a different person lands on the dashboard).
 * No header or a hostile one falls back to currentPath. No cookie at all keeps the old unowned link.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeDb,
  cookie: "jwt" as string | null,
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

import { requireSessionFromHeaders } from "@/lib/session";

const idleSession = () => ({
  id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password",
  step_up_unlocked: false, step_up_unlocked_at: null, catalog_edit_unlocked_at: null,
  created_at: new Date().toISOString(), last_activity_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  expires_at: new Date(Date.now() + 3_600_000).toISOString(), revoked_at: null, ip_address: null, user_agent: null,
});
const target = async (currentPath: string) => {
  await expect(requireSessionFromHeaders(currentPath)).rejects.toThrow("NEXT_REDIRECT");
  return h.redirect.mock.calls[0]![0] as string;
};

beforeEach(() => {
  h.cookie = "jwt";
  h.headers = new Map();
  h.redirect?.mockClear();
  h.db = fakeSupabase({ sessions: [idleSession()], users: [], user_locations: [] });
});

describe("session denial return link (B155, W06-2)", () => {
  it("returns to the served page, bound to the session's user", async () => {
    h.headers.set("x-co-path", "/admin/vendors/v1");
    expect(await target("/admin")).toBe("/?next=%2Fadmin%2Fvendors%2Fv1&for=user-1");
  });

  it("with no header it falls back to currentPath", async () => {
    expect(await target("/admin")).toBe("/?next=%2Fadmin&for=user-1");
  });

  it("a hostile header falls back too", async () => {
    h.headers.set("x-co-path", "//evil.com");
    expect(await target("/admin")).toBe("/?next=%2Fadmin&for=user-1");
  });

  it("no cookie at all keeps the old unowned return link", async () => {
    h.cookie = null;
    h.headers.set("x-co-path", "/catering/inbox/abc");
    expect(await target("/dashboard")).toBe("/?next=%2Fcatering%2Finbox%2Fabc");
  });
});
