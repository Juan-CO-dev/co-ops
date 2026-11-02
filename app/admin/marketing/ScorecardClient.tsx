"use client";

import { landingTenantConfig } from "@/config/tenant/landing";
import { useState } from "react";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { formatCents, formatDateLabel, formatQuantity } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { Language, TranslationKey, TranslationParams } from "@/lib/i18n/types";
import type { MarketingScorecard } from "@/lib/marketing/scorecard";
import { baselineWeeklyAverage, unavailable, type Metric } from "@/lib/marketing/scorecard-shared";

type ReadyData = Extract<MarketingScorecard, { state: "ok" }>;
type Score = ReadyData["series"][number]["score"];
type Row = { key: string; unit: "money" | "share" | "number"; get: (score: Score) => Metric; weekly?: boolean };
const rows: Row[] = [
  { key: "online_share", unit: "share", get: s => s.onlineDirectShare },
  { key: "order_share", unit: "share", get: s => s.onlineDirectOrderShare },
  { key: "total_share", unit: "share", get: s => s.totalDirectShare },
  { key: "orders_day", unit: "number", get: s => s.directOnlineOrdersPerDay },
  { key: "delivery", unit: "money", get: s => s.toastDeliveryServices.cents, weekly: true },
  { key: "ezcater", unit: "money", get: s => s.ezcater.cents, weekly: true },
  { key: "ez_ticket", unit: "money", get: s => s.ezcater.averageTicket },
  { key: "catering", unit: "money", get: s => s.directCatering.cents, weekly: true },
];

export default function ScorecardClient({ data }: { data: MarketingScorecard; lang: Language }) {
  const { t: translate, language: lang } = useTranslation();
  const [detail, setDetail] = useState<string | null>(null);
  const t = (key: string, params?: TranslationParams) => translate(`marketing.${key}` as TranslationKey, params);
  const date = (day: string) => formatDateLabel(day, lang);
  const number = (n: number) => formatQuantity(n, lang);
  const value = (metric: Metric, unit: Row["unit"] = "number") => {
    if (metric.value === null) return metric.reasons.map(reason => t(`state.${reason}`)).join(" · ");
    const formatted = unit === "money" ? formatCents(metric.value, lang) : unit === "share" ? `${number(metric.value * 100)}%` : number(metric.value);
    return metric.state === "partial" ? `${formatted} · ${metric.reasons.map(reason => t(`state.${reason}`)).join(" · ")}` : formatted;
  };
  if (data.state !== "ok") return <div className="min-w-0 space-y-4"><h1 className="text-xl font-bold">{t("title")}</h1><p role="status">{t(`state.${data.state === "load_failed" ? "load_failed" : data.reason}`)}</p></div>;
  const latest = data.series.filter(row => row.window.complete).at(-1);
  const current = [...data.series].reverse().find(row => !row.window.complete);
  const score = latest?.score;
  const baseline = data.baseline;
  const range = data.windows.baseline;
  const selectedRow = rows.find(row => row.key === detail);
  const entryWeek = current?.window ?? latest?.window;
  const missing = ["meta_spend", "promo_spend", "email_list_size"].filter(kind => !data.entries.some(entry => entry.kind === kind && entryWeek && (kind === "email_list_size"
    ? entry.period_start >= entryWeek.from && entry.period_start <= entryWeek.to
    : entry.period_start === entryWeek.from && entry.period_end === entryWeek.to))).length;
  const heads = data.milestones;
  const firstSpend = heads.find(row => row.kind === "first_ad_spend");
  const snapshot = data.snapshots.find(row => row.milestone_id === firstSpend?.id);
  const afterD = heads.some(row => row.kind === "first_ad_spend" && row.milestone_date <= data.windows.today);
  const delta = (a: Metric, b: Metric, unit: Row["unit"]) => a.value === null || b.value === null ? t("no_change") : unit === "share" ? t("change_points", { points: number((a.value - b.value) * 100) }) : value({ state: "ok", value: a.value - b.value }, unit);
  const allScores = [...data.series.map(row => row.score), ...(baseline ? [baseline] : [])];
  const alerts = [...new Map(allScores.flatMap(row => row.unknownLabels).map(row => [`${row.locationId}:${row.day}:${row.label}`, row])).values()];
  const largeChecks = allScores.flatMap(row => row.largeChecks);
  const gap = allScores.reduce((sum, row) => ({ captured: sum.captured + row.coverage.capturedDays, expected: sum.expected + row.coverage.expectedDays }), { captured: 0, expected: 0 });
  const details = (s: Score) => <div className="space-y-2 text-sm">
    <p>{t("coverage", { captured: s.coverage.capturedDays, expected: s.coverage.expectedDays })}</p>
    <p>{t("dine_in", { points: s.dineInPoints.value === null ? t("state.no_capture") : number(s.dineInPoints.value * 100) })}</p>
    <p>{t("orders", { count: value(s.ezcater.orders) })} · {t("checks", { count: value(s.directCatering.checks) })}</p>
    <p>{t("pipeline")}: {value(s.pipeline.events)} · {value(s.pipeline.cents, "money")}</p>
    <p>{t("ez_large", { count: s.ezcater.largeOrders })}</p>
    <p>{t("reconciliation")}: {Object.entries(s.ezcater.reconciliation).map(([status, count]) => `${translate(`reports.sales.catering.status.${status}` as TranslationKey)}: ${number(count)}`).join(" · ") || t("empty")}</p>
    <button type="button" onClick={() => setDetail("marketplace")} className="flex min-h-[48px] w-full items-center font-bold">{t("kpi.marketplace")}</button>
    {s.marketplace.length === 0 ? <p>{t("empty")}</p> : s.marketplace.map((provider, index) => <p key={index}>{provider.provider ?? t("provider_unknown")}: {value(provider.cents, "money")} · {value(provider.share, "share")}</p>)}
  </div>;
  return <div className="min-w-0 max-w-full space-y-4 break-words" data-testid="marketing-scorecard">
    <h1 className="text-xl font-bold">{t("title")}</h1>
    {range && <p>{t("identity", { from: date(range.from), to: date(range.to), week: current?.window.week ?? latest?.window.week ?? 0 })}{Boolean(snapshot) && <> · {t("locked")}</>}</p>}
    <div className="space-y-2 text-sm" role="status">
      {data.windows.noBaseline && <p>{t("alert.no_baseline")}</p>}
      {alerts.length > 0 && <div><p className="font-bold">{t("alert.unknown", { count: alerts.length })}</p>{alerts.map((row, i) => <p key={i}>{date(row.day)} · {data.locations.find(shop => shop.id === row.locationId)?.name} · {row.label === "(no dining option)" ? t("no_dining_option") : row.label} · {t("checks", { count: row.checks })} · {row.cents === null ? t("state.amount_missing") : `${formatCents(row.cents, lang)}${row.amountMissing ? ` ? ${t("state.amount_missing")}` : ""}`}</p>)}</div>}
      {largeChecks.length > 0 && <div><p className="font-bold">{t("alert.large", { count: largeChecks.length })}</p>{largeChecks.map((row, i) => <p key={i}>{date(row.day)} · {data.locations.find(shop => shop.id === row.locationId)?.name} · {translate(`reports.sales.channel.${row.channel}` as TranslationKey)} · {formatCents(row.amountCents, lang)}</p>)}</div>}
      {gap.captured < gap.expected && <p>{t("alert.coverage", gap)}</p>}
      {range && !snapshot && <p>{t("alert.no_snapshot")}</p>}
      {data.baselineDrift && <p>{t("alert.drift")}</p>}
      {afterD && !data.readiness.ready && <p>{t("alert.capi")}</p>}
      {!data.readiness.checks.noTestCodeInProduction && <p>{t("alert.test")}</p>}
    </div>
    <nav aria-label={t("lens.label")} className="flex flex-wrap gap-2">
      {[{ id: null, name: t("lens.all") }, ...data.locations].map(shop => <a key={shop.id ?? "all"} href={shop.id ? `/admin/marketing?location=${encodeURIComponent(shop.id)}` : "/admin/marketing"} aria-current={data.selectedLocationId === shop.id ? "page" : undefined} className="inline-flex min-h-[44px] items-center rounded border border-co-border px-3 font-bold">{shop.name}</a>)}
    </nav>
    <p className="text-sm">{t("yoy", { date: date(data.windows.yoy.captureBegan) })}</p>
    <p className="text-sm font-bold">{t("last_week")}{latest && <> · {date(latest.window.from)}–{date(latest.window.to)}</>}</p>
    <div className="space-y-2">{rows.map(row => {
      const metric = score ? row.get(score) : unavailable("no_capture");
      const base = baseline ? row.weekly ? baselineWeeklyAverage(row.get(baseline)) : row.get(baseline) : unavailable("no_baseline");
      return <button key={row.key} type="button" aria-expanded={detail === row.key} onClick={() => setDetail(row.key)} className="flex min-h-[48px] w-full flex-wrap items-center justify-between gap-2 rounded border border-co-border p-3 text-left">
        <span className="font-bold">{t(`kpi.${row.key}`)}</span><span className="min-w-0 text-right tabular-nums">{value(metric, row.unit)}<span className="block text-xs">{t("baseline_weekly")}: {value(base, row.unit)}</span><span className="block text-xs">{t("change")}: {latest?.window.compare ? delta(metric, base, row.unit) : t("no_change")}</span></span>
      </button>;
    })}</div>
    {score && details(score)}
    {latest && <div className="space-y-2">{[["meta", latest.metaSpend], ["cost_tap", latest.costPerTap], ["cost_extra", latest.costPerExtraOrder]].map(([key, metric]) => <button type="button" key={String(key)} onClick={() => setDetail(String(key))} className="flex min-h-[48px] w-full items-center justify-between gap-2 text-left">{t(`kpi.${key}`)}: <span className="text-right tabular-nums">{value(metric as Metric, "money")}</span></button>)}</div>}
    {current && <section className="co-card p-3"><h2 className="font-bold">{t("so_far", { days: current.window.daysSoFar })}</h2><p>{date(current.window.from)}–{date(current.window.to)}</p>{rows.map(row => <p key={row.key}>{t(`kpi.${row.key}`)}: {value(row.get(current.score), row.unit)}</p>)}</section>}
    <CollapsibleSection idBase="marketing-history" title={t("section.history")} count={t("count", { count: data.series.length })}>
      {data.windows.olderWeeksHidden && <p>{t("history.older_weeks")}</p>}
      {data.series.map(row => <section key={row.window.from} className="border-b border-co-border py-3"><h3>{t("week", { week: row.window.week, from: date(row.window.from), to: date(row.window.to) })}</h3>{!row.window.complete && <p>{t("so_far", { days: row.window.daysSoFar })}</p>}{rows.map(metric => <p key={metric.key}>{t(`kpi.${metric.key}`)}: {value(metric.get(row.score), metric.unit)}</p>)}{details(row.score)}</section>)}
    </CollapsibleSection>
    <CollapsibleSection idBase="marketing-taps" title={t("section.taps")} count={value(data.taps.total)}><p>{t("taps.campaign")}</p><p>{t("tap_disclosure")}</p>{data.taps.total.value === 0 && <p>{t("zero_recorded")}</p>}{data.taps.groups.map(row => <p key={`${row.storeKey}:${row.adCode}`}>{data.locations.find(shop => shop.code === landingTenantConfig.stores.find(store => store.key === row.storeKey)?.locationCode)?.name ?? row.storeKey} · {row.adCode}{!row.active && <> · {t("retired")}</>} · {number(row.clickCount)}</p>)}<CollapsibleSection idBase="marketing-taps-weeks" title={t("taps.by_week")}>{data.series.map(row => <section key={row.window.from}><h3>{t("week", { week: row.window.week, from: date(row.window.from), to: date(row.window.to) })}</h3><p>{value(row.taps.total)}</p>{row.taps.groups.map(group => <p key={`${group.storeKey}:${group.adCode}`}>{group.adCode}: {number(group.clickCount)}</p>)}</section>)}</CollapsibleSection></CollapsibleSection>
    <CollapsibleSection idBase="marketing-entries" title={t("section.entries")} count={t("missing_count", { count: missing })}>{data.entries.length === 0 && <p>{t("empty")}</p>}{data.entries.map(entry => <p key={entry.id}>{t(`entry.${entry.kind}`)} · {date(entry.period_start)}–{date(entry.period_end)} · {entry.location_id === null ? t("lens.all") : data.locations.find(shop => shop.id === entry.location_id)?.name} {entry.platform ? t(`platform.${entry.platform}`) : ""} · {entry.amount_cents === null ? number(entry.list_count ?? 0) : formatCents(entry.amount_cents, lang)}</p>)}{data.consent ? <p>{t("consent", { count: data.consent.optedIn, date: data.consent.lastImportDate ? date(data.consent.lastImportDate.slice(0, 10)) : t("no_import") })}</p> : <p>{t("entry.email_list_size")}: {t(data.consentEnabled ? "state.no_capture" : "state.not_switched_on")}</p>}</CollapsibleSection>
    <CollapsibleSection idBase="marketing-milestones" title={t("section.milestones")} count={t("count", { count: heads.length })}>{heads.length === 0 && <p>{t("empty")}</p>}{heads.map(row => <p key={row.id}>{t(`milestone.${row.kind}`)} · {date(row.milestone_date)}</p>)}</CollapsibleSection>
    <CollapsibleSection idBase="marketing-readiness" title={t("section.readiness")} count={t("ready_count", { ready: data.readiness.readyCount, total: data.readiness.total })}>{Object.entries(data.readiness.checks).map(([key, ready]) => <p key={key}>{t(`readiness.${key}`)}: {t(ready ? "readiness.ready" : "readiness.pending")}</p>)}</CollapsibleSection>
    {detail && <div role="dialog" aria-modal="true" aria-label={t(`kpi.${detail}`)} className="fixed inset-0 z-50 overflow-y-auto bg-co-surface p-4" onKeyDown={event => { if (event.key === "Escape") setDetail(null); if (event.key === "Tab") { event.preventDefault(); event.currentTarget.querySelector("button")?.focus(); } }}><div className="mx-auto max-w-lg space-y-4"><button autoFocus type="button" onClick={() => setDetail(null)} className="inline-flex min-h-[44px] items-center rounded border px-4">{t("close")}</button><h2 className="text-lg font-bold">{t(`kpi.${detail}`)}</h2><p>{t(`kpi.${detail}.definition`)}</p><p>{t("sources")}</p>{selectedRow && data.baselineSeries?.map(row => <div key={row.window.from}><p>{date(row.window.from)}–{date(row.window.to)}: {value(selectedRow.get(row.score), selectedRow.unit)}</p><p>{t("coverage", { captured: row.score.coverage.capturedDays, expected: row.score.coverage.expectedDays })}</p></div>)}{data.series.map(row => <div key={row.window.from}><p>{t("week", { week: row.window.week, from: date(row.window.from), to: date(row.window.to) })}: {selectedRow ? value(selectedRow.get(row.score), selectedRow.unit) : detail === "marketplace" ? "" : value(detail === "meta" ? row.metaSpend : detail === "cost_tap" ? row.costPerTap : row.costPerExtraOrder, "money")}</p>{detail === "marketplace" && details(row.score)}<p>{t("coverage", { captured: row.score.coverage.capturedDays, expected: row.score.coverage.expectedDays })}</p></div>)}</div></div>}
  </div>;
}
