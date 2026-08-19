/**
 * Shared reports-hub vocabulary. Pure — no I/O, no server imports, safe from
 * either side of the client boundary.
 *
 * ONE report-status → translation-key map. Three surfaces (ReportList,
 * ChecklistReportDetail, OpeningReportDetail) each hand-copied a partial map,
 * and two of the copies drifted: they were missing `auto_finalized` and
 * `incomplete_confirmed`, so those statuses rendered as raw DB enum strings
 * ("auto_finalized") in the list and the checklist detail while the opening
 * detail rendered them correctly. Add a status HERE and every surface gets it.
 *
 * Key-returning, not string-returning: translation stays at the call sites,
 * which already hold the viewer's language (the existing reports-hub pattern —
 * cf. TYPE_LABEL_KEYS).
 */

import type { TranslationKey } from "@/lib/i18n/types";

/** DB checklist/report status enum → translation key. Complete as of 0165. */
export const REPORT_STATUS_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  open: "reports.status.open",
  in_progress: "reports.status.in_progress",
  phase1_complete: "reports.status.phase1_complete",
  phase2_complete: "reports.status.phase2_complete",
  submitted: "reports.status.submitted",
  confirmed: "reports.status.confirmed",
  incomplete_confirmed: "reports.status.incomplete_confirmed",
  auto_finalized: "reports.status.auto_finalized",
};

/**
 * Translation key for a report status, or undefined when the status is outside
 * the known set (callers fall back to the raw string rather than blanking the
 * badge — an unrecognized status is still information).
 */
export function reportStatusLabelKey(status: string): TranslationKey | undefined {
  return REPORT_STATUS_LABEL_KEYS[status];
}

/** Resolve a report status to display text, falling back to the raw enum value. */
export function reportStatusLabel(status: string, t: (k: TranslationKey) => string): string {
  const key = reportStatusLabelKey(status);
  return key ? t(key) : status;
}
