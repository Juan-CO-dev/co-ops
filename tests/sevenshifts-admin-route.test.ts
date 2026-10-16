/**
 * Scheduling Phase 1, Task 10 — POST /api/admin/sevenshifts: link / unlink a shop or a person (Tier B,
 * the /admin/toast-employees precedent) and Sync now (MoO+, no step-up: it changes no config). The actor
 * comes from the session, never the body; payloads are exact; refusals carry their fixed code.
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => ({ fake: true })) }));
vi.mock("@/lib/sevenshifts/links", async (original) => ({
  ...await original<typeof import("@/lib/sevenshifts/links")>(),
  linkShop: vi.fn(async () => ({ id: "SL1", changed: true })), unlinkShop: vi.fn(async () => ({ id: "SL1", changed: true })),
  linkUser: vi.fn(async () => ({ id: "UL1", changed: true })), unlinkUser: vi.fn(async () => ({ id: "UL1", changed: true })),
}));
vi.mock("@/lib/sevenshifts/sync-now", async (original) => ({
  ...await original<typeof import("@/lib/sevenshifts/sync-now")>(),
  requestSyncNow: vi.fn(async () => ({ runId: "r1", status: "ok", requests: 15, persistenceErrors: [] })),
}));

const { requireSession } = await import("@/lib/session");
const { assertStepUp } = await import("@/lib/admin/step-up");
const { linkShop, linkUser, SevenShiftsLinkError, unlinkShop, unlinkUser } = await import("@/lib/sevenshifts/links");
const { requestSyncNow, SyncNowError } = await import("@/lib/sevenshifts/sync-now");
const { POST, maxDuration } = await import("@/app/api/admin/sevenshifts/route");

const SHOP = "11111111-1111-4111-8111-111111111111";
const LINK = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/sevenshifts", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "moo-1" }, role: "moo", level: 8, locations: [SHOP], session: {} } as never);
  vi.mocked(assertStepUp).mockReturnValue({ ok: true } as never);
});

describe("POST /api/admin/sevenshifts", () => {
  it("allows the Sync now run its budget", () => {
    expect(maxDuration).toBe(120);
  });

  it("link_user / unlink_user / link_shop / unlink_shop call the lib with the SESSION actor", async () => {
    const actor = { userId: "moo-1", role: "moo", level: 8, locations: [SHOP] };
    expect((await post({ action: "link_user", locationId: SHOP, remoteUserId: "501", userId: USER })).status).toBe(200);
    expect(linkUser).toHaveBeenCalledWith({ fake: true }, { actor, locationId: SHOP, remoteUserId: "501", userId: USER });
    expect((await post({ action: "unlink_user", locationId: SHOP, linkId: LINK })).status).toBe(200);
    expect(unlinkUser).toHaveBeenCalledWith({ fake: true }, { actor, locationId: SHOP, linkId: LINK });
    expect((await post({ action: "link_shop", locationId: SHOP, remoteLocationId: "4569" })).status).toBe(200);
    expect(linkShop).toHaveBeenCalledWith({ fake: true }, { actor, locationId: SHOP, remoteLocationId: "4569" });
    expect((await post({ action: "unlink_shop", linkId: LINK })).status).toBe(200);
    expect(unlinkShop).toHaveBeenCalledWith({ fake: true }, { actor, linkId: LINK });
  });

  it("every link act needs Tier B; a refusal stops before the lib", async () => {
    vi.mocked(assertStepUp).mockReturnValue({ ok: false, code: "step_up_stale" } as never);
    const res = await post({ action: "link_user", locationId: SHOP, remoteUserId: "501", userId: USER });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "step_up_stale" });
    expect(vi.mocked(assertStepUp).mock.calls[0]![1]).toBe("B");
    expect(linkUser).not.toHaveBeenCalled();
  });

  it.each([
    ["link_shop", { action: "link_shop", locationId: SHOP, remoteLocationId: "4569" }],
    ["unlink_shop", { action: "unlink_shop", linkId: LINK }],
    ["link_user", { action: "link_user", locationId: SHOP, remoteUserId: "501", userId: USER }],
    ["unlink_user", { action: "unlink_user", locationId: SHOP, linkId: LINK }],
  ] as const)("ruling (b): %s asks Tier B every time (it binds identities); a stale window stops it before the lib", async (_name, body) => {
    vi.mocked(assertStepUp).mockReturnValue({ ok: false, code: "step_up_required" } as never);
    const res = await post(body);
    expect(res.status).toBe(403);
    expect(vi.mocked(assertStepUp).mock.calls.map((c) => c[1])).toEqual(["B"]);
    for (const fn of [linkShop, unlinkShop, linkUser, unlinkUser, requestSyncNow]) expect(fn).not.toHaveBeenCalled();
  });

  it("ruling (b): the step-up tier map lists this route and its screen at exactly Tier B (none for Sync now is the route's own branch)", () => {
    const pin = readFileSync("tests/step-up-tier-map.test.ts", "utf8");
    expect(pin).toContain('"app/api/admin/sevenshifts/route.ts": ["B"],');
    expect(pin).toContain('"components/admin/sevenshifts/SevenShiftsScreen.tsx": ["B"],');
    const route = readFileSync("app/api/admin/sevenshifts/route.ts", "utf8");
    expect(route.indexOf('if (b.action === "sync_now")')).toBeLessThan(route.indexOf('assertStepUp(ctx, "B")'));
    expect(route.match(/assertStepUp\(/g)).toHaveLength(1);
  });

  it("Sync now needs no step-up (it changes no config); the lib decides MoO+", async () => {
    vi.mocked(assertStepUp).mockReturnValue({ ok: false, code: "step_up_required" } as never);
    const res = await post({ action: "sync_now" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", persistenceErrors: [] });
    expect(assertStepUp).not.toHaveBeenCalled();
    expect(requestSyncNow).toHaveBeenCalledWith({ userId: "moo-1", role: "moo", level: 8, locations: [SHOP] },
      { routeStartedAt: expect.any(Number) });
  });

  it.each([
    {}, { action: "nope" }, { action: "sync_now", extra: 1 },
    { action: "link_user", locationId: SHOP, remoteUserId: 501, userId: USER },
    { action: "link_user", locationId: SHOP, remoteUserId: "501", userId: USER, actorId: "someone-else" },
    { action: "unlink_shop", linkId: LINK, locationId: SHOP },
    { action: "link_shop", locationId: SHOP },
  ])("refuses an inexact payload %j with 400 and calls nothing", async (body) => {
    expect((await post(body)).status).toBe(400);
    for (const fn of [linkShop, unlinkShop, linkUser, unlinkUser, requestSyncNow]) expect(fn).not.toHaveBeenCalled();
  });

  it("maps the lib's errors to their status and fixed code", async () => {
    vi.mocked(linkUser).mockRejectedValueOnce(new SevenShiftsLinkError(409, "remote_already_linked"));
    let res = await post({ action: "link_user", locationId: SHOP, remoteUserId: "501", userId: USER });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "remote_already_linked" });
    vi.mocked(requestSyncNow).mockRejectedValueOnce(new SyncNowError(409, "sync_busy"));
    res = await post({ action: "sync_now" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "sync_busy" });
    vi.mocked(unlinkShop).mockRejectedValueOnce(new Error("boom with secrets"));
    res = await post({ action: "unlink_shop", linkId: LINK });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secrets");
  });

  it("no session → the session's own 401", async () => {
    vi.mocked(requireSession).mockResolvedValueOnce(new Response(null, { status: 401 }) as never);
    expect((await post({ action: "sync_now" })).status).toBe(401);
  });
});
