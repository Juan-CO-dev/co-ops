import Link from "next/link";

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
  locationId,
  language,
}: {
  items: AttentionItem[];
  locationId: string;
  language: Language;
}) {
  if (items.length === 0) {
    return (
      // role="status" — announce the calm state politely (a11y, council E).
      <div role="status" className="rounded-lg border-2 border-co-success bg-co-surface px-4 py-3">
        <p className="text-sm text-co-success">
          {serverT(language, "midshift.all_clear")}
        </p>
      </div>
    );
  }

  return (
    // role="alert" — attention items are the page's urgency signal.
    <div role="alert" className="rounded-lg border-2 border-co-cta bg-co-surface px-4 py-3">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-co-cta">
        {serverT(language, "midshift.attention.heading")}
      </h2>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          // Stable key from the item's identity (council E: never the index).
          const key = `${item.kind}-${item.reportKey ?? item.fridgeName ?? item.count ?? ""}`;
          if (item.kind === "overdue" && item.reportKey !== undefined) {
            const reportLabel = serverT(language, REPORT_LABEL_KEY[item.reportKey]);
            return (
              <li key={key} className="text-sm text-co-text">
                <a href="#midshift-reports" className="underline decoration-co-border underline-offset-2">
                  {serverT(language, "midshift.attention.overdue", { report: reportLabel })}
                </a>
              </li>
            );
          }
          if (item.kind === "fridge") {
            return (
              <li key={key} className="text-sm text-co-text">
                <Link
                  href={`/maintenance?location=${locationId}`}
                  className="underline decoration-co-border underline-offset-2"
                >
                  {serverT(language, "midshift.attention.fridge", { fridge: item.fridgeName ?? "—" })}
                </Link>
              </li>
            );
          }
          const count = item.count ?? 0;
          return (
            <li key={key} className="text-sm text-co-text">
              <Link
                href={`/maintenance?location=${locationId}`}
                className="underline decoration-co-border underline-offset-2"
              >
                {count === 1
                  ? serverT(language, "midshift.attention.maintenance_note_one")
                  : serverT(language, "midshift.attention.maintenance_note_other", { count })}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
