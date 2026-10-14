/**
 * PIN sign-in answer -> keypad error mapping (pure, client-safe, zero I/O).
 *
 * B3 / issue #55: the login page used to map EVERY non-ok answer from
 * POST /api/auth/pin that was not 423/403 to "Wrong PIN", including the
 * per-source throttle's 429 rate_limited. A shop shares one NAT IP, so a
 * correct PIN could read "Wrong PIN. Try again." while the real answer was
 * "wait". This module is the one place that decides the mapping.
 *
 * It only DESCRIBES the server's answer. It never loosens the throttle or the
 * lockout (lib/auth-throttle.ts and the route own those rules).
 */

export type PinKeypadError =
  | { kind: "invalid"; message?: string }
  | { kind: "locked"; retryAfterSeconds: number }
  | { kind: "throttled"; retryAfterSeconds: number }
  | { kind: "inactive" }
  | { kind: "network"; message?: string };

/** Used when the server's retry hint is missing or unusable. */
export const PIN_RETRY_FALLBACK_SECONDS = 60;

function retrySeconds(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? Math.ceil(raw)
    : PIN_RETRY_FALLBACK_SECONDS;
}

/**
 * Map a non-ok POST /api/auth/pin response to the keypad's error state.
 *
 *   423 account_locked -> locked (per-account lockout countdown)
 *   403 account_inactive -> inactive
 *   429 (any code)       -> throttled (per-source throttle countdown)
 *   5xx                  -> network (a server fault is not a wrong PIN)
 *   anything else        -> invalid (401 invalid_credentials and friends)
 */
export function pinErrorFromResponse(
  status: number,
  code: string | undefined,
  retryAfterSeconds?: number,
): PinKeypadError {
  if (status === 423 && code === "account_locked") {
    return { kind: "locked", retryAfterSeconds: retrySeconds(retryAfterSeconds) };
  }
  if (status === 403 && code === "account_inactive") return { kind: "inactive" };
  if (status === 429) {
    return { kind: "throttled", retryAfterSeconds: retrySeconds(retryAfterSeconds) };
  }
  if (status >= 500) return { kind: "network" };
  return { kind: "invalid" };
}
