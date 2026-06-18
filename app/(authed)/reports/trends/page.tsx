/**
 * /reports/trends — operational-signal trend charts (layout A, stacked cards).
 *
 * Auth → location guard (lockLocationContext) → loadTrendSeries → controls +
 * one stacked TrendCard per visible family. Cash family rendered only when the
 * loader reports cashVisible (KH+). Chart type per family follows the spec
 * mapping: par = line (day) / grouped bars (week-month); temps = bars; cash =
 * line w/ zero baseline; completion = line.
 */

import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { formatCents } from "@/lib/i18n/format";
import { loadTrendSeries, type TrendGranularity, type TrendSeries } from "@/lib/reports-trends";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { LineChart } from "@/components/trends/LineChart";
import type { LineSeries } from "@/components/trends/LineChart";
import { BarChart } from "@/components/trends/BarChart";
import { TrendCard } from "@/components/trends/TrendCard";
import { TrendControls } from "@/components/trends/TrendControls";

interface PageProps {
  searchParams: Promise<{ location?: string; g?: string; cmp?: string }>;
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

export default async function TrendsPage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/reports/trends");
  const { location: locationParam, g, cmp } = await searchParams;

  if (!locationParam) redirect("/dashboard");
  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, locationParam)) redirect("/dashboard");

  const language = auth.user.language;
  const granularity = parseGranularity(g);
  const compare = cmp === "1";
  const today = operationalNow(new Date()).date;

  const sb = getServiceRoleClient();
  const series: TrendSeries = await loadTrendSeries(sb, {
    viewer: { userId: auth.user.id, level: auth.level },
    locationId: locationParam,
    granularity,
    compare,
    today,
  });

  const grouping = serverT(language, groupingWord(granularity));
  const legendCurrent = serverT(language, "reports.trends.legend_current");
  const legendPrevious = serverT(language, "reports.trends.legend_previous");

  const cur = series.current;
  const prev = series.previous;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <h1 className="text-lg font-bold text-co-text">{serverT(language, "reports.trends.title")}</h1>
      <p className="mb-4 text-xs text-co-text-muted">{serverT(language, "reports.trends.subtitle")}</p>

      <TrendControls
        locationId={locationParam}
        granularity={granularity}
        compare={compare}
        language={language}
      />

      <div className="mt-5 flex flex-col gap-4">
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
