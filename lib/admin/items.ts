/**
 * /admin/items central-page loader (Items Central Page, 2026-07-07 spec).
 * SERVER-ONLY. Items are first-class in the pipeline: SKUs → recipes → ITEMS →
 * checklists/reports. This composes the global item registry with the pools the
 * item editor needs + the item→producing-recipe map (the pipeline made
 * navigable). Prep-list concerns (sections editing, per-location tabs) stay in
 * lib/admin/templates.ts's loadChecklistAdminView.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { loadProductItemLinks } from "@/lib/admin/product-item-links";
import type { RegistryLink } from "@/lib/admin/product-item-links-shared";
import { getRoleLevel } from "@/lib/roles";
import { catalogShopAllowed, type VersionScope } from "@/lib/sku-versions-shared";
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
  shops: Array<{ id: string; name: string }>;
  canCreate: boolean;
  editableDefinitionIds: string[];
  registry: ChecklistRegistryItem[];
  /** Active prep sections (grouping + the section dropdown in the editor). */
  sections: PrepSectionDefn[];
  /** Canonical par units (the unit-dropdown pool). */
  units: Array<{ label: string }>;
  /** Item-attached questions (active). */
  itemQuestions: ItemQuestionView[];
  /** itemId → its ACTIVE producing recipe id (recipe_outputs). */
  producingRecipeByItem: Record<string, string>;
  madeFromByItem: Record<string, RegistryLink[]>;
  /** The product/recipe link read failed: the page renders, with a visible notice instead of empty links. */
  relationshipsUnavailable: boolean;
}

export async function loadItemsAdminView(actor: AuthContext, scope: VersionScope = null): Promise<ItemsAdminView> {
  if (getRoleLevel(actor.user.role) < ITEMS_READ_MIN) {
    throw new Error("forbidden");
  }
  const sb = getServiceRoleClient();
  const level = getRoleLevel(actor.user.role);
  const { data: shopRows, error: shopError } = await sb.from("locations").select("id, name").eq("active", true).order("name").returns<Array<{ id: string; name: string }>>();
  if (shopError) throw new Error(`items shops: ${shopError.message}`);
  const shops = (shopRows ?? []).filter(shop => catalogShopAllowed({ level, locations: actor.locations }, shop.id));
  if (scope !== null && !shops.some(shop => shop.id === scope)) throw new Error("not_found");

  const [registry, sectionMap, units, itemQuestions, relationships] = await Promise.all([
    loadItemRegistry(sb, scope),
    loadPrepSections(sb),
    loadUnits(sb),
    loadItemQuestions(sb),
    // Tolerated locally: a failed link read must not take down the item editors. The human
    // sees a "links couldn't load" notice (relationshipsUnavailable), never silently empty links.
    loadProductItemLinks(actor, scope).catch((e) => {
      console.error("product/item links load failed (rendering without links)", e);
      return null;
    }),
  ]);
  const sections = Array.from(sectionMap.values()).sort((a, b) => a.displayOrder - b.displayOrder);

  return {
    actorLevel: getRoleLevel(actor.user.role),
    shops,
    canCreate: level >= 7 && actor.user.role !== "social_media_mgr",
    editableDefinitionIds: registry.filter(item => actor.user.role !== "social_media_mgr" && (level >= 8 || (level >= 7 && item.locationId != null && actor.locations.includes(item.locationId)))).map(item => item.itemId),
    registry,
    sections,
    units,
    itemQuestions,
    producingRecipeByItem: relationships?.producingRecipeByItem ?? {},
    madeFromByItem: relationships?.madeFromByItem ?? {},
    relationshipsUnavailable: relationships === null,
  };
}
