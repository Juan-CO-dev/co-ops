/**
 * /admin/catering/zones — Catering delivery-zone per-location editor
 * (Wave 1 slice 1A).
 *
 * Server component: gate ≥7 (mirrors the hub card minLevel + the route/lib
 * floor for catering.kb.delivery_zones.write), load the per-location zone
 * groups server-side, hand to the client surface. The admin shell (auth
 * boundary, level>=6, providers) lives in app/admin/layout.tsx; this page
 * re-gates ≥7 defensively per the C.39 pattern.
 */

import { redirect } from "next/navigation";
import type { TranslationKey } from "@/lib/i18n/types";
import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { loadZoneGroups } from "@/lib/admin/catering/zones";
import { ZonesClient } from "@/components/admin/catering/zones/ZonesClient";

const MIN = 7;

export default async function AdminCateringZonesPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const [groups] = await Promise.all([loadZoneGroups(auth)]);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.catering.zones.title" as TranslationKey)}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">
        {serverT(lang, "admin.catering.zones.subtitle" as TranslationKey)}
      </p>
      <ZonesClient groups={groups} actorLevel={level} />
    </div>
  );
}
