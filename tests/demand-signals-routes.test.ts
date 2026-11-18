/**
 * Item 4 PR 2: POST /api/admin/demand-signals/sources/mark (the human door of the verification gate) and the
 * store behind it. Run over the predicate-aware fake with an UNMOCKED requireSession, like the payroll-shop
 * route: same-origin first, the session, the trusted role (MoO+; a GM is refused before the password), Tier B
 * (kept by the route's own requireSession because the path is under /api/admin), then 0343's writer, which
 * re-reads the role and writes the audit row (who, when).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeRpc } from "./fake-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./fake-supabase").FakeDb, calls: [] as Array<[string, Record<string, unknown>]>,
  rpcError: null as { message: string; code?: string } | null, weather: [] as Array<Record<string, unknown>>, states: [] as Array<Record<string, unknown>> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));

import { isStepUpSurface, SESSION_COOKIE_NAME, unlockStepUp } from "@/lib/session";
import { POST } from "@/app/api/admin/demand-signals/sources/mark/route";
import { DemandSignalError, collectionPrecheck, loadUsableWeather, readSourceStates, saveDemandEvent } from "@/lib/demand-signals/signal-store";
import { NWS_DEFINITION } from "@/lib/demand-signals/nws-shared";
import { parseDemandEvent } from "@/lib/demand-signals/sources-shared";

const PATH = "/api/admin/demand-signals/sources/mark";
const LOC = "1c000000-0000-4000-8000-000000000002", OTHER = "1c000000-0000-4000-8000-000000000003";
const HASH = "a".repeat(64);
const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const post = (body: unknown, origin = "http://localhost") => new NextRequest(`http://localhost${PATH}`, {
  method: "POST", body: JSON.stringify(body), headers: { ...cookie, origin, "content-type": "application/json" },
});
const MARK = { sourceId: "nws", definitionHash: HASH, status: "verified", note: "Read the weather.gov terms today" };
const rpc = (name: string, ok: unknown): FakeRpc => (args) => {
  h.calls.push([name, args]);
  return h.rpcError ? { data: null, error: h.rpcError } : { data: typeof ok === "function" ? (ok as () => unknown)() : ok, error: null };
};
const state = (over: Record<string, unknown> = {}) => ({ source_id: "nws", source_seq: 1, definition_hash: NWS_DEFINITION.hash, name: "NWS", category: "weather",
  gate: "allow_with_conditions", terms_status: "verified", terms_url: "https://x.test", adapter: "nws@1", status: "verified", marked_at: null, marked_by: null, ...over });

function seed(role: string) {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  h.calls = []; h.rpcError = null; h.weather = []; h.states = [state()];
  h.db = fakeSupabase({
    sessions: [{
      id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password",
      step_up_unlocked: false, step_up_unlocked_at: null, catalog_edit_unlocked_at: null,
      created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
      expires_at: future, revoked_at: null, ip_address: null, user_agent: null,
    }],
    users: [{ id: "user-1", name: "Ops", email: "ops@example.test", role, active: true, language: "en" }],
    user_locations: [{ user_id: "user-1", location_id: LOC, active: true }],
  }, {
    demand_source_mark: rpc("demand_source_mark", { event_seq: 4, status: "verified", source_seq: 1 }),
    demand_source_states: rpc("demand_source_states", () => h.states),
    demand_usable_weather: rpc("demand_usable_weather", () => h.weather),
    demand_event_save: rpc("demand_event_save", { id: "ev-1", retracted: false }),
  });
}
beforeEach(() => seed("moo"));

describe("POST /api/admin/demand-signals/sources/mark", () => {
  it("is a step-up surface (the Tier B unlock survives its own requireSession)", () => {
    expect(isStepUpSurface(PATH)).toBe(true);
  });
  it("a MoO with a fresh password marks it: the writer gets the actor and the definition the person read", async () => {
    await unlockStepUp("session-1");
    const res = await POST(post(MARK));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ eventSeq: 4, status: "verified" });
    expect(h.calls).toEqual([["demand_source_mark", { p_actor: "user-1", p_source_id: "nws", p_definition_hash: HASH, p_status: "verified", p_note: MARK.note }]]);
  });
  it("without a password: 403 step_up_required, nothing written", async () => {
    const res = await POST(post(MARK));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "step_up_required" });
    expect(h.calls).toEqual([]);
  });
  it.each(["gm", "agm", "social_media_mgr", "catering_mgr"])("a %s is refused by role before any password prompt", async (role) => {
    seed(role);
    await unlockStepUp("session-1");
    const res = await POST(post(MARK));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden" });
    expect(h.calls).toEqual([]);
  });
  it("a cross-origin post is refused first", async () => {
    await unlockStepUp("session-1");
    const res = await POST(post(MARK, "https://evil.test"));
    expect(res.status).toBe(403);
    expect(h.calls).toEqual([]);
  });
  it.each([{ ...MARK, status: "approved" }, { ...MARK, note: " " }, { ...MARK, definitionHash: "xyz" }, { ...MARK, sourceId: "NWS!" }, null])(
    "a malformed body is 400 (%#)", async (body) => {
      await unlockStepUp("session-1");
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      expect(h.calls).toEqual([]);
    });
  it.each([
    ["source_definition_moved", 409], ["source_not_ingestible", 409], ["source_status_unchanged", 409], ["source_unknown", 404],
    ["demand_source_forbidden", 403], ["demand_source_invalid", 400],
  ])("the writer's refusal %s is answered by name (%i)", async (name, status) => {
    await unlockStepUp("session-1");
    h.rpcError = { message: name };
    const res = await POST(post(MARK));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code: name });
  });
  it("before 0343 is applied: 503 demand_signals_unavailable; any other error is a generic 500 (no database text)", async () => {
    await unlockStepUp("session-1");
    h.rpcError = { message: "Could not find the function public.demand_source_mark", code: "PGRST202" };
    expect((await POST(post(MARK))).status).toBe(503);
    await unlockStepUp("session-1");
    h.rpcError = { message: "connection reset by peer at 10.0.0.1" };
    const res = await POST(post(MARK));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.1");
  });
});

describe("the store: the register is asked at every use", () => {
  it("reads the register as it is now", async () => {
    expect(await readSourceStates(h.db.client as never)).toEqual([{ sourceId: "nws", definitionHash: NWS_DEFINITION.hash, gate: "allow_with_conditions", adapter: "nws@1", status: "verified" }]);
  });
  it("the cron's precheck: ready only when THIS adapter's definition is verified now", async () => {
    expect(await collectionPrecheck(h.db.client as never)).toBe("ready");
    h.states = [state({ status: "unverified" })];
    expect(await collectionPrecheck(h.db.client as never)).toBe("source_unverified");
    h.states = [state({ status: "revoked" })];
    expect(await collectionPrecheck(h.db.client as never)).toBe("source_revoked");
    h.states = [state({ definition_hash: "b".repeat(64) })];
    expect(await collectionPrecheck(h.db.client as never)).toBe("source_unverified");
    h.states = [];
    expect(await collectionPrecheck(h.db.client as never)).toBe("source_unverified");
    h.rpcError = { message: "no function", code: "PGRST202" };
    expect(await collectionPrecheck(h.db.client as never)).toBe("not_installed");
    h.rpcError = { message: "boom" };
    expect(await collectionPrecheck(h.db.client as never)).toBe("source_unverified");   // unreadable = closed
  });
  it("compute / render: a stored row is returned only while its source is verified NOW (asked here AND in SQL)", async () => {
    const row = { source_id: "nws", valid_hour: "2026-11-18T16:00:00+00:00", issued_at: "2026-11-18T14:00:00+00:00", available_at: "2026-11-18T15:00:00+00:00",
      vintage_id: 9, temperature_f: 57, precip_probability_pct: 0, wind_speed_mph: 2, relative_humidity_pct: 40, is_daytime: true, condition: "Sunny" };
    const args = { locationId: LOC, fromIso: "2026-11-18T00:00:00Z", toIso: "2026-11-19T00:00:00Z", asOfIso: "2026-11-18T16:00:00Z", use: "render" as const };
    h.weather = [row, { ...row, source_id: "ncei_observed", vintage_id: 10 }];
    const got = await loadUsableWeather(h.db.client as never, args);
    expect(got.map((r) => r.sourceId)).toEqual(["nws"]);                   // ncei is not in the register: unverified
    expect(got[0]).toMatchObject({ validHour: row.valid_hour, temperatureF: 57, vintageId: 9, sourceIds: ["nws"] });
    expect(h.calls.map((c) => c[0])).toEqual(["demand_source_states", "demand_usable_weather"]);
    expect(h.calls[1]![1]).toEqual({ p_location_id: LOC, p_from: args.fromIso, p_to: args.toIso, p_as_of: args.asOfIso });
    // Revoked after the rows were stored: even if a reader handed them back, they are not used.
    h.states = [state({ status: "revoked" })];
    expect(await loadUsableWeather(h.db.client as never, args)).toEqual([]);
  });
  it("manual events: refused early by role and shop, else sent to 0343's writer with the actor", async () => {
    const input = parseDemandEvent({ locationId: LOC, category: "sports_game", validFrom: "2026-11-20", title: "Home game", impact: "up" })!;
    await expect(saveDemandEvent(h.db.client as never, { userId: "u", role: "agm", locations: [LOC] }, input)).rejects.toMatchObject({ status: 403, code: "demand_event_forbidden" });
    await expect(saveDemandEvent(h.db.client as never, { userId: "u", role: "gm", locations: [OTHER] }, input)).rejects.toMatchObject({ status: 403, code: "demand_event_shop_forbidden" });
    await expect(saveDemandEvent(h.db.client as never, { userId: "u", role: "gm", locations: [LOC] }, { ...input, locationId: null })).rejects.toBeInstanceOf(DemandSignalError);
    expect(h.calls).toEqual([]);
    expect(await saveDemandEvent(h.db.client as never, { userId: "u", role: "gm", locations: [LOC] }, input)).toEqual({ id: "ev-1", retracted: false });
    expect(h.calls[0]).toEqual(["demand_event_save", { p_actor: "u", p_location_id: LOC, p_category: "sports_game", p_valid_from: "2026-11-20", p_valid_to: "2026-11-20",
      p_start_local: null, p_end_local: null, p_title: "Home game", p_impact: "up", p_note: null, p_supersedes: null, p_retract: false }]);
    h.rpcError = { message: "demand_event_moved" };
    await expect(saveDemandEvent(h.db.client as never, { userId: "u", role: "moo", locations: [] }, input)).rejects.toMatchObject({ status: 409, code: "demand_event_moved" });
  });
});
