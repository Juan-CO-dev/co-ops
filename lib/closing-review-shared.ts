/**
 * B11a-floor — closing review reason shortcuts. Pure, client-safe (zero I/O).
 *
 * "Same reason for all" / "Same reason for this station" fill only EMPTY drafts. Every line
 * keeps its own draft and stays editable; nothing is merged — the server still receives one
 * reason per unfinished line (lib/checklists.ts confirmInstance requires the reason set to
 * match the unfinished lines exactly, and refuses a blank one).
 */

/** Fill every id in `ids` whose draft is empty/whitespace with `reason` (trimmed). A blank
 *  reason changes nothing. Returns the SAME map when nothing changed (no needless render). */
export function applyReasonToEmptyDrafts(
  drafts: Map<string, string>,
  ids: ReadonlyArray<string>,
  reason: string,
): Map<string, string> {
  const text = reason.trim();
  if (text === "") return drafts;
  let next: Map<string, string> | null = null;
  for (const id of ids) {
    if ((drafts.get(id) ?? "").trim() !== "") continue;
    next ??= new Map(drafts);
    next.set(id, text);
  }
  return next ?? drafts;
}

/** How many of `ids` an Apply would fill (drives the button's disabled state). */
export function countEmptyDrafts(drafts: ReadonlyMap<string, string>, ids: ReadonlyArray<string>): number {
  return ids.filter((id) => (drafts.get(id) ?? "").trim() === "").length;
}

/**
 * Group ids by station in first-appearance order. `stationOf` returns the SYSTEM KEY (the
 * original English station) — grouping never compares translated strings.
 */
export function groupIdsByStation(
  ids: ReadonlyArray<string>,
  stationOf: (id: string) => string,
): Array<{ station: string; ids: string[] }> {
  const out: Array<{ station: string; ids: string[] }> = [];
  const at = new Map<string, number>();
  for (const id of ids) {
    const station = stationOf(id);
    let i = at.get(station);
    if (i === undefined) {
      i = out.length;
      at.set(station, i);
      out.push({ station, ids: [] });
    }
    out[i]!.ids.push(id);
  }
  return out;
}
