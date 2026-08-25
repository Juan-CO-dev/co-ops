"use client";

/**
 * ParSilencePanel — THE REASON LANE (Dynamic Pars Phase 4, Task 4.6). The flagship.
 *
 * v1's engine can honestly speak for ~14 pars out of ~282. The other ~268 are not a
 * failure — they are the product: each one names the errand that would wake it, and the
 * system generating that list live is the arc's thesis ("the system recognizes what's
 * going on before the human does") turned on its own readiness.
 *
 * ── AN AGGREGATE LINE AND A DRAWER, NEVER ROW BADGES (plan D15) ───────────────
 * With 94–100% of rows silent, a per-row badge marks everything and destroys the very
 * lane it sits beside. So: one aggregate line, then a default-collapsed section. Whether
 * rows ALSO badge is decided by a pure, tested function on the server
 * (`shouldBadgeSilencePerRow`) that returns false today and flips itself the day silence
 * becomes the minority — no flag, no follow-up PR.
 *
 * ── ERRANDS FIRST; PACKAGING LAST ─────────────────────────────────────────────
 * 114 of the silent rows are packaging and discontinued products — real, and NOT faults.
 * They are listed (a bucket that reads "other" is a bug) but in their own quieter group
 * at the bottom, because putting them on top would bury the list this panel exists for.
 * The ordering itself is decided server-side by `rollupParSilence`, which is unit-pinned.
 *
 * Disclosure Doctrine D3/D4/D5/D9/D10: summary row + drawer, i18n'd count on the collapsed
 * header, full-row phone tap target, `useState`-only disclosure, children unmounted when
 * closed. Every string and every count is translated (en + es, same PR).
 */

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { AlertPill } from "@/components/ui/AlertPill";
import {
  NOT_A_FAULT_REASONS,
  type ParSilenceCauseRow, type ParSilenceSummary,
} from "@/lib/dynamic-pars-shared";

export function ParSilencePanel({ silence }: { silence: ParSilenceSummary }) {
  const { t } = useTranslation();

  // The engine has never run here. Say so once, quietly, and claim nothing else — a
  // zeroed errand list would read as "everything is fine", which is a different fact.
  if (silence.runDate == null) {
    return (
      <p className="px-1 text-[12px] text-co-text-muted">{t("ordering.silence.never_run")}</p>
    );
  }

  const silent = silence.byCause.reduce((n, c) => n + c.count, 0);
  const errands = silence.byCause.filter((c) => !NOT_A_FAULT_REASONS.has(c.cause));
  const quiet = silence.byCause.filter((c) => NOT_A_FAULT_REASONS.has(c.cause));

  return (
    <div className="flex flex-col gap-2">
      {/* THE AGGREGATE LINE the spec asks for — with the shadow variant, because "3 pars
          auto-tuned this week" beside three pars that never moved is the same lie the
          per-row notice is careful not to tell. */}
      <p className="px-1 text-[13px] text-co-text-dim">
        {t(
          silence.shadowMode
            ? "ordering.silence.aggregate_shadow"
            : "ordering.silence.aggregate",
          { tuned: silence.autoMovesThisWeek, waiting: silence.suggestionsWaiting },
        )}
      </p>

      {silent > 0 && (
        <CollapsibleSection
          idBase="ordering-par-silence"
          title={t("ordering.silence.section_title", { n: silent })}
          count={t("ordering.silence.speaking", { n: silence.speaking })}
          badge={
            silence.badgePerRow ? undefined : (
              <AlertPill tone="info" uppercase={false}>
                {t("ordering.silence.headline", { n: silent })}
              </AlertPill>
            )
          }
        >
          <div className="flex flex-col gap-3">
            {errands.length > 0 && (
              <CauseGroup title={t("ordering.silence.errands_title")} rows={errands} tone="errand" />
            )}
            {quiet.length > 0 && (
              <CauseGroup title={t("ordering.silence.quiet_title")} rows={quiet} tone="quiet" />
            )}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

function CauseGroup({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: ParSilenceCauseRow[];
  tone: "errand" | "quiet";
}) {
  const { t } = useTranslation();
  return (
    <section>
      <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {title}
      </h4>
      <ul className="mt-1.5 flex flex-col gap-2">
        {rows.map((r) => {
          // NAMED WHEN FEW, COUNTED WHEN MANY — the discipline the products admin's
          // retirement warning already uses. Three names is a list a person reads; a
          // hundred is a wall they scroll past.
          const extra = r.count - r.sampleSkuNames.length;
          return (
            <li
              key={r.cause}
              className={
                "rounded-lg border-2 px-3 py-2 " +
                (tone === "errand"
                  ? "border-co-border-2 bg-co-surface"
                  : "border-co-border/60 bg-co-surface-inset")
              }
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[13px] font-bold text-co-text">
                  {r.count === 1
                    ? t("ordering.silence.count_one")
                    : t("ordering.silence.count", { n: r.count })}
                </span>
                <span className="text-[13px] text-co-text">
                  {t(`ordering.silence.cause.${r.cause}` as TranslationKey)}
                </span>
              </div>
              {r.sampleSkuNames.length > 0 && (
                <p className="mt-0.5 text-[12px] text-co-text-muted">
                  {r.sampleSkuNames.join(" · ")}
                  {extra > 0 ? ` · ${t("ordering.silence.and_more", { n: extra })}` : ""}
                </p>
              )}
              <p
                className={
                  "mt-1 text-[12px] " +
                  (tone === "errand" ? "text-co-gold-text" : "text-co-text-dim")
                }
              >
                {t(`ordering.silence.fix.${r.cause}` as TranslationKey)}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
