/**
 * OpeningReportDetail — server component (Reports Hub opening detail).
 *
 * Read-only mirror of the opening Phase 1 verification surface. Where the
 * generic ChecklistReportDetail showed only count_value (the fridge temp), this
 * view surfaces, per spot-check item:
 *   - the opener's RECOUNT value (prep_data->phase1.opener_recount),
 *   - the BASELINE it verified against — the prior-day closer count, OR a clear
 *     "Recount — no prior-day submission" label when that baseline is NULL,
 *   - the resolved ground truth + prep need where meaningful.
 *
 * A prominent report-level banner flags the NULL-sentinel case (the whole
 * opening was a recount-because-no-prior-day-submission).
 */

import { formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { OpeningDetailItem, OpeningReportDetail } from "@/lib/reports-hub";

const STATUS_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  open: "reports.status.open",
  in_progress: "reports.status.in_progress",
  phase1_complete: "reports.status.phase1_complete",
  phase2_complete: "reports.status.phase2_complete",
  submitted: "reports.status.submitted",
  confirmed: "reports.status.confirmed",
  incomplete_confirmed: "reports.status.incomplete_confirmed",
  auto_finalized: "reports.status.auto_finalized",
};

function statusLabel(status: string, t: (k: TranslationKey) => string): string {
  const key = STATUS_LABEL_KEYS[status];
  return key ? t(key) : status;
}

interface Props {
  detail: OpeningReportDetail;
  language: Language;
}

export function OpeningReportDetailView({ detail, language }: Props) {
  const t = (key: TranslationKey, params?: Record<string, string | number>) =>
    serverT(language, key, params);

  const { signals } = detail;

  // Group items by station (preserving order of first appearance).
  const stationOrder: string[] = [];
  const byStation = new Map<string, OpeningDetailItem[]>();
  for (const item of detail.items) {
    if (!byStation.has(item.station)) {
      stationOrder.push(item.station);
      byStation.set(item.station, []);
    }
    byStation.get(item.station)!.push(item);
  }

  const typeLabel = t("reports.type.opening");
  const dateLabel = formatDateLabel(detail.date, language);
  const statusText = statusLabel(detail.status, t);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-bold text-co-text">{typeLabel}</span>
          <span className="text-xs text-co-text-muted">{dateLabel}</span>
        </div>
        <span className="rounded-full border border-co-border px-2 py-0.5 text-xs font-semibold text-co-text-muted">
          {statusText}
        </span>
      </div>

      {/* NULL-sentinel banner — the whole opening was a recount because there was
          no prior-day AM-Prep submission to verify against. */}
      {detail.isRecountNoPriorSubmission && (
        <div
          role="note"
          className="rounded-lg border-2 border-co-gold bg-co-warning-surface px-3 py-2 text-xs text-co-text"
        >
          <p className="font-bold uppercase tracking-wide text-co-text">
            {t("reports.opening.no_prior_submission.title")}
          </p>
          <p className="mt-0.5 text-co-text-muted">
            {detail.noPriorDataReason !== null
              ? t("reports.opening.no_prior_submission.body_with_reason", {
                  reason: t(
                    `reports.opening.no_prior_reason.${detail.noPriorDataReason}` as TranslationKey,
                  ),
                })
              : t("reports.opening.no_prior_submission.body")}
          </p>
        </div>
      )}

      {/* Completion + temp-flag signal */}
      <div className="flex flex-wrap gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-xs text-co-text-muted">
        <span>
          {t("reports.signal.completion", {
            done: signals.done,
            total: signals.total,
            skipped: signals.skipped,
          })}
        </span>
        {signals.tempFlags > 0 && (
          <span className="font-semibold text-co-danger">
            {t("reports.signal.temp_flag", { n: signals.tempFlags })}
          </span>
        )}
      </div>

      {/* Station groups */}
      {stationOrder.map((station) => {
        const stationItems = byStation.get(station) ?? [];
        return (
          <section key={station}>
            <h2 className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-co-text-muted">
              {station}
            </h2>
            <ul className="flex flex-col gap-1">
              {stationItems.map((item, idx) => {
                const isSpotCheck = item.baseline !== null;
                const baselineNull =
                  item.baseline !== null && item.baseline.closerCount === null;
                return (
                  <li
                    key={`${station}-${idx}`}
                    className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-co-text">{item.label}</span>
                      <span
                        className={
                          item.done
                            ? "shrink-0 font-bold text-co-success"
                            : "shrink-0 text-co-text-muted"
                        }
                      >
                        {item.done ? t("reports.detail.done") : t("reports.detail.not_done")}
                      </span>
                    </div>

                    {/* by-name + temp reading (when present) */}
                    {(item.byName !== null || item.countValue !== null) && (
                      <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-co-text-muted">
                        {item.byName !== null && <span>{item.byName}</span>}
                        {item.countValue !== null && (
                          <span>
                            {t("reports.opening.temp_reading", { value: item.countValue })}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Spot-check verification detail: recount value, the baseline
                        it verified against (or the no-prior-submission label), and
                        the resolved ground-truth / prep-need. */}
                    {isSpotCheck && (
                      <div className="mt-1 flex flex-col gap-0.5 rounded bg-co-bg px-2 py-1.5 text-xs text-co-text">
                        {/* Resolution label */}
                        <span className="font-semibold uppercase tracking-wide text-co-text-muted">
                          {item.resolution === "recount"
                            ? baselineNull
                              ? t("reports.opening.resolution.recount_no_prior")
                              : t("reports.opening.resolution.recount")
                            : t("reports.opening.resolution.section_verify")}
                        </span>

                        {/* Baseline */}
                        <span className="text-co-text-muted">
                          {baselineNull
                            ? t("reports.opening.baseline.none")
                            : t("reports.opening.baseline.closer", {
                                closer: item.baseline!.closerCount as number,
                              })}
                          {item.baseline!.par !== null
                            ? " · " +
                              t("reports.opening.baseline.par", { par: item.baseline!.par })
                            : ""}
                        </span>

                        {/* Recount value (when the opener recounted) */}
                        {item.openerRecount !== null && (
                          <span>
                            {t("reports.opening.recount_value", { value: item.openerRecount })}
                          </span>
                        )}

                        {/* Resolved ground truth + prep need */}
                        {item.groundTruth !== null && (
                          <span>
                            {t("reports.opening.ground_truth", { value: item.groundTruth })}
                            {item.prepNeed !== null
                              ? " · " +
                                t("reports.opening.prep_need", { value: item.prepNeed })
                              : ""}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Note — only when non-null (loader redacts below L5) */}
                    {item.note !== null && (
                      <div className="mt-1 rounded bg-co-bg px-2 py-1 text-xs text-co-text">
                        <span className="font-semibold">{t("reports.detail.note")}: </span>
                        {item.note}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
