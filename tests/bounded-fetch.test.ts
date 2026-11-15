/**
 * Audit W06 fix round 8 — lib/bounded-fetch.ts: one deadline per request, whatever the request does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeadlineExceeded, fetchStatusWithin, withDeadline } from "@/lib/bounded-fetch";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("withDeadline", () => {
  it("settles at the deadline even when the work ignores its signal, and aborts the signal", async () => {
    let seen: AbortSignal | null = null;
    const p = withDeadline(1000, (signal) => {
      seen = signal;
      return new Promise<never>(() => {});
    });
    const outcome = p.then(() => "resolved", (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(999);
    expect(seen!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBeInstanceOf(DeadlineExceeded);
    expect(seen!.aborted).toBe(true);
  });

  it("returns the work's value and aborts the signal once decided (releasing an unread body)", async () => {
    let seen: AbortSignal | null = null;
    const value = await withDeadline(1000, async (signal) => {
      seen = signal;
      return 42;
    });
    expect(value).toBe(42);
    expect(seen!.aborted).toBe(true);
  });

  it("a work rejection after the deadline decided is not an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const p = withDeadline(10, (signal) => new Promise<never>((_r, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
      const outcome = p.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10);
      expect(await outcome).toBeInstanceOf(DeadlineExceeded);
      await vi.advanceTimersByTimeAsync(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

describe("fetchStatusWithin", () => {
  it("status and response type only; never throws; null on a network failure or the deadline", async () => {
    const json = vi.fn();
    fetchMock.mockResolvedValueOnce({ status: 503, type: "basic", json } as unknown as Response);
    expect(await fetchStatusWithin("/x", { method: "POST" }, 1000)).toEqual({ status: 503, type: "basic" });
    expect(json).not.toHaveBeenCalled();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await fetchStatusWithin("/x", { method: "POST" }, 1000)).toBeNull();
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const p = fetchStatusWithin("/x", { method: "POST" }, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBeNull();
    expect((fetchMock.mock.calls[2]![1] as RequestInit).signal!.aborted).toBe(true);
  });
});
