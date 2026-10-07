import { redirect } from "next/navigation";
import { serverT } from "@/lib/i18n/server";
import { formatDateLabel } from "@/lib/i18n/format";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { etCalendarDate } from "@/lib/operational-day";
import { requireSessionFromHeaders } from "@/lib/session";
import { loadYieldVariance, YIELD_STATS_READ_MIN } from "@/lib/yield-stats";
import { YieldVariance } from "@/components/production/YieldVariance";
import { BackLink } from "@/components/nav/BackLink";

/**
 * /operations/production/yield — batch vs bottle PHASE B variance view + nudges. Level 5+ (shift
 * lead and up), bound to the shop exactly like /operations/production. A computed read over the
 * batch headers Phase A already captures; nothing new is asked of the crew.
 */
export default async function YieldVariancePage({ searchParams }: { searchParams: Promise<{ location?: string }> }) {
  const auth = await requireSessionFromHeaders("/operations/production/yield");
  const { location } = await searchParams;
  if (auth.level < YIELD_STATS_READ_MIN) redirect("/dashboard");
  if (!location) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, location)) redirect("/dashboard");
  const lang = auth.user.language;
  const view = await loadYieldVariance(auth, location);
  const dateLabels: Record<string, string> = {};
  for (const item of view.items) {
    for (const l of [...item.lines, ...Object.values(item.makerLines).flat()]) {
      dateLabels[l.id] ??= formatDateLabel(etCalendarDate(l.producedAt), lang);
    }
  }
  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <BackLink search={`?location=${location}`} />
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(lang, "yield.view.title")}</h1>
      <YieldVariance view={view} dateLabels={dateLabels} />
    </main>
  );
}
