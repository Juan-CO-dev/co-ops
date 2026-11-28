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
 * NO REJECTION A PIECE HANDS OVER IS LEFT WITHOUT A HANDLER (fix round 3, E1; by class, not by case). Three values
 * come back from a piece, and each gets a handler before anything else is done with it:
 *   - what `start()` returns, WHATEVER it is. A promise or a thenable there (an `async start()` by mistake) is given a
 *     handler first and is then no handle at all: a throw inside the pre-load, like any other bad handle;
 *   - the handle's `done`, READ ONCE into a local and SUBSCRIBED ONCE (a lazy getter or a cold thenable starts its work
 *     a single time). That one subscription is both the handler and the wait;
 *   - the snapshot VALUE: the seal walks ALL of it and gives a handler to EVERY promise and thenable it meets (in a
 *     record, an array, a `Map`, a `Set`, a class instance, at any depth) BEFORE it decides. It never stops at the
 *     first thing it refuses. Finding one makes that piece `unavailable`.
 * A native promise is recognised by its internal slot (so one whose `then` was replaced is still handled).
 * The limit, stated: the runner can only handle a promise it is HANDED as data. One that a piece keeps to itself (in a
 * closure, behind a getter or a function, which the seal never runs) or deliberately disguises (a promise whose own
 * `constructor` throws cannot be subscribed by any code; one whose prototype was swapped for a plain object's reads
 * as an empty record) is the piece's own, like a rejected promise it simply dropped.
 *
 * SEALED = READ-ONLY, FOR REAL (fix round 3, E2). The seal never freezes, and never writes into, the object a piece
 * hands back. It builds a FRESH copy (plain objects and arrays only) from the OWN ENUMERABLE DATA properties, reading
 * each property once, and deep-freezes the copy. So nothing the producer still holds can reach a sealed value, and the
 * producer's own object is exactly as it was. In the copy:
 *   - a `Date` (by its internal slot, at any depth, whatever holds it) is its EPOCH MILLISECONDS, a number: `Sealed<T>`
 *     is what a snapshot of type `T` reads as;
 *   - an ACCESSOR property is code, not data (what it answers can change after the seal): it is never run and the piece
 *     is `unavailable`;
 *   - anything that is not a primitive, a plain object, an array or a Date (a `Map`, a `Set`, a promise, a thenable, a
 *     function, a class instance) makes the piece `unavailable`. Fail closed.
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
 * keeps its type. It is never the producer's own object: the seal hands out a fresh, deep-frozen copy (E2).
 */
export type Sealed<T> =
  T extends Date ? number
    : T extends (...args: never[]) => unknown ? T
      : T extends object ? { [K in keyof T]: Sealed<T[K]> }
        : T;

const noop = (): void => undefined;
// The intrinsics, taken once: each checks the INTERNAL SLOT of its receiver (it throws for anything else), whatever
// the object's prototype or own properties say.
const NATIVE_THEN = Promise.prototype.then;
const DATE_EPOCH = Date.prototype.getTime;
const MAP_EACH = Map.prototype.forEach;
const SET_EACH = Set.prototype.forEach;

const isObjectLike = (v: unknown): v is object => (typeof v === "object" && v !== null) || typeof v === "function";

/**
 * E1. Gives `v` a handler when it is a promise or a thenable, and says whether it was one. `fn` runs when `v` settles
 * EITHER way, so a rejection of `v` always has a handler and can never be an `unhandledRejection`. `v` is subscribed
 * exactly ONCE and its `then` is read at most once. Never throws: a thenable whose `then` (or whose getter for it)
 * throws counts as settled, and `fn` runs at once. `fn` may run more than once (a careless thenable): pass one that
 * does not mind.
 */
function attach(v: unknown, fn: () => void): boolean {
  if (!isObjectLike(v)) return false;
  // A native promise, by its internal slot: handled even when its own `then` was replaced or its prototype changed.
  try { NATIVE_THEN.call(v as Promise<unknown>, fn, fn); return true; } catch { /* not a native promise */ }
  let then: unknown;
  try { then = (v as { then?: unknown }).then; } catch { fn(); return true; }
  if (typeof then !== "function") return false;
  try { (then as (this: unknown, a: () => void, b: () => void) => unknown).call(v, fn, fn); } catch { fn(); }
  return true;
}

/** The epoch milliseconds of a `Date` (by its internal slot: a subclass and another realm's Date count), else null. */
function epochOf(v: object): number | null {
  try { return DATE_EPOCH.call(v as Date); } catch { return null; }
}

interface SealWalk {
  /** Something in the value cannot be part of a sealed result. Decided only after the WHOLE value was walked. */
  refused: boolean;
  /** Each object already met → its copy (so a shared or cyclic reference is copied once). */
  copies: Map<object, unknown>;
}

/**
 * Walks the OWN properties of `source`, each read ONCE through its descriptor (an accessor is never run). Every data
 * value is walked (so a promise in it gets its handler) and, when `into` is given, every ENUMERABLE one is defined on
 * the copy. Never throws: a property that cannot be read refuses the value and the walk goes on with the next one.
 */
function walkOwn(source: object, into: object | null, walk: SealWalk): void {
  let keys: Array<string | symbol>;
  try { keys = Reflect.ownKeys(source); } catch { walk.refused = true; return; }
  const intoArray = into !== null && Array.isArray(into);
  for (const k of keys) {
    try {
      const d = Object.getOwnPropertyDescriptor(source, k);
      if (!d) continue;
      // An accessor is code, not data: what it answers can change after the seal. Never run; the value is refused.
      if (!("value" in d)) { walk.refused = true; continue; }
      if (intoArray && k === "length") { (into as unknown[]).length = d.value as number; continue; }
      // A plain record or array that carries its own `then` function is a thenable: it gets its handler here (anything
      // not plain went through `attach` in `sealNode`), and the function value refuses the value just below.
      if (into !== null && k === "then" && typeof d.value === "function") {
        try { (d.value as (this: unknown, a: () => void, b: () => void) => unknown).call(source, noop, noop); } catch { /* it threw: nothing to wait for */ }
      }
      const child = sealNode(d.value, walk);
      // `defineProperty`, never an assignment: an own key named `__proto__` must stay a key of the copy.
      if (into !== null && d.enumerable === true) Object.defineProperty(into, k, { value: child, writable: true, enumerable: true, configurable: true });
    } catch { walk.refused = true; }
  }
}

/**
 * One node of the seal (E1 + E2): returns the node's SEALED COPY, or marks the walk refused. It never throws and never
 * stops early: a node it refuses is still walked to its end, so every promise beneath it gets a handler.
 */
function sealNode(v: unknown, walk: SealWalk): unknown {
  if (!isObjectLike(v)) return v;
  if (walk.copies.has(v)) return walk.copies.get(v);
  walk.copies.set(v, undefined);
  try {
    const proto: unknown = Object.getPrototypeOf(v);
    const isArray = Array.isArray(v);
    const plain = typeof v === "object" && (isArray ? proto === Array.prototype : proto === null || proto === Object.prototype);
    if (plain) {
      const copy: object = isArray ? [] : {};
      walk.copies.set(v, copy);
      walkOwn(v, copy, walk);
      return Object.freeze(copy);
    }
    // Not plain. A promise or a thenable: handled FIRST, then refused (a Date that carries a `then` included) …
    const epoch = attach(v, noop) ? null : epochOf(v);
    // … a Date …
    if (epoch !== null) {
      // The Date is its epoch number in the copy. (Its own properties are not data of the copy, but a promise among
      // them still gets its handler.)
      walk.copies.set(v, epoch);
      walkOwn(v, null, walk);
      return epoch;
    }
    // … or anything else (a Map, a Set, a function, a class instance): refused, and walked to its end all the same.
    walk.refused = true;
    try { MAP_EACH.call(v as Map<unknown, unknown>, (value, key) => { sealNode(key, walk); sealNode(value, walk); }); } catch { /* not a Map */ }
    try { SET_EACH.call(v as Set<unknown>, (value) => { sealNode(value, walk); }); } catch { /* not a Set */ }
    walkOwn(v, null, walk);
    return undefined;
  } catch {
    walk.refused = true;
    return undefined;
  }
}

/**
 * THE SEAL OF ONE SNAPSHOT (E2). Walks the whole value first, THEN decides: `ok` with a fresh deep-frozen copy, or
 * `unavailable` when anything in it was refused. Never throws, and never writes into `value` or anything it holds.
 */
function sealSnapshot(value: unknown): PreloadResult {
  const walk: SealWalk = { refused: false, copies: new Map() };
  const copy = sealNode(value, walk);
  return walk.refused ? UNAVAILABLE : Object.freeze({ kind: "ok", value: copy });
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
  let handle: PieceHandle<unknown>;
  // `done` has settled (either way). Until the wait below takes it over, a settlement is only remembered.
  let doneSettled = false;
  let onDone = (): void => { doneSettled = true; };
  try {
    const returned: unknown = piece.start(ctx);
    // E1: WHATEVER `start()` handed back gets a handler before anything else is looked at. A promise or a thenable
    // there (an `async start()` by mistake) may reject; it is never a handle.
    const promiseLike = attach(returned, noop);
    // E1: `done` is READ exactly ONCE, into this local, and SUBSCRIBED exactly once, here, before the handle is judged:
    // a handle refused just below whose `done` rejects already has its handler. This one subscription is also the wait
    // (so a lazy getter or a cold thenable never starts its work twice). A `done` that is no promise is settled.
    const done: unknown = isObjectLike(returned) ? (returned as { done?: unknown }).done : undefined;
    if (!attach(done, () => onDone())) void Promise.resolve().then(() => onDone());
    if (promiseLike || returned === null || typeof returned !== "object" || typeof (returned as { snapshot?: unknown }).snapshot !== "function") throw new Error("preload_bad_piece_handle");
    handle = returned as PieceHandle<unknown>;
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
    // The handlers were attached to `done` FIRST (above), whatever the clock says: a `done` that rejects is always
    // handled, also when the cutoff has already passed (Astra R4: a rejection at the boundary must never be unhandled).
    onDone = finish;
    if (doneSettled) { finish(); return; }
    const left = cutoffAt - clock();
    if (left <= 0) { finish(); return; }
    timer = timers.set(finish, left);
  });

  // Exactly once: abort the piece's signal, then take the snapshot. The result is the snapshot, whatever ended the wait.
  own.controller.abort();
  for (const c of cleanups) { try { c(); } catch { /* a timer already cleared */ } }
  // The ONE local rule (plan §15.2.2): a `snapshot()` that throws, or whose value cannot be sealed read-only, is
  // `unavailable` for THIS piece; the others are untouched.
  let value: unknown;
  try { value = handle.snapshot(); } catch { return UNAVAILABLE; }
  // E1 + E2: the seal walks the WHOLE value (every promise in it gets a handler), then decides; it never throws.
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
