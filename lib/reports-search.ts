/**
 * Reports Hub quick-find (Phase 1). Pure case-insensitive substring match over
 * the fields already on an authorized list row — submitter name + report type.
 * No tier-sensitive fields are touched (deep authorized-content search is a
 * separate Phase-2 cycle), so this never widens disclosure: it only filters a
 * list the viewer can already see in full.
 */
export function matchesReportQuery(
  item: { submitterName: string | null; type: string },
  q: string,
  /** Viewer-localized report-type label (e.g. "Closing" / "Cierre"). */
  typeLabel: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true; // callers skip filtering on blank q; defensive default
  const haystack = `${item.submitterName ?? ""} ${typeLabel} ${item.type}`.toLowerCase();
  return haystack.includes(needle);
}

/** A field of authorized searchable text for one report. `fieldKey` selects
 *  the snippet label (reports.search.snippet_field.<fieldKey>). */
export interface SearchCorpusField {
  fieldKey: "item" | "station" | "completer" | "note" | "cash_note" | "area_to_improve" | "pm_note" | "mvp_note";
  text: string;
}

export interface SearchCorpusEntry {
  fields: SearchCorpusField[];
}

export interface SearchSnippet {
  fieldKey: SearchCorpusField["fieldKey"];
  text: string; // ellipsized context window around the match
}

export interface SearchResult {
  matched: boolean;
  snippet?: SearchSnippet;
}

/** Ellipsized ~60-char window centered on the first occurrence of `needle`
 *  (already lowercased) in `text`. */
export function makeSnippet(text: string, needle: string, radius = 28): string {
  const idx = text.toLowerCase().indexOf(needle);
  if (idx < 0) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/**
 * Match `q` for one report. Prefers a DEEP field match (returns a snippet);
 * otherwise falls back to the Phase-1 name/type match (matched, no snippet).
 * `entry` is the viewer-authorized corpus (already redacted), so any snippet is safe.
 */
export function searchReport(
  base: { submitterName: string | null; type: string },
  typeLabel: string,
  entry: SearchCorpusEntry | undefined,
  q: string,
): SearchResult {
  const needle = q.trim().toLowerCase();
  if (!needle) return { matched: true };
  // 1. Deep fields first → informative snippet.
  for (const f of entry?.fields ?? []) {
    if (f.text.toLowerCase().includes(needle)) {
      return { matched: true, snippet: { fieldKey: f.fieldKey, text: makeSnippet(f.text, needle) } };
    }
  }
  // 2. Fall back to Phase-1 name/type (no snippet — those fields are already on the row).
  if (matchesReportQuery(base, q, typeLabel)) return { matched: true };
  return { matched: false };
}
