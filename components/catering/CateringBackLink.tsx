"use client";

/**
 * CateringBackLink — in-flow "‹ Catering" back affordance for catering sub-pages
 * (pipeline / quotes / customers / insights). Mirrors DashboardBackLink's muted style,
 * pointing at the catering hub so the nav hierarchy is dashboard → catering → sub-page
 * (like reports → trends landing → ops). Client component so it drops into server pages
 * without threading `language`.
 */

import Link from "next/link";

import { useTranslation } from "@/lib/i18n/provider";

export function CateringBackLink() {
  const { t } = useTranslation();
  return (
    <Link
      href="/catering"
      className="
        -ml-2 mb-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 py-2
        text-xs font-bold uppercase tracking-[0.14em] text-co-text-muted
        transition hover:text-co-text
        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
      "
    >
      <span aria-hidden>‹</span>
      <span>{t("catering.nav.back_to_catering")}</span>
    </Link>
  );
}
