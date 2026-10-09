/**
 * Pace curve — today's cumulative sales against the "normal day" cumulative, 2D SVG, no library.
 * Null points are gaps (hours not reached yet); the baseline is dashed. Hours 8–22 are the visible
 * window (the shop's day); the caption under the chart states the basis.
 */
export function PaceCurve({ today, baseline, currentHour, ariaLabel, labelToday, labelNormal, noData }: {
  today: ReadonlyArray<number | null>;
  baseline: ReadonlyArray<number | null> | null;
  currentHour: number;
  ariaLabel: string;
  labelToday: string;
  labelNormal: string;
  noData: string;
}) {
  const from = 8;
  const to = 22;
  const width = 320;
  const height = 120;
  const padX = 6;
  const padY = 10;
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const values = [...today, ...(baseline ?? [])].filter((v): v is number => v !== null);
  const max = values.length ? Math.max(...values, 1) : 1;
  const x = (h: number) => padX + ((h - from) / (to - from)) * (width - 2 * padX);
  const y = (v: number) => height - padY - (v / max) * (height - 2 * padY);
  const path = (series: ReadonlyArray<number | null>, upTo: number) => {
    let d = "";
    let pen = false;
    for (const h of hours) {
      const v = h <= upTo ? series[h] ?? null : null;
      if (v === null) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${x(h).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    }
    return d.trim();
  };
  const hasToday = today.some((v) => v !== null && v > 0);
  if (!hasToday && !baseline) {
    return <p className="flex h-[120px] items-center justify-center text-sm text-co-text-muted" role="img" aria-label={ariaLabel}>{noData}</p>;
  }
  const todayPath = path(today, currentHour);
  const basePath = baseline ? path(baseline, 23) : "";
  const cx = x(Math.min(Math.max(currentHour, from), to));
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={ariaLabel} preserveAspectRatio="none" className="overflow-visible">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="var(--co-card-border)" strokeWidth={1} />
        {[10, 14, 18, 22].map((h) => (
          <text key={h} x={x(h)} y={height - 1} fontSize={8} textAnchor="middle" fill="var(--co-text-dim)">{h}</text>
        ))}
        {basePath && <path d={basePath} fill="none" stroke="var(--co-border-2)" strokeWidth={2} strokeDasharray="4 3" strokeLinecap="round" />}
        {todayPath && <path d={todayPath} fill="none" stroke="var(--co-gold-deep)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="co-pace-draw" />}
        {hasToday && <line x1={cx} y1={padY} x2={cx} y2={height - padY} stroke="var(--co-text-dim)" strokeWidth={1} strokeDasharray="2 3" />}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-3 text-[11px] text-co-text-muted">
        <span><span aria-hidden className="mr-1 inline-block h-2 w-4 rounded-sm bg-co-gold-deep align-middle" />{labelToday}</span>
        {baseline && <span><span aria-hidden className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-co-border-2 align-middle" />{labelNormal}</span>}
      </figcaption>
    </figure>
  );
}
