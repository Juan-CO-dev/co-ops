import { notFound } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { canReadMarketing } from "@/lib/marketing/access-shared";
import { loadMarketingScorecard } from "@/lib/marketing/scorecard";
import ScorecardClient from "./ScorecardClient";

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin/marketing");
  if (!canReadMarketing(auth.role)) notFound();
  const { location } = await searchParams;
  const data = await loadMarketingScorecard(auth, !location || location === "all" ? null : location).catch(error => {
    if (error instanceof Error && error.message === "invalid_location") notFound();
    throw error;
  });
  return <ScorecardClient data={data} lang={auth.user.language} />;
}
