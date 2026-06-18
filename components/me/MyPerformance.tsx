import type { ReactNode } from "react";
import type { MyPerformanceData } from "@/lib/team-metrics";
import type { MyFeedbackItem, Gradient } from "@/lib/pm-report";
import { LineChart } from "@/components/trends/LineChart";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { formatDateLabel } from "@/lib/i18n/format";

const GRADIENT_KEY: Record<Gradient, TranslationKey> = {
  great: "pm.attitude.great",
  good: "pm.attitude.good",
  needs_work: "pm.attitude.needs_work",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border-2 border-co-border bg-co-surface p-4">
      <h4 className="text-sm font-bold uppercase tracking-[0.12em] text-co-text mb-2">{title}</h4>
      {children}
    </section>
  );
}

function Chip({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="rounded-xl border border-co-border p-2">
      <div className="text-lg font-extrabold text-co-text">{value}</div>
      <div className="text-[9px] uppercase text-co-text-dim">{label}</div>
    </div>
  );
}

export function MyPerformance({
  data,
  feedback,
  language,
}: {
  data: MyPerformanceData;
  feedback: MyFeedbackItem[];
  language: Language;
}) {
  const gradTotal =
    data.gradientTally.great + data.gradientTally.good + data.gradientTally.needsWork;

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Hero */}
      <div className="rounded-2xl border-2 border-co-border bg-co-surface p-5">
        <div className="rounded-xl bg-co-success-surface p-3">
          <p className="text-base font-bold text-co-text">
            {serverT(language, data.read.key as TranslationKey, data.read.params)}
          </p>
          <div className="mt-2">
            <span className="text-3xl font-extrabold text-co-text">{data.score}</span>
            {data.scoreDeltaPct !== null &&
              (data.scoreDeltaPct > 0 ? (
                <span className="ml-2 text-sm font-bold" style={{ color: "var(--co-success)" }}>
                  {serverT(language, "me.score_up", { pct: data.scoreDeltaPct })}
                </span>
              ) : data.scoreDeltaPct < 0 ? (
                <span className="ml-2 text-sm font-bold text-co-text-muted">
                  {serverT(language, "me.score_down", { pct: Math.abs(data.scoreDeltaPct) })}
                </span>
              ) : (
                <span className="ml-2 text-sm font-bold text-co-text-muted">
                  {serverT(language, "me.vs_prev_flat")}
                </span>
              ))}
          </div>
          <p className="mt-1 text-xs text-co-text-muted">
            {serverT(language, "me.score_label")} · {serverT(language, "me.score_demystify")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.wins.activeDayStreak > 0 && (
              <span className="rounded-full border border-co-border bg-co-surface px-3 py-1 text-xs font-bold">
                {serverT(language, "me.wins.streak", { n: data.wins.activeDayStreak })}
              </span>
            )}
            {data.wins.mvpAwards > 0 && (
              <span className="rounded-full border border-co-border bg-co-surface px-3 py-1 text-xs font-bold">
                {serverT(language, "me.wins.mvp", { n: data.wins.mvpAwards })}
              </span>
            )}
            {data.wins.personalBest > 0 && (
              <span className="rounded-full border border-co-border bg-co-surface px-3 py-1 text-xs font-bold">
                {serverT(language, "me.wins.best", { n: data.wins.personalBest })}
              </span>
            )}
            {data.wins.onTimePct !== null && (
              <span className="rounded-full border border-co-border bg-co-surface px-3 py-1 text-xs font-bold">
                {serverT(language, "me.wins.ontime", { n: data.wins.onTimePct })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2. Contribution */}
      <Section title={serverT(language, "me.contribution")}>
        <LineChart
          series={[{ points: data.contribution, color: "var(--co-gold-deep)" }]}
          ariaLabel={serverT(language, "me.contribution")}
        />
      </Section>

      {/* 3. On-time */}
      <Section title={serverT(language, "me.on_time")}>
        <p className="text-[10px] text-co-text-dim">{serverT(language, "me.on_time_sub")}</p>
        <LineChart
          series={[{ points: data.onTime, color: "var(--co-success)" }]}
          ariaLabel={serverT(language, "me.on_time")}
        />
      </Section>

      {/* 4. Gradients */}
      <Section title={serverT(language, "me.gradients")}>
        {gradTotal === 0 ? (
          <div className="flex h-3.5 rounded overflow-hidden bg-co-border" />
        ) : (
          <div className="flex h-3.5 rounded overflow-hidden">
            <div style={{ flex: data.gradientTally.great, background: "var(--co-success)" }} />
            <div style={{ flex: data.gradientTally.good, background: "#9ccc9c" }} />
            <div style={{ flex: data.gradientTally.needsWork, background: "var(--co-warning)" }} />
          </div>
        )}
      </Section>

      {/* 5. Streaks */}
      <Section title={serverT(language, "me.streaks")}>
        <div className="grid grid-cols-4 gap-2">
          <Chip value={data.streaks.activeDays} label={serverT(language, "me.streak_active")} />
          <Chip value={data.streaks.onTime} label={serverT(language, "me.streak_ontime")} />
          <Chip value={data.streaks.personalBest} label={serverT(language, "me.streak_best")} />
          <Chip value={data.signals.mvpAwards} label={serverT(language, "me.streak_mvp")} />
        </div>
        <p className="text-[10px] italic text-co-text-dim mt-2">
          {serverT(language, "me.toast_note")}
        </p>
      </Section>

      {/* 6. Feedback */}
      <Section title={serverT(language, "me.feedback")}>
        {feedback.length === 0 ? (
          <p className="text-sm text-co-text-muted">{serverT(language, "me.empty")}</p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {feedback.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-co-border bg-co-surface px-3 py-2"
                >
                  <div className="text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted">
                    {formatDateLabel(item.date, language)}
                    {item.wasMvp && (
                      <span
                        className="ml-2 rounded-full border border-co-gold bg-co-gold/10 px-2 py-0.5 text-xs"
                        style={{ color: "var(--co-gold-deep)" }}
                      >
                        {serverT(language, "pm.my_feedback.mvp")}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-full border border-co-border bg-co-bg px-2.5 py-0.5 text-xs">
                      {serverT(language, "pm.eval.arrived_ready")}: {serverT(language, GRADIENT_KEY[item.arrivedReady])}
                    </span>
                    <span className="rounded-full border border-co-border bg-co-bg px-2.5 py-0.5 text-xs">
                      {serverT(language, "pm.eval.attitude")}: {serverT(language, GRADIENT_KEY[item.attitude])}
                    </span>
                    <span className="rounded-full border border-co-border bg-co-bg px-2.5 py-0.5 text-xs">
                      {serverT(language, "pm.eval.production")}: {serverT(language, GRADIENT_KEY[item.production])}
                    </span>
                    <span className="rounded-full border border-co-border bg-co-bg px-2.5 py-0.5 text-xs">
                      {serverT(language, "pm.eval.team_player")}: {serverT(language, GRADIENT_KEY[item.teamPlayer])}
                    </span>
                  </div>
                  {item.areaToImprove && (
                    <p className="mt-1 text-sm text-co-text-muted">
                      {serverT(language, "me.area_to_grow")}: {item.areaToImprove}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-co-text-dim mt-2">
              {serverT(language, "me.feedback_reassure")}
            </p>
          </>
        )}
      </Section>
    </div>
  );
}
