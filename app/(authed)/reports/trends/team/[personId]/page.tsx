/** /reports/trends/team/[personId] — AGM+ per-person operating-health detail. */
import { redirect } from "next/navigation";

import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import type { TrendGranularity } from "@/lib/reports-trends";
import { loadPersonDetail, TEAM_VIEW_LEVEL } from "@/lib/team-metrics";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { TrendControls } from "@/components/trends/TrendControls";
import { PersonDetail } from "@/components/team/PersonDetail";

interface PageProps {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ location?: string; g?: string; cmp?: string }>;
}

function parseGranularity(g: string | undefined): TrendGranularity {
  return g === "week" || g === "month" ? g : "day";
}

export default async function PersonDetailPage({ params, searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/reports/trends/team");
  if (auth.level < TEAM_VIEW_LEVEL) redirect("/dashboard");
  const { personId } = await params;
  const { location: locationParam, g, cmp } = await searchParams;
  if (!locationParam) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, locationParam)) redirect("/dashboard");

  const language = auth.user.language;
  const granularity = parseGranularity(g);
  const compare = cmp === "1";
  const today = operationalNow(new Date()).date;
  const sb = getServiceRoleClient();

  const detail = await loadPersonDetail(sb, {
    viewer: { userId: auth.user.id, level: auth.level },
    personId, locationId: locationParam, granularity, compare, today,
  });
  if (!detail) redirect(`/reports/trends/team?location=${locationParam}`);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <TrendControls locationId={locationParam} granularity={granularity} compare={compare} language={language} basePath={`/reports/trends/team/${personId}`} />
      <div className="mt-4">
        <PersonDetail detail={detail} locationId={locationParam} language={language} />
      </div>
    </main>
  );
}
