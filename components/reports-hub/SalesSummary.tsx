/**
 * Sales summary for one shop (Reports hub piece 4). The cards ARE the export's `total` row and the
 * bucket table IS its `bucket` rows (lib/report-export-shared.ts salesSummaryRows): one DTO, two
 * renderings. Exclusions are named, coverage gaps are said out loud, and a percentage appears only
 * when both windows are fully covered (lib/sales-reports-shared.ts salesDeltaPct).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { formatDateLabel, formatMonthLabel, formatTime } from "@/lib/i18n/format";
import type { Language } from "@/lib/i18n/types";
import { etCalendarDate } from "@/lib/operational-day";
import { salesHasData, shownCents, unknownComponents, type SalesSummaryDto, type SalesTotals } from "@/lib/sales-reports-shared";
import { CoverageBadge, Money, salesCard, salesLink, tFor } from "@/components/reports-hub/SalesParts";

export function SalesSummary({ summary, language, checksHref }: {
  summary: SalesSummaryDto; language: Language;
  /** Drill: the checks list for a business-date window (null = no drill). */
  checksHref: (from: string, to: string) => string;
}) {
  const t = tFor(language);
  const { totals, previous, range } = summary;
  const partial = totals.amountMissing > 0;
  // No capture and no row at all = unavailable ("—"), never $0.00 (Astra P2-9); same rule as the export.
  const m = (tt: SalesTotals, cents: number | null) => <Money cents={shownCents(tt, cents)} language={language} />;
  const count = (tt: SalesTotals, value: number) => (salesHasData(tt) ? value : "—");
  const unknown = unknownComponents(totals);
  const coverageMoment = (iso: string) => formatSalesCoverageMoment(iso, language);
  const refundHint = summary.modifiedCoverage
    ? <>{summary.modifiedCoverage.through
      ? t("reports.sales.refunds_coverage", { n: totals.refundCount, start: coverageMoment(summary.modifiedCoverage.start), through: coverageMoment(summary.modifiedCoverage.through) })
      : t("reports.sales.refunds_coverage_pending", { n: totals.refundCount, start: coverageMoment(summary.modifiedCoverage.start) })}
      {" "}{t("reports.sales.refunds_bootstrap_caveat")}</>
    : t("reports.sales.refunds_hint", { n: totals.refundCount });
  const card = (label: string, value: ReactNode, sub?: ReactNode) => <div className="min-w-0 break-words rounded-lg border border-co-border bg-co-surface-inset p-3">
    <div className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{label}</div>
    <div className="text-lg font-bold text-co-text">{value}</div>
    {sub ? <div className="text-xs text-co-text-muted">{sub}</div> : null}
  </div>;
  const bucketLabel = (from: string, to: string) => range.grain === "month" && from.endsWith("-01")
    ? formatMonthLabel(from.slice(0, 7), language)
    : from === to ? formatDateLabel(from, language) : t("reports.export.header.range", { from: formatDateLabel(from, language), to: formatDateLabel(to, language) });

  if (range.empty) return <p className={`${salesCard} text-sm text-co-text-muted`}>{t("reports.sales.no_finished_days")}</p>;
  return <section className={salesCard} aria-label={t("reports.sales.view.summary")}>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <CoverageBadge status={totals.coverage} covered={totals.coveredDays} expected={totals.expectedDays} language={language} />
      {partial ? <span className="text-xs font-bold text-co-warning-text">{t("reports.sales.amount_missing", { n: totals.amountMissing })}</span> : null}
      {unknown ? <span className="text-xs font-bold text-co-warning-text">{t("reports.sales.unknown_components", { tax: totals.taxMissing, tips: totals.tipMissing, discounts: totals.discountMissing })}</span> : null}
      {totals.accountingMissing > 0 ? <span className="text-xs font-bold text-co-warning-text">{t("reports.sales.accounting_missing", { n: totals.accountingMissing })}</span> : null}
      {totals.salesRefundMissing > 0 ? <span className="text-xs font-bold text-co-warning-text">{t("reports.sales.sales_refund_missing", { n: totals.salesRefundMissing })}</span> : null}
    </div>
    {totals.coverage === "missing" ? <p className="mb-3 text-sm text-co-text-muted">{t("reports.sales.no_sales_recorded")}</p> : null}
    <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
      {card(t("reports.sales.toast_net"), m(totals, totals.toastNetCents), t("reports.sales.toast_net_hint"))}
      {card(t("reports.sales.gross"), m(totals, totals.grossCents))}
      {card(t("reports.sales.discounts_comps"), m(totals, totals.discountsCompsCents))}
      {card(t("reports.sales.item_voids"), m(totals, totals.voidsCents))}
      {card(t("reports.sales.service_charges"), m(totals, totals.serviceChargesCents))}
      {card(t("reports.sales.sales_refunds"), m(totals, totals.salesRefundsCents))}
      {card(t("reports.sales.total"), m(totals, totals.totalCents),
        previous ? <>{t("reports.sales.previous")}: {m(previous, previous.totalCents)}{summary.deltaPct !== null ? ` (${summary.deltaPct > 0 ? "+" : ""}${summary.deltaPct}%)` : ""}</> : undefined)}
      {card(t("reports.sales.toast_checks"), <Link className={salesLink} href={checksHref(range.from, range.to)}>{m(totals, totals.toastChecksCents)}</Link>, t("reports.sales.toast_checks_hint"))}
      {card(t("reports.sales.ezcater"), m(totals, totals.ezcaterCents), t("reports.sales.ezcater_orders", { n: totals.ezcaterOrders }))}
      {card(t("reports.sales.checks"), count(totals, totals.checks), previous ? `${t("reports.sales.previous")}: ${count(previous, previous.checks)}` : undefined)}
      {card(t("reports.sales.avg_check"), m(totals, totals.avgCheckCents))}
      {card(t("reports.sales.discounts"), m(totals, totals.discountCents), t("reports.sales.discount_count", { n: totals.discountCount }))}
      {card(t("reports.sales.tax"), m(totals, totals.taxCents))}
      {card(t("reports.sales.tips"), m(totals, totals.tipCents))}
      {card(t("reports.sales.refunds"), m(totals, totals.refundCents), refundHint)}
    </div>
    <p className="mt-3 text-xs text-co-text-muted" role="note">{t("reports.sales.net_basis")}</p>
    {/* Legacy check totals and ezCater subtotals remain separately labelled. */}
    <p className="mt-3 text-xs text-co-text-muted" role="note">{t("reports.sales.caveat")}</p>
    <div className="mt-3">
      <CollapsibleSection idBase={`sales-excluded-${summary.locationId}`} title={t("reports.sales.excluded.title")}
        count={t("reports.sales.excluded.count", { n: totals.giftCardChecks + totals.ezcaterLinkedChecks + totals.voidChecks + totals.excessFoodChecks })}>
        <ul className="grid gap-1 py-2 text-sm">
          <li>{t("reports.sales.excluded.gift_cards", { n: totals.giftCardChecks })}: {m(totals, totals.giftCardCents)}</li>
          <li>{t("reports.sales.excluded.ezcater_linked", { n: totals.ezcaterLinkedChecks })}: {m(totals, totals.ezcaterLinkedCents)}</li>
          <li>{t("reports.sales.excluded.voids", { n: totals.voidChecks })}</li>
          <li>{t("reports.sales.excluded.excess_food", { n: totals.excessFoodChecks })}</li>
        </ul>
      </CollapsibleSection>
    </div>
    {summary.buckets.length > 1 ? <div className="mt-3">
      <CollapsibleSection idBase={`sales-buckets-${summary.locationId}`} title={t(`reports.sales.by_${range.grain}`)} count={t("reports.sales.rows", { n: summary.buckets.length })}>
        <div className="min-w-0 max-w-full overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead><tr className="text-left text-xs text-co-text-muted">
              <th className="py-2 pr-2">{t("reports.sales.period")}</th><th className="py-2 pr-2 text-right">{t("reports.sales.total")}</th>
              <th className="py-2 pr-2 text-right">{t("reports.sales.toast_net")}</th>
              <th className="py-2 pr-2 text-right">{t("reports.sales.gross")}</th>
              <th className="py-2 pr-2 text-right">{t("reports.sales.discounts_comps")}</th>
              <th className="py-2 pr-2 text-right">{t("reports.sales.item_voids")}</th>
              <th className="py-2 pr-2 text-right">{t("reports.sales.service_charges")}</th>
              <th className="py-2 pr-2 text-right">{t("reports.sales.sales_refunds")}</th>
              <th className="py-2 pr-2 text-right">{t("reports.sales.toast_checks")}</th><th className="py-2 pr-2 text-right">{t("reports.sales.ezcater")}</th>
              <th className="py-2 pr-2 text-right">{t("reports.sales.checks")}</th><th className="py-2">{t("reports.sales.coverage.label")}</th>
            </tr></thead>
            <tbody>{summary.buckets.slice().reverse().map((b) => <tr key={b.key} className="border-t border-co-border">
              <td className="py-1 pr-2"><Link className={salesLink} href={checksHref(b.from, b.to)}>{bucketLabel(b.from, b.to)}</Link></td>
              <td className="py-1 pr-2 text-right">{m(b, b.totalCents)}</td>
              <td className="py-1 pr-2 text-right">{m(b, b.toastNetCents)}</td>
              <td className="py-1 pr-2 text-right">{m(b, b.grossCents)}</td>
              <td className="py-1 pr-2 text-right">{m(b, b.discountsCompsCents)}</td>
              <td className="py-1 pr-2 text-right">{m(b, b.voidsCents)}</td>
              <td className="py-1 pr-2 text-right">{m(b, b.serviceChargesCents)}</td>
              <td className="py-1 pr-2 text-right">{m(b, b.salesRefundsCents)}</td>
              <td className="py-1 pr-2 text-right">{m(b, b.toastChecksCents)}</td>
              <td className="py-1 pr-2 text-right">{m(b, b.ezcaterCents)}</td>
              <td className="py-1 pr-2 text-right">{count(b, b.checks)}</td>
              <td className="py-1"><CoverageBadge status={b.coverage} covered={b.coveredDays} expected={b.expectedDays} language={language} /></td>
            </tr>)}</tbody>
          </table>
        </div>
      </CollapsibleSection>
    </div> : null}
  </section>;
}

/** One instant rendered wholly in the operational timezone, including near UTC midnight. */
export function formatSalesCoverageMoment(iso: string, language: Language): string {
  return `${formatDateLabel(etCalendarDate(iso), language)}, ${formatTime(iso, language)}`;
}
