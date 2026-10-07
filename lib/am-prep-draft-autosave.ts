/**
 * AmPrepDraftAutosaver — the AM prep draft autosave LOGIC, framework-free so it is testable
 * in node (no DOM, no React). `components/prep/useAmPrepDraftAutosave.ts` is a thin hook
 * around it that wires the browser (fetch, sendBeacon, timers, visibility events).
 *
 * PER-LINE EDIT STAMPS (review round 2, PR #383 — CC's ruling). Every time a line's value
 * changes in this tab it gets a new `editedAt` from the TAB clock (module state in
 * lib/am-prep-draft-shared.ts, shared by every saver in this JS context — round 3), which
 * the saver first advances past every restored and acknowledged stamp. The server merge keeps, per line, the entry with the
 * greater stamp, so DELIVERY ORDER NO LONGER MATTERS: a beacon that lands late, after a
 * newer acknowledged fetch, carries an older stamp and loses.
 *
 * PENDING is a STAMP comparison, never a value comparison: a line is pending while its
 * latest local stamp is newer than the stamp the server has ACKNOWLEDGED for it. A revert
 * to an old value is a new edit with a new stamp, so it is sent even when it equals what
 * was last acknowledged (the server may hold a newer beaconed value).
 *
 * THE ACKNOWLEDGED STAMPS advance only on a successful fetch response, per line, only
 * forward (max). A `sendBeacon` returning true means "queued", not "saved": beacons send
 * the pending lines with their stamps and NEVER advance the acknowledgement. When the page
 * becomes visible again, every pending line is re-sent.
 *
 * DISPOSED (round 2, item 2). After `dispose()` (unmount) the saver sends exactly one final
 * beacon and then nothing: an in-flight fetch that fails afterwards schedules no retry, and
 * no new fetch starts — a dead form must never write over a newly mounted one.
 *
 * V1 LIMIT: two devices editing the SAME line resolve by stamp (wall clock). Stated in
 * lib/am-prep-draft-shared.ts and in the PR log.
 *
 * Client-safe: zero I/O of its own, no server imports.
 */

import {
  AM_PREP_DRAFT_DEBOUNCE_MS,
  AM_PREP_DRAFT_VERSION,
  amPrepDraftRetryDelayMs,
  amPrepDraftStampOf,
  createAmPrepDraftStamper,
  observeAmPrepDraftStamp,
  isRetryableAmPrepDraftFailure,
  normalizeAmPrepDraftItem,
  normalizeAmPrepDraftItems,
  type AmPrepDraftItem,
} from "./am-prep-draft-shared";

export type AmPrepDraftSaveStatus = "idle" | "saving" | "saved" | "retrying" | "failed";

type Items = Record<string, AmPrepDraftItem>;

/**
 * Advance the acknowledged stamps for the lines a successful save carried — per line, only
 * forward. An older acknowledgement can never lower a newer one.
 */
export function acknowledgeAmPrepDraftStamps(
  acked: Record<string, number>,
  sent: Items,
): Record<string, number> {
  const next = { ...acked };
  for (const [key, item] of Object.entries(sent)) {
    const stamp = amPrepDraftStampOf(item);
    if (stamp > (next[key] ?? 0)) next[key] = stamp;
  }
  return next;
}

export interface AmPrepDraftAutosaveDeps {
  /** POST the JSON body; resolve with the HTTP status, reject on a network failure/abort. */
  post: (body: string) => Promise<{ ok: boolean; status: number }>;
  /** Queue a best-effort beacon; true = queued (NOT saved). */
  beacon: (body: string) => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  onStatus: (status: AmPrepDraftSaveStatus) => void;
  /** Wall clock for the stamper (injectable for tests). */
  now?: () => number;
}

export class AmPrepDraftAutosaver {
  /** Latest normalized VALUE per line (no stamps). */
  private values: Items;
  /** Latest local stamp per line. */
  private stamps: Record<string, number>;
  /** Stamp the server has acknowledged per line (fetch responses only). */
  private acked: Record<string, number>;
  private readonly stamp: () => number;
  private inFlight = false;
  private again = false;
  private attempt = 0;
  private timer: unknown = null;
  private enabled = true;
  private disposed = false;

  constructor(
    private readonly deps: AmPrepDraftAutosaveDeps,
    private readonly instanceId: string,
    serverItems: Items,
  ) {
    this.stamp = createAmPrepDraftStamper(deps.now);
    this.values = {};
    this.stamps = {};
    for (const [key, item] of Object.entries(serverItems)) {
      const value = normalizeAmPrepDraftItem(item);
      if (Object.keys(value).length > 0) this.values[key] = value;
      this.stamps[key] = amPrepDraftStampOf(item);
      // Round 3: the TAB clock must run ahead of every restored stamp before any edit is
      // stamped, or an edit could be stamped below a restored line and never count.
      observeAmPrepDraftStamp(this.stamps[key]);
    }
    // What the page loaded is, by definition, what the server holds.
    this.acked = { ...this.stamps };
  }

  /** Lines not yet acknowledged, each with its value (blank = no fields) and its stamp. */
  pending(): Items {
    const out: Items = {};
    for (const key of Object.keys(this.stamps).sort()) {
      const stamp = this.stamps[key]!;
      if (stamp > (this.acked[key] ?? 0)) {
        out[key] = { ...(this.values[key] ?? {}), editedAt: stamp };
      }
    }
    return out;
  }

  /** Acknowledged stamps (for tests and diagnostics). */
  acknowledged(): Record<string, number> {
    return { ...this.acked };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancelTimer();
  }

  /** The form changed: stamp every line whose value changed, then (re)start the debounce. */
  update(rawValues: Items): void {
    if (this.disposed) return;
    const next = normalizeAmPrepDraftItems(rawValues);
    const keys = new Set([...Object.keys(this.values), ...Object.keys(next)]);
    let changed = false;
    for (const key of [...keys].sort()) {
      const before = JSON.stringify(this.values[key] ?? {});
      const after = JSON.stringify(next[key] ?? {});
      if (before !== after) {
        this.stamps[key] = this.stamp();
        changed = true;
      }
    }
    this.values = next;
    if (!changed || !this.enabled) return;
    this.schedule(AM_PREP_DRAFT_DEBOUNCE_MS);
  }

  /** Save now (debounce timer, blur, page visible again). Single-flight. */
  async flush(): Promise<void> {
    this.cancelTimer();
    if (!this.enabled || this.disposed) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    const patch = this.pending();
    if (Object.keys(patch).length === 0) return;

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
      // Acknowledge even after dispose: it is a fact about the server, and harmless.
      this.acked = acknowledgeAmPrepDraftStamps(this.acked, patch);
      for (const item of Object.values(patch)) observeAmPrepDraftStamp(amPrepDraftStampOf(item));
      this.attempt = 0;
      if (this.disposed) return;
      this.deps.onStatus("saved");
      const more = this.again || Object.keys(this.pending()).length > 0;
      this.again = false;
      if (this.enabled && more) this.schedule(AM_PREP_DRAFT_DEBOUNCE_MS);
      return;
    }
    this.again = false;
    if (!this.enabled || this.disposed) return;
    if (isRetryableAmPrepDraftFailure(status)) {
      this.attempt += 1;
      this.deps.onStatus("retrying");
      this.schedule(amPrepDraftRetryDelayMs(this.attempt));
    } else {
      this.attempt = 0;
      this.deps.onStatus("failed");
    }
  }

  /** Tab hidden / pagehide: best-effort beacon of the pending lines. NEVER acknowledges. */
  onHidden(): void {
    if (this.disposed) return;
    this.sendBeacon();
  }

  /** Visible again: re-send every pending line. */
  onVisible(): void {
    if (!this.enabled || this.disposed) return;
    if (Object.keys(this.pending()).length === 0) return;
    void this.flush();
  }

  /** Unmount: stop everything, then ONE final beacon of whatever is pending. */
  dispose(): void {
    if (this.disposed) return;
    this.cancelTimer();
    this.sendBeacon();
    this.disposed = true;
  }

  private sendBeacon(): void {
    if (!this.enabled) return;
    const patch = this.pending();
    if (Object.keys(patch).length === 0) return;
    this.deps.beacon(this.body(patch));
  }

  private body(patch: Items): string {
    return JSON.stringify({
      instanceId: this.instanceId,
      draft: { version: AM_PREP_DRAFT_VERSION, items: patch },
    });
  }

  private schedule(ms: number): void {
    if (this.disposed) return;
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
