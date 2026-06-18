import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import { formatCents } from "@/lib/i18n/format";
import type { Language } from "@/lib/i18n/types";
import type { TrendSeries } from "@/lib/reports-trends";

import { LineChart } from "@/components/trends/LineChart";
import { BarChart } from "@/components/trends/BarChart";

/**
 * Dashboard trends widget — layout B (2×2 small-multiples grid). Compact
 * read over the same loadTrendSeries output (day / last-30 / no compare).
 * Cash mini-card omitted when !series.cashVisible. Links to the full page.
 */
export function TrendsWidget({
  series,
  locationId,
  language,
}: {
  series: TrendSeries;
  locationId: string;
  language: Language;
}) {
  const cur = series.current;

  return (
    <section aria-label={serverT(language, "reports.trends.title")} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="inline-block self-start border-b-2 border-co-gold-deep pb-0.5 text-lg font-bold uppercase tracking-[0.14em] text-co-text">
          {serverT(language, "reports.trends.title")}
        </h3>
        <Link
          href={`/reports/trends?location=${locationId}`}
          className="text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted underline-offset-2 hover:text-co-text hover:underline"
        >
          {serverT(language, "reports.trends.nav_label")}
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Mini title={serverT(language, "reports.trends.par_title")} value={String(series.totals.par.current ?? 0)}>
          <LineChart
            height={40}
            ariaLabel={serverT(language, "reports.trends.par_title")}
            series={[{ points: cur.map((b) => (b.hasData ? b.underPar : null)), color: "var(--co-danger)" }]}
          />
        </Mini>
        <Mini title={serverT(language, "reports.trends.temps_title")} value={String(series.totals.temps.current ?? 0)}>
          <BarChart
            height={40}
            ariaLabel={serverT(language, "reports.trends.temps_title")}
            current={cur.map((b) => (b.hasData ? b.tempFlags : null))}
            colorCurrent="var(--co-info)"
          />
        </Mini>
        {series.cashVisible ? (
          <Mini
            title={serverT(language, "reports.trends.cash_title")}
            value={formatCents(series.totals.cash.current ?? 0, language)}
          >
            <LineChart
              height={40}
              zeroBaseline
              ariaLabel={serverT(language, "reports.trends.cash_title")}
              series={[{ points: cur.map((b) => b.cashOverShortCents), color: "var(--co-success)" }]}
            />
          </Mini>
        ) : null}
        <Mini
          title={serverT(language, "reports.trends.completion_title")}
          value={series.totals.completion.current !== null ? `${series.totals.completion.current}%` : "—"}
        >
          <LineChart
            height={40}
            ariaLabel={serverT(language, "reports.trends.completion_title")}
            series={[{ points: cur.map((b) => b.completionPct), color: "var(--co-success)" }]}
          />
        </Mini>
      </div>
    </section>
  );
}

function Mini({ title, value, children }: { title: string; value: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-co-border bg-co-surface p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-co-text-dim">{title}</p>
      <p className="text-lg font-extrabold leading-none text-co-text">{value}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
