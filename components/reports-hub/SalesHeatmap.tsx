/**
 * Hour x weekday heatmap (Reports hub piece 4). An ACCESSIBLE TABLE first: every cell prints its
 * value and carries a full label, and the intensity tint is an extra, never the only meaning.
 * Rows = weekday of the BUSINESS date; columns = the hour the check was OPENED, in America/New_York
 * (both fall-back 01:00 hours share a column; a check with no opened time is listed apart).
 * The grid scrolls inside its own box on a phone; the page never scrolls sideways.
 */
import Link from "next/link";
import { formatCents, formatCentsWhole, formatHourRange, formatHourShort, formatWeekday } from "@/lib/i18n/format";
import type { Language } from "@/lib/i18n/types";
import { shiftReportDate } from "@/lib/report-range";
import { heatLevel, heatmapGrid, type BreakdownRow } from "@/lib/sales-reports-shared";
import { heatmapHours } from "@/lib/sales-heatmap-shared";
import { Money, salesCard, tFor } from "@/components/reports-hub/SalesParts";

/** A fixed Monday: weekday names come from the i18n formatter, never a literal list. */
const MONDAY = "2026-10-05";
const TINT = ["", "bg-co-gold/20", "bg-co-gold/40", "bg-co-gold/60", "bg-co-gold"] as const;

export function SalesHeatmap({ rows, language, cellHref }: { rows: readonly BreakdownRow[]; language: Language; cellHref: (dow: number, hour: number) => string }) {
  const t = tFor(language);
  const grid = heatmapGrid(rows);
  const hours = heatmapHours(grid);
  const hourRange = (hour: number) => t("reports.sales.heatmap.hour_range", { range: formatHourRange(hour, language) });
  if (!rows.length) return <p className={`${salesCard} text-sm text-co-text-muted`}>{t("reports.sales.no_rows")}</p>;
  return <section className={salesCard} aria-label={t("reports.sales.view.heatmap")}>
    <p className="mb-2 text-xs text-co-text-muted">{t("reports.sales.heatmap.definition")}</p>
    {hours.length ? <div className="min-w-0 max-w-full overflow-x-auto" tabIndex={0} aria-label={t("reports.sales.heatmap.caption")}>
      <table className="w-full border-collapse text-[11px]">
        <caption className="sr-only">{t("reports.sales.heatmap.caption")}</caption>
        <thead><tr>
          <th scope="col" className="sticky left-0 z-10 bg-co-surface p-1 text-left">{t("reports.sales.heatmap.weekday")}</th>
          {hours.map((h) => <th key={h} scope="col" className="p-1 text-center font-bold text-co-text-muted" title={hourRange(h)} aria-label={hourRange(h)}>{formatHourShort(h, language)}</th>)}
        </tr></thead>
        <tbody>{grid.cents.map((row, d) => {
          const day = formatWeekday(shiftReportDate(MONDAY, d), language);
          return <tr key={d}>
            <th scope="row" className="sticky left-0 z-10 bg-co-surface p-1 text-left font-bold">{day}</th>
            {hours.map((h) => {
              const cents = row[h] ?? null;
              const checks = grid.checks[d]![h];
              if (cents === null) return <td key={h} className="h-11 min-w-11 border border-co-border text-center text-co-text-dim" aria-label={t("reports.sales.heatmap.empty_cell", { day, hour: hourRange(h) })}>·</td>;
              return <td key={h} className={`h-11 min-w-11 border border-co-border p-0 text-center ${TINT[heatLevel(cents, grid.maxCents)]}`}>
                <Link href={cellHref(d + 1, h)} className="flex h-11 min-w-11 items-center justify-center font-semibold text-co-text"
                  aria-label={t("reports.sales.heatmap.cell", { day, hour: hourRange(h), sales: formatCents(cents, language), checks: checks ?? 0 })}>
                  {formatCentsWhole(cents, language)}
                </Link>
              </td>;
            })}
          </tr>;
        })}</tbody>
      </table>
    </div> : null}
    {grid.unknown.checks > 0 ? <p className="mt-2 text-xs text-co-text-muted">
      <Link className="inline-flex min-h-[44px] items-center underline underline-offset-2" href={cellHref(0, -1)}>{t("reports.sales.heatmap.unknown", { n: grid.unknown.checks })}</Link>
      {" "}<Money cents={grid.unknown.cents} language={language} />
    </p> : null}
  </section>;
}
