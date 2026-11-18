/**
 * Astra r2 P2 #2: POST /api/admin/labor/payroll-shop takes Tier B, so its OWN requireSession must keep the unlock
 * the immediately-preceding POST /api/auth/step-up set. The route lives under /api/admin (isAdminPath), a step-up
 * surface by construction. Run UNMOCKED over the predicate-aware fake (tests/fake-supabase), the way
 * tests/schedule-settings-tier-e-session.test.ts does: a non-surface page visit clears the flag, a fresh password
 * sets it, the route's own requireSession keeps it, and the save reaches the RPC. Without a password: 403
 * step_up_required (not vacuous). Same-origin first, then the trusted role (GM refused), then Tier B, then the RPC.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeRpc } from "./fake-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./fake-supabase").FakeDb, calls: [] as Record<string, unknown>[], rpcError: null as string | null }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));

import { isStepUpSurface, requireSession, SESSION_COOKIE_NAME, unlockStepUp } from "@/lib/session";
import { POST } from "@/app/api/admin/labor/payroll-shop/route";

const PATH = "/api/admin/labor/payroll-shop";
const LOC = "1c000000-0000-4000-8000-000000000002";
const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const visit = async (path: string) => {
  const ctx = await requireSession(new NextRequest(`http://localhost${path}`, { headers: cookie }), path);
  if (ctx instanceof Response) throw new Error(`denied on ${path}`);
};
const post = (body: unknown, origin = "http://localhost") => new NextRequest(`http://localhost${PATH}`, {
  method: "POST", body: JSON.stringify(body), headers: { ...cookie, origin, "content-type": "application/json" },
});
const SAVE = { account: "9", disposition: "shop", locationId: LOC, validFrom: "2026-07-19", note: "P Street payroll", expectedSeq: null };
const save: FakeRpc = (args) => {
  h.calls.push(args);
  return h.rpcError ? { data: null, error: { message: h.rpcError } } : { data: { id: "row-1", seq: 7 }, error: null };
};
const sessionRow = () => (h.db.tables.sessions as Array<Record<string, unknown>>)[0]!;

function seed(role: string) {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  h.calls = []; h.rpcError = null;
  h.db = fakeSupabase({
    sessions: [{
      id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password",
      step_up_unlocked: false, step_up_unlocked_at: null, catalog_edit_unlocked_at: null,
      created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
      expires_at: future, revoked_at: null, ip_address: null, user_agent: null,
    }],
    users: [{ id: "user-1", name: "Ops", email: "ops@example.test", role, active: true, language: "en" }],
    user_locations: [{ user_id: "user-1", location_id: LOC, active: true }],
  }, { save_labor_payroll_shop: save });
}
beforeEach(() => seed("moo"));

describe("Tier B survives the route's own requireSession (Astra r2 P2 #2)", () => {
  it("the route path is a step-up surface", () => {
    expect(isStepUpSurface(PATH)).toBe(true);
  });
  it("a non-surface visit clears the flag, a password sets it, the route keeps it and the save reaches the RPC", async () => {
    await unlockStepUp("session-1");
    await visit("/dashboard"); // leaving the surface clears a stale unlock
    expect(sessionRow().step_up_unlocked).toBe(false);
    await unlockStepUp("session-1"); // the password typed for this save
    const res = await POST(post(SAVE));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ seq: 7 });
    expect(sessionRow().step_up_unlocked).toBe(true);
    expect(h.calls).toEqual([{ p_actor: "user-1", p_account: "9", p_location_id: LOC, p_disposition: "shop", p_valid_from: "2026-07-19",
      p_note: "P Street payroll", p_expected_seq: null }]);
  });
  it("without a password: 403 step_up_required, nothing written", async () => {
    const res = await POST(post(SAVE));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("step_up_required");
    expect(h.calls).toEqual([]);
  });
});

describe("order and refusals", () => {
  it("a foreign origin is refused before anything else", async () => {
    await unlockStepUp("session-1");
    const res = await POST(post(SAVE, "http://evil.example"));
    expect(res.status).toBe(403);
    expect(h.calls).toEqual([]);
  });
  it("a GM is refused by trusted role even with a password (owner / CGS / MoO only)", async () => {
    seed("gm");
    await unlockStepUp("session-1");
    const res = await POST(post(SAVE));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("forbidden");
    expect(h.calls).toEqual([]);
  });
  it("a malformed body is 400 before the RPC", async () => {
    await unlockStepUp("session-1");
    for (const bad of [{ ...SAVE, account: "abc" }, { ...SAVE, disposition: "both" }, { ...SAVE, validFrom: "07/19/2026" }, { ...SAVE, extra: 1 },
      { ...SAVE, expectedSeq: "7" }]) {
      const res = await POST(post(bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(h.calls).toEqual([]);
  });
  it("the writer's named refusals map to codes", async () => {
    await unlockStepUp("session-1");
    const cases: [string, number, string][] = [["labor_payroll_shop_moved", 409, "moved"], ["labor_payroll_shop_note_required", 422, "note_required"],
      ["labor_payroll_shop_invalid_destination", 422, "invalid_destination"], ["labor_payroll_shop_forbidden", 403, "forbidden"],
      ["labor_payroll_shop_invalid_date", 422, "invalid_date"], ["something else", 500, "generic"]];
    for (const [msg, status, code] of cases) {
      h.rpcError = msg;
      const res = await POST(post(SAVE));
      expect([res.status, (await res.json()).code], msg).toEqual([status, code]);
    }
  });
});
