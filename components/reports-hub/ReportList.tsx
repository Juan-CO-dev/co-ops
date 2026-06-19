/**
 * ReportList — server component.
 *
 * Renders the list of ReportListItem rows returned by listReports.
 * Each row: date label · type label · submitter · status · signal badges.
 * Each row links to /reports/<type>/<id>?location=<locationId>.
 * Empty list → reports.empty message.
 *
 * Signal badges (under-par count, temp flags, cash over/short) are rendered
 * from item.signalSummary when present. Cash badge only shown for L4+ viewers
 * (mirrors the base cash list-visibility gate).
 *
 * Mirrors maintenance card token styling.
 */

import { formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { REPORTS_HUB_CASH_LEVEL, type ReportListItem, type ReportTypeKey } from "@/lib/reports-hub";
import type { SearchSnippet } from "@/lib/reports-search";

const TYPE_LABEL_KEYS: Record<ReportTypeKey, TranslationKey> = {
  opening: "reports.type.opening",
  closing: "reports.type.closing",
  am_prep: "reports.type.am_prep",
  mid_day: "reports.type.mid_day",
  cash: "reports.type.cash",
  pm: "reports.type.pm",
  maintenance: "reports.type.maintenance",
};

// Map DB status enum → translation key. Mirrors ChecklistReportDetail's
// STATUS_LABEL_KEYS; partial because status values outside this set
// (e.g. incomplete_confirmed, auto_finalized) fall back to the raw string.
const STATUS_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  open: "reports.status.open",
  in_progress: "reports.status.in_progress",
  submitted: "reports.status.submitted",
  confirmed: "reports.status.confirmed",
  // Maintenance synthetic digest rows carry status "flags" | "ok"; the
  // out-of-range count is already surfaced in the temp signal badge, so these
  // map through the param-less status convention like the other types.
  flags: "reports.maint_status_row.flags",
  ok: "reports.maint_status_row.ok",
};

/** Format cents as a dollar string, e.g. 150 → "$1.50". */
function formatCents(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

interface ReportListProps {
  items: ReportListItem[];
  locationId: string;
  language: Language;
  viewerLevel: number;
  /** Active quick-find query; when set + no matches, shows the search-empty message. */
  searchQuery?: string;
  /** Per-row "where it matched" snippet, keyed `${type}:${id}`. */
  snippets?: Map<string, SearchSnippet>;
}

export function ReportList({ items, locationId, language, viewerLevel, searchQuery, snippets }: ReportListProps) {
  const t = (key: TranslationKey) => serverT(language, key);
  const canSeeCash = viewerLevel >= REPORTS_HUB_CASH_LEVEL;

  if (items.length === 0) {
    const q = searchQuery?.trim();
    const message = q ? serverT(language, "reports.search.empty", { q }) : t("reports.empty");
    return (
      <p className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm font-semibold text-co-text">
        {message}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => {
        const href = `/reports/${item.type}/${item.id}?location=${locationId}`;
        const dateLabel = formatDateLabel(item.date, language);
        const typeLabel = t(TYPE_LABEL_KEYS[item.type]);
        const statusKey = STATUS_LABEL_KEYS[item.status];
        const statusLabel = statusKey ? t(statusKey) : item.status;
        const s = item.signalSummary;
        const snip = snippets?.get(`${item.type}:${item.id}`);

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
                  {t("reports.col.status")}: {statusLabel}
                </span>
              </div>

              {/* Signal badges — derived from signalSummary, always attached by listReports */}
              {s ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {s.underPar > 0 ? (
                    <span className="rounded-full border border-co-cta/30 bg-co-cta/10 px-2 py-0.5 text-xs font-semibold text-co-cta">
                      {t("reports.badge.under_par").replace("{count}", String(s.underPar))}
                    </span>
                  ) : null}
                  {s.tempFlags > 0 ? (
                    <span className="rounded-full border border-co-border bg-co-gold/20 px-2 py-0.5 text-xs font-semibold text-co-text">
                      {t("reports.badge.temp").replace("{count}", String(s.tempFlags))}
                    </span>
                  ) : null}
                  {canSeeCash && s.cashOverShortCents !== null && s.cashOverShortCents > 0 ? (
                    <span className="rounded-full border border-co-border bg-co-surface px-2 py-0.5 text-xs font-semibold text-co-text-muted">
                      {t("reports.signal.cash_over").replace("{amount}", formatCents(s.cashOverShortCents))}
                    </span>
                  ) : null}
                  {canSeeCash && s.cashOverShortCents !== null && s.cashOverShortCents < 0 ? (
                    <span className="rounded-full border border-co-cta/30 bg-co-cta/10 px-2 py-0.5 text-xs font-semibold text-co-cta">
                      {t("reports.signal.cash_short").replace("{amount}", formatCents(s.cashOverShortCents))}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </a>
            {snip ? (
              <p className="mt-1 px-1 text-xs text-co-text-muted">
                <span className="font-semibold text-co-text-dim">
                  {serverT(language, `reports.search.snippet_field.${snip.fieldKey}` as TranslationKey)}:
                </span>{" "}
                <span className="italic">“{snip.text}”</span>
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
