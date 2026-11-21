/**
 * PlannedPage — the whole body of a route held for a feature that is planned
 * but not built (nav spec r5 §7.2: /tips, /announcements, /recipes,
 * /admin/audit, /feedback, /deep-cleaning, /comms).
 *
 * The feature's name and one honest sentence. No feature list, no phase or
 * module promise, nothing about who will get access: the real page arrives
 * with its own spec. None of these routes appears in any menu or search.
 *
 * Server component. The non-admin planned pages sit outside both layouts, so
 * there is no TranslationProvider above them: every string is translated here
 * with serverT, and the back link is a plain server-rendered anchor in the
 * BackLink idiom. The admin page passes `backLink={false}` because the admin
 * shell already draws the registry back link.
 */

import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { DEFAULT_PARENT } from "@/lib/nav-parents";

export function PlannedPage({
  lang,
  titleKey,
  backLink = true,
}: {
  lang: Language;
  titleKey: TranslationKey;
  backLink?: boolean;
}) {
  const parentLabel = serverT(lang, DEFAULT_PARENT.labelKey);
  return (
    <div className="mx-auto w-full max-w-2xl p-3 pb-8">
      {backLink && (
        <Link
          href={DEFAULT_PARENT.href}
          aria-label={serverT(lang, "nav.back_to_aria", { label: parentLabel })}
          className="
            -ml-2 mb-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 py-2
            text-xs font-bold uppercase tracking-[0.14em] text-co-text-muted
            transition hover:text-co-text
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
          "
        >
          <span aria-hidden>‹</span>
          <span>{parentLabel}</span>
        </Link>
      )}
      <h1 className="m-0 mb-3 text-base font-bold text-co-text">{serverT(lang, titleKey)}</h1>
      <p className="co-card m-0 px-4 py-3 text-sm text-co-text-muted">{serverT(lang, "planned.body")}</p>
    </div>
  );
}
