import type { ToastOrderClass, ToastOrderSummary } from "./catering-orders-shared";
import { etCalendarDate, etYmdMinusDays } from "../operational-day";

export interface CachedDiningOption { guid: string; name: string; updated_at: string }
export interface CateringChannel { dining_option_label: string; channel: string; provider: string | null; reviewed_at: string | null }

export interface CateringCaptureRun { finished_at: string; catering_status: "pending" | "complete" | "degraded"; catering_error_code: string | null }
export function cateringCaptureRunError(run: CateringCaptureRun, businessDate: string, now = Date.now()): string | null {
  if (run.catering_status !== "complete") {
    return ["capture_catering_config_stale", "capture_catering_channel_unreviewed", "capture_catering_deadline", "capture_catering_processing_failed"].includes(run.catering_error_code ?? "")
      ? run.catering_error_code : "capture_catering_pending";
  }
  const finishedAt = Date.parse(run.finished_at);
  const yesterday = etYmdMinusDays(etCalendarDate(new Date(now).toISOString()), 1);
  if (!Number.isFinite(finishedAt) || finishedAt > now || (businessDate >= yesterday && now - finishedAt > 20 * 60_000)) return "capture_catering_stale";
  return null;
}

/** GUID -> cached label -> reviewed channel. Labels are join keys, never fuzzy matches. */
export function captureCateringContext(
  orders: readonly ToastOrderSummary[],
  dining: readonly CachedDiningOption[],
  channels: readonly CateringChannel[],
  now = Date.now(),
) {
  const fresh = (row: CachedDiningOption) => {
    const timestamp = Date.parse(row.updated_at);
    return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= 3600_000;
  };
  if (!dining.some(fresh)) throw new Error("capture_catering_config_stale");
  const byGuid = new Map(dining.map((row) => [row.guid, row]));
  const byLabel = new Map(channels.map((row) => [row.dining_option_label, row]));
  const names = new Map(dining.map((row) => [row.guid, row.name]));
  const classifications = new Map<string, ToastOrderClass>();
  for (const order of orders) {
    const option = order.diningOptionGuid ? byGuid.get(order.diningOptionGuid) : null;
    if (order.diningOptionGuid && (!option || !fresh(option))) throw new Error("capture_catering_config_stale");
    const channel = option ? byLabel.get(option.name) : null;
    if (option && (!channel?.reviewed_at || channel.channel === "Unknown")) throw new Error("capture_catering_channel_unreviewed");
    let classification: ToastOrderClass = "not_catering";
    if (channel?.provider === "ezCater") classification = "ezcater";
    else if (channel?.channel === "third_party" || order.thirdPartyProvider) classification = "third_party";
    else if (channel?.channel === "catering" || order.source?.trim().toLowerCase() === "catering online ordering") classification = "catering";
    classifications.set(order.guid, classification);
  }
  return { names, classifications };
}
