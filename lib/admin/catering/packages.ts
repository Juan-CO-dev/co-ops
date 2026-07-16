/**
 * Admin catering-KB packages data layer (Catering KB — Wave 1, slice 1A).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level floor → assertStepUp)
 * AND re-checked here per-action (defense in depth; the lib is the authority).
 * Service-role bypasses RLS by design, consistent with lib/admin/vendors.ts and
 * lib/admin/skus.ts.
 *
 * Append-only: removals flip `active=false`, never DELETE (both the package and
 * its line items).
 *
 * Schema (live):
 *   catering_packages       — location_id (NULLABLE FK→locations — null = GLOBAL,
 *                             set = per-location), slug (system key, kebab),
 *                             label_en/label_es + description_en/description_es
 *                             (paired display columns), pricing_mode
 *                             (per_head|per_platter|fixed CHECK), price_cents (int
 *                             >= 0), min_headcount (int > 0 or null), lead_time_hours
 *                             (int >= 0 or null), active, display_order, audit.
 *                             NOTE: there is NO DB unique index on (location_id,
 *                             slug) — the one-active-per-(location,slug) rule is
 *                             enforced app-layer (query-first, reactivate-or-reject
 *                             → package_exists).
 *   catering_package_items  — package_id FK, item_id (nullable FK→items),
 *                             menu_item_id (nullable FK→menu_items), CHECK
 *                             exactly-not-both, description (text), quantity
 *                             (numeric > 0 CHECK), display_order, active,
 *                             created_by, created_at. No updated_* columns.
 *
 * LINE ITEMS ARE FREEFORM FOR NOW: the sale layer (menu_items / items) is empty,
 * so line items carry description + quantity only and leave item_id/menu_item_id
 * null. Spine-linking (picking a real item_id/menu_item_id) lands when the menu is
 * authored — until then the CHECK (both-null allowed) accepts the freeform rows.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

// ── Authority floors (the lib is the authority per-action) ──────────────────
export const PACKAGE_READ_MIN = 6; // catering_mgr/AGM+ — view the KB
export const PACKAGE_WRITE_MIN = 6; // catering.kb.packages.write — create/edit/deactivate + line items
/** Level 7+ (GM/MoO/Owner/CGS) see all locations; below that, own locations + globals. */
const ALL_LOCATIONS_MIN = 9; // Owner+ see every location's packages (per the brief)

const PRICING_MODES = ["per_head", "per_platter", "fixed"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

// ── Types ───────────────────────────────────────────────────────────────────
export interface PackageLineItemView {
  id: string;
  /** Freeform line for now — item_id/menu_item_id stay null until the menu is authored. */
  itemId: string | null;
  menuItemId: string | null;
  description: string | null;
  quantity: number;
  displayOrder: number;
}

export interface PackageView {
  id: string;
  locationId: string | null; // null = global
  locationName: string | null;
  slug: string;
  labelEn: string;
  labelEs: string | null;
  descriptionEn: string | null;
  descriptionEs: string | null;
  pricingMode: PricingMode;
  priceCents: number;
  minHeadcount: number | null;
  leadTimeHours: number | null;
  active: boolean;
  displayOrder: number;
  lineItems: PackageLineItemView[];
}

/** A location option for the create form's optional per-location select. */
export interface PackageLocationOption {
  id: string;
  name: string;
}

/** Typed error the routes map to jsonError(status, code). Mirrors AdminVendorError. */
export class AdminCateringError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminCateringError";
  }
}

// ── Internal guards / helpers ────────────────────────────────────────────────
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new AdminCateringError(403, "forbidden", "Insufficient role level for this action");
  }
}

function normalizeOptional(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t || null;
}

/** Derive a stable kebab slug from a label: lowercase, strip non-alphanumerics,
 *  collapse runs to single hyphens. The slug is the system key — NEVER translated
 *  or matched on the label. */
export function slugifyPackage(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new AdminCateringError(400, "invalid_slug", "Slug is empty after normalization");
  return slug;
}

/** price_cents: integer >= 0. */
function normalizePriceCents(v: number | null | undefined): number {
  if (v === null || v === undefined || !Number.isInteger(v) || v < 0) {
    throw new AdminCateringError(400, "invalid_price", "Price must be a non-negative integer (cents)");
  }
  return v;
}

/** min_headcount: null clears; a value must be a positive integer (DB CHECK > 0). */
function normalizeMinHeadcount(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v < 1) {
    throw new AdminCateringError(400, "invalid_headcount", "Minimum headcount must be a positive integer");
  }
  return v;
}

/** lead_time_hours: null clears; a value must be a non-negative integer (DB CHECK >= 0). */
function normalizeLeadTimeHours(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v < 0) {
    throw new AdminCateringError(400, "invalid_headcount", "Lead time must be a non-negative integer (hours)");
  }
  return v;
}

function assertPricingMode(mode: unknown): PricingMode {
  if (typeof mode !== "string" || !(PRICING_MODES as readonly string[]).includes(mode)) {
    throw new AdminCateringError(400, "invalid_mode", "Pricing mode must be per_head, per_platter, or fixed");
  }
  return mode as PricingMode;
}

/** quantity: a positive number (DB CHECK > 0). */
function normalizeQuantity(v: number | null | undefined): number {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) {
    throw new AdminCateringError(400, "invalid_payload", "Quantity must be a positive number");
  }
  return v;
}

/** Verify a location id exists AND is active, else invalid_presence. */
async function assertLocationActive(locationId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`assertLocationActive failed: ${error.message}`);
  if (!data) throw new AdminCateringError(400, "invalid_presence", "Location not found or inactive");
}

/** The set of location ids the actor may see (own user_locations), or null when
 *  the actor is level 9+ (all locations). Globals (location_id null) are always
 *  visible regardless. */
function visibleLocationScope(actor: AuthContext): string[] | null {
  if (getRoleLevel(actor.user.role) >= ALL_LOCATIONS_MIN) return null;
  return actor.locations ?? [];
}

interface DbPackageRow {
  id: string;
  location_id: string | null;
  slug: string;
  label_en: string;
  label_es: string | null;
  description_en: string | null;
  description_es: string | null;
  pricing_mode: string;
  price_cents: number;
  min_headcount: number | null;
  lead_time_hours: number | null;
  active: boolean | null;
  display_order: number;
}

interface DbLineItemRow {
  id: string;
  package_id: string;
  item_id: string | null;
  menu_item_id: string | null;
  description: string | null;
  quantity: number | string; // numeric arrives as string from PostgREST
  display_order: number;
}

const PACKAGE_COLS =
  "id, location_id, slug, label_en, label_es, description_en, description_es, pricing_mode, price_cents, min_headcount, lead_time_hours, active, display_order";

function toQty(v: number | string): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

// ── Reads ─────────────────────────────────────────────────────────────────────
/** Hydrate locationName + active line items via two-step batch loads (avoid
 *  fragile embedded-select filters per the PostgREST RLS-interaction lesson). */
async function hydratePackages(rows: DbPackageRow[]): Promise<PackageView[]> {
  if (rows.length === 0) return [];
  const sb = getServiceRoleClient();

  const locationIds = [...new Set(rows.map((r) => r.location_id).filter((v): v is string => v !== null))];
  const locationNameById = new Map<string, string>();
  if (locationIds.length > 0) {
    const { data, error } = await sb
      .from("locations")
      .select("id, name")
      .in("id", locationIds)
      .returns<Array<{ id: string; name: string }>>();
    if (error) throw new Error(`hydratePackages locations failed: ${error.message}`);
    for (const l of data ?? []) locationNameById.set(l.id, l.name);
  }

  const packageIds = rows.map((r) => r.id);
  const { data: itemRows, error: itemErr } = await sb
    .from("catering_package_items")
    .select("id, package_id, item_id, menu_item_id, description, quantity, display_order")
    .in("package_id", packageIds)
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<DbLineItemRow[]>();
  if (itemErr) throw new Error(`hydratePackages line items failed: ${itemErr.message}`);

  const itemsByPackage = new Map<string, PackageLineItemView[]>();
  for (const it of itemRows ?? []) {
    const arr = itemsByPackage.get(it.package_id) ?? [];
    arr.push({
      id: it.id,
      itemId: it.item_id,
      menuItemId: it.menu_item_id,
      description: it.description,
      quantity: toQty(it.quantity),
      displayOrder: it.display_order,
    });
    itemsByPackage.set(it.package_id, arr);
  }

  return rows.map((r) => ({
    id: r.id,
    locationId: r.location_id,
    locationName: r.location_id ? locationNameById.get(r.location_id) ?? null : null,
    slug: r.slug,
    labelEn: r.label_en,
    labelEs: r.label_es,
    descriptionEn: r.description_en,
    descriptionEs: r.description_es,
    pricingMode: (PRICING_MODES as readonly string[]).includes(r.pricing_mode)
      ? (r.pricing_mode as PricingMode)
      : "fixed",
    priceCents: r.price_cents,
    minHeadcount: r.min_headcount,
    leadTimeHours: r.lead_time_hours,
    active: r.active ?? true,
    displayOrder: r.display_order,
    lineItems: itemsByPackage.get(r.id) ?? [],
  }));
}

/**
 * Load packages the actor can see (≥6). Level 9+ sees ALL locations' packages;
 * below that, the actor's own user_locations PLUS globals (location_id null).
 * Returns active first, then display_order, then label.
 */
export async function loadPackages(actor: AuthContext): Promise<PackageView[]> {
  requireLevel(actor, PACKAGE_READ_MIN);
  const sb = getServiceRoleClient();

  const scope = visibleLocationScope(actor);
  let query = sb.from("catering_packages").select(PACKAGE_COLS);
  if (scope !== null) {
    // Own locations OR global (location_id null). PostgREST `.or()` with an
    // `in.(...)` list plus `is.null`.
    const idList = scope.length > 0 ? scope.join(",") : "";
    query = idList
      ? query.or(`location_id.in.(${idList}),location_id.is.null`)
      : query.is("location_id", null);
  }
  const { data, error } = await query
    .order("active", { ascending: false, nullsFirst: false })
    .order("display_order", { ascending: true })
    .order("label_en", { ascending: true })
    .returns<DbPackageRow[]>();
  if (error) throw new Error(`loadPackages failed: ${error.message}`);
  return hydratePackages(data ?? []);
}

/** Active locations for the create form's optional per-location select (≥6). */
export async function loadPackageLocations(actor: AuthContext): Promise<PackageLocationOption[]> {
  requireLevel(actor, PACKAGE_READ_MIN);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("locations")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<PackageLocationOption[]>();
  if (error) throw new Error(`loadPackageLocations failed: ${error.message}`);
  return data ?? [];
}

/** Load a package row (id + slug + location + active) or throw 404. */
async function requirePackageRow(
  id: string,
): Promise<{ id: string; slug: string; location_id: string | null; active: boolean | null }> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_packages")
    .select("id, slug, location_id, active")
    .eq("id", id)
    .maybeSingle<{ id: string; slug: string; location_id: string | null; active: boolean | null }>();
  if (error) throw new Error(`requirePackageRow failed: ${error.message}`);
  if (!data) throw new AdminCateringError(404, "not_found", "Package not found");
  return data;
}

// ── Create (Tier B; reactivate-or-reject on a colliding active slug) ──────────
export interface CreatePackageInput {
  locationId: string | null; // null = global
  labelEn: string;
  labelEs?: string | null;
  descriptionEn?: string | null;
  descriptionEs?: string | null;
  pricingMode: string;
  priceCents: number;
  minHeadcount?: number | null;
  leadTimeHours?: number | null;
}

export async function createPackage(
  actor: AuthContext,
  input: CreatePackageInput,
): Promise<{ id: string; slug: string }> {
  requireLevel(actor, PACKAGE_WRITE_MIN);

  const labelEn = input.labelEn?.trim() ?? "";
  if (!labelEn) throw new AdminCateringError(400, "invalid_label", "Package name is required");
  const slug = slugifyPackage(labelEn);
  const pricingMode = assertPricingMode(input.pricingMode);
  const priceCents = normalizePriceCents(input.priceCents);
  const minHeadcount = normalizeMinHeadcount(input.minHeadcount);
  const leadTimeHours = normalizeLeadTimeHours(input.leadTimeHours);
  const locationId = input.locationId ?? null;
  if (locationId !== null) await assertLocationActive(locationId);

  const sb = getServiceRoleClient();

  // One-active-per-(location, slug): there is NO DB unique index, so query first.
  // A colliding ACTIVE row → reject (package_exists). A colliding INACTIVE row →
  // reactivate it (append-only friendly) rather than inserting a duplicate.
  let existingQuery = sb
    .from("catering_packages")
    .select("id, active")
    .eq("slug", slug);
  existingQuery = locationId === null
    ? existingQuery.is("location_id", null)
    : existingQuery.eq("location_id", locationId);
  const { data: existing, error: exErr } = await existingQuery.maybeSingle<{ id: string; active: boolean | null }>();
  if (exErr) throw new Error(`createPackage dup check failed: ${exErr.message}`);
  if (existing) {
    if (existing.active !== false) {
      throw new AdminCateringError(409, "package_exists", "An active package with that key already exists here");
    }
    // Reactivate + overwrite the display fields with the new create payload.
    const { error: rErr } = await sb
      .from("catering_packages")
      .update({
        active: true,
        label_en: labelEn,
        label_es: normalizeOptional(input.labelEs),
        description_en: normalizeOptional(input.descriptionEn),
        description_es: normalizeOptional(input.descriptionEs),
        pricing_mode: pricingMode,
        price_cents: priceCents,
        min_headcount: minHeadcount,
        lead_time_hours: leadTimeHours,
        updated_by: actor.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (rErr) throw new Error(`createPackage reactivate failed: ${rErr.message}`);

    await audit({
      actorId: actor.user.id,
      actorRole: actor.user.role,
      action: "catering.kb.packages.create",
      resourceTable: "catering_packages",
      resourceId: existing.id,
      metadata: { slug, location_id: locationId, reactivated: true },
      ipAddress: null,
      userAgent: null,
    });
    return { id: existing.id, slug };
  }

  // display_order = max + 1 within the (location) scope.
  let maxQuery = sb.from("catering_packages").select("display_order");
  maxQuery = locationId === null ? maxQuery.is("location_id", null) : maxQuery.eq("location_id", locationId);
  const { data: maxRow, error: mErr } = await maxQuery
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mErr) throw new Error(`createPackage max order failed: ${mErr.message}`);
  const displayOrder = (maxRow?.display_order ?? -1) + 1;

  const { data: inserted, error: iErr } = await sb
    .from("catering_packages")
    .insert({
      location_id: locationId,
      slug,
      label_en: labelEn,
      label_es: normalizeOptional(input.labelEs),
      description_en: normalizeOptional(input.descriptionEn),
      description_es: normalizeOptional(input.descriptionEs),
      pricing_mode: pricingMode,
      price_cents: priceCents,
      min_headcount: minHeadcount,
      lead_time_hours: leadTimeHours,
      active: true,
      display_order: displayOrder,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) throw new Error(`createPackage insert failed: ${iErr.message}`);
  if (!inserted) throw new Error("createPackage insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.packages.create",
    resourceTable: "catering_packages",
    resourceId: inserted.id,
    metadata: { slug, location_id: locationId, pricing_mode: pricingMode, price_cents: priceCents },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id, slug };
}

// ── Update package fields (Tier A) ─────────────────────────────────────────────
// slug is the system key and is NOT editable here (changing it would break the
// one-active-per-(location,slug) identity); label_en/label_es + description_en/es
// are the paired display columns the edit form exposes and saves atomically.
export interface UpdatePackageChanges {
  labelEn?: string;
  labelEs?: string | null;
  descriptionEn?: string | null;
  descriptionEs?: string | null;
  pricingMode?: string;
  priceCents?: number;
  minHeadcount?: number | null;
  leadTimeHours?: number | null;
}

export async function updatePackage(
  actor: AuthContext,
  args: { id: string; changes: UpdatePackageChanges },
): Promise<void> {
  requireLevel(actor, PACKAGE_WRITE_MIN);
  await requirePackageRow(args.id);

  const { changes } = args;
  const update: Record<string, unknown> = {};
  if (changes.labelEn !== undefined) {
    const n = changes.labelEn.trim();
    if (!n) throw new AdminCateringError(400, "invalid_label", "Package name cannot be empty");
    update.label_en = n;
  }
  if (changes.labelEs !== undefined) update.label_es = normalizeOptional(changes.labelEs);
  if (changes.descriptionEn !== undefined) update.description_en = normalizeOptional(changes.descriptionEn);
  if (changes.descriptionEs !== undefined) update.description_es = normalizeOptional(changes.descriptionEs);
  if (changes.pricingMode !== undefined) update.pricing_mode = assertPricingMode(changes.pricingMode);
  if (changes.priceCents !== undefined) update.price_cents = normalizePriceCents(changes.priceCents);
  if (changes.minHeadcount !== undefined) update.min_headcount = normalizeMinHeadcount(changes.minHeadcount);
  if (changes.leadTimeHours !== undefined) update.lead_time_hours = normalizeLeadTimeHours(changes.leadTimeHours);

  if (Object.keys(update).length === 0) return;
  update.updated_by = actor.user.id;
  update.updated_at = new Date().toISOString();

  const sb = getServiceRoleClient();
  const { error, count } = await sb
    .from("catering_packages")
    .update(update, { count: "exact" })
    .eq("id", args.id);
  if (error) throw new Error(`updatePackage failed: ${error.message}`);
  if (count === 0) throw new AdminCateringError(404, "not_found", "Package not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.packages.update",
    resourceTable: "catering_packages",
    resourceId: args.id,
    metadata: { fields: Object.keys(update).filter((k) => k !== "updated_by" && k !== "updated_at") },
    ipAddress: null,
    userAgent: null,
  });
}

// ── Deactivate / reactivate (Tier B; append-only) ───────────────────────────────
export async function deactivatePackage(
  actor: AuthContext,
  args: { id: string; active: boolean },
): Promise<void> {
  requireLevel(actor, PACKAGE_WRITE_MIN);
  const row = await requirePackageRow(args.id);

  // Reactivating: guard against a live one-active-per-(location,slug) collision.
  if (args.active && row.active === false) {
    const sb = getServiceRoleClient();
    let collideQuery = sb
      .from("catering_packages")
      .select("id")
      .eq("slug", row.slug)
      .eq("active", true)
      .neq("id", args.id);
    collideQuery = row.location_id === null
      ? collideQuery.is("location_id", null)
      : collideQuery.eq("location_id", row.location_id);
    const { data: collide, error: cErr } = await collideQuery.maybeSingle<{ id: string }>();
    if (cErr) throw new Error(`deactivatePackage collision check failed: ${cErr.message}`);
    if (collide) throw new AdminCateringError(409, "package_exists", "An active package with that key already exists here");
  }

  const sb = getServiceRoleClient();
  const { error, count } = await sb
    .from("catering_packages")
    .update(
      { active: args.active, updated_by: actor.user.id, updated_at: new Date().toISOString() },
      { count: "exact" },
    )
    .eq("id", args.id);
  if (error) throw new Error(`deactivatePackage failed: ${error.message}`);
  if (count === 0) throw new AdminCateringError(404, "not_found", "Package not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: args.active ? "catering.kb.packages.activate" : "catering.kb.packages.deactivate",
    resourceTable: "catering_packages",
    resourceId: args.id,
    metadata: {},
    ipAddress: null,
    userAgent: null,
  });
}

// ── Line items (Tier A; FREEFORM for now — description + quantity only) ─────────
// item_id / menu_item_id stay null until the menu is authored (the CHECK allows
// both-null). Spine-linking lands as a follow-up when menu_items/items are real.
export async function addPackageLineItem(
  actor: AuthContext,
  args: { packageId: string; description: string; quantity: number },
): Promise<{ id: string }> {
  requireLevel(actor, PACKAGE_WRITE_MIN);
  await requirePackageRow(args.packageId);

  const description = normalizeOptional(args.description);
  if (!description) throw new AdminCateringError(400, "invalid_payload", "Line item description is required");
  const quantity = normalizeQuantity(args.quantity);

  const sb = getServiceRoleClient();
  const { data: maxRow, error: mErr } = await sb
    .from("catering_package_items")
    .select("display_order")
    .eq("package_id", args.packageId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mErr) throw new Error(`addPackageLineItem max order failed: ${mErr.message}`);
  const displayOrder = (maxRow?.display_order ?? -1) + 1;

  const { data: inserted, error: iErr } = await sb
    .from("catering_package_items")
    .insert({
      package_id: args.packageId,
      // Freeform: leave the spine FKs null until the menu is authored.
      item_id: null,
      menu_item_id: null,
      description,
      quantity,
      display_order: displayOrder,
      active: true,
      created_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) throw new Error(`addPackageLineItem insert failed: ${iErr.message}`);
  if (!inserted) throw new Error("addPackageLineItem insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.packages.line_item_add",
    resourceTable: "catering_package_items",
    resourceId: inserted.id,
    metadata: { package_id: args.packageId, description, quantity },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id };
}

/** Load a line-item row (id + package) or throw 404. */
async function requireLineItemRow(itemId: string): Promise<{ id: string; package_id: string }> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_package_items")
    .select("id, package_id")
    .eq("id", itemId)
    .maybeSingle<{ id: string; package_id: string }>();
  if (error) throw new Error(`requireLineItemRow failed: ${error.message}`);
  if (!data) throw new AdminCateringError(404, "not_found", "Line item not found");
  return data;
}

/** Remove a line item — append-only: flip active=false, never DELETE. Tier A. */
export async function removePackageLineItem(
  actor: AuthContext,
  args: { itemId: string },
): Promise<void> {
  requireLevel(actor, PACKAGE_WRITE_MIN);
  const row = await requireLineItemRow(args.itemId);

  const sb = getServiceRoleClient();
  const { error, count } = await sb
    .from("catering_package_items")
    .update({ active: false }, { count: "exact" })
    .eq("id", args.itemId)
    .eq("active", true);
  if (error) throw new Error(`removePackageLineItem failed: ${error.message}`);
  if (count === 0) throw new AdminCateringError(404, "not_found", "Line item not found or already removed");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.packages.line_item_remove",
    resourceTable: "catering_package_items",
    resourceId: args.itemId,
    metadata: { package_id: row.package_id },
    ipAddress: null,
    userAgent: null,
  });
}
