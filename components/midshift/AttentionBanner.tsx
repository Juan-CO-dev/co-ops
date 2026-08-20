import Link from "next/link";

import type { Language, TranslationKey } from "@/lib/i18n/types";
import { serverT } from "@/lib/i18n/server";
import { pulseScore, type AttentionItem, type PulseScore, type ReportKey } from "@/lib/midshift-shared";

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

/** The Pulse Score chip (council 2026-07-31, aggie): green = move on;
 *  yellow = worth a look; red = act now. One glance, three states. */
const SCORE_KEY: Record<PulseScore, TranslationKey> = {
  green: "midshift.score.green",
  yellow: "midshift.score.yellow",
  red: "midshift.score.red",
};
const SCORE_CHIP_CLASS: Record<PulseScore, string> = {
  green: "bg-co-success/15 text-co-confirm-text",
  yellow: "bg-co-gold/25 text-co-gold-text",
  red: "bg-co-danger-surface text-co-cta-text",
};

function ScoreChip({ score, language }: { score: PulseScore; language: Language }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${SCORE_CHIP_CLASS[score]}`}
    >
      {serverT(language, SCORE_KEY[score])}
    </span>
  );
}

export function AttentionBanner({
  items,
  locationId,
  language,
}: {
  items: AttentionItem[];
  locationId: string;
  language: Language;
}) {
  const score = pulseScore(items);

  if (score === "green") {
    return (
      // role="status" — announce the calm state politely (a11y, council E).
      <div role="status" className="flex items-center gap-2 rounded-lg border-2 border-co-success bg-co-surface px-4 py-3">
        <ScoreChip score="green" language={language} />
        <p className="text-sm text-co-confirm-text">
          {serverT(language, "midshift.all_clear")}
        </p>
      </div>
    );
  }

  const border = score === "red" ? "border-co-cta" : "border-co-gold-deep";
  const headingTone = score === "red" ? "text-co-cta-text" : "text-co-gold-text";
  return (
    // role="alert" — attention items are the page's urgency signal.
    <div role="alert" className={`rounded-lg border-2 ${border} bg-co-surface px-4 py-3`}>
      <h2 className={`mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] ${headingTone}`}>
        <ScoreChip score={score} language={language} />
        {serverT(language, "midshift.attention.heading")}
      </h2>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          // Stable key from the item's identity (council E: never the index;
          // fridges key on equipId — names can collide).
          const key = `${item.kind}-${item.reportKey ?? item.equipId ?? item.count ?? ""}`;
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
          if (item.kind === "fridge_unchecked") {
            const count = item.count ?? 0;
            return (
              <li key={key} className="text-sm text-co-text">
                <Link
                  href={`/maintenance?location=${locationId}`}
                  className="underline decoration-co-border underline-offset-2"
                >
                  {count === 1
                    ? serverT(language, "midshift.attention.fridge_unchecked_one")
                    : serverT(language, "midshift.attention.fridge_unchecked_other", { count })}
                </Link>
              </li>
            );
          }
          if (item.kind === "shrinkage") {
            // Advisory (YELLOW-tier): the last par-pass sees less than the computed
            // feed/verify model → possible unrecorded waste. Links to the Inventory
            // Audit page (where on-hand provenance lives). ?location= is required there.
            const count = item.count ?? 0;
            return (
              <li key={key} className="text-sm text-co-text">
                <Link
                  href={`/operations/counts?location=${locationId}`}
                  className="underline decoration-co-border underline-offset-2"
                >
                  {serverT(language, "midshift.attention.shrinkage", { n: count })}
                </Link>
              </li>
            );
          }
          if (item.kind === "ordering_cutoff") {
            // Vendor cutoff today with no order placed. YELLOW-tier. The earliest vendor
            // (loader-sorted first) names the line; hasDraft picks "draft ready" vs "no
            // draft yet"; pluralizes on the total count. Links to /ordering (?location=).
            const count = item.count ?? 0;
            const earliest = item.cutoffVendors?.[0];
            const draftKey = earliest?.hasDraft
              ? "midshift.attention.ordering_cutoff_draft"
              : "midshift.attention.ordering_cutoff_nodraft";
            const draftState = serverT(language, draftKey);
            const label =
              count === 1
                ? serverT(language, "midshift.attention.ordering_cutoff_one", {
                    vendor: earliest?.name ?? "—",
                    time: earliest?.time ?? "—",
                    state: draftState,
                  })
                : serverT(language, "midshift.attention.ordering_cutoff_other", {
                    vendor: earliest?.name ?? "—",
                    time: earliest?.time ?? "—",
                    state: draftState,
                    count,
                  });
            return (
              <li key={key} className="text-sm text-co-text">
                <Link
                  href={`/ordering?location=${locationId}`}
                  className="underline decoration-co-border underline-offset-2"
                >
                  {label}
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
