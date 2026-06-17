/**
 * PmReportDetail — server component (Task 4).
 *
 * Renders a PM report detail. All field-level redaction (notes below L5,
 * employee-only scope below L4) is enforced by the loader; this component
 * only renders what it receives — never renders a field the loader set to null.
 *
 * Security: all tier gates are in loadPmDetail; this component is a pure view.
 */

import { formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { Gradient, PmEvalDetail, PmReportDetail } from "@/lib/reports-hub";

const GRADIENT_KEY: Record<Gradient, TranslationKey> = {
  great: "pm.attitude.great",
  good: "pm.attitude.good",
  needs_work: "pm.attitude.needs_work",
};

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
    <li className="rounded-lg border border-co-border bg-co-surface px-3 py-3 text-sm">
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
        <div className="rounded-lg border border-co-border bg-co-surface px-3 py-2 text-sm">
          <span className="font-semibold text-co-text-muted">{t("pm.mvp.heading")}: </span>
          <span className="font-bold text-co-text">{detail.mvpName ?? detail.mvpUserId}</span>
          {detail.mvpNote !== null && (
            <span className="ml-1 text-co-text-muted"> — {detail.mvpNote}</span>
          )}
        </div>
      )}

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
    </div>
  );
}
