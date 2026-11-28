/**
 * The digest PRE-LOAD runner (digests round 3, PR 4; plan §15.2.2, CC addendum O-N3). Generic: it knows nothing about
 * labor. Zero I/O of its own: the clock and the timers are injected.
 *
 * THE RULE: every optional read of a run happens here, in ordered PHASES, before the first email is composed; composing
 * reads nothing and waits for nothing. So no recipient's email can depend on the order of recipients or on a read they
 * cannot see.
 *
 * ONE OWNER OF EVERY CUTOFF (finding L15). For each piece the runner fixes
 *     cutoffAt = min(piece start + min(piece.capMs, phase.maxCapMs), the run's absolute time)
 * and then:
 *   - WAITS until the piece's `done` settles OR the clock reaches `cutoffAt`. A wait and nothing else: no value is taken
 *     from it and nothing is dropped by it;
 *   - then, EXACTLY ONCE, aborts the piece's signal and calls `snapshot()`. The piece's result is ALWAYS what
 *     `snapshot()` returns, whichever of the two ended the wait and whether `done` resolved or rejected. A `snapshot()`
 *     that throws is `unavailable`.
 * A piece keeps a ledger of the results it accepted and certifies from it in `snapshot()`, so nothing a piece accepted
 * can be lost to a timer (no timer returns a result) and nothing that arrives after the snapshot is used.
 *
 * SIGNALS (finding L10). One root controller per run. Every piece gets a signal derived from the root that also aborts
 * at its cutoff; every stage gets a signal derived from its piece's that also aborts at the stage's end. Ending one stage
 * of one piece aborts that stage's requests only: not the piece's later stages, not another piece. Each signal's
 * deadline (on the runner's clock) is registered, so a transport wrapper can refuse an attempt whose stage has ended
 * even when the abort timer has not been delivered yet (`signalDeadline`, A4-4).
 *
 * PHASES. A phase starts only when every piece of the phase before it has been snapshotted, and never after the run's
 * absolute time. `definePreload` refuses a configuration whose phase caps do not fit the budget (so a later piece with
 * a longer cap cannot silently shorten another phase), and a piece is clamped to its phase's cap (O-N3).
 *
 * SOURCES. Anything that can change what a later read certifies (the digest's own Toast pull) is a SOURCE: it runs
 * before the budget opens and before every phase. The type has no other place for it: phases hold reads only. If the
 * sources did not finish writing, no phase runs and every result is `unavailable`.
 *
 * NEVER FAILS THE RUN (O-N3). `run()` never throws: any throw inside the pre-load seals EVERY result `unavailable`.
 */

/** The timer seam (global timers by default; tests inject fake ones on the same clock). */
export interface PreloadTimers { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }

/** One stage of a piece: its requests carry `signal`, check `expired()` before they start and when they answer. */
export interface Stage { signal: AbortSignal; expired(): boolean; /** On the runner's clock. */ deadlineAt: number }

export interface PieceCtx {
  /** The piece's own signal: aborted at its cutoff (or when the run is sealed). */
  signal: AbortSignal;
  expired(): boolean;
  clock: () => number;
  /** When the runner will snapshot this piece, on `clock`. */
  cutoffAt: number;
  /** A stage ending `endsAfterMs` after the piece's start (never later than the cutoff); "cutoff" = the piece's own end. */
  stage(endsAfterMs: number | "cutoff"): Stage;
}

/** `done` settles when the piece has nothing more to do; `snapshot()` closes its ledger and certifies from it. */
export interface PieceHandle<T> { done: Promise<void>; snapshot(): T }
export interface PreloadPiece<T> { key: string; capMs: number; start(ctx: PieceCtx): PieceHandle<T> }

export type PreloadResult<T = unknown> = { kind: "ok"; value: T } | { kind: "unavailable" };
/**
 * The sealed results, by piece key. A key that is absent was never loaded: read it as `unavailable`. READ-ONLY for real:
 * it has no method that writes, and every value in it is deep-frozen, so nothing a composer does to one recipient's
 * facts can reach the next recipient or the next run.
 */
export interface PreloadResults {
  get(key: string): PreloadResult | undefined;
  has(key: string): boolean;
  readonly size: number;
  keys(): IterableIterator<string>;
}

export interface PreloadPhase<D> {
  name: string;
  /** The largest cap a piece of this phase may have; a piece asking for more is clamped to it. */
  maxCapMs: number;
  /** The pieces of this phase, from what earlier phases sealed and who is due. Pure: no I/O here. */
  pieces(sealedSoFar: PreloadResults, due: D): PreloadPiece<unknown>[];
}

export interface PreloadRunArgs<D> {
  /**
   * Phase 0: every source-changing load, awaited BEFORE the budget opens. `writersSettled: false` (or a throw) = a write
   * may still be running, so nothing may be certified: no phase runs.
   */
  sources: () => Promise<{ writersSettled: boolean }>;
  due: D;
  /** A REAL advancing clock in ms. Never a fixed "now". */
  clock: () => number;
  timers?: PreloadTimers;
}

const DEADLINES = new WeakMap<AbortSignal, number>();
/** The deadline (on the runner's clock) of a signal this runner made; undefined for any other signal. */
export function signalDeadline(signal: AbortSignal): number | undefined {
  return DEADLINES.get(signal);
}

/** The real timers (the default). */
export const REAL_PRELOAD_TIMERS: PreloadTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const UNAVAILABLE: PreloadResult = Object.freeze({ kind: "unavailable" });

/** Freezes a value all the way down (plain objects, arrays, Maps and Sets of them). */
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  if (value instanceof Map) { for (const [k, v] of value) { deepFreeze(k, seen); deepFreeze(v, seen); } }
  else if (value instanceof Set) { for (const v of value) deepFreeze(v, seen); }
  else for (const k of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[k], seen);
  return Object.freeze(value);
}

/** THE SEAL: a read-only view over a private copy. Nothing outside this function holds the Map. */
function seal(results: ReadonlyMap<string, PreloadResult>): PreloadResults {
  const own = new Map<string, PreloadResult>();
  for (const [key, r] of results) own.set(key, deepFreeze(r));
  return Object.freeze({
    get: (key: string) => own.get(key),
    has: (key: string) => own.has(key),
    get size() { return own.size; },
    keys: () => own.keys(),
  });
}
/** "Nothing was loaded": every key reads as unavailable. Sealed, so it can be shared by every failed run. */
const NOTHING: PreloadResults = seal(new Map());

/** A signal that aborts when `parent` does. Returns the controller and a function that detaches the listener. */
function derived(parent: AbortSignal): { controller: AbortController; detach: () => void } {
  const controller = new AbortController();
  if (parent.aborted) { controller.abort(); return { controller, detach: () => {} }; }
  const onAbort = () => controller.abort();
  parent.addEventListener("abort", onAbort, { once: true });
  return { controller, detach: () => parent.removeEventListener("abort", onAbort) };
}

async function runPiece(
  piece: PreloadPiece<unknown>, maxCapMs: number, root: AbortSignal, absoluteAt: number, clock: () => number, timers: PreloadTimers,
): Promise<PreloadResult> {
  const startAt = clock();
  // A piece that does not say a real cap is not run: one bad piece costs that piece, never the others.
  if (!Number.isFinite(piece.capMs) || piece.capMs <= 0) return UNAVAILABLE;
  // O-N3: a piece is clamped to its phase's cap. ONE owner of the cutoff: this function.
  const cutoffAt = Math.min(startAt + Math.min(piece.capMs, maxCapMs), absoluteAt);
  const own = derived(root);
  DEADLINES.set(own.controller.signal, cutoffAt);
  const cleanups: Array<() => void> = [own.detach];
  const expired = () => own.controller.signal.aborted || clock() >= cutoffAt;
  const ctx: PieceCtx = {
    signal: own.controller.signal, expired, clock, cutoffAt,
    stage(endsAfterMs) {
      if (endsAfterMs === "cutoff") return { signal: own.controller.signal, expired, deadlineAt: cutoffAt };
      const deadlineAt = Math.min(startAt + endsAfterMs, cutoffAt);
      const child = derived(own.controller.signal);
      cleanups.push(child.detach);
      DEADLINES.set(child.controller.signal, deadlineAt);
      const left = deadlineAt - clock();
      if (left <= 0) child.controller.abort();
      else {
        const handle = timers.set(() => child.controller.abort(), left);
        cleanups.push(() => timers.clear(handle));
      }
      return { signal: child.controller.signal, deadlineAt, expired: () => child.controller.signal.aborted || clock() >= deadlineAt };
    },
  };

  let handle: PieceHandle<unknown> | null = null;
  try { handle = piece.start(ctx); } catch { handle = null; }
  // A handle that is not a handle is `unavailable` for this piece only.
  if (handle === null || typeof handle !== "object" || typeof handle.snapshot !== "function") handle = null;

  // The wait: `done` settles OR the clock reaches the cutoff. Nothing is taken from it.
  if (handle !== null) {
    const done = Promise.resolve(handle.done);
    await new Promise<void>((resolve) => {
      let over = false;
      let timer: unknown = null;
      const finish = () => {
        if (over) return;
        over = true;
        if (timer !== null) timers.clear(timer);
        resolve();
      };
      const left = cutoffAt - clock();
      if (left <= 0) { finish(); return; }
      timer = timers.set(finish, left);
      done.then(finish, finish);
    });
  }

  // Exactly once: abort the piece's signal, then take the snapshot. The result is the snapshot, whatever ended the wait.
  own.controller.abort();
  for (const c of cleanups) { try { c(); } catch { /* a timer already cleared */ } }
  if (handle === null) return UNAVAILABLE;
  try {
    return Object.freeze({ kind: "ok", value: handle.snapshot() }) as PreloadResult;
  } catch {
    return UNAVAILABLE;
  }
}

export interface Preload<D> {
  /** Runs the sources, then the phases, and returns the sealed results. NEVER throws (O-N3). */
  run(args: PreloadRunArgs<D>): Promise<PreloadResults>;
}

/**
 * Builds a pre-load. THROWS (a build-time error, never at send time) when the phases' caps do not fit the budget:
 * the sum over the phases of `maxCapMs` must not exceed `budgetMs`, so no phase can be shortened by the ones before it
 * in normal operation. `budgetMs` is a DURATION counted from the end of the sources (phase 0).
 */
export function definePreload<D>(config: { phases: readonly PreloadPhase<D>[]; budgetMs: number }): Preload<D> {
  const { phases, budgetMs } = config;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error("preload_bad_budget");
  for (const p of phases) if (!Number.isFinite(p.maxCapMs) || p.maxCapMs <= 0) throw new Error("preload_bad_cap");
  if (phases.reduce((sum, p) => sum + p.maxCapMs, 0) > budgetMs) throw new Error("preload_caps_exceed_budget");

  return {
    async run({ sources, due, clock, timers = REAL_PRELOAD_TIMERS }) {
      const root = new AbortController();
      try {
        // Phase 0: every source-changing load, before the budget opens and before every bracket.
        const settled = await sources();
        if (!settled.writersSettled) return NOTHING;

        const absoluteAt = clock() + budgetMs;
        DEADLINES.set(root.signal, absoluteAt);
        const sealed = new Map<string, PreloadResult>();
        for (const phase of phases) {
          // A phase that has not started by the absolute time never starts.
          if (clock() >= absoluteAt) break;
          // A phase sees what the earlier phases sealed, read-only.
          const pieces = phase.pieces(seal(sealed), due);
          const keys = new Set<string>();
          for (const p of pieces) {
            if (keys.has(p.key) || sealed.has(p.key)) throw new Error("preload_duplicate_key");
            keys.add(p.key);
          }
          // Every piece of a phase starts together; the phase is over when each has been snapshotted.
          const results = await Promise.all(pieces.map((p) => runPiece(p, phase.maxCapMs, root.signal, absoluteAt, clock, timers)));
          pieces.forEach((p, i) => sealed.set(p.key, results[i]!));
        }
        // The seal: a read-only view over a private, deep-frozen copy. A result that arrives later has nowhere to go
        // (every ledger is closed and nothing can write here).
        return seal(sealed);
      } catch {
        // O-N3: any throw inside the pre-load seals EVERY result unavailable; the run goes on.
        return NOTHING;
      } finally {
        root.abort();
      }
    },
  };
}

/** A sealed result by key, as its value or null (absent or `unavailable`). */
export function preloadValue<T>(results: PreloadResults, key: string): T | null {
  const r = results.get(key);
  return r && r.kind === "ok" ? (r.value as T) : null;
}
