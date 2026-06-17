import type { Language, TranslationKey } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import type { AttentionItem, ReportKey } from "@/lib/midshift";

/**
 * Maps ReportKey values to their i18n label keys.
 * Explicit Record<ReportKey, TranslationKey> — mirrors EquipmentOverview's
 * STATUS_KEY pattern; never string-concatenated loosely.
 */
const REPORT_LABEL_KEY: Record<ReportKey, TranslationKey> = {
  opening: "midshift.report.opening",
  am_prep: "midshift.report.am_prep",
  mid_day: "midshift.report.mid_day",
  cash: "midshift.report.cash",
  closing: "midshift.report.closing",
};

export function AttentionBanner({
  items,
  language,
}: {
  items: AttentionItem[];
  language: Language;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border-2 border-co-success bg-co-surface px-4 py-3">
        <p className="text-sm text-co-success">
          {serverT(language, "midshift.all_clear")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border-2 border-co-cta bg-co-surface px-4 py-3">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-cta">
        {serverT(language, "midshift.attention.heading")}
      </h2>
      <ul className="flex flex-col gap-1">
        {items.map((item, idx) => {
          let text: string;
          if (item.kind === "overdue" && item.reportKey !== undefined) {
            const reportLabel = serverT(language, REPORT_LABEL_KEY[item.reportKey]);
            text = serverT(language, "midshift.attention.overdue", {
              report: reportLabel,
            });
          } else if (item.kind === "fridge") {
            text = serverT(language, "midshift.attention.fridge", {
              fridge: item.fridgeName ?? "—",
            });
          } else {
            text = serverT(language, "midshift.attention.maintenance_note", {
              count: item.count ?? 0,
            });
          }
          return (
            <li key={idx} className="text-sm text-co-text">
              {text}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
