/**
 * Admin catering-pricing data layer (Catering KB — Wave 1 slice 1A, DOMAIN=pricing).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level floor → assertStepUp)
 * AND re-checked here per-action (defense in depth; the lib is the authority).
 * Service-role bypasses RLS by design, consistent with lib/admin/vendors.ts and
 * lib/admin/skus.ts.
 *
 * Append-only: the update path edits the single active rule IN PLACE (never
 * DELETE). There is exactly ONE active rule per location — enforced by the
 * partial-unique index `catering_pricing_rules_one_active_per_location`
 * (unique on location_id WHERE active). The editor is therefore a per-location
 * single-active-row form, not a list of appendable rows.
 *
 * FINANCIAL domain (LEVEL 8, all writes Tier B). Every rate is stored as basis
 * points (bps = percent * 100). The UI presents PERCENT (e.g. 6.5); the route +
 * lib recompute bps = round(percent * 100) and re-validate 0..10000 server-side.
 * NEVER trust the client's bps — validate/recompute here.
 *
 * Schema (live):
 *   catering_pricing_rules — id, location_id (NOT NULL), tax_rate_bps,
 *     gratuity_bps, service_charge_bps, deposit_pct_bps (all int bps, NOT NULL,
 *     default 0), tax_on_delivery bool (default true), tax_on_gratuity bool
 *     (default false), active bool, created_by/updated_by/created_at/updated_at.
 *     Partial-unique ONE active rule per location.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

// ── Authority floors (the lib is the authority per-action) ──────────────────
/** Read + write both require the financial floor. catering.kb.pricing.write = 8. */
export const PRICING_MIN = 8; // MoO+ — financial

/**
 * Per-domain all-locations threshold. Actors at level >= 9 manage EVERY
 * location's pricing; below that, only their assigned user_locations. This is a
 * domain-specific rule (financial pricing is more tightly scoped than the
 * app-wide ALL_LOCATIONS_THRESHOLD = 7 grant), so it is enforced explicitly
 * here rather than via lib/locations.ts isAllLocationsAccess.
 */
export const PRICING_ALL_LOCATIONS_MIN = 9;

/** bps bounds: 0..10000 (0%..100%). */
const BPS_MIN = 0;
const BPS_MAX = 10000;

// ── Types ───────────────────────────────────────────────────────────────────
/** One location's active pricing rule, hydrated with the location name. */
export interface PricingRuleView {
  /** Rule id — null when the location has no active rule yet (unconfigured). */
  id: string | null;
  locationId: string;
  locationName: string;
  taxRateBps: number;
  gratuityBps: number;
  serviceChargeBps: number;
  depositPctBps: number;
  taxOnDelivery: boolean;
  taxOnGratuity: boolean;
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

/** True when the actor may manage EVERY location's pricing (level >= 9). */
function actorManagesAllLocations(actor: AuthContext): boolean {
  return getRoleLevel(actor.user.role) >= PRICING_ALL_LOCATIONS_MIN;
}

/**
 * Validate + normalize a bps value (server-authoritative). Must be an integer
 * within 0..10000. Anything else → invalid_rate. The client sends bps already
 * rounded from percent, but we re-check here — never trust the client.
 */
function normalizeBps(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < BPS_MIN || v > BPS_MAX) {
    throw new AdminCateringError(400, "invalid_rate", "Rate must be an integer 0..10000 bps (0%..100%)");
  }
  return v;
}

function normalizeBool(v: unknown): boolean {
  if (typeof v !== "boolean") {
    throw new AdminCateringError(400, "invalid_presence", "Toggle must be a boolean");
  }
  return v;
}

// ── DB row shape ──────────────────────────────────────────────────────────────
interface DbPricingRow {
  id: string;
  location_id: string;
  tax_rate_bps: number;
  gratuity_bps: number;
  service_charge_bps: number;
  deposit_pct_bps: number;
  tax_on_delivery: boolean;
  tax_on_gratuity: boolean;
}

const PRICING_COLS =
  "id, location_id, tax_rate_bps, gratuity_bps, service_charge_bps, deposit_pct_bps, tax_on_delivery, tax_on_gratuity";

/**
 * The locations the actor manages. Level >= 9 → every active location; else the
 * actor's assigned active user_locations (intersected with active locations).
 * Ordered by name.
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

// ── Reads ─────────────────────────────────────────────────────────────────────
/**
 * Load one card per location the actor manages, each carrying that location's
 * single active pricing rule (or the schema defaults with id=null when the
 * location has no active rule yet). MoO+ (level >= 8).
 */
export async function loadPricingRules(actor: AuthContext): Promise<PricingRuleView[]> {
  requireLevel(actor, PRICING_MIN);
  const locations = await accessibleLocations(actor);
  if (locations.length === 0) return [];

  const sb = getServiceRoleClient();
  const locationIds = locations.map((l) => l.id);
  const { data: rules, error } = await sb
    .from("catering_pricing_rules")
    .select(PRICING_COLS)
    .in("location_id", locationIds)
    .eq("active", true)
    .returns<DbPricingRow[]>();
  if (error) throw new Error(`loadPricingRules failed: ${error.message}`);

  const byLocation = new Map<string, DbPricingRow>();
  for (const r of rules ?? []) byLocation.set(r.location_id, r);

  return locations.map((loc) => {
    const rule = byLocation.get(loc.id);
    return {
      id: rule?.id ?? null,
      locationId: loc.id,
      locationName: loc.name,
      taxRateBps: rule?.tax_rate_bps ?? 0,
      gratuityBps: rule?.gratuity_bps ?? 0,
      serviceChargeBps: rule?.service_charge_bps ?? 0,
      depositPctBps: rule?.deposit_pct_bps ?? 0,
      // Schema defaults when unconfigured: tax_on_delivery=true, tax_on_gratuity=false.
      taxOnDelivery: rule?.tax_on_delivery ?? true,
      taxOnGratuity: rule?.tax_on_gratuity ?? false,
    };
  });
}

// ── Write authorization / validation shared path ───────────────────────────────
export interface PricingRuleInput {
  locationId: string;
  taxRateBps: number;
  gratuityBps: number;
  serviceChargeBps: number;
  depositPctBps: number;
  taxOnDelivery: boolean;
  taxOnGratuity: boolean;
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

/** Validate + recompute the server-authoritative bps + toggle values. */
function normalizeInput(input: PricingRuleInput): {
  tax_rate_bps: number;
  gratuity_bps: number;
  service_charge_bps: number;
  deposit_pct_bps: number;
  tax_on_delivery: boolean;
  tax_on_gratuity: boolean;
} {
  return {
    tax_rate_bps: normalizeBps(input.taxRateBps),
    gratuity_bps: normalizeBps(input.gratuityBps),
    service_charge_bps: normalizeBps(input.serviceChargeBps),
    deposit_pct_bps: normalizeBps(input.depositPctBps),
    tax_on_delivery: normalizeBool(input.taxOnDelivery),
    tax_on_gratuity: normalizeBool(input.taxOnGratuity),
  };
}

// ── Create (MoO+, Tier B) — first active rule for a location ────────────────────
/**
 * Create the location's active pricing rule. Used when the location has no
 * active rule yet (id=null in the loader). The partial-unique index guarantees
 * a location can hold at most one active rule; a duplicate-create surfaces as a
 * 23505 unique violation which we map to invalid_rate-shaped conflict.
 */
export async function createPricingRule(
  actor: AuthContext,
  input: PricingRuleInput,
): Promise<{ id: string }> {
  requireLevel(actor, PRICING_MIN);
  await assertManagesLocation(actor, input.locationId);
  const values = normalizeInput(input);

  const sb = getServiceRoleClient();
  const { data: inserted, error } = await sb
    .from("catering_pricing_rules")
    .insert({
      location_id: input.locationId,
      ...values,
      active: true,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`createPricingRule failed: ${error.message}`);
  if (!inserted) throw new Error("createPricingRule insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.pricing.create",
    resourceTable: "catering_pricing_rules",
    resourceId: inserted.id,
    metadata: { location_id: input.locationId, ...values },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id };
}

// ── Update (MoO+, Tier B) — edit the single active rule in place ────────────────
/**
 * Update the location's single active rule in place. The active row is the one
 * matched by (location_id, active=true) — there is exactly one per the partial
 * unique index. We recompute+validate all bps/toggle values server-side and
 * check the error, throwing if present. If no active row exists (count 0) we
 * throw not_found so the caller can fall back to create.
 */
export async function updatePricingRule(
  actor: AuthContext,
  args: { ruleId: string; input: PricingRuleInput },
): Promise<void> {
  requireLevel(actor, PRICING_MIN);
  await assertManagesLocation(actor, args.input.locationId);
  const values = normalizeInput(args.input);

  const sb = getServiceRoleClient();
  // Match on the rule id AND the location the actor manages AND active — so a
  // client-supplied ruleId can never target a rule outside the managed location.
  const { error, count } = await sb
    .from("catering_pricing_rules")
    .update(
      { ...values, updated_by: actor.user.id, updated_at: new Date().toISOString() },
      { count: "exact" },
    )
    .eq("id", args.ruleId)
    .eq("location_id", args.input.locationId)
    .eq("active", true);
  if (error) throw new Error(`updatePricingRule failed: ${error.message}`);
  if (count === 0) throw new AdminCateringError(404, "not_found", "Active pricing rule not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.pricing.update",
    resourceTable: "catering_pricing_rules",
    resourceId: args.ruleId,
    metadata: { location_id: args.input.locationId, ...values },
    ipAddress: null,
    userAgent: null,
  });
}

// ── Deactivate (MoO+, Tier B) — retire a location's active rule ──────────────────
/**
 * Deactivate the location's active rule (active=false; never DELETE — append-only).
 * Retiring the rule frees the partial-unique slot so a fresh rule can be created.
 * Check the error and throw if present.
 */
export async function deactivatePricingRule(
  actor: AuthContext,
  args: { ruleId: string; locationId: string },
): Promise<void> {
  requireLevel(actor, PRICING_MIN);
  await assertManagesLocation(actor, args.locationId);

  const sb = getServiceRoleClient();
  const { error, count } = await sb
    .from("catering_pricing_rules")
    .update(
      { active: false, updated_by: actor.user.id, updated_at: new Date().toISOString() },
      { count: "exact" },
    )
    .eq("id", args.ruleId)
    .eq("location_id", args.locationId)
    .eq("active", true);
  if (error) throw new Error(`deactivatePricingRule failed: ${error.message}`);
  if (count === 0) throw new AdminCateringError(404, "not_found", "Active pricing rule not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.pricing.deactivate",
    resourceTable: "catering_pricing_rules",
    resourceId: args.ruleId,
    metadata: { location_id: args.locationId },
    ipAddress: null,
    userAgent: null,
  });
}
