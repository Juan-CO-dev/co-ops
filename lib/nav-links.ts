import type { TranslationKey } from "@/lib/i18n/types";

/** A primary navigation destination. */
export interface NavLink {
  key: TranslationKey;
  href: string;
  /** When true, append ?location=<selected> so the active location travels. */
  scoped: boolean;
}

/** The always-available destinations (level-independent), in display order. */
export const NAV_LINKS: NavLink[] = [
  { key: "nav.reports_hub", href: "/reports", scoped: true },
  { key: "nav.trends", href: "/reports/trends", scoped: true },
  { key: "nav.announcements", href: "/announcements", scoped: true },
  { key: "nav.ordering", href: "/ordering", scoped: true },
  { key: "nav.tips", href: "/tips", scoped: true },
  { key: "nav.ai", href: "/ai", scoped: true },
  { key: "nav.rollups", href: "/rollups", scoped: true },
  { key: "nav.deep_cleaning", href: "/deep-cleaning", scoped: true },
  { key: "nav.feedback", href: "/feedback", scoped: true },
  { key: "nav.lto", href: "/lto", scoped: true },
  { key: "nav.written_reports", href: "/written-reports", scoped: true },
  { key: "nav.catering", href: "/catering", scoped: true },
  // Unified — user/company-wide, no location context.
  { key: "nav.training", href: "/training", scoped: false },
  { key: "nav.recipes", href: "/recipes", scoped: false },
  { key: "nav.comms", href: "/comms", scoped: false },
  { key: "nav.profile", href: "/profile", scoped: false },
  { key: "nav.settings", href: "/settings", scoped: false },
  // My Feedback — unified (per-user, all levels; no ?location= suffix).
  { key: "nav.my_feedback", href: "/my-feedback", scoped: false },
];

/**
 * Destinations the given role level may reach, in display order:
 * mid-shift (>=4) first, then the always-available set, then admin (>=6) last.
 * Single source of truth for DashboardNav AND unified search.
 */
export function navDestinationsFor(level: number): NavLink[] {
  const out: NavLink[] = [];
  if (level >= 4) out.push({ key: "nav.mid_shift", href: "/mid-shift", scoped: true });
  out.push(...NAV_LINKS);
  if (level >= 6) out.push({ key: "nav.admin", href: "/admin", scoped: false });
  return out;
}

/** Append the active location to scoped destinations when one is selected. */
export function chipHref(href: string, scoped: boolean, locationId: string | null): string {
  return scoped && locationId ? `${href}?location=${locationId}` : href;
}
