/**
 * /admin/catering/lto — W4c-b Surplus → LTO/discount action surface.
 *
 * Server component: gate >= LTO_MIN (6). Loads perishable surplus + existing
 * LTO/discount events for the selected location and passes them to LtoClient.
 * Admin shell (auth boundary, providers) lives in app/admin/layout.tsx; this
 * page re-gates >= LTO_MIN defensively per the C.39 pattern.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { loadPackageLocations } from "@/lib/admin/catering/packages";
import { loadPerishableSurplus, SURPLUS_READ_MIN } from "@/lib/catering/surplus";
import { listLtoEvents, LTO_MIN } from "@/lib/catering/lto";
import { LtoClient } from "@/components/admin/catering/lto/LtoClient";

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

export default async function AdminCateringLtoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireSessionFromHeaders("/admin");
  const level = ROLES[auth.user.role].level;
  if (level < LTO_MIN) redirect("/dashboard");
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

  const from = todayYmd();
  const to = addDays(from, 14);

  // Load in parallel; pass [] when no location is available.
  const canReadSurplus = level >= SURPLUS_READ_MIN;
  const [surplus, events] = locationId
    ? await Promise.all([
        canReadSurplus
          ? loadPerishableSurplus(auth, { locationId, from, to })
          : Promise.resolve([] as Awaited<ReturnType<typeof loadPerishableSurplus>>),
        listLtoEvents(auth, { locationId, activeOnly: false }),
      ])
    : [[], []];

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "admin.catering.lto.title" as TranslationKey)}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">
        {serverT(lang, "admin.catering.lto.subtitle" as TranslationKey)}
      </p>
      <LtoClient
        surplus={surplus}
        events={events}
        locations={locations}
        locationId={locationId}
        actorLevel={level}
      />
    </div>
  );
}
