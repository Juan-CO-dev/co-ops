/**
 * /admin/catering/prep-demand — W4a Catering Prep Demand manager view.
 *
 * READ-ONLY forward-looking surface: for a selected location, shows upcoming
 * catering prep demand per date (from confirmed/reserved leads), with an
 * over-par alert + a manual par-bump affordance. No mutations, no step-up.
 * DORMANT-safe: with 0 data it renders an empty state.
 *
 * Gate: level >= PREP_DEMAND_READ_MIN (6). Admin shell (auth boundary, level
 * >= 6, providers) lives in app/admin/layout.tsx; this page re-gates
 * defensively per the C.39 pattern.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { resolveShop } from "@/lib/shop-context";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { loadPackageLocations } from "@/lib/admin/catering/packages";
import { loadCateringPrepDemand, PREP_DEMAND_READ_MIN } from "@/lib/catering/prep-demand";
import { loadCateringSkuDemand, type CateringSkuDemand } from "@/lib/catering/sku-demand";
import { loadCateringSurplus, type SurplusDay } from "@/lib/catering/surplus";
import { PrepDemandClient } from "@/components/admin/catering/prep-demand/PrepDemandClient";
import { isPrepDemandTab } from "@/lib/catering/prep-demand-shared";
import { PageHeader } from "@/components/ui/PageHeader";

/** YYYY-MM-DD of today (request-time) in operational TZ. */
function todayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Add `days` calendar days to a YYYY-MM-DD string. */
function addDays(yyyymmdd: string, days: number): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  if (!y || !m || !d) return yyyymmdd;
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export default async function AdminCateringPrepDemandPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < PREP_DEMAND_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const sp = await searchParams;
  const locations = await loadPackageLocations(auth);

  // Active location (B2): ?location= when allowed, else the remembered shop, else the first.
  const paramLocation = shopParamFor("/admin/catering/prep-demand", searchParamValues(sp));
  const locationId = (await resolveShop(locations, paramLocation))?.id ?? null;
  // A deep link (the catering digest) may name the first tab: ?tab=prep|sku|surplus|sales; anything else = Prep.
  const tabParam = typeof sp["tab"] === "string" ? sp["tab"] : null;
  const initialTab = isPrepDemandTab(tabParam) ? tabParam : "prep";

  // Default 14-day window from today.
  const from = todayYmd();
  const to = addDays(from, 14);

  const emptySkuDemand: CateringSkuDemand = { rows: [], unresolvedChoiceLines: 0, noRecipeLines: 0 };
  const emptySurplus: SurplusDay[] = [];

  const [days, skuDemand, surplus] = locationId
    ? await Promise.all([
        loadCateringPrepDemand(auth, { locationId, from, to }),
        loadCateringSkuDemand(auth, { locationId, from, to }),
        loadCateringSurplus(auth, { locationId, from, to }),
      ])
    : [[], emptySkuDemand, emptySurplus];

  return (
    <div>
      <PageHeader
        title={serverT(lang, "admin.catering.prep_demand.title" as TranslationKey)}
        subtitle={serverT(lang, "admin.catering.prep_demand.subtitle" as TranslationKey)}
      />
      <PrepDemandClient
        days={days}
        locations={locations}
        locationId={locationId}
        from={from}
        to={to}
        lang={lang}
        skuDemand={skuDemand}
        surplus={surplus}
        canPull={level >= 7}
        initialTab={initialTab}
      />
    </div>
  );
}
