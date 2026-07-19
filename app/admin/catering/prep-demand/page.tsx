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
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { loadPackageLocations } from "@/lib/admin/catering/packages";
import { loadCateringPrepDemand, PREP_DEMAND_READ_MIN } from "@/lib/catering/prep-demand";
import { PrepDemandClient } from "@/components/admin/catering/prep-demand/PrepDemandClient";

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

  // Determine active location: from ?location= param, else first location.
  const paramLocation = typeof sp["location"] === "string" ? sp["location"] : undefined;
  const firstLocation = locations[0];
  const locationId =
    paramLocation && locations.some((l) => l.id === paramLocation)
      ? paramLocation
      : (firstLocation?.id ?? null);

  // Default 14-day window from today.
  const from = todayYmd();
  const to = addDays(from, 14);

  const days =
    locationId
      ? await loadCateringPrepDemand(auth, { locationId, from, to })
      : [];

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.catering.prep_demand.title" as TranslationKey)}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">
        {serverT(lang, "admin.catering.prep_demand.subtitle" as TranslationKey)}
      </p>
      <PrepDemandClient
        days={days}
        locations={locations}
        locationId={locationId}
        from={from}
        to={to}
        lang={lang}
      />
    </div>
  );
}
