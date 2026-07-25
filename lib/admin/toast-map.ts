/**
 * Toast crosswalk admin data layer (read-track 1). SERVER-ONLY, service-role;
 * authz = requireSession → level floor at the route + re-checked here, writes
 * behind Tier-A step-up at the route (mirrors lib/admin/catering/menu.ts).
 *
 * The crosswalk maps CO entities → Toast menu-item GUIDs per location
 * (toast_menu_map, migration 0146; multi-guid since 0151 — ONE entity may hold
 * MANY confirmed Toast guids because Toast models channel-priced variants as
 * distinct items; each guid maps to exactly one entity. Deny-all RLS — this
 * lib is the sole write path). State machine per row: candidate → confirmed | rejected; confirmed →
 * stale (drift: vanished from Toast) or active=false (unmap/supersede). Rows
 * never DELETE; identity changes supersede (new row + old active=false).
 *
 * Toast stays MENU SOURCE-OF-TRUTH. Everything here is advisory read + curated
 * mapping — CO-OPS never mutates Toast, and never auto-mutates its own menu.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { toastConfigured } from "@/lib/toast/client";
import { fetchToastMenuItems } from "@/lib/toast/menus";
import { matchCandidates, type CoEntity, type ToastItem } from "@/lib/toast/matcher";

export const TOAST_MAP_MIN = 7; // GM+ — mirrors the catering-menu admin surface

export class AdminToastMapError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminToastMapError";
  }
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new AdminToastMapError(403, "forbidden", "Insufficient role level");
}

export interface ToastMapRow {
  id: string;
  locationId: string;
  menuItemId: string | null;
  itemId: string | null;
  entityName: string | null; // resolved for display
  toastItemGuid: string;
  toastItemName: string;
  toastPriceCents: number | null;
  matchStatus: "candidate" | "confirmed" | "rejected" | "stale";
  matchScore: number | null;
  confirmedAt: string | null;
}
export interface ToastMapLocation {
  id: string;
  name: string;
  toastRestaurantGuid: string | null;
}
export interface ToastMapState {
  configured: boolean;
  locations: ToastMapLocation[];
  rows: ToastMapRow[]; // active rows, all statuses
  entities: CoEntity[]; // the mappable universe (global)
}

interface DbMapRow {
  id: string; location_id: string; menu_item_id: string | null; item_id: string | null;
  toast_item_guid: string; toast_item_name: string; toast_price_cents: number | null;
  match_status: "candidate" | "confirmed" | "rejected" | "stale"; match_score: number | string | null;
  confirmed_at: string | null;
}

const toCents = (v: number | string | null) => (v != null ? Math.round(Number(v) * 100) : null);

/** Mappable universe (spec-pinned): active global menu_items + active global sold_directly items. */
async function loadEntities(): Promise<CoEntity[]> {
  const sb = getServiceRoleClient();
  const [{ data: subs, error: sErr }, { data: items, error: iErr }] = await Promise.all([
    sb.from("menu_items").select("id, name, menu_price").eq("active", true)
      .returns<Array<{ id: string; name: string; menu_price: number | string | null }>>(),
    sb.from("items").select("id, name, menu_price").eq("active", true).eq("sold_directly", true).is("location_id", null)
      .returns<Array<{ id: string; name: string; menu_price: number | string | null }>>(),
  ]);
  if (sErr) throw new Error(`toast-map entities menu_items: ${sErr.message}`);
  if (iErr) throw new Error(`toast-map entities items: ${iErr.message}`);
  return [
    ...(subs ?? []).map((r): CoEntity => ({ kind: "menu_item", id: r.id, name: r.name, priceCents: toCents(r.menu_price) })),
    ...(items ?? []).map((r): CoEntity => ({ kind: "item", id: r.id, name: r.name, priceCents: toCents(r.menu_price) })),
  ];
}

async function loadActiveRows(locationId?: string): Promise<DbMapRow[]> {
  const sb = getServiceRoleClient();
  let q = sb.from("toast_menu_map")
    .select("id, location_id, menu_item_id, item_id, toast_item_guid, toast_item_name, toast_price_cents, match_status, match_score, confirmed_at")
    .eq("active", true);
  if (locationId) q = q.eq("location_id", locationId);
  const { data, error } = await q.returns<DbMapRow[]>();
  if (error) throw new Error(`toast-map rows: ${error.message}`);
  return data ?? [];
}

export async function loadToastMapState(actor: AuthContext): Promise<ToastMapState> {
  requireLevel(actor, TOAST_MAP_MIN);
  const sb = getServiceRoleClient();
  const [{ data: locs, error: lErr }, rows, entities] = await Promise.all([
    sb.from("locations").select("id, name, toast_restaurant_guid").eq("active", true)
      .order("name", { ascending: true })
      .returns<Array<{ id: string; name: string; toast_restaurant_guid: string | null }>>(),
    loadActiveRows(),
    loadEntities(),
  ]);
  if (lErr) throw new Error(`toast-map locations: ${lErr.message}`);
  const nameByEntity = new Map(entities.map((e) => [e.id, e.name]));
  return {
    configured: toastConfigured(),
    locations: (locs ?? []).map((l) => ({ id: l.id, name: l.name, toastRestaurantGuid: l.toast_restaurant_guid })),
    rows: rows.map((r) => ({
      id: r.id, locationId: r.location_id, menuItemId: r.menu_item_id, itemId: r.item_id,
      entityName: nameByEntity.get(r.menu_item_id ?? r.item_id ?? "") ?? null,
      toastItemGuid: r.toast_item_guid, toastItemName: r.toast_item_name, toastPriceCents: r.toast_price_cents,
      matchStatus: r.match_status, matchScore: r.match_score != null ? Number(r.match_score) : null,
      confirmedAt: r.confirmed_at,
    })),
    entities,
  };
}

async function requireLocationGuid(locationId: string): Promise<string> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("locations").select("id, toast_restaurant_guid")
    .eq("id", locationId).eq("active", true)
    .maybeSingle<{ id: string; toast_restaurant_guid: string | null }>();
  if (error) throw new Error(`toast-map location: ${error.message}`);
  if (!data) throw new AdminToastMapError(404, "location_not_found", "Location not found");
  // Fixture mode runs without a real GUID; live mode requires one.
  return data.toast_restaurant_guid ?? "";
}

/** Pull the Toast menu and insert candidate rows for UNMAPPED entities × UNMAPPED Toast items.
 *  Idempotent: never duplicates an active row for the same (location, entity, guid) pair;
 *  NEVER touches confirmed/rejected rows. */
export async function runAutoMatch(
  actor: AuthContext,
  locationId: string,
): Promise<{ pulled: number; candidates: number; skippedExisting: number }> {
  requireLevel(actor, TOAST_MAP_MIN);
  const guid = await requireLocationGuid(locationId);
  const toastItems = await fetchToastMenuItems(guid);
  const [rows, entities] = await Promise.all([loadActiveRows(locationId), loadEntities()]);

  // Multi-guid law: a confirmed entity stays in the pool (it may gain more
  // channel-variant guids); only already-claimed GUIDs leave the pool.
  const takenGuids = new Set(rows.filter((r) => r.match_status === "confirmed").map((r) => r.toast_item_guid));
  const rejectedPairs = new Set(rows.filter((r) => r.match_status === "rejected").map((r) => `${r.menu_item_id ?? r.item_id}:${r.toast_item_guid}`));
  const existingCandidatePairs = new Set(rows.filter((r) => r.match_status === "candidate").map((r) => `${r.menu_item_id ?? r.item_id}:${r.toast_item_guid}`));

  const freeEntities = entities;
  const freeToast = toastItems.filter((t) => !takenGuids.has(t.itemGuid));
  const candidates = matchCandidates(freeEntities, freeToast)
    .filter((c) => !rejectedPairs.has(`${c.entity.id}:${c.toast.itemGuid}`));

  const sb = getServiceRoleClient();
  let inserted = 0, skipped = 0;
  for (const c of candidates) {
    const pair = `${c.entity.id}:${c.toast.itemGuid}`;
    if (existingCandidatePairs.has(pair)) { skipped += 1; continue; }
    const { error } = await sb.from("toast_menu_map").insert({
      location_id: locationId,
      menu_item_id: c.entity.kind === "menu_item" ? c.entity.id : null,
      item_id: c.entity.kind === "item" ? c.entity.id : null,
      toast_item_guid: c.toast.itemGuid,
      toast_item_name: c.toast.name,
      toast_price_cents: c.toast.priceCents,
      match_status: "candidate",
      match_score: c.score,
      created_by: actor.user.id,
    });
    if (error) throw new Error(`toast-map candidate insert: ${error.message}`);
    inserted += 1;
  }
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "toast_map.auto_match", resourceTable: "toast_menu_map", resourceId: locationId,
    metadata: { location_id: locationId, pulled: toastItems.length, candidates: inserted, skipped_existing: skipped },
    ipAddress: null, userAgent: null,
  });
  return { pulled: toastItems.length, candidates: inserted, skippedExisting: skipped };
}

async function loadRow(mapId: string): Promise<DbMapRow & { active: boolean }> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("toast_menu_map")
    .select("id, location_id, menu_item_id, item_id, toast_item_guid, toast_item_name, toast_price_cents, match_status, match_score, confirmed_at, active")
    .eq("id", mapId)
    .maybeSingle<DbMapRow & { active: boolean }>();
  if (error) throw new Error(`toast-map load row: ${error.message}`);
  if (!data || !data.active) throw new AdminToastMapError(404, "not_found", "Mapping not found");
  return data;
}

/** candidate → confirmed. Supersedes (active=false) any OTHER active row for the same
 *  entity or the same guid at this location, so the partial-unique indexes stay satisfiable. */
export async function confirmMapping(actor: AuthContext, mapId: string): Promise<void> {
  requireLevel(actor, TOAST_MAP_MIN);
  const row = await loadRow(mapId);
  if (row.match_status !== "candidate") throw new AdminToastMapError(409, "not_candidate", "Only candidates confirm");
  const sb = getServiceRoleClient();

  const entityId = row.menu_item_id ?? row.item_id!;
  // Supersede competitors claiming this GUID (each guid maps to ONE entity).
  // Same-entity rows are NOT rivals anymore — multi-guid law (0151).
  const { data: rivals, error: rErr } = await sb.from("toast_menu_map").select("id")
    .eq("location_id", row.location_id).eq("active", true).neq("id", mapId)
    .eq("toast_item_guid", row.toast_item_guid)
    .returns<Array<{ id: string }>>();
  if (rErr) throw new Error(`toast-map rivals: ${rErr.message}`);
  for (const rival of rivals ?? []) {
    const { error, count } = await sb.from("toast_menu_map")
      .update({ active: false }, { count: "exact" }).eq("id", rival.id).eq("active", true);
    if (error) throw new Error(`toast-map supersede: ${error.message}`);
    if (count === 0) throw new AdminToastMapError(409, "conflict", "Concurrent change — reload and retry");
  }
  const { error, count } = await sb.from("toast_menu_map")
    .update({ match_status: "confirmed", confirmed_by: actor.user.id, confirmed_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", mapId).eq("active", true).eq("match_status", "candidate");
  if (error) throw new Error(`toast-map confirm: ${error.message}`);
  if (count === 0) throw new AdminToastMapError(409, "conflict", "Concurrent change — reload and retry");
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "toast_map.confirm", resourceTable: "toast_menu_map", resourceId: mapId,
    metadata: { location_id: row.location_id, entity_id: entityId, toast_item_guid: row.toast_item_guid, superseded: (rivals ?? []).length },
    ipAddress: null, userAgent: null,
  });
}

/** candidate → rejected (the pair is remembered and excluded from future auto-match runs). */
export async function rejectMapping(actor: AuthContext, mapId: string): Promise<void> {
  requireLevel(actor, TOAST_MAP_MIN);
  const row = await loadRow(mapId);
  if (row.match_status !== "candidate") throw new AdminToastMapError(409, "not_candidate", "Only candidates reject");
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("toast_menu_map")
    .update({ match_status: "rejected", confirmed_by: actor.user.id, confirmed_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", mapId).eq("active", true).eq("match_status", "candidate");
  if (error) throw new Error(`toast-map reject: ${error.message}`);
  if (count === 0) throw new AdminToastMapError(409, "conflict", "Concurrent change — reload and retry");
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "toast_map.reject", resourceTable: "toast_menu_map", resourceId: mapId,
    metadata: { location_id: row.location_id, toast_item_guid: row.toast_item_guid },
    ipAddress: null, userAgent: null,
  });
}

/** Retire an active confirmed/stale mapping (correction path — supersede-out, no delete). */
export async function unmapConfirmed(actor: AuthContext, mapId: string): Promise<void> {
  requireLevel(actor, TOAST_MAP_MIN);
  const row = await loadRow(mapId);
  if (row.match_status !== "confirmed" && row.match_status !== "stale") {
    throw new AdminToastMapError(409, "not_confirmed", "Only confirmed/stale mappings unmap");
  }
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("toast_menu_map")
    .update({ active: false }, { count: "exact" }).eq("id", mapId).eq("active", true);
  if (error) throw new Error(`toast-map unmap: ${error.message}`);
  if (count === 0) throw new AdminToastMapError(409, "conflict", "Concurrent change — reload and retry");
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "toast_map.unmap", resourceTable: "toast_menu_map", resourceId: mapId,
    metadata: { location_id: row.location_id, toast_item_guid: row.toast_item_guid },
    ipAddress: null, userAgent: null,
  });
}

export interface DriftReport {
  priceChanged: Array<{ row: ToastMapRow; toastNowCents: number | null; coCents: number | null }>;
  renamed: Array<{ row: ToastMapRow; toastNowName: string }>;
  missingOnToast: ToastMapRow[]; // flipped to 'stale' as the one write
  newOnToast: ToastItem[];
  unmappedCo: CoEntity[];
}

/** Advisory drift: live/fixture pull vs confirmed mappings vs CO prices. The ONLY write is
 *  flipping vanished mappings to 'stale' (audited) — read-time-classifier precedent (W4c-a). */
export async function driftReport(actor: AuthContext, locationId: string): Promise<DriftReport> {
  requireLevel(actor, TOAST_MAP_MIN);
  const guid = await requireLocationGuid(locationId);
  const toastItems = await fetchToastMenuItems(guid);
  const byGuid = new Map(toastItems.map((t) => [t.itemGuid, t]));
  const [rows, entities] = await Promise.all([loadActiveRows(locationId), loadEntities()]);
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const confirmed = rows.filter((r) => r.match_status === "confirmed");
  const mappedGuids = new Set(confirmed.map((r) => r.toast_item_guid));
  const mappedEntityIds = new Set(confirmed.map((r) => r.menu_item_id ?? r.item_id));

  const toView = (r: DbMapRow): ToastMapRow => ({
    id: r.id, locationId: r.location_id, menuItemId: r.menu_item_id, itemId: r.item_id,
    entityName: entityById.get(r.menu_item_id ?? r.item_id ?? "")?.name ?? null,
    toastItemGuid: r.toast_item_guid, toastItemName: r.toast_item_name, toastPriceCents: r.toast_price_cents,
    matchStatus: r.match_status, matchScore: r.match_score != null ? Number(r.match_score) : null,
    confirmedAt: r.confirmed_at,
  });

  const report: DriftReport = { priceChanged: [], renamed: [], missingOnToast: [], newOnToast: [], unmappedCo: [] };
  const sb = getServiceRoleClient();

  for (const r of confirmed) {
    const live = byGuid.get(r.toast_item_guid);
    if (!live) {
      const { error, count } = await sb.from("toast_menu_map")
        .update({ match_status: "stale" }, { count: "exact" })
        .eq("id", r.id).eq("active", true).eq("match_status", "confirmed");
      if (error) throw new Error(`toast-map stale flip: ${error.message}`);
      if (count === 1) {
        void audit({
          actorId: actor.user.id, actorRole: actor.user.role,
          action: "toast_map.stale", resourceTable: "toast_menu_map", resourceId: r.id,
          metadata: { location_id: locationId, toast_item_guid: r.toast_item_guid },
          ipAddress: null, userAgent: null,
        });
      }
      report.missingOnToast.push({ ...toView(r), matchStatus: "stale" });
      continue;
    }
    if (live.name !== r.toast_item_name) report.renamed.push({ row: toView(r), toastNowName: live.name });
    const coCents = entityById.get(r.menu_item_id ?? r.item_id ?? "")?.priceCents ?? null;
    const changedVsSnapshot = live.priceCents != null && r.toast_price_cents != null && live.priceCents !== r.toast_price_cents;
    const disagreesWithCo = live.priceCents != null && coCents != null && live.priceCents !== coCents;
    if (changedVsSnapshot || disagreesWithCo) {
      report.priceChanged.push({ row: toView(r), toastNowCents: live.priceCents, coCents });
    }
  }
  report.newOnToast = toastItems.filter((t) => !mappedGuids.has(t.itemGuid));
  report.unmappedCo = entities.filter((e) => !mappedEntityIds.has(e.id));
  return report;
}

/** Set/clear a location's Toast restaurant GUID (per-location operational identity — DATA
 *  per the tenant boundary law; the GUID scopes every Toast API call for that location). */
export async function setLocationToastGuid(
  actor: AuthContext,
  locationId: string,
  guid: string | null,
): Promise<void> {
  requireLevel(actor, TOAST_MAP_MIN);
  const trimmed = guid?.trim() || null;
  if (trimmed != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    throw new AdminToastMapError(400, "invalid_guid", "Toast restaurant GUID must be a UUID");
  }
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("locations")
    .update({ toast_restaurant_guid: trimmed }, { count: "exact" })
    .eq("id", locationId).eq("active", true);
  if (error) throw new Error(`toast-map set guid: ${error.message}`);
  if (count === 0) throw new AdminToastMapError(404, "location_not_found", "Location not found");
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "toast_map.set_location_guid", resourceTable: "locations", resourceId: locationId,
    metadata: { toast_restaurant_guid_set: trimmed != null },
    ipAddress: null, userAgent: null,
  });
}
