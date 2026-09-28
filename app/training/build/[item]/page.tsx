/**
 * /training/build/[item] — "Learn the build" (co-scenes spec §9).
 *
 * Same gate as /training (any signed-in user). The steps are joined here, on the
 * server, from the item's build DEF (canonical order + en/es how-to) and its
 * exported CARD (amounts from docs/seed/source/sandwich-build-sheet.csv; see
 * lib/training/build-card-shared.ts). Both languages ship to the client so the
 * language toggle never needs a round-trip for the steps.
 *
 * Unknown slugs 404. Adding an item = a BUILD_DEFS entry + its card export.
 */

import { notFound } from "next/navigation";

import { BackLink } from "@/components/nav/BackLink";
import { LearnTheBuild } from "@/components/training/LearnTheBuild";
import { TranslationProvider } from "@/lib/i18n/provider";
import { buildCardForSlug } from "@/lib/training/build-cards";
import { buildDefForSlug, buildSteps } from "@/lib/training/build-card-shared";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function LearnTheBuildPage({ params }: { params: Promise<{ item: string }> }) {
  const { item: slug } = await params;
  const auth = await requireSessionFromHeaders(`/training/build/${encodeURIComponent(slug)}`);
  const def = buildDefForSlug(slug);
  const card = buildCardForSlug(slug);
  if (!def || !card) notFound();

  const steps = { en: buildSteps(def, card, "en"), es: buildSteps(def, card, "es") };

  return (
    <TranslationProvider initialLanguage={auth.user.language}>
      <div className="mx-auto w-full max-w-3xl px-3 pt-3">
        <BackLink />
      </div>
      <LearnTheBuild item={def.item} steps={steps} />
    </TranslationProvider>
  );
}
