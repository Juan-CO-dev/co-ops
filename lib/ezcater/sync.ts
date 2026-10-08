/** System-only ezCater ingestion. All projections are published by one transaction. */
import "server-only";
import { createHash } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { EzcaterApiError, ezcaterConfigured } from "./client";
import { fetchEzcaterOrder } from "./orders";
import { EZCATER_ORDER_EVENT_KEYS } from "./lifecycle-shared";

export interface EzcaterApplyResult { lead_id: string | null; result: string }

/** Provider messages, GraphQL extensions and SQL details are never diagnostic data. */
export function ezcaterSyncError(error: unknown): string {
  if (error instanceof EzcaterApiError && ["auth_failed", "graphql_error", "bad_payload", "deadline_exceeded"].includes(error.code)) return error.code;
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
  try {
    const snapshot = await fetchEzcaterOrder(providerUuid, { deadlineMs: options.deadlineMs, signal });
    if (!snapshot.catererUuid || snapshot.catererUuid !== catererUuid) throw new Error("location_mismatch");
    // Normalizer fixes property order. Transport timestamps never enter this digest.
    const digest = createHash("sha256").update(JSON.stringify({ snapshot, eventKey })).digest("hex");
    const { data, error } = await sb.rpc("apply_ezcater_order", {
      p_provider_uuid: providerUuid, p_caterer_uuid: catererUuid,
      p_snapshot: snapshot, p_digest: digest, p_event_key: eventKey, p_error: null,
    }).abortSignal(signal);
    if (error || !data) throw new Error("apply_failed");
    const result = data as EzcaterApplyResult;
    // The transactional trail is in the RPC. Audit is deliberately fail-open.
    void audit({ actorId: null, actorRole: null, action: "ezcater.order_synced",
      resourceTable: "ezcater_orders", resourceId: null,
      metadata: { provider_uuid: providerUuid, result: result.result }, ipAddress: null, userAgent: null });
    return result;
  } catch (error) {
    const code = ezcaterSyncError(error);
    // A failed first fetch also leaves a known UUID for the nightly retry sweep.
    // If the DB is down this throws: the webhook must return 500 and be retried.
    // Reserve a separate, short persistence bound: an expired provider deadline
    // must not prevent recording the retry marker/attempt time. This branch cannot
    // change a lead or snapshot and never extends the outer nightly phase deadline.
    const saved = await sb.rpc("apply_ezcater_order", {
      p_provider_uuid: providerUuid, p_caterer_uuid: catererUuid,
      p_snapshot: null, p_digest: null, p_event_key: eventKey, p_error: code,
    }).abortSignal(AbortSignal.timeout(1_000));
    if (saved.error) throw new Error("apply_failed");
    return { lead_id: null, result: `error:${code}` };
  }
}
