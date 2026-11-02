import { notFound } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { canReadMarketing } from "@/lib/marketing/access-shared";
import { loadMarketingScorecard } from "@/lib/marketing/scorecard";
import ScorecardClient from "./ScorecardClient";
import { MarketingWriteForms } from "@/components/admin/marketing/MarketingWriteForms";
import { serverT } from "@/lib/i18n/server";

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin/marketing");
  if (!canReadMarketing(auth.role)) notFound();
  const { location } = await searchParams;
  const data = await loadMarketingScorecard(auth, !location || location === "all" ? null : location).catch(error => {
    if (error instanceof Error && error.message === "invalid_location") notFound();
    throw error;
  });
  const milestone = data.state === "ok" ? data.milestones.find(row => row.kind === "first_ad_spend") : undefined;
  return <div className="space-y-6"><ScorecardClient data={data} lang={auth.user.language} />
    {data.state === "ok" && <a href="/admin/marketing/ad-codes" className="inline-flex min-h-11 items-center underline">{serverT(auth.user.language, "marketing.adcodes.title")}</a>}
    {data.state === "ok" && <MarketingWriteForms lang={auth.user.language} locations={data.locations}
      milestones={data.milestones} entries={data.entries} weeks={data.series.map(row => row.window)} canCorrectBaseline={auth.role === "owner" || auth.role === "cgs"} snapshotId={data.snapshots.find(row => row.milestone_id === milestone?.id)?.id} />}
  </div>;
}
