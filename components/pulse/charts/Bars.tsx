/**
 * Horizontal bars for ranked numbers (top sellers, channel mix, discounts by name). Each row reads
 * as text first (label + value) with the bar as reinforcement; rows keep the 44 px floor when they
 * are links, 28 px when static. No library; widths animate with a CSS transition.
 */
export interface BarRow { key: string; label: string; value: number; display: string; href?: string }

export function Bars({ rows, ariaLabel, noData }: { rows: readonly BarRow[]; ariaLabel: string; noData: string }) {
  if (rows.length === 0) return <p className="text-sm text-co-text-muted">{noData}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="flex flex-col gap-1" aria-label={ariaLabel}>
      {rows.map((r) => {
        const pct = Math.max(2, Math.round((Math.max(0, r.value) / max) * 100));
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-semibold text-co-text">{r.label}</span>
              <span className="shrink-0 tabular-nums text-co-text-muted">{r.display}</span>
            </span>
            <span className="block h-2 w-full overflow-hidden rounded-full bg-co-surface-inset" aria-hidden>
              <span className="block h-full rounded-full bg-co-gold transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </span>
          </>
        );
        return (
          <li key={r.key} className="min-w-0">
            {r.href
              ? <a href={r.href} className="flex min-h-[44px] flex-col justify-center gap-1 rounded-md px-1 hover:bg-co-surface-2">{body}</a>
              : <div className="flex min-h-[28px] flex-col justify-center gap-1 px-1">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}
