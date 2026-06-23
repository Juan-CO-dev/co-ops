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
import { setPrepItemMeta, setPrepItemSection, narrowPrepTemplateItem, isPrepMeta, seedPrepItem } from "@/lib/prep";
import { columnsForSection, isPrepSectionName } from "@/lib/prep-sections";
import type { AuthContext } from "@/lib/session";
import type {
  ChecklistTemplateItem,
  ChecklistTemplateItemTranslations,
  PrepMeta,
  PrepSection,
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

/** Resolve the active opening template id at a location (most-recent-active). */
async function resolveActiveOpeningTemplateId(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("checklist_templates")
    .select("id")
    .eq("location_id", locationId)
    .eq("type", "opening")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`resolveActiveOpeningTemplateId failed: ${error.message}`);
  return data?.id ?? null;
}

/**
 * Update the linked Opening Phase-2 mirror's par (OpeningPhase2Meta.parValue/
 * parUnit). Link = mirror's references_template_item_id → the AM-prep item id,
 * scoped to the active opening template at the location. Returns affected ids.
 * No-op ([]) when no active opening template or no linked item.
 */
async function propagateParToOpeningMirror(args: {
  amPrepItemId: string;
  locationId: string;
  parValue: number | null;
  parUnit: string | null;
}): Promise<string[]> {
  const sb = getServiceRoleClient();
  const openingId = await resolveActiveOpeningTemplateId(sb, args.locationId);
  if (!openingId) return [];
  const { data: linked, error: lErr } = await sb
    .from("checklist_template_items")
    .select("id, prep_meta")
    .eq("template_id", openingId)
    .eq("references_template_item_id", args.amPrepItemId)
    .eq("active", true)
    .returns<Array<{ id: string; prep_meta: Record<string, unknown> | null }>>();
  if (lErr) throw new Error(`propagate: linked items lookup failed: ${lErr.message}`);
  const ids: string[] = [];
  for (const item of linked ?? []) {
    const nextMeta = { ...(item.prep_meta ?? {}), parValue: args.parValue, parUnit: args.parUnit };
    const { error: uErr } = await sb.from("checklist_template_items").update({ prep_meta: nextMeta }).eq("id", item.id);
    if (uErr) throw new Error(`propagate: update item ${item.id} failed: ${uErr.message}`);
    ids.push(item.id);
  }
  return ids;
}

/**
 * Create an Opening Phase-2 verification mirror for a newly-added AM-prep item.
 * Inserts into the active opening template at the location with OpeningPhase2Meta
 * prep_meta and references_template_item_id = the AM-prep item. Mirrors label/
 * translations/min-role/required; par/section mirrored. Appends to display_order.
 * Returns the new mirror id, or null when no active opening template (graceful).
 */
async function createOpeningMirror(args: {
  amPrepItemId: string;
  locationId: string;
  section: PrepSection;
  parValue: number | null;
  parUnit: string | null;
  label: string;
  translations: ChecklistTemplateItemTranslations | null;
  minRoleLevel: number;
  required: boolean;
}): Promise<string | null> {
  const sb = getServiceRoleClient();
  const openingId = await resolveActiveOpeningTemplateId(sb, args.locationId);
  if (!openingId) return null;

  const { data: maxRow, error: mErr } = await sb
    .from("checklist_template_items")
    .select("display_order")
    .eq("template_id", openingId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mErr) throw new Error(`createOpeningMirror max order failed: ${mErr.message}`);
  const nextOrder = (maxRow?.display_order ?? 0) + 1;

  const { data: inserted, error: iErr } = await sb
    .from("checklist_template_items")
    .insert({
      template_id: openingId,
      station: args.section,
      display_order: nextOrder,
      label: args.label,
      description: null,
      min_role_level: args.minRoleLevel,
      required: args.required,
      expects_count: false,
      expects_photo: false,
      vendor_item_id: null,
      active: true,
      translations: args.translations,
      prep_meta: { openingPhase2: true, section: args.section, parValue: args.parValue, parUnit: args.parUnit },
      report_reference_type: null,
      references_template_item_id: args.amPrepItemId,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) throw new Error(`createOpeningMirror insert failed: ${iErr.message}`);
  return inserted?.id ?? null;
}

/** Deactivate (active=false) the Opening mirror(s) linked to an AM-prep item. Returns affected ids. */
async function deactivateOpeningMirror(args: { amPrepItemId: string; locationId: string }): Promise<string[]> {
  const sb = getServiceRoleClient();
  const openingId = await resolveActiveOpeningTemplateId(sb, args.locationId);
  if (!openingId) return [];
  const { data, error } = await sb
    .from("checklist_template_items")
    .update({ active: false })
    .eq("template_id", openingId)
    .eq("references_template_item_id", args.amPrepItemId)
    .eq("active", true)
    .select("id")
    .returns<Array<{ id: string }>>();
  if (error) throw new Error(`deactivateOpeningMirror failed: ${error.message}`);
  return (data ?? []).map((r) => r.id);
}

/** Update the Opening mirror's section (station + prep_meta.section) for a re-sectioned AM-prep item. */
async function setOpeningMirrorSection(args: { amPrepItemId: string; locationId: string; section: PrepSection }): Promise<string[]> {
  const sb = getServiceRoleClient();
  const openingId = await resolveActiveOpeningTemplateId(sb, args.locationId);
  if (!openingId) return [];
  const { data: linked, error: lErr } = await sb
    .from("checklist_template_items")
    .select("id, prep_meta")
    .eq("template_id", openingId)
    .eq("references_template_item_id", args.amPrepItemId)
    .eq("active", true)
    .returns<Array<{ id: string; prep_meta: Record<string, unknown> | null }>>();
  if (lErr) throw new Error(`setOpeningMirrorSection lookup failed: ${lErr.message}`);
  const ids: string[] = [];
  for (const item of linked ?? []) {
    const nextMeta = { ...(item.prep_meta ?? {}), section: args.section };
    const { error: uErr } = await sb
      .from("checklist_template_items")
      .update({ station: args.section, prep_meta: nextMeta })
      .eq("id", item.id);
    if (uErr) throw new Error(`setOpeningMirrorSection update ${item.id} failed: ${uErr.message}`);
    ids.push(item.id);
  }
  return ids;
}

export interface PrepItemContentPatch {
  label?: string;
  labelEs?: string | null;
  description?: string | null;
  descriptionEs?: string | null;
  displayOrder?: number;
  required?: boolean;
  parValue?: number | null;
  parUnit?: string | null;
  specialInstruction?: string | null; // en (prep_meta.specialInstruction)
  specialInstructionEs?: string | null;
}

function mergeEsTranslation(
  existing: ChecklistTemplateItemTranslations | null,
  patch: { label?: string | null; description?: string | null; specialInstruction?: string | null },
): ChecklistTemplateItemTranslations {
  const next: ChecklistTemplateItemTranslations = { ...(existing ?? {}) };
  const es = { ...(next.es ?? {}) };
  if (patch.label !== undefined) es.label = patch.label ?? undefined;
  if (patch.description !== undefined) es.description = patch.description;
  if (patch.specialInstruction !== undefined) es.specialInstruction = patch.specialInstruction;
  next.es = es;
  return next;
}

/**
 * In-place content edit of a prep template item (Tier A). Writes prep_meta via
 * setPrepItemMeta (preserves section/columns, asserts station match), top-level
 * columns + translations via a direct UPDATE. AM-prep par edits propagate to
 * the Opening mirror. Audits checklist_template_item.update with before/after.
 */
export async function updatePrepItemContent(
  actor: AuthContext,
  args: { templateId: string; itemId: string; patch: PrepItemContentPatch },
): Promise<void> {
  const tmpl = await loadAuthorizedPrepTemplate(actor, args.templateId);
  const sb = getServiceRoleClient();

  const { data: rawRow, error: rErr } = await sb
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .eq("id", args.itemId)
    .eq("template_id", args.templateId)
    .eq("active", true)
    .maybeSingle<TemplateItemRow>();
  if (rErr) throw new Error(`updatePrepItemContent read failed: ${rErr.message}`);
  if (!rawRow) throw new AdminTemplateError(404, "item_not_found", "Template item not found");
  const item = rowToTemplateItem(rawRow);

  const { patch } = args;
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  // ── Top-level columns + en translations ──────────────────────────────────
  const colUpdate: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const v = patch.label.trim();
    if (!v) throw new AdminTemplateError(400, "invalid_label", "Label cannot be empty");
    if (v !== item.label) { before.label = item.label; after.label = v; colUpdate.label = v; }
  }
  if (patch.description !== undefined) {
    const v = patch.description?.trim() || null;
    if (v !== item.description) { before.description = item.description; after.description = v; colUpdate.description = v; }
  }
  if (patch.displayOrder !== undefined) {
    if (!Number.isInteger(patch.displayOrder) || patch.displayOrder < 0) {
      throw new AdminTemplateError(400, "invalid_display_order", "Display order must be a non-negative integer");
    }
    if (patch.displayOrder !== item.displayOrder) {
      before.displayOrder = item.displayOrder; after.displayOrder = patch.displayOrder;
      colUpdate.display_order = patch.displayOrder;
    }
  }
  if (patch.required !== undefined && patch.required !== item.required) {
    before.required = item.required; after.required = patch.required; colUpdate.required = patch.required;
  }

  // es translations (label/description/specialInstruction)
  const esPatch: { label?: string | null; description?: string | null; specialInstruction?: string | null } = {};
  if (patch.labelEs !== undefined) esPatch.label = patch.labelEs?.trim() || null;
  if (patch.descriptionEs !== undefined) esPatch.description = patch.descriptionEs?.trim() || null;
  if (patch.specialInstructionEs !== undefined) esPatch.specialInstruction = patch.specialInstructionEs?.trim() || null;
  if (Object.keys(esPatch).length > 0) {
    colUpdate.translations = mergeEsTranslation(item.translations, esPatch);
    before.translations_es = item.translations?.es ?? null;
    after.translations_es = (colUpdate.translations as ChecklistTemplateItemTranslations).es;
  }

  if (Object.keys(colUpdate).length > 0) {
    const { error: uErr } = await sb
      .from("checklist_template_items").update(colUpdate).eq("id", args.itemId);
    if (uErr) throw new Error(`updatePrepItemContent column update failed: ${uErr.message}`);
  }

  // ── prep_meta (par/unit/specialInstruction en) via setPrepItemMeta ────────
  let parChanged = false;
  const touchesMeta =
    patch.parValue !== undefined || patch.parUnit !== undefined || patch.specialInstruction !== undefined;
  if (touchesMeta) {
    if (!isPrepMeta(item.prepMeta)) {
      throw new AdminTemplateError(400, "not_a_prep_item", "Item has no editable prep metadata");
    }
    const base: PrepMeta = item.prepMeta;
    const nextMeta: PrepMeta = {
      ...base,
      parValue: patch.parValue !== undefined ? patch.parValue : base.parValue,
      parUnit: patch.parUnit !== undefined ? (patch.parUnit?.trim() || null) : base.parUnit,
      specialInstruction:
        patch.specialInstruction !== undefined
          ? (patch.specialInstruction?.trim() || null)
          : base.specialInstruction,
    };
    if (nextMeta.parValue !== null && (!Number.isFinite(nextMeta.parValue) || nextMeta.parValue < 0)) {
      throw new AdminTemplateError(400, "invalid_par", "Par must be a non-negative number or empty");
    }
    parChanged = nextMeta.parValue !== base.parValue || nextMeta.parUnit !== base.parUnit;
    if (
      nextMeta.parValue !== base.parValue ||
      nextMeta.parUnit !== base.parUnit ||
      nextMeta.specialInstruction !== base.specialInstruction
    ) {
      before.prep_meta = { parValue: base.parValue, parUnit: base.parUnit, specialInstruction: base.specialInstruction };
      after.prep_meta = { parValue: nextMeta.parValue, parUnit: nextMeta.parUnit, specialInstruction: nextMeta.specialInstruction };
      // setPrepItemMeta asserts meta.section === existing station before writing.
      await setPrepItemMeta(sb, { templateItemId: args.itemId, meta: nextMeta });
    }
  }

  if (Object.keys(after).length === 0) return; // nothing changed

  // ── Propagation (AM-prep par edits → Opening mirror) ─────────────────────
  let propagatedTo: string[] = [];
  if (parChanged && tmpl.prep_subtype === "am_prep") {
    propagatedTo = await propagateParToOpeningMirror({
      amPrepItemId: args.itemId,
      locationId: tmpl.location_id,
      parValue: (after.prep_meta as { parValue: number | null }).parValue,
      parUnit: (after.prep_meta as { parUnit: string | null }).parUnit,
    });
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template_item.update",
    resourceTable: "checklist_template_items",
    resourceId: args.itemId,
    metadata: {
      template_id: args.templateId,
      prep_subtype: tmpl.prep_subtype,
      before,
      after,
      ...(propagatedTo.length > 0
        ? {
            propagated_to_item_ids: propagatedTo,
            par_before: (before.prep_meta as { parValue: number | null } | undefined)?.parValue ?? null,
            par_after: (after.prep_meta as { parValue: number | null } | undefined)?.parValue ?? null,
          }
        : {}),
    },
    ipAddress: null,
    userAgent: null,
  });
}

/** Tier-B: change who can complete a prep step. Audited; no propagation. */
export async function setPrepItemMinRole(
  actor: AuthContext,
  args: { templateId: string; itemId: string; minRoleLevel: number },
): Promise<void> {
  const tmpl = await loadAuthorizedPrepTemplate(actor, args.templateId);
  if (!Number.isFinite(args.minRoleLevel) || args.minRoleLevel < 0 || args.minRoleLevel > 10) {
    throw new AdminTemplateError(400, "invalid_min_role", "Min role level must be between 0 and 10");
  }
  const sb = getServiceRoleClient();
  const { data: row, error: rErr } = await sb
    .from("checklist_template_items")
    .select("min_role_level")
    .eq("id", args.itemId)
    .eq("template_id", args.templateId)
    .eq("active", true)
    .maybeSingle<{ min_role_level: number }>();
  if (rErr) throw new Error(`setPrepItemMinRole read failed: ${rErr.message}`);
  if (!row) throw new AdminTemplateError(404, "item_not_found", "Template item not found");
  if (row.min_role_level === args.minRoleLevel) return;

  const { error: uErr } = await sb
    .from("checklist_template_items")
    .update({ min_role_level: args.minRoleLevel })
    .eq("id", args.itemId);
  if (uErr) throw new Error(`setPrepItemMinRole update failed: ${uErr.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template_item.update",
    resourceTable: "checklist_template_items",
    resourceId: args.itemId,
    metadata: {
      template_id: args.templateId,
      prep_subtype: tmpl.prep_subtype,
      field: "min_role_level",
      tier: "B",
      before: { min_role_level: row.min_role_level },
      after: { min_role_level: args.minRoleLevel },
    },
    ipAddress: null,
    userAgent: null,
  });
}

export interface AddPrepItemInput {
  section: PrepSection;
  parValue: number | null;
  parUnit: string | null;
  label: string;
  labelEs: string | null;
  description: string | null;
  descriptionEs: string | null;
  specialInstruction: string | null;
  specialInstructionEs: string | null;
  minRoleLevel: number;
  required: boolean;
  includeNote: boolean;        // Misc only: add the free_text column
  createOpeningMirror: boolean; // am_prep only; ignored for mid-day
}

/** Add a prep template item in place (Tier B). AM-prep optionally gets an Opening mirror. */
export async function addPrepItem(
  actor: AuthContext,
  args: { templateId: string; input: AddPrepItemInput },
): Promise<{ itemId: string; openingMirrorId: string | null }> {
  const tmpl = await loadAuthorizedPrepTemplate(actor, args.templateId);
  const sb = getServiceRoleClient();
  const { input } = args;

  if (!isPrepSectionName(input.section)) throw new AdminTemplateError(400, "invalid_section", "Unknown section");
  const label = input.label.trim();
  if (!label) throw new AdminTemplateError(400, "invalid_label", "Label is required");
  if (input.parValue !== null && (!Number.isFinite(input.parValue) || input.parValue < 0)) {
    throw new AdminTemplateError(400, "invalid_par", "Par must be a non-negative number or empty");
  }
  if (!Number.isFinite(input.minRoleLevel) || input.minRoleLevel < 0 || input.minRoleLevel > 10) {
    throw new AdminTemplateError(400, "invalid_min_role", "Min role level must be between 0 and 10");
  }

  // Append to display order (no unique constraint; max+1 across the template).
  const { data: maxRow, error: mErr } = await sb
    .from("checklist_template_items")
    .select("display_order")
    .eq("template_id", args.templateId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mErr) throw new Error(`addPrepItem max order failed: ${mErr.message}`);
  const displayOrder = (maxRow?.display_order ?? 0) + 1;

  // Build es translations from the *Es fields (only when present).
  const esLabel = input.labelEs?.trim() || undefined;
  const esDesc = input.descriptionEs?.trim() || null;
  const esSi = input.specialInstructionEs?.trim() || null;
  const hasEs = esLabel !== undefined || input.descriptionEs !== null || input.specialInstructionEs !== null;
  const translations: ChecklistTemplateItemTranslations | undefined = hasEs
    ? { es: { ...(esLabel !== undefined ? { label: esLabel } : {}), description: esDesc, specialInstruction: esSi } }
    : undefined;

  const { templateItemId } = await seedPrepItem(sb, {
    templateId: args.templateId,
    displayOrder,
    section: input.section,
    label,
    description: input.description?.trim() || null,
    minRoleLevel: input.minRoleLevel,
    required: input.required,
    meta: {
      parValue: input.parValue,
      parUnit: input.parUnit?.trim() || null,
      specialInstruction: input.specialInstruction?.trim() || null,
      columns: columnsForSection(input.section, input.includeNote),
    },
    translations,
  });

  let openingMirrorId: string | null = null;
  if (tmpl.prep_subtype === "am_prep" && input.createOpeningMirror) {
    openingMirrorId = await createOpeningMirror({
      amPrepItemId: templateItemId,
      locationId: tmpl.location_id,
      section: input.section,
      parValue: input.parValue,
      parUnit: input.parUnit?.trim() || null,
      label,
      translations: translations ?? null,
      minRoleLevel: input.minRoleLevel,
      required: input.required,
    });
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template_item.create",
    resourceTable: "checklist_template_items",
    resourceId: templateItemId,
    metadata: {
      template_id: args.templateId,
      prep_subtype: tmpl.prep_subtype,
      section: input.section,
      created_opening_mirror_id: openingMirrorId,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { itemId: templateItemId, openingMirrorId };
}

/** Remove (soft-delete) a prep item in place (Tier B). AM-prep cascade-deactivates the Opening mirror. */
export async function removePrepItem(
  actor: AuthContext,
  args: { templateId: string; itemId: string },
): Promise<{ deactivatedMirrorIds: string[] }> {
  const tmpl = await loadAuthorizedPrepTemplate(actor, args.templateId);
  const sb = getServiceRoleClient();

  const { data: row, error: rErr } = await sb
    .from("checklist_template_items")
    .select("id, active")
    .eq("id", args.itemId)
    .eq("template_id", args.templateId)
    .maybeSingle<{ id: string; active: boolean }>();
  if (rErr) throw new Error(`removePrepItem read failed: ${rErr.message}`);
  if (!row) throw new AdminTemplateError(404, "item_not_found", "Template item not found");
  if (!row.active) return { deactivatedMirrorIds: [] }; // already removed — idempotent

  const { error: uErr } = await sb
    .from("checklist_template_items")
    .update({ active: false })
    .eq("id", args.itemId);
  if (uErr) throw new Error(`removePrepItem deactivate failed: ${uErr.message}`);

  let deactivatedMirrorIds: string[] = [];
  if (tmpl.prep_subtype === "am_prep") {
    deactivatedMirrorIds = await deactivateOpeningMirror({ amPrepItemId: args.itemId, locationId: tmpl.location_id });
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template_item.delete",
    resourceTable: "checklist_template_items",
    resourceId: args.itemId,
    metadata: { template_id: args.templateId, prep_subtype: tmpl.prep_subtype, deactivated_mirror_ids: deactivatedMirrorIds },
    ipAddress: null,
    userAgent: null,
  });

  return { deactivatedMirrorIds };
}

/**
 * Change a prep item's section in place (Tier B). Syncs station+prep_meta.section
 * via setPrepItemSection, then re-derives columns from the new section's
 * convention (preserving par/unit/specialInstruction scalars). AM-prep also
 * updates the Opening mirror's section. Audits with before/after section.
 */
export async function changePrepItemSection(
  actor: AuthContext,
  args: { templateId: string; itemId: string; section: PrepSection },
): Promise<{ mirrorSyncedIds: string[] }> {
  const tmpl = await loadAuthorizedPrepTemplate(actor, args.templateId);
  if (!isPrepSectionName(args.section)) throw new AdminTemplateError(400, "invalid_section", "Unknown section");
  const sb = getServiceRoleClient();

  const { data: rawRow, error: rErr } = await sb
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .eq("id", args.itemId)
    .eq("template_id", args.templateId)
    .eq("active", true)
    .maybeSingle<TemplateItemRow>();
  if (rErr) throw new Error(`changePrepItemSection read failed: ${rErr.message}`);
  if (!rawRow) throw new AdminTemplateError(404, "item_not_found", "Template item not found");
  const item = rowToTemplateItem(rawRow);
  if (!isPrepMeta(item.prepMeta)) throw new AdminTemplateError(400, "not_a_prep_item", "Item has no prep metadata");

  const fromSection = item.prepMeta.section;
  if (fromSection === args.section) return { mirrorSyncedIds: [] }; // no-op

  // 1) Sync station + prep_meta.section to the new section (preserves scalars + columns).
  await setPrepItemSection(sb, { templateItemId: args.itemId, section: args.section });

  // 2) Re-derive columns for the new section (preserve par/unit/specialInstruction).
  const keepNote = args.section === "Misc" && item.prepMeta.columns.includes("free_text");
  const nextMeta: PrepMeta = {
    section: args.section,
    parValue: item.prepMeta.parValue,
    parUnit: item.prepMeta.parUnit,
    specialInstruction: item.prepMeta.specialInstruction,
    columns: columnsForSection(args.section, keepNote),
  };
  // setPrepItemMeta asserts meta.section === existing station (now args.section). OK.
  await setPrepItemMeta(sb, { templateItemId: args.itemId, meta: nextMeta });

  let mirrorSyncedIds: string[] = [];
  if (tmpl.prep_subtype === "am_prep") {
    mirrorSyncedIds = await setOpeningMirrorSection({ amPrepItemId: args.itemId, locationId: tmpl.location_id, section: args.section });
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template_item.update",
    resourceTable: "checklist_template_items",
    resourceId: args.itemId,
    metadata: {
      template_id: args.templateId,
      prep_subtype: tmpl.prep_subtype,
      field: "section",
      before: { section: fromSection },
      after: { section: args.section },
      mirror_synced_ids: mirrorSyncedIds,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { mirrorSyncedIds };
}
