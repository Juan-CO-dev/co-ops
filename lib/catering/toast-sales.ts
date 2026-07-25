/**
 * Toast sales ingest + depletion projection (read-track 2). SERVER-ONLY,
 * service-role; level floors re-checked here, Tier-A step-up at the routes.
 *
 * Ledger law: toast_sales_events is APPEND-ONLY and snapshot-versioned per
 * (location, check, selection) — a re-pull appends version+1 only when the
 * selection state changed (quantity/void/price/name); voids arrive as new
 * versions. Depletion is a DERIVED projection (latest non-void versions →
 * exclusions → crosswalk → graph engines) — no stored on-hand is ever mutated.
 *
 * Double-count rule (Juan 2026-07-23, catering is MIXED): admin-curated
 * toast_ingest_exclusions decide which Toast lines are "regular sales";
 * excluded parents exclude their modifier children; a suspected-catering
 * advisory keeps misconfiguration visible. Outside-platform catering that
 * never touches Toast or CO-OPS is a NAMED gap until spec #2b's punch-in.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { fetchToastOrders } from "@/lib/toast/orders";
import { fetchToastMenuItems } from "@/lib/toast/menus";
import { fetchDiningOptionNames } from "@/lib/toast/config";
import { selectionChanged, type ToastSaleLine } from "@/lib/toast/orders-shared";
import {
  matchesExclusion, SUSPECT_NAME_RE, SUSPECT_CHECK_QTY,
  type IngestExclusion, type ExclusionTarget,
} from "./toast-sales-shared";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import {
  perUnitSkuOzForItemFromGraph, perUnitDirectSkuOzForMenuItem, firstLevelItemConsumption,
} from "@/lib/prep-consumption-graph";
import { modifierParUnits, removalAmount } from "@/lib/toast/modifiers-shared";

export const TOAST_SALES_WRITE_MIN = 7; // GM+ — pull + exclusions (mirrors toast-map)
export const TOAST_SALES_READ_MIN = 6;  // AGM+ — consumption readout (prep-demand page floor)

export class AdminToastSalesError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminToastSalesError";
  }
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new AdminToastSalesError(403, "forbidden", "Insufficient role level");
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
function requireYmd(d: string): void {
  if (!YMD_RE.test(d) || Number.isNaN(Date.parse(d))) throw new AdminToastSalesError(400, "invalid_date", "businessDate must be YYYY-MM-DD");
}

interface LedgerRow {
  check_guid: string; selection_guid: string; parent_selection_guid: string | null;
  toast_item_guid: string; item_name: string; quantity: number | string;
  price_cents: number | null; voided: boolean; dining_option: string | null;
  menu_group: string | null; snapshot_version: number;
}

async function loadLatestVersions(locationId: string, businessDate: string): Promise<Map<string, LedgerRow>> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("toast_sales_events")
    .select("check_guid, selection_guid, parent_selection_guid, toast_item_guid, item_name, quantity, price_cents, voided, dining_option, menu_group, snapshot_version")
    .eq("location_id", locationId).eq("business_date", businessDate)
    .returns<LedgerRow[]>();
  if (error) throw new Error(`toast-sales ledger read: ${error.message}`);
  const latest = new Map<string, LedgerRow>();
  for (const r of data ?? []) {
    const key = `${r.check_guid}:${r.selection_guid}`;
    const cur = latest.get(key);
    if (!cur || r.snapshot_version > cur.snapshot_version) latest.set(key, r);
  }
  return latest;
}

async function resolveLocationGuid(locationId: string): Promise<string> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("locations").select("id, toast_restaurant_guid")
    .eq("id", locationId).eq("active", true)
    .maybeSingle<{ id: string; toast_restaurant_guid: string | null }>();
  if (error) throw new Error(`toast-sales location: ${error.message}`);
  if (!data) throw new AdminToastSalesError(404, "location_not_found", "Location not found");
  return data.toast_restaurant_guid ?? ""; // fixture mode tolerates empty
}

export interface PullResult { selections: number; appended: number; unchanged: number; voids: number }

/** Core pull (shared by admin route + cron). actor null = system/cron context. */
async function doPull(locationId: string, businessDate: string, actor: AuthContext | null): Promise<PullResult> {
  requireYmd(businessDate);
  const guid = await resolveLocationGuid(locationId);
  const [lines, menuItems, diningNames, latest] = await Promise.all([
    fetchToastOrders(guid, businessDate),
    fetchToastMenuItems(guid),
    fetchDiningOptionNames(guid), // orders carry bare diningOption refs — names live in the config API
    loadLatestVersions(locationId, businessDate),
  ]);
  const groupByGuid = new Map(menuItems.map((m) => [m.itemGuid, m.groupName]));

  const inserts: Array<Record<string, unknown>> = [];
  let unchanged = 0, voids = 0;
  for (const line of lines) {
    if (line.voided) voids += 1;
    const key = `${line.checkGuid}:${line.selectionGuid}`;
    const prev = latest.get(key);
    if (prev && !selectionChanged(
      { quantity: Number(prev.quantity), voided: prev.voided, priceCents: prev.price_cents, itemName: prev.item_name },
      line,
    )) { unchanged += 1; continue; }
    inserts.push({
      location_id: locationId,
      business_date: businessDate,
      check_guid: line.checkGuid,
      selection_guid: line.selectionGuid,
      parent_selection_guid: line.parentSelectionGuid,
      toast_item_guid: line.itemGuid,
      item_name: line.displayName,
      quantity: line.quantity,
      price_cents: line.priceCents,
      voided: line.voided,
      dining_option: line.diningOptionGuid != null
        ? (diningNames.get(line.diningOptionGuid) ?? line.diningOptionGuid)
        : null,
      menu_group: groupByGuid.get(line.itemGuid) ?? null,
      snapshot_version: (prev?.snapshot_version ?? 0) + 1,
      created_by: actor?.user.id ?? null,
    });
  }
  if (inserts.length > 0) {
    const sb = getServiceRoleClient();
    const { error } = await sb.from("toast_sales_events").insert(inserts);
    if (error) {
      // Unique-violation = a concurrent pull already appended these versions
      // (cron + manual racing). Data is intact; degrade to a typed retryable.
      if (error.code === "23505") throw new AdminToastSalesError(409, "concurrent_pull", "Another pull just ran — refresh and retry");
      throw new Error(`toast-sales append: ${error.message}`);
    }
  }
  void audit({
    actorId: actor?.user.id ?? null,
    actorRole: actor?.user.role ?? null,
    action: "toast_sales.pull",
    resourceTable: "toast_sales_events",
    resourceId: locationId,
    metadata: {
      business_date: businessDate, selections: lines.length, appended: inserts.length,
      unchanged, voids, ...(actor ? {} : { actor_context: "cron" }),
    },
    ipAddress: null, userAgent: null,
  });
  return { selections: lines.length, appended: inserts.length, unchanged, voids };
}

export async function pullSales(actor: AuthContext, locationId: string, businessDate: string): Promise<PullResult> {
  requireLevel(actor, TOAST_SALES_WRITE_MIN);
  return doPull(locationId, businessDate, actor);
}

/** Cron entry: pull for every active location with a Toast GUID. Never throws per-location. */
export async function pullSalesForAllLocations(businessDate: string): Promise<Array<{ locationId: string; ok: boolean; error?: string; result?: PullResult }>> {
  requireYmd(businessDate);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("locations").select("id, toast_restaurant_guid").eq("active", true)
    .not("toast_restaurant_guid", "is", null)
    .returns<Array<{ id: string; toast_restaurant_guid: string }>>();
  if (error) throw new Error(`toast-sales cron locations: ${error.message}`);
  const out: Array<{ locationId: string; ok: boolean; error?: string; result?: PullResult }> = [];
  for (const loc of data ?? []) {
    try {
      out.push({ locationId: loc.id, ok: true, result: await doPull(loc.id, businessDate, null) });
    } catch (e) {
      out.push({ locationId: loc.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

// ─── Exclusions (append-only active-flag config) ─────────────────────────────

export interface ExclusionView extends IngestExclusion { createdAt: string }

export async function listExclusions(actor: AuthContext): Promise<ExclusionView[]> {
  requireLevel(actor, TOAST_SALES_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("toast_ingest_exclusions")
    .select("id, location_id, kind, value, note, created_at").eq("active", true)
    .order("created_at", { ascending: true })
    .returns<Array<{ id: string; location_id: string | null; kind: IngestExclusion["kind"]; value: string; note: string | null; created_at: string }>>();
  if (error) throw new Error(`toast-sales exclusions: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, locationId: r.location_id, kind: r.kind, value: r.value, note: r.note, createdAt: r.created_at }));
}

const KINDS = new Set(["dining_option", "menu_group", "toast_item_guid", "item_name_contains"]);

export async function addExclusion(
  actor: AuthContext,
  input: { locationId: string | null; kind: string; value: string; note?: string | null },
): Promise<{ id: string }> {
  requireLevel(actor, TOAST_SALES_WRITE_MIN);
  if (!KINDS.has(input.kind)) throw new AdminToastSalesError(400, "invalid_kind", "Unknown exclusion kind");
  const value = input.value.trim();
  if (value.length === 0 || value.length > 200) throw new AdminToastSalesError(400, "invalid_value", "Value required (≤200 chars)");
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("toast_ingest_exclusions")
    .insert({ location_id: input.locationId, kind: input.kind, value, note: input.note ?? null, created_by: actor.user.id })
    .select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`toast-sales exclusion insert: ${error.message}`);
  if (!data) throw new Error("toast-sales exclusion insert returned no row");
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "toast_sales.exclusion_add", resourceTable: "toast_ingest_exclusions", resourceId: data.id,
    metadata: { location_id: input.locationId, kind: input.kind, value },
    ipAddress: null, userAgent: null,
  });
  return { id: data.id };
}

export async function deactivateExclusion(actor: AuthContext, id: string): Promise<void> {
  requireLevel(actor, TOAST_SALES_WRITE_MIN);
  const sb = getServiceRoleClient();
  const { error, count } = await sb.from("toast_ingest_exclusions")
    .update({ active: false }, { count: "exact" }).eq("id", id).eq("active", true);
  if (error) throw new Error(`toast-sales exclusion deactivate: ${error.message}`);
  if (count === 0) throw new AdminToastSalesError(404, "not_found", "Exclusion not found");
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "toast_sales.exclusion_remove", resourceTable: "toast_ingest_exclusions", resourceId: id,
    metadata: {}, ipAddress: null, userAgent: null,
  });
}

// ─── Consumption projection (derived; advisory) ──────────────────────────────

export interface SalesConsumption {
  soldLines: Array<{ name: string; quantity: number; kind: "menu_item" | "item" }>;
  prepConsumed: Array<{ itemId: string; name: string; units: number; removedUnits: number }>;
  skuConsumed: Array<{ skuId: string; name: string; oz: number }>;
  unmappedToastItems: Array<{ name: string; quantity: number; toastItemGuid: string; isModifier: boolean }>;
  excludedCount: number;
  suspectedCatering: Array<{ checkGuid: string; diningOption: string | null; totalQty: number; reason: "name" | "quantity" }>;
  /** Modifier lane (spec 2026-07-24): applications counted / subtracted / skipped. */
  modifierStats: { depleted: number; removed: number; ignored: number; portionNeeded: Array<{ name: string; quantity: number }> };
}

export async function salesConsumption(actor: AuthContext, locationId: string, businessDate: string): Promise<SalesConsumption> {
  requireLevel(actor, TOAST_SALES_READ_MIN);
  requireYmd(businessDate);
  const sb = getServiceRoleClient();
  const [latest, exclusions] = await Promise.all([
    loadLatestVersions(locationId, businessDate),
    listExclusions(actor),
  ]);

  const live = [...latest.values()].filter((r) => !r.voided);

  // Exclusion pass + parent propagation (modifiers of an excluded parent are excluded).
  const excluded = new Set<string>();
  for (const r of live) {
    const target: ExclusionTarget = {
      locationId, diningOption: r.dining_option, menuGroup: r.menu_group,
      toastItemGuid: r.toast_item_guid, itemName: r.item_name,
    };
    if (matchesExclusion(target, exclusions)) excluded.add(r.selection_guid);
  }
  for (let i = 0; i < 3; i += 1) { // modifier depth is ≤2 in practice; fixpoint loop is cheap
    for (const r of live) {
      if (r.parent_selection_guid && excluded.has(r.parent_selection_guid)) excluded.add(r.selection_guid);
    }
  }
  const counted = live.filter((r) => !excluded.has(r.selection_guid));

  // Crosswalk resolution (confirmed, active).
  const { data: mapRows, error: mErr } = await sb.from("toast_menu_map")
    .select("menu_item_id, item_id, toast_item_guid, is_modifier, disposition, portion_qty, portion_unit")
    .eq("location_id", locationId).eq("active", true).eq("match_status", "confirmed")
    .returns<Array<{ menu_item_id: string | null; item_id: string | null; toast_item_guid: string; is_modifier: boolean; disposition: "deplete" | "remove" | "ignore"; portion_qty: number | string | null; portion_unit: string | null }>>();
  if (mErr) throw new Error(`toast-sales crosswalk: ${mErr.message}`);
  const entityByGuid = new Map(
    (mapRows ?? []).filter((m) => !m.is_modifier).map((m) => [m.toast_item_guid, m.menu_item_id != null
      ? { kind: "menu_item" as const, id: m.menu_item_id }
      : { kind: "item" as const, id: m.item_id! }]),
  );
  const modifierByGuid = new Map(
    (mapRows ?? []).filter((m) => m.is_modifier && m.item_id != null).map((m) => [m.toast_item_guid, {
      itemId: m.item_id!,
      disposition: m.disposition,
      portionQty: m.portion_qty != null ? Number(m.portion_qty) : null,
      portionUnit: m.portion_unit,
    }]),
  );

  const baseLines = counted.filter((r) => r.parent_selection_guid == null);
  const modifierLines = counted.filter((r) => r.parent_selection_guid != null);

  const qtyByEntity = new Map<string, { kind: "menu_item" | "item"; id: string; quantity: number }>();
  const unmapped = new Map<string, { name: string; quantity: number; isModifier: boolean }>();
  for (const r of baseLines) {
    const qty = Number(r.quantity);
    const ent = entityByGuid.get(r.toast_item_guid);
    if (!ent) {
      const u = unmapped.get(r.toast_item_guid) ?? { name: r.item_name, quantity: 0, isModifier: false };
      u.quantity += qty;
      unmapped.set(r.toast_item_guid, u);
      continue;
    }
    const key = `${ent.kind}:${ent.id}`;
    const cur = qtyByEntity.get(key);
    if (cur) cur.quantity += qty; else qtyByEntity.set(key, { ...ent, quantity: qty });
  }

  // ── Graph load once; base flatten first (menu_items → SKUs directly; item
  //    par-units accumulate SIGNED so the modifier lane can add/subtract before
  //    the clamp + item-grain SKU flatten). ─────────────────────────────────
  const graph = await loadRecipeGraph();
  const itemUnits = new Map<string, number>();       // signed par-units per item
  const removedByItem = new Map<string, number>();   // visible removal truth
  const sku = new Map<string, number>();             // menu_item lane SKUs (direct)
  for (const e of qtyByEntity.values()) {
    if (e.kind === "menu_item") {
      // DIRECT SKUs only here — item-ref SKUs flow through itemUnits so the
      // modifier lane can adjust them pre-flatten. Using the FULL flatten here
      // double-counted item-ref SKUs ~2x (PR #180 review finding #1).
      for (const [skuId, oz] of perUnitDirectSkuOzForMenuItem(graph, e.id)) sku.set(skuId, (sku.get(skuId) ?? 0) + oz * e.quantity);
      for (const [itemId, units] of firstLevelItemConsumption(graph, e.id)) itemUnits.set(itemId, (itemUnits.get(itemId) ?? 0) + units * e.quantity);
    } else {
      itemUnits.set(e.id, (itemUnits.get(e.id) ?? 0) + e.quantity);
    }
  }

  // ── Modifier lane (spec 2026-07-24): deplete adds portion-par-units; remove
  //    subtracts PARENT-AWARE amount (the parent sub recipe's own contribution)
  //    with portion fallback — Juan: removals COUNT. ────────────────────────
  const modifierStats = { depleted: 0, removed: 0, ignored: 0, portionNeeded: new Map<string, number>() };
  const parentGuidBySelection = new Map(counted.map((r) => [r.selection_guid, r.toast_item_guid]));
  for (const r of modifierLines) {
    const qty = Number(r.quantity);
    const mod = modifierByGuid.get(r.toast_item_guid);
    if (!mod) {
      const u = unmapped.get(r.toast_item_guid) ?? { name: r.item_name, quantity: 0, isModifier: true };
      u.quantity += qty;
      unmapped.set(r.toast_item_guid, u);
      continue;
    }
    if (mod.disposition === "ignore") { modifierStats.ignored += qty; continue; }
    const portion = mod.portionQty != null ? { qty: mod.portionQty, unit: mod.portionUnit } : null;
    const portionUnits = portion != null ? modifierParUnits(graph, mod.itemId, portion) : null;
    if (mod.disposition === "deplete") {
      if (portionUnits == null) { modifierStats.portionNeeded.set(r.item_name, (modifierStats.portionNeeded.get(r.item_name) ?? 0) + qty); continue; }
      itemUnits.set(mod.itemId, (itemUnits.get(mod.itemId) ?? 0) + portionUnits * qty);
      modifierStats.depleted += qty;
    } else {
      // remove: parent-aware first, portion fallback.
      const parentToastGuid = r.parent_selection_guid != null ? parentGuidBySelection.get(r.parent_selection_guid) : undefined;
      const parentEnt = parentToastGuid != null ? entityByGuid.get(parentToastGuid) : undefined;
      const parentAmount = parentEnt?.kind === "menu_item" ? removalAmount(graph, parentEnt.id, mod.itemId) : null;
      const amount = parentAmount ?? portionUnits;
      if (amount == null) { modifierStats.portionNeeded.set(r.item_name, (modifierStats.portionNeeded.get(r.item_name) ?? 0) + qty); continue; }
      itemUnits.set(mod.itemId, (itemUnits.get(mod.itemId) ?? 0) - amount * qty);
      removedByItem.set(mod.itemId, (removedByItem.get(mod.itemId) ?? 0) + amount * qty);
      modifierStats.removed += qty;
    }
  }

  // ── Clamp per-item totals at ≥0, THEN flatten item par-units to SKUs. ─────
  const prep = new Map<string, number>();
  for (const [itemId, units] of itemUnits) {
    const clamped = Math.max(units, 0);
    prep.set(itemId, clamped);
    if (clamped > 0) {
      for (const [skuId, oz] of perUnitSkuOzForItemFromGraph(graph, itemId)) sku.set(skuId, (sku.get(skuId) ?? 0) + oz * clamped);
    }
  }

  // Names for entities, prep items, and SKUs.
  const menuItemIds = [...qtyByEntity.values()].filter((e) => e.kind === "menu_item").map((e) => e.id);
  const itemIds = [...new Set([...prep.keys(), ...[...qtyByEntity.values()].filter((e) => e.kind === "item").map((e) => e.id)])];
  const skuIds = [...sku.keys()];
  const [menuNames, itemNames, skuNames] = await Promise.all([
    menuItemIds.length ? sb.from("menu_items").select("id, name").in("id", menuItemIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [], error: null }),
    itemIds.length ? sb.from("items").select("id, name").in("id", itemIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [], error: null }),
    skuIds.length ? sb.from("vendor_items").select("id, name").in("id", skuIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [], error: null }),
  ]);
  if (menuNames.error) throw new Error(`toast-sales names menu_items: ${menuNames.error.message}`);
  if (itemNames.error) throw new Error(`toast-sales names items: ${itemNames.error.message}`);
  if (skuNames.error) throw new Error(`toast-sales names skus: ${skuNames.error.message}`);
  const mName = new Map((menuNames.data ?? []).map((r) => [r.id, r.name]));
  const iName = new Map((itemNames.data ?? []).map((r) => [r.id, r.name]));
  const sName = new Map((skuNames.data ?? []).map((r) => [r.id, r.name]));

  // Suspected-catering advisory over NON-excluded checks.
  const byCheck = new Map<string, { qty: number; dining: string | null; nameHit: boolean }>();
  for (const r of counted) {
    const c = byCheck.get(r.check_guid) ?? { qty: 0, dining: r.dining_option, nameHit: false };
    c.qty += Number(r.quantity);
    if (SUSPECT_NAME_RE.test(r.item_name)) c.nameHit = true;
    byCheck.set(r.check_guid, c);
  }
  const suspectedCatering: SalesConsumption["suspectedCatering"] = [];
  for (const [checkGuid, c] of byCheck) {
    if (c.nameHit) suspectedCatering.push({ checkGuid, diningOption: c.dining, totalQty: c.qty, reason: "name" });
    else if (c.qty >= SUSPECT_CHECK_QTY) suspectedCatering.push({ checkGuid, diningOption: c.dining, totalQty: c.qty, reason: "quantity" });
  }

  return {
    soldLines: [...qtyByEntity.values()]
      .map((e) => ({ name: (e.kind === "menu_item" ? mName.get(e.id) : iName.get(e.id)) ?? "(unknown)", quantity: e.quantity, kind: e.kind }))
      .sort((a, b) => b.quantity - a.quantity),
    prepConsumed: [...prep.entries()]
      .filter(([itemId, units]) => units > 0 || (removedByItem.get(itemId) ?? 0) > 0)
      .map(([itemId, units]) => ({ itemId, name: iName.get(itemId) ?? "(item)", units, removedUnits: removedByItem.get(itemId) ?? 0 }))
      .sort((a, b) => b.units - a.units),
    skuConsumed: [...sku.entries()].map(([skuId, oz]) => ({ skuId, name: sName.get(skuId) ?? "(sku)", oz })).sort((a, b) => b.oz - a.oz),
    unmappedToastItems: [...unmapped.entries()]
      .map(([toastItemGuid, u]) => ({ name: u.name, quantity: u.quantity, toastItemGuid, isModifier: u.isModifier }))
      .sort((a, b) => b.quantity - a.quantity),
    excludedCount: excluded.size,
    suspectedCatering,
    modifierStats: {
      depleted: modifierStats.depleted,
      removed: modifierStats.removed,
      ignored: modifierStats.ignored,
      portionNeeded: [...modifierStats.portionNeeded.entries()].map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity),
    },
  };
}
