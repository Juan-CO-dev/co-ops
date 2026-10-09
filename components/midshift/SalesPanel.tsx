/**
 * SalesPanel — the mid-shift pulse's two-lane Toast sales card (council
 * 2026-07-31; replaces the pre-Toast "connect Toast" placeholder).
 *
 *   TODAY SO FAR — same-day events landed by the closing-confirm / on-visit
 *     triggers, stamped "as of HH:MM" from the freshest pull (honest about
 *     freshness — the pull cadence is debounced, not live).
 *   YESTERDAY & PACE — final numbers + Δ% vs the same weekday last week,
 *     with a trailing same-weekday average as today's context line.
 *
 * Server component; strings via serverT (en+es in the same PR per the
 * translate-from-day-one law).
 */

import Link from "next/link";
import type { Language } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import { formatCents, formatTime, formatWeekday } from "@/lib/i18n/format";
import type { SalesPulse } from "@/lib/midshift-sales";
import { SALES_READ_MIN } from "@/lib/sales-reports-shared";

export function SalesReportLink({ viewerLevel, locationId, language }: { viewerLevel: number; locationId: string; language: Language }) {
  if (viewerLevel < SALES_READ_MIN) return null;
  return <Link href={`/reports/sales?location=${encodeURIComponent(locationId)}`}
    className="inline-flex min-h-[44px] items-center rounded-lg border border-co-border-2 px-3 text-sm font-semibold text-co-text underline underline-offset-2">
    {serverT(language, "midshift.sales.report_link")}
  </Link>;
}

function checksLabel(count: number, language: Language): string {
  return count === 1
    ? serverT(language, "midshift.sales.checks_one")
    : serverT(language, "midshift.sales.checks_other", { count });
}

export function SalesPanel({ pulse, language, viewerLevel, locationId }: { pulse: SalesPulse; language: Language; viewerLevel: number; locationId: string }) {
  const { today, yesterday, yesterdayDeltaPct, baselineAvgCents, baselineWeeks, topToday, lastPulledAt } = pulse;
  const empty = today == null && yesterday == null;

  return (
    <section>
      <h2 className="mb-2 flex flex-wrap items-baseline gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-gold-text">
        {serverT(language, pulse.source === "capture" ? "midshift.sales.net_heading" : "midshift.sales.heading")}
        {lastPulledAt && (
          <span className="normal-case font-semibold tracking-normal text-co-text-dim">
            {serverT(language, "midshift.sales.as_of", { time: formatTime(lastPulledAt, language) })}
          </span>
        )}
      </h2>
      <SalesReportLink viewerLevel={viewerLevel} locationId={locationId} language={language} />

      {empty ? (
        <p className="text-sm text-co-text-muted">{serverT(language, "midshift.sales.empty")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {/* ── Today lane ── */}
          {today ? (
            <p className="text-sm font-semibold text-co-text">
              {serverT(language, "midshift.sales.today_line", {
                amount: formatCents(today.netCents, language),
                checks: checksLabel(today.checks, language),
              })}
            </p>
          ) : (
            <p className="text-sm text-co-text-muted">{serverT(language, "midshift.sales.today_none")}</p>
          )}
          {baselineAvgCents != null && (
            <p className="text-xs text-co-text-muted">
              {serverT(language, "midshift.sales.baseline_line", {
                weekday: formatWeekday(pulse.todayYmd, language),
                weeks: baselineWeeks,
                amount: formatCents(baselineAvgCents, language),
              })}
            </p>
          )}
          {topToday.length > 0 && (
            <p className="text-xs text-co-text-muted">
              {serverT(language, "midshift.sales.top_today", {
                items: topToday.map((t) => `${t.name} ×${t.qty}`).join(" · "),
              })}
            </p>
          )}

          {/* ── Yesterday lane ── */}
          {yesterday && (
            <p className="mt-1 border-t border-co-border/50 pt-2 text-sm text-co-text">
              {serverT(language, "midshift.sales.yesterday_line", {
                amount: formatCents(yesterday.netCents, language),
                checks: checksLabel(yesterday.checks, language),
                avg: yesterday.avgTicketCents != null ? formatCents(yesterday.avgTicketCents, language) : "—",
              })}
              {yesterdayDeltaPct != null && (
                <span
                  className={`ml-2 text-xs font-bold ${yesterdayDeltaPct >= 0 ? "text-co-text-muted" : "text-co-cta-text"}`}
                >
                  {serverT(language, "midshift.sales.yesterday_delta", {
                    delta: `${yesterdayDeltaPct >= 0 ? "+" : "−"}${Math.abs(yesterdayDeltaPct)}%`,
                    weekday: formatWeekday(yesterday.businessDate, language),
                  })}
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
