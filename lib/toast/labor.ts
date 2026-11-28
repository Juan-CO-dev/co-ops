/**
 * Toast labor pull — SERVER-ONLY. Fetches time entries per Toast-connected shop (+ the jobs list and
 * employees' first names), normalises them to the minimal row (lib/toast/labor-shared.ts: no wages,
 * no tips, no sales) and upserts them into toast_time_entries (0224, service-role only). A data
 * fetch, never an email.
 *
 * TWO READS PER SHOP (Astra r2 P2, Toast contract): a businessDate query NEVER returns archived
 * entries, even with includeArchived, so a shift imported and later archived would stay counted
 * forever. Each pull therefore also reads the MODIFICATION window (modifiedStartDate..now,
 * includeArchived=true): archive tombstones arrive there and their rows are marked deleted, whatever
 * business date they belong to.
 *
 * BOUNDED, FAIL-SOFT, HEARTBEAT: one AbortSignal covers EVERY read — the locations query included —
 * and each await is also raced against the deadline, so a driver that ignores the signal cannot
 * stall the run; a shop that fails is reported and the others still land; the heartbeat itself is
 * bounded. Gated by TOAST_LABOR_PULL=1 (nothing runs before 0224 is applied).
 *
 * ONLY IF NEWER (CC ruling D-R2; migration 0361; behind TOAST_LABOR_GUARD, OFF by default): two pulls for one shop
 * can overlap (the 10-minute cron, the nightly, the digest pre-load), and the upsert below lets an OLDER read land
 * last and put an open shift back over its clock-out. With TOAST_LABOR_GUARD exactly "1" every non-empty read is
 * written by ONE call of 0361's `toast_time_entries_apply_newer` instead: a row is stored only when no row is stored
 * or Toast's own `modifiedDate` is later than the stored one; everything else is SKIPPED AND COUNTED, and a skip is
 * a success (the result row stays ok, the reconcile still runs). The counts ride in `LaborPullResult.guard` and in
 * the heartbeat. ON fails CLOSED: an rpc error, a missing function or an answer that is not the eight counts is
 * `toast_labor_write_failed`, never a fallback to the upsert (that would silently reopen the race behind an ON
 * switch). Unset or any other value = OFF = the upsert, byte for byte (tests/toast-labor-guard-off.test.ts).
 * Apply 0361 BEFORE the switch is turned on; runbook: docs/runbooks/toast-labor-guard.md.
 */
import "server-only";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { etCalendarDate } from "@/lib/operational-day";
import { withDeadline as withDeadlineShared } from "@/lib/deadline-shared";
import { toastGet } from "./client";
import { toastModifiedParam } from "./dates-shared";
export { toastModifiedParam } from "./dates-shared";
import { toastBusinessDate } from "./orders";
import { employeeFirstNames, jobTitles, normalizeTimeEntries, type LaborEntryRow } from "./labor-shared";

export function laborPullEnabled(): boolean {
  return process.env.TOAST_LABOR_PULL === "1";
}

/** Separate from the labor reader so the app may deploy safely before migration 0230 is applied. */
export function stationLifecycleEnabled(): boolean {
  return process.env.STATION_LIFECYCLE === "1";
}

/**
 * The D-R2 guard (0361): ON only when the value is EXACTLY "1". Unset, "", "0", "true", " 1": OFF, main's upsert.
 * Turning it on is Juan's call, after 0361 is on prod (with it ON and the function missing every pull fails closed).
 */
export function laborGuardEnabled(): boolean {
  return process.env.TOAST_LABOR_GUARD === "1";
}

/** What 0361's `toast_time_entries_apply_newer` answers: eight whole numbers; received = the sum of the other seven. */
export const LABOR_GUARD_KEYS = ["received", "inserted", "updated", "unchanged", "skipped_same_stamp", "skipped_older",
  "skipped_no_stamp", "duplicates"] as const;
export type LaborGuardCounts = Record<(typeof LABOR_GUARD_KEYS)[number], number>;
export type LaborGuardSkips = Pick<LaborGuardCounts, "skipped_same_stamp" | "skipped_older" | "skipped_no_stamp">;

const zeroGuardCounts = (): LaborGuardCounts => ({ received: 0, inserted: 0, updated: 0, unchanged: 0,
  skipped_same_stamp: 0, skipped_older: 0, skipped_no_stamp: 0, duplicates: 0 });

/**
 * The guarded writer's answer, or null when it is not EXACTLY the contract: a plain object holding the eight keys and
 * nothing else, each a whole number >= 0, `received` = the rows sent = the sum of the other seven. The caller fails
 * closed on null: a count that cannot be trusted is not a write that can be reported as done.
 */
export function parseLaborGuardCounts(data: unknown, sent: number): LaborGuardCounts | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = data as Record<string, unknown>;
  if (Object.keys(raw).length !== LABOR_GUARD_KEYS.length) return null;
  const out = zeroGuardCounts();
  for (const k of LABOR_GUARD_KEYS) {
    const v = raw[k];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return null;
    out[k] = v;
  }
  if (out.received !== sent) return null;
  if (out.inserted + out.updated + out.unchanged + out.skipped_same_stamp + out.skipped_older + out.skipped_no_stamp + out.duplicates !== out.received) return null;
  return out;
}

export type LaborPullContext = "cron" | "manual" | "digest" | "backfill";

export interface LaborPullResult {
  ran: boolean;
  results: Array<{ locationId: string; businessDate: string; ok: boolean; rows: number; skipped: number; error?: string }>;
  /** Rows written from the modification window (edits + archive tombstones). */
  modified: number;
  /**
   * ONLY with TOAST_LABOR_GUARD=1 (absent otherwise): the guarded writer's eight counts summed over every read of the
   * run that was written. `results[].rows` and `modified` keep main's meaning (rows READ), guard or not.
   */
  guard?: LaborGuardCounts;
}

/** How far back the modification window reaches: two nightly cadences, well inside Toast's 1-month cap. */
export const MODIFIED_WINDOW_HOURS = 48;
/** The heartbeat may not hold the caller past its own budget. */
const HEARTBEAT_MS = 5_000;

/** Never a provider message or payload in the record: a fixed code per failure class. */
function code(e: unknown): string {
  if (e instanceof Error && /^toast_labor_/.test(e.message)) return e.message;
  if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")) return "toast_labor_deadline";
  if (e instanceof Error && e.name === "ToastApiError") return `toast_labor_${(e as Error & { code?: string }).code ?? "api"}`;
  return "toast_labor_failed";
}

/** Settle `p` or reject with toast_labor_deadline when the signal fires — whichever comes first.
 *  The mechanism lives in lib/deadline-shared.ts (shared with the 7shifts sync); this keeps its code. */
export function withDeadline<T>(p: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return withDeadlineShared(p, signal, "toast_labor_deadline");
}

export async function runToastLaborPull(
  dates: readonly string[],
  opts: {
    deadlineMs: number;
    context: LaborPullContext;
    locationIds?: readonly string[];
    now?: Date;
    /** Today's ET day only. Reconciliation runs after both its date pull and corrections succeed. */
    reconcileDate?: string;
  },
): Promise<LaborPullResult> {
  if (!laborPullEnabled()) return { ran: false, results: [], modified: 0 };
  // Read ONCE per run: a run is guarded for all of its writes or for none.
  const guard = laborGuardEnabled();
  const guardSkips: Record<string, LaborGuardSkips> = {};
  const signal = AbortSignal.timeout(Math.max(1_000, opts.deadlineMs));
  const now = opts.now ?? new Date();
  const todayEt = etCalendarDate(now.toISOString());
  // The module owns the safety boundary: every successful TODAY pull reconciles, while even an
  // explicit stale option cannot make a historical pull release current work.
  const reconcileDate = dates.includes(todayEt) && (opts.reconcileDate === undefined || opts.reconcileDate === todayEt)
    ? todayEt : undefined;
  const out: LaborPullResult = { ran: true, results: [], modified: 0 };
  if (guard) out.guard = zeroGuardCounts();
  let locations: Array<{ id: string; toast_restaurant_guid: string }> = [];
  try {
    const sb = getServiceRoleClient();
    let q = sb.from("locations").select("id, toast_restaurant_guid").eq("active", true).not("toast_restaurant_guid", "is", null);
    if (opts.locationIds) q = q.in("id", [...opts.locationIds]);
    const res = await withDeadline(q.abortSignal(signal).returns<Array<{ id: string; toast_restaurant_guid: string }>>(), signal);
    if (res.error) throw new Error(signal.aborted ? "toast_labor_deadline" : "toast_labor_locations_failed");
    locations = res.data ?? [];
  } catch (e) {
    out.results.push({ locationId: "*", businessDate: dates[0] ?? "", ok: false, rows: 0, skipped: 0, error: code(e) });
  }
  for (const loc of locations) {
    let reconcileDaySucceeded = false;
    let correctionsSucceeded = false;
    let jobs: Map<string, string> | null = null;
    let employees: Map<string, string> | null = null;
    // TOAST_LABOR_GUARD=1: ONE call of 0361's function per non-empty read. The rows go as the normalizer made them
    // (no pulled_at: the function stamps what it stores). Fail closed; never the upsert.
    const writeGuarded = async (rows: LaborEntryRow[]) => {
      const { data, error } = await withDeadline(getServiceRoleClient()
        .rpc("toast_time_entries_apply_newer", { p_rows: rows }).abortSignal(signal), signal);
      if (error) throw new Error(signal.aborted ? "toast_labor_deadline" : "toast_labor_write_failed");
      const counts = parseLaborGuardCounts(data, rows.length);
      if (!counts || !out.guard) throw new Error("toast_labor_write_failed");
      for (const k of LABOR_GUARD_KEYS) out.guard[k] += counts[k];
      if (counts.skipped_same_stamp + counts.skipped_older + counts.skipped_no_stamp > 0) {
        const s = (guardSkips[loc.id] ??= { skipped_same_stamp: 0, skipped_older: 0, skipped_no_stamp: 0 });
        s.skipped_same_stamp += counts.skipped_same_stamp;
        s.skipped_older += counts.skipped_older;
        s.skipped_no_stamp += counts.skipped_no_stamp;
      }
    };
    const write = async (rows: LaborEntryRow[]) => {
      if (rows.length === 0) return;
      if (guard) return writeGuarded(rows);
      const sb = getServiceRoleClient();
      const { error } = await withDeadline(sb.from("toast_time_entries")
        .upsert(rows.map((r) => ({ ...r, pulled_at: new Date().toISOString() })), { onConflict: "location_id,time_entry_guid" })
        .abortSignal(signal), signal);
      if (error) throw new Error(signal.aborted ? "toast_labor_deadline" : "toast_labor_write_failed");
    };
    const get = (path: string) => withDeadline(toastGet<unknown>(path, loc.toast_restaurant_guid, signal), signal);
    const ctx = async () => {
      jobs ??= jobTitles(await get("/labor/v1/jobs"));
      employees ??= employeeFirstNames(await get("/labor/v1/employees"));
      return { jobs, employees };
    };
    for (const day of dates) {
      try {
        const c = await ctx();
        const raw = await get(`/labor/v1/timeEntries?businessDate=${toastBusinessDate(day)}`);
        const { rows, skipped } = normalizeTimeEntries(raw, { locationId: loc.id, businessDate: day, ...c });
        await write(rows);
        out.results.push({ locationId: loc.id, businessDate: day, ok: true, rows: rows.length, skipped });
        if (day === reconcileDate) reconcileDaySucceeded = true;
      } catch (e) {
        out.results.push({ locationId: loc.id, businessDate: day, ok: false, rows: 0, skipped: 0, error: code(e) });
      }
    }
    // The modification window: edits AND archive tombstones (deleted=true), any business date.
    try {
      const c = await ctx();
      const from = new Date(now.getTime() - MODIFIED_WINDOW_HOURS * 3_600_000);
      const raw = await get(`/labor/v1/timeEntries?modifiedStartDate=${toastModifiedParam(from)}&modifiedEndDate=${toastModifiedParam(now)}&includeArchived=true`);
      const { rows } = normalizeTimeEntries(raw, { locationId: loc.id, businessDate: null, ...c });
      await write(rows);
      out.modified += rows.length;
      correctionsSucceeded = true;
    } catch (e) {
      out.results.push({ locationId: loc.id, businessDate: "modified", ok: false, rows: 0, skipped: 0, error: code(e) });
    }
    if (reconcileDate && stationLifecycleEnabled() && reconcileDaySucceeded && correctionsSucceeded) {
      try {
        const { error } = await withDeadline(getServiceRoleClient().rpc("reconcile_station_lifecycle", {
          p_location_id: loc.id,
          p_day: reconcileDate,
        }).abortSignal(signal), signal);
        if (error) throw new Error(signal.aborted ? "toast_labor_deadline" : "toast_labor_reconcile_failed");
      } catch (e) {
        out.results.push({ locationId: loc.id, businessDate: "reconcile", ok: false, rows: 0, skipped: 0, error: code(e) });
      }
    }
  }
  const failures = out.results.filter((r) => !r.ok).length;
  const job = opts.context === "cron" ? "toast-labor-pull" : `toast-labor-pull-${opts.context}`;
  try {
    await withDeadline(audit({
      actorId: null, actorRole: null, action: failures === 0 ? "cron.success" : "cron.failure", resourceTable: "cron", resourceId: null,
      metadata: {
        job, dates, modified_rows: out.modified,
        rows: out.results.reduce((a, r) => a + r.rows, 0), skipped: out.results.reduce((a, r) => a + r.skipped, 0),
        per_location_failures: failures, errors: out.results.filter((r) => !r.ok).map((r) => `${r.locationId}:${r.businessDate}:${r.error}`),
        // Guard ON only: the eight counts, and the shops where a row was skipped (shop ids and counts; no entry, no person).
        ...(out.guard ? { guard: out.guard, guard_skips_by_location: guardSkips } : {}),
      },
      ipAddress: null, userAgent: null,
    }), AbortSignal.timeout(HEARTBEAT_MS));
  } catch { /* the heartbeat is fail-open and bounded; job-watch notices a missing one */ }
  return out;
}
