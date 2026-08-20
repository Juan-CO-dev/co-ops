import type { Language, TranslationKey } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import type { ActiveStaff, ReportKey } from "@/lib/midshift";

const REPORT_LABEL_KEY: Record<ReportKey, TranslationKey> = {
  opening: "midshift.report.opening",
  am_prep: "midshift.report.am_prep",
  mid_day: "midshift.report.mid_day",
  cash: "midshift.report.cash",
  closing: "midshift.report.closing",
};

export function ActiveToday({
  staff,
  language,
}: {
  staff: ActiveStaff[];
  language: Language;
}) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-gold-text">
        {serverT(language, "midshift.active.heading")}
      </h2>

      {staff.length === 0 ? (
        <p className="text-sm text-co-text-muted">
          {serverT(language, "midshift.active.none")}
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-2">
            {staff.map((member) => (
              <span
                key={member.userId}
                className="rounded-md border border-co-border bg-co-surface px-2 py-1 text-xs font-semibold text-co-text"
              >
                {member.name}
                {/* What they touched (council 2026-07-31 — this shipped as an
                    always-empty array; the section's stated job is "who + what"). */}
                {member.reports.length > 0 && (
                  <span className="ml-1 font-normal text-co-text-muted">
                    · {member.reports.map((k) => serverT(language, REPORT_LABEL_KEY[k])).join(", ")}
                  </span>
                )}
              </span>
            ))}
          </div>
          <p className="text-xs text-co-text-muted">
            {serverT(language, "midshift.active.proxy_note")}
          </p>
        </>
      )}
    </section>
  );
}
