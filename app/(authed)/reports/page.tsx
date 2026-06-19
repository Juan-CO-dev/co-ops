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
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { REPORTS_HUB_CASH_LEVEL, listReports, type ReportTypeKey, type SignalFilters, type Viewer } from "@/lib/reports-hub";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { ReportFilterBar } from "@/components/reports-hub/ReportFilterBar";
import { ReportList } from "@/components/reports-hub/ReportList";

const ALL_TYPES: ReportTypeKey[] = ["opening", "closing", "am_prep", "mid_day", "cash", "pm", "maintenance"];

interface PageProps {
  searchParams: Promise<{
    location?: string;
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

export default async function ReportsPage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/reports");
  const {
    location: locationParam,
    type: typeParam,
    from: fromParam,
    to: toParam,
    sf_underPar,
    sf_overPar,
    sf_skipped,
    sf_tempFlag,
    sf_cashOver,
    sf_cashShort,
    q: qParam,
  } = await searchParams;

  if (!locationParam) redirect("/dashboard");

  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, locationParam)) redirect("/dashboard");

  const lang = auth.user.language;
  const locationId = locationParam;

  // ── Default date range: last 14 days ending today (operational TZ) ──
  const todayDate = operationalNow(new Date()).date;
  const fourteenDaysAgo = operationalNow(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)).date;

  const dateFrom = fromParam ?? fourteenDaysAgo;
  const dateTo = toParam ?? todayDate;

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

  const viewer: Viewer = { userId: auth.user.id, level: viewerLevel };

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
  const items = await listReports(sb, {
    viewer,
    locationId,
    dateFrom,
    dateTo,
    types: selectedTypes,
    signalFilters: hasSignalFilters ? signalFilters : undefined,
  });

  // Phase-2 deep search: when q is present, build the viewer-authorized corpus
  // for the listed reports and match q over name/type + authorized deep fields.
  // The corpus is redacted to the viewer BEFORE matching, so a match/snippet can
  // never disclose a field the viewer can't see. Built ONLY when q is non-empty.
  const query = (qParam ?? "").trim();
  let filteredItems = items;
  const snippets = new Map<string, SearchSnippet>();
  if (query) {
    const corpus = await buildSearchCorpus(sb, { viewer, locationId, items });
    filteredItems = items.filter((it) => {
      const typeLabel = serverT(lang, `reports.type.${it.type}` as TranslationKey);
      const res = searchReport(
        { submitterName: it.submitterName, type: it.type },
        typeLabel,
        corpus.get(`${it.type}:${it.id}`),
        query,
      );
      if (res.matched && res.snippet) snippets.set(`${it.type}:${it.id}`, res.snippet);
      return res.matched;
    });
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-co-text">
          {serverT(lang, "reports.page.title")}
        </h1>
        <Link
          href={`/reports/trends?location=${locationId}`}
          className="inline-flex min-h-[40px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-4 text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted transition hover:border-co-text hover:text-co-text"
        >
          {serverT(lang, "reports.trends.nav_label")}
        </Link>
      </div>

      <ReportFilterBar
        locationId={locationId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        selectedType={typeParam ?? "all"}
        allowedTypes={allowedTypes}
        language={lang}
        viewerLevel={viewerLevel}
        activeSignalFilters={signalFilters}
        query={qParam ?? ""}
      />

      <div className="mt-4">
        <ReportList
          items={filteredItems}
          locationId={locationId}
          language={lang}
          viewerLevel={viewerLevel}
          searchQuery={qParam ?? ""}
          snippets={snippets}
        />
      </div>
    </main>
  );
}
