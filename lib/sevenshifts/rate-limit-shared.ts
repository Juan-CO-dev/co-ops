/**
 * THE 7SHIFTS RATE LIMITER — a dual token bucket (per second + per minute). Pure, clock injected.
 *
 * Scheduling Phase 1, Task 4 Step 1. 7shifts publishes 10 req/s and 600 req/min (spec §2). We run
 * at 80% (8/s, 500/min) so a manual Sync now can collide with the cron without a 429 storm.
 * `reserve()` BOOKS the next send slot and returns how many ms to wait before using it; the
 * caller sleeps (the client owns real time, tests never sleep). After a 429, `penalize(ms)` pushes
 * every later slot past the server's Retry-After.
 *
 * Note: at 8/s a rolling minute can hold at most 480 sends, so the 500/min bucket is a backstop
 * that binds only if the per-second cap is ever raised. It is kept, and tested, for that reason.
 */

export const SEVENSHIFTS_LIMITS = { perSecond: 8, perMinute: 500 } as const;

export interface Limiter {
  /** Books a send slot; returns the ms to wait (≥ 0) before sending. */
  reserve(): number;
  /** After a 429: no slot before now + retryAfterMs. Ignores a negative or non-finite value. */
  penalize(retryAfterMs: number): void;
}

export function createLimiter(opts: { perSecond: number; perMinute: number; now: () => number }): Limiter {
  const { perSecond, perMinute, now } = opts;
  if (!Number.isInteger(perSecond) || perSecond < 1 || !Number.isInteger(perMinute) || perMinute < 1) {
    throw new Error("bad_limiter_config");
  }
  const booked: number[] = []; // nondecreasing send instants
  let notBefore = Number.NEGATIVE_INFINITY;

  return {
    reserve(): number {
      const t = now();
      let slot = Math.max(t, notBefore, booked.at(-1) ?? Number.NEGATIVE_INFINITY);
      // A window (slot − span, slot] may hold at most `cap` sends: the cap-th most recent send must
      // have aged out, i.e. slot ≥ that send + span.
      const secondAnchor = booked[booked.length - perSecond];
      if (secondAnchor !== undefined) slot = Math.max(slot, secondAnchor + 1000);
      const minuteAnchor = booked[booked.length - perMinute];
      if (minuteAnchor !== undefined) slot = Math.max(slot, minuteAnchor + 60_000);
      booked.push(slot);
      // Forget sends no window can see any more (keep enough for both anchors).
      while (booked.length > perMinute && booked.length > perSecond && booked[0]! <= slot - 60_000) booked.shift();
      return slot - t;
    },
    penalize(retryAfterMs: number): void {
      if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return;
      notBefore = Math.max(notBefore, now() + retryAfterMs);
    },
  };
}
