import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { etYmdMinusDays } from "@/lib/operational-day";
import { captureEnabled, captureToastDaySystem } from "./capture";
import { captureBudget, captureErrorCode } from "./capture-runner";
import { coverHouseNoteEvidence, runHouseCateringToast, type HouseReconcileResult } from "@/lib/catering/catering-toast-reconcile";

/** Additive best-effort capture. One deadline includes location reads and both dates. */
export async function captureIntraday(today: string, signal?: AbortSignal, remainingMs = 45_000) {
  if (!captureEnabled()) return { failures: 0, results: [], skipped: true };
  if (remainingMs <= 0) return { failures: 0, results: [], skipped: true, reason: "capture_route_time_exhausted" };
  const deadlineAt = Date.now() + Math.min(45_000, remainingMs);
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
    let cateringToast: HouseReconcileResult | null | undefined;
    // Reconcile committed snapshots even if a different shop/date failed. The
    // planner reads latest published pointers globally; this range only scopes
    // automatic review resolution. Yesterday's +7 late ring reaches today-8,
    // and today's -1 early ring can cover tomorrow. No depletion flag required.
    if (!budget.signal.aborted && hasPublishedCapture) {
      // Item 21 PR 4 (review PORTAL4-r1): the one note lookup examines the captures nobody examined yet, BEFORE either
      // reconciler admits a check. Off unless a shop's settings say so. If it fails or runs out of time the unexamined
      // checks stay pending for both sources (0348 refuses them in SQL); it is never part of this run's failures.
      await coverHouseNoteEvidence({ from: etYmdMinusDays(today, 1), to: today, maxDays: 2, deadlineAt: Math.min(deadlineAt, Date.now() + 12_000), signal: budget.signal });
      try {
        const reconciliation = await budget.wait(() => sb.rpc("reconcile_ezcater_toast", {
          p_from: etYmdMinusDays(today, 8), p_to: etYmdMinusDays(today, -1),
        }).abortSignal(budget.signal));
        if (reconciliation.error) throw new Error("capture_reconciliation_failed");
      } catch (error) { reconciliationError = captureErrorCode(error); }
      // Item 21 PR 4: the HOUSE reconciler, AFTER the ezCater one returned and as its own requests (its own
      // transactions: the ezCater reconciler never runs inside a savepoint). Off unless a shop's settings say so;
      // fail-soft, never part of this run's failures.
      // Bounded by its own deadline inside this route's; what it could not do, the next tick does.
      if (!budget.signal.aborted) {
        cateringToast = await runHouseCateringToast({ from: etYmdMinusDays(today, 8), to: etYmdMinusDays(today, -1), today,
          deadlineAt: Math.min(deadlineAt, Date.now() + 15_000), signal: budget.signal });
      }
    }
    return { failures: results.filter((r) => r.error).length + (reconciliationError ? 1 : 0), results, skipped: false,
      ...(reconciliationError ? { error: reconciliationError } : {}), ...(cateringToast !== undefined ? { cateringToast } : {}) };
  } catch (error) {
    return { failures: 1, results, skipped: false, error: captureErrorCode(error) };
  } finally { budget.close(); }
}
