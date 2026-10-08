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
  _now = Date.now(),
) {
  const byGuid = new Map(dining.map((row) => [row.guid, row]));
  const byLabel = new Map(channels.map((row) => [row.dining_option_label, row]));
  const names = new Map(dining.map((row) => [row.guid, row.name]));
  const classifications = new Map<string, ToastOrderClass>();
  const diagnostics = new Map<string, string>();
  for (const order of orders) {
    const option = order.diningOptionGuid ? byGuid.get(order.diningOptionGuid) : null;
    const channel = option ? byLabel.get(option.name) : null;
    if (order.diningOptionGuid && (!option || !channel?.reviewed_at || channel.channel === "Unknown")) {
      classifications.set(order.guid, "not_catering");
      diagnostics.set(order.guid, option ? "capture_catering_channel_unreviewed" : "capture_catering_option_missing");
      continue;
    }
    if (channel?.provider === "gift_card" || channel?.channel === "gift_card") {
      classifications.set(order.guid, "not_catering");
      continue;
    }
    let classification: ToastOrderClass = "not_catering";
    if (channel?.provider === "ezCater") classification = "ezcater";
    else if (channel?.channel === "third_party" || order.thirdPartyProvider) classification = "third_party";
    else if (channel?.channel === "catering" || order.source?.trim().toLowerCase() === "catering online ordering") classification = "catering";
    classifications.set(order.guid, classification);
  }
  return { names, classifications, diagnostics };
}
