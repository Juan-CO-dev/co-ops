"use client";
/**
 * The hours budget control (spec §5.2; CC chunk G: "No budget set for this week. Set one" links HERE). A manager with the
 * budget act sets the hours for THIS week or for the whole month the week starts in; the server apportions them to the
 * dates (by forecast share, else evenly) and the newest entry covering a date wins for that date. Posts the route's EXACT
 * body (`budgetBody`, pinned against `SCHEDULE_ACTIONS.budget`); no step-up (audited `schedule.budget_set`); a refusal is
 * named (en + es). 44 px controls; radios are 20 px inside 44 px labels.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import type { TranslationKey } from "@/lib/i18n/types";
import { scheduleErrorKey } from "./schedule-errors";
import { useBoardLine } from "./use-board-line";

export type BudgetScopeChoice = "week" | "month";

/** The route's exact body: a week entry names its Monday, a month entry the 1st of the month the week starts in. */
export function budgetBody(locationId: string, scope: BudgetScopeChoice, weekStart: string, hours: number) {
  return {
    action: "budget" as const, locationId, scope,
    weekStart: scope === "week" ? weekStart : null,
    month: scope === "month" ? `${weekStart.slice(0, 7)}-01` : null,
    hours,
  };
}

/** Typed hours → a quarter-hour number, or null (blank / not a number / negative / off the quarter-hour grid). */
export function parseBudgetHours(v: string): number | null {
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n * 4) ? n : null;
}

export function BudgetSetter({ locationId, weekStart }: { locationId: string; weekStart: string }) {
  const { t } = useBoardLine({ names: {}, positions: {} });
  const router = useRouter();
  const post = useStepUpPost();
  const [scope, setScope] = useState<BudgetScopeChoice>("week");
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);

  async function save() {
    const h = parseBudgetHours(hours);
    if (h === null) { setError("schedule.board.budget.invalid"); return; }
    setBusy(true); setError(null);
    const r = await post("/api/schedule", budgetBody(locationId, scope, weekStart, h));
    setBusy(false);
    if (!r.ok) { setError(scheduleErrorKey(r.code)); return; }
    setHours("");
    router.refresh();
  }

  return (
    <section id="schedule-budget-set" className="co-card grid gap-2 p-4" data-section="budget-set" aria-labelledby="schedule-budget-set-title">
      <h2 id="schedule-budget-set-title" className="text-base font-bold text-co-text">{t("schedule.board.budget.title")}</h2>
      <fieldset className="grid gap-1">
        <legend className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("schedule.board.budget.scope")}</legend>
        <div className="flex flex-wrap gap-2">
          {(["week", "month"] as const).map((s) => (
            <label key={s} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border-2 border-co-border px-3 text-sm font-bold text-co-text">
              <input type="radio" name="schedule-budget-scope" value={s} checked={scope === s} onChange={() => setScope(s)} className="h-5 w-5" />
              {t(s === "week" ? "schedule.board.budget.scope_week" : "schedule.board.budget.scope_month")}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-1 text-sm text-co-text">
        <span className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("schedule.board.budget.hours")}</span>
        <input type="number" inputMode="decimal" min={0} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)}
          className="min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 text-co-text" />
      </label>
      <button type="button" data-act="budget-save" disabled={busy} onClick={save}
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text disabled:opacity-60">
        {t("schedule.board.budget.save")}
      </button>
      {error ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p> : null}
    </section>
  );
}
