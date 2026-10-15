/**
 * Catalog Phase 1 (Astra r2 design decision) — the edit window is a FIXED 15-minute clock from an
 * admin-page password: background and outside requests never close it, saving never extends it,
 * it expires at 15 minutes exactly, and it ends with the session (logout / revoke / expiry).
 * Runs the real requireSession / unlockStepUp / revokeSession over the predicate-aware fake.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fake-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./fake-supabase").FakeDb }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));

import { requireSession, revokeSession, SESSION_COOKIE_NAME, unlockStepUp } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import type { AuthContext } from "@/lib/session";

const req = (path: string) =>
  new NextRequest(`http://localhost${path}`, { headers: { cookie: `${SESSION_COOKIE_NAME}=jwt` } });
async function visit(path: string): Promise<AuthContext> {
  const ctx = await requireSession(req(path), path);
  if (ctx instanceof Response) throw new Error(`denied on ${path}`);
  return ctx;
}
const sessionRow = () => (h.db.tables.sessions as Array<Record<string, unknown>>)[0]!;

beforeEach(() => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  h.db = fakeSupabase({
    sessions: [{
      id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password",
      step_up_unlocked: false, step_up_unlocked_at: null, catalog_edit_unlocked_at: null,
      created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
      expires_at: future, revoked_at: null, ip_address: null, user_agent: null,
    }],
    users: [{ id: "user-1", name: "GM", email: "gm@example.test", role: "gm", active: true, language: "en" }],
    user_locations: [],
  });
});

describe("the catalog edit window is a fixed 15-minute clock", () => {
  it("only an admin-surface password opens it; a counts password does not", async () => {
    await unlockStepUp("session-1");
    expect(sessionRow().catalog_edit_unlocked_at).toBeNull();
    await unlockStepUp("session-1", { catalogWindow: true });
    expect(sessionRow().catalog_edit_unlocked_at).toEqual(expect.any(String));
  });

  it("background and outside requests never close it — language PATCH, dashboard prefetch, counts", async () => {
    await unlockStepUp("session-1", { catalogWindow: true });
    const stamped = sessionRow().catalog_edit_unlocked_at;
    for (const p of ["/api/users/me/language", "/dashboard", "/operations/counts", "/api/operations/counts", "/api/catering/quotes/q/send"]) {
      expect((await visit(p)).session.catalogEditUnlockedAt, p).toBe(stamped);
    }
    expect(sessionRow().catalog_edit_unlocked_at).toBe(stamped);
    expect(assertStepUp(await visit("/admin/recipes"), "E")).toEqual({ ok: true });
  });

  it("saving never extends it, and it closes AT 15 minutes (exclusive deadline)", async () => {
    await unlockStepUp("session-1", { catalogWindow: true });
    const stamped = sessionRow().catalog_edit_unlocked_at as string;
    const ctx = await visit("/api/admin/recipes/r/inputs");
    expect(sessionRow().catalog_edit_unlocked_at).toBe(stamped); // a write request moved nothing
    const t0 = Date.parse(stamped);
    expect(assertStepUp(ctx, "E", t0 + 899_999)).toEqual({ ok: true });
    expect(assertStepUp(ctx, "E", t0 + 900_000)).toEqual({ ok: false, code: "step_up_stale" });
    expect(assertStepUp(ctx, "E", t0 + 900_001)).toEqual({ ok: false, code: "step_up_stale" });
  });

  it("logout / revoke ends it — the session stops resolving at all", async () => {
    await unlockStepUp("session-1", { catalogWindow: true });
    expect(assertStepUp(await visit("/admin/recipes"), "E")).toEqual({ ok: true });
    await revokeSession("session-1");
    expect(await requireSession(req("/admin/recipes"), "/admin/recipes")).toBeInstanceOf(Response);
  });

  it("the session ending ends it", async () => {
    await unlockStepUp("session-1", { catalogWindow: true });
    sessionRow().expires_at = new Date(Date.now() - 1_000).toISOString();
    expect(await requireSession(req("/admin/recipes"), "/admin/recipes")).toBeInstanceOf(Response);
  });

  it("the shared flag keeps its own lifecycle — /dashboard clears IT, not the catalog clock", async () => {
    await unlockStepUp("session-1", { catalogWindow: true });
    const atDashboard = await visit("/dashboard");
    expect(atDashboard.session.stepUpUnlocked).toBe(false);
    expect(atDashboard.session.catalogEditUnlockedAt).toEqual(expect.any(String));
  });
});
