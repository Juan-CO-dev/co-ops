// Audit W01/B033: a cart edit made inside the 400 ms debounce, then Continue, must be SAVED before the
// page navigates — it was dropped (the timer was cleared on unmount and the POST never sent).
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createCartSaveQueue, type CartSaveOutcome } from "@/lib/portal/cart-save-queue-shared";

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
});

describe("the build page uses it", () => {
  const page = readFileSync("app/order/build/page.tsx", "utf8");
  it("Continue awaits the flush before navigating, and an unmount sends any unsent edit with keepalive", () => {
    expect(page).toContain("createCartSaveQueue(");
    expect(page).toMatch(/const goToReview = async \(\) => \{[\s\S]*?await saveQueue\.flush\(\)[\s\S]*?router\.push\(`\/order\/review\?draft=\$\{draftId\}`\)/);
    expect(page).toMatch(/saveQueue\.takePending\(\)[\s\S]*?keepalive: true/);
  });
});
