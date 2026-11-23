/**
 * Catering delivery (D1) — the access gates (plan r6 section 5). By trusted ROLE, checked before any I/O.
 * Zero I/O. Client-safe.
 *
 * LEVEL ALONE NEVER ADMITS. The prep manager and the social media manager are level 6 like the AGM, and both are
 * refused every write and every detail / cost read; the social media manager is refused the status read too.
 *
 *   status read    key holder and up (level 4+) with an active membership at the lead's CURRENT shop; the catering
 *                  manager at any shop; level 8+ at any shop. Never the social media manager.
 *   detail read    AGM / GM with an active membership at the lead's CURRENT shop; catering manager any; level 8+ any.
 *   write          the same set as detail. The SQL twin is `delivery_actor_role` (0356), re-checked on the locked users
 *                  row under the lead lock.
 *   cost read      the write gate (a person who may type the cost may read it).
 *   job history    JOB-scoped: AGM / GM with an active membership at THAT JOB's pickup shop
 *                  (`delivery_jobs.location_id`). For the pickup shop's managers after the order moved away; it never
 *                  opens the lead's current state, another shop's job, cost, or any write.
 *   settings       owner, CGS, MoO.
 *
 * Every lead-scoped gate binds to the lead's CURRENT shop: scope follows the lead, never the job's pickup shop.
 * `locations` is the actor's ACTIVE memberships (the session reads them live from user_locations where active).
 */
import { getRoleLevel, type RoleCode } from "@/lib/roles";

export interface DeliveryActor { role: RoleCode; active: boolean; locations: readonly string[] }

/** From the auth context (`AuthContext`): the trusted role, the user's active flag, the live memberships. */
export function deliveryActorOf(ctx: { role: RoleCode; locations: readonly string[]; user: { active: boolean } }): DeliveryActor {
  return { role: ctx.role, active: ctx.user.active, locations: ctx.locations };
}

/** Roles that manage deliveries at ANY shop: the catering manager and level 8+ (MoO, Owner, CGS). */
function anyShop(actor: DeliveryActor): boolean {
  return actor.role === "catering_mgr" || getRoleLevel(actor.role) >= 8;
}
function member(actor: DeliveryActor, shopId: string | null): boolean {
  return shopId !== null && actor.locations.includes(shopId);
}
const SHOP_MANAGERS: readonly RoleCode[] = ["gm", "agm"];
export const DELIVERY_SETTINGS_ROLES = ["owner", "cgs", "moo"] as const satisfies readonly RoleCode[];
/** Key holder and up. */
const STATUS_READ_MIN_LEVEL = 4;

export function deliveryWriteAllowed(actor: DeliveryActor, leadShopId: string | null): boolean {
  if (!actor.active) return false;
  if (anyShop(actor)) return true;
  return SHOP_MANAGERS.includes(actor.role) && member(actor, leadShopId);
}
export function deliveryDetailReadAllowed(actor: DeliveryActor, leadShopId: string | null): boolean {
  return deliveryWriteAllowed(actor, leadShopId);
}
export function deliveryCostReadAllowed(actor: DeliveryActor, leadShopId: string | null): boolean {
  return deliveryWriteAllowed(actor, leadShopId);
}
export function deliveryStatusReadAllowed(actor: DeliveryActor, leadShopId: string | null): boolean {
  if (!actor.active || actor.role === "social_media_mgr") return false;
  if (anyShop(actor)) return true;
  return getRoleLevel(actor.role) >= STATUS_READ_MIN_LEVEL && member(actor, leadShopId);
}
/** JOB-scoped. `jobPickupShopId` = `delivery_jobs.location_id`. */
export function deliveryJobHistoryReadAllowed(actor: DeliveryActor, jobPickupShopId: string | null): boolean {
  return actor.active && SHOP_MANAGERS.includes(actor.role) && member(actor, jobPickupShopId);
}
export function deliverySettingsWriteAllowed(actor: DeliveryActor): boolean {
  return actor.active && (DELIVERY_SETTINGS_ROLES as readonly RoleCode[]).includes(actor.role);
}
/** Could this person pass ANY delivery read gate at some shop? The coarse refusal before the first query. */
export function deliveryReadPossible(actor: DeliveryActor): boolean {
  if (!actor.active || actor.role === "social_media_mgr") return false;
  return anyShop(actor) || getRoleLevel(actor.role) >= STATUS_READ_MIN_LEVEL;
}
