import type { ReactNode } from "react";
import Link from "next/link";

import { LineChart } from "@/components/trends/LineChart";
import type { PersonDetail as PersonDetailData } from "@/lib/team-metrics";
import { ROLES } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { formatDateLabel } from "@/lib/i18n/format";
import type { Language, TranslationKey } from "@/lib/i18n/types";

/** Card-chrome section wrapper for the detail body. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-co-border bg-co-surface p-3">
      <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Small value + label chip. */
function Chip({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-co-border bg-co-surface px-3 py-2 text-center">
      <span className="text-lg font-extrabold leading-none text-co-text">{value}</span>
      <span className="mt-1 text-[10px] leading-tight text-co-text-dim">{label}</span>
    </div>
  );
}

/** Tenure string — months past 60 days, else days. */
function tenureLabel(tenureDays: number, language: Language): string {
  return tenureDays >= 60
    ? serverT(language, "people.signals.months", { n: Math.round(tenureDays / 30) })
    : serverT(language, "people.signals.days", { n: tenureDays });
}

/**
 * One member's full operating-health detail (approved layout). Pure
 * presentational Server Component. Mobile-first, tap-friendly.
 */
export function PersonDetail({
  detail,
  locationId,
  language,
}: {
  detail: PersonDetailData;
  locationId: string;
  language: Language;
}) {
  const tally = detail.gradientTally;
  const gradTotal = tally.great + tally.good + tally.needsWork;

  return (
    <div className="space-y-3">
      {/* 1. Back link */}
      <Link
        href={`/reports/trends/team?location=${locationId}`}
        className="text-xs text-co-text-muted"
      >
        ← {serverT(language, "people.detail.back")}
      </Link>

      {/* 2. Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-extrabold text-co-text">{detail.name}</span>
            <span className="rounded-full bg-[#f1ede0] px-2 py-0.5 text-[10px] font-bold uppercase text-co-text-dim">
              {ROLES[detail.role].shortLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-co-text-muted">
            {tenureLabel(detail.signals.tenureDays, language)}
            {" · "}
            {serverT(language, "people.signals.last_active", {
              date: detail.signals.lastActive
                ? formatDateLabel(detail.signals.lastActive, language)
                : "—",
            })}
          </p>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-2xl font-extrabold leading-none text-co-text">
            {detail.score}
          </span>
          <span
            className="mt-1 text-xs font-semibold"
            style={{
              color:
                detail.health === "on_track" ? "var(--co-success)" : "var(--co-warning)",
            }}
          >
            {serverT(
              language,
              detail.health === "on_track" ? "people.on_track" : "people.needs_attention",
            )}
          </span>
        </div>
      </div>

      {/* 3. The read */}
      <div className="rounded-md border-l-[3px] border-co-gold bg-co-warning-surface px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-co-text-dim">
          {serverT(language, "people.detail.the_read")}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-co-text">
          {serverT(language, detail.read.key as TranslationKey, detail.read.params)}
        </p>
      </div>

      {/* 4. AI Insight */}
      <div className="rounded-md border border-dashed border-co-border-2 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-co-text-dim">
          {serverT(language, "people.detail.ai_insight")}
        </p>
        <p className="mt-0.5 text-xs italic leading-relaxed text-co-text-muted">
          {serverT(language, "people.detail.ai_pending")}
        </p>
      </div>

      {/* 5. Contribution */}
      <Section title={serverT(language, "people.detail.contribution")}>
        <LineChart
          series={[{ points: detail.contribution, color: "var(--co-gold-deep)" }]}
          ariaLabel={serverT(language, "people.detail.contribution")}
        />
      </Section>

      {/* 6. On-time */}
      <Section title={serverT(language, "people.detail.on_time")}>
        <p className="-mt-1 mb-2 text-[10px] text-co-text-dim">
          {serverT(language, "people.detail.on_time_sub")}
        </p>
        <LineChart
          series={[{ points: detail.onTime, color: "var(--co-success)" }]}
          ariaLabel={serverT(language, "people.detail.on_time")}
        />
      </Section>

      {/* 7. PM gradients */}
      <Section title={serverT(language, "people.detail.gradients")}>
        <div className="flex h-3 w-full overflow-hidden rounded-full">
          {gradTotal === 0 ? (
            <div className="h-full w-full bg-co-surface-2" />
          ) : (
            <>
              {tally.great > 0 ? (
                <div
                  className="h-full"
                  style={{
                    width: `${(tally.great / gradTotal) * 100}%`,
                    background: "var(--co-success)",
                  }}
                />
              ) : null}
              {tally.good > 0 ? (
                <div
                  className="h-full"
                  style={{ width: `${(tally.good / gradTotal) * 100}%`, background: "#9ccc9c" }}
                />
              ) : null}
              {tally.needsWork > 0 ? (
                <div
                  className="h-full"
                  style={{
                    width: `${(tally.needsWork / gradTotal) * 100}%`,
                    background: "var(--co-warning)",
                  }}
                />
              ) : null}
            </>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-co-text-dim">
          <span className="flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "var(--co-success)" }}
            />
            {tally.great} great
          </span>
          <span className="flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "#9ccc9c" }}
            />
            {tally.good} good
          </span>
          <span className="flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "var(--co-warning)" }}
            />
            {tally.needsWork} needs work
          </span>
        </div>
      </Section>

      {/* 8. Streaks */}
      <Section title={serverT(language, "people.detail.streaks")}>
        <p className="-mt-1 mb-2 text-[10px] italic text-co-text-dim">
          {serverT(language, "people.detail.streaks_from_data")}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Chip
            value={detail.streaks.activeDays}
            label={serverT(language, "people.detail.streak_active")}
          />
          <Chip
            value={detail.streaks.onTime}
            label={serverT(language, "people.detail.streak_ontime")}
          />
          <Chip
            value={detail.streaks.personalBest}
            label={serverT(language, "people.detail.streak_best")}
          />
        </div>
        <p className="mt-2 text-[10px] italic text-co-text-dim">
          {serverT(language, "people.detail.toast_note")}
        </p>
      </Section>

      {/* 9. Signals */}
      <Section title={serverT(language, "people.detail.signals")}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Chip
            value={detail.signals.mvpAwards}
            label={serverT(language, "people.signals.mvp")}
          />
          <Chip
            value={detail.signals.flaggedToImprove}
            label={serverT(language, "people.signals.flagged")}
          />
          <Chip
            value={
              detail.signals.mostActiveDay
                ? serverT(
                    language,
                    `people.weekday.${detail.signals.mostActiveDay}` as TranslationKey,
                  )
                : "—"
            }
            label={serverT(language, "people.signals.most_active")}
          />
          <Chip
            value={tenureLabel(detail.signals.tenureDays, language)}
            label={serverT(language, "people.signals.tenure")}
          />
        </div>
      </Section>
    </div>
  );
}
