/**
 * Item 9b: the business report's five tabs for ONE shop, rendered from the DTO of lib/business-report.ts (the
 * export, lib/report-export-shared.ts business*Rows, projects the same DTO). Summary rows with drawers
 * (CollapsibleSection, D1-D10), phone-first at 375 px: no tables, lines that wrap.
 *
 * What a viewer gets is decided by the loader, never here: a GM's DTO carries no cost per person and no
 * labor dollars per 15 minutes (PERSON_COST_MIN / QUARTER_COST_MIN), so this page cannot show them.
 */
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { channelLabel, providerLabel, serverLabel } from "@/components/reports-hub/SalesParts";
import type { ReactNode } from "react";
import { formatCents, formatDateLabel, formatQuantity, formatTime } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { BusinessDayDto, BusinessQuarterDto, BusinessReportDto } from "@/lib/business-report";
import { compareChange, laborReasonKey, loadedReasonKey, type CompareChange, type LaborFigures } from "@/lib/business-report-shared";
import { Card, Dash, LaborPct, Line, Money, bizCard, dateRange, hoursText, pctText, tFor } from "./BusinessParts";

type Props = { dto: BusinessReportDto; language: Language };

/** The labor lines of a day / week / range drawer: pure hourly, then fully loaded, each with its reason. */
function LaborLines({ labor, language }: { labor: LaborFigures; language: Language }) {
  const t = tFor(language);
  const pureReason = laborReasonKey(labor.state);
  const loadedReason = loadedReasonKey(labor.loadedState);
  return <div className="flex flex-col gap-1">
    <Line language={language} label={t("reports.business.detail.net_sales")} value={labor.denominator.cents === null ? null : <Money cents={labor.denominator.cents} language={language} />}
      reason={labor.denominator.state === "ok" ? null : `reports.business.labor.state.${labor.denominator.state}`} />
    <Line language={language} label={t("reports.business.detail.hours")} value={hoursText(labor.minutes, language)} reason={pureReason} />
    <Line language={language} label={t("reports.business.detail.pure_hourly_cost")} value={labor.pureHourlyCents === null ? null : <Money cents={labor.pureHourlyCents} language={language} />} reason={pureReason} />
    <Line language={language} label={t("reports.business.detail.ot_premium")} value={labor.otPremiumCents === null ? null : <Money cents={labor.otPremiumCents} language={language} />} reason={pureReason} />
    <Line language={language} label={t("reports.business.detail.ot_hours")} value={hoursText(labor.otMinutes, language)} reason={pureReason} />
    <Line language={language} label={t("reports.business.detail.salaried")} value={labor.salariedCents === null ? null : <Money cents={labor.salariedCents} language={language} />} reason={loadedReason} />
    <Line language={language} label={t("reports.business.detail.burden")} value={labor.burdenCents === null ? null : <Money cents={labor.burdenCents} language={language} />} reason={loadedReason} />
    <Line language={language} label={t("reports.business.detail.fully_loaded")} value={labor.fullyLoadedCents === null ? null : <Money cents={labor.fullyLoadedCents} language={language} />} reason={loadedReason} />
    {labor.fullyLoadedCents !== null && labor.burdenEstimated ? <p className="text-xs text-co-warning-text">{t("reports.business.burden_estimated")}</p> : null}
    {labor.fullyLoadedCents !== null && labor.salaryEstimated ? <p className="text-xs text-co-text-muted">{t("reports.business.salary_estimated")}</p> : null}
    {labor.salaryGaps > 0 ? <p className="text-xs text-co-warning-text">{t("reports.business.salary_gaps", { n: labor.salaryGaps })}</p> : null}
  </div>;
}

/** The collapsed line of a day / week: its figures in words, so the closed list still reads. */
function summaryLine(salesCents: number | null, labor: LaborFigures, language: Language): string {
  const t = tFor(language);
  const dash = "—";
  return [
    salesCents === null ? dash : t("reports.business.row.sales", { amount: formatCents(salesCents, language) }),
    t("reports.business.row.labor_pct", { pct: pctText(labor.pct, language) ?? dash }),
    t("reports.business.row.loaded_pct", { pct: pctText(labor.loadedPct, language) ?? dash }),
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

// ── Overview ────────────────────────────────────────────────────────────────────────────────────

export function BusinessOverview({ dto, language }: Props) {
  const t = tFor(language);
  const { total } = dto;
  const covered = dto.days.filter((d) => d.sales.coverage === "complete").length;
  return <section className={bizCard} aria-label={t("reports.business.tab.overview")}>
    <p className="mb-3 text-sm text-co-text-muted">{dateRange(dto.range.from, dto.range.to, language)} · {t("reports.business.caption")}</p>
    {covered < dto.days.length ? <p className="mb-3 text-xs font-bold text-co-warning-text">{t("reports.business.coverage.days", { covered, expected: dto.days.length })}</p> : null}
    <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3">
      <Card label={t("reports.business.card.sales")} sub={t("reports.business.card.sales_hint")}><Money cents={total.sales.coverage === "missing" ? null : total.sales.totalCents} language={language} /></Card>
      <Card label={t("reports.business.card.net")} sub={total.labor.denominator.state === "ok" ? t("reports.business.card.net_hint") : t(`reports.business.labor.state.${total.labor.denominator.state}`)}>
        <Money cents={total.labor.denominator.cents} language={language} /></Card>
      <Card label={t("reports.business.card.hours")}>{hoursText(total.labor.minutes, language) ?? <Dash reason={laborReasonKey(total.labor.state)} language={language} />}</Card>
      <Card label={t("reports.business.card.pure_hourly")}><LaborPct figures={total.labor} view="pure" target={total.target} language={language} /></Card>
      <Card label={t("reports.business.card.fully_loaded")} sub={total.labor.fullyLoadedCents !== null && total.labor.burdenEstimated ? t("reports.business.burden_estimated") : null}>
        <LaborPct figures={total.labor} view="loaded" target={total.loadedTarget} language={language} /></Card>
      <Card label={t("reports.business.card.refunds")} sub={t("reports.business.card.refunds_hint")}><Money cents={total.sales.coverage === "missing" ? null : total.sales.refundCents} language={language} /></Card>
    </div>
    <p className="mt-3 text-xs text-co-text-muted">{t("reports.business.labor.denominator")}</p>
    <p className="text-xs text-co-text-muted">{t("reports.business.loaded.basis")}</p>
    {dto.largeChecks.checks > 0 ? <p className="mt-1 text-xs font-bold text-co-warning-text">{t("reports.business.large_checks", { count: dto.largeChecks.checks, amount: formatCents(dto.largeChecks.cents, language) })}</p> : null}

    <div className="mt-4 flex flex-col gap-2">
      <CollapsibleSection idBase={`biz-weeks-${dto.locationId}`} title={t("reports.business.weeks")} count={t("reports.business.count_weeks", { n: dto.weeks.length })} defaultOpen>
        <div className="flex flex-col gap-2">
          {dto.weeks.map((w) => {
            const days = dto.days.filter((d) => d.date >= w.from && d.date <= w.to);
            const sales = days.every((d) => d.sales.coverage === "missing") ? null : days.reduce((s, d) => s + d.sales.totalCents, 0);
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
            title={formatDateLabel(d.date, language)} count={summaryLine(d.sales.coverage === "missing" ? null : d.sales.totalCents, d.labor, language)} badge={<DayBadges day={d} language={language} />}>
            <div className="flex flex-col gap-2 p-1">
              <Line language={language} label={t("reports.business.detail.sales")} value={d.sales.coverage === "missing" ? null : <Money cents={d.sales.totalCents} language={language} />} reason="reports.business.labor.state.sales_not_covered" />
              <Line language={language} label={t("reports.business.detail.checks")} value={d.sales.coverage === "missing" ? null : String(d.sales.checks)} reason="reports.business.labor.state.sales_not_covered" />
              <Line language={language} label={t("reports.business.detail.toast_net")} value={d.sales.toastNetCents === null ? null : <Money cents={d.sales.toastNetCents} language={language} />} reason="reports.business.labor.state.net_unknown" />
              <Line language={language} label={t("reports.business.detail.ezcater")} value={<Money cents={d.sales.ezcaterCents} language={language} />} />
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

function QuarterLine({ q, money, language }: { q: BusinessQuarterDto; money: boolean; language: Language }) {
  const t = tFor(language);
  return <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-co-border/50 py-2 text-sm">
    <span className="min-w-[4.5rem] font-bold text-co-text">{formatTime(q.quarterStartAt, language)}</span>
    <span>{q.checks === null ? <Dash reason="reports.business.cuts.rebuilding" language={language} /> : t("reports.business.hours.checks", { n: q.checks })}</span>
    <span>{q.toastCents === null ? <Dash reason="reports.business.cuts.rebuilding" language={language} /> : <Money cents={q.toastCents} language={language} />}</span>
    <span className="text-co-text-muted">{hoursText(q.laborMinutes, language) ?? t("reports.business.hours.no_labor")}</span>
    {money ? <span className="text-co-text-muted">{q.straightCents === null || q.straightCents === undefined ? <Dash reason="reports.business.labor.state.rebuilding" language={language} /> : <Money cents={q.straightCents} language={language} />}
      {" · "}{pctText(q.pct ?? null, language) ?? <Dash reason="reports.business.hours.no_pct" language={language} />}</span> : null}
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
        return <CollapsibleSection key={d.date} idBase={`biz-hours-${dto.locationId}-${d.date}`} title={formatDateLabel(d.date, language)}
          count={rush === null ? t("reports.business.badge.rebuilding") : rush.state === "not_enough_history" ? t("reports.business.rush.not_enough_history")
            : rush.windows.length ? t("reports.business.rush.count", { n: rush.windows.length }) : t("reports.business.rush.none")}
          badge={<DayBadges day={d} language={language} />}>
          <div className="flex flex-col gap-2 p-1">
            {rush?.state === "ok" ? rush.windows.map((w) => <p key={w.startAt} className="rounded-lg bg-co-gold/20 p-2 text-sm font-semibold text-co-text">
              {t("reports.business.rush.window", { start: formatTime(w.startAt, language), end: formatTime(w.endAt, language), checks: w.checks,
                usual: formatQuantity(w.baselineChecks, language) })}{" · "}<Money cents={w.cents} language={language} /></p>) : null}
            {d.cuts !== "ok" ? <p className="text-xs text-co-warning-text">{t("reports.business.cuts.rebuilding")}</p> : null}
            {qs.length === 0 ? <p className="text-sm text-co-text-muted">{t("reports.business.hours.no_activity")}</p>
              : <ul aria-label={t("reports.business.hours.list_aria")}>{qs.map((q) => <QuarterLine key={q.quarterStartAt} q={q} money={money} language={language} />)}</ul>}
            {un ? <p className="text-xs text-co-text-muted">{t("reports.business.quarter.unassigned")}: {t("reports.business.hours.checks", { n: un.checks })} · <Money cents={un.toastCents} language={language} /></p> : null}
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
  const row = (key: string, label: string, sub: string | null, checks: number, cents: number) => <li key={key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-co-border/50 py-2 text-sm">
    <span className="min-w-0 break-words"><span className="font-semibold text-co-text">{label}</span>{sub ? <span className="text-co-text-muted"> · {sub}</span> : null}</span>
    <span className="text-right"><Money cents={cents} language={language} /> <span className="text-co-text-muted">· {t("reports.business.hours.checks", { n: checks })}</span></span>
  </li>;
  return <section className={bizCard} aria-label={t("reports.business.tab.channels")}>
    {rebuilding > 0 ? <p className="mb-3 text-xs font-bold text-co-warning-text">{t("reports.business.channels.rebuilding_days", { n: rebuilding })}</p> : null}
    <h3 className="mb-1 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.channels.title")}</h3>
    {dto.channels.included.length === 0 ? <p className="text-sm text-co-text-muted">{t("reports.business.channels.none")}</p>
      : <ul>{dto.channels.included.map((c) => row(`${c.key}|${c.provider ?? ""}`, channelLabel(language, c.key), c.provider ? providerLabel(language, c.provider) : null, c.checks, c.cents))}</ul>}
    <h3 className="mb-1 mt-4 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.channels.ezcater")}</h3>
    <ul>{row("ezcater", t("reports.business.channels.ezcater_label"), null, ezOrders, dto.total.sales.ezcaterCents)}</ul>
    <h3 className="mb-1 mt-4 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.channels.excluded")}</h3>
    {dto.channels.excluded.length === 0 ? <p className="text-sm text-co-text-muted">{t("reports.business.channels.excluded_none")}</p>
      : <ul>{dto.channels.excluded.map((c) => row(c.key, t(c.key === "gift_card" ? "reports.business.channels.excluded.gift_card" : "reports.business.channels.excluded.ezcater_linked"), null, c.checks, c.cents))}</ul>}
  </section>;
}

// ── People ──────────────────────────────────────────────────────────────────────────────────────

export function BusinessPeople({ dto, language }: Props) {
  const t = tFor(language);
  const rebuilding = dto.days.filter((d) => d.cuts !== "ok").length;
  return <section className={bizCard} aria-label={t("reports.business.tab.people")}>
    <CollapsibleSection idBase={`biz-people-${dto.locationId}`} title={t("reports.business.people.title")} count={t("reports.business.people.count", { n: dto.people.length })} defaultOpen>
      {!dto.access.personCost ? <p className="mb-2 text-xs text-co-text-muted">{t("reports.business.people.cost_note")}</p> : null}
      {dto.people.length === 0 ? <p className="text-sm text-co-text-muted">{t("reports.business.people.none")}</p> : <ul>
        {dto.people.map((p) => <li key={`${p.personKey}|${p.source}|${p.payClass}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-co-border/50 py-2 text-sm">
          <span className="min-w-0 break-words"><span className="font-semibold text-co-text">{p.label ?? t("reports.business.people.unnamed")}</span>
            <span className="text-co-text-muted"> · {t(p.payClass === "hourly" ? "reports.business.people.pay.hourly" : "reports.business.people.pay.salaried")}</span></span>
          <span className="flex flex-col items-end text-right">
            <span>{hoursText(p.minutes, language)}</span>
            {p.otMinutes === null ? <span className="text-xs text-co-warning-text">{t("reports.business.people.withheld", { n: p.weeksSuppressed })}</span>
              : p.otMinutes > 0 ? <span className="text-xs text-co-text-muted">{t("reports.business.people.ot", { h: hoursText(p.otMinutes, language) ?? "" })}</span> : null}
            {dto.access.personCost && "straightCostCents" in p ? <span className="text-xs text-co-text-muted">{p.straightCostCents === null || p.straightCostCents === undefined
              ? (p.payClass === "hourly" ? t("reports.business.people.cost_withheld") : t("reports.business.people.salaried_cost")) : <>{t("reports.business.people.cost")} <Money cents={p.straightCostCents} language={language} /></>}</span> : null}
          </span>
        </li>)}
      </ul>}
    </CollapsibleSection>
    <div className="mt-3">
      <CollapsibleSection idBase={`biz-servers-${dto.locationId}`} title={t("reports.business.people.servers")} count={t("reports.business.people.count", { n: dto.servers.length })}>
        <p className="mb-2 text-xs text-co-text-muted">{t("reports.business.people.server_note")}</p>
        {rebuilding > 0 ? <p className="mb-2 text-xs font-bold text-co-warning-text">{t("reports.business.channels.rebuilding_days", { n: rebuilding })}</p> : null}
        <ul>{dto.servers.map((s) => <li key={s.key || "none"} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-co-border/50 py-2 text-sm">
          <span className="min-w-0 break-words font-semibold text-co-text">{serverLabel(language, s.key, s.label)}</span>
          <span className="text-right"><Money cents={s.cents} language={language} /> <span className="text-co-text-muted">· {t("reports.business.hours.checks", { n: s.checks })}</span></span>
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

export function BusinessCompare({ dto, previous, language }: Props & { previous: BusinessReportDto | null }) {
  const t = tFor(language);
  const cur = dto.total, prev = previous?.total ?? null;
  const done = (x: BusinessReportDto["total"] | null) => x !== null && x.sales.coverage === "complete";
  const rows: Array<{ key: string; label: string; a: ReactNode; b: ReactNode; change: CompareChange }> = [
    { key: "sales", label: t("reports.business.card.sales"), a: <Money cents={cur.sales.totalCents} language={language} />, b: prev ? <Money cents={prev.sales.totalCents} language={language} /> : <Dash language={language} />,
      change: compareChange({ value: cur.sales.totalCents, complete: done(cur) }, { value: prev?.sales.totalCents ?? null, complete: done(prev) }, "money") },
    { key: "net", label: t("reports.business.card.net"), a: <Money cents={cur.labor.denominator.cents} language={language} />, b: <Money cents={prev?.labor.denominator.cents ?? null} language={language} />,
      change: compareChange({ value: cur.labor.denominator.cents, complete: true }, { value: prev?.labor.denominator.cents ?? null, complete: true }, "money") },
    { key: "hours", label: t("reports.business.card.hours"), a: hoursText(cur.labor.minutes, language) ?? <Dash language={language} />, b: hoursText(prev?.labor.minutes, language) ?? <Dash language={language} />,
      change: compareChange({ value: cur.labor.minutes, complete: cur.labor.state !== "hours_unknown" }, { value: prev?.labor.minutes ?? null, complete: !!prev && prev.labor.state !== "hours_unknown" }, "money") },
    { key: "pure", label: t("reports.business.card.pure_hourly"), a: pctText(cur.labor.pct, language) ?? <Dash reason={laborReasonKey(cur.labor.state)} language={language} />,
      b: pctText(prev?.labor.pct ?? null, language) ?? <Dash reason={prev ? laborReasonKey(prev.labor.state) : null} language={language} />,
      change: compareChange({ value: cur.labor.pct, complete: true }, { value: prev?.labor.pct ?? null, complete: true }, "points") },
    { key: "loaded", label: t("reports.business.card.fully_loaded"), a: pctText(cur.labor.loadedPct, language) ?? <Dash reason={loadedReasonKey(cur.labor.loadedState)} language={language} />,
      b: pctText(prev?.labor.loadedPct ?? null, language) ?? <Dash reason={prev ? loadedReasonKey(prev.labor.loadedState) : null} language={language} />,
      change: compareChange({ value: cur.labor.loadedPct, complete: true }, { value: prev?.labor.loadedPct ?? null, complete: true }, "points") },
  ];
  return <section className={bizCard} aria-label={t("reports.business.tab.compare")}>
    <p className="mb-3 text-sm text-co-text-muted">{t("reports.business.compare.periods", { current: dateRange(dto.range.from, dto.range.to, language),
      previous: previous ? dateRange(previous.range.from, previous.range.to, language) : "—" })}</p>
    <ul className="flex flex-col gap-2">
      {rows.map((r) => <li key={r.key} className="rounded-lg border border-co-border bg-co-surface-inset p-3 text-sm">
        <div className="mb-1 text-xs font-bold tracking-wide text-co-text-muted">{r.label}</div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span><span className="text-co-text-muted">{t("reports.business.compare.this")}: </span><span className="font-semibold">{r.a}</span></span>
          <span><span className="text-co-text-muted">{t("reports.business.compare.previous")}: </span><span className="font-semibold">{r.b}</span></span>
          <ChangeText change={r.change} language={language} />
        </div>
      </li>)}
      <li className="rounded-lg border border-co-border bg-co-surface-inset p-3 text-sm">
        <div className="mb-1 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.last_year.label")}</div>
        <p className="text-co-text-muted">{t("reports.business.last_year.no_data_yet")}</p>
      </li>
    </ul>
    <p className="mt-3 text-xs text-co-text-muted">{t("reports.business.compare.rule")}</p>
  </section>;
}
