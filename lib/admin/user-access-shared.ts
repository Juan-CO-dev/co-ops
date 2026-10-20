/**
 * WHO MAY MANAGE WHICH USER — pure, client-safe (staff separations ADDENDUM, Juan 2026-10-20: "should extend down to
 * GMs also").
 *
 * - User management opens at GM (level 7). MoO (8) and up keep exactly what they had: any user strictly below their own
 *   level (`canActOn`), wherever that user works.
 * - A GM manages ONLY the people of their own shop(s): the target is strictly below GM (canActOn: 7 > target), holds at
 *   least one active membership, and EVERY active membership of the target is at a shop where the GM holds an active
 *   membership. A user who also works at a shop the GM does not belong to is that other shop's (or the MoO's) to manage.
 * - Never oneself (canActOn is strict, so an equal level — oneself included — is refused).
 *
 * The lib (lib/admin/users.ts `loadActionableTarget`) and the UI (the per-row "can act" decision) ask THIS function;
 * the SQL twin for the employment writer lives in 0279 (`record_user_employment_event`).
 */
import { canActOn, getRoleLevel, type RoleCode } from "@/lib/roles";

/** User management opens at GM. */
export const USER_ADMIN_MIN_LEVEL = 7;
/** From MoO up, a user's shops do not limit who may manage them. */
export const USER_ADMIN_ANY_SHOP_LEVEL = 8;

export interface UserAdminActor {
  userId: string;
  role: RoleCode;
  /** The actor's active shop memberships (the session's `locations`). */
  locations: readonly string[];
}
export interface UserAdminTarget {
  id: string;
  role: RoleCode;
  /** The target's ACTIVE shop memberships. */
  locationIds: readonly string[];
}

export type UserAdminRefusal = "forbidden" | "target_outside_shop";

export function canOpenUserAdmin(role: RoleCode): boolean {
  return getRoleLevel(role) >= USER_ADMIN_MIN_LEVEL;
}

/** A GM's list is their own shops' people; MoO+ see everyone (null = no shop scope). */
export function userAdminListScope(actor: Pick<UserAdminActor, "role" | "locations">): readonly string[] | null {
  return getRoleLevel(actor.role) >= USER_ADMIN_ANY_SHOP_LEVEL ? null : actor.locations;
}

/** Null when the actor may manage the target; otherwise the named refusal. */
export function userAdminRefusal(actor: UserAdminActor, target: UserAdminTarget): UserAdminRefusal | null {
  if (!canOpenUserAdmin(actor.role)) return "forbidden";
  if (target.id === actor.userId || !canActOn(actor.role, target.role)) return "forbidden";
  if (getRoleLevel(actor.role) >= USER_ADMIN_ANY_SHOP_LEVEL) return null;
  if (target.locationIds.length === 0) return "target_outside_shop";
  const mine = new Set(actor.locations);
  return target.locationIds.every((l) => mine.has(l)) ? null : "target_outside_shop";
}
