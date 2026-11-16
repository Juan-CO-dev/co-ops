/**
 * Shop scope for the catering-integrations admin READS (Toast crosswalk, ezCater tab) — audit W08 B161.
 *
 * Owner ruling 2026-11-15: the MoO, owner and CGS roles see both shops' Toast mappings, Toast restaurant GUID,
 * ezCater caterer id and ezCater events automatically — by role, not by shop membership and not by role level.
 * Every other role (GM, AGM, catering manager, ...) sees only the shops it is assigned to.
 *
 * Reads only. The writes keep lockLocationContext (shop membership, or all-locations access).
 * ezCater events with no lead have no shop; they stay with all-locations access (isAllLocationsAccess),
 * as before the ruling.
 */
import type { RoleCode } from "@/lib/roles";

export const INTEGRATIONS_ALL_SHOPS_ROLES: readonly RoleCode[] = ["moo", "owner", "cgs"];

/** `null` = every active shop; otherwise the actor's own shops (possibly none). */
export function integrationsReadScope(actor: { user: { role: RoleCode }; locations: readonly string[] }): string[] | null {
  return INTEGRATIONS_ALL_SHOPS_ROLES.includes(actor.user.role) ? null : [...actor.locations];
}
