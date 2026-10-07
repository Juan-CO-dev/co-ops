import { describe, expect, it, vi } from "vitest";
import { backfillDates, captureErrorCode, retryCaptureRequest, runCapturePages } from "@/lib/toast/capture-runner";
import { ToastApiError } from "@/lib/toast/client";
import { captureToastDay } from "@/lib/toast/capture";
import type { AuthContext } from "@/lib/session";

describe("capture page publication", () => {
  it("publishes only after the terminal short page, including a real empty day", async () => {
    const events: string[] = [];
    const port = {
      page: async (page: number) => page === 1 ? Array(100).fill({}) : [],
      save: async (page: number) => { events.push(`save:${page}`); },
      complete: async (pages: number) => { events.push(`complete:${pages}`); },
      fail: vi.fn(),
    };
    expect(await runCapturePages(port)).toEqual({ pages: 2, orders: 100 });
    expect(events).toEqual(["save:1", "save:2", "complete:2"]);
    expect(port.fail).not.toHaveBeenCalled();
    expect(await runCapturePages({ ...port, page: async () => [] })).toEqual({ pages: 1, orders: 0 });
  });
  it("failed writes never publish and persist only a safe error code", async () => {
    const fail = vi.fn(); const complete = vi.fn();
    await expect(runCapturePages({ page: async () => [{}], save: async () => { throw new Error("customer@example.invalid"); }, complete, fail })).rejects.toThrow("capture_failed");
    expect(fail).toHaveBeenCalledWith("capture_failed");
    expect(complete).not.toHaveBeenCalled();
  });
  it("rejects malformed responses and the full-page safety ceiling", async () => {
    const complete = vi.fn(); const fail = vi.fn();
    for (const page of [async () => ({}), async () => Array(100).fill({})]) {
      await expect(runCapturePages({ page, save: async () => {}, complete, fail })).rejects.toThrow();
    }
    expect(complete).not.toHaveBeenCalled();
    expect(fail.mock.calls.map((call) => call[0])).toEqual(["capture_bad_page", "capture_page_limit"]);
  });
});

describe("capture request backoff", () => {
  it("paces requests and respects Retry-After before retrying a 429", async () => {
    const request = vi.fn().mockRejectedValueOnce(new ToastApiError(429, "rate_limited", undefined, 2500)).mockResolvedValue([]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await retryCaptureRequest(request, sleep);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([250, 2500, 250]);
  });
  it("bounds retry count and never retries authorization failures", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockRejectedValue(new ToastApiError(429, "rate_limited"));
    await expect(retryCaptureRequest(request, sleep)).rejects.toMatchObject({ status: 429 });
    expect(request).toHaveBeenCalledTimes(6);
    request.mockReset().mockRejectedValue(new ToastApiError(403, "forbidden"));
    await expect(retryCaptureRequest(request, sleep)).rejects.toMatchObject({ status: 403 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(captureErrorCode(new Error("private payload"))).toBe("capture_failed");
  });
});

it("backfills exactly 12 months before the fixed anchor, newest first", () => {
  const dates = backfillDates();
  expect(dates).toHaveLength(365);
  expect(dates[0]).toBe("2026-07-22");
  expect(dates.at(-1)).toBe("2025-07-23");
  expect(() => backfillDates("2025-02-30", "2025-03-01")).toThrow();
});

it("binds the actor to the location before credentials or DB creation", async () => {
  const actor = { user: { role: "gm" }, locations: ["shop-a"] } as AuthContext;
  await expect(captureToastDay(actor, "shop-b", "2026-07-22")).rejects.toThrow("capture_forbidden");
  await expect(captureToastDay({ ...actor, user: { ...actor.user, role: "agm" } }, "shop-a", "2026-07-22")).rejects.toThrow("capture_forbidden");
});
