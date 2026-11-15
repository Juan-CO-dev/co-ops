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
 * Every retry names the session it means to end: the caller's own (`sessionId`), else the one a 503 named — so a retry
 * landing after a sign-in in another tab finds a different session on the cookie and leaves it alone (round 5).
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

function logoutInit(sessionId: string | null, signal: AbortSignal): RequestInit {
  return sessionId
    ? {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
        signal,
      }
    : { method: "POST", redirect: "manual", signal };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function attempt(sessionId: string | null): Promise<Response | null> {
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

/** The session a 503 named, if any (the Log out buttons may not know theirs). */
async function namedBy(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "sessionId" in body) {
      const id = (body as { sessionId: unknown }).sessionId;
      return typeof id === "string" && id.length > 0 ? id : null;
    }
  } catch {
    // not JSON
  }
  return null;
}

/** End this browser's session, retrying an unacknowledged end a few times. Never throws. */
export async function requestSignOut(sessionId?: string | null): Promise<SignOutResult> {
  let named = sessionId ?? null;
  for (let i = 0; ; i++) {
    const res = await attempt(named);
    if (res && res.status >= 200 && res.status < 300) return { ended: true, attempts: i + 1 };
    if (res && res.status === 503 && named === null) named = await namedBy(res);
    const delay = LOGOUT_RETRY_DELAYS_MS[i];
    if (delay === undefined) return { ended: false, attempts: i + 1 };
    await wait(delay);
  }
}
