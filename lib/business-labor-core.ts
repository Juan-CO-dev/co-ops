/**
 * Digest LABOR MONEY (digests round 3, PR 4): the labor-money READS of the digest pre-load (server-only). Two pre-load
 * pieces (lib/preload-runner.ts), each keeping a LEDGER of the results it accepted; `snapshot()` closes the ledger
 * and certifies from it with the pure rules of lib/business-labor-hourly-shared.ts. Its one importer is
 * lib/report-digests-labor.ts (the pre-load's factory). It sends nothing.
 *
 * THE BUSINESS REPORT'S OWN BRACKET, TWICE (plan §3.2, §11.2.2). `loadBusinessReport` reads coverage, then the labor
 * reads, then coverage again, then each week's current fingerprint. The hourly piece does that twice for D's payroll week
 * and the one before it: bracket 1 decides which day is final; bracket 2 reads the spans that depend on that day and
 * re-checks both weeks. Nothing here prices anything: every figure comes from the report's own functions.
 *
 *   stage 1  bracket-1 data            ends 4.0 s   coverage before (FIRST, to completion), then the sales window,
 *                                                   the structures and fact_labor_cost for D−1 … D−7
 *   stage 2  bracket-1 closing checks  ends 5.5 s   coverage after, then ONE fingerprint request per week
 *   stage 3  bracket-2 data            ends 8.0 s   coverage before, then the week so far (only when the latest final
 *                                                   day is in D's week) and the last full payroll week
 *   stage 4  bracket-2 closing checks  the CUTOFF   coverage after, then one fingerprint per week
 * An inner stage end only moves the piece on: what that stage accepted stays in the ledger, and the closing checks still
 * run. The last stage has no end of its own: the runner owns the cutoff (§15.2.2, L15).
 *
 * EVERY REQUEST (§5 of the PR 4 contract; §13.2.4 L10, §15.2.3, O-N4, O-N8):
 *   1. the stage's `expired()` is checked BEFORE it starts (each page, each queued item, each single request);
 *   2. it is sent through `preloadRequest` (the stage's signal AND `.retry(false)`: one request = one HTTP attempt);
 *   3. its answer is ACCEPTED into the ledger only while the stage has not ended and the ledger is open;
 *   4. a table-returning read is read to completion with an exact count (`readAll` with the stage as its guard) or it
 *      is a failure, never a partial set;
 *   5. at most four requests of one stage are in flight;
 *   6. nothing is logged but fixed codes (never an argument, a row, a name or a dollar);
 *   7. the day row and the people read use the SAME wage fallback (`deps.wageFallback`, resolved once per run, P3-7).
 * Aborting ends the HTTP request at the client; whether Postgres stops the query is NOT verified.
 *
 * NO PERSON LEAVES THE ROLE PIECE (Opus P3-5): the people read's rows are cut to (person key, role, source, pay class,
 * cents) inside the piece and handed only to the pure bucket rule; the facts it seals hold no label, user id or key.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAll, rpcError, tableError, targetsForWeek, type Page, type StructureRow } from "@/lib/business-report";
import { payrollWeekStart, type LaborWeekGenerationRow } from "@/lib/business-report-shared";
import { toLaborCostRow, type LaborCostRow } from "@/lib/facts/labor-cost-shared";
import { LABOR_BUILDER_VERSION, LABOR_HISTORY_FLOOR_DAY, type WageFallback } from "@/lib/facts/labor-config-shared";
import { salesWindows, type DailyRaw } from "@/lib/sales-reports-shared";
import type { PieceCtx, PreloadPiece, Stage } from "@/lib/preload-runner";
import {
  LABOR_HOURLY_CAP_MS, LABOR_HOURLY_STAGE_MS, LABOR_ROLE_CAP_MS, LABOR_ROLE_STAGE_MS, laborHourlyKey, laborRolesKey,
  type HourlyLaborFacts, type RoleLaborFacts,
} from "@/lib/business-labor-shared";
import {
  canonicalRoleKey, certifyHourly, certifyRoleLedger, chooseLatestFinalDay, emptyHourlyLedger, hourlyFrame,
  type HourlyLedger, type RoleLedger, type RolePeopleRowIn,
} from "@/lib/business-labor-hourly-shared";
import { roleBuckets } from "@/lib/business-labor-roles-shared";

/** `sb` is the pre-load's OWN client (A4-4: its fetch refuses an attempt whose stage has ended). */
export interface LaborCoreDeps { sb: SupabaseClient; wageFallback: WageFallback }

/** At most this many requests of one stage in flight (rule 5). */
export const LABOR_STAGE_IN_FLIGHT = 4;
/** The role names are read in batches of at most this many ids. */
export const LABOR_ROLE_NAME_BATCH = 100;

/**
 * THE one way a pre-load request is sent: the stage's signal AND no SDK retries. `@supabase/postgrest-js` 2.105.x retries
 * eligible GETs inside the builder by default; with `.retry(false)` one request is one HTTP attempt, so nothing is sent
 * from a back-off after its stage ended (§15.2.3, O-N4). Every `sb.from(` / `sb.rpc(` in this file is wrapped in it
 * (tests/business-labor-core.test.ts scans the source).
 */
export function preloadRequest<B extends { abortSignal(s: AbortSignal): B; retry(enabled: boolean): B }>(builder: B, stage: Stage): B {
  return builder.abortSignal(stage.signal).retry(false);
}

// ── The request plumbing (no I/O of its own) ────────────────────────────────────────────────────

/** A request that was not sent, or whose stage ended before it answered. Never logged with any detail. */
class StageCut extends Error {
  constructor() { super("labor_preload_cut"); this.name = "StageCut"; }
}
/** An answer that is not what the read promises (a malformed row): a failure, never read "as far as it goes". */
class Refused extends Error {
  constructor() { super("labor_preload_refused"); this.name = "Refused"; }
}

/** Resolves with `p`, or rejects the moment `signal` aborts (the answer that comes later is ignored). */
function untilAbort<T>(signal: AbortSignal, p: PromiseLike<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(new StageCut());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new StageCut());
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(p).then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

/** One stage's requests: at most LABOR_STAGE_IN_FLIGHT in flight; a queued request whose turn comes after the stage
 * ended is never sent (L10). */
function stageGate(stage: Stage) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => { active--; waiting.shift()?.(); };
  const acquire = () => (active < LABOR_STAGE_IN_FLIGHT ? (active++, Promise.resolve())
    : new Promise<void>((r) => waiting.push(() => { active++; r(); })));
  return {
    stage,
    async send<T>(start: () => PromiseLike<T>): Promise<T> {
      await acquire();
      try {
        if (stage.expired()) throw new StageCut();
        return await untilAbort(stage.signal, start());
      } finally {
        release();
      }
    },
  };
}
type Gate = ReturnType<typeof stageGate>;

/** Waits for a stage's work, but never past the stage's end (its abort): the piece then moves on. Never rejects. */
async function settleBy(stage: Stage, work: Promise<unknown>): Promise<void> {
  await untilAbort(stage.signal, work.catch(() => undefined)).catch(() => undefined);
}

/** A table-returning read, read to completion (exact count) with the stage as its guard, every page through the gate. */
function readEvery<T>(g: Gate, page: (from: number, to: number) => PromiseLike<unknown>, onError: (e: { code?: string }) => never): Promise<T[]> {
  return readAll<T>((a, z) => g.send(() => page(a, z) as PromiseLike<Page>), onError, g.stage);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const latest = (...days: string[]) => [...days].sort().at(-1)!;

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x);
  }
  return v;
}

/** The reads both pieces share, each built with the stage it belongs to. */
function reads(deps: LaborCoreDeps, locationId: string) {
  const { sb, wageFallback } = deps;
  /** labor_week_coverage for weeks [fromWeek, toWeek] (both shops are built together: no shop filter, as the report). */
  const coverage = (g: Gate, fromWeek: string, toWeek: string) => readEvery<LaborWeekGenerationRow>(g, (a, z) =>
    preloadRequest(sb.from("labor_week_coverage").select("week_start,ot_scope,builder_version,built_at,source_fingerprint", { count: "exact" }).gte("week_start", fromWeek).lte("week_start", toWeek).order("week_start", { ascending: true }).range(a, z), g.stage), tableError);
  /** fact_labor_cost(from, to): its one row, or null (the report's own reading of it). */
  const laborCost = async (g: Gate, from: string, to: string): Promise<LaborCostRow | null> => {
    const r = await readEvery<Record<string, unknown>>(g, (a, z) =>
      preloadRequest(sb.rpc("fact_labor_cost", { p_location_id: locationId, p_from: from, p_to: to, p_wage_fallback: wageFallback }, { count: "exact" }).range(a, z), g.stage), rpcError);
    return r[0] ? toLaborCostRow(r[0]) : null;
  };
  /** ONE week's current fingerprint, its own promise (§13.2.5): an error or anything but a non-empty string is null. */
  const fingerprint = async (g: Gate, week: string): Promise<string | null> => {
    let res: { data: unknown; error: unknown };
    try {
      res = await g.send(() => preloadRequest(sb.rpc("fact_labor_week_fingerprint", { p_week_start: week, p_builder_version: LABOR_BUILDER_VERSION }), g.stage));
    } catch (e) {
      if (e instanceof StageCut) throw e; // not answered in time: absent from the ledger (= null)
      return null;
    }
    return !res.error && typeof res.data === "string" && res.data.length > 0 ? res.data : null;
  };
  return { sb, wageFallback, coverage, laborCost, fingerprint };
}

/** A piece that reads nothing and certifies `value` (a request the core refuses to make). */
function inert<T>(key: string, capMs: number, value: T): PreloadPiece<T> {
  return { key, capMs, start: () => ({ done: Promise.resolve(), snapshot: () => value }) };
}

// ── The hourly piece (F1–F4) ────────────────────────────────────────────────────────────────────

const HOURLY_UNAVAILABLE = (day: string): HourlyLaborFacts => deepFreeze({ day, latestFinalDay: { kind: "unavailable" },
  weekSoFar: { kind: "unavailable" }, lastFullWeek: { kind: "unavailable" }, roleStep: null });

/** One shop and business day D: the two brackets over D's payroll week and the one before it. */
export function hourlyLaborPiece(deps: LaborCoreDeps, locationId: string, day: string): PreloadPiece<HourlyLaborFacts> {
  const key = laborHourlyKey(locationId, day);
  if (!UUID.test(locationId) || !DAY.test(day)) return inert(key, LABOR_HOURLY_CAP_MS, HOURLY_UNAVAILABLE(day));
  return {
    key,
    capMs: LABOR_HOURLY_CAP_MS,
    start(ctx: PieceCtx) {
      const r = reads(deps, locationId);
      const frame = hourlyFrame(day);
      const ledger: HourlyLedger<StructureRow> = emptyHourlyLedger<StructureRow>(day);
      let closed = false;
      /** Rule 3: an answer enters the ledger only while its stage has not ended and the ledger is open. */
      const take = (stage: Stage, put: () => void): boolean => {
        if (closed || stage.expired()) return false;
        put();
        return true;
      };
      /** A read whose failure is simply "not accepted". */
      const quietly = (p: Promise<unknown>) => p.catch(() => undefined);

      const bracket1Data = async (g: Gate) => {
        // The report's order: coverage BEFORE finishes before any labor read starts.
        const before = await r.coverage(g, frame.weekP, frame.weekD);
        if (!take(g.stage, () => { ledger.coverageBefore1 = before; })) return;
        await Promise.allSettled([
          quietly((async () => {
            const windows = salesWindows(frame.weekP, day);
            const raws = await Promise.all(windows.map(async (w) => {
              const res: { data: unknown; error: { code?: string } | null } = await g.send(() =>
                preloadRequest(r.sb.rpc("sales_report_daily", { p_location_id: locationId, p_from: w.from, p_to: w.to }), g.stage));
              if (res.error) rpcError(res.error);
              if (!res.data || typeof res.data !== "object") throw new Refused();
              return res.data as DailyRaw;
            }));
            if (windows.length === 0) return; // never "no sales" from an empty window list
            take(g.stage, () => { ledger.sales = raws; });
          })()),
          quietly((async () => {
            const rows = await readEvery<StructureRow>(g, (a, z) =>
              preloadRequest(r.sb.from("schedule_structures").select("structure,created_at", { count: "exact" }).eq("location_id", locationId).order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, z), g.stage), tableError);
            take(g.stage, () => { ledger.structures = rows; });
          })()),
          ...frame.days.map((d) => quietly((async () => {
            // The report reads no labor before the history floor: that day has no row.
            const row = d < LABOR_HISTORY_FLOOR_DAY ? null : await r.laborCost(g, d, d);
            take(g.stage, () => { ledger.dayCosts.set(d, row); });
          })())),
        ]);
      };

      const closingChecks = async (g: Gate, n: 1 | 2) => {
        const after = await r.coverage(g, frame.weekP, frame.weekD);
        if (!take(g.stage, () => { if (n === 1) ledger.coverageAfter1 = after; else ledger.coverageAfter2 = after; })) return;
        const fps = n === 1 ? ledger.fingerprints1 : ledger.fingerprints2;
        // One request per week, each its own promise and its own ledger entry (§13.2.5, L15).
        await Promise.allSettled([frame.weekP, frame.weekD].map((w) => quietly((async () => {
          const fp = await r.fingerprint(g, w);
          take(g.stage, () => { fps.set(w, fp); });
        })())));
      };

      const bracket2Data = async (g: Gate) => {
        const before = await r.coverage(g, frame.weekP, frame.weekD);
        if (!take(g.stage, () => { ledger.coverageBefore2 = before; })) return;
        // The latest final day from bracket 1 as it stands (its stages are over: nothing more enters it).
        const choice = chooseLatestFinalDay(ledger, targetsForWeek);
        const spans: Promise<unknown>[] = [];
        if (choice.kind === "day" && choice.week === frame.weekD) {
          const to = choice.date;
          spans.push(quietly((async () => {
            const from = latest(frame.weekD, LABOR_HISTORY_FLOOR_DAY);
            const row = from > to ? null : await r.laborCost(g, from, to);
            take(g.stage, () => { ledger.weekSoFarTo = to; ledger.weekSoFarRow = row; });
          })()));
        }
        // The last full week needs no final day: it is read whatever bracket 1 chose (or could not).
        spans.push(quietly((async () => {
          const from = latest(frame.weekP, LABOR_HISTORY_FLOOR_DAY);
          const row = from > frame.lastFullWeekEnd ? null : await r.laborCost(g, from, frame.lastFullWeekEnd);
          take(g.stage, () => { ledger.lastFullWeekRow = row; });
        })()));
        await Promise.allSettled(spans);
      };

      const run = async (stage: Stage, work: (g: Gate) => Promise<void>) => {
        if (closed) return;
        const g = stageGate(stage);
        await settleBy(stage, work(g));
      };
      const done = (async () => {
        try {
          await run(ctx.stage(LABOR_HOURLY_STAGE_MS.bracket1Data), bracket1Data);
          await run(ctx.stage(LABOR_HOURLY_STAGE_MS.bracket1Checks), (g) => closingChecks(g, 1));
          await run(ctx.stage(LABOR_HOURLY_STAGE_MS.bracket2Data), bracket2Data);
          await run(ctx.stage("cutoff"), (g) => closingChecks(g, 2));
        } catch {
          // `done` never rejects: what was accepted stays in the ledger.
        }
      })();
      return {
        done,
        snapshot: () => {
          closed = true;
          return deepFreeze(certifyHourly(ledger, targetsForWeek));
        },
      };
    },
  };
}

// ── The role piece (F5) ─────────────────────────────────────────────────────────────────────────

const ROLES_UNAVAILABLE: RoleLaborFacts = deepFreeze({ kind: "unavailable" });

/** Ascending by numeric value (canonical ids: shorter first, then lexicographic). */
const idOrder = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

/**
 * That shop and day's cost by role, from `hourly.roleStep`. Decided: with NO role step (no usable latest final day) the
 * piece makes no read at all and certifies `unavailable`; it is not an error (the factory should not ask for it).
 */
export function roleLaborPiece(deps: LaborCoreDeps, locationId: string, day: string, hourly: HourlyLaborFacts): PreloadPiece<RoleLaborFacts> {
  const key = laborRolesKey(locationId, day);
  const step = hourly.roleStep;
  if (!step || !UUID.test(locationId) || !DAY.test(step.date) || !DAY.test(step.weekStart) || payrollWeekStart(step.date) !== step.weekStart) {
    return inert(key, LABOR_ROLE_CAP_MS, ROLES_UNAVAILABLE);
  }
  return {
    key,
    capMs: LABOR_ROLE_CAP_MS,
    start(ctx: PieceCtx) {
      const r = reads(deps, locationId);
      const ledger: RoleLedger = {};
      let closed = false;
      const take = (stage: Stage, put: () => void): boolean => {
        if (closed || stage.expired()) return false;
        put();
        return true;
      };

      const data = async (g: Gate) => {
        const before = await r.coverage(g, step.weekStart, step.weekStart);
        if (!take(g.stage, () => { ledger.coverageBefore = before; })) return;
        // The SAME wage fallback as the day row (P3-7).
        const raw = await readEvery<Record<string, unknown>>(g, (a, z) =>
          preloadRequest(r.sb.rpc("business_report_labor_people", { p_location_id: locationId, p_from: step.date, p_to: step.date, p_wage_fallback: r.wageFallback }, { count: "exact" }).range(a, z), g.stage), rpcError);
        // Opus P3-5: only these five fields are kept; the label and the user id are never copied.
        const people: RolePeopleRowIn[] = raw.map((x) => {
          const roleKey = canonicalRoleKey(x.role_key);
          const cents = x.straight_cents === null || x.straight_cents === undefined ? null : Number(x.straight_cents);
          if (roleKey === undefined || typeof x.person_key !== "string" || (cents !== null && !Number.isFinite(cents))) throw new Refused();
          return { personKey: x.person_key, roleKey, source: String(x.source), payClass: String(x.pay_class), straightCents: cents };
        });
        if (!take(g.stage, () => { ledger.people = people; })) return;
        const ids = [...new Set(people.filter((p) => p.payClass === "hourly" && p.roleKey !== null).map((p) => p.roleKey!))].sort(idOrder);
        const names = new Map<string, string | null>();
        for (let i = 0; i < ids.length; i += LABOR_ROLE_NAME_BATCH) {
          const batch = ids.slice(i, i + LABOR_ROLE_NAME_BATCH);
          const rows = await readEvery<Record<string, unknown>>(g, (a, z) =>
            preloadRequest(r.sb.from("sevenshifts_roles").select("id,name", { count: "exact" }).in("id", batch).order("id", { ascending: true }).range(a, z), g.stage), tableError);
          for (const row of rows) {
            const id = canonicalRoleKey(row.id);
            if (!id) throw new Refused();
            names.set(id, typeof row.name === "string" ? row.name : null);
          }
        }
        take(g.stage, () => { ledger.roleNames = names; });
      };
      const checks = async (g: Gate) => {
        const after = await r.coverage(g, step.weekStart, step.weekStart);
        if (!take(g.stage, () => { ledger.coverageAfter = after; })) return;
        const fp = await r.fingerprint(g, step.weekStart);
        take(g.stage, () => { ledger.fingerprint = fp; });
      };

      const run = async (stage: Stage, work: (g: Gate) => Promise<void>) => {
        if (closed) return;
        await settleBy(stage, work(stageGate(stage)));
      };
      const done = (async () => {
        try {
          await run(ctx.stage(LABOR_ROLE_STAGE_MS.data), data);
          await run(ctx.stage("cutoff"), checks);
        } catch {
          // never rejects
        }
      })();
      return {
        done,
        snapshot: () => {
          closed = true;
          const cert = certifyRoleLedger(ledger, step);
          if (cert.kind !== "certified") return ROLES_UNAVAILABLE;
          try {
            return deepFreeze(roleBuckets(cert.people, cert.roleNames, { date: step.date, dayStraightCents: step.dayStraightCents, wageEstimated: step.wageEstimated }));
          } catch {
            return ROLES_UNAVAILABLE;
          }
        },
      };
    },
  };
}
