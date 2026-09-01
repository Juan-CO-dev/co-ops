/**
 * Staff sign-in SOURCE throttle — the pure half (P2-6).
 *
 * WHAT THIS IS FOR. The PIN login's only brake was the per-ACCOUNT 5-per-15-min
 * lockout, and the target of a guess is free: `/api/users/login-options` is
 * unauthenticated and hands out real user ids (a documented, accepted
 * enumeration tradeoff for the tile-login UX). An attacker therefore never
 * trips a lockout — they rotate targets. Twenty accounts x 4 guesses per window
 * x 96 windows is ~7,680 guesses a day against a 10,000-PIN space. Counting the
 * SOURCE is the missing dimension.
 *
 * AND THE COUNTER-ARGUMENT IS REAL, WHICH IS WHY THE BUDGET IS GENEROUS.
 * app/api/auth/password-reset-request/route.ts records the prior ruling
 * verbatim: "No per-SOURCE cap on sign-in: a whole location shares one IP, so
 * that would false-lock legit staff." That is true and it still binds — a shop
 * behind one NAT means this is a per-LOCATION cap in practice. The budget is
 * therefore set far above a shift change's real login volume and the per-account
 * lockout REMAINS the primary brake; this only removes the attacker's ability
 * to run an unbounded rotation from one machine. Two further safety rails: the
 * limiter is fail-open (a limiter outage never locks a shop out), and no
 * trusted source IP means the throttle is skipped rather than pooled.
 *
 * The I/O half is lib/portal/rate-limit.ts's `checkAndRecord`, which this
 * module deliberately does not import — everything here is a decision, so it is
 * unit-testable with no database anywhere near it.
 */

/** Matches the per-account lockout window, so an operator sees one time-scale. */
export const PIN_SOURCE_WINDOW_SECONDS = 15 * 60;

/**
 * Attempts per source IP per window.
 *
 * Sized against the operational worst case, not the attacker: one shop's whole
 * shift change on shared tablets, plus mistyped PINs and idle-timeout
 * re-logins, is comfortably under this. A guessing rotation is not.
 */
export const PIN_SOURCE_MAX_ATTEMPTS = 30;

/**
 * The limiter bucket for a sign-in source, or null when there is no trusted IP.
 *
 * NULL MEANS SKIP, NEVER POOL. The house precedent for a missing IP is a
 * literal `"noip"` segment (lib/portal/magic-link.ts), but that key also
 * carries the email, so its fallback bucket is still per-target. A bare
 * `pin_src:noip` would be ONE global bucket for every shop on the platform, and
 * a single missing `x-vercel-forwarded-for` would then become a
 * business-wide sign-in outage. Refusing to build a key is the honest answer.
 */
export function pinSourceBucketKey(ip: string | null | undefined): string | null {
  if (typeof ip !== "string") return null;
  const trimmed = ip.trim();
  if (trimmed.length === 0) return null;
  return `pin_src:${trimmed}`;
}

/**
 * Seconds until the current fixed window rolls over.
 *
 * MIRRORS THE LIMITER'S OWN ARITHMETIC. lib/portal/rate-limit.ts buckets on
 * `floor(now / windowMs) * windowMs`, so the moment a throttled caller may try
 * again is the next such boundary — not a flat constant. Never returns 0: a
 * client told to retry in zero seconds retries immediately and is refused
 * again, which reads as a hang rather than a throttle.
 */
export function fixedWindowRetryAfterSeconds(nowMs: number, windowSeconds: number): number {
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const remainingMs = windowStart + windowMs - nowMs;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}
