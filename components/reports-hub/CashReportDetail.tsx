/**
 * CashReportDetail — server component (Task 4).
 *
 * Renders a cash report detail. Fields that were null-redacted by the loader
 * (overShortNote below L5) are never rendered here — they arrive as null.
 *
 * Security: all redaction is in loadCashDetail; this component only renders
 * what it receives.
 *
 * Highlights card: over/short readout from signals.cashOverShortCents.
 */

import { formatCents, formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { CashReportDetail } from "@/lib/reports-hub";

interface Props {
  detail: CashReportDetail;
  language: Language;
}

export function CashReportDetailView({ detail, language }: Props) {
  const t = (key: TranslationKey, params?: Record<string, string | number>) =>
    serverT(language, key, params);
  const centsToDisplay = (cents: number) => `${cents > 0 ? "+" : ""}${formatCents(cents, language)}`;
  const dateLabel = formatDateLabel(detail.date, language);

  const overShortCents = detail.signals.cashOverShortCents;

  const rows: Array<{ label: TranslationKey; value: string }> = [
    { label: "reports.cash.projected", value: formatCents(detail.projectedCents, language) },
    { label: "reports.cash.drawer", value: formatCents(detail.drawerTotalCents, language) },
    { label: "reports.cash.float", value: formatCents(detail.floatCents, language) },
    { label: "reports.cash.deposit", value: formatCents(detail.depositCents, language) },
    { label: "reports.cash.over_short", value: centsToDisplay(detail.overShortCents) },
    { label: "reports.cash.tips", value: formatCents(detail.cashTipsCents, language) },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-bold text-co-text">{t("reports.type.cash")}</span>
          <span className="text-xs text-co-text-muted">{dateLabel}</span>
        </div>
        {detail.signedByName !== null && (
          <span className="text-xs text-co-text-muted">
            {t("reports.cash.signed_by")}: {detail.signedByName}
          </span>
        )}
      </div>

      {/* Highlights card — over/short signal from signals.cashOverShortCents */}
      {overShortCents !== null && (
        <div
          className={[
            "flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-xs font-semibold",
            overShortCents > 0
              ? "border-co-border bg-co-surface text-co-confirm-text"
              : overShortCents < 0
                ? "border-co-border bg-co-surface text-co-cta-text"
                : "border-co-border bg-co-surface text-co-text-muted",
          ].join(" ")}
        >
          {overShortCents > 0
            ? t("reports.signal.cash_over", { amount: centsToDisplay(overShortCents) })
            : overShortCents < 0
              ? t("reports.signal.cash_short", { amount: centsToDisplay(overShortCents) })
              : t("reports.signal.cash_even")}
        </div>
      )}

      {/* Money summary */}
      <section>
        <ul className="flex flex-col gap-1">
          {rows.map(({ label, value }) => (
            <li
              key={label}
              className="flex items-center justify-between rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm"
            >
              <span className="text-co-text-muted">{t(label)}</span>
              <span
                className={
                  label === "reports.cash.over_short"
                    ? detail.overShortCents < 0
                      ? "font-semibold text-co-cta-text"
                      : detail.overShortCents > 0
                        ? "font-semibold text-co-confirm-text"
                        : "font-semibold text-co-text"
                    : "font-semibold text-co-text"
                }
              >
                {value}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Over/short note — only rendered when non-null (loader already redacted below L5) */}
      {detail.overShortNote !== null && (
        <div className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm">
          <span className="font-semibold text-co-text-muted">{t("reports.detail.note")}: </span>
          <span className="text-co-text">{detail.overShortNote}</span>
        </div>
      )}

      {/* On-shift employees */}
      {detail.onShift.length > 0 && (
        <section>
          <h2 className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-co-text-muted">
            {t("reports.cash.on_shift")}
          </h2>
          <ul className="flex flex-col gap-1">
            {detail.onShift.map((entry, idx) => (
              <li
                key={entry.userId ?? idx}
                className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm text-co-text"
              >
                {entry.name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
