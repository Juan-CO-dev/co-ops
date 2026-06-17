/**
 * DashboardNav — primary navigation bar for the dashboard.
 *
 * Server Component. Renders a flex-wrapped row of pill-shaped chip links
 * covering every non-report destination in the app.
 *
 * Location scoping: most destinations are per-location (Mid-Shift Pulse,
 * Reports Hub, Announcements, etc.). Those chips carry the dashboard's
 * currently-selected location as `?location=<id>` so the active location
 * travels with the user (matching how the report tiles link). Unified
 * destinations (Profile, Settings, Recipes, Comms, Training, Admin) are
 * user/company-wide and link bare. The Admin chip is GM+ (level >= 6); the
 * Mid-Shift Pulse chip is KH+ (level >= 4).
 *
 * Props mirror the dashboard page's resolved session values so no
 * additional session read is needed here.
 */

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";

interface DashboardNavProps {
  language: Language;
  actorLevel: number;
  /** The dashboard's active location id (from the LocationSwitcher / ?loc=). */
  selectedLocationId: string | null;
}

interface NavLink {
  key: TranslationKey;
  href: string;
  /** When true, append ?location=<selected> so the active location travels. */
  scoped: boolean;
}

const NAV_LINKS: NavLink[] = [
  { key: "nav.reports_hub", href: "/reports", scoped: true },
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
];

const CHIP_CLASS =
  "rounded-full border-2 border-co-border bg-co-surface px-3 py-1.5 text-sm font-semibold text-co-text hover:opacity-90";

/** Append the active location to scoped destinations when one is selected. */
function chipHref(href: string, scoped: boolean, locationId: string | null): string {
  return scoped && locationId ? `${href}?location=${locationId}` : href;
}

export function DashboardNav({ language, actorLevel, selectedLocationId }: DashboardNavProps) {
  return (
    <nav aria-label={serverT(language, "nav.aria_label")}>
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
        {serverT(language, "nav.section_label")}
      </p>
      <div className="flex flex-wrap gap-2">
        {actorLevel >= 4 ? (
          <a href={chipHref("/mid-shift", true, selectedLocationId)} className={CHIP_CLASS}>
            {serverT(language, "nav.mid_shift")}
          </a>
        ) : null}
        {NAV_LINKS.map(({ key, href, scoped }) => (
          <a key={href} href={chipHref(href, scoped, selectedLocationId)} className={CHIP_CLASS}>
            {serverT(language, key)}
          </a>
        ))}
        {actorLevel >= 6 ? (
          <a href="/admin" className={CHIP_CLASS}>
            {serverT(language, "nav.admin")}
          </a>
        ) : null}
      </div>
    </nav>
  );
}
