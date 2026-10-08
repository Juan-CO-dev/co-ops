import "server-only";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadCateringReader } from "@/lib/catering/ezcater-detail";
import { canTransferCatering } from "@/lib/catering/transfers-shared";
import { CateringPipelineError } from "@/lib/catering/pipeline";
import { assertStepUp } from "./step-up";
import { itemIdentity, type ItemIdentity } from "@/lib/ezcater/pass2-shared";

export interface MappingCandidate {
  reviewId: string; identity: string; locationId: string; locationName: string;
  name: string; size: string; lineCount: number; suggestedId: string | null;
}
export interface MappingTarget { id: string; location_id: string; toast_item_name: string; toast_item_guid: string }

async function authorize(actor: AuthContext) {
  const reader = await loadCateringReader(actor);
  if (!reader || !canTransferCatering(reader.role)) throw new CateringPipelineError(403, "forbidden");
}

/** No contacts, special instructions or provider payloads enter this projection. */
export async function loadEzcaterMappingReview(actor: AuthContext) {
  await authorize(actor);
  const sb = getServiceRoleClient();
  const reviews = await selectAllRows<{ id: string; order_id: string; location_id: string; identity_key: string; candidates: string[] }>((from, to) => sb.from("ezcater_review_queue")
    .select("id,order_id,location_id,identity_key,candidates").eq("source", "ezcater").is("resolved_at", null)
    .order("id").range(from, to));
  const targets = await selectAllRows<MappingTarget>((from, to) => sb.from("toast_menu_map")
    .select("id,location_id,toast_item_name,toast_item_guid").eq("active", true).eq("match_status", "confirmed")
    .eq("is_modifier", false).eq("disposition", "deplete").order("id").range(from, to));
  const orders = await selectAllRows<{ id: string; location_id: string }>((from, to) => sb.from("ezcater_orders")
    .select("id,location_id").order("id").range(from, to));
  const locations = await selectAllRows<{ id: string; name: string }>((from, to) => sb.from("locations")
    .select("id,name").order("id").range(from, to));
  const items = await selectAllRows<ItemIdentity & { order_id: string; options: unknown[] }>((from, to) => sb.from("ezcater_order_items")
    .select("order_id,provider_item_uuid,menu_item_size_id,pos_item_id,name,options").eq("is_current", true)
    .order("snapshot_id").order("ordinal").range(from, to));
  const counts = new Map<string, { item: ItemIdentity; count: number }>();
  const orderLocations = new Map(orders.map((o) => [o.id, o.location_id]));
  for (const item of items) {
    const identity = itemIdentity(item), location = orderLocations.get(item.order_id);
    if (!identity || !location) continue;
    const key = JSON.stringify([location, identity]);
    const previous = counts.get(key);
    counts.set(key, { item, count: (previous?.count ?? 0) + 1 });
  }
  const candidates: MappingCandidate[] = [];
  const seen = new Set<string>();
  for (const review of reviews) {
    // A transfer may leave a historical candidate at its old shop. Never offer
    // that row as the approval handle for the current order.
    if (orderLocations.get(review.order_id) !== review.location_id) continue;
    const key = JSON.stringify([review.location_id, review.identity_key]);
    const group = counts.get(key);
    if (!group || seen.has(key)) continue;
    seen.add(key);
    const suggestions = targets.filter((t) => t.location_id === review.location_id && review.candidates.includes(t.toast_item_guid));
    const optionNames = (group.item.options ?? []).flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const option = raw as { name?: unknown; customizationId?: unknown };
      return typeof option.name === "string" ? [option.name] : typeof option.customizationId === "string" ? [option.customizationId] : [];
    });
    candidates.push({ reviewId: review.id, identity: review.identity_key, locationId: review.location_id,
      locationName: locations.find((l) => l.id === review.location_id)?.name ?? review.location_id,
      name: [group.item.name, ...optionNames].join(" · "), size: group.item.menu_item_size_id!, lineCount: group.count,
      suggestedId: suggestions.length === 1 ? suggestions[0]!.id : null });
  }
  return { candidates, targets };
}

export async function decideEzcaterMapping(actor: AuthContext, reviewId: string, decision: "approve" | "ignore", targetId: string | null) {
  await authorize(actor);
  const step = assertStepUp(actor, "B");
  if (!step.ok) throw new CateringPipelineError(403, step.code);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(reviewId) || !["approve", "ignore"].includes(decision) ||
      (decision === "approve" ? !targetId || !uuid.test(targetId) : targetId !== null)) {
    throw new CateringPipelineError(400, "invalid_payload");
  }
  const { data, error } = await getServiceRoleClient().rpc("decide_ezcater_mapping", {
    p_review_id: reviewId, p_toast_map_id: targetId, p_decision: decision, p_actor_id: actor.user.id,
  });
  if (error) {
    if (["42883", "42P01", "42703", "PGRST202", "PGRST205"].includes(error.code)) throw new CateringPipelineError(503, "ezcater_schema_unavailable");
    if (error.message === "ezcater_mapping_forbidden") throw new CateringPipelineError(403, "forbidden");
    if (error.message === "ezcater_mapping_review_not_found") throw new CateringPipelineError(404, "not_found");
    if (["ezcater_mapping_source_changed", "ezcater_mapping_target_invalid"].includes(error.message)) throw new CateringPipelineError(409, "mapping_changed");
    throw new CateringPipelineError(503, "mapping_unavailable");
  }
  if (!data) throw new CateringPipelineError(503, "mapping_unavailable");
  return data;
}
