/**
 * MaintenanceReportDetail — server component.
 *
 * Renders one date's per-equipment maintenance snapshot at a location:
 * a header (equipment-log title + flag summary), then a per-equipment card —
 * label, status chip (reports.maint_status.<status>), the day's readings
 * ("AM 38°F · PM 40°F"), and that date's maintenance notes (text + byName).
 *
 * Pure render — no redaction logic here; the loader (loadMaintenanceReportDetail)
 * supplies exactly what this view shows. Plain text only.
 */

import { formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { MaintenanceReportDetail } from "@/lib/maintenance";

interface Props {
  detail: MaintenanceReportDetail;
  language: Language;
}

export function MaintenanceReportDetailView({ detail, language }: Props) {
  const t = (key: TranslationKey, params?: Record<string, string | number>) =>
    serverT(language, key, params);

  const dateLabel = formatDateLabel(detail.date, language);

  return (
    <div className="flex flex-col gap-4">
      {/* Header — title + date + flag summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-bold text-co-text">{t("reports.maint.title")}</span>
          <span className="text-xs text-co-text-muted">{dateLabel}</span>
        </div>
        <span
          className={
            detail.flagCount > 0
              ? "text-xs font-semibold text-co-danger"
              : "text-xs font-semibold text-co-text-muted"
          }
        >
          {detail.flagCount > 0
            ? t("reports.maint.flag_summary", { n: detail.flagCount })
            : t("reports.maint.all_ok")}
        </span>
      </div>

      {/* Per-equipment cards */}
      <ul className="flex flex-col gap-2">
        {detail.equipment.map((e) => (
          <li
            key={e.equipmentId}
            className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-co-text">{e.label}</span>
              <span
                className={
                  e.status === "out_of_range"
                    ? "shrink-0 text-[11px] font-bold uppercase text-co-danger"
                    : "shrink-0 text-[11px] font-bold uppercase text-co-text-muted"
                }
              >
                {t(`reports.maint_status.${e.status}` as TranslationKey)}
              </span>
            </div>

            {/* Day's readings — "AM 38°F · PM 40°F" */}
            {e.readings.length > 0 ? (
              <div className="mt-1 text-xs text-co-text-muted">
                {e.readings.map((r) => `${r.phase} ${r.valueF}°F`).join(" · ")}
              </div>
            ) : null}

            {/* Maintenance notes for this equipment on this date */}
            {e.notes.map((n) => (
              <div key={n.id} className="mt-1 rounded bg-co-bg px-2 py-1 text-xs text-co-text">
                {n.note}
                {n.byName !== null ? ` — ${n.byName}` : ""}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
