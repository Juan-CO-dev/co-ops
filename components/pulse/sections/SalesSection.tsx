"use client";

/**
 * Sales (GM+): today's pace vs a normal weekday (the basis stated), sales so far / checks / avg
 * check, top sellers, channel mix, discounts + refunds so far; the detail page adds discounts by
 * name, servers and the 4-week hour × weekday heatmap. Money never renders below GM: the server
 * refuses the section, so this component is only ever mounted with a GM payload.
 */
import Link from "next/link";
import { formatCents, formatQuantity, formatTime, formatWeekday } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { SalesData } from "@/lib/pulse/types";
import { Bars } from "@/components/pulse/charts/Bars";
import { Heatmap } from "@/components/pulse/charts/Heatmap";
import { PaceCurve } from "@/components/pulse/charts/PaceCurve";
import { subHeading, tapLink } from "@/components/pulse/shared";

export function SalesSection({ data, mode, locationId, date }: { data: SalesData; mode: "card" | "detail"; locationId: string; date: string }) {
  const { t, language } = useTranslation();
  const weekday = formatWeekday(date, language);
  const delta = data.pace.pctOfNormal;
  const channelLabel = (c: string) => t(`reports.sales.channel.${c}` as TranslationKey);
  return (
    <div className="flex flex-col gap-3">
      {data.coverage === "missing" && !data.net && <p className="text-sm text-co-text-muted">{t("pulse.sales.coverage_missing")}</p>}
      {data.coverage === "partial" && <p className="text-xs text-co-warning-text">{t("pulse.sales.coverage_partial")}</p>}
      {/* Freshness, honestly: the last COMPLETED Toast capture this card is built from (the 60 s poll picks up the next one). */}
      <p className="text-[11px] text-co-text-dim">{data.capturedAt ? t("pulse.sales.synced", { time: formatTime(data.capturedAt, language) }) : t("pulse.sales.synced_none")}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="min-w-0 rounded-lg border border-co-border bg-co-surface-inset p-3">
          <div className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("pulse.sales.net")}</div>
          <div className="text-lg font-bold tabular-nums text-co-text">{data.net ? formatCents(data.net.cents, language) : "—"}</div>
          {data.net && <div className="text-xs text-co-text-muted">{t("pulse.sales.checks", { count: data.net.checks })}{data.net.avgCheckCents != null ? ` · ${t("pulse.sales.avg", { amount: formatCents(data.net.avgCheckCents, language) })}` : ""}</div>}
        </div>
        <div className="min-w-0 rounded-lg border border-co-border bg-co-surface-inset p-3">
          <div className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("pulse.sales.pace", { weekday })}</div>
          <div className={`text-lg font-bold tabular-nums ${delta == null ? "text-co-text-muted" : delta >= 0 ? "text-co-confirm-text" : "text-co-cta-text"}`}>
            {delta == null ? "—" : `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}%`}
          </div>
          <div className="text-xs text-co-text-muted">{delta == null ? t(data.pace.baselineUnavailable ? "pulse.sales.baseline_unavailable" : "pulse.sales.pace_no_basis") : t(delta >= 0 ? "pulse.sales.pace_delta_up" : "pulse.sales.pace_delta_down", { pct: Math.abs(delta) })}</div>
        </div>
        <div className="col-span-2 min-w-0 rounded-lg border border-co-border bg-co-surface-inset p-3 sm:col-span-1">
          <div className="text-xs text-co-text-muted">{t("pulse.sales.discounts", { count: data.discounts.count, amount: formatCents(data.discounts.cents, language) })}</div>
          <div className="text-xs text-co-text-muted">{t("pulse.sales.refunds", { count: data.refunds.count, amount: formatCents(data.refunds.cents, language) })}</div>
        </div>
      </div>
      <div>
        <PaceCurve
          today={data.pace.todayCumulative} baseline={data.pace.baselineCumulative} currentHour={data.pace.currentHour}
          ariaLabel={t("pulse.sales.pace", { weekday })} labelToday={t("pulse.sales.legend_today")} labelNormal={t("pulse.sales.legend_normal")} noData={t("pulse.chart.no_data")}
        />
        <p className="mt-1 text-[11px] text-co-text-dim">{data.pace.baselineWeeks > 0 ? t("pulse.sales.basis", { weeks: data.pace.baselineWeeks, weekday }) : t(data.pace.baselineUnavailable ? "pulse.sales.baseline_unavailable" : "pulse.sales.pace_no_basis")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <h3 className={subHeading}>{t("pulse.sales.top_items")}</h3>
          <Bars ariaLabel={t("pulse.sales.top_items")} noData={t("pulse.chart.no_data")}
            rows={data.topItems.slice(0, mode === "card" ? 3 : 5).map((i) => ({ key: i.name, label: i.name, value: i.units, display: t("pulse.sales.units", { count: formatQuantity(i.units, language) }) }))} />
        </div>
        <div>
          <h3 className={subHeading}>{t("pulse.sales.channels")}</h3>
          <Bars ariaLabel={t("pulse.sales.channels")} noData={t("pulse.chart.no_data")}
            rows={data.channels.slice(0, mode === "card" ? 4 : 8).map((c) => ({ key: c.channel, label: channelLabel(c.channel), value: c.cents, display: formatCents(c.cents, language) }))} />
        </div>
      </div>
      {mode === "detail" && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <h3 className={subHeading}>{t("pulse.sales.discounts_by_name")}</h3>
              <Bars ariaLabel={t("pulse.sales.discounts_by_name")} noData={t("pulse.chart.no_data")}
                rows={data.discountsByName.map((d) => ({ key: d.name, label: d.name, value: d.cents, display: `${d.count} · ${formatCents(d.cents, language)}` }))} />
            </div>
            <div>
              <h3 className={subHeading}>{t("pulse.sales.servers")}</h3>
              <Bars ariaLabel={t("pulse.sales.servers")} noData={t("pulse.chart.no_data")}
                rows={data.servers.map((s) => ({ key: s.name, label: s.name, value: s.cents, display: `${s.checks} · ${formatCents(s.cents, language)}` }))} />
            </div>
          </div>
          <div>
            <h3 className={subHeading}>{t("pulse.sales.heatmap")}</h3>
            {data.pace.baselineUnavailable ? <p className="text-sm text-co-text-muted">{t("pulse.sales.baseline_unavailable")}</p> : <Heatmap cells={data.heat} language={language} ariaLabel={t("pulse.sales.heatmap")} noData={t("pulse.chart.no_data")} />}
          </div>
          <Link href={`/reports/sales?location=${encodeURIComponent(locationId)}&range=today`} className={tapLink}>{t("pulse.sales.report_link")}</Link>
        </>
      )}
    </div>
  );
}
