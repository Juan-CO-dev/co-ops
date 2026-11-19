/**
 * Item 21 PR 5: the settings routes. POST /api/admin/catering/toast-settings (0350 set_catering_toast_settings):
 * same-origin, the session, the trusted role, Tier B, the strict parse, then the writer. Run UNMOCKED over the
 * predicate-aware fake (like tests/labor-burden-route.test.ts): the route lives under /api/admin, so its own
 * requireSession keeps the Tier B unlock the preceding POST /api/auth/step-up set. The old-orders route (Tier A) runs
 * over the same fake with its lib mocked at the two entry points.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeRpc } from "./fake-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./fake-supabase").FakeDb, calls: [] as Array<[string, Record<string, unknown>]>,
  rpcError: null as { message: string; code?: string } | null }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));
vi.mock("@/lib/catering/catering-toast-settings", async (original) => {
  const real = await original<typeof import("@/lib/catering/catering-toast-settings")>();
  return { ...real, loadOldOrders: vi.fn(), linkOldOrders: vi.fn() };
});

import { audit } from "@/lib/audit";
import { isStepUpSurface, requireSession, SESSION_COOKIE_NAME, unlockStepUp } from "@/lib/session";
import { GET, POST } from "@/app/api/admin/catering/toast-settings/route";
import { GET as GET_OLD, POST as POST_OLD } from "@/app/api/admin/catering/toast-settings/old-orders/route";
import { CateringToastSettingsError, linkOldOrders, loadOldOrders } from "@/lib/catering/catering-toast-settings";
import { DEFAULT_CATERING_TOAST_SETTINGS as OFF, toSettingsRow } from "@/lib/catering/catering-toast-settings-shared";
import { EMPTY_OLD_ORDERS } from "@/lib/catering/catering-toast-old-orders-shared";

const PATH = "/api/admin/catering/toast-settings";
const OLD = `${PATH}/old-orders`;
const LOC = "1c000000-0000-4000-8000-000000000002";
const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const visit = async (path: string) => {
  const ctx = await requireSession(new NextRequest(`http://localhost${path}`, { headers: cookie }), path);
  if (ctx instanceof Response) throw new Error(`denied on ${path}`);
};
const post = (path: string, body: unknown, origin = "http://localhost") => new NextRequest(`http://localhost${path}`, {
  method: "POST", body: JSON.stringify(body), headers: { ...cookie, origin, "content-type": "application/json" },
});
const get = (path: string) => new NextRequest(`http://localhost${path}`, { headers: cookie });
const VALUES = { ...OFF, enabled: true };
const SAVE = { locationId: LOC, values: VALUES, expectedUpdatedAt: null };
const ROW = { location_id: LOC, ...toSettingsRow(VALUES), updated_at: "2026-11-19T12:00:00.123456+00:00" };
const save: FakeRpc = (args) => { h.calls.push(["set_catering_toast_settings", args]); return h.rpcError ? { data: null, error: h.rpcError } : { data: ROW, error: null }; };
const ready: FakeRpc = () => ({ data: { link_step: true, automatic: false }, error: null });

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
    locations: [{ id: LOC, name: "Shop", active: true }],
    catering_toast_settings: [],
  }, { set_catering_toast_settings: save, catering_toast_settings_ready: ready });
}
beforeEach(() => { seed("moo"); vi.mocked(audit).mockClear(); vi.mocked(loadOldOrders).mockReset(); vi.mocked(linkOldOrders).mockReset(); });
const code = async (res: Response) => { const body = (await res.json()) as { code?: string; error?: string }; return body.code ?? body.error; };

describe("POST the settings: same-origin, the role, Tier B, the strict parse, the writer", () => {
  it("both paths are step-up surfaces", () => {
    expect(isStepUpSurface(PATH)).toBe(true);
    expect(isStepUpSurface(OLD)).toBe(true);
  });

  it("a password typed for this save is kept by the route, and the save reaches the writer with the exact arguments", async () => {
    await unlockStepUp("session-1");
    const res = await POST(post(PATH, SAVE));
    expect(res.status).toBe(200);
    expect(h.calls).toEqual([["set_catering_toast_settings", { p_actor_id: "user-1", p_location_id: LOC, p_settings: toSettingsRow(VALUES), p_expected_updated_at: null }]]);
    expect(((await res.json()) as { saved: { enabled: boolean; updatedAt: string } }).saved).toMatchObject({ enabled: true, updatedAt: ROW.updated_at });
    // The writer audits in its own transaction: the app writes no second row.
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses another origin before anything else, with no session read and no write", async () => {
    await unlockStepUp("session-1");
    const res = await POST(post(PATH, SAVE, "https://evil.example"));
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("bad_origin");
    expect(h.calls).toEqual([]);
  });

  it("refuses everyone but the owner, the CGS and the MoO by role, before the password is asked for", async () => {
    for (const role of ["gm", "catering_mgr", "agm", "social_media_mgr"]) {
      seed(role);
      await unlockStepUp("session-1");
      const res = await POST(post(PATH, SAVE));
      expect([role, res.status, await code(res)]).toEqual([role, 403, "forbidden"]);
      expect(h.calls).toEqual([]);
    }
    for (const role of ["owner", "cgs"]) {
      seed(role);
      await unlockStepUp("session-1");
      expect([role, (await POST(post(PATH, SAVE))).status]).toEqual([role, 200]);
    }
  });

  it("no password, or one typed more than two minutes ago: refused by name, nothing written", async () => {
    const none = await POST(post(PATH, SAVE));
    expect([none.status, await code(none)]).toEqual([403, "step_up_required"]);
    await unlockStepUp("session-1");
    (h.db.tables.sessions as Array<Record<string, unknown>>)[0]!.step_up_unlocked_at = new Date(Date.now() - 121_000).toISOString();
    const stale = await POST(post(PATH, SAVE));
    expect([stale.status, await code(stale)]).toEqual([403, "step_up_stale"]);
    expect(h.calls).toEqual([]);
  });

  it("a password typed elsewhere and then left does not open this save", async () => {
    await unlockStepUp("session-1");
    await visit("/dashboard");
    const res = await POST(post(PATH, SAVE));
    expect([res.status, await code(res)]).toEqual([403, "step_up_required"]);
  });

  it("a body that is not the whole row is 400 before the writer", async () => {
    await unlockStepUp("session-1");
    for (const body of [{ ...SAVE, values: { enabled: true } }, { ...SAVE, extra: 1 }, { ...SAVE, values: { ...VALUES, note: "x" } }, []]) {
      const res = await POST(post(PATH, body));
      expect([res.status, await code(res)]).toEqual([400, "invalid_settings"]);
    }
    expect(h.calls).toEqual([]);
  });

  it("the writer's refusals pass through by name; a missing function is 503; anything else is a 500", async () => {
    const cases: Array<[{ message: string; code?: string }, number, string]> = [
      [{ message: "settings_moved", code: "P0001" }, 409, "settings_moved"], [{ message: "auto_needs_start_date", code: "P0001" }, 409, "auto_needs_start_date"],
      [{ message: "automatic_not_installed", code: "P0001" }, 409, "automatic_not_installed"], [{ message: "no_change", code: "P0001" }, 409, "no_change"],
      [{ message: "forbidden", code: "P0001" }, 403, "forbidden"], [{ message: "location_not_found", code: "P0001" }, 404, "location_not_found"],
      [{ message: "invalid_settings", code: "P0001" }, 400, "invalid_settings"], [{ message: "function not found", code: "PGRST202" }, 503, "settings_unavailable"],
      [{ message: "canceling statement due to statement timeout", code: "57014" }, 500, "generic"],
    ];
    for (const [error, status, name] of cases) {
      seed("moo"); h.rpcError = error;
      await unlockStepUp("session-1");
      const res = await POST(post(PATH, SAVE));
      expect([error.message, res.status, await code(res)]).toEqual([error.message, status, name]);
    }
  });
});

describe("GET the settings", () => {
  it("the three roles read every active shop (no row = off, the defaults) and what is installed; nobody else", async () => {
    const res = await GET(get(PATH));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { settings: unknown }).settings).toEqual({ state: "ready", readiness: { linkStep: true, automatic: false },
      shops: [{ locationId: LOC, name: "Shop", values: OFF, updatedAt: null }] });
    seed("gm");
    expect((await GET(get(PATH))).status).toBe(403);
  });
});

describe("the old orders: GET the matches, POST one batch (Tier A)", () => {
  it("GET: the role, a shop id, then the lib", async () => {
    vi.mocked(loadOldOrders).mockResolvedValue(EMPTY_OLD_ORDERS("ready"));
    const res = await GET_OLD(get(`${OLD}?location=${LOC}`));
    expect(res.status).toBe(200);
    expect(vi.mocked(loadOldOrders).mock.calls[0]![1]).toBe(LOC);
    expect((await GET_OLD(get(`${OLD}?location=nope`))).status).toBe(400);
    expect((await GET_OLD(get(OLD))).status).toBe(400);
    seed("catering_mgr");
    expect((await GET_OLD(get(`${OLD}?location=${LOC}`))).status).toBe(403);
    expect(loadOldOrders).toHaveBeenCalledTimes(1);
  });

  it("POST: another origin, a role outside the three, no password, a loose body are each refused before the lib", async () => {
    vi.mocked(linkOldOrders).mockResolvedValue({ linked: 2, refused: {}, remaining: 0 });
    expect(await code(await POST_OLD(post(OLD, { locationId: LOC, skip: 0 }, "https://evil.example")))).toBe("bad_origin");
    expect(await code(await POST_OLD(post(OLD, { locationId: LOC, skip: 0 })))).toBe("step_up_required");
    await unlockStepUp("session-1");
    for (const body of [{ locationId: LOC }, { locationId: LOC, skip: 0, pairs: [] }, { locationId: "x", skip: 0 }]) expect((await POST_OLD(post(OLD, body))).status).toBe(400);
    seed("gm");
    await unlockStepUp("session-1");
    expect((await POST_OLD(post(OLD, { locationId: LOC, skip: 0 }))).status).toBe(403);
    expect(linkOldOrders).not.toHaveBeenCalled();
  });

  it("POST: one batch as the person who pressed, with the skip count and a deadline inside the route's; Tier A does not go stale", async () => {
    vi.mocked(linkOldOrders).mockResolvedValue({ linked: 60, refused: { decision_moved: 1 }, remaining: 12 });
    await unlockStepUp("session-1");
    (h.db.tables.sessions as Array<Record<string, unknown>>)[0]!.step_up_unlocked_at = new Date(Date.now() - 600_000).toISOString();
    const before = Date.now();
    const res = await POST_OLD(post(OLD, { locationId: LOC, skip: 3 }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { result: unknown }).result).toEqual({ linked: 60, refused: { decision_moved: 1 }, remaining: 12 });
    const [actor, shop, skip, deps] = vi.mocked(linkOldOrders).mock.calls[0]!;
    expect([actor.user.id, actor.role, shop, skip]).toEqual(["user-1", "moo", LOC, 3]);
    expect(deps!.deadlineAt!).toBeGreaterThanOrEqual(before + 40_000);
    expect(deps!.deadlineAt!).toBeLessThan(before + 60_000);
  });

  it("the lib's refusals keep their status and name", async () => {
    vi.mocked(linkOldOrders).mockRejectedValue(new CateringToastSettingsError(409, "switch_needs_enabled"));
    await unlockStepUp("session-1");
    const res = await POST_OLD(post(OLD, { locationId: LOC, skip: 0 }));
    expect([res.status, await code(res)]).toEqual([409, "switch_needs_enabled"]);
    vi.mocked(loadOldOrders).mockRejectedValue(new CateringToastSettingsError(503, "settings_unavailable"));
    const down = await GET_OLD(get(`${OLD}?location=${LOC}`));
    expect([down.status, down.headers.get("Retry-After")]).toEqual([503, "60"]);
  });
});
