/**
 * /maintenance — Maintenance Log page (Task 10).
 *
 * Two views:
 *   – Overview (no `equipment` param): fridge status + equipment list.
 *   – Detail (`equipment` param): full equipment detail + add-note form.
 *
 * Auth → location guard → KH+ gate (MAINTENANCE_BASE_LEVEL = 3).
 */

import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import { isAllLocationsAccess, lockLocationContext, type LocationActor } from "@/lib/locations";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import {
  MAINTENANCE_BASE_LEVEL,
  loadEquipment,
  loadEquipmentDetail,
  loadMaintenanceOverview,
} from "@/lib/maintenance";
import { etYmdMinusDays } from "@/lib/operational-day";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { EquipmentDetail } from "@/components/maintenance/EquipmentDetail";
import { EquipmentOverview } from "@/components/maintenance/EquipmentOverview";
import { AddMaintenanceNote } from "./maintenance-client";

const OPERATIONAL_TZ = "America/New_York";

function nyDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

async function activeLocationIds(): Promise<string[]> {
  const { data, error } = await getServiceRoleClient().from("locations").select("id").eq("active", true).order("name").returns<Array<{ id: string }>>();
  // A failed lookup is a fault, not "no shop": throw so the error boundary shows it instead of a silent bounce.
  if (error) throw new Error(`maintenance: default shop lookup failed: ${error.message}`);
  return (data ?? []).map((row) => row.id);
}

interface PageProps {
  searchParams: Promise<{ equipment?: string; location?: string }>;
}

export default async function MaintenancePage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/maintenance");
  const sp = await searchParams;
  const requested = shopParamFor("/maintenance", searchParamValues(sp));
  const equipmentParam = sp.equipment;

  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  // No hard ?location redirect (the production page's D-64 rule): without one, the B2 resolver picks among the
  // shops this page's bind admits (memberships, plus every active shop after them for the 9+ all-shop grant), the
  // remembered shop first. The report hub's "all shops" search links here with no shop.
  const locationParam = requested ?? (await resolveShopId(isAllLocationsAccess(locActor)
    ? [...auth.locations, ...(await activeLocationIds()).filter((id) => !auth.locations.includes(id))]
    : auth.locations));
  if (!locationParam) redirect("/dashboard");
  if (!lockLocationContext(locActor, locationParam)) redirect("/dashboard");

  const lang = auth.user.language;

  if (auth.level < MAINTENANCE_BASE_LEVEL) {
    return (
      <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
        <div className="mb-3">
          <DashboardBackLink />
        </div>
        <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
          {serverT(lang, "maintenance.not_available")}
        </p>
      </main>
    );
  }

  const sb = getServiceRoleClient();
  const today = nyDateString(new Date());

  // 14-day window for readings + notes
  const sinceDate = etYmdMinusDays(today, 14);

  const locationId = locationParam;

  // ── Detail view ──────────────────────────────────────────────────────────
  if (equipmentParam) {
    const detail = await loadEquipmentDetail(sb, {
      equipmentId: equipmentParam,
      today,
      sinceDate,
    });

    const allEquipment = await loadEquipment(sb, locationId);

    return (
      <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
        <div className="mb-3">
          <DashboardBackLink />
        </div>

        <div className="mb-4">
          <a
            href={`/maintenance?location=${locationId}`}
            className="text-sm font-semibold text-co-text-muted hover:text-co-text"
          >
            ← {serverT(lang, "maintenance.page.title")}
          </a>
        </div>

        {detail === null ? (
          <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
            {serverT(lang, "maintenance.not_found")}
          </p>
        ) : (
          <EquipmentDetail detail={detail} language={lang} />
        )}

        <div className="mt-8">
          <AddMaintenanceNote
            locationId={locationId}
            equipment={allEquipment.map((e) => ({ id: e.id, name: e.name }))}
            language={lang}
            defaultEquipmentId={equipmentParam}
          />
        </div>
      </main>
    );
  }

  // ── Overview view ─────────────────────────────────────────────────────────
  const overview = await loadMaintenanceOverview(sb, { locationId, today, sinceDate });
  const allEquipment = await loadEquipment(sb, locationId);

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <h1 className="mb-4 text-lg font-bold text-co-text">
        {serverT(lang, "maintenance.page.title")}
      </h1>

      <EquipmentOverview overview={overview} locationId={locationId} language={lang} />

      <div className="mt-8">
        <AddMaintenanceNote
          locationId={locationId}
          equipment={allEquipment.map((e) => ({ id: e.id, name: e.name }))}
          language={lang}
        />
      </div>
    </main>
  );
}
