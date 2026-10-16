/**
 * Scheduling Phase 2, Task 18 — POST /api/schedule and POST /api/schedule/settings.
 *  - session required (401), same-origin (403 bad_origin), the exact body shape (400 bad_request) — before the lib;
 *  - THE TIER IS THE ROUTE'S, asserted before the lib runs: approve → B; apply with ≥ 1 confirmed edited week → B;
 *    generate with confirmEdited → B; everything else none; structure / shop → E;
 *  - approve / apply post IDENTITIES (week + expected head + token), the actor is the SESSION's;
 *  - a ScheduleError answers its code with its status. (`/schedule` / `/admin/people-reconcile` join SHOP_PARAMS_BY_PATH WITH
 *    their pages, chunks F / G: the route audit refuses a declared route that no audited page backs.)
 */
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => ({ fake: true })) }));
vi.mock("@/lib/scheduling/schedules", () => ({
  generateWeek: vi.fn(async () => ({ ok: 1 })), previewHorizon: vi.fn(async () => ({ token: "t" })), applyHorizon: vi.fn(async () => ({ landed: [] })),
  saveEdit: vi.fn(async () => ({ ok: 1 })), approveWeek: vi.fn(async () => ({ ok: 1 })),
}));
vi.mock("@/lib/scheduling/settings", () => ({
  setBudget: vi.fn(async () => ({})), acceptBudgetSuggestion: vi.fn(async () => ({})), keepBudget: vi.fn(async () => ({})), setDayType: vi.fn(async () => ({})),
  setPin: vi.fn(async () => ({})), recordPersonSettings: vi.fn(async () => ({})), saveStructure: vi.fn(async () => ({})), saveShopSettings: vi.fn(async () => ({})),
}));

const { requireSession } = await import("@/lib/session");
const { assertStepUp } = await import("@/lib/admin/step-up");
const sched = await import("@/lib/scheduling/schedules");
const sett = await import("@/lib/scheduling/settings");
const { ScheduleError } = await import("@/lib/scheduling/errors-shared");
const route = await import("@/app/api/schedule/route");
const settingsRoute = await import("@/app/api/schedule/settings/route");

const SHOP = "11111111-1111-4111-8111-111111111111";
const WEEK = "2026-10-26";
const HEAD = "22222222-2222-4222-8222-222222222222";
const req = (path: string, body: unknown, origin: string | null = "http://localhost") => new NextRequest(`http://localhost${path}`, {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
});
const post = (body: unknown, origin?: string | null) => route.POST(req("/api/schedule", body, origin));
const postSettings = (body: unknown) => settingsRoute.POST(req("/api/schedule/settings", body));
const actor = { userId: "actor-1", role: "gm", level: 7, locations: [SHOP] };
const deps = { service: { fake: true } };
const tiers = () => vi.mocked(assertStepUp).mock.calls.map((c) => c[1]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "actor-1" }, role: "gm", level: 7, locations: [SHOP], session: {} } as never);
  vi.mocked(assertStepUp).mockReturnValue({ ok: true } as never);
});

describe("POST /api/schedule — the envelope", () => {
  it("no session → the session's own 401, nothing else runs", async () => {
    vi.mocked(requireSession).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never);
    expect((await post({ action: "preview", locationId: SHOP, request: { mode: "next_week" } })).status).toBe(401);
    expect(sched.previewHorizon).not.toHaveBeenCalled();
  });
  it("a cross-site or Origin-less request → 403 bad_origin before the lib", async () => {
    expect((await post({ action: "preview", locationId: SHOP, request: { mode: "next_week" } }, "https://evil.example")).status).toBe(403);
    expect((await post({ action: "preview", locationId: SHOP, request: { mode: "next_week" } }, null)).status).toBe(403);
    expect(sched.previewHorizon).not.toHaveBeenCalled();
  });
  it("exact shapes: an unknown action, an extra key, a missing key, a wrong type, an array → 400 bad_request", async () => {
    const approve = { action: "approve", locationId: SHOP, weekStart: WEEK, expectedHead: HEAD };
    for (const body of [{ ...approve, action: "publish" }, { ...approve, actorId: "x" }, { action: "approve", locationId: SHOP, weekStart: WEEK }, { ...approve, expectedHead: 5 }, [approve], { ...approve, action: "constructor" }]) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect((await r.json()).code).toBe("bad_request");
    }
    expect(sched.approveWeek).not.toHaveBeenCalled();
  });
});

describe("POST /api/schedule — the tier, asserted before the lib", () => {
  it("approve → Tier B; a stale or missing step-up is refused and the lib never runs", async () => {
    vi.mocked(assertStepUp).mockReturnValue({ ok: false, code: "step_up_stale" } as never);
    const r = await post({ action: "approve", locationId: SHOP, weekStart: WEEK, expectedHead: HEAD });
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("step_up_stale");
    expect(tiers()).toEqual(["B"]);
    expect(sched.approveWeek).not.toHaveBeenCalled();
  });
  it("approve posts IDENTITIES: the week and the expected head; the actor is the session's", async () => {
    expect((await post({ action: "approve", locationId: SHOP, weekStart: WEEK, expectedHead: HEAD })).status).toBe(200);
    expect(sched.approveWeek).toHaveBeenCalledWith(deps, { actor, locationId: SHOP, weekStart: WEEK, expectedHead: HEAD });
  });
  it("apply: Tier B only when a confirmed edited week is named; the token and the confirmed weeks pass through", async () => {
    const body = { action: "apply", locationId: SHOP, request: { mode: "next_weeks", n: 2 }, token: "tok", confirmedWeekStarts: [] as string[] };
    expect((await post(body)).status).toBe(200);
    expect(tiers()).toEqual([]);
    expect((await post({ ...body, confirmedWeekStarts: [WEEK] })).status).toBe(200);
    expect(tiers()).toEqual(["B"]);
    expect(sched.applyHorizon).toHaveBeenLastCalledWith(deps, { actor, locationId: SHOP, request: { mode: "next_weeks", n: 2 }, token: "tok", confirmedWeekStarts: [WEEK] });
  });
  it("generate: no tier for a new week or an unedited rebuild; Tier B with confirmEdited", async () => {
    expect((await post({ action: "generate", locationId: SHOP, weekStart: WEEK, expectedHead: null, confirmEdited: false })).status).toBe(200);
    expect(tiers()).toEqual([]);
    expect((await post({ action: "generate", locationId: SHOP, weekStart: WEEK, expectedHead: HEAD, confirmEdited: true })).status).toBe(200);
    expect(tiers()).toEqual(["B"]);
  });
  it("the operational acts take no step-up: preview, edit, budget, keep / accept, day type, pin, person", async () => {
    const bodies = [
      { action: "preview", locationId: SHOP, request: { mode: "next_week" } },
      { action: "edit", locationId: SHOP, weekStart: WEEK, expectedHead: HEAD, op: { kind: "removeShift", shift: { date: WEEK, userId: "u", startQ: 44 } } },
      { action: "budget", locationId: SHOP, scope: "week", weekStart: WEEK, month: null, hours: 70 },
      { action: "keep_budget", locationId: SHOP, weekStart: WEEK, digest: "d" },
      { action: "accept_budget", locationId: SHOP, weekStart: WEEK, digest: "d" },
      { action: "day_type", locationId: SHOP, date: WEEK, dayType: "busy" },
      { action: "pin", locationId: SHOP, pin: { retiresId: HEAD } },
      { action: "person", locationId: SHOP, settings: { userId: HEAD } },
    ];
    for (const b of bodies) expect((await post(b)).status, b.action).toBe(200);
    expect(tiers()).toEqual([]);
    expect(sett.setDayType).toHaveBeenCalledWith(deps, { actor, locationId: SHOP, date: WEEK, dayType: "busy" });
  });
  it("a ScheduleError answers its code with its status (and the structure key / params)", async () => {
    vi.mocked(sched.applyHorizon).mockRejectedValueOnce(new ScheduleError("preview_stale"));
    const r = await post({ action: "apply", locationId: SHOP, request: { mode: "next_week" }, token: "t", confirmedWeekStarts: [] });
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("preview_stale");
    vi.mocked(sched.generateWeek).mockRejectedValueOnce(new ScheduleError("demand_unavailable", { params: { cause: "timeout" } }));
    const g = await post({ action: "generate", locationId: SHOP, weekStart: WEEK, expectedHead: null, confirmEdited: false });
    expect(g.status).toBe(503);
    expect(await g.json()).toMatchObject({ code: "demand_unavailable", params: { cause: "timeout" } });
    vi.mocked(sched.generateWeek).mockRejectedValueOnce(new Error("boom"));
    expect((await post({ action: "generate", locationId: SHOP, weekStart: WEEK, expectedHead: null, confirmEdited: false })).status).toBe(500);
  });
});

describe("POST /api/schedule/settings — Tier E", () => {
  it("structure and shop take the edit window; refused without it, before the lib", async () => {
    vi.mocked(assertStepUp).mockReturnValue({ ok: false, code: "step_up_required" } as never);
    expect((await postSettings({ action: "structure", locationId: SHOP, expectedId: null, structure: {} })).status).toBe(403);
    expect(sett.saveStructure).not.toHaveBeenCalled();
    vi.mocked(assertStepUp).mockReturnValue({ ok: true } as never);
    expect((await postSettings({ action: "structure", locationId: SHOP, expectedId: null, structure: {} })).status).toBe(200);
    expect((await postSettings({ action: "shop", locationId: SHOP, enabled: true, estimatedHourlyCents: 1800, estimatedSalariedWeeklyCents: null, agmAccess: "read" })).status).toBe(200);
    expect(tiers().every((t) => t === "E")).toBe(true);
    vi.mocked(sett.saveStructure).mockRejectedValueOnce(new ScheduleError("structure_invalid", { key: "limits.maxShiftH" }));
    const r = await postSettings({ action: "structure", locationId: SHOP, expectedId: null, structure: {} });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ code: "structure_invalid", key: "limits.maxShiftH" });
    expect((await postSettings({ action: "shop", locationId: SHOP })).status).toBe(400);
  });
});
