"use client";

/**
 * OpenCreditsPanel — the receiving-list open-credits summary (spec D3, Task 7).
 *
 * A secondary, default-collapsed disclosure (Disclosure Doctrine D3): the manager's
 * primary job on this page is logging a delivery, so the outstanding-credits rollup
 * lives behind a CollapsibleSection whose header carries an i18n'd count (D5) and a
 * never-collapse warn badge (D2) when anything is aging. Full-row toggle + useState-
 * only disclosure are baked into CollapsibleSection (D8/D9); this island only shapes
 * the display of already-loaded server data.
 *
 * MONEY LAW: `totalCents === null` (no open row carried an amount) renders an em-dash,
 * NEVER $0.00 — a false zero would read as "nothing owed". Amber (warn) accents an
 * aging row (oldest > 7 days — the false-trust guard: a credit rotting unresolved).
 * Renders nothing when there are no open credits.
 *
 * DISPLAY-STRING contract: the server ran the query; this component runs t() for
 * every visible string and never touches business logic.
 */
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents } from "@/lib/i18n/format";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { AlertPill } from "@/components/ui/AlertPill";
import type { OpenCreditVendorSummary } from "@/lib/credits";

/** Days-aged threshold past which a vendor's open credits read as "aging" (warn). */
const AGING_DAYS = 7;

export function OpenCreditsPanel({ summary }: { summary: OpenCreditVendorSummary[] }) {
  const { t, language } = useTranslation();

  // Nothing owed → render nothing (no empty disclosure taking up space).
  if (summary.length === 0) return null;

  const totalOpen = summary.reduce((n, s) => n + s.openCount, 0);
  // Any vendor aging past the threshold shouts on the collapsed header (D2).
  const aging = summary.some((s) => s.oldestDays != null && s.oldestDays > AGING_DAYS);

  return (
    <div className="mt-6">
      <CollapsibleSection
        idBase="receiving-open-credits"
        title={t("receiving.credits.panel_title")}
        count={t("receiving.credits.open_count", { n: totalOpen })}
        badge={
          aging ? (
            <AlertPill tone="warn">{t("receiving.credits.aging_badge")}</AlertPill>
          ) : null
        }
      >
        <ul className="flex flex-col gap-1.5">
          {summary.map((s) => {
            const isAging = s.oldestDays != null && s.oldestDays > AGING_DAYS;
            return (
              <li
                key={s.vendorId}
                className="flex items-center justify-between gap-3 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-co-text">{s.vendorName}</span>
                  <span className="block text-[11px] text-co-text-dim">
                    {t("receiving.credits.vendor_open", { n: s.openCount })}
                    {s.oldestDays != null
                      ? ` · ${t("receiving.credits.oldest_days", { n: s.oldestDays })}`
                      : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Null total → em-dash, never $0.00 (money law). */}
                  <span className="text-sm font-bold text-co-text">
                    {s.totalCents != null ? formatCents(s.totalCents, language) : "—"}
                  </span>
                  {isAging ? (
                    <AlertPill tone="warn">{t("receiving.credits.aging_badge")}</AlertPill>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </CollapsibleSection>
    </div>
  );
}
