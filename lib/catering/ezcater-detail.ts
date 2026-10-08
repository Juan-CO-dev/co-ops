import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { AuthContext } from "@/lib/session";
import type { RoleCode } from "@/lib/roles";
import { canReadCateringContact, type EzcaterOrderDetail } from "./ezcater-detail-shared";

/** Fail closed on membership-read failure; never rely on stale JWT locations for PII. */
export async function loadCateringReader(actor: AuthContext): Promise<{ role: RoleCode; active: boolean; locations: string[] } | null> {
  const sb = getServiceRoleClient();
  const { data: user, error } = await sb.from("users").select("role,active").eq("id", actor.user.id)
    .maybeSingle<{ role: RoleCode; active: boolean }>();
  if (error || !user?.active) return null;
  const { data: memberships, error: membershipError } = await sb.from("user_locations")
    .select("location_id").eq("user_id", actor.user.id).eq("active", true);
  if (membershipError) return null;
  return { ...user, locations: (memberships ?? []).map((row) => row.location_id as string) };
}

export async function canReadCateringLead(actor: AuthContext, locationId: string | null): Promise<boolean> {
  const reader = await loadCateringReader(actor);
  return reader != null && canReadCateringContact(reader, locationId);
}

/** Reusable by the pipeline and catering digest. No contacts in audit/log/diagnostic data. */
export async function loadEzcaterOrderDetail(actor: AuthContext, leadId: string): Promise<EzcaterOrderDetail | null> {
  return loadDetail(actor, leadId, 1);
}

async function loadDetail(actor: AuthContext, leadId: string, retries: number): Promise<EzcaterOrderDetail | null> {
  const sb = getServiceRoleClient();
  const { data: lead, error: leadError } = await sb.from("catering_pipeline").select("location_id")
    .eq("id", leadId).maybeSingle<{ location_id: string | null }>();
  if (leadError) throw new Error("ezcater_detail_lead_read_failed");
  if (!lead || !await canReadCateringLead(actor, lead.location_id)) return null;
  const { data: order, error } = await sb.from("ezcater_orders")
    .select("id,snapshot_id,location_id,order_number,event_date,event_timestamp,handoff_time,status,headcount,fulfillment,subtotal_cents,tax_cents,tip_cents,fees_cents,discounts_cents,total_cents,payment_status,fetched_at")
    .eq("lead_id", leadId).maybeSingle<Omit<EzcaterOrderDetail, "items" | "contact"> & { id: string; snapshot_id: string | null; location_id: string }>();
  if (error) throw new Error("ezcater_detail_order_read_failed");
  if (!order?.snapshot_id || order.location_id !== lead.location_id) return null;
  const [{ data: items, error: itemError }, { data: contact, error: contactError }] = await Promise.all([
    sb.from("ezcater_order_items").select("ordinal,name,quantity,unit_price_cents,total_cents,pos_item_id,options,special_instructions,note_to_caterer")
      .eq("order_id", order.id).eq("snapshot_id", order.snapshot_id).order("ordinal")
      .returns<EzcaterOrderDetail["items"]>(),
    sb.from("ezcater_order_contacts").select("contact").eq("order_id", order.id).eq("snapshot_id", order.snapshot_id)
      .maybeSingle<{ contact: EzcaterOrderDetail["contact"] }>(),
  ]);
  if (itemError || contactError) throw new Error("ezcater_detail_children_read_failed");
  const { data: current, error: currentError } = await sb.from("ezcater_orders").select("snapshot_id")
    .eq("id", order.id).maybeSingle<{ snapshot_id: string }>();
  if (currentError) throw new Error("ezcater_detail_snapshot_read_failed");
  if (current?.snapshot_id !== order.snapshot_id) {
    if (retries > 0) return loadDetail(actor, leadId, retries - 1);
    throw new Error("ezcater_detail_snapshot_changed");
  }
  // Pin immutable item rows to the selected snapshot, even when a refresh races this read.
  const { id: _id, snapshot_id: _snapshotId, location_id: _locationId, ...detail } = order;
  return { ...detail, items: items ?? [], contact: contact?.contact ?? null };
}
