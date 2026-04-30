/**
 * Location-context helpers — Phase 2.
 *
 * Pure functions. No DB. Operate on a session-derived actor shape carrying
 * the role and the list of assigned location IDs (extracted from the JWT).
 *
 * Level 7+ (Owner / CGS) has implicit access to every location regardless of
 * their user_locations rows. Below 7, access is the explicit assignment list.
 */

import { type RoleCode, isRoleAtOrAbove } from "./roles";

const ALL_LOCATIONS_THRESHOLD = 7;

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
 * Returns true for level 7+ unconditionally; otherwise true only when the
 * locationId is in the actor's assignment list.
 */
export function lockLocationContext(actor: LocationActor, locationId: string): boolean {
  if (isAllLocationsAccess(actor)) return true;
  return actor.locations.includes(locationId);
}
