/**
 * /reports/trends — landing. Entry cards (Ops always; Team for AGM+) + a
 * "relevant right now" attention strip + section snapshots. Ops content lives
 * at /reports/trends/ops; Team at /reports/trends/team.
 */

import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import { canReadReportLocation, lockLocationContext, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { loadTrendSeries } from "@/lib/reports-trends";
import { loadTeamOperatingHealth, TEAM_VIEW_LEVEL } from "@/lib/team-metrics";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadYieldVariance, YIELD_STATS_READ_MIN } from "@/lib/yield-stats";

import { BackLink } from "@/components/nav/BackLink";
import { TrendsLanding } from "@/components/team/TrendsLanding";

interface PageProps {
  searchParams: Promise<{ location?: string }>;
}

export default async function TrendsLandingPage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/reports/trends");
  const { location: locationParam } = await searchParams;
  if (!locationParam) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!canReadReportLocation(locActor, locationParam)) redirect("/dashboard");

  const language = auth.user.language;
  const today = operationalNow(new Date()).date;
  const sb = getServiceRoleClient();
  const viewer = { userId: auth.user.id, level: auth.level };
  const canSeeTeam = auth.level >= TEAM_VIEW_LEVEL;

  const opsSeries = await loadTrendSeries(sb, { viewer, locationId: locationParam, granularity: "day", compare: false, today });
  const ops = { underPar: opsSeries.totals.par.current ?? 0, tempFlags: opsSeries.totals.temps.current ?? 0 };

  const team = canSeeTeam
    ? await loadTeamOperatingHealth(sb, { viewer, locationId: locationParam, granularity: "day", compare: true, today })
    : null;

  // Batch vs bottle Phase B: the yield nudges join the attention strip for level 5+ bound to this
  // shop (the operational bind, as the yield page itself uses). Fail-soft on a HUB: a yield read
  // failure must not take the trends landing down with it; the yield page itself throws loudly.
  const canSeeYield = auth.level >= YIELD_STATS_READ_MIN && lockLocationContext(locActor, locationParam);
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
    attention.push({ kind: "ops", titleKey: "reports.trends.temps_title", sub: String(ops.tempFlags) });
  }
  if (ops.underPar > 0) {
    attention.push({ kind: "ops", titleKey: "reports.trends.par_title", sub: String(ops.underPar) });
  }

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <BackLink search={`?location=${locationParam}`} />
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(language, "reports.trends.landing.title")}</h1>
      <TrendsLanding
        locationId={locationParam}
        language={language}
        canSeeTeam={canSeeTeam}
        canSeeYield={canSeeYield}
        ops={ops}
        team={team}
        attention={attention}
      />
    </main>
  );
}
