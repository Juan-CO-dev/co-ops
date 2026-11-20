/**
 * /reports/business — the business report (item 9 PR 9b). Plan: CHIEF item-09-FULL-REPORT-PLAN-r2.md; Juan's
 * answers 2026-11-18. Overview / Hours / Channels / People / Compare, one URL-selected tab per request.
 *
 * DARK until BUSINESS_REPORT, FACT_LAYER and FACT_LAYER_LABOR are all "1": off, or a role that may not read it
 * (every level-6 role and below, the AGM and the social media manager included), and the page redirects to the
 * hub before any read. The loader re-checks all of it (lib/business-report.ts assertBusinessScope).
 *
 * WHO SEES WHAT (business report access, Juan 2026-11-19; plan item-09-BUSINESS-REPORT-ACCESS-PLAN-r6.md):
 *   MoO / Owner / CGS (by ROLE): every shop, "All shops" (each shop's report stacked; ratios are never blended across
 *     shops), and everything in it.
 *   GM (by ROLE): the shops they belong to, never "All shops", and what the MoO+ setting holds for GMs
 *     (0349; lib/business-access-shared.ts). Never cost per person, never labor dollars per 15 minutes.
 * The loader decides and CUTS the report; this page only follows the access the loaded report carries:
 *   - before any report read, the settings as they are NOW (`resolveBusinessAccess`): the report off for GMs
 *     redirects to the hub; a settings store that cannot be read shows "not available";
 *   - after the load(s) and before anything is rendered from them, `assertBusinessSurface` on the loaded
 *     report(s): a tab that is not in the report is a refusal card, never the tab;
 *   - the tab strip and the CSV / PDF links of a LOADED panel come from that report's own access (never the earlier
 *     read); the earlier read decides them only when nothing was loaded (an empty range, a refused load).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ExportLinks } from "@/components/reports-export/ExportLinks";
import { ReportPageNav } from "@/components/reports-hub/ReportPageNav";
import { ReportShopTabs } from "@/components/reports-hub/ReportShopTabs";
import { TrendShopPanels } from "@/components/trends/TrendShopPanels";
import { BUSINESS_EMPTY_KEY, BUSINESS_EXPORT_OFF_KEY, BusinessRangeControls, BusinessTabs, BusinessUnavailable, bizCard, tFor } from "@/components/reports-business/BusinessParts";
import { BusinessChannels, BusinessCompare, BusinessHours, BusinessOverview, BusinessPeople } from "@/components/reports-business/BusinessReport";
import { businessAllShopsAllowed, businessShopAllowed, businessTabAllowed, businessTabsFor, canManageBusinessVisibility, type BusinessAccess } from "@/lib/business-access-shared";
import { BusinessReportError, assertBusinessSurface, loadBusinessReport, resolveBusinessAccess, resolveBusinessRange } from "@/lib/business-report";
import { businessView } from "@/lib/business-view-shared";
import { businessReportEnabled, businessReportRefusal, businessTab, parseBusinessRangeRequest } from "@/lib/business-report-shared";
import { operationalNow } from "@/lib/midshift";
import { reportNavigationHref } from "@/lib/report-navigation";
import { SALES_READ_MIN } from "@/lib/sales-reports-shared";
import { requireSessionFromHeaders } from "@/lib/session";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { resolveReportShopId } from "@/lib/shop-context";

type Params = Record<string, string | undefined>;

export default async function BusinessReportPage({ searchParams }: { searchParams: Promise<Params> }): Promise<ReactNode> {
  const params = await searchParams;
  const auth = await requireSessionFromHeaders("/reports/business");
  // Dark behind its switch; GM / MoO / Owner / CGS by ROLE. Both before any read.
  if (!businessReportEnabled(process.env) || auth.level < SALES_READ_MIN || businessReportRefusal(auth.role)) redirect("/reports");
  const viewer = { userId: auth.user.id, level: auth.level, locations: auth.locations, role: auth.role };
  const locationId = shopParamFor("/reports/business", searchParamValues(params)) ?? (await resolveReportShopId(auth));
  if (!locationId) redirect("/dashboard");
  // By ROLE: "All shops" is MoO / Owner / CGS; a GM reads only a shop they belong to.
  if (locationId === "all" ? !businessAllShopsAllowed(auth.role) : !businessShopAllowed(viewer, locationId)) redirect("/reports");

  const language = auth.user.language;
  const t = tFor(language);
  // What this viewer may see, as the settings are NOW (MoO / Owner / CGS: everything, no read). The report switched
  // off for GMs is the hub; a settings store that cannot be read is "not available", never a wider report.
  let early: BusinessAccess | null = null;
  let unavailable: string | null = null;
  try {
    early = await resolveBusinessAccess(viewer);
  } catch (error) {
    if (!(error instanceof BusinessReportError)) throw error;
    if (error.status !== 503) redirect("/reports");
    unavailable = error.code;
  }

  const today = operationalNow(new Date()).date;
  // Fix round 6 (ITEM9B-r6 P2): ONE parse of the raw query. The form shows `request.form`, every link (controls,
  // tabs, nav, shop tabs, both exports) carries `request.query`, which re-parses to THIS request — an empty one
  // stays empty, a missing date stays missing — never a date rebuilt from a normalized or default range.
  const request = parseBusinessRangeRequest(params, today);
  // A tab this viewer's report does not hold falls back to the Overview (the loaded report is checked again below).
  const asked = businessTab(params.tab);
  const tab = early !== null && businessTabAllowed(early, asked) ? asked : "overview";
  const context: Params = { ...request.query, tab, hubLocation: params.hubLocation, location: locationId };
  const href = (extra: Params = {}) => reportNavigationHref("/reports/business", { ...context, ...extra });

  /** `access` = the access the page's controls follow: a loaded panel's own, else the early read. */
  const header = (access: BusinessAccess | null) => <>
    <ReportPageNav viewerLevel={auth.level} path="/reports/business" params={context} language={language} />
    <ReportShopTabs path="/reports/business" params={context} locationId={locationId} language={language} viewer={auth} />
    <h1 className="mb-3 text-lg font-bold text-co-text">{t("reports.business.title")}</h1>
    {canManageBusinessVisibility(auth.role) ? <p className="mb-3"><Link href="/admin/sevenshifts" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-co-text underline">
      {t("reports.business.access.settings_link")}</Link></p> : null}
    <BusinessRangeControls request={request} locationId={locationId} tab={tab} language={language} />
    {access !== null ? <BusinessTabs tab={tab} tabs={businessTabsFor(access)} language={language} hrefFor={(v) => href({ tab: v })} /> : null}
  </>;
  if (early === null) return <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6 md:max-w-3xl lg:max-w-5xl">
    {header(null)}
    <BusinessUnavailable code={unavailable ?? "business_access_unavailable"} language={language} />
  </main>;

  const panel = async (shopId: string): Promise<{ node: ReactNode; access: BusinessAccess }> => {
    let body: ReactNode;
    // The access of the LOADED report (kept even when the surface check then refuses the tab); null = nothing loaded.
    let loaded: BusinessAccess | null = null;
    try {
      if (request.kind === "empty") body = <p className={`${bizCard} text-sm text-co-text-muted`} role="status">{t(BUSINESS_EMPTY_KEY[request.reason])}</p>;
      else {
        const range = request.range;
        const current = await loadBusinessReport(viewer, { locationId: shopId, range });
        loaded = current.access;
        const earlier = tab === "compare" ? await loadBusinessReport(viewer, { locationId: shopId, range: resolveBusinessRange({ range: "custom", ...range.previous }, today) }) : null;
        // The tab is judged on the access the report(s) were BUILT with, before anything is rendered from them.
        assertBusinessSurface(earlier ? [current, earlier] : [current], tab, { download: false });
        // The tabs get the VIEW (lib/business-view-shared.ts: every figure sealed with its state), never the DTO.
        const view = businessView(current);
        if (tab === "hours") body = <BusinessHours view={view} language={language} />;
        else if (tab === "channels") body = <BusinessChannels view={view} language={language} />;
        else if (tab === "people") body = <BusinessPeople view={view} language={language} />;
        else if (tab === "compare") body = <BusinessCompare view={view} previous={earlier ? businessView(earlier) : null} language={language} />;
        else body = <BusinessOverview view={view} language={language} />;
      }
    } catch (error) {
      if (error instanceof BusinessReportError) body = <BusinessUnavailable code={error.code} language={language} />;
      else throw error;
    }
    const access = loaded ?? early;
    // Polish: a request with no range (no dates, a start after the end, no finished day yet) has nothing to
    // download, so the CSV / PDF links are not offered and the reason is said in their place. Downloads that are
    // not in this viewer's report are not offered either (the export refuses them whatever the page shows).
    return { access, node: <div className="mb-6">
      {request.kind === "empty" ? <p className="mb-3 text-xs text-co-text-muted" role="note">{t(BUSINESS_EXPORT_OFF_KEY[request.reason])}</p>
        : access.export ? <ExportLinks className="mb-3" family="business" language={language} query={{ ...context, location: shopId }} />
          : <p className="mb-3 text-xs text-co-text-muted" role="note">{t("reports.business.export.off.not_shared")}</p>}
      {body}
    </div> };
  };

  // "All shops" is MoO / Owner / CGS only: their access is everything, for every shop (the early read IS it).
  if (locationId === "all") return <TrendShopPanels header={header(early)} render={async (shopId) => (await panel(shopId)).node} />;
  // One shop: the panel is loaded FIRST, and the tab strip follows the access it was built with.
  const one = await panel(locationId);
  return <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6 md:max-w-3xl lg:max-w-5xl">
    {header(one.access)}
    {one.node}
  </main>;
}
