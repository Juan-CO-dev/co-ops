/**
 * PlaceholderCard — rendered by every module page that hasn't been built yet.
 *
 * Pattern from prototype's `PH` component. Shows the module title, a
 * description, and a feature list so the user (and future Cristian) can see
 * what's coming. Replaced module-by-module as features ship.
 *
 * Server component (async): it reads the viewer's language so its back link is
 * i18n'd — the stub pages that render it (settings, ai, training, etc.) live
 * OUTSIDE the (authed)/admin TranslationProvider trees, so there's no client
 * i18n context to lean on. The ~5ms session read matches the C.39-accepted
 * duplicate-read pattern used across the app.
 *
 * The back link targets a parent via props that default to the nav registry's
 * DEFAULT_PARENT (/dashboard) — every current stub legitimately returns to the
 * dashboard, and a future nested stub can override parentHref/parentLabelKey to
 * point at its own section instead. Pages whose parent layout already owns the
 * back affordance (the admin shell's registry BackLink) pass showBackLink=false.
 */

import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { DEFAULT_PARENT } from "@/lib/nav-parents";
import { requireSessionFromHeaders } from "@/lib/session";

interface PlaceholderCardProps {
  title: string;
  description: string;
  features: string[];
  /** "Phase B" by default; some modules will land in Phase C+. */
  shippingIn?: string;
  /**
   * Whether to render the built-in back link. Default true.
   * Set false when a parent layout already owns the back affordance (e.g.
   * the admin shell's registry BackLink), to avoid a duplicate.
   */
  showBackLink?: boolean;
  /** Back-link target. Defaults to the registry's DEFAULT_PARENT (/dashboard). */
  parentHref?: string;
  /** Back-link label key. Defaults to the registry's DEFAULT_PARENT label. */
  parentLabelKey?: TranslationKey;
}

export async function PlaceholderCard({
  title,
  description,
  features,
  shippingIn = "Phase B",
  showBackLink = true,
  parentHref = DEFAULT_PARENT.href,
  parentLabelKey = DEFAULT_PARENT.labelKey,
}: PlaceholderCardProps) {
  // Only pay the session read when we actually render the back link. The stub
  // pages are all proxy-gated, so a session is guaranteed to exist.
  const lang = showBackLink ? (await requireSessionFromHeaders(parentHref)).user.language : "en";

  return (
    <div className="mx-auto w-full max-w-[460px] p-3 pb-8">
      {showBackLink && (
        <Link
          href={parentHref}
          aria-label={serverT(lang, "nav.back_to_aria", { label: serverT(lang, parentLabelKey) })}
          className="
            -ml-2 mb-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 py-2
            text-xs font-bold uppercase tracking-[0.14em] text-co-text-muted
            transition hover:text-co-text
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
          "
        >
          <span aria-hidden>‹</span>
          <span>{serverT(lang, parentLabelKey)}</span>
        </Link>
      )}
      <div className="mb-3 flex items-center gap-2">
        <h2 className="m-0 text-base font-bold text-co-text">{title}</h2>
      </div>
      <div className="rounded-lg border border-co-gold bg-co-surface p-5 text-center">
        <h3 className="m-0 mb-1.5 text-sm font-bold text-co-gold">
          Coming in {shippingIn}
        </h3>
        <p className="m-0 mb-3 text-[11px] text-co-text-muted">
          {description}
        </p>
        <ul className="m-0 list-none p-0 text-left">
          {features.map((f, i) => (
            <li
              key={i}
              className="my-1 border-l-2 border-co-gold pl-2 text-[10px] text-[#aaa]"
            >
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
