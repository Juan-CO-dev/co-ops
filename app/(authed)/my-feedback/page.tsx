/**
 * /my-feedback — "My Performance" (employee self-view).
 *
 * Route kept (the PM `shift_feedback` notification deep-links here); the label
 * is "My Performance". Own data only, per-location switcher, positive framing
 * (no rank, no needs-attention). Absorbs the prior eval list as the Feedback
 * section. Security: loadMyPerformance derives the person from the session
 * (never a param); manager notes are never selected.
 */

import { redirect } from "next/navigation";
import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { accessibleLocations, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { loadMyFeedback } from "@/lib/pm-report";
import { loadMyPerformance } from "@/lib/team-metrics";
import type { TrendGranularity } from "@/lib/reports-trends";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { TrendControls } from "@/components/trends/TrendControls";
import { MyPerformance } from "@/components/me/MyPerformance";

interface PageProps {
  searchParams: Promise<{ loc?: string; location?: string; g?: string; cmp?: string }>;
}

function parseGranularity(g: string | undefined): TrendGranularity {
  return g === "week" || g === "month" ? g : "day";
}

interface LocLite { id: string; code: string }

export default async function MyPerformancePage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/my-feedback");
  const language: Language = auth.user.language;
  const { loc, location, g, cmp } = await searchParams;
  const selectedParam = loc ?? location; // switcher uses ?loc=, TrendControls uses ?location=
  const sb = getServiceRoleClient();

  const actor: LocationActor = { role: auth.role, locations: auth.locations };
  const access = accessibleLocations(actor);
  let locQuery = sb.from("locations").select("id, code").eq("active", true).order("code", { ascending: true });
  if (access !== "all") {
    if (access.length === 0) return <EmptyShell language={language} />;
    locQuery = locQuery.in("id", access);
  }
  const { data: locRows } = await locQuery;
  const locations = (locRows ?? []) as LocLite[];
  if (locations.length === 0) return <EmptyShell language={language} />;

  const selected = (selectedParam ? locations.find((l) => l.id === selectedParam) : null) ?? locations[0]!;
  const granularity = parseGranularity(g);
  const compare = cmp === "1";
  const today = operationalNow(new Date()).date;

  const data = await loadMyPerformance(sb, {
    viewer: { userId: auth.user.id, level: auth.level },
    locationId: selected.id, granularity, compare, today,
  });

  const allFeedback = await loadMyFeedback(sb, { userId: auth.user.id });
  const feedback = allFeedback.filter((f) => f.locationId === selected.id);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-co-text">{serverT(language, "me.title")}</h1>
        {locations.length > 1 ? (
          <nav aria-label={serverT(language, "me.location_aria")} className="flex flex-wrap gap-1.5">
            {locations.map((l) => {
              const on = l.id === selected.id;
              const href = `/my-feedback?loc=${l.id}&g=${granularity}${compare ? "&cmp=1" : ""}`;
              return (
                <Link key={l.id} href={href} scroll={false} aria-current={on ? "page" : undefined}
                  className={[
                    "inline-flex min-h-[36px] items-center rounded-full px-3 text-xs font-bold uppercase tracking-[0.1em] transition",
                    on ? "border-2 border-co-text bg-co-gold text-co-text" : "border-2 border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text",
                  ].join(" ")}>
                  {l.code}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>

      <div className="mb-4">
        <TrendControls locationId={selected.id} granularity={granularity} compare={compare} language={language} basePath="/my-feedback" />
      </div>

      {data ? (
        <MyPerformance data={data} feedback={feedback} language={language} />
      ) : (
        <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
          {serverT(language, "me.empty")}
        </p>
      )}
    </main>
  );
}

function EmptyShell({ language }: { language: Language }) {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3"><DashboardBackLink /></div>
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(language, "me.title")}</h1>
      <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
        {serverT(language, "me.empty")}
      </p>
    </main>
  );
}
