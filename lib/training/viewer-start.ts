/**
 * viewer-start — decides whether the interactive build viewer came up, so the
 * page can fall back to the plain step list when it did not (spec §9: the page
 * must still teach the build). Pure (injected load/mount/ready/timers), so the
 * decision is unit-tested without a DOM.
 *
 * FAILED covers every way the viewer can fail to come up, each with a reason
 * handed to `report` (the page logs it — a silent fallback hid the 2026-09-29
 * prod failure):
 *   - the bundle import rejects (blocked, offline, 404/401);
 *   - the import does not land within `importTimeoutMs` (a hung import);
 *   - mounting throws;
 *   - the element's ready() settles with a status other than "ready" (the
 *     element catches scene-init failures itself — no WebGL, a failed lazy
 *     chunk, a photo refused by the asset law, its own prepare-timeout — and
 *     reports status "failed" with the error rather than rejecting);
 *   - ready() rejects;
 *   - nothing settles within `ceilingMs` (a backstop for a hung element).
 *
 * NO FLAT EARLY CUT-OFF once the element is mounted: the element owns the load
 * (scene data + 33 photos + scene prepare) and bounds it itself with its
 * `prepare-timeout` (VIEWER_PREPARE_TIMEOUT_MS, set by the page). Measured
 * 2026-09-29 (iPhone-like WebKit + real signed-URL photos ~6.8 s; Chromium at
 * 4x CPU on LTE ~19 s; Juan's prod photo fetches alone took 4-7 s), so the old
 * flat 8 s would cut off a viewer that was about to come up.
 * The first outcome wins; a late "ready" after a failure stays failed, and the
 * caller tears the element down.
 */

import { toElementSteps, type WebStep } from "./build-card-shared";

/** The bundle import (entry module, same-origin, behind requireSession) must land within this. */
export const VIEWER_IMPORT_TIMEOUT_MS = 15_000;
/** Set on the element as `prepare-timeout`: its own ceiling for data + photos + scene prepare. */
export const VIEWER_PREPARE_TIMEOUT_MS = 30_000;
/** Backstop only: past import + the element's own prepare timeout, with a grace for its report. */
export const VIEWER_CEILING_MS = VIEWER_IMPORT_TIMEOUT_MS + VIEWER_PREPARE_TIMEOUT_MS + 5_000;

/**
 * Whether the viewer can be STARTED at all, decided before any render-time
 * work can throw. A mismatched en/es step list, or a bundle vendored without
 * scene data, is a BUILD/CONFIG problem, not a runtime failure: the page shows
 * the plain step list (with no "could not load" message) and logs the reason,
 * instead of crashing during render (toElementSteps throws on a mismatch).
 */
export type ViewerInputs =
  | { kind: "ok"; steps: WebStep[]; dataUrl: string }
  | { kind: "unavailable"; reason: "no_scene_data" | "steps_mismatch"; detail: string };

export function viewerInputs(en: readonly WebStep[], es: readonly WebStep[], dataUrl: string | null): ViewerInputs {
  if (!dataUrl) return { kind: "unavailable", reason: "no_scene_data", detail: "the vendored bundle has no scene data file" };
  try {
    return { kind: "ok", steps: toElementSteps(en, es), dataUrl };
  } catch (e) {
    return { kind: "unavailable", reason: "steps_mismatch", detail: e instanceof Error ? e.message : String(e) };
  }
}

export type ViewerOutcome = "ready" | "failed";

export interface ViewerStartDeps<M, E> {
  load(): Promise<M>;
  mount(mod: M): E;
  ready(el: E): Promise<unknown>;
  importTimeoutMs: number;
  ceilingMs: number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  /** Called once, with why, when the outcome is "failed". */
  report?(reason: string): void;
}

function readyField(result: unknown, key: "status" | "error"): unknown {
  return result && typeof result === "object" && key in result ? (result as Record<string, unknown>)[key] : undefined;
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return e == null ? "no error given" : String(e);
}

export function startViewer<M, E>(deps: ViewerStartDeps<M, E>): Promise<ViewerOutcome> {
  return new Promise<ViewerOutcome>((resolve) => {
    let settled = false;
    let importTimer: unknown = null;
    const finish = (o: ViewerOutcome, reason?: string) => {
      if (settled) return;
      settled = true;
      deps.clearTimer(ceiling);
      if (importTimer !== null) deps.clearTimer(importTimer);
      if (o === "failed") deps.report?.(reason ?? "unknown");
      resolve(o);
    };
    const ceiling = deps.setTimer(() => finish("failed", `viewer did not settle within ${deps.ceilingMs} ms`), deps.ceilingMs);
    importTimer = deps.setTimer(() => finish("failed", `bundle import did not land within ${deps.importTimeoutMs} ms`), deps.importTimeoutMs);
    deps
      .load()
      .catch((e: unknown) => {
        throw new Error(`bundle import failed: ${describeError(e)}`);
      })
      .then((mod) => {
        if (settled) return undefined;
        deps.clearTimer(importTimer);
        importTimer = null;
        return deps.ready(deps.mount(mod)).then((result) => {
          if (readyField(result, "status") === "ready") finish("ready");
          else finish("failed", `element reported ${String(readyField(result, "status"))}: ${describeError(readyField(result, "error"))}`);
        });
      })
      .catch((e: unknown) => finish("failed", describeError(e)));
  });
}
