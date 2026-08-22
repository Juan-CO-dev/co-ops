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
 *   location_sku_settings — per-(location,sku) overlay (VO-7, migration 0174):
 *                  active_override (null=inherit / true=on / false=off),
 *                  weekday_par / weekend_par (null=inherit global). UNIQUE
 *                  (location_id, sku_id). Upsert-in-place; NEVER deleted (a
 *                  revert-to-all-inherit nulls the three fields, keeping the row).
 *
 * SKU cost is deferred to the C3 cost/yield slice (vendor_price_history).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import type { MeasureDimension } from "@/lib/recipe-math";
import type { SkuClass } from "@/lib/admin/catalog-shared";
// SKU_CLASSES + isSkuClass live in the client-safe shared module (used by the
// SKU form); re-export so server consumers keep importing from lib/admin/skus.
export { SKU_CLASSES, isSkuClass } from "@/lib/admin/catalog-shared";
import { isSkuClass } from "@/lib/admin/catalog-shared";
import { parWriteColumns, type DayClass } from "@/lib/dynamic-pars-shared";
import { parAutoLaneReady } from "@/lib/dynamic-pars-probes";

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
  eachContainerLabel: string | null; // free-text label for the each/container
  avgOzPerEach: number | null; // oz per one each_measure unit (count/volume); null for weight
  itemNumber: string | null;
  sourceUrl: string | null;
  leadTimeDays: number | null;
  /** Ordering par in purchase units (Mon–Thu default). Drives the ordering walk. */
  weekdayPar: number | null;
  /** Ordering par in purchase units for Fri–Sun. Falls back to weekdayPar when null. */
  weekendPar: number | null;
  notes: string | null;
  active: boolean;
  /** Taxonomy class (0157): raw | packaging | cleaning | misc. */
  skuClass: SkuClass;
  /** Cushion policy class (0182). Deliberately un-enumerated free text; the percentages
   *  live in lib/dynamic-pars-shared.ts CUSHION_BY_CLASS. Null until 0182 + authoring. */
  cushionClass: string | null;
  /** The par quantum in order units (0182). Null = inferred by parStepFor() from the
   *  standing pars' grain — the column is the override, the inference is the bootstrap. */
  parStep: number | null;
}

/** A registry option (pack format or measure unit). */
export interface RegistryOption {
  id: string;
  label: string;
}

/** A measure-unit registry option carrying its conversion data (R1). */
export interface MeasureUnitOption {
  id: string;
  label: string;
  dimension: MeasureDimension;
  toBaseFactor: number;
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

/** weekday_par / weekend_par: null clears; a value must be a finite non-negative number. */
function normalizePar(v: number | null | undefined, field: string): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || v < 0) {
    throw new AdminSkuError(400, `invalid_${field}`, `${field} must be a non-negative number`);
  }
  return v;
}

/** cushion_class (0182): trimmed to ≤40 chars, or null. Deliberately NOT an enum — the
 *  vocabulary is expected to grow (plan D6, the 0177 precedent), so the only rule is
 *  "a short label or nothing". */
function normalizeCushionClass(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new AdminSkuError(400, "invalid_cushion_class", "Cushion class must be text");
  const t = v.trim();
  if (!t) return null;
  if (t.length > 40) {
    throw new AdminSkuError(400, "invalid_cushion_class", "Cushion class must be 40 characters or fewer");
  }
  return t;
}

/** par_step (0182): null clears (→ inferred by parStepFor); a value must be finite > 0,
 *  matching the DDL CHECK so the app never hands Postgres a row it will reject. */
function normalizeParStep(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || v <= 0) {
    throw new AdminSkuError(400, "invalid_par_step", "Par step must be a positive number");
  }
  return v;
}

/** avg_oz_per_each: null clears; a value must be a positive number. */
function normalizeAvgOzPerEach(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || v <= 0) {
    throw new AdminSkuError(400, "invalid_avg_oz_per_each", "Average oz per each must be a positive number");
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
  each_container_label: string | null;
  avg_oz_per_each: number | string | null;
  item_number: string | null;
  source_url: string | null;
  lead_time_days: number | null;
  weekday_par: number | string | null;
  weekend_par: number | string | null;
  notes: string | null;
  active: boolean | null;
  sku_class: SkuClass | null;
  // 0182 (GATE M1). Absent from the select until the migration applies — hence optional.
  cushion_class?: string | null;
  par_step?: number | string | null;
}

// sku_class rides the STAGED 0157 migration (merges with it in this PR).
const SKU_COLS =
  "id, vendor_id, location_id, name, pack_format, units_per_pack, each_size, each_measure, each_container_label, item_number, source_url, lead_time_days, weekday_par, weekend_par, notes, active, avg_oz_per_each, sku_class";

// ── The 0182 ordering-rhythm columns (Dynamic Pars Phase 1, Task 1.6) ──────────
//
// cushion_class + par_step do not exist until migration 0182 (GATE M1) is applied, and
// PostgREST rejects the WHOLE select when one column is missing — so naming them
// unconditionally in SKU_COLS would 500 /admin/skus and /admin/vendors/[id] for every
// deploy between this PR and the gate. They are therefore probe-gated exactly as
// countProductAllocationReady gates its column (lib/counts.ts): probe once, cache ONLY
// the true answer, re-probe while false, warn once. Pre-apply the two fields simply read
// null and the form group does not render; post-apply the surface lights itself with no
// redeploy. This is the plan's own pre-apply-degradation requirement applied to Task 1.6.
const SKU_PARS_COLS = "cushion_class, par_step";

let skuParsColumnsReady = false;
let skuParsPendingLogged = false;

/** True once vendor_items carries the 0182 ordering-rhythm columns. */
export async function parsColumnsReady(): Promise<boolean> {
  if (skuParsColumnsReady) return true;
  const sb = getServiceRoleClient();
  const { error } = await sb.from("vendor_items").select("par_step").limit(1);
  if (error) {
    if (!skuParsPendingLogged) {
      skuParsPendingLogged = true;
      console.warn(
        `[skus] cushion_class / par_step are DORMANT — migration 0182 (GATE M1) is not applied yet: ${error.message}`,
      );
    }
    return false;
  }
  skuParsColumnsReady = true;
  return true;
}

async function skuCols(): Promise<string> {
  return (await parsColumnsReady()) ? `${SKU_COLS}, ${SKU_PARS_COLS}` : SKU_COLS;
}

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
    eachContainerLabel: r.each_container_label,
    avgOzPerEach: toNum(r.avg_oz_per_each),
    itemNumber: r.item_number,
    sourceUrl: r.source_url,
    leadTimeDays: r.lead_time_days,
    weekdayPar: toNum(r.weekday_par),
    weekendPar: toNum(r.weekend_par),
    notes: r.notes,
    active: r.active ?? true, // nullable in DB → treat null as active
    skuClass: r.sku_class ?? "raw", // default to raw (matches the 0157 column default)
    // Absent (undefined) pre-0182, null post-0182-but-unauthored — both read as null.
    cushionClass: r.cushion_class ?? null,
    parStep: toNum(r.par_step ?? null),
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

  const cols = await skuCols();
  const rows = await selectAllRows<DbSkuRow>((from, to) => {
    let query = sb.from("vendor_items").select(cols);
    if (opts && "vendorId" in opts) {
      if (opts.vendorId === null) {
        query = query.is("vendor_id", null);
      } else if (typeof opts.vendorId === "string") {
        query = query.eq("vendor_id", opts.vendorId);
      }
    }
    return query
      .order("active", { ascending: false, nullsFirst: false })
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
      .returns<DbSkuRow[]>();
  });
  return hydrateSkus(rows);
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
export async function loadMeasureUnits(actor: AuthContext): Promise<MeasureUnitOption[]> {
  requireLevel(actor, SKU_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("measure_units")
    .select("id, label, dimension, to_base_factor")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("label", { ascending: true })
    .returns<Array<{ id: string; label: string; dimension: MeasureDimension; to_base_factor: number | string }>>();
  if (error) throw new Error(`loadMeasureUnits failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    dimension: r.dimension,
    toBaseFactor: Number(r.to_base_factor),
  }));
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
const MEASURE_DIMENSIONS: ReadonlySet<string> = new Set(["weight", "volume", "count"]);

export async function addMeasureUnit(
  actor: AuthContext,
  input: { label: string; dimension: string; toBaseFactor: number },
): Promise<MeasureUnitOption> {
  requireLevel(actor, SKU_REGISTRY_ADD_MIN);
  const label = input.label.trim();
  if (!label) throw new AdminSkuError(400, "invalid_label", "Label is required");
  if (!MEASURE_DIMENSIONS.has(input.dimension)) {
    throw new AdminSkuError(400, "invalid_dimension", "Dimension must be weight, volume, or count");
  }
  if (!Number.isFinite(input.toBaseFactor) || input.toBaseFactor <= 0) {
    throw new AdminSkuError(400, "invalid_factor", "Conversion factor must be a positive number");
  }
  const sb = getServiceRoleClient();
  const { data: existing, error: exErr } = await sb
    .from("measure_units")
    .select("id, label, dimension, to_base_factor, active")
    .eq("label", label)
    .maybeSingle<{ id: string; label: string; dimension: MeasureDimension; to_base_factor: number | string; active: boolean | null }>();
  if (exErr) throw new Error(`addMeasureUnit lookup failed: ${exErr.message}`);
  if (existing) {
    if (existing.active === false) {
      await sb.from("measure_units")
        .update({ active: true, dimension: input.dimension, to_base_factor: input.toBaseFactor, updated_by: actor.user.id, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return { id: existing.id, label: existing.label, dimension: existing.dimension, toBaseFactor: Number(existing.to_base_factor) };
  }
  const { data: maxRow } = await sb
    .from("measure_units").select("display_order").order("display_order", { ascending: false }).limit(1).maybeSingle<{ display_order: number }>();
  const nextOrder = (maxRow?.display_order ?? 0) + 1;
  const { data: inserted, error } = await sb
    .from("measure_units")
    .insert({ label, dimension: input.dimension, to_base_factor: input.toBaseFactor, display_order: nextOrder, created_by: actor.user.id, updated_by: actor.user.id })
    .select("id, label, dimension, to_base_factor")
    .maybeSingle<{ id: string; label: string; dimension: MeasureDimension; to_base_factor: number | string }>();
  if (error) throw new Error(`addMeasureUnit insert failed: ${error.message}`);
  if (!inserted) throw new Error("addMeasureUnit returned no row");
  return { id: inserted.id, label: inserted.label, dimension: inserted.dimension, toBaseFactor: Number(inserted.to_base_factor) };
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
  eachContainerLabel?: string | null;
  avgOzPerEach?: number | null;
  itemNumber?: string | null;
  sourceUrl?: string | null;
  leadTimeDays?: number | null;
  notes?: string | null;
  skuClass?: SkuClass | null;
  /**
   * Product this SKU is a member of (migration 0179). ABSENT (undefined) leaves
   * the column untouched — which is also what null means on a create, since NULL
   * is the column's own default and the implicit-singleton case. That absence is
   * load-bearing while migration 0179 is unapplied (GATE M1): a payload without
   * the key is byte-identical to today's insert.
   */
  productId?: string | null;
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
  if (input.skuClass != null && !isSkuClass(input.skuClass)) {
    throw new AdminSkuError(400, "invalid_sku_class", "Unknown SKU class");
  }

  const sb = getServiceRoleClient();
  const { data: inserted, error } = await sb
    .from("vendor_items")
    .insert({
      // product_id ONLY when a product was actually named: NULL is the column
      // default anyway, and omitting the key keeps this insert legal against a
      // schema where 0179 has not been applied yet.
      ...(input.productId ? { product_id: input.productId } : {}),
      vendor_id: input.vendorId ?? null,
      location_id: input.locationId ?? null,
      name,
      pack_format: packFormat,
      units_per_pack: unitsPerPack,
      each_size: eachSize,
      each_measure: normalizeOptional(input.eachMeasure),
      each_container_label: normalizeOptional(input.eachContainerLabel),
      avg_oz_per_each: normalizeAvgOzPerEach(input.avgOzPerEach),
      item_number: normalizeOptional(input.itemNumber),
      source_url: normalizeOptional(input.sourceUrl),
      lead_time_days: leadTimeDays,
      notes: normalizeOptional(input.notes),
      sku_class: input.skuClass ?? "raw",
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
      product_id: input.productId ?? null,
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
  eachContainerLabel?: string | null;
  avgOzPerEach?: number | null;
  itemNumber?: string | null;
  sourceUrl?: string | null;
  leadTimeDays?: number | null;
  weekdayPar?: number | null;
  weekendPar?: number | null;
  notes?: string | null;
  skuClass?: SkuClass;
  /** Product membership (0179). Absent = untouched; null = back to singleton. */
  productId?: string | null;
  /** Ordering rhythm (0182). Absent = untouched; null clears. The form OMITS both keys
   *  while the migration is unapplied, and updateSku refuses them loudly if one arrives
   *  anyway — a dropped write would be a silent failure. */
  cushionClass?: string | null;
  parStep?: number | null;
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
  if (changes.eachContainerLabel !== undefined) update.each_container_label = normalizeOptional(changes.eachContainerLabel);
  if (changes.avgOzPerEach !== undefined) update.avg_oz_per_each = normalizeAvgOzPerEach(changes.avgOzPerEach);
  if (changes.itemNumber !== undefined) update.item_number = normalizeOptional(changes.itemNumber);
  if (changes.sourceUrl !== undefined) update.source_url = normalizeOptional(changes.sourceUrl);
  if (changes.leadTimeDays !== undefined) update.lead_time_days = normalizeLeadTime(changes.leadTimeDays);
  if (changes.weekdayPar !== undefined) update.weekday_par = normalizePar(changes.weekdayPar, "weekday_par");
  if (changes.weekendPar !== undefined) update.weekend_par = normalizePar(changes.weekendPar, "weekend_par");
  if (changes.notes !== undefined) update.notes = normalizeOptional(changes.notes);
  if (changes.skuClass !== undefined) {
    if (!isSkuClass(changes.skuClass)) throw new AdminSkuError(400, "invalid_sku_class", "Unknown SKU class");
    update.sku_class = changes.skuClass;
  }
  // Membership (0179). Key-present null = detach back to implicit singleton; the
  // key is absent on every payload that predates the product picker, so an edit
  // made before migration 0179 lands never touches the column.
  if (changes.productId !== undefined) update.product_id = changes.productId;

  // Ordering rhythm (0182, GATE M1). Refuse LOUDLY rather than dropping the write: the
  // form omits these keys entirely while the columns are absent, so an arriving key means
  // a stale client or a hand-rolled request, and silently ignoring it would look like a
  // successful save that changed nothing.
  if (changes.cushionClass !== undefined || changes.parStep !== undefined) {
    if (!(await parsColumnsReady())) {
      throw new AdminSkuError(
        503,
        "pars_schema_pending",
        "Migration 0182 (GATE M1) has not been applied yet",
      );
    }
    if (changes.cushionClass !== undefined) update.cushion_class = normalizeCushionClass(changes.cushionClass);
    if (changes.parStep !== undefined) update.par_step = normalizeParStep(changes.parStep);
  }

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

// ── Per-location SKU overlay (VO-7; migration 0174) ────────────────────────────
//
// location_sku_settings carries the per-(location,sku) activation + par overrides
// the ordering walk resolves through lib/location-sku-shared.ts. Tri-state:
//   activeOverride null = inherit global / true = on here / false = off here
//   weekdayPar / weekendPar null = inherit the global vendor_items par
// Upsert-in-place keyed on the (location_id, sku_id) UNIQUE; revert-to-all-inherit
// nulls the three fields (append-only — the row is never DELETEd). GM+ (SKU write
// floor), Tier A at the route (mirrors a SKU edit). Rides vendor_item.update audit
// with metadata.scope: "location_settings" (parallels updateSku's vocabulary).

/** An existing overlay row as loaded per SKU, keyed for the editor tri-state. */
export interface LocationSkuSetting {
  locationId: string;
  activeOverride: boolean | null;
  weekdayPar: number | null;
  weekendPar: number | null;
}

interface DbLocationSkuSettingRow {
  location_id: string;
  active_override: boolean | null;
  weekday_par: number | string | null;
  weekend_par: number | string | null;
}

/** Batch-load overlay rows for a set of SKUs (≥6 read). Returns a map skuId →
 *  rows[]; a SKU absent from the map (or with an empty array) has no overlays. */
export async function loadLocationSkuSettings(
  actor: AuthContext,
  skuIds: string[],
): Promise<Map<string, LocationSkuSetting[]>> {
  requireLevel(actor, SKU_READ_MIN);
  const out = new Map<string, LocationSkuSetting[]>();
  const ids = [...new Set(skuIds.filter((s): s is string => typeof s === "string" && !!s))];
  if (ids.length === 0) return out;

  const sb = getServiceRoleClient();
  const rows = await selectAllRows<DbLocationSkuSettingRow & { sku_id: string }>((from, to) =>
    sb
      .from("location_sku_settings")
      .select("sku_id, location_id, active_override, weekday_par, weekend_par")
      .in("sku_id", ids)
      .range(from, to)
      .returns<Array<DbLocationSkuSettingRow & { sku_id: string }>>(),
  );
  for (const r of rows) {
    const arr = out.get(r.sku_id) ?? [];
    arr.push({
      locationId: r.location_id,
      activeOverride: r.active_override,
      weekdayPar: toNum(r.weekday_par),
      weekendPar: toNum(r.weekend_par),
    });
    out.set(r.sku_id, arr);
  }
  return out;
}

export interface UpsertLocationSkuSettingsInput {
  skuId: string;
  locationId: string;
  /** null = inherit global active / true = on here / false = off here. */
  activeOverride: boolean | null;
  /** null = inherit global par. */
  weekdayPar: number | null;
  weekendPar: number | null;
}

/**
 * Insert-or-update the (location, sku) overlay row (GM+). Any non-inherit value
 * upserts; a revert-to-all-inherit (all three null) nulls the fields on an existing
 * row (never a delete — append-only). Idempotent on the (location_id, sku_id)
 * UNIQUE. normalizePar reused for the pars; activeOverride tri-state validated.
 */
export async function upsertLocationSkuSettings(
  actor: AuthContext,
  input: UpsertLocationSkuSettingsInput,
): Promise<void> {
  requireLevel(actor, SKU_WRITE_MIN);

  if (input.activeOverride !== null && typeof input.activeOverride !== "boolean") {
    throw new AdminSkuError(400, "invalid_active_override", "Active override must be true, false, or null");
  }
  const weekdayPar = normalizePar(input.weekdayPar, "weekday_par");
  const weekendPar = normalizePar(input.weekendPar, "weekend_par");
  const activeOverride = input.activeOverride;

  // The SKU + location must both exist + be valid (the SKU can be inactive globally —
  // a promotional per-location ON is a legitimate override — so no active filter on
  // the SKU; the location must be active, matching assertLocationActive).
  const sb = getServiceRoleClient();
  const { data: sku, error: sErr } = await sb
    .from("vendor_items")
    .select("id")
    .eq("id", input.skuId)
    .maybeSingle<{ id: string }>();
  if (sErr) throw new Error(`upsertLocationSkuSettings sku check failed: ${sErr.message}`);
  if (!sku) throw new AdminSkuError(404, "sku_not_found", "SKU not found");
  await assertLocationActive(input.locationId);

  // Find the existing (location, sku) row (the UNIQUE guarantees at most one). The two par
  // columns come back too: a slot is "directly edited" only when its VALUE CHANGED, and
  // that is what clears a pin (r3 — a resubmit of the same number is not an edit).
  const { data: existing, error: exErr } = await sb
    .from("location_sku_settings")
    .select("id, weekday_par, weekend_par")
    .eq("location_id", input.locationId)
    .eq("sku_id", input.skuId)
    .maybeSingle<{ id: string; weekday_par: number | string | null; weekend_par: number | string | null }>();
  if (exErr) throw new Error(`upsertLocationSkuSettings lookup failed: ${exErr.message}`);

  // ── THE MACHINE LANE, THROUGH THE ONE AUTHORITY (Dynamic Pars, Task 3.8) ──────
  //
  // THE AUTO COLUMNS ARE STRUCTURALLY UNREACHABLE FROM THE OPERATOR (r3's machine-lane
  // bypass). This function's payload is an explicit field list that names only
  // active_override and the two HUMAN par columns — there is no route by which a caller
  // can set an auto value. What the operator's edit DOES to the machine's lane is decided
  // by `parWriteColumns({ kind: "admin", … })` in the pure core, the same function the
  // walker's accept/revert and the (dark) machine writer resolve their columns through:
  // for kind "admin" every auto value it returns is NULL, for every input.
  //
  // WHY THE COLUMN HALF AND NOT THE ASYNC AUTHORITY. This function owns a row the walker
  // lanes do not: it writes `active_override` and BOTH par slots in one upsert and must
  // decide insert-vs-update. Delegating to the per-slot async writer would mean up to
  // three UPDATEs racing on one row and three `vendor_item.update` audit rows for one
  // edit. r3 asks that ONE PLACE DECIDE what a par write does to the machine lane, the
  // baseline and the pin — that place is parWriteColumns, and it decides for both callers.
  //
  // Probe-gated: pre-0183 the auto columns do not exist, so the payload is byte-identical
  // to the one this function shipped with.
  const autoLaneReady = await parAutoLaneReady(sb);
  const editedSlots: DayClass[] = [];
  if (weekdayPar !== toNum(existing?.weekday_par ?? null)) editedSlots.push("weekday");
  if (weekendPar !== toNum(existing?.weekend_par ?? null)) editedSlots.push("weekend");
  const autoPatch: Record<string, number | string | null> = {};
  if (autoLaneReady) {
    for (const dayClass of editedSlots) {
      // r3: a human blanking their own override also NULLS the auto column on that slot —
      // blank-to-global must not resurrect a stale machine number the human never saw.
      const effect = parWriteColumns({
        kind: "admin",
        dayClass,
        value: dayClass === "weekend" ? weekendPar : weekdayPar,
      });
      Object.assign(autoPatch, effect.autoLane);
    }
  }

  const payloadFields = {
    active_override: activeOverride,
    weekday_par: weekdayPar,
    weekend_par: weekendPar,
    ...autoPatch,
    updated_by: actor.user.id,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    // Update-in-place — a revert-to-all-inherit nulls the three fields, keeping the
    // row (never delete; append-only).
    const { error, count } = await sb
      .from("location_sku_settings")
      .update(payloadFields, { count: "exact" })
      .eq("id", existing.id);
    if (error) throw new Error(`upsertLocationSkuSettings update failed: ${error.message}`);
    if (count === 0) throw new AdminSkuError(404, "sku_not_found", "Overlay row vanished");
  } else {
    // Insert only when there's something to store — a first write that's all-inherit
    // is a no-op (nothing overrides the global; no row needed).
    if (activeOverride === null && weekdayPar === null && weekendPar === null) return;
    const { error } = await sb
      .from("location_sku_settings")
      .insert({ location_id: input.locationId, sku_id: input.skuId, ...payloadFields });
    if (error) throw new Error(`upsertLocationSkuSettings insert failed: ${error.message}`);
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor_item.update",
    resourceTable: "vendor_items",
    resourceId: input.skuId,
    metadata: {
      scope: "location_settings",
      location_id: input.locationId,
      active_override: activeOverride,
      weekday_par: weekdayPar,
      weekend_par: weekendPar,
      // Which slots the human DIRECTLY edited — the grain that clears a pin (r3).
      edited_slots: editedSlots,
      cleared_auto_slots: autoLaneReady ? editedSlots : [],
    },
    ipAddress: null,
    userAgent: null,
  });
}
