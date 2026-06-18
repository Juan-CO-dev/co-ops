import type { ReactNode } from "react";

import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey, TranslationParams } from "@/lib/i18n/types";

/**
 * One stacked trend card (layout A). Renders title, headline value, a
 * delta-vs-previous pill colored by whether the move is good or bad for this
 * family, the chart (passed as children), a plain-language explainer, and a
 * "how to read this" callout.
 */
export function TrendCard({
  titleKey,
  headline,
  delta,
  deltaGoodWhenNegative,
  explainKey,
  explainParams,
  howToReadKey,
  language,
  children,
}: {
  titleKey: TranslationKey;
  headline: string;
  /** Already-formatted delta string + signed numeric value; null hides the pill. */
  delta: { label: string; value: number } | null;
  /** Lower-is-better families (under-par, temps) pass true; completion/cash pass false. */
  deltaGoodWhenNegative: boolean;
  explainKey: TranslationKey;
  explainParams?: TranslationParams;
  howToReadKey: TranslationKey;
  language: Language;
  children: ReactNode;
}) {
  let tone: "good" | "bad" | "flat" = "flat";
  if (delta && delta.value !== 0) {
    const improving = deltaGoodWhenNegative ? delta.value < 0 : delta.value > 0;
    tone = improving ? "good" : "bad";
  }
  const toneColor =
    tone === "good" ? "var(--co-success)" : tone === "bad" ? "var(--co-danger)" : "var(--co-text-dim)";

  return (
    <section className="rounded-2xl border-2 border-co-border bg-co-surface p-4 shadow-sm sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-co-text">
          {serverT(language, titleKey)}
        </h3>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-extrabold leading-none text-co-text">{headline}</span>
          {delta ? (
            <span className="text-xs font-bold" style={{ color: toneColor }}>
              {delta.label}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3">{children}</div>

      <p className="mt-3 text-xs leading-relaxed text-co-text-muted">
        {serverT(language, explainKey, explainParams)}
      </p>

      <div className="mt-2 rounded-md border-l-[3px] border-co-gold bg-co-warning-surface px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-co-text-dim">
          {serverT(language, "reports.trends.how_to_read")}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-co-text">{serverT(language, howToReadKey)}</p>
      </div>
    </section>
  );
}
