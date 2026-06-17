/**
 * ReportFilterBar — server component.
 *
 * A plain `<form method="get">` filter bar for the /reports list page.
 * Preserves the ?location= param via a hidden field so navigation within
 * the page keeps the active location.
 *
 * Cash type shown only when the viewer's level permits (filtered by the
 * page before passing `allowedTypes` here).
 *
 * No client JS required — GET form updates the URL on submit.
 */

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { ReportTypeKey } from "@/lib/reports-hub";

const TYPE_KEYS: Record<ReportTypeKey, TranslationKey> = {
  opening: "reports.type.opening",
  closing: "reports.type.closing",
  am_prep: "reports.type.am_prep",
  mid_day: "reports.type.mid_day",
  cash: "reports.type.cash",
  pm: "reports.type.pm",
};

interface ReportFilterBarProps {
  locationId: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD
  selectedType: string; // "all" or a ReportTypeKey
  allowedTypes: ReportTypeKey[];
  language: Language;
}

export function ReportFilterBar({
  locationId,
  dateFrom,
  dateTo,
  selectedType,
  allowedTypes,
  language,
}: ReportFilterBarProps) {
  const t = (key: TranslationKey) => serverT(language, key);

  return (
    <form method="get" className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3">
      {/* Preserve active location across filter submits */}
      <input type="hidden" name="location" value={locationId} />

      <div className="flex flex-wrap gap-3">
        {/* Date from */}
        <div className="flex flex-col gap-1">
          <label htmlFor="rpt-from" className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
            {t("reports.filter.from")}
          </label>
          <input
            id="rpt-from"
            type="date"
            name="from"
            defaultValue={dateFrom}
            className="rounded border border-co-border bg-co-bg px-2 py-1 text-sm text-co-text"
          />
        </div>

        {/* Date to */}
        <div className="flex flex-col gap-1">
          <label htmlFor="rpt-to" className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
            {t("reports.filter.to")}
          </label>
          <input
            id="rpt-to"
            type="date"
            name="to"
            defaultValue={dateTo}
            className="rounded border border-co-border bg-co-bg px-2 py-1 text-sm text-co-text"
          />
        </div>

        {/* Report type */}
        <div className="flex flex-col gap-1">
          <label htmlFor="rpt-type" className="text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
            {t("reports.filter.type")}
          </label>
          <select
            id="rpt-type"
            name="type"
            defaultValue={selectedType}
            className="rounded border border-co-border bg-co-bg px-2 py-1 text-sm text-co-text"
          >
            <option value="all">{t("reports.filter.all_types")}</option>
            {allowedTypes.map((typeKey) => (
              <option key={typeKey} value={typeKey}>
                {t(TYPE_KEYS[typeKey])}
              </option>
            ))}
          </select>
        </div>

        {/* Submit */}
        <div className="flex items-end">
          <button
            type="submit"
            className="rounded-full border-2 border-co-border bg-co-surface px-4 py-1.5 text-sm font-semibold text-co-text hover:opacity-90"
          >
            {t("reports.filter.apply")}
          </button>
        </div>
      </div>
    </form>
  );
}
