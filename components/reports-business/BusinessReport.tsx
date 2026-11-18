/**
 * Item 9b: the business report's five tabs for ONE shop, rendered from the VIEW of lib/business-view-shared.ts
 * (the export, lib/report-export-shared.ts business*Rows, projects the same view). Summary rows with drawers
 * (CollapsibleSection, D1-D10), phone-first at 375 px: no tables, lines that wrap.
 *
 * What a viewer gets is decided by the loader, never here: a GM's view carries no cost per person and no
 * labor dollars per 15 minutes (PERSON_COST_MIN / QUARTER_COST_MIN), so this page cannot show them.
 *
 * Fix round 4 (review ITEM9B-r4): THIS FILE NEVER SEES A NUMBER OF THE REPORT. It receives `BusinessReportView`,
 * in which every money, percent, hours and count value is an opaque `Figure`; the only thing it can do with one
 * is hand it to `FigureView` / `FigureLine` / `figureText` (BusinessParts), which write the value with its state,
 * reason and qualifications. It does not import the DTO, a raw amount or a number formatter
 * (tests/business-report-figure-census.test.ts fails by name if it does).
 */
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { channelLabel, providerLabel, serverLabel } from "@/components/reports-hub/SalesParts";
import type { ReactNode } from "react";
import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { figureKindOf, type Figure } from "@/lib/business-figure-shared";
import type { BusinessReportView, CutView, DayView, LaborView, QuarterView, SalesView } from "@/lib/business-view-shared";
import { Card, ChangeText, Dash, EmptyNote, FigureLine, FigureView, LaborShare, bizCard, dateRange, figureReasonText, figureText, figureValueText, tFor } from "./BusinessParts";

type Props = { view: BusinessReportView; language: Language };

/** The labor lines of a day / week / range drawer: pure hourly, then fully loaded, each through the descriptor. */
function LaborLines({ labor, language }: { labor: LaborView; language: Language }) {
  const t = tFor(language);
  return <div className="flex flex-col gap-1">
    <FigureLine language={language} label={t("reports.business.detail.net_sales")} f={labor.net} />
    <FigureLine language={language} label={t("reports.business.detail.hours")} f={labor.hours} />
    <FigureLine language={language} label={t("reports.business.detail.pure_hourly_cost")} f={labor.pureCost} />
    <FigureLine language={language} label={t("reports.business.detail.ot_premium")} f={labor.otPremium} />
    <FigureLine language={language} label={t("reports.business.detail.ot_hours")} f={labor.otHours} />
    <FigureLine language={language} label={t("reports.business.detail.salaried")} f={labor.salaried} />
    <FigureLine language={language} label={t("reports.business.detail.burden")} f={labor.burden} />
    <FigureLine language={language} label={t("reports.business.detail.fully_loaded")} f={labor.loadedCost} />
  </div>;
}

/** The collapsed line of a day / week: every figure with its state, reason and (short) qualifications, so the
 * closed list says everything the open drawer says about whether a number is whole. */
function summaryLine(sales: SalesView, labor: LaborView, language: Language): string {
  const t = tFor(language);
  const short = { short: true };
  return [
    t("reports.business.row.sales", { amount: figureText(sales.total, language, short) }),
    t("reports.business.row.hours", { h: figureText(labor.hours, language, short) }),
    t("reports.business.row.labor_pct", { pct: figureText(labor.purePct, language, short) }),
    t("reports.business.row.loaded_pct", { pct: figureText(labor.loadedPct, language, short) }),
  ].join(" · ");
}

/** "Same days last year": "No data until ..." only while that IS the reason; a year that has data is not shown here yet. */
function lastYearKey(view: BusinessReportView): TranslationKey {
  return view.range.lastYearReason === "no_data_yet" ? "reports.business.last_year.no_data_yet" : "reports.business.last_year.not_shown";
}

function DayBadges({ day, language }: { day: DayView; language: Language }) {
  const t = tFor(language);
  const badge = "rounded-full px-2 py-0.5 text-xs font-bold";
  return <>
    {day.sales.coverage !== "complete" ? <span className={`${badge} bg-co-warning-surface text-co-warning-text`}>{t(`reports.business.coverage.${day.sales.coverage}` as TranslationKey)}</span> : null}
    {day.cuts === "rebuilding" ? <span className={`${badge} bg-co-warning-surface text-co-warning-text`}>{t("reports.business.badge.rebuilding")}</span> : null}
    {day.rush?.any ? <span className={`${badge} bg-co-gold/20 text-co-text`}>{t("reports.business.rush.count", { n: figureValueText(day.rush.count, language) ?? "" })}</span> : null}
    {day.largeChecks.any ? <span className={`${badge} bg-co-gold/20 text-co-text`}>{t("reports.business.badge.large", { n: figureText(day.largeChecks.checks, language) })}</span> : null}
  </>;
}

// ── Overview ────────────────────────────────────────────────────────────────────────────────────

export function BusinessOverview({ view, language }: Props) {
  const t = tFor(language);
  const { total, salesDays, breakdown } = view;
  return <section className={bizCard} aria-label={t("reports.business.tab.overview")}>
    <p className="mb-3 text-sm text-co-text-muted">{dateRange(view.range.from, view.range.to, language)} · {t("reports.business.caption")}</p>
    {salesDays.covered < salesDays.expected ? <p className="mb-3 text-xs font-bold text-co-warning-text">{t("reports.business.coverage.days", salesDays)}</p> : null}
    <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3">
      <Card label={t("reports.business.card.sales")} sub={t("reports.business.card.sales_hint")}><FigureView f={total.sales.total} language={language} /></Card>
      <Card label={t("reports.business.card.net")} sub={total.labor.netState === "ok" ? t("reports.business.card.net_hint") : null}>
        <FigureView f={total.labor.net} language={language} /></Card>
      <Card label={t("reports.business.card.hours")}><FigureView f={total.labor.hours} language={language} /></Card>
      <Card label={t("reports.business.card.pure_hourly")}><LaborShare labor={total.labor} view="pure" target={total.target} language={language} /></Card>
      <Card label={t("reports.business.card.fully_loaded")}><LaborShare labor={total.labor} view="loaded" target={total.loadedTarget} language={language} /></Card>
      <Card label={t("reports.business.card.refunds")} sub={t("reports.business.card.refunds_hint")}><FigureView f={total.sales.refunds} language={language} /></Card>
    </div>
    <p className="mt-3 text-xs text-co-text-muted">{t("reports.business.labor.denominator")}</p>
    <p className="text-xs text-co-text-muted">{t("reports.business.loaded.basis")}</p>
    {total.largeChecks.any ? <p className="mt-1 text-xs font-bold text-co-warning-text">{t("reports.business.large_checks", { count: figureText(total.largeChecks.checks, language), amount: figureText(total.largeChecks.amount, language) })}</p> : null}
    {breakdown.state !== "complete" && breakdown.expected > 0 ? <p className="mt-1 text-xs text-co-text-muted">{t("reports.business.large_checks_partial", { covered: breakdown.included, expected: breakdown.expected })}</p> : null}

    <div className="mt-4 flex flex-col gap-2">
      <CollapsibleSection idBase={`biz-weeks-${view.locationId}`} title={t("reports.business.weeks")} count={t("reports.business.count_weeks", { n: view.weeks.length })} defaultOpen>
        <div className="flex flex-col gap-2">
          {view.weeks.map((w) => <CollapsibleSection key={w.weekStart} idBase={`biz-week-${view.locationId}-${w.weekStart}`}
            title={t("reports.business.week_of", { range: dateRange(w.from, w.to, language) })} count={summaryLine(w.sales, w.labor, language)}>
            <div className="flex flex-col gap-2 p-1">
              <div className="flex flex-wrap gap-4"><LaborShare labor={w.labor} view="pure" target={w.target} language={language} /><LaborShare labor={w.labor} view="loaded" target={w.loadedTarget} language={language} /></div>
              <LaborLines labor={w.labor} language={language} />
            </div>
          </CollapsibleSection>)}
        </div>
      </CollapsibleSection>
      <CollapsibleSection idBase={`biz-days-${view.locationId}`} title={t("reports.business.days")} count={t("reports.business.count_days", { n: view.days.length })}>
        <div className="flex flex-col gap-2">
          {[...view.days].reverse().map((d) => <CollapsibleSection key={d.date} idBase={`biz-day-${view.locationId}-${d.date}`}
            title={formatDateLabel(d.date, language)} count={summaryLine(d.sales, d.labor, language)} badge={<DayBadges day={d} language={language} />}>
            <div className="flex flex-col gap-2 p-1">
              <FigureLine language={language} label={t("reports.business.detail.sales")} f={d.sales.total} />
              <FigureLine language={language} label={t("reports.business.detail.checks")} f={d.sales.checks} />
              <FigureLine language={language} label={t("reports.business.detail.toast_net")} f={d.sales.toastNet} />
              <FigureLine language={language} label={t("reports.business.detail.ezcater")} f={d.sales.ezcater} />
              <div className="flex flex-wrap gap-4"><LaborShare labor={d.labor} view="pure" target={d.target} language={language} />
                <LaborShare labor={d.labor} view="loaded" target={d.loadedTarget} language={language} /></div>
              <LaborLines labor={d.labor} language={language} />
              {d.cuts === "rebuilding" ? <p className="text-xs text-co-warning-text">{t("reports.business.cuts.rebuilding")}</p> : null}
            </div>
          </CollapsibleSection>)}
        </div>
      </CollapsibleSection>
      <p className="text-xs text-co-text-muted">{t("reports.business.last_year.label")}: {t(lastYearKey(view))}</p>
    </div>
  </section>;
}

// ── Hours (15-minute grid, rushes) ──────────────────────────────────────────────────────────────

/** One 15 minutes. Its labor is judged against the DAY's labor state (fix round 3): no minutes is "No labor"
 * only when the day's hours are final; otherwise a dash with the day's reason, and minutes are "so far". */
function QuarterLine({ q, language }: { q: QuarterView; language: Language }) {
  return <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-co-border/50 py-2 text-sm">
    <span className="min-w-[4.5rem] font-bold text-co-text">{formatTime(q.quarterStartAt, language)}</span>
    <span><FigureView f={q.checks} language={language} compact /></span>
    <span><FigureView f={q.sales} language={language} compact /></span>
    <span className="text-co-text-muted"><FigureView f={q.hours} language={language} compact /></span>
    {q.cost && q.pct ? <span className="inline-flex gap-1 text-co-text-muted"><FigureView f={q.cost} language={language} compact />
      {" · "}<FigureView f={q.pct} language={language} compact /></span> : null}
  </li>;
}

export function BusinessHours({ view, language }: Props) {
  const t = tFor(language);
  const r = view.rushRule;
  const money = view.access.quarterCost;
  return <section className={bizCard} aria-label={t("reports.business.tab.hours")}>
    <p className="mb-1 text-xs text-co-text-muted">{t("reports.business.quarter.basis")}</p>
    <p className="mb-1 text-xs text-co-text-muted">{t("reports.business.rush.rule", { quarters: r.minRunQuarters, multiplier: r.multiplier, checks: r.minChecks })}</p>
    <p className="mb-3 text-xs text-co-text-muted">{t(money ? "reports.business.hours.money_note" : "reports.business.hours.gm_note")}</p>
    {view.quarters === null ? <p className="text-sm text-co-text-muted">{t("reports.business.hours.too_wide")}</p> : <div className="flex flex-col gap-2">
      {[...view.days].reverse().map((d) => {
        const rush = d.rush;
        const hours = d.labor.hours;
        const final = figureKindOf(hours) === "known";
        // Fix round 7: "No rushes" is a claim (rush.none: every 15 minutes that could be one was compared); a
        // breakdown that is not shown names its own reason (no sales captured is not "rebuilding").
        const rushText = rush === null ? t(d.sales.coverage !== "complete" ? `reports.business.coverage.${d.sales.coverage}` as TranslationKey : "reports.business.badge.rebuilding")
          : rush.state === "not_enough_history" ? t("reports.business.rush.not_enough_history")
          : [rush.any ? t("reports.business.rush.count", { n: figureValueText(rush.count, language) ?? "" }) : rush.none ? t("reports.business.rush.none") : null,
            figureReasonText(rush.count, language)].filter((x) => x !== null).join(" · ");
        // The closed row says whether the day's labor is final (the reason travels with the figure).
        const count = final ? rushText : `${rushText} · ${t("reports.business.row.hours", { h: figureText(hours, language, { short: true }) })}`;
        return <CollapsibleSection key={d.date} idBase={`biz-hours-${view.locationId}-${d.date}`} title={formatDateLabel(d.date, language)}
          count={count} badge={<DayBadges day={d} language={language} />}>
          <div className="flex flex-col gap-2 p-1">
            {rush?.state === "ok" ? rush.windows.map((w) => <p key={w.startAt} className="rounded-lg bg-co-gold/20 p-2 text-sm font-semibold text-co-text">
              {t("reports.business.rush.window", { start: formatTime(w.startAt, language), end: formatTime(w.endAt, language), checks: figureText(w.checks, language),
                usual: figureText(w.usual, language) })}{" · "}{figureText(w.sales, language)}</p>) : null}
            {d.cutsReason !== null ? <p className="text-xs text-co-warning-text">{t(d.cutsReason)}</p> : null}
            {!final ? <p className="text-xs text-co-warning-text">{t("reports.business.detail.hours")}: {figureText(hours, language)}</p> : null}
            {d.activity !== null ? <EmptyNote claim={d.activity} language={language}
              none={d.unassigned ? "reports.business.hours.no_timed_activity" : "reports.business.hours.no_activity"} />
              : <ul aria-label={t("reports.business.hours.list_aria")}>{d.quarters.map((q) => <QuarterLine key={q.quarterStartAt} q={q} language={language} />)}</ul>}
            {d.unassigned ? <p className="text-xs text-co-text-muted">{t("reports.business.quarter.unassigned")}: {figureText(d.unassigned.checks, language)} · {figureText(d.unassigned.sales, language)}</p> : null}
          </div>
        </CollapsibleSection>;
      })}
    </div>}
  </section>;
}

// ── Channels ────────────────────────────────────────────────────────────────────────────────────

/** One line of a breakdown list: the amount through the formatter, then its count (which rides on the amount: an
 * unknown amount already shows the dash and the reason for the whole line). */
function CutLine({ label, sub, sales, checks, language }: { label: string; sub?: string | null; sales: Figure; checks: Figure; language: Language }) {
  const n = figureValueText(checks, language);
  return <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-co-border/50 py-2 text-sm">
    <span className="min-w-0 break-words"><span className="font-semibold text-co-text">{label}</span>{sub ? <span className="text-co-text-muted"> · {sub}</span> : null}</span>
    <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1 text-right"><FigureView f={sales} language={language} compact />{n !== null ? <span className="text-co-text-muted">· {n}</span> : null}</span>
  </li>;
}

export function BusinessChannels({ view, language }: Props) {
  const t = tFor(language);
  const notice = view.breakdownNotice;
  const line = (c: CutView, label: string, sub: string | null) => <CutLine key={`${c.key}|${c.provider ?? ""}`} label={label} sub={sub} sales={c.sales} checks={c.checks} language={language} />;
  return <section className={bizCard} aria-label={t("reports.business.tab.channels")}>
    {notice ? <p className="mb-3 text-xs font-bold text-co-warning-text">{t(notice.key, notice.values)}</p> : null}
    <h3 className="mb-1 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.channels.title")}</h3>
    {view.empty.channels !== null ? <EmptyNote claim={view.empty.channels} none="reports.business.channels.none_verified" language={language} />
      : <ul>{view.channels.included.map((c) => line(c, channelLabel(language, c.key), c.provider ? providerLabel(language, c.provider) : null))}</ul>}
    <h3 className="mb-1 mt-4 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.channels.ezcater")}</h3>
    <ul><CutLine label={t("reports.business.channels.ezcater_label")} sales={view.channels.ezcater.sales} checks={view.channels.ezcater.orders} language={language} /></ul>
    <h3 className="mb-1 mt-4 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.channels.excluded")}</h3>
    {view.empty.excluded !== null ? <EmptyNote claim={view.empty.excluded} none="reports.business.channels.excluded_none" language={language} />
      : <ul>{view.channels.excluded.map((c) => line(c, t(c.key === "gift_card" ? "reports.business.channels.excluded.gift_card" : "reports.business.channels.excluded.ezcater_linked"), null))}</ul>}
  </section>;
}

// ── People ──────────────────────────────────────────────────────────────────────────────────────

export function BusinessPeople({ view, language }: Props) {
  const t = tFor(language);
  const notice = view.breakdownNotice;
  const span = view.total.labor.hours;
  const spanReason = figureReasonText(span, language);
  // Fix round 7: "0 people" in a closed header is a claim too: a dash when the empty list is not known to be empty.
  const listCount = (n: number, claim: BusinessReportView["empty"]["people"]) => (claim?.kind === "unknown" ? "—" : t("reports.business.people.count", { n }));
  return <section className={bizCard} aria-label={t("reports.business.tab.people")}>
    <CollapsibleSection idBase={`biz-people-${view.locationId}`} title={t("reports.business.people.title")} count={listCount(view.people.length, view.empty.people)} defaultOpen>
      {!view.access.personCost ? <p className="mb-2 text-xs text-co-text-muted">{t("reports.business.people.cost_note")}</p> : null}
      {figureKindOf(span) !== "known" && spanReason ? <p className="mb-2 text-xs font-bold text-co-warning-text">
        {t("reports.business.people.hours_partial")} {spanReason}</p> : null}
      {view.empty.people !== null ? <EmptyNote claim={view.empty.people} none="reports.business.people.none" language={language} /> : <ul>
        {view.people.map((p) => <li key={p.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-co-border/50 py-2 text-sm">
          <span className="min-w-0 break-words"><span className="font-semibold text-co-text">{p.label ?? t("reports.business.people.unnamed")}</span>
            <span className="text-co-text-muted"> · {t(p.payClass === "hourly" ? "reports.business.people.pay.hourly" : "reports.business.people.pay.salaried")}</span></span>
          <span className="flex flex-col items-end text-right">
            <FigureView f={p.hours} language={language} compact />
            {p.overtime === null ? <span className="text-xs text-co-warning-text">{t("reports.business.people.withheld", { n: p.weeksWithheld })}</span>
              : p.overtimeAny ? <span className="text-xs text-co-text-muted">{t("reports.business.people.ot", { h: figureValueText(p.overtime, language) ?? "" })}</span> : null}
            {/* Fix round 4 (ITEM9B-r4 P2): the cost is a figure like the hours above it: "so far" with its reason, a wage estimate named. */}
            {p.cost ? <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1 text-xs text-co-text-muted">
              {figureKindOf(p.cost) === "unknown" ? null : <span>{t("reports.business.people.cost")}</span>}<FigureView f={p.cost} language={language} compact reason="always" /></span> : null}
          </span>
        </li>)}
      </ul>}
    </CollapsibleSection>
    <div className="mt-3">
      <CollapsibleSection idBase={`biz-servers-${view.locationId}`} title={t("reports.business.people.servers")} count={listCount(view.servers.length, view.empty.servers)}>
        <p className="mb-2 text-xs text-co-text-muted">{t("reports.business.people.server_note")}</p>
        {notice ? <p className="mb-2 text-xs font-bold text-co-warning-text">{t(notice.key, notice.values)}</p> : null}
        {view.empty.servers !== null ? <EmptyNote claim={view.empty.servers} none="reports.business.people.servers_none" language={language} />
          : <ul>{view.servers.map((s) => <CutLine key={s.key || "none"} label={serverLabel(language, s.key, s.label)} sales={s.sales} checks={s.checks} language={language} />)}</ul>}
      </CollapsibleSection>
    </div>
  </section>;
}

// ── Compare ─────────────────────────────────────────────────────────────────────────────────────

type Total = BusinessReportView["total"];
export function BusinessCompare({ view, previous, language }: Props & { previous: BusinessReportView | null }) {
  const t = tFor(language);
  const cur = view.total, prev = previous?.total ?? null;
  // A figure compares only when BOTH periods are shown and whole (figureChange: known or estimated, never
  // "so far", a sales floor, covered-days-only or a payroll gap). Every cell is the descriptor of its period.
  const rows: Array<{ key: string; label: string; fig: (x: Total) => Figure }> = [
    { key: "sales", label: t("reports.business.card.sales"), fig: (x) => x.sales.total },
    { key: "net", label: t("reports.business.card.net"), fig: (x) => x.labor.net },
    { key: "hours", label: t("reports.business.card.hours"), fig: (x) => x.labor.hours },
    { key: "pure", label: t("reports.business.card.pure_hourly"), fig: (x) => x.labor.purePct },
    { key: "loaded", label: t("reports.business.card.fully_loaded"), fig: (x) => x.labor.loadedPct },
  ];
  const none = <Dash reason="reports.business.compare.no_previous" language={language} />;
  const cell = (f: Figure | null): ReactNode => (f === null ? none : <FigureView f={f} language={language} />);
  return <section className={bizCard} aria-label={t("reports.business.tab.compare")}>
    <p className="mb-3 text-sm text-co-text-muted">{t("reports.business.compare.periods", { current: dateRange(view.range.from, view.range.to, language),
      previous: previous ? dateRange(previous.range.from, previous.range.to, language) : t("reports.business.compare.no_previous") })}</p>
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const a = r.fig(cur), b = prev ? r.fig(prev) : null;
        return <li key={r.key} className="rounded-lg border border-co-border bg-co-surface-inset p-3 text-sm">
          <div className="mb-1 text-xs font-bold tracking-wide text-co-text-muted">{r.label}</div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span><span className="text-co-text-muted">{t("reports.business.compare.this")}: </span><span className="font-semibold">{cell(a)}</span></span>
            <span><span className="text-co-text-muted">{t("reports.business.compare.previous")}: </span><span className="font-semibold">{cell(b)}</span></span>
            <ChangeText cur={a} prev={b} language={language} />
          </div>
        </li>;
      })}
      <li className="rounded-lg border border-co-border bg-co-surface-inset p-3 text-sm">
        <div className="mb-1 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.last_year.label")}</div>
        <p className="text-co-text-muted">{t(lastYearKey(view))}</p>
      </li>
    </ul>
    <p className="mt-3 text-xs text-co-text-muted">{t("reports.business.compare.rule")}</p>
  </section>;
}
