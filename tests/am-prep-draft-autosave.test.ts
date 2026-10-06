/**
 * Unit spine — the AM prep draft AUTOSAVE logic (PR #383 review rounds 1 + 2).
 *
 * `AmPrepDraftAutosaver` (lib/am-prep-draft-autosave.ts) is the framework-free core of the
 * hook. Pinned here:
 *   - per-line EDIT STAMPS: pending = local stamp newer than the acknowledged stamp (never a
 *     value comparison), so a revert is a new edit and is re-sent;
 *   - the acknowledged stamps advance only on a successful fetch response, per line, only
 *     forward; a beacon (queued is not saved) never advances them, and pending lines are
 *     re-sent when the page becomes visible again;
 *   - with the server's max-stamp merge (the TS mirror), a LATE beacon after a newer
 *     acknowledged fetch loses;
 *   - DISPOSED: after unmount, an in-flight fetch that fails schedules nothing.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  AmPrepDraftAutosaver,
  acknowledgeAmPrepDraftStamps,
  type AmPrepDraftAutosaveDeps,
  type AmPrepDraftSaveStatus,
} from "@/lib/am-prep-draft-autosave";
import {
  mergeAmPrepDraftItems,
  resetAmPrepDraftTabClockForTests,
  type AmPrepDraftItem,
} from "@/lib/am-prep-draft-shared";

const INSTANCE = "33333333-3333-4333-8333-333333333333";
const L1 = "55555555-5555-4555-8555-555555555555";
const L2 = "66666666-6666-4666-8666-666666666666";

type Items = Record<string, AmPrepDraftItem>;

function harness(serverItems: Items = {}, startAt = 1_000) {
  const posts: Array<Items> = [];
  const beacons: Array<Items> = [];
  const statuses: AmPrepDraftSaveStatus[] = [];
  const resolvers: Array<(v: { ok: boolean; status: number }) => void> = [];
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const clock = { t: startAt };
  const itemsOf = (body: string) => (JSON.parse(body) as { draft: { items: Items } }).draft.items;
  const deps: AmPrepDraftAutosaveDeps = {
    post: (body) => {
      posts.push(itemsOf(body));
      return new Promise((resolve) => resolvers.push(resolve));
    },
    beacon: (body) => {
      beacons.push(itemsOf(body));
      return true; // QUEUED — which says nothing about whether it ever lands
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
    now: () => clock.t,
  };
  const saver = new AmPrepDraftAutosaver(deps, INSTANCE, serverItems);
  return {
    saver,
    posts,
    beacons,
    statuses,
    clock,
    timers,
    liveTimers: () => timers.filter((t) => t.live),
    respond: (status: number) => {
      const r = resolvers.shift();
      if (!r) throw new Error("no pending POST");
      r({ ok: status >= 200 && status < 300, status });
    },
    pendingPosts: () => resolvers.length,
    fireTimers: () => {
      for (const t of timers.splice(0)) if (t.live) t.fn();
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// The tab clock is module state (one per JS context, round 3); each test starts a fresh "tab".
beforeEach(() => resetAmPrepDraftTabClockForTests());

describe("stamps and the acknowledged baseline", () => {
  it("a page load that hydrates from the draft posts nothing", () => {
    const h = harness({ [L1]: { onHand: "4", editedAt: 500 } });
    h.saver.update({ [L1]: { onHand: "4" } });
    expect(h.liveTimers()).toEqual([]);
    expect(h.saver.pending()).toEqual({});
  });

  it("an edit gets a stamp, debounces ~1 s, and only the 2xx acknowledges it", async () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "4" } });
    expect(h.timers[0]?.ms).toBe(1000);
    h.fireTimers();
    expect(h.posts[0]).toEqual({ [L1]: { onHand: "4", editedAt: 1000 } });
    expect(h.saver.acknowledged()).toEqual({}); // in flight: NOT acknowledged yet
    h.respond(200);
    await tick();
    expect(h.saver.acknowledged()).toEqual({ [L1]: 1000 });
    expect(h.saver.pending()).toEqual({});
    expect(h.statuses).toEqual(["saving", "saved"]);
  });

  it("a cleared line goes out as a stamped blank line", () => {
    const h = harness({ [L1]: { onHand: "4", editedAt: 500 } });
    h.saver.update({});
    expect(h.saver.pending()).toEqual({ [L1]: { editedAt: 1000 } });
  });

  it("a failed fetch leaves the line pending and retries on a backoff", async () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "4" } });
    h.fireTimers();
    h.respond(503);
    await tick();
    expect(h.saver.pending()).toEqual({ [L1]: { onHand: "4", editedAt: 1000 } });
    expect(h.statuses.at(-1)).toBe("retrying");
    expect(h.liveTimers().at(-1)?.ms).toBe(2000);
  });

  it("acknowledgements only move a line's stamp forward", () => {
    const acked = { [L1]: 50 };
    expect(acknowledgeAmPrepDraftStamps(acked, { [L1]: { onHand: "3", editedAt: 40 } })).toEqual({ [L1]: 50 });
    expect(acknowledgeAmPrepDraftStamps(acked, { [L1]: { onHand: "6", editedAt: 60 }, [L2]: { editedAt: 7 } }))
      .toEqual({ [L1]: 60, [L2]: 7 });
  });
});

describe("beacons are best-effort: they never acknowledge, and visible re-sends", () => {
  it("hidden → beacon of the pending lines WITH stamps; nothing is acknowledged", () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "4" } });
    h.saver.onHidden();
    expect(h.beacons[0]).toEqual({ [L1]: { onHand: "4", editedAt: 1000 } });
    expect(h.saver.acknowledged()).toEqual({});
    expect(Object.keys(h.saver.pending())).toEqual([L1]);
  });

  it("a queued-but-LOST beacon is re-sent by fetch when the page becomes visible", async () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "4" }, [L2]: { line: "2" } });
    h.saver.onHidden();
    h.saver.onVisible();
    expect(h.posts[0]).toEqual({ [L1]: { onHand: "4", editedAt: 1000 }, [L2]: { line: "2", editedAt: 1001 } });
    h.respond(200);
    await tick();
    expect(h.saver.pending()).toEqual({});
  });

  it("a LATE beacon after a newer acknowledged fetch loses on the server (max-stamp merge)", async () => {
    const h = harness();
    let server: Items = {};
    h.saver.update({ [L1]: { onHand: "3" } }); // stamp 1000
    h.saver.onHidden(); // beacon(3 @1000) queued, still in the network
    h.clock.t = 2000;
    h.saver.update({ [L1]: { onHand: "5" } }); // stamp 2000
    h.saver.onVisible();
    server = mergeAmPrepDraftItems(server, h.posts[0]!); // fetch(5 @2000) lands…
    h.respond(200);
    await tick();
    server = mergeAmPrepDraftItems(server, h.beacons[0]!); // …then the beacon arrives late
    expect(server).toEqual({ [L1]: { onHand: "5", editedAt: 2000 } });
    expect(h.saver.acknowledged()).toEqual({ [L1]: 2000 });
  });

  it("a REVERT after a beacon is re-sent even though it equals the acknowledged value", async () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "4" } }); // @1000
    h.fireTimers();
    h.respond(200);
    await tick();
    expect(h.saver.acknowledged()).toEqual({ [L1]: 1000 });
    h.clock.t = 2000;
    h.saver.update({ [L1]: { onHand: "5" } }); // @2000
    h.saver.onHidden(); // beacon(5) — may have landed on the server
    h.clock.t = 3000;
    h.saver.update({ [L1]: { onHand: "4" } }); // revert to the acknowledged VALUE, new stamp @3000
    expect(h.saver.pending()).toEqual({ [L1]: { onHand: "4", editedAt: 3000 } });
    h.saver.onVisible();
    expect(h.posts.at(-1)).toEqual({ [L1]: { onHand: "4", editedAt: 3000 } });
    // And it beats the beaconed 5 on the server, in either arrival order.
    const viaBeaconFirst = mergeAmPrepDraftItems(mergeAmPrepDraftItems({}, h.beacons[0]!), h.posts.at(-1)!);
    const viaFetchFirst = mergeAmPrepDraftItems(mergeAmPrepDraftItems({}, h.posts.at(-1)!), h.beacons[0]!);
    expect(viaBeaconFirst).toEqual({ [L1]: { onHand: "4", editedAt: 3000 } });
    expect(viaFetchFirst).toEqual({ [L1]: { onHand: "4", editedAt: 3000 } });
  });

  it("two tabs on the same line: the higher stamp wins on the server", () => {
    const a = harness({}, 1_000);
    const b = harness({}, 1_500);
    a.saver.update({ [L1]: { onHand: "3" } });
    b.saver.update({ [L1]: { onHand: "8" } });
    a.saver.onHidden();
    b.saver.onHidden();
    const server1 = mergeAmPrepDraftItems(mergeAmPrepDraftItems({}, b.beacons[0]!), a.beacons[0]!);
    const server2 = mergeAmPrepDraftItems(mergeAmPrepDraftItems({}, a.beacons[0]!), b.beacons[0]!);
    expect(server1).toEqual({ [L1]: { onHand: "8", editedAt: 1500 } });
    expect(server2).toEqual(server1);
  });
});

describe("single-flight", () => {
  it("an edit during a save goes out after it with its own newer stamp", async () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "3" } }); // @1000
    h.fireTimers();
    h.clock.t = 1500;
    h.saver.update({ [L1]: { onHand: "5" } }); // @1500
    void h.saver.flush();
    expect(h.pendingPosts()).toBe(1); // no overlapping POST
    h.respond(200);
    await tick();
    expect(h.saver.acknowledged()).toEqual({ [L1]: 1000 });
    h.fireTimers();
    expect(h.posts[1]).toEqual({ [L1]: { onHand: "5", editedAt: 1500 } });
    h.respond(200);
    await tick();
    expect(h.saver.acknowledged()).toEqual({ [L1]: 1500 });
    expect(h.saver.pending()).toEqual({});
  });
});

describe("disposed (unmount) — one final beacon, then nothing", () => {
  it("fetch in flight, dispose, fetch returns 401 → NO retry timer is scheduled", async () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "4" } });
    h.fireTimers();
    expect(h.pendingPosts()).toBe(1);
    h.saver.dispose();
    expect(h.beacons).toHaveLength(1); // the single final unmount beacon
    h.respond(401);
    await tick();
    expect(h.liveTimers()).toEqual([]);
    expect(h.timers).toEqual([]);
    expect(h.statuses).not.toContain("retrying");
  });

  it("after dispose: no new fetch, no further beacon, edits are ignored", async () => {
    const h = harness();
    h.saver.update({ [L1]: { onHand: "4" } });
    h.saver.dispose();
    h.saver.dispose();
    h.saver.update({ [L1]: { onHand: "9" } });
    h.saver.onHidden();
    h.saver.onVisible();
    await h.saver.flush();
    expect(h.posts).toEqual([]);
    expect(h.beacons).toHaveLength(1);
    expect(h.liveTimers()).toEqual([]);
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
    expect(h.liveTimers()).toEqual([]);
  });
});

describe("the TAB clock outlives a saver (round 3)", () => {
  it("remount with a backwards clock: the new saver's edit still beats the old saver's late dispose-beacon", async () => {
    const first = harness({}, 5_000);
    first.saver.update({ [L1]: { onHand: "3" } }); // @5000
    first.saver.dispose(); // final beacon(3 @5000), still in the network
    const lateBeacon = first.beacons[0]!;
    expect(lateBeacon).toEqual({ [L1]: { onHand: "3", editedAt: 5000 } });

    const second = harness({}, 3_000); // same tab, new mount, wall clock stepped BACK
    second.saver.update({ [L1]: { onHand: "7" } });
    const sent = second.saver.pending();
    expect(sent[L1]!.editedAt).toBeGreaterThan(5000); // 5001: the tab clock, not the wall clock
    second.fireTimers();
    second.respond(200);
    await tick();
    const server = mergeAmPrepDraftItems(mergeAmPrepDraftItems({}, second.posts[0]!), lateBeacon);
    expect(server).toEqual({ [L1]: { onHand: "7", editedAt: 5001 } });
  });

  it("a restored draft with a HIGHER stamp, then an edit: the edit is pending, sent, and wins", async () => {
    // Another device (clock ahead) saved L1 @9000; this tab's wall clock reads 1000.
    const restored = { [L1]: { onHand: "4", editedAt: 9_000 } };
    const h = harness(restored, 1_000);
    h.saver.update({ [L1]: { onHand: "4" } }); // hydration: no edit, nothing pending
    expect(h.saver.pending()).toEqual({});
    h.saver.update({ [L1]: { onHand: "6" } });
    expect(h.saver.pending()).toEqual({ [L1]: { onHand: "6", editedAt: 9_001 } });
    h.fireTimers();
    expect(h.posts[0]).toEqual({ [L1]: { onHand: "6", editedAt: 9_001 } });
    h.respond(200);
    await tick();
    expect(mergeAmPrepDraftItems(restored, h.posts[0]!)).toEqual({ [L1]: { onHand: "6", editedAt: 9_001 } });
    expect(h.saver.pending()).toEqual({});
  });

  it("the tab clock carries across savers: a later saver stamps above an earlier acknowledged edit", async () => {
    const a = harness({}, 2_000);
    a.saver.update({ [L1]: { onHand: "1" } });
    a.fireTimers();
    a.respond(200);
    await tick();
    const b = harness({}, 100);
    b.saver.update({ [L2]: { line: "2" } });
    expect(b.saver.pending()[L2]!.editedAt).toBe(2_001);
  });
});
