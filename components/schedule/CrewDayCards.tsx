"use client";
import type { DayView, PositionLabel, ShiftView } from "@/lib/scheduling/board-view-shared";
import { formatQ } from "@/lib/scheduling/time-shared";
import { useBoardLine } from "./use-board-line";

export function CrewDayCards({ day, positions, names, onSelect }: {
  day: DayView; positions: Record<string, PositionLabel>; names: Record<string, string>;
  onSelect: (shift: ShiftView, segment: number | null) => void;
}) {
  const { t, language, segment, name } = useBoardLine({ names, positions });
  const control = "min-h-[44px] min-w-[44px] w-full break-words rounded-lg border-2 border-co-border p-2 text-left text-sm";
  return <section className="grid min-w-0 grid-cols-1 gap-2" data-section="crew-day-cards" aria-label={t("schedule.crew.cards")}>
    {day.rows.flatMap((row) => row.shifts.map((shift) => <article key={`${row.userId}-${shift.startQ}`} className="co-card grid min-w-0 gap-2 p-3">
      <button type="button" className={control} onClick={() => onSelect(shift, null)} aria-label={t("schedule.crew.select", { name: row.name, from: formatQ(shift.startQ, language), to: formatQ(shift.endQ, language) })}>
        <strong className="block">{row.name} · {shift.crewType?.name ?? t("schedule.crew.custom_shift")}</strong>
        <span>{formatQ(shift.startQ, language)}–{formatQ(shift.endQ, language)}</span>
      </button>
      {shift.segments.map((g, index) => <button type="button" key={index} className={control} onClick={() => onSelect(shift, index)}>
        {segment(g)} · {formatQ(g.startQ, language)}–{formatQ(g.endQ, language)}
      </button>)}
    </article>))}
    <div className="grid min-w-0 gap-1 rounded-lg border-2 border-co-border p-3" aria-label={t("schedule.board.mod_short")}>
      <h3 className="font-bold">{t("schedule.board.mod_short")}</h3>
      {day.mod.filter((m) => m.tone !== "none").map((m) => <p key={m.hour} className="break-words text-sm" data-mod-tone={m.tone}>
        {formatQ(m.hour * 4, language)} · {m.userIds.map(name).join(", ")}{m.tone === "gap" ? ` · ${t("schedule.rule.mod_missing")}` : ""}
      </p>)}
    </div>
  </section>;
}
