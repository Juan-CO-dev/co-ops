"use client";
/**
 * PM v2 on "My Performance" (Scheduling Phase 1, Task 21, R9): per SUBMITTED v2 day, per position, each
 * criterion as a BAND ("Great · Good · Building"). Nothing else: no number, no manager's name, no note text —
 * the lib (`loadMyFeedbackV2`) never loads them for this view. Collapsed by default (D8).
 */
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { formatDateLabel } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { MyFeedbackV2Day } from "@/lib/pm-report-v2";

export function MyFeedbackV2({ days, initiallyOpen = false }: { days: readonly MyFeedbackV2Day[]; initiallyOpen?: boolean }) {
  return days.length ? <MyFeedbackV2List days={days} initiallyOpen={initiallyOpen} /> : null;
}

function MyFeedbackV2List({ days, initiallyOpen }: { days: readonly MyFeedbackV2Day[]; initiallyOpen: boolean }) {
  const { t, language } = useTranslation();
  return (
    <section className="mt-6" aria-label={t("pmv2.mine.title")}>
      <CollapsibleSection idBase="pmv2-mine" title={t("pmv2.mine.title")} count={t("pmv2.mine.count", { n: days.length })} defaultOpen={initiallyOpen}>
        <ul className="grid gap-3">
          {days.map((d) => (
            <li key={`${d.date}/${d.locationId}`} className="grid gap-1">
              <span className="text-sm font-bold text-co-text">{formatDateLabel(d.date, language)}</span>
              {d.positions.map((p) => (
                <div key={p.positionId ?? "none"} className="text-sm text-co-text">
                  <span className="font-bold">{p.positionId === null ? t("pmv2.position.none") : (language === "es" && p.nameEs ? p.nameEs : p.name)}</span>
                  {": "}
                  {p.criteria.map((c) => `${language === "es" && c.labelEs ? c.labelEs : c.label} · ${t(`pmv2.band.${c.band}` as TranslationKey)}`).join(" — ")}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    </section>
  );
}
