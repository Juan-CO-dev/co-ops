import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { captureBudget } from "@/lib/toast/capture-runner";
import { etYmdMinusDays } from "@/lib/operational-day";
import { materializeEzcaterShadow } from "./pass2";
import { loadReconciledSalesWindow } from "./depletion";

/** Shadow and cross-check publication run even while operational PASS 3 is OFF.
 * No caller can mistake partial shadow work for a complete comparison. */
export async function materializeEzcaterReconciliation(fromDate: string, toDate: string, deadlineAt = Date.now() + 60_000) {
  const result = await materializeEzcaterShadow(fromDate, toDate, deadlineAt);
  if (result.failed || result.deferred || "skipped" in result) return result;
  if (Date.now() >= deadlineAt) return { ...result, deferred: true };
  const budget = captureBudget(deadlineAt - Date.now());
  const sb = getServiceRoleClient();
  try {
    const reconciled = await sb.rpc("reconcile_ezcater_toast", { p_from: fromDate, p_to: toDate }).abortSignal(budget.signal);
    if (reconciled.error) throw new Error("ezcater_reconcile_failed");
    const comparison = await budget.wait(() => loadReconciledSalesWindow(sb, {
      fromDate, untilDateExclusive: etYmdMinusDays(toDate, -1),
    }));
    // A missing capture day cannot be recorded as a zero Toast baseline.
    if (comparison.coverage.hasGaps) return { ...result, deferred: true };
    const recorded = await sb.rpc("record_ezcater_reconciled_comparison", {
      p_from: fromDate, p_to: toDate, p_rows: comparison.rows,
    }).abortSignal(budget.signal);
    if (recorded.error) throw new Error("ezcater_comparison_failed");
    return result;
  } finally { budget.close(); }
}
