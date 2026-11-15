// Audit W01/B033: a cart edit made inside the 400 ms debounce, then Continue, must be SAVED before the
// page navigates — it was dropped (the timer was cleared on unmount and the POST never sent).
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createCartSaveQueue, parseCartRevision, newCartRevEpoch, type CartSaveOutcome } from "@/lib/portal/cart-save-queue-shared";

function manualTimers() {
  const fns = new Map<number, () => void>();
  let n = 0;
  return {
    timers: { set: (fn: () => void) => { fns.set(++n, fn); return n; }, clear: (h: unknown) => { fns.delete(h as number); } },
    fire: () => { const all = [...fns.values()]; fns.clear(); all.forEach((f) => f()); },
    armed: () => fns.size,
  };
}

describe("createCartSaveQueue", () => {
  it("flush() inside the debounce sends the pending edit NOW and resolves with its outcome", async () => {
    const t = manualTimers();
    const send = vi.fn(async (_b: string): Promise<CartSaveOutcome> => "ok");
    const q = createCartSaveQueue({ send, delayMs: 400, timers: t.timers });
    q.schedule('{"qty":2}');
    expect(send).not.toHaveBeenCalled();
    await expect(q.flush()).resolves.toBe("ok");
    expect(send).toHaveBeenCalledExactlyOnceWith('{"qty":2}');
    expect(t.armed()).toBe(0);
    t.fire();
    expect(send).toHaveBeenCalledTimes(1); // the cancelled debounce never sends a duplicate
  });
  it("flush() waits for a save already in flight, then sends the newer edit last", async () => {
    const t = manualTimers();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const send = vi.fn(async (b: string): Promise<CartSaveOutcome> => { order.push(`start ${b}`); if (b === "v1") await gate; order.push(`end ${b}`); return "ok"; });
    const q = createCartSaveQueue({ send, delayMs: 400, timers: t.timers });
    q.schedule("v1");
    t.fire(); // the debounce fires; v1 is in flight
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    q.schedule("v2");
    const flushed = q.flush();
    release();
    await expect(flushed).resolves.toBe("ok");
    expect(order).toEqual(["start v1", "end v1", "start v2", "end v2"]);
  });
  it("an edit made WHILE flush() is saving is drained too: flush resolves only once the latest edit is saved", async () => {
    // Reviewer repro (W01-r1, slow connection): press Continue, then change a quantity while that save
    // is pending. flush() used to resolve after the earlier save with the newer edit still unsent.
    const t = manualTimers();
    const sent: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const send = vi.fn(async (b: string): Promise<CartSaveOutcome> => { sent.push(b); if (b === "v1") await gate; return "ok"; });
    const q = createCartSaveQueue({ send, delayMs: 400, timers: t.timers });
    q.schedule("v1");
    const flushed = q.flush();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    q.schedule("v2"); // the edit during the flush (its debounce is armed, not fired)
    release();
    await expect(flushed).resolves.toBe("ok");
    expect(sent).toEqual(["v1", "v2"]);
    expect(q.hasPending()).toBe(false);
    expect(t.armed()).toBe(0); // the newer edit's debounce was cancelled, never a duplicate send
  });
  it("a failure while draining stops the flush and reports it (the edit stays pending for the retry)", async () => {
    const t = manualTimers();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const send = vi.fn(async (b: string): Promise<CartSaveOutcome> => { if (b === "v1") { await gate; return "ok"; } return "failed"; });
    const q = createCartSaveQueue({ send, delayMs: 400, timers: t.timers });
    q.schedule("v1");
    const flushed = q.flush();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    q.schedule("v2");
    release();
    await expect(flushed).resolves.toBe("failed");
    expect(send).toHaveBeenCalledTimes(2);
    expect(q.hasPending()).toBe(true);
  });
  it("flush() with nothing pending and nothing in flight is an immediate ok (no request)", async () => {
    const send = vi.fn(async (): Promise<CartSaveOutcome> => "ok");
    await expect(createCartSaveQueue({ send, delayMs: 400 }).flush()).resolves.toBe("ok");
    expect(send).not.toHaveBeenCalled();
  });
  it("a failed save is retried by the next flush (never a stale failure forever); a thrown send counts as failed", async () => {
    const outcomes: CartSaveOutcome[] = ["failed", "ok"];
    const send = vi.fn(async (): Promise<CartSaveOutcome> => { const o = outcomes.shift()!; return o; });
    const q = createCartSaveQueue({ send, delayMs: 400, timers: manualTimers().timers });
    q.schedule("v1");
    await expect(q.flush()).resolves.toBe("failed");
    expect(q.hasPending()).toBe(true);
    await expect(q.flush()).resolves.toBe("ok");
    expect(send).toHaveBeenNthCalledWith(2, "v1");
    const boom = createCartSaveQueue({ send: async () => { throw new Error("network"); }, delayMs: 400, timers: manualTimers().timers });
    boom.schedule("x");
    await expect(boom.flush()).resolves.toBe("failed");
  });
  it("unauthorized / not_draft are reported, not retried", async () => {
    const send = vi.fn(async (): Promise<CartSaveOutcome> => "not_draft");
    const q = createCartSaveQueue({ send, delayMs: 400, timers: manualTimers().timers });
    q.schedule("v1");
    await expect(q.flush()).resolves.toBe("not_draft");
    expect(q.hasPending()).toBe(false);
  });
  it("takePending() hands back an unsent edit for the unmount keepalive and cancels the debounce", () => {
    const t = manualTimers();
    const q = createCartSaveQueue({ send: async () => "ok", delayMs: 400, timers: t.timers });
    q.schedule("v9");
    expect(q.takePending()).toBe("v9");
    expect(t.armed()).toBe(0);
    expect(q.takePending()).toBeNull();
  });
  it("W01-r2: the unmount save waits for the save already in flight — v2 is never sent before v1 has landed", async () => {
    // Reviewer repro (slow connection): save v1 is in flight, the customer edits (v2), then navigates
    // away without Continue. The unmount used to send v2 at once beside v1, so v2 could reach the
    // database first and the older v1 then overwrote it.
    const t = manualTimers();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const send = vi.fn(async (b: string): Promise<CartSaveOutcome> => { order.push(`start ${b}`); await gate; order.push(`end ${b}`); return "ok"; });
    const unmountSend = vi.fn(async (b: string): Promise<CartSaveOutcome> => { order.push(`unmount ${b}`); return "ok"; });
    const q = createCartSaveQueue({ send, delayMs: 400, timers: t.timers });
    q.schedule("v1");
    t.fire(); // the debounce fires; v1 is in flight
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    q.schedule("v2"); // the edit inside the debounce, then the page unmounts
    const drained = q.drainOnUnmount(unmountSend);
    expect(t.armed()).toBe(0); // the debounce is cancelled — v2 goes out once, through the unmount sender
    await Promise.resolve(); await Promise.resolve();
    expect(unmountSend).not.toHaveBeenCalled(); // NOT beside v1
    release();
    await expect(drained).resolves.toBe("ok");
    expect(order).toEqual(["start v1", "end v1", "unmount v2"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.hasPending()).toBe(false);
  });
  it("W01-r2: with nothing in flight the unmount save goes out at once; with nothing pending it sends nothing", async () => {
    const t = manualTimers();
    const unmountSend = vi.fn(async (): Promise<CartSaveOutcome> => "ok");
    const q = createCartSaveQueue({ send: async () => "ok", delayMs: 400, timers: t.timers });
    await expect(q.drainOnUnmount(unmountSend)).resolves.toBe("ok");
    expect(unmountSend).not.toHaveBeenCalled();
    q.schedule("v3");
    await q.drainOnUnmount(unmountSend);
    expect(unmountSend).toHaveBeenCalledExactlyOnceWith("v3");
    const boom = createCartSaveQueue({ send: async () => "ok", delayMs: 400, timers: manualTimers().timers });
    boom.schedule("x");
    await expect(boom.drainOnUnmount(async () => { throw new Error("network"); })).resolves.toBe("failed");
  });
});

describe("the cart edit revision (W01-r2: the server refuses a save older than one it already stored)", () => {
  it("parseCartRevision: absent → null (an older cached page), a valid {epoch, seq} → itself, anything else → invalid", () => {
    expect(parseCartRevision(undefined)).toBeNull();
    expect(parseCartRevision(null)).toBeNull();
    expect(parseCartRevision({ epoch: "a1b2-c3", seq: 7 })).toEqual({ epoch: "a1b2-c3", seq: 7 });
    for (const bad of [{ epoch: "", seq: 1 }, { epoch: "x".repeat(65), seq: 1 }, { epoch: "has space", seq: 1 }, { epoch: "e", seq: 0 },
      { epoch: "e", seq: 1.5 }, { epoch: "e", seq: Number.MAX_SAFE_INTEGER + 1 }, { epoch: "e" }, { seq: 1 }, "e:1", 5]) {
      expect(parseCartRevision(bad)).toBe("invalid");
    }
  });
  it("newCartRevEpoch: a fresh id per page that parseCartRevision accepts, even without crypto.randomUUID (an insecure origin)", () => {
    const a = newCartRevEpoch(), b = newCartRevEpoch();
    expect(a).not.toBe(b);
    expect(parseCartRevision({ epoch: a, seq: 1 })).toEqual({ epoch: a, seq: 1 });
    const orig = globalThis.crypto.randomUUID;
    try {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
      const c = newCartRevEpoch();
      expect(parseCartRevision({ epoch: c, seq: 1 })).toEqual({ epoch: c, seq: 1 });
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: orig, configurable: true });
    }
  });
});

describe("the build page uses it", () => {
  const page = readFileSync("app/order/build/page.tsx", "utf8");
  it("Continue awaits the flush before navigating, and an unmount sends any unsent edit with keepalive", () => {
    expect(page).toContain("createCartSaveQueue(");
    expect(page).toMatch(/const goToReview = async \(\) => \{[\s\S]*?await saveQueue\.flush\(\)[\s\S]*?router\.push\(`\/order\/review\?draft=\$\{draftId\}`\)/);
    // W01-r2: the unmount save goes THROUGH the queue (after any save in flight), never a direct fetch beside it.
    expect(page).toMatch(/useEffect\(\(\) => \(\) => \{\s*void saveQueue\.drainOnUnmount\(/);
    expect(page).toMatch(/keepalive: true/);
    expect(page).not.toContain("saveQueue.takePending()");
  });
  it("W01-r2: every save carries the page's edit revision (one epoch per page, a seq that only grows)", () => {
    expect(page).toMatch(/saveQueue\.schedule\(JSON\.stringify\(\{ quoteId: draftId, lines: linesPayload, rev: nextCartRev\(\) \}\)\)/);
    expect(page).toMatch(/epoch: newCartRevEpoch\(\), seq: 0/);
  });
  it("the page is frozen (inert) while Continue saves and navigates, and unfreezes on a failed save", () => {
    expect(page).toContain('inert={leaving} aria-busy={leaving}');
    expect(page).toMatch(/if \(outcome !== "ok"\) \{\s*setLeaving\(false\);/);
  });
});
