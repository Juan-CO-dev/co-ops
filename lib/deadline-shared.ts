/**
 * One deadline for a whole run — pure, client-safe. Extracted from lib/toast/labor.ts (Scheduling
 * Phase 1, Task 7 Step 2) so the 7shifts sync bounds every await the same way the Toast labor pull
 * does. lib/toast/labor.ts keeps its export (it delegates here with its own code).
 *
 * Settles with `p`, or rejects with `new Error(code)` when `signal` fires — whichever comes first. A
 * driver that ignores the signal therefore cannot stall the caller.
 */
export function withDeadline<T>(p: PromiseLike<T>, signal: AbortSignal, code = "deadline"): Promise<T> {
  if (signal.aborted) {
    // A STARTED promise (e.g. a fetch on this aborted signal) may still reject later: consume it, or
    // it is an unhandled rejection (W27 / B141). Only a real Promise — a lazy thenable (a PostgREST
    // builder) sends its query on `.then`, so it must never be started after the deadline.
    if (p instanceof Promise) p.catch(() => {});
    return Promise.reject(new Error(code));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error(code));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(p).then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}
