import type { ReactNode } from "react";
import { TrendShopPanels } from "@/components/trends/TrendShopPanels";
import { resolveTrendRange } from "@/lib/reports-trends";
import { reportRangeParams } from "@/lib/report-range";
/** /reports/trends/team — AGM+ ranked operating-health roster (layout B cards). */
import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import { canReadReportLocation, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import type { TrendGranularity } from "@/lib/reports-trends";
import { loadTeamOperatingHealth, TEAM_VIEW_LEVEL } from "@/lib/team-metrics";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { BackLink } from "@/components/nav/BackLink";
import { TrendControls } from "@/components/trends/TrendControls";
import { TeamRosterCard } from "@/components/team/TeamRosterCard";
import { ExportLinks } from "@/components/reports-export/ExportLinks";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function parseGranularity(g: string | undefined): TrendGranularity {
  return g === "week" || g === "month" ? g : "day";
}

export default async function TeamRosterPage({ searchParams }: PageProps): Promise<ReactNode> {
  const auth = await requireSessionFromHeaders("/reports/trends/team");
  if (auth.level < TEAM_VIEW_LEVEL) redirect("/dashboard");
  const paramsRange = await searchParams;
  const { location: locationParam, g } = paramsRange;
  if (!locationParam) redirect("/dashboard");
  if (locationParam === "all") {
    if (auth.level < 8) redirect("/reports");
    return <TrendShopPanels render={(id) => TeamRosterPage({ searchParams: Promise.resolve({ ...paramsRange, location: id }) })} />;
  }
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!canReadReportLocation(locActor, locationParam)) redirect("/dashboard");

  const language = auth.user.language;
  const granularity = parseGranularity(g);
  const today = operationalNow(new Date()).date;
  const range = resolveTrendRange(paramsRange, today, granularity);
  const compare = range.compare;
  const context = reportRangeParams(range);
  context.set("g", granularity);
  const sb = getServiceRoleClient();

  const team = await loadTeamOperatingHealth(sb, {
    viewer: { userId: auth.user.id, level: auth.level, locations: auth.locations },
    locationId: locationParam, granularity, compare, today, range,
  });

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <BackLink search={`?location=${locationParam}&${context}`} labelKey="reports.trends.back" />
      <h1 className="text-lg font-bold text-co-text">{serverT(language, "reports.trends.team.title")}</h1>
      <p className="mb-4 text-xs text-co-text-muted">{serverT(language, "reports.trends.team.subtitle")}</p>

      <TrendControls range={range} locationId={locationParam} granularity={granularity} compare={compare} language={language} basePath="/reports/trends/team" />
      <ExportLinks className="mt-3" family="team" language={language}
        query={{ location: locationParam, range: range.range, from: range.from, to: range.to, g: granularity }} />

      {team && team.members.length > 0 ? (
        <>
          <p className="mt-4 mb-3 text-xs text-co-text-muted">
            {serverT(language, team.banner.key as Parameters<typeof serverT>[1], team.banner.params)}
          </p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {team.members.map((m) => (
              <TeamRosterCard context={context.toString()} key={m.userId} member={m} locationId={locationParam} language={language} />
            ))}
          </div>
        </>
      ) : (
        <p className="mt-6 text-sm text-co-text-muted">{serverT(language, "reports.trends.landing.nothing_urgent")}</p>
      )}
    </main>
  );
}
