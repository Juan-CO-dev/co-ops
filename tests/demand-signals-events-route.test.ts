/**
 * Item 4 PR 5: POST /api/admin/demand-signals/events (a manual event: new, corrected, taken back) with an
 * UNMOCKED requireSession over the predicate-aware fake. Order under test: same-origin, the session, the trusted
 * role (a level-6 role is refused whatever its level), the switch (DEMAND_SIGNALS unset = 503 and NO read or
 * write), the parser the form uses, then 0343's writer. Also: the two pages are dark and role-gated before any read.
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeRpc } from "./fake-supabase";

const h = vi.hoisted(() => ({ db: null as unknown as import("./fake-supabase").FakeDb, calls: [] as Array<[string, Record<string, unknown>]>,
  rpcError: null as { message: string; code?: string } | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  verifyJwt: async () => ({ user_id: "user-1", session_id: "session-1", locations: [LOC] }),
  hashToken: async () => "hash-1",
  signJwt: async () => "jwt",
}));

import { SESSION_COOKIE_NAME } from "@/lib/session";
import { POST } from "@/app/api/admin/demand-signals/events/route";

const PATH = "/api/admin/demand-signals/events";
const LOC = "1c000000-0000-4000-8000-000000000002", OTHER = "1c000000-0000-4000-8000-000000000003", HEAD = "1c000000-0000-4000-8000-0000000000aa";
const cookie = { cookie: `${SESSION_COOKIE_NAME}=jwt` };
const post = (body: unknown, origin = "http://localhost") => new NextRequest(`http://localhost${PATH}`, {
  method: "POST", body: JSON.stringify(body), headers: { ...cookie, origin, "content-type": "application/json" },
});
const EVENT = { locationId: LOC, category: "sports_game", validFrom: "2026-11-21", validTo: "2026-11-21", startLocal: "19:00", endLocal: null, title: "Home game", impact: "up", supersedesId: null, retract: false };
const rpc = (name: string, ok: unknown): FakeRpc => (args) => {
  h.calls.push([name, args]);
  return h.rpcError ? { data: null, error: h.rpcError } : { data: ok, error: null };
};
function seed(role: string) {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  h.calls = []; h.rpcError = null;
  h.db = fakeSupabase({
    sessions: [{ id: "session-1", user_id: "user-1", token_hash: "hash-1", auth_method: "password", step_up_unlocked: false, step_up_unlocked_at: null,
      catalog_edit_unlocked_at: null, created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(), expires_at: future, revoked_at: null, ip_address: null, user_agent: null }],
    users: [{ id: "user-1", name: "Gina", email: "gm@example.test", role, active: true, language: "en" }],
    user_locations: [{ user_id: "user-1", location_id: LOC, active: true }],
  }, { demand_event_save: rpc("demand_event_save", { id: "ev-1", retracted: false }) });
}
const code = async (r: Response) => ((await r.json()) as { code?: string }).code;
const ENV = process.env.DEMAND_SIGNALS;
beforeEach(() => { seed("gm"); process.env.DEMAND_SIGNALS = "1"; });
afterEach(() => { if (ENV === undefined) delete process.env.DEMAND_SIGNALS; else process.env.DEMAND_SIGNALS = ENV; });

describe("POST /api/admin/demand-signals/events", () => {
  it("a GM saves an event for their shop with NO password prompt; the writer gets the actor and the parsed fields", async () => {
    const res = await POST(post(EVENT));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "ev-1", retracted: false });
    expect(h.calls).toEqual([["demand_event_save", { p_actor: "user-1", p_location_id: LOC, p_category: "sports_game", p_valid_from: "2026-11-21", p_valid_to: "2026-11-21",
      p_start_local: "19:00", p_end_local: null, p_title: "Home game", p_impact: "up", p_note: null, p_supersedes: null, p_retract: false }]]);
  });
  it("same-origin is checked first: a cross-site post is refused before the session and the writer", async () => {
    const res = await POST(post(EVENT, "https://evil.example"));
    expect(res.status).toBe(403);
    expect(h.calls).toEqual([]);
  });
  it("level-6 roles and below are refused by ROLE before the switch and the writer", async () => {
    for (const role of ["agm", "social_media_mgr", "catering_mgr", "prep_mgr", "shift_lead"]) {
      seed(role);
      const res = await POST(post(EVENT));
      expect(res.status, role).toBe(403);
      expect(await code(res), role).toBe("demand_event_forbidden");
      expect(h.calls, role).toEqual([]);
    }
  });
  it("OFF: with DEMAND_SIGNALS unset (or anything but 1) the route answers 503 and writes nothing", async () => {
    for (const v of [undefined, "", "0", "true"]) {
      if (v === undefined) delete process.env.DEMAND_SIGNALS; else process.env.DEMAND_SIGNALS = v;
      const res = await POST(post(EVENT));
      expect(res.status).toBe(503);
      expect(await code(res)).toBe("demand_signals_off");
    }
    expect(h.calls).toEqual([]);
  });
  it("a bad body is refused by the form's own parser before the writer", async () => {
    for (const bad of [{ ...EVENT, title: "x" }, { ...EVENT, validTo: "2026-11-01" }, { ...EVENT, category: "party" }, { retract: true }, {}]) {
      const res = await POST(post(bad));
      expect(res.status).toBe(400);
      expect(await code(res)).toBe("demand_event_invalid");
    }
    // Not an object at all: refused one step earlier, by the shared body parser.
    for (const bad of [null, []]) expect((await POST(post(bad))).status).toBe(400);
    expect(h.calls).toEqual([]);
  });
  it("a GM is refused another shop and 'every shop' before the writer; MoO may send both", async () => {
    for (const locationId of [OTHER, null]) {
      const res = await POST(post({ ...EVENT, locationId }));
      expect(res.status).toBe(403);
      expect(await code(res)).toBe("demand_event_shop_forbidden");
    }
    expect(h.calls).toEqual([]);
    seed("moo");
    expect((await POST(post({ ...EVENT, locationId: null }))).status).toBe(200);
    expect(h.calls[0]![1]).toMatchObject({ p_location_id: null });
  });
  it("a retraction names the head only (the writer keeps the head's own fields and decides the shop on the row)", async () => {
    const res = await POST(post({ supersedesId: HEAD, retract: true }));
    expect(res.status).toBe(200);
    expect(h.calls[0]![1]).toMatchObject({ p_supersedes: HEAD, p_retract: true, p_location_id: null, p_title: null, p_category: null });
  });
  it("the writer's refusals come back by name: a head that moved is 409, a missing 0343 is 503, anything else a plain 500", async () => {
    h.rpcError = { message: "demand_event_moved" };
    let res = await POST(post({ ...EVENT, supersedesId: HEAD }));
    expect([res.status, await code(res)]).toEqual([409, "demand_event_moved"]);
    h.rpcError = { message: "Could not find the function public.demand_event_save", code: "PGRST202" };
    res = await POST(post(EVENT));
    expect([res.status, await code(res)]).toEqual([503, "demand_signals_unavailable"]);
    h.rpcError = { message: "connection reset by peer at 10.0.0.4" };
    res = await POST(post(EVENT));
    expect([res.status, await code(res)]).toEqual([500, "generic"]);
  });
});

describe("the two pages are dark and role-gated before anything is read", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("the signals page: session, then role AND switch (404), then the first read", () => {
    const src = read("app/admin/demand-signals/page.tsx");
    const gate = src.indexOf("if (!canViewDemandSignals(auth.role) || !demandSignalsEnabled(process.env.DEMAND_SIGNALS)) notFound();");
    expect(gate).toBeGreaterThan(src.indexOf('requireSessionFromHeaders("/admin/demand-signals")'));
    expect(gate).toBeLessThan(src.indexOf("getServiceRoleClient()"));
    expect(src).toContain('shopParamFor("/admin/demand-signals", searchParamValues(sp))');
    expect(src).toContain("demandSignalShops(auth.role, auth.locations,");
  });
  it("the sources page: MoO / Owner / CGS only, and dark", () => {
    const src = read("app/admin/demand-signals/sources/page.tsx");
    const gate = src.indexOf("if (!canMarkSource(auth.role) || !demandSignalsEnabled(process.env.DEMAND_SIGNALS)) notFound();");
    expect(gate).toBeGreaterThan(src.indexOf('requireSessionFromHeaders("/admin/demand-signals/sources")'));
    expect(gate).toBeLessThan(src.indexOf("getServiceRoleClient()"));
  });
  it("the hub row is hidden unless the switch is on and the role may open the page", async () => {
    // Nav PR 4: the row comes from the destination list, which needs the switch and exactly canViewDemandSignals's roles
    // (PR 3's guard d proves the rule equal to the page's); the hub reads the switch and passes it.
    expect(read("app/admin/page.tsx")).toContain("demandSignals: demandSignalsEnabled(process.env.DEMAND_SIGNALS)");
    const { byId } = await import("@/lib/nav/destinations");
    const { backOfficeFor } = await import("@/lib/nav/back-office");
    expect(byId("demand-signals").access).toMatchObject({ requires: "demandSignals", onlyRoles: ["gm", "moo", "owner", "cgs"] });
    const has = (switches: { demandSignals?: boolean }) => backOfficeFor({ role: "moo", level: 8, switches }).groups.some((g) => g.rows.some((r) => r.id === "demand-signals"));
    expect(has({ demandSignals: true })).toBe(true);
    expect(has({})).toBe(false);
  });
  it("the clients import nothing that reaches the server: values only from the import-free input rules", () => {
    for (const p of ["components/admin/demand-signals/DemandSignalsClient.tsx", "components/admin/demand-signals/SourcesClient.tsx"]) {
      const src = read(p);
      const valueImports = [...src.matchAll(/^import (?!type )[^;]*from "@\/lib\/demand-signals\/([\w-]+)";/gm)].map((m) => m[1]);
      // The page's client also takes the one-line forecast's rules and (PR 7) the sentence-key helper of the contract file: both import-free.
      expect(valueImports, p).toEqual(p.endsWith("DemandSignalsClient.tsx") ? ["input-shared", "contracts-shared", "weather-line-shared"] : ["input-shared"]);
      expect(src, p).not.toMatch(/toLocale|\.slice\(0, 10\)/);
    }
    expect(read("lib/demand-signals/input-shared.ts")).not.toMatch(/^import /m);
    expect(read("lib/demand-signals/weather-line-shared.ts")).not.toMatch(/^import /m);
    expect(read("lib/demand-signals/contracts-shared.ts")).not.toMatch(/^import /m);
  });
  it("every key the clients build from a value exists in en AND es", () => {
    const en = JSON.parse(read("lib/i18n/en.json")) as Record<string, string>, es = JSON.parse(read("lib/i18n/es.json")) as Record<string, string>;
    const built = [
      ...["weather_alert", "government_closure", "federal_holiday", "school_closure", "transit_disruption", "street_closure", "sports_game", "concert_show", "convention", "race",
        "festival_parade", "demonstration", "other"].map((c) => `signals.category.${c}`),
      ...["up", "down", "unknown"].map((i) => `signals.impact.${i}`),
      ...["minor", "moderate", "severe", "extreme", "unknown"].map((s) => `signals.severity.${s}`),
      ...["verified", "unverified", "revoked"].map((s) => `signals.source.status.${s}`),
      ...["source_not_verified", "beyond_reach", "not_collected", "unreadable"].flatMap((g) => [`signals.weather.gap.${g}`, `signals.weather.gap_detail.${g}`]),
      ...["weather_hourly", "day_events"].map((f) => `signals.feeds.feed.${f}`),
      ...["allow", "allow_with_conditions", "pending_terms", "named_only", "refuse"].flatMap((g) => [`signals.sources.gate.${g}`, `signals.sources.gate_help.${g}`]),
      ...["all", "can_verify", "verified", "revoked", "by_hand", "not_allowed"].map((l) => `signals.sources.lens.${l}`),
      ...["demand_event_forbidden", "demand_event_shop_forbidden", "demand_event_invalid", "demand_event_moved", "demand_signals_off", "demand_signals_unavailable", "generic"].map((c) => `signals.event.error.${c}`),
      ...["forbidden", "invalid", "demand_source_forbidden", "demand_source_invalid", "source_unknown", "source_definition_moved", "source_not_ingestible", "source_status_unchanged",
        "source_terms_evidence_missing", "demand_signals_unavailable", "generic"].map((c) => `signals.sources.error.${c}`),
    ];
    for (const key of built) { expect(en[key], key).toBeTruthy(); expect(es[key], key).toBeTruthy(); }
    const mine = Object.keys(en).filter((k) => k.startsWith("signals."));
    expect(mine.length).toBeGreaterThan(150);
    for (const key of mine) {
      expect(es[key], key).toBeTruthy();
      expect([...es[key]!.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), key).toEqual([...en[key]!.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });
});
