"use client";

/**
 * DashboardBackLink — in-flow "‹ Dashboard" back affordance (C.43 polish).
 * The muted-text ChevronLeft style Juan preferred over the earlier floating pill.
 * Client component so it can drop into server pages without threading `language`.
 * Place at the top of a page's content (not fixed-positioned).
 */

import Link from "next/link";

import { useTranslation } from "@/lib/i18n/provider";

export function DashboardBackLink() {
  const { t } = useTranslation();
  return (
    <Link
      href="/dashboard"
      aria-label={t("nav.back_to_dashboard_aria")}
      className="
        -ml-2 mb-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 py-2
        text-xs font-bold uppercase tracking-[0.14em] text-co-text-muted
        transition hover:text-co-text
        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
      "
    >
      <span aria-hidden>‹</span>
      <span>{t("nav.dashboard")}</span>
    </Link>
  );
}
