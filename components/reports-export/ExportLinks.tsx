/**
 * "CSV · PDF" download links for one report family (Reports hub v2 piece 3). Server component,
 * no client state: two plain links to /api/reports/export carrying the page's own filters, so the
 * file is exactly what the screen shows (the route re-runs the page's loader and gates).
 *
 * Lives outside components/reports-hub/* on purpose (that folder belongs to PR #394).
 */
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import type { ExportFamily } from "@/lib/report-export-shared";

/** The page's query, minus paging cursors (an export is the whole filtered range, never one page). */
export function exportHref(family: ExportFamily, format: "csv" | "pdf", query: URLSearchParams | Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  const entries = query instanceof URLSearchParams ? [...query.entries()] : Object.entries(query);
  for (const [key, value] of entries) {
    if (typeof value !== "string" || value === "" || key === "cursor" || key.startsWith("cursor_") || key === "family" || key === "format") continue;
    params.set(key, value);
  }
  params.set("family", family);
  params.set("format", format);
  return `/api/reports/export?${params.toString()}`;
}

export function ExportLinks({ family, query, language, className = "" }: {
  family: ExportFamily;
  query: URLSearchParams | Record<string, string | undefined>;
  language: Language;
  className?: string;
}) {
  const link = "inline-flex min-h-[44px] items-center rounded-lg border border-co-border-2 px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted hover:bg-co-surface-2 hover:text-co-text";
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} role="group" aria-label={serverT(language, "reports.export.group_aria")}>
      <span className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{serverT(language, "reports.export.label")}</span>
      <a className={link} href={exportHref(family, "csv", query)} download aria-label={serverT(language, "reports.export.csv_aria")}>{serverT(language, "reports.export.csv")}</a>
      <a className={link} href={exportHref(family, "pdf", query)} download aria-label={serverT(language, "reports.export.pdf_aria")}>{serverT(language, "reports.export.pdf")}</a>
    </div>
  );
}
