/**
 * Admin prep-template data layer (C.44 Module 3 slice 1).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level >= 7 → assertStepUp)
 * and re-checked here for the IDOR location-bind (defense in depth). Service-role
 * bypasses RLS by design, consistent with lib/admin/users.ts.
 *
 * Prep-only this slice: type='prep' (am_prep | mid_day_prep). Opening/closing
 * editing is a later slice. prep_meta writes go through lib/prep.ts
 * setPrepItemMeta so the station/section sync invariant is preserved.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { isAllLocationsAccess, lockLocationContext } from "@/lib/locations";
import {
  TEMPLATE_ITEM_COLUMNS,
  type TemplateItemRow,
  rowToTemplateItem,
} from "@/lib/template-items";
import { setPrepItemMeta, narrowPrepTemplateItem, isPrepMeta } from "@/lib/prep";
import type { AuthContext } from "@/lib/session";
import type {
  ChecklistTemplateItem,
  ChecklistTemplateItemTranslations,
  PrepMeta,
} from "@/lib/types";

export type PrepSubtype = "am_prep" | "mid_day_prep";

export interface AdminPrepTemplateListItem {
  id: string;
  name: string;
  prepSubtype: PrepSubtype;
  activeItemCount: number;
}

export interface AdminPrepTemplateDetail {
  id: string;
  name: string;
  prepSubtype: PrepSubtype;
  locationId: string;
  items: ChecklistTemplateItem[];
}

/** Typed error the routes map to jsonError(status, code). */
export class AdminTemplateError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminTemplateError";
  }
}

interface TemplateRow {
  id: string;
  name: string;
  type: string;
  prep_subtype: PrepSubtype | null;
  location_id: string;
  active: boolean;
}

function actorLocationShape(actor: AuthContext) {
  return { role: actor.user.role, locations: actor.locations };
}

/**
 * Loads a prep template by id and binds it to the actor's authorized location.
 * Throws AdminTemplateError(404) when missing, not a prep template, or the
 * actor isn't authorized for its location (404 — don't confirm existence).
 */
async function loadAuthorizedPrepTemplate(
  actor: AuthContext,
  templateId: string,
): Promise<TemplateRow> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("checklist_templates")
    .select("id, name, type, prep_subtype, location_id, active")
    .eq("id", templateId)
    .maybeSingle<TemplateRow>();
  if (error) throw new Error(`loadAuthorizedPrepTemplate failed: ${error.message}`);
  if (!data || data.type !== "prep" || !data.prep_subtype) {
    throw new AdminTemplateError(404, "template_not_found", "Template not found");
  }
  if (!lockLocationContext(actorLocationShape(actor), data.location_id)) {
    throw new AdminTemplateError(404, "template_not_found", "Template not found");
  }
  return data;
}

/** Active prep templates (am + mid-day) at a location the actor may access. */
export async function listPrepTemplates(
  actor: AuthContext,
  locationId: string,
): Promise<AdminPrepTemplateListItem[]> {
  if (!lockLocationContext(actorLocationShape(actor), locationId)) {
    throw new AdminTemplateError(404, "location_not_found", "Location not accessible");
  }
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("checklist_templates")
    .select("id, name, prep_subtype")
    .eq("location_id", locationId)
    .eq("type", "prep")
    .eq("active", true)
    .order("prep_subtype", { ascending: true })
    .returns<Array<{ id: string; name: string; prep_subtype: PrepSubtype }>>();
  if (error) throw new Error(`listPrepTemplates failed: ${error.message}`);
  const templates = data ?? [];

  const out: AdminPrepTemplateListItem[] = [];
  for (const t of templates) {
    const { count, error: cErr } = await sb
      .from("checklist_template_items")
      .select("id", { count: "exact", head: true })
      .eq("template_id", t.id)
      .eq("active", true);
    if (cErr) throw new Error(`listPrepTemplates count failed: ${cErr.message}`);
    out.push({ id: t.id, name: t.name, prepSubtype: t.prep_subtype, activeItemCount: count ?? 0 });
  }
  return out;
}

/** A prep template's active items (typed, invariant-checked), ordered for display. */
export async function getPrepTemplateDetail(
  actor: AuthContext,
  templateId: string,
): Promise<AdminPrepTemplateDetail> {
  const tmpl = await loadAuthorizedPrepTemplate(actor, templateId);
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .eq("template_id", templateId)
    .eq("active", true)
    .order("display_order", { ascending: true })
    .returns<TemplateItemRow[]>();
  if (error) throw new Error(`getPrepTemplateDetail items failed: ${error.message}`);
  const items = (data ?? []).map(rowToTemplateItem).map(narrowPrepTemplateItem);
  return {
    id: tmpl.id,
    name: tmpl.name,
    prepSubtype: tmpl.prep_subtype as PrepSubtype,
    locationId: tmpl.location_id,
    items,
  };
}
