"use client";
/**
 * The day timeline (spec §7; mockup v17 `renderTimeline` / `demandSvg` / `coverage` / `modHour` /
 * `closingRoleCoverage` / `renderStrength`). One CSS grid: a sticky label column plus one column per shop hour. It is
 * the ONE horizontally scrollable region of the board (the page never scrolls sideways): a full-width hour is 4 rem, and
 * "Fit hours" zooms the axis to the screen. Rows: the demand curve (an SVG with its basis in the aria-label; relative
 * heights only — no dollars in the drawing), labor % by hour (money viewers only; toned from the shop's target, each cell
 * with its word), coverage per position × hour (red short / amber over / green covered / grey closed — each with its
 * word, never colour alone), the Closing Manager role, the manager-on-duty lane, then the person rows (`renderRows`).
 * Team-strength chips sit above the grid. useState only.
 */
import { useState, type ReactNode } from "react";
import { formatHourShort } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import type { DayView } from "@/lib/scheduling/board-view-shared";
import { Q_PER_HOUR } from "@/lib/scheduling/time-shared";
import { useBoardLine } from "./use-board-line";

const COVERAGE_TONE = {
  gap: "bg-co-danger-surface text-co-cta-text",
  over: "bg-co-warning-surface text-co-warning-text",
  good: "bg-co-success-surface text-co-confirm-text",
  closed: "bg-co-surface-inset text-co-text-dim",
} as const;
const LABOR_TONE = {
  good: "text-co-confirm-text", watch: "text-co-warning-text", high: "text-co-cta-text", none: "text-co-text-dim",
} as const;
const STRENGTH_TONE: Record<string, string> = {
  strong: "bg-co-success-surface text-co-confirm-text", watch: "bg-co-warning-surface text-co-warning-text", thin: "bg-co-danger-surface text-co-cta-text",
  unknown: "bg-co-surface-inset text-co-text-muted", empty: "bg-co-surface-inset text-co-text-dim",
};
const num = (n: number) => String(Math.round(n * 100) / 100);

export interface TimelineAxis { fromQ: number; toQ: number }

export function DayTimeline({ day, names, positions, renderRows }: {
  day: DayView;
  names: Record<string, string>;
  positions: Record<string, { name: string; nameEs: string | null }>;
  renderRows?: (axis: TimelineAxis) => ReactNode;
}) {
  const { t, language, name, position } = useBoardLine({ names, positions });
  const [fit, setFit] = useState(false);
  const hours = day.hours;
  if (hours.length === 0) {
    return (
      <section className="grid gap-2" aria-label={t("schedule.board.timeline.label")}>
        <p className="text-sm text-co-text-muted">{t("schedule.board.timeline.no_context")}</p>
        {renderRows ? <div className="grid gap-1">{renderRows({ fromQ: 24, toQ: 88 })}</div> : null}
      </section>
    );
  }
  const axis: TimelineAxis = { fromQ: hours[0]! * Q_PER_HOUR, toQ: (hours[hours.length - 1]! + 1) * Q_PER_HOUR };
  const cols = { gridTemplateColumns: `7rem repeat(${hours.length}, ${fit ? "minmax(0, 1fr)" : "4rem"})` };
  const label = "sticky left-0 z-10 flex min-h-[44px] flex-col justify-center border-r border-co-border bg-co-surface px-2 text-xs";
  const shown = day.positionOrder.filter((id) => day.coverage.some((c) => c.positionId === id && c.tone !== "closed"));
  const curve = day.curve;
  const points = curve ? curve.map((c, i) => `${i * 4 + 2},${(38 - c.level * 34).toFixed(1)}`).join(" ") : "";
  return (
    <section className="grid min-w-0 gap-2" aria-label={t("schedule.board.timeline.label")}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-bold tracking-wide text-co-text-muted">{t("schedule.board.strength.title")}</h3>
        <ul className="flex flex-wrap gap-1">
          {day.strength.map((w) => (
            <li key={w.key} data-strength={w.word} className={`rounded-lg px-2 py-1 text-xs font-bold ${STRENGTH_TONE[w.word] ?? ""}`}>
              {t("schedule.board.strength.chip", { window: t(`schedule.board.window.${w.key}` as TranslationKey), word: t(`schedule.board.strength.${w.word}` as TranslationKey) })}
            </li>
          ))}
        </ul>
        <button type="button" data-act="fit" aria-pressed={fit} onClick={() => setFit((f) => !f)}
          className="ml-auto inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold tracking-[0.1em] text-co-text">
          {t("schedule.board.timeline.fit")}
        </button>
      </div>
      <div data-section="timeline" className="max-w-full overflow-x-auto rounded-lg border border-co-border bg-co-surface">
        <div className="grid text-xs" style={cols}>
          <div className={`${label} font-bold tracking-[0.12em] text-co-text-dim`}>{t("schedule.board.timeline.axis")}</div>
          {hours.map((h) => <div key={h} className="flex min-h-[44px] items-center border-b border-co-border px-1 tabular-nums text-co-text-muted">{formatHourShort(h, language)}</div>)}

          <div className={label}><strong className="text-co-text">{t("schedule.board.timeline.demand_label")}</strong></div>
          <div className="relative min-h-[48px] border-b border-co-border" style={{ gridColumn: "2 / -1" }}>
            {curve ? (
              <svg viewBox={`0 0 ${hours.length * 4} 40`} preserveAspectRatio="none" role="img" className="absolute inset-0 h-full w-full"
                aria-label={t("schedule.board.demand.label", { basis: t("schedule.board.demand.basis") })}>
                <polygon points={`0,40 ${points} ${hours.length * 4},40`} className="fill-co-gold/40" />
                <polyline points={points} fill="none" className="stroke-co-gold-text" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
              </svg>
            ) : <p className="px-2 py-3 text-co-text-muted">{t("schedule.board.demand.none")}</p>}
          </div>

          {day.laborByHour ? (
            <>
              <div className={label}><strong className="text-co-text">{t("schedule.board.timeline.labor_label")}</strong></div>
              {day.laborByHour.map((c) => (
                <div key={c.hour} data-labor-tone={c.tone} className={`flex min-h-[44px] flex-col items-center justify-center border-b border-co-border tabular-nums ${LABOR_TONE[c.tone]}`}>
                  <span className="font-bold">{c.pct === null ? t("schedule.board.money.blank") : `${num(c.pct)}%`}</span>
                  <small className="text-[10px]">{t(`schedule.board.labor.${c.tone}` as TranslationKey)}</small>
                </div>
              ))}
            </>
          ) : null}

          <div className="sticky left-0 z-10 bg-co-surface-2 px-2 py-2 text-[10px] font-bold tracking-[0.08em] text-co-text-muted" style={{ gridColumn: "1 / -1" }}>
            {t("schedule.board.timeline.coverage_heading")}
          </div>
          {shown.map((id) => (
            <CoverageRow key={id} label={position(id)} cells={day.coverage.filter((c) => c.positionId === id)} labelClass={label} t={t} />
          ))}
          <div className={label}><strong className="text-co-text">{t("schedule.board.timeline.closing_label")}</strong></div>
          {day.closing.map((c) => (
            <div key={c.hour} data-closing-state={c.state} className={`flex min-h-[44px] flex-col items-center justify-center border-b border-co-border px-0.5 text-center ${c.state === "gap" ? COVERAGE_TONE.gap : c.state === "covered" ? COVERAGE_TONE.good : COVERAGE_TONE.closed}`}>
              <span className="font-bold">{t(`schedule.board.closing.${c.state}` as TranslationKey)}</span>
              {c.userId ? <small className="truncate text-[10px]">{name(c.userId)}</small> : null}
            </div>
          ))}

          <div className="sticky left-0 z-10 bg-co-surface-2 px-2 py-2 text-[10px] font-bold tracking-[0.08em] text-co-text-muted" style={{ gridColumn: "1 / -1" }}>
            {t("schedule.board.timeline.mod_heading")}
          </div>
          <div className={label}><strong className="text-co-text">{t("schedule.board.mod_short")}</strong></div>
          {day.mod.map((m) => (
            <div key={m.hour} data-mod-tone={m.tone} className={`flex min-h-[44px] flex-col items-center justify-center border-b border-co-border px-0.5 text-center ${m.tone === "gap" ? COVERAGE_TONE.gap : m.tone === "good" ? COVERAGE_TONE.good : COVERAGE_TONE.closed}`}>
              <span className="font-bold">{m.userIds.length > 0 ? m.userIds.map((u) => name(u)).join(" / ") : t(`schedule.board.mod.${m.tone}` as TranslationKey)}</span>
              {m.userIds.length > 0 ? <small className="text-[10px]">{t(`schedule.board.mod.${m.tone}` as TranslationKey)}</small> : null}
            </div>
          ))}
          {renderRows ? renderRows(axis) : null}
        </div>
      </div>
    </section>
  );
}

function CoverageRow({ label, cells, labelClass, t }: {
  label: string;
  cells: DayView["coverage"];
  labelClass: string;
  t: ReturnType<typeof useBoardLine>["t"];
}) {
  return (
    <>
      <div className={labelClass}><strong className="truncate text-co-text">{label}</strong></div>
      {cells.map((c) => (
        <div key={c.hour} data-coverage-tone={c.tone} className={`flex min-h-[44px] flex-col items-center justify-center border-b border-co-border tabular-nums ${COVERAGE_TONE[c.tone]}`}>
          <span className="font-bold">{num(c.scheduled)}/{num(c.needed)}</span>
          <small className="text-[10px]">{t(`schedule.board.coverage.${c.tone}` as TranslationKey)}</small>
        </div>
      ))}
    </>
  );
}
