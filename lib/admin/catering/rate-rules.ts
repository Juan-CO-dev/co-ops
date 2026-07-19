/**
 * Admin catering rate-rule data layer (Catering KB — W1a, DOMAIN=rate).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level floor → assertStepUp)
 * AND re-checked here per-action (defense in depth; the lib is the authority).
 * Service-role bypasses RLS by design, consistent with lib/admin/catering/pricing.ts,
 * lib/admin/vendors.ts and lib/admin/skus.ts.
 *
 * Append-only: the update path edits the matched active rule IN PLACE (never
 * DELETE); deactivation flips active=false. There is exactly ONE active rule per
 * (location, scope, COALESCE(scope_ref,'')) — enforced by the partial-unique
 * index `catering_rate_rules_one_active`.
 *
 * FINANCIAL domain (LEVEL 8, all writes Tier B). Each rate is stored as basis
 * points (bps) expressing catering price as a fraction of the regular price
 * (10000 = 100% = regular; < 10000 = wholesale discount; > 10000 = raise). The UI
 * presents PERCENT; the route + lib recompute bps and re-validate 0..30000
 * server-side. NEVER trust the client's bps — validate/recompute here. NOTE the
 * bound is 0..30000 (catering rate can exceed 100%), distinct from the pricing
 * charge-stack's 0..10000 bound.
 *
 * Distinct from catering_pricing_rules (lib/admin/catering/pricing.ts) — that is
 * the charge stack (tax/gratuity/service/deposit). This is the price-derivation
 * rate table, resolved most-specific-wins by lib/catering/pricing-derivation.ts.
 *
 * Schema (live, migration 0128):
 *   catering_rate_rules — id, location_id (NOT NULL), scope (text CHECK IN
 *     ('location','section','item','menu_item')), scope_ref (text, NULL for
 *     'location'), rate_bps (int, 0..30000), active bool (default true),
 *     created_by/updated_by/created_at/updated_at. Partial-unique ONE active rule
 *     per (location_id, scope, COALESCE(scope_ref,'')).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

// ── Authority floors (the lib is the authority per-action) ──────────────────
/** Read + write both require the financial floor. catering.kb.rate.write = 8. */
export const RATE_MIN = 8; // MoO+ — financial

/**
 * Per-domain all-locations threshold. Actors at level >= 9 manage EVERY
 * location's rate rules; below that, only their assigned user_locations. This is
 * a domain-specific rule (financial rates are more tightly scoped than the
 * app-wide ALL_LOCATIONS_THRESHOLD = 7 grant), so it is enforced explicitly here
 * rather than via lib/locations.ts isAllLocationsAccess. Mirrors pricing.ts.
 */
export const RATE_ALL_LOCATIONS_MIN = 9;

/** bps bounds: 0..30000 (0%..300%). Catering rate can exceed 100% (a raise). */
const RATE_BPS_MIN = 0;
const RATE_BPS_MAX = 30000;

/** The 4 valid rate-rule scopes (mirrors the catering_rate_rules scope CHECK). */
const RATE_SCOPES = ["location", "section", "item", "menu_item"] as const;
type RateScope = (typeof RATE_SCOPES)[number];

// ── Types ───────────────────────────────────────────────────────────────────
/** One active rate rule for a location. */
export interface RateRuleView {
  id: string;
  locationId: string;
  scope: "location" | "section" | "item" | "menu_item";
  /** null for scope='location'; section name / entity id (text) otherwise. */
  scopeRef: string | null;
  rateBps: number;
}

/** Typed error the routes map to jsonError(status, code). Mirrors AdminCateringError. */
export class AdminCateringRateError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminCateringRateError";
  }
}

// ── Internal guards / helpers ────────────────────────────────────────────────
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new AdminCateringRateError(403, "forbidden", "Insufficient role level for this action");
  }
}

/** True when the actor may manage EVERY location's rate rules (level >= 9). */
function actorManagesAllLocations(actor: AuthContext): boolean {
  return getRoleLevel(actor.user.role) >= RATE_ALL_LOCATIONS_MIN;
}

/**
 * Validate + normalize a bps value (server-authoritative). Must be an integer
 * within 0..30000. Anything else → invalid_rate. The client sends bps already
 * rounded from percent, but we re-check here — never trust the client. NOTE the
 * 0..30000 bound (catering rate can exceed 100%), NOT the pricing 0..10000.
 */
function normalizeRateBps(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < RATE_BPS_MIN || v > RATE_BPS_MAX) {
    throw new AdminCateringRateError(400, "invalid_rate", "Rate must be an integer 0..30000 bps");
  }
  return v;
}

/**
 * The locations the actor manages. Level >= 9 → every active location; else the
 * actor's assigned active user_locations (intersected with active locations).
 * Ordered by name. (Copied from pricing.ts — do not import its privates.)
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
    throw new AdminCateringRateError(403, "forbidden", "You do not manage that location");
  }
  return match;
}

// ── DB row shape ──────────────────────────────────────────────────────────────
interface DbRateRow {
  id: string;
  location_id: string;
  scope: RateScope;
  scope_ref: string | null;
  rate_bps: number;
}

const RATE_COLS = "id, location_id, scope, scope_ref, rate_bps";

// ── Reads ─────────────────────────────────────────────────────────────────────
/**
 * Load all ACTIVE rate rules for a location the actor manages, ordered by scope
 * then scope_ref. MoO+ (level >= 8).
 */
export async function loadRateRules(actor: AuthContext, locationId: string): Promise<RateRuleView[]> {
  requireLevel(actor, RATE_MIN);
  await assertManagesLocation(actor, locationId);

  const sb = getServiceRoleClient();
  const { data: rules, error } = await sb
    .from("catering_rate_rules")
    .select(RATE_COLS)
    .eq("location_id", locationId)
    .eq("active", true)
    .order("scope", { ascending: true })
    .order("scope_ref", { ascending: true })
    .returns<DbRateRow[]>();
  if (error) throw new Error(`loadRateRules failed: ${error.message}`);

  return (rules ?? []).map((r) => ({
    id: r.id,
    locationId: r.location_id,
    scope: r.scope,
    scopeRef: r.scope_ref,
    rateBps: r.rate_bps,
  }));
}

// ── Write authorization / validation shared path ───────────────────────────────
export interface RateRuleInput {
  locationId: string;
  scope: "location" | "section" | "item" | "menu_item";
  scopeRef: string | null;
  rateBps: number;
}

/** Validate the scope enum + the scope_ref/scope pairing. Returns the normalized scope_ref. */
function normalizeScope(input: RateRuleInput): { scope: RateScope; scopeRef: string | null } {
  if (!RATE_SCOPES.includes(input.scope as RateScope)) {
    throw new AdminCateringRateError(400, "invalid_scope", "Scope must be location, section, item, or menu_item");
  }
  const scope = input.scope as RateScope;
  // scope_ref must be null for 'location' and a non-empty string otherwise.
  if (scope === "location") {
    if (input.scopeRef != null && input.scopeRef !== "") {
      throw new AdminCateringRateError(400, "invalid_scope_ref", "Location-scope rate must not carry a scope ref");
    }
    return { scope, scopeRef: null };
  }
  if (typeof input.scopeRef !== "string" || input.scopeRef === "") {
    throw new AdminCateringRateError(400, "invalid_scope_ref", "This scope requires a non-empty scope ref");
  }
  return { scope, scopeRef: input.scopeRef };
}

// ── Upsert (MoO+, Tier B) — one active rule per (location, scope, ref) ───────────
/**
 * Upsert the active rate rule for (location_id, scope, COALESCE(scope_ref,'')).
 * Query-first: find the active row → if found UPDATE it in place; else INSERT a
 * fresh active row. The partial-unique index backstops a concurrent-insert race
 * (23505 → rate_rule_exists). We recompute+validate the bps server-side and
 * validate the scope/scope_ref pairing. All writes MoO+ (level >= 8), Tier B.
 */
export async function upsertRateRule(
  actor: AuthContext,
  input: RateRuleInput,
): Promise<{ id: string }> {
  requireLevel(actor, RATE_MIN);
  const { scope, scopeRef } = normalizeScope(input);
  const rateBps = normalizeRateBps(input.rateBps);
  await assertManagesLocation(actor, input.locationId);

  const sb = getServiceRoleClient();

  // Find the active row for (location_id, scope, COALESCE(scope_ref,'')). scope='location'
  // has scope_ref NULL — match with .is() rather than .eq() so NULL compares correctly.
  let existingQuery = sb
    .from("catering_rate_rules")
    .select("id")
    .eq("location_id", input.locationId)
    .eq("scope", scope)
    .eq("active", true);
  existingQuery = scopeRef == null ? existingQuery.is("scope_ref", null) : existingQuery.eq("scope_ref", scopeRef);
  const { data: existing, error: findErr } = await existingQuery.maybeSingle<{ id: string }>();
  if (findErr) throw new Error(`upsertRateRule find failed: ${findErr.message}`);

  if (existing) {
    // Update the matched active rule in place.
    const { error, count } = await sb
      .from("catering_rate_rules")
      .update(
        { rate_bps: rateBps, updated_by: actor.user.id, updated_at: new Date().toISOString() },
        { count: "exact" },
      )
      .eq("id", existing.id)
      .eq("location_id", input.locationId)
      .eq("active", true);
    if (error) throw new Error(`upsertRateRule update failed: ${error.message}`);
    if (count === 0) throw new AdminCateringRateError(404, "not_found", "Active rate rule not found");

    await audit({
      actorId: actor.user.id,
      actorRole: actor.user.role,
      action: "catering.kb.rate.update",
      resourceTable: "catering_rate_rules",
      resourceId: existing.id,
      metadata: { location_id: input.locationId, scope, scope_ref: scopeRef, rate_bps: rateBps },
      ipAddress: null,
      userAgent: null,
    });

    return { id: existing.id };
  }

  // Insert a fresh active rule. A concurrent insert that beats us trips the
  // partial-unique index (23505) — map to a conflict the caller can retry.
  const { data: inserted, error } = await sb
    .from("catering_rate_rules")
    .insert({
      location_id: input.locationId,
      scope,
      scope_ref: scopeRef,
      rate_bps: rateBps,
      active: true,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) {
    if (error.code === "23505") {
      throw new AdminCateringRateError(409, "rate_rule_exists", "An active rate rule already exists for that scope");
    }
    throw new Error(`upsertRateRule insert failed: ${error.message}`);
  }
  if (!inserted) throw new Error("upsertRateRule insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.rate.create",
    resourceTable: "catering_rate_rules",
    resourceId: inserted.id,
    metadata: { location_id: input.locationId, scope, scope_ref: scopeRef, rate_bps: rateBps },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id };
}

// ── Deactivate (MoO+, Tier B) — retire an active rate rule ───────────────────────
/**
 * Deactivate a rate rule (active=false; never DELETE — append-only). Retiring the
 * rule frees the partial-unique slot so a fresh rule can be created. Matched on
 * (id, location_id, active) so a client-supplied ruleId can never target a rule
 * outside the managed location. Count 0 → not_found.
 */
export async function deactivateRateRule(
  actor: AuthContext,
  args: { ruleId: string; locationId: string },
): Promise<void> {
  requireLevel(actor, RATE_MIN);
  await assertManagesLocation(actor, args.locationId);

  const sb = getServiceRoleClient();
  const { error, count } = await sb
    .from("catering_rate_rules")
    .update(
      { active: false, updated_by: actor.user.id, updated_at: new Date().toISOString() },
      { count: "exact" },
    )
    .eq("id", args.ruleId)
    .eq("location_id", args.locationId)
    .eq("active", true);
  if (error) throw new Error(`deactivateRateRule failed: ${error.message}`);
  if (count === 0) throw new AdminCateringRateError(404, "not_found", "Active rate rule not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.kb.rate.deactivate",
    resourceTable: "catering_rate_rules",
    resourceId: args.ruleId,
    metadata: { location_id: args.locationId },
    ipAddress: null,
    userAgent: null,
  });
}
