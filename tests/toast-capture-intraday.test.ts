import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { captureIntraday } from "@/lib/toast/capture-intraday";
import { captureEnabled, captureToastDaySystem } from "@/lib/toast/capture";
import { getServiceRoleClient } from "@/lib/supabase-server";
vi.mock("@/lib/toast/capture", () => ({ captureEnabled: vi.fn(() => true), captureToastDaySystem: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(captureEnabled).mockReturnValue(true);
  vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "run", pages: 1, orders: 0, skipped: false });
  const query = { select: () => query, eq: () => query, not: () => query,
    abortSignal: async () => ({ data: [{ id: "shop" }], error: null }) };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => query } as unknown as ReturnType<typeof getServiceRoleClient>);
});
afterEach(() => vi.useRealTimers());
it("captures today then yesterday with atomic debounce requested on each", async () => {
  expect(await captureIntraday("2026-10-07")).toMatchObject({ failures: 0 });
  expect(vi.mocked(captureToastDaySystem).mock.calls.map((c) => c[1])).toEqual(["2026-10-07", "2026-10-06"]);
  expect(captureToastDaySystem).toHaveBeenCalledWith("shop", "2026-10-07", { debounce: true, minInterval: "5 minutes", signal: expect.any(AbortSignal) });
  expect(captureToastDaySystem).toHaveBeenCalledWith("shop", "2026-10-06", { debounce: true, minInterval: "1 hour", signal: expect.any(AbortSignal) });
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
