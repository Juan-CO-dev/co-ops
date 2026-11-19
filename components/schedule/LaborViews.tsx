"use client";
/**
 * THE TWO LABOR VIEWS ON THE BOARD (Board two labor views PR 3; plan r4 "Day tab", "Day states", "PR split" item 3; dark
 * behind SCHEDULE_LABOR_VIEWS). Renders the server's `laborViews` exactly as serialized (`BoardLaborViews`,
 * lib/scheduling/labor-projection-shared.ts) and computes NOTHING: no sum of days into a week, no % of its own. Each
 * figure is the labor facts' own answer for its range.
 *
 *  - `LaborViewsStrip`: the week, three lines that are never blended: "Actual, N of 7 days" (toned only at 7 of 7),
 *    "Projected, M days", and a COUNT of days not settled (and of days with no schedule).
 *  - `LaborDayCard`: the selected day. Headline = fully loaded %, pure hourly beneath (Juan), each with its target and
 *    its tone as a WORD (never colour alone); the day's kind ("Actual" / "Projected · not settled" / "Not settled yet").
 *  - An unknown figure is "—" with its reason line (always visible); never 0, never a tone.
 *  - The $ breakdown is secondary: collapsed by default behind a full-row 44 px toggle (disclosure doctrine D3 / D8).
 * useState only.
 */
import { useId, useState } from "react";
import { formatCentsWhole } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { laborFigureQualifications, type BoardLaborDay, type BoardLaborFigure, type BoardLaborViews } from "@/lib/scheduling/labor-projection-shared";

const TONE = { good: "text-co-confirm-text", watch: "text-co-warning-text", high: "text-co-cta-text", none: "text-co-text" } as const;
const h1 = (minutes: number) => String(Math.round((minutes / 60) * 10) / 10);
type Targets = { hourlyPct: number; loadedPct: number };

function useFmt() {
  const { t, language } = useTranslation();
  const blank = t("schedule.board.money.blank");
  return {
    t, blank,
    usd: (c: number | null) => (c === null ? blank : formatCentsWhole(c, language)),
    pct: (p: number | null) => (p === null ? blank : t("schedule.board.money.pct_value", { pct: p })),
    hours: (m: number | null) => (m === null ? blank : t("schedule.board.money.hours_only", { hours: h1(m) })),
  };
}

function ViewTile({ view, label, pct, tone, cents, target }: {
  view: "fully_loaded" | "pure_hourly"; label: string; pct: number | null; tone: BoardLaborFigure["fullyLoadedTone"]; cents: number | null; target: number;
}) {
  const f = useFmt();
  return (
    <div className="grid min-w-0 gap-0.5 rounded-lg border border-co-border bg-co-surface p-3" data-labor-view={view} data-tone={tone}>
      <span className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{label}</span>
      <span className={`font-bold tabular-nums ${view === "fully_loaded" ? "text-2xl" : "text-lg"} ${TONE[tone]}`}>{f.pct(pct)}</span>
      {tone !== "none" ? <span className={`text-xs font-bold ${TONE[tone]}`}>{f.t(`schedule.board.labor.${tone}` as TranslationKey)}</span> : null}
      <span className="text-xs text-co-text-muted">{f.usd(cents)} · {f.t("schedule.labor_views.target", { pct: target })}</span>
    </div>
  );
}

/** One range's figure: both views, the hours, every reason and flag (always visible), the $ breakdown collapsed.
 * `hoursOnly` (a day not settled, or with no schedule): the hours and the reason, with no %, no $, no target and no tone. */
function Figure({ figure: g, targets, id, hoursOnly = false }: { figure: BoardLaborFigure; targets: Targets; id: string; hoursOnly?: boolean }) {
  const f = useFmt();
  const [open, setOpen] = useState(false);
  const panel = useId();
  // The figure's qualifications, from the ONE list (the labor target card derived from this figure shows the same).
  const quals = laborFigureQualifications(g);
  const otQ = quals.find((q) => q.code === "ot");
  const ot = otQ ? (otQ.key as TranslationKey) : null;
  const flags = quals.filter((q) => q.code !== "ot").map((q) => f.t(q.key as TranslationKey, q.params));
  const rows: Array<[string, string, string]> = [
    ["hours", f.t("schedule.labor_views.row.hours"), f.hours(g.minutes)],
    ["ot_hours", f.t("schedule.labor_views.row.ot_hours"), f.hours(g.otMinutes)],
    ["straight", f.t("schedule.labor_views.row.straight"), f.usd(g.straightCents)],
    ["premium", f.t("schedule.labor_views.row.premium"), f.usd(g.otPremiumCents)],
    ["pure_hourly", f.t("schedule.labor_views.row.pure_hourly"), f.usd(g.pureHourlyCents)],
    ["salaries", f.t("schedule.labor_views.row.salaries"), f.usd(g.salariedCents)],
    ["burden", g.burdenPct === null ? f.t("schedule.labor_views.row.burden_plain") : f.t("schedule.labor_views.row.burden", { pct: g.burdenPct }), f.usd(g.burdenCents)],
    ["fully_loaded", f.t("schedule.labor_views.row.fully_loaded"), f.usd(g.fullyLoadedCents)],
    ["sales", f.t(`schedule.labor_views.sales.${g.sales.basis}` as TranslationKey), f.usd(g.sales.cents)],
  ];
  return (
    <div className="grid min-w-0 gap-2" data-labor-figure={id}>
      {hoursOnly ? null : <div className="grid grid-cols-2 gap-2">
        <ViewTile view="fully_loaded" label={f.t("schedule.labor_views.view.fully_loaded")} pct={g.fullyLoadedPct} tone={g.fullyLoadedTone} cents={g.fullyLoadedCents} target={targets.loadedPct} />
        <ViewTile view="pure_hourly" label={f.t("schedule.labor_views.view.pure_hourly")} pct={g.pureHourlyPct} tone={g.pureHourlyTone} cents={g.pureHourlyCents} target={targets.hourlyPct} />
      </div>}
      <p className="text-sm text-co-text" data-labor-hours>
        <span className="font-bold">{f.t("schedule.labor_views.row.hours")}:</span> <span className="tabular-nums">{f.hours(g.minutes)}</span>
        {ot ? <span className="text-co-text-muted"> · {f.t(ot)}</span> : null}
      </p>
      {g.reasons.length > 0 ? (
        <ul className="grid gap-0.5 text-sm font-bold text-co-warning-text" data-labor-reasons>
          {g.reasons.map((r) => <li key={r} data-labor-reason={r}>{f.t(`schedule.labor_views.reason.${r}` as TranslationKey)}</li>)}
        </ul>
      ) : null}
      {flags.length > 0 ? <ul className="grid gap-0.5 text-xs text-co-text-muted" data-labor-flags>{flags.map((x) => <li key={x}>{x}</li>)}</ul> : null}
      {hoursOnly ? null : <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((v) => !v)} data-act="labor-detail"
        className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border border-co-border bg-co-surface-inset px-3 text-left text-sm font-bold text-co-text">
        <span>{f.t("schedule.labor_views.detail")}</span>
        <span aria-hidden className="text-xs text-co-text-dim">{open ? "▾" : "▸"}</span>
      </button>}
      {open && !hoursOnly ? (
        <dl id={panel} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm" data-labor-detail>
          {rows.map(([key, label, value]) => (
            <div key={key} className="contents" data-labor-row={key}>
              <dt className="min-w-0 text-co-text-muted">{label}</dt>
              <dd className="text-right font-bold tabular-nums text-co-text">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** The named state when the labor numbers could not be shown at all (never a blank, never a 0). */
function ViewsState({ state }: { state: Exclude<BoardLaborViews["state"], "ready"> }) {
  const { t } = useTranslation();
  return <p role="status" className="co-card p-3 text-sm font-bold text-co-warning-text" data-section="labor-views" data-labor-state={state}>{t(`schedule.labor_views.state.${state}` as TranslationKey)}</p>;
}

/** The week: actual so far, the projected rest, and the days not settled: three lines, never one blended figure. */
export function LaborViewsStrip({ views }: { views: BoardLaborViews }) {
  const { t } = useTranslation();
  if (views.state !== "ready") return <ViewsState state={views.state} />;
  const { actual, projected, notSettledDays, noScheduleDays } = views.strip;
  return (
    <section className="co-card grid min-w-0 gap-3 p-4" aria-labelledby="schedule-labor-views-week" data-section="labor-views" data-labor-state="ready">
      <h2 id="schedule-labor-views-week" className="text-sm font-bold text-co-text">{t("schedule.labor_views.title.week")}</h2>
      {actual ? (
        <div className="grid min-w-0 gap-2" data-labor-strip="actual">
          <h3 className="text-xs font-bold tracking-wide text-co-text-muted">{t("schedule.labor_views.strip.actual", { n: actual.days })}</h3>
          <Figure figure={actual} targets={views.targets} id="strip-actual" />
        </div>
      ) : null}
      {projected ? (
        <div className="grid min-w-0 gap-2" data-labor-strip="projected">
          <h3 className="text-xs font-bold tracking-wide text-co-text-muted">{t("schedule.labor_views.strip.projected", { n: projected.days })}</h3>
          <Figure figure={projected} targets={views.targets} id="strip-projected" />
        </div>
      ) : null}
      {notSettledDays > 0 ? (
        <p className="text-sm font-bold text-co-warning-text" data-labor-strip="not_settled">
          {t("schedule.labor_views.strip.not_settled", { n: notSettledDays })}
          {projected && projected.otState === "projected" ? <span className="font-normal text-co-text-muted"> · {t("schedule.labor_views.strip.ot_estimated", { n: notSettledDays })}</span> : null}
        </p>
      ) : null}
      {noScheduleDays > 0 ? <p className="text-sm text-co-text-muted" data-labor-strip="no_schedule">{t("schedule.labor_views.strip.no_schedule", { n: noScheduleDays })}</p> : null}
    </section>
  );
}

/** The selected day: its kind, both views (fully loaded first), the hours, the reasons. */
export function LaborDayCard({ views, date }: { views: BoardLaborViews; date: string }) {
  const { t } = useTranslation();
  if (views.state !== "ready") return null; // the strip already names the state, once
  const day: BoardLaborDay | undefined = views.days.find((d) => d.date === date);
  if (!day) return null;
  return (
    <section className="co-card grid min-w-0 gap-2 p-4" aria-labelledby="schedule-labor-views-day" data-section="labor-day" data-labor-kind={day.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="schedule-labor-views-day" className="text-sm font-bold text-co-text">{t("schedule.labor_views.title.day")}</h3>
        <span className="rounded-lg bg-co-surface-inset px-2 py-1 text-xs font-bold text-co-text" data-labor-kind-chip>{t(`schedule.labor_views.kind.${day.kind}` as TranslationKey)}</span>
      </div>
      <Figure figure={day} targets={views.targets} id={`day-${date}`} hoursOnly={day.kind === "not_settled" || day.kind === "no_schedule"} />
    </section>
  );
}
