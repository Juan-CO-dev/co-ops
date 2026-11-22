/**
 * Shortcuts in place of the 16 "Explore" pills (nav PR 7, plan r2 2.3, 2.5; spec 3.2 item 7, 3.6). Server component.
 * The role's own list (shortcutsFor: real gates, surfaces held, no numbers for the social media manager), then "All pages"
 * (DashboardNav), which opens the top bar's Go to sheet (nav PR 9).
 * `actorRole` is the session's REAL role, never "works as".
 */
import { ActionLink } from "@/components/ActionButton";
import { DashboardNav } from "@/components/DashboardNav";
import { shortcutHref, shortcutsFor } from "@/lib/dashboard-day-shared";
import type { Surface } from "@/lib/day-plan-shared";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import type { Switches } from "@/lib/nav/types";
import type { RoleCode } from "@/lib/roles";

export function Shortcuts({ actorRole, actorLevel, surfaces, switches, shopId, language }: {
  actorRole: RoleCode;
  actorLevel: number;
  surfaces: ReadonlySet<Surface>;
  switches: Switches;
  shopId: string | null;
  language: Language;
}) {
  const list = shortcutsFor({ role: actorRole, level: actorLevel, surfaces, switches });
  return (
    <section aria-label={serverT(language, "dashboard.shortcuts.aria")} className="flex flex-col gap-3" data-shortcuts>
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-co-text-muted">{serverT(language, "dashboard.shortcuts.heading")}</h3>
      {list.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {list.map((d) => (
            <ActionLink key={d.id} href={shortcutHref(d, shopId)} variant="secondary" data-shortcut={d.id}>
              {serverT(language, d.nameKey)}
            </ActionLink>
          ))}
        </div>
      ) : null}
      <DashboardNav label={serverT(language, "dashboard.shortcuts.all_pages")} />
    </section>
  );
}
