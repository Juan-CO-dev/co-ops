/**
 * ReportList — server component.
 *
 * Renders the list of ReportListItem rows returned by listReports.
 * Each row: date label · type label · submitter · status.
 * Each row links to /reports/<type>/<id>?location=<locationId>.
 * Empty list → reports.empty message.
 *
 * Mirrors maintenance card token styling.
 */

import { formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { ReportListItem, ReportTypeKey } from "@/lib/reports-hub";

const TYPE_LABEL_KEYS: Record<ReportTypeKey, TranslationKey> = {
  opening: "reports.type.opening",
  closing: "reports.type.closing",
  am_prep: "reports.type.am_prep",
  mid_day: "reports.type.mid_day",
  cash: "reports.type.cash",
  pm: "reports.type.pm",
};

interface ReportListProps {
  items: ReportListItem[];
  locationId: string;
  language: Language;
}

export function ReportList({ items, locationId, language }: ReportListProps) {
  const t = (key: TranslationKey) => serverT(language, key);

  if (items.length === 0) {
    return (
      <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
        {t("reports.empty")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => {
        const href = `/reports/${item.type}/${item.id}?location=${locationId}`;
        const dateLabel = formatDateLabel(item.date, language);
        const typeLabel = t(TYPE_LABEL_KEYS[item.type]);

        return (
          <li key={item.id}>
            <a
              href={href}
              className="flex flex-col gap-0.5 rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm hover:opacity-90"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-co-text">{dateLabel}</span>
                <span className="rounded-full border border-co-border px-2 py-0.5 text-xs font-semibold text-co-text-muted">
                  {typeLabel}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-co-text-muted">
                {item.submitterName ? (
                  <span>
                    {t("reports.col.by")}: {item.submitterName}
                  </span>
                ) : null}
                <span>
                  {t("reports.col.status")}: {item.status}
                </span>
              </div>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
