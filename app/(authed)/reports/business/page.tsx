/**
 * /reports/business — the business report (item 9 PR 9b). Plan: CHIEF item-09-FULL-REPORT-PLAN-r2.md; Juan's
 * answers 2026-11-18. Overview / Hours / Channels / People / Compare, one URL-selected tab per request.
 *
 * DARK until BUSINESS_REPORT, FACT_LAYER and FACT_LAYER_LABOR are all "1": off, or a role that may not read it
 * (every level-6 role and below, the AGM and the social media manager included), and the page redirects to the
 * hub before any read. The loader re-checks all of it (lib/business-report.ts assertBusinessScope).
 * GM: own shop, hours per person, sales per server, shop labor totals; MoO+: also cost per person and labor
 * dollars per 15 minutes (PERSON_COST_MIN / QUARTER_COST_MIN decide, in the loader). Level 8+: every shop
 * (stacked panels; ratios are never blended across shops).
 */
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ExportLinks } from "@/components/reports-export/ExportLinks";
import { ReportPageNav } from "@/components/reports-hub/ReportPageNav";
import { ReportShopTabs } from "@/components/reports-hub/ReportShopTabs";
import { TrendShopPanels } from "@/components/trends/TrendShopPanels";
import { BUSINESS_EMPTY_KEY, BUSINESS_EXPORT_OFF_KEY, BusinessRangeControls, BusinessTabs, BusinessUnavailable, bizCard, tFor } from "@/components/reports-business/BusinessParts";
import { BusinessChannels, BusinessCompare, BusinessHours, BusinessOverview, BusinessPeople } from "@/components/reports-business/BusinessReport";
import { BusinessReportError, loadBusinessReport, resolveBusinessRange } from "@/lib/business-report";
import { businessView } from "@/lib/business-view-shared";
import { businessReportEnabled, businessReportRefusal, businessTab, parseBusinessRangeRequest } from "@/lib/business-report-shared";
import { REPORT_ALL_LOCATIONS_LEVEL } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { reportNavigationHref } from "@/lib/report-navigation";
import { canReadScopedReport } from "@/lib/report-scope";
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
  if (locationId === "all" ? auth.level < REPORT_ALL_LOCATIONS_LEVEL : !canReadScopedReport(viewer, locationId)) redirect("/reports");

  const language = auth.user.language;
  const t = tFor(language);
  const today = operationalNow(new Date()).date;
  // Fix round 6 (ITEM9B-r6 P2): ONE parse of the raw query. The form shows `request.form`, every link (controls,
  // tabs, nav, shop tabs, both exports) carries `request.query`, which re-parses to THIS request — an empty one
  // stays empty, a missing date stays missing — never a date rebuilt from a normalized or default range.
  const request = parseBusinessRangeRequest(params, today);
  const tab = businessTab(params.tab);
  const context: Params = { ...request.query, tab, hubLocation: params.hubLocation, location: locationId };
  const href = (extra: Params = {}) => reportNavigationHref("/reports/business", { ...context, ...extra });

  const header = <>
    <ReportPageNav viewerLevel={auth.level} path="/reports/business" params={context} language={language} />
    <ReportShopTabs path="/reports/business" params={context} locationId={locationId} language={language} viewer={auth} />
    <h1 className="mb-3 text-lg font-bold text-co-text">{t("reports.business.title")}</h1>
    <BusinessRangeControls request={request} locationId={locationId} tab={tab} language={language} />
    <BusinessTabs tab={tab} language={language} hrefFor={(v) => href({ tab: v })} />
  </>;

  const panel = async (shopId: string): Promise<ReactNode> => {
    let body: ReactNode;
    try {
      if (request.kind === "empty") body = <p className={`${bizCard} text-sm text-co-text-muted`} role="status">{t(BUSINESS_EMPTY_KEY[request.reason])}</p>;
      else {
        const range = request.range;
        // The tabs get the VIEW (lib/business-view-shared.ts: every figure sealed with its state), never the DTO.
        const view = businessView(await loadBusinessReport(viewer, { locationId: shopId, range }));
        if (tab === "hours") body = <BusinessHours view={view} language={language} />;
        else if (tab === "channels") body = <BusinessChannels view={view} language={language} />;
        else if (tab === "people") body = <BusinessPeople view={view} language={language} />;
        else if (tab === "compare") {
          const previous = businessView(await loadBusinessReport(viewer, { locationId: shopId, range: resolveBusinessRange({ range: "custom", ...range.previous }, today) }));
          body = <BusinessCompare view={view} previous={previous} language={language} />;
        } else body = <BusinessOverview view={view} language={language} />;
      }
    } catch (error) {
      if (error instanceof BusinessReportError) body = <BusinessUnavailable code={error.code} language={language} />;
      else throw error;
    }
    // Polish: a request with no range (no dates, a start after the end, no finished day yet) has nothing to
    // download, so the CSV / PDF links are not offered and the reason is said in their place.
    return <div className="mb-6">
      {request.kind === "empty" ? <p className="mb-3 text-xs text-co-text-muted" role="note">{t(BUSINESS_EXPORT_OFF_KEY[request.reason])}</p>
        : <ExportLinks className="mb-3" family="business" language={language} query={{ ...context, location: shopId }} />}
      {body}
    </div>;
  };

  if (locationId === "all") return <TrendShopPanels header={header} render={panel} />;
  return <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6 md:max-w-3xl lg:max-w-5xl">
    {header}
    {await panel(locationId)}
  </main>;
}
