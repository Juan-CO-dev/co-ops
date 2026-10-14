import type { ReportType } from "@/lib/types";

/**
 * Source-report page for a closing report-reference line (B4 #15). Pure and
 * shared so a unit test can pin every ReportType. System-key match per C.38:
 * callers pass the ORIGINAL English enum value, never a translated string.
 *
 * `training_report` / `special_report` have no page yet; they (and a null type)
 * take the defensive AM Prep default so a closer is never dead-ended on a 404.
 * Closing-template seed discipline is to add a report-reference item only when
 * its target page exists, so that branch is forensic-only.
 */
export function reportRoute(reportType: ReportType | null | undefined): string {
  switch (reportType) {
    case "opening_report":
      return "/operations/opening";
    case "mid_day_prep":
      // Multi-instance; the page smart-routes (1 instance -> straight to it, 2+ -> the day's list).
      return "/operations/mid-day";
    case "cash_report":
      return "/cash";
    case "pm_report":
      return "/pm-report";
    case "receiving":
      return "/operations/receiving";
    case "counts":
      return "/operations/counts";
    case "ordering":
      return "/ordering";
    case "am_prep":
    default:
      return "/operations/am-prep";
  }
}

/**
 * i18n key naming a report in prose ("tap to open {report}"). Reuses the
 * existing `assignments.task.<type>` keys; types with no task key fall back to
 * a generic "this report" so the aria never names the wrong page.
 */
export function reportNameKey(
  reportType: ReportType | null | undefined,
):
  | "assignments.task.am_prep"
  | "assignments.task.mid_day_prep"
  | "assignments.task.cash_report"
  | "assignments.task.opening_report"
  | "assignments.task.receiving"
  | "assignments.task.counts"
  | "assignments.task.ordering"
  | "assignments.task.pm_report"
  | "closing.report_ref.report_fallback" {
  switch (reportType) {
    case "am_prep":
    case "mid_day_prep":
    case "cash_report":
    case "opening_report":
    case "receiving":
    case "counts":
    case "ordering":
    case "pm_report":
      return `assignments.task.${reportType}`;
    default:
      return "closing.report_ref.report_fallback";
  }
}
