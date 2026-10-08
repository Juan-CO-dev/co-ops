import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { reconcileCaptureQuantities, type LegacyCaptureSelection, type QuantityCapture, type CaptureReconciliation } from "./capture-reconciliation-shared";

/** Runs only after publication. Failures alert independently; never undo a captured day. */
export async function recordCaptureReconciliation(locationId: string, businessDate: string, runId: string, captures: QuantityCapture[], signal: AbortSignal) {
  const sb = getServiceRoleClient();
  let result: CaptureReconciliation;
  let errorCode: string | null = null;
  try {
    const rows = await selectAllRows<LegacyCaptureSelection>(async (from, to) => {
      const response = await sb.from("toast_sales_events")
        .select("check_guid,selection_guid,parent_selection_guid,toast_item_guid,item_name,quantity,snapshot_version,voided")
        .eq("location_id", locationId).eq("business_date", businessDate)
        .order("id", { ascending: true }).range(from, to).abortSignal(signal);
      if (response.error) throw new Error("capture_reconciliation_read_failed");
      return { data: response.data as LegacyCaptureSelection[] | null };
    });
    result = reconcileCaptureQuantities(rows, captures);
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
