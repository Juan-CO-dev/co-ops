/**
 * The one client sign-out request — audit W06/B012 fix round 6.
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
 */

/** Waits between attempts (ms): four attempts at most, settled within about 3.5 s plus the requests themselves. */
export const LOGOUT_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000];
/** One attempt that has not answered by then is a failed attempt (a hung request must not hold the page). */
export const LOGOUT_ATTEMPT_TIMEOUT_MS = 5000;

export interface SignOutResult {
  /** The server acknowledged the end (a 2xx). False = unconfirmed after every attempt; the server's idle limit ends it. */
  ended: boolean;
  attempts: number;
}

function logoutInit(sessionId: string, signal: AbortSignal): RequestInit {
  return {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
    signal,
  };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function attempt(sessionId: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGOUT_ATTEMPT_TIMEOUT_MS);
  try {
    return await fetch("/api/auth/logout", logoutInit(sessionId, controller.signal));
  } catch {
    return null; // network failure or timeout: not ended
  } finally {
    clearTimeout(timer);
  }
}

/**
 * End the session this page was served for, retrying an unacknowledged end a few times. Never throws. Every attempt
 * names `sessionId`; the decision reads only the status, never a response body.
 */
export async function requestSignOut(sessionId: string): Promise<SignOutResult> {
  for (let i = 0; ; i++) {
    const res = await attempt(sessionId);
    if (res && res.status >= 200 && res.status < 300) return { ended: true, attempts: i + 1 };
    const delay = LOGOUT_RETRY_DELAYS_MS[i];
    if (delay === undefined) return { ended: false, attempts: i + 1 };
    await wait(delay);
  }
}
