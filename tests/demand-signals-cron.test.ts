// Item 4 PR 2: the demand-signals cron ships OFF and is INERT BEFORE ITS LEASE.
//   secret -> DEMAND_SIGNALS=1 (else nothing) -> the register says this adapter's source is verified NOW
//   (else nothing: no lease, no heartbeat, no request) -> the lease -> one bounded pass -> the heartbeat.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, maxDuration } from "@/app/api/cron/demand-signals/route";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { audit } from "@/lib/audit";
import { JOBS_REGISTRY } from "@/lib/jobs-registry";
import { collectionPrecheck, runDemandSignalsCollection } from "@/lib/demand-signals/signal-store";
import { DEMAND_SIGNALS_PASS_BUDGET_MS, demandSignalsEnabled } from "@/lib/demand-signals/config-shared";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cron-route-lease", () => ({ claimCronRoute: vi.fn(async () => true) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({}) }));
vi.mock("@/lib/demand-signals/signal-store", () => ({
  collectionPrecheck: vi.fn(async () => "ready"),
  runDemandSignalsCollection: vi.fn(async () => ({ status: "ran", shops: [{ locationId: "loc", weather: { seen: 112, written: 112 }, alerts: { seen: 0, written: 0 } }], weatherRows: 112, failed: 0, requests: 3 })),
}));

const req = (auth = "Bearer vercel-test") => new NextRequest("https://example.test/api/cron/demand-signals", { headers: { authorization: auth } });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "vercel-test"); });
afterEach(() => vi.unstubAllEnvs());

describe("demand-signals cron", () => {
  it("the switch is on only for the literal 1", () => {
    for (const v of [undefined, "", "0", "true", "on", " 1"]) expect(demandSignalsEnabled(v)).toBe(false);
    expect(demandSignalsEnabled("1")).toBe(true);
  });
  it("refuses an unauthenticated call before anything else", async () => {
    vi.stubEnv("DEMAND_SIGNALS", "1");
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(collectionPrecheck).not.toHaveBeenCalled();
    expect(claimCronRoute).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "0", "true"])("is OFF unless DEMAND_SIGNALS=1 (%s): no register read, no lease, no pass, no heartbeat", async (value) => {
    if (value !== undefined) vi.stubEnv("DEMAND_SIGNALS", value);
    expect(await (await GET(req())).json()).toMatchObject({ skipped: true, reason: "demand_signals_off" });
    expect(collectionPrecheck).not.toHaveBeenCalled();
    expect(claimCronRoute).not.toHaveBeenCalled();
    expect(runDemandSignalsCollection).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
  it.each(["source_unverified", "source_revoked", "not_installed"] as const)(
    "ON but the source is %s: skipped by that name with no lease, no pass and no heartbeat (DEMAND_SIGNALS=1 is necessary, not sufficient)", async (state) => {
      vi.stubEnv("DEMAND_SIGNALS", "1");
      vi.mocked(collectionPrecheck).mockResolvedValueOnce(state);
      expect(await (await GET(req())).json()).toMatchObject({ skipped: true, reason: state });
      expect(claimCronRoute).not.toHaveBeenCalled();
      expect(runDemandSignalsCollection).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    });
  it("ON and verified: claims the demand-signals lease, then one bounded pass, then cron.success", async () => {
    vi.stubEnv("DEMAND_SIGNALS", "1");
    const before = Date.now();
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(claimCronRoute).toHaveBeenCalledWith("demand-signals");
    const arg = vi.mocked(runDemandSignalsCollection).mock.calls[0]![0];
    expect(arg.deadlineAt).toBeGreaterThanOrEqual(before + DEMAND_SIGNALS_PASS_BUDGET_MS - 1);
    expect(arg.deadlineAt).toBeLessThanOrEqual(Date.now() + DEMAND_SIGNALS_PASS_BUDGET_MS);
    expect(vi.mocked(audit).mock.calls).toHaveLength(1);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.success", resourceTable: "cron",
      metadata: { job: "demand-signals", status: "ran", weather_rows: 112, failed: 0, requests: 3,
        shops: [{ location_id: "loc", weather: { seen: 112, written: 112 }, alerts: { seen: 0, written: 0 } }] } });
  });
  it("a held lease skips without a pass", async () => {
    vi.stubEnv("DEMAND_SIGNALS", "1");
    vi.mocked(claimCronRoute).mockResolvedValueOnce(false);
    expect(await (await GET(req())).json()).toMatchObject({ skipped: true, reason: "cron_route_busy" });
    expect(runDemandSignalsCollection).not.toHaveBeenCalled();
  });
  it("a pass with a failed feed writes cron.failure naming it by fixed code", async () => {
    vi.stubEnv("DEMAND_SIGNALS", "1");
    vi.mocked(runDemandSignalsCollection).mockResolvedValueOnce({ status: "ran", shops: [{ locationId: "loc", weather: { error: "server_error" }, alerts: { seen: 0, written: 0 } }], weatherRows: 0, failed: 1, requests: 4 });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.failure",
      metadata: { job: "demand-signals", error: "signal_feeds_failed", failed: 1, shops: [{ location_id: "loc", weather: { error: "server_error" } }] } });
  });
  it("revoked DURING the pass: it stopped, and the heartbeat says so (not a failure)", async () => {
    vi.stubEnv("DEMAND_SIGNALS", "1");
    vi.mocked(runDemandSignalsCollection).mockResolvedValueOnce({ status: "source_revoked", shops: [], weatherRows: 0, requests: 2 });
    await GET(req());
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.success", metadata: { job: "demand-signals", status: "source_revoked" } });
  });
  it("a thrown pass is a cron.failure with a fixed code and a 500 that carries no detail", async () => {
    vi.stubEnv("DEMAND_SIGNALS", "1");
    vi.mocked(runDemandSignalsCollection).mockRejectedValueOnce(new Error("relation secret_table does not exist"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret_table");
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.failure", metadata: { job: "demand-signals", error: "demand_signals_failed" } });
  });
  it("is scheduled four times a day, inside the function limit, and is not a job-watch job (nothing emails)", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    expect(config.crons.filter((c) => c.path === "/api/cron/demand-signals")).toEqual([{ path: "/api/cron/demand-signals", schedule: "50 3,9,15,21 * * *" }]);
    expect(DEMAND_SIGNALS_PASS_BUDGET_MS).toBeLessThan(maxDuration * 1000);
    expect(JOBS_REGISTRY.some((j) => JSON.stringify(j).includes("demand-signals"))).toBe(false);
    const route = readFileSync("app/api/cron/demand-signals/route.ts", "utf8");
    expect(route.indexOf("collectionPrecheck(")).toBeLessThan(route.indexOf('claimCronRoute("demand-signals")'));
    expect(route.indexOf("demandSignalsEnabled(")).toBeLessThan(route.indexOf("collectionPrecheck("));
  });
});
