import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { runOrderCapture } from "@/lib/toast/capture-job";
import { materializeCapturedDepletion } from "@/lib/toast/depletion";
import { completeElapsedCateringEvents } from "@/lib/catering/system-intake";
import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";
import { pullSalesForAllLocations, materializeDailyDepletion } from "@/lib/catering/toast-sales";
import { loadDepletionWatermark } from "@/lib/counts";
import { runParShadowForLocation, recordParRunSkipped } from "@/lib/dynamic-pars";
import { captureErrorCode } from "@/lib/toast/capture-runner";

/** The flag switches readers AND writers; unset restores Stage A's legacy pipeline. */
export async function runToastSalesPull(opts: { businessDate: string; deadlineAt?: number; signal?: AbortSignal }) {
  const { businessDate } = opts;
  const deadlineAt = opts.deadlineAt ?? Date.now() + 300_000;
  const captureMode = process.env.DEPLETION_SOURCE === "capture";
  const dates = [businessDate, etYmdMinusDays(businessDate, 1), etYmdMinusDays(businessDate, 2)];
  const results: { locationId: string; ok: boolean; error?: string }[] = [];
  const depletionRows: Record<string, number> = {};
  const parRows: Record<string, number> = {};
  let depletionFailures = 0;
  let parRunFailures = 0;
  let capture: Awaited<ReturnType<typeof runOrderCapture>>;
  let elapsedCompleted = 0, elapsedFailed = 0;
  let elapsedError: string | null = null;
  try {
    const elapsed = await completeElapsedCateringEvents(etCalendarDate(new Date().toISOString()));
    elapsedCompleted = elapsed.completed.length;
    elapsedFailed = elapsed.failed.length;
  } catch (error) { elapsedError = captureErrorCode(error); }
  if (!captureMode) {
    // Preserve main's pipeline, including zero-row and backfill watermark handling.
    results.push(...await pullSalesForAllLocations(businessDate));
    for (const result of results) {
      if (!result.ok) continue;
      try {
        depletionRows[result.locationId] = (await materializeDailyDepletion(result.locationId, businessDate)).rows;
      } catch { depletionFailures++; }
    }
    for (const result of results) {
      if (!result.ok) continue;
      try {
        const watermark = await loadDepletionWatermark(result.locationId);
        const current = Object.hasOwn(depletionRows, result.locationId) || (watermark != null && watermark >= businessDate);
        const par = current
          ? await runParShadowForLocation(result.locationId, businessDate)
          : await recordParRunSkipped(result.locationId, businessDate, watermark);
        parRows[result.locationId] = par.rows;
      } catch { parRunFailures++; }
    }
    // Additive Stage A capture runs only after the operational legacy work finishes.
    capture = await runOrderCapture(results.map((r) => r.locationId), businessDate, "cron", [businessDate], Math.max(0, deadlineAt - Date.now()), opts.signal);
  } else {
    const sb = getServiceRoleClient();
    const locations = await sb.from("locations").select("id").eq("active", true)
      .not("toast_restaurant_guid", "is", null);
    if (locations.error) throw new Error("capture_location_unavailable");
    const ids = (locations.data ?? []).map((r: { id: string }) => r.id);
    capture = await runOrderCapture(ids, businessDate, "cron", dates, Math.max(0, deadlineAt - Date.now()), opts.signal);
    const completed = new Set<string>();
    for (const date of dates) {
      for (const locationId of ids) {
        const run = capture.results.find((r) => r.locationId === locationId && r.businessDate === date);
        if (!run?.complete) continue;
        try {
          const result = await materializeCapturedDepletion(locationId, date);
          depletionRows[`${locationId}:${date}`] = result.rows;
          // Reviewed-label gaps disclose partial data; they do not invalidate a day.
          completed.add(`${locationId}:${date}`);
        } catch { depletionFailures++; }
      }
    }
    // T-2/T-3 are capture repairs only. Pars are computed once, for T-1.
    for (const locationId of ids) {
      if (!completed.has(`${locationId}:${businessDate}`)) continue;
      try {
        parRows[`${locationId}:${businessDate}`] = (await runParShadowForLocation(locationId, businessDate)).rows;
      } catch { parRunFailures++; }
    }
    for (const locationId of ids) {
      const ok = dates.every((date) => completed.has(`${locationId}:${date}`));
      results.push({ locationId, ok, ...(!ok ? { error: "capture_day_incomplete" } : {}) });
    }
  }
  const perLocationFailures = results.filter((r) => !r.ok).length;
  const healthy = (!captureMode || (!capture.skipped && capture.failures === 0)) && perLocationFailures === 0
    && depletionFailures === 0 && parRunFailures === 0 && elapsedFailed === 0 && elapsedError === null;
  const metadata = {
    job: "toast-sales-pull", source: captureMode ? "capture" : "legacy", business_date: businessDate, dates: captureMode ? dates : [businessDate],
    capture_failures: capture.failures, capture_skipped: capture.skipped,
    per_location_failures: perLocationFailures, depletion_rows: depletionRows,
    depletion_failures: depletionFailures, par_rows: parRows, par_run_failures: parRunFailures,
    pars_pending_activation: false,
    elapsed_completed: elapsedCompleted, elapsed_failed: elapsedFailed, elapsed_error: elapsedError,
  };
  return { businessDate, results, metadata, healthy };
}
