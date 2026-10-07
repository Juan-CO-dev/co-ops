import { resolveTrendRange } from "@/lib/reports-trends";
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
import type { ReactNode } from "react";

import { REPORT_ALL_LOCATIONS_LEVEL } from "@/lib/locations";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { operationalNow } from "@/lib/midshift";
import { loadMyFeedback } from "@/lib/pm-report";
import { loadMyPerformance } from "@/lib/team-metrics";
import type { TrendGranularity } from "@/lib/reports-trends";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { ReportPageNav } from "@/components/reports-hub/ReportPageNav";
import { ReportShopTabs } from "@/components/reports-hub/ReportShopTabs";
import { TrendShopPanels } from "@/components/trends/TrendShopPanels";
import { TrendControls } from "@/components/trends/TrendControls";
import { MyPerformance } from "@/components/me/MyPerformance";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function parseGranularity(g: string | undefined): TrendGranularity {
  return g === "week" || g === "month" ? g : "day";
}

interface LocLite { id: string; code: string }

export default async function MyPerformancePage({ searchParams }: PageProps): Promise<ReactNode> {
  return renderPage(await searchParams);
}

async function renderPage(query: Record<string, string | undefined>, allShops = false): Promise<ReactNode> {
  const auth = await requireSessionFromHeaders("/my-feedback");
  const language: Language = auth.user.language;
  const { loc, location, g } = query;
  const selectedParam = location ?? loc; // Keep old ?loc= links working; the shared tabs use ?location=.
  const sb = getServiceRoleClient();

  const access = auth.level >= REPORT_ALL_LOCATIONS_LEVEL ? "all" : auth.locations;
  let locQuery = sb.from("locations").select("id, code").eq("active", true).order("code", { ascending: true });
  if (access !== "all") {
    if (access.length === 0) return <EmptyShell language={language} viewerLevel={auth.level} />;
    locQuery = locQuery.in("id", access);
  }
  const { data: locRows } = await locQuery;
  const locations = (locRows ?? []) as LocLite[];
  if (locations.length === 0) return <EmptyShell language={language} viewerLevel={auth.level} />;

  const selected = selectedParam === "all" ? { id: "all", code: "" } : (selectedParam ? locations.find((l) => l.id === selectedParam) : null) ?? locations[0]!;
  const granularity = parseGranularity(g);
  const today = operationalNow(new Date()).date;
  const range = resolveTrendRange(query, today, granularity);
  const compare = range.compare;

  const header = <>
      <ReportPageNav viewerLevel={auth.level} path="/my-feedback" params={{ ...query, location: allShops ? "all" : selected.id }} language={language} />
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-co-text">{serverT(language, "me.title")}</h1>
      </div>

      <ReportShopTabs path="/my-feedback" params={query} locationId={allShops ? "all" : selected.id} language={language} viewer={auth} />
      <div className="mb-4">
        <TrendControls range={range} locationId={allShops ? "all" : selected.id} granularity={granularity} compare={compare} language={language} basePath="/my-feedback" />
      </div>

  </>;
  if (selectedParam === "all") {
    if (auth.level < REPORT_ALL_LOCATIONS_LEVEL) redirect("/reports");
    return <TrendShopPanels header={header} render={(id) => renderPage({ ...query, location: id, loc: undefined }, true)} />;
  }

  const data = await loadMyPerformance(sb, {
    viewer: { userId: auth.user.id, level: auth.level, locations: auth.locations },
    locationId: selected.id, granularity, compare, today, range,
  });

  const allFeedback = await loadMyFeedback(sb, { userId: auth.user.id });
  const feedback = allFeedback.filter((f) => f.locationId === selected.id);

  const Container = allShops ? "div" : "main";
  return (
    <Container className={allShops ? "pt-4" : "mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6"}>
      {!allShops && header}
      {data ? (
        <MyPerformance data={data} feedback={feedback} language={language} />
      ) : (
        <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
          {serverT(language, "me.empty")}
        </p>
      )}
    </Container>
  );
}

function EmptyShell({ language, viewerLevel }: { language: Language; viewerLevel: number }) {
  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <ReportPageNav viewerLevel={viewerLevel} path="/my-feedback" params={{}} language={language} />
      <h1 className="mb-4 text-lg font-bold text-co-text">{serverT(language, "me.title")}</h1>
      <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
        {serverT(language, "me.empty")}
      </p>
    </main>
  );
}
