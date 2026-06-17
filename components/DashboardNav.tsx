/**
 * DashboardNav — primary navigation bar for the dashboard.
 *
 * Server Component. Renders a flex-wrapped row of pill-shaped chip links
 * covering every non-report destination in the app. The Admin chip is
 * conditionally rendered for GM+ (actorLevel >= 6).
 *
 * Props mirror the dashboard page's resolved session values so no
 * additional session read is needed here.
 */

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";

interface DashboardNavProps {
  language: Language;
  actorLevel: number;
}

interface NavLink {
  key:
    | "nav.reports_hub"
    | "nav.announcements"
    | "nav.training"
    | "nav.recipes"
    | "nav.ordering"
    | "nav.tips"
    | "nav.comms"
    | "nav.ai"
    | "nav.rollups"
    | "nav.deep_cleaning"
    | "nav.feedback"
    | "nav.lto"
    | "nav.written_reports"
    | "nav.catering"
    | "nav.profile"
    | "nav.settings"
    | "nav.mid_shift";
  href: string;
}

const NAV_LINKS: NavLink[] = [
  { key: "nav.reports_hub", href: "/reports" },
  { key: "nav.announcements", href: "/announcements" },
  { key: "nav.training", href: "/training" },
  { key: "nav.recipes", href: "/recipes" },
  { key: "nav.ordering", href: "/ordering" },
  { key: "nav.tips", href: "/tips" },
  { key: "nav.comms", href: "/comms" },
  { key: "nav.ai", href: "/ai" },
  { key: "nav.rollups", href: "/rollups" },
  { key: "nav.deep_cleaning", href: "/deep-cleaning" },
  { key: "nav.feedback", href: "/feedback" },
  { key: "nav.lto", href: "/lto" },
  { key: "nav.written_reports", href: "/written-reports" },
  { key: "nav.catering", href: "/catering" },
  { key: "nav.profile", href: "/profile" },
  { key: "nav.settings", href: "/settings" },
];

const CHIP_CLASS =
  "rounded-full border-2 border-co-border bg-co-surface px-3 py-1.5 text-sm font-semibold text-co-text hover:opacity-90";

export function DashboardNav({ language, actorLevel }: DashboardNavProps) {
  return (
    <nav aria-label={serverT(language, "nav.aria_label")}>
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
        {serverT(language, "nav.section_label")}
      </p>
      <div className="flex flex-wrap gap-2">
        {actorLevel >= 4 ? (
          <a href="/mid-shift" className={CHIP_CLASS}>
            {serverT(language, "nav.mid_shift")}
          </a>
        ) : null}
        {NAV_LINKS.map(({ key, href }) => (
          <a key={href} href={href} className={CHIP_CLASS}>
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
