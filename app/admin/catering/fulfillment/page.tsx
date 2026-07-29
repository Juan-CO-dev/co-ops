/**
 * /admin/catering/fulfillment — per-store delivery zone editor.
 *
 * Server component: gate >= FULFILLMENT_MIN (7). Loads all active store nodes
 * (configured + unconfigured) and passes them to FulfillmentClient for the
 * map-based zone editor. Admin shell (auth boundary, providers) lives in
 * app/admin/layout.tsx; this page re-gates >= 7 defensively per the C.39 pattern.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { loadFulfillmentNodes, FULFILLMENT_MIN } from "@/lib/admin/catering/fulfillment";
import { FulfillmentClient } from "@/components/admin/catering/fulfillment/FulfillmentClient";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function AdminCateringFulfillmentPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < FULFILLMENT_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const nodes = await loadFulfillmentNodes(auth);

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.catering.fulfillment.title" as TranslationKey)}
        subtitle={serverT(lang, "admin.catering.fulfillment.subtitle" as TranslationKey)}
      />
      <FulfillmentClient nodes={nodes} actorLevel={level} />
    </div>
  );
}
