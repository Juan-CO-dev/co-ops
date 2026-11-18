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
import { BusinessRangeControls, BusinessTabs, BusinessUnavailable, bizCard, tFor } from "@/components/reports-business/BusinessParts";
import { BusinessChannels, BusinessCompare, BusinessHours, BusinessOverview, BusinessPeople } from "@/components/reports-business/BusinessReport";
import { BusinessReportError, loadBusinessReport, resolveBusinessRange, type BusinessReportDto } from "@/lib/business-report";
import { businessReportEnabled, businessReportRefusal, businessTab } from "@/lib/business-report-shared";
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
  const range = resolveBusinessRange(params, today);
  const tab = businessTab(params.tab);
  const rangeParams: Params = range.range === "custom" ? { range: "custom", from: range.from, to: range.to } : { range: range.range };
  const context: Params = { ...rangeParams, tab, hubLocation: params.hubLocation, location: locationId };
  const href = (extra: Params = {}) => reportNavigationHref("/reports/business", { ...context, ...extra });

  const header = <>
    <ReportPageNav viewerLevel={auth.level} path="/reports/business" params={context} language={language} />
    <ReportShopTabs path="/reports/business" params={context} locationId={locationId} language={language} viewer={auth} />
    <h1 className="mb-3 text-lg font-bold text-co-text">{t("reports.business.title")}</h1>
    <BusinessRangeControls range={range} locationId={locationId} tab={tab} language={language} />
    <BusinessTabs tab={tab} language={language} hrefFor={(v) => href({ tab: v })} />
  </>;

  const panel = async (shopId: string): Promise<ReactNode> => {
    let body: ReactNode;
    try {
      if (range.empty) body = <p className={`${bizCard} text-sm text-co-text-muted`}>{t("reports.business.no_finished_days")}</p>;
      else {
        const dto = await loadBusinessReport(viewer, { locationId: shopId, range });
        if (tab === "hours") body = <BusinessHours dto={dto} language={language} />;
        else if (tab === "channels") body = <BusinessChannels dto={dto} language={language} />;
        else if (tab === "people") body = <BusinessPeople dto={dto} language={language} />;
        else if (tab === "compare") {
          const previous: BusinessReportDto = await loadBusinessReport(viewer, { locationId: shopId, range: resolveBusinessRange({ range: "custom", ...range.previous }, today) });
          body = <BusinessCompare dto={dto} previous={previous} language={language} />;
        } else body = <BusinessOverview dto={dto} language={language} />;
      }
    } catch (error) {
      if (error instanceof BusinessReportError) body = <BusinessUnavailable code={error.code} language={language} />;
      else throw error;
    }
    return <div className="mb-6">
      <ExportLinks className="mb-3" family="business" language={language} query={{ ...context, location: shopId }} />
      {body}
    </div>;
  };

  if (locationId === "all") return <TrendShopPanels header={header} render={panel} />;
  return <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6 md:max-w-3xl lg:max-w-5xl">
    {header}
    {await panel(locationId)}
  </main>;
}
