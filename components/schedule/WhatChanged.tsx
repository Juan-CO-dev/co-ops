"use client";
/**
 * "What changed" (spec §6.1; plan Task 23): a week's summary line, then the per-day list COLLAPSED behind a full-row
 * toggle with its count (D5, D8, D10). Each change names the person and the times; money changes appear only for a
 * viewer who may see money (the diff carries them only then); an unknown cost says so, never $0.
 */
import { useId, useState } from "react";
import { formatCentsWhole, formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import type { DayChange, WeekDiff } from "@/lib/scheduling/diff-shared";
import { formatQ } from "@/lib/scheduling/time-shared";
import { useBoardLine } from "./use-board-line";

const r1 = (n: number) => Math.round(n * 10) / 10;
const signed = (n: number) => (n > 0 ? `+${r1(n)}` : String(r1(n)));

export function WhatChanged({ diff, names, positions }: {
  diff: WeekDiff;
  names: Record<string, string>;
  positions: Record<string, { name: string; nameEs: string | null }>;
}) {
  const { t, language, line, name, position } = useBoardLine({ names, positions });
  const [open, setOpen] = useState(false);
  const id = useId();
  const range = (a: number, b: number) => `${formatQ(a, language)}–${formatQ(b, language)}`;
  const detail = (c: DayChange): string => {
    switch (c.kind) {
      case "person_added": case "person_removed": return `${name(c.userId)} ${range(c.startQ, c.endQ)}`;
      case "shift_moved": return `${name(c.userId)} ${range(c.fromStartQ, c.fromEndQ)} → ${range(c.toStartQ, c.toEndQ)}`;
      case "segments_relabelled": return `${name(c.userId)}: ${c.from.map((x) => position(x)).join(" / ")} → ${c.to.map((x) => position(x)).join(" / ")}`;
      case "closing_manager_changed": return `${c.from ? name(c.from) : "—"} → ${c.to ? name(c.to) : "—"}`;
      case "mod_gap_opened": case "mod_gap_closed": return range(c.fromQ, c.toQ);
      case "gap_hours": return `${t(`schedule.gap.cause.${c.cause}` as TranslationKey)} ${signed(c.deltaHours)} h`;
      case "hourly_hours": return `${signed(c.deltaHours)} h`;
      case "cost": return formatCentsWhole(c.deltaCents, language);
      case "cost_unknown": return t("schedule.diff.cost_partial", { n: c.unknownShifts });
      case "problems": return `${signed(c.delta)}`;
    }
  };
  const total = diff.days.reduce((n, d) => n + d.changes.length, 0);
  return (
    <div className="grid gap-1" data-section="what-changed">
      <p className="text-sm text-co-text">{line(diff.summaryLine)}</p>
      {total > 0 ? (
        <>
          <button type="button" aria-expanded={open} aria-controls={id} data-days={diff.days.length} onClick={() => setOpen((o) => !o)}
            className="flex min-h-[44px] w-full items-center justify-between rounded-lg border border-co-border bg-co-surface-inset px-3 text-left text-xs font-bold tracking-wide text-co-text-muted">
            <span>{t("schedule.board.horizon.days_toggle", { n: total })}</span><span aria-hidden="true">{open ? "⌃" : "⌄"}</span>
          </button>
          {open ? (
            <ul id={id} className="grid gap-2 text-sm">
              {diff.days.map((d) => (
                <li key={d.date} className="grid gap-0.5">
                  <span className="font-bold text-co-text">{formatDateLabel(d.date, language)}</span>
                  <ul className="grid gap-0.5 pl-3 text-co-text-muted">
                    {d.changes.map((c, i) => <li key={i}>{t("schedule.board.diff.line", { label: t(`schedule.diff.kind.${c.kind}` as TranslationKey, c.kind === "cost_unknown" ? { unknownShifts: c.unknownShifts } : undefined), detail: detail(c) })}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
