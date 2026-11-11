import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/meta-leads/route";
import { JOBS_REGISTRY } from "@/lib/jobs-registry";
const mocks = vi.hoisted(() => ({ claim: vi.fn(), sweep: vi.fn() }));
vi.mock("@/lib/cron-route-lease", () => ({ claimCronRoute: mocks.claim }));
vi.mock("@/lib/meta-leads/worker", () => ({ sweepMetaLeads: mocks.sweep }));
function request(token = "test-cron") {
  return new NextRequest("https://example.test/api/cron/meta-leads", { headers: { authorization: `Bearer ${token}` } });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", "test-cron");
  vi.stubEnv("CATERING_SCAN_SECRET", "");
  vi.stubEnv("META_LEADS_ENABLED", "1");
  mocks.claim.mockResolvedValue(true);
  mocks.sweep.mockResolvedValue({ processed: 2 });
});
afterEach(() => { vi.unstubAllEnvs(); });
it("authenticates before lease or ledger work", async () => {
  expect((await GET(request("forged"))).status).toBe(401);
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.sweep).not.toHaveBeenCalled();
});
it("refuses unconfigured cron before database work", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(request())).status).toBe(503);
  expect(mocks.claim).not.toHaveBeenCalled();
});
it.each(["", "0", "true"])("stays off with switch %s before database work", async value => {
  vi.stubEnv("META_LEADS_ENABLED", value);
  expect(await (await GET(request())).json()).toEqual({ disabled: true });
  expect(mocks.claim).not.toHaveBeenCalled();
  expect(mocks.sweep).not.toHaveBeenCalled();
});
it("skips a concurrently leased sweep", async () => {
  mocks.claim.mockResolvedValue(false);
  expect(await (await GET(request())).json()).toEqual({ skipped: true });
  expect(mocks.claim).toHaveBeenCalledExactlyOnceWith("meta-leads");
  expect(mocks.sweep).not.toHaveBeenCalled();
});
it("sweeps after acquiring the house lease", async () => {
  expect(await (await GET(request())).json()).toEqual({ processed: 2 });
  expect(mocks.claim).toHaveBeenCalledExactlyOnceWith("meta-leads");
  expect(mocks.sweep).toHaveBeenCalledOnce();
  expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(mocks.sweep.mock.invocationCallOrder[0]!);
});
it("returns only a closed failure code", async () => {
  mocks.sweep.mockRejectedValue(new Error("Bearer test-page-token"));
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "meta_leads_sweep_failed", code: "meta_leads_sweep_failed" });
});
it("runs every ten minutes as an unregistered retry backstop", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
  expect(config.crons.filter(row => row.path === "/api/cron/meta-leads")).toEqual([{ path: "/api/cron/meta-leads", schedule: "*/10 * * * *" }]);
  expect(JOBS_REGISTRY.some(row => String(row.job) === "meta-leads")).toBe(false);
});
