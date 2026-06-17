/**
 * /reports — Reports Hub list page (Task 2).
 *
 * Moved from the top-level stub (app/reports/page.tsx) into the (authed)
 * route group so it sits behind the authed layout while keeping the same URL.
 *
 * Auth → location guard → listReports → filter bar + list.
 */

import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { REPORTS_HUB_CASH_LEVEL, listReports, type ReportTypeKey, type SignalFilters, type Viewer } from "@/lib/reports-hub";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { ReportFilterBar } from "@/components/reports-hub/ReportFilterBar";
import { ReportList } from "@/components/reports-hub/ReportList";

const ALL_TYPES: ReportTypeKey[] = ["opening", "closing", "am_prep", "mid_day", "cash", "pm"];

interface PageProps {
  searchParams: Promise<{
    location?: string;
    type?: string;
    from?: string;
    to?: string;
    // Signal filter toggles (checkbox GET params — present = "true" string)
    sf_underPar?: string;
    sf_overPar?: string;
    sf_skipped?: string;
    sf_tempFlag?: string;
    sf_cashOver?: string;
    sf_cashShort?: string;
  }>;
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/reports");
  const {
    location: locationParam,
    type: typeParam,
    from: fromParam,
    to: toParam,
    sf_underPar,
    sf_overPar,
    sf_skipped,
    sf_tempFlag,
    sf_cashOver,
    sf_cashShort,
  } = await searchParams;

  if (!locationParam) redirect("/dashboard");

  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, locationParam)) redirect("/dashboard");

  const lang = auth.user.language;
  const locationId = locationParam;

  // ── Default date range: last 14 days ending today (operational TZ) ──
  const todayDate = operationalNow(new Date()).date;
  const fourteenDaysAgo = operationalNow(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)).date;

  const dateFrom = fromParam ?? fourteenDaysAgo;
  const dateTo = toParam ?? todayDate;

  // ── Resolve type filter ──
  // Single-select: one type OR empty/"all" = all the viewer may see.
  const viewerLevel = auth.level;
  const allowedTypes: ReportTypeKey[] = ALL_TYPES.filter(
    (t) => t !== "cash" || viewerLevel >= REPORTS_HUB_CASH_LEVEL,
  );

  let selectedTypes: ReportTypeKey[] | undefined;
  if (typeParam && typeParam !== "all" && (ALL_TYPES as string[]).includes(typeParam)) {
    const t = typeParam as ReportTypeKey;
    // silently ignore if viewer can't see this type (e.g., L3 trying ?type=cash)
    if (allowedTypes.includes(t)) {
      selectedTypes = [t];
    }
  }

  const viewer: Viewer = { userId: auth.user.id, level: viewerLevel };

  // ── Signal filters (derived toggles from GET params) ──
  // Cash toggles only respected when viewer is L4+ (cash-visible tier).
  const signalFilters: SignalFilters = {
    ...(sf_underPar === "true" ? { underPar: true } : {}),
    ...(sf_overPar === "true" ? { overPar: true } : {}),
    ...(sf_skipped === "true" ? { skipped: true } : {}),
    ...(sf_tempFlag === "true" ? { tempFlag: true } : {}),
    ...(sf_cashOver === "true" && viewerLevel >= REPORTS_HUB_CASH_LEVEL ? { cashOver: true } : {}),
    ...(sf_cashShort === "true" && viewerLevel >= REPORTS_HUB_CASH_LEVEL ? { cashShort: true } : {}),
  };
  const hasSignalFilters = Object.keys(signalFilters).length > 0;

  const sb = getServiceRoleClient();
  const items = await listReports(sb, {
    viewer,
    locationId,
    dateFrom,
    dateTo,
    types: selectedTypes,
    signalFilters: hasSignalFilters ? signalFilters : undefined,
  });

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <h1 className="mb-4 text-lg font-bold text-co-text">
        {serverT(lang, "reports.page.title")}
      </h1>

      <ReportFilterBar
        locationId={locationId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        selectedType={typeParam ?? "all"}
        allowedTypes={allowedTypes}
        language={lang}
        viewerLevel={viewerLevel}
        activeSignalFilters={signalFilters}
      />

      <div className="mt-4">
        <ReportList
          items={items}
          locationId={locationId}
          language={lang}
          viewerLevel={viewerLevel}
        />
      </div>
    </main>
  );
}
