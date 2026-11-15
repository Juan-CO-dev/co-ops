/**
 * Audit W06/B013 prerequisite — the idle heartbeat must not drop a password unlock.
 *
 * The activity heartbeat now fires every couple of minutes while someone is typing. If POST /api/auth/heartbeat
 * auto-cleared step_up_unlocked (as every non-surface path does), a manager who typed their password on, say, the
 * counts form and kept typing would lose the unlock before the save it was for. The heartbeat leaves the flag as it
 * stands; a page visit still clears it (not vacuous), and the heartbeat is NOT a step-up surface for any gate.
 * Unmocked requireSession over the predicate-aware fake (tests/fake-supabase).
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

import { isStepUpSurface, requireSession, SESSION_COOKIE_NAME, unlockStepUp } from "@/lib/session";
import { POST as heartbeat } from "@/app/api/auth/heartbeat/route";

const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const visit = async (path: string) => {
  const ctx = await requireSession(new NextRequest(`http://localhost${path}`, { headers: cookie }), path);
  if (ctx instanceof Response) throw new Error(`denied on ${path}`);
  return ctx;
};
const beat = () => heartbeat(new NextRequest("http://localhost/api/auth/heartbeat", {
  method: "POST", headers: { ...cookie, origin: "http://localhost" },
}));
const sessionRow = () => (h.db.tables.sessions as Array<Record<string, unknown>>)[0]!;

beforeEach(() => {
  h.db = fakeSupabase({
    sessions: [{
      id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password",
      step_up_unlocked: false, step_up_unlocked_at: null, catalog_edit_unlocked_at: null,
      created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(), revoked_at: null, ip_address: null, user_agent: null,
    }],
    users: [{ id: "user-1", name: "GM", email: "gm@example.test", role: "gm", active: true, language: "en" }],
    user_locations: [],
  });
});

describe("the idle heartbeat keeps a password unlock (B013)", () => {
  it("a heartbeat after the password leaves step_up_unlocked as it stands", async () => {
    await unlockStepUp("session-1");
    const res = await beat();
    expect(res.status).toBe(200);
    expect(sessionRow().step_up_unlocked).toBe(true);
    expect(sessionRow().step_up_unlocked_at).toEqual(expect.any(String));
  });

  it("a page visit still clears it (not vacuous)", async () => {
    await unlockStepUp("session-1");
    await beat();
    await visit("/dashboard");
    expect(sessionRow().step_up_unlocked).toBe(false);
  });

  it("the heartbeat is not a step-up surface for any gate", () => {
    expect(isStepUpSurface("/api/auth/heartbeat")).toBe(false);
  });
});
