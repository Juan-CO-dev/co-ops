/**
 * /reports/sales/catering — the catering slice of Sales (Reports hub piece 4).
 *
 * Three sources, three labelled blocks, never summed into each other blindly:
 *   1. ezCater orders (the source of truth for ezCater revenue, Juan 2026-10-08) by event date,
 *      with how each lines up with Toast (matched / not rung in Toast / amount mismatch) and the
 *      Toast "Ezcater" rings no ezCater order explains (still counted as Toast sales, named here);
 *   2. Toast catering-channel sales (house catering, DeliverThat courier, CO app catering);
 *   3. the 0195 pipeline split by event date: completed (earned) vs confirmed/out (to earn), which is
 *      quote/estimate value, not POS sales.
 * No customer name, contact or note is read: the order list is number, date, headcount, money.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ExportLinks } from "@/components/reports-export/ExportLinks";
import { ReportPageNav } from "@/components/reports-hub/ReportPageNav";
import { ReportRangeControls } from "@/components/reports-hub/ReportRangeControls";
import { ReportShopTabs } from "@/components/reports-hub/ReportShopTabs";
import { Money, RangeCaption, SalesUnavailable, providerLabel, salesCard, salesLink, tFor } from "@/components/reports-hub/SalesParts";
import { TrendShopPanels } from "@/components/trends/TrendShopPanels";
import { formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import { REPORT_ALL_LOCATIONS_LEVEL } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { reportNavigationHref } from "@/lib/report-navigation";
import { canReadScopedReport } from "@/lib/report-scope";
import { SALES_EMPTY_KEY, SALES_GRAINS, SALES_RANGES, SALES_READ_MIN, SalesReportError, loadSalesCatering, resolveSalesRange, salesRangeParams } from "@/lib/sales-reports";
import { requireSessionFromHeaders } from "@/lib/session";

type Params = Record<string, string | undefined>;
const STATUSES = ["matched", "not_rung_in_toast", "amount_mismatch"] as const;

export default async function SalesCateringPage({ searchParams }: { searchParams: Promise<Params> }): Promise<ReactNode> {
  const params = await searchParams;
  const auth = await requireSessionFromHeaders("/reports/sales/catering");
  if (auth.level < SALES_READ_MIN) redirect("/reports");
  const viewer = { userId: auth.user.id, level: auth.level, locations: auth.locations };
  const locationId = params.location ?? auth.locations[0];
  if (!locationId) redirect("/dashboard");
  if (locationId === "all" ? auth.level < REPORT_ALL_LOCATIONS_LEVEL : !canReadScopedReport(viewer, locationId)) redirect("/reports");

  const language = auth.user.language;
  const t = tFor(language);
  const range = resolveSalesRange(params, operationalNow(new Date()).date);
  const context: Params = { ...salesRangeParams(range), hubLocation: params.hubLocation, location: locationId };

  const header = <>
    <ReportPageNav viewerLevel={auth.level} path="/reports/sales/catering" params={context} language={language} />
    <ReportShopTabs path="/reports/sales/catering" params={context} locationId={locationId} language={language} viewer={auth} />
    <h1 className="mb-3 text-lg font-bold text-co-text">{t("reports.sales.catering.title")}</h1>
    <ReportRangeControls range={range} locationId={locationId} language={language} action="/reports/sales/catering"
      preserve={{ hubLocation: params.hubLocation }} ranges={SALES_RANGES} grains={SALES_GRAINS} grain={range.grain}
      capKey="reports.sales.cap" shortened={range.shortened} shortenedKey="reports.sales.range_shortened" />
  </>;

  const panel = async (shopId: string): Promise<ReactNode> => {
    const cursorKey = locationId === "all" ? `cursor_${shopId}` : "cursor";
    let body: ReactNode;
    try {
      const data = await loadSalesCatering(viewer, { locationId: shopId, range, cursor: params[cursorKey] });
      const cursors = Object.fromEntries(Object.entries(params).filter(([k]) => k.startsWith("cursor_")));
      const nextHref = data.orders.nextCursor ? reportNavigationHref("/reports/sales/catering", { ...context, ...cursors, [cursorKey]: data.orders.nextCursor }) : null;
      const toastTotal = data.toastCatering.reduce((s, r) => s + r.cents, 0);
      const checksHref = (provider: string | null) => reportNavigationHref("/reports/sales/checks", { ...context, channel: "catering", provider: provider ?? SALES_EMPTY_KEY }, shopId);
      body = <div className="grid min-w-0 gap-3">
        <section className={salesCard} aria-label={t("reports.sales.catering.ezcater")}>
          <h2 className="mb-2 font-bold">{t("reports.sales.catering.ezcater")}</h2>
          <p className="text-sm">{t("reports.sales.ezcater_orders", { n: data.ezcater.orders })} · <Money cents={data.ezcater.subtotalCents} language={language} />
            {data.ezcater.amountMissing ? ` · ${t("reports.sales.amount_missing", { n: data.ezcater.amountMissing })}` : ""}</p>
          <p className="mb-2 text-xs text-co-text-muted">{t("reports.sales.catering.ezcater_basis")}</p>
          <ul className="flex flex-wrap gap-2 text-sm">{STATUSES.map((s) => <li key={s} className="min-w-0 max-w-full break-words rounded-full border border-co-border-2 px-3 py-1">
            {t(`reports.sales.catering.status.${s}` as TranslationKey)}: {data.ezcater.statuses[s]}</li>)}</ul>
          {data.ezcater.orphanChecks ? <p className="mt-2 text-sm text-co-warning-text">{t("reports.sales.catering.orphans", { n: data.ezcater.orphanChecks })} · <Money cents={data.ezcater.orphanCents} language={language} /></p> : null}
        </section>

        <section className={salesCard} aria-label={t("reports.sales.catering.toast")}>
          <h2 className="mb-2 font-bold">{t("reports.sales.catering.toast")}</h2>
          <p className="mb-2 text-sm">{t("reports.sales.total")}: <Money cents={toastTotal} language={language} /></p>
          {data.toastCatering.length ? <ul className="text-sm">{data.toastCatering.map((r) => <li key={r.key} className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-co-border">
            <Link className={`${salesLink} min-w-0 max-w-full truncate`} title={providerLabel(language, r.provider)} href={checksHref(r.provider ?? null)}>{providerLabel(language, r.provider)}</Link>
            <span className="inline-flex items-center"><Money cents={r.cents} language={language} /> · {t("reports.sales.checks_n", { n: r.checks })}</span>
          </li>)}</ul> : <p className="text-sm text-co-text-muted">{t("reports.sales.no_rows")}</p>}
        </section>

        <section className={salesCard} aria-label={t("reports.sales.catering.pipeline")}>
          <h2 className="mb-2 font-bold">{t("reports.sales.catering.pipeline")}</h2>
          <ul className="text-sm">
            <li>{t("reports.sales.catering.completed", { n: data.pipeline.completedEvents })}: <Money cents={data.pipeline.completedCents} language={language} />
              {data.pipeline.completedUnvalued ? ` · ${t("reports.sales.catering.unvalued", { n: data.pipeline.completedUnvalued })}` : ""}</li>
            <li>{t("reports.sales.catering.confirmed", { n: data.pipeline.confirmedEvents })}: <Money cents={data.pipeline.confirmedCents} language={language} />
              {data.pipeline.confirmedUnvalued ? ` · ${t("reports.sales.catering.unvalued", { n: data.pipeline.confirmedUnvalued })}` : ""}</li>
          </ul>
          <p className="mt-1 text-xs text-co-text-muted">{t("reports.sales.catering.pipeline_basis")}</p>
        </section>

        <section className={salesCard} aria-label={t("reports.sales.catering.orders")}>
          <h2 className="mb-2 font-bold">{t("reports.sales.catering.orders")}</h2>
          {data.orders.rows.length ? <div className="min-w-0 max-w-full overflow-x-auto"><table className="w-full min-w-[620px] text-sm">
            <thead><tr className="text-left text-xs text-co-text-muted">
              <th className="py-2 pr-2">{t("reports.sales.catering.event_date")}</th><th className="py-2 pr-2">{t("reports.sales.catering.order_number")}</th>
              <th className="py-2 pr-2 text-right">{t("reports.sales.catering.headcount")}</th><th className="py-2 pr-2 text-right">{t("reports.sales.catering.subtotal")}</th>
              <th className="py-2">{t("reports.sales.catering.toast_status")}</th>
            </tr></thead>
            <tbody>{data.orders.rows.map((o) => <tr key={o.orderId} className="border-t border-co-border">
              <td className="py-1 pr-2">{formatDateLabel(o.eventDate, language)}</td><td className="py-1 pr-2">{o.orderNumber ?? "—"}</td>
              <td className="py-1 pr-2 text-right">{o.headcount ?? "—"}</td><td className="py-1 pr-2 text-right"><Money cents={o.subtotalCents} language={language} /></td>
              <td className="py-1">{(STATUSES as readonly string[]).includes(o.status) ? t(`reports.sales.catering.status.${o.status}` as TranslationKey) : o.status}</td>
            </tr>)}</tbody>
          </table></div> : <p className="text-sm text-co-text-muted">{t("reports.sales.no_rows")}</p>}
          {nextHref ? <Link className={salesLink} href={nextHref}>{t("reports.pagination.next")}</Link> : null}
        </section>
      </div>;
    } catch (error) {
      if (error instanceof SalesReportError && error.status === 503) body = <SalesUnavailable code={error.code} language={language} />;
      else throw error;
    }
    return <div className="mb-6">
      <RangeCaption from={range.from} to={range.to} language={language} todaySoFar={range.todaySoFar} />
      <ExportLinks className="mb-3" family="sales" language={language} query={{ ...context, view: "catering", location: shopId }} />
      {body}
    </div>;
  };

  if (locationId === "all") return <TrendShopPanels header={header} render={panel} />;
  return <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6 md:max-w-3xl lg:max-w-5xl">
    {header}
    {await panel(locationId)}
  </main>;
}
