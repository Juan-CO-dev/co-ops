/** Closing section names are the stable station keys; Spanish is display only. */
export interface ClosingStationItem {
  station: string | null;
  display_order: number;
  translations: { es?: { station?: string | null } } | null;
}

export interface ClosingStation { name: string; nameEs: string | null; sort: number }
export interface StoredStation extends ClosingStation { id: string; active: boolean }
export type StationChange =
  | { operation: "insert"; section: ClosingStation }
  | { operation: "update"; section: ClosingStation; id: string }
  | { operation: "deactivate"; id: string; name: string };

export function closingStations(items: readonly ClosingStationItem[]): ClosingStation[] {
  const ordered = [...items].sort((a, b) => a.display_order - b.display_order);
  const sections = new Map<string, ClosingStation>();
  for (const item of ordered) {
    const name = item.station?.trim();
    if (!name) continue;
    const spanish = item.translations?.es?.station?.trim() || null;
    const existing = sections.get(name);
    if (!existing) sections.set(name, { name, nameEs: spanish, sort: item.display_order });
    else if (!existing.nameEs && spanish) existing.nameEs = spanish;
  }
  return [...sections.values()];
}

/** The edit plan is empty after a successful sync, including on repeat calls. */
export function stationChanges(desired: readonly ClosingStation[], current: readonly StoredStation[]): StationChange[] {
  const changes: StationChange[] = [];
  const byName = new Map(current.map((row) => [row.name, row]));
  const wanted = new Set(desired.map((row) => row.name));
  for (const section of desired) {
    const old = byName.get(section.name);
    if (!old) { changes.push({ operation: "insert", section }); continue; }
    if (!old.active || old.sort !== section.sort || (section.nameEs && old.nameEs !== section.nameEs)) {
      changes.push({ operation: "update", section, id: old.id });
    }
  }
  for (const old of current) {
    if (old.active && !wanted.has(old.name)) changes.push({ operation: "deactivate", id: old.id, name: old.name });
  }
  return changes;
}
