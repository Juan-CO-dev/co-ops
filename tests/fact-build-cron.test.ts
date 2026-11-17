// Item 2 PR 2b: the hourly fact build ships OFF behind FACT_LAYER=1 (no lease claim, no read, no write).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, maxDuration } from "@/app/api/cron/fact-build/route";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { runFactBuildPass } from "@/lib/facts/order-facts";
import { runLaborBuildPass } from "@/lib/facts/labor-facts";
import { audit } from "@/lib/audit";
import { JOBS_REGISTRY } from "@/lib/jobs-registry";
import { FACT_PASS_BUDGET_MS } from "@/lib/facts/config-shared";

vi.mock("@/lib/cron-route-lease", () => ({ claimCronRoute: vi.fn(async () => true) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/facts/order-facts", () => ({ runFactBuildPass: vi.fn(async () => ({ stale: 2, built: 2, raced: 0, failed: 0, timedOut: 0, leftForNextPass: 0, failures: [] })) }));
vi.mock("@/lib/facts/labor-facts", () => ({ runLaborBuildPass: vi.fn(async () => ({ stale: 1, built: 1, raced: 0, failed: 0, timedOut: 0, leftForNextPass: 0, failures: [] })) }));

const req = (auth = "Bearer vercel-test") => new NextRequest("https://example.test/api/cron/fact-build", { headers: { authorization: auth } });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "vercel-test"); });
afterEach(() => vi.unstubAllEnvs());

describe("fact-build cron", () => {
  it("refuses an unauthenticated call before anything else", async () => {
    vi.stubEnv("FACT_LAYER", "1");
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(claimCronRoute).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "0", "true"])("is OFF unless FACT_LAYER=1 (%s): no lease, no pass", async (value) => {
    if (value !== undefined) vi.stubEnv("FACT_LAYER", value);
    const res = await GET(req());
    expect(await res.json()).toMatchObject({ skipped: true, reason: "fact_layer_off" });
    expect(claimCronRoute).not.toHaveBeenCalled();
    expect(runFactBuildPass).not.toHaveBeenCalled();
  });
  it("ON: claims the fact-build lease, then runs one bounded pass from the floor", async () => {
    vi.stubEnv("FACT_LAYER", "1");
    vi.stubEnv("FACT_CAPTURE_FLOOR", "2025-10-01");
    const before = Date.now();
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(claimCronRoute).toHaveBeenCalledWith("fact-build");
    const arg = vi.mocked(runFactBuildPass).mock.calls[0]![0];
    expect(arg.floor).toBe("2025-10-01");
    expect(arg.deadlineAt).toBeGreaterThanOrEqual(before + FACT_PASS_BUDGET_MS - 1);
    expect(arg.deadlineAt).toBeLessThanOrEqual(Date.now() + FACT_PASS_BUDGET_MS);
    expect(await res.json()).toMatchObject({ built: 2 });
  });
  it("a clean pass writes the cron.success heartbeat (job fact-build) with its counts", async () => {
    vi.stubEnv("FACT_LAYER", "1");
    const res = await GET(req());
    expect(await res.json()).toMatchObject({ healthy: true, built: 2 });
    expect(vi.mocked(audit).mock.calls).toHaveLength(1);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.success", resourceTable: "cron",
      metadata: { job: "fact-build", stale: 2, built: 2, failed: 0, timed_out: 0, left_for_next_pass: 0, failures: [] } });
  });
  it("a pass with failed days writes cron.failure naming them by fixed code (review r1 #2)", async () => {
    vi.stubEnv("FACT_LAYER", "1");
    vi.mocked(runFactBuildPass).mockResolvedValueOnce({ stale: 3, built: 1, raced: 0, failed: 2, timedOut: 1, leftForNextPass: 0,
      failures: [{ locationId: "loc", businessDate: "2026-10-01", error: "fact_replace_failed" }, { locationId: "loc", businessDate: "2026-10-02", error: "fact_day_timeout" }] });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ healthy: false, failed: 2 });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.failure", resourceTable: "cron",
      metadata: { job: "fact-build", error: "fact_days_failed", failed: 2, timed_out: 1,
        failures: [{ location_id: "loc", business_date: "2026-10-01", error: "fact_replace_failed" }, { location_id: "loc", business_date: "2026-10-02", error: "fact_day_timeout" }] } });
  });
  it("the LABOR pass is OFF unless FACT_LAYER_LABOR=1 as well (0338 must be applied first)", async () => {
    vi.stubEnv("FACT_LAYER", "1");
    for (const v of [undefined, "0", "true"]) {
      vi.unstubAllEnvs(); vi.stubEnv("CRON_SECRET", "vercel-test"); vi.stubEnv("FACT_LAYER", "1");
      if (v !== undefined) vi.stubEnv("FACT_LAYER_LABOR", v);
      const body = await (await GET(req())).json();
      expect(body.labor).toEqual({ skipped: true, reason: "fact_layer_labor_off" });
    }
    expect(runLaborBuildPass).not.toHaveBeenCalled();
    vi.stubEnv("FACT_LAYER", "0"); vi.stubEnv("FACT_LAYER_LABOR", "1");
    await GET(req());
    expect(runLaborBuildPass).not.toHaveBeenCalled();
  });
  it("ON: the labor pass runs after the order pass inside the SAME deadline; one heartbeat names both", async () => {
    vi.stubEnv("FACT_LAYER", "1"); vi.stubEnv("FACT_LAYER_LABOR", "1");
    const res = await GET(req());
    expect(await res.json()).toMatchObject({ healthy: true, built: 2, labor: { built: 1 } });
    const order = vi.mocked(runFactBuildPass).mock.calls[0]![0], labor = vi.mocked(runLaborBuildPass).mock.calls[0]![0];
    expect(labor.deadlineAt).toBe(order.deadlineAt);
    expect(vi.mocked(runFactBuildPass).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(runLaborBuildPass).mock.invocationCallOrder[0]!);
    expect(vi.mocked(audit).mock.calls).toHaveLength(1);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.success", metadata: { job: "fact-build", built: 2, labor: { stale: 1, built: 1, failed: 0 } } });
  });
  it("a failed labor week makes the heartbeat cron.failure, named by fixed code", async () => {
    vi.stubEnv("FACT_LAYER", "1"); vi.stubEnv("FACT_LAYER_LABOR", "1");
    vi.mocked(runLaborBuildPass).mockResolvedValueOnce({ stale: 1, built: 0, raced: 0, failed: 1, timedOut: 0, leftForNextPass: 0,
      failures: [{ weekStart: "2026-10-04", error: "fact_replace_failed" }] });
    expect(await (await GET(req())).json()).toMatchObject({ healthy: false });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.failure",
      metadata: { error: "fact_days_failed", labor: { failed: 1, failures: [{ week_start: "2026-10-04", error: "fact_replace_failed" }] } } });
  });
  it("a labor pass that throws is a fixed-code failure; the order pass result is still reported", async () => {
    vi.stubEnv("FACT_LAYER", "1"); vi.stubEnv("FACT_LAYER_LABOR", "1");
    vi.mocked(runLaborBuildPass).mockRejectedValueOnce(new Error("secret"));
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ healthy: false, built: 2, labor: { error: "fact_labor_failed" } });
    expect(JSON.stringify(body)).not.toContain("secret");
  });
  it("a held lease is a quiet skip", async () => {
    vi.stubEnv("FACT_LAYER", "1");
    vi.mocked(claimCronRoute).mockResolvedValueOnce(false);
    expect(await (await GET(req())).json()).toMatchObject({ skipped: true, reason: "cron_route_busy" });
    expect(runFactBuildPass).not.toHaveBeenCalled();
  });
  it("a failure is a fixed code and a cron.failure row, never a message", async () => {
    vi.stubEnv("FACT_LAYER", "1");
    vi.mocked(runFactBuildPass).mockRejectedValueOnce(new Error("secret detail"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "cron.failure", metadata: { job: "fact-build", error: "fact_build_failed" } });
  });
  it("the lease outlives the pass budget, and the job never emails (not in JOBS_REGISTRY)", () => {
    expect(FACT_PASS_BUDGET_MS + 30_000).toBeLessThanOrEqual(maxDuration * 1000);
    expect(maxDuration * 1000).toBeLessThan(330_000);
    expect(JSON.stringify(JOBS_REGISTRY)).not.toContain("fact-build");
  });
  it("is scheduled hourly at :40 in vercel.json", () => {
    const crons = (JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons.filter((c) => c.path === "/api/cron/fact-build")).toEqual([{ path: "/api/cron/fact-build", schedule: "40 * * * *" }]);
  });
});
