import "server-only";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { assertStepUp } from "@/lib/admin/step-up";
import { loadCateringReader } from "./ezcater-detail";
import { CateringPipelineError } from "./pipeline";
import { canTransferCatering, validTransferReason } from "./transfers-shared";

export interface CateringTransferResult {
  result: "moved" | "unchanged";
  from_location_id: string | null;
  to_location_id: string;
  prep_preserved: true;
}
export async function transferCateringLead(actor: AuthContext, leadId: string, input: {
  locationId: string; reason: string; note?: string | null;
}): Promise<CateringTransferResult> {
  const reader = await loadCateringReader(actor);
  if (!reader || !canTransferCatering(reader.role)) throw new CateringPipelineError(403, "forbidden");
  const step = assertStepUp(actor, "B");
  if (!step.ok) throw new CateringPipelineError(403, step.code);
  if (!validTransferReason(input.reason, input.note)) throw new CateringPipelineError(400, "invalid_transfer_reason");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.locationId)) {
    throw new CateringPipelineError(400, "invalid_location");
  }
  const sb = getServiceRoleClient();
  const args = {
    p_lead_id: leadId, p_location_id: input.locationId, p_actor_id: actor.user.id,
    p_reason: input.reason, p_note: input.note?.trim() || null,
  };
  // A deadlock aborts the entire RPC transaction; only that code is safe to replay.
  let result = await sb.rpc("transfer_catering_lead", args);
  for (let retry = 0; result.error?.code === "40P01" && retry < 2; retry++) {
    await new Promise((resolve) => setTimeout(resolve, 25 * (retry + 1)));
    result = await sb.rpc("transfer_catering_lead", args);
  }
  const { data, error } = result;
  if (error) {
    if (["PGRST202", "42883", "42P01", "42703", "PGRST204", "PGRST205"].includes(error.code)) {
      throw new CateringPipelineError(503, "catering_transfer_unavailable");
    }
    if (error.code === "40P01") throw new CateringPipelineError(503, "catering_transfer_retry");
    if (error.message === "transfer_forbidden") throw new CateringPipelineError(403, "forbidden");
    if (error.message === "transfer_lead_not_found") throw new CateringPipelineError(404, "not_found");
    if (error.message === "transfer_invalid_location") throw new CateringPipelineError(400, "invalid_location");
    throw new Error("catering_transfer_failed");
  }
  if (!data) throw new Error("catering_transfer_failed");
  return data as CateringTransferResult;
}
