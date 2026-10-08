import "server-only";
import { audit } from "@/lib/audit";
import { captureToastDaySystem, captureEnabled } from "./capture";
import { captureBudget, captureErrorCode } from "./capture-runner";

/** Independent accounting heartbeat; never changes selection pipeline health.
 * One deadline across ALL shops, including a transport that fails to honor abort.
 */
export async function runOrderCapture(locationIds: string[], businessDate: string, context: "cron" | "manual", dates = [businessDate]) {
  if (!captureEnabled()) return { failures: 0, skipped: true, results: [] };
  const budget = captureBudget(context === "cron" ? 150_000 : 60_000);
  try {
    const results: { locationId: string; businessDate: string; error: string | null }[] = [];
    for (const date of [...new Set(dates)]) {
    const dayResults = await Promise.all([...new Set(locationIds)].map(async (locationId) => {
      try {
        const result = await budget.wait(() => captureToastDaySystem(locationId, date, { signal: budget.signal, ...(context === "cron" ? { reconcile: true } : {}) }));
        const error = "reason" in result && result.reason === "capture_schema_missing" ? result.reason : result.reconciliation?.error ?? null;
        return { locationId, businessDate: date, ...result, error };
      } catch (error) {
        return { locationId, businessDate: date, error: captureErrorCode(error) };
      }
    }));
    results.push(...dayResults);
    if (budget.signal.aborted) break;
    }
    const failures = results.filter((r) => r.error !== null).length;
    // Manual repairs must not mask a missing nightly all-location heartbeat.
    const heartbeat = audit({ actorId: null, actorRole: null,
      action: failures ? "cron.failure" : "cron.success", resourceTable: "cron", resourceId: null,
      metadata: { job: context === "cron" ? "toast-order-capture" : "toast-order-capture-manual",
        business_date: businessDate, actor_context: context, failures, results },
      ipAddress: null, userAgent: null });
    // audit() is fail-open, but also bound its latency; on timeout enqueue the failure
    // heartbeat immediately without extending the capture phase's wall-clock budget.
    try { await budget.wait(() => heartbeat); } catch { void heartbeat.catch(() => {}); }
    return { failures, skipped: false, results };
  } finally { budget.close(); }
}
