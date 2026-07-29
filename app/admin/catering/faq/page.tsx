/**
 * /admin/catering/faq — Catering FAQ list editor (Wave 1 slice 1A).
 *
 * Server component: gate ≥6 (mirrors the hub card minLevel), load FAQs +
 * locations server-side, hand to the client surface. The admin shell (auth
 * boundary, level>=6, providers) lives in app/admin/layout.tsx; this page
 * re-gates ≥6 defensively per the C.39 pattern.
 */

import { redirect } from "next/navigation";
import type { TranslationKey } from "@/lib/i18n/types";
import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadFaqs, loadFaqLocations } from "@/lib/admin/catering/faq";
import { FaqClient } from "@/components/admin/catering/faq/FaqClient";
import { PageHeader } from "@/components/ui/PageHeader";

const MIN = 6;

export default async function AdminCateringFaqPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const [faqs, locations] = await Promise.all([
    loadFaqs(auth),
    loadFaqLocations(auth),
  ]);

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.catering.faq.title" as TranslationKey)}
        subtitle={serverT(lang, "admin.catering.faq.subtitle" as TranslationKey)}
      />
      <FaqClient faqs={faqs} locations={locations} actorLevel={level} />
    </div>
  );
}
