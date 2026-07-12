/**
 * /admin/items central-page loader (Items Central Page, 2026-07-07 spec).
 * SERVER-ONLY. Items are first-class in the pipeline: SKUs → recipes → ITEMS →
 * checklists/reports. This composes the global item registry with the pools the
 * item editor needs + the item→producing-recipe map (the pipeline made
 * navigable). Prep-list concerns (sections editing, per-location tabs) stay in
 * lib/admin/templates.ts's loadChecklistAdminView.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import type { AuthContext } from "@/lib/session";
import type { PrepSectionDefn } from "@/lib/types";
import { loadPrepSections } from "@/lib/prep-sections.server";
import { loadUnits } from "@/lib/units.server";
import {
  loadItemRegistry, loadItemQuestions,
  type ChecklistRegistryItem, type ItemQuestionView,
} from "@/lib/admin/templates";

export const ITEMS_READ_MIN = 6; // AGM+ view; add GM+ / edit MoO+ enforced by the reused routes

export interface ItemsAdminView {
  actorLevel: number;
  registry: ChecklistRegistryItem[];
  /** Active prep sections (grouping + the section dropdown in the editor). */
  sections: PrepSectionDefn[];
  /** Canonical par units (the unit-dropdown pool). */
  units: Array<{ label: string }>;
  /** Item-attached questions (active). */
  itemQuestions: ItemQuestionView[];
  /** itemId → its ACTIVE producing recipe id (recipe_outputs). */
  producingRecipeByItem: Record<string, string>;
}

export async function loadItemsAdminView(actor: AuthContext): Promise<ItemsAdminView> {
  if (getRoleLevel(actor.user.role) < ITEMS_READ_MIN) {
    throw new Error("forbidden");
  }
  const sb = getServiceRoleClient();

  const [registry, sectionMap, units, itemQuestions] = await Promise.all([
    loadItemRegistry(sb),
    loadPrepSections(sb),
    loadUnits(sb),
    loadItemQuestions(sb),
  ]);
  const sections = Array.from(sectionMap.values()).sort((a, b) => a.displayOrder - b.displayOrder);

  // itemId → producing recipe, ACTIVE recipes only (an item produced solely by
  // an inactive recipe reads "no recipe" — mirrors lib/admin/readiness-load.ts).
  const [{ data: recRows }, { data: outRows }] = await Promise.all([
    sb.from("recipes").select("id").eq("active", true).returns<Array<{ id: string }>>(),
    sb.from("recipe_outputs").select("recipe_id, output_item_id").not("output_item_id", "is", null)
      .returns<Array<{ recipe_id: string; output_item_id: string }>>(),
  ]);
  const activeRecipeIds = new Set((recRows ?? []).map((r) => r.id));
  const producingRecipeByItem: Record<string, string> = {};
  for (const o of outRows ?? []) {
    if (activeRecipeIds.has(o.recipe_id)) producingRecipeByItem[o.output_item_id] = o.recipe_id;
  }

  return {
    actorLevel: getRoleLevel(actor.user.role),
    registry,
    sections,
    units,
    itemQuestions,
    producingRecipeByItem,
  };
}
