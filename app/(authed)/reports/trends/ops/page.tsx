import Link from "next/link";
import type { ReactNode } from "react";
import { TrendShopPanels } from "@/components/trends/TrendShopPanels";
import { resolveTrendRange } from "@/lib/reports-trends";
import { reportRangeParams } from "@/lib/report-range";
/**
 * /reports/trends — operational-signal trend charts (layout A, stacked cards).
 *
 * Auth → location guard (canReadReportLocation) → loadTrendSeries → controls +
 * one stacked TrendCard per visible family. Cash family rendered only when the
 * loader reports cashVisible (KH+). Chart type per family follows the spec
 * mapping: par = line (day) / grouped bars (week-month); temps = bars; cash =
 * line w/ zero baseline; completion = line.
 */

import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { canReadReportLocation, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { formatCents, formatTrendMonthLabels } from "@/lib/i18n/format";
import { addDays, bucketStart, loadTrendSeries, type TrendGranularity, type TrendSeries } from "@/lib/reports-trends";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { BackLink } from "@/components/nav/BackLink";
import { LineChart } from "@/components/trends/LineChart";
import type { LineSeries } from "@/components/trends/LineChart";
import { BarChart } from "@/components/trends/BarChart";
import { TrendCard } from "@/components/trends/TrendCard";
import { TrendControls } from "@/components/trends/TrendControls";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function parseGranularity(g: string | undefined): TrendGranularity {
  return g === "week" || g === "month" ? g : "day";
}

function groupingWord(g: TrendGranularity): TranslationKey {
  return g === "week"
    ? "reports.trends.grouping_week"
    : g === "month"
      ? "reports.trends.grouping_month"
      : "reports.trends.grouping_day";
}

function deltaPill(
  delta: number | null,
  language: Language,
): { label: string; value: number } | null {
  if (delta === null || delta === 0) return null;
  const n = Math.abs(delta);
  const label =
    delta < 0
      ? serverT(language, "reports.trends.delta_down", { n })
      : serverT(language, "reports.trends.delta_up", { n });
  return { label, value: delta };
}

export default async function OpsTrendsPage({ searchParams }: PageProps): Promise<ReactNode> {
  const auth = await requireSessionFromHeaders("/reports/trends/ops");
  const paramsRange = await searchParams;
  const { location: locationParam, g } = paramsRange;

  if (auth.level < 4) redirect("/reports");
  if (!locationParam) redirect("/dashboard");
  if (locationParam === "all") {
    if (auth.level < 8) redirect("/reports");
    return <TrendShopPanels render={(id) => OpsTrendsPage({ searchParams: Promise.resolve({ ...paramsRange, location: id }) })} />;
  }
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!canReadReportLocation(locActor, locationParam)) redirect("/dashboard");

  const language = auth.user.language;
  const granularity = parseGranularity(g);
  const today = operationalNow(new Date()).date;
  const range = resolveTrendRange(paramsRange, today, granularity);
  const compare = range.compare;
  const context = reportRangeParams(range);
  context.set("g", granularity);

  const sb = getServiceRoleClient();
  const series: TrendSeries = await loadTrendSeries(sb, {
    viewer: { userId: auth.user.id, level: auth.level, locations: auth.locations },
    locationId: locationParam,
    granularity,
    compare,
    today,
    range,
  });

  const grouping = serverT(language, groupingWord(granularity));
  const legendCurrent = serverT(language, "reports.trends.legend_current");
  const legendPrevious = serverT(language, "reports.trends.legend_previous");

  const drill = (signal: string) => `/reports/operations?location=${locationParam}&${context}&sf_${signal}=true`;
  const cur = series.current;
  const prev = series.previous;
  const monthLabels = granularity === "month" ? formatTrendMonthLabels(cur.map(bucket => bucket.key), language) : [];
  const partialFirst = granularity === "month" && bucketStart(range.from, "month") !== range.from;
  const partialLast = granularity === "month" && bucketStart(addDays(range.to, 1), "month") === bucketStart(range.to, "month");
  const monthAxis = monthLabels.length ? <div className="mt-1 flex text-[10px] text-co-text-dim" aria-label={serverT(language, "reports.trends.gran_month")}>
    {monthLabels.map((label, index) => <span key={`${cur[index]?.key}-${index}`} className="min-w-0 flex-1 text-center">{label}
      {(index === 0 && partialFirst || index === monthLabels.length - 1 && partialLast) ? <span className="block">{serverT(language, "reports.trends.partial")}</span> : null}
    </span>)}
  </div> : null;

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <BackLink search={`?location=${locationParam}&${context}`} labelKey="reports.trends.back" />
      <h1 className="text-lg font-bold text-co-text">{serverT(language, "reports.trends.title")}</h1>
      <p className="mb-4 text-xs text-co-text-muted">{serverT(language, "reports.trends.subtitle")}</p>

      <TrendControls
        locationId={locationParam}
        range={range}
        granularity={granularity}
        compare={compare}
        language={language}
        basePath="/reports/trends/ops"
      />

      <nav className="mt-3 flex flex-wrap gap-2">
        <Link className="inline-flex min-h-[44px] items-center rounded-lg border border-co-border px-3 text-xs" href={drill("underPar")}>{serverT(language, "reports.trends.par_title")}</Link>
        <Link className="inline-flex min-h-[44px] items-center rounded-lg border border-co-border px-3 text-xs" href={drill("tempFlag")}>{serverT(language, "reports.trends.temps_title")}</Link>
        <Link className="inline-flex min-h-[44px] items-center rounded-lg border border-co-border px-3 text-xs" href={`/reports/operations?location=${locationParam}&${context}&type=cash`}>{serverT(language, "reports.trends.cash_title")}</Link>
      </nav>
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* PAR — line (day) / grouped bars (week, month) */}
        <TrendCard
          titleKey="reports.trends.par_title"
          headline={String(series.totals.par.current ?? 0)}
          delta={deltaPill(series.totals.par.delta, language)}
          deltaGoodWhenNegative
          explainKey="reports.trends.par_explain"
          explainParams={{ grouping }}
          howToReadKey="reports.trends.par_how_to_read"
          language={language}
        >
          {granularity === "day" ? (
            <LineChart
              ariaLabel={serverT(language, "reports.trends.par_title")}
              series={[
                { points: cur.map((b) => (b.hasData ? b.underPar : null)), color: "var(--co-danger)" },
                { points: cur.map((b) => (b.hasData ? b.overPar : null)), color: "var(--co-gold-deep)" },
                ...(prev
                  ? ([{ points: prev.map((b) => (b.hasData ? b.underPar : null)), color: "var(--co-danger)", dashed: true }] as LineSeries[])
                  : []),
              ]}
            />
          ) : (
            <BarChart
              ariaLabel={serverT(language, "reports.trends.par_title")}
              current={cur.map((b) => (b.hasData ? b.underPar : null))}
              previous={prev ? prev.map((b) => (b.hasData ? b.underPar : null)) : undefined}
              colorCurrent="var(--co-danger)"
            />
          )}
          {monthAxis}
          <ChartLegend hasPrev={!!prev} current={legendCurrent} previous={legendPrevious} />
        </TrendCard>

        {/* TEMPS — bars always */}
        <TrendCard
          titleKey="reports.trends.temps_title"
          headline={String(series.totals.temps.current ?? 0)}
          delta={deltaPill(series.totals.temps.delta, language)}
          deltaGoodWhenNegative
          explainKey="reports.trends.temps_explain"
          explainParams={{ grouping }}
          howToReadKey="reports.trends.temps_how_to_read"
          language={language}
        >
          <BarChart
            ariaLabel={serverT(language, "reports.trends.temps_title")}
            current={cur.map((b) => (b.hasData ? b.tempFlags : null))}
            previous={prev ? prev.map((b) => (b.hasData ? b.tempFlags : null)) : undefined}
            colorCurrent="var(--co-info)"
          />
          {monthAxis}
          <ChartLegend hasPrev={!!prev} current={legendCurrent} previous={legendPrevious} />
        </TrendCard>

        {/* CASH — line w/ zero baseline (KH+ only) */}
        {series.cashVisible ? (
          <TrendCard
            titleKey="reports.trends.cash_title"
            headline={formatCents(series.totals.cash.current ?? 0, language)}
            delta={
              series.totals.cash.delta !== null
                ? { label: formatCents(series.totals.cash.delta, language), value: series.totals.cash.delta }
                : null
            }
            deltaGoodWhenNegative={false}
            explainKey="reports.trends.cash_explain"
            explainParams={{ grouping }}
            howToReadKey="reports.trends.cash_how_to_read"
            language={language}
          >
            <LineChart
              ariaLabel={serverT(language, "reports.trends.cash_title")}
              zeroBaseline
              series={[
                { points: cur.map((b) => b.cashOverShortCents), color: "var(--co-success)" },
                ...(prev
                  ? ([{ points: prev.map((b) => b.cashOverShortCents), color: "var(--co-success)", dashed: true }] as LineSeries[])
                  : []),
              ]}
            />
            {monthAxis}
            <ChartLegend hasPrev={!!prev} current={legendCurrent} previous={legendPrevious} />
          </TrendCard>
        ) : null}

        {/* COMPLETION — line */}
        <TrendCard
          titleKey="reports.trends.completion_title"
          headline={series.totals.completion.current !== null ? `${series.totals.completion.current}%` : "—"}
          delta={deltaPill(series.totals.completion.delta, language)}
          deltaGoodWhenNegative={false}
          explainKey="reports.trends.completion_explain"
          explainParams={{ grouping }}
          howToReadKey="reports.trends.completion_how_to_read"
          language={language}
        >
          <LineChart
            ariaLabel={serverT(language, "reports.trends.completion_title")}
            series={[
              { points: cur.map((b) => b.completionPct), color: "var(--co-success)" },
              ...(prev
                ? ([{ points: prev.map((b) => b.completionPct), color: "var(--co-success)", dashed: true }] as LineSeries[])
                : []),
            ]}
          />
          {monthAxis}
          <ChartLegend hasPrev={!!prev} current={legendCurrent} previous={legendPrevious} />
        </TrendCard>
      </div>
    </main>
  );
}

function ChartLegend({
  hasPrev,
  current,
  previous,
}: {
  hasPrev: boolean;
  current: string;
  previous: string;
}) {
  return (
    <div className="mt-1.5 flex gap-3 text-[10px] text-co-text-dim">
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-0.5 w-3.5 bg-co-text-dim" aria-hidden /> {current}
      </span>
      {hasPrev ? (
        <span className="inline-flex items-center gap-1 opacity-60">
          <span className="inline-block h-0.5 w-3.5 bg-co-text-dim" aria-hidden /> {previous}
        </span>
      ) : null}
    </div>
  );
}
