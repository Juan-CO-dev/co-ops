/**
 * Sales summary for one shop (Reports hub piece 4). The cards ARE the export's `total` row and the
 * bucket table IS its `bucket` rows (lib/report-export-shared.ts salesSummaryRows): one DTO, two
 * renderings. Exclusions are named, coverage gaps are said out loud, and a percentage appears only
 * when both windows are fully covered (lib/sales-reports-shared.ts salesDeltaPct).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { formatDateLabel, formatMonthLabel } from "@/lib/i18n/format";
import type { Language } from "@/lib/i18n/types";
import type { SalesSummaryDto } from "@/lib/sales-reports-shared";
import { CoverageBadge, Money, salesCard, salesLink, tFor } from "@/components/reports-hub/SalesParts";

export function SalesSummary({ summary, language, checksHref }: {
  summary: SalesSummaryDto; language: Language;
  /** Drill: the checks list for a business-date window (null = no drill). */
  checksHref: (from: string, to: string) => string;
}) {
  const t = tFor(language);
  const { totals, previous, range } = summary;
  const partial = totals.amountMissing > 0;
  const card = (label: string, value: ReactNode, sub?: ReactNode) => <div className="rounded-lg border border-co-border bg-co-surface-inset p-3">
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
    </div>
    {totals.coverage === "missing" ? <p className="mb-3 text-sm text-co-text-muted">{t("reports.sales.no_sales_recorded")}</p> : null}
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {card(t("reports.sales.total"), <Money cents={totals.totalCents} language={language} />,
        previous ? <>{t("reports.sales.previous")}: <Money cents={previous.totalCents} language={language} />{summary.deltaPct !== null ? ` (${summary.deltaPct > 0 ? "+" : ""}${summary.deltaPct}%)` : ""}</> : undefined)}
      {card(t("reports.sales.toast_net"), <Link className={salesLink} href={checksHref(range.from, range.to)}><Money cents={totals.toastNetCents} language={language} /></Link>, t("reports.sales.toast_net_hint"))}
      {card(t("reports.sales.ezcater"), <Money cents={totals.ezcaterCents} language={language} />, t("reports.sales.ezcater_orders", { n: totals.ezcaterOrders }))}
      {card(t("reports.sales.checks"), totals.checks, previous ? `${t("reports.sales.previous")}: ${previous.checks}` : undefined)}
      {card(t("reports.sales.avg_check"), <Money cents={totals.avgCheckCents} language={language} />)}
      {card(t("reports.sales.discounts"), <Money cents={totals.discountCents} language={language} />, t("reports.sales.discount_count", { n: totals.discountCount }))}
      {card(t("reports.sales.tax"), <Money cents={totals.taxCents} language={language} />)}
      {card(t("reports.sales.tips"), <Money cents={totals.tipCents} language={language} />)}
      {card(t("reports.sales.refunds"), <Money cents={totals.refundCents} language={language} />, t("reports.sales.refunds_hint", { n: totals.refundCount }))}
    </div>
    <div className="mt-3">
      <CollapsibleSection idBase={`sales-excluded-${summary.locationId}`} title={t("reports.sales.excluded.title")}
        count={t("reports.sales.excluded.count", { n: totals.giftCardChecks + totals.ezcaterLinkedChecks + totals.voidChecks + totals.excessFoodChecks })}>
        <ul className="grid gap-1 py-2 text-sm">
          <li>{t("reports.sales.excluded.gift_cards", { n: totals.giftCardChecks })}: <Money cents={totals.giftCardCents} language={language} /></li>
          <li>{t("reports.sales.excluded.ezcater_linked", { n: totals.ezcaterLinkedChecks })}: <Money cents={totals.ezcaterLinkedCents} language={language} /></li>
          <li>{t("reports.sales.excluded.voids", { n: totals.voidChecks })}</li>
          <li>{t("reports.sales.excluded.excess_food", { n: totals.excessFoodChecks })}</li>
        </ul>
      </CollapsibleSection>
    </div>
    {summary.buckets.length > 1 ? <div className="mt-3">
      <CollapsibleSection idBase={`sales-buckets-${summary.locationId}`} title={t(`reports.sales.by_${range.grain}`)} count={t("reports.sales.rows", { n: summary.buckets.length })}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="text-left text-xs text-co-text-muted">
              <th className="py-2 pr-2">{t("reports.sales.period")}</th><th className="py-2 pr-2 text-right">{t("reports.sales.total")}</th>
              <th className="py-2 pr-2 text-right">{t("reports.sales.toast_net")}</th><th className="py-2 pr-2 text-right">{t("reports.sales.ezcater")}</th>
              <th className="py-2 pr-2 text-right">{t("reports.sales.checks")}</th><th className="py-2">{t("reports.sales.coverage.label")}</th>
            </tr></thead>
            <tbody>{summary.buckets.slice().reverse().map((b) => <tr key={b.key} className="border-t border-co-border">
              <td className="py-1 pr-2"><Link className={salesLink} href={checksHref(b.from, b.to)}>{bucketLabel(b.from, b.to)}</Link></td>
              <td className="py-1 pr-2 text-right"><Money cents={b.totalCents} language={language} /></td>
              <td className="py-1 pr-2 text-right"><Money cents={b.toastNetCents} language={language} /></td>
              <td className="py-1 pr-2 text-right"><Money cents={b.ezcaterCents} language={language} /></td>
              <td className="py-1 pr-2 text-right">{b.checks}</td>
              <td className="py-1"><CoverageBadge status={b.coverage} covered={b.coveredDays} expected={b.expectedDays} language={language} /></td>
            </tr>)}</tbody>
          </table>
        </div>
      </CollapsibleSection>
    </div> : null}
  </section>;
}
