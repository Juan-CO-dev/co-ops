/**
 * Unit spine — the AM prep draft AUTOSAVE logic (review fix, PR #383, item 2).
 *
 * `AmPrepDraftAutosaver` (lib/am-prep-draft-autosave.ts) is the framework-free core of the
 * hook. Pinned here:
 *   - the ACKNOWLEDGED baseline advances only on a successful fetch response;
 *   - a beacon (queued is not saved) never advances it, and a queued-but-lost beacon's lines
 *     are re-sent when the page becomes visible again;
 *   - an older acknowledgement can never overwrite a newer baseline (sequence numbers);
 *   - single-flight: an edit made during a save goes out after it, carrying the newest values.
 */
import { describe, expect, it, vi } from "vitest";

import {
  AmPrepDraftAutosaver,
  acknowledgeAmPrepDraftSave,
  type AmPrepDraftAutosaveDeps,
  type AmPrepDraftSaveStatus,
} from "@/lib/am-prep-draft-autosave";

const INSTANCE = "33333333-3333-4333-8333-333333333333";
const L1 = "55555555-5555-4555-8555-555555555555";
const L2 = "66666666-6666-4666-8666-666666666666";

interface Harness {
  saver: AmPrepDraftAutosaver;
  posts: Array<Record<string, unknown>>;
  beacons: Array<Record<string, unknown>>;
  statuses: AmPrepDraftSaveStatus[];
  /** Resolve the n-th pending POST with this status. */
  respond: (status: number) => void;
  pendingPosts: () => number;
  timers: Array<{ fn: () => void; ms: number; live: boolean }>;
  fireTimers: () => void;
}

function harness(serverItems: Record<string, Record<string, string>> = {}, beaconQueued = true): Harness {
  const posts: Array<Record<string, unknown>> = [];
  const beacons: Array<Record<string, unknown>> = [];
  const statuses: AmPrepDraftSaveStatus[] = [];
  const resolvers: Array<(v: { ok: boolean; status: number }) => void> = [];
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const deps: AmPrepDraftAutosaveDeps = {
    post: (body) => {
      posts.push(JSON.parse(body) as Record<string, unknown>);
      return new Promise((resolve) => resolvers.push(resolve));
    },
    beacon: (body) => {
      beacons.push(JSON.parse(body) as Record<string, unknown>);
      return beaconQueued;
    },
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { live: boolean }).live = false;
    },
    onStatus: (s) => statuses.push(s),
  };
  const saver = new AmPrepDraftAutosaver(deps, INSTANCE, serverItems);
  return {
    saver,
    posts,
    beacons,
    statuses,
    respond: (status) => {
      const r = resolvers.shift();
      if (!r) throw new Error("no pending POST");
      r({ ok: status >= 200 && status < 300, status });
    },
    pendingPosts: () => resolvers.length,
    timers,
    fireTimers: () => {
      for (const t of timers.splice(0)) if (t.live) t.fn();
    },
  };
}

const items = (b: unknown) => ((b as { draft: { items: unknown } }).draft.items);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the acknowledged baseline moves only on a successful fetch", () => {
  it("a page load that hydrates from the draft posts nothing", () => {
    const h = harness({ [L1]: { onHand: "4" } });
    h.saver.update({ [L1]: { onHand: "4" } });
    expect(h.timers.filter((t) => t.live)).toEqual([]);
    expect(h.saver.pending()).toEqual({});
  });

  it("an edit debounces ~1 s, posts the patch, and only the 2xx advances the baseline", async () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "4" } });
    expect(h.timers[0]?.ms).toBe(1000);
    h.fireTimers();
    expect(h.posts).toHaveLength(1);
    expect(items(h.posts[0])).toEqual({ [L1]: { onHand: "4" } });
    expect(h.saver.acknowledged().ackedSeq).toBe(0); // in flight: NOT acknowledged yet
    h.respond(200);
    await tick();
    expect(h.saver.acknowledged()).toEqual({ ackedSeq: 1, acked: { [L1]: { onHand: "4" } } });
    expect(h.statuses).toEqual(["saving", "saved"]);
  });

  it("a failed fetch leaves the line unacknowledged and retries on a backoff", async () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "4" } });
    h.fireTimers();
    h.respond(503);
    await tick();
    expect(h.saver.pending()).toEqual({ [L1]: { onHand: "4" } });
    expect(h.statuses.at(-1)).toBe("retrying");
    expect(h.timers.at(-1)?.ms).toBe(2000);
    h.fireTimers();
    expect(items(h.posts[1])).toEqual({ [L1]: { onHand: "4" } });
  });
});

describe("a beacon is best-effort: queued is not saved", () => {
  it("hidden → beacon of the unacked lines; the baseline does NOT move", () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "4" } });
    h.saver.onHidden();
    expect(h.beacons).toHaveLength(1);
    expect(items(h.beacons[0])).toEqual({ [L1]: { onHand: "4" } });
    expect(h.saver.acknowledged().ackedSeq).toBe(0);
    expect(h.saver.pending()).toEqual({ [L1]: { onHand: "4" } });
  });

  it("a queued-but-LOST beacon is re-sent by fetch when the page becomes visible again", async () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "4" }, [L2]: { line: "2" } });
    h.saver.onHidden(); // queued=true, but the server never got it
    h.saver.onVisible();
    expect(h.posts).toHaveLength(1);
    expect(items(h.posts[0])).toEqual({ [L1]: { onHand: "4" }, [L2]: { line: "2" } });
    h.respond(200);
    await tick();
    expect(h.saver.pending()).toEqual({});
  });

  it("visible with nothing unacknowledged sends nothing", () => {
    const h = harness({ [L1]: { onHand: "4" } });
    h.saver.onVisible();
    expect(h.posts).toEqual([]);
  });

  it("unmount (dispose) beacons the unacked lines and stops the timer", () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "4" } });
    h.saver.dispose();
    expect(h.beacons).toHaveLength(1);
    expect(h.timers.every((t) => !t.live)).toBe(true);
  });
});

describe("sequencing — an older response can never overwrite a newer baseline", () => {
  it("acknowledgeAmPrepDraftSave only moves forward", () => {
    const newer = { ackedSeq: 2, acked: { [L1]: { onHand: "5" } } };
    expect(acknowledgeAmPrepDraftSave(newer, 1, { [L1]: { onHand: "3" } })).toBe(newer);
    expect(acknowledgeAmPrepDraftSave(newer, 3, { [L1]: { onHand: "6" } })).toEqual({ ackedSeq: 3, acked: { [L1]: { onHand: "6" } } });
  });

  it("single-flight: an edit during a save goes out AFTER it, with the newest value; the baseline ends on the newest", async () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "3" } });
    h.fireTimers();
    expect(h.pendingPosts()).toBe(1);
    // Typing continues while the first save is in flight; blur asks to flush now.
    h.saver.update({ [L1]: { onHand: "5" } });
    void h.saver.flush();
    expect(h.pendingPosts()).toBe(1); // no overlapping POST
    h.respond(200);
    await tick();
    expect(h.saver.acknowledged().acked).toEqual({ [L1]: { onHand: "3" } });
    h.fireTimers(); // the follow-up save
    expect(items(h.posts[1])).toEqual({ [L1]: { onHand: "5" } });
    h.respond(200);
    await tick();
    expect(h.saver.acknowledged()).toEqual({ ackedSeq: 2, acked: { [L1]: { onHand: "5" } } });
    expect(h.saver.pending()).toEqual({});
  });

  it("a beacon in between consumes a sequence number, so a later ack still moves forward", async () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "3" } });
    h.saver.onHidden();
    h.saver.onVisible();
    h.respond(200);
    await tick();
    expect(h.saver.acknowledged().ackedSeq).toBe(2);
  });
});

describe("disabled (after submit) does nothing", () => {
  it("no timer, no post, no beacon", () => {
    const h = harness();
    h.saver.setEnabled(false);
    h.saver.update({ [L1]: { onHand: "4" } });
    h.saver.onHidden();
    h.saver.onVisible();
    expect(h.timers).toEqual([]);
    expect(h.posts).toEqual([]);
    expect(h.beacons).toEqual([]);
  });

  it("a verdict (409 submitted) stops retrying", async () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "4" } });
    h.fireTimers();
    h.respond(409);
    await tick();
    expect(h.statuses.at(-1)).toBe("failed");
    expect(h.timers.filter((t) => t.live)).toEqual([]);
    vi.restoreAllMocks();
  });
});
