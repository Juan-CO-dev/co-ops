/**
 * The social media manager's Dashboard body (nav PR 7, plan r2 2.7; spec 3.3.6, 8.1; group 13). Server component.
 *
 * Input: the SmmPlan and nothing else from the shop. Own checklist tasks ("Assigned to you."), the own station, a link to
 * the closing checklist, the two shortcuts and "All pages". NEVER: the phase line, a count, a time, a holder, "Nobody yet",
 * "Edit", the board, Team today, Shop pulse, the numbers strip or retrain tasks. The page draws the header without a bell.
 */
import Link from "next/link";
import { taskHref } from "@/lib/assignments-shared";
import type { DayViewer, SmmPlan } from "@/lib/day-plan-shared";
import { renderDayReason } from "@/lib/day-plan-render";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { byId } from "@/lib/nav/destinations";
import { Shortcuts } from "./Shortcuts";

export function SmmDashboard({ plan, shopId, language, viewer }: {
  plan: SmmPlan;
  shopId: string;
  language: Language;
  viewer: Pick<DayViewer, "role" | "level" | "surfaces" | "switches">;
}) {
  const closingHref = `/operations/closing?location=${encodeURIComponent(shopId)}`;
  return (
    <div className="flex flex-col gap-6" data-smm-dashboard>
      {plan.notes.map((key) => (
        <p key={key} className="text-sm text-co-text-muted" role="status">{serverT(language, key)}</p>
      ))}
      <section aria-label={serverT(language, "dashboard.smm.tasks_heading")} className="flex flex-col gap-3">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-co-text-muted">{serverT(language, "dashboard.smm.tasks_heading")}</h3>
        {plan.tasks === "unavailable" ? null : plan.tasks.length === 0 ? (
          <p className="text-sm text-co-text-muted">{serverT(language, "dashboard.smm.no_tasks")}</p>
        ) : (
          plan.tasks.map((t) => (
            <article key={t.task} data-smm-task={t.task} className="co-card flex min-w-0 flex-col gap-1 p-4">
              <Link href={taskHref(t.task, shopId)} className="font-bold text-co-text underline-offset-2 hover:underline">
                {serverT(language, byId(t.destId).nameKey)}
              </Link>
              <p className="text-sm text-co-text-muted">{serverT(language, `day.state.${t.state === "unknown" ? "not_started" : t.state}`)}</p>
              <p className="text-sm text-co-text">{renderDayReason(t.reason, language)}</p>
            </article>
          ))
        )}
        {plan.station !== null && plan.station !== "unavailable" ? (
          <p className="text-sm font-semibold text-co-text">
            {serverT(language, "assignments.stationCard", { station: language === "es" ? (plan.station.nameEs || plan.station.name) : plan.station.name })}
          </p>
        ) : null}
        <Link href={closingHref} className="font-semibold text-co-text underline underline-offset-2" data-smm-closing>
          {serverT(language, byId(plan.closingDestId).nameKey)}
        </Link>
      </section>
      <Shortcuts viewer={viewer} shopId={shopId} language={language} />
    </div>
  );
}
