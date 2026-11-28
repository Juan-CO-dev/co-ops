/**
 * Digests round 3, PR 4, packet T: the END-TO-END harness of the labor-money digests. The REAL engine
 * (lib/report-digests-engine.ts) runs the REAL pre-load pieces (lib/business-labor-core.ts, the settings piece) over a
 * fake labor database, and the REAL composers (`renderShopDigest` / `renderUnifiedDigest` / `renderCateringDigest`)
 * write the emails the in-memory sender captures, byte for byte.
 *
 * ONE TIMELINE. The fake clock and timers of tests/fixtures/digest-labor-engine.ts drive the runner, the phase-0
 * budget, every held or delayed database answer and the Toast change of the L7 case (`toastChangeAt`).
 *
 * THE FAKE LABOR DATABASE. The business report's own fake client (tests/helpers/business-report-fake.ts: real rows
 * for coverage, fingerprints, sales, fact_labor_cost, the GM visibility row) wrapped so every request is COUNTED (name,
 * shop, time, signal, `.retry(false)`) and can be held (never settles). The current payroll week's fingerprint
 * follows the fake "Toast state": once a pull or the L7 change moves an `out_at` of that week, the stored
 * fingerprint no longer equals the current one (`toastChanged`).
 *
 * THE ORDINARY FACTS. `shopFacts` hands back its SOURCE promise (the digest's own pull) as `loadShopDayFacts` does;
 * the facts are sampled from the Toast state at the moment the pull ends, so a load at a later moment would show it.
 * Unchanged, a shop's facts are exactly the switch-off golden's (tests/fixtures/digest-labor-goldens/cases.ts).
 *
 * Synthetic only: shops "Shop A" / "Shop B", people "Person A" … "Person G", made-up ids, example.com addresses.
 * Nothing here sends, fetches or reads a database. Used by tests/report-digests-labor-e2e.test.ts and
 * scripts/render-digest-labor-samples.ts.
 */
import { hourlyLaborPiece, roleLaborPiece, type LaborCoreDeps } from "@/lib/business-labor-core";
import { readGmVisibility } from "@/lib/business-report";
import type { DigestIO, DigestRunSummary } from "@/lib/report-digests-engine";
import { runClosingDigestsWith, runDigestTickWith } from "@/lib/report-digests-engine";
import { DEFAULT_DIGEST_SETTINGS, type DigestSettings, type RecipientOverride } from "@/lib/report-digests-shared";
import {
  LABOR_SETTINGS_CAP_MS, LABOR_SETTINGS_KEY, type GmSettingsResult, type LaborMoneyIO,
} from "@/lib/report-digests-labor-shared";
import type { CateringFacts, ShopDayFacts } from "@/lib/report-digests-compose";
import type { PieceHandle, PreloadPiece } from "@/lib/preload-runner";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { ok, unavailable } from "@/lib/report-digests-v2-shared";
import { CallLog, FakeClock, MemStore, deferred, type Deferred } from "./digest-labor-engine";
import { fakeClient, type FakeOpts, type VisibilityAnswer } from "../helpers/business-report-fake";
import { A, B, BASE, D, D1, SHOP_A, SHOP_B, cateringFacts, fullDay, labor, schedule, shopFacts, tomorrowDay } from "./digest-staffing";

export { A, B, BASE, D, D1, SHOP_A, SHOP_B };

// ── days and instants ────────────────────────────────────────────────────────────────────────────

/** D = Wed 2026-10-07 (EDT). D's payroll week starts Sun 10-04; the one before it Sun 09-27. */
export const WD = "2026-10-04";
export const WP = "2026-09-27";
/** D − 1: the latest final day on a healthy night. */
export const LATEST = "2026-10-06";
/** The Saturday that closes the previous payroll week (the latest final day when D's week is not usable). */
export const LAST_SAT = "2026-10-03";
/** D − 1 as a business day of a tick. */
export const DM1 = "2026-10-06";
/** 23:30 ET on D: the closing run of D, and a tick whose business days are [D − 1, D]. */
export const NIGHT = "2026-10-08T03:30:00Z";
export const FP = "f".repeat(32);
export const ON4 = { DIGEST_LABOR_MONEY: "1", BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" } as const;

const ready = (week_start: string) => ({ week_start, ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-10-07T05:00:00.000Z", source_fingerprint: FP });

/** Four hourly people on the latest final day (2 × $3.00 "Line", 2 × $1.50 "Prep" = the day's $9.00). */
export const ROLE_PEOPLE = [
  { week_start: WD, person_key: "k1", user_id: null, person_label: "Person A", role_key: 11, source: "7shifts", pay_class: "hourly", minutes: 60, ot_minutes: 0, straight_cents: 300 },
  { week_start: WD, person_key: "k2", user_id: null, person_label: "Person B", role_key: 11, source: "7shifts", pay_class: "hourly", minutes: 60, ot_minutes: 0, straight_cents: 300 },
  { week_start: WD, person_key: "k3", user_id: null, person_label: "Person C", role_key: 12, source: "7shifts", pay_class: "hourly", minutes: 60, ot_minutes: 0, straight_cents: 150 },
  { week_start: WD, person_key: "k4", user_id: null, person_label: "Person D", role_key: 12, source: "7shifts", pay_class: "hourly", minutes: 60, ot_minutes: 0, straight_cents: 150 },
];
export const ROLE_NAMES = [{ id: 11, name: "Line" }, { id: 12, name: "Prep" }];
/** A stored salary so fully loaded prices. */
export const SALARY = { salaried_cents: 4_000, salary_basis: "wages", salaried_people: 1 };

// ── the fake labor database ──────────────────────────────────────────────────────────────────────

export type Req = {
  kind: "rpc" | "table"; name: string; args: Record<string, unknown>; filters: Record<string, unknown>; range?: [number, number];
  signal?: AbortSignal; retry?: boolean; at: number; seq: number;
  /** The shared time entry's stored `out_at` at the moment the request was sent (A4-3: what a labor read sees). */
  outAt: string;
  /** The shop a request is about (`p_location_id` or an `eq` on location_id); null = a shared read (coverage, fingerprint). */
  shop: string | null;
};
type Answer = { data: unknown; error?: unknown; count?: number };
export type Respond = (r: Req) => undefined | "hang" | { delayMs: number } | { rows: unknown[] } | { answer: Answer };

export interface LaborDbOpts {
  /** Merged into every fact_labor_cost row (per call args). */
  laborCostRow?: (args: Record<string, unknown>) => Record<string, unknown>;
  /** What each read of the GM visibility row answers (default: no row saved = the defaults). */
  visibility?: ReadonlyArray<VisibilityAnswer>;
  /** Extra answers, first match wins (before the built-in stalls). */
  respond?: Respond;
}

export class LaborDb {
  /** An `out_at` of D's payroll week moved after the last build (by the digest's own pull, or at T). */
  toastChanged = false;
  /** Shops whose shop-bearing reads (sales, structures, fact_labor_cost) never settle. */
  readonly stalled = new Set<string>();
  /** The role step's people and role-name reads never settle. */
  stallRoles = false;
  /** The role step's people read errors. */
  failRoles = false;
  /** The GM visibility read never settles. */
  stallSettings = false;
  /**
   * One shared time entry's stored `out_at` (A4-3). A pull with `pull: { outAt }` rewrites it from its own answer when
   * it ends; every request records the value it was served against (`Req.outAt`).
   */
  entryOutAt = "out-initial";
  readonly sent: Req[] = [];
  readonly client: LaborCoreDeps["sb"];
  private seq = 0;
  constructor(private readonly clock: FakeClock, private readonly o: LaborDbOpts = {}) {
    const base = fakeClient({
      weeks: [ready(WP), ready(WD)],
      currentFingerprint: (w) => (this.toastChanged && w === WD ? "e".repeat(32) : undefined),
      ...(o.laborCostRow ? { laborCostRow: o.laborCostRow } : {}),
      visibility: o.visibility ?? [null],
      rpcRows: { business_report_labor_people: () => ROLE_PEOPLE },
    } as FakeOpts);
    this.client = this.wrap(base) as LaborCoreDeps["sb"];
  }
  count(pred: (r: Req) => boolean = () => true): number { return this.sent.filter(pred).length; }
  named(name: string, shop?: string | null): Req[] { return this.sent.filter((r) => r.name === name && (shop === undefined || r.shop === shop)); }
  /** Requests of the labor money proper (everything but the GM visibility read). */
  laborRequests(): Req[] { return this.sent.filter((r) => r.name !== "business_report_gm_visibility"); }
  settingsRequests(): Req[] { return this.named("business_report_gm_visibility"); }

  private respond(r: Req): ReturnType<Respond> {
    const own = this.o.respond?.(r);
    if (own !== undefined) return own;
    if (r.name === "business_report_gm_visibility" && this.stallSettings) return "hang";
    if (r.shop !== null && this.stalled.has(r.shop)) return "hang";
    if ((r.name === "business_report_labor_people" || r.name === "sevenshifts_roles") && this.stallRoles) return "hang";
    if (r.name === "business_report_labor_people" && this.failRoles) return { answer: { data: null, error: { code: "57014" } } };
    if (r.name === "sevenshifts_roles") return { rows: ROLE_NAMES };
    return undefined;
  }

  /** The counting, holding wrapper (copied from tests/business-labor-core.test.ts, on the fake clock). */
  private wrap(base: ReturnType<typeof fakeClient>) {
    const make = (kind: Req["kind"], name: string, args: Record<string, unknown>, inner: Record<string, unknown>) => {
      const req: Req = { kind, name, args, filters: {}, at: 0, seq: 0, outAt: "", shop: typeof args.p_location_id === "string" ? args.p_location_id : null };
      const proxy: Record<string, unknown> = new Proxy({}, {
        get: (_t, prop: string) => {
          if (prop === "abortSignal") return (s: AbortSignal) => { req.signal = s; return proxy; };
          if (prop === "retry") return (v: boolean) => { req.retry = v; return proxy; };
          if (prop === "then") {
            return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
              req.at = this.clock.now;
              req.seq = ++this.seq;
              req.outAt = this.entryOutAt;
              this.sent.push(req);
              const how = this.respond(req);
              const answer = (): Promise<unknown> => {
                if (how && typeof how === "object" && "rows" in how) {
                  const [lo, hi] = req.range ?? [0, Number.POSITIVE_INFINITY];
                  return Promise.resolve({ data: how.rows.slice(lo, hi + 1), error: null, count: how.rows.length });
                }
                if (how && typeof how === "object" && "answer" in how) return Promise.resolve({ error: null, ...how.answer });
                return Promise.resolve(inner).then((v) => v);
              };
              if (how === "hang") return new Promise(() => {});
              if (how && typeof how === "object" && "delayMs" in how) {
                return new Promise<void>((r) => { this.clock.timers.set(() => r(), how.delayMs); }).then(() => answer()).then(res, rej);
              }
              return answer().then(res, rej);
            };
          }
          const f = inner[prop];
          if (typeof f !== "function") return f;
          return (...a: unknown[]) => {
            if (prop === "range") req.range = [a[0] as number, a[1] as number];
            else if (["eq", "gte", "lte", "in"].includes(prop)) {
              req.filters[`${prop}:${String(a[0])}`] = a[1];
              if (prop === "eq" && a[0] === "location_id" && typeof a[1] === "string") req.shop = a[1];
            }
            (f as (...x: unknown[]) => unknown).apply(inner, a);
            return proxy;
          };
        },
      });
      return proxy;
    };
    const b = base.client as unknown as { rpc: (fn: string, a: Record<string, unknown>, o?: unknown) => Record<string, unknown>; from: (t: string) => Record<string, unknown> };
    return {
      rpc: (fn: string, args: Record<string, unknown>, o?: unknown) => make("rpc", fn, args, b.rpc(fn, args, o)),
      from: (t: string) => make("table", t, {}, b.from(t)),
    } as unknown;
  }
}

// ── the LaborMoneyIO over the real pieces ───────────────────────────────────────────────────────

/**
 * Built BY HAND from the real pieces (the packet's recipe): `settings` is the factory's own piece (one read through
 * `readGmVisibility(sb, stage.signal)` on the piece's cutoff stage, its one-result ledger), `hourly` / `roles` the core's.
 * The test also runs the real `buildLaborMoneyIO` over the same fake client (its client factory mocked).
 */
export function handLaborIO(db: LaborDb, clock: FakeClock): LaborMoneyIO {
  const deps: LaborCoreDeps = { sb: db.client, wageFallback: "first_known" };
  return {
    clock: clock.clock,
    timers: clock.timers,
    settings(): PreloadPiece<GmSettingsResult> {
      return {
        key: LABOR_SETTINGS_KEY, capMs: LABOR_SETTINGS_CAP_MS,
        start(ctx): PieceHandle<GmSettingsResult> {
          const stage = ctx.stage("cutoff");
          let open = true;
          let accepted: GmSettingsResult | null = null;
          const done = (async () => {
            if (stage.expired()) return;
            const read = await readGmVisibility(deps.sb, stage.signal);
            if (!open || stage.expired()) return;
            accepted = "unavailable" in read ? { kind: "unavailable" } : { kind: "settings", settings: read.settings };
          })().catch(() => undefined);
          return { done, snapshot: () => { open = false; return accepted ?? { kind: "unavailable" }; } };
        },
      };
    },
    hourly: (locationId, day) => hourlyLaborPiece(deps, locationId, day),
    roles: (locationId, day, hourly) => roleLaborPiece(deps, locationId, day, hourly),
  };
}

// ── the ordinary facts ──────────────────────────────────────────────────────────────────────────

/** The switch-off golden's shop facts (tests/fixtures/digest-labor-goldens/cases.ts `goldenShop`), for any day. */
export function goldenFacts(shop: { id: string; name: string }, day = D, toastChanged = false): ShopDayFacts {
  const f = shopFacts(shop, { labor: ok(labor(toastChanged ? { totalHours: 63.5, people: [{ employeeGuid: "g1", firstName: "Person A", hours: 9, unknownShifts: 0 }] } : {})) },
    schedule(fullDay(D), tomorrowDay(D1, 1)));
  return day === D ? f : { ...f, day };
}

/**
 * `bare`: no Toast labor fact and no schedule for D (the Labor section exists only through a labor-money line).
 * `sourceResult`: what the SOURCE resolves once its pull is over (default `{ writeUncertain: false }`, a healthy night;
 * `{ writeUncertain: true }` = the pull failed or was cut; any other value is passed as is). `sourceRejects`: it rejects.
 * `pull` (A4-3): the pull takes `delayMs` of fake time and then rewrites the shared entry's `out_at` from its own answer.
 * `detached` (the teeth of the A4-3 test): the source settles AT ONCE instead of holding the pull (a loader that does
 * not hand back its write), so the engine's per-shop chain no longer waits for it; the facts still settle after the pull.
 * `notConnected` (fix round 2, D-4): the shop has no Toast connection, as the real loader reports it: the labor area is
 * `unavailable("labor_not_connected")` and the source resolves `{ writeUncertain: false, notConnected: true }`.
 */
export type ShopMode = {
  facts?: "never" | "reject"; source?: "never" | Deferred<void>; pullChanges?: boolean; bare?: boolean;
  sourceResult?: unknown; sourceRejects?: boolean; pull?: { outAt: string; delayMs: number }; detached?: boolean;
  notConnected?: boolean;
};
export const HEALTHY_SOURCE = { writeUncertain: false } as const;

export class FakeShopFacts {
  readonly calls: Array<{ key: string; at: number; args: number }> = [];
  private readonly modes = new Map<string, ShopMode>();
  constructor(private readonly db: LaborDb, private readonly clock: FakeClock, private readonly log: CallLog) {}
  mode(locationId: string, day: string, m: ShopMode): void { this.modes.set(`${locationId}|${day}`, { ...this.modes.get(`${locationId}|${day}`), ...m }); }
  readonly io: DigestIO["shopFacts"] = (...args: Parameters<DigestIO["shopFacts"]>) => {
    const [location, day, onSource] = args;
    const key = `${location.id}|${day}`;
    this.calls.push({ key, at: this.clock.now, args: args.length });
    this.log.push(`shopFacts:start(${key})`);
    const m = this.modes.get(key) ?? {};
    // The digest's own pull: it may move an out_at of D's payroll week BEFORE the facts settle (N1).
    const pullOver = m.pull ? new Promise<void>((r) => { this.clock.timers.set(() => r(), m.pull!.delayMs); }) : Promise.resolve();
    const pulled = pullOver.then(() => {
      if (m.pullChanges) this.db.toastChanged = true;
      if (m.pull) { this.db.entryOutAt = m.pull.outAt; this.log.push(`pull:write(${key}, ${m.pull.outAt})`); }
    });
    const written = m.detached ? Promise.resolve() : pulled;
    const settled = m.source === "never" ? new Promise<void>(() => {}) : m.source ? written.then(() => (m.source as Deferred<void>).promise) : written;
    const result = m.notConnected ? { writeUncertain: false, notConnected: true } : "sourceResult" in m ? m.sourceResult : HEALTHY_SOURCE;
    onSource?.(settled.then(() => {
      if (m.sourceRejects) throw new Error("source_failed (synthetic)");
      return result as Awaited<Parameters<NonNullable<typeof onSource>>[0]>;
    }));
    if (m.facts === "never") return new Promise<ShopDayFacts>(() => {});
    if (m.facts === "reject") return pulled.then(() => { throw new Error("facts_read_failed (synthetic)"); });
    // Sampled when the pull ends: what Toast holds at that moment.
    return pulled.then(() => {
      if (m.bare) return { ...shopFacts(location), day };
      const f = goldenFacts(location, day, this.db.toastChanged);
      return m.notConnected ? { ...f, v2: { ...f.v2!, labor: unavailable("labor_not_connected") } } : f;
    });
  };
}

// ── the directory ───────────────────────────────────────────────────────────────────────────────

export type Who = "gm-a" | "gm-b" | "moo" | "own" | "cgs" | "agm" | "cat";
const USERS: Record<Who, { id: string; name: string; role: string; m: string[] }> = {
  "gm-a": { id: "gm-a", name: "Person A", role: "gm", m: [A] },
  "gm-b": { id: "gm-b", name: "Person B", role: "gm", m: [B] },
  moo: { id: "moo", name: "Person C", role: "moo", m: [A] },
  own: { id: "own", name: "Person D", role: "owner", m: [A, B] },
  cgs: { id: "cgs", name: "Person G", role: "cgs", m: [A, B] },
  agm: { id: "agm", name: "Person E", role: "agm", m: [A] },
  cat: { id: "cat", name: "Person F", role: "catering_mgr", m: [A] },
};
const ov = (userId: string, over: Partial<RecipientOverride>): RecipientOverride =>
  ({ id: `o-${userId}`, kind: "internal", userId, email: null, displayName: userId, active: true, cateringDigest: false, shopDigest: false, locationIds: null, ...over });

export interface DirOpts {
  who?: readonly Who[];
  /** The MoO's user id: "aa-moo" sorts BEFORE "gm-a", "zz-moo" after (the `ref` order). */
  mooId?: string;
  /** Language per person (default en). */
  es?: readonly Who[];
  /** The owner is flagged for Shop A's shop digest too (the samples). */
  ownerShopDigest?: boolean;
}
export function directory(o: DirOpts = {}) {
  const who = o.who ?? ["gm-a", "gm-b", "moo", "own", "agm", "cat"];
  const idOf = (w: Who) => (w === "moo" ? o.mooId ?? "moo" : USERS[w].id);
  const users = who.map((w) => ({ id: idOf(w), name: USERS[w].name, email: `${idOf(w)}@example.com`, role: USERS[w].role, language: o.es?.includes(w) ? "es" : "en", active: true }));
  const overrides: RecipientOverride[] = [];
  if (who.includes("moo")) overrides.push(ov(idOf("moo"), { shopDigest: true, locationIds: [A] }));
  if (who.includes("agm")) overrides.push(ov("agm", { shopDigest: true }));
  if (who.includes("own") && o.ownerShopDigest) overrides.push(ov("own", { shopDigest: true, locationIds: [A] }));
  return {
    dir: { users, memberships: who.flatMap((w) => USERS[w].m.map((locationId) => ({ userId: idOf(w), locationId }))), overrides, locationIds: [A, B] },
    locations: [SHOP_A, SHOP_B],
  };
}
export const ref = (id: string) => `user:${id}`;

// ── the harness ─────────────────────────────────────────────────────────────────────────────────

export interface Mail { kind: string; day: string; ref: string; location: string | null; subject: string; html: string; text: string; preheader: string; at: number }

export interface E2EOpts {
  run: { kind: "closing"; locationId?: string; day?: string } | { kind: "tick" };
  /** day → the shops whose closing is finalized. */
  finalized: Readonly<Record<string, readonly string[]>>;
  switchOn?: boolean;
  dir?: DirOpts;
  settings?: Partial<DigestSettings>;
  db?: LaborDbOpts;
  /** How the LaborMoneyIO is built (default: by hand from the real pieces). */
  laborIO?: (db: LaborDb, clock: FakeClock) => LaborMoneyIO;
  /** Fake time to the L7 Toast change, from the start of the run (ms). */
  toastChangeAt?: number;
  /** Set up the facts / database before the run starts. */
  before?: (h: Harness) => void;
}

export interface Harness {
  io: DigestIO; clock: FakeClock; log: CallLog; db: LaborDb; shop: FakeShopFacts; store: MemStore;
  mails: Mail[]; alerts: unknown[];
  /** The request count when the first email was handed to the sender. */
  requestsAtFirstSend: number | null;
  catering: { calls: number };
  summary: DigestRunSummary | null;
  run(): Promise<Harness>;
  mail(kind: string, refOrId: string, location?: string | null, day?: string): Mail;
}

export const preheaderOf = (html: string): string => /<div[^>]*display:\s*none[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? "";

export function e2e(o: E2EOpts): Harness {
  const clock = new FakeClock();
  const log = new CallLog(clock.clock);
  const store = new MemStore();
  store.log = log;
  store.now = NIGHT;
  const db = new LaborDb(clock, o.db);
  const shop = new FakeShopFacts(db, clock, log);
  const d = directory(o.dir);
  const mails: Mail[] = [];
  const alerts: unknown[] = [];
  const catering = { calls: 0 };
  const io: DigestIO = {
    now: new Date(NIGHT), baseUrl: BASE,
    previewRecipient: async () => "operator@example.com",
    settings: async () => ({ ...DEFAULT_DIGEST_SETTINGS, mode: "live", unifiedFallbackTimeEt: "23:59", cateringTimeEt: "23:59", ...o.settings }),
    directory: async () => d,
    sendLog: async (days) => store.rows.filter((r) => days.includes(r.business_day)).map((r) => ({ ...r })),
    finalizedClosings: async (days) => new Map(days.map((day) => [day, new Set(o.finalized[day] ?? [])])),
    shopFacts: shop.io,
    cateringFacts: (today) => {
      catering.calls++;
      log.push("cateringFacts:start");
      return Promise.resolve(cateringFacts([], undefined, { today }) as CateringFacts);
    },
    store,
    sendEmail: async (m) => {
      // co-digest/<mode>/<kind>/<day>/r1/<ref>/<location|all>
      const [, , kind, day, , r, loc] = m.idempotencyKey.split("/");
      if (h.requestsAtFirstSend === null) h.requestsAtFirstSend = db.sent.length;
      mails.push({ kind: kind!, day: day!, ref: r!, location: loc === "all" ? null : loc!, subject: m.subject, html: m.html, text: m.text, preheader: preheaderOf(m.html), at: clock.now });
      log.push(`sendEmail(${kind}, ${r}, ${loc})`);
      return { id: `mail-${mails.length}` };
    },
    sha: (c) => String(c.length),
    alert: async (a) => { alerts.push(a); return true; },
    recordRun: async () => {},
  };
  if (o.switchOn) io.laborMoney = (o.laborIO ?? handLaborIO)(db, clock);
  const h: Harness = {
    io, clock, log, db, shop, store, mails, alerts, requestsAtFirstSend: null, catering, summary: null,
    async run() {
      o.before?.(h);
      if (o.toastChangeAt !== undefined) clock.timers.set(() => { db.toastChanged = true; log.push("toast:T"); }, o.toastChangeAt);
      const p = o.run.kind === "tick" ? runDigestTickWith(io)
        : runClosingDigestsWith(io, o.run.locationId ?? A, o.run.day ?? D);
      h.summary = await clock.until(p, { stepMs: 250, maxMs: 600_000 });
      return h;
    },
    mail(kind, refOrId, location, day) {
      const r = refOrId.startsWith("user:") ? refOrId : ref(refOrId);
      const found = mails.filter((m) => m.kind === kind && m.ref === r && (location === undefined || m.location === location) && (day === undefined || m.day === day));
      if (found.length !== 1) throw new Error(`expected one ${kind} mail for ${r}@${location ?? "*"} ${day ?? ""}, got ${found.length}`);
      return found[0]!;
    },
  };
  return h;
}

export { deferred, FakeClock };
