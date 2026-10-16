/**
 * Scheduling Phase 1, Task 8 — the hourly cron route and Sync now.
 *
 * The cron route: the house cron secret (cronAuthStatus: timingSafeEqual, fail closed), dormant
 * without the token or the switch (no lease claim, no run), the shared lease, ONE run inside the
 * route's budget. Sync now (lib/sevenshifts/sync-now.ts): MoO+ before any I/O, the same dormancy,
 * the same lease (busy → 409 sync_busy), audited `sevenshifts.sync_requested`, a manual run that
 * names its requester. Nothing here emails or notifies.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PeopleActor } from "@/lib/people/access-shared";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/cron-route-lease", () => ({ claimCronRoute: vi.fn(async () => true) }));
vi.mock("@/lib/sevenshifts/sync", () => ({
  runSevenShiftsSync: vi.fn(async () => ({ ran: true, runId: "run-1", status: "ok", requests: 12, results: {}, persistenceErrors: [] })),
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("no database in this test"); } }));

const { GET, maxDuration, runtime } = await import("@/app/api/cron/sevenshifts-sync/route");
const { requestSyncNow, SyncNowError } = await import("@/lib/sevenshifts/sync-now");
const { audit } = await import("@/lib/audit");
const { claimCronRoute } = await import("@/lib/cron-route-lease");
const { runSevenShiftsSync } = await import("@/lib/sevenshifts/sync");

const TOKEN = "PLANTED-TOKEN-route";
const request = (headers: Record<string, string> = { authorization: "Bearer test-cron" }) =>
  new NextRequest("https://example.com/api/cron/sevenshifts-sync", { headers });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "test-cron");
  vi.stubEnv("CATERING_SCAN_SECRET", "");
  vi.stubEnv("SEVENSHIFTS_ACCESS_TOKEN", TOKEN);
  vi.stubEnv("SEVENSHIFTS_SYNC", "1");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("GET /api/cron/sevenshifts-sync", () => {
  it("is a node route with a 120 s budget", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(120);
  });

  it("the cron secret is enforced and fails closed: no secret configured → 503, a wrong one → 401, nothing claimed or run", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request())).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "test-cron");
    expect((await GET(request({}))).status).toBe(401);
    expect((await GET(request({ authorization: "Bearer test-cro" }))).status).toBe(401);
    expect((await GET(request({ "x-cron-secret": "bad" }))).status).toBe(401);
    expect(claimCronRoute).not.toHaveBeenCalled();
    expect(runSevenShiftsSync).not.toHaveBeenCalled();
  });

  it("dormant without the token: skipped token_missing, no lease claim, no run (even with SEVENSHIFTS_SYNC=1)", async () => {
    vi.stubEnv("SEVENSHIFTS_ACCESS_TOKEN", "");
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: true, reason: "token_missing" });
    expect(claimCronRoute).not.toHaveBeenCalled();
    expect(runSevenShiftsSync).not.toHaveBeenCalled();
  });

  it("dormant with the switch off: skipped sync_off, no lease claim, no run", async () => {
    vi.stubEnv("SEVENSHIFTS_SYNC", "");
    const body = await (await GET(request())).json();
    expect(body).toEqual({ skipped: true, reason: "sync_off" });
    expect(claimCronRoute).not.toHaveBeenCalled();
    expect(runSevenShiftsSync).not.toHaveBeenCalled();
  });

  it("a busy lease → skipped cron_route_busy and no run", async () => {
    vi.mocked(claimCronRoute).mockResolvedValueOnce(false);
    const body = await (await GET(request())).json();
    expect(body).toEqual({ skipped: true, reason: "cron_route_busy" });
    expect(claimCronRoute).toHaveBeenCalledWith("sevenshifts-sync");
    expect(runSevenShiftsSync).not.toHaveBeenCalled();
  });

  it("otherwise ONE cron run inside maxDuration·1000 − 10 s; the response carries counts and codes, never the token", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(runSevenShiftsSync).toHaveBeenCalledTimes(1);
    const [opts] = vi.mocked(runSevenShiftsSync).mock.calls[0]!;
    expect(opts.trigger).toBe("cron");
    expect(opts.requestedBy ?? null).toBeNull();
    expect(opts.deadlineMs).toBeLessThanOrEqual(110_000);
    expect(opts.deadlineMs).toBeGreaterThan(100_000);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("\"status\":\"ok\"");
    expect(text).toContain("\"persistenceErrors\":[]");
    expect(text).not.toContain(TOKEN);
  });

  it("a lease claim error fails closed: 500, one cron.failure heartbeat with a fixed code, no run", async () => {
    vi.mocked(claimCronRoute).mockRejectedValueOnce(new Error("cron_route_claim_failed"));
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(runSevenShiftsSync).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({
      action: "cron.failure", actorId: null, metadata: { job: "sevenshifts-sync", error: "sync_route_failed" },
    });
  });

  it("vercel.json schedules it hourly at :20, and the job is NOT in JOBS_REGISTRY (no email on a missed heartbeat, R6)", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    expect(vercel.crons.filter((c) => c.path === "/api/cron/sevenshifts-sync")).toEqual([
      { path: "/api/cron/sevenshifts-sync", schedule: "20 * * * *" },
    ]);
    expect(readFileSync("lib/jobs-registry.ts", "utf8")).not.toMatch(/sevenshifts/);
  });

  it("the route source never sends email or a notification", () => {
    const src = readFileSync("app/api/cron/sevenshifts-sync/route.ts", "utf8") + readFileSync("lib/sevenshifts/sync-now.ts", "utf8");
    expect(src).not.toMatch(/sendEmail|enqueueNotification|@\/lib\/email|watchSiblings/);
  });
});

const moo: PeopleActor = { userId: "11111111-1111-4111-8111-111111111111", role: "moo", level: 8, locations: [] };
const gm: PeopleActor = { userId: "22222222-2222-4222-8222-222222222222", role: "gm", level: 7, locations: ["33333333-3333-4333-8333-333333333333"] };
const smm: PeopleActor = { userId: "44444444-4444-4444-8444-444444444444", role: "social_media_mgr", level: 9, locations: [] };

describe("requestSyncNow (Sync now)", () => {
  it("MoO+ only, decided BEFORE any I/O: a GM and a level-forged SMM are refused 403 forbidden", async () => {
    for (const actor of [gm, smm]) {
      const err = await requestSyncNow(actor).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SyncNowError);
      expect(err).toMatchObject({ status: 403, code: "forbidden" });
    }
    expect(claimCronRoute).not.toHaveBeenCalled();
    expect(runSevenShiftsSync).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("respects dormancy: no token → 409 not_connected; switch off → 409 sync_off; nothing claimed, run or audited", async () => {
    vi.stubEnv("SEVENSHIFTS_ACCESS_TOKEN", "");
    await expect(requestSyncNow(moo)).rejects.toMatchObject({ status: 409, code: "not_connected" });
    vi.stubEnv("SEVENSHIFTS_ACCESS_TOKEN", TOKEN);
    vi.stubEnv("SEVENSHIFTS_SYNC", "0");
    await expect(requestSyncNow(moo)).rejects.toMatchObject({ status: 409, code: "sync_off" });
    expect(claimCronRoute).not.toHaveBeenCalled();
    expect(runSevenShiftsSync).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("uses the cron's lease: busy → 409 sync_busy, no run, no audit row", async () => {
    vi.mocked(claimCronRoute).mockResolvedValueOnce(false);
    await expect(requestSyncNow(moo)).rejects.toMatchObject({ status: 409, code: "sync_busy" });
    expect(claimCronRoute).toHaveBeenCalledWith("sevenshifts-sync");
    expect(runSevenShiftsSync).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("claims, audits sevenshifts.sync_requested (ids only), then runs ONE manual sync naming the requester", async () => {
    const out = await requestSyncNow(moo, { deadlineMs: 90_000 });
    expect(out).toEqual({ runId: "run-1", status: "ok", requests: 12, persistenceErrors: [] });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({
      actorId: moo.userId, actorRole: "moo", action: "sevenshifts.sync_requested", resourceTable: "sevenshifts_sync_runs",
    });
    expect(JSON.stringify(vi.mocked(audit).mock.calls[0]![0])).not.toContain(TOKEN);
    const order = [vi.mocked(claimCronRoute).mock.invocationCallOrder[0]!, vi.mocked(audit).mock.invocationCallOrder[0]!,
      vi.mocked(runSevenShiftsSync).mock.invocationCallOrder[0]!];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(vi.mocked(runSevenShiftsSync).mock.calls[0]![0]).toMatchObject({ trigger: "manual", requestedBy: moo.userId, deadlineMs: 90_000 });
  });

  it("a run that turned dormant between the check and the run is reported as such, not as a success", async () => {
    vi.mocked(runSevenShiftsSync).mockResolvedValueOnce({ ran: false, reason: "sync_off" });
    await expect(requestSyncNow(moo)).rejects.toMatchObject({ status: 409, code: "sync_off" });
  });
});
