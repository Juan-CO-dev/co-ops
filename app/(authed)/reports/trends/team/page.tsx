/** /reports/trends/team — AGM+ ranked operating-health roster (layout B cards). */
import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import type { TrendGranularity } from "@/lib/reports-trends";
import { loadTeamOperatingHealth, TEAM_VIEW_LEVEL } from "@/lib/team-metrics";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { TrendControls } from "@/components/trends/TrendControls";
import { TeamRosterCard } from "@/components/team/TeamRosterCard";

interface PageProps {
  searchParams: Promise<{ location?: string; g?: string; cmp?: string }>;
}

function parseGranularity(g: string | undefined): TrendGranularity {
  return g === "week" || g === "month" ? g : "day";
}

export default async function TeamRosterPage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/reports/trends/team");
  if (auth.level < TEAM_VIEW_LEVEL) redirect("/dashboard");
  const { location: locationParam, g, cmp } = await searchParams;
  if (!locationParam) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, locationParam)) redirect("/dashboard");

  const language = auth.user.language;
  const granularity = parseGranularity(g);
  const compare = cmp === "1";
  const today = operationalNow(new Date()).date;
  const sb = getServiceRoleClient();

  const team = await loadTeamOperatingHealth(sb, {
    viewer: { userId: auth.user.id, level: auth.level },
    locationId: locationParam, granularity, compare, today,
  });

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <h1 className="text-lg font-bold text-co-text">{serverT(language, "reports.trends.team.title")}</h1>
      <p className="mb-4 text-xs text-co-text-muted">{serverT(language, "reports.trends.team.subtitle")}</p>

      <TrendControls locationId={locationParam} granularity={granularity} compare={compare} language={language} basePath="/reports/trends/team" />

      {team && team.members.length > 0 ? (
        <>
          <p className="mt-4 mb-3 text-xs text-co-text-muted">
            {serverT(language, team.banner.key as Parameters<typeof serverT>[1], team.banner.params)}
          </p>
          <div className="flex flex-col gap-3">
            {team.members.map((m) => (
              <TeamRosterCard key={m.userId} member={m} locationId={locationParam} language={language} />
            ))}
          </div>
        </>
      ) : (
        <p className="mt-6 text-sm text-co-text-muted">{serverT(language, "reports.trends.landing.nothing_urgent")}</p>
      )}
    </main>
  );
}
