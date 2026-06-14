"use client";

/**
 * BackToDashboard — fixed top-left "← Dashboard" affordance on authenticated
 * pages. Mirrors UserMenu's top-right floating pattern; the (authed) layout
 * reserves the top-left corner for it.
 *
 * Auto-hides on /dashboard itself (where a back-to-dashboard link is
 * redundant). Client component because it reads usePathname() for that gate.
 *
 * Fixes the dead-end-page class: operations surfaces (opening, prep, am-prep,
 * closing, overlay, synthesis) previously had no way back to the dashboard —
 * the only global chrome was UserMenu (language toggle). See also UserMenu's
 * Dashboard + Sign out dropdown items, the redundant-by-design companion.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";

export function BackToDashboard() {
  const { t } = useTranslation();
  const pathname = usePathname();

  // Redundant on the dashboard itself.
  if (pathname === "/dashboard") return null;

  return (
    <Link
      href="/dashboard"
      aria-label={t("nav.back_to_dashboard_aria")}
      className="
        inline-flex min-h-[40px] items-center gap-1.5 rounded-full
        border-2 border-co-border bg-co-surface px-3
        text-xs font-bold uppercase tracking-[0.12em] text-co-text
        transition hover:border-co-gold-deep
        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
      "
    >
      <span aria-hidden>←</span>
      {t("nav.dashboard")}
    </Link>
  );
}
