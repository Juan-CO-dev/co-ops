"use client";

/**
 * BackLink — THE single back affordance for the whole app.
 *
 * Replaces the five bespoke back components (AdminBackLink, CateringBackLink,
 * DashboardBackLink, BackToTrendsLink, and PlaceholderCard's inline anchor).
 * The target is derived from the route→parent registry (lib/nav-parents.ts)
 * via longest-prefix match on the current pathname, so a page never hardcodes
 * where "back" goes — it just renders <BackLink/> and the registry resolves
 * the correct parent (recipes/[id]→/admin/recipes, catering sub-page→
 * /admin/catering, report detail→/reports, etc.).
 *
 * One visual idiom: the muted uppercase chevron style (‹ glyph), 44px tall,
 * next/link (never <a> — no full reload). aria-label is i18n'd.
 *
 * Overrides for edge cases:
 *   - hrefOverride  — force a specific target instead of the registry's
 *   - labelKey      — force a specific label instead of the parent's
 *   - search        — query string to append to the target (e.g. "?location=x"),
 *                     so drill-ins return to a location-scoped list
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { parentFor } from "@/lib/nav-parents";

export function BackLink({
  hrefOverride,
  labelKey,
  search,
  className,
}: {
  hrefOverride?: string;
  labelKey?: TranslationKey;
  /** Query string (with leading "?") appended to the resolved href. */
  search?: string;
  /** Extra classes merged after the base style (rarely needed). */
  className?: string;
}) {
  const pathname = usePathname();
  const { t } = useTranslation();

  const parent = parentFor(pathname ?? "/");
  const baseHref = hrefOverride ?? parent.href;
  const href = search ? `${baseHref}${search}` : baseHref;
  const label = t(labelKey ?? parent.labelKey);

  return (
    <Link
      href={href}
      aria-label={t("nav.back_to_aria", { label })}
      className={`-ml-2 mb-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 py-2 text-xs font-bold uppercase tracking-[0.14em] text-co-text-muted transition hover:text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60${className ? ` ${className}` : ""}`}
    >
      <span aria-hidden>‹</span>
      <span>{label}</span>
    </Link>
  );
}
