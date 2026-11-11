import "server-only";
import type { AuthContext } from "./session";
import { getServiceRoleClient } from "./supabase-server";
import { readVendorMailRow, VendorMailError, VENDOR_MAIL_UUID } from "./vendor-mail";
import { audit } from "./audit";
export interface VendorMailMutation { expected_revision: number; request_id: string }
export function validateVendorMailMutation(input: VendorMailMutation) {
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0 || typeof input.request_id !== "string" || !VENDOR_MAIL_UUID.test(input.request_id)) throw new VendorMailError(400, "invalid_payload");
}
export async function vendorMailRpc(ctx: AuthContext, id: string, input: VendorMailMutation, rpc: string, payload: Record<string, unknown>, action?: string) {
  validateVendorMailMutation(input);
  const { data, error } = await getServiceRoleClient().rpc(rpc, { p_message_id: id, p_expected_revision: input.expected_revision, p_request_id: input.request_id,
    p_actor_id: ctx.user.id, p_session_id: ctx.session.id, p_payload: payload, ...(action ? { p_action: action } : {}) });
  if (error) {
    const named = ["forbidden","not_found","stale_revision","request_conflict","worker_busy","invalid_state","already_handled","linked_receipt","invalid_location","invalid_vendor","linked_evidence","already_attributed","invalid_input","invalid_claim","already_resulted"].find(code => error.message === code);
    throw new VendorMailError(named === "forbidden" ? 403 : named === "not_found" ? 404 : named === "invalid_input" ? 400 : named ? 409 : 503, named ?? "vendor_mail_unavailable");
  }
  return data as { revision: number; replayed: boolean; data: Record<string, unknown> };
}
/** Shared session-bound, locked revision CAS used by both redrive entry points. */
export async function redriveVendorMail(ctx: AuthContext, id: string, input: VendorMailMutation) {
  return actOnVendorMail(ctx, id, "redrive", input, {});
}
export async function actOnVendorMail(ctx: AuthContext, id: string, action: "handle" | "assign" | "redrive", input: VendorMailMutation, payload: Record<string, unknown>) {
  await readVendorMailRow(ctx, id);
  const result = await vendorMailRpc(ctx, id, input, "vendor_mail_act", payload, action);
  if (!result.replayed) await audit({ actorId: ctx.user.id, actorRole: ctx.user.role, action: action === "redrive" ? "inbound.redrive" : action === "handle" ? "vendor_mail.handle" : "vendor_mail.assign",
    resourceTable: "inbound_messages", resourceId: id, metadata: { request_id: input.request_id }, ipAddress: null, userAgent: null });
  return result;
}
