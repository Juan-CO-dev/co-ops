import type { Language, TranslationKey } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import { formatTime } from "@/lib/i18n/format";
import type { ReportStatusRow, ReportKey, ReportProgress, OverdueState } from "@/lib/midshift";

/**
 * Maps ReportKey values to their i18n label keys.
 * Explicit Record — mirrors EquipmentOverview's STATUS_KEY pattern.
 */
const REPORT_LABEL_KEY: Record<ReportKey, TranslationKey> = {
  opening: "midshift.report.opening",
  am_prep: "midshift.report.am_prep",
  mid_day: "midshift.report.mid_day",
  cash: "midshift.report.cash",
  closing: "midshift.report.closing",
};

/**
 * Maps ReportProgress to its i18n key.
 */
const PROGRESS_KEY: Record<ReportProgress, TranslationKey> = {
  done: "midshift.progress.done",
  in_progress: "midshift.progress.in_progress",
  not_started: "midshift.progress.not_started",
};

/**
 * Chip color class per progress state.
 */
const PROGRESS_CLASS: Record<ReportProgress, string> = {
  done: "text-co-confirm-text",
  in_progress: "text-co-text-muted",
  not_started: "text-co-text-muted",
};

export function ReportStatusList({
  reports,
  language,
}: {
  reports: ReportStatusRow[];
  language: Language;
}) {
  return (
    // id = the attention banner's tap-through anchor target.
    <section id="midshift-reports">
      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-gold-text">
        {serverT(language, "midshift.reports.heading")}
      </h2>
      <ul className="flex flex-col gap-2">
        {reports.map((row) => (
          <li
            key={row.key}
            className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2"
          >
            <div className="flex items-start justify-between gap-2">
              {/* Left: report label */}
              <span className="text-sm font-bold text-co-text">
                {serverT(language, REPORT_LABEL_KEY[row.key])}
              </span>

              {/* Right: status chip area */}
              <div className="flex flex-col items-end gap-0.5">
                {/* Overdue badge takes visual priority */}
                {row.overdue === "overdue" && (
                  <span className="text-xs font-semibold text-co-cta-text">
                    {serverT(language, "midshift.overdue.badge")}
                  </span>
                )}
                {row.overdue === "not_due_yet" && row.progress !== "done" && (
                  <span className="text-xs font-semibold text-co-text-muted">
                    {serverT(language, "midshift.overdue.not_due_yet")}
                  </span>
                )}
                {/* due_now: the mid-day 14:00–15:30 window nudge (was silent). */}
                {row.overdue === "due_now" && (
                  <span className="text-xs font-semibold text-co-gold-text">
                    {serverT(language, "midshift.overdue.due_now")}
                  </span>
                )}
                {/* waiting_on_closing: names the closing-dependent neutral state
                    so am-prep/cash don't read as "all good" pre-close. */}
                {row.overdue === "waiting_on_closing" && row.progress !== "done" && (
                  <span className="text-xs font-semibold text-co-text-dim">
                    {serverT(language, "midshift.overdue.waiting_on_closing")}
                  </span>
                )}
                {/* Progress chip */}
                <span
                  className={`text-xs font-semibold ${PROGRESS_CLASS[row.progress]}`}
                >
                  {serverT(language, PROGRESS_KEY[row.progress])}
                </span>
              </div>
            </div>

            {/* Done-by attribution */}
            {row.progress === "done" && row.doneAt !== null && (
              <p className="mt-0.5 text-xs text-co-text-muted">
                {serverT(language, "midshift.done_by", {
                  time: formatTime(row.doneAt, language),
                  name: row.doneByName ?? "—",
                })}
              </p>
            )}

            {/* mid_day count badge */}
            {row.key === "mid_day" && row.count !== undefined && row.count > 0 && (
              <p className="mt-0.5 text-xs text-co-text-muted">
                {serverT(language, "midshift.mid_day_count", { count: row.count })}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
