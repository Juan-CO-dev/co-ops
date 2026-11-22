/**
 * Which shops a person may ACT at, by surface: the all-shops access plan's one source of truth (plan r15, section 2
 * option (a); this file is PR 1). Pure: zero I/O, no clock, no env, client-safe under the `*-shared` rule.
 *
 * The ruling (Juan 2026-11-20): "MoO+ is a member of all shops. The catering manager can also work all shops etc."
 * It is decided by ROLE, never by level: level 6 is not one thing (AGM, catering manager, prep manager and social media
 * manager all sit there), and a role set states the ruling's intent where a threshold only happens to match it.
 *
 *   effective shops = real memberships  ∪  (every active shop, when the role holds the surface)
 *
 * What this module never does:
 *   - it never widens ROSTERS: `AuthContext.locations` / the JWT `locations` claim stay real memberships, and the
 *     "who appears on a list" questions (subjects) live in their own per-list table (plan r3 (C), PR 6);
 *   - it never changes a level FLOOR: a surface widens shops, not floors (the catering manager still cannot reach
 *     pricing at 8 or capacity at 7);
 *   - it decides nothing about whether a shop is active: "all" means every ACTIVE shop, resolved by the caller against
 *     `locations` at the I/O layer.
 *
 * PR 1 (this one) is ZERO behaviour change. Today level 8+ is exactly {moo, owner, cgs}, so the task and report-read
 * wrappers in lib/locations.ts (`canWorkShopTasks`, `shopTaskLocations`, `canReadReportLocation`), `worksShopTasks`
 * (lib/checklist-write-guard-shared.ts) and the two task binds in lib/checklists.ts read this module with the same
 * answers. The `ops` and `catering` surfaces are defined here but NOT consumed yet: `lockLocationContext`,
 * `isAllLocationsAccess` and `accessibleLocations` keep their level-9 rule until PR 3, and the catering gates move in
 * PR 4. tests/shop-access-matrix.test.ts proves every re-pointed gate equal to a frozen copy of the old one, and
 * tests/shop-access-twin.test.ts pins this role set as data for the SQL twin `public.all_shops_role` (PR 2).
 *
 * Changing who holds what is a ruling: change it here and in `all_shops_role` in the same PR (the twin test fails
 * otherwise), and list the widened cells in the matrix test's allowed differences (plan section 6).
 */
import type { RoleCode } from "./roles";

/**
 * The surfaces a membership authorizes. `ops`: operational reads and writes (cash, receiving, counts, ordering, POs,
 * production, maintenance, PM, stations, pars, catalog). `tasks`: the checklist family only (opening, closing, AM prep,
 * mid-day prep, task photos, the correction writers and the tag picker). `catering`: the catering trees. `report_read`:
 * report reads and the "All shops" report scope.
 */
export const SHOP_SURFACES = ["ops", "tasks", "catering", "report_read"] as const;
export type ShopSurface = (typeof SHOP_SURFACES)[number];

/** The ruling: these roles are members of every active shop, on every surface. */
export const ALL_SHOP_ROLES = ["moo", "owner", "cgs"] as const satisfies readonly RoleCode[];

/**
 * The catering manager works every shop on these surfaces only; everywhere else it keeps its real memberships, like an
 * AGM. Juan's Q1 adds `tasks`, but only in PR 5 together with its SQL writers and the twin (plan r3 → r4 item 4), and
 * PR 8 adds `schedule`. Until then: catering only.
 */
export const CATERING_ALL_SHOP_SURFACES: readonly ShopSurface[] = ["catering"];

/** True when `role` holds EVERY active shop on `surface`, membership or not. */
export function holdsAllShops(role: RoleCode, surface: ShopSurface): boolean {
  if ((ALL_SHOP_ROLES as readonly RoleCode[]).includes(role)) return true;
  return role === "catering_mgr" && CATERING_ALL_SHOP_SURFACES.includes(surface);
}

/**
 * The actor shape every gate reads. `locations` = the person's ACTIVE memberships (the session and
 * `resolveChecklistWriteActor` read `user_locations.active` fresh). `active` is optional: a session actor is active by
 * construction; a verified checklist actor carries the flag, and `false` refuses every shop.
 */
export interface ShopActor {
  readonly role: RoleCode;
  readonly locations: readonly string[];
  readonly active?: boolean;
}

/** May this actor act at `shopId` on `surface`? A member of the shop, or a role that holds every shop there. */
export function canActAtShop(actor: ShopActor, shopId: string, surface: ShopSurface): boolean {
  if (actor.active === false) return false;
  return holdsAllShops(actor.role, surface) || actor.locations.includes(shopId);
}

/**
 * The shops this actor acts at on `surface`: the sentinel `"all"` (every ACTIVE shop; the caller resolves the list at
 * the I/O layer) when the role holds the surface, else a copy of the memberships. An inactive actor acts nowhere.
 */
export function actingShops(actor: ShopActor, surface: ShopSurface): string[] | "all" {
  if (actor.active === false) return [];
  return holdsAllShops(actor.role, surface) ? "all" : [...actor.locations];
}

/**
 * Memberships first, then every other active shop: the one ordering every all-shops picker uses (the ordering
 * `reportShopCandidates` in lib/shop-context-shared.ts already gives level 8+). Without the grant, the memberships.
 */
export function orderActingShops(
  memberships: readonly string[],
  activeShopIds: readonly string[],
  allShops: boolean,
): string[] {
  if (!allShops) return [...memberships];
  return [...memberships, ...activeShopIds.filter((id) => !memberships.includes(id))];
}
