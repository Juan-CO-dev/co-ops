import { ReportPageNav } from "@/components/reports-hub/ReportPageNav";
import { ReportShopTabs } from "@/components/reports-hub/ReportShopTabs";
import { TrendShopPanels } from "@/components/trends/TrendShopPanels";
import { serverT } from "@/lib/i18n/server";
import type { ReactNode } from "react";
import { resolveTrendRange } from "@/lib/reports-trends";
import { reportRangeParams } from "@/lib/report-range";
/** /reports/trends/team/[personId] — AGM+ per-person operating-health detail. */
import { redirect } from "next/navigation";

import { REPORT_ALL_LOCATIONS_LEVEL, canReadReportLocation, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import type { TrendGranularity } from "@/lib/reports-trends";
import { loadPersonDetail, loadPersonReportLocations, TEAM_VIEW_LEVEL } from "@/lib/team-metrics";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { TrendControls } from "@/components/trends/TrendControls";
import { PersonDetail } from "@/components/team/PersonDetail";

interface PageProps {
  params: Promise<{ personId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

function parseGranularity(g: string | undefined): TrendGranularity {
  return g === "week" || g === "month" ? g : "day";
}

export default async function PersonDetailPage({ params, searchParams }: PageProps): Promise<ReactNode> {
  return renderPage((await params).personId, await searchParams);
}

async function renderPage(personId: string, paramsRange: Record<string, string | undefined>, allShops = false, personLocations?: string[]): Promise<ReactNode> {
  const auth = await requireSessionFromHeaders("/reports/trends/team");
  if (auth.level < TEAM_VIEW_LEVEL) redirect("/dashboard");
  const { g } = paramsRange;
  let locationParam = paramsRange.location;
  if (!locationParam) redirect("/dashboard");
  if (locationParam === "all" && auth.level < REPORT_ALL_LOCATIONS_LEVEL) redirect("/reports");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (locationParam !== "all" && !canReadReportLocation(locActor, locationParam)) redirect("/dashboard");
  const sb = getServiceRoleClient();
  const availableLocations = personLocations ?? await loadPersonReportLocations(sb, { userId: auth.user.id, level: auth.level, locations: auth.locations }, personId);
  if (availableLocations.length === 1) locationParam = availableLocations[0]!;
  paramsRange = { ...paramsRange, location: locationParam };

  const language = auth.user.language;
  const granularity = parseGranularity(g);
  const today = operationalNow(new Date()).date;
  const range = resolveTrendRange(paramsRange, today, granularity);
  const compare = range.compare;
  const context = reportRangeParams(range);
  context.set("g", granularity);
  for (const [key, value] of Object.entries(paramsRange)) if (value !== undefined && !["location", "loc", "g", "range", "from", "to", "compare", "cmp"].includes(key)) context.set(key, value);
  if (allShops) context.set("returnLocation", "all");

  const header = <>
      <ReportPageNav viewerLevel={auth.level} path={`/reports/trends/team/${personId}`} params={{ ...paramsRange, location: allShops || (auth.level >= REPORT_ALL_LOCATIONS_LEVEL && paramsRange.returnLocation === "all") ? "all" : locationParam, returnLocation: undefined }} language={language} />
      <ReportShopTabs path={`/reports/trends/team/${personId}`} params={paramsRange} locationId={allShops ? "all" : locationParam} language={language} viewer={auth} allowedLocationIds={availableLocations} supportsAll={availableLocations.length > 1} />
      <TrendControls range={range} locationId={allShops ? "all" : locationParam} granularity={granularity} compare={compare} language={language} basePath={`/reports/trends/team/${personId}`} />
  </>;
  if (locationParam === "all") {
    if (auth.level < REPORT_ALL_LOCATIONS_LEVEL) redirect("/reports");
    return <TrendShopPanels header={header} locationIds={availableLocations} render={(id) => renderPage(personId, { ...paramsRange, location: id }, true, availableLocations)} />;
  }

  const detail = await loadPersonDetail(sb, {
    viewer: { userId: auth.user.id, level: auth.level, locations: auth.locations },
    personId, locationId: locationParam, granularity, compare, today, range,
  });


  const Container = allShops ? "div" : "main";
  return (
    <Container className={allShops ? "pt-4" : "mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6"}>
      {!allShops && header}
      <div className="mt-4">
        {detail ? <PersonDetail context={context.toString()} detail={detail} locationId={locationParam} language={language} /> : <p>{serverT(language, "reports.not_available")}</p>}
      </div>
    </Container>
  );
}
