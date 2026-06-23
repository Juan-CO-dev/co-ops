/**
 * Item-registry resolution helpers (Item/Inventory Spine 2A).
 * Pure. The single place that decides a prep/opening line's displayed
 * name + par: from the linked item when present, else a defensive fallback
 * to the line's own prep_meta/label (shouldn't fire post-#82 backfill).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChecklistTemplateItem } from "@/lib/types";

/** Minimal item fields needed to resolve a line's name + par. */
export interface ItemDefn {
  name: string;
  nameEs: string | null;
  defaultPar: number | null;
  defaultParUnit: string | null;
}

export interface ResolvedDefinition {
  name: string;
  nameEs: string | null;
  par: number | null;
  parUnit: string | null;
}

export function resolveLineDefinition(
  line: ChecklistTemplateItem,
  item: ItemDefn | null,
): ResolvedDefinition {
  if (item) {
    return { name: item.name, nameEs: item.nameEs, par: item.defaultPar, parUnit: item.defaultParUnit };
  }
  console.warn(`[items] resolveLineDefinition: line ${line.id} has no linked item; falling back to prep_meta/label`);
  return {
    name: line.label,
    nameEs: line.translations?.es?.label ?? null,
    par: line.prepMeta?.parValue ?? null,
    parUnit: line.prepMeta?.parUnit ?? null,
  };
}

/** Batch-load ItemDefn by id for a set of item_ids (service-role). */
export async function loadItemDefns(
  service: SupabaseClient,
  itemIds: string[],
): Promise<Map<string, ItemDefn>> {
  const map = new Map<string, ItemDefn>();
  const ids = [...new Set(itemIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return map;
  const { data, error } = await service
    .from("items")
    .select("id, name, name_es, default_par, default_par_unit")
    .in("id", ids);
  if (error) throw new Error(`loadItemDefns: ${error.message}`);
  for (const r of (data ?? []) as Array<{ id: string; name: string; name_es: string | null; default_par: number | null; default_par_unit: string | null }>) {
    map.set(r.id, { name: r.name, nameEs: r.name_es, defaultPar: r.default_par, defaultParUnit: r.default_par_unit });
  }
  return map;
}
