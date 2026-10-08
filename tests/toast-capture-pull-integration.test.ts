import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runToastSalesPull } from "@/lib/toast-sales-pull-run";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { runOrderCapture } from "@/lib/toast/capture-job";
import { materializeCapturedDepletion } from "@/lib/toast/depletion";
import { pullSalesForAllLocations, materializeDailyDepletion } from "@/lib/catering/toast-sales";
import { loadDepletionWatermark } from "@/lib/counts";
import { runParShadowForLocation, recordParRunSkipped } from "@/lib/dynamic-pars";
import { completeElapsedCateringEvents } from "@/lib/catering/system-intake";
import { audit } from "@/lib/audit";
import { watchSiblings } from "@/lib/job-watch-run";
import { GET, maxDuration } from "@/app/api/cron/toast-sales-pull/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/capture-job", () => ({ runOrderCapture: vi.fn() }));
vi.mock("@/lib/toast/depletion", () => ({ materializeCapturedDepletion: vi.fn() }));
vi.mock("@/lib/dynamic-pars", () => ({ runParShadowForLocation: vi.fn(), recordParRunSkipped: vi.fn() }));
vi.mock("@/lib/catering/toast-sales", () => ({ pullSalesForAllLocations: vi.fn(), materializeDailyDepletion: vi.fn() }));
vi.mock("@/lib/counts", () => ({ loadDepletionWatermark: vi.fn() }));
vi.mock("@/lib/catering/system-intake", () => ({ completeElapsedCateringEvents: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/job-watch-run", () => ({ watchSiblings: vi.fn(async () => {}) }));

const DAYS = ["2026-10-06", "2026-10-05", "2026-10-04"];
const SHOPS = ["shop1", "shop2"];
type CaptureResult = Awaited<ReturnType<typeof runOrderCapture>>;
const fullCapture = (): CaptureResult => ({ failures: 0, skipped: false,
  results: DAYS.flatMap((businessDate) => SHOPS.map((locationId) => ({
    locationId, businessDate, runId: `${locationId}:${businessDate}`, skipped: false,
    orders: 0, pages: 1, error: null, complete: true,
  }))),
});
let sequence: string[];
let captureResult: CaptureResult;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEPLETION_SOURCE", "capture");
  sequence = [];
  vi.mocked(pullSalesForAllLocations).mockImplementation(async () => {
    sequence.push("legacy-pull");
    return SHOPS.map((locationId) => ({ locationId, ok: true }));
  });
  vi.mocked(materializeDailyDepletion).mockImplementation(async (id, date) => {
    sequence.push(`legacy-depletion:${id}:${date}`);
    return { rows: 0 };
  });
  vi.mocked(loadDepletionWatermark).mockResolvedValue(null);
  vi.mocked(recordParRunSkipped).mockResolvedValue({ rows: 0 } as Awaited<ReturnType<typeof recordParRunSkipped>>);
  captureResult = fullCapture();
  const query = { select: () => query, eq: () => query,
    not: async () => ({ data: SHOPS.map((id) => ({ id })), error: null }) };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => query } as unknown as ReturnType<typeof getServiceRoleClient>);
  vi.mocked(runOrderCapture).mockImplementation(async () => {
    sequence.push(...DAYS.flatMap((date) => SHOPS.map((id) => `capture:${id}:${date}`)));
    return captureResult;
  });
  vi.mocked(materializeCapturedDepletion).mockImplementation(async (id, date) => {
    sequence.push(`depletion:${id}:${date}`);
    return { rows: 2 } as Awaited<ReturnType<typeof materializeCapturedDepletion>>;
  });
  vi.mocked(runParShadowForLocation).mockImplementation(async (id, date) => {
    sequence.push(`pars:${id}:${date}`);
    return { rows: 1 } as Awaited<ReturnType<typeof runParShadowForLocation>>;
  });
  vi.mocked(completeElapsedCateringEvents).mockResolvedValue({ completed: [], failed: [], stageChanged: 0 });
});
afterEach(() => vi.unstubAllEnvs());

it("finishes every requested capture, then every materialization, then shadow pars", async () => {
  const result = await runToastSalesPull({ businessDate: DAYS[0]! });
  expect(runOrderCapture).toHaveBeenCalledExactlyOnceWith(SHOPS, DAYS[0], "cron", DAYS, expect.any(Number), undefined);
  const expected = (stage: string) => DAYS.flatMap((date) => SHOPS.map((id) => `${stage}:${id}:${date}`));
  expect(sequence).toEqual([...expected("capture"), ...expected("depletion"), ...SHOPS.map((id) => `pars:${id}:${DAYS[0]}`)]);
  expect(pullSalesForAllLocations).not.toHaveBeenCalled();
  expect(materializeDailyDepletion).not.toHaveBeenCalled();
  expect(result).toMatchObject({ healthy: true, metadata: { capture_failures: 0, depletion_failures: 0, par_run_failures: 0 } });
});

it("cannot materialize while the shared capture phase remains pending", async () => {
  let finish: (result: CaptureResult) => void = () => {};
  vi.mocked(runOrderCapture).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const pending = runToastSalesPull({ businessDate: DAYS[0]! });
  await vi.waitFor(() => expect(runOrderCapture).toHaveBeenCalledTimes(1));
  expect(materializeCapturedDepletion).not.toHaveBeenCalled();
  expect(runParShadowForLocation).not.toHaveBeenCalled();
  finish(fullCapture());
  await expect(pending).resolves.toMatchObject({ healthy: true });
});

it("a capture failure excludes exactly its location-day while other dates continue", async () => {
  captureResult = { ...captureResult, failures: 1,
    results: captureResult.results.map((r) => r.locationId === "shop1" && r.businessDate === DAYS[1]
      ? { ...r, complete: false, error: "capture_deadline" } : r) };
  const result = await runToastSalesPull({ businessDate: DAYS[0]! });
  expect(materializeCapturedDepletion).toHaveBeenCalledTimes(5);
  expect(materializeCapturedDepletion).not.toHaveBeenCalledWith("shop1", DAYS[1]);
  expect(runParShadowForLocation).toHaveBeenCalledTimes(2);
  expect(runParShadowForLocation).not.toHaveBeenCalledWith("shop1", DAYS[1]);
  expect(runParShadowForLocation).toHaveBeenCalledWith("shop1", DAYS[0]);
  expect(runParShadowForLocation).not.toHaveBeenCalledWith("shop1", DAYS[2]);
  expect(result).toMatchObject({ healthy: false, metadata: { capture_failures: 1, per_location_failures: 1 } });
});

it("missing result coverage cannot be replaced by an older successful watermark", async () => {
  captureResult.results = captureResult.results.filter((r) => !(r.locationId === "shop2" && r.businessDate === DAYS[2]));
  const result = await runToastSalesPull({ businessDate: DAYS[0]! });
  expect(materializeCapturedDepletion).not.toHaveBeenCalledWith("shop2", DAYS[2]);
  expect(runParShadowForLocation).not.toHaveBeenCalledWith("shop2", DAYS[2]);
  expect(result.healthy).toBe(false);
});

it("successful zero-row materialization authorizes pars for that same day", async () => {
  vi.mocked(materializeCapturedDepletion).mockResolvedValue({ rows: 0 } as Awaited<ReturnType<typeof materializeCapturedDepletion>>);
  const result = await runToastSalesPull({ businessDate: DAYS[0]! });
  expect(result.healthy).toBe(true);
  expect(result.metadata.depletion_rows["shop1:2026-10-06"]).toBe(0);
  expect(runParShadowForLocation).toHaveBeenCalledTimes(2);
});

it("a failed replacement prevents that day from authorizing pars", async () => {
  vi.mocked(materializeCapturedDepletion).mockRejectedValueOnce(new Error("replacement failed"));
  const result = await runToastSalesPull({ businessDate: DAYS[0]! });
  expect(runParShadowForLocation).not.toHaveBeenCalledWith("shop1", DAYS[0]);
  expect(runParShadowForLocation).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ healthy: false, metadata: { depletion_failures: 1, per_location_failures: 1 } });
});

it("degraded materialization counts as a day and authorizes T-1 pars", async () => {
  vi.mocked(materializeCapturedDepletion).mockResolvedValueOnce({ rows: 0, runId: "run",
    status: "degraded", reason: "toast_capture_config_degraded" });
  const result = await runToastSalesPull({ businessDate: DAYS[0]! });
  expect(result).toMatchObject({ healthy: true, metadata: { depletion_failures: 0 } });
  expect(runParShadowForLocation).toHaveBeenCalledWith("shop1", DAYS[0]);
  expect(runParShadowForLocation).toHaveBeenCalledTimes(2);
});

it("passes remaining route time and cancellation into capture", async () => {
  const now = Date.now();
  const parent = new AbortController();
  await runToastSalesPull({ businessDate: DAYS[0]!, deadlineAt: now + 22_000, signal: parent.signal });
  const call = vi.mocked(runOrderCapture).mock.calls[0]!;
  expect(call[4]).toBeGreaterThan(0);
  expect(call[4]).toBeLessThanOrEqual(22_000);
  expect(call[5]).toBe(parent.signal);
});

it.each([undefined, "legacy"])("flag %s preserves legacy pull, materializer, pars, then additive capture", async (flag) => {
  vi.stubEnv("DEPLETION_SOURCE", flag);
  const result = await runToastSalesPull({ businessDate: DAYS[0]! });
  expect(pullSalesForAllLocations).toHaveBeenCalledExactlyOnceWith(DAYS[0]);
  expect(materializeCapturedDepletion).not.toHaveBeenCalled();
  expect(sequence.slice(0, 5)).toEqual(["legacy-pull", ...SHOPS.map((id) => `legacy-depletion:${id}:${DAYS[0]}`), ...SHOPS.map((id) => `pars:${id}:${DAYS[0]}`)]);
  expect(runOrderCapture).toHaveBeenCalledExactlyOnceWith(SHOPS, DAYS[0], "cron", [DAYS[0]], expect.any(Number), undefined);
  expect(result).toMatchObject({ healthy: true, metadata: { source: "legacy", pars_pending_activation: false } });
});
it("disabled additive capture leaves the flag-OFF operational pipeline healthy", async () => {
  vi.stubEnv("DEPLETION_SOURCE", undefined);
  captureResult = { failures: 0, skipped: true, results: [] };
  const result = await runToastSalesPull({ businessDate: DAYS[0]! });
  expect(result.healthy).toBe(true);
  expect(runParShadowForLocation).toHaveBeenCalledTimes(2);
});
it("flag-OFF legacy materialization failure records a skipped par when no watermark covers T-1", async () => {
  vi.stubEnv("DEPLETION_SOURCE", undefined);
  vi.mocked(materializeDailyDepletion).mockRejectedValueOnce(new Error("write failed"));
  const result = await runToastSalesPull({ businessDate: DAYS[0]! });
  expect(recordParRunSkipped).toHaveBeenCalledExactlyOnceWith("shop1", DAYS[0], null);
  expect(runParShadowForLocation).toHaveBeenCalledExactlyOnceWith("shop2", DAYS[0]);
  expect(result.metadata.depletion_failures).toBe(1);
});

it("the kill switch cannot report a healthy nightly run", async () => {
  captureResult = { failures: 0, skipped: true, results: [] };
  const result = await runToastSalesPull({ businessDate: DAYS[0]! });
  expect(materializeCapturedDepletion).not.toHaveBeenCalled();
  expect(runParShadowForLocation).not.toHaveBeenCalled();
  expect(result).toMatchObject({ healthy: false, metadata: { capture_skipped: true, per_location_failures: 2 } });
});

it("par failures degrade health and do not stop other days", async () => {
  vi.mocked(runParShadowForLocation).mockRejectedValueOnce(new Error("par failed"));
  const result = await runToastSalesPull({ businessDate: DAYS[0]! });
  expect(runParShadowForLocation).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({ healthy: false, metadata: { par_run_failures: 1 } });
});

it("catering rollover errors are sanitized and degrade health", async () => {
  vi.mocked(completeElapsedCateringEvents).mockRejectedValue(new Error("PRIVATE customer payload"));
  const result = await runToastSalesPull({ businessDate: DAYS[0]! });
  expect(result).toMatchObject({ healthy: false, metadata: { elapsed_error: "capture_failed" } });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});

it("the authenticated route has a 300-second budget and reports failed capture health", async () => {
  vi.stubEnv("CRON_SECRET", "synthetic-cron-test-secret");
  captureResult = { failures: 0, skipped: true, results: [] };
  const request = new NextRequest("http://localhost/api/cron/toast-sales-pull?date=2026-10-06", {
    headers: { authorization: "Bearer synthetic-cron-test-secret" },
  });
  const response = await GET(request);
  expect(maxDuration).toBe(300);
  expect(await response.json()).toMatchObject({ healthy: false });
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure",
    metadata: expect.objectContaining({ job: "toast-sales-pull", capture_skipped: true }) }));
  expect(watchSiblings).toHaveBeenCalledWith("toast-sales-pull");
});
