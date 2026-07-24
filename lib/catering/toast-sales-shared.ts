/**
 * Pure, client-safe half of the Toast sales ingest (read-track 2): the
 * exclusion matcher (the catering double-count rule — CO's catering reality is
 * MIXED across Toast/invoice/EZCater, so which Toast checks count as "regular
 * sales" is admin-curated config) + the suspected-catering heuristics that
 * keep misconfiguration visible instead of silent.
 */

export type ExclusionKind = "dining_option" | "menu_group" | "toast_item_guid" | "item_name_contains";

export interface IngestExclusion {
  id: string;
  locationId: string | null; // null = every location
  kind: ExclusionKind;
  value: string;
  note: string | null;
}

export interface ExclusionTarget {
  locationId: string;
  diningOption: string | null;
  menuGroup: string | null;
  toastItemGuid: string;
  itemName: string;
}

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function matchesExclusion(target: ExclusionTarget, exclusions: IngestExclusion[]): boolean {
  for (const ex of exclusions) {
    if (ex.locationId != null && ex.locationId !== target.locationId) continue;
    switch (ex.kind) {
      case "dining_option":
        if (target.diningOption != null && eq(target.diningOption, ex.value)) return true;
        break;
      case "menu_group":
        if (target.menuGroup != null && eq(target.menuGroup, ex.value)) return true;
        break;
      case "toast_item_guid":
        if (target.toastItemGuid === ex.value.trim()) return true;
        break;
      case "item_name_contains":
        if (target.itemName.toLowerCase().includes(ex.value.trim().toLowerCase())) return true;
        break;
    }
  }
  return false;
}

/** Catering-ish signals for the suspected advisory (never excludes by itself). */
export const SUSPECT_NAME_RE = /catering|platter|box(ed)? lunch/i;
export const SUSPECT_CHECK_QTY = 20;
