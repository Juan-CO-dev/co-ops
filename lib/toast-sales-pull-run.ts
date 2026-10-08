import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { runOrderCapture } from "@/lib/toast/capture-job";
import { materializeCapturedDepletion } from "@/lib/toast/depletion";
import { completeElapsedCateringEvents } from "@/lib/catering/system-intake";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";
import { runParShadowForLocation } from "@/lib/dynamic-pars";
import { captureErrorCode } from "@/lib/toast/capture-runner";

/** Scheduler URL retained; implementation is capture -> materialize -> shadow pars. */
export async function runToastSalesPull(opts: { businessDate: string }) {
  const { businessDate } = opts;
  const dates = [businessDate, etYmdMinusDays(businessDate, 1), etYmdMinusDays(businessDate, 2)];
  const sb = getServiceRoleClient();
  const locations = await sb.from("locations").select("id").eq("active", true)
    .not("toast_restaurant_guid", "is", null);
  if (locations.error) throw new Error("capture_location_unavailable");
  const ids = (locations.data ?? []).map((r: { id: string }) => r.id);
  // All requested captures finish before any materialization or par computation.
  const capture = await runOrderCapture(ids, businessDate, "cron", dates);
  const results: { locationId: string; ok: boolean; error?: string }[] = [];
  const depletionRows: Record<string, number> = {};
  const parRows: Record<string, number> = {};
  const completed = new Set<string>();
  let depletionFailures = 0;
  let parRunFailures = 0;
  for (const date of dates) {
    for (const locationId of ids) {
      const run = capture.results.find((r) => r.locationId === locationId && r.businessDate === date);
      if (!run?.complete) continue;
      try {
        const result = await materializeCapturedDepletion(locationId, date);
        depletionRows[`${locationId}:${date}`] = result.rows;
        completed.add(`${locationId}:${date}`);
      } catch { depletionFailures++; }
    }
  }
  // Reader activation is deliberately separate from warming the new projection.
  // Never run pars over a default-legacy reader whose old writer has been retired.
  if (process.env.DEPLETION_SOURCE === "capture") {
    for (const date of dates) {
      for (const locationId of ids) {
        if (!completed.has(`${locationId}:${date}`)) continue;
        try {
          const result = await runParShadowForLocation(locationId, date);
          parRows[`${locationId}:${date}`] = result.rows;
        } catch { parRunFailures++; }
      }
    }
  }
  for (const locationId of ids) {
    const ok = dates.every((date) => completed.has(`${locationId}:${date}`));
    results.push({ locationId, ok, ...(!ok ? { error: "capture_day_incomplete" } : {}) });
  }
  let elapsedCompleted = 0, elapsedFailed = 0;
  let elapsedError: string | null = null;
  try {
    const elapsed = await completeElapsedCateringEvents(etCalendarDate(new Date().toISOString()));
    elapsedCompleted = elapsed.completed.length;
    elapsedFailed = elapsed.failed.length;
  } catch (error) { elapsedError = captureErrorCode(error); }
  const perLocationFailures = results.filter((r) => !r.ok).length;
  const healthy = !capture.skipped && capture.failures === 0 && perLocationFailures === 0
    && depletionFailures === 0 && parRunFailures === 0 && elapsedFailed === 0 && elapsedError === null;
  const metadata = {
    job: "toast-sales-pull", source: "capture", business_date: businessDate, dates,
    capture_failures: capture.failures, capture_skipped: capture.skipped,
    per_location_failures: perLocationFailures, depletion_rows: depletionRows,
    depletion_failures: depletionFailures, par_rows: parRows, par_run_failures: parRunFailures,
    pars_pending_activation: process.env.DEPLETION_SOURCE !== "capture",
    elapsed_completed: elapsedCompleted, elapsed_failed: elapsedFailed, elapsed_error: elapsedError,
  };
  return { businessDate, results, metadata, healthy };
}
