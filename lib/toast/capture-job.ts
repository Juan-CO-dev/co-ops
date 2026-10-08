import "server-only";
import { audit } from "@/lib/audit";
import { captureToastDaySystem, captureEnabled } from "./capture";
import { captureBudget, captureErrorCode } from "./capture-runner";

export interface CaptureJobResult {
  locationId: string; businessDate: string; complete: boolean; error: string | null;
  runId?: string; skipped?: boolean;
}
/** One bounded capture phase for all shops/dates. Legacy parity is an operator gate,
 * not a nightly health dependency after the old ledger stops receiving writes. */
export async function runOrderCapture(locationIds: string[], businessDate: string, context: "cron" | "manual", dates = [businessDate]) {
  if (!captureEnabled()) return { failures: 0, skipped: true, results: [] as CaptureJobResult[] };
  const budget = captureBudget(context === "cron" ? 180_000 : 60_000);
  const results: CaptureJobResult[] = [];
  try {
    for (const date of [...new Set(dates)]) {
      results.push(...await Promise.all([...new Set(locationIds)].map(async (locationId): Promise<CaptureJobResult> => {
        try {
          const result = await budget.wait(() => captureToastDaySystem(locationId, date, { signal: budget.signal }));
          const complete = !result.skipped && !!result.runId;
          const error = !complete ? result.reason ?? "capture_incomplete"
            : result.catering?.ok === false ? result.catering.error ?? "capture_catering_degraded" : null;
          return { locationId, businessDate: date, ...result, complete, error };
        } catch (error) { return { locationId, businessDate: date, complete: false, error: captureErrorCode(error) }; }
      })));
    }
    const failures = results.filter((r) => r.error !== null).length;
    const heartbeat = audit({ actorId: null, actorRole: null,
      action: failures ? "cron.failure" : "cron.success", resourceTable: "cron", resourceId: null,
      metadata: { job: context === "cron" ? "toast-order-capture" : "toast-order-capture-manual",
        business_date: businessDate, dates, actor_context: context, failures, results },
      ipAddress: null, userAgent: null });
    try { await budget.wait(() => heartbeat); } catch { void heartbeat.catch(() => {}); }
    return { failures, skipped: false, results };
  } finally { budget.close(); }
}
