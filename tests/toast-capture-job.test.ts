import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runOrderCapture } from "@/lib/toast/capture-job";
import { captureToastDaySystem } from "@/lib/toast/capture";
import { audit } from "@/lib/audit";

vi.mock("@/lib/toast/capture", async (original) => ({
  ...await original<typeof import("@/lib/toast/capture")>(),
  captureToastDaySystem: vi.fn(),
}));
vi.mock("@/lib/toast/client", async (original) => ({
  ...await original<typeof import("@/lib/toast/client")>(), toastConfigured: () => true,
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

const DAYS = ["2026-10-06", "2026-10-05", "2026-10-04"];
const SHOPS = ["shop1", "shop2"];
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("TOAST_ORDER_CAPTURE", "1");
  vi.stubEnv("TOAST_FIXTURES", "0");
  vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "run", pages: 1, orders: 0, skipped: false });
  vi.mocked(audit).mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("shared full-day capture job", () => {
  it.each([undefined, "0"])("capture flag %s disables the real job without a heartbeat", async (flag) => {
    vi.stubEnv("TOAST_ORDER_CAPTURE", flag);
    expect(await runOrderCapture(SHOPS, DAYS[0]!, "cron", DAYS)).toEqual({ failures: 0, skipped: true, results: [] });
    expect(captureToastDaySystem).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("fixture mode cannot masquerade as a completed production capture", async () => {
    vi.stubEnv("TOAST_FIXTURES", "1");
    expect(await runOrderCapture(SHOPS, DAYS[0]!, "cron", DAYS)).toMatchObject({ skipped: true });
    expect(captureToastDaySystem).not.toHaveBeenCalled();
  });

  it("deduplicates shops and dates, uses one signal, and never requests retired-ledger reconciliation", async () => {
    const result = await runOrderCapture([...SHOPS, SHOPS[0]!], DAYS[0]!, "cron", [...DAYS, DAYS[0]!]);
    expect(captureToastDaySystem).toHaveBeenCalledTimes(6);
    expect(result).toMatchObject({ failures: 0, skipped: false });
    expect(result.results).toHaveLength(6);
    const signals = vi.mocked(captureToastDaySystem).mock.calls.map((call) => call[2]?.signal);
    expect(new Set(signals).size).toBe(1);
    for (const call of vi.mocked(captureToastDaySystem).mock.calls) {
      expect(call[2]).toEqual({ signal: expect.any(AbortSignal) });
    }
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.success",
      metadata: expect.objectContaining({ job: "toast-order-capture", failures: 0 }) }));
  });

  it("the 180-second deadline covers later dates instead of restarting per date", async () => {
    vi.mocked(captureToastDaySystem).mockImplementation(async (_id, date) => {
      if (date === DAYS[0]) {
        await new Promise<void>((resolve) => setTimeout(resolve, 120_000));
        return { runId: "first-day", pages: 1, orders: 0, skipped: false };
      }
      // Deliberately ignore AbortSignal to prove the job owns the wall-clock bound.
      return new Promise(() => {});
    });
    let settled = false;
    const pending = runOrderCapture(SHOPS, DAYS[0]!, "cron", DAYS).then((result) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(captureToastDaySystem).toHaveBeenCalledTimes(4);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.failures).toBe(4);
    expect(result.results.filter((r) => r.complete)).toHaveLength(2);
    expect(result.results.filter((r) => !r.complete)).toEqual(expect.arrayContaining(
      DAYS.slice(1).flatMap((businessDate) => SHOPS.map((locationId) => expect.objectContaining({
        locationId, businessDate, complete: false, error: "capture_deadline",
      }))),
    ));
    expect(captureToastDaySystem).toHaveBeenCalledTimes(4); // third date was never sent after abort
    expect(vi.mocked(captureToastDaySystem).mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
  });

  it("manual capture has a 60-second shared deadline and a distinct heartbeat", async () => {
    vi.mocked(captureToastDaySystem).mockImplementation(() => new Promise(() => {}));
    const pending = runOrderCapture(SHOPS, DAYS[0]!, "manual", DAYS);
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;
    expect(result.failures).toBe(6);
    expect(result.results).toHaveLength(6);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure",
      metadata: expect.objectContaining({ job: "toast-order-capture-manual", failures: 6 }) }));
    expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ job: "toast-order-capture" }) }));
  });

  it("a hung heartbeat cannot extend the shared capture budget", async () => {
    vi.mocked(audit).mockImplementation(() => new Promise(() => {}));
    const pending = runOrderCapture(SHOPS, DAYS[0]!, "manual");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({ skipped: false, failures: 0 });
  });

  it("missing schema is incomplete evidence rather than a zero-sales success", async () => {
    vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "", pages: 0, orders: 0,
      skipped: true, reason: "capture_schema_missing" });
    const result = await runOrderCapture(SHOPS, DAYS[0]!, "cron", DAYS);
    expect(result.failures).toBe(6);
    expect(result.results.every((r) => !r.complete && r.error === "capture_schema_missing")).toBe(true);
  });

  it("marks catering degradation unhealthy while retaining the completed capture fact", async () => {
    vi.mocked(captureToastDaySystem).mockResolvedValueOnce({ runId: "run", pages: 1, orders: 0, skipped: false,
      catering: { ok: false, error: "capture_config_stale" } });
    const result = await runOrderCapture(SHOPS, DAYS[0]!, "cron");
    expect(result.failures).toBe(1);
    expect(result.results[0]).toMatchObject({ complete: true, error: "capture_config_stale" });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "cron.failure" }));
  });

  it("sanitizes provider failures while allowing independent shop/date captures to finish", async () => {
    vi.mocked(captureToastDaySystem).mockRejectedValueOnce(new Error("PRIVATE provider payload"));
    const result = await runOrderCapture(SHOPS, DAYS[0]!, "cron", DAYS);
    expect(result.failures).toBe(1);
    expect(result.results.filter((r) => r.complete)).toHaveLength(5);
    expect(result.results[0]).toMatchObject({ complete: false, error: "capture_failed" });
    expect(JSON.stringify({ result, audit: vi.mocked(audit).mock.calls })).not.toContain("PRIVATE");
  });
});
