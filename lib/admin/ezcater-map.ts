/**
 * EZCater admin data layer (spec #2c). SERVER-ONLY, service-role; level floors
 * re-checked here, Tier-A step-up at the route (mirrors lib/admin/toast-map.ts).
 * Scope: per-location caterer-UUID mapping + read-only visibility into the
 * webhook events ledger (a webhook-only feed with no visibility is a silent
 * feed — the ledger list is the operator's eyes).
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

export const EZCATER_ADMIN_MIN = 7; // GM+ — mirrors toast-map
export const EZCATER_READ_MIN = 6;  // AGM+ — events visibility

export class AdminEzcaterError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminEzcaterError";
  }
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new AdminEzcaterError(403, "forbidden", "Insufficient role level");
}

export interface EzcaterAdminState {
  webhookConfigured: boolean; // EZCATER_WEBHOOK_SECRET present
  apiConfigured: boolean;     // EZCATER_API_TOKEN present
  locations: Array<{ id: string; name: string; ezcaterCatererUuid: string | null }>;
  events: Array<{
    id: string; eventKey: string | null; entityId: string | null;
    processingResult: string | null; signatureValid: boolean; receivedAt: string; leadId: string | null;
  }>;
}

export async function loadEzcaterAdminState(actor: AuthContext): Promise<EzcaterAdminState> {
  requireLevel(actor, EZCATER_READ_MIN);
  const sb = getServiceRoleClient();
  const [{ data: locs, error: lErr }, { data: evts, error: eErr }] = await Promise.all([
    sb.from("locations").select("id, name, ezcater_caterer_uuid").eq("active", true)
      .order("name", { ascending: true })
      .returns<Array<{ id: string; name: string; ezcater_caterer_uuid: string | null }>>(),
    sb.from("ezcater_events")
      .select("id, event_key, entity_id, processing_result, signature_valid, received_at, lead_id")
      .order("received_at", { ascending: false }).limit(20)
      .returns<Array<{ id: string; event_key: string | null; entity_id: string | null; processing_result: string | null; signature_valid: boolean; received_at: string; lead_id: string | null }>>(),
  ]);
  if (lErr) throw new Error(`ezcater locations: ${lErr.message}`);
  if (eErr) throw new Error(`ezcater events: ${eErr.message}`);
  return {
    webhookConfigured: Boolean(process.env.EZCATER_WEBHOOK_SECRET),
    apiConfigured: Boolean(process.env.EZCATER_API_TOKEN),
    locations: (locs ?? []).map((l) => ({ id: l.id, name: l.name, ezcaterCatererUuid: l.ezcater_caterer_uuid })),
    events: (evts ?? []).map((e) => ({
      id: e.id, eventKey: e.event_key, entityId: e.entity_id,
      processingResult: e.processing_result, signatureValid: e.signature_valid,
      receivedAt: e.received_at, leadId: e.lead_id,
    })),
  };
}

/** Set/clear a location's ezCater caterer UUID (their id format is theirs — non-empty ≤100 chars, no shape guess). */
export async function setLocationEzcaterUuid(actor: AuthContext, locationId: string, uuid: string | null): Promise<void> {
  requireLevel(actor, EZCATER_ADMIN_MIN);
  const trimmed = uuid?.trim() || null;
  if (trimmed != null && trimmed.length > 100) {
    throw new AdminEzcaterError(400, "invalid_uuid", "EZCater caterer UUID too long");
  }
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("locations")
    .update({ ezcater_caterer_uuid: trimmed }, { count: "exact" })
    .eq("id", locationId).eq("active", true);
  if (error) throw new Error(`ezcater set uuid: ${error.message}`);
  if (count === 0) throw new AdminEzcaterError(404, "location_not_found", "Location not found");
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "ezcater.set_location_uuid", resourceTable: "locations", resourceId: locationId,
    metadata: { ezcater_caterer_uuid_set: trimmed != null },
    ipAddress: null, userAgent: null,
  });
}
