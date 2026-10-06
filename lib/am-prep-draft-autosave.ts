/**
 * AmPrepDraftAutosaver — the AM prep draft autosave LOGIC, framework-free so it is testable
 * in node (no DOM, no React). `components/prep/useAmPrepDraftAutosave.ts` is a thin hook
 * around it that wires the browser (fetch, sendBeacon, timers, visibility events).
 *
 * THE ACKNOWLEDGED BASELINE (review fix, PR #383). `acked` is what the server is KNOWN to
 * hold from this client, and it advances ONLY on a successful fetch response:
 *   - a `sendBeacon` returning true means "queued", not "saved" — beacons are best-effort
 *     and NEVER advance the baseline;
 *   - when the page becomes visible again, everything not yet acknowledged is re-sent;
 *   - every send carries a sequence number, and an acknowledgement only moves the baseline
 *     forward (`acknowledgeAmPrepDraftSave`): an older response can never overwrite a newer
 *     baseline.
 * Fetches are single-flight (an edit during a save is sent right after it), so the server
 * applies this client's saves in order; the hook aborts a stalled fetch so one hung request
 * cannot block the queue.
 *
 * What it sends: a PATCH = every line that differs from the acknowledged baseline, with its
 * CURRENT value — so a later send always supersedes an earlier one for every line it covers.
 *
 * Client-safe: zero I/O of its own, no server imports.
 */

import {
  AM_PREP_DRAFT_DEBOUNCE_MS,
  AM_PREP_DRAFT_VERSION,
  amPrepDraftRetryDelayMs,
  diffAmPrepDraftItems,
  isRetryableAmPrepDraftFailure,
  normalizeAmPrepDraftItems,
  type AmPrepDraftItem,
} from "./am-prep-draft-shared";

export type AmPrepDraftSaveStatus = "idle" | "saving" | "saved" | "retrying" | "failed";

type Items = Record<string, AmPrepDraftItem>;

export interface AmPrepDraftAckState {
  /** Sequence number of the send that produced `acked`; 0 = the page-load baseline. */
  ackedSeq: number;
  /** The lines the server is known to hold from this client. */
  acked: Items;
}

/**
 * Advance the acknowledged baseline — only FORWARD. `sent` is the full normalized form
 * state at the moment send `seq` was built (its patch was diff(acked, sent), so once the
 * server applied it, the server holds `sent`). A stale ack (seq <= ackedSeq) is ignored.
 */
export function acknowledgeAmPrepDraftSave(
  state: AmPrepDraftAckState,
  seq: number,
  sent: Items,
): AmPrepDraftAckState {
  if (seq <= state.ackedSeq) return state;
  return { ackedSeq: seq, acked: sent };
}

export interface AmPrepDraftAutosaveDeps {
  /** POST the JSON body; resolve with the HTTP status, reject on a network failure/abort. */
  post: (body: string) => Promise<{ ok: boolean; status: number }>;
  /** Queue a best-effort beacon; true = queued (NOT saved). */
  beacon: (body: string) => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  onStatus: (status: AmPrepDraftSaveStatus) => void;
}

export class AmPrepDraftAutosaver {
  private ack: AmPrepDraftAckState;
  private latest: Items;
  private nextSeq = 0;
  private inFlight = false;
  private again = false;
  private attempt = 0;
  private timer: unknown = null;
  private enabled = true;

  constructor(
    private readonly deps: AmPrepDraftAutosaveDeps,
    private readonly instanceId: string,
    serverItems: Items,
  ) {
    const base = normalizeAmPrepDraftItems(serverItems);
    this.ack = { ackedSeq: 0, acked: base };
    this.latest = base;
  }

  /** Lines not yet acknowledged by the server. */
  pending(): Items {
    return diffAmPrepDraftItems(this.ack.acked, this.latest);
  }

  /** The acknowledged baseline (for tests and diagnostics). */
  acknowledged(): AmPrepDraftAckState {
    return this.ack;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancelTimer();
  }

  /** The form changed: remember it and (re)start the debounce if anything is unacked. */
  update(rawValues: Items): void {
    this.latest = normalizeAmPrepDraftItems(rawValues);
    if (!this.enabled) return;
    if (Object.keys(this.pending()).length === 0) return;
    this.schedule(AM_PREP_DRAFT_DEBOUNCE_MS);
  }

  /** Save now (debounce timer, blur, page visible again). Single-flight. */
  async flush(): Promise<void> {
    this.cancelTimer();
    if (!this.enabled) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    const sent = this.latest;
    const patch = diffAmPrepDraftItems(this.ack.acked, sent);
    if (Object.keys(patch).length === 0) return;

    const seq = ++this.nextSeq;
    this.inFlight = true;
    this.deps.onStatus("saving");
    let status: number | null = null;
    let ok = false;
    try {
      const res = await this.deps.post(this.body(patch));
      // An opaque redirect (status 0) is the proxy bouncing an expired session.
      status = res.status === 0 ? null : res.status;
      ok = res.ok;
    } catch {
      status = null;
    }
    this.inFlight = false;

    if (ok) {
      this.ack = acknowledgeAmPrepDraftSave(this.ack, seq, sent);
      this.attempt = 0;
      this.deps.onStatus("saved");
      const more = this.again || Object.keys(this.pending()).length > 0;
      this.again = false;
      if (this.enabled && more) this.schedule(AM_PREP_DRAFT_DEBOUNCE_MS);
      return;
    }
    this.again = false;
    if (!this.enabled) return;
    if (isRetryableAmPrepDraftFailure(status)) {
      this.attempt += 1;
      this.deps.onStatus("retrying");
      this.schedule(amPrepDraftRetryDelayMs(this.attempt));
    } else {
      this.attempt = 0;
      this.deps.onStatus("failed");
    }
  }

  /** Tab hidden / pagehide / unmount: best-effort beacon. NEVER advances the baseline. */
  onHidden(): void {
    if (!this.enabled) return;
    const patch = this.pending();
    if (Object.keys(patch).length === 0) return;
    this.nextSeq += 1;
    this.deps.beacon(this.body(patch));
  }

  /** Visible again: re-send everything the server has not acknowledged. */
  onVisible(): void {
    if (!this.enabled) return;
    if (Object.keys(this.pending()).length === 0) return;
    void this.flush();
  }

  /** Unmount: stop the timer and hand the browser whatever is unacknowledged. */
  dispose(): void {
    this.cancelTimer();
    this.onHidden();
  }

  private body(patch: Items): string {
    return JSON.stringify({
      instanceId: this.instanceId,
      draft: { version: AM_PREP_DRAFT_VERSION, items: patch },
    });
  }

  private schedule(ms: number): void {
    this.cancelTimer();
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }
}
