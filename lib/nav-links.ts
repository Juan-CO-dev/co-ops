import type { TranslationKey } from "@/lib/i18n/types";
import { byId } from "@/lib/nav/destinations";
import { chipLinks } from "@/lib/nav/legacy";

/** A primary navigation destination. */
export interface NavLink {
  key: TranslationKey;
  href: string;
  /** When true, append ?location=<selected> so the active location travels. */
  scoped: boolean;
  /**
   * Minimum role level that may actually REACH this destination. Omitted =
   * every level. Must mirror the destination's own gate: a chip that renders
   * for a level the page redirects away is a bounce, and it also advertises the
   * route through unified search (both consume navDestinationsFor).
   */
  minLevel?: number;
}

/**
 * Built destinations and their navigation role floors, in display order. Derived from the one destination list
 * (lib/nav/destinations.ts: each chip's key, route, floor and scope; lib/nav/legacy.ts: the order). Production's
 * floor is PRODUCE_MIN, Maintenance's MAINTENANCE_BASE_LEVEL (tests/nav-destinations-access.test.ts pins both).
 */
export const NAV_LINKS: NavLink[] = chipLinks();

/**
 * Destinations the given role level may reach, in display order:
 * mid-shift first, then eligible destinations, then admin (>=6) last.
 * Single source of truth for DashboardNav AND unified search — so a `minLevel`
 * filtered out here stops being both a nav chip AND a search hit.
 *
 * Mid-shift's floor follows the page it opens: with Pulse v2 on (PULSE_V2=1) the page serves
 * trainee and up, with crew getting the server-stripped view (PULSE_V2_BASE_LEVEL = 2); with it off,
 * the v1 page is key holder and up (MIDSHIFT_BASE_LEVEL = 4). The caller reads the flag.
 */
export function navDestinationsFor(level: number, opts?: { vault?: boolean; pulseV2?: boolean }): NavLink[] {
  const out: NavLink[] = [];
  const midShift = byId("mid-shift");
  // PULSE_V2_BASE_LEVEL : MIDSHIFT_BASE_LEVEL (the destination's floorWhenOn and minLevel)
  const midShiftFloor = opts?.pulseV2 ? midShift.access.floorWhenOn!.minLevel : midShift.access.minLevel;
  if (level >= midShiftFloor) out.push({ key: midShift.nameKey, href: midShift.route, scoped: true, minLevel: midShiftFloor });
  out.push(...NAV_LINKS.filter((l) => level >= (l.minLevel ?? 0)));
  // The password vault (0235) is a switched surface: the chip exists only while VAULT_ENABLED=1
  // (the caller reads the flag; this module stays pure). Every level has "My logins".
  const vault = byId("vault");
  if (opts?.vault) out.push({ key: vault.nameKey, href: vault.route, scoped: false });
  const admin = byId("admin");
  if (level >= admin.access.minLevel) out.push({ key: admin.nameKey, href: admin.route, scoped: false, minLevel: admin.access.minLevel });
  return out;
}

/** Append the active location to scoped destinations when one is selected. */
export function chipHref(href: string, scoped: boolean, locationId: string | null): string {
  return scoped && locationId ? `${href}?location=${locationId}` : href;
}

/** The scoped destinations whose pages read `?location=all` (the report hub's "all shops" scope). */
const ALL_SHOPS_DESTINATIONS: ReadonlySet<string> = new Set(["/reports", "/reports/trends", "/reports/written"]);

/**
 * `chipHref` for a surface whose scope can be the report hub's "all" (the unified search on
 * /reports/operations). "all" is a hub scope, not a shop: a page that does not read it would be handed
 * `?location=all` as if it were a shop id (a bounce or a failed query), so those destinations get no shop
 * and resolve their own (remembered, else first).
 */
export function chipHrefForScope(href: string, scoped: boolean, locationId: string | null): string {
  return chipHref(href, scoped, locationId === "all" && !ALL_SHOPS_DESTINATIONS.has(href) ? null : locationId);
}
