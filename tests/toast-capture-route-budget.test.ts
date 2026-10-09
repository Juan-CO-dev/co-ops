import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/toast-sales-today/route";
import { captureToastDaySystem } from "@/lib/toast/capture";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { pullTodaySalesForAllLocations } from "@/lib/catering/toast-sales";
import { audit } from "@/lib/audit";
import { runToastLaborPull } from "@/lib/toast/labor";
import { captureModified } from "@/lib/toast/capture-modified";
vi.mock("@/lib/toast/capture-modified", () => ({ captureModified: vi.fn() }));
vi.mock("@/lib/catering/toast-sales", () => ({ pullTodaySalesForAllLocations: vi.fn() }));
vi.mock("@/lib/toast/capture", () => ({ captureEnabled: () => true, captureToastDaySystem: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/job-watch-run", () => ({ watchSiblings: vi.fn(async () => {}) }));
vi.mock("@/lib/toast/labor", () => ({ laborPullEnabled: vi.fn(() => true), runToastLaborPull: vi.fn(async () => ({ ran: false, results: [], modified: 0 })) }));
const reconcile = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(captureModified).mockResolvedValue({ failures: 0, results: [], skipped: false });
  vi.stubEnv("DEPLETION_SOURCE", "capture");
  vi.mocked(pullTodaySalesForAllLocations).mockResolvedValue([{ locationId: "shop", result: "pulled" }]);
  vi.useFakeTimers();
  vi.stubEnv("CATERING_SCAN_SECRET", "synthetic-test-secret");
  const query = { select: () => query, eq: () => query, not: () => query,
    abortSignal: async () => ({ data: [{ id: "shop" }], error: null }) };
  reconcile.mockReturnValue({ abortSignal: async () => ({ error: null }) });
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => query, rpc: reconcile } as unknown as ReturnType<typeof getServiceRoleClient>);
  vi.mocked(captureToastDaySystem).mockImplementation(() => new Promise(() => {}));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it.each([0, 100_000, 111_000])("reserves response time after %ims elapsed before capture", async (elapsedMs) => {
  const start = Date.now();
  const request = new NextRequest("http://localhost/api/cron/toast-sales-today", {
    headers: { "x-cron-secret": "synthetic-test-secret" },
  });
  // Simulate pre-capture route work without resurrecting the retired writer.
  const get = request.headers.get.bind(request.headers);
  vi.spyOn(request.headers, "get").mockImplementation((key) => {
    vi.setSystemTime(start + elapsedMs);
    return get(key);
  });
  let done = false;
  const pending = GET(request).then((response) => { done = true; return response; });
  const available = Math.max(0, 110_000 - elapsedMs);
  const allowance = Math.max(0, Math.min(45_000, available - Math.min(30_000, available)));
  if (allowance) {
    await vi.advanceTimersByTimeAsync(allowance - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
  }
  const response = await pending;
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ healthy: false });
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure",
    metadata: expect.objectContaining({ job: "toast-sales-today", capture_failures: allowance ? 1 : 0 }),
  }));
  expect(captureToastDaySystem).toHaveBeenCalledTimes(allowance ? 1 : 0);
  expect(captureModified).toHaveBeenCalledWith(expect.any(AbortSignal), Math.min(20_000,
    Math.max(0, 110_000 - elapsedMs - allowance - 30_000)));
});

it("modified discovery runs after capture and its failure leaves labor and response available", async () => {
  vi.mocked(captureToastDaySystem).mockResolvedValue({ skipped: false, runId: "run" } as Awaited<ReturnType<typeof captureToastDaySystem>>);
  vi.mocked(captureModified).mockResolvedValue({ failures: 1, results: [], skipped: false, error: "capture_schema_missing" });
  const response = await GET(new NextRequest("http://localhost/api/cron/toast-sales-today", {
    headers: { "x-cron-secret": "synthetic-test-secret" },
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ healthy: true, modified: { failures: 1 }, labor: { ran: false } });
  expect(vi.mocked(captureModified).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(captureToastDaySystem).mock.invocationCallOrder[1]!);
  expect(vi.mocked(runToastLaborPull).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(captureModified).mock.invocationCallOrder[0]!);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ modified_failures: 1, modified_errors: ["capture_schema_missing"] }) }));
});

it.each([undefined, "capture"])("today uses %s writer mode and runs additive capture", async (flag) => {
  vi.stubEnv("DEPLETION_SOURCE", flag);
  vi.mocked(captureToastDaySystem).mockResolvedValue({ skipped: false, runId: "run" } as Awaited<ReturnType<typeof captureToastDaySystem>>);
  const request = new NextRequest("http://localhost/api/cron/toast-sales-today", { headers: { "x-cron-secret": "synthetic-test-secret" } });
  const response = await GET(request);
  expect(await response.json()).toMatchObject({ healthy: true });
  expect(pullTodaySalesForAllLocations).toHaveBeenCalledTimes(flag === "capture" ? 0 : 1);
  expect(captureToastDaySystem).toHaveBeenCalledTimes(2);
  expect(reconcile).toHaveBeenCalledWith("reconcile_ezcater_toast", expect.objectContaining({ p_from: expect.any(String), p_to: expect.any(String) }));
  expect(runToastLaborPull).toHaveBeenCalledWith([expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)], expect.objectContaining({
    context: "cron", reconcileDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), deadlineMs: 30_000,
  }));
});

it("keeps the pinger healthy when the additive labor pull fails soft", async () => {
  vi.mocked(captureToastDaySystem).mockResolvedValue({ skipped: false, runId: "run" } as Awaited<ReturnType<typeof captureToastDaySystem>>);
  vi.mocked(runToastLaborPull).mockResolvedValue({
    ran: true, modified: 0,
    results: [{ locationId: "shop", businessDate: "modified", ok: false, rows: 0, skipped: 0, error: "toast_labor_deadline" }],
  });
  const response = await GET(new NextRequest("http://localhost/api/cron/toast-sales-today", {
    headers: { "x-cron-secret": "synthetic-test-secret" },
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ healthy: true, labor: { ran: true, results: [{ ok: false }] } });
});

it("audits each shop failure code and omits successful shops", async () => {
  vi.mocked(captureToastDaySystem).mockResolvedValue({ skipped: false, runId: "run" } as Awaited<ReturnType<typeof captureToastDaySystem>>);
  vi.mocked(captureModified).mockResolvedValue({ failures: 2, skipped: false, results: [
    { locationId: "shop", windows: 0, pages: 0, changed: 0, error: "toast_http_400" },
    { locationId: "second", windows: 0, pages: 0, changed: 0, error: "toast_http_400" },
    { locationId: "third", windows: 1, pages: 1, changed: 0, error: null },
  ] });
  const response = await GET(new NextRequest("http://localhost/api/cron/toast-sales-today", { headers: { "x-cron-secret": "synthetic-test-secret" } }));
  expect(response.status).toBe(200);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({
    modified_failures: 2, modified_errors: ["toast_http_400", "toast_http_400"],
  }) }));
});
