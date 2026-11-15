/**
 * Audit W06/B012 fix round 6 — the client sign-out treats an unconfirmed end as NOT YET ENDED (lib/logout-client.ts).
 *
 * POST /api/auth/logout answers 503 `logout_unconfirmed` (and clears the cookie) when the server cannot confirm the
 * end. The helper retries any non-2xx / network failure / hung request with short, bounded backoff, names the caller's
 * session on every attempt and retry (round 7: the id is required, there is no unnamed sign-out), and reports whether
 * the end was ever acknowledged. The route half is tests/logout-revoke-only.test.ts.
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
async function settle(sessionId = "session-1") {
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

  it("round 7: every attempt and retry names the caller's session, whatever a 503 body says", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(res(504))
      .mockResolvedValueOnce(unconfirmed("session-9"))
      .mockResolvedValue(res(200));
    expect(await settle("session-1")).toEqual({ ended: true, attempts: 4 });
    expect(bodies()).toEqual(Array(4).fill(JSON.stringify({ sessionId: "session-1" })));
  });

  it("never throws", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    await expect(settle()).resolves.toEqual({ ended: false, attempts: LOGOUT_RETRY_DELAYS_MS.length + 1 });
  });
});

// ── Fix round 7 (review W06-r7 P2 #2) — a response body can never hold the sign-out ─────────────────────────────────
// fetch() resolves when the HEADERS arrive. The helper used to clear its abort timer then and await res.json() on a 503
// with no deadline, so a body that stalled on a poor connection held "Signing out…" up forever. Now the decision reads
// the status only (no body is read), and the attempt's request — body stream included — is aborted as soon as the
// attempt is decided, so nothing of it outlives the attempt's own deadline.
const MAX_TOTAL_MS = LOGOUT_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) + (LOGOUT_RETRY_DELAYS_MS.length + 1) * LOGOUT_ATTEMPT_TIMEOUT_MS;

/** Headers arrived; the body never finishes (and is only released by the request's abort signal). */
function stalledBody(status: number, signal: AbortSignal) {
  const json = vi.fn(() => new Promise<never>(() => {}));
  const text = vi.fn(() => new Promise<never>(() => {}));
  const body = new ReadableStream({
    start(controller) {
      signal.addEventListener("abort", () => controller.error(new Error("aborted")));
    },
  });
  return { response: { ok: status >= 200 && status < 300, status, type: "basic", json, text, body } as unknown as Response, json, text };
}

describe("round 7 — stalled response bodies", () => {
  it("a 503 whose body never finishes: no body read, its request is aborted, retried at once, settled in bounds", async () => {
    const stalled: Array<ReturnType<typeof stalledBody>> = [];
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      const s = stalledBody(503, init.signal!);
      stalled.push(s);
      return s.response;
    });
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      return res(200);
    });
    let settled: unknown = null;
    const p = requestSignOut("session-1").then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(LOGOUT_RETRY_DELAYS_MS[0]!);
    expect(settled).toEqual({ ended: true, attempts: 2 }); // the retry went out on the backoff, not after a body
    await p;
    expect(stalled[0]!.json).not.toHaveBeenCalled();
    expect(stalled[0]!.text).not.toHaveBeenCalled();
    expect(signals[0]!.aborted).toBe(true); // the stalled body was released when the attempt was decided
    expect(bodies()).toEqual(Array(2).fill(JSON.stringify({ sessionId: "session-1" })));
  });

  it("every response stalls after its headers: bounded retries, then ended: false within the bounded total", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      return stalledBody(503, init.signal!).response;
    });
    let settled: unknown = null;
    void requestSignOut("session-1").then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(MAX_TOTAL_MS);
    expect(settled).toEqual({ ended: false, attempts: LOGOUT_RETRY_DELAYS_MS.length + 1 });
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it("a 2xx with a stalled body is the end at once (the status decides)", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => stalledBody(200, init.signal!).response);
    let settled: unknown = null;
    void requestSignOut("session-1").then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toEqual({ ended: true, attempts: 1 });
  });
});


// ── Fix round 8 (CC's deadline inventory) — the attempt deadline holds whatever the request does ────────────────────
describe("round 8 — the per-attempt deadline does not depend on the request honouring its signal", () => {
  it("a request that ignores its abort signal is still abandoned at the deadline and retried", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      return new Promise(() => {}); // never settles, whatever the signal says
    });
    fetchMock.mockResolvedValue(res(200));
    let settled: unknown = null;
    void requestSignOut("session-1").then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(LOGOUT_ATTEMPT_TIMEOUT_MS + LOGOUT_RETRY_DELAYS_MS[0]!);
    expect(settled).toEqual({ ended: true, attempts: 2 });
    expect(signals[0]!.aborted).toBe(true);
  });

  it("every request ignores its signal: ended: false within the bounded total", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    let settled: unknown = null;
    void requestSignOut("session-1").then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(MAX_TOTAL_MS);
    expect(settled).toEqual({ ended: false, attempts: LOGOUT_RETRY_DELAYS_MS.length + 1 });
  });
});
