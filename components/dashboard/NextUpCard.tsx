/**
 * Next up (nav PR 7, plan r2 2.3; spec 3.3.5 item 5). Server component.
 *
 * Under the aggregate failure it draws NOTHING (Astra F2): no heading, no "Nothing is due", no "Closed for the day". A day
 * nobody could load makes no claim about what is due.
 */
import type { ReactNode } from "react";
import { aggregateFailure } from "@/lib/dashboard-day-shared";
import type { DayPlan, StationState } from "@/lib/day-plan-shared";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { DayRow, dayItemName } from "./DayRow";

export function NextUpCard({ plan, shopId, language, editHref, bodies }: {
  plan: DayPlan;
  shopId: string;
  language: Language;
  editHref?: string;
  bodies?: Readonly<Partial<Record<string, ReactNode>>>;
}) {
  if (aggregateFailure(plan)) return null;
  const n = plan.nextUp;
  const stations: readonly StationState[] = plan.stations;
  let body: ReactNode;
  if (n.kind === "item") {
    const item = plan.items[n.index];
    if (!item) return null;
    body = (
      <DayRow item={item} shopId={shopId} stations={stations} variant="next" language={language} editHref={editHref}>
        {bodies?.[item.id]}
      </DayRow>
    );
  } else if (n.kind === "nothing_due") {
    const next = n.nextIndex !== null ? plan.items[n.nextIndex] : undefined;
    body = (
      <p className="co-card p-4 text-base text-co-text">
        {next
          ? serverT(language, "day.next.nothing_due", { task: dayItemName(next, stations, language) })
          : serverT(language, "dashboard.day.nothing_due_none")}
      </p>
    );
  } else {
    body = <p className="co-card p-4 text-base text-co-text">{serverT(language, "day.next.closed")}</p>;
  }
  return (
    <section aria-label={serverT(language, "dashboard.day.next_up")} data-next-up={n.kind} className="flex flex-col gap-2">
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-co-text-muted">{serverT(language, "dashboard.day.next_up")}</h3>
      {body}
    </section>
  );
}
