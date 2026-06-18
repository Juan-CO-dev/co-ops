/**
 * Hand-rolled SVG bar chart (no dependency). Pure presentational Server
 * Component. Single series, or grouped (current vs previous) when `previous`
 * is provided. `null` values are gaps (no bar drawn).
 */

export function BarChart({
  current,
  previous,
  colorCurrent,
  colorPrevious = "var(--co-border-2)",
  height = 96,
  ariaLabel,
}: {
  current: (number | null)[];
  previous?: (number | null)[];
  colorCurrent: string;
  colorPrevious?: string;
  height?: number;
  ariaLabel: string;
}) {
  const width = 320;
  const padY = 8;
  const n = Math.max(1, current.length);

  const vals = [
    ...current.filter((v): v is number => v !== null),
    ...(previous ?? []).filter((v): v is number => v !== null),
  ];
  const max = vals.length ? Math.max(...vals, 1) : 1;
  const slot = width / n;
  const grouped = !!previous;
  const barW = grouped ? slot * 0.32 : slot * 0.6;

  const barH = (v: number) => Math.max(0, (v / max) * (height - 2 * padY));
  const yTop = (v: number) => height - padY - barH(v);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
    >
      <line x1={0} y1={height - padY} x2={width} y2={height - padY} stroke="var(--co-border)" strokeWidth={1} />
      {current.map((v, i) => {
        const cx = i * slot + slot / 2;
        const prevV = previous?.[i] ?? null;
        return (
          <g key={i}>
            {grouped && prevV !== null ? (
              <rect x={cx - barW - 1} y={yTop(prevV)} width={barW} height={barH(prevV)} fill={colorPrevious} rx={1.5} />
            ) : null}
            {v !== null ? (
              <rect
                x={grouped ? cx + 1 : cx - barW / 2}
                y={yTop(v)}
                width={barW}
                height={barH(v)}
                fill={colorCurrent}
                rx={1.5}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
