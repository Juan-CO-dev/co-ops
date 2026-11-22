/**
 * Nav PR 8 (plan r2 7.4): the role blocks' reads under PR 7's one page deadline.
 *
 * T-D5 (A3, E5): `settleBy` aborts its signal on a REJECTION too, so a cell that runs several reads under one signal
 * cancels its surviving siblings the moment one rejects. Success does not abort. PR 7's own settleBy / deadline tests
 * (tests/dashboard-page-flow.test.ts, tests/dashboard-read-cancellation.test.ts) re-run unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settleBy } from "@/lib/dashboard-day";

const NOW = new Date("2026-11-18T18:45:00.000Z");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe("T-D5 (E5): settleBy aborts on rejection", () => {
  it("a rejection aborts the signal, resolves failed at once and leaves no timer", async () => {
    let signal: AbortSignal | null = null;
    const r = settleBy((s) => { signal = s; return Promise.reject(new Error("x")); }, Date.now() + 6_000, "t");
    expect(await r).toEqual({ kind: "failed" });
    expect(signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a synchronous throw aborts the signal too", async () => {
    let signal: AbortSignal | null = null;
    expect(await settleBy((s) => { signal = s; throw new Error("sync"); }, Date.now() + 6_000, "t")).toEqual({ kind: "failed" });
    expect(signal!.aborted).toBe(true);
  });

  it("success does not abort", async () => {
    let signal: AbortSignal | null = null;
    expect(await settleBy(async (s) => { signal = s; return 1; }, Date.now() + 6_000, "t")).toEqual({ kind: "ok", value: 1 });
    expect(signal!.aborted).toBe(false);
  });

  it("one sibling rejects at 100 ms while the other hangs: failed at 100 ms, the hanging sibling's signal aborted then", async () => {
    let hanging: AbortSignal | null = null;
    let hangingSaw = false;
    const r = settleBy((s) => Promise.all([
      new Promise((_, reject) => setTimeout(() => reject(new Error("ezcater")), 100)),
      new Promise((resolve) => { hanging = s; s.addEventListener("abort", () => { hangingSaw = true; resolve(null); }); }),
    ]), Date.now() + 6_000, "t");
    let done = false;
    void r.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(99);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await r).toEqual({ kind: "failed" });
    expect(hanging!.aborted).toBe(true);
    expect(hangingSaw).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
