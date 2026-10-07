import type { ReactNode } from "react";
import { TrendShopPanels } from "@/components/trends/TrendShopPanels";
import { resolveTrendRange } from "@/lib/reports-trends";
import { reportRangeParams } from "@/lib/report-range";
/**
 * /reports/trends — landing. Entry cards (Ops always; Team for AGM+) + a
 * "relevant right now" attention strip + section snapshots. Ops content lives
 * at /reports/trends/ops; Team at /reports/trends/team.
 */

import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import { REPORT_ALL_LOCATIONS_LEVEL, canReadReportLocation, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { loadTrendSeries } from "@/lib/reports-trends";
import { loadTeamOperatingHealth, TEAM_VIEW_LEVEL } from "@/lib/team-metrics";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { ReportPageNav } from "@/components/reports-hub/ReportPageNav";
import { ReportShopTabs } from "@/components/reports-hub/ReportShopTabs";
import { TrendsLanding } from "@/components/team/TrendsLanding";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function TrendsLandingPage({ searchParams }: PageProps): Promise<ReactNode> {
  return renderPage(await searchParams);
}

async function renderPage(paramsRange: Record<string, string | undefined>, allShops = false): Promise<ReactNode> {
  const auth = await requireSessionFromHeaders("/reports/trends");
  const { location: locationParam } = paramsRange;
  if (auth.level < 4) redirect("/reports");
  if (!locationParam) redirect("/dashboard");
  if (locationParam === "all") {
    if (auth.level < REPORT_ALL_LOCATIONS_LEVEL) redirect("/reports");
    return <TrendShopPanels render={(id) => renderPage({ ...paramsRange, location: id }, true)} />;
  }
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!canReadReportLocation(locActor, locationParam)) redirect("/dashboard");

  const language = auth.user.language;
  const granularity = paramsRange.g === "month" ? "month" : paramsRange.g === "week" ? "week" : "day";
  const today = operationalNow(new Date()).date;
  const range = resolveTrendRange(paramsRange, today, granularity);
  const compare = range.compare;
  const context = reportRangeParams(range);
  context.set("g", granularity);
  for (const [key, value] of Object.entries(paramsRange)) if (value !== undefined && !["location", "loc", "g", "range", "from", "to", "compare", "cmp"].includes(key)) context.set(key, value);
  if (allShops) context.set("returnLocation", "all");
  const sb = getServiceRoleClient();
  const viewer = { userId: auth.user.id, level: auth.level, locations: auth.locations };
  const canSeeTeam = auth.level >= TEAM_VIEW_LEVEL;

  const opsSeries = await loadTrendSeries(sb, { viewer, locationId: locationParam, granularity, compare, today, range });
  const ops = { underPar: opsSeries.totals.par.current ?? 0, tempFlags: opsSeries.totals.temps.current ?? 0 };

  const team = canSeeTeam
    ? await loadTeamOperatingHealth(sb, { viewer, locationId: locationParam, granularity, compare: true, today, range: { ...range, compare: true } })
    : null;

  const attention: { kind: "ops" | "team"; titleKey: string; sub: string }[] = [];
  if (team && team.summary.needsAttention > 0) {
    attention.push({ kind: "team", titleKey: "reports.trends.team.title", sub: serverT(language, team.banner.key as Parameters<typeof serverT>[1], team.banner.params) });
  }
  if (ops.tempFlags > 0) {
    attention.push({ kind: "ops", titleKey: "reports.trends.temps_title", sub: String(ops.tempFlags) });
  }
  if (ops.underPar > 0) {
    attention.push({ kind: "ops", titleKey: "reports.trends.par_title", sub: String(ops.underPar) });
  }

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <ReportPageNav viewerLevel={auth.level} path="/reports/trends" params={{ ...paramsRange, location: allShops || (auth.level >= REPORT_ALL_LOCATIONS_LEVEL && paramsRange.returnLocation === "all") ? "all" : locationParam, returnLocation: undefined }} language={language} />
      <ReportShopTabs path="/reports/trends" params={paramsRange} locationId={allShops ? "all" : locationParam} language={language} viewer={auth} />
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(language, "reports.trends.landing.title")}</h1>
      <TrendsLanding
        locationId={locationParam}
        language={language}
        context={context.toString()}
        canSeeTeam={canSeeTeam}
        ops={ops}
        team={team}
        attention={attention}
      />
    </main>
  );
}
