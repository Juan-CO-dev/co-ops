/**
 * B8 #4 r4 (Astra round 3): THE fridge temp-item registry — which fridge a checklist item's
 * reading belongs to, and that fridge's safe max. Reports, Trends, Pulse, the maintenance list and
 * day page, the equipment pages and the hub summary all read readings through this one map; no
 * surface keeps its own list of fridges or items.
 *
 * - Every fridge at the location is in it, retired ones included: their past readings are history.
 * - One owner per item. When several fridges carry the same item, the ACTIVE fridge wins; among
 *   fridges of the same status, the most recently created wins, then the lowest id. (The table has
 *   no updated_at.) Row order from the database never decides it.
 * - A reading is a flag when it is strictly above its owner's safe max, 41°F when unset.
 *
 * Pure apart from `loadTempItemRegistry`; no server-only imports so client-safe modules may reuse
 * the constant.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const FRIDGE_DEFAULT_SAFE_MAX_F = 41;

export interface FridgeRegistryRow {
  id: string;
  opening_temp_item_id: string | null;
  closing_temp_item_id: string | null;
  safe_max_f: number | null;
  active?: boolean | null;
  created_at?: string | null;
}

export interface TempItemOwner {
  fridgeId: string;
  safeMaxF: number;
  active: boolean;
  /** AM = the fridge's opening temp item, PM = its closing one. */
  phase: "AM" | "PM";
}

export type TempItemRegistry = ReadonlyMap<string, TempItemOwner>;

export const FRIDGE_REGISTRY_COLUMNS = "id, opening_temp_item_id, closing_temp_item_id, safe_max_f, active, created_at";

const isActive = (r: FridgeRegistryRow) => r.active !== false;

/** Rows → item id → owner, by the one deterministic rule above. */
export function buildTempItemRegistry(rows: ReadonlyArray<FridgeRegistryRow>): Map<string, TempItemOwner> {
  const ordered = [...rows].sort((a, b) =>
    Number(isActive(b)) - Number(isActive(a))
    || (b.created_at ?? "").localeCompare(a.created_at ?? "")
    || a.id.localeCompare(b.id));
  const out = new Map<string, TempItemOwner>();
  for (const r of ordered) {
    const safeMaxF = r.safe_max_f ?? FRIDGE_DEFAULT_SAFE_MAX_F;
    const claims: Array<[string | null, "AM" | "PM"]> = [[r.opening_temp_item_id, "AM"], [r.closing_temp_item_id, "PM"]];
    for (const [item, phase] of claims) {
      if (item && !out.has(item)) out.set(item, { fridgeId: r.id, safeMaxF, active: isActive(r), phase });
    }
  }
  return out;
}

/** One read: every fridge at the location (active and retired). */
export async function loadTempItemRegistry(service: SupabaseClient, locationId: string): Promise<Map<string, TempItemOwner>> {
  const { data, error } = await service
    .from("maintenance_equipment")
    .select(FRIDGE_REGISTRY_COLUMNS)
    .eq("location_id", locationId)
    .eq("kind", "fridge");
  if (error) throw new Error(`temp item registry: ${error.message}`);
  return buildTempItemRegistry((data ?? []) as FridgeRegistryRow[]);
}

/** The items whose readings belong to this fridge (never an item another fridge owns). */
export function itemsOwnedBy(registry: TempItemRegistry, fridgeId: string): string[] {
  return [...registry].filter(([, owner]) => owner.fridgeId === fridgeId).map(([item]) => item);
}

/** THE temp-flag rule: a registry item whose reading is strictly above its owner's safe max. */
export function isHotReading(registry: TempItemRegistry, templateItemId: string, countValue: number | null): boolean {
  const owner = registry.get(templateItemId);
  return owner !== undefined && countValue !== null && countValue > owner.safeMaxF;
}
