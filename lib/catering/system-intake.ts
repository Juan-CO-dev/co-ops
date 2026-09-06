/**
 * System intake helpers shared by the machine tributaries (ezCater webhook, Toast catering scan).
 * SERVER-ONLY, service-role, NO operator actor. `systemMoveStage` mirrors moveStage's guarded UPDATE +
 * append-only event + audit; it does NOT touch prep demand (machine-created leads carry no quote until
 * 2c-b). FOLLOW-UP: fold into a shared applyStageMove with lib/catering/pipeline.ts once 2c-b lands.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { PipelineStage } from "@/lib/catering/pipeline-shared";

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
export async function resolveCateringManager(sb: ReturnType<typeof getServiceRoleClient>, locationId: string): Promise<string | null> {
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
export type ExistingLead = { id: string; stage: PipelineStage };

export type SystemMoveOutcome = "moved" | "stage_changed" | "event_failed" | "update_failed";

/** System stage move — mirrors moveStage's guarded UPDATE + append-only event + audit, with NO
 *  operator actor (actor_id null, actor_context is the caller's tributary label). Does NOT touch
 *  prep demand: a machine-created lead carries no quote in v1 (2c-b), so reserve/consume/release
 *  would early-return. Returns a discriminated outcome rather than a boolean (I1/C2): "update_failed"
 *  is a hard DB error; "stage_changed" means the guarded UPDATE matched zero rows because a
 *  concurrent delivery already moved this lead — there are no provider retries, so this is the final
 *  word, not a hint to retry; "event_failed" means the stage UPDATE committed but the ledger row did
 *  not, which the caller must NOT report as a failed move. */
export async function systemMoveStage(
  sb: ReturnType<typeof getServiceRoleClient>,
  lead: ExistingLead,
  toStage: PipelineStage,
  note: string,
  actorContext: string,
): Promise<SystemMoveOutcome> {
  const { error, count } = await sb.from("catering_pipeline")
    .update({ stage: toStage, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", lead.id).eq("stage", lead.stage);
  if (error) return "update_failed";
  if (count === 0) return "stage_changed"; // a concurrent delivery already moved it
  const { error: evErr } = await sb.from("catering_pipeline_events").insert({ pipeline_id: lead.id, from_stage: lead.stage, to_stage: toStage, note, actor_id: null });
  // The UPDATE above already committed — the stage genuinely moved. The ledger row failing to
  // land is a trail gap, never a failed move, so the caller must not claim "error:stage_move".
  if (evErr) return "event_failed";
  void audit({ actorId: null, actorRole: null, action: "catering.pipeline.stage_move", resourceTable: "catering_pipeline", resourceId: lead.id, metadata: { actor_context: actorContext, from_stage: lead.stage, to_stage: toStage }, ipAddress: null, userAgent: null });
  return "moved";
}

/** What one nightly completion pass did. `completed` carries the lead ids that genuinely moved
 *  to `completed`; `stageChanged` counts leads a human moved between the select and the update
 *  (not a failure — the guarded UPDATE's whole job); `failed` carries the ids whose move did
 *  not happen, with the outcome that says why. */
export interface ElapsedCompletionResult {
  completed: string[];
  stageChanged: number;
  failed: Array<{ id: string; result: string }>;
}

/**
 * THE ET DAY ROLLOVER COMPLETES ITS OWN EVENTS (spec 2026-09-05 §1; Juan: "if it's passed, it
 * already completed"). Every lead still sitting in `confirmed` or `out` with an `event_date`
 * before `todayEt` is moved to `completed` by the system, once a night, from the daily cron.
 *
 * NOT at read time (a stage is state — every surface must agree on it, and a read that writes
 * is how loadOnHand earned its warning) and NOT on the 10-minute pinger (which would race a
 * manager marking a lead `out` late in the evening of its own event day).
 *
 * `out` is deliberately NOT skipped: a lead left in `out` past its date is a delivered order
 * nobody clicked done on, and the events ledger keeps the honest `out → completed` row with the
 * auto note. `lost` stays lost; `inquiry`/`quote_sent` stay open — an unanswered inquiry with a
 * past date is a stale lead, not a served event, and the pipeline board should keep saying so.
 *
 * All locations (the cron is system context, no actor). PER-LEAD FAILURE NEVER THROWS — one bad
 * lead must not cost the other five, nor the sales pull this runs in front of. Only a failure of
 * the SELECT throws, because then the candidate set is unknown and reporting "0 completed" would
 * be a fabrication.
 */
export async function completeElapsedCateringEvents(todayEt: string): Promise<ElapsedCompletionResult> {
  const sb = getServiceRoleClient();
  // `event_date < todayEt` — a lead whose event is TODAY is untouched (the day is not over).
  // Rows with a null event_date never match (`null < x` is null), which is the right answer:
  // an undated lead has no elapsed date to pass.
  const { data, error } = await sb.from("catering_pipeline")
    .select("id, stage, location_id")
    .in("stage", ["confirmed", "out"])
    .lt("event_date", todayEt)
    .returns<Array<{ id: string; stage: PipelineStage; location_id: string }>>();
  if (error) throw new Error(`completeElapsedCateringEvents select: ${error.message}`);

  const out: ElapsedCompletionResult = { completed: [], stageChanged: 0, failed: [] };
  for (const lead of data ?? []) {
    let outcome: SystemMoveOutcome;
    try {
      outcome = await systemMoveStage(sb, { id: lead.id, stage: lead.stage }, "completed", "auto: event date passed", "cron_rollover");
    } catch (e) {
      out.failed.push({ id: lead.id, result: "threw" });
      console.error(`[catering rollover] complete threw for lead ${lead.id} (location ${lead.location_id}):`, e instanceof Error ? e.message : String(e));
      continue;
    }
    if (outcome === "moved") { out.completed.push(lead.id); continue; }
    if (outcome === "event_failed") {
      // The stage UPDATE committed — the lead IS completed. Only the ledger row is missing, and
      // systemMoveStage's contract is explicit that this must not be reported as a failed move.
      // It is counted as completed and the trail gap is logged, never counted as a failure.
      out.completed.push(lead.id);
      console.error(`[catering rollover] lead ${lead.id} completed but its pipeline_events row did not land (trail gap)`);
      continue;
    }
    if (outcome === "stage_changed") { out.stageChanged += 1; continue; }
    out.failed.push({ id: lead.id, result: outcome });
    console.error(`[catering rollover] complete failed for lead ${lead.id} (location ${lead.location_id}): ${outcome}`);
  }
  return out;
}
