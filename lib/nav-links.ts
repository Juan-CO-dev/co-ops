import type { TranslationKey } from "@/lib/i18n/types";

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

/** Built destinations and their navigation role floors, in display order. */
export const NAV_LINKS: NavLink[] = [
  { key: "nav.reports_hub", href: "/reports", scoped: true, minLevel: 2 },
  { key: "nav.assignments", href: "/assignments", scoped: true },
  { key: "nav.trends", href: "/reports/trends", scoped: true, minLevel: 4 },
  { key: "nav.lto", href: "/lto", scoped: true, minLevel: 6 },
  { key: "nav.written_reports", href: "/reports/written", scoped: true, minLevel: 2 },
  { key: "nav.catering", href: "/catering", scoped: true, minLevel: 5 },
  { key: "maintenance.nav_label", href: "/maintenance", scoped: true, minLevel: 3 }, // MAINTENANCE_BASE_LEVEL
  { key: "nav.training", href: "/training", scoped: false },
  { key: "nav.recipes", href: "/admin/recipes", scoped: false, minLevel: 6 },
  { key: "nav.profile", href: "/profile", scoped: false },
  { key: "nav.settings", href: "/settings", scoped: false },
  { key: "nav.my_feedback", href: "/my-feedback", scoped: false },
];

/**
 * Destinations the given role level may reach, in display order:
 * mid-shift (>=4) first, then eligible destinations, then admin (>=6) last.
 * Single source of truth for DashboardNav AND unified search — so a `minLevel`
 * filtered out here stops being both a nav chip AND a search hit.
 */
export function navDestinationsFor(level: number, opts?: { vault?: boolean }): NavLink[] {
  const out: NavLink[] = [];
  if (level >= 4) out.push({ key: "nav.mid_shift", href: "/mid-shift", scoped: true, minLevel: 4 });
  out.push(...NAV_LINKS.filter((l) => level >= (l.minLevel ?? 0)));
  // The password vault (0235) is a switched surface: the chip exists only while VAULT_ENABLED=1
  // (the caller reads the flag; this module stays pure). Every level has "My logins".
  if (opts?.vault) out.push({ key: "nav.vault", href: "/vault", scoped: false });
  if (level >= 6) out.push({ key: "nav.admin", href: "/admin", scoped: false, minLevel: 6 });
  return out;
}

/** Append the active location to scoped destinations when one is selected. */
export function chipHref(href: string, scoped: boolean, locationId: string | null): string {
  return scoped && locationId ? `${href}?location=${locationId}` : href;
}
