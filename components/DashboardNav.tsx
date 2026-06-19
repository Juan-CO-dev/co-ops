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
import type { Language } from "@/lib/i18n/types";
import { navDestinationsFor, chipHref } from "@/lib/nav-links";

interface DashboardNavProps {
  language: Language;
  actorLevel: number;
  /** The dashboard's active location id (from the LocationSwitcher / ?loc=). */
  selectedLocationId: string | null;
}

const CHIP_CLASS =
  "rounded-full border-2 border-co-border bg-co-surface px-3 py-1.5 text-sm font-semibold text-co-text " +
  "transition-[opacity,border-color,background-color] duration-150 hover:opacity-90 active:opacity-80";

export function DashboardNav({ language, actorLevel, selectedLocationId }: DashboardNavProps) {
  return (
    <nav aria-label={serverT(language, "nav.aria_label")}>
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
        {serverT(language, "nav.section_label")}
      </p>
      <div className="flex flex-wrap gap-2">
        {navDestinationsFor(actorLevel).map(({ key, href, scoped }) => (
          <a key={href} href={chipHref(href, scoped, selectedLocationId)} className={CHIP_CLASS}>
            {serverT(language, key)}
          </a>
        ))}
      </div>
    </nav>
  );
}
