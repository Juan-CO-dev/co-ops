/**
 * Business report access: POST /api/admin/reports/business-visibility (0349 save_business_report_gm_visibility).
 * Plan r5: `assertSameOrigin` -> session -> role -> switch -> step-up (Tier B) -> the exact body -> RPC. Run UNMOCKED
 * over the predicate-aware fake, like tests/labor-burden-route.test.ts: the route lives under /api/admin, so its own
 * requireSession keeps the Tier B unlock the preceding POST /api/auth/step-up set. Dark: without BUSINESS_REPORT (and
 * the two fact switches) it answers 503 before the password is even asked for, and nothing is written.
 */
import { readFileSync } from "node:fs";
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
import { POST } from "@/app/api/admin/reports/business-visibility/route";
import { GM_VISIBILITY_DEFAULTS } from "@/lib/business-access-shared";

const PATH = "/api/admin/reports/business-visibility";
const HEAD = "2d000000-0000-4000-8000-000000000009";
const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const visit = async (path: string) => {
  const ctx = await requireSession(new NextRequest(`http://localhost${path}`, { headers: cookie }), path);
  if (ctx instanceof Response) throw new Error(`denied on ${path}`);
};
const post = (body: unknown, origin = "http://localhost") => new NextRequest(`http://localhost${PATH}`, {
  method: "POST", body: JSON.stringify(body), headers: { ...cookie, origin, "content-type": "application/json" },
});
const ALL_ON = { report: true, hourly_cost: true, loaded: true, quarters: true, channels: true, people: true, servers: true, compare: true, export: true };
const FIRST = { settings: ALL_ON, expectedId: null };
const NEXT = { settings: { ...ALL_ON, hourly_cost: false, loaded: false }, expectedId: HEAD };
const save: FakeRpc = (args) => {
  h.calls.push(args);
  return h.rpcError ? { data: null, error: h.rpcError } : { data: "row-1", error: null };
};
const sessionRow = () => (h.db.tables.sessions as Array<Record<string, unknown>>)[0]!;
const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
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
    user_locations: [],
  }, { save_business_report_gm_visibility: save });
}
beforeEach(() => { seed("moo"); setEnv(ON); vi.mocked(audit).mockClear(); });
afterEach(() => setEnv({ BUSINESS_REPORT: undefined, FACT_LAYER: undefined, FACT_LAYER_LABOR: undefined }));

describe("Tier B survives the route's own requireSession", () => {
  it("the route path is a step-up surface", () => {
    expect(isStepUpSurface(PATH)).toBe(true);
  });
  it("a password set for this save is kept by the route and the save reaches the writer with the exact arguments", async () => {
    await unlockStepUp("session-1");
    await visit("/dashboard"); // leaving the surface clears a stale unlock
    expect(sessionRow().step_up_unlocked).toBe(false);
    await unlockStepUp("session-1");
    const res = await POST(post(FIRST));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "row-1" });
    expect(h.calls).toEqual([{ p_actor: "user-1", p_settings: ALL_ON, p_expected_id: null }]);
  });
  it("the next save carries the head the card showed (lowercase), and the whole set of nine", async () => {
    await unlockStepUp("session-1");
    expect((await POST(post({ ...NEXT, expectedId: HEAD.toUpperCase() }))).status).toBe(200);
    expect(h.calls).toEqual([{ p_actor: "user-1", p_settings: NEXT.settings, p_expected_id: HEAD }]);
    expect(Object.keys(h.calls[0]!.p_settings as object).sort()).toEqual(Object.keys(GM_VISIBILITY_DEFAULTS).sort());
  });
  it("without a password: 403 step_up_required, nothing written; turning things OFF is prompted too", async () => {
    for (const body of [FIRST, NEXT]) {
      const res = await POST(post(body));
      expect([res.status, (await res.json()).code]).toEqual([403, "step_up_required"]);
    }
    expect(h.calls).toEqual([]);
  });
  it("a password older than the Tier B window: 403 step_up_stale, nothing written", async () => {
    await unlockStepUp("session-1");
    sessionRow().step_up_unlocked_at = new Date(Date.now() - 10 * 60_000).toISOString();
    const res = await POST(post(FIRST));
    expect([res.status, (await res.json()).code]).toEqual([403, "step_up_stale"]);
    expect(h.calls).toEqual([]);
  });
  it("the audit row is the writer's own (SQL, same transaction): the route never writes one", async () => {
    await unlockStepUp("session-1");
    await POST(post(FIRST));
    expect(vi.mocked(audit).mock.calls.filter(([a]) => String(a.action).startsWith("business_report"))).toEqual([]);
    const src = readFileSync("app/api/admin/reports/business-visibility/route.ts", "utf8") + readFileSync("lib/business-visibility.ts", "utf8");
    expect(src.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\baudit(Checked)?\(/);
  });
});

describe("order and refusals", () => {
  it("the first two statements are the same-origin check and its refusal, before the session", () => {
    const src = readFileSync("app/api/admin/reports/business-visibility/route.ts", "utf8");
    const body = src.slice(src.indexOf("export async function POST"));
    expect(body).toMatch(/^export async function POST\(req: NextRequest\) \{\n  const origin = assertSameOrigin\(req\);\n  if \(origin\) return origin;\n  const ctx = await requireSession\(/);
    const order = ["assertSameOrigin(req)", "requireSession(req", "canManageBusinessVisibility(ctx.role)", "businessReportEnabled(process.env)", "assertStepUp(ctx, \"B\")",
      "parseJsonBody(req)", "parseGmVisibilitySave(body)", "saveBusinessVisibility("].map((s) => body.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it("a foreign origin is refused before anything else", async () => {
    await unlockStepUp("session-1");
    const res = await POST(post(FIRST, "http://evil.example"));
    expect(res.status).toBe(403);
    expect(h.calls).toEqual([]);
  });
  it("a GM, an AGM, the social media manager and the catering manager are refused by trusted role, password or not", async () => {
    for (const role of ["gm", "agm", "social_media_mgr", "catering_mgr", "shift_lead"]) {
      seed(role);
      await unlockStepUp("session-1");
      const res = await POST(post(FIRST));
      expect([res.status, (await res.json()).code], role).toEqual([403, "forbidden"]);
    }
    expect(h.calls).toEqual([]);
  });
  it("the owner and the CGS may save", async () => {
    for (const role of ["owner", "cgs"]) {
      seed(role);
      await unlockStepUp("session-1");
      expect((await POST(post(FIRST))).status, role).toBe(200);
    }
  });
  it("dark: any of the three switches off is 503 unavailable, after the role and before the password", async () => {
    for (const off of ["BUSINESS_REPORT", "FACT_LAYER", "FACT_LAYER_LABOR"]) {
      setEnv({ ...ON, [off]: undefined });
      const res = await POST(post(FIRST)); // no password typed
      expect([res.status, (await res.json()).code], off).toEqual([503, "unavailable"]);
    }
    setEnv({ ...ON, BUSINESS_REPORT: "true" });
    expect((await POST(post(FIRST))).status).toBe(503);
    seed("gm");
    setEnv({ ...ON, BUSINESS_REPORT: undefined });
    expect((await (await POST(post(FIRST))).json()).code).toBe("forbidden"); // the role is judged first
    expect(h.calls).toEqual([]);
  });
  it("a body that is not exactly { settings: the coherent nine, expectedId } is 400 before the RPC", async () => {
    await unlockStepUp("session-1");
    const { export: _drop, ...missing } = ALL_ON;
    for (const bad of [{ settings: ALL_ON }, { ...FIRST, note: "x" }, { settings: missing, expectedId: null }, { settings: { ...ALL_ON, person_cost: true }, expectedId: null },
      { settings: { ...ALL_ON, quarter_cost: true }, expectedId: null }, { settings: { ...ALL_ON, loaded: "yes" }, expectedId: null },
      { settings: { ...ALL_ON, hourly_cost: false }, expectedId: null }, { settings: { ...ALL_ON, report: false }, expectedId: null },
      { settings: ALL_ON, expectedId: "not-a-uuid" }, { settings: ALL_ON, expectedId: 7 }, [FIRST], "x"]) {
      const res = await POST(post(bad));
      expect([res.status, (await res.json()).code], JSON.stringify(bad)).toEqual([400, "invalid"]);
    }
    expect(h.calls).toEqual([]);
  });
  it("the named refusals of the writer map to codes; a missing 0349 is 503 unavailable", async () => {
    await unlockStepUp("session-1");
    const cases: [{ message: string; code?: string }, number, string][] = [
      [{ message: "business_visibility_moved" }, 409, "moved"], [{ message: "business_visibility_unchanged" }, 409, "unchanged"],
      [{ message: "business_visibility_invalid" }, 400, "invalid"], [{ message: "business_visibility_forbidden" }, 403, "forbidden"],
      [{ message: "something else" }, 500, "generic"],
      [{ message: "Could not find the function public.save_business_report_gm_visibility", code: "PGRST202" }, 503, "unavailable"],
      [{ message: "function does not exist", code: "42883" }, 503, "unavailable"]];
    for (const [error, status, code] of cases) {
      h.rpcError = error;
      const res = await POST(post(FIRST));
      expect([res.status, (await res.json()).code], error.message).toEqual([status, code]);
    }
  });
});
