/**
 * Shop scope for the catering-integrations admin (Toast crosswalk, ezCater tab) — audit W08 B161 (reads) and
 * its follow-up W08B (writes).
 *
 * Owner ruling 2026-11-15: the MoO, owner and CGS roles see AND change both shops' Toast mappings, Toast
 * restaurant GUID, ezCater caterer id and ezCater settings automatically — by role, not by shop membership and
 * not by role level. Every other role (GM, AGM, catering manager, ...) works only on the shops it is assigned to.
 * The level floors and the step-up tiers are unchanged; this file decides WHICH shop, never WHETHER.
 *
 * ezCater events with no lead have no shop; they stay with all-locations access (isAllLocationsAccess),
 * as before the ruling.
 */
import type { RoleCode } from "@/lib/roles";
import { lockLocationContext } from "@/lib/locations";

export const INTEGRATIONS_ALL_SHOPS_ROLES: readonly RoleCode[] = ["moo", "owner", "cgs"];

type IntegrationsActor = { user: { role: RoleCode }; locations: readonly string[] };

/** `null` = every active shop; otherwise the actor's own shops (possibly none). */
export function integrationsReadScope(actor: IntegrationsActor): string[] | null {
  return INTEGRATIONS_ALL_SHOPS_ROLES.includes(actor.user.role) ? null : [...actor.locations];
}

/**
 * May this actor change this shop's Toast / ezCater integration settings? The trusted roles may change any
 * shop (the writers still refuse a shop that is missing or inactive); everyone else needs the shop membership
 * lockLocationContext has always required.
 */
export function canWriteIntegrationsShop(actor: IntegrationsActor, locationId: string): boolean {
  if (INTEGRATIONS_ALL_SHOPS_ROLES.includes(actor.user.role)) return true;
  return lockLocationContext({ role: actor.user.role, locations: [...actor.locations] }, locationId);
}
