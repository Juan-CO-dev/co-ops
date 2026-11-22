/**
 * PlannedPage — the whole body of a route held for a feature that is planned
 * but not built (nav spec r5 §7.2: /tips, /announcements, /recipes,
 * /admin/audit, /feedback, /deep-cleaning, /comms).
 *
 * The feature's name and one honest sentence. No feature list, no phase or
 * module promise, nothing about who will get access: the real page arrives
 * with its own spec. None of these routes appears in any menu or search.
 *
 * Server component; both strings are translated here with serverT.
 *
 * Nav PR 9 (A1, Q2): the six non-admin planned pages sit outside both layouts,
 * so they pass `frame={auth}`: the whole page then renders inside its own
 * TranslationProvider and the top bar's NavFrame, which carries the idle-logout
 * warning every signed-in page tree must mount (spec §9). The admin page
 * (/admin/audit) passes NO frame and `backLink={false}`: the admin layout
 * already draws the bar, the idle guard and the registry back link, so it gets
 * no second bar and no second idle guard.
 */

import { BackLink } from "@/components/nav/BackLink";
import { NavFrame } from "@/components/nav/NavFrame";
import { TranslationProvider } from "@/lib/i18n/provider";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { AuthContext } from "@/lib/session";

export function PlannedPage({
  lang,
  titleKey,
  backLink = true,
  frame,
}: {
  lang: Language;
  titleKey: TranslationKey;
  backLink?: boolean;
  /** The page's own session, for a planned page outside both layouts: render inside the top bar's frame. */
  frame?: AuthContext;
}) {
  const body = (
    <div className="mx-auto w-full max-w-2xl p-3 pb-8">
      {backLink && (frame ? (
        <BackLink />
      ) : (
        <TranslationProvider initialLanguage={lang}>
          <BackLink />
        </TranslationProvider>
      ))}
      <h1 className="m-0 mb-3 text-base font-bold text-co-text">{serverT(lang, titleKey)}</h1>
      <p className="co-card m-0 px-4 py-3 text-sm text-co-text-muted">{serverT(lang, "planned.body")}</p>
    </div>
  );
  if (!frame) return body;
  return (
    <TranslationProvider initialLanguage={lang}>
      <NavFrame auth={frame} language={lang}>
        {body}
      </NavFrame>
    </TranslationProvider>
  );
}
