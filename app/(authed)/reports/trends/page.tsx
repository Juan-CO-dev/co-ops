/**
 * /reports/trends — landing. Entry cards (Ops always; Team for AGM+) + a
 * "relevant right now" attention strip + section snapshots. Ops content lives
 * at /reports/trends/ops; Team at /reports/trends/team.
 */

import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { loadTrendSeries } from "@/lib/reports-trends";
import { loadTeamOperatingHealth, TEAM_VIEW_LEVEL } from "@/lib/team-metrics";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { TrendsLanding } from "@/components/team/TrendsLanding";

interface PageProps {
  searchParams: Promise<{ location?: string }>;
}

export default async function TrendsLandingPage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/reports/trends");
  const { location: locationParam } = await searchParams;
  if (!locationParam) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, locationParam)) redirect("/dashboard");

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
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(language, "reports.trends.landing.title")}</h1>
      <TrendsLanding
        locationId={locationParam}
        language={language}
        canSeeTeam={canSeeTeam}
        ops={ops}
        team={team}
        attention={attention}
      />
    </main>
  );
}
