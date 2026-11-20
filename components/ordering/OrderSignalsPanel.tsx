"use client";
/**
 * Signals for the days this order looks ahead to (item 4 PR 6, first half), on /ordering above the walk.
 * Disclosure doctrine: ONE collapsed section; its header carries the count and, when anything is coming, the
 * never-collapse badge. Inside: each day that has an event, with the day's forecast line when one is held, the
 * events by name and the direction a person entered.
 *
 * IT NAMES, IT DOES NOT ADJUST. No quantity is suggested and no line is prefilled: the gate that would allow a
 * tested number (lib/demand-signals/order-signals-shared.ts) answers "no approved signal" today, and this panel
 * renders that reason. It never changes a par. Rendered only when DEMAND_SIGNALS is on (the page decides).
 */
import Link from "next/link";
import { WeatherSummary } from "@/components/admin/demand-signals/WeatherSummary";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { DEMAND_EVENT_CATEGORIES, DEMAND_EVENT_IMPACTS } from "@/lib/demand-signals/input-shared";
import type { OrderSignalsData } from "@/lib/demand-signals/order-signals";
import type { OrderNudge } from "@/lib/demand-signals/order-signals-shared";
import { formatDateLabel, formatWeekday } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";

const WARN_CHIP = "rounded-full bg-co-warning-surface px-2 py-0.5 text-xs font-bold text-co-warning-text";
const NUDGE_REASONS = ["no_approved_signal", "wrong_target", "evidence_not_point_in_time", "not_authorized_for_scope", "source_unverified", "source_revoked", "no_term_for_date", "no_effect"];
const known = (list: ReadonlyArray<string>, v: string) => list.includes(v);

export function OrderSignalsPanel({ data, locationId }: { data: Exclude<OrderSignalsData, { state: "unavailable" }>; locationId: string }) {
  const { t, language } = useTranslation();
  if (data.state === "unreadable") {
    return <section className="co-card mt-4 p-4"><p role="status" className="text-sm font-bold text-co-warning-text">{t("ordering.signals.unreadable")}</p></section>;
  }
  const { view } = data;
  const byId = new Map(view.events.map((e) => [e.id, e]));
  const n = view.events.length;

  function nudgeLine(nudge: OrderNudge): string {
    if (nudge.kind === "named_only") return t(`ordering.signals.nudge.${known(NUDGE_REASONS, nudge.reason) ? nudge.reason : "no_approved_signal"}` as TranslationKey);
    const pct = Math.round(Math.abs(nudge.multiplier - 1) * 100);
    return t(nudge.multiplier > 1 ? "ordering.signals.nudge.number_up" : "ordering.signals.nudge.number_down", { pct });
  }
  // One sentence when every listed day has the same answer (today: always), else one per day.
  const lines = [...new Set(view.days.map((d) => nudgeLine(d.nudge)))];

  return <div className="mt-4">
    <CollapsibleSection idBase="order-signals" title={t("ordering.signals.title")} count={t("ordering.signals.count", { n, days: data.horizonDays })}
      badge={n > 0 ? <span className={WARN_CHIP}>{t("ordering.signals.badge", { n })}</span> : null}>
      <div className="space-y-3 text-sm text-co-text">
        {view.days.length === 0 && <p className="text-co-text-muted">{t("ordering.signals.none", { days: data.horizonDays })}</p>}
        {view.days.length > 0 && <ul className="space-y-3">{view.days.map((day) => {
          return <li key={day.date} className="rounded-lg border-2 border-co-border p-3">
            <p className="flex flex-wrap items-center gap-2"><span className="font-bold">{formatWeekday(day.date, language)}, {formatDateLabel(day.date, language)}</span>
              {/* The same one-line forecast as the signals page, with the same qualifications (review r1 P2). */}
              {day.weather && <WeatherSummary weather={day.weather} feeds={data.weatherFeeds} className="text-co-text-muted" />}</p>
            <ul className="mt-1 space-y-1">{day.eventIds.map((id) => byId.get(id)).filter((e) => e !== undefined).map((e) => <li key={e.id}>
              <span className="font-bold">{e.title}</span>{" "}
              <span className="text-co-text-muted">{t("signals.event.summary", {
                category: t(`signals.category.${known(DEMAND_EVENT_CATEGORIES, e.category) ? e.category : "other"}` as TranslationKey),
                impact: t(`signals.impact.${known(DEMAND_EVENT_IMPACTS, e.expectedImpact) ? e.expectedImpact : "unknown"}` as TranslationKey) })}</span>
            </li>)}</ul>
            {lines.length > 1 && <p className="mt-1 text-co-text-muted">{nudgeLine(day.nudge)}</p>}
          </li>;
        })}</ul>}
        {lines.length === 1 && <p className="text-co-text-muted">{lines[0]}</p>}
        <p className="text-co-text-muted">{t("ordering.signals.par_note")}</p>
        {data.canOpenPage && <Link href={`/admin/demand-signals?location=${encodeURIComponent(locationId)}`}
          className="inline-flex min-h-[44px] items-center font-bold text-co-text underline">{t("ordering.signals.open_page")}</Link>}
      </div>
    </CollapsibleSection>
  </div>;
}
