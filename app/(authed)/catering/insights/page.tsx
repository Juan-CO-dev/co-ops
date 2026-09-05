/**
 * /catering/insights — the catering read surface, v2 (catering-truth arc 2026-09-05).
 *
 * Server shell only: auth + the level-5 floor + the ET "today" the windows are cut on, then
 * one client component. The four windows, the calendar and the breakdowns are all one RPC
 * (0194 `catering_insights_v2`) — money by EVENT date, lead flow by CREATED date, never a
 * client reduce over loaded rows.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { etCalendarDate } from "@/lib/operational-day";
import { loadCateringInsightsV2, INSIGHTS_READ_MIN } from "@/lib/catering/insights";
import { InsightsClient } from "@/components/catering/InsightsClient";
import { BackLink } from "@/components/nav/BackLink";

export default async function CateringInsightsPage() {
  const auth = await requireSessionFromHeaders("/catering/insights");
  if (getRoleLevel(auth.user.role) < INSIGHTS_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  // The ET calendar date — the windows ("this week", "this month", "last 30") and the
  // calendar's ±90-day span are all cut against it server-side, never against a browser clock.
  const today = etCalendarDate(new Date().toISOString());
  const data = await loadCateringInsightsV2(auth, today);

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <BackLink />
      <h1 className="text-lg font-bold text-co-text">{serverT(lang, "catering.insights.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "catering.insights.subtitle")}</p>
      <InsightsClient data={data} />
    </main>
  );
}
