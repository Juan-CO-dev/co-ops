/**
 * The one client sign-out request — audit W06/B012 fix rounds 6 + 7.
 *
 * POST /api/auth/logout answers 200 only when the end of the session is CONFIRMED (or there is nothing to end). When
 * the server cannot confirm it (a database blip) it answers 503 `logout_unconfirmed` and clears this browser's cookie
 * — fail closed. Anything that is not a 2xx (that 503, a gateway error, a network failure, a hung request) is
 * NOT-YET-ENDED: this helper retries a few times with short, bounded backoff while the caller is still on the page, and
 * then reports whether the end was ever acknowledged. The caller ALWAYS goes to the sign-in page afterwards and shows
 * no authenticated screen in the meantime (components/auth/SigningOutOverlay).
 *
 * Every attempt and every retry names the session it means to end (round 7): `sessionId` is REQUIRED and every caller
 * passes the session its page was served for. A retry landing after a sign-in in another tab finds a different session
 * on the cookie and leaves it alone (`session_superseded`). There is no unnamed sign-out — an unnamed retry after a
 * network failure or a 504 (nothing named by a 503 body) used to revoke whatever session the cookie carried by then.
 *
 * Round 9: every sign-out SURFACE (LogoutButton, the UserMenu's Sign out, the idle sign-out and "Log out now") goes
 * through signOutAndBroadcast below, which also tells the other tabs once the request has settled. The plain buttons
 * used to skip that signal, so a second tab of the same session kept the signed-out person's page open.
 */

import { fetchStatusWithin } from "@/lib/bounded-fetch";

/** Waits between attempts (ms): four attempts at most, settled within about 3.5 s plus the requests themselves. */
export const LOGOUT_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000];
/** One attempt that has not answered by then is a failed attempt (a hung request must not hold the page). */
export const LOGOUT_ATTEMPT_TIMEOUT_MS = 5000;

export interface SignOutResult {
  /** The server acknowledged the end (a 2xx). False = unconfirmed after every attempt; the server's idle limit ends it. */
  ended: boolean;
  attempts: number;
}

function logoutInit(sessionId: string): Omit<RequestInit, "signal"> {
  return {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One attempt, decided by the STATUS alone (round 7): fetch() resolves when the headers arrive, and no body is ever
 * read — a body that stalls on a poor connection can no longer hold the sign-out past this attempt's deadline. The
 * request (its body stream included) is aborted as soon as the attempt is decided, so nothing of it outlives it.
 * Null = no status: a network failure, or no headers before the deadline. Round 8: the deadline holds even for a
 * request that ignores its abort signal (lib/bounded-fetch.ts races it), so an attempt can never outlive it.
 */
async function attempt(sessionId: string): Promise<number | null> {
  const res = await fetchStatusWithin("/api/auth/logout", logoutInit(sessionId), LOGOUT_ATTEMPT_TIMEOUT_MS);
  return res === null ? null : res.status; // null: network failure or timeout, not ended
}

/**
 * End the session this page was served for, retrying an unacknowledged end a few times. Never throws. Every attempt
 * names `sessionId`; the decision reads only the status, never a response body.
 */
export async function requestSignOut(sessionId: string): Promise<SignOutResult> {
  for (let i = 0; ; i++) {
    const status = await attempt(sessionId);
    if (status !== null && status >= 200 && status < 300) return { ended: true, attempts: i + 1 };
    const delay = LOGOUT_RETRY_DELAYS_MS[i];
    if (delay === undefined) return { ended: false, attempts: i + 1 };
    await wait(delay);
  }
}

// ── The cross-tab sign-out signal (round 9: one place for every sign-out surface) ───────────────────────────────────

/** localStorage key of the cross-tab sign-out signal; every open tab's IdleTimeoutWarning listens for it. */
export const SIGNED_OUT_KEY = "co_ops_signed_out";

/** Why the session ended: `idle` sends the other tabs to the idle sign-in page, `logout` to the plain one. */
export type SignOutKind = "idle" | "logout";

/** The signal: `<ms>:<idle|logout>:<session id>` — it names the session that ended (round 5). */
export function signedOutSignal(kind: SignOutKind, sessionId: string): string {
  return `${Date.now()}:${kind}:${sessionId}`;
}

/** Parse a signal; one written before round 5 names no session and applies to every tab. */
export function parseSignedOutSignal(value: string): { kind: string; sessionId: string | null } {
  const [, kind = "", sessionId = ""] = value.split(":");
  return { kind, sessionId: sessionId || null };
}

/**
 * THE sign-out, for every surface (round 9): end the session this page was served for (requestSignOut — bounded
 * retries, every attempt naming `sessionId`), THEN tell the other tabs with the session-qualified signal. The signal is
 * published only once the request has SETTLED (round 4: told earlier, another tab reached the login page mid-logout and
 * a sign-in there could meet the old request), and it is published whether or not the end was confirmed — the page is
 * leaving either way, and so must every other tab of that session. A tab of a NEWER session ignores it (it names the
 * old session). Storage blocked (private mode) = no signal; the other tabs meet the dead session on their next request.
 * Never throws. The caller navigates afterwards.
 */
export async function signOutAndBroadcast(sessionId: string, kind: SignOutKind): Promise<SignOutResult> {
  const result = await requestSignOut(sessionId);
  try {
    window.localStorage.setItem(SIGNED_OUT_KEY, signedOutSignal(kind, sessionId));
  } catch {
    // Storage blocked — nothing to tell; the other tabs' next request finds the session ended.
  }
  return result;
}
