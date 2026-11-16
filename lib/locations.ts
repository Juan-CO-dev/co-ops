/**
 * Location-context helpers — Phase 2.
 *
 * Pure functions. No DB. Operate on a session-derived actor shape carrying
 * the role and the list of assigned location IDs (extracted from the JWT).
 *
 * Level 9+ has implicit operational access to every location regardless of
 * user_locations. Report reads separately grant all-location access at level 8.
 */

import { type RoleCode, isRoleAtOrAbove } from "./roles";

const ALL_LOCATIONS_THRESHOLD = 9;
export const REPORT_ALL_LOCATIONS_LEVEL = 8;

/** Minimal shape for any caller — typically derived from the verified JWT. */
export interface LocationActor {
  role: RoleCode;
  /** UUIDs of locations the user is explicitly assigned to. */
  locations: string[];
}

export function isAllLocationsAccess(actor: LocationActor): boolean {
  return isRoleAtOrAbove(actor.role, ALL_LOCATIONS_THRESHOLD);
}

/**
 * Returns the locations the actor can access. Sentinel `"all"` when the actor
 * has the all-locations grant — callers that need a concrete list must resolve
 * it against the locations table at the API/DB layer (not here, no DB).
 */
export function accessibleLocations(actor: LocationActor): string[] | "all" {
  return isAllLocationsAccess(actor) ? "all" : [...actor.locations];
}

/**
 * Authorizes that the actor may operate inside a specific location context.
 * Returns true for level 9+ unconditionally; otherwise true only when the
 * locationId is in the actor's assignment list.
 */
export function lockLocationContext(actor: LocationActor, locationId: string): boolean {
  if (isAllLocationsAccess(actor)) return true;
  return actor.locations.includes(locationId);
}

/**
 * Shop TASKS (checklists: opening, closing, AM / mid-day prep) — Juan's ruling 2026-11-15: "we
 * routinely do tasks at the shops depending on what's needed and who is available". Level 8+ (MoO,
 * owner, CGS) may mark tasks done, submit and confirm at ANY shop without a membership row; below
 * level 8 the actor's (active) membership is required, exactly as lockLocationContext requires it.
 * The same rule the checklist correction writers and tagActualCompleter use (audit W05) and the
 * SQL writers enforce (checklist_actor_level, 0318). Task surfaces only: every other operational
 * write keeps lockLocationContext (all shops at 9+).
 */
export const SHOP_TASK_ALL_LOCATIONS_LEVEL = 8;

export function canWorkShopTasks(actor: LocationActor, locationId: string): boolean {
  return isRoleAtOrAbove(actor.role, SHOP_TASK_ALL_LOCATIONS_LEVEL) || actor.locations.includes(locationId);
}

/** The shops whose task pages the actor may work: "all" at level 8+, else their memberships. */
export function shopTaskLocations(actor: LocationActor): string[] | "all" {
  return isRoleAtOrAbove(actor.role, SHOP_TASK_ALL_LOCATIONS_LEVEL) ? "all" : [...actor.locations];
}

/** Report navigation grant only. Operational writes retain lockLocationContext. */
export function canReadReportLocation(actor: LocationActor, locationId: string): boolean {
  return isRoleAtOrAbove(actor.role, REPORT_ALL_LOCATIONS_LEVEL) || lockLocationContext(actor, locationId);
}
