/**
 * /reports/sales — the Sales root (Reports hub piece 4, Phase 2b).
 *
 * Juan 2026-10-08: GM+ sees their own shop, level 8+ every shop (stacked per-shop panels); 12
 * months of history in ranges; discounts by name; credit to the order's server; channels per the
 * reviewed map with E-Gift Cards excluded; ezCater orders are the revenue source of truth and a
 * linked Toast ring is never counted twice. One URL-selected view per request (summary, items,
 * modifiers, channels, heatmap, discounts, servers), so a 12-month request runs one bounded
 * aggregation, not seven.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ExportLinks } from "@/components/reports-export/ExportLinks";
import { ReportPageNav } from "@/components/reports-hub/ReportPageNav";
import { ReportRangeControls } from "@/components/reports-hub/ReportRangeControls";
import { ReportShopTabs } from "@/components/reports-hub/ReportShopTabs";
import { SalesBreakdown, type BreakdownView } from "@/components/reports-hub/SalesBreakdown";
import { SalesHeatmap } from "@/components/reports-hub/SalesHeatmap";
import { RangeCaption, SalesUnavailable, SalesViewTabs, salesLink, tFor } from "@/components/reports-hub/SalesParts";
import { SalesSummary } from "@/components/reports-hub/SalesSummary";
import { TrendShopPanels } from "@/components/trends/TrendShopPanels";
import { REPORT_ALL_LOCATIONS_LEVEL } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { reportNavigationHref } from "@/lib/report-navigation";
import { canReadScopedReport } from "@/lib/report-scope";
import {
  SALES_EMPTY_KEY, SALES_GRAINS, SALES_RANGES, SALES_READ_MIN, SalesReportError, VIEW_DIMENSION, isSalesView, loadSalesBreakdown,
  loadSalesSummary, pageRows, resolveSalesRange, salesRangeParams, type BreakdownRow, type SalesView,
} from "@/lib/sales-reports";
import { requireSessionFromHeaders } from "@/lib/session";

type Params = Record<string, string | undefined>;

export default async function SalesPage({ searchParams }: { searchParams: Promise<Params> }): Promise<ReactNode> {
  const params = await searchParams;
  const auth = await requireSessionFromHeaders("/reports/sales");
  if (auth.level < SALES_READ_MIN) redirect("/reports");
  const viewer = { userId: auth.user.id, level: auth.level, locations: auth.locations };
  const locationId = params.location ?? auth.locations[0];
  if (!locationId) redirect("/dashboard");
  if (locationId === "all" ? auth.level < REPORT_ALL_LOCATIONS_LEVEL : !canReadScopedReport(viewer, locationId)) redirect("/reports");

  const language = auth.user.language;
  const t = tFor(language);
  const range = resolveSalesRange(params, operationalNow(new Date()).date);
  const view: SalesView = isSalesView(params.view) ? params.view : "summary";
  // Canonical context: the effective range, the view, the hub provenance. Cursors/offsets never ride along.
  const context: Params = { ...salesRangeParams(range), view, hubLocation: params.hubLocation, location: locationId };
  const href = (path: string, extra: Params = {}, shop?: string) => reportNavigationHref(path, { ...context, ...extra }, shop);

  const header = <>
    <ReportPageNav viewerLevel={auth.level} path="/reports/sales" params={context} language={language} />
    <ReportShopTabs path="/reports/sales" params={context} locationId={locationId} language={language} viewer={auth} />
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-lg font-bold text-co-text">{t("reports.hub.sales")}</h1>
      <div className="flex flex-wrap gap-2">
        <Link className={salesLink} href={href("/reports/sales/checks", { view: undefined })}>{t("reports.sales.checks_link")}</Link>
        <Link className={salesLink} href={href("/reports/sales/catering", { view: undefined })}>{t("reports.sales.catering_link")}</Link>
      </div>
    </div>
    <ReportRangeControls range={range} locationId={locationId} language={language} action="/reports/sales" preserve={{ view, hubLocation: params.hubLocation }}
      ranges={SALES_RANGES} grains={SALES_GRAINS} grain={range.grain} capKey="reports.sales.cap" shortened={range.shortened} shortenedKey="reports.sales.range_shortened" />
    <SalesViewTabs view={view} language={language} hrefFor={(v) => href("/reports/sales", { view: v })} />
  </>;

  const panel = async (shopId: string): Promise<ReactNode> => {
    const shopHref = (path: string, extra: Params = {}) => href(path, { view: undefined, ...extra }, shopId);
    const checksHref = (from: string, to: string) => shopHref("/reports/sales/checks", { range: "custom", from, to });
    let body: ReactNode;
    try {
      if (view === "summary") {
        const summary = await loadSalesSummary(viewer, { locationId: shopId, range });
        body = <>
          <RangeCaption from={range.from} to={range.to} language={language} todaySoFar={range.todaySoFar} capturedAt={summary.capturedAt} />
          <SalesSummary summary={summary} language={language} checksHref={checksHref} />
        </>;
      } else {
        const rows = await loadSalesBreakdown(viewer, { locationId: shopId, range, dimension: VIEW_DIMENSION[view] });
        const caption = <RangeCaption from={range.from} to={range.to} language={language} todaySoFar={range.todaySoFar} />;
        if (view === "heatmap") {
          body = <>{caption}<SalesHeatmap rows={rows} language={language}
            cellHref={(dow, hour) => shopHref("/reports/sales/checks", { ...(dow ? { dow: String(dow) } : {}), hour: String(hour) })} /></>;
        } else {
          const offsetKey = locationId === "all" ? `offset_${shopId}` : "offset";
          const offset = Number(params[offsetKey] ?? 0);
          const page = pageRows(rows, Number.isSafeInteger(offset) ? offset : 0);
          const drill = (r: BreakdownRow): string | null => {
            const key = r.key === "" ? SALES_EMPTY_KEY : r.key;
            if (view === "discounts") return shopHref("/reports/sales/checks", { discount: key });
            if (view === "servers") return shopHref("/reports/sales/checks", { server: key });
            if (view === "channels" && r.saleClass === "sale") {
              return shopHref("/reports/sales/checks", { channel: r.channel, provider: r.provider ?? SALES_EMPTY_KEY });
            }
            return null; // units-only rows and excluded/ezCater rows have no check list behind them
          };
          // Per-shop panels page independently: keep every other panel's offset.
          const offsets = Object.fromEntries(Object.entries(params).filter(([k]) => k.startsWith("offset_")));
          const nextHref = page.nextOffset !== null ? reportNavigationHref("/reports/sales", { ...context, ...offsets, [offsetKey]: String(page.nextOffset) }) : null;
          body = <>{caption}<SalesBreakdown view={view as BreakdownView} rows={view === "channels" ? rows : page.rows} offset={view === "channels" ? 0 : Math.max(0, offset)}
            total={rows.length} language={language} drillHref={drill} nextHref={view === "channels" ? null : nextHref} /></>;
        }
      }
    } catch (error) {
      if (error instanceof SalesReportError && error.status === 503) body = <SalesUnavailable code={error.code} language={language} />;
      else throw error;
    }
    return <div className="mb-6">
      <ExportLinks className="mb-3" family="sales" language={language} query={{ ...context, location: shopId }} />
      {body}
    </div>;
  };

  if (locationId === "all") return <TrendShopPanels header={header} render={panel} />;
  return <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6 md:max-w-3xl lg:max-w-5xl xl:max-w-6xl">
    {header}
    {await panel(locationId)}
  </main>;
}
