/**
 * ChecklistReportDetail — server component (Task 3).
 *
 * Renders a checklist-based report (opening / closing / am_prep / mid_day).
 * Items are grouped by station; per item: label, done ✓/—, by-name +
 * count_value when present, and the note ONLY when present (already
 * null-redacted by loadChecklistDetail for viewers below L5).
 *
 * Header: type label + date + status badge.
 */

import { formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { ChecklistDetailItem, ChecklistReportDetail, ReportTypeKey } from "@/lib/reports-hub";

const TYPE_LABEL_KEYS: Record<ReportTypeKey, TranslationKey> = {
  opening: "reports.type.opening",
  closing: "reports.type.closing",
  am_prep: "reports.type.am_prep",
  mid_day: "reports.type.mid_day",
  cash: "reports.type.cash",
  pm: "reports.type.pm",
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

interface Props {
  detail: ChecklistReportDetail;
  language: Language;
}

export function ChecklistReportDetailView({ detail, language }: Props) {
  const t = (key: TranslationKey) => serverT(language, key);

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
                  className="rounded-lg border border-co-border bg-co-surface px-3 py-2 text-sm"
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
