/**
 * DashboardNav — the Dashboard's "All pages" list (nav PR 7, plan r2 2.5; spec 3.2 item 7).
 *
 * Server Component. A native <details>, collapsed, under the role's shortcuts: until PR 9 (Go to, the top bar) it is the
 * only route from the Dashboard to the rest of the app, so it keeps today's full chip list for everyone but the social
 * media manager, whose list is its closed role menu (lib/nav/resolve.ts ROLE_MENUS) minus the Dashboard itself:
 * Training, My performance, Me.
 *
 * Location scoping: per-location destinations carry the Dashboard's selected shop as `?location=<id>`; unified ones
 * (Profile, Settings, Recipes, Comms, Training, Admin) link bare. The switches are the request's ONE read
 * (lib/nav-switches.ts), passed in; this component reads no environment.
 */

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import type { RoleCode } from "@/lib/roles";
import { navDestinationsFor, chipHref, type NavLink } from "@/lib/nav-links";
import { destinationsFor, ROLE_MENUS } from "@/lib/nav/resolve";
import type { Switches } from "@/lib/nav/types";

interface DashboardNavProps {
  language: Language;
  actorLevel: number;
  /** The dashboard's active location id (from the LocationSwitcher / ?loc=). */
  selectedLocationId: string | null;
  /** The session's REAL role (never "works as"): a role the report family refuses gets no report chip (nav PR 4). */
  actorRole: RoleCode;
  /** The request's switches, read once by the page (navSwitches()). */
  switches: Switches;
}

const CHIP_CLASS =
  "inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border bg-co-surface px-3 py-1.5 text-sm font-semibold text-co-text " +
  "transition-[opacity,border-color,background-color] duration-150 hover:opacity-90 active:opacity-80";

/** The chips: a closed role menu when the role has one (minus the Dashboard), else today's full list. */
function chipsFor(actorLevel: number, actorRole: RoleCode, switches: Switches): NavLink[] {
  if (ROLE_MENUS[actorRole] !== undefined) {
    return destinationsFor({ role: actorRole, level: actorLevel, switches }).filter((d) => d.id !== "dashboard")
      .map((d) => ({ key: d.nameKey, href: d.route, scoped: d.takesShop && d.legacy?.chipScoped !== false }));
  }
  return navDestinationsFor(actorLevel, { vault: switches.vault, pulseV2: switches.pulseV2, role: actorRole });
}

export function DashboardNav({ language, actorLevel, selectedLocationId, actorRole, switches }: DashboardNavProps) {
  return (
    <nav aria-label={serverT(language, "nav.aria_label")}>
      <details className="group">
        <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-sm font-bold text-co-text">
          {serverT(language, "dashboard.shortcuts.all_pages")}
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {chipsFor(actorLevel, actorRole, switches).map(({ key, href, scoped }) => (
            <a key={href} href={chipHref(href, scoped, selectedLocationId)} className={CHIP_CLASS}>
              {serverT(language, key)}
            </a>
          ))}
        </div>
      </details>
    </nav>
  );
}
