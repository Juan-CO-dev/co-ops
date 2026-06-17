/**
 * PmReportDetail — server component (Task 4).
 *
 * Renders a PM report detail. All field-level redaction (notes below L5,
 * employee-only scope below L4) is enforced by the loader; this component
 * only renders what it receives — never renders a field the loader set to null.
 *
 * Security: all tier gates are in loadPmDetail; this component is a pure view.
 *
 * Gradient tally card: per-dimension great/good/needs_work counts (reflects
 * only the evals the viewer could already see — no new exposure).
 */

import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { Gradient, GradientTallyEntry, PmEvalDetail, PmReportDetail } from "@/lib/reports-hub";

const GRADIENT_KEY: Record<Gradient, TranslationKey> = {
  great: "pm.attitude.great",
  good: "pm.attitude.good",
  needs_work: "pm.attitude.needs_work",
};

const DIMENSION_LABEL_KEY: Record<GradientTallyEntry["dimension"], TranslationKey> = {
  arrivedReady: "pm.eval.arrived_ready",
  attitude: "pm.eval.attitude",
  production: "pm.eval.production",
  teamPlayer: "pm.eval.team_player",
};

interface GradientTallyCardProps {
  tally: GradientTallyEntry[];
  t: (key: TranslationKey) => string;
}

function GradientTallyCard({ tally, t }: GradientTallyCardProps) {
  // Only render when there is at least one eval
  const hasData = tally.some((e) => e.great + e.good + e.needsWork > 0);
  if (!hasData) return null;

  return (
    <section>
      <h2 className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-co-text-muted">
        {t("reports.pm.gradient_tally")}
      </h2>
      <div className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2">
        <ul className="flex flex-col gap-1">
          {tally.map((entry) => (
            <li key={entry.dimension} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-co-text-muted">{t(DIMENSION_LABEL_KEY[entry.dimension])}</span>
              <span className="flex gap-3">
                <span className="font-semibold text-co-success">
                  {t("pm.attitude.great")} {entry.great}
                </span>
                <span className="font-semibold text-co-text">
                  {t("pm.attitude.good")} {entry.good}
                </span>
                <span className="font-semibold text-co-danger">
                  {t("pm.attitude.needs_work")} {entry.needsWork}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

interface EvalCardProps {
  ev: PmEvalDetail;
  t: (key: TranslationKey) => string;
}

function EvalCard({ ev, t }: EvalCardProps) {
  const fields: Array<{ labelKey: TranslationKey; value: Gradient }> = [
    { labelKey: "pm.eval.arrived_ready", value: ev.arrivedReady },
    { labelKey: "pm.eval.attitude", value: ev.attitude },
    { labelKey: "pm.eval.production", value: ev.production },
    { labelKey: "pm.eval.team_player", value: ev.teamPlayer },
  ];

  return (
    <li className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm">
      {/* Employee name */}
      <div className="mb-2 font-bold text-co-text">{ev.employeeName ?? ev.employeeId}</div>

      {/* Structured gradients */}
      <ul className="flex flex-col gap-1">
        {fields.map(({ labelKey, value }) => (
          <li key={labelKey} className="flex items-center justify-between gap-2">
            <span className="text-xs text-co-text-muted">{t(labelKey)}</span>
            <span
              className={
                value === "great"
                  ? "text-xs font-semibold text-co-success"
                  : value === "needs_work"
                    ? "text-xs font-semibold text-co-danger"
                    : "text-xs font-semibold text-co-text"
              }
            >
              {t(GRADIENT_KEY[value])}
            </span>
          </li>
        ))}
      </ul>

      {/* Area to improve — only rendered when non-null */}
      {ev.areaToImprove !== null && (
        <div className="mt-2 rounded bg-co-bg px-2 py-1 text-xs text-co-text">
          <span className="font-semibold text-co-text-muted">{t("pm.eval.area_to_improve")}: </span>
          {ev.areaToImprove}
        </div>
      )}

      {/* Note — only rendered when non-null (loader already redacted below L5, never present for employees) */}
      {ev.note !== null && (
        <div className="mt-1 rounded bg-co-bg px-2 py-1 text-xs text-co-text">
          <span className="font-semibold text-co-text-muted">{t("reports.detail.note")}: </span>
          {ev.note}
        </div>
      )}
    </li>
  );
}

interface Props {
  detail: PmReportDetail;
  language: Language;
}

export function PmReportDetailView({ detail, language }: Props) {
  const t = (key: TranslationKey) => serverT(language, key);
  const dateLabel = formatDateLabel(detail.date, language);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-bold text-co-text">{t("reports.type.pm")}</span>
          <span className="text-xs text-co-text-muted">{dateLabel}</span>
        </div>
        {detail.submittedByName !== null && (
          <span className="text-xs text-co-text-muted">
            {t("reports.pm.submitted_by")}: {detail.submittedByName}
          </span>
        )}
      </div>

      {/* MVP — only rendered when mvpUserId is non-null (present for managers only) */}
      {detail.mvpUserId !== null && (
        <div className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm">
          <span className="font-semibold text-co-text-muted">{t("pm.mvp.heading")}: </span>
          <span className="font-bold text-co-text">{detail.mvpName ?? detail.mvpUserId}</span>
          {detail.mvpNote !== null && (
            <span className="ml-1 text-co-text-muted"> — {detail.mvpNote}</span>
          )}
        </div>
      )}

      {/* Gradient tally card — reflects only evals visible to this viewer (no new exposure) */}
      <GradientTallyCard tally={detail.gradientTally} t={t} />

      {/* Evals */}
      {detail.evals.length > 0 && (
        <section>
          <ul className="flex flex-col gap-2">
            {detail.evals.map((ev) => (
              <EvalCard key={ev.id} ev={ev} t={t} />
            ))}
          </ul>
        </section>
      )}

      {/* Shift activity — only rendered for managers (L4+); loader returns empty arrays for employees. */}
      {(detail.wrapUp.length > 0 || detail.reportProgress.length > 0) && (
        <section>
          <h2 className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-co-text-muted">
            {t("reports.pm.shift_activity")}
          </h2>
          <div className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2">
            {/* Per-employee summary: {name}: {itemsCompleted} items · {reportsSubmitted} reports */}
            {detail.wrapUp.length > 0 && (
              <ul className="mb-2 flex flex-col gap-1 text-xs text-co-text">
                {detail.wrapUp.map((row) => (
                  <li key={row.userId}>
                    <span className="font-medium">{row.name ?? row.userId}</span>
                    {`: ${row.itemsCompleted} items · ${row.reportsSubmitted} reports`}
                  </li>
                ))}
              </ul>
            )}
            {/* Per-report progress rows — no overdue (misleading on historical reports) */}
            {detail.reportProgress.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-co-text-muted">
                {detail.reportProgress.map((r) => (
                  <li key={r.key} className="flex items-center justify-between gap-2">
                    <span>{t(`midshift.report.${r.key}` as Parameters<typeof t>[0])}</span>
                    <span className={r.progress === "done" ? "font-semibold text-co-success" : r.progress === "in_progress" ? "font-semibold text-co-text" : "text-co-text-muted"}>
                      {t(`midshift.progress.${r.progress}` as Parameters<typeof t>[0])}
                      {r.doneAt !== null && r.progress === "done" && (
                        <> · {formatTime(r.doneAt, language)}</>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
