"use client";

/**
 * AdminBackLink — context-aware back affordance for the admin chrome.
 *
 * On the hub root ("/admin") it returns to the dashboard; on any admin
 * section page ("/admin/...") it returns to the admin hub. Owned by
 * app/admin/layout.tsx so it's the single back link for the whole admin
 * subtree — section stub pages suppress PlaceholderCard's own back link
 * (showBackLink={false}) to avoid a duplicate.
 */

import { usePathname } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";

export function AdminBackLink() {
  const pathname = usePathname();
  const { t } = useTranslation();

  const onHub = pathname === "/admin";
  const href = onHub ? "/dashboard" : "/admin";
  const label = onHub ? t("admin.back_to_dashboard") : t("admin.back_to_hub");

  return (
    <a
      href={href}
      className="-ml-2 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 py-2 text-xs font-bold uppercase tracking-[0.14em] text-co-text-muted transition hover:text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
    >
      <span aria-hidden>‹</span>
      <span>{label}</span>
    </a>
  );
}
