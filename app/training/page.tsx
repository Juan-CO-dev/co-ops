/**
 * /training — the three written guides, read inside the app.
 *
 * Managers start on the app Monday 2026-09-21 and this is what they train from,
 * so the guides stop being repo files a manager cannot open and become the page
 * the nav already points at. The Markdown in docs/guides is the single source:
 * nothing is copied here, and re-shooting a walk updates the page.
 *
 * Server component. It keeps the placeholder's gate exactly
 * (`requireSessionFromHeaders("/training")`), reads the viewer's language fresh
 * from the session for BOTH the chrome strings and the Spanish note, decides
 * which guides this role may read, parses only those, and hands the trees to the
 * client reader. /training sits outside the (authed) group, so there is no
 * TranslationProvider above it — every string crosses the boundary already
 * translated, as PlaceholderCard does for the remaining stubs.
 */

import { BackLink } from "@/components/nav/BackLink";
import { TranslationProvider } from "@/lib/i18n/provider";
import { GuideReader, type GuideTab } from "@/components/training/GuideReader";
import { guidesForLevel, resolveInitialGuide } from "@/lib/guides/access-shared";
import { loadGuide } from "@/lib/guides/content";
import type { GuideSlug } from "@/lib/guides/markdown-shared";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { requireSessionFromHeaders } from "@/lib/session";

const TAB_LABEL_KEY: Record<GuideSlug, TranslationKey> = {
  staff: "training.tab.staff",
  manager: "training.tab.manager",
  catering: "training.tab.catering",
};

export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ guide?: string | string[] }>;
}) {
  const auth = await requireSessionFromHeaders("/training");
  const lang = auth.user.language;

  const available = guidesForLevel(auth.level);
  const requested = (await searchParams).guide;
  const initialGuide = resolveInitialGuide(
    auth.role,
    available,
    Array.isArray(requested) ? requested[0] : requested,
  );

  const title = serverT(lang, "training.title");

  // Nobody below trainee has a guide written for them yet — say so plainly
  // rather than rendering an empty reader.
  if (!initialGuide) {
    return (
      <TranslationProvider initialLanguage={lang}>
        <div className="mx-auto w-full max-w-3xl p-3 pb-8">
          <BackLink hrefOverride="/dashboard" labelKey="nav.dashboard" />
          <h1 className="m-0 mb-2 text-base font-bold text-co-text">{title}</h1>
          <p className="co-card m-0 px-4 py-3 text-sm text-co-text-muted">
            {serverT(lang, "training.none")}
          </p>
        </div>
      </TranslationProvider>
    );
  }

  const guides: GuideTab[] = available.map((slug) => {
    const doc = loadGuide(slug);
    return {
      slug,
      label: serverT(lang, TAB_LABEL_KEY[slug]),
      doc,
      contentsCount: serverT(lang, "training.contents.count", { n: doc.sections.length }),
    };
  });

  return (
    // BackLink is a client component and reads the translation context; the
    // reader itself takes pre-translated props and needs none of it.
    <TranslationProvider initialLanguage={lang}>
      <div className="mx-auto w-full max-w-3xl px-3 pt-3">
        <BackLink hrefOverride="/dashboard" labelKey="nav.dashboard" />
      </div>
      <GuideReader
        title={title}
        description={serverT(lang, "training.description")}
        spanishNote={lang === "es" ? serverT(lang, "training.spanish_note") : null}
        labels={{
          contents: serverT(lang, "training.contents"),
          backToTop: serverT(lang, "training.back_to_top"),
          tabsAria: serverT(lang, "training.tabs_aria"),
          // Passed as the raw template — the heading name is only known in the
          // reader, which does the one {section} substitution itself.
          sectionLinkAria: serverT(lang, "training.section_link_aria"),
        }}
        guides={guides}
        initialGuide={initialGuide}
      />
    </TranslationProvider>
  );
}
