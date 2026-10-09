/**
 * Sales breakdown tables (items, modifiers, channels, discounts BY NAME, servers). Rows arrive
 * merged and sorted from lib/sales-reports-shared.ts; each money row drills to the checks behind
 * it (same eligible-facts predicate). Items/modifiers show units only: the capture keeps no
 * per-selection money, so no fake per-item dollars are drawn.
 */
import Link from "next/link";
import { formatQuantity } from "@/lib/i18n/format";
import type { Language } from "@/lib/i18n/types";
import { channelView, type BreakdownRow } from "@/lib/sales-reports-shared";
import { Money, channelLabel, discountLabel, providerLabel, salesCard, salesLink, serverLabel, tFor } from "@/components/reports-hub/SalesParts";

export type BreakdownView = "items" | "modifiers" | "channels" | "discounts" | "servers";

export function SalesBreakdown({ view, rows, offset, language, drillHref, nextHref, total }: {
  view: BreakdownView; rows: readonly BreakdownRow[]; offset: number; language: Language;
  drillHref: (row: BreakdownRow) => string | null; nextHref: string | null; total: number;
}) {
  const t = tFor(language);
  if (view === "channels") return <ChannelTables rows={rows} language={language} drillHref={drillHref} />;
  const label = (r: BreakdownRow) => view === "discounts" ? discountLabel(language, r.label)
    : view === "servers" ? serverLabel(language, r.key, r.label) : (r.label ?? t("reports.sales.item.unnamed"));
  const units = view === "items" || view === "modifiers";
  if (!rows.length) return <p className={`${salesCard} text-sm text-co-text-muted`}>{t("reports.sales.no_rows")}</p>;
  return <section className={salesCard} aria-label={t(`reports.sales.view.${view}`)}>
    {units ? <p className="mb-2 text-xs text-co-text-muted">{t("reports.sales.units_only")}</p> : null}
    {view === "discounts" ? <p className="mb-2 text-xs text-co-text-muted">{t("reports.sales.discounts_by_name")}</p> : null}
    {view === "servers" ? <p className="mb-2 text-xs text-co-text-muted">{t("reports.sales.server_basis")}</p> : null}
    <div className="min-w-0 max-w-full overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead><tr className="text-left text-xs text-co-text-muted">
          <th className="py-2 pr-2">#</th>
          <th className="py-2 pr-2">{t(`reports.sales.col.${view}`)}</th>
          {units ? <th className="py-2 pr-2 text-right">{t("reports.sales.units")}</th> : null}
          {view === "discounts" ? <th className="py-2 pr-2 text-right">{t("reports.sales.applications")}</th> : null}
          <th className="py-2 pr-2 text-right">{t("reports.sales.checks")}</th>
          {!units ? <th className="py-2 text-right">{t(view === "discounts" ? "reports.sales.amount" : "reports.sales.sales")}</th> : null}
        </tr></thead>
        <tbody>{rows.map((r, i) => {
          const href = drillHref(r);
          return <tr key={r.key} className="border-t border-co-border">
            <td className="py-1 pr-2 text-co-text-muted">{offset + i + 1}</td>
            <td className="max-w-48 py-1 pr-2"><span className="block truncate" title={label(r)}>{href ? <Link className={salesLink} href={href}>{label(r)}</Link> : label(r)}</span></td>
            {units ? <td className="py-1 pr-2 text-right">{formatQuantity(r.units, language)}</td> : null}
            {view === "discounts" ? <td className="py-1 pr-2 text-right">{r.count}</td> : null}
            <td className="py-1 pr-2 text-right">{r.checks}</td>
            {!units ? <td className="py-1 text-right"><Money cents={r.cents} language={language} />{r.amountMissing ? ` · ${t("reports.sales.amount_missing", { n: r.amountMissing })}` : ""}</td> : null}
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="mt-2 text-xs text-co-text-muted">{t("reports.sales.showing", { from: offset + 1, to: offset + rows.length, total })}</p>
    {nextHref ? <Link className={salesLink} href={nextHref}>{t("reports.pagination.next")}</Link> : null}
  </section>;
}

function ChannelTables({ rows, language, drillHref }: { rows: readonly BreakdownRow[]; language: Language; drillHref: (row: BreakdownRow) => string | null }) {
  const t = tFor(language);
  const { included, excluded, includedCents } = channelView(rows);
  const table = (list: readonly BreakdownRow[], caption: string) => <div className="min-w-0 max-w-full overflow-x-auto">
    <table className="w-full min-w-[560px] text-sm">
      <caption className="py-2 text-left text-xs font-bold tracking-wide text-co-text-muted">{caption}</caption>
      <thead><tr className="text-left text-xs text-co-text-muted">
        <th className="py-2 pr-2">{t("reports.sales.col.channel")}</th><th className="py-2 pr-2">{t("reports.sales.col.provider")}</th>
        <th className="py-2 pr-2 text-right">{t("reports.sales.checks_or_orders")}</th><th className="py-2 text-right">{t("reports.sales.sales")}</th>
      </tr></thead>
      <tbody>{list.map((r) => {
        const href = drillHref(r);
        const source = r.saleClass === "ezcater_source" ? t("reports.sales.source.ezcater") : r.saleClass === "gift_card" ? t("reports.sales.excluded.gift_card_row")
          : r.saleClass === "ezcater_linked" ? t("reports.sales.excluded.ezcater_linked_row") : null;
        return <tr key={`${r.key}|${r.saleClass}`} className="border-t border-co-border">
          <td className="py-1 pr-2">{href ? <Link className={salesLink} href={href}>{channelLabel(language, r.channel)}</Link> : channelLabel(language, r.channel)}{source ? <span className="block text-xs text-co-text-muted">{source}</span> : null}</td>
          <td className="py-1 pr-2">{providerLabel(language, r.provider)}</td>
          <td className="py-1 pr-2 text-right">{r.checks}</td>
          <td className="py-1 text-right"><Money cents={r.cents} language={language} /></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
  return <section className={salesCard} aria-label={t("reports.sales.view.channels")}>
    <p className="mb-2 text-sm font-bold">{t("reports.sales.total")}: <Money cents={includedCents} language={language} /></p>
    {included.length ? table(included, t("reports.sales.channels.counted")) : <p className="text-sm text-co-text-muted">{t("reports.sales.no_rows")}</p>}
    {excluded.length ? <div className="mt-3">{table(excluded, t("reports.sales.channels.not_counted"))}</div> : null}
  </section>;
}
