/**
 * Unit spine — lib/training/viewer-start.ts: when "Learn the build" falls back
 * to the plain step list. Every failure shape (import rejects, mount throws,
 * the element reports status "failed", ready rejects, nothing settles in time)
 * must come out "failed"; only an element that reports "ready" in time is ready.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startViewer, viewerInputs, VIEWER_TIMEOUT_MS, type ViewerStartDeps } from "@/lib/training/viewer-start";
import { buildCardForSlug } from "@/lib/training/build-cards";
import { buildDefForSlug, buildSteps } from "@/lib/training/build-card-shared";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const never = <T,>() => new Promise<T>(() => {});

function deps(over: Partial<ViewerStartDeps<string, string>>): ViewerStartDeps<string, string> {
  return {
    load: async () => "mod",
    mount: () => "el",
    ready: async () => ({ status: "ready" }),
    timeoutMs: VIEWER_TIMEOUT_MS,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    ...over,
  };
}

async function outcome(d: ViewerStartDeps<string, string>, advanceMs = VIEWER_TIMEOUT_MS + 1) {
  const p = startViewer(d);
  await vi.advanceTimersByTimeAsync(advanceMs);
  return p;
}

describe("startViewer", () => {
  it("ready when the element reports ready in time", async () => {
    expect(await outcome(deps({}))).toBe("ready");
  });

  it("failed when the scene init fails inside the element (ready resolves with status failed)", async () => {
    expect(await outcome(deps({ ready: async () => ({ status: "failed" }) }))).toBe("failed");
  });

  it("failed when the bundle import rejects", async () => {
    expect(await outcome(deps({ load: () => Promise.reject(new Error("401")) }))).toBe("failed");
  });

  it("failed when mounting throws", async () => {
    expect(await outcome(deps({ mount: () => { throw new Error("no custom elements"); } }))).toBe("failed");
  });

  it("failed when ready rejects", async () => {
    expect(await outcome(deps({ ready: () => Promise.reject(new Error("x")) }))).toBe("failed");
  });

  it("failed when the import hangs past the timeout", async () => {
    expect(await outcome(deps({ load: never }))).toBe("failed");
  });

  it("failed when scene init hangs past the timeout, and a late ready does not revive it", async () => {
    let release!: (v: unknown) => void;
    const p = startViewer(deps({ ready: () => new Promise((r) => { release = r; }) }));
    await vi.advanceTimersByTimeAsync(VIEWER_TIMEOUT_MS + 1);
    release({ status: "ready" });
    expect(await p).toBe("failed");
  });

  it("still loading just before the timeout", async () => {
    const p = startViewer(deps({ load: never }));
    let done = false;
    void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(VIEWER_TIMEOUT_MS - 1);
    expect(done).toBe(false);
  });

  it("a mount after the timeout never happens", async () => {
    let resolveLoad!: (m: string) => void;
    const mount = vi.fn(() => "el");
    const p = startViewer(deps({ load: () => new Promise((r) => { resolveLoad = r; }), mount }));
    await vi.advanceTimersByTimeAsync(VIEWER_TIMEOUT_MS + 1);
    resolveLoad("mod");
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe("failed");
    expect(mount).not.toHaveBeenCalled();
  });
});

describe("viewerInputs (decided before render; never throws)", () => {
  const def = buildDefForSlug("crunchy-boi")!;
  const card = buildCardForSlug("crunchy-boi")!;
  const en = buildSteps(def, card, "en");
  const es = buildSteps(def, card, "es");

  it("ok with matching steps and a data file", () => {
    const r = viewerInputs(en, es, "/api/training/co-scenes/d.json");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.steps).toHaveLength(12);
  });

  it("a step/key mismatch degrades to unavailable instead of throwing during render", () => {
    expect(() => viewerInputs(en, [...es].reverse(), "/d.json")).not.toThrow();
    expect(viewerInputs(en, [...es].reverse(), "/d.json")).toMatchObject({ kind: "unavailable", reason: "steps_mismatch" });
    expect(viewerInputs(en, es.slice(1), "/d.json")).toMatchObject({ kind: "unavailable", reason: "steps_mismatch" });
  });

  it("no scene data vendored is a CONFIG problem (unavailable), not a runtime failure", () => {
    expect(viewerInputs(en, es, null)).toMatchObject({ kind: "unavailable", reason: "no_scene_data" });
  });
});
