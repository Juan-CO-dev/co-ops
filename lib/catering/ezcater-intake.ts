/**
 * EZCater intake processor (spec #2c, extended by Amendment A1.1/A1.3). SERVER-ONLY,
 * service-role, NO actor — this is system ingestion driven by the signed webhook (the
 * FIRST inbound webhook in the codebase).
 *
 * Ledger-first law: EVERY delivery appends to ezcater_events verbatim before
 * any processing — invalid signatures included (forensics). Processing NEVER
 * throws to the route: every failure path stamps `processing_result` and
 * returns (webhook providers retry on non-2xx; our 200 means "recorded").
 *
 * A1.1 lifecycle table (lib/ezcater/lifecycle-shared.ts `planEzcaterEvent`): an order
 * becomes a lead the moment `submitted` arrives (stage 'inquiry'), or straight at
 * 'confirmed' if `accepted` is the first event we ever see for it (submitted missed).
 * `accepted` on an existing lead moves it to 'confirmed' — the ezManage acceptance click
 * is the human act, so `confirmed` is reached ONLY that way. `modified`/`updated` refresh
 * the order-derived fields in place with no stage change. `cancelled`/`rejected`/`failed`
 * move the lead to 'lost'. `uncancelled` and `succeeded`/`succeeded_with_warnings`/
 * `relish_finalized` are advisory notes only. Every stage move is guarded by the
 * pipeline's own `canTransition`; a refused move is ledgered `illegal_transition` and left
 * for a human, never forced. Lead creation resolves the location via
 * `locations.ezcater_caterer_uuid`, fetches + normalizes the order, inserts the lead
 * (lead_source 'ezcater', full order context in notes, catering manager auto-assigned via
 * A1.3's `resolveCateringManager`) + the append-only pipeline event + audit with
 * `metadata.actor_context: 'ezcater_webhook'` and `actorId: null`.
 *
 * `confirmed` is reached only by `accepted` (the ezManage acceptance = the human act).
 * Prep demand is not touched by the system move: ezCater leads carry no quote until 2c-b.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { parseEzcaterNotification, type EzcaterNotification } from "@/lib/ezcater/webhook-shared";
import { fetchEzcaterOrder } from "@/lib/ezcater/orders";
import type { EzcaterOrder } from "@/lib/ezcater/orders-shared";
import { planEzcaterEvent } from "@/lib/ezcater/lifecycle-shared";
import { isPipelineStage } from "@/lib/catering/pipeline";
import type { PipelineStage } from "@/lib/catering/pipeline-shared";

export type EzcaterProcessingResult =
  | "created_lead"            // submitted (or modified/updated with no lead) → inquiry
  | "created_lead_confirmed"  // accepted with no prior lead → confirmed
  | "stage_moved"             // accepted → confirmed · cancelled/rejected/failed → lost
  | "refreshed"               // modified/updated → fields refreshed in place
  | "noted"                   // uncancelled / succeeded* / relish_finalized → note only
  | "duplicate"
  | "unmatched"               // terminal/advisory event for an order we never saw
  | "illegal_transition"      // canTransition refused; left for the human
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

/**
 * A1.3: the active catering manager scoped to the lead's location, else any active one,
 * else null. Two-query form — no embed: `user_locations` carries THREE FKs
 * (`user_locations_user_id_fkey`, `user_locations_assigned_by_fkey`,
 * `user_locations_location_id_fkey`), two of them to `users`, so a bare `users!inner`
 * embed fails PGRST201 (PostgREST cannot pick which FK to join on). In prod there is
 * currently NO active catering_mgr, so this resolving to null is the expected live
 * outcome today — leads land unassigned until Keith's account exists (Task 4 errand).
 */
async function resolveCateringManager(sb: ReturnType<typeof getServiceRoleClient>, locationId: string): Promise<string | null> {
  const { data: assigned } = await sb.from("user_locations")
    .select("user_id").eq("location_id", locationId).eq("active", true)
    .returns<Array<{ user_id: string }>>();
  const scopedIds = (assigned ?? []).map((r) => r.user_id);
  if (scopedIds.length > 0) {
    const { data: scoped } = await sb.from("users").select("id")
      .in("id", scopedIds).eq("role", "catering_mgr").eq("active", true)
      .order("created_at", { ascending: true }).limit(1).returns<Array<{ id: string }>>();
    if (scoped && scoped.length > 0 && scoped[0]) return scoped[0].id;
  }
  const { data: any } = await sb.from("users").select("id").eq("role", "catering_mgr").eq("active", true)
    .order("created_at", { ascending: true }).limit(1).returns<Array<{ id: string }>>();
  return any && any.length > 0 && any[0] ? any[0].id : null;
}

/** System stage move — mirrors moveStage's guarded UPDATE + append-only event + audit, with NO
 *  operator actor (actor_id null, actor_context 'ezcater_webhook'). Does NOT touch prep demand:
 *  an ezCater lead carries no quote in v1 (2c-b), so reserve/consume/release would early-return. */
async function systemMoveStage(sb: ReturnType<typeof getServiceRoleClient>, lead: { id: string; stage: string }, toStage: PipelineStage, note: string): Promise<boolean> {
  const { error, count } = await sb.from("catering_pipeline")
    .update({ stage: toStage, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", lead.id).eq("stage", lead.stage);
  if (error || count === 0) return false; // moved since read → the retry delivery re-plans
  const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: lead.stage, to_stage: toStage, note, actor_id: null });
  if (evErr) return false;
  void audit({ actorId: null, actorRole: null, action: "catering.pipeline.stage_move", resourceTable: "catering_pipeline", resourceId: lead.id, metadata: { actor_context: "ezcater_webhook", from_stage: lead.stage, to_stage: toStage }, ipAddress: null, userAgent: null });
  return true;
}

/** A1.1 modified/updated: refresh the order-derived fields in place; the lead identity, stage, assignee and human edits to other fields are untouched. */
async function refreshLead(sb: ReturnType<typeof getServiceRoleClient>, lead: { id: string; stage: string }, order: EzcaterOrder, note: string): Promise<boolean> {
  const { error } = await sb.from("catering_pipeline").update({
    headcount: order.headcount,
    event_date: order.eventTimestamp ? order.eventTimestamp.slice(0, 10) : null,
    time_window: order.handoffTime,
    estimated_revenue_cents: order.totalDueCents,
    notes: leadNotes(order),
    updated_at: new Date().toISOString(),
  }).eq("id", lead.id);
  if (error) return false;
  // catering_pipeline_events.to_stage is NOT NULL: a same-stage row is a NOTE, not a
  // transition, so a refresh writes from_stage = to_stage = the lead's current stage.
  const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: lead.stage, to_stage: lead.stage, note, actor_id: null });
  if (evErr) return false; // fields landed, the trail did not — report it, never claim success
  void audit({ actorId: null, actorRole: null, action: "catering.pipeline.edit", resourceTable: "catering_pipeline", resourceId: lead.id, metadata: { actor_context: "ezcater_webhook", reason: "ezcater_order_modified" }, ipAddress: null, userAgent: null });
  return true;
}

/** Note-only ledger row (uncancelled / succeeded* / relish_finalized / illegal_transition).
 *  Same NOT-NULL reasoning as refreshLead above: from_stage = to_stage = the lead's current
 *  stage — a same-stage row is a note, not a transition. */
async function noteLead(sb: ReturnType<typeof getServiceRoleClient>, lead: { id: string; stage: string }, note: string): Promise<boolean> {
  const { error } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: lead.stage, to_stage: lead.stage, note, actor_id: null });
  return !error;
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

  if (notification.entityType !== "Order") {
    await appendEvent({ notification, raw, signatureValid, result: "ignored_event" });
    return { result: "ignored_event" };
  }

  const sb = getServiceRoleClient();
  const { data: existing, error: exErr } = await sb.from("catering_pipeline")
    .select("id, stage").eq("external_ref", notification.entityId)
    .maybeSingle<{ id: string; stage: string }>();
  if (exErr) {
    await appendEvent({ notification, raw, signatureValid, result: "error:lookup_failed" });
    return { result: "error:lookup_failed" };
  }
  const existingStage: PipelineStage | null = existing && isPipelineStage(existing.stage) ? existing.stage : null;
  const plan = planEzcaterEvent(notification.key, existing ? existingStage : null);
  const label = `EZCater ${notification.key} (webhook)`;

  switch (plan.action) {
    case "ignore": { await appendEvent({ notification, raw, signatureValid, result: "ignored_event", leadId: existing?.id ?? null }); return { result: "ignored_event" }; }
    case "duplicate": { await appendEvent({ notification, raw, signatureValid, result: "duplicate", leadId: existing?.id ?? null }); return { result: "duplicate" }; }
    case "unmatched": { await appendEvent({ notification, raw, signatureValid, result: "unmatched" }); return { result: "unmatched" }; }
    case "note": {
      const noted = existing ? await noteLead(sb, existing, label) : true;
      const result: EzcaterProcessingResult = noted ? "noted" : "error:note";
      await appendEvent({ notification, raw, signatureValid, result, leadId: existing?.id ?? null });
      return { result };
    }
    case "illegal_transition": {
      if (existing) await noteLead(sb, existing, `${label} — not applied: ${existing.stage} → ${plan.stage} is not a legal move; needs a human`);
      await appendEvent({ notification, raw, signatureValid, result: "illegal_transition", leadId: existing?.id ?? null });
      return { result: "illegal_transition" };
    }
    case "move": {
      if (!existing) { await appendEvent({ notification, raw, signatureValid, result: "error:missing_lead" }); return { result: "error:missing_lead" }; }
      const ok = await systemMoveStage(sb, existing, plan.stage, label);
      await appendEvent({ notification, raw, signatureValid, result: ok ? "stage_moved" : "error:stage_move", leadId: existing.id });
      return { result: ok ? "stage_moved" : "error:stage_move" };
    }
    case "refresh": {
      if (!existing) { await appendEvent({ notification, raw, signatureValid, result: "error:missing_lead" }); return { result: "error:missing_lead" }; }
      let order: EzcaterOrder;
      try { order = await fetchEzcaterOrder(notification.entityId); }
      catch (e) { const code = e instanceof Error && "code" in e ? String((e as { code: string }).code) : "order_fetch"; await appendEvent({ notification, raw, signatureValid, result: `error:${code}`, leadId: existing.id }); return { result: `error:${code}` }; }
      const ok = await refreshLead(sb, existing, order, label);
      await appendEvent({ notification, raw, signatureValid, result: ok ? "refreshed" : "error:refresh", leadId: existing.id });
      return { result: ok ? "refreshed" : "error:refresh" };
    }
    case "create": {
      // fall through to the create path below
    }
  }

  // create — at inquiry (submitted / first sight) or confirmed (accepted, submitted missed)
  const { data: loc, error: locErr } = await sb.from("locations")
    .select("id").eq("ezcater_caterer_uuid", notification.parentId).eq("active", true)
    .maybeSingle<{ id: string }>();
  if (locErr || !loc) {
    await appendEvent({ notification, raw, signatureValid, result: locErr ? "error:location_lookup" : "unmapped_location" });
    return { result: locErr ? "error:location_lookup" : "unmapped_location" };
  }
  let order: EzcaterOrder;
  try { order = await fetchEzcaterOrder(notification.entityId); }
  catch (e) { const code = e instanceof Error && "code" in e ? String((e as { code: string }).code) : "order_fetch"; await appendEvent({ notification, raw, signatureValid, result: `error:${code}` }); return { result: `error:${code}` }; }

  const assignedTo = await resolveCateringManager(sb, loc.id);
  const stage = plan.stage; // "inquiry" | "confirmed"
  const { data: inserted, error: insErr } = await sb.from("catering_pipeline").insert({
    contact_name: `EZCater order ${order.orderNumber}`,
    stage,
    lead_source: "ezcater",
    external_ref: notification.entityId,
    location_id: loc.id,
    headcount: order.headcount,
    event_date: order.eventTimestamp ? order.eventTimestamp.slice(0, 10) : null,
    time_window: order.handoffTime,
    estimated_revenue_cents: order.totalDueCents,
    notes: leadNotes(order),
    assigned_to: assignedTo,
    created_by: null,
  }).select("id").maybeSingle<{ id: string }>();
  if (insErr || !inserted) {
    const dup = insErr?.code === "23505";
    await appendEvent({ notification, raw, signatureValid, result: dup ? "duplicate" : "error:lead_insert" });
    return { result: dup ? "duplicate" : "error:lead_insert" };
  }
  const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: inserted.id, from_stage: null, to_stage: stage, note: `EZCater ${order.orderNumber} ${notification.key} (webhook)`, actor_id: null });
  if (evErr) { await appendEvent({ notification, raw, signatureValid, result: "error:pipeline_event", leadId: inserted.id }); return { result: "error:pipeline_event" }; }
  void audit({ actorId: null, actorRole: null, action: "catering.pipeline.create", resourceTable: "catering_pipeline", resourceId: inserted.id, metadata: { actor_context: "ezcater_webhook", lead_source: "ezcater", external_ref: notification.entityId, order_number: order.orderNumber, location_id: loc.id, stage, assigned_to: assignedTo, event_key: notification.key }, ipAddress: null, userAgent: null });
  const result: EzcaterProcessingResult = stage === "confirmed" ? "created_lead_confirmed" : "created_lead";
  await appendEvent({ notification, raw, signatureValid, result, leadId: inserted.id });
  return { result };
}
