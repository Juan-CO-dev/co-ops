/**
 * Admin SKU-catalog data layer (Item/Inventory Spine — vendor mini-arc, Slice C1).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level floor → assertStepUp)
 * AND re-checked here per-action (defense in depth; the lib is the authority).
 * Service-role bypasses RLS by design, consistent with lib/admin/vendors.ts.
 *
 * Append-only: removals flip `active=false`, never DELETE.
 *
 * Schema (live, migrations 0095 + 0096 applied):
 *   vendor_items — id, vendor_id (NULLABLE FK→vendors — null = manual/vendor-less),
 *                  location_id (NULLABLE FK→locations — null = global, set =
 *                  location-specific), name (not null), category (text, VESTIGIAL),
 *                  unit/unit_size (text, VESTIGIAL — superseded by the structured
 *                  purchase model below; unit lost its NOT NULL in 0096),
 *                  pack_format (label from sku_pack_formats — how the vendor packs
 *                  it: Case/Box/Each…), units_per_pack (int — e.g. 6, 1 for Each),
 *                  each_size (numeric — e.g. 32), each_measure (label from
 *                  measure_units — oz/lb/count…), item_number, source_url,
 *                  lead_time_days, weekday_par/weekend_par (dormant ordering par —
 *                  LEFT UNTOUCHED), notes, active, audit.
 *   sku_pack_formats / measure_units — MoO+ registries (deny-all RLS, label-keyed),
 *                  mirror public.units (migration 0084).
 *
 * SKU cost is deferred to the C3 cost/yield slice (vendor_price_history).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

// ── Authority floors (the lib is the authority per-action) ──────────────────
export const SKU_READ_MIN = 6; // AGM+ — view the catalog + registries
export const SKU_WRITE_MIN = 7; // GM+ — create / update / deactivate / reassign
export const SKU_REGISTRY_ADD_MIN = 8; // MoO+ — add a pack format / measure unit

// ── Types ───────────────────────────────────────────────────────────────────
export interface SkuView {
  id: string;
  vendorId: string | null;
  vendorName: string | null;
  locationId: string | null;
  locationName: string | null;
  name: string;
  packFormat: string | null; // label (Case/Box/Each…)
  unitsPerPack: number | null; // 6 (1 for Each)
  eachSize: number | null; // 32
  eachMeasure: string | null; // label (oz/lb/count…)
  itemNumber: string | null;
  sourceUrl: string | null;
  leadTimeDays: number | null;
  notes: string | null;
  active: boolean;
}

/** A registry option (pack format or measure unit). */
export interface RegistryOption {
  id: string;
  label: string;
}

/** Typed error the routes map to jsonError(status, code). Mirrors AdminVendorError. */
export class AdminSkuError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminSkuError";
  }
}

// ── Internal guards / helpers ────────────────────────────────────────────────
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new AdminSkuError(403, "forbidden", "Insufficient role level for this action");
  }
}

function normalizeOptional(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t || null;
}

/** lead_time_days: undefined → leave as-is (caller decides); a value must be a
 *  non-negative integer, else throw. null is accepted (clears the field). */
function normalizeLeadTime(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v < 0) {
    throw new AdminSkuError(400, "invalid_lead_time", "Lead time must be a non-negative integer");
  }
  return v;
}

/** units_per_pack: null clears; a value must be a positive integer. */
function normalizeUnitsPerPack(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v < 1) {
    throw new AdminSkuError(400, "invalid_units_per_pack", "Units per pack must be a positive integer");
  }
  return v;
}

/** each_size: null clears; a value must be a positive number. */
function normalizeEachSize(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || v <= 0) {
    throw new AdminSkuError(400, "invalid_each_size", "Size of each must be a positive number");
  }
  return v;
}

/** Verify a vendor id exists AND is active, else invalid_vendor. */
async function assertVendorActive(vendorId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendors")
    .select("id")
    .eq("id", vendorId)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`assertVendorActive failed: ${error.message}`);
  if (!data) throw new AdminSkuError(400, "invalid_vendor", "Vendor not found or inactive");
}

/** Verify a location id exists AND is active, else invalid_location. */
async function assertLocationActive(locationId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`assertLocationActive failed: ${error.message}`);
  if (!data) throw new AdminSkuError(400, "invalid_location", "Location not found or inactive");
}

interface DbSkuRow {
  id: string;
  vendor_id: string | null;
  location_id: string | null;
  name: string;
  pack_format: string | null;
  units_per_pack: number | null;
  each_size: number | string | null; // numeric arrives as string from PostgREST
  each_measure: string | null;
  item_number: string | null;
  source_url: string | null;
  lead_time_days: number | null;
  notes: string | null;
  active: boolean | null;
}

const SKU_COLS =
  "id, vendor_id, location_id, name, pack_format, units_per_pack, each_size, each_measure, item_number, source_url, lead_time_days, notes, active";

function toNum(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

// ── Reads ─────────────────────────────────────────────────────────────────────
/** Hydrate vendorName + locationName via two-step batch loads (avoid fragile
 *  embedded-select filters per the PostgREST RLS-interaction lesson). */
async function hydrateSkus(rows: DbSkuRow[]): Promise<SkuView[]> {
  if (rows.length === 0) return [];
  const sb = getServiceRoleClient();

  const vendorIds = [...new Set(rows.map((r) => r.vendor_id).filter((v): v is string => v !== null))];
  const vendorNameById = new Map<string, string>();
  if (vendorIds.length > 0) {
    const { data, error } = await sb
      .from("vendors")
      .select("id, name")
      .in("id", vendorIds)
      .returns<Array<{ id: string; name: string }>>();
    if (error) throw new Error(`hydrateSkus vendors failed: ${error.message}`);
    for (const v of data ?? []) vendorNameById.set(v.id, v.name);
  }

  const locationIds = [...new Set(rows.map((r) => r.location_id).filter((v): v is string => v !== null))];
  const locationNameById = new Map<string, string>();
  if (locationIds.length > 0) {
    const { data, error } = await sb
      .from("locations")
      .select("id, name")
      .in("id", locationIds)
      .returns<Array<{ id: string; name: string }>>();
    if (error) throw new Error(`hydrateSkus locations failed: ${error.message}`);
    for (const l of data ?? []) locationNameById.set(l.id, l.name);
  }

  return rows.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    vendorName: r.vendor_id ? vendorNameById.get(r.vendor_id) ?? null : null,
    locationId: r.location_id,
    locationName: r.location_id ? locationNameById.get(r.location_id) ?? null : null,
    name: r.name,
    packFormat: r.pack_format,
    unitsPerPack: r.units_per_pack,
    eachSize: toNum(r.each_size),
    eachMeasure: r.each_measure,
    itemNumber: r.item_number,
    sourceUrl: r.source_url,
    leadTimeDays: r.lead_time_days,
    notes: r.notes,
    active: r.active ?? true, // nullable in DB → treat null as active
  }));
}

/**
 * Load SKUs (≥6). Returns all active+inactive SKUs (active first, then name).
 * opts.vendorId:
 *   undefined → all SKUs
 *   null      → manual / vendor-less SKUs only
 *   string    → SKUs for that vendor
 */
export async function loadSkus(
  actor: AuthContext,
  opts?: { vendorId?: string | null },
): Promise<SkuView[]> {
  requireLevel(actor, SKU_READ_MIN);
  const sb = getServiceRoleClient();

  let query = sb.from("vendor_items").select(SKU_COLS);
  if (opts && "vendorId" in opts) {
    if (opts.vendorId === null) {
      query = query.is("vendor_id", null);
    } else if (typeof opts.vendorId === "string") {
      query = query.eq("vendor_id", opts.vendorId);
    }
  }
  const { data, error } = await query
    .order("active", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true })
    .returns<DbSkuRow[]>();
  if (error) throw new Error(`loadSkus failed: ${error.message}`);
  return hydrateSkus(data ?? []);
}

// ── Registries (pack formats + measure units) ───────────────────────────────────
async function loadRegistry(actor: AuthContext, table: string): Promise<RegistryOption[]> {
  requireLevel(actor, SKU_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from(table)
    .select("id, label")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("label", { ascending: true })
    .returns<RegistryOption[]>();
  if (error) throw new Error(`loadRegistry(${table}) failed: ${error.message}`);
  return data ?? [];
}

export function loadPackFormats(actor: AuthContext): Promise<RegistryOption[]> {
  return loadRegistry(actor, "sku_pack_formats");
}
export function loadMeasureUnits(actor: AuthContext): Promise<RegistryOption[]> {
  return loadRegistry(actor, "measure_units");
}

/** Add a registry label (MoO+). Idempotent on the unique label; returns the row. */
async function addRegistryLabel(
  actor: AuthContext,
  table: string,
  label: string,
): Promise<RegistryOption> {
  requireLevel(actor, SKU_REGISTRY_ADD_MIN);
  const trimmed = label.trim();
  if (!trimmed) throw new AdminSkuError(400, "invalid_label", "Label is required");

  const sb = getServiceRoleClient();
  // Reactivate-or-return if the label already exists (append-only friendly).
  const { data: existing, error: exErr } = await sb
    .from(table)
    .select("id, label, active")
    .eq("label", trimmed)
    .maybeSingle<{ id: string; label: string; active: boolean | null }>();
  if (exErr) throw new Error(`addRegistryLabel(${table}) lookup failed: ${exErr.message}`);
  if (existing) {
    if (existing.active === false) {
      await sb
        .from(table)
        .update({ active: true, updated_by: actor.user.id, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return { id: existing.id, label: existing.label };
  }

  const { data: maxRow } = await sb
    .from(table)
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  const nextOrder = (maxRow?.display_order ?? 0) + 1;

  const { data: inserted, error } = await sb
    .from(table)
    .insert({
      label: trimmed,
      display_order: nextOrder,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id, label")
    .maybeSingle<RegistryOption>();
  if (error) throw new Error(`addRegistryLabel(${table}) insert failed: ${error.message}`);
  if (!inserted) throw new Error(`addRegistryLabel(${table}) returned no row`);
  return inserted;
}

export function addPackFormat(actor: AuthContext, label: string): Promise<RegistryOption> {
  return addRegistryLabel(actor, "sku_pack_formats", label);
}
export function addMeasureUnit(actor: AuthContext, label: string): Promise<RegistryOption> {
  return addRegistryLabel(actor, "measure_units", label);
}

// ── Create (GM+) ───────────────────────────────────────────────────────────────
export interface CreateSkuInput {
  vendorId: string | null;
  locationId: string | null;
  name: string;
  packFormat: string;
  unitsPerPack?: number | null;
  eachSize?: number | null;
  eachMeasure?: string | null;
  itemNumber?: string | null;
  sourceUrl?: string | null;
  leadTimeDays?: number | null;
  notes?: string | null;
}

export async function createSku(actor: AuthContext, input: CreateSkuInput): Promise<{ id: string }> {
  requireLevel(actor, SKU_WRITE_MIN);

  const name = input.name.trim();
  if (!name) throw new AdminSkuError(400, "invalid_name", "SKU name is required");
  const packFormat = input.packFormat.trim();
  if (!packFormat) throw new AdminSkuError(400, "invalid_pack_format", "Pack format is required");

  if (input.vendorId) await assertVendorActive(input.vendorId);
  if (input.locationId) await assertLocationActive(input.locationId);
  const leadTimeDays = normalizeLeadTime(input.leadTimeDays);
  const unitsPerPack = normalizeUnitsPerPack(input.unitsPerPack);
  const eachSize = normalizeEachSize(input.eachSize);

  const sb = getServiceRoleClient();
  const { data: inserted, error } = await sb
    .from("vendor_items")
    .insert({
      vendor_id: input.vendorId ?? null,
      location_id: input.locationId ?? null,
      name,
      pack_format: packFormat,
      units_per_pack: unitsPerPack,
      each_size: eachSize,
      each_measure: normalizeOptional(input.eachMeasure),
      item_number: normalizeOptional(input.itemNumber),
      source_url: normalizeOptional(input.sourceUrl),
      lead_time_days: leadTimeDays,
      notes: normalizeOptional(input.notes),
      active: true,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`createSku insert failed: ${error.message}`);
  if (!inserted) throw new Error("createSku insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor_item.create",
    resourceTable: "vendor_items",
    resourceId: inserted.id,
    metadata: {
      name,
      vendor_id: input.vendorId ?? null,
      location_id: input.locationId ?? null,
      pack_format: packFormat,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id };
}

// ── Update (GM+; reassign vendor allowed, incl. → null for manual) ─────────────
export interface UpdateSkuChanges {
  vendorId?: string | null;
  locationId?: string | null;
  name?: string;
  packFormat?: string;
  unitsPerPack?: number | null;
  eachSize?: number | null;
  eachMeasure?: string | null;
  itemNumber?: string | null;
  sourceUrl?: string | null;
  leadTimeDays?: number | null;
  notes?: string | null;
}

export async function updateSku(
  actor: AuthContext,
  args: { id: string; changes: UpdateSkuChanges },
): Promise<void> {
  requireLevel(actor, SKU_WRITE_MIN);

  const { changes } = args;
  const update: Record<string, unknown> = {};

  if (changes.vendorId !== undefined) {
    if (changes.vendorId !== null) await assertVendorActive(changes.vendorId);
    update.vendor_id = changes.vendorId; // null allowed → manual / reassign-off
  }
  if (changes.locationId !== undefined) {
    if (changes.locationId !== null) await assertLocationActive(changes.locationId);
    update.location_id = changes.locationId;
  }
  if (changes.name !== undefined) {
    const n = changes.name.trim();
    if (!n) throw new AdminSkuError(400, "invalid_name", "SKU name cannot be empty");
    update.name = n;
  }
  if (changes.packFormat !== undefined) {
    const p = changes.packFormat.trim();
    if (!p) throw new AdminSkuError(400, "invalid_pack_format", "Pack format cannot be empty");
    update.pack_format = p;
  }
  if (changes.unitsPerPack !== undefined) update.units_per_pack = normalizeUnitsPerPack(changes.unitsPerPack);
  if (changes.eachSize !== undefined) update.each_size = normalizeEachSize(changes.eachSize);
  if (changes.eachMeasure !== undefined) update.each_measure = normalizeOptional(changes.eachMeasure);
  if (changes.itemNumber !== undefined) update.item_number = normalizeOptional(changes.itemNumber);
  if (changes.sourceUrl !== undefined) update.source_url = normalizeOptional(changes.sourceUrl);
  if (changes.leadTimeDays !== undefined) update.lead_time_days = normalizeLeadTime(changes.leadTimeDays);
  if (changes.notes !== undefined) update.notes = normalizeOptional(changes.notes);

  if (Object.keys(update).length === 0) return;
  update.updated_by = actor.user.id;
  update.updated_at = new Date().toISOString();

  const sb = getServiceRoleClient();
  const { error, count } = await sb
    .from("vendor_items")
    .update(update, { count: "exact" })
    .eq("id", args.id);
  if (error) throw new Error(`updateSku failed: ${error.message}`);
  if (count === 0) throw new AdminSkuError(404, "sku_not_found", "SKU not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor_item.update",
    resourceTable: "vendor_items",
    resourceId: args.id,
    metadata: {
      fields: Object.keys(update).filter((k) => k !== "updated_by" && k !== "updated_at"),
    },
    ipAddress: null,
    userAgent: null,
  });
}

// ── Deactivate / reactivate (GM+; append-only) ─────────────────────────────────
export async function deactivateSku(
  actor: AuthContext,
  args: { id: string; active: boolean },
): Promise<void> {
  requireLevel(actor, SKU_WRITE_MIN);

  const sb = getServiceRoleClient();
  const { error, count } = await sb
    .from("vendor_items")
    .update(
      { active: args.active, updated_by: actor.user.id, updated_at: new Date().toISOString() },
      { count: "exact" },
    )
    .eq("id", args.id);
  if (error) throw new Error(`deactivateSku failed: ${error.message}`);
  if (count === 0) throw new AdminSkuError(404, "sku_not_found", "SKU not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: args.active ? "vendor_item.activate" : "vendor_item.deactivate",
    resourceTable: "vendor_items",
    resourceId: args.id,
    metadata: {},
    ipAddress: null,
    userAgent: null,
  });
}
