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
 * is hand it to `FigureView` / `FigureLine` / `Labeled` / `figureText` (BusinessParts), which write the value with
 * its state, reason and qualifications. It does not import the DTO, a raw amount or a number formatter
 * (tests/business-report-figure-census.test.ts fails by name if it does).
 *
 * Polish (2026-11-18), presentation only: every figure has a visible LABEL, and each qualification is written
 * ONCE per scope (a card grid, a list, a drawer) in a legend, with a mark on every figure it qualifies
 * (`legendFor` / `LegendNotes`; tests/business-report-polish.test.tsx). The 15-minute list is hours that open.
 */
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { channelLabel, providerLabel, serverLabel } from "@/components/reports-hub/SalesParts";
import type { ReactNode } from "react";
import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { FigureLegend } from "@/lib/business-figure-format";
import { figureKindOf, type Figure } from "@/lib/business-figure-shared";
import type { BusinessReportView, CutView, DayView, HourView, LaborView, QuarterView, SalesView } from "@/lib/business-view-shared";
import { Card, ChangeText, Dash, EmptyNote, FigureLine, FigureView, Labeled, LaborShare, LegendNotes, bizCard, dateRange, figureReasonText, figureText, figureWhyText, legendFor, shareTone, tFor, targetLine } from "./BusinessParts";
import { HourDisclosure } from "./HourDisclosure";

type Props = { view: BusinessReportView; language: Language };
type Target = number | "target_varies";

/** Every labor figure a drawer shows (the scope of its legend). */
const laborFigures = (l: LaborView): Figure[] => [l.net, l.hours, l.pureCost, l.purePct, l.otPremium, l.otHours, l.salaried, l.burden, l.loadedCost, l.loadedPct];
/** The figures of a closed day / week row. */
const summaryFigures = (sales: SalesView, labor: LaborView): Figure[] => [sales.total, labor.hours, labor.purePct, labor.loadedPct];

/** The labor lines of a day / week drawer, each with its label: money, then the % it gives against its target. */
function LaborLines({ labor, target, loadedTarget, language, legend }: { labor: LaborView; target: Target; loadedTarget: Target; language: Language; legend: FigureLegend }) {
  const t = tFor(language);
  const line = (key: TranslationKey, f: Figure, extra: { sub?: string; tone?: string } = {}) => <FigureLine language={language} legend={legend} label={t(key)} f={f} {...extra} />;
  return <div className="flex flex-col gap-1.5">
    {line("reports.business.detail.net_sales", labor.net)}
    {line("reports.business.detail.hours", labor.hours)}
    {line("reports.business.detail.ot_hours", labor.otHours)}
    {line("reports.business.detail.pure_hourly_cost", labor.pureCost)}
    {line("reports.business.detail.ot_premium", labor.otPremium)}
    {line("reports.business.detail.pure_pct", labor.purePct, { sub: targetLine("pure", target, language), tone: shareTone(labor, "pure") })}
    {line("reports.business.detail.salaried", labor.salaried)}
    {line("reports.business.detail.burden", labor.burden)}
    {line("reports.business.detail.fully_loaded", labor.loadedCost)}
    {line("reports.business.detail.loaded_pct", labor.loadedPct, { sub: targetLine("loaded", loadedTarget, language), tone: shareTone(labor, "loaded") })}
  </div>;
}

/** The collapsed line of a day / week: every figure with its LABEL and the marks of what qualifies it (the list's
 * legend says each once), so the closed list says everything the open drawer says about whether a number is whole. */
function SummaryLine({ sales, labor, language, legend }: { sales: SalesView; labor: LaborView; language: Language; legend: FigureLegend }) {
  const t = tFor(language);
  return <span className="flex flex-wrap gap-x-3 gap-y-0.5">
    <Labeled language={language} legend={legend} label={t("reports.business.sum.sales")} f={sales.total} />
    <Labeled language={language} legend={legend} label={t("reports.business.sum.hours")} f={labor.hours} />
    <Labeled language={language} legend={legend} label={t("reports.business.sum.pure")} f={labor.purePct} />
    <Labeled language={language} legend={legend} label={t("reports.business.sum.loaded")} f={labor.loadedPct} />
  </span>;
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
    {day.rush?.any ? <span className={`${badge} bg-co-gold/20 text-co-text`}>{figureText(day.rush.count, language, { short: true, wrap: (n) => t("reports.business.rush.count", { n }) })}</span> : null}
    {day.largeChecks.any ? <span className={`${badge} bg-co-gold/20 text-co-text`}>{figureText(day.largeChecks.checks, language, { short: true, wrap: (n) => t("reports.business.badge.large", { n }) })}</span> : null}
  </>;
}

// ── Overview ────────────────────────────────────────────────────────────────────────────────────

/** Why the large-check count leaves days out: "still rebuilding" only when a day is. */
const LARGE_PARTIAL: Record<NonNullable<BusinessReportView["breakdownLeftOut"]>, TranslationKey> = {
  rebuilding: "reports.business.large_checks_partial.rebuilding", not_captured: "reports.business.large_checks_partial.not_captured", mixed: "reports.business.large_checks_partial",
};

export function BusinessOverview({ view, language }: Props) {
  const t = tFor(language);
  const { total, salesDays, breakdown } = view;
  // The six cards are one scope: a reason stays in its card, a qualification is said once under them.
  const cards = legendFor(language, [total.sales.total, total.labor.net, total.labor.hours, total.labor.purePct, total.labor.loadedPct, total.sales.refunds]);
  const weeks = legendFor(language, view.weeks.flatMap((w) => [...summaryFigures(w.sales, w.labor), ...laborFigures(w.labor)]), { reasons: true });
  const dayFigures = (d: DayView): Figure[] => [d.sales.total, d.sales.checks, d.sales.toastNet, d.sales.ezcater, ...laborFigures(d.labor)];
  const days = legendFor(language, view.days.flatMap(dayFigures), { reasons: true });
  return <section className={bizCard} aria-label={t("reports.business.tab.overview")}>
    <p className="mb-3 text-sm text-co-text-muted">{dateRange(view.range.from, view.range.to, language)} · {t("reports.business.caption")}</p>
    {salesDays.covered < salesDays.expected ? <p className="mb-3 text-xs font-bold text-co-warning-text">{t("reports.business.coverage.days", salesDays)}</p> : null}
    <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3">
      <Card label={t("reports.business.card.sales")} sub={t("reports.business.card.sales_hint")}><FigureView f={total.sales.total} language={language} legend={cards} /></Card>
      <Card label={t("reports.business.card.net")} sub={total.labor.netState === "ok" ? t("reports.business.card.net_hint") : null}>
        <FigureView f={total.labor.net} language={language} legend={cards} /></Card>
      <Card label={t("reports.business.card.hours")}><FigureView f={total.labor.hours} language={language} legend={cards} /></Card>
      <Card label={t("reports.business.card.pure_hourly")}><LaborShare labor={total.labor} view="pure" target={total.target} language={language} legend={cards} /></Card>
      <Card label={t("reports.business.card.fully_loaded")}><LaborShare labor={total.labor} view="loaded" target={total.loadedTarget} language={language} legend={cards} /></Card>
      <Card label={t("reports.business.card.refunds")} sub={t("reports.business.card.refunds_hint")}><FigureView f={total.sales.refunds} language={language} legend={cards} /></Card>
    </div>
    <LegendNotes entries={cards.entries} language={language} className="mt-2" />
    <p className="mt-3 text-xs text-co-text-muted">{t("reports.business.labor.denominator")}</p>
    <p className="text-xs text-co-text-muted">{t("reports.business.loaded.basis")}</p>
    {total.largeChecks.any ? <p className="mt-1 text-xs font-bold text-co-warning-text">{t("reports.business.large_checks", { count: figureText(total.largeChecks.checks, language), amount: figureText(total.largeChecks.amount, language) })}</p> : null}
    {view.breakdownLeftOut !== null && breakdown.expected > 0 ? <p className="mt-1 text-xs text-co-text-muted">{t(LARGE_PARTIAL[view.breakdownLeftOut], { covered: breakdown.included, expected: breakdown.expected })}</p> : null}

    <div className="mt-4 flex flex-col gap-2">
      <CollapsibleSection idBase={`biz-weeks-${view.locationId}`} title={t("reports.business.weeks")} count={t("reports.business.count_weeks", { n: view.weeks.length })} defaultOpen>
        <div className="flex flex-col gap-2">
          <LegendNotes entries={weeks.of(view.weeks.flatMap((w) => summaryFigures(w.sales, w.labor)))} language={language} />
          {view.weeks.map((w) => <CollapsibleSection key={w.weekStart} idBase={`biz-week-${view.locationId}-${w.weekStart}`}
            title={t("reports.business.week_of", { range: dateRange(w.from, w.to, language) })} count={<SummaryLine sales={w.sales} labor={w.labor} language={language} legend={weeks} />}>
            <div className="flex flex-col gap-2 p-1">
              <LaborLines labor={w.labor} target={w.target} loadedTarget={w.loadedTarget} language={language} legend={weeks} />
              <LegendNotes entries={weeks.of(laborFigures(w.labor))} language={language} />
            </div>
          </CollapsibleSection>)}
        </div>
      </CollapsibleSection>
      <CollapsibleSection idBase={`biz-days-${view.locationId}`} title={t("reports.business.days")} count={t("reports.business.count_days", { n: view.days.length })}>
        <div className="flex flex-col gap-2">
          <LegendNotes entries={days.of(view.days.flatMap((d) => summaryFigures(d.sales, d.labor)))} language={language} />
          {[...view.days].reverse().map((d) => <CollapsibleSection key={d.date} idBase={`biz-day-${view.locationId}-${d.date}`}
            title={formatDateLabel(d.date, language)} count={<SummaryLine sales={d.sales} labor={d.labor} language={language} legend={days} />} badge={<DayBadges day={d} language={language} />}>
            <div className="flex flex-col gap-1.5 p-1">
              <FigureLine language={language} legend={days} label={t("reports.business.detail.sales")} f={d.sales.total} />
              <FigureLine language={language} legend={days} label={t("reports.business.detail.checks")} f={d.sales.checks} />
              <FigureLine language={language} legend={days} label={t("reports.business.detail.toast_net")} f={d.sales.toastNet} />
              <FigureLine language={language} legend={days} label={t("reports.business.detail.ezcater")} f={d.sales.ezcater} />
              <LaborLines labor={d.labor} target={d.target} loadedTarget={d.loadedTarget} language={language} legend={days} />
              {d.cuts === "rebuilding" ? <p className="text-xs text-co-warning-text">{t("reports.business.cuts.rebuilding")}</p> : null}
              <LegendNotes entries={days.of(dayFigures(d))} language={language} className="mt-1" />
            </div>
          </CollapsibleSection>)}
        </div>
      </CollapsibleSection>
      <p className="text-xs text-co-text-muted">{t("reports.business.last_year.label")}: {t(lastYearKey(view))}</p>
    </div>
  </section>;
}

// ── Hours (15-minute grid, rushes) ──────────────────────────────────────────────────────────────

/** The labelled figures of one hour or one 15 minutes: checks, sales, labor hours and (MoO+) labor dollars and %.
 * Its labor is judged against the DAY's labor state (fix round 3): no minutes is "No labor" only when the day's
 * hours are final; otherwise a dash, and minutes are "so far". Every figure has its label: never a bare dash. */
function SlotFigures({ slot, language, legend }: { slot: Pick<QuarterView, "checks" | "sales" | "hours" | "cost" | "pct"> | HourView; language: Language; legend: FigureLegend }) {
  const t = tFor(language);
  return <>
    <Labeled language={language} legend={legend} label={t("reports.business.slot.checks")} f={slot.checks} selfLabeled />
    <Labeled language={language} legend={legend} label={t("reports.business.slot.sales")} f={slot.sales} />
    <Labeled language={language} legend={legend} label={t("reports.business.slot.labor")} f={slot.hours} />
    {slot.cost ? <Labeled language={language} legend={legend} label={t("reports.business.slot.cost")} f={slot.cost} /> : null}
    {"pct" in slot && slot.pct ? <Labeled language={language} legend={legend} label={t("reports.business.slot.pct")} f={slot.pct} /> : null}
  </>;
}
const slotFigures = (s: Pick<QuarterView, "checks" | "sales" | "hours" | "cost" | "pct"> | HourView): Array<Figure | undefined> =>
  [s.checks, s.sales, s.hours, s.cost, "pct" in s ? s.pct : undefined];

function QuarterLine({ q, language, legend }: { q: QuarterView; language: Language; legend: FigureLegend }) {
  return <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-sm">
    <span className="min-w-[4.5rem] font-semibold text-co-text">{formatTime(q.quarterStartAt, language)}</span>
    <SlotFigures slot={q} language={language} legend={legend} />
  </li>;
}

export function BusinessHours({ view, language }: Props) {
  const t = tFor(language);
  const r = view.rushRule;
  const money = view.access.quarterCost;
  // The closed day rows are one scope (each day's hours and why they are not final, said once on top).
  const rows = legendFor(language, view.days.map((d) => d.labor.hours), { reasons: true });
  return <section className={bizCard} aria-label={t("reports.business.tab.hours")}>
    <p className="mb-1 text-xs text-co-text-muted">{t("reports.business.quarter.basis")}</p>
    <p className="mb-1 text-xs text-co-text-muted">{t("reports.business.rush.rule", { quarters: r.minRunQuarters, multiplier: r.multiplier, checks: r.minChecks })}</p>
    <p className="mb-3 text-xs text-co-text-muted">{t(money ? "reports.business.hours.money_note" : "reports.business.hours.gm_note")}</p>
    {view.quarters === null ? <p className="text-sm text-co-text-muted">{t("reports.business.hours.too_wide")}</p> : <div className="flex flex-col gap-2">
      <LegendNotes entries={rows.entries} language={language} />
      {[...view.days].reverse().map((d) => {
        const rush = d.rush;
        const hours = d.labor.hours;
        // Fix round 7: "No rushes" is a claim (rush.none: every 15 minutes that could be one was compared). A
        // breakdown that is not shown names its own reason in the badge beside it (no sales captured is not
        // "rebuilding"), so the row does not repeat it.
        const rushText = rush === null ? null
          : rush.state === "not_enough_history" ? t("reports.business.rush.not_enough_history")
          : rush.any ? figureText(rush.count, language, { wrap: (n) => t("reports.business.rush.count", { n }) })
          : [rush.none ? t("reports.business.rush.none") : null, figureWhyText(rush.count, language)].filter((x) => x !== null).join(" · ");
        // The closed row always says the day's labor hours, with the marks of what qualifies them.
        const count = <span className="flex flex-wrap gap-x-3 gap-y-0.5">{rushText ? <span>{rushText}</span> : null}
          <Labeled language={language} legend={rows} label={t("reports.business.sum.hours")} f={hours} /></span>;
        // One day's drawer is one scope: its hours and quarters share a legend, shown on top of the list.
        const drawer = legendFor(language, [hours, ...d.hourly.flatMap((h) => [...slotFigures(h), ...h.quarters.flatMap(slotFigures)]),
          ...(d.unassigned ? [d.unassigned.checks, d.unassigned.sales] : [])], { reasons: true });
        const cutsReason = d.cutsReason !== null ? t(d.cutsReason) : null;
        return <CollapsibleSection key={d.date} idBase={`biz-hours-${view.locationId}-${d.date}`} title={formatDateLabel(d.date, language)}
          count={count} badge={<DayBadges day={d} language={language} />}>
          <div className="flex flex-col gap-2 p-1">
            {rush?.state === "ok" ? rush.windows.map((w) => <p key={w.startAt} className="rounded-lg bg-co-gold/20 p-2 text-sm font-semibold text-co-text">
              {t("reports.business.rush.window", { start: formatTime(w.startAt, language), end: formatTime(w.endAt, language), checks: figureText(w.checks, language),
                usual: figureText(w.usual, language) })}{" · "}{figureText(w.sales, language)}</p>) : null}
            {/* Why the breakdown is not shown: once. When the figures below carry it, the legend says it. */}
            {cutsReason !== null && !drawer.entries.some((e) => e.text === cutsReason) ? <p className="text-xs text-co-warning-text">{cutsReason}</p> : null}
            <FigureLine language={language} legend={drawer} label={t("reports.business.detail.hours")} f={hours} />
            <LegendNotes entries={drawer.entries} language={language} />
            {d.activity !== null ? <EmptyNote claim={d.activity} language={language}
              none={d.unassigned ? "reports.business.hours.no_timed_activity" : "reports.business.hours.no_activity"} />
              : <>
                <p className="text-xs text-co-text-muted">{t("reports.business.hours.tap_hour")}</p>
                <ul aria-label={t("reports.business.hours.list_aria")}>
                  {d.hourly.map((h) => <HourDisclosure key={h.hourStartAt} idBase={`biz-hour-${view.locationId}-${h.hourStartAt}`} title={formatTime(h.hourStartAt, language)}
                    summary={<SlotFigures slot={h} language={language} legend={drawer} />}>
                    {h.quarters.map((q) => <QuarterLine key={q.quarterStartAt} q={q} language={language} legend={drawer} />)}
                  </HourDisclosure>)}
                </ul>
              </>}
            {d.unassigned ? <p className="flex flex-wrap gap-x-3 text-xs text-co-text-muted"><span>{t("reports.business.quarter.unassigned")}:</span>
              <Labeled language={language} legend={drawer} label={t("reports.business.slot.checks")} f={d.unassigned.checks} selfLabeled />
              <Labeled language={language} legend={drawer} label={t("reports.business.slot.sales")} f={d.unassigned.sales} /></p> : null}
          </div>
        </CollapsibleSection>;
      })}
    </div>}
  </section>;
}

// ── Channels ────────────────────────────────────────────────────────────────────────────────────

/** One line of a breakdown list: the label left, the amount (through the formatter) and its count right, in two
 * fixed columns so a dash sits where an amount would. The count rides on the amount: an unknown amount already
 * shows the dash, with the mark of its reason, for the whole line. */
function CutLine({ label, sub, sales, checks, language, legend }: { label: string; sub?: string | null; sales: Figure; checks: Figure; language: Language; legend: FigureLegend }) {
  const known = figureKindOf(checks) !== "unknown";
  return <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-co-border/50 py-2 text-sm">
    <span className="min-w-0 break-words"><span className="font-semibold text-co-text">{label}</span>{sub ? <span className="text-co-text-muted"> · {sub}</span> : null}</span>
    <span className="flex flex-col items-end text-right">
      <FigureView f={sales} language={language} legend={legend} className="font-semibold text-co-text" />
      {known ? <span className="text-xs text-co-text-muted"><FigureView f={checks} language={language} legend={legend} /></span> : null}
    </span>
  </li>;
}

/** Fix round 8: every class that is not a sale is listed under "Not counted as sales" (the classifier's closed set). */
const EXCLUDED_LABELS: Record<string, TranslationKey> = {
  gift_card: "reports.business.channels.excluded.gift_card", ezcater_linked: "reports.business.channels.excluded.ezcater_linked",
  void: "reports.business.channels.excluded.void", excess_food: "reports.business.channels.excluded.excess_food",
};
const excludedLabel = (key: string): TranslationKey => EXCLUDED_LABELS[key] ?? "reports.business.channels.excluded.other";
const cutFigures = (c: { sales: Figure; checks: Figure }): Figure[] => [c.sales, c.checks];

export function BusinessChannels({ view, language }: Props) {
  const t = tFor(language);
  const notice = view.breakdownNotice;
  const ez = view.channels.ezcater;
  const legend = legendFor(language, [...view.channels.included.flatMap(cutFigures), ez.sales, ez.orders, ...view.channels.excluded.flatMap(cutFigures)], { reasons: true });
  const line = (c: CutView, label: string, sub: string | null) => <CutLine key={`${c.key}|${c.provider ?? ""}`} label={label} sub={sub} sales={c.sales} checks={c.checks} language={language} legend={legend} />;
  return <section className={bizCard} aria-label={t("reports.business.tab.channels")}>
    {notice ? <p className="mb-3 text-xs font-bold text-co-warning-text">{t(notice.key, notice.values)}</p> : null}
    <LegendNotes entries={legend.entries} language={language} className="mb-3" />
    <h3 className="mb-1 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.channels.title")}</h3>
    {view.empty.channels !== null ? <EmptyNote claim={view.empty.channels} none="reports.business.channels.none_verified" language={language} />
      : <ul>{view.channels.included.map((c) => line(c, channelLabel(language, c.key), c.provider ? providerLabel(language, c.provider) : null))}</ul>}
    <h3 className="mb-1 mt-4 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.channels.ezcater")}</h3>
    <ul><CutLine label={t("reports.business.channels.ezcater_label")} sales={ez.sales} checks={ez.orders} language={language} legend={legend} /></ul>
    <h3 className="mb-1 mt-4 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.channels.excluded")}</h3>
    {view.empty.excluded !== null ? <EmptyNote claim={view.empty.excluded} none="reports.business.channels.excluded_none" language={language} />
      : <ul>{view.channels.excluded.map((c) => line(c, t(excludedLabel(c.key)), null))}</ul>}
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
  // The list is one scope: "Toast hours, not confirmed" and "wage estimated" are said once on top, not per person.
  const people = legendFor(language, view.people.flatMap((p) => [p.hours, p.overtime, p.cost]), { reasons: true });
  const servers = legendFor(language, view.servers.flatMap(cutFigures), { reasons: true });
  return <section className={bizCard} aria-label={t("reports.business.tab.people")}>
    <CollapsibleSection idBase={`biz-people-${view.locationId}`} title={t("reports.business.people.title")} count={listCount(view.people.length, view.empty.people)} defaultOpen>
      {!view.access.personCost ? <p className="mb-2 text-xs text-co-text-muted">{t("reports.business.people.cost_note")}</p> : null}
      {figureKindOf(span) !== "known" && spanReason ? <p className="mb-2 text-xs font-bold text-co-warning-text">
        {t("reports.business.people.hours_partial")} {spanReason}</p> : null}
      <LegendNotes entries={people.entries} language={language} className="mb-2" />
      {view.empty.people !== null ? <EmptyNote claim={view.empty.people} none="reports.business.people.none" language={language} /> : <ul>
        {/* Two fixed columns (name left, figures right) so a person with an overtime line sits like everyone else. */}
        {view.people.map((p) => <li key={p.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-co-border/50 py-2 text-sm">
          <span className="min-w-0 break-words"><span className="font-semibold text-co-text">{p.label ?? t("reports.business.people.unnamed")}</span>
            <span className="text-co-text-muted"> · {t(p.payClass === "hourly" ? "reports.business.people.pay.hourly" : "reports.business.people.pay.salaried")}</span></span>
          <span className="flex flex-col items-end text-right">
            <FigureView f={p.hours} language={language} legend={people} className="font-semibold text-co-text" />
            {p.overtime === null ? <span className="max-w-[12rem] text-xs text-co-warning-text">{t("reports.business.people.withheld", { n: p.weeksWithheld })}</span>
              : p.overtimeAny ? <span className="text-xs text-co-text-muted"><Labeled language={language} legend={people} label={t("reports.business.people.ot_label")} f={p.overtime} /></span> : null}
            {/* Fix round 4 (ITEM9B-r4 P2): the cost is a figure like the hours above it; it always has its label. */}
            {p.cost ? <span className="text-xs text-co-text-muted"><Labeled language={language} legend={people} label={t("reports.business.people.cost")} f={p.cost} /></span> : null}
          </span>
        </li>)}
      </ul>}
    </CollapsibleSection>
    <div className="mt-3">
      <CollapsibleSection idBase={`biz-servers-${view.locationId}`} title={t("reports.business.people.servers")} count={listCount(view.servers.length, view.empty.servers)}>
        <p className="mb-2 text-xs text-co-text-muted">{t("reports.business.people.server_note")}</p>
        {notice ? <p className="mb-2 text-xs font-bold text-co-warning-text">{t(notice.key, notice.values)}</p> : null}
        <LegendNotes entries={servers.entries} language={language} className="mb-2" />
        {view.empty.servers !== null ? <EmptyNote claim={view.empty.servers} none="reports.business.people.servers_none" language={language} />
          : <ul>{view.servers.map((s) => <CutLine key={s.key || "none"} label={serverLabel(language, s.key, s.label)} sales={s.sales} checks={s.checks} language={language} legend={servers} />)}</ul>}
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
  // Both periods of every card are one scope: "Sales are missing ..." is said once under the cards.
  const legend = legendFor(language, rows.flatMap((r) => [r.fig(cur), prev ? r.fig(prev) : null]), { reasons: true });
  const none = <Dash reason="reports.business.compare.no_previous" language={language} />;
  // Both periods are laid out the same way: the label on its own line, the figure under it.
  const cell = (label: string, f: Figure | null): ReactNode => <span className="flex min-w-0 flex-col">
    <span className="text-xs text-co-text-muted">{label}</span>
    <span className="break-words font-semibold text-co-text">{f === null ? none : <FigureView f={f} language={language} legend={legend} />}</span>
  </span>;
  return <section className={bizCard} aria-label={t("reports.business.tab.compare")}>
    <p className="mb-3 text-sm text-co-text-muted">{t("reports.business.compare.periods", { current: dateRange(view.range.from, view.range.to, language),
      previous: previous ? dateRange(previous.range.from, previous.range.to, language) : t("reports.business.compare.no_previous") })}</p>
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const a = r.fig(cur), b = prev ? r.fig(prev) : null;
        return <li key={r.key} className="rounded-lg border border-co-border bg-co-surface-inset p-3 text-sm">
          <div className="mb-1 text-xs font-bold tracking-wide text-co-text-muted">{r.label}</div>
          <div className="grid grid-cols-2 gap-x-3">
            {cell(t("reports.business.compare.this"), a)}
            {cell(t("reports.business.compare.previous"), b)}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2"><span className="text-xs text-co-text-muted">{t("reports.business.compare.change")}</span><ChangeText cur={a} prev={b} language={language} /></div>
        </li>;
      })}
      <li className="rounded-lg border border-co-border bg-co-surface-inset p-3 text-sm">
        <div className="mb-1 text-xs font-bold tracking-wide text-co-text-muted">{t("reports.business.last_year.label")}</div>
        <p className="text-co-text-muted">{t(lastYearKey(view))}</p>
      </li>
    </ul>
    <LegendNotes entries={legend.entries} language={language} className="mt-3" />
    <p className="mt-3 text-xs text-co-text-muted">{t("reports.business.compare.rule")}</p>
  </section>;
}
