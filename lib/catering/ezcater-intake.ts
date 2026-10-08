/** Signed webhook ledger + transactional structured order apply (0223). */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { parseEzcaterNotification, type EzcaterNotification } from "@/lib/ezcater/webhook-shared";
import { EZCATER_ORDER_EVENT_KEYS } from "@/lib/ezcater/lifecycle-shared";
import { syncEzcaterOrder } from "@/lib/ezcater/sync";

export type EzcaterProcessingResult =
  | "created_lead"            // submitted (or modified/updated with no lead) → inquiry
  | "created_lead_confirmed"  // accepted with no prior lead → confirmed
  | "stage_moved"             // accepted → confirmed · cancelled/rejected/failed → lost
  | "stage_moved_no_trail"    // the stage changed but the event row did not land
  | "refreshed"               // modified/updated → fields refreshed in place
  | "noted"                   // succeeded* / relish_finalized → note only
  | "uncancelled_needs_human" // uncancelled → note written, but flagged for a human to see
  | "duplicate"
  | "unmatched"               // terminal/advisory event for an order we never saw
  | "illegal_transition"      // canTransition refused; left for the human
  | "unmapped_location"
  | "invalid_signature"
  | "sync_error"
  | "ignored_event"
  | `error:${string}`;

async function appendEvent(args: {
  notification: EzcaterNotification | null;
  raw: unknown;
  signatureValid: boolean;
  result: EzcaterProcessingResult;
  leadId?: string | null;
}): Promise<string | null> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("ezcater_events").insert({
    notification_id: args.notification?.notificationId ?? null,
    parent_id: args.notification?.parentId ?? null,
    entity_id: args.notification?.entityId ?? null,
    event_key: args.notification?.key ?? null,
    occurred_at: args.notification?.occurredAt ?? null,
    raw: args.raw ?? {},
    signature_valid: args.signatureValid,
    processing_result: args.result,
    lead_id: args.leadId ?? null,
  }).select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error("ezcater_events_append_failed");
  return data?.id ?? null;
}

/** Receipt is durable before provider I/O; failed apply persistence throws for provider retry. */
export async function processEzcaterDelivery(rawBody: string, signatureValid: boolean): Promise<{ result: EzcaterProcessingResult }> {
  let raw: unknown;
  let notification: EzcaterNotification;
  if (!signatureValid) {
    await appendEvent({ notification: null, raw: {}, signatureValid, result: "invalid_signature" });
    return { result: "invalid_signature" };
  }
  try { raw = JSON.parse(rawBody) as unknown; }
  catch {
    await appendEvent({ notification: null, raw: {}, signatureValid, result: "error:unparseable_body" });
    return { result: "error:unparseable_body" };
  }
  try { notification = parseEzcaterNotification(raw); }
  catch {
    await appendEvent({ notification: null, raw: {}, signatureValid, result: "error:bad_notification_shape" });
    return { result: "error:bad_notification_shape" };
  }
  // Store notification identities only, never arbitrary provider payload/contact fields.
  const safeRaw = { id: notification.notificationId, parent_id: notification.parentId,
    entity_id: notification.entityId, entity_type: notification.entityType,
    key: notification.key, occurred_at: notification.occurredAt };
  const ctx = { notification, raw: safeRaw, signatureValid };
  if (notification.entityType !== "Order" || !EZCATER_ORDER_EVENT_KEYS.some((key) => key === notification.key)) {
    await appendEvent({ ...ctx, result: "ignored_event" });
    return { result: "ignored_event" };
  }
  const receiptId = await appendEvent({ ...ctx, result: "error:sync_pending" });
  if (!receiptId) throw new Error("ezcater_events_append_failed");
  const applied = await syncEzcaterOrder(notification.entityId, notification.parentId, { eventKey: notification.key });
  const result = applied.result as EzcaterProcessingResult;
  const { data, error } = await getServiceRoleClient().from("ezcater_events")
    .update({ processing_result: result, lead_id: applied.lead_id })
    .eq("id", receiptId).select("id").maybeSingle<{ id: string }>();
  if (error || !data) throw new Error("ezcater_events_update_failed");
  return { result };
}
