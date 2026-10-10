import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as sales } from "@/app/api/cron/toast-sales-today/route";
import { GET as catering } from "@/app/api/cron/toast-catering-scan/route";
import { GET as digest } from "@/app/api/cron/digest-tick/route";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { captureIntraday } from "@/lib/toast/capture-intraday";
import { scanToastCateringForAllLocations } from "@/lib/catering/toast-catering-scan";
import { runDigestTick } from "@/lib/report-digests";
import { audit } from "@/lib/audit";
import { catchUpDailyJobs } from "@/lib/daily-catchup";

vi.mock("@/lib/cron-route-lease", () => ({ claimCronRoute: vi.fn(async () => true) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/job-watch-run", () => ({ watchSiblings: vi.fn(async () => {}) }));
vi.mock("@/lib/daily-catchup", () => ({ catchUpDailyJobs: vi.fn(async () => {}) }));
vi.mock("@/lib/catering/toast-sales", () => ({ pullTodaySalesForAllLocations: vi.fn(async () => []) }));
vi.mock("@/lib/toast/capture-intraday", () => ({ captureIntraday: vi.fn(async () => ({ failures: 0, results: [], skipped: false })) }));
vi.mock("@/lib/toast/capture-modified", () => ({ captureModified: vi.fn(async () => ({ failures: 0, results: [], skipped: false })) }));
vi.mock("@/lib/toast/labor", () => ({ laborPullEnabled: () => false, runToastLaborPull: vi.fn(async () => ({ ran: false })) }));
vi.mock("@/lib/whos-here-tick", () => ({ runWhosHereTick: vi.fn(async () => ({ ran: false })) }));
vi.mock("@/lib/catering/toast-catering-scan", () => ({ scanToastCateringForAllLocations: vi.fn(async () => []) }));
vi.mock("@/lib/report-digests", () => ({ runDigestTick: vi.fn(async () => null) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(claimCronRoute).mockResolvedValue(true);
  vi.stubEnv("CATERING_SCAN_SECRET", "desktop-test");
  vi.stubEnv("CRON_SECRET", "vercel-test");
  vi.stubEnv("DEPLETION_SOURCE", "capture");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const request = (headers: Record<string, string> = { authorization: "Bearer vercel-test" }, query = "") =>
  new NextRequest(`https://example.test/api/cron/test${query}`, { headers });

describe.each([
  ["toast-sales-today", sales, captureIntraday],
  ["toast-catering-scan", catering, scanToastCateringForAllLocations],
  ["digest-tick", digest, runDigestTick],
] as const)("%s auth", (_job, get, work) => {
  it.each([
    [{ authorization: "Bearer vercel-test" }, 200],
    [{ authorization: "bEaReR desktop-test" }, 200],
    [{ "x-cron-secret": "desktop-test" }, 200],
    [{ "x-cron-secret": "desktop-test", authorization: "Bearer wrong" }, 200],
    [{ "x-cron-secret": "vercel-test" }, 401],
    [{ "x-cron-secret": "wrong", authorization: "Bearer vercel-test" }, 401],
    [{ "x-cron-secret": "", authorization: "Bearer vercel-test" }, 401],
    [{ authorization: "vercel-test" }, 401],
    [{ authorization: "Basic vercel-test" }, 401],
    [{ authorization: "Bearer wrong" }, 401],
    [{}, 401],
  ] satisfies Array<[Record<string, string>, number]>)("credentials %j -> %i", async (headers, status) => {
    expect((await get(request(headers))).status).toBe(status);
    expect(work).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
    if (status !== 200) { expect(claimCronRoute).not.toHaveBeenCalled(); expect(audit).not.toHaveBeenCalled(); }
  });
  it.each(["", undefined])("503 when neither secret is configured (%s)", async (value) => {
    vi.stubEnv("CATERING_SCAN_SECRET", value); vi.stubEnv("CRON_SECRET", value);
    expect((await get(request())).status).toBe(503);
    expect(work).not.toHaveBeenCalled(); expect(claimCronRoute).not.toHaveBeenCalled();
  });
  it("accepts either independently configured secret", async () => {
    vi.stubEnv("CATERING_SCAN_SECRET", "");
    expect((await get(request())).status).toBe(200);
    expect((await get(request({ "x-cron-secret": "desktop-test" }))).status).toBe(401);
    vi.stubEnv("CATERING_SCAN_SECRET", "desktop-test"); vi.stubEnv("CRON_SECRET", "");
    expect((await get(request())).status).toBe(401);
    expect((await get(request({ authorization: "Bearer desktop-test" }))).status).toBe(200);
  });
});

describe.each([
  ["toast-sales-today", sales, captureIntraday],
  ["toast-catering-scan", catering, scanToastCateringForAllLocations],
] as const)("%s lease", (job, get, work) => {
  it("only lets the database claim winner run, with no fake heartbeat from the loser", async () => {
    vi.mocked(claimCronRoute).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const responses = await Promise.all([get(request()), get(request({ "x-cron-secret": "desktop-test" }))]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await responses[1]!.json()).toEqual({ skipped: true, reason: "cron_route_busy" });
    expect(work).toHaveBeenCalledTimes(1);
    expect(claimCronRoute).toHaveBeenCalledWith(job);
    expect(audit).toHaveBeenCalledTimes(1);
  });
  it("fails closed on a claim failure and records a failure, never success", async () => {
    vi.mocked(claimCronRoute).mockRejectedValueOnce(new Error("cron_route_claim_failed"));
    expect((await get(request())).status).toBe(500);
    expect(work).not.toHaveBeenCalled(); expect(catchUpDailyJobs).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure" }));
  });
  it.each(["2026-07-15T10:00:00Z", "2026-07-16T03:50:00Z", "2026-01-15T10:00:00Z", "2026-01-16T03:50:00Z"])(
    "accepts padded schedule time %s and keeps the ET business date", async (at) => {
      vi.useFakeTimers(); vi.setSystemTime(new Date(at));
      const result = await get(request());
      expect(result.status).toBe(200);
      const body = await result.json();
      const day = at.includes("07-") ? "2026-07-15" : "2026-01-15";
      expect(job === "toast-sales-today" ? body.date : body.dates[0]).toBe(day);
    });
});

it("rejects invalid catering date overrides before claiming the route", async () => {
  expect((await catering(request(undefined, "?date=bad"))).status).toBe(400);
  expect((await catering(request(undefined, "?date=1900-01-01"))).status).toBe(400);
  expect(claimCronRoute).not.toHaveBeenCalled();
});
