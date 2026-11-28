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
 *
 * THREAT MODEL (CC ruling H0, fix round 4; binding). Pieces are first-party, reviewed TypeScript in this repo. The runner
 * contains HONEST failures: a piece that throws, rejects, hangs, or returns data it should not. It does NOT defend
 * against hostile objects: Proxies with throwing traps, null-prototype or re-prototyped Promises / Maps / Dates, custom
 * thenables with a hostile `then`, a spoofed `Symbol.toStringTag`, rejected promises thrown as exception values,
 * pathological getters. Those are out of scope.
 *
 * HONEST ASYNC FAILURES ARE CONTAINED (H1), with the platform's own promise adoption and nothing hand-written:
 *   - what a phase's `pieces()` returns (and each entry of that list) and what a piece's `start()` returns go through
 *     `Promise.resolve(...)` with a handler, inside the try: an `async` function there by mistake that rejects is
 *     never an unhandled rejection. A promise is no list and no handle: a throw inside the pre-load, as above;
 *   - the handle's `done` and `snapshot` are each READ ONCE, into locals;
 *   - the wait is `Promise.resolve(done)` (so whatever `done` fulfils with is adopted too) raced with the cutoff;
 *   - the seal never calls a `then`. A native promise it finds (`instanceof Promise`) gets
 *     `Promise.prototype.catch.call(p, noop)` and makes the piece `unavailable`; any other object with a `then`
 *     property makes the piece `unavailable` and is not touched.
 *
 * THE SEAL = JSON-SAFE DATA ONLY (H2). `snapshot()` must return plain data: plain objects (prototype exactly
 * `Object.prototype`) and arrays (prototype exactly `Array.prototype`) of strings, finite numbers, booleans and null.
 * A `Date` (`instanceof Date`, read with `Date.prototype.getTime.call`) becomes its EPOCH MILLISECONDS, a number
 * (`Sealed<T>` is what a snapshot of type `T` reads as). The seal reads OWN properties through their descriptors (it
 * never runs a getter), builds a FRESH copy and deep-freezes it; it never freezes, and never writes into, what the
 * piece handed back. A record's property whose value is `undefined` is left out of the copy, as JSON leaves it out.
 * Everything else makes THAT piece `unavailable` (fail closed), and the seal does not look inside it:
 *   - an accessor; a non-enumerable property (an array's own `length` aside); a symbol key; a `then` key;
 *   - a `Map`, a `Set`, a class instance, a null-prototype object, a function, a symbol, a bigint, `NaN` / `Infinity`
 *     (an invalid `Date` included), `undefined` at the top or in an array, a hole in an array, an array with any
 *     property that is not one of its elements;
 *   - more than `SEAL_MAX_DEPTH` (32) levels of nesting or more than `SEAL_MAX_NODES` (10,000) values: the walk is a
 *     loop over an explicit stack (no recursion to overflow) and stops at the cap. A value that refers to itself runs
 *     into the depth cap; a value referenced twice is copied twice (a sealed value is a tree, as JSON is).
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

/**
 * `done` settles when the piece has nothing more to do; `snapshot()` closes its ledger and certifies from it. What
 * `snapshot()` returns must be JSON-safe data (see THE SEAL in the header); anything else is `unavailable`.
 */
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
 * keeps its type. It is never the producer's own object: the seal hands out a fresh, deep-frozen copy (H2).
 */
export type Sealed<T> =
  T extends Date ? number
    : T extends (...args: never[]) => unknown ? T
      : T extends object ? { [K in keyof T]: Sealed<T[K]> }
        : T;

const noop = (): void => undefined;
const PROMISE_CATCH = Promise.prototype.catch;
const DATE_EPOCH = Date.prototype.getTime;
/** H2: a value nested inside more than this many records / arrays is not sealed. */
const SEAL_MAX_DEPTH = 32;
/** H2: a snapshot of more than this many values (the top one, every property value, every array element) is not sealed. */
const SEAL_MAX_NODES = 10_000;
const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;

/**
 * THE SEAL OF ONE SNAPSHOT (H1 + H2; see the header): `ok` with a fresh deep-frozen copy of JSON-safe data, or
 * `unavailable` when anything in the value is not that. A loop over an explicit stack: no recursion. A refusal does not
 * stop the walk (a second promise further on still gets its handler); a cap does. Never throws, never calls a `then`,
 * never runs a getter, and never writes into `value` or anything it holds.
 */
function sealSnapshot(value: unknown): PreloadResult {
  try {
    let refused = false;
    let capped = false;
    let nodes = 0;
    const todo: Array<{ from: object; into: object; depth: number }> = [];
    /** The sealed form of ONE value: itself (a primitive), its epoch (a Date) or a fresh copy still to be filled. */
    const sealed = (v: unknown, depth: number): unknown => {
      nodes += 1;
      if (nodes > SEAL_MAX_NODES || depth > SEAL_MAX_DEPTH) { capped = true; return undefined; }
      if (v === null || typeof v === "string" || typeof v === "boolean") return v;
      if (typeof v === "number") { if (!Number.isFinite(v)) refused = true; return v; }
      // undefined, a function, a symbol, a bigint.
      if (typeof v !== "object") { refused = true; return undefined; }
      // A promise is not data. Its rejection gets a handler, so it is never an `unhandledRejection`.
      if (v instanceof Promise) { void PROMISE_CATCH.call(v, noop); refused = true; return undefined; }
      if (v instanceof Date) {
        let epoch = Number.NaN;
        try { epoch = DATE_EPOCH.call(v); } catch { /* not a real Date */ }
        if (!Number.isFinite(epoch)) refused = true;
        return epoch;
      }
      const isArray = Array.isArray(v);
      // A Map, a Set, a class instance, a null-prototype object: refused, and not looked into.
      if (Object.getPrototypeOf(v) !== (isArray ? Array.prototype : Object.prototype)) { refused = true; return undefined; }
      // An array longer than what is left of the node cap can never be sealed: its keys are not even listed.
      if (isArray && v.length > SEAL_MAX_NODES - nodes) { capped = true; return undefined; }
      const into: object = isArray ? [] : {};
      todo.push({ from: v, into, depth });
      return into;
    };

    const top = sealed(value, 0);
    while (todo.length > 0 && !capped) {
      const { from, into, depth } = todo.pop()!;
      const length = Array.isArray(from) ? from.length : -1;
      let elements = 0;
      for (const k of Reflect.ownKeys(from)) {
        if (capped) break;
        if (length >= 0 && k === "length") continue;
        const d = Object.getOwnPropertyDescriptor(from, k);
        if (!d) continue;
        // An accessor is code, not data: never run.
        if (!("value" in d)) { refused = true; continue; }
        const isElement = length >= 0 && typeof k === "string" && ARRAY_INDEX.test(k) && Number(k) < length;
        // What JSON would not carry (a symbol key, a non-enumerable property, a property of an array that is not an
        // element) and anything with a `then`: refused. Its value is still walked, for a promise in it.
        const carried = typeof k === "string" && k !== "then" && d.enumerable === true && (length < 0 || isElement);
        if (!carried) refused = true;
        // A record's undefined property is no property (JSON). In an array it is refused, by `sealed`.
        if (d.value === undefined && !isElement) continue;
        const child = sealed(d.value, depth + 1);
        if (isElement) elements += 1;
        // `defineProperty`, never an assignment: an own key named `__proto__` must stay a key of the copy.
        if (carried) Object.defineProperty(into, k, { value: child, writable: true, enumerable: true, configurable: true });
      }
      // A hole in an array.
      if (length >= 0 && elements !== length) refused = true;
      Object.freeze(into);
    }
    return refused || capped ? UNAVAILABLE : Object.freeze({ kind: "ok", value: top });
  } catch {
    return UNAVAILABLE;
  }
}

/** THE SEAL: a read-only view over a private copy. Nothing outside this function holds the Map. */
function seal(results: ReadonlyMap<string, PreloadResult>): PreloadResults {
  // Every value is a deep-frozen copy made when its piece was snapshotted (`sealSnapshot`).
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
  let handle: object;
  let snapshot: (this: unknown) => unknown;
  /** Settles when `done` does, either way; never rejects. */
  let settled: Promise<void>;
  try {
    const returned: unknown = piece.start(ctx);
    // H1: what `start()` handed back goes through `Promise.resolve` with a handler. An `async start()` by mistake that
    // rejects is then never an unhandled rejection; a promise is never a handle (refused just below).
    void Promise.resolve(returned).catch(noop);
    const fields = (typeof returned === "object" && returned !== null) || typeof returned === "function" ? (returned as { done?: unknown; snapshot?: unknown; then?: unknown }) : null;
    // H1: `done` and `snapshot` are each READ exactly ONCE, here, into locals (a lazy getter runs a single time).
    const done: unknown = fields === null ? undefined : fields.done;
    const snap: unknown = fields === null ? undefined : fields.snapshot;
    // H1: the wait is `Promise.resolve(done)`: the platform adopts `done` AND whatever it fulfils with. The handlers
    // are attached here, BEFORE the handle is judged: a handle refused on the next line whose `done` rejects is handled.
    settled = Promise.resolve(done).then(noop, noop);
    if (fields === null || typeof returned !== "object" || returned instanceof Promise || typeof fields.then === "function" || typeof snap !== "function") throw new Error("preload_bad_piece_handle");
    handle = fields;
    snapshot = snap as (this: unknown) => unknown;
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
    // `done` already has its handlers (above), whatever the clock says: a `done` that rejects is always handled, also
    // when the cutoff has already passed (Astra R4: a rejection at the boundary must never be unhandled).
    void settled.then(finish);
    const left = cutoffAt - clock();
    if (left <= 0) { finish(); return; }
    timer = timers.set(finish, left);
  });

  // Exactly once: abort the piece's signal, then take the snapshot. The result is the snapshot, whatever ended the wait.
  own.controller.abort();
  for (const c of cleanups) { try { c(); } catch { /* a timer already cleared */ } }
  // The ONE local rule (plan §15.2.2): a `snapshot()` that throws, or whose value is not JSON-safe data, is
  // `unavailable` for THIS piece; the others are untouched.
  let value: unknown;
  try { value = snapshot.call(handle); } catch { return UNAVAILABLE; }
  // H2: a fresh deep-frozen copy of JSON-safe data, or `unavailable`; the seal never throws.
  return sealSnapshot(value);
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
          const listed: unknown = phase.pieces(seal(sealed), due);
          // H1: an `async pieces()` by mistake that rejects is never an unhandled rejection; neither is a promise put
          // in the list where a piece belongs. A promise is no list and no piece: a throw inside the pre-load (O-N3).
          void Promise.resolve(listed).catch(noop);
          if (!Array.isArray(listed)) throw new Error("preload_bad_pieces");
          const pieces = listed as PreloadPiece<unknown>[];
          for (const p of pieces) void Promise.resolve(p).catch(noop);
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
