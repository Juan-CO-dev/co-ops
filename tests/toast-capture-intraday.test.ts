import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { captureIntraday } from "@/lib/toast/capture-intraday";
import { captureEnabled, captureToastDaySystem } from "@/lib/toast/capture";
import { getServiceRoleClient } from "@/lib/supabase-server";
vi.mock("@/lib/toast/capture", () => ({ captureEnabled: vi.fn(() => true), captureToastDaySystem: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
const reconcile = vi.fn();
const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(captureEnabled).mockReturnValue(true);
  vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "run", pages: 1, orders: 0, skipped: false });
  const query = { select: () => query, eq: () => query, not: () => query,
    abortSignal: async () => ({ data: [{ id: "shop" }], error: null }) };
  reconcile.mockResolvedValue({ error: null });
  rpc.mockReturnValue({ abortSignal: reconcile });
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => query, rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it("captures today then yesterday with atomic debounce requested on each", async () => {
  expect(await captureIntraday("2026-10-07")).toMatchObject({ failures: 0 });
  expect(vi.mocked(captureToastDaySystem).mock.calls.map((c) => c[1])).toEqual(["2026-10-07", "2026-10-06"]);
  expect(captureToastDaySystem).toHaveBeenCalledWith("shop", "2026-10-07", { debounce: true, minInterval: "5 minutes", signal: expect.any(AbortSignal) });
  expect(captureToastDaySystem).toHaveBeenCalledWith("shop", "2026-10-06", { debounce: true, minInterval: "1 hour", signal: expect.any(AbortSignal) });
  expect(rpc).toHaveBeenCalledWith("reconcile_ezcater_toast", { p_from: "2026-09-29", p_to: "2026-10-08" });
  expect(rpc.mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(captureToastDaySystem).mock.invocationCallOrder[1]!);
});
it("accepts a recently completed or running day as a debounce skip", async () => {
  vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "", pages: 0, orders: 0, skipped: true, reason: "capture_debounced" });
  expect(await captureIntraday("2026-10-07")).toMatchObject({ failures: 0, results: [{ skipped: true }, { skipped: true }] });
});
it("bounds abort-ignoring transport without starting yesterday after deadline", async () => {
  vi.useFakeTimers();
  vi.mocked(captureToastDaySystem).mockImplementation(() => new Promise(() => {}));
  const pending = captureIntraday("2026-10-07");
  await vi.advanceTimersByTimeAsync(45_000);
  expect(await pending).toMatchObject({ failures: 1, results: [{ error: "capture_deadline" }] });
  expect(captureToastDaySystem).toHaveBeenCalledTimes(1);
  expect(rpc).not.toHaveBeenCalled();
});

it("reconciles new rings while operational ezCater depletion is off", async () => {
  vi.stubEnv("EZCATER_DEPLETION_ENABLED", "0");
  expect(await captureIntraday("2026-10-08")).toMatchObject({ failures: 0 });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(reconcile).toHaveBeenCalledWith(expect.any(AbortSignal));
});

it("reconciles completed snapshots when another captured day fails", async () => {
  vi.mocked(captureToastDaySystem).mockRejectedValueOnce(new Error("capture_unavailable"));
  expect(await captureIntraday("2026-10-08")).toMatchObject({ failures: 1 });
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("does not reconcile if every capture attempt failed", async () => {
  vi.mocked(captureToastDaySystem).mockRejectedValue(new Error("capture_unavailable"));
  expect(await captureIntraday("2026-10-08")).toMatchObject({ failures: 2 });
  expect(rpc).not.toHaveBeenCalled();
});

it("reconciles committed snapshots even when catering import is degraded", async () => {
  vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "run", pages: 1, orders: 1, skipped: false,
    catering: { ok: false, error: "capture_catering_degraded" } });
  expect(await captureIntraday("2026-10-08")).toMatchObject({ failures: 2 });
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("exposes reconciliation failures without losing capture failures", async () => {
  vi.mocked(captureToastDaySystem).mockRejectedValueOnce(new Error("capture_unavailable"));
  reconcile.mockResolvedValue({ error: { message: "private database detail" } });
  expect(await captureIntraday("2026-10-08")).toMatchObject({ failures: 2, error: "capture_reconciliation_failed" });
});

it("bounds an abort-ignoring reconciliation by the remaining capture deadline", async () => {
  vi.useFakeTimers();
  reconcile.mockImplementation(() => new Promise(() => {}));
  const pending = captureIntraday("2026-10-08", undefined, 2_000);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await pending).toMatchObject({ failures: 1, error: "capture_deadline" });
});
it("kill switch causes no database or provider work", async () => {
  vi.mocked(captureEnabled).mockReturnValue(false);
  expect(await captureIntraday("2026-10-07")).toMatchObject({ skipped: true });
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});

it("uses the smaller remaining route budget and skips when it is exhausted", async () => {
  expect(await captureIntraday("2026-10-07", undefined, 0)).toMatchObject({ skipped: true });
  expect(getServiceRoleClient).not.toHaveBeenCalled();
  vi.useFakeTimers();
  vi.mocked(captureToastDaySystem).mockImplementation(() => new Promise(() => {}));
  const pending = captureIntraday("2026-10-07", undefined, 2_000);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(await pending).toMatchObject({ failures: 1, results: [{ error: "capture_deadline" }] });
  expect(captureToastDaySystem).toHaveBeenCalledTimes(1);
});
