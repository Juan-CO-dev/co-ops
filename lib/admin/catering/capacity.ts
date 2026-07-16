/**
 * Admin catering-capacity data layer (Catering KB — Wave 1 slice 1A, DOMAIN=capacity).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level floor → assertStepUp)
 * AND re-checked here per-action (defense in depth; the lib is the authority).
 * Service-role bypasses RLS by design, consistent with lib/admin/vendors.ts and
 * lib/admin/skus.ts.
 *
 * Append-only: blackout removals flip `active=false`, never DELETE. The capacity
 * policy is edited IN PLACE — there is exactly ONE active policy per location,
 * enforced by the partial-unique index
 * `catering_capacity_policy_one_active_per_location` (unique on location_id
 * WHERE active). Blackouts are one-active-per-(location, date) via
 * `catering_blackout_dates_one_active`.
 *
 * PER-LOCATION editor (LEVEL 7, catering.kb.capacity.write): one card per
 * location the actor manages — level >= 9 manages every location, else the
 * actor's active user_locations. Feeds the Wave-1B capacity gate.
 *
 * Schema (live, migration 0116):
 *   catering_capacity_policy — id, location_id (NOT NULL), max_covers_per_day /
 *     max_events_per_day / min_lead_time_hours (all int NULLABLE, NULL = no cap,
 *     CHECK >= 0), active, created_by/updated_by/created_at/updated_at.
 *     Partial-unique ONE active row per location.
 *   catering_blackout_dates — id, location_id (NOT NULL), blackout_date (date),
 *     reason (text NULLABLE), active, created_by/created_at. NO updated_by /
 *     updated_at columns — deactivation flips `active` only; the audit row
 *     carries the actor. Partial-unique ONE active row per (location, date).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

// ── Authority floors (the lib is the authority per-action) ──────────────────
/** Read + write both require the capacity floor. catering.kb.capacity.write = 7. */
export const CAPACITY_MIN = 7; // GM+ — per-location operational policy

/**
 * Per-domain all-locations threshold. Actors at level >= 9 manage EVERY
 * location's capacity; below that, only their assigned user_locations. Mirrors
 * lib/admin/catering/pricing.ts PRICING_ALL_LOCATIONS_MIN (enforced explicitly
 * here, not via lib/locations.ts).
 */
export const CAPACITY_ALL_LOCATIONS_MIN = 9;

// ── Types ───────────────────────────────────────────────────────────────────
/** One location's active capacity policy, hydrated with the location name. */
export interface CapacityPolicyView {
  /** Policy id — null when the location has no active policy yet (unconfigured). */
  id: string | null;
  locationId: string;
  locationName: string;
  /** null = no cap. */
  maxCoversPerDay: number | null;
  /** null = no cap. */
  maxEventsPerDay: number | null;
  /** null = no minimum. */
  minLeadTimeHours: number | null;
}

/** One active blackout date row. */
export interface BlackoutDateView {
  id: string;
  locationId: string;
  /** YYYY-MM-DD (DB `date` column shape). */
  blackoutDate: string;
  reason: string | null;
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

/** True when the actor may manage EVERY location's capacity (level >= 9). */
function actorManagesAllLocations(actor: AuthContext): boolean {
  return getRoleLevel(actor.user.role) >= CAPACITY_ALL_LOCATIONS_MIN;
}

function normalizeOptional(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t || null;
}

/**
 * Validate + normalize a capacity cap (server-authoritative). null = no cap;
 * a value must be a non-negative integer, else invalid_payload.
 */
function normalizeCap(v: number | null): number | null {
  if (v === null) return null;
  if (!Number.isInteger(v) || v < 0) {
    throw new AdminCateringError(400, "invalid_payload", "Caps must be non-negative integers or null");
  }
  return v;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Validate a blackout date string (YYYY-MM-DD, real calendar date) → invalid_date. */
function normalizeBlackoutDate(v: string): string {
  const s = v.trim();
  const m = DATE_RE.exec(s);
  if (!m) throw new AdminCateringError(400, "invalid_date", "Date must be YYYY-MM-DD");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new AdminCateringError(400, "invalid_date", "Not a real calendar date");
  }
  return s;
}

// ── DB row shapes ─────────────────────────────────────────────────────────────
interface DbPolicyRow {
  id: string;
  location_id: string;
  max_covers_per_day: number | null;
  max_events_per_day: number | null;
  min_lead_time_hours: number | null;
}

interface DbBlackoutRow {
  id: string;
  location_id: string;
  blackout_date: string;
  reason: string | null;
}

const POLICY_COLS = "id, location_id, max_covers_per_day, max_events_per_day, min_lead_time_hours";

/**
 * The locations the actor manages. Level >= 9 → every active location; else the
 * actor's assigned active user_locations (intersected with active locations).
 * Ordered by name. Mirrors lib/admin/catering/pricing.ts accessibleLocations.
 */
async function accessibleLocations(actor: AuthContext): Promise<Array<{ id: string; name: string }>> {
  const sb = getServiceRoleClient();
  const { data: locRows, error: lErr } = await sb
    .from("locations")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string }>>();
  if (lErr) throw new Error(`accessibleLocations failed: ${lErr.message}`);
  const all = locRows ?? [];
  if (actorManagesAllLocations(actor)) return all;

  const { data: ul, error: ulErr } = await sb
    .from("user_locations")
    .select("location_id")
    .eq("user_id", actor.user.id)
    .eq("active", true)
    .returns<Array<{ location_id: string }>>();
  if (ulErr) throw new Error(`accessibleLocations user_locations failed: ${ulErr.message}`);
  const assigned = new Set((ul ?? []).map((r) => r.location_id));
  return all.filter((l) => assigned.has(l.id));
}

/** The actor must manage the target location, else forbidden. */
async function assertManagesLocation(actor: AuthContext, locationId: string): Promise<{ id: string; name: string }> {
  const managed = await accessibleLocations(actor);
  const match = managed.find((l) => l.id === locationId);
  if (!match) {
    throw new AdminCateringError(403, "forbidden", "You do not manage that location");
  }
  return match;
}

// ── Reads ─────────────────────────────────────────────────────────────────────
/**
 * Load one card per location the actor manages, each carrying that location's
 * single active capacity policy (or all-null caps with id=null when the
 * location has no active policy yet). GM+ (level >= 7).
 */
export async function loadCapacityPolicies(actor: AuthContext): Promise<CapacityPolicyView[]> {
  requireLevel(actor, CAPACITY_MIN);
  const locations = await accessibleLocations(actor);
  if (locations.length === 0) return [];

  const sb = getServiceRoleClient();
  const locationIds = locations.map((l) => l.id);
  const { data: policies, error } = await sb
    .from("catering_capacity_policy")
    .select(POLICY_COLS)
    .in("location_id", locationIds)
    .eq("active", true)
    .returns<DbPolicyRow[]>();
  if (error) throw new Error(`loadCapacityPolicies failed: ${error.message}`);

  const byLocation = new Map<string, DbPolicyRow>();
  for (const p of policies ?? []) byLocation.set(p.location_id, p);

  return locations.map((loc) => {
    const policy = byLocation.get(loc.id);
    return {
      id: policy?.id ?? null,
      locationId: loc.id,
      locationName: loc.name,
      maxCoversPerDay: policy?.max_covers_per_day ?? null,
      maxEventsPerDay: policy?.max_events_per_day ?? null,
      minLeadTimeHours: policy?.min_lead_time_hours ?? null,
    };
  });
}

/**
 * Load the active blackout dates across the locations the actor manages,
 * ordered by date. GM+ (level >= 7).
 */
export async function loadBlackoutDates(actor: AuthContext): Promise<BlackoutDateView[]> {
  requireLevel(actor, CAPACITY_MIN);
  const locations = await accessibleLocations(actor);
  if (locations.length === 0) return [];

  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_blackout_dates")
    .select("id, location_id, blackout_date, reason")
    .in("location_id", locations.map((l) => l.id))
    .eq("active", true)
    .order("blackout_date", { ascending: true })
    .returns<DbBlackoutRow[]>();
  if (error) throw new Error(`loadBlackoutDates failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    locationId: r.location_id,
    blackoutDate: r.blackout_date,
    reason: r.reason,
  }));
}

// ── Capacity policy writes (GM+, Tier B at the route) ────────────────────────
export interface CapacityPolicyInput {
  locationId: string;
  maxCoversPerDay: number | null;
  maxEventsPerDay: number | null;
  minLeadTimeHours: number | null;
}

/** Validate the server-authoritative cap values (never trust the client). */
function normalizeCaps(input: CapacityPolicyInput): {
  max_covers_per_day: number | null;
  max_events_per_day: number | null;
  min_lead_time_hours: number | null;
} {
  return {
    max_covers_per_day: normalizeCap(input.maxCoversPerDay),
    max_events_per_day: normalizeCap(input.maxEventsPerDay),
    min_lead_time_hours: normalizeCap(input.minLeadTimeHours),
  };
}

/**
 * Create the location's active capacity policy. Used when the location has no
 * active policy yet (id=null in the loader). The partial-unique index
 * guarantees a location can hold at most one active policy.
 */
export async function createCapacityPolicy(
  actor: AuthContext,
  input: CapacityPolicyInput,
): Promise<{ id: string }> {
  requireLevel(actor, CAPACITY_MIN);
  await assertManagesLocation(actor, input.locationId);
  const values = normalizeCaps(input);

  const sb = getServiceRoleClient();
  const { data: inserted, error } = await sb
    .from("catering_capacity_policy")
    .insert({
      location_id: input.locationId,
      ...values,
      active: true,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`createCapacityPolicy failed: ${error.message}`);
  if (!inserted) throw new Error("createCapacityPolicy insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.capacity.create",
    resourceTable: "catering_capacity_policy",
    resourceId: inserted.id,
    metadata: { location_id: input.locationId, ...values },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id };
}

/**
 * Update the location's single active policy in place (save edits the one
 * active row). Matches on the policy id AND the location the actor manages AND
 * active — a client-supplied id can never target a policy outside the managed
 * location. count 0 → not_found so the caller can fall back to create.
 */
export async function updateCapacityPolicy(
  actor: AuthContext,
  args: { policyId: string; input: CapacityPolicyInput },
): Promise<void> {
  requireLevel(actor, CAPACITY_MIN);
  await assertManagesLocation(actor, args.input.locationId);
  const values = normalizeCaps(args.input);

  const sb = getServiceRoleClient();
  const { error, count } = await sb
    .from("catering_capacity_policy")
    .update(
      { ...values, updated_by: actor.user.id, updated_at: new Date().toISOString() },
      { count: "exact" },
    )
    .eq("id", args.policyId)
    .eq("location_id", args.input.locationId)
    .eq("active", true);
  if (error) throw new Error(`updateCapacityPolicy failed: ${error.message}`);
  if (count === 0) throw new AdminCateringError(404, "not_found", "Active capacity policy not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.capacity.update",
    resourceTable: "catering_capacity_policy",
    resourceId: args.policyId,
    metadata: { location_id: args.input.locationId, ...values },
    ipAddress: null,
    userAgent: null,
  });
}

// ── Blackout dates (GM+, Tier A at the route) ────────────────────────────────
/**
 * Add a blackout date (append-only). One active blackout per (location, date):
 * a colliding active date → 409 blackout_exists. A malformed / non-calendar
 * date → 400 invalid_date.
 */
export async function addBlackoutDate(
  actor: AuthContext,
  args: { locationId: string; blackoutDate: string; reason?: string | null },
): Promise<{ id: string }> {
  requireLevel(actor, CAPACITY_MIN);
  await assertManagesLocation(actor, args.locationId);
  const blackoutDate = normalizeBlackoutDate(args.blackoutDate);
  const reason = normalizeOptional(args.reason);

  const sb = getServiceRoleClient();
  // Dup-guard on the active (location, date) pair (partial-unique backs this).
  const { data: existing, error: exErr } = await sb
    .from("catering_blackout_dates")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("blackout_date", blackoutDate)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (exErr) throw new Error(`addBlackoutDate dup check failed: ${exErr.message}`);
  if (existing) {
    throw new AdminCateringError(409, "blackout_exists", "An active blackout already exists for that date");
  }

  // NOTE: catering_blackout_dates has no updated_by/updated_at columns —
  // insert carries created_by only (migration 0116).
  const { data: inserted, error } = await sb
    .from("catering_blackout_dates")
    .insert({
      location_id: args.locationId,
      blackout_date: blackoutDate,
      reason,
      active: true,
      created_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`addBlackoutDate insert failed: ${error.message}`);
  if (!inserted) throw new Error("addBlackoutDate insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.capacity.blackout_create",
    resourceTable: "catering_blackout_dates",
    resourceId: inserted.id,
    metadata: { location_id: args.locationId, blackout_date: blackoutDate, reason },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id };
}

/**
 * Deactivate a blackout date (active=false; never DELETE — append-only).
 * Matches on the blackout id AND the location the actor manages AND active —
 * a client-supplied id can never target another location's row. Restoring a
 * date = re-add it (fresh row), never reactivate (partial-unique collision).
 */
export async function deactivateBlackoutDate(
  actor: AuthContext,
  args: { blackoutId: string; locationId: string },
): Promise<void> {
  requireLevel(actor, CAPACITY_MIN);
  await assertManagesLocation(actor, args.locationId);

  const sb = getServiceRoleClient();
  // No updated_by/updated_at on this table — the audit row carries the actor.
  const { error, count } = await sb
    .from("catering_blackout_dates")
    .update({ active: false }, { count: "exact" })
    .eq("id", args.blackoutId)
    .eq("location_id", args.locationId)
    .eq("active", true);
  if (error) throw new Error(`deactivateBlackoutDate failed: ${error.message}`);
  if (count === 0) throw new AdminCateringError(404, "not_found", "Active blackout not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.capacity.blackout_deactivate",
    resourceTable: "catering_blackout_dates",
    resourceId: args.blackoutId,
    metadata: { location_id: args.locationId },
    ipAddress: null,
    userAgent: null,
  });
}
