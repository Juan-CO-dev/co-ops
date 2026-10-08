import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { processToastCateringOrders, type ScanLocationResult } from "@/lib/catering/toast-catering-scan";
import { extractToastOrders } from "./catering-orders-shared";
import { captureCateringContext, type CachedDiningOption, type CateringChannel } from "./capture-catering-shared";

/** Only called AFTER the full-day finish RPC succeeds. Raw contacts stay in request memory;
 * the restricted existing catering ledger is the only persisted customer projection. */
export async function persistCapturedCatering(
  locationId: string,
  rawOrders: unknown[],
  options: { configFresh: boolean; signal?: AbortSignal },
): Promise<ScanLocationResult> {
  const signal = options.signal ?? AbortSignal.timeout(45_000);
  try {
    signal.throwIfAborted();
    if (!options.configFresh) throw new Error("capture_catering_config_stale");
    const sb = getServiceRoleClient();
    const [dining, channels] = await Promise.all([
      selectAllRows<CachedDiningOption>((from, to) => sb.from("toast_dining_options")
        .select("guid,name,updated_at").eq("location_id", locationId).order("guid").range(from, to).abortSignal(signal)),
      selectAllRows<CateringChannel>((from, to) => sb.from("sales_channel_map")
        .select("dining_option_label,channel,provider,reviewed_at").order("dining_option_label").range(from, to).abortSignal(signal)),
    ]);
    const orders = extractToastOrders(rawOrders);
    const context = captureCateringContext(orders, dining, channels);
    return await processToastCateringOrders(locationId, orders, context, signal);
  } catch (error) {
    // Never place provider/DB error strings in public capture status: raw orders contain PII.
    const code = error instanceof Error && ["capture_catering_config_stale", "capture_catering_channel_unreviewed"].includes(error.message)
      ? error.message : signal.aborted ? "capture_catering_deadline" : "capture_catering_processing_failed";
    return { locationId, ok: false, error: code, seen: 0, catering: 0, attributed: 0, createdLeads: 0, lostLeads: 0, refreshed: 0, skipped: 0, errors: 1, unparsedAmounts: 0 };
  }
}
