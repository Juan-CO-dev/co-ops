/**
 * The build page's cart-save queue (zero I/O of its own; client-safe). Audit W01/B033: cart edits are
 * saved on a 400 ms debounce, and tapping Continue inside that window navigated away and DROPPED the
 * pending save — the review page then showed (and submit froze) the older cart.
 *
 *   schedule(body) — remember the newest payload and (re)start the debounce.
 *   flush()        — cancel the debounce, wait for any save already in flight, then send whatever is
 *                    pending, and keep going until no edit is left (an edit made DURING the flush is
 *                    saved too); resolves with the outcome of the LAST save. The caller navigates only
 *                    on "ok".
 *   drainOnUnmount(send) — the page is unmounting: cancel the debounce and send the unsent edit with
 *                    `send` (a keepalive request) AFTER any save already in flight, never beside it
 *                    (audit W01-r2: an unmount send beside an in-flight older save could reach the
 *                    database first and then be overwritten by that older save).
 *   takePending()  — hand back an unsent payload (no send).
 *
 * Sends are serialized: the newest payload is always the last one SENT. The server enforces the same
 * order on arrival with the edit revision each payload carries (`CartRevision`, below): a save older
 * than one it already stored is answered `stale` and writes nothing. A save that failed for a
 * transient reason is put back as pending (unless a newer edit replaced it), so the next flush retries
 * it instead of reporting the stale failure forever.
 */
export type CartSaveOutcome = "ok" | "unauthorized" | "not_draft" | "failed";

export interface CartSaveQueue {
  schedule(body: string): void;
  flush(): Promise<CartSaveOutcome>;
  drainOnUnmount(send: (body: string) => Promise<CartSaveOutcome>): Promise<CartSaveOutcome>;
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
  const run = (send: (body: string) => Promise<CartSaveOutcome> = opts.send): Promise<CartSaveOutcome> => {
    tail = tail.then(async () => {
      const body = pending;
      if (body === null) return last;
      pending = null;
      let outcome: CartSaveOutcome;
      try {
        outcome = await send(body);
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
    async flush() {
      // Drain through the LATEST revision (audit W01/B033 r1): an edit made while this flush is saving
      // is sent too before the flush resolves — the caller navigates only when nothing is left unsaved.
      // A non-ok outcome stops the drain and is reported (a failed edit stays pending for the retry).
      let outcome: CartSaveOutcome;
      do {
        cancelTimer();
        outcome = await run();
      } while (outcome === "ok" && pending !== null);
      return outcome;
    },
    drainOnUnmount(send) {
      // Chained on the same tail as every other save: it runs after the save in flight has landed.
      cancelTimer();
      return run(send);
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

// ── The cart edit revision (audit W01-r2) ─────────────────────────────────────────────────────
// Every save carries { epoch, seq }: `epoch` is minted once per build-page load, `seq` grows by one per
// edit. The database writer (0302 portal_draft_set_lines) stores the last revision it wrote and answers
// `stale` — writing nothing — to a save from the SAME epoch whose seq is not newer. Epochs never compare
// with each other (a new page load, or another device, is never frozen out by a clock or a counter).

export interface CartRevision { epoch: string; seq: number }

const EPOCH_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** A request body's `rev`: absent → null (a page cached from before W01-r2 — saved as before), a valid
 *  revision → it, anything else → "invalid" (the route answers 400). */
export function parseCartRevision(raw: unknown): CartRevision | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") return "invalid";
  const { epoch, seq } = raw as Record<string, unknown>;
  if (typeof epoch !== "string" || !EPOCH_RE.test(epoch)) return "invalid";
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) return "invalid";
  return { epoch, seq };
}

/** A fresh epoch for one build-page load. crypto.randomUUID is missing on an insecure origin (a LAN
 *  sim over http), so there is a fallback; uniqueness per draft is all it needs. */
export function newCartRevEpoch(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}
