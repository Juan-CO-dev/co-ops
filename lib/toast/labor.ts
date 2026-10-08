/**
 * Toast labor pull — SERVER-ONLY. Fetches one business day of time entries per Toast-connected
 * shop (+ the jobs list and employees' first names), normalises them to the minimal row
 * (lib/toast/labor-shared.ts: no wages, no tips, no sales) and upserts them into
 * toast_time_entries (0224, service-role only). A data fetch, never an email.
 *
 * Bounded, fail-soft, heartbeat: every shop runs under one AbortSignal deadline; a shop that fails
 * is reported and the others still land; the run writes ONE cron.success / cron.failure row with
 * job "toast-labor-pull" (JOBS_REGISTRY) so job-watch sees a dead pull. Gated by
 * TOAST_LABOR_PULL=1 so nothing runs before 0224 is applied (the job-watch entry is skipped too).
 */
import "server-only";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { toastGet } from "./client";
import { toastBusinessDate } from "./orders";
import { employeeFirstNames, jobTitles, normalizeTimeEntries } from "./labor-shared";

export function laborPullEnabled(): boolean {
  return process.env.TOAST_LABOR_PULL === "1";
}

export interface LaborPullResult {
  ran: boolean;
  results: Array<{ locationId: string; businessDate: string; ok: boolean; rows: number; skipped: number; error?: string }>;
}

/** Never a provider message or payload in the record: a fixed code per failure class. */
function code(e: unknown): string {
  if (e instanceof Error && /^toast_labor_/.test(e.message)) return e.message;
  if (e instanceof Error && e.name === "AbortError") return "toast_labor_deadline";
  if (e instanceof Error && e.name === "ToastApiError") return `toast_labor_${(e as Error & { code?: string }).code ?? "api"}`;
  return "toast_labor_failed";
}

export async function runToastLaborPull(dates: readonly string[], opts: { deadlineMs: number; context: "cron" | "manual" }): Promise<LaborPullResult> {
  if (!laborPullEnabled()) return { ran: false, results: [] };
  const signal = AbortSignal.timeout(Math.max(1_000, opts.deadlineMs));
  const sb = getServiceRoleClient();
  const out: LaborPullResult = { ran: true, results: [] };
  let locations: Array<{ id: string; toast_restaurant_guid: string }> = [];
  try {
    const res = await sb.from("locations").select("id, toast_restaurant_guid").eq("active", true).not("toast_restaurant_guid", "is", null)
      .returns<Array<{ id: string; toast_restaurant_guid: string }>>();
    if (res.error) throw new Error("toast_labor_locations_failed");
    locations = res.data ?? [];
  } catch (e) {
    out.results.push({ locationId: "*", businessDate: dates[0] ?? "", ok: false, rows: 0, skipped: 0, error: code(e) });
  }
  for (const loc of locations) {
    let jobs: Map<string, string> | null = null;
    let employees: Map<string, string> | null = null;
    for (const day of dates) {
      try {
        jobs ??= jobTitles(await toastGet<unknown>("/labor/v1/jobs", loc.toast_restaurant_guid, signal));
        employees ??= employeeFirstNames(await toastGet<unknown>("/labor/v1/employees", loc.toast_restaurant_guid, signal));
        const raw = await toastGet<unknown>(`/labor/v1/timeEntries?businessDate=${toastBusinessDate(day)}`, loc.toast_restaurant_guid, signal);
        const { rows, skipped } = normalizeTimeEntries(raw, { locationId: loc.id, businessDate: day, jobs, employees });
        if (rows.length > 0) {
          const { error } = await sb.from("toast_time_entries")
            .upsert(rows.map((r) => ({ ...r, pulled_at: new Date().toISOString() })), { onConflict: "location_id,time_entry_guid" })
            .abortSignal(signal);
          if (error) throw new Error("toast_labor_write_failed");
        }
        out.results.push({ locationId: loc.id, businessDate: day, ok: true, rows: rows.length, skipped });
      } catch (e) {
        out.results.push({ locationId: loc.id, businessDate: day, ok: false, rows: 0, skipped: 0, error: code(e) });
      }
    }
  }
  const failures = out.results.filter((r) => !r.ok).length;
  await audit({
    actorId: null, actorRole: null, action: failures === 0 ? "cron.success" : "cron.failure", resourceTable: "cron", resourceId: null,
    metadata: {
      job: opts.context === "cron" ? "toast-labor-pull" : "toast-labor-pull-manual", dates,
      rows: out.results.reduce((a, r) => a + r.rows, 0), skipped: out.results.reduce((a, r) => a + r.skipped, 0),
      per_location_failures: failures, errors: out.results.filter((r) => !r.ok).map((r) => `${r.locationId}:${r.businessDate}:${r.error}`),
    },
    ipAddress: null, userAgent: null,
  });
  return out;
}
