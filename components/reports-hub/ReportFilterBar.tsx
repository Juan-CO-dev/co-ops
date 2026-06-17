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
 * Cash signal toggles (cashOver / cashShort) only render when viewerLevel >= 4
 * (REPORTS_HUB_CASH_LEVEL) — mirrors the base list-visibility gate.
 *
 * No client JS required — GET form updates the URL on submit.
 */

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { REPORTS_HUB_CASH_LEVEL, type ReportTypeKey } from "@/lib/reports-hub";

import { ActionButton } from "@/components/ActionButton";

const TYPE_KEYS: Record<ReportTypeKey, TranslationKey> = {
  opening: "reports.type.opening",
  closing: "reports.type.closing",
  am_prep: "reports.type.am_prep",
  mid_day: "reports.type.mid_day",
  cash: "reports.type.cash",
  pm: "reports.type.pm",
};

interface ActiveSignalFilters {
  underPar?: boolean;
  overPar?: boolean;
  skipped?: boolean;
  tempFlag?: boolean;
  cashOver?: boolean;
  cashShort?: boolean;
}

interface ReportFilterBarProps {
  locationId: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD
  selectedType: string; // "all" or a ReportTypeKey
  allowedTypes: ReportTypeKey[];
  language: Language;
  viewerLevel: number;
  activeSignalFilters?: ActiveSignalFilters;
}

export function ReportFilterBar({
  locationId,
  dateFrom,
  dateTo,
  selectedType,
  allowedTypes,
  language,
  viewerLevel,
  activeSignalFilters = {},
}: ReportFilterBarProps) {
  const t = (key: TranslationKey) => serverT(language, key);
  const canSeeCash = viewerLevel >= REPORTS_HUB_CASH_LEVEL;

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
            className="h-10 rounded-md border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text focus:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
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
          <ActionButton type="submit" variant="secondary">
            {t("reports.filter.apply")}
          </ActionButton>
        </div>
      </div>

      {/* Derived signal filter toggles — checkboxes submitted as "true" when checked */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-co-border pt-3">
        <span className="w-full text-xs font-bold uppercase tracking-[0.12em] text-co-text-muted">
          {t("reports.filter.signals_heading")}
        </span>

        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-co-text">
          <input
            type="checkbox"
            name="sf_underPar"
            value="true"
            defaultChecked={activeSignalFilters.underPar === true}
            className="accent-co-cta"
          />
          {t("reports.filter.under_par")}
        </label>

        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-co-text">
          <input
            type="checkbox"
            name="sf_overPar"
            value="true"
            defaultChecked={activeSignalFilters.overPar === true}
            className="accent-co-gold"
          />
          {t("reports.filter.over_par")}
        </label>

        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-co-text">
          <input
            type="checkbox"
            name="sf_skipped"
            value="true"
            defaultChecked={activeSignalFilters.skipped === true}
          />
          {t("reports.filter.skipped")}
        </label>

        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-co-text">
          <input
            type="checkbox"
            name="sf_tempFlag"
            value="true"
            defaultChecked={activeSignalFilters.tempFlag === true}
          />
          {t("reports.filter.temp_flag")}
        </label>

        {/* Cash toggles — only render for L4+ viewers (mirrors cash list-visibility gate) */}
        {canSeeCash ? (
          <>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-co-text">
              <input
                type="checkbox"
                name="sf_cashOver"
                value="true"
                defaultChecked={activeSignalFilters.cashOver === true}
              />
              {t("reports.filter.cash_over")}
            </label>

            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-co-text">
              <input
                type="checkbox"
                name="sf_cashShort"
                value="true"
                defaultChecked={activeSignalFilters.cashShort === true}
              />
              {t("reports.filter.cash_short")}
            </label>
          </>
        ) : null}
      </div>
    </form>
  );
}
