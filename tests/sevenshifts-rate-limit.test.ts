import { describe, expect, it } from "vitest";

import { createLimiter, SEVENSHIFTS_LIMITS } from "@/lib/sevenshifts/rate-limit-shared";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; }, set: (ms: number) => { t = ms; } };
}

describe("createLimiter — a dual token bucket with an injected clock (no real sleeps)", () => {
  it("runs at 80% of the published 10/s and 600/min", () => {
    expect(SEVENSHIFTS_LIMITS).toEqual({ perSecond: 8, perMinute: 500 });
  });

  it("8 immediate reservations go at once; the 9th waits ~1000 ms", () => {
    const c = clock(1_000_000);
    const l = createLimiter({ ...SEVENSHIFTS_LIMITS, now: c.now });
    for (let i = 0; i < 8; i += 1) expect(l.reserve()).toBe(0);
    expect(l.reserve()).toBe(1000);
    // and the 10th is booked behind it, still inside the same next second
    expect(l.reserve()).toBe(1000);
  });

  it("spaced requests never wait", () => {
    const c = clock();
    const l = createLimiter({ ...SEVENSHIFTS_LIMITS, now: c.now });
    for (let i = 0; i < 100; i += 1) {
      expect(l.reserve()).toBe(0);
      c.advance(200);
    }
  });

  it("the per-minute bucket: 500 in a minute, then the 501st waits for the oldest to age out", () => {
    // A per-second cap of 8 can never reach 500 in a rolling minute (8 × 60 = 480), so the minute
    // rule is exercised with a looser per-second cap; production uses SEVENSHIFTS_LIMITS.
    const c = clock();
    const l = createLimiter({ perSecond: 1000, perMinute: 500, now: c.now });
    for (let i = 0; i < 500; i += 1) {
      expect(l.reserve()).toBe(0);
      c.advance(10); // 500 requests over 5 s
    }
    // now = 5000; the oldest went at 0, so the next slot opens at 60 000
    expect(l.reserve()).toBe(55_000);
  });

  it("penalize(retryAfterMs) after a 429 pushes every later reservation past it", () => {
    const c = clock(0);
    const l = createLimiter({ ...SEVENSHIFTS_LIMITS, now: c.now });
    expect(l.reserve()).toBe(0);
    l.penalize(3000);
    expect(l.reserve()).toBe(3000);
    c.advance(1000);
    expect(l.reserve()).toBeGreaterThanOrEqual(2000);
    c.set(10_000);
    expect(l.reserve()).toBe(0);
  });

  it("a negative or non-finite penalty is ignored, never a negative wait", () => {
    const c = clock(0);
    const l = createLimiter({ ...SEVENSHIFTS_LIMITS, now: c.now });
    l.penalize(-50);
    l.penalize(Number.NaN);
    expect(l.reserve()).toBe(0);
  });

  it("over a long burst the booked send times never exceed 8 in any 1 s or 500 in any 60 s", () => {
    const c = clock(0);
    const l = createLimiter({ ...SEVENSHIFTS_LIMITS, now: c.now });
    const sends: number[] = [];
    for (let i = 0; i < 700; i += 1) sends.push(c.now() + l.reserve());
    for (let i = 0; i < sends.length; i += 1) {
      const t = sends[i]!;
      expect(sends.filter((s) => s > t - 1000 && s <= t).length).toBeLessThanOrEqual(8);
      expect(sends.filter((s) => s > t - 60_000 && s <= t).length).toBeLessThanOrEqual(500);
    }
  });

  it("refuses a nonsense configuration", () => {
    expect(() => createLimiter({ perSecond: 0, perMinute: 500, now: () => 0 })).toThrow();
    expect(() => createLimiter({ perSecond: 8, perMinute: 0, now: () => 0 })).toThrow();
  });
});
