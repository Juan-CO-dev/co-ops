import type { Language } from "@/lib/i18n/types";

export function TempTrendChart({
  values,
  safeMaxF,
  _language,
}: {
  values: number[];
  safeMaxF: number;
  _language?: Language;
}) {
  if (values.length === 0) return null;
  const W = 280,
    H = 64,
    pad = 6;
  const min = Math.min(...values, safeMaxF) - 2;
  const max = Math.max(...values, safeMaxF) + 2;
  const x = (i: number) =>
    pad + (i * (W - 2 * pad)) / Math.max(values.length - 1, 1);
  const y = (v: number) =>
    H - pad - ((v - min) / Math.max(max - min, 1)) * (H - 2 * pad);
  const pts = values
    .map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const safeY = y(safeMaxF).toFixed(1);
  const bottom = H - pad;
  // Values-derived id so multiple fridge charts on a page keep distinct gradient defs.
  const gradId = "cotemp-" + values.length + "-" + Math.round((values[0] ?? 0) * 10);
  const areaPath =
    `M ${x(0).toFixed(1)},${y(values[0]!).toFixed(1)} ` +
    values.slice(1).map((v, i) => `L ${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(" ") +
    ` L ${x(values.length - 1).toFixed(1)},${bottom.toFixed(1)} L ${x(0).toFixed(1)},${bottom.toFixed(1)} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label="Temperature trend"
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--co-text-muted)", stopOpacity: 0.14 }} />
          <stop offset="100%" style={{ stopColor: "var(--co-text-muted)", stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
      <line
        x1={pad}
        y1={safeY}
        x2={W - pad}
        y2={safeY}
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="4 3"
        className="text-co-cta/50"
      />
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-co-text-muted"
      />
      {values.map((v, i) => (
        <circle
          key={i}
          cx={x(i)}
          cy={y(v)}
          r="3"
          className={v > safeMaxF ? "text-co-cta" : "text-co-success"}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
