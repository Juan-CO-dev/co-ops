/**
 * Item 9b: the business report's five tabs for ONE shop, rendered from the DTO of lib/business-report.ts (the
 * export, lib/report-export-shared.ts business*Rows, projects the same DTO). Summary rows with drawers
 * (CollapsibleSection, D1-D10), phone-first at 375 px: no tables, lines that wrap.
 *
 * What a viewer gets is decided by the loader, never here: a GM's DTO carries no cost per person and no
 * labor dollars per 15 minutes (PERSON_COST_MIN / QUARTER_COST_MIN), so this page cannot show them.
 *
 * Fix round 3 (review ITEM9B-r3): every labor and sales figure — cards, collapsed summary rows, drawers, the
 * 15-minute lines, People, Compare — is a `Figure` from lib/business-figure-shared.ts rendered by `FigureView` /
 * `figureText` (BusinessParts). This file never formats a labor number or picks its reason by hand
 * (pinned by tests/business-report-9b-r3.test.ts).
 */
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { channelLabel, providerLabel, serverLabel } from "@/components/reports-hub/SalesParts";
import type { ReactNode } from "react";
import { formatCents, formatDateLabel, formatQuantity, formatTime } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { BusinessDayDto, BusinessQuarterDto, BusinessReportDto } from "@/lib/business-report";
import { breakdownCoverage, compareChange, salesAmountMissing, type CompareChange, type LaborFigures } from "@/lib/business-report-shared";
import {
  figureComparable, hoursFigure, loadedCentsFigure, loadedPctFigure, minutesFigure, netFigure, otHoursFigure, pureCentsFigure, purePctFigure,
  quarterCentsFigure, quarterHoursFigure, quarterPctFigure, salesFigure, type Figure,
} from "@/lib/business-figure-shared";
import { Amount, Card, Dash, FigureLine, FigureView, LaborPct, Line, Money, bizCard, dateRange, figureText, figureValueText, tFor } from "./BusinessParts";

type Props = { dto: BusinessReportDto; language: Language };

/** The labor lines of a day / week / range drawer: pure hourly, then fully loaded, each through the descriptor. */
function LaborLines({ labor, language }: { labor: LaborFigures; language: Language }) {
  const t = tFor(language);
  return <div className="flex flex-col gap-1">
    <FigureLine language={language} label={t("reports.business.detail.net_sales")} f={netFigure(labor)} />
    <FigureLine language={language} label={t("reports.business.detail.hours")} f={hoursFigure(labor)} />
    <FigureLine language={language} label={t("reports.business.detail.pure_hourly_cost")} f={pureCentsFigure(labor, "pureHourlyCents")} />
    <FigureLine language={language} label={t("reports.business.detail.ot_premium")} f={pureCentsFigure(labor, "otPremiumCents")} />
    <FigureLine language={language} label={t("reports.business.detail.ot_hours")} f={otHoursFigure(labor)} />
    <FigureLine language={language} label={t("reports.business.detail.salaried")} f={loadedCentsFigure(labor, "salariedCents")} />
    <FigureLine language={language} label={t("reports.business.detail.burden")} f={loadedCentsFigure(labor, "burdenCents")} />
    <FigureLine language={language} label={t("reports.business.detail.fully_loaded")} f={loadedCentsFigure(labor, "fullyLoadedCents")} />
  </div>;
}

/** The collapsed line of a day / week: every figure with its state, reason and (short) qualifications, so the
 * closed list says everything the open drawer says about whether a number is whole. */
function summaryLine(sales: Figure, labor: LaborFigures, language: Language): string {
  const t = tFor(language);
  const short = { short: true };
  return [
    t("reports.business.row.sales", { amount: figureText(sales, language, short) }),
    t("reports.business.row.hours", { h: figureText(hoursFigure(labor), language, short) }),
    t("reports.business.row.labor_pct", { pct: figureText(purePctFigure(labor), language, short) }),
    t("reports.business.row.loaded_pct", { pct: figureText(loadedPctFigure(labor), language, short) }),
  ].join(" · ");
}

function DayBadges({ day, language }: { day: BusinessDayDto; language: Language }) {
  const t = tFor(language);
  return <>
    {day.sales.coverage !== "complete" ? <span className="rounded-full bg-co-warning-surface px-2 py-0.5 text-xs font-bold text-co-warning-text">{t(`reports.business.coverage.${day.sales.coverage}` as TranslationKey)}</span> : null}
    {day.cuts === "rebuilding" ? <span className="rounded-full bg-co-warning-surface px-2 py-0.5 text-xs font-bold text-co-warning-text">{t("reports.business.badge.rebuilding")}</span> : null}
    {day.rush?.state === "ok" && day.rush.windows.length > 0 ? <span className="rounded-full bg-co-gold/20 px-2 py-0.5 text-xs font-bold text-co-text">{t("reports.business.rush.count", { n: day.rush.windows.length })}</span> : null}
    {day.largeChecks.checks > 0 ? <span className="rounded-full bg-co-gold/20 px-2 py-0.5 text-xs font-bold text-co-text">{t("reports.business.badge.large", { n: day.largeChecks.checks })}</span> : null}
  </>;
}

const daySales = (d: BusinessDayDto) => salesFigure(d.sales, salesAmountMissing(d.sales));

// ── Overview ────────────────────────────────────────────────────────────────────────────────────

export function BusinessOverview({ dto, language }: Props) {
  const t = tFor(language);
  const { total } = dto;
  const covered = dto.days.filter((d) => d.sales.coverage === "complete").length;
  const totalMissing = dto.days.reduce((s, d) => s + salesAmountMissing(d.sales), 0);
  const breakdown = breakdownCoverage(dto.days);
  return <section className={bizCard} aria-label={t("reports.business.tab.overview")}>
    <p className="mb-3 text-sm text-co-text-muted">{dateRange(dto.range.from, dto.range.to, language)} · {t("reports.business.caption")}</p>
    {covered < dto.days.length ? <p className="mb-3 text-xs font-bold text-co-warning-text">{t("reports.business.coverage.days", { covered, expected: dto.days.length })}</p> : null}
    <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3">
      <Card label={t("reports.business.card.sales")} sub={t("reports.business.card.sales_hint")}><FigureView f={salesFigure(total.sales, totalMissing)} language={language} /></Card>
      <Card label={t("reports.business.card.net")} sub={total.labor.denominator.state === "ok" ? t("reports.business.card.net_hint") : null}>
        <FigureView f={netFigure(total.labor)} language={language} /></Card>
      <Card label={t("reports.business.card.hours")}><FigureView f={hoursFigure(total.labor)} language={language} /></Card>
      <Card label={t("reports.business.card.pure_hourly")}><LaborPct figures={total.labor} view="pure" target={total.target} language={language} /></Card>
      <Card label={t("reports.business.card.fully_loaded")}><LaborPct figures={total.labor} view="loaded" target={total.loadedTarget} language={language} /></Card>
      <Card label={t("reports.business.card.refunds")} sub={t("reports.business.card.refunds_hint")}><Money cents={total.sales.coverage === "missing" ? null : total.sales.refundCents} reason="reports.business.sales.not_captured" language={language} /></Card>
    </div>
    <p className="mt-3 text-xs text-co-text-muted">{t("reports.business.labor.denominator")}</p>
    <p className="text-xs text-co-text-muted">{t("reports.business.loaded.basis")}</p>
    {dto.largeChecks.checks > 0 ? <p className="mt-1 text-xs font-bold text-co-warning-text">{t("reports.business.large_checks", { count: dto.largeChecks.checks, amount: formatCents(dto.largeChecks.cents, language) })}</p> : null}
    {breakdown.state !== "complete" && dto.days.length > 0 ? <p className="mt-1 text-xs text-co-text-muted">{t("reports.business.large_checks_partial", { covered: breakdown.included, expected: breakdown.expected })}</p> : null}

    <div className="mt-4 flex flex-col gap-2">
      <CollapsibleSection idBase={`biz-weeks-${dto.locationId}`} title={t("reports.business.weeks")} count={t("reports.business.count_weeks", { n: dto.weeks.length })} defaultOpen>
        <div className="flex flex-col gap-2">
          {dto.weeks.map((w) => {
            const days = dto.days.filter((d) => d.date >= w.from && d.date <= w.to);
            const coverage = days.length > 0 && days.every((d) => d.sales.coverage === "complete") ? "complete" : days.every((d) => d.sales.coverage === "missing") ? "missing" : "partial";
            const sales = salesFigure({ coverage, totalCents: days.reduce((s, d) => s + d.sales.totalCents, 0) }, days.reduce((s, d) => s + salesAmountMissing(d.sales), 0));
            return <CollapsibleSection key={w.weekStart} idBase={`biz-week-${dto.locationId}-${w.weekStart}`}
              title={t("reports.business.week_of", { range: dateRange(w.from, w.to, language) })} count={summaryLine(sales, w.labor, language)}>
              <div className="flex flex-col gap-2 p-1">
                <div className="flex flex-wrap gap-4"><LaborPct figures={w.labor} view="pure" target={w.target} language={language} /><LaborPct figures={w.labor} view="loaded" target={w.loadedTarget} language={language} /></div>
                <LaborLines labor={w.labor} language={language} />
              </div>
            </CollapsibleSection>;
          })}
        </div>
      </CollapsibleSection>
      <CollapsibleSection idBase={`biz-days-${dto.locationId}`} title={t("reports.business.days")} count={t("reports.business.count_days", { n: dto.days.length })}>
        <div className="flex flex-col gap-2">
          {[...dto.days].reverse().map((d) => <CollapsibleSection key={d.date} idBase={`biz-day-${dto.locationId}-${d.date}`}
            title={formatDateLabel(d.date, language)} count={summaryLine(daySales(d), d.labor, language)} badge={<DayBadges day={d} language={language} />}>
            <div className="flex flex-col gap-2 p-1">
              <FigureLine language={language} label={t("reports.business.detail.sales")} f={daySales(d)} />
              <Line language={language} label={t("reports.business.detail.checks")} value={d.sales.coverage === "missing" ? null : String(d.sales.checks)} reason="reports.business.labor.state.sales_not_covered" />
              <Line language={language} label={t("reports.business.detail.toast_net")} value={d.sales.toastNetCents === null ? null : <Money cents={d.sales.toastNetCents} language={language} />} reason="reports.business.labor.state.net_unknown" />
              <Line language={language} label={t("reports.business.detail.ezcater")} value={d.sales.coverage === "missing" ? null : <Amount cents={d.sales.ezcaterCents} missing={d.sales.ezcaterMissing} language={language} />} reason="reports.business.sales.not_captured" />
              <div className="flex flex-wrap gap-4"><LaborPct figures={d.labor} view="pure" target={dto.weeks.find((w) => d.date >= w.from && d.date <= w.to)?.target ?? total.target} language={language} />
                <LaborPct figures={d.labor} view="loaded" target={dto.weeks.find((w) => d.date >= w.from && d.date <= w.to)?.loadedTarget ?? total.loadedTarget} language={language} /></div>
              <LaborLines labor={d.labor} language={language} />
              {d.cuts === "rebuilding" ? <p className="text-xs text-co-warning-text">{t("reports.business.cuts.rebuilding")}</p> : null}
            </div>
          </CollapsibleSection>)}
        </div>
      </CollapsibleSection>
      <p className="text-xs text-co-text-muted">{t("reports.business.last_year.label")}: {t("reports.business.last_year.no_data_yet")}</p>
    </div>
  </section>;
}

// ── Hours (15-minute grid, rushes) ──────────────────────────────────────────────────────────────

/** One 15 minutes. Its labor is judged against the DAY's labor state (fix round 3): no minutes is "No labor"
 * only when the day's hours are final; otherwise a dash with the day's reason, and minutes are "so far". */
function QuarterLine({ q, day, money, language }: { q: BusinessQuarterDto; day: BusinessDayDto; money: boolean; language: Language }) {
  const t = tFor(language);
  return <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-co-border/50 py-2 text-sm">
    <span className="min-w-[4.5rem] font-bold text-co-text">{formatTime(q.quarterStartAt, language)}</span>
    <span>{q.checks === null ? <Dash reason="reports.business.cuts.rebuilding" language={language} /> : t("reports.business.hours.checks", { n: q.checks })}</span>
    <span>{q.toastCents === null ? <Dash reason="reports.business.cuts.rebuilding" language={language} /> : <Amount cents={q.toastCents} missing={q.amountMissing} language={language} />}</span>
    <span className="text-co-text-muted"><FigureView f={quarterHoursFigure(q.laborMinutes, day.labor.state)} language={language} compact /></span>
    {money ? <span className="inline-flex gap-1 text-co-text-muted"><FigureView f={quarterCentsFigure(q.straightCents, q.laborMinutes, day.labor)} language={language} compact />
      {" · "}<FigureView f={quarterPctFigure(q.pct, day.labor.state)} language={language} compact /></span> : null}
  </li>;
}

export function BusinessHours({ dto, language }: Props) {
  const t = tFor(language);
  const r = dto.rushRule;
  const money = dto.access.quarterCost;
  return <section className={bizCard} aria-label={t("reports.business.tab.hours")}>
    <p className="mb-1 text-xs text-co-text-muted">{t("reports.business.quarter.basis")}</p>
    <p className="mb-1 text-xs text-co-text-muted">{t("reports.business.rush.rule", { quarters: r.minRunQuarters, multiplier: r.multiplier, checks: r.minChecks })}</p>
    <p className="mb-3 text-xs text-co-text-muted">{t(money ? "reports.business.hours.money_note" : "reports.business.hours.gm_note")}</p>
    {dto.quarters === null ? <p className="text-sm text-co-text-muted">{t("reports.business.hours.too_wide")}</p> : <div className="flex flex-col gap-2">
      {[...dto.days].reverse().map((d) => {
        const qs = dto.quarters!.filter((q) => q.date === d.date && ((q.checks ?? 0) > 0 || (q.laborMinutes ?? 0) > 0));
        const un = dto.quartersUnassigned?.find((u) => u.date === d.date);
        const rush = d.rush;
        const hours = hoursFigure(d.labor);
        const rushText = rush === null ? t("reports.business.badge.rebuilding") : rush.state === "not_enough_history" ? t("reports.business.rush.not_enough_history")
          : rush.windows.length ? t("reports.business.rush.count", { n: rush.windows.length }) : t("reports.business.rush.none");
        // The closed row says whether the day's labor is final (the reason travels with the figure).
        const count = hours.kind === "known" ? rushText : `${rushText} · ${t("reports.business.row.hours", { h: figureText(hours, language, { short: true }) })}`;
        return <CollapsibleSection key={d.date} idBase={`biz-hours-${dto.locationId}-${d.date}`} title={formatDateLabel(d.date, language)}
          count={count} badge={<DayBadges day={d} language={language} />}>
          <div className="flex flex-col gap-2 p-1">
            {rush?.state === "ok" ? rush.windows.map((w) => <p key={w.startAt} className="rounded-lg bg-co-gold/20 p-2 text-sm font-semibold text-co-text">
              {t("reports.business.rush.window", { start: formatTime(w.startAt, language), end: formatTime(w.endAt, language), checks: w.checks,
                usual: formatQuantity(w.baselineChecks, language) })}{" · "}<Money cents={w.cents} language={language} /></p>) : null}
            {d.cuts !== "ok" ? <p className="text-xs text-co-warning-text">{t("reports.business.cuts.rebuilding")}</p> : null}
            {hours.kind !== "known" ? <p className="text-xs text-co-warning-text">{t("reports.business.detail.hours")}: {figureText(hours, language)}</p> : null}
            {qs.length === 0 ? <p className="text-sm text-co-text-muted">{t("reports.business.hours.no_activity")}</p>
              : <ul aria-label={t("reports.business.hours.list_aria")}>{qs.map((q) => <QuarterLine key={q.quarterStartAt} q={q} day={d} money={money} language={language} />)}</ul>}
            {un ? <p className="text-xs text-co-text-muted">{t("reports.business.quarter.unassigned")}: {t("reports.business.hours.checks", { n: un.checks })} · <Amount cents={un.toastCents} missing={un.amountMissing} language={language} /></p> : null}
          </div>
        </CollapsibleSection>;
      })}
    </div>}
  </section>;
}

// ── Channels ────────────────────────────────────────────────────────────────────────────────────

export function BusinessChannels({ dto, language }: Props) {
  const t = tFor(language);
  const rebuilding = dto.days.filter((d) => d.cuts !== "ok").length;
  const ezOrders = dto.days.reduce((s, d) => s + d.sales.ezcaterOrders, 0);
  const ezMissing = dto.days.reduce((s, d) => s + d.sales.ezcaterMissing, 0);
  const row = (key: string, label: string, sub: string | null, checks: number, cents: number | null, missing: number | undefined) => <li key={key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-co-border/50 py-2 text-sm">
    <span className="min-w-0 break-words"><span className="font-semibold text-co-text">{label}</span>{sub ? <span className="text-co-text-muted"> · {sub}</span> : null}</span>
    <span className="text-right">{cents === null ? <Dash reason="reports.business.sales.not_captured" language={language} /> : <Amount cents={cents} missing={missing} language={language} />} <span className="text-co-text-muted">· {t("reports.business.hours.checks", { n: checks })}</span></span>
  </li>;
  return <section className={bizCard} aria-label={t("reports.business.tab.channels")}>
    {rebuilding > 0 ? <p className="mb-3 text-xs font-bold text-co-warning-text">{t("reports.business.channels.rebuilding_days", { n: rebuilding })}</p> : null}
    <h3 className="mb-1 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.channels.title")}</h3>
    {dto.channels.included.length === 0 ? <p className="text-sm text-co-text-muted">{t("reports.business.channels.none")}</p>
      : <ul>{dto.channels.included.map((c) => row(`${c.key}|${c.provider ?? ""}`, channelLabel(language, c.key), c.provider ? providerLabel(language, c.provider) : null, c.checks, c.cents, c.amountMissing))}</ul>}
    <h3 className="mb-1 mt-4 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.channels.ezcater")}</h3>
    <ul>{row("ezcater", t("reports.business.channels.ezcater_label"), null, ezOrders, dto.total.sales.coverage === "missing" ? null : dto.total.sales.ezcaterCents, ezMissing)}</ul>
    <h3 className="mb-1 mt-4 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.channels.excluded")}</h3>
    {dto.channels.excluded.length === 0 ? <p className="text-sm text-co-text-muted">{t("reports.business.channels.excluded_none")}</p>
      : <ul>{dto.channels.excluded.map((c) => row(c.key, t(c.key === "gift_card" ? "reports.business.channels.excluded.gift_card" : "reports.business.channels.excluded.ezcater_linked"), null, c.checks, c.cents, c.amountMissing))}</ul>}
  </section>;
}

// ── People ──────────────────────────────────────────────────────────────────────────────────────

export function BusinessPeople({ dto, language }: Props) {
  const t = tFor(language);
  const rebuilding = dto.days.filter((d) => d.cuts !== "ok").length;
  const span = hoursFigure(dto.total.labor);
  const state = dto.total.labor.state;
  return <section className={bizCard} aria-label={t("reports.business.tab.people")}>
    <CollapsibleSection idBase={`biz-people-${dto.locationId}`} title={t("reports.business.people.title")} count={t("reports.business.people.count", { n: dto.people.length })} defaultOpen>
      {!dto.access.personCost ? <p className="mb-2 text-xs text-co-text-muted">{t("reports.business.people.cost_note")}</p> : null}
      {span.kind !== "known" && span.reason ? <p className="mb-2 text-xs font-bold text-co-warning-text">
        {t("reports.business.people.hours_partial")} {t(span.reason)}</p> : null}
      {dto.people.length === 0 ? <p className="text-sm text-co-text-muted">{t("reports.business.people.none")}</p> : <ul>
        {dto.people.map((p) => {
          const ot = minutesFigure(p.otMinutes, state);
          return <li key={`${p.personKey}|${p.source}|${p.payClass}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-co-border/50 py-2 text-sm">
            <span className="min-w-0 break-words"><span className="font-semibold text-co-text">{p.label ?? t("reports.business.people.unnamed")}</span>
              <span className="text-co-text-muted"> · {t(p.payClass === "hourly" ? "reports.business.people.pay.hourly" : "reports.business.people.pay.salaried")}</span></span>
            <span className="flex flex-col items-end text-right">
              <FigureView f={minutesFigure(p.minutes, state)} language={language} compact />
              {p.otMinutes === null ? <span className="text-xs text-co-warning-text">{t("reports.business.people.withheld", { n: p.weeksSuppressed })}</span>
                : p.otMinutes > 0 ? <span className="text-xs text-co-text-muted">{t("reports.business.people.ot", { h: figureValueText(ot, language) ?? "" })}</span> : null}
              {dto.access.personCost && "straightCostCents" in p ? <span className="text-xs text-co-text-muted">{p.straightCostCents === null || p.straightCostCents === undefined
                ? (p.payClass === "hourly" ? t("reports.business.people.cost_withheld") : t("reports.business.people.salaried_cost")) : <>{t("reports.business.people.cost")} <Money cents={p.straightCostCents} language={language} /></>}</span> : null}
            </span>
          </li>;
        })}
      </ul>}
    </CollapsibleSection>
    <div className="mt-3">
      <CollapsibleSection idBase={`biz-servers-${dto.locationId}`} title={t("reports.business.people.servers")} count={t("reports.business.people.count", { n: dto.servers.length })}>
        <p className="mb-2 text-xs text-co-text-muted">{t("reports.business.people.server_note")}</p>
        {rebuilding > 0 ? <p className="mb-2 text-xs font-bold text-co-warning-text">{t("reports.business.channels.rebuilding_days", { n: rebuilding })}</p> : null}
        <ul>{dto.servers.map((s) => <li key={s.key || "none"} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-co-border/50 py-2 text-sm">
          <span className="min-w-0 break-words font-semibold text-co-text">{serverLabel(language, s.key, s.label)}</span>
          <span className="text-right"><Amount cents={s.cents} missing={s.amountMissing} language={language} /> <span className="text-co-text-muted">· {t("reports.business.hours.checks", { n: s.checks })}</span></span>
        </li>)}</ul>
      </CollapsibleSection>
    </div>
  </section>;
}

// ── Compare ─────────────────────────────────────────────────────────────────────────────────────

function ChangeText({ change, language }: { change: CompareChange; language: Language }) {
  const t = tFor(language);
  if (change.kind === "not_comparable") return <span className="text-co-text-muted">{t("reports.business.compare.not_comparable")}</span>;
  const sign = change.value > 0 ? "+" : "";
  return <span className="font-semibold">{change.kind === "pct" ? t("reports.business.compare.pct", { n: `${sign}${change.value}` }) : t("reports.business.compare.points", { n: `${sign}${formatQuantity(change.value, language)}` })}</span>;
}

type Total = BusinessReportDto["total"];
export function BusinessCompare({ dto, previous, language }: Props & { previous: BusinessReportDto | null }) {
  const t = tFor(language);
  const cur = dto.total, prev = previous?.total ?? null;
  // A figure compares only when BOTH periods are shown and whole (figureComparable: known or estimated — never
  // "so far", a sales floor, covered-days-only or a payroll gap). Every cell is the descriptor of its period.
  const missingOf = (d: BusinessReportDto) => d.days.reduce((s, x) => s + salesAmountMissing(x.sales), 0);
  const rows: Array<{ key: string; label: string; fig: (x: Total, d: BusinessReportDto) => Figure; kind: "money" | "points" }> = [
    { key: "sales", label: t("reports.business.card.sales"), fig: (x, d) => salesFigure(x.sales, missingOf(d)), kind: "money" },
    { key: "net", label: t("reports.business.card.net"), fig: (x) => netFigure(x.labor), kind: "money" },
    { key: "hours", label: t("reports.business.card.hours"), fig: (x) => hoursFigure(x.labor), kind: "money" },
    { key: "pure", label: t("reports.business.card.pure_hourly"), fig: (x) => purePctFigure(x.labor), kind: "points" },
    { key: "loaded", label: t("reports.business.card.fully_loaded"), fig: (x) => loadedPctFigure(x.labor), kind: "points" },
  ];
  const none = <Dash reason="reports.business.compare.no_previous" language={language} />;
  const cell = (f: Figure | null): ReactNode => (f === null ? none : <FigureView f={f} language={language} />);
  return <section className={bizCard} aria-label={t("reports.business.tab.compare")}>
    <p className="mb-3 text-sm text-co-text-muted">{t("reports.business.compare.periods", { current: dateRange(dto.range.from, dto.range.to, language),
      previous: previous ? dateRange(previous.range.from, previous.range.to, language) : t("reports.business.compare.no_previous") })}</p>
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const a = r.fig(cur, dto), b = prev && previous ? r.fig(prev, previous) : null;
        const change = compareChange({ value: a.value, complete: figureComparable(a) }, { value: b?.value ?? null, complete: b !== null && figureComparable(b) }, r.kind);
        return <li key={r.key} className="rounded-lg border border-co-border bg-co-surface-inset p-3 text-sm">
          <div className="mb-1 text-xs font-bold tracking-wide text-co-text-muted">{r.label}</div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span><span className="text-co-text-muted">{t("reports.business.compare.this")}: </span><span className="font-semibold">{cell(a)}</span></span>
            <span><span className="text-co-text-muted">{t("reports.business.compare.previous")}: </span><span className="font-semibold">{cell(b)}</span></span>
            <ChangeText change={change} language={language} />
          </div>
        </li>;
      })}
      <li className="rounded-lg border border-co-border bg-co-surface-inset p-3 text-sm">
        <div className="mb-1 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.last_year.label")}</div>
        <p className="text-co-text-muted">{t("reports.business.last_year.no_data_yet")}</p>
      </li>
    </ul>
    <p className="mt-3 text-xs text-co-text-muted">{t("reports.business.compare.rule")}</p>
  </section>;
}
