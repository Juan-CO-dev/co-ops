/**
 * The phase line (nav PR 7, plan r2 2.3; spec 3.2 item 2, 3.3.11). Server component: no client JS, no data, no clock.
 * Draws NOTHING under the aggregate failure (Q5, Astra F2): a day nobody could load has no phase to claim.
 * `omitHeadsUp` (nav PR 8, Q5): the page passes it only when the catering block is drawn AND draws the night-before line
 * itself, so the line appears once.
 */
import { aggregateFailure } from "@/lib/dashboard-day-shared";
import type { DayPlan } from "@/lib/day-plan-shared";
import { renderDayReason } from "@/lib/day-plan-render";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";

export function PhaseLine({ plan, language, omitHeadsUp = false }: { plan: DayPlan; language: Language; omitHeadsUp?: boolean }) {
  if (aggregateFailure(plan)) return null;
  const parts = [serverT(language, `day.phase.${plan.phase.id}`)];
  if (plan.phase.heavy) parts.push(serverT(language, "day.phase.heavy_suffix"));
  if (plan.phase.since) parts.push(renderDayReason(plan.phase.since, language));
  return (
    <section aria-label={serverT(language, "dashboard.day.phase_aria")} data-phase={plan.phase.id} className="flex flex-col gap-1">
      <p className="text-base font-bold text-co-text">{parts.join(" · ")}</p>
      {plan.headsUp && !omitHeadsUp ? <p className="text-sm text-co-text-muted">{renderDayReason(plan.headsUp, language)}</p> : null}
    </section>
  );
}
