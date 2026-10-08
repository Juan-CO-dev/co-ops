import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { etYmdMinusDays } from "@/lib/operational-day";
import { captureEnabled, captureToastDaySystem } from "./capture";
import { captureBudget, captureErrorCode } from "./capture-runner";

/** Additive best-effort capture. One deadline includes location reads and both dates. */
export async function captureIntraday(today: string, signal?: AbortSignal, remainingMs = 45_000) {
  if (!captureEnabled()) return { failures: 0, results: [], skipped: true };
  if (remainingMs <= 0) return { failures: 0, results: [], skipped: true, reason: "capture_route_time_exhausted" };
  const budget = captureBudget(Math.min(45_000, remainingMs), signal);
  const results: { locationId: string; date: string; error: string | null; skipped?: boolean }[] = [];
  let hasPublishedCapture = false;
  try {
    const sb = getServiceRoleClient();
    const locations = await budget.wait(() => sb.from("locations")
      .select("id").eq("active", true).not("toast_restaurant_guid", "is", null).abortSignal(budget.signal));
    if (locations.error) throw new Error("capture_location_unavailable");
    for (const date of [today, etYmdMinusDays(today, 1)]) {
      const day = await Promise.all((locations.data ?? []).map(async (location: { id: string }) => {
        try {
          const result = await budget.wait(() => captureToastDaySystem(location.id, date, { debounce: true, minInterval: date === today ? "5 minutes" : "1 hour", signal: budget.signal }));
          if ((!result.skipped && result.runId) || result.reason === "capture_debounced") hasPublishedCapture = true;
          return { locationId: location.id, date, skipped: result.skipped,
            error: result.catering?.ok === false ? result.catering.error ?? "capture_catering_degraded"
              : result.skipped && result.reason !== "capture_debounced" ? result.reason ?? "capture_incomplete" : null };
        } catch (error) { return { locationId: location.id, date, error: captureErrorCode(error) }; }
      }));
      results.push(...day);
      if (budget.signal.aborted) break;
    }
    let reconciliationError: string | null = null;
    // Reconcile committed snapshots even if a different shop/date failed. The
    // planner reads latest published pointers globally; this range only scopes
    // automatic review resolution. Yesterday's +7 late ring reaches today-8,
    // and today's -1 early ring can cover tomorrow. No depletion flag required.
    if (!budget.signal.aborted && hasPublishedCapture) {
      try {
        const reconciliation = await budget.wait(() => sb.rpc("reconcile_ezcater_toast", {
          p_from: etYmdMinusDays(today, 8), p_to: etYmdMinusDays(today, -1),
        }).abortSignal(budget.signal));
        if (reconciliation.error) throw new Error("capture_reconciliation_failed");
      } catch (error) { reconciliationError = captureErrorCode(error); }
    }
    return { failures: results.filter((r) => r.error).length + (reconciliationError ? 1 : 0), results, skipped: false,
      ...(reconciliationError ? { error: reconciliationError } : {}) };
  } catch (error) {
    return { failures: 1, results, skipped: false, error: captureErrorCode(error) };
  } finally { budget.close(); }
}
