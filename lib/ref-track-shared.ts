/**
 * Ref-tracking closing lines — which item on TODAY's template a frozen reference means.
 * CLIENT-SAFE and pure (no I/O); the loader is lib/prep.ts reconcileRefTrackItems.
 *
 * A closing line with `ref_track_item_completion` follows another item
 * (`references_template_item_id`, frozen at authoring time). Template versioning re-mints item
 * ids, so on a later version the frozen id is not on today's template and the item has to be
 * found again. There is no lineage key across versions, and labels are NOT unique on a template:
 * opening templates repeat a label per station ("Station appears clean as reported").
 *
 * Audit W14 / B081 — the old lookup took an unordered first row by label on the effective
 * template, for every reference, so a line could tick from another station's completion even
 * when the frozen reference already sat on today's template. The rule now:
 *   1. The reference is on today's template → it IS the item (its own id, no lookup).
 *   2. Otherwise the item is the ONE active same-label item at the SAME station.
 *   3. Zero or several → null. The caller skips the line: an unticked line costs one tap, a
 *      line ticked from the wrong station fakes a check. Never another station's item, and
 *      never the frozen id of another version (it has no completions on today's instance).
 */
export interface RefTrackSourceItem {
  id: string;
  template_id: string;
  label: string;
  station: string | null;
}

/** An ACTIVE item on the effective template that carries the reference's label. */
export interface RefTrackCandidate {
  id: string;
  station: string | null;
}

export function pickEffectiveRefItem(
  refItem: RefTrackSourceItem,
  effTemplateId: string,
  candidates: ReadonlyArray<RefTrackCandidate>,
): string | null {
  if (refItem.template_id === effTemplateId) return refItem.id;
  const station = refItem.station ?? null;
  const sameStation = candidates.filter((c) => (c.station ?? null) === station);
  return sameStation.length === 1 ? sameStation[0]!.id : null;
}
