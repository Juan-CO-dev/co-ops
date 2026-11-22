"use client";

/**
 * The bar's "Dashboard" link (nav PR 9, plan r2 3.1; spec 4.1 bullet 1). Hidden on /dashboard itself. A BARE /dashboard:
 * the Dashboard resolves the shop from ?loc → the remembered `co_shop` cookie → the first allowed, and ShopContextSync has
 * already remembered any declared page's shop. `prefetch={false}`: from an admin page a prefetch would render the
 * (authed) layout, whose session check clears the step-up unlock (plan 6.2).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";

export function TopBarDashboardLink() {
  const { t } = useTranslation();
  const pathname = usePathname();
  if (pathname === "/dashboard") return null;
  return (
    <Link
      href="/dashboard"
      prefetch={false}
      data-co-dashboard-link=""
      className="
        -ml-2 inline-flex min-h-[44px] items-center rounded-md px-2 text-xs font-bold uppercase tracking-[0.14em]
        text-co-text-muted transition hover:text-co-text
        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
      "
    >
      {t("nav.dashboard")}
    </Link>
  );
}
