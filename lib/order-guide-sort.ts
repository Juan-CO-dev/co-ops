/**
 * lib/order-guide-sort.ts — the ONE law for "in what order does a manager read an order".
 * PURE: no I/O. position = section.position * 1000 + line.position (spec §3), null = not on
 * the vendor's guide. Every consumer (PO panel, copied body, email, walker preview, picker)
 * sorts with compareByGuide and groups with groupByGuideSection; nobody re-implements it.
 */
export interface GuideSortKey { position: number | null; section: string | null; name: string }
/** Sentinel section for the trailing group. `null` in the returned group = "no header" (only group). */
export const NOT_ON_GUIDE = "__not_on_guide__" as const;
export interface GuideGroup<T extends GuideSortKey> { section: string | null; rows: T[] }

export function compareByGuide<T extends GuideSortKey>(a: T, b: T): number {
  const pa = a.position, pb = b.position;
  if (pa == null && pb == null) return a.name.localeCompare(b.name);
  if (pa == null) return 1;
  if (pb == null) return -1;
  if (pa !== pb) return pa - pb;
  return a.name.localeCompare(b.name);
}

/** Sort, then split into consecutive same-section runs. Rows without a position form the
 *  last group under NOT_ON_GUIDE; when that is the ONLY group its section is null (no header). */
export function groupByGuideSection<T extends GuideSortKey>(rows: readonly T[]): GuideGroup<T>[] {
  const sorted = [...rows].sort(compareByGuide);
  const groups: GuideGroup<T>[] = [];
  for (const r of sorted) {
    const key = r.position == null ? NOT_ON_GUIDE : (r.section ?? "");
    const last = groups[groups.length - 1];
    if (last && last.section === key) last.rows.push(r);
    else groups.push({ section: key, rows: [r] });
  }
  if (groups.length === 1 && groups[0]!.section === NOT_ON_GUIDE) groups[0]!.section = null;
  return groups;
}
