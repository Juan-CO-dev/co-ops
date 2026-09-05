"use client";

/**
 * InsightsCalendar — the booked-catering month grid (catering truth arc, Juan 2026-09-05:
 * "a calendar of what's booked"). A Monday-start ET grid of the RPC's ±30/+90-day booked
 * window; every day carries a dot per event (FILL token roles only) and tapping a day opens
 * its list underneath. All grid/date math is pure and vitest-covered in insights-shared —
 * this file only renders.
 *
 * Disclosure doctrine: the day list is the drawer; the grid is the summary row.
 */

import { useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel, formatMonthLabel, formatWeekday } from "@/lib/i18n/format";
import {
  groupEventsByDate,
  monthGrid,
  monthKey,
  shiftMonth,
  stageDot,
  type CalendarEvent,
} from "@/lib/catering/insights-shared";
import { leadSourceLabelKey } from "@/lib/catering/intake-shared";
import { timeWindowLabel } from "@/lib/midshift-shared";

export function InsightsCalendar({ events, today }: { events: CalendarEvent[]; today: string }) {
  const { t, language } = useTranslation();
  const [month, setMonth] = useState(() => monthKey(today));
  const [selected, setSelected] = useState<string | null>(today);

  const grid = useMemo(() => monthGrid(month), [month]);
  const byDate = useMemo(() => groupEventsByDate(events), [events]);
  const dayEvents = selected ? byDate.get(selected) ?? [] : [];
  // The first week's seven dates ARE Mon…Sun, whatever month they belong to.
  const weekdays = grid.weeks[0]!.map((d) => formatWeekday(d.date, language).slice(0, 3));

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, -1))}
          aria-label={t("catering.insights.calendar.prev")}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border-2 border-co-border-2 bg-co-surface text-co-text"
        >
          <span aria-hidden>‹</span>
        </button>
        <span className="text-sm font-bold text-co-text">{formatMonthLabel(month, language)}</span>
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, 1))}
          aria-label={t("catering.insights.calendar.next")}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border-2 border-co-border-2 bg-co-surface text-co-text"
        >
          <span aria-hidden>›</span>
        </button>
      </div>

      <p className="mt-2 text-xs text-co-text-dim">{t("catering.insights.calendar.hint")}</p>

      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {weekdays.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {grid.weeks.flat().map((d) => {
          const evs = byDate.get(d.date) ?? [];
          const isSel = d.date === selected;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => setSelected(d.date)}
              aria-pressed={isSel}
              aria-label={`${formatDateLabel(d.date, language)}${
                evs.length > 0 ? ` · ${t("catering.insights.calendar_count", { n: evs.length })}` : ""
              }`}
              className={`flex min-h-[44px] flex-col items-center justify-start gap-0.5 rounded-lg border-2 p-1 text-xs tabular-nums ${
                isSel ? "border-co-text bg-co-surface-2" : "border-co-border bg-co-surface"
              } ${d.inMonth ? "text-co-text" : "text-co-text-dim"} ${d.date === today ? "font-extrabold" : ""}`}
            >
              <span>{Number(d.date.slice(8, 10))}</span>
              {evs.length > 0 && (
                <span className="flex items-center gap-0.5">
                  {evs.slice(0, 3).map((e) => (
                    <span key={e.id} className={`h-1.5 w-1.5 rounded-full ${stageDot(e.stage)}`} aria-hidden />
                  ))}
                  {evs.length > 3 && <span className="text-[9px] text-co-text-dim">+{evs.length - 3}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-col gap-2" aria-live="polite">
        {selected && dayEvents.length === 0 && (
          <li className="text-sm text-co-text-muted">{t("catering.insights.calendar.empty_day")}</li>
        )}
        {dayEvents.map((e) => {
          const src = leadSourceLabelKey(e.source);
          // The raw column holds three shapes (Toast "13:15" · ezCater ISO · portal range);
          // timeWindowLabel is the ONLY thing allowed to render it.
          const when = timeWindowLabel(e.timeWindow, language);
          return (
            <li
              key={e.id}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${stageDot(e.stage)}`} aria-hidden />
              <span className="text-sm font-extrabold text-co-text">{when ?? t("midshift.catering.no_time")}</span>
              <span className="text-sm font-semibold text-co-text">{e.name}</span>
              {e.headcount != null && (
                <span className="text-xs text-co-text-muted">
                  {e.headcount === 1
                    ? t("midshift.catering.covers_one")
                    : t("midshift.catering.covers_other", { count: e.headcount })}
                </span>
              )}
              <span className="text-xs text-co-text-dim">{"key" in src ? t(src.key) : src.verbatim}</span>
              <span className="ml-auto text-sm font-bold tabular-nums text-co-text">
                {formatCents(e.valueCents, language)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
