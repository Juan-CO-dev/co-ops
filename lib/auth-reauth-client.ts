/**
 * Re-check throttle — the client half (audit wave W07 / B159). Zero server imports: safe in any client component.
 *
 * When five password / PIN re-checks in a row are wrong, the server signs the SESSION out and answers
 * 401 `reauth_locked` with the cookie cleared (lib/auth-reauth.ts). The screen that asked shows
 * `auth.reauth.signed_out`, then calls `leaveAfterReauthLock()` to land on the sign-in page — the account
 * itself is not locked, so the person can sign straight back in.
 */

/** The code the server answers with (the twin of lib/auth-reauth.ts REAUTH_LOCKED_CODE; pinned equal by a test). */
export const REAUTH_LOCKED_CODE = "reauth_locked";

/** Long enough to read the one-line message, short enough that nobody keeps typing into a dead session. */
export const REAUTH_LEAVE_DELAY_MS = 2500;

/** Go to the sign-in page after the message has had a moment on screen. No-op outside a browser. */
export function leaveAfterReauthLock(delayMs: number = REAUTH_LEAVE_DELAY_MS): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => window.location.assign("/"), delayMs);
}
