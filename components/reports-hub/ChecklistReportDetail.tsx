/**
 * ChecklistReportDetail — server component (Task 3).
 *
 * Renders a checklist-based report (opening / closing / am_prep / mid_day).
 * Items are grouped by station; per item: label, done ✓/—, by-name +
 * count_value when present, and the note ONLY when present (already
 * null-redacted by loadChecklistDetail for viewers below L5).
 *
 * Header: type label + date + status badge.
 * Highlights card: completion signal + par signal (prep only) + temp flag.
 * Prep values table: per-item label / par / on-hand / total (prep only).
 */

import { formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { ChecklistDetailItem, ChecklistReportDetail, PrepValueRow, ReportTypeKey } from "@/lib/reports-hub";

const TYPE_LABEL_KEYS: Record<ReportTypeKey, TranslationKey> = {
  opening: "reports.type.opening",
  closing: "reports.type.closing",
  am_prep: "reports.type.am_prep",
  mid_day: "reports.type.mid_day",
  cash: "reports.type.cash",
  pm: "reports.type.pm",
  maintenance: "reports.type.maintenance",
};

const STATUS_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  open: "reports.status.open",
  in_progress: "reports.status.in_progress",
  submitted: "reports.status.submitted",
  confirmed: "reports.status.confirmed",
};

function statusLabel(status: string, t: (k: TranslationKey) => string): string {
  const key = STATUS_LABEL_KEYS[status];
  return key ? t(key) : status;
}

function formatPrepValue(v: number | null): string {
  return v === null ? "—" : String(v);
}

interface PrepValuesTableProps {
  rows: PrepValueRow[];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

function PrepValuesTable({ rows, t }: PrepValuesTableProps) {
  return (
    <section>
      <h2 className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-co-text-muted">
        {t("reports.values.heading")}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-co-border text-left text-co-text-muted">
              <th className="pb-1 pr-3 font-semibold">{/* label col — no heading */}</th>
              <th className="pb-1 pr-3 font-semibold">{t("reports.values.par")}</th>
              <th className="pb-1 pr-3 font-semibold">{t("reports.values.on_hand")}</th>
              <th className="pb-1 font-semibold">{t("reports.values.total")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={idx}
                className={
                  row.parStatus === "under"
                    ? "text-co-cta"
                    : row.parStatus === "over"
                      ? "text-co-gold-deep"
                      : "text-co-text"
                }
              >
                <td className="py-1 pr-3 font-medium">{row.label}</td>
                <td className="py-1 pr-3">{formatPrepValue(row.par)}</td>
                <td className="py-1 pr-3">{formatPrepValue(row.onHand)}</td>
                <td className="py-1">{formatPrepValue(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface Props {
  detail: ChecklistReportDetail;
  language: Language;
}

export function ChecklistReportDetailView({ detail, language }: Props) {
  const t = (key: TranslationKey, params?: Record<string, string | number>) =>
    serverT(language, key, params);

  const { signals, prepValues } = detail;
  const hasPrepValues = prepValues.length > 0;

  // Group items by station (preserving order of first appearance)
  const stationOrder: string[] = [];
  const byStation = new Map<string, ChecklistDetailItem[]>();
  for (const item of detail.items) {
    if (!byStation.has(item.station)) {
      stationOrder.push(item.station);
      byStation.set(item.station, []);
    }
    byStation.get(item.station)!.push(item);
  }

  const typeLabel = t(TYPE_LABEL_KEYS[detail.type]);
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

      {/* Highlights card — completion signal + par (prep only) + temp flag */}
      <div className="flex flex-wrap gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-xs text-co-text-muted">
        <span>
          {t("reports.signal.completion", {
            done: signals.done,
            total: signals.total,
            skipped: signals.skipped,
          })}
        </span>
        {hasPrepValues && (
          <span>
            {t("reports.signal.par", {
              underPar: signals.underPar,
              overPar: signals.overPar,
            })}
          </span>
        )}
        {signals.tempFlags > 0 && (
          <span className="font-semibold text-co-danger">
            {t("reports.signal.temp_flag", { n: signals.tempFlags })}
          </span>
        )}
      </div>

      {/* Prep values table — only when this report has prep items */}
      {hasPrepValues && (
        <div className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2">
          <PrepValuesTable rows={prepValues} t={t} />
        </div>
      )}

      {/* Counts & readings — items with a count_value, for opening/closing types (or when no prep values).
          Rendered ABOVE the station body so temperature/count readings surface first. */}
      {(() => {
        const countItems = detail.items.filter((i) => i.countValue !== null);
        const showReadings =
          countItems.length > 0 &&
          ((detail.type !== "am_prep" && detail.type !== "mid_day") || prepValues.length === 0);
        if (!showReadings) return null;
        return (
          <div className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2">
            <h2 className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-co-text-muted">
              {t("reports.readings.heading")}
            </h2>
            <ul className="flex flex-col gap-1">
              {countItems.map((item, idx) => (
                <li
                  key={idx}
                  className={`flex items-center justify-between gap-2 text-xs${item.isTempFlag ? " text-co-cta" : " text-co-text"}`}
                >
                  <span className="font-medium">{item.label}</span>
                  <span>{item.countValue}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {/* Station groups */}
      {stationOrder.map((station) => {
        const stationItems = byStation.get(station) ?? [];
        return (
          <section key={station}>
            <h2 className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-co-text-muted">
              {station}
            </h2>
            <ul className="flex flex-col gap-1">
              {stationItems.map((item, idx) => (
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

                  {/* by-name + count_value (when present) */}
                  {(item.byName !== null || item.countValue !== null) && (
                    <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-co-text-muted">
                      {item.byName !== null && <span>{item.byName}</span>}
                      {item.countValue !== null && <span>{item.countValue}</span>}
                    </div>
                  )}

                  {/* Note — only rendered when non-null (loader already redacted below L5) */}
                  {item.note !== null && (
                    <div className="mt-1 rounded bg-co-bg px-2 py-1 text-xs text-co-text">
                      <span className="font-semibold">{t("reports.detail.note")}: </span>
                      {item.note}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
