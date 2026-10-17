"use client";
/**
 * The live strip (spec §7, mockup v17 `renderMetrics` + `renderSalaryStrip`): hourly hours vs budget, hourly labor $ and
 * % of forecast, salaried (fixed) cost, TOTAL labor %, OT risk, flex days used, manager floor hours + the hourly hours
 * they save (MoD time shown apart — it never counts as floor time). Money arrives only for a viewer who may see it
 * (J1): an AGM sees the hours and one line saying who sees cost. An unknown wage is "—" with its errand, never $0 (R2).
 * Phone-first: two columns at 375 px, four from `sm`.
 */
import Link from "next/link";
import type { MoneyStrip as Strip } from "@/lib/scheduling/board-shared";
import { formatCentsWhole } from "@/lib/i18n/format";
import { useBoardLine } from "./use-board-line";

const h1 = (n: number) => String(Math.round(n * 10) / 10);

function Metric({ label, value, sub, tone = "plain" }: { label: string; value: string; sub?: string | null; tone?: "plain" | "danger" }) {
  return (
    <div className="grid min-w-0 gap-0.5 rounded-lg border border-co-border bg-co-surface p-3" data-metric={label}>
      <span className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{label}</span>
      <span className={`text-lg font-bold tabular-nums ${tone === "danger" ? "text-co-cta-text" : "text-co-text"}`}>{value}</span>
      {sub ? <span className="text-xs text-co-text-muted">{sub}</span> : null}
    </div>
  );
}

/**
 * One budget line. "No budget set for this week." (CC chunk G: one line, never one per date) carries "Set one", linking
 * the budget control on this page, for a viewer who may set the budget.
 */
export function BudgetLineItem({ line: l, canBudget, render, setLink }: {
  line: { key: string; params?: Record<string, string | number> };
  canBudget: boolean;
  render: (l: { key: string; params?: Record<string, string | number> }) => string;
  setLink: string;
}) {
  if (l.key !== "schedule.budget.none_set") return <li>{render(l)}</li>;
  return (
    <li className="flex flex-wrap items-center gap-x-2" data-budget="none_set">
      <span>{render(l)}</span>
      {canBudget ? <a href="#schedule-budget-set" className="inline-flex min-h-[44px] items-center font-bold text-co-text underline">{setLink}</a> : null}
    </li>
  );
}

export function MoneyStrip({ strip, budgetLines, names, positions, canSetEstimates, canBudget = false, locationId }: {
  strip: Strip;
  budgetLines: Array<{ key: string; params?: Record<string, string | number> }>;
  names: Record<string, string>;
  positions: Record<string, { name: string; nameEs: string | null }>;
  /** MoO+: the errand links to schedule settings. */
  canSetEstimates: boolean;
  /** The budget act: "Set one" links the budget control. */
  canBudget?: boolean;
  locationId: string;
}) {
  const { t, language, line } = useBoardLine({ names, positions });
  const hrs = strip.hours;
  const money = strip.money;
  const blank = t("schedule.board.money.blank");
  const remaining = hrs.remainingHours;
  const budgetSub = remaining === null ? t("schedule.board.money.no_budget")
    : remaining < 0 ? t("schedule.board.money.over", { hours: h1(-remaining) }) : t("schedule.board.money.remaining", { hours: h1(remaining) });
  const usd = (c: number | null | undefined) => (c === null || c === undefined ? blank : formatCentsWhole(c, language));
  const pct = (p: number | null | undefined) => (p === null || p === undefined ? blank : t("schedule.board.money.pct_value", { pct: p }));
  const moneyBlank = !!money && (money.hourlyCostCents === null || money.salariedFixedCents === null);
  return (
    <section aria-label={t("schedule.board.money.title")} className="grid gap-2" data-section="strip">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label={t("schedule.board.money.hours_vs_budget")} value={t("schedule.board.money.hours_value", { used: h1(hrs.hourlyHours), budget: hrs.budgetHours === null ? blank : h1(hrs.budgetHours) })}
          sub={budgetSub} tone={remaining !== null && remaining < 0 ? "danger" : "plain"} />
        {money ? (
          <>
            <Metric label={t("schedule.board.money.hourly_cost")} value={usd(money.hourlyCostCents)} sub={money.hourlyPct === null ? null : t("schedule.board.money.of_forecast", { pct: money.hourlyPct })} />
            <Metric label={t("schedule.board.money.salaried")} value={usd(money.salariedFixedCents)} sub={t("schedule.board.money.salaried_sub")} />
            <Metric label={t("schedule.board.money.total_pct")} value={pct(money.totalPct)} />
          </>
        ) : null}
        <Metric label={t("schedule.board.money.ot_risk")} value={String(hrs.otRiskCount)} tone={hrs.otRiskCount > 0 ? "danger" : "plain"} />
        <Metric label={t("schedule.board.money.flex_used")} value={String(hrs.flexUsed)} sub={t("schedule.board.flag.flex_later")} />
        <Metric label={t("schedule.board.money.manager_floor")} value={t("schedule.board.money.floor_value", { floor: h1(hrs.managerFloorHours), saved: h1(hrs.hourlySavedBySalaried) })}
          sub={`${t("schedule.board.money.manager_mod")}: ${t("schedule.board.money.hours_only", { hours: h1(hrs.managerModHours) })}`} />
      </div>
      {hrs.salariedWeeks.length > 0 ? (
        <ul className="grid gap-1 text-sm text-co-text" data-section="salaried-weeks">
          {hrs.salariedWeeks.map((w) => (
            <li key={w.userId} data-salaried-week={w.userId}>{t("schedule.board.money.salaried_week", { name: names[w.userId] ?? w.userId, base: h1(w.baseHours), flex: h1(w.flexHours) })}</li>
          ))}
        </ul>
      ) : null}
      {!money ? <p className="text-xs text-co-text-muted">{t("schedule.board.money.hidden")}</p> : null}
      {moneyBlank ? (
        <p className="text-sm font-bold text-co-warning-text">
          {canSetEstimates
            ? <Link href={`/schedule/settings?loc=${locationId}`} className="inline-flex min-h-[44px] items-center underline">{t("schedule.board.money.errand_set_wage_moo")}</Link>
            : t("schedule.board.money.errand_set_wage")}
        </p>
      ) : null}
      {[...strip.notes, ...budgetLines].length > 0 ? (
        <ul className="grid gap-1 text-sm text-co-text-muted" data-section="budget-lines">
          {strip.notes.map((n, i) => <li key={`n${i}`} className="font-bold text-co-warning-text">{line(n)}</li>)}
          {budgetLines.map((n, i) => <BudgetLineItem key={`b${i}`} line={n} canBudget={canBudget} render={line} setLink={t("schedule.board.budget.set_link")} />)}
        </ul>
      ) : null}
    </section>
  );
}
