/**
 * THE 7SHIFTS SYNC RUN — SERVER-ONLY (Scheduling Phase 1, Task 7). A read, never a write to 7shifts,
 * never an email or a notification.
 *
 *   whoami → locations → departments → roles → users → assignments (per user) → wages (per user)
 *     → labor_settings → availabilities → time_off → shifts → time_punches
 *   then ONE ledger row (sevenshifts_sync_runs) and ONE heartbeat (cron.success | cron.failure).
 *
 * DORMANT without SEVENSHIFTS_ACCESS_TOKEN (or with SEVENSHIFTS_SYNC off): no request, no write, no
 * ledger row, no heartbeat.
 *
 * ONE COMPANY PER TOKEN (R2). whoami names it; zero or several companies fail the run
 * (`no_company` / `multi_company`) and nothing else is read.
 *
 * FAIL-SOFT PER RESOURCE, in the runToastLaborPull shape: one AbortSignal (the run's deadline) bounds
 * every request and every write; a resource that fails is recorded with a FIXED code and the others
 * still land. The ledger row and the heartbeat are written under their own short budget, so a run that
 * hit its deadline still records itself.
 *
 * WATERMARKS move ONLY for a resource that fully succeeded: every request pass complete, no rejected
 * row, every write ok. A failed resource keeps its watermark, so the next run re-reads the window
 * (upserts are idempotent). The watermark is the run's START instant; the next run asks for
 * `modified_since = watermark − 48 h`.
 *
 * THE ROLLING SHIFT HORIZON (chunk B review #2): shifts are read to today + 28. On an incremental run the
 * days the horizon admitted since the watermark are ALSO read WITHOUT `modified_since` (a backfill of just
 * those days), so a shift made weeks ago for a newly admitted date is imported the day it enters the window.
 *
 * PERSISTENCE IS NEVER REPORTED AS SUCCESSFUL WHEN IT FAILED (chunk B review #4). Supabase resolves a refused
 * write with `error`; every state and ledger write checks it. A failure is a fixed code in
 * `persistenceErrors` (`state_write_failed` / `ledger_write_failed`) and in the heartbeat, which is then
 * `cron.failure`. The run itself stays fail-open.
 *
 * WRITES go through MIRROR_WRITE_SPEC only: upserts on the spec's conflict key (nothing is ever
 * deleted; 7shifts' `deleted` flag is a column), and the per-user reconciler for assignments and
 * wages, called with `p_complete = request ok && shape ok && zero rejected rows` (r2 #2).
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit as auditImpl, type AuditInput } from "@/lib/audit";
import { withDeadline } from "@/lib/deadline-shared";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { createSevenShiftsClient, SevenShiftsApiError, type SevenShiftsFetch } from "@/lib/sevenshifts/client";
import { sevenShiftsStatus, sevenShiftsToken } from "@/lib/sevenshifts/config";
import type { SevenShiftsResource, SyncWindow } from "@/lib/sevenshifts/endpoints-shared";
import { MIRROR_WRITE_SPEC, type MirroredResource } from "@/lib/sevenshifts/mirror-spec-shared";
import * as normalizers from "@/lib/sevenshifts/normalize-shared";
import type { AssignmentsSnapshot, WagesSnapshot } from "@/lib/sevenshifts/paginate-shared";
import { createLimiter, SEVENSHIFTS_LIMITS } from "@/lib/sevenshifts/rate-limit-shared";

export const SYNC_ORDER: readonly MirroredResource[] = [
  "locations", "departments", "roles", "users", "assignments", "wages", "labor_settings",
  "availabilities", "time_off", "shifts", "time_punches",
];

/** First-run backfill for dated resources, and how far ahead published shifts are read. */
export const BACKFILL_DAYS = 90;
export const SHIFT_LOOKAHEAD_DAYS = 28;
/** Incremental runs re-read this much before the watermark (an upsert makes the overlap idempotent). */
export const MODIFIED_OVERLAP_HOURS = 48;
/** The finalization window (state, ledger, heartbeat) after the run's own deadline. Callers reserve it. */
export const SYNC_FINISH_BUDGET_MS = 5_000;
const UPSERT_CHUNK = 500;

export type SyncTrigger = "cron" | "manual";
export type ResourceErrorCode = string; // a fixed code: a SevenShiftsErrorCode, a PaginationError, or one below
export interface ResourceResult {
  rows: number;
  skipped: number;
  pages: number;
  error_code: ResourceErrorCode | null;
  /** Snapshot kinds only: users whose snapshot was incomplete or failed. */
  failed_users?: number;
}
export type SyncStatus = "ok" | "partial" | "failed";
export type PersistenceErrorCode = "state_write_failed" | "ledger_write_failed";
export type SyncOutcome =
  | { ran: false; reason: "token_missing" | "sync_off" }
  | {
    ran: true; runId: string | null; status: SyncStatus; requests: number; results: Record<string, ResourceResult>;
    /** Writes of the run's own record that did NOT land (chunk B review #4). Empty = all persisted. */
    persistenceErrors: PersistenceErrorCode[];
  };

export interface SyncDeps {
  env?: Readonly<Record<string, string | undefined>>;
  db?: SupabaseClient;
  fetch?: SevenShiftsFetch;
  /** The limiter's clock (ms). */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Overrides the deadline signal (tests). */
  signal?: AbortSignal;
  audit?: (input: AuditInput) => Promise<void>;
  randomUUID?: () => string;
}

type Row = Record<string, unknown>;

/** A fixed code for any failure; never a message, payload or URL. */
function codeOf(e: unknown): ResourceErrorCode {
  if (e instanceof SevenShiftsApiError) return e.code;
  if (e instanceof Error && e.message === "deadline") return "deadline";
  if (e instanceof Error && (e.message === "bad_id" || e.message === "bad_window")) return e.message;
  return "failed";
}

export async function runSevenShiftsSync(
  opts: { trigger: SyncTrigger; requestedBy?: string | null; deadlineMs: number; now?: Date },
  deps: SyncDeps = {},
): Promise<SyncOutcome> {
  const env = deps.env ?? process.env;
  const status = sevenShiftsStatus(env);
  if (status.reason === "token_missing" || status.reason === "sync_off") return { ran: false, reason: status.reason };
  const token = sevenShiftsToken(env)!;

  const now = opts.now ?? new Date();
  const startedAt = now.toISOString();
  const signal = deps.signal ?? AbortSignal.timeout(Math.max(1_000, opts.deadlineMs));
  const db = deps.db ?? getServiceRoleClient();
  const counter = { requests: 0 };
  const clock = deps.clock ?? Date.now;
  const limiter = createLimiter({ ...SEVENSHIFTS_LIMITS, now: clock });
  // The deadline on the limiter's clock: a cooldown that cannot end before it is never waited (review #5).
  const deadlineAt = clock() + Math.max(1_000, opts.deadlineMs);
  const client = createSevenShiftsClient({ token, limiter, signal, counter, fetch: deps.fetch, sleep: deps.sleep, now: clock, deadlineAt });
  const results: Record<string, ResourceResult> = {};
  const succeeded = new Set<MirroredResource>();
  const bounded = <T,>(p: PromiseLike<T>) => withDeadline(p, signal);
  const trigger = opts.trigger;
  const requestedBy = trigger === "manual" ? (opts.requestedBy ?? null) : null;

  // ── the run id, minted FIRST so reconciled rows can name it ──
  const runId = (deps.randomUUID ?? (() => crypto.randomUUID()))();
  let runMinted = false;
  try {
    const { error } = await bounded(db.from("sevenshifts_sync_run_ids").insert({ id: runId, trigger }));
    if (error) throw new Error("run_id_failed");
    runMinted = true;
  } catch {
    results.whoami = { rows: 0, skipped: 0, pages: 0, error_code: "run_id_failed" };
  }

  let companyId: string | null = null;
  if (runMinted) {
    // ── watermarks ──
    const watermarks = new Map<string, string | null>();
    try {
      const { data, error } = await bounded(db.from("sevenshifts_sync_state").select("resource, modified_watermark"));
      if (error) throw new Error("state_failed");
      for (const r of (data ?? []) as Array<{ resource: string; modified_watermark: string | null }>) watermarks.set(r.resource, r.modified_watermark);
    } catch {
      results.whoami = { rows: 0, skipped: 0, pages: 0, error_code: "state_failed" };
    }

    // ── whoami: one company per token ──
    if (!results.whoami) {
      try {
        const who = await client.get("whoami", { companyId: null, window: windowFor("whoami", null, now) });
        const ids = who.kind === "snapshot" ? (who.value as { companyIds: string[] }).companyIds : [];
        if (ids.length === 1) {
          companyId = ids[0]!;
          results.whoami = { rows: 1, skipped: 0, pages: 1, error_code: null };
        } else {
          results.whoami = { rows: 0, skipped: 0, pages: 1, error_code: ids.length === 0 ? "no_company" : "multi_company" };
        }
      } catch (e) {
        results.whoami = { rows: 0, skipped: 0, pages: 0, error_code: codeOf(e) };
      }
    }

    if (companyId !== null) {
      const cid = companyId;
      const since = (resource: string): string | null => {
        const w = watermarks.get(resource);
        if (!w) return null;
        return new Date(Date.parse(w) - MODIFIED_OVERLAP_HOURS * 3_600_000).toISOString();
      };
      const fetchedUsers = new Set<string>();

      const upsert = async (resource: MirroredResource, rows: Row[]) => {
        const spec = MIRROR_WRITE_SPEC[resource];
        if (spec.mode !== "upsert") throw new Error("not_upsert");
        rows = dedupeOnKey(rows, spec.onConflict);
        for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
          const { error } = await bounded(db.from(spec.table).upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: spec.onConflict.join(",") }));
          if (error) throw new Error(signal.aborted ? "deadline" : "write_failed");
        }
      };

      async function listOrSingleton(resource: Exclude<MirroredResource, "assignments" | "wages">): Promise<ResourceResult> {
        const spec = MIRROR_WRITE_SPEC[resource];
        try {
          const window = windowFor(resource, since(resource), now);
          const backfill = resource === "shifts" ? admittedShiftWindow(window.modifiedSince, now) : null;
          let raw: unknown[] = [];
          let pages = 0;
          let pageError: string | null = null;
          for (const w of backfill ? [window, backfill] : [window]) {
            const got = await client.get(resource, { companyId: cid, window: w });
            if (got.kind === "list") {
              raw.push(...got.rows);
              pages += got.pages;
              if (!got.complete) { pageError = got.error ?? "bad_pagination"; break; }
            } else {
              raw = [got.value];
              pages = 1;
            }
          }
          const out = resource === "labor_settings"
            ? normalizers.normalizeLaborSettings((raw[0] ?? {}) as Record<string, unknown>)
            : (normalizers[spec.normalizer] as unknown as (xs: readonly unknown[]) => normalizers.Normalized<Row>)(raw);
          // Passes and the horizon backfill may overlap: one row per conflict key, counted once.
          const rows = spec.mode === "upsert" ? dedupeOnKey(out.rows as Row[], spec.onConflict) : (out.rows as Row[]);
          await upsert(resource, rows);
          if (resource === "users") for (const r of rows) fetchedUsers.add(String(r.id));
          const error_code = pageError ?? (out.rejected.length > 0 ? "rejected_rows" : null);
          return { rows: rows.length, skipped: out.rejected.length, pages, error_code };
        } catch (e) {
          return { rows: 0, skipped: 0, pages: 0, error_code: codeOf(e) };
        }
      }

      async function reconcileResource(kind: "assignments" | "wages"): Promise<ResourceResult> {
        const result: ResourceResult = { rows: 0, skipped: 0, pages: 0, error_code: null, failed_users: 0 };
        let users: string[];
        try {
          users = await usersToReconcile(fetchedUsers);
        } catch (e) {
          return { ...result, error_code: codeOf(e) };
        }
        for (const userId of users) {
          let rows: Row[];
          let complete: boolean;
          try {
            const got = await client.get(kind, { companyId: cid, userId, window: windowFor(kind, null, now) });
            result.pages += 1;
            const out = kind === "assignments"
              ? normalizers.normalizeAssignments(userId, got.kind === "snapshot" ? (got.value as AssignmentsSnapshot) : { locations: [], departments: [], roles: [] })
              : normalizers.normalizeWages(userId, got.kind === "snapshot" ? (got.value as WagesSnapshot) : { current_wages: [], upcoming_wages: [] });
            rows = out.rows as unknown as Row[];
            complete = got.kind === "snapshot" && out.rejected.length === 0;
            result.skipped += out.rejected.length;
          } catch (e) {
            // The request or its shape failed: this user is NOT reconciled at all, so nothing of theirs retires.
            result.failed_users! += 1;
            result.error_code ??= codeOf(e);
            if (codeOf(e) === "deadline") break;
            continue;
          }
          try {
            const { error } = await bounded(db.rpc("reconcile_sevenshifts_user_snapshot", {
              p_run: runId, p_user: userId, p_kind: kind, p_complete: complete, p_rows: rows,
            }));
            if (error) throw new Error(signal.aborted ? "deadline" : "write_failed");
            result.rows += rows.length;
            if (!complete) {
              result.failed_users! += 1;
              result.error_code ??= "incomplete_snapshot";
            }
          } catch (e) {
            result.failed_users! += 1;
            result.error_code ??= codeOf(e);
            if (codeOf(e) === "deadline") break;
          }
        }
        return result;
      }

      async function usersToReconcile(fromThisRun: ReadonlySet<string>): Promise<string[]> {
        // This run's users (any status: an inactive user modified in the window is reconciled too)
        // plus every user the mirror holds as active. An inactive, unmodified user is never touched.
        const live = await bounded(selectAllRows<{ id: string | number }>((from, to) =>
          db.from("sevenshifts_users").select("id").eq("active", true).order("id", { ascending: true }).range(from, to)));
        const ids = new Set<string>(fromThisRun);
        for (const r of live) ids.add(String(r.id));
        return [...ids].filter((id) => /^\d{1,18}$/.test(id)).sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0));
      }

      for (const resource of SYNC_ORDER) {
        if (resource === "assignments" || resource === "wages") {
          results[resource] = await reconcileResource(resource);
        } else {
          results[resource] = await listOrSingleton(resource);
        }
        if (results[resource]!.error_code === null) succeeded.add(resource);
      }
    }
  }

  // ── finish: state, the ledger row, the heartbeat — under their own budget ──
  for (const r of SYNC_ORDER) if (!(r in results)) results[r] = { rows: 0, skipped: 0, pages: 0, error_code: companyId === null ? "not_run" : "failed" };
  const failedResources = SYNC_ORDER.filter((r) => results[r]!.error_code !== null);
  const runStatus: SyncStatus = companyId === null || results.whoami?.error_code
    ? "failed"
    : failedResources.length === 0 ? "ok" : failedResources.length === SYNC_ORDER.length ? "failed" : "partial";
  const finish = AbortSignal.timeout(SYNC_FINISH_BUDGET_MS);
  const finishedAt = new Date(Math.max(Date.now(), now.getTime())).toISOString();

  const persistenceErrors: PersistenceErrorCode[] = [];
  /** A write that resolved with `error` (Supabase never throws), threw, or ran out of budget did NOT land. */
  const landed = async (write: PromiseLike<{ error: unknown }>): Promise<boolean> => {
    try {
      const { error } = await withDeadline(write, finish);
      return !error;
    } catch {
      return false;
    }
  };
  if (runMinted && companyId !== null) {
    // A missed state write only means the next run re-reads more — but it is never reported as written.
    const ok = SYNC_ORDER.filter((r) => succeeded.has(r)).map((resource) => ({
      resource, last_success_at: startedAt, modified_watermark: startedAt, last_error_code: null, updated_at: finishedAt,
    }));
    const bad = failedResources.map((resource) => ({ resource, last_error_code: results[resource]!.error_code, updated_at: finishedAt }));
    let stateLanded = true;
    if (ok.length && !(await landed(db.from("sevenshifts_sync_state").upsert(ok, { onConflict: "resource" })))) stateLanded = false;
    if (bad.length && !(await landed(db.from("sevenshifts_sync_state").upsert(bad, { onConflict: "resource" })))) stateLanded = false;
    if (!stateLanded) persistenceErrors.push("state_write_failed");
  }
  if (runMinted) {
    // Fail-open: the run id without a ledger row reads as "interrupted" on the screen.
    const ledgerLanded = await landed(db.from("sevenshifts_sync_runs").insert({
      id: runId, trigger, requested_by: requestedBy, started_at: startedAt, finished_at: finishedAt,
      status: runStatus, company_id: companyId, requests: counter.requests, results,
    }));
    if (!ledgerLanded) persistenceErrors.push("ledger_write_failed");
  }
  try {
    await withDeadline((deps.audit ?? auditImpl)({
      actorId: null, actorRole: null, action: runStatus === "ok" && persistenceErrors.length === 0 ? "cron.success" : "cron.failure",
      resourceTable: "cron", resourceId: null,
      metadata: {
        job: trigger === "cron" ? "sevenshifts-sync" : "sevenshifts-sync-manual",
        status: runStatus, requests: counter.requests, persistence_errors: persistenceErrors,
        errors: [...(results.whoami?.error_code ? [`whoami:${results.whoami.error_code}`] : []),
          ...failedResources.map((r) => `${r}:${results[r]!.error_code}`),
          ...persistenceErrors.map((c) => `persistence:${c}`)],
      },
      ipAddress: null, userAgent: null,
    }), finish);
  } catch { /* the heartbeat is fail-open and bounded */ }

  return { ran: true, runId: runMinted ? runId : null, status: runStatus, requests: counter.requests, results, persistenceErrors };
}

/**
 * The ET dates the rolling shift horizon admitted since the last good run (chunk B review #2):
 * (ET date of `modifiedSince` + lookahead, today + lookahead], read WITHOUT `modified_since`. The overlap
 * instant (watermark − 48 h) is used, so the range errs wide. null on a first run (the whole window is
 * already a backfill) or when nothing new was admitted.
 */
export function admittedShiftWindow(modifiedSince: string | null, now: Date): SyncWindow | null {
  if (modifiedSince === null) return null;
  const to = etYmdMinusDays(etCalendarDate(now.toISOString()), -SHIFT_LOOKAHEAD_DAYS);
  const previousTo = etYmdMinusDays(etCalendarDate(new Date(Date.parse(modifiedSince)).toISOString()), -SHIFT_LOOKAHEAD_DAYS);
  const from = etYmdMinusDays(previousTo, -1);
  return from <= to ? { modifiedSince: null, from, to } : null;
}

/** One row per conflict key, the LAST one read winning (passes and requests may overlap). */
function dedupeOnKey(rows: Row[], key: readonly string[]): Row[] {
  const byKey = new Map<string, Row>();
  for (const r of rows) byKey.set(key.map((k) => String(r[k])).join("|"), r);
  return byKey.size === rows.length ? rows : [...byKey.values()];
}

/** The window each resource is read with (ET business dates → the endpoint table makes instants). */
function windowFor(resource: SevenShiftsResource, modifiedSince: string | null, now: Date): SyncWindow {
  const today = etCalendarDate(now.toISOString());
  const from = etYmdMinusDays(today, BACKFILL_DAYS);
  const to = resource === "shifts" ? etYmdMinusDays(today, -SHIFT_LOOKAHEAD_DAYS) : today;
  return { modifiedSince, from, to };
}
