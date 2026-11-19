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
import { figureChange, figureChangeQualifiers, figureDisplay, type Figure, type FigureFormat } from "@/lib/business-figure-shared";

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

// ── Say each qualification ONCE per scope (polish, 2026-11-18) ──────────────────────────────────
// A card, a drawer, a list or a PDF page is a SCOPE. Its legend lists every qualification (and, where asked, every
// reason a figure is unknown or not whole) of the figures in it ONCE, each under a short mark; a figure then shows
// its value (or a dash) with the marks of what qualifies it. Nothing is dropped: a sentence that is not in the
// scope's legend comes back from `read` as `loose` / `reason` and the surface writes it beside the figure as before.

export interface LegendEntry { mark: string; text: string; gap: boolean }
export interface LegendRead {
  /** The value as words; null = a dash. */
  said: string | null;
  /** The marks of this figure's reason and qualifications, in legend order. */
  marks: LegendEntry[];
  /** The reason, when the legend does not hold it (said beside the figure). */
  reason: string | null;
  /** Qualifications the legend does not hold (said beside the figure). */
  loose: Array<{ id: string; gap: boolean; text: string }>;
}
export interface FigureLegend {
  entries: LegendEntry[];
  read(f: Figure): LegendRead;
  /** The legend's entries that qualify any of `figures` (a drawer repeats only its own, under the same marks). */
  of(figures: ReadonlyArray<Figure | null | undefined>): LegendEntry[];
  /** One cell of text for a printed table: the value or a dash, then its marks: "$1,251.20 (a, b)". */
  cell(f: Figure): string;
}
const markAt = (i: number): string => (i < 26 ? "" : markAt(Math.floor(i / 26) - 1)) + String.fromCharCode(97 + (i % 26));

/** THE legend of a scope. `reasons` puts the reasons (why a figure is a dash or not whole) in the legend too;
 * without it only the qualifications are, and a reason stays beside its figure. */
export function figureLegend(language: Language, figures: ReadonlyArray<Figure | null | undefined>, o: { reasons?: boolean } = {}): FigureLegend {
  const fmt = figureFormatFor(language);
  const display = (f: Figure) => figureDisplay(f, fmt, { reason: "always" });
  const byText = new Map<string, LegendEntry>();
  const add = (text: string, gap: boolean) => { if (!byText.has(text)) byText.set(text, { mark: markAt(byText.size), text, gap }); };
  for (const f of figures) {
    if (!f) continue;
    const d = display(f);
    if (o.reasons && d.reason !== null) add(d.reason, true);
    for (const n of d.notes) add(n.text, n.gap);
  }
  const entries = [...byText.values()];
  const read = (f: Figure): LegendRead => {
    const d = display(f);
    const reasonEntry = d.reason !== null && o.reasons ? byText.get(d.reason) : undefined;
    const noteEntries = d.notes.map((n) => ({ n, e: byText.get(n.text) }));
    return {
      said: d.words,
      // In legend order ("a, b", never "b, a"), each once.
      marks: entries.filter((e) => e === reasonEntry || noteEntries.some((x) => x.e === e)),
      reason: reasonEntry ? null : d.reason,
      loose: noteEntries.flatMap((x) => (x.e ? [] : [x.n])),
    };
  };
  return {
    entries, read,
    of: (list) => { const used = new Set(list.flatMap((f) => (f ? read(f).marks.map((m) => m.mark) : []))); return entries.filter((e) => used.has(e.mark)); },
    cell: (f) => {
      const r = read(f);
      const beside = [r.reason, ...r.loose.map((n) => n.text)].filter((x): x is string => x !== null);
      return `${r.said ?? "—"}${r.marks.length ? ` (${r.marks.map((m) => m.mark).join(", ")})` : ""}${beside.length ? ` (${beside.join("; ")})` : ""}`;
    },
  };
}
