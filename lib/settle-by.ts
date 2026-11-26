/**
 * The bounded-read helpers (nav PR 7 G1, PR 8 E5), moved here verbatim from lib/dashboard-day.ts by nav PR 9 (plan r2
 * 3.2). Server-only. The top bar's bell (components/nav/TopBarBell.tsx, on every signed-in page) needs them and must not
 * import lib/dashboard-day.ts, which pulls the day loader into every page's server graph. lib/dashboard-day.ts re-exports
 * them, so the Dashboard law's names stand where they were.
 *
 * `settleBy` never rejects, aborts its read at the deadline AND on rejection, and clears its timer on every outcome.
 */
import "server-only";

export type Settled<T> = { readonly kind: "ok"; readonly value: T } | { readonly kind: "failed" } | { readonly kind: "timed_out" };

function logOutcome(area: string, kind: "failed" | "timed_out"): void {
  // The area and the outcome kind only: never row content (as lib/day-plan.ts logs a lane).
  console.error(`dashboard: ${area} ${kind}`);
}

/**
 * Run `run` bounded by the ABSOLUTE deadline `deadlineAt` (epoch ms). Never rejects: `ok`, `failed` (it rejected or threw)
 * or `timed_out` (the deadline came first, or no time was left to start it, in which case `run` is never called). At the
 * deadline the read's signal is aborted, and on a rejection too (E5), so the reads still running under that signal stop
 * (`withAbortStrict` then builds no new query). The timer is cleared on success and on rejection; a timeout's timer has
 * fired; a read that settles late after a timeout changes nothing and leaves nothing behind.
 */
export function settleBy<T>(run: (signal: AbortSignal) => Promise<T>, deadlineAt: number, area: string): Promise<Settled<T>> {
  const left = deadlineAt - Date.now();
  if (left <= 0) {
    logOutcome(area, "timed_out");
    return Promise.resolve({ kind: "timed_out" });
  }
  const controller = new AbortController();
  return new Promise<Settled<T>>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      logOutcome(area, "timed_out");
      resolve({ kind: "timed_out" });
    }, left);
    let p: Promise<T>;
    try { p = Promise.resolve(run(controller.signal)); } catch (e) { p = Promise.reject(e); }
    p.then(
      (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ kind: "ok", value }); },
      () => { if (settled) return; settled = true; clearTimeout(timer); controller.abort(); logOutcome(area, "failed"); resolve({ kind: "failed" }); },
    );
  });
}

/** `settleBy` with a deadline `ms` from now (the loader's separate safety bound). */
export function settleWithin<T>(run: (signal: AbortSignal) => Promise<T>, ms: number, area: string): Promise<Settled<T>> {
  return settleBy(run, Date.now() + ms, area);
}
