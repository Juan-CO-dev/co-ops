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
import { lockLocationContext } from "@/lib/locations";
import type { AuthContext } from "@/lib/session";
import { toastConfigured } from "@/lib/toast/client";
import { fetchToastMenuItems, fetchToastModifierOptions } from "@/lib/toast/menus";
import { matchCandidates, type CoEntity, type ToastItem } from "@/lib/toast/matcher";
import {
  classifyModifier, derivePortion,
  SKU_MODIFIER_DEFAULT_PORTION_QTY, SKU_MODIFIER_DEFAULT_PORTION_UNIT,
} from "@/lib/toast/modifiers-shared";
import { MENU_ITEM_MODIFIER_PORTION_WHOLE_SUBS, WHOLE_SUB_UNIT } from "@/lib/toast/platter-shared";
import { loadRecipeGraph } from "@/lib/prep-consumption";

export const TOAST_MAP_MIN = 7; // GM+ — mirrors the catering-menu admin surface

/** Row dispositions. assortment_* rows (platter spec 2026-07-25) map a MODIFIER
 *  guid to a pool BEHAVIOR (full enabled options vs the classic subset) and
 *  carry no entity FK at all — the parent line's package supplies the pool. */
export type MapDisposition = "deplete" | "remove" | "ignore" | "assortment_full" | "assortment_classics";
const ASSORTMENT_DISPOSITIONS = new Set<MapDisposition>(["assortment_full", "assortment_classics"]);

export class AdminToastMapError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminToastMapError";
  }
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new AdminToastMapError(403, "forbidden", "Insufficient role level");
}

/**
 * Location-access IDOR bind (hardening 2026-07-31, council P1): this lib had ZERO
 * location scoping — a location-scoped GM could auto-match / confirm / drift /
 * set-guid another location's crosswalk (masked today only by the solo admin's
 * all-locations shape). Every location-taking function calls this; the mapId
 * functions bind the loaded row's location. Mirrors lib/admin/templates.ts.
 */
function assertLocationAccess(actor: AuthContext, locationId: string): void {
  if (!lockLocationContext({ role: actor.user.role, locations: actor.locations }, locationId)) {
    throw new AdminToastMapError(403, "forbidden", "You do not manage that location");
  }
}

export interface ToastMapRow {
  id: string;
  locationId: string;
  menuItemId: string | null;
  itemId: string | null;
  packageId: string | null;
  skuId: string | null;
  entityName: string | null; // resolved for display
  toastItemGuid: string;
  toastItemName: string;
  toastPriceCents: number | null;
  matchStatus: "candidate" | "confirmed" | "rejected" | "stale";
  matchScore: number | null;
  confirmedAt: string | null;
  isModifier: boolean;
  disposition: MapDisposition;
  portionQty: number | null;
  portionUnit: string | null;
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
  package_id: string | null; sku_id: string | null;
  toast_item_guid: string; toast_item_name: string; toast_price_cents: number | null;
  match_status: "candidate" | "confirmed" | "rejected" | "stale"; match_score: number | string | null;
  confirmed_at: string | null;
  is_modifier: boolean; disposition: MapDisposition;
  portion_qty: number | string | null; portion_unit: string | null;
}

const toCents = (v: number | string | null) => (v != null ? Math.round(Number(v) * 100) : null);

/** Mappable universe. Item lane (spec #1): active global menu_items + sold_directly items.
 *  Modifier lane (spec 2026-07-24): ALL active global items — toppings are prep items. */
async function loadEntities(all = false): Promise<CoEntity[]> {
  const sb = getServiceRoleClient();
  let itemsQ = sb.from("items").select("id, name, menu_price").eq("active", true).is("location_id", null);
  if (!all) itemsQ = itemsQ.eq("sold_directly", true);
  const [{ data: subs, error: sErr }, { data: items, error: iErr }] = await Promise.all([
    sb.from("menu_items").select("id, name, menu_price").eq("active", true)
      .returns<Array<{ id: string; name: string; menu_price: number | string | null }>>(),
    itemsQ.returns<Array<{ id: string; name: string; menu_price: number | string | null }>>(),
  ]);
  if (sErr) throw new Error(`toast-map entities menu_items: ${sErr.message}`);
  if (iErr) throw new Error(`toast-map entities items: ${iErr.message}`);
  return [
    ...(subs ?? []).map((r): CoEntity => ({ kind: "menu_item", id: r.id, name: r.name, priceCents: toCents(r.menu_price) })),
    ...(items ?? []).map((r): CoEntity => ({ kind: "item", id: r.id, name: r.name, priceCents: toCents(r.menu_price) })),
  ];
}

/** Raw SKUs (vendor ingredients, taxonomy 0157 `sku_class='raw'`) — modifier
 *  targets with NO prep item (Sub Roll for salad conversion; Arugula /
 *  Pepperoncini / Dijon condiments). SKUs never enter the auto-matcher pool —
 *  they are manual-map-only — so this stays out of loadEntities/CoEntity. */
async function loadRawSkus(): Promise<Array<{ id: string; name: string }>> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("vendor_items").select("id, name")
    .eq("active", true).eq("sku_class", "raw")
    .returns<Array<{ id: string; name: string }>>();
  if (error) throw new Error(`toast-map raw skus: ${error.message}`);
  return data ?? [];
}

async function loadActiveRows(locationId?: string): Promise<DbMapRow[]> {
  const sb = getServiceRoleClient();
  let q = sb.from("toast_menu_map")
    .select("id, location_id, menu_item_id, item_id, package_id, sku_id, toast_item_guid, toast_item_name, toast_price_cents, match_status, match_score, confirmed_at, is_modifier, disposition, portion_qty, portion_unit")
    .eq("active", true);
  if (locationId) q = q.eq("location_id", locationId);
  const { data, error } = await q.returns<DbMapRow[]>();
  if (error) throw new Error(`toast-map rows: ${error.message}`);
  return data ?? [];
}

export async function loadToastMapState(actor: AuthContext): Promise<ToastMapState> {
  requireLevel(actor, TOAST_MAP_MIN);
  const sb = getServiceRoleClient();
  const [{ data: locs, error: lErr }, rows, entities, allEntities, { data: pkgs, error: pErr }, rawSkus] = await Promise.all([
    sb.from("locations").select("id, name, toast_restaurant_guid").eq("active", true)
      .order("name", { ascending: true })
      .returns<Array<{ id: string; name: string; toast_restaurant_guid: string | null }>>(),
    loadActiveRows(),
    loadEntities(),
    loadEntities(true), // display names must cover MODIFIER targets (all items), not just the sellable lane
    sb.from("catering_packages").select("id, label_en").eq("active", true)
      .returns<Array<{ id: string; label_en: string }>>(),
    loadRawSkus(), // SKU-target modifier rows (Part 2) resolve their display name here
  ]);
  if (lErr) throw new Error(`toast-map locations: ${lErr.message}`);
  if (pErr) throw new Error(`toast-map packages: ${pErr.message}`);
  const nameByEntity = new Map(allEntities.map((e) => [e.id, e.name]));
  for (const p of pkgs ?? []) nameByEntity.set(p.id, p.label_en);
  for (const s of rawSkus) nameByEntity.set(s.id, s.name);
  return {
    configured: toastConfigured(),
    locations: (locs ?? []).map((l) => ({ id: l.id, name: l.name, toastRestaurantGuid: l.toast_restaurant_guid })),
    rows: rows.map((r) => ({
      id: r.id, locationId: r.location_id, menuItemId: r.menu_item_id, itemId: r.item_id,
      packageId: r.package_id, skuId: r.sku_id,
      entityName: nameByEntity.get(r.menu_item_id ?? r.item_id ?? r.package_id ?? r.sku_id ?? "") ?? null,
      toastItemGuid: r.toast_item_guid, toastItemName: r.toast_item_name, toastPriceCents: r.toast_price_cents,
      matchStatus: r.match_status, matchScore: r.match_score != null ? Number(r.match_score) : null,
      confirmedAt: r.confirmed_at,
      isModifier: r.is_modifier, disposition: r.disposition,
      portionQty: r.portion_qty != null ? Number(r.portion_qty) : null, portionUnit: r.portion_unit,
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
): Promise<{ pulled: number; candidates: number; skippedExisting: number; modifierCandidates: number }> {
  requireLevel(actor, TOAST_MAP_MIN);
  assertLocationAccess(actor, locationId);
  const guid = await requireLocationGuid(locationId);
  const [toastItems, modifierOptions] = await Promise.all([
    fetchToastMenuItems(guid),
    fetchToastModifierOptions(guid),
  ]);
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
  // Modifier lane (spec 2026-07-24; menu_item targets since the platter spec
  // 2026-07-25): options match ALL active items AND menu_items via classified
  // names — platter checks carry named-sub picks as modifiers. Candidates
  // carry disposition + portion (items: derived; menu_items: half a sub).
  let modifierInserted = 0;
  if (modifierOptions.length > 0) {
    const allEntities = await loadEntities(true);
    const graph = await loadRecipeGraph();
    const classified = modifierOptions
      .filter((t) => !takenGuids.has(t.itemGuid))
      .map((t) => ({ toast: t, cls: classifyModifier(t.name) }))
      .filter((x) => x.cls.matchName.length > 0);
    const matchable: ToastItem[] = classified.map((x) => ({ ...x.toast, name: x.cls.matchName }));
    const clsByGuid = new Map(classified.map((x) => [x.toast.itemGuid, x.cls]));
    const nameByGuid = new Map(classified.map((x) => [x.toast.itemGuid, x.toast.name]));
    const modCandidates = matchCandidates(allEntities, matchable)
      .filter((c) => !rejectedPairs.has(`${c.entity.id}:${c.toast.itemGuid}`))
      .filter((c) => !existingCandidatePairs.has(`${c.entity.id}:${c.toast.itemGuid}`));
    for (const c of modCandidates) {
      const cls = clsByGuid.get(c.toast.itemGuid)!;
      const portion = c.entity.kind === "item"
        ? derivePortion(graph, c.entity.id)
        : { qty: MENU_ITEM_MODIFIER_PORTION_WHOLE_SUBS, unit: WHOLE_SUB_UNIT }; // platter piece = half a sub
      const { error } = await sb.from("toast_menu_map").insert({
        location_id: locationId,
        menu_item_id: c.entity.kind === "menu_item" ? c.entity.id : null,
        item_id: c.entity.kind === "item" ? c.entity.id : null,
        toast_item_guid: c.toast.itemGuid,
        toast_item_name: nameByGuid.get(c.toast.itemGuid) ?? c.toast.name,
        toast_price_cents: c.toast.priceCents,
        match_status: "candidate",
        match_score: c.score,
        is_modifier: true,
        disposition: cls.disposition,
        portion_qty: portion?.qty ?? null,
        portion_unit: portion?.unit ?? null,
        created_by: actor.user.id,
      });
      if (error) throw new Error(`toast-map modifier candidate insert: ${error.message}`);
      modifierInserted += 1;
    }
  }

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "toast_map.auto_match", resourceTable: "toast_menu_map", resourceId: locationId,
    metadata: { location_id: locationId, pulled: toastItems.length, candidates: inserted, skipped_existing: skipped, modifier_options: modifierOptions.length, modifier_candidates: modifierInserted },
    ipAddress: null, userAgent: null,
  });
  return { pulled: toastItems.length, candidates: inserted, skippedExisting: skipped, modifierCandidates: modifierInserted };
}

async function loadRow(mapId: string): Promise<DbMapRow & { active: boolean }> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("toast_menu_map")
    .select("id, location_id, menu_item_id, item_id, package_id, sku_id, toast_item_guid, toast_item_name, toast_price_cents, match_status, match_score, confirmed_at, is_modifier, disposition, portion_qty, portion_unit, active")
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
  assertLocationAccess(actor, row.location_id);
  if (row.match_status !== "candidate") throw new AdminToastMapError(409, "not_candidate", "Only candidates confirm");
  const sb = getServiceRoleClient();

  const entityId = row.menu_item_id ?? row.item_id ?? row.package_id ?? row.sku_id ?? null;
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
  await audit({
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
  assertLocationAccess(actor, row.location_id);
  if (row.match_status !== "candidate") throw new AdminToastMapError(409, "not_candidate", "Only candidates reject");
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("toast_menu_map")
    .update({ match_status: "rejected", confirmed_by: actor.user.id, confirmed_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", mapId).eq("active", true).eq("match_status", "candidate");
  if (error) throw new Error(`toast-map reject: ${error.message}`);
  if (count === 0) throw new AdminToastMapError(409, "conflict", "Concurrent change — reload and retry");
  await audit({
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
  assertLocationAccess(actor, row.location_id);
  if (row.match_status !== "confirmed" && row.match_status !== "stale") {
    throw new AdminToastMapError(409, "not_confirmed", "Only confirmed/stale mappings unmap");
  }
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("toast_menu_map")
    .update({ active: false }, { count: "exact" }).eq("id", mapId).eq("active", true);
  if (error) throw new Error(`toast-map unmap: ${error.message}`);
  if (count === 0) throw new AdminToastMapError(409, "conflict", "Concurrent change — reload and retry");
  await audit({
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
  assertLocationAccess(actor, locationId);
  const guid = await requireLocationGuid(locationId);
  const toastItems = await fetchToastMenuItems(guid);
  const byGuid = new Map(toastItems.map((t) => [t.itemGuid, t]));
  const [rows, entities] = await Promise.all([loadActiveRows(locationId), loadEntities()]);
  const entityById = new Map(entities.map((e) => [e.id, e]));
  // Drift compares the ITEM lane only — modifier options live in a different
  // payload block and would all read as "missing on Toast" here.
  const confirmed = rows.filter((r) => r.match_status === "confirmed" && !r.is_modifier);
  const mappedGuids = new Set(confirmed.map((r) => r.toast_item_guid));
  const mappedEntityIds = new Set(confirmed.map((r) => r.menu_item_id ?? r.item_id));

  const toView = (r: DbMapRow): ToastMapRow => ({
    id: r.id, locationId: r.location_id, menuItemId: r.menu_item_id, itemId: r.item_id,
    packageId: r.package_id, skuId: r.sku_id,
    entityName: entityById.get(r.menu_item_id ?? r.item_id ?? "")?.name ?? null,
    toastItemGuid: r.toast_item_guid, toastItemName: r.toast_item_name, toastPriceCents: r.toast_price_cents,
    matchStatus: r.match_status, matchScore: r.match_score != null ? Number(r.match_score) : null,
    confirmedAt: r.confirmed_at,
    isModifier: r.is_modifier, disposition: r.disposition,
    portionQty: r.portion_qty != null ? Number(r.portion_qty) : null, portionUnit: r.portion_unit,
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
        await audit({
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
  assertLocationAccess(actor, locationId);
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
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "toast_map.set_location_guid", resourceTable: "locations", resourceId: locationId,
    metadata: { toast_restaurant_guid_set: trimmed != null },
    ipAddress: null, userAgent: null,
  });
}

/** Manual-map targets: real entities (item / menu_item / package / raw SKU),
 *  plus the two assortment BEHAVIORS (platter spec 2026-07-25) which carry no
 *  entityId. SKU targets (Part 2) are always modifiers — a raw SKU is never a
 *  sold base line. */
export type ManualMapKind = "item" | "menu_item" | "package" | "sku" | "assortment_full" | "assortment_classics";

/**
 * MANUAL MAPPING (alias design 2026-07-25 — the crosswalk row IS the alias):
 * maps a Toast guid the matcher couldn't resolve ("Regular Mayo (Dukes)" →
 * Dukes, "Shredded Lettuce" → Iceberg) straight to a CONFIRMED row. Modifier
 * mappings auto-classify disposition from the Toast name and derive the
 * portion exactly like auto-matches; both are overridable later via unmap +
 * re-map. Supersedes same-guid rivals (one entity per guid stays law).
 *
 * Platter extensions (2026-07-25): base lines may map to a catering PACKAGE
 * (per-location or global — a platter parent guid); modifier lines may map to
 * a MENU_ITEM (named-sub pick, half-a-sub portion) or to an ASSORTMENT
 * behavior ("Our Favorites" → full pool, "The Classics" → classic subset).
 *
 * SKU extension (Part 2, 2026-07-27): modifier lines may map to a raw SKU with
 * no prep item — "No bread- serve it on a bed of greens" → remove one Sub
 * Roll; Arugula / Pepperoncini / Dijon → deplete their raw SKU. SKU targets are
 * ALWAYS modifiers (a raw SKU is never a sold base line) and default to a
 * 1-each portion; disposition classifies from the Toast name like items.
 */
export async function manualMap(
  actor: AuthContext,
  input: {
    locationId: string;
    toastItemGuid: string;
    toastItemName: string;
    entityKind: ManualMapKind;
    entityId: string | null;
    isModifier: boolean;
  },
): Promise<{ id: string }> {
  requireLevel(actor, TOAST_MAP_MIN);
  assertLocationAccess(actor, input.locationId);
  const sb = getServiceRoleClient();
  const name = input.toastItemName.trim();
  if (name.length === 0 || name.length > 200) throw new AdminToastMapError(400, "invalid_payload", "Toast item name required");
  if (input.toastItemGuid.trim().length === 0 || input.toastItemGuid.length > 100) {
    throw new AdminToastMapError(400, "invalid_payload", "Toast item guid required");
  }
  const isAssortment = ASSORTMENT_DISPOSITIONS.has(input.entityKind as MapDisposition);
  if (isAssortment && !input.isModifier) {
    throw new AdminToastMapError(400, "invalid_payload", "Assortments are modifier picks");
  }
  if (input.entityKind === "package" && input.isModifier) {
    throw new AdminToastMapError(400, "invalid_payload", "Packages map to base lines");
  }
  if (input.entityKind === "sku" && !input.isModifier) {
    throw new AdminToastMapError(400, "invalid_payload", "SKUs map to modifier lines only");
  }
  if (!isAssortment && input.entityId == null) {
    throw new AdminToastMapError(400, "invalid_payload", "Target entity required");
  }

  let entityName: string | null = null;
  if (!isAssortment) {
    if (input.entityKind === "package") {
      // Packages are per-location config — a guid at THIS location may only
      // target a package for this location (or a global one).
      const { data: pkg, error: pkgErr } = await sb.from("catering_packages")
        .select("id, label_en, location_id").eq("id", input.entityId!).eq("active", true)
        .maybeSingle<{ id: string; label_en: string; location_id: string | null }>();
      if (pkgErr) throw new Error(`toast-map manual package check: ${pkgErr.message}`);
      if (!pkg || (pkg.location_id != null && pkg.location_id !== input.locationId)) {
        throw new AdminToastMapError(400, "invalid_entity", "Package not found for this location");
      }
      entityName = pkg.label_en;
    } else if (input.entityKind === "sku") {
      const { data: skuRow, error: skuErr } = await sb.from("vendor_items")
        .select("id, name, sku_class").eq("id", input.entityId!).eq("active", true)
        .maybeSingle<{ id: string; name: string; sku_class: string }>();
      if (skuErr) throw new Error(`toast-map manual sku check: ${skuErr.message}`);
      if (!skuRow || skuRow.sku_class !== "raw") throw new AdminToastMapError(400, "invalid_entity", "Raw SKU not found or inactive");
      entityName = skuRow.name;
    } else {
      const table = input.entityKind === "menu_item" ? "menu_items" : "items";
      const { data: ent, error: eErr } = await sb.from(table).select("id, name").eq("id", input.entityId!).eq("active", true)
        .maybeSingle<{ id: string; name: string }>();
      if (eErr) throw new Error(`toast-map manual entity check: ${eErr.message}`);
      if (!ent) throw new AdminToastMapError(400, "invalid_entity", "Target not found or inactive");
      entityName = ent.name;
    }
  }

  // Supersede any active rival claiming this guid at this location.
  const { data: rivals, error: rErr } = await sb.from("toast_menu_map").select("id")
    .eq("location_id", input.locationId).eq("active", true).eq("toast_item_guid", input.toastItemGuid)
    .returns<Array<{ id: string }>>();
  if (rErr) throw new Error(`toast-map manual rivals: ${rErr.message}`);
  for (const rival of rivals ?? []) {
    const { error, count } = await sb.from("toast_menu_map")
      .update({ active: false }, { count: "exact" }).eq("id", rival.id).eq("active", true);
    if (error) throw new Error(`toast-map manual supersede: ${error.message}`);
    if (count === 0) throw new AdminToastMapError(409, "conflict", "Concurrent change — reload and retry");
  }

  let disposition: MapDisposition = "deplete";
  let portionQty: number | null = null;
  let portionUnit: string | null = null;
  if (isAssortment) {
    disposition = input.entityKind as MapDisposition;
  } else if (input.isModifier) {
    disposition = classifyModifier(name).disposition;
    if (input.entityKind === "menu_item") {
      portionQty = MENU_ITEM_MODIFIER_PORTION_WHOLE_SUBS; // platter piece = half a sub
      portionUnit = WHOLE_SUB_UNIT;
    } else if (input.entityKind === "sku") {
      // Raw SKU with no prep item (Sub Roll, condiments): default one each per
      // application; read-time conversion uses vendor_items.avg_oz_per_each.
      portionQty = SKU_MODIFIER_DEFAULT_PORTION_QTY;
      portionUnit = SKU_MODIFIER_DEFAULT_PORTION_UNIT;
    } else {
      const graph = await loadRecipeGraph();
      const portion = derivePortion(graph, input.entityId!);
      portionQty = portion?.qty ?? null;
      portionUnit = portion?.unit ?? null;
    }
  }

  const { data: inserted, error } = await sb.from("toast_menu_map").insert({
    location_id: input.locationId,
    menu_item_id: input.entityKind === "menu_item" ? input.entityId : null,
    item_id: input.entityKind === "item" ? input.entityId : null,
    package_id: input.entityKind === "package" ? input.entityId : null,
    sku_id: input.entityKind === "sku" ? input.entityId : null,
    toast_item_guid: input.toastItemGuid,
    toast_item_name: name,
    toast_price_cents: null,
    match_status: "confirmed",
    match_score: null,
    is_modifier: input.isModifier,
    disposition,
    portion_qty: portionQty,
    portion_unit: portionUnit,
    confirmed_by: actor.user.id,
    confirmed_at: new Date().toISOString(),
    created_by: actor.user.id,
  }).select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`toast-map manual insert: ${error.message}`);
  if (!inserted) throw new Error("toast-map manual insert returned no row");

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "toast_map.manual_map", resourceTable: "toast_menu_map", resourceId: inserted.id,
    metadata: {
      location_id: input.locationId, toast_item_guid: input.toastItemGuid, toast_item_name: name,
      entity_kind: input.entityKind, entity_id: input.entityId, entity_name: entityName,
      is_modifier: input.isModifier, disposition, superseded: (rivals ?? []).length,
    },
    ipAddress: null, userAgent: null,
  });
  return { id: inserted.id };
}

export interface MappableEntity {
  id: string;
  name: string;
  kind: "item" | "menu_item" | "package" | "sku";
  /** Packages only: null = global, else the owning location. Items/menu_items/SKUs are global (null). */
  locationId: string | null;
}

/** Lightweight mappable-entity list for manual-mapping pickers (id/name/kind).
 *  Includes active catering packages (platter parents map to packages) and
 *  active raw SKUs (modifier targets with no prep item — Part 2). */
export async function listMappableEntities(actor: AuthContext): Promise<MappableEntity[]> {
  requireLevel(actor, 6); // AGM+ — read-only names for the picker (writes stay >=7)
  const sb = getServiceRoleClient();
  const [all, { data: pkgs, error: pErr }, rawSkus] = await Promise.all([
    loadEntities(true),
    sb.from("catering_packages").select("id, label_en, location_id").eq("active", true)
      .returns<Array<{ id: string; label_en: string; location_id: string | null }>>(),
    loadRawSkus(),
  ]);
  if (pErr) throw new Error(`toast-map mappable packages: ${pErr.message}`);
  return [
    ...all.map((e): MappableEntity => ({ id: e.id, name: e.name, kind: e.kind, locationId: null })),
    ...(pkgs ?? []).map((p): MappableEntity => ({ id: p.id, name: p.label_en, kind: "package", locationId: p.location_id })),
    ...rawSkus.map((s): MappableEntity => ({ id: s.id, name: s.name, kind: "sku", locationId: null })),
  ].sort((a, b) => (a.name < b.name ? -1 : 1));
}

