import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/toast-sales-today/route";
import { pullTodaySalesForAllLocations } from "@/lib/catering/toast-sales";
import { captureToastDaySystem } from "@/lib/toast/capture";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
vi.mock("@/lib/catering/toast-sales", () => ({ pullTodaySalesForAllLocations: vi.fn() }));
vi.mock("@/lib/toast/capture", () => ({ captureEnabled: () => true, captureToastDaySystem: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/job-watch-run", () => ({ watchSiblings: vi.fn(async () => {}) }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("CATERING_SCAN_SECRET", "synthetic-test-secret");
  const query = { select: () => query, eq: () => query, not: () => query,
    abortSignal: async () => ({ data: [{ id: "shop" }], error: null }) };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => query } as unknown as ReturnType<typeof getServiceRoleClient>);
  vi.mocked(captureToastDaySystem).mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it.each([100_000, 111_000])("protects the legacy heartbeat after a %ims selection pull", async (pullMs) => {
  vi.mocked(pullTodaySalesForAllLocations).mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, pullMs));
    return [];
  });
  let done = false;
  const pending = GET(new NextRequest("http://localhost/api/cron/toast-sales-today", {
    headers: { "x-cron-secret": "synthetic-test-secret" },
  })).then((response) => { done = true; return response; });
  await vi.advanceTimersByTimeAsync(pullMs);
  if (pullMs < 110_000) {
    await vi.advanceTimersByTimeAsync(9_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
  }
  const response = await pending;
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ healthy: true });
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success",
    metadata: expect.objectContaining({ job: "toast-sales-today", capture_failures: pullMs < 110_000 ? 1 : 0 }),
  }));
  expect(captureToastDaySystem).toHaveBeenCalledTimes(pullMs < 110_000 ? 1 : 0);
});
