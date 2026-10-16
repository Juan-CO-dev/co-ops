"use client";
/**
 * The labor-target card (spec §6.6, Juan 2026-10-16): per day and per window, the optimal people and hours that keep
 * great service without going over the labor target. It shows the math exactly as the spec words it — "Max hourly
 * labor $ = forecast sales × target %", "Max hours = max labor $ ÷ blended average wage" — then the draft against it per
 * window ("Lunch rush: 5 on, optimal 4–5"), and turns AMBER only when a window is over its optimal AND above its minimum
 * crew (judged per quarter; CC chunk G). When the minimum crews alone are above the target it says so ONCE for the day,
 * with its math line. With no forecast or no wage it names its errand. An AGM sees the heads, never the dollar lines
 * (J1: they are absent from the view-model).
 */
import type { LaborTarget } from "@/lib/scheduling/labor-target-shared";
import { useBoardLine } from "./use-board-line";

export function LaborTargetCard({ labor, names, positions }: {
  labor: LaborTarget;
  names: Record<string, string>;
  positions: Record<string, { name: string; nameEs: string | null }>;
}) {
  const { t, line } = useBoardLine({ names, positions });
  const amber = labor.state === "ok" && labor.windows.some((w) => w.tone === "amber");
  return (
    <section data-section="labor-target" data-tone={amber ? "amber" : "good"} aria-labelledby="schedule-labor-title"
      className={`co-card grid gap-2 p-4 ${amber ? "border-2 border-co-warning bg-co-warning-surface" : ""}`}>
      <h3 id="schedule-labor-title" className="text-sm font-bold text-co-text">{t("schedule.board.labor_card.title")}</h3>
      <p className="text-xs text-co-text-muted">{t("schedule.board.labor_card.intro")}</p>
      {labor.state === "ok" ? (
        <>
          {amber ? <p className="text-sm font-bold text-co-warning-text">{t("schedule.board.labor_card.amber")}</p> : null}
          <ul className="grid gap-1 text-sm text-co-text">
            {labor.lines.map((l, i) => (
              <li key={i} data-labor-line={l.key} className={/window_over_target|minimums_over_target$/.test(l.key) ? "font-bold text-co-warning-text" : ""}>{line(l)}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-co-text-muted">{line(labor.errand)}</p>
      )}
    </section>
  );
}
