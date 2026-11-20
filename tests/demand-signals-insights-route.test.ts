/**
 * Item 4 PR 7: POST /api/admin/demand-signals/insights and the model client behind it, with an UNMOCKED
 * requireSession over the predicate-aware fake. THE MODEL IS NEVER CALLED HERE: the SDK module is replaced by a
 * fake class that records how it was built and asked. No network exists in this file.
 *   · INERT: DEMAND_AI unset = 503 and nothing happens; DEMAND_AI=1 WITHOUT ITS OWN KEY = 503
 *     `demand_ai_not_configured`, no ledger call, no SDK client built, even when another feature's key
 *     (ANTHROPIC_API_KEY) is in the environment;
 *   · same-origin first, the trusted role, the shop; the ledger's refusals by name; one bounded request.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeRpc } from "./fake-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./fake-supabase").FakeDb, calls: [] as Array<[string, Record<string, unknown>]>, rpcError: {} as Record<string, { message: string; code?: string }>,
  built: [] as Array<Record<string, unknown>>, asked: [] as Array<Record<string, unknown>>, answer: null as unknown, page: null as unknown, pageCalls: 0,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [LOC] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));
vi.mock("@/lib/demand-signals/signals-page", () => ({ loadSignalsPage: async () => { h.pageCalls++; return h.page; } }));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error { constructor(readonly status: number) { super("api error"); } }
  class APIConnectionTimeoutError extends Error {}
  class Anthropic {
    static APIError = APIError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    constructor(options: Record<string, unknown>) { h.built.push(options); }
    messages = { create: async (body: Record<string, unknown>) => { h.asked.push(body); if (h.answer instanceof Error) throw h.answer; return h.answer; } };
  }
  return { default: Anthropic };
});

import Anthropic from "@anthropic-ai/sdk";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { POST } from "@/app/api/admin/demand-signals/insights/route";
import { askForClaims } from "@/lib/demand-signals/ai-client";
import { INSIGHT_OUTPUT_SCHEMA, INSIGHT_SYSTEM } from "@/lib/demand-signals/insights-shared";

const PATH = "/api/admin/demand-signals/insights";
const LOC = "1c000000-0000-4000-8000-000000000002", OTHER = "1c000000-0000-4000-8000-000000000003";
const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const post = (body: unknown, origin = "http://localhost") => new NextRequest(`http://localhost${PATH}`, {
  method: "POST", body: JSON.stringify(body), headers: { ...cookie, origin, "content-type": "application/json" },
});
const rpc = (name: string, ok: unknown): FakeRpc => (args) => {
  h.calls.push([name, args]);
  return h.rpcError[name] ? { data: null, error: h.rpcError[name]! } : { data: ok, error: null };
};
const message = (text: string) => ({ content: [{ type: "thinking", thinking: "private" }, { type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 640, output_tokens: 90 } });
const PAGE = { state: "ok", today: "2026-11-19", shop: { id: LOC, name: "Shop A" },
  days: [{ date: "2026-11-19", weather: null, weatherGap: "not_collected", eventIds: [] }, { date: "2026-11-20", weather: null, weatherGap: "not_collected", eventIds: ["x"] }],
  events: [{ id: "x", origin: "manual", sourceId: null, locationId: LOC, category: "sports_game", validFrom: "2026-11-20", validTo: "2026-11-20", startLocal: null, endLocal: null,
    title: "Private title that must not travel", expectedImpact: "up", severity: null, canEdit: true }] };

function seed(role: string) {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  h.calls = []; h.rpcError = {}; h.built = []; h.asked = []; h.pageCalls = 0; h.page = PAGE;
  h.answer = message(JSON.stringify({ claims: [{ type: "event_on_date", evidenceIds: ["e1"] }, { type: "event_on_date", evidenceIds: ["e7"] }] }));
  h.db = fakeSupabase({
    sessions: [{ id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password", step_up_unlocked: false, step_up_unlocked_at: null,
      catalog_edit_unlocked_at: null, created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(), expires_at: future, revoked_at: null, ip_address: null, user_agent: null }],
    users: [{ id: "user-1", name: "Gina", email: "gm@example.test", role, active: true, language: "en" }],
    user_locations: [{ user_id: "user-1", location_id: LOC, active: true }],
    locations: [{ id: LOC, name: "Shop A", active: true }, { id: OTHER, name: "Shop B", active: true }],
  }, {
    demand_ai_reserve: rpc("demand_ai_reserve", { id: "res-1", day_et: "2026-11-19", month_spent_before_micro: 0 }),
    demand_ai_settle: rpc("demand_ai_settle", { reservation_id: "res-1", outcome: "ok" }),
  });
}
const code = async (r: Response) => ((await r.json()) as { code?: string }).code;
const SAVED = { ...process.env };
function setEnv(over: Record<string, string | undefined>) {
  for (const k of ["DEMAND_SIGNALS", "DEMAND_AI", "DEMAND_AI_API_KEY", "DEMAND_AI_MODEL", "DEMAND_AI_MONTHLY_CAP_CENTS", "ANTHROPIC_API_KEY"]) delete process.env[k];
  for (const [k, v] of Object.entries(over)) if (v !== undefined) process.env[k] = v;
}
const ON = { DEMAND_SIGNALS: "1", DEMAND_AI: "1", DEMAND_AI_API_KEY: "k-test-not-a-real-key" };
beforeEach(() => { seed("gm"); setEnv(ON); });
afterEach(() => { process.env = { ...SAVED }; });
const untouched = () => { expect(h.calls).toEqual([]); expect(h.built).toEqual([]); expect(h.asked).toEqual([]); };

describe("INERT unless everything is set", () => {
  it("DEMAND_AI unset (or anything but 1): 503, and nothing is read, reserved, built or sent", async () => {
    for (const v of [undefined, "", "0", "true"]) {
      setEnv({ ...ON, DEMAND_AI: v });
      const res = await POST(post({ locationId: LOC }));
      expect([res.status, await code(res)]).toEqual([503, "demand_ai_off"]);
    }
    untouched();
    expect(h.pageCalls).toBe(0);
  });
  it("DEMAND_AI=1 WITHOUT ITS OWN KEY: 503 'not configured', nothing reserved, no client built, even with another feature's key present", async () => {
    for (const over of [{ DEMAND_AI_API_KEY: undefined }, { DEMAND_AI_API_KEY: "" }, { DEMAND_AI_API_KEY: "   " }, { DEMAND_AI_API_KEY: undefined, ANTHROPIC_API_KEY: "another-features-key" }]) {
      setEnv({ ...ON, ...over });
      const res = await POST(post({ locationId: LOC }));
      expect([res.status, await code(res)]).toEqual([503, "demand_ai_not_configured"]);
    }
    untouched();
    expect(h.pageCalls).toBe(0);
  });
  it("the signals switch off, or a model with no price in code: 503 and nothing happens", async () => {
    setEnv({ ...ON, DEMAND_SIGNALS: undefined });
    let res = await POST(post({ locationId: LOC }));
    expect([res.status, await code(res)]).toEqual([503, "demand_signals_off"]);
    setEnv({ ...ON, DEMAND_AI_MODEL: "claude-haiku-5-5" });
    res = await POST(post({ locationId: LOC }));
    expect([res.status, await code(res)]).toEqual([503, "demand_ai_model_unpriced"]);
    untouched();
  });
});

describe("who may ask, and for which shop", () => {
  it("same-origin first; level-6 roles are refused by ROLE before any switch is read", async () => {
    expect((await POST(post({ locationId: LOC }, "https://evil.example"))).status).toBe(403);
    for (const role of ["agm", "social_media_mgr", "catering_mgr", "shift_lead"]) {
      seed(role);
      const res = await POST(post({ locationId: LOC }));
      expect([res.status, await code(res)], role).toEqual([403, "demand_ai_forbidden"]);
    }
    untouched();
  });
  it("a GM is refused another shop; a bad body is refused; neither reaches the ledger or the model", async () => {
    let res = await POST(post({ locationId: OTHER }));
    expect([res.status, await code(res)]).toEqual([403, "demand_ai_shop_forbidden"]);
    for (const body of [{}, { locationId: "not-a-uuid" }, { locationId: 7 }]) {
      res = await POST(post(body));
      expect([res.status, await code(res)]).toEqual([400, "demand_ai_invalid"]);
    }
    untouched();
  });
});

describe("one request", () => {
  it("reserves, asks ONCE with this feature's key and the bounds, settles the real cost and only the validated claim", async () => {
    const res = await POST(post({ locationId: LOC }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claims: 1, rejected: 1 });   // e7 is not a fact that was sent
    expect(h.calls.map((c) => c[0])).toEqual(["demand_ai_reserve", "demand_ai_settle"]);
    expect(h.calls[0]![1]).toMatchObject({ p_actor: "user-1", p_location_id: LOC, p_model: "claude-opus-5-5", p_prompt_version: 1, p_cap_micro: 5_000_000 });
    expect(h.calls[0]![1].p_input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.built).toEqual([{ apiKey: "k-test-not-a-real-key", timeout: 20_000, maxRetries: 1 }]);
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]).toEqual({ model: "claude-opus-5-5", max_tokens: 2_000, system: INSIGHT_SYSTEM, messages: [{ role: "user", content: expect.any(String) }],
      output_config: { effort: "low", format: { type: "json_schema", schema: INSIGHT_OUTPUT_SCHEMA } } });
    // What was sent names no title, no shop and no person.
    expect(JSON.stringify(h.asked[0])).not.toMatch(/Private title|Shop A|Gina|1c000000/);
    expect(h.calls[1]![1]).toMatchObject({ p_reservation_id: "res-1", p_outcome: "ok", p_input_tokens: 640, p_output_tokens: 90, p_actual_micro: 640 * 4 + 90 * 20, p_stop_reason: "end_turn",
      p_rejected_count: 1, p_claims: [{ type: "event_on_date", facts: [{ id: "e1", kind: "named_event", date: "2026-11-20", endDate: "2026-11-20", category: "sports_game", impact: "up", origin: "manual", scope: "shop" }] }] });
    // Nothing the model wrote is stored or returned: not its thinking, not its text.
    expect(JSON.stringify(h.calls)).not.toMatch(/private|thinking/);
    expect((h.calls[0]![1].p_reserve_micro as number)).toBeGreaterThanOrEqual(h.calls[1]![1].p_actual_micro as number);
  });
  it("the ledger's refusals end the request by name BEFORE the model is built or asked", async () => {
    for (const [message, status, name] of [["demand_ai_daily_limit", 409, "demand_ai_daily_limit"], ["demand_ai_cap_reached", 409, "demand_ai_cap_reached"],
      ["demand_ai_shop_forbidden", 403, "demand_ai_shop_forbidden"], ["Could not find the function public.demand_ai_reserve", 503, "demand_ai_unavailable"]] as const) {
      seed("gm");
      h.rpcError = { demand_ai_reserve: { message, ...(status === 503 ? { code: "PGRST202" } : {}) } };
      const res = await POST(post({ locationId: LOC }));
      expect([res.status, await code(res)]).toEqual([status, name]);
      expect(h.built).toEqual([]); expect(h.asked).toEqual([]);
      expect(h.calls.map((c) => c[0])).toEqual(["demand_ai_reserve"]);
    }
  });
  it("prose from the model is settled at its cost and nothing of it is kept; a failed call is settled 'failed'", async () => {
    h.answer = message("Saturday will be slammed. Order double.");
    let res = await POST(post({ locationId: LOC }));
    expect([res.status, await code(res)]).toEqual([502, "demand_ai_answer_unreadable"]);
    expect(h.calls[1]![1]).toMatchObject({ p_outcome: "ok", p_stop_reason: "answer_unreadable", p_claims: [] });
    expect(JSON.stringify(h.calls)).not.toMatch(/slammed|double/);
    seed("gm");
    h.answer = new (Anthropic as unknown as { APIConnectionTimeoutError: new () => Error }).APIConnectionTimeoutError();
    res = await POST(post({ locationId: LOC }));
    expect([res.status, await code(res)]).toEqual([502, "demand_ai_timeout"]);
    expect(h.calls[1]![1]).toMatchObject({ p_outcome: "failed", p_error_code: "ai_timeout", p_claims: [], p_actual_micro: null });
  });
  it("a page that was not read whole, or has nothing to ask about, never reaches the ledger or the model", async () => {
    h.page = { ...PAGE, events: null };
    let res = await POST(post({ locationId: LOC }));
    expect([res.status, await code(res)]).toEqual([409, "demand_ai_facts_incomplete"]);
    h.page = { state: "unreadable" };
    res = await POST(post({ locationId: LOC }));
    expect([res.status, await code(res)]).toEqual([503, "demand_ai_facts_incomplete"]);
    h.page = { ...PAGE, events: [], days: [{ date: "2026-11-19", weather: null, weatherGap: "beyond_reach", eventIds: [] }] };
    res = await POST(post({ locationId: LOC }));
    expect([res.status, await code(res)]).toEqual([409, "demand_ai_nothing_to_say"]);
    untouched();
  });
});

describe("the model client", () => {
  const args = { apiKey: "k-test-not-a-real-key", model: "claude-opus-5-5", system: "s", user: "u", schema: { type: "object" }, maxTokens: 10, timeoutMs: 5, maxRetries: 0 };
  beforeEach(() => { h.built = []; h.asked = []; });
  it("refuses to build a client without a key (the SDK would otherwise read another key from the environment)", async () => {
    for (const apiKey of ["", "  ", undefined as unknown as string]) await expect(askForClaims({ ...args, apiKey })).rejects.toThrow("ai_key_missing");
    expect(h.built).toEqual([]);
  });
  it("returns the first text block and the usage, and nothing else the model produced", async () => {
    h.answer = { content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "{}" }, { type: "text", text: "second" }], stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } };
    expect(await askForClaims(args)).toEqual({ ok: true, text: "{}", stopReason: "end_turn", inputTokens: 16, outputTokens: 3 });
    h.answer = { content: [], stop_reason: "max_tokens", usage: { input_tokens: 10, output_tokens: 10 } };
    expect(await askForClaims(args)).toEqual({ ok: true, text: null, stopReason: "max_tokens", inputTokens: 10, outputTokens: 10 });
  });
  it("an error is a fixed code, never a message", async () => {
    const A = Anthropic as unknown as { APIError: new (status: number) => Error; APIConnectionTimeoutError: new () => Error };
    for (const [error, expected] of [[new A.APIConnectionTimeoutError(), "ai_timeout"], [new A.APIError(401), "ai_auth"], [new A.APIError(429), "ai_rate_limited"],
      [new A.APIError(400), "ai_refused_request"], [new A.APIError(500), "ai_unavailable"], [new Error("secret detail"), "ai_unavailable"]] as const) {
      h.answer = error;
      expect(await askForClaims(args)).toEqual({ ok: false, code: expected });
    }
  });
});
