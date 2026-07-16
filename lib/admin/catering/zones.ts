/**
 * Admin Catering Delivery Zones data layer (Wave 1 slice 1A — zones editor).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level floor → assertStepUp)
 * AND re-checked here per-action (defense in depth; the lib is the authority).
 * Service-role bypasses RLS by design, consistent with lib/admin/vendors.ts and
 * lib/admin/skus.ts.
 *
 * Append-only: removals flip `active=false`, never DELETE.
 *
 * Schema (catering_delivery_zones, migration 0117):
 *   id, location_id (uuid NOT NULL), slug, label_en, label_es, fee_cents
 *   (integer ≥ 0), min_order_cents (integer ≥ 0, nullable), active,
 *   display_order, created_by, updated_by, created_at, updated_at.
 *   Partial unique index: one ACTIVE row per (location_id, slug).
 *
 * slug is derived from label_en (lowercase kebab, truncated to 80 chars) and is
 * the system key — NEVER translate or match on the labels. Colliding active
 * slug within a location throws zone_exists.
 *
 * PER-LOCATION editor: zones group by location. Level ≥ 9 sees all locations;
 * below that, only the actor's user_locations assignments (actor.locations).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

// ── Authority floors (the lib is the authority per-action) ──────────────────
// catering.kb.delivery_zones.write = 7 (GM+) — fee config.
const ZONE_READ_MIN = 7;  // GM+ — view the per-location zone lists
const ZONE_WRITE_MIN = 7; // GM+ — create (Tier B) / edit fee+labels (Tier A) / deactivate (Tier B)

// ── Typed error ─────────────────────────────────────────────────────────────
export class AdminCateringError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminCateringError";
  }
}

// ── Internal guards ──────────────────────────────────────────────────────────
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

/** fee_cents: must be an integer ≥ 0 (money is integer cents). */
function validateFeeCents(v: number): number {
  if (!Number.isInteger(v) || v < 0) {
    throw new AdminCateringError(400, "invalid_fee", "Fee must be a non-negative integer (cents)");
  }
  return v;
}

/** min_order_cents: null clears; a value must be an integer ≥ 0 (cents). */
function validateMinOrderCents(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v < 0) {
    throw new AdminCateringError(400, "invalid_price", "Minimum order must be a non-negative integer (cents)");
  }
  return v;
}

/**
 * Derive the stable slug from label_en: trim, lowercase, replace
 * non-alphanumeric runs with hyphens, collapse, strip leading/trailing
 * hyphens, truncate to 80 chars. Mirrors lib/admin/catering/faq.ts.
 */
export function slugifyZoneLabel(labelEn: string): string {
  const slug = labelEn
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) throw new AdminCateringError(400, "invalid_slug", "Label is empty after slugify");
  return slug;
}

/**
 * Verify the target location exists + is active AND the actor may operate in
 * it (level ≥ 9 = all locations; below that, user_locations assignment).
 * The write-target guard: every create/edit/deactivate re-checks this.
 */
async function requireAccessibleLocation(actor: AuthContext, locationId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`requireAccessibleLocation failed: ${error.message}`);
  if (!data) throw new AdminCateringError(400, "invalid_payload", "Location not found or inactive");
  if (!lockLocationContext({ role: actor.user.role, locations: actor.locations }, locationId)) {
    throw new AdminCateringError(403, "forbidden", "Location is outside your assignments");
  }
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface ZoneView {
  id: string;
  locationId: string;
  slug: string;
  labelEn: string;
  labelEs: string | null;
  feeCents: number;
  minOrderCents: number | null;
  active: boolean;
  displayOrder: number;
}

/** One location's zones (the per-location group the editor renders). */
export interface ZoneLocationGroup {
  locationId: string;
  name: string;
  code: string;
  zones: ZoneView[];
}

interface DbZoneRow {
  id: string;
  location_id: string;
  slug: string;
  label_en: string;
  label_es: string | null;
  fee_cents: number;
  min_order_cents: number | null;
  active: boolean | null;
  display_order: number;
}

const ZONE_COLS =
  "id, location_id, slug, label_en, label_es, fee_cents, min_order_cents, active, display_order";

function rowToView(r: DbZoneRow): ZoneView {
  return {
    id: r.id,
    locationId: r.location_id,
    slug: r.slug,
    labelEn: r.label_en,
    labelEs: r.label_es,
    feeCents: r.fee_cents,
    minOrderCents: r.min_order_cents,
    active: r.active ?? true,
    displayOrder: r.display_order,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * Load zones grouped by location the actor can access (≥7). Level ≥ 9 sees
 * every active location; below that only the actor's user_locations
 * assignments. Zones order: active first, then display_order, then label_en.
 */
export async function loadZoneGroups(actor: AuthContext): Promise<ZoneLocationGroup[]> {
  requireLevel(actor, ZONE_READ_MIN);
  const sb = getServiceRoleClient();

  const { data: locRows, error: lErr } = await sb
    .from("locations")
    .select("id, name, code")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; code: string }>>();
  if (lErr) throw new Error(`loadZoneGroups locations failed: ${lErr.message}`);

  const accessible = (locRows ?? []).filter((l) =>
    lockLocationContext({ role: actor.user.role, locations: actor.locations }, l.id),
  );
  if (accessible.length === 0) return [];

  const { data: zoneRows, error: zErr } = await sb
    .from("catering_delivery_zones")
    .select(ZONE_COLS)
    .in("location_id", accessible.map((l) => l.id))
    .order("active", { ascending: false, nullsFirst: false })
    .order("display_order", { ascending: true })
    .order("label_en", { ascending: true })
    .returns<DbZoneRow[]>();
  if (zErr) throw new Error(`loadZoneGroups zones failed: ${zErr.message}`);

  const byLocation = new Map<string, ZoneView[]>();
  for (const r of zoneRows ?? []) {
    const arr = byLocation.get(r.location_id) ?? [];
    arr.push(rowToView(r));
    byLocation.set(r.location_id, arr);
  }

  return accessible.map((l) => ({
    locationId: l.id,
    name: l.name,
    code: l.code,
    zones: byLocation.get(l.id) ?? [],
  }));
}

// ── Create (GM+ ≥7; Tier B step-up at route) ─────────────────────────────────
export interface CreateZoneInput {
  locationId: string;
  labelEn: string;
  labelEs?: string | null;
  feeCents: number;
  minOrderCents?: number | null;
}

export async function createZone(
  actor: AuthContext,
  input: CreateZoneInput,
): Promise<{ id: string; slug: string }> {
  requireLevel(actor, ZONE_WRITE_MIN);

  const labelEn = input.labelEn.trim();
  if (!labelEn) throw new AdminCateringError(400, "invalid_label", "label_en cannot be empty");
  const slug = slugifyZoneLabel(labelEn);
  const labelEs = normalizeOptional(input.labelEs);
  const feeCents = validateFeeCents(input.feeCents);
  const minOrderCents = validateMinOrderCents(input.minOrderCents);

  await requireAccessibleLocation(actor, input.locationId);

  const sb = getServiceRoleClient();

  // Dup-guard: one ACTIVE row per (location_id, slug) — mirrors the partial
  // unique index so the caller gets a typed 409 instead of a constraint 500.
  const { data: existing, error: eErr } = await sb
    .from("catering_delivery_zones")
    .select("id")
    .eq("location_id", input.locationId)
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (eErr) throw new Error(`createZone dup check failed: ${eErr.message}`);
  if (existing) throw new AdminCateringError(409, "zone_exists", "An active zone with that key already exists for this location");

  // display_order = max active at this location + 1.
  const { data: maxRow, error: mErr } = await sb
    .from("catering_delivery_zones")
    .select("display_order")
    .eq("location_id", input.locationId)
    .eq("active", true)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mErr) throw new Error(`createZone max order failed: ${mErr.message}`);
  const displayOrder = (maxRow?.display_order ?? 0) + 1;

  const { data: inserted, error: iErr } = await sb
    .from("catering_delivery_zones")
    .insert({
      location_id: input.locationId,
      slug,
      label_en: labelEn,
      label_es: labelEs,
      fee_cents: feeCents,
      min_order_cents: minOrderCents,
      active: true,
      display_order: displayOrder,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) throw new Error(`createZone insert failed: ${iErr.message}`);
  if (!inserted) throw new Error("createZone insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.zones.create",
    resourceTable: "catering_delivery_zones",
    resourceId: inserted.id,
    metadata: {
      slug,
      location_id: input.locationId,
      fee_cents: feeCents,
      min_order_cents: minOrderCents,
      display_order: displayOrder,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id, slug };
}

// ── Update fee / labels (GM+ ≥7; Tier A step-up at route) ────────────────────
export interface UpdateZoneInput {
  labelEn?: string;
  labelEs?: string | null;
  feeCents?: number;
  minOrderCents?: number | null;
}

async function requireZoneRow(id: string): Promise<DbZoneRow> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_delivery_zones")
    .select(ZONE_COLS)
    .eq("id", id)
    .maybeSingle<DbZoneRow>();
  if (error) throw new Error(`requireZoneRow failed: ${error.message}`);
  if (!data) throw new AdminCateringError(404, "not_found", "Zone not found");
  return data;
}

export async function updateZone(
  actor: AuthContext,
  args: { id: string; changes: UpdateZoneInput },
): Promise<void> {
  requireLevel(actor, ZONE_WRITE_MIN);
  const existing = await requireZoneRow(args.id);
  await requireAccessibleLocation(actor, existing.location_id);

  const update: Record<string, unknown> = {};
  const { changes } = args;

  let newSlug: string | undefined;

  if (changes.labelEn !== undefined) {
    const lEn = changes.labelEn.trim();
    if (!lEn) throw new AdminCateringError(400, "invalid_label", "label_en cannot be empty");
    update.label_en = lEn;
    // Re-derive slug from the new label_en (slug tracks the English label).
    newSlug = slugifyZoneLabel(lEn);
  }
  if (changes.labelEs !== undefined) update.label_es = normalizeOptional(changes.labelEs);
  if (changes.feeCents !== undefined) update.fee_cents = validateFeeCents(changes.feeCents);
  if (changes.minOrderCents !== undefined) update.min_order_cents = validateMinOrderCents(changes.minOrderCents);

  if (Object.keys(update).length === 0) return;

  // If slug changed, check for an active collision within the same location.
  if (newSlug && newSlug !== existing.slug) {
    const sb = getServiceRoleClient();
    const { data: dup, error: dErr } = await sb
      .from("catering_delivery_zones")
      .select("id")
      .eq("location_id", existing.location_id)
      .eq("slug", newSlug)
      .eq("active", true)
      .neq("id", args.id)
      .maybeSingle<{ id: string }>();
    if (dErr) throw new Error(`updateZone dup check failed: ${dErr.message}`);
    if (dup) throw new AdminCateringError(409, "zone_exists", "An active zone with that key already exists for this location");
    update.slug = newSlug;
  }

  update.updated_by = actor.user.id;
  update.updated_at = new Date().toISOString();

  const sb = getServiceRoleClient();
  const { error } = await sb
    .from("catering_delivery_zones")
    .update(update)
    .eq("id", args.id);
  if (error) throw new Error(`updateZone failed: ${error.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.zones.edit",
    resourceTable: "catering_delivery_zones",
    resourceId: args.id,
    metadata: {
      location_id: existing.location_id,
      fields: Object.keys(update).filter((k) => k !== "updated_by" && k !== "updated_at"),
      ...(newSlug && newSlug !== existing.slug ? { slug_changed_to: newSlug } : {}),
    },
    ipAddress: null,
    userAgent: null,
  });
}

// ── Deactivate / reactivate (GM+ ≥7; Tier B step-up at route) ────────────────
export async function deactivateZone(
  actor: AuthContext,
  args: { id: string; active: boolean },
): Promise<void> {
  requireLevel(actor, ZONE_WRITE_MIN);
  const existing = await requireZoneRow(args.id);
  await requireAccessibleLocation(actor, existing.location_id);

  const sb = getServiceRoleClient();

  // Reactivation must not violate the one-active-per-(location, slug) index —
  // surface a typed 409 instead of the raw constraint error.
  if (args.active && existing.active === false) {
    const { data: dup, error: dErr } = await sb
      .from("catering_delivery_zones")
      .select("id")
      .eq("location_id", existing.location_id)
      .eq("slug", existing.slug)
      .eq("active", true)
      .neq("id", args.id)
      .maybeSingle<{ id: string }>();
    if (dErr) throw new Error(`deactivateZone dup check failed: ${dErr.message}`);
    if (dup) throw new AdminCateringError(409, "zone_exists", "An active zone with that key already exists for this location");
  }

  const { error } = await sb
    .from("catering_delivery_zones")
    .update({
      active: args.active,
      updated_by: actor.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.id);
  if (error) throw new Error(`deactivateZone failed: ${error.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: args.active ? "catering.kb.zones.activate" : "catering.kb.zones.deactivate",
    resourceTable: "catering_delivery_zones",
    resourceId: args.id,
    metadata: { location_id: existing.location_id, slug: existing.slug },
    ipAddress: null,
    userAgent: null,
  });
}
