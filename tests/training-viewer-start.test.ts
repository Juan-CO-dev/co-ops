/**
 * Unit spine — lib/training/viewer-start.ts: when "Learn the build" falls back
 * to the plain step list. Every failure shape (import rejects, mount throws,
 * the element reports status "failed", ready rejects, the import hangs, the
 * element never settles) must come out "failed" WITH a logged reason; an
 * element that is still working is NOT failed early (2026-09-29: a real phone
 * needs ~7-20 s for bundle + 33 photos + scene; a flat 8 s cut it off).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  startViewer,
  viewerInputs,
  VIEWER_CEILING_MS,
  VIEWER_IMPORT_TIMEOUT_MS,
  VIEWER_PREPARE_TIMEOUT_MS,
  type ViewerStartDeps,
} from "@/lib/training/viewer-start";
import { buildCardForSlug } from "@/lib/training/build-cards";
import { buildDefForSlug, buildSteps } from "@/lib/training/build-card-shared";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const never = <T,>() => new Promise<T>(() => {});
const after = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

function deps(over: Partial<ViewerStartDeps<string, string>>): ViewerStartDeps<string, string> {
  return {
    load: async () => "mod",
    mount: () => "el",
    ready: async () => ({ status: "ready" }),
    importTimeoutMs: VIEWER_IMPORT_TIMEOUT_MS,
    ceilingMs: VIEWER_CEILING_MS,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    ...over,
  };
}

async function outcome(d: ViewerStartDeps<string, string>, advanceMs = VIEWER_CEILING_MS + 1) {
  const p = startViewer(d);
  await vi.advanceTimersByTimeAsync(advanceMs);
  return p;
}

describe("startViewer", () => {
  it("ready when the element reports ready", async () => {
    expect(await outcome(deps({}))).toBe("ready");
  });

  it("ready when the element takes 20 s (a phone loading 33 photos) — no flat early cut-off", async () => {
    expect(await outcome(deps({ ready: () => after(20_000, { status: "ready" }) }))).toBe("ready");
  });

  it("failed when the scene init fails inside the element, and the element's error is reported", async () => {
    const report = vi.fn();
    const err = new Error("crunchy loader: cb-f-built-angle breaks the asset law: edge: declared undefined, measured soft");
    expect(await outcome(deps({ ready: async () => ({ status: "failed", error: err }), report }))).toBe("failed");
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![0]).toContain("breaks the asset law");
  });

  it("an element failure is decided at once, not at a timeout", async () => {
    const p = startViewer(deps({ ready: async () => ({ status: "failed", error: "x" }) }));
    let got: string | null = null;
    void p.then((o) => { got = o; });
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toBe("failed");
  });

  it("failed (reported) when the bundle import rejects", async () => {
    const report = vi.fn();
    expect(await outcome(deps({ load: () => Promise.reject(new Error("401")), report }))).toBe("failed");
    expect(report.mock.calls[0]![0]).toContain("401");
  });

  it("a reporter that throws never strands the page: the outcome still settles failed (Astra PR #381 P2)", async () => {
    const p = startViewer(
      deps({
        load: async () => {
          throw new Error("offline");
        },
        report: () => {
          throw new Error("logging broke");
        },
      }),
    );
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("failed");
  });
  it("failed when mounting throws", async () => {
    expect(await outcome(deps({ mount: () => { throw new Error("no custom elements"); } }))).toBe("failed");
  });

  it("failed when ready rejects", async () => {
    expect(await outcome(deps({ ready: () => Promise.reject(new Error("x")) }))).toBe("failed");
  });

  it("failed when the import hangs past the import timeout", async () => {
    const report = vi.fn();
    expect(await outcome(deps({ load: never, report }), VIEWER_IMPORT_TIMEOUT_MS + 1)).toBe("failed");
    expect(report.mock.calls[0]![0]).toMatch(/import/);
  });

  it("a slow import that lands in time is not failed by the import timeout", async () => {
    expect(await outcome(deps({ load: () => after(VIEWER_IMPORT_TIMEOUT_MS - 100, "mod"), ready: () => after(10_000, { status: "ready" }) }))).toBe("ready");
  });

  it("failed at the ceiling when the element never settles, and a late ready does not revive it", async () => {
    let release!: (v: unknown) => void;
    const p = startViewer(deps({ ready: () => new Promise((r) => { release = r; }) }));
    await vi.advanceTimersByTimeAsync(VIEWER_CEILING_MS + 1);
    release({ status: "ready" });
    expect(await p).toBe("failed");
  });

  it("still loading just before the ceiling", async () => {
    const p = startViewer(deps({ ready: never }));
    let done = false;
    void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(VIEWER_CEILING_MS - 1);
    expect(done).toBe(false);
  });

  it("a mount after the import timeout never happens", async () => {
    let resolveLoad!: (m: string) => void;
    const mount = vi.fn(() => "el");
    const p = startViewer(deps({ load: () => new Promise((r) => { resolveLoad = r; }), mount }));
    await vi.advanceTimersByTimeAsync(VIEWER_IMPORT_TIMEOUT_MS + 1);
    resolveLoad("mod");
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe("failed");
    expect(mount).not.toHaveBeenCalled();
  });

  it("the ceiling is only a backstop: it outlasts the import budget plus the element's own prepare timeout", () => {
    expect(VIEWER_CEILING_MS).toBeGreaterThan(VIEWER_IMPORT_TIMEOUT_MS + VIEWER_PREPARE_TIMEOUT_MS);
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
