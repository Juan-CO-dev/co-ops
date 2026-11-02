import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit-actions";
import type { AuthContext } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { MARKETING_SCORECARD_ROLES } from "./access-shared";

export const marketingRoleAllowed = (role: string) => MARKETING_SCORECARD_ROLES.some(r => r === role);
export const marketingRefusals = ["actor_not_allowed", "correction_target_not_head", "reason_required", "milestone_locked", "date_invalid", "entry_exists_use_correct", "entry_invalid", "entry_overlaps", "baseline_window_mismatch", "baseline_not_due", "snapshot_exists", "code_invalid", "code_reserved", "code_taken", "slots_exhausted", "code_not_found", "already_retired"] as const;
export function marketingWriteError(error: { code?: string; message?: string }) {
  if (error.code === "42P01" || error.code === "42883" || error.code === "PGRST202") return jsonError(503, "marketing_unavailable");
  const refusal = marketingRefusals.find(code => error.message === code);
  return jsonError(refusal === "actor_not_allowed" || refusal === "milestone_locked" ? 403 : refusal ? 409 : 500, refusal ?? "internal_error");
}
export async function marketingRpc(ctx: AuthContext, rpc: string, args: Record<string, unknown>, action: AuditAction, table: string) {
  if (!marketingRoleAllowed(ctx.user.role)) return jsonError(403, "role_not_allowed");
  if (process.env.MARKETING_SCORECARD !== "1") return jsonError(503, "marketing_unavailable");
  let result;
  try {
    result = await getServiceRoleClient().rpc(rpc, { ...args, p_actor: ctx.user.id });
  } catch {
    return jsonError(503, "marketing_unavailable");
  }
  const { data, error } = result;
  if (error) return marketingWriteError(error);
  // Explicit allowlist: free-text notes/reasons and snapshot payload never enter audit metadata.
  const metadata: Record<string, unknown> = {};
  for (const key of ["p_kind", "p_date", "p_corrects", "p_location_id", "p_platform", "p_from", "p_to", "p_amount_cents", "p_list_count", "p_milestone_id", "p_kpi_version"]) {
    if (key in args) metadata[key.slice(2)] = args[key];
  }
  await audit({ actorId: ctx.user.id, actorRole: ctx.user.role, action, resourceTable: table, resourceId: typeof data === "string" ? data : null, metadata, ipAddress: null, userAgent: null });
  return jsonOk({ id: data }, 201);
}
export const isBody = (body: unknown): body is Record<string, unknown> => !!body && typeof body === "object" && !Array.isArray(body);
export const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validMarketingBody(body: Record<string, unknown>, manual: boolean) {
  const text = (v: unknown, max: number) => v == null || typeof v === "string" && v.length <= max;
  const day = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!text(body.reason, 300)) return false;
  if (!manual) return ["first_ad_spend", "landing_live", "counter_on", "capi_on"].includes(String(body.kind)) && day(body.date);
  return ["meta_spend", "promo_spend", "email_list_size"].includes(String(body.kind)) && day(body.from) && day(body.to)
    && (body.locationId == null || isId(body.locationId)) && text(body.note, 200)
    && (body.platform == null || ["uber_eats", "doordash", "grubhub", "other"].includes(String(body.platform)))
    && (body.amountCents == null || Number.isSafeInteger(body.amountCents) && Number(body.amountCents) >= 0 && Number(body.amountCents) <= 100000000)
    && (body.listCount == null || Number.isSafeInteger(body.listCount) && Number(body.listCount) >= 0 && Number(body.listCount) <= 2147483647);
}
