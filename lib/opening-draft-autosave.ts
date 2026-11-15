/**
 * OpeningDraftAutosaver — the opening Phase 1 draft autosave LOGIC, framework-free so it is
 * testable in node (no DOM, no React). opening-client.tsx wires the browser to it (fetch,
 * sendBeacon, timers, visibility events). Precedent: lib/am-prep-draft-autosave.ts.
 *
 * WHAT IT FIXES (audit W14 / B078). The page used to POST the draft with no ordering and set
 * its "sent" marker to whatever acked LAST. Two debounced POSTs — A slow, B fast — could commit
 * B then A (the database kept the OLDER draft) and ack B then A (the marker said A while the
 * form held B). Nothing re-sent B until the next edit, so the key holder who opened the same
 * opening on another device inherited the older walk.
 *
 * THE REVISION. Every send — fetch or beacon — carries `rev: { tab, seq }`: a random id minted
 * once per page load and a counter that only goes up. `save_opening_phase1_draft` (migration
 * 0315) refuses a request from the SAME tab whose counter is not higher than the stored one and
 * answers `applied: false`. Another tab or device keeps last-write-wins: that cross-device rule
 * is a recorded decision (lib/opening.ts saveOpeningPhase1Draft) and is not changed here.
 *
 * THE MARKER. `sent` is the body this tab believes the server holds. It moves only on a
 * response the server APPLIED whose sequence is higher than every earlier acknowledgement, so
 * an older ack can never pull it back. Requests may overlap; no queue is needed, because the
 * server orders them.
 *
 * THE RE-SEND. After a request settles OK, if the newest body is still not the sent one and
 * nothing in flight or scheduled carries it, it goes out again with the next sequence — that
 * replaces "wait for the next edit", which is what lost B. One more case re-sends: an OLDER
 * request reported `applied: true` after a newer one was acknowledged. On a database without
 * 0315 (or when it simply committed first) the server may now hold the older body; sending
 * the newest once more is cheap and idempotent.
 *
 * NEVER BLOCKS THE OPERATOR, and never loops on failure: a failed save changes the quiet
 * status line and waits for the next edit (or the page-hide beacon), exactly as before.
 *
 * Client-safe: zero I/O of its own, no server imports.
 */

export interface OpeningDraftAutosaveDeps {
  /**
   * POST the JSON body. Resolve `{ ok }` from the HTTP status and `applied` from the answer
   * (`false` only when the server refused an older same-tab request); reject on a network
   * failure.
   */
  post: (body: string) => Promise<{ ok: boolean; applied: boolean }>;
  /** Queue a best-effort beacon; true = queued. */
  beacon: (body: string) => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** The form changed and a save is now pending (the status line's "editing"). */
  onEdit: () => void;
  /** A save started; returns the status revision its outcome must name. */
  onStart: () => number;
  onAck: (revision: number) => void;
  onFail: (revision: number) => void;
}

/** The wire body: the page's `{ instanceId, draft }` payload plus this send's revision. */
export function withDraftRev(payload: string, tab: string, seq: number): string {
  return JSON.stringify({ ...(JSON.parse(payload) as Record<string, unknown>), rev: { tab, seq } });
}

export class OpeningDraftAutosaver {
  /** The newest serialized `{ instanceId, draft }` the form holds. */
  private latest: string | null = null;
  /** The payload this tab believes the server holds. null until the first observe. */
  private sent: string | null = null;
  /** This tab's send counter (fetches and beacons share it). */
  private seq = 0;
  /** The highest sequence whose save was acknowledged as applied (or claimed by a beacon). */
  private ackedSeq = 0;
  private timer: unknown = null;
  private enabled = true;
  private stopped = false;
  private readonly inFlight = new Map<number, string>();

  constructor(
    private readonly deps: OpeningDraftAutosaveDeps,
    private readonly tabId: string,
    private readonly debounceMs: number,
  ) {}

  /** What the server is believed to hold (tests, and the page's "nothing to save" check). */
  sentPayload(): string | null {
    return this.sent;
  }

  /**
   * The form's newest payload. The FIRST one is adopted as already saved, without a POST: the
   * form was just hydrated from the server's draft, so posting it would be a write per page
   * load. A burst of changes is one send, `debounceMs` after the operator stops.
   */
  observe(payload: string): void {
    if (!this.enabled || this.stopped) return;
    this.latest = payload;
    if (this.sent === null) {
      this.sent = payload;
      return;
    }
    this.cancelTimer();
    if (this.sent === payload) return;
    this.deps.onEdit();
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Past Phase 1 the submit RPC owns the truth: stop observing, sending and beaconing. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancelTimer();
  }

  /**
   * The tab is being hidden or unloaded: a fetch would be cancelled, a beacon is queued by the
   * browser and survives. It carries the NEXT sequence, so it can never overwrite a newer save
   * and an older fetch still in flight can never overwrite it. Claimed only on a successful
   * enqueue; a refused beacon leaves the ordinary save pending.
   */
  onHidden(): void {
    if (!this.enabled || this.stopped) return;
    const payload = this.latest;
    if (payload === null || payload === this.sent) return;
    const seq = ++this.seq;
    if (!this.deps.beacon(withDraftRev(payload, this.tabId, seq))) return;
    this.sent = payload;
    this.ackedSeq = seq;
    this.cancelTimer();
  }

  /** The operator tapped Retry on a failed save: send the newest draft now. */
  retry(): void {
    if (!this.enabled || this.stopped) return;
    this.cancelTimer();
    void this.flush(true);
  }

  /** The page is going away: no further send, re-send or status change. */
  stop(): void {
    this.stopped = true;
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private carriedInFlight(payload: string): boolean {
    for (const body of this.inFlight.values()) if (body === payload) return true;
    return false;
  }

  /** `force` = send even though the marker already names this body (the re-send case). */
  private async flush(force = false): Promise<void> {
    if (!this.enabled || this.stopped) return;
    const payload = this.latest;
    if (payload === null || (!force && payload === this.sent)) return;
    const seq = ++this.seq;
    this.inFlight.set(seq, payload);
    const revision = this.deps.onStart();
    let result: { ok: boolean; applied: boolean };
    try {
      result = await this.deps.post(withDraftRev(payload, this.tabId, seq));
    } catch {
      result = { ok: false, applied: false };
    }
    this.inFlight.delete(seq);
    if (this.stopped) return;
    if (!result.ok) {
      // Deliberately quiet: an autosave failure is not an operator error. The marker stays
      // put, so the next edit (or the page-hide beacon) sends the full latest draft.
      this.deps.onFail(revision);
      return;
    }
    let resend = false;
    if (result.applied) {
      if (seq > this.ackedSeq) {
        this.ackedSeq = seq;
        this.sent = payload;
      } else if (payload !== this.sent) {
        // An OLDER request was applied after a newer one was acknowledged: the server may
        // hold this older body now. The marker stays on the newer one; send the newest again.
        resend = true;
      }
    }
    // `applied: false` = the server already holds a newer save from this tab. Nothing to do.
    this.deps.onAck(revision);
    if (!this.enabled) return;
    const newest = this.latest;
    // A pending debounce or a request already carrying the newest body will deliver it.
    if (newest === null || this.timer !== null || this.carriedInFlight(newest)) return;
    if (resend || newest !== this.sent) void this.flush(resend);
  }
}
