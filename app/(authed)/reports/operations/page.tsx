import { parseReportRange, reportRangeParams, validReportDate } from "@/lib/report-range";
import type { ReactNode } from "react";
import { TrendShopPanels } from "@/components/trends/TrendShopPanels";
/**
 * /reports — Reports Hub list page (Task 2).
 *
 * Moved from the top-level stub (app/reports/page.tsx) into the (authed)
 * route group so it sits behind the authed layout while keeping the same URL.
 *
 * Auth → location guard → listReports → filter bar + list.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import type { TranslationKey } from "@/lib/i18n/types";
import { buildSearchCorpus, searchReport, type SearchSnippet } from "@/lib/reports-search";
import { REPORT_ALL_LOCATIONS_LEVEL, canReadReportLocation, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { REPORTS_HUB_CASH_LEVEL, listReportsPage, type ReportTypeKey, type SignalFilters, type Viewer } from "@/lib/reports-hub";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadProfileDirectory } from "@/lib/profiles";
import { matchPeople, matchPages, type PageResult, type PersonResult } from "@/lib/unified-search";

import { BackLink } from "@/components/nav/BackLink";
import { ReportRangeControls } from "@/components/reports-hub/ReportRangeControls";
import { ReportFilterBar } from "@/components/reports-hub/ReportFilterBar";
import { ReportList } from "@/components/reports-hub/ReportList";
import { UnifiedSearchResults } from "@/components/reports-hub/UnifiedSearchResults";

const ALL_TYPES: ReportTypeKey[] = ["opening", "closing", "am_prep", "mid_day", "cash", "pm", "maintenance"];

interface PageProps {
  searchParams: Promise<Record<string, string | undefined> & {
    location?: string;
    range?: string;
    compare?: string;
    cmp?: string;
    cursor?: string;
    type?: string;
    from?: string;
    to?: string;
    // Signal filter toggles (checkbox GET params — present = "true" string)
    sf_underPar?: string;
    sf_overPar?: string;
    sf_skipped?: string;
    sf_tempFlag?: string;
    sf_cashOver?: string;
    sf_cashShort?: string;
    q?: string; // free-text quick-find
  }>;
}

export default async function ReportsPage({ searchParams }: PageProps): Promise<ReactNode> {
  return renderReportsPage(await searchParams);
}

async function renderReportsPage(params: Awaited<PageProps["searchParams"]>, allShops = false): Promise<ReactNode> {
  const auth = await requireSessionFromHeaders("/reports");
  if (auth.level < 2) redirect("/dashboard");
  const {
    location: locationParam,
    type: typeParam,
    sf_underPar,
    sf_overPar,
    sf_skipped,
    sf_tempFlag,
    sf_cashOver,
    sf_cashShort,
    q: qParam,
  } = params;

  if (!locationParam) redirect("/dashboard");
  if (locationParam === "all") {
    if (auth.level < REPORT_ALL_LOCATIONS_LEVEL) redirect("/reports");
    return <TrendShopPanels render={(id) => renderReportsPage({ ...params, location: id }, true)} />;
  }

  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!canReadReportLocation(locActor, locationParam)) redirect("/dashboard");

  const lang = auth.user.language;
  const locationId = locationParam;

  const range = parseReportRange(params, operationalNow(new Date()).date);
  const dateFrom = range.from;
  const dateTo = range.to;
  const context = reportRangeParams(range);
  for (const [key,value] of Object.entries(params)) if (value && !key.startsWith("cursor_") && !["cursor","from","to","range","compare","cmp"].includes(key)) context.set(key,value);
  if (allShops) context.set("location", "all");

  // ── Resolve type filter ──
  // Single-select: one type OR empty/"all" = all the viewer may see.
  const viewerLevel = auth.level;
  const allowedTypes: ReportTypeKey[] = ALL_TYPES.filter(
    (t) => t !== "cash" || viewerLevel >= REPORTS_HUB_CASH_LEVEL,
  );

  let selectedTypes: ReportTypeKey[] | undefined;
  if (typeParam && typeParam !== "all" && (ALL_TYPES as string[]).includes(typeParam)) {
    const t = typeParam as ReportTypeKey;
    // silently ignore if viewer can't see this type (e.g., L3 trying ?type=cash)
    if (allowedTypes.includes(t)) {
      selectedTypes = [t];
    }
  }

  const viewer: Viewer = { userId: auth.user.id, level: viewerLevel, locations: auth.locations };

  // ── Signal filters (derived toggles from GET params) ──
  // Cash toggles only respected when viewer is L4+ (cash-visible tier).
  const signalFilters: SignalFilters = {
    ...(sf_underPar === "true" ? { underPar: true } : {}),
    ...(sf_overPar === "true" ? { overPar: true } : {}),
    ...(sf_skipped === "true" ? { skipped: true } : {}),
    ...(sf_tempFlag === "true" ? { tempFlag: true } : {}),
    ...(sf_cashOver === "true" && viewerLevel >= REPORTS_HUB_CASH_LEVEL ? { cashOver: true } : {}),
    ...(sf_cashShort === "true" && viewerLevel >= REPORTS_HUB_CASH_LEVEL ? { cashShort: true } : {}),
  };
  const hasSignalFilters = Object.keys(signalFilters).length > 0;

  const sb = getServiceRoleClient();
  // Report browsing has a MoO+ all-shop grant independent of task/write scope.
  let reportLocations: Array<{ id: string; name: string }> = [];
  if (auth.level >= REPORT_ALL_LOCATIONS_LEVEL) {
    const { data, error } = await sb.from("locations").select("id, name").eq("active", true).order("name");
    if (error) throw new Error(`report locations: ${error.message}`);
    reportLocations = data ?? [];
  }
  const query = (qParam ?? "").trim();
  const snippets = new Map<string, SearchSnippet>();
  const page = await listReportsPage(sb, {
    viewer, locationId, dateFrom, dateTo, types: selectedTypes,
    signalFilters: hasSignalFilters ? signalFilters : undefined,
    cursor: allShops ? params[`cursor_${locationId}`] : params.cursor, query, context: context.toString(),
    match: query ? async items => {
      const corpus = await buildSearchCorpus(sb, {viewer, locationId, items});
      return items.filter(it => {
        const result = searchReport(it, serverT(lang, `reports.type.${it.type}` as TranslationKey), corpus.get(`${it.type}:${it.id}`), query);
        if (result.snippet) snippets.set(`${it.type}:${it.id}`, result.snippet);
        return result.matched;
      });
    } : undefined,
  });
  const filteredItems = page.items;
  const nextParams = new URLSearchParams(context);
  if (allShops) {
    for (const [key, value] of Object.entries(params)) if (key.startsWith("cursor_") && value) nextParams.set(key, value);
  }
  if (page.nextCursor) nextParams.set(allShops ? `cursor_${locationId}` : "cursor", page.nextCursor);

  // Unified search: People + Pages, only when searching. Each source is its
  // own authorized loader — the matchers filter an already-authorized set.
  let people: PersonResult[] = [];
  let peopleHasMore = false;
  let pages: PageResult[] = [];
  if (query) {
    const directory = await loadProfileDirectory(sb, {
      viewer: { userId: auth.user.id, locations: auth.locations },
    });
    const pm = matchPeople(directory, query, (role) => serverT(lang, `role.${role}` as TranslationKey));
    people = pm.people;
    peopleHasMore = pm.hasMore;
    pages = matchPages(viewerLevel, query, (key) => serverT(lang, key));
  }
  const nothingMatched =
    query.length > 0 && people.length === 0 && pages.length === 0 && filteredItems.length === 0;

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <BackLink hrefOverride={`/reports?${context}`} />
      </div>
      {reportLocations.length > 1 ? (
        <nav className="mb-4 flex flex-wrap gap-2" aria-label={serverT(lang, "dashboard.location.switcher_aria")}>
          {reportLocations.map((shop) => (
            <Link key={shop.id} href={`/reports/operations?${new URLSearchParams({...Object.fromEntries(context), location: shop.id})}`} aria-current={shop.id === locationId ? "page" : undefined}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-co-border-2 px-3 text-sm font-bold text-co-text hover:bg-co-surface-2">
              {shop.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-co-text">
          {serverT(lang, "reports.page.title")}
        </h1>
        {auth.level >= 4 ? <Link
          href={`/reports/trends/ops?${context}`}
          className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-4 text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted transition hover:border-co-text hover:text-co-text"
        >
          {serverT(lang, "reports.trends.nav_label")}
        </Link> : null}
      </div>

      {viewerLevel < 4 ? <p className="mb-4 text-sm text-co-text-muted">{serverT(lang, "reports.hub.own_scope")}</p> : null}
      <ReportRangeControls range={range} locationId={allShops ? "all" : locationId} language={lang} action="/reports/operations" preserve={params}
        shortened={validReportDate(params.from) && params.from < range.from} />
      <ReportFilterBar
        locationId={allShops ? "all" : locationId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        selectedType={typeParam ?? "all"}
        allowedTypes={allowedTypes}
        language={lang}
        viewerLevel={viewerLevel}
        activeSignalFilters={signalFilters}
        query={qParam ?? ""}
        compare={range.compare}
      />

      {query ? (
        <div className="mt-4">
          <UnifiedSearchResults
            people={people}
            peopleHasMore={peopleHasMore}
            pages={pages}
            locationId={locationId}
            language={lang}
          />
        </div>
      ) : null}

      {nothingMatched ? (
        <p className="mt-4 rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
          {serverT(lang, "reports.search.no_matches", { q: query })}
        </p>
      ) : (
        <div className="mt-4">
          <ReportList
            items={filteredItems}
            locationId={locationId}
            language={lang}
            viewerLevel={viewerLevel}
            searchQuery={qParam ?? ""}
            snippets={snippets}
            context={context.toString()}
          />
        </div>
      )}
      {page.nextCursor ? <Link className="inline-flex min-h-[44px] items-center px-4" href={`/reports/operations?${nextParams}`}>{serverT(lang, "reports.pagination.next")}</Link> : null}
    </main>
  );
}
