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
import { formatDateLabel } from "@/lib/i18n/format";
import { REPORT_ALL_LOCATIONS_LEVEL, canReadReportLocation, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { loadTrendSeries } from "@/lib/reports-trends";
import { loadTeamOperatingHealth, TEAM_VIEW_LEVEL } from "@/lib/team-metrics";
import { canViewPeople, peopleActorFromAuth } from "@/lib/people/access-shared";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadYieldVariance, YIELD_STATS_READ_MIN } from "@/lib/yield-stats";

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
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (locationParam !== "all" && !canReadReportLocation(locActor, locationParam)) redirect("/dashboard");

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
  const viewer = { userId: auth.user.id, role: auth.role, level: auth.level, locations: auth.locations };
  // Task 13 (R7): the team read is canViewPeople for the selected shop — the social media manager never.
  const canSeeTeam = auth.level >= TEAM_VIEW_LEVEL && canViewPeople(peopleActorFromAuth(auth), locationParam);

  const header = <>
      <ReportPageNav viewerLevel={auth.level} path="/reports/trends" params={{ ...paramsRange, location: allShops || (auth.level >= REPORT_ALL_LOCATIONS_LEVEL && paramsRange.returnLocation === "all") ? "all" : locationParam, returnLocation: undefined }} language={language} />
      <ReportShopTabs path="/reports/trends" params={paramsRange} locationId={allShops ? "all" : locationParam} language={language} viewer={auth} />
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(language, "reports.trends.landing.title")}</h1>
  </>;
  if (locationParam === "all") {
    if (auth.level < REPORT_ALL_LOCATIONS_LEVEL) redirect("/reports");
    return <TrendShopPanels header={header} render={(id) => renderPage({ ...paramsRange, location: id }, true)} />;
  }

  const opsSeries = await loadTrendSeries(sb, { viewer, locationId: locationParam, granularity, compare, today, range });
  const ops = { underPar: opsSeries.totals.par.current ?? 0, tempFlags: opsSeries.totals.temps.current ?? 0 };
  // B8 #4: these are WINDOW totals (30 days by default), not today — say so wherever they show,
  // or they read as "right now" beside Pulse's today-only fridge card.
  const windowLabel = { from: formatDateLabel(range.from, language), to: formatDateLabel(range.to, language) };
  const inWindow = (n: number) => serverT(language, "reports.trends.landing.count_in_window", { n, ...windowLabel });

  const team = canSeeTeam
    ? await loadTeamOperatingHealth(sb, { viewer, locationId: locationParam, granularity, compare: true, today, range: { ...range, compare: true } })
    : null;

  // Batch vs bottle Phase B: the yield nudges join the attention strip for level 5+ bound to this
  // shop with the REPORT bind (Astra r1 #4 — level 8 reads every shop, as the yield page does).
  // Fail-soft on a HUB: a yield read failure must not take the trends landing down with it; the
  // yield page itself says "unavailable" when 0218 is missing.
  const canSeeYield = auth.level >= YIELD_STATS_READ_MIN && canReadReportLocation(locActor, locationParam);
  const yieldView = canSeeYield
    ? await loadYieldVariance(auth, locationParam).catch((e: unknown) => {
        console.error("trends landing: yield variance unavailable", e);
        return null;
      })
    : null;

  const attention: { kind: "ops" | "team" | "yield"; titleKey: string; sub: string }[] = [];
  if (yieldView && yieldView.recipeNudges + yieldView.makerItems > 0) {
    attention.push({ kind: "yield", titleKey: "reports.trends.yield_title", sub: serverT(language, "reports.trends.yield_sub", { recipes: yieldView.recipeNudges, makers: yieldView.makerItems }) });
  }
  if (team && team.summary.needsAttention > 0) {
    attention.push({ kind: "team", titleKey: "reports.trends.team.title", sub: serverT(language, team.banner.key as Parameters<typeof serverT>[1], team.banner.params) });
  }
  if (ops.tempFlags > 0) {
    attention.push({ kind: "ops", titleKey: "reports.trends.temps_title", sub: inWindow(ops.tempFlags) });
  }
  if (ops.underPar > 0) {
    attention.push({ kind: "ops", titleKey: "reports.trends.par_title", sub: inWindow(ops.underPar) });
  }

  const Container = allShops ? "div" : "main";
  return (
    <Container className={allShops ? "pt-4" : "mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6"}>
      {!allShops && header}
      <TrendsLanding
        locationId={locationParam}
        language={language}
        context={context.toString()}
        canSeeTeam={canSeeTeam}
        canSeeYield={canSeeYield}
        ops={ops}
        opsWindow={serverT(language, "reports.trends.landing.window", windowLabel)}
        team={team}
        attention={attention}
      />
    </Container>
  );
}
