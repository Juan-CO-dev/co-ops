/**
 * Audit W06/B012 fix round 6 — the client sign-out treats an unconfirmed end as NOT YET ENDED (lib/logout-client.ts).
 *
 * POST /api/auth/logout answers 503 `logout_unconfirmed` (and clears the cookie) when the server cannot confirm the
 * end. The helper retries any non-2xx / network failure / hung request with short, bounded backoff, names the session
 * on every retry (its own, else the one the 503 named), and reports whether the end was ever acknowledged. The route
 * half is tests/logout-revoke-only.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGOUT_ATTEMPT_TIMEOUT_MS, LOGOUT_RETRY_DELAYS_MS, requestSignOut } from "@/lib/logout-client";

const fetchMock = vi.fn();
const res = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, type: "basic", json: async () => body }) as unknown as Response;
const unconfirmed = (sessionId = "session-1") => res(503, { code: "logout_unconfirmed", sessionId });
const bodies = () => fetchMock.mock.calls.map((c) => (c[1] as RequestInit).body ?? null);

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Run the helper to completion under fake timers. */
async function settle(sessionId?: string) {
  const p = requestSignOut(sessionId);
  await vi.runAllTimersAsync();
  return p;
}

describe("round 6 — requestSignOut", () => {
  it("a 200 is the end: one request", async () => {
    fetchMock.mockResolvedValue(res(200, { ok: true }));
    expect(await settle("session-1")).toEqual({ ended: true, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/auth/logout");
    expect(bodies()).toEqual([JSON.stringify({ sessionId: "session-1" })]);
  });

  it("a 503 is not the end: it retries, and stops at the first 200", async () => {
    fetchMock.mockResolvedValueOnce(unconfirmed()).mockResolvedValueOnce(unconfirmed()).mockResolvedValue(res(200));
    expect(await settle("session-1")).toEqual({ ended: true, attempts: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("the retries are bounded and spaced by the backoff; still-unconfirmed reports ended: false", async () => {
    fetchMock.mockResolvedValue(unconfirmed());
    const p = requestSignOut("session-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LOGOUT_RETRY_DELAYS_MS[0]! - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry before its delay
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ ended: false, attempts: LOGOUT_RETRY_DELAYS_MS.length + 1 });
    expect(fetchMock).toHaveBeenCalledTimes(LOGOUT_RETRY_DELAYS_MS.length + 1);
  });

  it("network failures and gateway errors are retried the same way", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(res(504))
      .mockResolvedValue(res(200));
    expect(await settle("session-1")).toEqual({ ended: true, attempts: 3 });
  });

  it("a hung request is abandoned at the per-attempt timeout and retried", async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    fetchMock.mockResolvedValue(res(200));
    const p = requestSignOut("session-1");
    await vi.advanceTimersByTimeAsync(LOGOUT_ATTEMPT_TIMEOUT_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ ended: true, attempts: 2 });
  });

  it("a caller that does not know its session names the one the 503 named on every retry", async () => {
    fetchMock.mockResolvedValueOnce(unconfirmed("session-9")).mockResolvedValue(res(200));
    await settle();
    expect(bodies()).toEqual([null, JSON.stringify({ sessionId: "session-9" })]);
  });

  it("never throws", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    await expect(settle()).resolves.toEqual({ ended: false, attempts: LOGOUT_RETRY_DELAYS_MS.length + 1 });
  });
});
