import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadCapturedToastDay } from "./captured-day";
import { reconcileCaptureQuantities, type LegacyCaptureSelection, type QuantityCapture, type CaptureReconciliation } from "./capture-reconciliation-shared";

/** Runs only after publication. Failures alert independently; never undo a captured day. */
export async function recordCaptureReconciliation(locationId: string, businessDate: string, runId: string, captures: QuantityCapture[], signal: AbortSignal) {
  const sb = getServiceRoleClient();
  let result: CaptureReconciliation;
  let errorCode: string | null = null;
  try {
    signal.throwIfAborted();
    const day = await loadCapturedToastDay(locationId, businessDate);
    signal.throwIfAborted();
    const rows: LegacyCaptureSelection[] = (day?.orders ?? []).flatMap(order => {
      const deletedChecks = new Set(order.checks.filter(check => check.deleted).map(check => check.checkGuid));
      return order.selections.map(row => ({
        check_guid: row.check_guid, selection_guid: row.selection_guid,
        parent_selection_guid: row.parent_selection_guid, toast_item_guid: row.item_guid,
        item_name: row.name, quantity: row.quantity, snapshot_version: 1,
        voided: row.voided || row.deleted || order.deleted || deletedChecks.has(row.check_guid),
      }));
    });
    // A successful empty capture is a known zero; missing coverage is unknown.
    result = reconcileCaptureQuantities(rows, captures, day !== null);
  } catch {
    errorCode = "capture_reconciliation_read_failed";
    result = { status: "skipped", old_units: null, new_units: null, mismatched_items: [] };
  }
  const saved = await sb.from("toast_capture_reconciliations").insert({
    location_id: locationId, business_date: businessDate, run_id: runId, ...result,
  }).abortSignal(signal);
  if (saved.error) throw new Error("capture_reconciliation_write_failed");
  return { status: result.status, error: errorCode ?? (result.status === "match" ? null : `capture_reconciliation_${result.status}`) };
}
