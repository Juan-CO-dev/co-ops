import { afterEach, describe, expect, it, vi } from "vitest";
import { withDeadline } from "@/lib/deadline-shared";

// W27 / B141: an already-expired deadline must not leave a started request's rejection unhandled,
// and must never start a lazy thenable (a PostgREST builder sends its query on `.then`).
describe("withDeadline on an already-aborted signal", () => {
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown) => { seen.push(reason); };
  afterEach(() => { process.off("unhandledRejection", onUnhandled); seen.length = 0; });

  it("an already-aborted deadline consumes a started promise's later rejection", async () => {
    // Vitest itself registers listeners; ours records whether this promise went unhandled.
    process.on("unhandledRejection", onUnhandled);
    const late = new Error("late");
    const p = new Promise((_, r) => setTimeout(() => r(late), 0));
    await expect(withDeadline(p, AbortSignal.abort(), "x")).rejects.toThrow("x");
    await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setImmediate(r));
    expect(seen).not.toContain(late);
  });

  it("an already-aborted deadline never starts a lazy thenable", async () => {
    const then = vi.fn();
    await expect(withDeadline({ then } as PromiseLike<unknown>, AbortSignal.abort())).rejects.toThrow("deadline");
    expect(then).not.toHaveBeenCalled();
  });

  it("a live deadline still settles with the promise", async () => {
    await expect(withDeadline(Promise.resolve(3), new AbortController().signal)).resolves.toBe(3);
  });
});
