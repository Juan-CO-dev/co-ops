/**
 * Audit W14 / B078 — the opening Phase 1 draft autosave, as a framework-free controller
 * (lib/opening-draft-autosave.ts; the AmPrepDraftAutosaver precedent).
 *
 * The page used to POST the draft with no ordering and set its "sent" marker to WHATEVER
 * acked last. Two debounced POSTs, A slow and B fast, could commit B then A (the database kept
 * the OLDER draft) and ack B then A (the marker said A while the form held B). Nothing re-sent
 * B until the next edit, so the newest work was lost on the next device.
 *
 * Now every send carries a per-tab revision (tab id + a counter); the server refuses an older
 * request from the same tab (migration 0315), an older ack can never pull the marker back, and
 * a settled request re-sends when the newest body is still not the sent one.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { OpeningDraftAutosaver, withDraftRev } from "@/lib/opening-draft-autosave";

const TAB = "0b7e5d2c-1111-4222-8333-444455556666";
const body = (n: number) => JSON.stringify({ instanceId: "i", draft: { version: 1, n } });
const seqOf = (sent: string) => (JSON.parse(sent) as { rev: { tab: string; seq: number } }).rev;
const payloadOf = (sent: string) => {
  const { rev: _rev, ...rest } = JSON.parse(sent) as Record<string, unknown>;
  return JSON.stringify(rest);
};
const tick = () => new Promise((r) => setTimeout(r, 0));

function harness() {
  const posts: Array<{ body: string; resolve: (r: { ok: boolean; applied: boolean }) => void; reject: (e: Error) => void }> = [];
  const beacons: string[] = [];
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const events: string[] = [];
  let revision = 0;
  let beaconAccepts = true;
  const saver = new OpeningDraftAutosaver(
    {
      post: (b) => new Promise((resolve, reject) => posts.push({ body: b, resolve, reject })),
      beacon: (b) => { if (beaconAccepts) beacons.push(b); return beaconAccepts; },
      setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
      clearTimer: (h) => { (h as { live: boolean }).live = false; },
      onEdit: () => events.push("edit"),
      onStart: () => { events.push("start"); return ++revision; },
      onAck: (r) => events.push(`ack:${r}`),
      onFail: (r) => events.push(`fail:${r}`),
    },
    TAB,
    800,
  );
  return {
    saver, posts, beacons, timers, events,
    refuseBeacons: () => { beaconAccepts = false; },
    fire: () => { for (const t of timers.splice(0)) if (t.live) t.fn(); },
    live: () => timers.filter((t) => t.live),
  };
}

describe("withDraftRev", () => {
  it("adds the tab and the sequence beside the payload, changing nothing else", () => {
    const sent = withDraftRev(body(1), TAB, 7);
    expect(seqOf(sent)).toEqual({ tab: TAB, seq: 7 });
    expect(payloadOf(sent)).toBe(body(1));
  });
});

describe("OpeningDraftAutosaver — ordering (B078)", () => {
  it("the first observed body is what the server already holds: no POST, no status change", () => {
    const h = harness();
    h.saver.observe(body(0));
    expect(h.timers).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.saver.sentPayload()).toBe(body(0));
  });

  it("a burst of edits is one debounced POST of the newest body, with the next sequence", async () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.saver.observe(body(2));
    expect(h.live().length).toBe(1);
    expect(h.live()[0]?.ms).toBe(800);
    h.fire();
    expect(h.posts.length).toBe(1);
    expect(payloadOf(h.posts[0]!.body)).toBe(body(2));
    expect(seqOf(h.posts[0]!.body)).toEqual({ tab: TAB, seq: 1 });
    h.posts[0]!.resolve({ ok: true, applied: true });
    await tick();
    expect(h.saver.sentPayload()).toBe(body(2));
    expect(h.events).toEqual(["edit", "edit", "start", "ack:1"]);
  });

  it("an edit back to the saved body cancels the pending send", () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.saver.observe(body(0));
    expect(h.live()).toEqual([]);
  });

  it("an older ack never overwrites the newer sent marker and the newest body is not resent", async () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1)); // A
    h.fire();
    h.saver.observe(body(2)); // B, while A is still in flight
    h.fire();
    expect(h.posts.map((p) => seqOf(p.body).seq)).toEqual([1, 2]);
    // The network answers B first, then A (A was the slow one).
    h.posts[1]!.resolve({ ok: true, applied: true });
    await tick();
    expect(h.saver.sentPayload()).toBe(body(2));
    h.posts[0]!.resolve({ ok: true, applied: false }); // the server refused the older request
    await tick();
    expect(h.saver.sentPayload()).toBe(body(2)); // …and the marker did not move back to A
    expect(h.posts.length).toBe(2);
    expect(h.live()).toEqual([]);
  });

  it("when the server APPLIED the older request after the newer ack (a database without 0315), the marker stays and the newest body is sent once more", async () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.fire();
    h.saver.observe(body(2));
    h.fire();
    h.posts[1]!.resolve({ ok: true, applied: true });
    await tick();
    h.posts[0]!.resolve({ ok: true, applied: true }); // last write wins: the server may hold A
    await tick();
    expect(h.saver.sentPayload()).toBe(body(2));
    expect(h.posts.length).toBe(3);
    expect(payloadOf(h.posts[2]!.body)).toBe(body(2));
    expect(seqOf(h.posts[2]!.body).seq).toBe(3);
    h.posts[2]!.resolve({ ok: true, applied: true });
    await tick();
    expect(h.posts.length).toBe(3);
    expect(h.live()).toEqual([]);
  });

  it("the old logic, ported as the baseline, ends on the OLDER body — the bug", async () => {
    // opening-client.tsx before this change: `draftSentRef.current = body` on every ok.
    let sent: string | null = body(0);
    const flush = (b: string, answer: Promise<void>) => answer.then(() => { sent = b; });
    let releaseA!: () => void;
    const a = flush(body(1), new Promise<void>((r) => { releaseA = r; }));
    const b = flush(body(2), Promise.resolve());
    await b;
    releaseA();
    await a;
    expect(sent).toBe(body(1));
  });

  it("when the newer request fails and the older one lands, the newest body is resent automatically", async () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.fire();
    h.saver.observe(body(2));
    h.fire();
    h.posts[1]!.reject(new Error("offline")); // B failed
    await tick();
    expect(h.events.at(-1)).toBe("fail:2");
    h.posts[0]!.resolve({ ok: true, applied: true }); // A landed
    await tick();
    expect(h.saver.sentPayload()).toBe(body(1));
    // The server holds A while the form holds B: one more send, with a higher sequence.
    expect(h.posts.length).toBe(3);
    expect(payloadOf(h.posts[2]!.body)).toBe(body(2));
    expect(seqOf(h.posts[2]!.body).seq).toBe(3);
    h.posts[2]!.resolve({ ok: true, applied: true });
    await tick();
    expect(h.saver.sentPayload()).toBe(body(2));
    expect(h.posts.length).toBe(3);
  });

  it("a failed save does not loop: it waits for the next edit, as before", async () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.fire();
    h.posts[0]!.resolve({ ok: false, applied: false });
    await tick();
    expect(h.events.at(-1)).toBe("fail:1");
    expect(h.posts.length).toBe(1);
    expect(h.live()).toEqual([]);
    h.saver.observe(body(2));
    h.fire();
    expect(seqOf(h.posts[1]!.body).seq).toBe(2);
  });

  it("Retry sends the newest draft at once, with a new sequence", async () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.fire();
    h.posts[0]!.reject(new Error("offline"));
    await tick();
    h.saver.retry();
    expect(h.posts.length).toBe(2);
    expect(payloadOf(h.posts[1]!.body)).toBe(body(1));
    expect(seqOf(h.posts[1]!.body).seq).toBe(2);
    h.posts[1]!.resolve({ ok: true, applied: true });
    await tick();
    expect(h.saver.sentPayload()).toBe(body(1));
    expect(h.events.at(-1)).toBe("ack:2");
  });

  it("a refused newest request (a beacon with a higher sequence already landed) is not resent", async () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.fire(); // fetch seq 1 in flight
    h.saver.onHidden(); // nothing newer than what is in flight is pending → still beacons the unsaved body
    expect(h.beacons.length).toBe(1);
    expect(seqOf(h.beacons[0]!).seq).toBe(2);
    h.posts[0]!.resolve({ ok: true, applied: false });
    await tick();
    expect(h.saver.sentPayload()).toBe(body(1));
    expect(h.posts.length).toBe(1);
  });
});

describe("OpeningDraftAutosaver — the beacon", () => {
  it("hidden with an unsent body queues one beacon carrying the next sequence, and claims it", () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.saver.onHidden();
    expect(h.beacons.length).toBe(1);
    expect(payloadOf(h.beacons[0]!)).toBe(body(1));
    expect(h.saver.sentPayload()).toBe(body(1));
    expect(h.live()).toEqual([]); // the debounced fetch for the same body is not needed any more
    h.saver.onHidden();
    expect(h.beacons.length).toBe(1);
  });

  it("a refused beacon claims nothing, so the ordinary save still goes out", () => {
    const h = harness();
    h.refuseBeacons();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.saver.onHidden();
    expect(h.saver.sentPayload()).toBe(body(0));
    expect(h.live().length).toBe(1);
  });

  it("an older fetch that acks after the beacon cannot pull the marker back", async () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.fire(); // fetch A, seq 1
    h.saver.observe(body(2));
    h.saver.onHidden(); // beacon B, seq 2
    h.posts[0]!.resolve({ ok: true, applied: false }); // 0315: the beacon's higher sequence is stored
    await tick();
    expect(h.saver.sentPayload()).toBe(body(2));
    expect(h.posts.length).toBe(1);
  });

  it("disabled (Phase 1 submitted): nothing is observed, sent or beaconed", () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.saver.setEnabled(false);
    expect(h.live()).toEqual([]);
    h.saver.observe(body(2));
    h.saver.onHidden();
    expect(h.posts).toEqual([]);
    expect(h.beacons).toEqual([]);
  });
});

/**
 * Audit W14 / B079 — leaving the page within the 800 ms debounce threw the last edit away.
 * A client-side navigation (the "< Dashboard" next/link) unmounts the page without a pagehide
 * or visibilitychange, the debounce timer was cleared by the effect cleanup, and nothing sent
 * the pending body.
 */
describe("OpeningDraftAutosaver — dispose on unmount (B079)", () => {
  it("dispose with a pending edit sends one beacon with the newest body; a second dispose sends nothing", () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.saver.observe(body(2)); // still inside the debounce window
    h.saver.dispose();
    expect(h.beacons.length).toBe(1);
    expect(payloadOf(h.beacons[0]!)).toBe(body(2));
    expect(seqOf(h.beacons[0]!)).toEqual({ tab: TAB, seq: 1 });
    expect(h.live()).toEqual([]); // the debounced fetch is cancelled, not fired
    h.saver.dispose();
    expect(h.beacons.length).toBe(1);
    expect(h.posts).toEqual([]);
  });

  it("dispose with nothing pending sends none", () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.dispose();
    expect(h.beacons).toEqual([]);
  });

  it("the old cleanup (cancel the timer, send nothing) is the bug", () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    // What opening-client.tsx did on unmount before this change:
    for (const t of h.live()) t.live = false;
    expect(h.beacons).toEqual([]);
    expect(h.posts).toEqual([]);
    expect(h.saver.sentPayload()).toBe(body(0)); // …and the edit is gone
  });

  it("the unmount beacon carries a sequence above a fetch still in flight, so it cannot lose to it", async () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.fire(); // fetch seq 1
    h.saver.observe(body(2));
    h.saver.dispose(); // beacon seq 2
    expect(seqOf(h.beacons[0]!).seq).toBe(2);
    // A dead page changes nothing more: the late ack is ignored and nothing is re-sent.
    const before = h.events.length;
    h.posts[0]!.resolve({ ok: true, applied: true });
    await tick();
    expect(h.events.length).toBe(before);
    expect(h.posts.length).toBe(1);
    h.saver.observe(body(3));
    h.saver.onHidden();
    h.saver.retry();
    expect(h.live()).toEqual([]);
    expect(h.beacons.length).toBe(1);
    expect(h.posts.length).toBe(1);
  });

  it("after Phase 1 was submitted (disabled) the unmount sends nothing", () => {
    const h = harness();
    h.saver.observe(body(0));
    h.saver.observe(body(1));
    h.saver.setEnabled(false);
    h.saver.dispose();
    expect(h.beacons).toEqual([]);
  });

  it("the page's unmount cleanup disposes the saver", () => {
    const page = readFileSync("app/(authed)/operations/opening/opening-client.tsx", "utf8");
    const cleanup = page.slice(page.indexOf('window.addEventListener("pagehide", onPageHide);'), page.indexOf("}, [stepDraft]);"));
    expect(cleanup).toContain("saver.dispose();");
    expect(cleanup).not.toContain("saver.stop();");
  });
});

describe("the opening page is wired to the controller", () => {
  const page = readFileSync("app/(authed)/operations/opening/opening-client.tsx", "utf8");
  it("sends every draft through OpeningDraftAutosaver with a per-tab id", () => {
    expect(page).toContain('from "@/lib/opening-draft-autosave"');
    expect(page).toContain("new OpeningDraftAutosaver(");
    expect(page).toContain("createClientRequestId()");
    // No second, unordered sender left on the page.
    expect(page).not.toContain("draftSentRef");
    expect(page.match(/"\/api\/opening\/phase1\/draft"/g)?.length).toBe(1);
  });
});
