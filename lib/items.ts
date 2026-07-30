/**
 * Item-registry resolution helpers (Item/Inventory Spine 2A).
 * Pure. The single place that decides a prep/opening line's displayed
 * name + par: from the linked item when present, else a defensive fallback
 * to the line's own prep_meta/label (shouldn't fire post-#82 backfill).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChecklistTemplateItem, ParMode } from "@/lib/types";

/** Minimal item fields needed to resolve a line's name + par. */
export interface ItemDefn {
  name: string;
  nameEs: string | null;
  defaultPar: number | null;
  defaultParUnit: string | null;
  /** Registry lifecycle: a deactivated item no longer speaks for its lines. */
  active: boolean;
}

/** An item_par_levels row as the resolver helpers need it (day-bearing). */
export interface ItemParRow {
  dayOfWeek: number | null;
  parValue: number | null;
  parUnit: string | null;
  parMode: ParMode;
}

/** A day-picked override (day stripped) as resolveLineDefinition consumes it. */
export interface ItemOverride {
  parValue: number | null;
  parUnit: string | null;
  parMode: ParMode;
}

export interface ResolvedDefinition {
  name: string;
  nameEs: string | null;
  par: number | null;
  parUnit: string | null;
}

/**
 * JS day-of-week (0 = Sunday … 6 = Saturday) for a YYYY-MM-DD operational date.
 * Parsed at midday to avoid TZ-rollover off-by-one at the day boundary.
 */
export function operationalDayOfWeek(operationalDate: string): number {
  return new Date(`${operationalDate}T12:00:00`).getDay();
}

/**
 * Pick the override that applies for a given day: the specific-day row if present,
 * else the all-days base (dayOfWeek === null), else null. Day is stripped.
 */
export function pickOverride(rows: ItemParRow[], dayOfWeek: number): ItemOverride | null {
  const specific = rows.find((r) => r.dayOfWeek === dayOfWeek);
  const chosen = specific ?? rows.find((r) => r.dayOfWeek === null) ?? null;
  if (!chosen) return null;
  return { parValue: chosen.parValue, parUnit: chosen.parUnit, parMode: chosen.parMode };
}

/**
 * A QUESTION-SHAPED prep line (yes_no / free_text input) — its LABEL IS THE
 * QUESTION ("Meatball mix - ready?"), so the registry item's name must NEVER
 * replace it (hotfix 2026-07-30: linking the meatball/bacon yes_no lines to
 * their registry items made every one of them render as the bare item name —
 * the question text vanished from the operator form, the submit snapshot AND
 * the admin editor). Pure; used by resolveLineDefinition below and exported
 * for the durable label-law design to build on.
 */
export function isQuestionShapedLine(line: ChecklistTemplateItem): boolean {
  const cols = line.prepMeta?.columns;
  if (!Array.isArray(cols)) return false;
  return isQuestionShapedColumns(cols);
}

/**
 * Column-level primitive of the same law, for callers holding a PrepMeta
 * rather than a full line (the section-change paths). ONE definition — every
 * question-shape guard routes through here so the predicate can never drift.
 */
export function isQuestionShapedColumns(columns: readonly string[]): boolean {
  return columns.includes("yes_no") || columns.includes("free_text");
}

/**
 * The WRITE half of the label law (fulledit floor — mirrors the read law
 * above): where does a label/labelEs edit land?
 *   - question-shaped line (linked or not) → the LINE — the label IS the
 *     question, edited in place; the item link is untouched.
 *   - unlinked line → the LINE (there is no registry row to write; blocking
 *     the edit never fixed linkage — the Doctor flags needs-link separately).
 *   - linked inventory line → the registry ITEM (edit-once-everywhere).
 */
export function resolvePrepLabelWriteTarget(line: ChecklistTemplateItem): "line" | "item" {
  if (!line.itemId || isQuestionShapedLine(line)) return "line";
  return "item";
}

export function resolveLineDefinition(
  line: ChecklistTemplateItem,
  item: ItemDefn | null,
  override: ItemOverride | null = null,
): ResolvedDefinition {
  // QUESTION lines keep their own label — the label IS the question. The
  // registry link still stands (depletion/costing use it); only the DISPLAY
  // authority differs. Par resolution is irrelevant here (question lines carry
  // no par), so the label-preserving fallback shape is exactly right.
  if (item && isQuestionShapedLine(line)) {
    return {
      name: line.label,
      nameEs: line.translations?.es?.label ?? null,
      par: line.prepMeta?.parValue ?? null,
      parUnit: line.prepMeta?.parUnit ?? null,
    };
  }
  // A linked-but-DEACTIVATED item no longer speaks for the line (fulledit floor):
  // fall back to the line's own label/prep_meta. Deliberate registry lifecycle,
  // not a data error — only the truly-unlinked case warns.
  const liveItem = item && item.active === false ? null : item;
  if (!liveItem) {
    if (item === null) {
      console.warn(`[items] resolveLineDefinition: line ${line.id} has no linked item; falling back to prep_meta/label`);
    }
    return {
      name: line.label,
      nameEs: line.translations?.es?.label ?? null,
      par: line.prepMeta?.parValue ?? null,
      parUnit: line.prepMeta?.parUnit ?? null,
    };
  }
  const par = override && override.parMode === "manual" ? override.parValue : liveItem.defaultPar;
  // Unit is an ITEM-GLOBAL attribute now (Units Registry slice): it always comes
  // from the item, never the per-location override. ItemOverride still carries a
  // parUnit field (harmless/vestigial) — item_par_levels.par_unit is no longer
  // written and not read here.
  const parUnit = liveItem.defaultParUnit;
  return { name: liveItem.name, nameEs: liveItem.nameEs, par, parUnit };
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
    .select("id, name, name_es, default_par, default_par_unit, active")
    .in("id", ids);
  if (error) throw new Error(`loadItemDefns: ${error.message}`);
  for (const r of (data ?? []) as Array<{ id: string; name: string; name_es: string | null; default_par: number | null; default_par_unit: string | null; active: boolean }>) {
    map.set(r.id, { name: r.name, nameEs: r.name_es, defaultPar: r.default_par, defaultParUnit: r.default_par_unit, active: r.active });
  }
  return map;
}

/**
 * Batch-load active item_par_levels rows for a set of item_ids at one location,
 * grouped by item_id (service-role). Rows are day-bearing; pickOverride picks the
 * day that applies. Mirrors loadItemDefns' dedup + early-return + throw-on-error.
 */
export async function loadItemOverrides(
  service: SupabaseClient,
  itemIds: string[],
  locationId: string,
): Promise<Map<string, ItemParRow[]>> {
  const map = new Map<string, ItemParRow[]>();
  const ids = [...new Set(itemIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return map;
  const { data, error } = await service
    .from("item_par_levels")
    .select("item_id, day_of_week, par_value, par_unit, par_mode")
    .in("item_id", ids)
    .eq("location_id", locationId)
    .eq("active", true);
  if (error) throw new Error(`loadItemOverrides: ${error.message}`);
  for (const r of (data ?? []) as Array<{ item_id: string; day_of_week: number | null; par_value: number | null; par_unit: string | null; par_mode: ParMode }>) {
    const rows = map.get(r.item_id) ?? [];
    rows.push({ dayOfWeek: r.day_of_week, parValue: r.par_value, parUnit: r.par_unit, parMode: r.par_mode });
    map.set(r.item_id, rows);
  }
  return map;
}
