/**
 * /reports/sales/checks/[checkGuid]?location=&date= — one check's evidence (Reports hub piece 4).
 *
 * Read by (shop, business date) FIRST, then the check (0232 sales_report_check_detail). Shows what
 * the capture holds and nothing else: no customer, no card, no comment exists to show. Payment
 * TYPE only. A check outside the `sale` class says why it is not counted (E-Gift Card, linked to
 * an ezCater order, voided, excess food).
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ReportPageNav } from "@/components/reports-hub/ReportPageNav";
import { Money, SalesUnavailable, channelLabel, discountLabel, providerLabel, salesCard, salesLink, serverLabel, tFor } from "@/components/reports-hub/SalesParts";
import { formatDateLabel, formatQuantity, formatTime } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import { reportNavigationHref } from "@/lib/report-navigation";
import { canReadScopedReport } from "@/lib/report-scope";
import { SALES_READ_MIN, SalesReportError, loadSalesCheckDetail, type SalesCheckDetail } from "@/lib/sales-reports";
import { requireSessionFromHeaders } from "@/lib/session";

type Params = Record<string, string | undefined>;
/** Toast payment types (system keys) rendered through i18n; anything else reads "Other". */
const PAYMENT_TYPES = ["CASH", "CREDIT", "GIFTCARD", "HOUSE_ACCOUNT", "REWARDCARD", "LEVELUP", "OTHER", "UNDETERMINED"];

export default async function SalesCheckPage({ params, searchParams }: { params: Promise<{ checkGuid: string }>; searchParams: Promise<Params> }): Promise<ReactNode> {
  const [{ checkGuid: rawGuid }, query] = await Promise.all([params, searchParams]);
  const checkGuid = decodeURIComponent(rawGuid);
  const auth = await requireSessionFromHeaders("/reports/sales/checks");
  if (auth.level < SALES_READ_MIN) redirect("/reports");
  const viewer = { userId: auth.user.id, level: auth.level, locations: auth.locations };
  const locationId = query.location;
  if (!locationId || locationId === "all" || !canReadScopedReport(viewer, locationId)) redirect("/reports");
  const language = auth.user.language;
  const t = tFor(language);
  const businessDate = query.date ?? "";

  let detail: SalesCheckDetail | null;
  try {
    detail = await loadSalesCheckDetail(viewer, { locationId, businessDate, checkGuid });
  } catch (error) {
    if (error instanceof SalesReportError && error.status === 503) {
      return <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6"><SalesUnavailable code={error.code} language={language} /></main>;
    }
    throw error;
  }
  if (!detail) notFound();

  // Back goes to the list page the viewer came from (range, filters, cursor and shop preserved).
  const navParams: Params = { ...query, date: undefined };
  const dayContext: Params = { location: locationId, hubLocation: query.hubLocation, range: "custom", from: detail.businessDate, to: detail.businessDate, g: "day" };
  const paymentType = (type: string | null) => type && PAYMENT_TYPES.includes(type) ? t(`reports.sales.payment.${type}` as TranslationKey) : t("reports.sales.payment.OTHER");
  const row = (label: string, value: ReactNode) => <div className="flex min-h-[32px] items-baseline justify-between gap-3 border-t border-co-border py-1 text-sm"><span className="text-co-text-muted">{label}</span><span className="text-right font-semibold">{value}</span></div>;

  return <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
    <ReportPageNav viewerLevel={auth.level} path={`/reports/sales/checks/${encodeURIComponent(checkGuid)}`} params={navParams} language={language} />
    <h1 className="mb-1 text-lg font-bold text-co-text">{t("reports.sales.check.title")}</h1>
    <p className="mb-3 text-sm text-co-text-muted">{formatDateLabel(detail.businessDate, language)}{detail.openedAt ? ` · ${formatTime(detail.openedAt, language)}` : ""}</p>
    <nav aria-label={t("reports.related.same_day")} className="mb-4 flex flex-wrap gap-x-4">
      <Link className={salesLink} href={reportNavigationHref("/reports/sales/checks", dayContext)}>{t("reports.sales.check.same_day")}</Link>
      <Link className={salesLink} href={reportNavigationHref("/reports/sales", dayContext)}>{t("reports.sales.check.day_summary")}</Link>
    </nav>
    {detail.saleClass !== "sale" ? <p className="mb-3 rounded-lg border border-co-warning bg-co-warning-surface p-3 text-sm text-co-warning-text" role="status">
      {t(`reports.sales.check.class.${detail.saleClass}` as TranslationKey, { order: detail.ezcaterOrderNumber ?? "" })}
    </p> : null}

    <section className={`${salesCard} mb-3`}>
      {row(t("reports.sales.col.channel"), channelLabel(language, detail.channel))}
      {row(t("reports.sales.col.provider"), providerLabel(language, detail.provider))}
      {row(t("reports.sales.check.dining_option"), detail.diningOption ?? "—")}
      {row(t("reports.sales.col.servers"), serverLabel(language, detail.serverGuid ?? "", detail.serverName))}
      {row(t("reports.sales.check.opened"), detail.openedAt ? formatTime(detail.openedAt, language) : "—")}
      {row(t("reports.sales.check.closed"), detail.closedAt ? formatTime(detail.closedAt, language) : "—")}
      {row(t("reports.sales.toast_net"), <Money cents={detail.amountCents} language={language} />)}
      {row(t("reports.sales.tax"), <Money cents={detail.taxCents} language={language} />)}
      {row(t("reports.sales.check.total"), <Money cents={detail.totalCents} language={language} />)}
    </section>

    <section className={`${salesCard} mb-3`} aria-label={t("reports.sales.check.items")}>
      <h2 className="mb-2 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.sales.check.items")}</h2>
      {detail.selections.length ? <ul className="text-sm">{detail.selections.map((s) => <li key={s.selectionGuid} className={`flex justify-between gap-3 py-1 ${s.voided ? "text-co-text-dim line-through" : ""}`} style={{ paddingLeft: `${Math.min(s.depth, 4) * 16}px` }}>
        <span>{s.name}{s.voided ? ` · ${t("reports.sales.check.voided")}` : ""}</span><span>{formatQuantity(s.quantity, language)}</span>
      </li>)}</ul> : <p className="text-sm text-co-text-muted">{t("reports.sales.no_rows")}</p>}
    </section>

    <section className={`${salesCard} mb-3`} aria-label={t("reports.sales.view.discounts")}>
      <h2 className="mb-2 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.sales.view.discounts")}</h2>
      {detail.discounts.length ? detail.discounts.map((d) => <div key={d.ordinal}>{row(`${discountLabel(language, d.name)}${d.itemName ? ` · ${d.itemName}` : ""}`, <Money cents={d.amountCents} language={language} />)}</div>)
        : <p className="text-sm text-co-text-muted">{t("reports.sales.check.no_discounts")}</p>}
    </section>

    {detail.serviceCharges.length ? <section className={`${salesCard} mb-3`} aria-label={t("reports.sales.check.service_charges")}>
      <h2 className="mb-2 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.sales.check.service_charges")}</h2>
      {detail.serviceCharges.map((s) => <div key={s.ordinal}>{row(`${s.name ?? t("reports.sales.check.unnamed_charge")}${s.gratuity ? ` · ${t("reports.sales.check.gratuity")}` : ""}`, <Money cents={s.amountCents} language={language} />)}</div>)}
    </section> : null}

    <section className={salesCard} aria-label={t("reports.sales.check.payments")}>
      <h2 className="mb-2 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.sales.check.payments")}</h2>
      {detail.payments.length ? detail.payments.map((p, i) => <div key={i} className="border-t border-co-border py-1 text-sm">
        <div className="flex justify-between gap-3"><span>{paymentType(p.type)}</span><span className="font-semibold"><Money cents={p.amountCents} language={language} /></span></div>
        <div className="flex justify-between gap-3 text-xs text-co-text-muted"><span>{t("reports.sales.tips")}</span><span><Money cents={p.tipCents} language={language} /></span></div>
        {p.refundAmountCents !== null ? <div className="flex justify-between gap-3 text-xs text-co-cta-text"><span>{t("reports.sales.check.refunded", { date: p.refundBusinessDate ? formatDateLabel(p.refundBusinessDate, language) : "—" })}</span><span><Money cents={p.refundAmountCents} language={language} /></span></div> : null}
      </div>) : <p className="text-sm text-co-text-muted">{t("reports.sales.check.no_payments")}</p>}
    </section>
  </main>;
}
