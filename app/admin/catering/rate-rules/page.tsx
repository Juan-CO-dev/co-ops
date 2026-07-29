/**
 * /admin/catering/rate-rules — per-location catering rate editor (W1a, DOMAIN=rate).
 *
 * FINANCIAL: MoO+ (level >= 8, catering.kb.rate.write). Server component:
 * re-gate >= 8 defensively per the C.39 pattern (the admin shell already gates
 * >= 6 + mounts the StepUpProvider this page's client consumes), load the
 * accessible locations + per-location rate rules + catering menu items
 * (for per-entity overrides), hand to the client.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { loadRateRules, RATE_MIN } from "@/lib/admin/catering/rate-rules";
import { loadCateringMenuItems } from "@/lib/catering/menu";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { RateRulesClient } from "./rate-rules-client";
import { PageHeader } from "@/components/ui/PageHeader";
import type { RateRuleView } from "@/lib/admin/catering/rate-rules";
import type { CateringMenuItem } from "@/lib/catering/menu";

const RATE_ALL_LOCATIONS_MIN = 9;

/** The locations the actor can manage (mirrors lib but avoids re-importing privates). */
async function getManageableLocations(actor: {
  user: { id: string; role: string };
}): Promise<Array<{ id: string; name: string }>> {
  const sb = getServiceRoleClient();
  const { data: all } = await sb
    .from("locations")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string }>>();
  const locs = all ?? [];
  const level = ROLES[actor.user.role as keyof typeof ROLES].level;
  if (level >= RATE_ALL_LOCATIONS_MIN) return locs;
  const { data: ul } = await sb
    .from("user_locations")
    .select("location_id")
    .eq("user_id", actor.user.id)
    .eq("active", true)
    .returns<Array<{ location_id: string }>>();
  const assigned = new Set((ul ?? []).map((r) => r.location_id));
  return locs.filter((l) => assigned.has(l.id));
}

export interface LocationRateData {
  locationId: string;
  locationName: string;
  rules: RateRuleView[];
  menuItems: CateringMenuItem[];
}

export default async function AdminCateringRateRulesPage() {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < RATE_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const locations = await getManageableLocations(auth);

  // Load rules + menu items per location in parallel.
  const locationData: LocationRateData[] = await Promise.all(
    locations.map(async (loc) => {
      const [rules, menuItems] = await Promise.all([
        loadRateRules(auth, loc.id),
        loadCateringMenuItems(auth, loc.id),
      ]);
      return { locationId: loc.id, locationName: loc.name, rules, menuItems };
    }),
  );

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.catering.rate.title" as TranslationKey)}
        subtitle={serverT(lang, "admin.catering.rate.subtitle" as TranslationKey)}
      />
      <RateRulesClient locationData={locationData} actorLevel={level} />
    </div>
  );
}
