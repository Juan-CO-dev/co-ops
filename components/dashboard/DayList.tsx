/**
 * The day list (nav PR 7, plan r2 2.3; spec 3.2 item 5, 3.3.5, 3.3.6). Server component: it draws `plan.items` in the
 * engine's order and never re-sorts:
 *
 *  1. items[0] when it is the full-size pin;
 *  2. the Next up card (its item is not drawn twice); under the aggregate failure there is no card and the item at the
 *     would-be index is an ordinary row (Astra F2);
 *  3. every other urgent / now / upcoming item, in order (the compact pin keeps its index);
 *  4. "Done today" and the done items;
 *  5. "Audit tools" and the tool items;
 *  then the empty line. An item placed as a "block" (the catering manager's catering) is never a row: the page draws it
 *  as the catering block (nav PR 8, Q9). Indices are kept; nothing is re-sorted.
 */
import type { ReactNode } from "react";
import { aggregateFailure } from "@/lib/dashboard-day-shared";
import type { DayItem, DayPlan } from "@/lib/day-plan-shared";
import { renderDayReason } from "@/lib/day-plan-render";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { DayRow, type DayRowVariant } from "./DayRow";
import { NextUpCard } from "./NextUpCard";

export function DayList({ plan, shopId, language, editHref, bodies }: {
  plan: DayPlan;
  shopId: string;
  language: Language;
  /** The AM prep submitter's Edit (C.46 A2). */
  editHref?: string;
  /** The own Receiving / Counts tiles, by item id. */
  bodies?: Readonly<Partial<Record<string, ReactNode>>>;
}) {
  const failed = aggregateFailure(plan);
  const nextIndex = !failed && plan.nextUp.kind === "item" ? plan.nextUp.index : -1;
  const open = (i: DayItem) => i.band === "urgent" || i.band === "now" || i.band === "upcoming";
  const row = (item: DayItem, index: number, variant: DayRowVariant) => (
    <DayRow key={`${item.id}:${index}`} item={item} shopId={shopId} stations={plan.stations} variant={variant} language={language} editHref={editHref}>
      {bodies?.[item.id]}
    </DayRow>
  );
  const fullPin = plan.items[0]?.pin === "full" ? plan.items[0] : null;
  const rest = plan.items.map((item, index) => ({ item, index }))
    .filter(({ item, index }) => !(fullPin && index === 0) && index !== nextIndex && item.placement !== "block");
  const active = rest.filter(({ item }) => open(item));
  const done = rest.filter(({ item }) => item.band === "done");
  const tools = rest.filter(({ item }) => item.band === "tool");
  return (
    <section aria-label={serverT(language, "dashboard.day.list_aria")} className="flex flex-col gap-3">
      {fullPin ? row(fullPin, 0, "full") : null}
      <NextUpCard plan={plan} shopId={shopId} language={language} editHref={editHref} bodies={bodies} />
      {active.map(({ item, index }) => row(item, index, item.pin === "compact" ? "compact-pin" : "row"))}
      {done.length > 0 ? (
        <>
          <h3 className="mt-2 text-[12px] font-bold uppercase tracking-wide text-co-text-muted">{serverT(language, "dashboard.day.done_heading")}</h3>
          {done.map(({ item, index }) => row(item, index, "row"))}
        </>
      ) : null}
      {tools.length > 0 ? (
        <>
          <h3 className="mt-2 text-[12px] font-bold uppercase tracking-wide text-co-text-muted">{serverT(language, "dashboard.day.tools_heading")}</h3>
          {tools.map(({ item, index }) => row(item, index, "row"))}
        </>
      ) : null}
      {plan.empty ? <p className="text-sm text-co-text-muted" role="status">{renderDayReason(plan.empty, language)}</p> : null}
    </section>
  );
}
