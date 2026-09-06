"use client";

/**
 * InsightsClient — the catering insights surface (v2, catering-truth arc 2026-09-05).
 *
 * One client component over the loader's four pre-cut windows: the pills switch which
 * window the stat grid and the two breakdowns describe; the calendar is window-independent
 * (it always shows the RPC's booked -30/+90-day span, which is what a manager means by
 * "what is booked"). Every number arrives pre-summed from SQL — nothing here reduces rows.
 *
 * Disclosure doctrine: the stat grid + the money note are the always-visible summary; the
 * breakdowns are default-collapsed drawers; the calendar opens by default because it IS the
 * thing Juan asked for.
 */

import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { INSIGHT_WINDOWS, stageDot, type WindowKey } from "@/lib/catering/insights-shared";
import { leadSourceLabelKey } from "@/lib/catering/intake-shared";
import { PIPELINE_STAGES } from "@/lib/catering/pipeline-shared";
import type { CateringInsightsV2 } from "@/lib/catering/insights";
import { InsightsCalendar } from "@/components/catering/InsightsCalendar";

export function InsightsClient({ data }: { data: CateringInsightsV2 }) {
  const { t, language } = useTranslation();
  const [windowKey, setWindowKey] = useState<WindowKey>("this_month");
  const stats = data.windows[windowKey];
  const money = (c: number) => formatCents(c, language);

  const hasActivity =
    data.windows.all_time.leadsNew > 0 || data.calendar.length > 0 || data.feedbackCount > 0;

  const sourceRows = Object.entries(stats.bySource)
    .map(([source, count]) => {
      const label = leadSourceLabelKey(source);
      return { source, count, label: "key" in label ? t(label.key) : label.verbatim };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const sourceMax = Math.max(...sourceRows.map((r) => r.count), 1);

  const stageRows = PIPELINE_STAGES.map((stage) => ({
    stage,
    label: t(`catering.pipeline.stage.${stage}` as TranslationKey),
    count: stats.byStage[stage] ?? 0,
  })).filter((r) => r.count > 0);
  const stageMax = Math.max(...stageRows.map((r) => r.count), 1);

  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* Window pills — one row, wrapping on a phone. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("catering.insights.title")}>
        {INSIGHT_WINDOWS.map((w) => {
          const active = w.key === windowKey;
          return (
            <button
              key={w.key}
              type="button"
              onClick={() => setWindowKey(w.key)}
              aria-pressed={active}
              className={`flex min-h-[44px] items-center rounded-xl border-2 px-4 text-sm font-bold uppercase tracking-[0.1em] ${
                active
                  ? "border-co-text bg-co-text text-co-bg"
                  : "border-co-border-2 bg-co-surface text-co-text"
              }`}
            >
              {t(w.labelKey)}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("catering.insights.stat.leads_new")} value={String(stats.leadsNew)} />
        <StatCard label={t("catering.insights.stat.booked_events")} value={String(stats.bookedEvents)} />
        {/* The booked money, split by whether the event has happened yet (Juan 2026-09-05:
            "we need money confirmed and money completed"). The two cards partition the
            "Booked events" total above them; each carries its own event count underneath. */}
        <StatCard
          label={t("catering.insights.stat.confirmed_value")}
          value={money(stats.confirmedValueCents)}
          sub={t("catering.insights.stat.events_count", { count: stats.confirmedEvents })}
          accent
        />
        <StatCard
          label={t("catering.insights.stat.completed_value")}
          value={money(stats.completedValueCents)}
          sub={t("catering.insights.stat.events_count", { count: stats.completedEvents })}
        />
        <StatCard
          label={t("catering.insights.stat.win_rate")}
          value={stats.winRateBps == null ? "—" : `${Math.round(stats.winRateBps / 100)}%`}
          note={stats.winRateBps == null ? t("catering.insights.stat.no_settled") : undefined}
        />
        <StatCard label={t("catering.insights.stat.lost")} value={String(stats.lost)} />
        <StatCard
          label={t("catering.insights.stat.avg_headcount")}
          value={stats.avgHeadcount == null ? "—" : String(stats.avgHeadcount)}
        />
        <StatCard label={t("catering.insights.stat.open_pipeline")} value={money(stats.pipelineOpenValueCents)} />
      </div>

      <p className="text-xs text-co-text-dim">{t("catering.insights.money_note")}</p>

      {!hasActivity && (
        <p className="co-card p-6 text-sm text-co-text-muted">{t("catering.insights.empty")}</p>
      )}

      <CollapsibleSection
        idBase="catering-insights-by-source"
        title={t("catering.insights.by_source")}
        count={t("catering.insights.source_count", { n: sourceRows.length })}
      >
        <div className="flex flex-col gap-2.5">
          {sourceRows.map((r) => (
            <FunnelBar key={r.source} label={r.label} count={r.count} max={sourceMax} />
          ))}
          {sourceRows.length === 0 && (
            <p className="text-sm text-co-text-muted">{t("catering.insights.empty")}</p>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        idBase="catering-insights-by-stage"
        title={t("catering.insights.by_stage")}
        count={t("catering.insights.stage_count", { n: stageRows.reduce((n, r) => n + r.count, 0) })}
      >
        <div className="flex flex-col gap-2.5">
          {stageRows.map((r) => (
            <FunnelBar key={r.stage} label={r.label} count={r.count} max={stageMax} />
          ))}
          {stageRows.length === 0 && (
            <p className="text-sm text-co-text-muted">{t("catering.insights.empty")}</p>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        idBase="catering-insights-calendar"
        title={t("catering.insights.calendar")}
        count={t("catering.insights.calendar_count", { n: data.calendar.length })}
        defaultOpen
      >
        {/* The legend names the same three stages the pipeline chips do, so it reads the
            STAGE vocabulary rather than a private copy that can drift word-for-word. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-co-text-muted">
          <LegendDot stage="confirmed" label={t("catering.pipeline.stage.confirmed")} />
          <LegendDot stage="out" label={t("catering.pipeline.stage.out")} />
          <LegendDot stage="completed" label={t("catering.pipeline.stage.completed")} />
        </div>
        <InsightsCalendar events={data.calendar} today={data.today} />
      </CollapsibleSection>

      {/* Feedback — carried over from v1; the RPC still supplies the rollup and the loader
          still supplies the bounded recent list. */}
      <section className="co-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">
            {t("catering.insights.feedback")}
          </h2>
          <span className="text-sm text-co-text-muted">
            {data.averageRating != null ? (
              <>
                <span className="text-lg font-extrabold text-co-text">{data.averageRating.toFixed(1)}</span>
                <span className="text-co-text-dim">
                  {" "}
                  / 5 · {data.feedbackCount} {t("catering.insights.feedback_count")}
                </span>
              </>
            ) : (
              t("catering.insights.no_feedback")
            )}
          </span>
        </div>
        {data.recentFeedback.length > 0 && (
          <ul className="flex flex-col gap-2">
            {data.recentFeedback.map((f) => (
              <li key={f.id} className="rounded-lg border-2 border-co-border-2 bg-co-surface p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-co-text">
                    {f.rating != null ? `${f.rating}/5` : "—"}
                    {f.category ? <span className="ml-2 text-xs font-normal text-co-text-dim">{f.category}</span> : null}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-co-text-dim">
                    {f.followUpNeeded && (
                      <span className="rounded-full border border-co-cta/40 bg-co-cta/10 px-2 py-0.5 font-bold text-co-cta-text">
                        {t("catering.insights.follow_up")}
                      </span>
                    )}
                    {f.submittedAt ? formatDateLabel(f.submittedAt.slice(0, 10), language) : ""}
                  </span>
                </div>
                {f.comment && <p className="mt-1 text-sm text-co-text-muted">{f.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** `sub` is the quiet line under the number (the money cards' event count); `note` stays the
 *  explanatory aside ("No settled leads yet"). Both are optional, both live below the value. */
function StatCard({ label, value, sub, note, accent }: { label: string; value: string; sub?: string; note?: string; accent?: boolean }) {
  return (
    <div className={`co-card p-3 ${accent ? "ring-2 ring-co-gold/40" : ""}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{label}</p>
      <p className="mt-1 text-xl font-extrabold tabular-nums text-co-text">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-co-text-dim">{sub}</p>}
      {note && <p className="mt-0.5 text-[10px] text-co-text-muted">{note}</p>}
    </div>
  );
}

/** The v1 funnel bar, lifted into the client so the breakdowns keep the surface's look. */
function FunnelBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = Math.round((count / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-co-text">{label}</span>
        <span className="font-bold tabular-nums text-co-text">{count}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-co-border/40">
        <div className="h-full rounded-full bg-co-gold" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LegendDot({ stage, label }: { stage: "confirmed" | "out" | "completed"; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${stageDot(stage)}`} aria-hidden />
      {label}
    </span>
  );
}
