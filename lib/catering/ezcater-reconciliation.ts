import "server-only";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { canReadCateringLead } from "./ezcater-detail";
import { CateringPipelineError } from "./pipeline";
import type { EzcaterReconciliationDetail } from "./ezcater-reconciliation-shared";

/** Review is a read, never a mapping confirmation or a depletion write. */
export async function loadEzcaterReconciliation(actor: AuthContext, leadId: string): Promise<EzcaterReconciliationDetail> {
  const sb = getServiceRoleClient();
  const { data: lead, error: leadError } = await sb.from("catering_pipeline").select("location_id")
    .eq("id", leadId).maybeSingle<{ location_id: string | null }>();
  if (leadError) throw new CateringPipelineError(503, "reconciliation_unavailable");
  if (!lead) throw new CateringPipelineError(404, "not_found");
  if (!await canReadCateringLead(actor, lead.location_id)) throw new CateringPipelineError(403, "forbidden");
  const unavailable: EzcaterReconciliationDetail = { available: false, locationConflict: false, manualLocation: null, reviews: [], linkCount: 0, shadowRows: 0, truncated: false };
  const { data: order, error: orderError } = await sb.from("ezcater_orders").select("id,snapshot_id,location_conflict,location_manual_override,caterer_uuid")
    .eq("lead_id", leadId).maybeSingle<{ id: string; snapshot_id: string | null; location_conflict: boolean; location_manual_override: boolean; caterer_uuid: string }>();
  if (orderError) return unavailable;
  unavailable.locationConflict = order?.location_conflict ?? false;
  if (order?.location_manual_override) {
    const [provider, kept] = await Promise.all([
      sb.from("locations").select("name").eq("ezcater_caterer_uuid", order.caterer_uuid).maybeSingle<{ name: string }>(),
      sb.from("locations").select("name").eq("id", lead.location_id).maybeSingle<{ name: string }>(),
    ]);
    if (!provider.error && !kept.error && provider.data && kept.data) {
      unavailable.manualLocation = { provider: provider.data.name, kept: kept.data.name };
    }
  }
  let query = sb.from("ezcater_review_queue").select("id,source,code,candidates").is("resolved_at", null);
  query = order ? query.eq("order_id", order.id).eq("snapshot_id", order.snapshot_id).eq("location_id", lead.location_id)
    : query.contains("candidates", [leadId]);
  const { data: reviews, error: reviewError } = await query.order("created_at").limit(101)
    .returns<Array<{ id: string; source: "ezcater" | "toast"; code: string; candidates: unknown }>>();
  if (reviewError) return unavailable;
  const counts = order?.snapshot_id ? await Promise.all([
    sb.from("ezcater_toast_links").select("order_id", { count: "exact", head: true }).eq("order_id", order.id).eq("snapshot_id", order.snapshot_id).eq("location_id", lead.location_id).eq("is_current", true),
    sb.from("ezcater_shadow_depletion").select("order_id", { count: "exact", head: true }).eq("order_id", order.id).eq("snapshot_id", order.snapshot_id).eq("location_id", lead.location_id).eq("is_current", true),
  ]) : [];
  if (counts.some((r) => r.error)) return unavailable;
  return { available: true, locationConflict: order?.location_conflict ?? false, manualLocation: unavailable.manualLocation, reviews: (reviews ?? []).slice(0, 100).map((row) => ({
    id: row.id, source: row.source, code: row.code,
    candidateCount: Array.isArray(row.candidates) ? row.candidates.length : 0,
  })), linkCount: counts[0]?.count ?? 0, shadowRows: counts[1]?.count ?? 0, truncated: (reviews?.length ?? 0) > 100 };
}
