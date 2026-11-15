/**
 * Client requests with a hard deadline — audit W06 fix round 8.
 *
 * A request that never answers must never hold a guard, a cover or a button forever (the stalled heartbeat that
 * blocked every later keep-alive, review W06-r8). `withDeadline` runs one request — the fetch AND whatever the caller
 * reads from the response — under ONE deadline:
 *   - the AbortSignal it hands the caller aborts at the deadline (a real fetch then rejects, and an unread or
 *     half-read body stream is released);
 *   - the returned promise settles at the deadline EVEN IF the request ignores its signal (it races a timer), with
 *     a `DeadlineExceeded` rejection;
 *   - the request is aborted as soon as it is decided (in `finally`), so nothing of it outlives the caller's decision.
 * `fetchStatusWithin` is the status-only form: the decision reads the status and the response type (an
 * `opaqueredirect` under `redirect: "manual"` is the proxy's 307), never a body; null = no status by the deadline or
 * a network failure. Neither ever hangs; `fetchStatusWithin` never throws.
 */

export class DeadlineExceeded extends Error {
  constructor(ms: number) {
    super(`No answer within ${ms} ms`);
    this.name = "DeadlineExceeded";
  }
}

/** Run `run(signal)` under a deadline of `ms`. Rejects with DeadlineExceeded at the deadline, whatever `run` does. */
export async function withDeadline<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new DeadlineExceeded(ms)); // first, so the race reports the deadline rather than the abort it causes
      controller.abort();
    }, ms);
  });
  const work = run(controller.signal);
  work.catch(() => {}); // a rejection after the deadline already decided is not unhandled
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    controller.abort(); // release an unread (possibly stalled) body; a no-op once the response is complete
  }
}

export interface RequestStatus {
  status: number;
  type: ResponseType;
}

/** One request decided by its status alone, within `ms`. Null = a network failure or no headers by the deadline. */
export async function fetchStatusWithin(
  input: string,
  init: Omit<RequestInit, "signal">,
  ms: number,
): Promise<RequestStatus | null> {
  try {
    return await withDeadline(ms, async (signal) => {
      const res = await fetch(input, { ...init, signal });
      return { status: res.status, type: res.type };
    });
  } catch {
    return null;
  }
}
