/**
 * /reports/sales/checks — the checks behind every Sales number (Reports hub piece 4).
 *
 * The SAME eligible-facts predicate as the summary (0232 `sale` class), newest business date first,
 * 50 per page, keyset cursor bound to shop + effective window + filters (a tampered or stale cursor
 * restarts at page one, never skips or repeats). Filters are a closed allowlist parsed on the
 * server; every value reaches SQL as a bound parameter.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ExportLinks } from "@/components/reports-export/ExportLinks";
import { ReportPageNav } from "@/components/reports-hub/ReportPageNav";
import { ReportRangeControls } from "@/components/reports-hub/ReportRangeControls";
import { ReportShopTabs } from "@/components/reports-hub/ReportShopTabs";
import { Money, RangeCaption, SalesUnavailable, channelLabel, discountLabel, providerLabel, salesCard, salesLink, serverLabel, tFor } from "@/components/reports-hub/SalesParts";
import { TrendShopPanels } from "@/components/trends/TrendShopPanels";
import { formatDateLabel, formatQuantity, formatTime, formatWeekday } from "@/lib/i18n/format";
import { REPORT_ALL_LOCATIONS_LEVEL } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { reportNavigationHref } from "@/lib/report-navigation";
import { shiftReportDate } from "@/lib/report-range";
import { canReadScopedReport } from "@/lib/report-scope";
import {
  SALES_GRAINS, SALES_RANGES, SALES_READ_MIN, SalesReportError, loadSalesCheckPage, parseSalesCheckFilters, resolveSalesRange,
  salesFilterParams, salesRangeParams, type SalesCheckFilters,
} from "@/lib/sales-reports";
import { requireSessionFromHeaders } from "@/lib/session";

type Params = Record<string, string | undefined>;

export default async function SalesChecksPage({ searchParams }: { searchParams: Promise<Params> }): Promise<ReactNode> {
  const params = await searchParams;
  const auth = await requireSessionFromHeaders("/reports/sales/checks");
  if (auth.level < SALES_READ_MIN) redirect("/reports");
  const viewer = { userId: auth.user.id, level: auth.level, locations: auth.locations };
  const locationId = params.location ?? auth.locations[0];
  if (!locationId) redirect("/dashboard");
  if (locationId === "all" ? auth.level < REPORT_ALL_LOCATIONS_LEVEL : !canReadScopedReport(viewer, locationId)) redirect("/reports");

  const language = auth.user.language;
  const t = tFor(language);
  const range = resolveSalesRange(params, operationalNow(new Date()).date);
  const filters = parseSalesCheckFilters(params);
  const filterParams = salesFilterParams(filters);
  const context: Params = { ...salesRangeParams(range), ...filterParams, hubLocation: params.hubLocation, location: locationId };

  const chips = filterChips(filters, language);
  const header = <>
    <ReportPageNav viewerLevel={auth.level} path="/reports/sales/checks" params={context} language={language} />
    <ReportShopTabs path="/reports/sales/checks" params={context} locationId={locationId} language={language} viewer={auth} />
    <h1 className="mb-3 text-lg font-bold text-co-text">{t("reports.sales.checks.title")}</h1>
    <ReportRangeControls range={range} locationId={locationId} language={language} action="/reports/sales/checks"
      preserve={{ ...filterParams, hubLocation: params.hubLocation }} ranges={SALES_RANGES} grains={SALES_GRAINS} grain={range.grain}
      capKey="reports.sales.cap" shortened={range.shortened} shortenedKey="reports.sales.range_shortened" />
    {chips.length ? <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs font-bold tracking-wide text-co-text-muted">{t("reports.sales.filters")}</span>
      {chips.map((c) => <span key={c} className="min-w-0 max-w-full break-words rounded-full border border-co-border-2 bg-co-surface px-3 py-1">{c}</span>)}
      <Link className={salesLink} href={reportNavigationHref("/reports/sales/checks", { ...salesRangeParams(range), hubLocation: params.hubLocation, location: locationId })}>{t("reports.sales.clear_filters")}</Link>
    </div> : null}
  </>;

  const panel = async (shopId: string): Promise<ReactNode> => {
    const cursorKey = locationId === "all" ? `cursor_${shopId}` : "cursor";
    let body: ReactNode;
    try {
      const page = await loadSalesCheckPage(viewer, { locationId: shopId, range, filters, cursor: params[cursorKey] });
      const detailHref = (date: string, check: string) => reportNavigationHref(`/reports/sales/checks/${encodeURIComponent(check)}`,
        { ...context, date, cursor: params[cursorKey] }, shopId);
      const cursors = Object.fromEntries(Object.entries(params).filter(([k]) => k.startsWith("cursor_")));
      const nextHref = page.nextCursor ? reportNavigationHref("/reports/sales/checks", { ...context, ...cursors, [cursorKey]: page.nextCursor }) : null;
      body = <section className={salesCard} aria-label={t("reports.sales.checks.title")}>
        {page.cursorReset ? <p className="mb-2 text-xs text-co-warning-text">{t("reports.sales.cursor_reset")}</p> : null}
        {page.rows.length === 0 ? <p className="text-sm text-co-text-muted">{t("reports.sales.no_checks")}</p> : <ul className="divide-y divide-co-border">
          {page.rows.map((r) => <li key={`${r.businessDate}|${r.checkGuid}`}>
            <Link href={detailHref(r.businessDate, r.checkGuid)} className="flex min-h-[44px] min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 hover:bg-co-surface-2">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{formatDateLabel(r.businessDate, language)}{r.openedAt ? ` · ${formatTime(r.openedAt, language)}` : ""}</span>
                <span className="block truncate text-xs text-co-text-muted" title={`${channelLabel(language, r.channel)} · ${providerLabel(language, r.provider)} · ${serverLabel(language, r.serverGuid ?? "", r.serverName)}`}>{channelLabel(language, r.channel)} · {providerLabel(language, r.provider)} · {serverLabel(language, r.serverGuid ?? "", r.serverName)} · {t("reports.sales.units_n", { n: formatQuantity(r.units, language) })}</span>
              </span>
              <span className="text-right font-bold"><Money cents={r.amountCents} language={language} />
                {r.discountCents ? <span className="block text-xs font-normal text-co-text-muted">{t("reports.sales.discounts")}: <Money cents={r.discountCents} language={language} /></span> : null}
              </span>
            </Link>
          </li>)}
        </ul>}
        {nextHref ? <Link className={salesLink} href={nextHref}>{t("reports.pagination.next")}</Link> : null}
      </section>;
    } catch (error) {
      if (error instanceof SalesReportError && error.status === 503) body = <SalesUnavailable code={error.code} language={language} />;
      else throw error;
    }
    return <div className="mb-6">
      <RangeCaption from={range.from} to={range.to} language={language} todaySoFar={range.todaySoFar} />
      <ExportLinks className="mb-3" family="sales" language={language} query={{ ...context, view: "checks", location: shopId }} />
      {body}
    </div>;
  };

  if (locationId === "all") return <TrendShopPanels header={header} render={panel} />;
  return <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6 md:max-w-3xl lg:max-w-5xl">
    {header}
    {await panel(locationId)}
  </main>;
}

/** Human labels for the active filters (translated; tenant vocabulary passes through). */
function filterChips(f: SalesCheckFilters, language: Parameters<typeof tFor>[0]): string[] {
  const t = tFor(language);
  const out: string[] = [];
  if (f.channel) out.push(`${t("reports.sales.col.channel")}: ${channelLabel(language, f.channel)}`);
  if (f.provider !== undefined) out.push(`${t("reports.sales.col.provider")}: ${providerLabel(language, f.provider)}`);
  if (f.server !== undefined) out.push(`${t("reports.sales.col.servers")}: ${serverLabel(language, f.server, null)}`);
  if (f.discount !== undefined) out.push(`${t("reports.sales.col.discounts")}: ${discountLabel(language, f.discount)}`);
  if (f.dow !== undefined) out.push(`${t("reports.sales.heatmap.weekday")}: ${formatWeekday(shiftReportDate("2026-10-05", f.dow - 1), language)}`);
  if (f.hour !== undefined) out.push(f.hour < 0 ? t("reports.sales.heatmap.unknown_hour") : t("reports.sales.heatmap.hour", { hour: f.hour }));
  return out;
}
