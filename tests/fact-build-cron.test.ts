// Item 2 PR 2b: the hourly fact build ships OFF behind FACT_LAYER=1 (no lease claim, no read, no write).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, maxDuration } from "@/app/api/cron/fact-build/route";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { runFactBuildPass } from "@/lib/facts/order-facts";
import { audit } from "@/lib/audit";
import { JOBS_REGISTRY } from "@/lib/jobs-registry";
import { FACT_PASS_BUDGET_MS } from "@/lib/facts/config-shared";

vi.mock("@/lib/cron-route-lease", () => ({ claimCronRoute: vi.fn(async () => true) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/facts/order-facts", () => ({ runFactBuildPass: vi.fn(async () => ({ stale: 2, built: 2, raced: 0, failed: 0, leftForNextPass: 0 })) }));

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
