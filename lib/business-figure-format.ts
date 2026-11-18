/**
 * Item 9b fix round 4 (review ITEM9B-r4): the ONE place the business report names a number formatter.
 *
 * lib/business-figure-shared.ts decides WHAT may be said about a figure ("so far", "at least", covered days only,
 * a dash); this module only tells it how a language writes a number and a sentence. The page
 * (components/reports-business) imports neither `formatCents` nor `formatQuantity`: it cannot format a number by
 * hand, because it never holds one (tests/business-report-figure-census.test.ts).
 */
import { formatCents, formatQuantity } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { figureChange, figureChangeQualifiers, type Figure, type FigureFormat } from "@/lib/business-figure-shared";

export function figureFormatFor(language: Language): FigureFormat {
  return {
    cents: (c) => formatCents(c, language),
    hours: (m) => serverT(language, "reports.business.hours_value", { h: formatQuantity(m / 60, language) }),
    pct: (p) => serverT(language, "reports.business.pct_value", { pct: formatQuantity(p, language) }),
    count: (n) => formatQuantity(n, language),
    t: (key, values) => serverT(language, key, values),
  };
}

/** This period against the one before (`figureChange` decides it), as words: "+10%", "+1.5 pts", or null when the
 * two periods are not comparable. Fix round 7: the change is derived from the two figures, so it takes THEM (never
 * a bare change) and carries every qualification of both: "+1.5 pts (burden estimated; salary estimated)". */
export function changeWords(cur: Figure, prev: Figure | null, language: Language): string | null {
  const change = figureChange(cur, prev);
  if (change.kind === "not_comparable") return null;
  const sign = change.value > 0 ? "+" : "";
  const words = change.kind === "pct" ? serverT(language, "reports.business.compare.pct", { n: `${sign}${change.value}` })
    : serverT(language, "reports.business.compare.points", { n: `${sign}${formatQuantity(change.value, language)}` });
  const quals = figureChangeQualifiers(cur, prev, figureFormatFor(language));
  return quals.length > 0 ? `${words} (${quals.join("; ")})` : words;
}
