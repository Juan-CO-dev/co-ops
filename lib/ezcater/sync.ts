/** System-only ezCater ingestion. All projections are published by one transaction. */
import "server-only";
import { createHash } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { EzcaterApiError, ezcaterConfigured } from "./client";
import { fetchEzcaterOrder } from "./orders";
import { EZCATER_ORDER_EVENT_KEYS } from "./lifecycle-shared";

export interface EzcaterApplyResult {
  lead_id: string | null; result: string; created?: boolean;
  from_stage?: string | null; to_stage?: string | null; location_id?: string | null;
  code?: string | null; sync_error?: string | null;
}

function missingApply(error: { code?: string } | null): boolean {
  return !!error?.code && ["PGRST202", "42883", "42P01", "42703", "PGRST204", "PGRST205"].includes(error.code);
}

/** 0223 rejects reassigned orders before 0225 exists. Probe without writing. */
async function assertReassignmentSchema(sb: ReturnType<typeof getServiceRoleClient>, error: { message?: string } | null): Promise<void> {
  if (error?.message !== "location_mismatch") return;
  const probe = await sb.from("ezcater_orders").select("location_manual_override").limit(0)
    .abortSignal(AbortSignal.timeout(1_000));
  if (missingApply(probe.error)) throw new Error("ezcater_schema_unavailable");
}

function auditApplied(result: EzcaterApplyResult, providerUuid: string): void {
  const common = { actorId: null, actorRole: null, resourceTable: "catering_pipeline",
    resourceId: result.lead_id, ipAddress: null, userAgent: null };
  if (result.created && result.lead_id) void audit({ ...common, action: "catering.pipeline.create",
    metadata: { actor_context: "ezcater", source: "ezcater", location_id: result.location_id } });
  if (result.lead_id && result.from_stage && result.to_stage && result.from_stage !== result.to_stage) {
    void audit({ ...common, action: "catering.pipeline.stage_move",
      metadata: { actor_context: "ezcater", from_stage: result.from_stage, to_stage: result.to_stage } });
  }
  void audit({ ...common, action: "ezcater.order_synced", resourceTable: "ezcater_orders", resourceId: null,
    metadata: { provider_uuid: providerUuid, result: result.result, code: result.code ?? null } });
}

/** Provider messages, GraphQL extensions and SQL details are never diagnostic data. */
export function ezcaterSyncError(error: unknown): string {
  if (error instanceof EzcaterApiError && ["auth_failed", "graphql_error", "bad_payload", "deadline_exceeded", "timeout", "network_error"].includes(error.code)) return error.code;
  if (error instanceof Error && ["ezcater_disabled", "location_mismatch", "apply_failed", "identity_invalid"].includes(error.message)) return error.message;
  return "sync_failed";
}

export async function syncEzcaterOrder(providerUuid: string, catererUuid: string, options: {
  eventKey?: string | null; deadlineMs?: number; signal?: AbortSignal;
} = {}): Promise<EzcaterApplyResult> {
  // Never publish fixtures as live customer orders.
  if (!ezcaterConfigured() || process.env.EZCATER_FIXTURES === "1") throw new Error("ezcater_disabled");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providerUuid)) throw new Error("identity_invalid");
  const sb = getServiceRoleClient();
  const signal = options.signal ?? AbortSignal.timeout(25_000);
  const eventKey = EZCATER_ORDER_EVENT_KEYS.find((k) => k === options.eventKey) ?? null;
  const locationObservedAt = new Date().toISOString();
  try {
    const snapshot = await fetchEzcaterOrder(providerUuid, { deadlineMs: options.deadlineMs, signal });
    if (!snapshot.catererUuid) throw new Error("location_mismatch");
    // Normalizer fixes property order. Transport timestamps never enter this digest.
    const digest = createHash("sha256").update(JSON.stringify({ snapshot, eventKey })).digest("hex");
    const { data, error } = await sb.rpc("apply_ezcater_order", {
      p_provider_uuid: providerUuid, p_caterer_uuid: snapshot.catererUuid,
      p_snapshot: { ...snapshot, locationObservedAt }, p_digest: digest, p_event_key: eventKey, p_error: null,
    }).abortSignal(signal);
    if (missingApply(error)) throw new Error("ezcater_schema_unavailable");
    await assertReassignmentSchema(sb, error);
    if (error || !data) throw new Error("apply_failed");
    const result = data as EzcaterApplyResult;
    auditApplied(result, providerUuid);
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === "ezcater_schema_unavailable") throw error;
    const code = ezcaterSyncError(error);
    // A failed first fetch also leaves a known UUID for the nightly retry sweep.
    // If the DB is down this throws: the webhook must return 500 and be retried.
    // Reserve a separate, short persistence bound: an expired provider deadline
    // must not prevent recording the retry marker/attempt time. This branch cannot
    // overwrite a snapshot; lifecycle moves still apply when fetching failed.
    const saved = await sb.rpc("apply_ezcater_order", {
      p_provider_uuid: providerUuid, p_caterer_uuid: catererUuid,
      p_snapshot: null, p_digest: null, p_event_key: eventKey, p_error: code,
    }).abortSignal(AbortSignal.timeout(1_000));
    if (missingApply(saved.error)) throw new Error("ezcater_schema_unavailable");
    await assertReassignmentSchema(sb, saved.error);
    if (saved.error || !saved.data) throw new Error("apply_failed");
    const result = saved.data as EzcaterApplyResult;
    auditApplied(result, providerUuid);
    return result;
  }
}
