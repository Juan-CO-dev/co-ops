/**
 * Board two labor views PR 2: POST /api/admin/labor/burden (0346 save_labor_burden). Plan r4 "Burden card":
 * `assertSameOrigin` → session → role → flag → step-up → RPC. Run UNMOCKED over the predicate-aware fake, like
 * tests/labor-payroll-shop-route.test.ts: the route lives under /api/admin, so its own requireSession keeps the
 * Tier B unlock the preceding POST /api/auth/step-up set. Dark: without SCHEDULE_LABOR_VIEWS (and the two fact
 * switches) it answers 503 before the password is even asked for, and nothing is written.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeRpc } from "./fake-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./fake-supabase").FakeDb, calls: [] as Record<string, unknown>[],
  rpcError: null as { message: string; code?: string } | null }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));

import { audit } from "@/lib/audit";
import { isStepUpSurface, requireSession, SESSION_COOKIE_NAME, unlockStepUp } from "@/lib/session";
import { POST } from "@/app/api/admin/labor/burden/route";

const PATH = "/api/admin/labor/burden";
const LOC = "1c000000-0000-4000-8000-000000000002";
const HEAD = "2d000000-0000-4000-8000-000000000009";
const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const visit = async (path: string) => {
  const ctx = await requireSession(new NextRequest(`http://localhost${path}`, { headers: cookie }), path);
  if (ctx instanceof Response) throw new Error(`denied on ${path}`);
};
const post = (body: unknown, origin = "http://localhost") => new NextRequest(`http://localhost${PATH}`, {
  method: "POST", body: JSON.stringify(body), headers: { ...cookie, origin, "content-type": "application/json" },
});
const SAVE = { locationId: null, followCompany: false, burdenPct: 11.5, validFrom: "2026-07-19", source: "payroll", note: "payroll register 2026", expectedId: null };
const FOLLOW = { locationId: LOC, followCompany: true, burdenPct: null, validFrom: "2026-11-15", source: null, note: "", expectedId: HEAD };
const save: FakeRpc = (args) => {
  h.calls.push(args);
  return h.rpcError ? { data: null, error: h.rpcError } : { data: "row-1", error: null };
};
const sessionRow = () => (h.db.tables.sessions as Array<Record<string, unknown>>)[0]!;
const ON = { SCHEDULE_LABOR_VIEWS: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const setEnv = (env: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };

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
  }, { save_labor_burden: save });
}
beforeEach(() => { seed("moo"); setEnv(ON); vi.mocked(audit).mockClear(); });
afterEach(() => setEnv({ SCHEDULE_LABOR_VIEWS: undefined, FACT_LAYER: undefined, FACT_LAYER_LABOR: undefined }));

describe("Tier B survives the route's own requireSession", () => {
  it("the route path is a step-up surface", () => {
    expect(isStepUpSurface(PATH)).toBe(true);
  });
  it("a password set for this save is kept by the route and the save reaches the writer with the exact arguments", async () => {
    await unlockStepUp("session-1");
    await visit("/dashboard"); // leaving the surface clears a stale unlock
    expect(sessionRow().step_up_unlocked).toBe(false);
    await unlockStepUp("session-1");
    const res = await POST(post(SAVE));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "row-1" });
    expect(h.calls).toEqual([{ p_actor: "user-1", p_location_id: null, p_follow_company: false, p_burden_pct: 11.5, p_valid_from: "2026-07-19",
      p_source: "payroll", p_note: "payroll register 2026", p_expected_id: null }]);
  });
  it("follow the company: a shop, no rate, the head the card showed", async () => {
    await unlockStepUp("session-1");
    expect((await POST(post(FOLLOW))).status).toBe(200);
    expect(h.calls).toEqual([{ p_actor: "user-1", p_location_id: LOC, p_follow_company: true, p_burden_pct: null, p_valid_from: "2026-11-15",
      p_source: null, p_note: "", p_expected_id: HEAD }]);
  });
  it("without a password: 403 step_up_required, nothing written", async () => {
    const res = await POST(post(SAVE));
    expect([res.status, (await res.json()).code]).toEqual([403, "step_up_required"]);
    expect(h.calls).toEqual([]);
  });
  it("the audit row is the writer's own (SQL, same transaction): the route never writes a second one", async () => {
    await unlockStepUp("session-1");
    await POST(post(SAVE));
    expect(vi.mocked(audit).mock.calls.filter(([a]) => String(a.action).startsWith("labor_burden"))).toEqual([]);
  });
});

describe("order and refusals", () => {
  it("a foreign origin is refused before anything else", async () => {
    await unlockStepUp("session-1");
    const res = await POST(post(SAVE, "http://evil.example"));
    expect(res.status).toBe(403);
    expect(h.calls).toEqual([]);
  });
  it("a GM, an AGM and the social media manager are refused by trusted role, password or not", async () => {
    for (const role of ["gm", "agm", "social_media_mgr", "catering_mgr"]) {
      seed(role);
      await unlockStepUp("session-1");
      const res = await POST(post(SAVE));
      expect([res.status, (await res.json()).code], role).toEqual([403, "forbidden"]);
    }
    expect(h.calls).toEqual([]);
  });
  it("the owner and the CGS may save", async () => {
    for (const role of ["owner", "cgs"]) {
      seed(role);
      await unlockStepUp("session-1");
      expect((await POST(post(SAVE))).status, role).toBe(200);
    }
  });
  it("dark: any of the three switches off is 503 unavailable, after the role and before the password", async () => {
    for (const off of ["SCHEDULE_LABOR_VIEWS", "FACT_LAYER", "FACT_LAYER_LABOR"]) {
      setEnv({ ...ON, [off]: undefined });
      const res = await POST(post(SAVE)); // no password typed
      expect([res.status, (await res.json()).code], off).toEqual([503, "unavailable"]);
    }
    setEnv({ ...ON, SCHEDULE_LABOR_VIEWS: "true" });
    expect((await POST(post(SAVE))).status).toBe(503);
    seed("gm");
    setEnv({ ...ON, SCHEDULE_LABOR_VIEWS: undefined });
    expect((await (await POST(post(SAVE))).json()).code).toBe("forbidden"); // the role is judged first
    expect(h.calls).toEqual([]);
  });
  it("a malformed body is 400 before the RPC", async () => {
    await unlockStepUp("session-1");
    for (const bad of [{ ...SAVE, burdenPct: 51 }, { ...SAVE, validFrom: "2026-07-20" }, { ...SAVE, source: "guess" }, { ...SAVE, extra: 1 },
      { ...FOLLOW, locationId: null }, { ...FOLLOW, burdenPct: 10 }]) {
      const res = await POST(post(bad));
      expect([res.status, (await res.json()).code], JSON.stringify(bad)).toEqual([400, "invalid"]);
    }
    expect(h.calls).toEqual([]);
  });
  it("the writer's named refusals map to codes; a missing 0346 is 503 unavailable", async () => {
    await unlockStepUp("session-1");
    const cases: [{ message: string; code?: string }, number, string][] = [
      [{ message: "labor_burden_moved" }, 409, "moved"], [{ message: "labor_burden_already_following" }, 409, "already_following"],
      [{ message: "labor_burden_invalid_date" }, 422, "invalid_date"], [{ message: "labor_burden_invalid" }, 400, "invalid"],
      [{ message: "labor_burden_forbidden" }, 403, "forbidden"], [{ message: "something else" }, 500, "generic"],
      [{ message: "Could not find the function public.save_labor_burden", code: "PGRST202" }, 503, "unavailable"],
      [{ message: "function does not exist", code: "42883" }, 503, "unavailable"]];
    for (const [error, status, code] of cases) {
      h.rpcError = error;
      const res = await POST(post(SAVE));
      expect([res.status, (await res.json()).code], error.message).toEqual([status, code]);
    }
  });
});
