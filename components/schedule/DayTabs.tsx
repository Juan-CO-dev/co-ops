"use client";
/**
 * The week's day tabs (spec §7; mockup v17 `renderTabs`): weekday + date, the day type, and — for a viewer who may see
 * money — the day's hourly labor %. Days before today are COMPLETED: `aria-disabled` with "Done" (still selectable to
 * read, never editable). Arrow keys move between tabs (roving tabindex). 44 px targets; the row scrolls sideways
 * inside itself on a phone, never the page.
 */
import type { KeyboardEvent } from "react";
import { formatDateLabel } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { DayTab } from "@/lib/scheduling/board-shared";

export function DayTabs({ tabs, selected, onSelect }: { tabs: DayTab[]; selected: string; onSelect: (date: string) => void }) {
  const { t, language } = useTranslation();
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
        return (
          <button key={tab.date} type="button" role="tab" aria-selected={isSel} aria-disabled={tab.locked ? true : undefined} tabIndex={isSel ? 0 : -1}
            onClick={() => onSelect(tab.date)} data-date={tab.date}
            className={`inline-flex min-h-[44px] min-w-[5.5rem] shrink-0 flex-col items-center justify-center rounded-lg border-2 px-2 py-1 text-xs ${isSel ? "border-co-text bg-co-surface" : "border-co-border bg-co-surface-inset"} ${tab.locked ? "text-co-text-dim" : "text-co-text"}`}>
            <span className="font-bold">{formatDateLabel(tab.date, language)}</span>
            <span>{tab.dayType ? t(`schedule.board.day_type.${tab.dayType}` as TranslationKey) : t("schedule.board.money.blank")}{tab.locked ? ` · ${t("schedule.board.day_tab.done")}` : ""}</span>
            {tab.hourlyPct !== undefined ? <span className="tabular-nums">{tab.hourlyPct === null ? t("schedule.board.money.blank") : t("schedule.board.tabs.hourly_pct", { pct: tab.hourlyPct })}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
