import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runToastSalesPull } from "@/lib/toast-sales-pull-run";
import { materializeDailyDepletion, pullSalesForAllLocations } from "@/lib/catering/toast-sales";
import { runParShadowForLocation } from "@/lib/dynamic-pars";
import { captureToastDaySystem, captureEnabled } from "@/lib/toast/capture";
import { ToastApiError } from "@/lib/toast/client";
import { audit } from "@/lib/audit";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/toast-sales-pull/route";
import { watchSiblings } from "@/lib/job-watch-run";

vi.mock("@/lib/catering/toast-sales", () => ({ pullSalesForAllLocations: vi.fn(), materializeDailyDepletion: vi.fn() }));
vi.mock("@/lib/catering/system-intake", () => ({ completeElapsedCateringEvents: vi.fn(async () => ({ completed: [], failed: [] })) }));
vi.mock("@/lib/counts", () => ({ loadDepletionWatermark: vi.fn(async () => null) }));
vi.mock("@/lib/dynamic-pars", () => ({ runParShadowForLocation: vi.fn(), recordParRunSkipped: vi.fn() }));
vi.mock("@/lib/toast/capture", () => ({ captureToastDaySystem: vi.fn(), captureEnabled: vi.fn(() => true) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

vi.mock("@/lib/job-watch-run", () => ({ watchSiblings: vi.fn(async () => {}) }));

let sequence: string[];
beforeEach(() => {
  vi.clearAllMocks();
  sequence = [];
  vi.mocked(captureEnabled).mockReturnValue(true);
  vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "run", pages: 1, orders: 0, skipped: false });
  vi.mocked(pullSalesForAllLocations).mockImplementation(async () => {
    sequence.push("pull:shop1", "pull:shop2");
    return ["shop1", "shop2"].map((locationId) => ({ locationId, ok: true,
      result: { selections: 3, appended: 2, unchanged: 1, voids: 0 } }));
  });
  vi.mocked(materializeDailyDepletion).mockImplementation(async (id) => {
    sequence.push(`depletion:${id}`); return { rows: 2 };
  });
  vi.mocked(runParShadowForLocation).mockImplementation(async (id) => {
    sequence.push(`pars:${id}`); return { rows: 1 } as Awaited<ReturnType<typeof runParShadowForLocation>>;
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it("finishes both shops' selection, depletion and pars before a hung capture, then returns healthy at the shared 60s deadline", async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  vi.mocked(captureToastDaySystem).mockImplementation((id, _date, opts) => {
    sequence.push(`capture:${id}`);
    signals.push(opts!.signal!);
    // Deliberately ignore abort: the orchestrator must still bound the route.
    return new Promise(() => {});
  });
  let settled = false;
  const pending = runToastSalesPull({ businessDate: "2026-07-23" }).then((result) => { settled = true; return result; });
  await vi.advanceTimersByTimeAsync(0);
  expect(sequence).toEqual(["pull:shop1", "pull:shop2", "depletion:shop1", "depletion:shop2", "pars:shop1", "pars:shop2", "capture:shop1", "capture:shop2"]);
  expect(signals).toHaveLength(2);
  expect(signals[0]).toBe(signals[1]);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({ healthy: true, metadata: {
    capture_failures: 2, per_location_failures: 0, depletion_rows: { shop1: 2, shop2: 2 }, par_rows: { shop1: 1, shop2: 1 },
  } });
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: expect.objectContaining({
    job: "toast-order-capture", failures: 2, results: expect.arrayContaining([expect.objectContaining({ error: "capture_deadline" })]),
  }) }));
});

it("a capture 429 produces its own sanitized failure heartbeat without poisoning selection health", async () => {
  vi.mocked(captureToastDaySystem).mockRejectedValueOnce(new ToastApiError(429, "rate_limited", "PRIVATE provider payload", 60_000));
  const result = await runToastSalesPull({ businessDate: "2026-07-23" });
  expect(result).toMatchObject({ healthy: true, metadata: { job: "toast-sales-pull", capture_failures: 1, per_location_failures: 0 } });
  expect(materializeDailyDepletion).toHaveBeenCalledTimes(2);
  expect(runParShadowForLocation).toHaveBeenCalledTimes(2);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: expect.objectContaining({
    job: "toast-order-capture", results: expect.arrayContaining([{ locationId: "shop1", error: "toast_http_429" }]),
  }) }));
  expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain("PRIVATE");
});

it("successful capture writes an independent nightly heartbeat", async () => {
  expect(await runToastSalesPull({ businessDate: "2026-07-23" })).toMatchObject({ healthy: true, metadata: { capture_failures: 0 } });
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: expect.objectContaining({ job: "toast-order-capture" }) }));
});

it("selection failures remain unhealthy and do not materialize", async () => {
  vi.mocked(pullSalesForAllLocations).mockResolvedValue([{ locationId: "shop", ok: false, error: "selection_failed" }]);
  expect(await runToastSalesPull({ businessDate: "2026-07-23" })).toMatchObject({ healthy: false, metadata: { per_location_failures: 1 } });
  expect(materializeDailyDepletion).not.toHaveBeenCalled();
  expect(runParShadowForLocation).not.toHaveBeenCalled();
});

it("kill switch leaves the selection pipeline healthy without an accounting heartbeat", async () => {
  vi.mocked(captureEnabled).mockReturnValue(false);
  expect(await runToastSalesPull({ businessDate: "2026-07-23" })).toMatchObject({ healthy: true });
  expect(captureToastDaySystem).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

it("authenticated nightly GET stays HTTP 200 with selection cron.success when accounting times out", async () => {
  vi.useFakeTimers();
  vi.stubEnv("CRON_SECRET", "synthetic-cron-test-secret");
  vi.mocked(captureToastDaySystem).mockImplementation(() => new Promise(() => {}));
  const request = new NextRequest("http://localhost/api/cron/toast-sales-pull?date=2026-07-23", {
    headers: { authorization: "Bearer synthetic-cron-test-secret" },
  });
  const pending = GET(request);
  await vi.advanceTimersByTimeAsync(0);
  expect(materializeDailyDepletion).toHaveBeenCalledTimes(2);
  expect(runParShadowForLocation).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  const response = await pending;
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ businessDate: "2026-07-23", healthy: true });
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: expect.objectContaining({ job: "toast-order-capture", failures: 2 }) }));
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: expect.objectContaining({ job: "toast-sales-pull", per_location_failures: 0 }) }));
  expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: expect.objectContaining({ job: "toast-sales-pull" }) }));
  expect(watchSiblings).toHaveBeenCalledWith("toast-sales-pull");
});

it("missing capture schema skips capture and alerts independently while selections stay healthy", async () => {
  vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "", pages: 0, orders: 0, skipped: true, reason: "capture_schema_missing" });
  expect(await runToastSalesPull({ businessDate: "2026-07-23" })).toMatchObject({ healthy: true, metadata: { capture_failures: 2, per_location_failures: 0 } });
  expect(materializeDailyDepletion).toHaveBeenCalledTimes(2);
  expect(runParShadowForLocation).toHaveBeenCalledTimes(2);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: expect.objectContaining({
    job: "toast-order-capture", results: expect.arrayContaining([expect.objectContaining({ skipped: true, error: "capture_schema_missing" })]),
  }) }));
});

 it.each(["mismatch", "skipped"] as const)("shadow %s flags capture heartbeat without failing selections", async (status) => {
  vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "run", pages: 1, orders: 1, skipped: false,
    reconciliation: { status, error: `capture_reconciliation_${status}` } });
  expect(await runToastSalesPull({ businessDate: "2026-07-23" })).toMatchObject({ healthy: true, metadata: { capture_failures: 2, per_location_failures: 0 } });
  expect(captureToastDaySystem).toHaveBeenCalledWith("shop1", "2026-07-23", { signal: expect.any(AbortSignal), reconcile: true });
  expect(materializeDailyDepletion).toHaveBeenCalledTimes(2);
  expect(runParShadowForLocation).toHaveBeenCalledTimes(2);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure", metadata: expect.objectContaining({ job: "toast-order-capture" }) }));
  expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success", metadata: expect.objectContaining({ job: "toast-order-capture" }) }));
});
