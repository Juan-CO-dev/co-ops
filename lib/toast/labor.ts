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
 */
import "server-only";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { etCalendarDate } from "@/lib/operational-day";
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

export type LaborPullContext = "cron" | "manual" | "digest";

export interface LaborPullResult {
  ran: boolean;
  results: Array<{ locationId: string; businessDate: string; ok: boolean; rows: number; skipped: number; error?: string }>;
  /** Rows written from the modification window (edits + archive tombstones). */
  modified: number;
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

/** Settle `p` or reject with toast_labor_deadline when the signal fires — whichever comes first. */
export function withDeadline<T>(p: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("toast_labor_deadline"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("toast_labor_deadline"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(p).then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
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
  const signal = AbortSignal.timeout(Math.max(1_000, opts.deadlineMs));
  const now = opts.now ?? new Date();
  const todayEt = etCalendarDate(now.toISOString());
  // The module owns the safety boundary: every successful TODAY pull reconciles, while even an
  // explicit stale option cannot make a historical pull release current work.
  const reconcileDate = dates.includes(todayEt) && (opts.reconcileDate === undefined || opts.reconcileDate === todayEt)
    ? todayEt : undefined;
  const out: LaborPullResult = { ran: true, results: [], modified: 0 };
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
    const write = async (rows: LaborEntryRow[]) => {
      if (rows.length === 0) return;
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
      },
      ipAddress: null, userAgent: null,
    }), AbortSignal.timeout(HEARTBEAT_MS));
  } catch { /* the heartbeat is fail-open and bounded; job-watch notices a missing one */ }
  return out;
}
