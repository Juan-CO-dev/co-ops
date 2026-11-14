/**
 * The build page's cart-save queue (zero I/O of its own; client-safe). Audit W01/B033: cart edits are
 * saved on a 400 ms debounce, and tapping Continue inside that window navigated away and DROPPED the
 * pending save — the review page then showed (and submit froze) the older cart.
 *
 *   schedule(body) — remember the newest payload and (re)start the debounce.
 *   flush()        — cancel the debounce, wait for any save already in flight, then send whatever is
 *                    pending; resolves with the outcome of the LAST save. The caller navigates only
 *                    on "ok".
 *   takePending()  — hand back an unsent payload (for a keepalive send when the page unmounts).
 *
 * Sends are serialized: the newest payload is always the last one written. A save that failed for a
 * transient reason is put back as pending (unless a newer edit replaced it), so the next flush retries
 * it instead of reporting the stale failure forever.
 */
export type CartSaveOutcome = "ok" | "unauthorized" | "not_draft" | "failed";

export interface CartSaveQueue {
  schedule(body: string): void;
  flush(): Promise<CartSaveOutcome>;
  takePending(): string | null;
  hasPending(): boolean;
}

export interface CartSaveTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export function createCartSaveQueue(opts: {
  send: (body: string) => Promise<CartSaveOutcome>;
  delayMs: number;
  timers?: CartSaveTimers;
}): CartSaveQueue {
  const timers: CartSaveTimers = opts.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  let pending: string | null = null;
  let timer: unknown = null;
  let last: CartSaveOutcome = "ok";
  let tail: Promise<CartSaveOutcome> = Promise.resolve("ok");

  const cancelTimer = () => {
    if (timer !== null) { timers.clear(timer); timer = null; }
  };
  const run = (): Promise<CartSaveOutcome> => {
    tail = tail.then(async () => {
      const body = pending;
      if (body === null) return last;
      pending = null;
      let outcome: CartSaveOutcome;
      try {
        outcome = await opts.send(body);
      } catch {
        outcome = "failed";
      }
      if (outcome === "failed" && pending === null) pending = body; // retry on the next flush
      last = outcome;
      return outcome;
    });
    return tail;
  };

  return {
    schedule(body) {
      pending = body;
      cancelTimer();
      timer = timers.set(() => { timer = null; void run(); }, opts.delayMs);
    },
    flush() {
      cancelTimer();
      return run();
    },
    takePending() {
      cancelTimer();
      const body = pending;
      pending = null;
      return body;
    },
    hasPending() {
      return pending !== null;
    },
  };
}
