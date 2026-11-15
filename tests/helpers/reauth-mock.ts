/**
 * A stand-in for lib/auth-reauth.ts (audit W07 B159) for route tests that are about something else: every
 * re-check is allowed and counted as attempt 1, nothing is revoked. Use it from a hoisted factory:
 *
 *   vi.mock("@/lib/auth-reauth", async () => (await import("./helpers/reauth-mock")).reauthAllowAll());
 *
 * Tests that are ABOUT the throttle (tests/step-up-reauth-throttle.test.ts) mock the module themselves.
 */
export function reauthAllowAll() {
  return {
    REAUTH_LIMIT: 5,
    REAUTH_LOCKED_CODE: "reauth_locked",
    reserveReauth: async () => ({ allowed: true, attempt: 1, degraded: false }),
    clearReauth: async () => undefined,
    reauthFailed: async () => false,
    reauthLockedResponse: () => Response.json({ error: "reauth_locked", code: "reauth_locked" }, { status: 401 }),
  };
}
