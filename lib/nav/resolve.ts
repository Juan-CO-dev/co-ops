/**
 * The role-aware resolver over the destination list (nav spec r5, PR 3; plan r5 section 2.3).
 *
 * Used only by tests in PR 3; Go to, search and shortcuts consume it in later PRs. The legacy adapters
 * (lib/nav/legacy.ts) never call it. It reads the person's real role, level and the server switches the caller
 * passes, never "works as" (guard g).
 */
import type { RoleCode } from "@/lib/roles";
import { DESTINATIONS } from "@/lib/nav/destinations";
import type { Destination, Viewer } from "@/lib/nav/types";

/** A closed per-role menu, decided by REAL role before any level rule. Default: none (level rules apply). */
export const ROLE_MENUS: Readonly<Partial<Record<RoleCode, readonly string[]>>> = {
  social_media_mgr: ["dashboard", "training", "my-feedback", "me"], // spec 1, 3.3.6, 8.1
};

/** May this viewer open this destination? Level, trusted roles, switch. Planned pages never. */
export function canSee(d: Destination, v: Viewer): boolean {
  const a = d.access;
  const floor = a.floorWhenOn && v.switches[a.floorWhenOn.switch] ? a.floorWhenOn.minLevel : a.minLevel;
  const byLevel = v.level >= floor || (a.alsoRoles?.includes(v.role) ?? false);
  return byLevel
    && (a.onlyRoles === undefined || a.onlyRoles.includes(v.role))
    && (a.requires === undefined || v.switches[a.requires] === true)
    && (a.needsFact === undefined || !a.needsFact.roles.includes(v.role))
    && !d.planned;
}

/**
 * Go to / search / shortcuts (PRs 7, 9). Planned pages never. A role with a ROLE_MENUS entry gets that list, minus
 * anything tagged `numbers` (a second, independent line), minus what canSee refuses. In DESTINATIONS order.
 */
export function destinationsFor(v: Viewer, list: readonly Destination[] = DESTINATIONS, menus = ROLE_MENUS): Destination[] {
  const menu = menus[v.role];
  return list.filter((d) => (menu === undefined || (menu.includes(d.id) && !d.numbers)) && canSee(d, v));
}
