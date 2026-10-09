import "server-only";
import type { ToastCrossCheckOrder } from "@/lib/report-digests-catering-shared";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { loadCateringReader } from "@/lib/catering/ezcater-detail";
import { canTransferCatering } from "@/lib/catering/transfers-shared";
import { CateringPipelineError } from "@/lib/catering/pipeline";
import { assertStepUp } from "./step-up";
import { itemIdentity, type ItemIdentity } from "@/lib/ezcater/pass2-shared";
import type { ModifierEffect } from "@/lib/toast/modifiers-shared";
import { parseCustomizationDecision } from "@/lib/ezcater/customization-validation-shared";

export interface MappingCandidate {
  reviewId: string; identity: string; locationId: string; locationName: string;
  name: string; size: string; lineCount: number; suggestedId: string | null;
}
export interface MappingTarget { id: string; location_id: string; toast_item_name: string; toast_item_guid: string }
export interface DirectMappingTarget { id: string; kind: "menu_item" | "item" | "package" | "sku"; name: string; location_id: string | null }
export interface CustomizationCandidate {
  reviewId: string; customizationId: string; locationId: string; locationName: string;
  name: string; typeName: string | null; lineCount: number;
}
export interface ReconciliationReview extends ToastCrossCheckOrder { locationName: string }
export interface ToastReview { reviewId: string; locationId: string; locationName: string; code: string; identity: string; orderNumber: string | null }

async function authorize(actor: AuthContext) {
  const reader = await loadCateringReader(actor);
  if (!reader || !canTransferCatering(reader.role)) throw new CateringPipelineError(403, "forbidden");
}

/** No contacts, special instructions or provider payloads enter this projection. */
export async function loadEzcaterMappingReview(actor: AuthContext) {
  await authorize(actor);
  const sb = getServiceRoleClient();
  const reviews = await selectAllRows<{ id: string; order_id: string; snapshot_id?: string; location_id: string; identity_key: string; candidates: string[]; code?: string }>((from, to) => sb.from("ezcater_review_queue")
    .select("id,order_id,snapshot_id,location_id,identity_key,candidates,code").eq("source", "ezcater").is("resolved_at", null)
    .order("id").range(from, to));
  const targets = await selectAllRows<MappingTarget>((from, to) => sb.from("toast_menu_map")
    .select("id,location_id,toast_item_name,toast_item_guid").eq("active", true).eq("match_status", "confirmed")
    .eq("is_modifier", false).eq("disposition", "deplete").order("id").range(from, to));
  const orders = await selectAllRows<{ id: string; snapshot_id?: string; location_id: string; order_number: string | null }>((from, to) => sb.from("ezcater_orders")
    .select("id,snapshot_id,location_id,order_number").order("id").range(from, to));
  const locations = await selectAllRows<{ id: string; name: string }>((from, to) => sb.from("locations")
    .select("id,name").order("id").range(from, to));
  const items = await selectAllRows<ItemIdentity & { order_id: string; snapshot_id?: string; options: unknown[] }>((from, to) => sb.from("ezcater_order_items")
    .select("order_id,snapshot_id,provider_item_uuid,menu_item_size_id,pos_item_id,name,options").eq("is_current", true)
    .order("snapshot_id").order("ordinal").range(from, to));
  const counts = new Map<string, { item: ItemIdentity; count: number }>();
  const orderLocations = new Map(orders.map((o) => [o.id, o.location_id]));
  const orderSnapshots = new Map(orders.map((o) => [o.id, o.snapshot_id]));
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
    if (review.code?.startsWith("customization_")) continue;
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
  const directTargets: DirectMappingTarget[] = [];
  type Entity = { id: string; name: string; name_es: string | null; location_id?: string | null };
  for (const [table, kind] of [["menu_items", "menu_item"], ["items", "item"], ["catering_packages", "package"]] as const) {
    const entities = await selectAllRows<Entity>((from, to) => sb.from(table)
      .select(kind === "package" ? "id,name:label_en,name_es:label_es,location_id" : "id,name,name_es")
      .eq("active", true).order("id").range(from, to).returns<Entity[]>());
    directTargets.push(...entities.map((entity) => ({ id: entity.id,
      name: actor.user.language === "es" ? entity.name_es ?? entity.name : entity.name,
      kind, location_id: entity.location_id ?? null })));
  }
  const toastRows = await selectAllRows<{ id: string; order_id: string; location_id: string; identity_key: string; code: string }>((from, to) => sb.from("ezcater_review_queue")
    .select("id,order_id,location_id,identity_key,code").eq("source", "toast").eq("code", "unmatched_code").is("resolved_at", null)
    .order("id").range(from, to));
  const toastReviews: ToastReview[] = toastRows.filter((row) => orderLocations.get(row.order_id) === row.location_id).map((row) => ({
    reviewId: row.id, locationId: row.location_id,
    locationName: locations.find((location) => location.id === row.location_id)?.name ?? row.location_id,
    code: row.code, identity: row.identity_key, orderNumber: orders.find((order) => order.id === row.order_id)?.order_number ?? null,
  }));
  const reconciliation = await selectAllRows<ToastCrossCheckOrder>((from, to) => sb.from("ezcater_reconciliation_status")
    .select("order_id,location_id,event_date,order_number,status,rule").order("event_date", { ascending: false }).order("order_id").range(from, to));
  const reconciliationReviews: ReconciliationReview[] = reconciliation.map((row) => ({ ...row,
    locationName: locations.find((location) => location.id === row.location_id)?.name ?? row.location_id,
  }));
  const skuRows = await selectAllRows<{ id: string; name: string }>((from, to) => sb.from("vendor_items")
    .select("id,name").eq("active", true).eq("sku_class", "raw").order("name").range(from, to));
  directTargets.push(...skuRows.map((row) => ({ id: row.id, kind: "sku" as const, name: row.name, location_id: null })));
  const customizationRows = await selectAllRows<{ id: string; order_id: string; snapshot_id: string; location_id: string; identity_key: string }>((from, to) => sb.from("ezcater_review_queue")
    .select("id,order_id,snapshot_id,location_id,identity_key").eq("source", "ezcater").eq("code", "customization_unmapped")
    .is("resolved_at", null).order("id").range(from, to));
  const optionCounts = new Map<string, { name: string; typeName: string | null; count: number }>();
  const optionsByOrder = new Set<string>();
  for (const item of items) {
    const locationId = orderLocations.get(item.order_id);
    if (!locationId) continue;
    for (const raw of item.options ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const option = raw as { customizationId?: unknown; name?: unknown; typeName?: unknown };
      if (typeof option.customizationId !== "string" || !option.customizationId.trim()) continue;
      const key = JSON.stringify([locationId, option.customizationId]);
      optionsByOrder.add(JSON.stringify([item.order_id, item.snapshot_id, option.customizationId]));
      const previous = optionCounts.get(key);
      optionCounts.set(key, {
        name: typeof option.name === "string" && option.name.trim() ? option.name.trim() : option.customizationId,
        typeName: typeof option.typeName === "string" && option.typeName.trim() ? option.typeName.trim() : null,
        count: (previous?.count ?? 0) + 1,
      });
    }
  }
  const customizationCandidates: CustomizationCandidate[] = [];
  const seenCustomizations = new Set<string>();
  for (const row of customizationRows) {
    if (orderLocations.get(row.order_id) !== row.location_id) continue;
    if (orderSnapshots.get(row.order_id) !== row.snapshot_id) continue;
    if (!optionsByOrder.has(JSON.stringify([row.order_id, row.snapshot_id, row.identity_key]))) continue;
    const key = JSON.stringify([row.location_id, row.identity_key]);
    const count = optionCounts.get(key);
    if (!count || seenCustomizations.has(key)) continue;
    seenCustomizations.add(key);
    customizationCandidates.push({ reviewId: row.id, customizationId: row.identity_key,
      locationId: row.location_id, locationName: locations.find((l) => l.id === row.location_id)?.name ?? row.location_id,
      name: count.name, typeName: count.typeName, lineCount: count.count });
  }
  return { candidates, customizationCandidates, targets, directTargets, toastReviews, reconciliationReviews };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorizeDecision(actor: AuthContext) {
  await authorize(actor);
  const step = assertStepUp(actor, "B");
  if (!step.ok) throw new CateringPipelineError(403, step.code);
}

export async function decideEzcaterMappingDirect(actor: AuthContext, reviewId: string, entityKind: string, entityId: string) {
  await authorizeDecision(actor);
  if (!UUID.test(reviewId) || !["menu_item", "item", "package"].includes(entityKind) || !UUID.test(entityId)) {
    throw new CateringPipelineError(400, "invalid_payload");
  }
  return mappingRpc("decide_ezcater_mapping_direct", {
    p_review_id: reviewId, p_entity_kind: entityKind, p_entity_id: entityId, p_actor_id: actor.user.id,
  });
}

export async function dismissEzcaterToastReview(actor: AuthContext, reviewId: string, reason: string, note: string | null) {
  await authorizeDecision(actor);
  if (!UUID.test(reviewId) || !["not_ezcater", "duplicate", "test", "other"].includes(reason) ||
      (note !== null && (typeof note !== "string" || note.trim().length > 500)) || (reason === "other" && !note?.trim())) {
    throw new CateringPipelineError(400, "invalid_payload");
  }
  return mappingRpc("dismiss_ezcater_toast_review", {
    p_review_id: reviewId, p_reason: reason, p_note: note?.trim() || null, p_actor_id: actor.user.id,
  });
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
  return mappingRpc("decide_ezcater_mapping", {
    p_review_id: reviewId, p_toast_map_id: targetId, p_decision: decision, p_actor_id: actor.user.id,
  });
}

export async function decideEzcaterCustomization(
  actor: AuthContext, reviewId: string, decision: "approve" | "ignore",
  effects: ModifierEffect[], pickMenuItemId: string | null,
) {
  await authorizeDecision(actor);
  if (!UUID.test(reviewId)) throw new CateringPipelineError(400, "invalid_payload");
  const parsed = parseCustomizationDecision({ decision, effects, pickMenuItemId });
  if (!parsed) throw new CateringPipelineError(400, "invalid_payload");
  return mappingRpc("decide_ezcater_customization", {
    p_review_id: reviewId, p_decision: parsed.decision, p_effects: parsed.effects,
    p_pick_menu_item_id: parsed.pickMenuItemId, p_actor_id: actor.user.id,
  });
}

async function mappingRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await getServiceRoleClient().rpc(name, args);
  if (error) {
    if (["42883", "42P01", "42703", "PGRST202", "PGRST205"].includes(error.code)) throw new CateringPipelineError(503, "ezcater_schema_unavailable");
    if (error.message === "ezcater_mapping_forbidden") throw new CateringPipelineError(403, "forbidden");
    if (error.message === "ezcater_mapping_review_not_found") throw new CateringPipelineError(404, "not_found");
    if (error.message === "ezcater_customization_review_not_found") throw new CateringPipelineError(404, "not_found");
    if (["ezcater_customization_invalid_decision", "ezcater_customization_effect_invalid"].includes(error.message)) throw new CateringPipelineError(400, "invalid_payload");
    if (error.message === "ezcater_customization_pick_invalid") throw new CateringPipelineError(409, "mapping_changed");
    if (["ezcater_mapping_source_changed", "ezcater_mapping_target_invalid"].includes(error.message)) throw new CateringPipelineError(409, "mapping_changed");
    throw new CateringPipelineError(503, "mapping_unavailable");
  }
  if (!data) throw new CateringPipelineError(503, "mapping_unavailable");
  return data;
}
