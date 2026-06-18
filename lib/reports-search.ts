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
