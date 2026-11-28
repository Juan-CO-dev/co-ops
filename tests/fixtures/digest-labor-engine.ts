/**
 * Digests round 3, PR 4, packet E: the helpers of the pre-load runner tests and of the engine's labor-money wiring
 * tests (tests/preload-runner.test.ts, tests/report-digests-labor-engine.test.ts).
 *
 * ONE TIMELINE. A hand-rolled fake clock + fake timers (`PreloadTimers`) instead of `vi.useFakeTimers()`, so a test
 * can say "the clock crossed a deadline but the timer callback has not run yet" (`moveClockOnly`). `advance(ms)` fires
 * the due timers in order, moving the clock to each one's instant, and drains the microtasks between them.
 *
 * Everything else is controllable and recorded in ONE ordered call log: the ordinary shop facts (with a SOURCE promise
 * of their own, as `loadShopDayFacts` hands back), the catering facts, the labor-money pieces (`LaborMoneyIO`), the
 * in-memory send store (0220's partial unique index, as tests/report-digests-send.test.ts enforces it), the composers
 * (stubbed: they record what they were GIVEN; rendered bytes of the labor lines are a later packet) and the sender.
 *
 * Synthetic only: shops "Shop A" / "Shop B", made-up ids, example.com addresses. Nothing here sends or fetches.
 * This file never imports the composers at run time (the test's compose mock imports it).
 */
import type { CateringFacts, Envelope, ShopDayFacts } from "@/lib/report-digests-compose";
import type { ClaimRow, DigestAlert, DigestIO, FinishGuard, SendOutcome, PackageIO } from "@/lib/report-digests-engine";
import { DEFAULT_DIGEST_SETTINGS, type DigestSettings, type RecipientOverride, type SendLogRow } from "@/lib/report-digests-shared";
import type { PieceCtx, PieceHandle, PreloadPiece, PreloadTimers } from "@/lib/preload-runner";
import type { GmSettingsResult, HourlyLaborFacts, LaborMoneyIO, RoleLaborFacts } from "@/lib/report-digests-labor-shared";
import type { GmVisibility } from "@/lib/business-access-shared";
import type { LaborWeekGenerationRow } from "@/lib/business-report-shared";
import type { PackageRecipientRow } from "@/lib/report-package-shared";

// ── ids, days, instants ─────────────────────────────────────────────────────────────────────────

export const A = "aaaaaaaa-0000-4000-8000-000000000001";
export const B = "bbbbbbbb-0000-4000-8000-000000000002";
export const SHOP_A = { id: A, name: "Shop A" };
export const SHOP_B = { id: B, name: "Shop B" };
export const BASE = "https://ops.example.com";
/** Two business days before DST (EST, UTC−5). */
export const D0 = "2026-03-01";
export const D1 = "2026-03-02";
/** 23:30 ET on D0: the closing run of D0. */
export const CLOSING_NOW = "2026-03-02T04:30:00Z";
/** 23:30 ET on D1: a tick whose business days are [D0, D1]. */
export const TICK_NOW = "2026-03-03T04:30:00Z";
export const CLOCK_START = 1_000_000;

// ── one timeline ────────────────────────────────────────────────────────────────────────────────

/** Drain the microtask queue (and anything chained on it) without touching any timer of ours. */
export async function flush(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
}

interface Pending { at: number; seq: number; fn: () => void }

export class FakeClock {
  now: number;
  private seq = 0;
  private pending = new Map<number, Pending>();
  /** Every timer ever set: [delay asked, the instant it was set]. */
  readonly setCalls: Array<{ ms: number; at: number }> = [];
  constructor(start = CLOCK_START) { this.now = start; }
  readonly clock = (): number => this.now;
  readonly timers: PreloadTimers = {
    set: (fn, ms) => {
      const id = ++this.seq;
      this.setCalls.push({ ms, at: this.now });
      // Node's setTimeout: a non-finite or negative delay is 1 ms.
      const delay = Number.isFinite(ms) && ms >= 1 ? ms : 1;
      this.pending.set(id, { at: this.now + delay, seq: id, fn });
      return id;
    },
    clear: (h) => { this.pending.delete(h as number); },
  };
  pendingCount(): number { return this.pending.size; }
  /** The clock crosses `ms` and NO timer callback runs (they stay pending, due). */
  moveClockOnly(ms: number): void { this.now += ms; }
  /** Advance to now + ms: fire every due timer in (instant, order set) order, draining microtasks between them. */
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      await flush();
      let next: [number, Pending] | null = null;
      for (const e of this.pending) {
        if (e[1].at > target) continue;
        if (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[1].seq < next[1].seq)) next = e;
      }
      if (!next) break;
      this.pending.delete(next[0]);
      this.now = Math.max(this.now, next[1].at);
      next[1].fn();
    }
    this.now = Math.max(this.now, target);
    await flush();
  }
  /** Fire the timers already due at the current instant (after a `moveClockOnly`). */
  async fireDue(): Promise<void> { await this.advance(0); }
  /** Advance in steps until `p` settles. Rejects if it does not within `maxMs` of fake time. */
  async until<T>(p: Promise<T>, opts: { stepMs?: number; maxMs?: number } = {}): Promise<T> {
    const step = opts.stepMs ?? 250;
    const max = opts.maxMs ?? 300_000;
    let done = false;
    let value: T | undefined;
    let error: unknown = null;
    let failed = false;
    void p.then((v) => { done = true; value = v; }, (e) => { done = true; failed = true; error = e; });
    await flush();
    for (let t = 0; !done && t <= max; t += step) await this.advance(step);
    if (!done) throw new Error(`did not settle within ${max} ms of fake time`);
    if (failed) throw error;
    return value as T;
  }
}

export interface Deferred<T> { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void; settled: boolean }
export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const d = { settled: false } as Deferred<T>;
  d.promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  d.resolve = (v) => { d.settled = true; resolve(v); };
  d.reject = (e) => { d.settled = true; reject(e); };
  return d;
}

// ── the ordered call log ────────────────────────────────────────────────────────────────────────

export class CallLog {
  readonly events: Array<{ ev: string; at: number }> = [];
  constructor(private readonly clock: () => number) {}
  push(ev: string): void { this.events.push({ ev, at: this.clock() }); }
  names(): string[] { return this.events.map((e) => e.ev); }
  /** Index of the first event starting with `prefix`, -1 if none. */
  first(prefix: string): number { return this.events.findIndex((e) => e.ev.startsWith(prefix)); }
  /** Index of the last event starting with `prefix`, -1 if none. */
  last(prefix: string): number { for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i]!.ev.startsWith(prefix)) return i; return -1; }
  all(prefix: string): Array<{ ev: string; at: number; i: number }> { return this.events.map((e, i) => ({ ...e, i })).filter((e) => e.ev.startsWith(prefix)); }
  count(prefix: string): number { return this.all(prefix).length; }
  at(prefix: string): number | undefined { return this.events.find((e) => e.ev.startsWith(prefix))?.at; }
}

// ── the in-memory send store (copied from tests/report-digests-send.test.ts, plus controls) ─────

const HOLDS = new Set(["claimed", "sent", "ambiguous", "failed_ambiguous"]);
export type StoreRow = SendLogRow & { id: string; error: string | null; idempotency_key: string | null; sent_at: string | null };

export class MemStore {
  rows: StoreRow[] = [];
  now = "2026-03-01T12:00:00Z";
  private seq = 0;
  log: CallLog | null = null;
  /** The ref of the row last claimed / re-claimed: the composers and the sender run right after it, one send at a time. */
  lastRef = "";
  /** Refs whose claim is refused as a duplicate (another run holds a fresh claim the log did not show). */
  duplicateFor = new Set<string>();
  /** Refs whose claim throws. */
  throwFor = new Set<string>();
  /** Re-claims lose (another run took the row meanwhile). */
  reclaimLoses = false;
  finishes: Array<{ id: string; from: SendOutcome[]; outcome: string; error: string | null; guard?: FinishGuard }> = [];
  skips: Array<ClaimRow & { skip_reason: string }> = [];
  private key(r: ClaimRow) { return [r.recipient_ref, r.kind, r.business_day, r.revision, r.mode, r.location_id ?? ""].join("|"); }
  seed(row: Partial<StoreRow> & ClaimRow & { outcome: string }): StoreRow {
    const full: StoreRow = { skip_reason: null, attempted_at: this.now, error: null, first_attempt_at: null, provider_message_id: null, idempotency_key: null, sent_at: null, id: `seed-${++this.seq}`, ...row };
    this.rows.push(full);
    return full;
  }
  async claim(r: ClaimRow) {
    this.log?.push(`claim(${r.kind}, ${r.recipient_ref})`);
    if (this.throwFor.has(r.recipient_ref)) throw new Error("claim_failed (synthetic)");
    if (this.duplicateFor.has(r.recipient_ref)) return "duplicate" as const;
    if (this.rows.some((x) => HOLDS.has(x.outcome) && this.key(x as ClaimRow) === this.key(r))) return "duplicate" as const;
    const id = `row-${++this.seq}`;
    this.rows.push({ ...r, id, outcome: "claimed", skip_reason: null, attempted_at: this.now, error: null, first_attempt_at: null, provider_message_id: null, idempotency_key: null, sent_at: null });
    this.lastRef = r.recipient_ref;
    return { id };
  }
  async markAttempt(id: string, patch: { first_attempt_at: string; idempotency_key: string }) {
    const row = this.rows.find((x) => x.id === id && x.outcome === "claimed" && !x.first_attempt_at);
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  }
  async recordAccepted(id: string, patch: { provider_message_id: string; sent_at: string }) {
    const row = this.rows.find((x) => x.id === id && (x.outcome === "claimed" || x.outcome === "ambiguous"));
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  }
  async reclaim(id: string, patch: { attempted_at: string }, observed: { attempted_at: string }) {
    const row = this.rows.find((x) => x.id === id);
    this.log?.push(`reclaim(${row?.recipient_ref ?? id})`);
    if (this.reclaimLoses) return false;
    const ok = this.rows.find((x) => x.id === id && x.outcome === "ambiguous" && !x.provider_message_id && x.attempted_at === observed.attempted_at);
    if (!ok) return false;
    Object.assign(ok, { ...patch, outcome: "claimed" });
    this.lastRef = ok.recipient_ref;
    return true;
  }
  async finish(id: string, from: SendOutcome[], patch: { outcome: string; error?: string | null }, guard?: FinishGuard) {
    this.finishes.push({ id, from, outcome: patch.outcome, error: patch.error ?? null, guard });
    const row = this.rows.find((x) => x.id === id && (from as string[]).includes(x.outcome) &&
      (!guard?.noMessageId || !x.provider_message_id) && (!guard?.neverAttempted || !x.first_attempt_at) &&
      (!guard?.observedAttemptedAt || x.attempted_at === guard.observedAttemptedAt) &&
      (!guard?.staleBefore || Date.parse(x.attempted_at) < Date.parse(guard.staleBefore)));
    if (!row) return false;
    Object.assign(row, { outcome: patch.outcome, error: patch.error ?? null });
    return true;
  }
  async skip(r: ClaimRow & { skip_reason: string }) {
    this.skips.push(r);
    this.log?.push(`skip(${r.kind}, ${r.recipient_ref}, ${r.skip_reason})`);
    this.rows.push({ ...r, id: `row-${++this.seq}`, outcome: "skipped", attempted_at: this.now, error: null, first_attempt_at: null, provider_message_id: null, idempotency_key: null, sent_at: null });
  }
  of(outcome: string) { return this.rows.filter((r) => r.outcome === outcome); }
}

// ── the directory ───────────────────────────────────────────────────────────────────────────────

export type Who = "gm-a" | "gm-b" | "moo" | "own" | "agm" | "cat";
export interface DirOpts {
  /** Who is in the directory (default: everyone). */
  who?: readonly Who[];
  /** The flagged MoO's user id (default "moo"): "aa-moo" sorts BEFORE "gm-a", "zz-moo" after. */
  mooId?: string;
  overrides?: RecipientOverride[];
}
export const ov = (userId: string, over: Partial<RecipientOverride>): RecipientOverride =>
  ({ id: `o-${userId}`, kind: "internal", userId, email: null, displayName: userId, active: true, cateringDigest: false, shopDigest: false, locationIds: null, ...over });

/**
 * A GM of Shop A, a GM of Shop B, a MoO at Shop A flagged for Shop A's shop digest, an owner (unified), an AGM at Shop A
 * flagged for Shop A's shop digest, a catering manager at Shop A.
 */
export function directory(o: DirOpts = {}) {
  const who = new Set<Who>(o.who ?? ["gm-a", "gm-b", "moo", "own", "agm", "cat"]);
  const mooId = o.mooId ?? "moo";
  const users = [
    { key: "gm-a" as Who, u: { id: "gm-a", name: "Person A", email: "gm-a@example.com", role: "gm", language: "en", active: true }, m: [A] },
    { key: "gm-b" as Who, u: { id: "gm-b", name: "Person B", email: "gm-b@example.com", role: "gm", language: "en", active: true }, m: [B] },
    { key: "moo" as Who, u: { id: mooId, name: "Person C", email: "moo@example.com", role: "moo", language: "en", active: true }, m: [A] },
    { key: "own" as Who, u: { id: "own", name: "Person D", email: "own@example.com", role: "owner", language: "en", active: true }, m: [] },
    { key: "agm" as Who, u: { id: "agm", name: "Person E", email: "agm@example.com", role: "agm", language: "en", active: true }, m: [A] },
    { key: "cat" as Who, u: { id: "cat", name: "Person F", email: "cat@example.com", role: "catering_mgr", language: "en", active: true }, m: [A] },
  ].filter((x) => who.has(x.key));
  const overrides: RecipientOverride[] = [];
  if (who.has("moo")) overrides.push(ov(mooId, { shopDigest: true, locationIds: [A] }));
  if (who.has("agm")) overrides.push(ov("agm", { shopDigest: true }));
  for (const x of o.overrides ?? []) {
    const i = overrides.findIndex((y) => y.userId === x.userId);
    if (i >= 0) overrides[i] = x; else overrides.push(x);
  }
  return {
    dir: {
      users: users.map((x) => x.u),
      memberships: users.flatMap((x) => x.m.map((locationId) => ({ userId: x.u.id, locationId }))),
      overrides,
      locationIds: [A, B],
    },
    locations: [SHOP_A, SHOP_B],
  };
}

// ── the ordinary facts ──────────────────────────────────────────────────────────────────────────

const shopName = (id: string) => (id === A ? "A" : id === B ? "B" : id);
export const sk = (locationId: string, day: string) => `${shopName(locationId)},${day}`;

export type FactsMode = { kind: "now" } | { kind: "held"; facts: Deferred<void> } | { kind: "reject"; error?: string } | { kind: "never" } | { kind: "reject_later"; facts: Deferred<void> };
export type SourceMode = { kind: "now" } | { kind: "held"; source: Deferred<void> } | { kind: "never" };
/**
 * What a settled SOURCE resolves (post-build review, Astra R3: `FactsSource`). Default `{ writeUncertain: false }` (a
 * healthy night). `{ writeUncertain: true }` = a pull that failed or was cut; `reject` = a source that broke its
 * contract; any other value (`undefined`, `{}`) is passed through as is (the engine must fail closed on it).
 */
export type SourceResult = { kind: "value"; value: unknown } | { kind: "reject" };
export const HEALTHY_SOURCE = { writeUncertain: false } as const;

/** The ordinary shop facts: each call reads the mutable "Toast state" AT THE MOMENT IT IS CALLED (L7). */
export class FakeShopFacts {
  toast = { outAt: "out-before-T" };
  calls: Array<{ key: string; args: number; at: number }> = [];
  private factsMode = new Map<string, FactsMode>();
  private sourceMode = new Map<string, SourceMode>();
  private sourceResult = new Map<string, SourceResult>();
  produced: ShopDayFacts[] = [];
  constructor(private readonly log: CallLog, private readonly clock: () => number) {}
  holdFacts(locationId: string, day: string): Deferred<void> { const d = deferred<void>(); this.factsMode.set(sk(locationId, day), { kind: "held", facts: d }); return d; }
  /** The facts promise rejects when the deferred is released (`release.resolve()`). */
  rejectFactsLater(locationId: string, day: string): Deferred<void> { const d = deferred<void>(); this.factsMode.set(sk(locationId, day), { kind: "reject_later", facts: d }); return d; }
  rejectFacts(locationId: string, day: string): void { this.factsMode.set(sk(locationId, day), { kind: "reject" }); }
  neverFacts(locationId: string, day: string): void { this.factsMode.set(sk(locationId, day), { kind: "never" }); }
  holdSource(locationId: string, day: string): Deferred<void> { const d = deferred<void>(); this.sourceMode.set(sk(locationId, day), { kind: "held", source: d }); return d; }
  neverSource(locationId: string, day: string): void { this.sourceMode.set(sk(locationId, day), { kind: "never" }); }
  /** The source settles with `{ writeUncertain: true }` (its pull failed or was cut at its own deadline). */
  uncertainSource(locationId: string, day: string): void { this.sourceResult.set(sk(locationId, day), { kind: "value", value: { writeUncertain: true } }); }
  /** The source settles with exactly `value` (e.g. `undefined`, `{}`: not a `FactsSource`). */
  sourceResolves(locationId: string, day: string, value: unknown): void { this.sourceResult.set(sk(locationId, day), { kind: "value", value }); }
  /** The source REJECTS when it settles (a broken loader). */
  rejectSource(locationId: string, day: string): void { this.sourceResult.set(sk(locationId, day), { kind: "reject" }); }

  readonly io: DigestIO["shopFacts"] = (...args: Parameters<DigestIO["shopFacts"]>) => {
    const [location, day, onSource] = args;
    const key = sk(location.id, day);
    this.calls.push({ key, args: args.length, at: this.clock() });
    this.log.push(`shopFacts:start(${key})`);
    // Sampled NOW (the moment of the call), never later.
    const facts = { location, day, reports: [], receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [], pmFindings: null,
      toastOutAt: this.toast.outAt } as unknown as ShopDayFacts;
    this.produced.push(facts);
    const sm = this.sourceMode.get(key) ?? { kind: "now" };
    if (onSource) {
      const raw = sm.kind === "now" ? Promise.resolve() : sm.kind === "held" ? sm.source.promise : new Promise<void>(() => {});
      const result = this.sourceResult.get(key) ?? { kind: "value", value: HEALTHY_SOURCE };
      onSource(raw.then(() => {
        this.log.push(`source:settle(${key})`);
        if (result.kind === "reject") throw new Error("source_failed (synthetic)");
        return result.value as Awaited<Parameters<NonNullable<typeof onSource>>[0]>;
      }));
    }
    const fm = this.factsMode.get(key) ?? { kind: "now" };
    const settleOk = () => { this.log.push(`shopFacts:settle(${key})`); return facts; };
    const settleErr = (msg: string) => { this.log.push(`shopFacts:reject(${key})`); throw new Error(msg); };
    switch (fm.kind) {
      case "now": return Promise.resolve().then(settleOk);
      case "held": return fm.facts.promise.then(settleOk);
      case "reject": return Promise.resolve().then(() => settleErr(fm.error ?? "facts_read_failed (synthetic)"));
      case "reject_later": return fm.facts.promise.then(() => settleErr("facts_read_failed (synthetic)"));
      case "never": return new Promise<ShopDayFacts>(() => {});
    }
  };
}

export class FakeCatering {
  private mode: FactsMode = { kind: "now" };
  calls = 0;
  constructor(private readonly log: CallLog) {}
  hold(): Deferred<void> { const d = deferred<void>(); this.mode = { kind: "held", facts: d }; return d; }
  reject(): void { this.mode = { kind: "reject" }; }
  never(): void { this.mode = { kind: "never" }; }
  readonly io: DigestIO["cateringFacts"] = (today) => {
    this.calls++;
    this.log.push("cateringFacts:start");
    const facts = { today, leads: [], lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [] } as unknown as CateringFacts;
    const ok = () => { this.log.push("cateringFacts:settle"); return facts; };
    const m = this.mode;
    switch (m.kind) {
      case "now": return Promise.resolve().then(ok);
      case "held": return m.facts.promise.then(ok);
      case "reject": case "reject_later": return Promise.resolve().then(() => { this.log.push("cateringFacts:reject"); throw new Error("catering_read_failed (synthetic)"); });
      case "never": return new Promise<CateringFacts>(() => {});
    }
  };
}

// ── labor-money facts and the fake LaborMoneyIO ─────────────────────────────────────────────────

const GEN = { ot_scope: "per_shop", builder_version: "labor-v3", week_start: "2026-02-22", built_at: null, source_fingerprint: "fp" } as LaborWeekGenerationRow;

/** Hourly facts with a usable latest final day (a `roleStep`) — a marker per shop and day. */
export function hourlyFacts(locationId: string, day: string, roleStep = true): HourlyLaborFacts {
  return {
    day,
    latestFinalDay: { kind: "unavailable" },
    weekSoFar: { kind: "unavailable" },
    lastFullWeek: { kind: "updating" },
    roleStep: roleStep ? { date: `${day}-final@${shopName(locationId)}`, weekStart: "2026-02-22", generation: GEN, dayStraightCents: 12345, wageEstimated: false } : null,
  };
}
/** What a cut hourly piece certifies from an EMPTY ledger. */
export function cutHourly(day: string): HourlyLaborFacts {
  return { day, latestFinalDay: { kind: "unavailable" }, weekSoFar: { kind: "unavailable" }, lastFullWeek: { kind: "unavailable" }, roleStep: null };
}
export function roleFacts(locationId: string, day: string): RoleLaborFacts {
  return { kind: "ok", date: `${day}-final@${shopName(locationId)}`, buckets: [{ kind: "role", name: "Cook", cents: 100 }, { kind: "other", name: null, cents: 50 }], roundedSeparately: false, wageEstimated: false };
}

export type PieceBehaviour<T> =
  | { kind: "now"; value: T }
  | { kind: "after"; ms: number; value: T }
  | { kind: "never"; empty: T }
  | { kind: "throwStart" }
  | { kind: "throwSnapshot" };

export interface PieceRecord { key: string; ctx: PieceCtx; startedAt: number; snapshots: number; snapshotAt: number | null }

/** A piece with a LEDGER: a result enters only while the piece is open and its stage has not expired. */
export function fakePiece<T>(key: string, capMs: number, behaviour: PieceBehaviour<T>, hooks: {
  timers: PreloadTimers; onStart?: (ctx: PieceCtx) => void; onSnapshot?: () => void; records?: PieceRecord[]; empty?: T;
}): PreloadPiece<T> {
  return {
    key, capMs,
    start(ctx): PieceHandle<T> {
      const rec: PieceRecord = { key, ctx, startedAt: ctx.clock(), snapshots: 0, snapshotAt: null };
      hooks.records?.push(rec);
      hooks.onStart?.(ctx);
      if (behaviour.kind === "throwStart") throw new Error("piece_start_failed (synthetic)");
      let closed = false;
      let ledger: T | undefined;
      const empty = behaviour.kind === "never" ? behaviour.empty : hooks.empty;
      const accept = (v: T) => { if (!closed && !ctx.expired()) ledger = v; };
      let done: Promise<void>;
      if (behaviour.kind === "now") { accept(behaviour.value); done = Promise.resolve(); }
      else if (behaviour.kind === "after") {
        const v = behaviour.value;
        done = new Promise<void>((res) => { hooks.timers.set(() => { accept(v); res(); }, behaviour.ms); });
      } else if (behaviour.kind === "never") done = new Promise<void>(() => {});
      else done = Promise.resolve();
      return {
        done,
        snapshot: () => {
          rec.snapshots++;
          rec.snapshotAt = ctx.clock();
          hooks.onSnapshot?.();
          if (behaviour.kind === "throwSnapshot") throw new Error("snapshot_failed (synthetic)");
          closed = true;
          return (ledger ?? empty) as T;
        },
      };
    },
  };
}

export class FakeLabor {
  settingsBehaviour: PieceBehaviour<GmSettingsResult> = { kind: "now", value: { kind: "settings", settings: null } };
  hourlyBehaviour = new Map<string, PieceBehaviour<HourlyLaborFacts>>();
  rolesBehaviour = new Map<string, PieceBehaviour<RoleLaborFacts>>();
  /** Declared caps (the runner clamps them). */
  caps = { settings: 3_000, hourly: 10_000, roles: 3_000 };
  hourlyThrows = false;
  settingsThrows = false;
  /** `lm.roles()` throws synchronously (while phase C's pieces are built). */
  rolesThrows = false;
  records: PieceRecord[] = [];
  starts = 0;
  constructor(private readonly log: CallLog, private readonly clockObj: FakeClock) {}
  setGm(settings: GmVisibility | null): void { this.settingsBehaviour = { kind: "now", value: { kind: "settings", settings } }; }
  hourlyOf(locationId: string, day: string): PieceBehaviour<HourlyLaborFacts> { return this.hourlyBehaviour.get(sk(locationId, day)) ?? { kind: "now", value: hourlyFacts(locationId, day) }; }
  rolesOf(locationId: string, day: string): PieceBehaviour<RoleLaborFacts> { return this.rolesBehaviour.get(sk(locationId, day)) ?? { kind: "now", value: roleFacts(locationId, day) }; }
  private hooks(name: string) {
    return {
      timers: this.clockObj.timers, records: this.records,
      onStart: () => { this.starts++; this.log.push(`${name}:start`); },
      onSnapshot: () => { this.log.push(`snapshot(${name})`); },
    };
  }
  readonly io: LaborMoneyIO = {
    clock: () => this.clockObj.now,
    timers: this.clockObj.timers,
    settings: () => {
      if (this.settingsThrows) throw new Error("settings_piece_failed (synthetic)");
      return fakePiece("settings", this.caps.settings, this.settingsBehaviour, { ...this.hooks("settings"), empty: { kind: "unavailable" } });
    },
    hourly: (locationId, day) => {
      if (this.hourlyThrows) throw new Error("hourly_piece_failed (synthetic)");
      return fakePiece(`hourly(${sk(locationId, day)})`, this.caps.hourly, this.hourlyOf(locationId, day), { ...this.hooks(`hourly(${sk(locationId, day)})`), empty: cutHourly(day) });
    },
    roles: (locationId, day, hourly) => {
      if (this.rolesThrows) throw new Error("roles_piece_failed (synthetic)");
      this.log.push(`roles:given(${sk(locationId, day)}, ${hourly.roleStep?.date ?? "none"})`);
      return fakePiece(`roles(${sk(locationId, day)})`, this.caps.roles, this.rolesOf(locationId, day), { ...this.hooks(`roles(${sk(locationId, day)})`), empty: { kind: "unavailable" } });
    },
  };
}

// ── the composers (stubbed) and the harness ─────────────────────────────────────────────────────

export interface ComposeRecord { kind: "shop" | "unified" | "catering" | "package"; ref: string; env: Envelope; facts: unknown; at: number; startsAtCompose: number }

let ACTIVE: Harness | null = null;

/** What the test's `vi.mock("@/lib/report-digests-compose")` returns: three renderers that record what they are GIVEN. */
export function composeModuleStub() {
  const rec = (kind: ComposeRecord["kind"], facts: unknown, env: Envelope) => {
    const h = ACTIVE;
    if (!h) throw new Error("no active harness");
    h.composes.push({ kind, ref: h.store.lastRef, env, facts, at: h.clock.now, startsAtCompose: h.labor.starts });
    h.log.push(`compose(${kind}, ${h.store.lastRef})`);
    const shop = kind === "shop" ? (facts as ShopDayFacts).location.name : kind;
    return { subject: `${kind} ${shop} ${(facts as { day?: string; today?: string }).day ?? (facts as { today?: string }).today ?? ""}`, html: stableText(facts, env), text: stableText(facts, env) };
  };
  return {
    renderShopDigest: (f: ShopDayFacts, env: Envelope) => rec("shop", f, env),
    renderUnifiedDigest: (a: { day: string; notFinalized: unknown; shops: ShopDayFacts[] }, env: Envelope) => rec("unified", a, env),
    renderCateringDigest: (f: CateringFacts, _scope: unknown, env: Envelope) => rec("catering", f, env),
  };
}

/** A deterministic rendering of exactly what a composer was given (the store's functions shown as a marker). */
export function stableText(facts: unknown, env: Envelope): string {
  return JSON.stringify({ facts, env: { ...env, laborMoney: env.laborMoney === undefined ? undefined : env.laborMoney === null ? null : "store" } });
}

export interface HarnessOpts {
  now: string;
  switchOn?: boolean;
  dir?: DirOpts;
  finalized?: Readonly<Record<string, readonly string[]>>;
  settings?: Partial<DigestSettings>;
  store?: MemStore;
  /** Rows returned by sendLog INSTEAD of the store's own (a stale snapshot). */
  sendLog?: SendLogRow[];
  packages?: boolean;
}

export interface Harness {
  io: DigestIO; clock: FakeClock; log: CallLog; store: MemStore; shop: FakeShopFacts; catering: FakeCatering; labor: FakeLabor;
  composes: ComposeRecord[]; sent: Array<{ to: string; subject: string; text: string; ref: string; at: number }>;
  alerts: DigestAlert[]; runs: unknown[];
  envOf(ref: string, kind?: ComposeRecord["kind"]): ComposeRecord[];
}

export function harness(o: HarnessOpts): Harness {
  const clock = new FakeClock();
  const log = new CallLog(clock.clock);
  const store = o.store ?? new MemStore();
  store.log = log;
  store.now = new Date(o.now).toISOString();
  const shop = new FakeShopFacts(log, clock.clock);
  const catering = new FakeCatering(log);
  const labor = new FakeLabor(log, clock);
  const composes: ComposeRecord[] = [];
  const sent: Harness["sent"] = [];
  const alerts: DigestAlert[] = [];
  const runs: unknown[] = [];
  const d = directory(o.dir);
  const packageIO: PackageIO = {
    recipients: async () => [{ id: "p1", kind: "internal", user_id: "own", email: null, display_name: "own", active: true, location_ids: null, packages: ["sales"], cadence: "daily_close", formats: ["csv"] } satisfies PackageRecipientRow],
    compose: async (r, cadence, day, env) => {
      composes.push({ kind: "package", ref: r.ref, env, facts: { cadence, day }, at: clock.now, startsAtCompose: labor.starts });
      log.push(`compose(package, ${r.ref})`);
      return { subject: `package ${day}`, html: "p", text: "p" };
    },
    recordSend: async () => {},
  };
  const io: DigestIO = {
    now: new Date(o.now), baseUrl: BASE,
    previewRecipient: async () => "operator@example.com",
    settings: async () => ({ ...DEFAULT_DIGEST_SETTINGS, mode: "live", ...o.settings }),
    directory: async () => d,
    sendLog: async (days) => (o.sendLog ?? store.rows).filter((r) => days.includes(r.business_day)).map((r) => ({ ...r })),
    finalizedClosings: async (days) => new Map(days.map((day) => [day, new Set(o.finalized?.[day] ?? [])])),
    shopFacts: shop.io,
    cateringFacts: catering.io,
    store,
    sendEmail: async (m) => {
      sent.push({ to: m.to, subject: m.subject, text: m.text, ref: store.lastRef, at: clock.now });
      log.push(`sendEmail(${store.lastRef})`);
      return { id: `mail-${sent.length}` };
    },
    sha: (c) => String(c.length),
    alert: async (a) => { alerts.push(a); return true; },
    recordRun: async (s) => { runs.push(s); },
    ...(o.packages ? { packages: packageIO } : {}),
    ...(o.switchOn ? { laborMoney: labor.io } : {}),
  };
  const h: Harness = {
    io, clock, log, store, shop, catering, labor, composes, sent, alerts, runs,
    envOf: (ref, kind) => composes.filter((c) => c.ref === ref && (!kind || c.kind === kind)),
  };
  ACTIVE = h;
  return h;
}

export const ref = (id: string) => `user:${id}`;
