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
 * `modified`/`updated` also CREATE (at 'inquiry') when the order was never seen — the order
 * exists, we just missed its `submitted`. `accepted` on an existing lead moves it to
 * 'confirmed' — the ezManage acceptance click is the human act, so `confirmed` is reached
 * ONLY that way. `modified`/`updated` on an existing lead refresh the order-derived fields
 * in place with no stage change; the `notes` field is merged through the ezCater marker
 * block (`mergeEzcaterNotes`) so any human text a manager typed survives the refresh
 * verbatim. `cancelled`/`rejected`/`failed` move the lead to 'lost'. `uncancelled` and
 * `succeeded`/`succeeded_with_warnings`/`relish_finalized` are advisory notes only —
 * `uncancelled` ledgers its own distinct result (`uncancelled_needs_human`) so a human can
 * query for it. Every stage move is guarded by the pipeline's own `canTransition`; a
 * refused move is ledgered `illegal_transition` and left for a human, never forced. Lead
 * creation resolves the location via `locations.ezcater_caterer_uuid`, fetches + normalizes
 * the order, inserts the lead (lead_source 'ezcater', full order context in notes wrapped in
 * the ezCater marker block, catering manager auto-assigned via A1.3's
 * `resolveCateringManager`) + the append-only pipeline event + audit with
 * `metadata.actor_context: 'ezcater_webhook'` and `actorId: null`. A `23505` unique-violation
 * on insert means a concurrent delivery won the race (I2) — the code re-reads the lead and
 * re-plans once rather than blindly ledgering `duplicate`.
 *
 * `confirmed` is reached only by `accepted` (the ezManage acceptance = the human act).
 * Prep demand is not touched by the system move: ezCater leads carry no quote until 2c-b.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { parseEzcaterNotification, type EzcaterNotification } from "@/lib/ezcater/webhook-shared";
import { fetchEzcaterOrder } from "@/lib/ezcater/orders";
import type { EzcaterOrder } from "@/lib/ezcater/orders-shared";
import { mergeEzcaterNotes, planEzcaterEvent, wrapEzcaterNotes } from "@/lib/ezcater/lifecycle-shared";
import { isPipelineStage } from "@/lib/catering/pipeline";
import type { PipelineStage } from "@/lib/catering/pipeline-shared";

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
 *
 * Honesty (I3/M2/M3): a query error returns null (unassigned) — it NEVER falls through
 * to the broader lookup, because a DB error is not "no scoped manager found". Bounded
 * order: (1) every active catering_mgr, small set, ordered by creation; if none, null.
 * (2) which of them are scoped to this location; first match in (1)'s creation order.
 * (3) else the first from (1) — the spec'd (A1.3) cross-location fallback, deliberately
 * reached ONLY when the scoped lookup returned zero rows without error.
 */
async function resolveCateringManager(sb: ReturnType<typeof getServiceRoleClient>, locationId: string): Promise<string | null> {
  const { data: activeMgrs, error: mgrErr } = await sb.from("users").select("id")
    .eq("role", "catering_mgr").eq("active", true)
    .order("created_at", { ascending: true }).returns<Array<{ id: string }>>();
  if (mgrErr) return null;
  if (!activeMgrs || activeMgrs.length === 0) return null;

  const mgrIds = activeMgrs.map((m) => m.id);
  const { data: scoped, error: scopedErr } = await sb.from("user_locations")
    .select("user_id").eq("location_id", locationId).eq("active", true)
    .in("user_id", mgrIds).returns<Array<{ user_id: string }>>();
  if (scopedErr) return null;
  if (scoped && scoped.length > 0) {
    const scopedIds = new Set(scoped.map((r) => r.user_id));
    const first = activeMgrs.find((m) => scopedIds.has(m.id));
    if (first) return first.id;
  }

  // Deliberate cross-location fallback (spec A1.3) — reached only because the scoped
  // lookup above returned zero rows, not because it errored.
  return activeMgrs[0]?.id ?? null;
}

/** A lead already resolved from `catering_pipeline`, with a stage confirmed in-vocabulary. */
type ExistingLead = { id: string; stage: PipelineStage };

type SystemMoveOutcome = "moved" | "stage_changed" | "event_failed" | "update_failed";

// FOLLOW-UP: shared applyStageMove with lib/catering/pipeline.ts moveStage (prep-demand sync
// inside) once 2c-b gives ezCater leads quotes.
/** System stage move — mirrors moveStage's guarded UPDATE + append-only event + audit, with NO
 *  operator actor (actor_id null, actor_context 'ezcater_webhook'). Does NOT touch prep demand:
 *  an ezCater lead carries no quote in v1 (2c-b), so reserve/consume/release would early-return.
 *  Returns a discriminated outcome rather than a boolean (I1/C2): "update_failed" is a hard DB
 *  error; "stage_changed" means the guarded UPDATE matched zero rows because a concurrent
 *  delivery already moved this lead (see the `move` case below — there are no provider retries,
 *  so this is the final word, not a hint to retry); "event_failed" means the stage UPDATE
 *  committed but the ledger row did not, which the caller must NOT report as a failed move. */
async function systemMoveStage(sb: ReturnType<typeof getServiceRoleClient>, lead: ExistingLead, toStage: PipelineStage, note: string): Promise<SystemMoveOutcome> {
  const { error, count } = await sb.from("catering_pipeline")
    .update({ stage: toStage, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", lead.id).eq("stage", lead.stage);
  if (error) return "update_failed";
  if (count === 0) return "stage_changed"; // a concurrent delivery already moved it
  const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: lead.stage, to_stage: toStage, note, actor_id: null });
  // The UPDATE above already committed — the stage genuinely moved. The ledger row failing to
  // land is a trail gap, never a failed move, so the caller must not claim "error:stage_move".
  if (evErr) return "event_failed";
  void audit({ actorId: null, actorRole: null, action: "catering.pipeline.stage_move", resourceTable: "catering_pipeline", resourceId: lead.id, metadata: { actor_context: "ezcater_webhook", from_stage: lead.stage, to_stage: toStage }, ipAddress: null, userAgent: null });
  return "moved";
}

/** Perform a "move" plan against an existing lead and ledger the honest outcome. Shared by the
 *  main switch's `move` case and the submitted/accepted race retry (I2) so this mapping is not
 *  duplicated. */
async function applyPlanToExisting(
  sb: ReturnType<typeof getServiceRoleClient>,
  lead: ExistingLead,
  toStage: PipelineStage,
  label: string,
  ctx: { notification: EzcaterNotification | null; raw: unknown; signatureValid: boolean },
): Promise<{ result: EzcaterProcessingResult }> {
  const outcome = await systemMoveStage(sb, lead, toStage, label);
  const result: EzcaterProcessingResult =
    outcome === "moved" ? "stage_moved"
    : outcome === "stage_changed" ? "duplicate"
    : outcome === "event_failed" ? "stage_moved_no_trail"
    : "error:stage_move";
  await appendEvent({ ...ctx, result, leadId: lead.id });
  return { result };
}

/** A1.1 modified/updated: refresh the order-derived fields in place; the lead identity, stage,
 *  and assignee are untouched. `notes` is merged through the ezCater marker block
 *  (`mergeEzcaterNotes`) — the machine-written order block is replaced in place, any human text
 *  before/after the markers is preserved verbatim; the other order-derived fields still receive
 *  a plain overwrite. */
async function refreshLead(sb: ReturnType<typeof getServiceRoleClient>, lead: ExistingLead, order: EzcaterOrder, note: string): Promise<boolean> {
  const { data: current } = await sb.from("catering_pipeline").select("notes").eq("id", lead.id).maybeSingle<{ notes: string | null }>();
  const { error, count } = await sb.from("catering_pipeline").update({
    headcount: order.headcount,
    event_date: order.eventTimestamp ? order.eventTimestamp.slice(0, 10) : null,
    time_window: order.handoffTime,
    estimated_revenue_cents: order.totalDueCents,
    notes: mergeEzcaterNotes(current?.notes, leadNotes(order)),
    updated_at: new Date().toISOString(),
  }, { count: "exact" }).eq("id", lead.id);
  if (error || count === 0) return false;
  // catering_pipeline_events.to_stage is NOT NULL: a same-stage row is a NOTE, not a
  // transition, so a refresh writes from_stage = to_stage = the lead's current stage.
  const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: lead.stage, to_stage: lead.stage, note, actor_id: null });
  if (evErr) return false; // fields landed, the trail did not — report it, never claim success
  void audit({ actorId: null, actorRole: null, action: "catering.pipeline.edit", resourceTable: "catering_pipeline", resourceId: lead.id, metadata: { actor_context: "ezcater_webhook", reason: "ezcater_order_modified", fields: ["headcount", "event_date", "time_window", "estimated_revenue_cents", "notes"] }, ipAddress: null, userAgent: null });
  return true;
}

/** Note-only ledger row (succeeded* / relish_finalized / uncancelled / illegal_transition).
 *  Same NOT-NULL reasoning as refreshLead above: from_stage = to_stage = the lead's current
 *  stage — a same-stage row is a note, not a transition. */
async function noteLead(sb: ReturnType<typeof getServiceRoleClient>, lead: ExistingLead, note: string): Promise<boolean> {
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
  if (existing && !isPipelineStage(existing.stage)) {
    // M5/M7: an out-of-vocabulary stage is a data problem, not "no lead" — a fall-through to
    // the create path would try to insert a second lead for an external_ref that already
    // exists. Ledger honestly and stop.
    await appendEvent({ notification, raw, signatureValid, result: "error:unknown_stage", leadId: existing.id });
    return { result: "error:unknown_stage" };
  }
  const lead: ExistingLead | null = existing && isPipelineStage(existing.stage) ? { id: existing.id, stage: existing.stage } : null;
  const plan = planEzcaterEvent(notification.key, lead?.stage ?? null);
  const label = `EZCater ${notification.key} (webhook)`;
  const ctx = { notification, raw, signatureValid };

  switch (plan.action) {
    case "ignore": { await appendEvent({ ...ctx, result: "ignored_event", leadId: lead?.id ?? null }); return { result: "ignored_event" }; }
    case "duplicate": { await appendEvent({ ...ctx, result: "duplicate", leadId: lead?.id ?? null }); return { result: "duplicate" }; }
    case "unmatched": { await appendEvent({ ...ctx, result: "unmatched" }); return { result: "unmatched" }; }
    case "note": {
      if (!lead) { await appendEvent({ ...ctx, result: "error:missing_lead" }); return { result: "error:missing_lead" }; }
      const noted = await noteLead(sb, lead, label);
      // I6: uncancelled gets its own ledger result so a human can query for it — the note
      // row is written either way, this is only about what the processing_result says.
      const result: EzcaterProcessingResult = !noted
        ? "error:note"
        : notification.key === "uncancelled" ? "uncancelled_needs_human" : "noted";
      await appendEvent({ ...ctx, result, leadId: lead.id });
      return { result };
    }
    case "illegal_transition": {
      let result: EzcaterProcessingResult = "illegal_transition";
      if (lead) {
        const noted = await noteLead(sb, lead, `${label} — not applied: ${lead.stage} → ${plan.stage} is not a legal move; needs a human`);
        if (!noted) result = "error:note";
      }
      await appendEvent({ ...ctx, result, leadId: lead?.id ?? null });
      return { result };
    }
    case "move": {
      if (!lead) { await appendEvent({ ...ctx, result: "error:missing_lead" }); return { result: "error:missing_lead" }; }
      return applyPlanToExisting(sb, lead, plan.stage, label, ctx);
    }
    case "refresh": {
      if (!lead) { await appendEvent({ ...ctx, result: "error:missing_lead" }); return { result: "error:missing_lead" }; }
      let order: EzcaterOrder;
      try { order = await fetchEzcaterOrder(notification.entityId); }
      catch (e) { const code = e instanceof Error && "code" in e ? String((e as { code: string }).code) : "order_fetch"; await appendEvent({ ...ctx, result: `error:${code}`, leadId: lead.id }); return { result: `error:${code}` }; }
      const ok = await refreshLead(sb, lead, order, label);
      await appendEvent({ ...ctx, result: ok ? "refreshed" : "error:refresh", leadId: lead.id });
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
    await appendEvent({ ...ctx, result: locErr ? "error:location_lookup" : "unmapped_location" });
    return { result: locErr ? "error:location_lookup" : "unmapped_location" };
  }
  let order: EzcaterOrder;
  try { order = await fetchEzcaterOrder(notification.entityId); }
  catch (e) { const code = e instanceof Error && "code" in e ? String((e as { code: string }).code) : "order_fetch"; await appendEvent({ ...ctx, result: `error:${code}` }); return { result: `error:${code}` }; }

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
    notes: wrapEzcaterNotes(leadNotes(order)),
    assigned_to: assignedTo,
    created_by: null,
  }).select("id").maybeSingle<{ id: string }>();
  if (insErr || !inserted) {
    if (insErr?.code !== "23505") {
      await appendEvent({ ...ctx, result: "error:lead_insert" });
      return { result: "error:lead_insert" };
    }
    // I2: submitted/accepted race — a concurrent delivery inserted the lead between our
    // lookup above and this insert. Re-read it and re-plan ONCE against its real stage; if
    // the fresh plan is a move, apply it exactly like the main "move" case would have.
    // Anything else (including another "create" or "duplicate") ledgers duplicate — this is
    // a single re-plan, never a retry loop.
    const { data: retryRow } = await sb.from("catering_pipeline")
      .select("id, stage").eq("external_ref", notification.entityId)
      .maybeSingle<{ id: string; stage: string }>();
    if (retryRow && isPipelineStage(retryRow.stage)) {
      const retryLead: ExistingLead = { id: retryRow.id, stage: retryRow.stage };
      const retryPlan = planEzcaterEvent(notification.key, retryLead.stage);
      if (retryPlan.action === "move") {
        return applyPlanToExisting(sb, retryLead, retryPlan.stage, label, ctx);
      }
    }
    await appendEvent({ ...ctx, result: "duplicate", leadId: retryRow?.id ?? null });
    return { result: "duplicate" };
  }
  const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: inserted.id, from_stage: null, to_stage: stage, note: `EZCater ${order.orderNumber} ${notification.key} (webhook)`, actor_id: null });
  if (evErr) { await appendEvent({ notification, raw, signatureValid, result: "error:pipeline_event", leadId: inserted.id }); return { result: "error:pipeline_event" }; }
  void audit({ actorId: null, actorRole: null, action: "catering.pipeline.create", resourceTable: "catering_pipeline", resourceId: inserted.id, metadata: { actor_context: "ezcater_webhook", lead_source: "ezcater", external_ref: notification.entityId, order_number: order.orderNumber, location_id: loc.id, stage, assigned_to: assignedTo, event_key: notification.key }, ipAddress: null, userAgent: null });
  const result: EzcaterProcessingResult = stage === "confirmed" ? "created_lead_confirmed" : "created_lead";
  await appendEvent({ notification, raw, signatureValid, result, leadId: inserted.id });
  return { result };
}
