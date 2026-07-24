/**
 * EZCater intake processor (spec #2c). SERVER-ONLY, service-role, NO actor —
 * this is system ingestion driven by the signed webhook (the FIRST inbound
 * webhook in the codebase).
 *
 * Ledger-first law: EVERY delivery appends to ezcater_events verbatim before
 * any processing — invalid signatures included (forensics). Processing NEVER
 * throws to the route: every failure path stamps `processing_result` and
 * returns (webhook providers retry on non-2xx; our 200 means "recorded").
 *
 * accepted → dedupe on catering_pipeline.external_ref (order uuid; partial
 * unique index backs it) → resolve location via locations.ezcater_caterer_uuid
 * → fetch + normalize order → INSERT lead directly (stage 'inquiry',
 * lead_source 'ezcater', full order context in notes; createLead needs an
 * AuthContext so the system path mirrors its insert shape) + the append-only
 * pipeline event + audit with actor_context 'ezcater_webhook'.
 * cancelled → flag the matching lead's ledger row; the HUMAN moves the stage
 * (a confirmed lead's release then flows W4a per existing wiring).
 *
 * v1 scope honesty (spec): NO auto-advance to confirmed — W4a reserve
 * resolves quote lines and an auto-created lead has none; item→entity mapping
 * + quote synthesis is fast-follow #2c-b.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { parseEzcaterNotification, type EzcaterNotification } from "@/lib/ezcater/webhook-shared";
import { fetchEzcaterOrder } from "@/lib/ezcater/orders";
import type { EzcaterOrder } from "@/lib/ezcater/orders-shared";

export type EzcaterProcessingResult =
  | "created_lead"
  | "duplicate"
  | "cancelled_flagged"
  | "cancelled_unmatched"
  | "unmapped_location"
  | "invalid_signature"
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
  if (error) throw new Error(`ezcater_events append: ${error.message}`);
  return data?.id ?? null;
}

function leadNotes(order: EzcaterOrder): string {
  const lines = order.items.map((it) => {
    const custom = it.customizations.length > 0
      ? ` [${it.customizations.map((c) => `${c.name}${c.quantity != null ? ` x${c.quantity}` : ""}`).join(", ")}]`
      : "";
    const special = it.specialInstructions ? ` — "${it.specialInstructions}"` : "";
    return `• ${it.quantity}× ${it.name}${custom}${special}`;
  });
  const total = order.totalDueCents != null ? `$${(order.totalDueCents / 100).toFixed(2)}` : "n/a";
  return [
    `EZCater order ${order.orderNumber} (${order.orderType ?? "order"}) — auto-created from webhook.`,
    `Handoff: ${order.handoffTime ?? "n/a"} · Total: ${total}`,
    ...lines,
  ].join("\n");
}

/** Entry point for the webhook route. Body already signature-checked; NEVER throws
 *  except when the LEDGER APPEND itself fails (the route 500s so ezCater retries). */
export async function processEzcaterDelivery(rawBody: string, signatureValid: boolean): Promise<{ result: EzcaterProcessingResult }> {
  let raw: unknown = null;
  let notification: EzcaterNotification | null = null;
  try {
    raw = JSON.parse(rawBody) as unknown;
  } catch {
    await appendEvent({ notification: null, raw: { unparseable_body: rawBody.slice(0, 2000) }, signatureValid, result: "error:unparseable_body" });
    return { result: "error:unparseable_body" };
  }
  if (!signatureValid) {
    // Attacker-controllable path: cap what we store (review finding #3).
    await appendEvent({ notification: null, raw: { unverified_body: rawBody.slice(0, 2000) }, signatureValid, result: "invalid_signature" });
    return { result: "invalid_signature" };
  }
  try {
    notification = parseEzcaterNotification(raw);
  } catch {
    await appendEvent({ notification: null, raw, signatureValid, result: "error:bad_notification_shape" });
    return { result: "error:bad_notification_shape" };
  }

  if (notification.entityType !== "Order" || (notification.key !== "accepted" && notification.key !== "cancelled")) {
    await appendEvent({ notification, raw, signatureValid, result: "ignored_event" });
    return { result: "ignored_event" };
  }

  const sb = getServiceRoleClient();

  // Existing lead for this ezCater order?
  const { data: existing, error: exErr } = await sb.from("catering_pipeline")
    .select("id").eq("external_ref", notification.entityId)
    .maybeSingle<{ id: string }>();
  if (exErr) {
    await appendEvent({ notification, raw, signatureValid, result: "error:lookup_failed" });
    return { result: "error:lookup_failed" };
  }

  if (notification.key === "cancelled") {
    const result: EzcaterProcessingResult = existing ? "cancelled_flagged" : "cancelled_unmatched";
    await appendEvent({ notification, raw, signatureValid, result, leadId: existing?.id ?? null });
    return { result };
  }

  // accepted
  if (existing) {
    await appendEvent({ notification, raw, signatureValid, result: "duplicate", leadId: existing.id });
    return { result: "duplicate" };
  }

  const { data: loc, error: locErr } = await sb.from("locations")
    .select("id").eq("ezcater_caterer_uuid", notification.parentId).eq("active", true)
    .maybeSingle<{ id: string }>();
  if (locErr || !loc) {
    await appendEvent({ notification, raw, signatureValid, result: locErr ? "error:location_lookup" : "unmapped_location" });
    return { result: locErr ? "error:location_lookup" : "unmapped_location" };
  }

  let order: EzcaterOrder;
  try {
    order = await fetchEzcaterOrder(notification.entityId);
  } catch (e) {
    const code = e instanceof Error && "code" in e ? String((e as { code: string }).code) : "order_fetch";
    await appendEvent({ notification, raw, signatureValid, result: `error:${code}` });
    return { result: `error:${code}` };
  }

  const eventDate = order.eventTimestamp ? order.eventTimestamp.slice(0, 10) : null;
  const { data: inserted, error: insErr } = await sb.from("catering_pipeline").insert({
    contact_name: `EZCater order ${order.orderNumber}`,
    stage: "inquiry",
    lead_source: "ezcater",
    external_ref: notification.entityId,
    location_id: loc.id,
    headcount: order.headcount,
    event_date: eventDate,
    time_window: order.handoffTime,
    estimated_revenue_cents: order.totalDueCents,
    notes: leadNotes(order),
    created_by: null,
  }).select("id").maybeSingle<{ id: string }>();
  if (insErr || !inserted) {
    // 23505 = the unique external_ref index caught a concurrent duplicate delivery.
    const dup = insErr?.code === "23505";
    await appendEvent({ notification, raw, signatureValid, result: dup ? "duplicate" : "error:lead_insert" });
    return { result: dup ? "duplicate" : "error:lead_insert" };
  }
  const { error: evErr } = await sb.from("catering_pipeline_events").insert({
    pipeline_id: inserted.id,
    from_stage: null,
    to_stage: "inquiry",
    note: `EZCater ${order.orderNumber} accepted (webhook)`,
    actor_id: null,
  });
  if (evErr) {
    await appendEvent({ notification, raw, signatureValid, result: "error:pipeline_event", leadId: inserted.id });
    return { result: "error:pipeline_event" };
  }

  void audit({
    actorId: null,
    actorRole: null,
    action: "catering.pipeline.create",
    resourceTable: "catering_pipeline",
    resourceId: inserted.id,
    metadata: {
      actor_context: "ezcater_webhook",
      lead_source: "ezcater",
      external_ref: notification.entityId,
      order_number: order.orderNumber,
      location_id: loc.id,
    },
    ipAddress: null,
    userAgent: null,
  });

  await appendEvent({ notification, raw, signatureValid, result: "created_lead", leadId: inserted.id });
  return { result: "created_lead" };
}
