/**
 * /admin/catering/pricing — per-location catering pricing & tax editor
 * (Catering KB, Wave 1 slice 1A, DOMAIN=pricing).
 *
 * FINANCIAL: MoO+ (level >= 8, catering.kb.pricing.write). Server component:
 * re-gate >= 8 defensively per the C.39 pattern (the admin shell already gates
 * >= 6 + mounts the StepUpProvider this page's client consumes), load the
 * per-location rules server-side via the lib loader, hand to the client.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { loadPricingRules, PRICING_MIN } from "@/lib/admin/catering/pricing";
import { PricingClient } from "@/components/admin/catering/pricing/PricingClient";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function AdminCateringPricingPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < PRICING_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const [rules] = await Promise.all([loadPricingRules(auth)]);

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.catering.pricing.title" as TranslationKey)}
        subtitle={serverT(lang, "admin.catering.pricing.subtitle" as TranslationKey)}
      />
      <PricingClient rules={rules} actorLevel={level} />
    </div>
  );
}
