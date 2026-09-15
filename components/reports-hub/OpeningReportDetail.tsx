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
 *
 * LRA-205 adds the PHASE 2 block: what the opener actually prepped against the
 * need Phase 1 derived, the over/under status and its reason, and the per-item
 * save provenance. Without it a manager reading a finalized opening could see
 * the verification but never its outcome.
 */

import { interpretAnswer } from "@/lib/checklist-answers";
import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { OpeningDetailItem, OpeningReportDetail } from "@/lib/reports-hub";
import { reportStatusLabel } from "./shared";

/**
 * Fulledit PR-2 (0165): render a question line's ANSWER via interpretAnswer —
 * yes → "Yes" ✓ (success tone) · no → "No" ✗ (danger tone) · free_text → the
 * notes string. Reconstructed from the item's redaction-respecting fields (note
 * is null below L5). Null for non-question lines. (Opening question lines are
 * rare — the phase-1 submit path carries no input_type today — but the report
 * renders them symmetrically with closing.)
 */
function QuestionAnswer({
  item,
  t,
}: {
  item: Pick<OpeningDetailItem, "inputType" | "countValue" | "note" | "done">;
  t: (key: TranslationKey) => string;
}) {
  if (item.inputType !== "yes_no" && item.inputType !== "free_text") return null;
  if (!item.done) return null;
  const answer = interpretAnswer(
    { inputType: item.inputType, expectsCount: false },
    { countValue: item.countValue, notes: item.note },
  );
  if (!answer) return null;
  if (answer.kind === "yes") {
    return <span className="font-bold text-co-confirm-text">{t("reports.detail.answer_yes")}</span>;
  }
  if (answer.kind === "no") {
    return <span className="font-bold text-co-cta-text">{t("reports.detail.answer_no")}</span>;
  }
  if (answer.kind === "text") {
    const text = typeof answer.value === "string" ? answer.value : "";
    if (text.trim() === "") return null;
    return <span className="text-co-text">{text}</span>;
  }
  return null;
}

/**
 * Reason-category label keys. The vocabulary is CLOSED (validated at
 * app/api/opening/prep/item/route.ts before the RPC ever sees it) and these are
 * the SAME keys the capture modals render — OverParModal reads
 * `opening.over_par.reason.*`, UnderParModal reads
 * `notifications.under_par_alert.reason.*`. Reused rather than re-spelled so the
 * report and the modal can never drift apart in either language.
 */
const OVER_PREP_REASON_KEYS: Readonly<Record<string, TranslationKey>> = {
  management_directive: "opening.over_par.reason.management_directive",
  clear_fridge_space: "opening.over_par.reason.clear_fridge_space",
  prevent_expiration: "opening.over_par.reason.prevent_expiration",
  forecast_busy: "opening.over_par.reason.forecast_busy",
  bulk_efficiency: "opening.over_par.reason.bulk_efficiency",
  other: "opening.over_par.reason.other",
};
const UNDER_PREP_REASON_KEYS: Readonly<Record<string, TranslationKey>> = {
  ingredient_unavailable: "notifications.under_par_alert.reason.ingredient_unavailable",
  equipment_issue: "notifications.under_par_alert.reason.equipment_issue",
  time_constraint: "notifications.under_par_alert.reason.time_constraint",
  staff_shortage: "notifications.under_par_alert.reason.staff_shortage",
  other: "notifications.under_par_alert.reason.other",
};

/** Status tone — the report's existing text roles (AGENTS.md token law). */
const PHASE2_STATUS_TONE: Readonly<Record<string, string>> = {
  at_par: "text-co-confirm-text",
  over_prep: "text-co-warning-text",
  under_prep: "text-co-cta-text",
};

/**
 * Phase 2 outcome block (LRA-205) — rendered only when the item has a live
 * phase-2 completion. The FIRST line is the opener-prepped quantity, and it
 * deliberately opens with the exact words of `opening.phase2.opener_prepped_label`
 * in each language: the opening journey's report assertion matches
 * "<label>: <number>" on this row, and `tests/reports-hub-phase2.test.ts` pins
 * that prefix so a copy edit cannot silently break the contract.
 */
function Phase2Outcome({
  phase2,
  language,
  t,
}: {
  phase2: NonNullable<OpeningDetailItem["phase2"]>;
  language: Language;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const { overUnderStatus, deltaVsPrepNeed, reasonCategory } = phase2;
  const reasonKey =
    reasonCategory === null
      ? null
      : overUnderStatus === "over_prep"
        ? (OVER_PREP_REASON_KEYS[reasonCategory] ?? null)
        : overUnderStatus === "under_prep"
          ? (UNDER_PREP_REASON_KEYS[reasonCategory] ?? null)
          : null;
  // Defensive: an out-of-vocabulary category still shows its raw value rather
  // than an untranslated key or nothing at all.
  const reasonLabel = reasonKey !== null ? t(reasonKey) : reasonCategory;
  const savedTime = phase2.savedAt !== null ? formatTime(phase2.savedAt, language) : "";
  const savedName = phase2.savedByName ?? t("opening.phase2.save.saved_by_unknown");

  return (
    <div className="mt-1 flex flex-col gap-0.5 rounded bg-co-bg px-2 py-1.5 text-xs text-co-text">
      {/* The outcome itself — Phase 2's whole reason for existing. */}
      <span className="font-semibold">
        {t("reports.opening.opener_prepped", { value: phase2.openerPrepped })}
      </span>

      {/* Status pill + signed delta against the derived prep need. */}
      {overUnderStatus !== null && (
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border border-co-border px-2 py-0.5 font-semibold ${
              PHASE2_STATUS_TONE[overUnderStatus] ?? "text-co-text-muted"
            }`}
          >
            {t(`reports.opening.phase2.status.${overUnderStatus}` as TranslationKey)}
          </span>
          {deltaVsPrepNeed !== null && deltaVsPrepNeed !== 0 && (
            <span className="text-co-text-muted">
              {t("reports.opening.phase2.delta", {
                delta: deltaVsPrepNeed > 0 ? `+${deltaVsPrepNeed}` : String(deltaVsPrepNeed),
              })}
            </span>
          )}
        </span>
      )}

      {/* Why, when a reason was captured. */}
      {reasonLabel !== null && (
        <span className="text-co-text-muted">
          {t("reports.opening.phase2.reason", { reason: reasonLabel })}
        </span>
      )}
      {/* Operator free text — the loader nulls this below L5. */}
      {phase2.reasonText !== null && (
        <span className="text-co-text-muted">
          {t("reports.opening.phase2.reason_note", { text: phase2.reasonText })}
        </span>
      )}

      {/* Accountability: the manager who directed an over-prep. */}
      {phase2.directedByName !== null && (
        <span className="text-co-text-muted">
          {t("reports.opening.phase2.directed_by", { name: phase2.directedByName })}
        </span>
      )}

      {/* Per-item save provenance (C.52). House time formatter, never toLocale*. */}
      {(phase2.savedByName !== null || phase2.savedAt !== null) && (
        <span className="text-co-text-muted">
          {savedTime !== ""
            ? t("opening.phase2.save.saved_by_at", { name: savedName, time: savedTime })
            : t("reports.opening.phase2.saved_by", { name: savedName })}
        </span>
      )}
    </div>
  );
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
  const statusText = reportStatusLabel(detail.status, t);

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
          <span className="font-semibold text-co-cta-text">
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
                            ? "shrink-0 font-bold text-co-confirm-text"
                            : "shrink-0 text-co-text-muted"
                        }
                      >
                        {item.done ? t("reports.detail.done") : t("reports.detail.not_done")}
                      </span>
                    </div>

                    {/* by-name + answer/temp reading. Question lines (yes_no /
                        free_text) render their ANSWER via interpretAnswer; other
                        lines keep the temp reading (Fulledit PR-2). */}
                    {(item.byName !== null || item.countValue !== null || item.inputType !== null) && (
                      <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-co-text-muted">
                        {item.byName !== null && <span>{item.byName}</span>}
                        {item.inputType !== null ? (
                          <QuestionAnswer item={item} t={t} />
                        ) : (
                          item.countValue !== null && (
                            <span>
                              {t("reports.opening.temp_reading", { value: item.countValue })}
                            </span>
                          )
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

                    {/* Phase 2 outcome — what was actually prepped against the
                        need Phase 1 derived (LRA-205). Under dual membership the
                        same line carries both phases' data. */}
                    {item.phase2 !== null && (
                      <Phase2Outcome phase2={item.phase2} language={language} t={t} />
                    )}

                    {/* Note — only when non-null (loader redacts below L5). Suppressed
                        on free_text lines: their notes ARE the answer (shown above). */}
                    {item.note !== null && item.inputType !== "free_text" && (
                      <div className="mt-1 rounded bg-co-bg px-2 py-1 text-xs text-co-text">
                        <span className="font-semibold">{t("reports.detail.note")}: </span>
                        {item.note}
                      </div>
                    )}

                    {/* Attached photo link — visible to any viewer of the report (0164). */}
                    {item.photoId !== null && (
                      <a
                        href={`/api/photos/${item.photoId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex text-xs font-semibold text-co-cta-text underline"
                      >
                        {t("reports.detail.photo")}
                      </a>
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
