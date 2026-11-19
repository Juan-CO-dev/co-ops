"use client";
/**
 * The week's day tabs (spec §7; mockup v17 `renderTabs`): weekday + date, the day type, and — for a viewer who may see
 * money — the day's hourly labor %. Days before today are COMPLETED: `aria-disabled` with "Done" (still selectable to
 * read, never editable). Arrow keys move between tabs (roving tabindex). 44 px targets; the row scrolls sideways
 * inside itself on a phone, never the page.
 *
 * Two labor views (PR 3, dark): with `labor` (a money viewer, SCHEDULE_LABOR_VIEWS on) the tab reads the labor facts'
 * own day figure instead: the day's kind, FULLY LOADED % as the headline and pure hourly beneath (Juan). An unknown %
 * is "—"; a day with hours only (not settled) or no schedule says so in words. Nothing is computed here.
 */
import type { KeyboardEvent } from "react";
import { formatDateLabel } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { DayTab } from "@/lib/scheduling/board-shared";
import type { BoardLaborViews } from "@/lib/scheduling/labor-projection-shared";

export function DayTabs({ tabs, selected, onSelect, labor }: { tabs: DayTab[]; selected: string; onSelect: (date: string) => void; labor?: BoardLaborViews }) {
  const { t, language } = useTranslation();
  const laborDays = labor?.state === "ready" ? labor.days : [];
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = tabs.findIndex((x) => x.date === selected);
    const next = tabs[(i + (e.key === "ArrowLeft" ? tabs.length - 1 : 1)) % tabs.length];
    if (next) onSelect(next.date);
  }
  return (
    <div role="tablist" aria-label={t("schedule.board.tabs.label")} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" onKeyDown={onKey}>
      {tabs.map((tab) => {
        const isSel = tab.date === selected;
        const ld = laborDays.find((d) => d.date === tab.date);
        return (
          <button key={tab.date} type="button" role="tab" aria-selected={isSel} aria-disabled={tab.locked ? true : undefined} tabIndex={isSel ? 0 : -1}
            onClick={() => onSelect(tab.date)} data-date={tab.date}
            className={`inline-flex min-h-[44px] min-w-[5.5rem] shrink-0 flex-col items-center justify-center rounded-lg border-2 px-2 py-1 text-xs ${isSel ? "border-co-text bg-co-surface" : "border-co-border bg-co-surface-inset"} ${tab.locked ? "text-co-text-dim" : "text-co-text"}`}>
            <span className="font-bold">{formatDateLabel(tab.date, language)}</span>
            <span>{tab.dayType ? t(`schedule.board.day_type.${tab.dayType}` as TranslationKey) : t("schedule.board.money.blank")}{tab.locked ? ` · ${t("schedule.board.day_tab.done")}` : ""}</span>
            {tab.hourlyPct !== undefined ? <span className="tabular-nums">{tab.hourlyPct === null ? t("schedule.board.money.blank") : t("schedule.board.tabs.hourly_pct", { pct: tab.hourlyPct })}</span> : null}
            {ld && (ld.kind === "actual" || ld.kind === "projected") ? (
              <span className="grid justify-items-center" data-tab-labor={ld.kind}>
                <span className="text-[10px] font-bold tracking-[0.08em] text-co-text-muted">{t(`schedule.labor_views.tab.${ld.kind}` as TranslationKey)}</span>
                <span className="font-bold tabular-nums">{ld.fullyLoadedPct === null ? t("schedule.labor_views.tab.loaded_unknown") : t("schedule.labor_views.tab.loaded", { pct: ld.fullyLoadedPct })}</span>
                <span className="tabular-nums">{ld.pureHourlyPct === null ? t("schedule.labor_views.tab.hourly_unknown") : t("schedule.labor_views.tab.hourly", { pct: ld.pureHourlyPct })}</span>
              </span>
            ) : ld ? <span className="text-[10px] font-bold text-co-text-muted" data-tab-labor={ld.kind}>{t(`schedule.labor_views.kind.${ld.kind}` as TranslationKey)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
