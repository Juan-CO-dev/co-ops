/**
 * viewer-start — decides whether the interactive build viewer came up, so the
 * page can fall back to the plain step list when it did not (spec §9: the page
 * must still teach the build). Pure (injected load/mount/ready/timers), so the
 * decision is unit-tested without a DOM.
 *
 * FAILED covers every way the viewer can fail to come up:
 *   - the bundle import rejects (blocked, offline, 404/401);
 *   - mounting throws;
 *   - the element's ready() settles with a status other than "ready" (the
 *     element catches scene-init failures itself — no WebGL, a failed lazy chunk
 *     — and reports status "failed" rather than rejecting);
 *   - ready() rejects;
 *   - NOTHING settles within `timeoutMs` (a hung import or scene init).
 * The first outcome wins; a late "ready" after a timeout stays failed, and the
 * caller tears the element down.
 */

export const VIEWER_TIMEOUT_MS = 8000;

export type ViewerOutcome = "ready" | "failed";

export interface ViewerStartDeps<M, E> {
  load(): Promise<M>;
  mount(mod: M): E;
  ready(el: E): Promise<unknown>;
  timeoutMs: number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
}

function readyStatus(result: unknown): string | null {
  if (result && typeof result === "object" && "status" in result) {
    const s = (result as { status: unknown }).status;
    return typeof s === "string" ? s : null;
  }
  return null;
}

export function startViewer<M, E>(deps: ViewerStartDeps<M, E>): Promise<ViewerOutcome> {
  return new Promise<ViewerOutcome>((resolve) => {
    let settled = false;
    const finish = (o: ViewerOutcome) => {
      if (settled) return;
      settled = true;
      deps.clearTimer(timer);
      resolve(o);
    };
    const timer = deps.setTimer(() => finish("failed"), deps.timeoutMs);
    deps
      .load()
      .then((mod) => {
        if (settled) return undefined;
        return deps.ready(deps.mount(mod));
      })
      .then((result) => {
        if (!settled) finish(readyStatus(result) === "ready" ? "ready" : "failed");
      })
      .catch(() => finish("failed"));
  });
}
