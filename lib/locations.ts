/**
 * Location-context helpers — Phase 2.
 *
 * Pure functions. No DB. Operate on a session-derived actor shape carrying
 * the role and the list of assigned location IDs (extracted from the JWT).
 *
 * Level 9+ has implicit operational access to every location regardless of
 * user_locations (until the all-shops access plan's PR 3 moves it to the `ops` surface). Shop tasks
 * and report reads read lib/shop-access-shared.ts by ROLE: MoO, owner and CGS hold every shop there
 * (plan r15 PR 1; the same people as "level 8+" today, so no answer changed).
 */

import { type RoleCode, isRoleAtOrAbove } from "./roles";
import { actingShops, canActAtShop } from "./shop-access-shared";

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
 * routinely do tasks at the shops depending on what's needed and who is available". The roles that
 * hold the `tasks` surface (lib/shop-access-shared.ts: MoO, owner, CGS) may mark tasks done, submit
 * and confirm at ANY shop without a membership row; everyone else needs their (active) membership,
 * exactly as lockLocationContext requires it. The same rule the checklist correction writers and
 * tagActualCompleter use (worksShopTasks, audit W05) and the SQL writers enforce
 * (checklist_actor_level, 0318: level >= 8, the same three roles). Task surfaces only: every other
 * operational write keeps lockLocationContext (all shops at 9+).
 */
export function canWorkShopTasks(actor: LocationActor, locationId: string): boolean {
  return canActAtShop(actor, locationId, "tasks");
}

/** The shops whose task pages the actor may work: "all" for a role that holds `tasks`, else their memberships. */
export function shopTaskLocations(actor: LocationActor): string[] | "all" {
  return actingShops(actor, "tasks");
}

/**
 * Report navigation grant only: a role that holds `report_read` (MoO, owner, CGS) reads every shop,
 * anyone else where they may work (lockLocationContext). Operational writes retain lockLocationContext.
 * `REPORT_ALL_LOCATIONS_LEVEL` above still offers the "All shops" scope at the same level 8 until
 * the plan's PR 3 moves its readers to `holdsAllShops(role, "report_read")`.
 */
export function canReadReportLocation(actor: LocationActor, locationId: string): boolean {
  return canActAtShop(actor, locationId, "report_read") || lockLocationContext(actor, locationId);
}
