/**
 * Hand-rolled SVG line chart (no chart-library dependency). Pure
 * presentational Server Component. Draws one or two series over a shared
 * x-domain; `null` points are GAPS (the line breaks, never interpolates a
 * fake zero). Optional zero baseline for signed series (cash over/short).
 */

export interface LineSeries {
  points: (number | null)[];
  /** CSS color string, e.g. "var(--co-danger)". */
  color: string;
  dashed?: boolean;
}

export function LineChart({
  series,
  zeroBaseline = false,
  height = 96,
  ariaLabel,
}: {
  series: LineSeries[];
  zeroBaseline?: boolean;
  height?: number;
  ariaLabel: string;
}) {
  const width = 320;
  const padY = 8;
  const n = Math.max(1, ...series.map((s) => s.points.length));

  const allVals = series.flatMap((s) => s.points.filter((p): p is number => p !== null));
  if (zeroBaseline) allVals.push(0);
  let min = allVals.length ? Math.min(...allVals) : 0;
  let max = allVals.length ? Math.max(...allVals) : 1;
  if (min === max) {
    // flat series — pad so it renders mid-height
    min -= 1;
    max += 1;
  }

  const x = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * width);
  const y = (v: number) => padY + (1 - (v - min) / (max - min)) * (height - 2 * padY);

  // Build a polyline path that breaks on null (gap).
  const pathFor = (points: (number | null)[]): string => {
    let d = "";
    let penDown = false;
    points.forEach((p, i) => {
      if (p === null) {
        penDown = false;
        return;
      }
      d += `${penDown ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)} `;
      penDown = true;
    });
    return d.trim();
  };

  // Gradient area fill under the primary series — unsigned data only (a signed
  // zero-baseline series must not fill to the bottom). Segmented so gaps stay gaps.
  const bottom = height - padY;
  const areaId = "coarea-" + ariaLabel.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);
  const areaSegments = (points: (number | null)[]): string[] => {
    const segs: [number, number][][] = [];
    let cur: [number, number][] = [];
    points.forEach((p, i) => {
      if (p === null) {
        if (cur.length) { segs.push(cur); cur = []; }
        return;
      }
      cur.push([x(i), y(p)]);
    });
    if (cur.length) segs.push(cur);
    return segs
      .filter((seg) => seg.length >= 2)
      .map((seg) => {
        const top = seg.map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
        const x0 = seg[0]![0].toFixed(1);
        const x1 = seg[seg.length - 1]![0].toFixed(1);
        return `${top} L${x1},${bottom.toFixed(1)} L${x0},${bottom.toFixed(1)} Z`;
      });
  };
  const primary = series[0];
  const areaPaths = !zeroBaseline && primary && !primary.dashed ? areaSegments(primary.points) : [];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
    >
      {areaPaths.length && primary ? (
        <>
          <defs>
            <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: primary.color, stopOpacity: 0.2 }} />
              <stop offset="100%" style={{ stopColor: primary.color, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {areaPaths.map((d, i) => (
            <path key={`area-${i}`} d={d} fill={`url(#${areaId})`} stroke="none" />
          ))}
        </>
      ) : null}
      {zeroBaseline && min < 0 && max > 0 ? (
        <line x1={0} y1={y(0)} x2={width} y2={y(0)} stroke="var(--co-border)" strokeWidth={1} />
      ) : null}
      {series.map((s, si) => {
        const d = pathFor(s.points);
        if (!d) return null;
        return (
          <path
            key={si}
            d={d}
            fill="none"
            stroke={s.color}
            strokeWidth={si === 0 ? 2.5 : 2}
            strokeDasharray={s.dashed ? "4 3" : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={s.dashed ? 0.6 : 1}
          />
        );
      })}
    </svg>
  );
}
