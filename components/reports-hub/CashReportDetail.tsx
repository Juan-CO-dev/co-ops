/**
 * CashReportDetail — server component (Task 4).
 *
 * Renders a cash report detail. Fields that were null-redacted by the loader
 * (overShortNote below L5) are never rendered here — they arrive as null.
 *
 * Security: all redaction is in loadCashDetail; this component only renders
 * what it receives.
 */

import { formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { CashReportDetail } from "@/lib/reports-hub";

function centsToDisplay(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const pennies = abs % 100;
  const sign = cents < 0 ? "-" : cents > 0 ? "+" : "";
  return `${sign}$${dollars}.${String(pennies).padStart(2, "0")}`;
}

function centsToPositiveDisplay(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const pennies = cents % 100;
  return `$${dollars}.${String(pennies).padStart(2, "0")}`;
}

interface Props {
  detail: CashReportDetail;
  language: Language;
}

export function CashReportDetailView({ detail, language }: Props) {
  const t = (key: TranslationKey) => serverT(language, key);
  const dateLabel = formatDateLabel(detail.date, language);

  const rows: Array<{ label: TranslationKey; value: string }> = [
    { label: "reports.cash.projected", value: centsToPositiveDisplay(detail.projectedCents) },
    { label: "reports.cash.drawer", value: centsToPositiveDisplay(detail.drawerTotalCents) },
    { label: "reports.cash.float", value: centsToPositiveDisplay(detail.floatCents) },
    { label: "reports.cash.deposit", value: centsToPositiveDisplay(detail.depositCents) },
    { label: "reports.cash.over_short", value: centsToDisplay(detail.overShortCents) },
    { label: "reports.cash.tips", value: centsToPositiveDisplay(detail.cashTipsCents) },
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

      {/* Money summary */}
      <section>
        <ul className="flex flex-col gap-1">
          {rows.map(({ label, value }) => (
            <li
              key={label}
              className="flex items-center justify-between rounded-lg border border-co-border bg-co-surface px-3 py-2 text-sm"
            >
              <span className="text-co-text-muted">{t(label)}</span>
              <span
                className={
                  label === "reports.cash.over_short"
                    ? detail.overShortCents < 0
                      ? "font-semibold text-co-danger"
                      : detail.overShortCents > 0
                        ? "font-semibold text-co-success"
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
        <div className="rounded-lg border border-co-border bg-co-surface px-3 py-2 text-sm">
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
                className="rounded-lg border border-co-border bg-co-surface px-3 py-2 text-sm text-co-text"
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
