/**
 * Hour × weekday heatmap (compact) — reuses the Sales report's grid + level math so the two surfaces
 * agree. Cells carry their value as an accessible label; tint is reinforcement.
 */
import { heatLevel, heatmapGrid, type BreakdownRow } from "@/lib/sales-reports-shared";
import { formatCentsWhole, formatWeekday } from "@/lib/i18n/format";
import { shiftReportDate } from "@/lib/report-range";
import type { Language } from "@/lib/i18n/types";

const TINT = ["bg-co-surface", "bg-co-gold/15", "bg-co-gold/35", "bg-co-gold/60", "bg-co-gold-deep/80"] as const;
/** Any Monday — the row labels only need weekday names. */
const MONDAY = "2026-01-05";

export function Heatmap({ cells, language, ariaLabel, noData }: {
  cells: ReadonlyArray<{ dow: number; hour: number; cents: number }>;
  language: Language;
  ariaLabel: string;
  noData: string;
}) {
  if (cells.length === 0) return <p className="text-sm text-co-text-muted">{noData}</p>;
  const rows: BreakdownRow[] = cells.map((c) => ({ key: `${c.dow}:${c.hour}`, label: null, units: 0, checks: 0, cents: c.cents, count: 0, amountMissing: 0, dow: c.dow, hour: c.hour }));
  const grid = heatmapGrid(rows);
  const hours = Array.from({ length: 15 }, (_, i) => 8 + i);
  return (
    <div className="min-w-0 max-w-full overflow-x-auto" role="group" tabIndex={0} aria-label={ariaLabel}>
      <table className="w-full min-w-[420px] border-collapse text-[10px]">
        <caption className="sr-only">{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col" className="p-0.5 text-left text-co-text-dim" />
            {hours.map((h) => <th key={h} scope="col" className="p-0.5 text-center font-bold text-co-text-dim">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.cents.map((row, d) => {
            const day = formatWeekday(shiftReportDate(MONDAY, d), language).slice(0, 3);
            return (
              <tr key={d}>
                <th scope="row" className="p-0.5 text-left font-bold text-co-text-muted">{day}</th>
                {hours.map((h) => {
                  const cents = row[h] ?? null;
                  const label = cents === null ? "—" : formatCentsWhole(cents, language);
                  return <td key={h} className={`h-5 border border-co-border/40 text-center ${TINT[heatLevel(cents, grid.maxCents)]}`} aria-label={`${day} ${h}:00 ${label}`} title={`${day} ${h}:00 · ${label}`} />;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
