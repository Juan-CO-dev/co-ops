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
 * sources did not finish writing, no phase that certifies anything runs (every such result is `unavailable`); a phase
 * that certifies nothing (`needsSettledWriters: false`: the settings read) still runs, so that who may see a line is
 * still decided and they read "not available".
 *
 * NEVER FAILS THE RUN (O-N3). `run()` never throws and never leaves a rejection unhandled. Any throw inside the pre-load
 * (a phase's `pieces()`, a piece's `start()`, a piece with no real cap or no real handle, a duplicate key) seals EVERY
 * result `unavailable`. The ONE local rule (plan §15.2.2; CC ruling D-6: the plan wins over O-N3's wording): a
 * `snapshot()` that throws, or that returns a value which cannot be sealed, makes THAT piece `unavailable` and leaves
 * the others as they are.
 * A `done` is OBSERVED the moment `start()` hands it back, before the handle is judged (fix round 2, D-2): a handle
 * the runner refuses (no `snapshot`) whose `done` rejects is still a throw inside the pre-load, never an unhandled
 * rejection. A promise handed back as a snapshot VALUE is observed too, and refused.
 *
 * SEALED = READ-ONLY, FOR REAL. A snapshot is deep-frozen (plain objects and arrays, at every depth). A value that
 * cannot be frozen that way (a `Map`, a `Set`: `Object.freeze` leaves their entries writable; a promise) is refused.
 * A `Date` cannot be frozen either (`setTime` works on a frozen Date, also through the producer's own reference), so
 * the seal stores its EPOCH MILLISECONDS, a number, in its place (fix round 2, D-5): `Sealed<T>` is what a snapshot of
 * type `T` reads as. A Date whose holder cannot be written (the producer froze it first) makes the piece `unavailable`.
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
  /**
   * Default true: this phase certifies something, so it never runs while a source may still be writing. False only for a
   * phase that certifies nothing (the settings read): it runs even then.
   */
  needsSettledWriters?: boolean;
}

export interface PreloadRunArgs<D> {
  /**
   * Phase 0: every source-changing load, awaited BEFORE the budget opens. `writersSettled: false` = a write may still be
   * running or its outcome is not known, so nothing may be certified: only a phase with `needsSettledWriters: false`
   * runs. A throw = no phase runs.
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

/**
 * What a snapshot of type `T` reads as once sealed (D-5): every `Date` in it is its epoch milliseconds. Everything else
 * keeps its type (and, for an object or an array, its identity: it is frozen in place).
 */
export type Sealed<T> =
  T extends Date ? number
    : T extends (...args: never[]) => unknown ? T
      : T extends object ? { [K in keyof T]: Sealed<T[K]> }
        : T;

/** A rejection nobody else may be listening for is listened for here, so it can never be an `unhandledRejection`. */
function observe(maybePromise: unknown): void {
  void Promise.resolve(maybePromise).then(undefined, () => undefined);
}

const isDate = (v: unknown): v is Date => v instanceof Date || Object.prototype.toString.call(v) === "[object Date]";

/**
 * Freezes a value all the way down (plain objects and arrays) and returns it sealed. A `Map` or a `Set` anywhere in it
 * THROWS: `Object.freeze` leaves their entries writable, so they can never be part of a sealed value. So does a
 * promise (it is not data; it is observed first, so a rejected one is never unhandled). A `Date` is replaced by its
 * epoch milliseconds where it sits (D-5); if its holder cannot be written, the assignment THROWS (strict mode).
 */
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Sealed<T> {
  if (isDate(value)) return value.getTime() as Sealed<T>;
  if (typeof value !== "object" || value === null || seen.has(value)) return value as Sealed<T>;
  if (value instanceof Promise) { observe(value); throw new Error("preload_unsealable_value"); }
  if (value instanceof Map || value instanceof Set || value instanceof WeakMap || value instanceof WeakSet) throw new Error("preload_unsealable_value");
  seen.add(value);
  const holder = value as Record<PropertyKey, unknown>;
  for (const k of Reflect.ownKeys(value)) {
    const v = holder[k];
    if (isDate(v)) holder[k] = v.getTime();
    else deepFreeze(v, seen);
  }
  return Object.freeze(value) as Sealed<T>;
}

/** THE SEAL: a read-only view over a private copy. Nothing outside this function holds the Map. */
function seal(results: ReadonlyMap<string, PreloadResult>): PreloadResults {
  // Every value was deep-frozen when its piece was snapshotted (`runPiece`).
  const own = new Map<string, PreloadResult>(results);
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
  // A piece with no real cap is a programming error: a throw inside the pre-load (O-N3: every result unavailable).
  if (!Number.isFinite(piece.capMs) || piece.capMs <= 0) throw new Error("preload_bad_piece_cap");
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

  // A `start()` that throws, or that returns no real handle, is a throw inside the pre-load (O-N3): it propagates,
  // `run()` seals EVERY result unavailable and aborts the root. (Only `snapshot()` has a local rule, below.)
  let handle: PieceHandle<unknown>;
  try {
    handle = piece.start(ctx);
    // D-2: whatever `start()` handed back, the `done` it carries is observed FIRST. A handle refused on the next line
    // (no `snapshot`) with a `done` that rejects would otherwise leave that rejection with no handler at all.
    observe((handle as { done?: unknown } | null | undefined)?.done);
    if (handle === null || typeof handle !== "object" || typeof handle.snapshot !== "function") throw new Error("preload_bad_piece_handle");
  } catch (e) {
    own.controller.abort();
    for (const c of cleanups) { try { c(); } catch { /* already cleared */ } }
    throw e;
  }

  // The wait: `done` settles OR the clock reaches the cutoff. Nothing is taken from it.
  await new Promise<void>((resolve) => {
    let over = false;
    let timer: unknown = null;
    const finish = () => {
      if (over) return;
      over = true;
      if (timer !== null) timers.clear(timer);
      resolve();
    };
    // BOTH handlers are attached FIRST, whatever the clock says: a `done` that rejects is always handled, also when the
    // cutoff has already passed (Astra R4: a rejection at the boundary must never be unhandled).
    Promise.resolve(handle.done).then(finish, finish);
    const left = cutoffAt - clock();
    if (left <= 0) { finish(); return; }
    timer = timers.set(finish, left);
  });

  // Exactly once: abort the piece's signal, then take the snapshot. The result is the snapshot, whatever ended the wait.
  own.controller.abort();
  for (const c of cleanups) { try { c(); } catch { /* a timer already cleared */ } }
  // The ONE local rule (plan §15.2.2): a `snapshot()` that throws, or whose value cannot be sealed read-only, is
  // `unavailable` for THIS piece; the others are untouched.
  try {
    return Object.freeze({ kind: "ok", value: deepFreeze(handle.snapshot()) }) as PreloadResult;
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
        // A source may still be writing: nothing may be certified in this run. Only a phase that certifies nothing runs.
        const writersSettled = settled.writersSettled === true;

        const absoluteAt = clock() + budgetMs;
        DEADLINES.set(root.signal, absoluteAt);
        const sealed = new Map<string, PreloadResult>();
        for (const phase of phases) {
          // A phase that has not started by the absolute time never starts.
          if (clock() >= absoluteAt) break;
          if (!writersSettled && phase.needsSettledWriters !== false) continue;
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

/**
 * A sealed result by key, as its value or null (absent or `unavailable`). `T` is the type the piece's `snapshot()`
 * returned; what comes back is that value SEALED (`Sealed<T>`: a `Date` in it is its epoch milliseconds).
 */
export function preloadValue<T>(results: PreloadResults, key: string): Sealed<T> | null {
  const r = results.get(key);
  return r && r.kind === "ok" ? (r.value as Sealed<T>) : null;
}
