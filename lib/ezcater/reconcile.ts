import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { captureBudget } from "@/lib/toast/capture-runner";
import { etYmdMinusDays } from "@/lib/operational-day";
import { materializeEzcaterShadow } from "./pass2";
import { loadReconciledSalesWindow } from "./depletion";

/** RECOVERY ONLY (item 1 PR B, plan r3 §4.5 step 3): rebuild the links for an event-date range —
 * pass 2 (note-code links) then the reconcile_ezcater_toast RPC (name-code and daily-batch links) —
 * and NEVER record a comparison. It therefore never reads capture coverage, so the range may end
 * tomorrow (the D+1 early-ring date). Comparisons are recorded afterwards by the normal mode, only
 * up to the last covered date. */
export async function materializeEzcaterLinks(fromDate: string, toDate: string, deadlineAt = Date.now() + 60_000) {
  const result = await materializeEzcaterShadow(fromDate, toDate, deadlineAt);
  if (result.failed || result.deferred || "skipped" in result) return result;
  if (Date.now() >= deadlineAt) return { ...result, deferred: true };
  const budget = captureBudget(deadlineAt - Date.now());
  try {
    const reconciled = await getServiceRoleClient().rpc("reconcile_ezcater_toast", { p_from: fromDate, p_to: toDate }).abortSignal(budget.signal);
    if (reconciled.error) throw new Error("ezcater_reconcile_failed");
    return result;
  } finally { budget.close(); }
}

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
