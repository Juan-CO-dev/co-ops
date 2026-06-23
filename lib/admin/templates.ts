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
  ParMode,
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

/** Per-line par context for the admin editor (Item/Inventory Spine 2B). */
export interface PrepLineParContext {
  itemId: string | null;
  itemGlobal: boolean;
  /** The item's default_par = the global recommendation (NOT the vestigial line prep_meta). */
  recommendedPar: number | null;
  recommendedParUnit: string | null;
  overrides: Array<{ dayOfWeek: number | null; parValue: number | null; parUnit: string | null; parMode: ParMode }>;
}

export interface AdminPrepTemplateDetail {
  id: string;
  name: string;
  prepSubtype: PrepSubtype;
  locationId: string;
  items: ChecklistTemplateItem[];
  /** Keyed by LINE id (checklist_template_items.id). */
  parContext: Record<string, PrepLineParContext>;
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

  // ── Par context per line (Item/Inventory Spine 2B) ────────────────────────
  // Each line resolves to its registry item's global status + this location's
  // active par overrides. Lines with no linked item get an empty context.
  const itemIds = Array.from(
    new Set(items.map((it) => it.itemId).filter((v): v is string => typeof v === "string")),
  );

  const itemGlobalById = new Map<string, boolean>();
  const recommendationById = new Map<string, { par: number | null; parUnit: string | null }>();
  const overridesByItem = new Map<
    string,
    Array<{ dayOfWeek: number | null; parValue: number | null; parUnit: string | null; parMode: ParMode }>
  >();

  if (itemIds.length > 0) {
    const { data: itemRows, error: iErr } = await sb
      .from("items")
      .select("id, location_id, default_par, default_par_unit")
      .in("id", itemIds)
      .returns<Array<{ id: string; location_id: string | null; default_par: number | null; default_par_unit: string | null }>>();
    if (iErr) throw new Error(`getPrepTemplateDetail items lookup failed: ${iErr.message}`);
    for (const r of itemRows ?? []) {
      itemGlobalById.set(r.id, r.location_id === null);
      recommendationById.set(r.id, { par: r.default_par, parUnit: r.default_par_unit });
    }

    const { data: parRows, error: pErr } = await sb
      .from("item_par_levels")
      .select("item_id, day_of_week, par_value, par_unit, par_mode")
      .in("item_id", itemIds)
      .eq("location_id", tmpl.location_id)
      .eq("active", true)
      .returns<Array<{ item_id: string; day_of_week: number | null; par_value: number | null; par_unit: string | null; par_mode: ParMode }>>();
    if (pErr) throw new Error(`getPrepTemplateDetail par lookup failed: ${pErr.message}`);
    for (const r of parRows ?? []) {
      const arr = overridesByItem.get(r.item_id) ?? [];
      arr.push({ dayOfWeek: r.day_of_week, parValue: r.par_value, parUnit: r.par_unit, parMode: r.par_mode });
      overridesByItem.set(r.item_id, arr);
    }
  }

  const parContext: Record<string, PrepLineParContext> = {};
  for (const it of items) {
    const itemId = typeof it.itemId === "string" ? it.itemId : null;
    const rec = itemId ? recommendationById.get(itemId) ?? null : null;
    parContext[it.id] = itemId
      ? {
          itemId,
          itemGlobal: itemGlobalById.get(itemId) ?? false,
          recommendedPar: rec?.par ?? null,
          recommendedParUnit: rec?.parUnit ?? null,
          overrides: overridesByItem.get(itemId) ?? [],
        }
      : { itemId: null, itemGlobal: false, recommendedPar: null, recommendedParUnit: null, overrides: [] };
  }

  return {
    id: tmpl.id,
    name: tmpl.name,
    prepSubtype: tmpl.prep_subtype as PrepSubtype,
    locationId: tmpl.location_id,
    items,
    parContext,
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
 * Create an Opening Phase-2 verification mirror for a newly-added AM-prep item.
 * Inserts into the active opening template at the location with OpeningPhase2Meta
 * prep_meta and references_template_item_id = the AM-prep item. Mirrors label/
 * translations/min-role/required; par/section mirrored. Appends to display_order.
 * Returns the new mirror id, or null when no active opening template (graceful).
 */
async function createOpeningMirror(args: {
  amPrepItemId: string;
  itemId: string | null;
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
      // Share the AM-prep line's registry item so the opening mirror resolves
      // name + par from the same item (within-location edit-once-everywhere).
      item_id: args.itemId,
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
  patch: { description?: string | null; specialInstruction?: string | null },
): ChecklistTemplateItemTranslations {
  const next: ChecklistTemplateItemTranslations = { ...(existing ?? {}) };
  const es = { ...(next.es ?? {}) };
  if (patch.description !== undefined) es.description = patch.description;
  if (patch.specialInstruction !== undefined) es.specialInstruction = patch.specialInstruction;
  next.es = es;
  return next;
}

/**
 * In-place content edit of a prep template item (Tier A). Par + name (label/
 * labelEs) write the linked registry `items` row (edit-once-everywhere — they
 * apply to the item on every list it appears on). Line-level fields
 * (description/descriptionEs, specialInstruction/specialInstructionEs,
 * required, displayOrder) write the line via direct UPDATE + setPrepItemMeta.
 * Audits checklist_template_item.update with before/after (incl. item before/
 * after + item_id when par/name changed).
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

  // ── Registry item (par + name → the item; edit-once-everywhere) ───────────
  // Par and name (label/labelEs) write the linked `items` row, not the line —
  // they apply to the item on every list it appears on. Validation of label
  // emptiness mirrors the prior line-level check.
  const itemUpdate: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const v = patch.label.trim();
    if (!v) throw new AdminTemplateError(400, "invalid_label", "Label cannot be empty");
    itemUpdate.name = v;
  }
  if (patch.labelEs !== undefined) itemUpdate.name_es = patch.labelEs?.trim() || null;
  if (patch.parValue !== undefined) {
    if (patch.parValue !== null && (!Number.isFinite(patch.parValue) || patch.parValue < 0)) {
      throw new AdminTemplateError(400, "invalid_par", "Par must be a non-negative number or empty");
    }
    itemUpdate.default_par = patch.parValue;
  }
  if (patch.parUnit !== undefined) itemUpdate.default_par_unit = patch.parUnit?.trim() || null;

  // ── Top-level columns + en translations ──────────────────────────────────
  const colUpdate: Record<string, unknown> = {};
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

  // es translations (description/specialInstruction stay line-level; label_es
  // now lives on the item as name_es — see itemUpdate above).
  const esPatch: { description?: string | null; specialInstruction?: string | null } = {};
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

  // ── prep_meta (specialInstruction en only) via setPrepItemMeta ────────────
  // Par/unit no longer live in prep_meta — they're item-level (default_par /
  // default_par_unit on the items row). Only the en specialInstruction is a
  // line-level prep_meta scalar.
  if (patch.specialInstruction !== undefined) {
    if (!isPrepMeta(item.prepMeta)) {
      throw new AdminTemplateError(400, "not_a_prep_item", "Item has no editable prep metadata");
    }
    const base: PrepMeta = item.prepMeta;
    const nextSi = patch.specialInstruction?.trim() || null;
    if (nextSi !== base.specialInstruction) {
      const nextMeta: PrepMeta = { ...base, specialInstruction: nextSi };
      before.prep_meta = { specialInstruction: base.specialInstruction };
      after.prep_meta = { specialInstruction: nextSi };
      // setPrepItemMeta asserts meta.section === existing station before writing.
      await setPrepItemMeta(sb, { templateItemId: args.itemId, meta: nextMeta });
    }
  }

  // ── Registry item write (par + name → the item, edit-once-everywhere) ─────
  if (Object.keys(itemUpdate).length > 0) {
    if (!item.itemId) {
      throw new AdminTemplateError(409, "item_unlinked", "This line has no linked registry item");
    }
    before.item = {
      ...(itemUpdate.name !== undefined ? { name: item.label } : {}),
      ...(itemUpdate.name_es !== undefined ? { name_es: item.translations?.es?.label ?? null } : {}),
      ...(itemUpdate.default_par !== undefined ? { default_par: item.prepMeta?.parValue ?? null } : {}),
      ...(itemUpdate.default_par_unit !== undefined ? { default_par_unit: item.prepMeta?.parUnit ?? null } : {}),
    };
    after.item = {
      ...(itemUpdate.name !== undefined ? { name: itemUpdate.name } : {}),
      ...(itemUpdate.name_es !== undefined ? { name_es: itemUpdate.name_es } : {}),
      ...(itemUpdate.default_par !== undefined ? { default_par: itemUpdate.default_par } : {}),
      ...(itemUpdate.default_par_unit !== undefined ? { default_par_unit: itemUpdate.default_par_unit } : {}),
    };
    itemUpdate.updated_by = actor.user.id;
    itemUpdate.updated_at = new Date().toISOString();
    const { error: itemErr } = await sb.from("items").update(itemUpdate).eq("id", item.itemId);
    if (itemErr) throw new Error(`updatePrepItemContent item update: ${itemErr.message}`);
  }

  if (Object.keys(after).length === 0) return; // nothing changed

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
      ...(after.item !== undefined
        ? { item_id: item.itemId, item_fields: Object.keys(after.item as Record<string, unknown>) }
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

  const parUnit = input.parUnit?.trim() || null;

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
      parUnit,
      specialInstruction: input.specialInstruction?.trim() || null,
      columns: columnsForSection(input.section, input.includeNote),
    },
    translations,
  });

  // ── Registry-back the new line (Item/Inventory Spine 2B) ──────────────────
  // Create a location-owned manual item carrying name + recommended default_par,
  // link the line to it, and seed an all-days manual par override at the
  // location so the resolver has both the recommendation (item.default_par) and
  // the operational override (item_par_levels). edit-once-everywhere: the
  // opening mirror shares the same item id.
  const { data: itemRow, error: itemErr } = await sb
    .from("items")
    .insert({
      location_id: tmpl.location_id,
      kind: "manual",
      name: label,
      name_es: esLabel ?? null,
      section: input.section,
      default_par: input.parValue,
      default_par_unit: parUnit,
      active: true,
      created_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (itemErr) throw new Error(`addPrepItem item insert failed: ${itemErr.message}`);
  if (!itemRow) throw new Error(`addPrepItem item insert returned no row`);
  const itemId = itemRow.id;

  const { error: linkErr } = await sb
    .from("checklist_template_items")
    .update({ item_id: itemId })
    .eq("id", templateItemId);
  if (linkErr) throw new Error(`addPrepItem item link failed: ${linkErr.message}`);

  const { error: parErr } = await sb.from("item_par_levels").insert({
    item_id: itemId,
    location_id: tmpl.location_id,
    day_of_week: null,
    par_value: input.parValue,
    par_unit: parUnit,
    par_mode: "manual",
    created_by: actor.user.id,
    updated_by: actor.user.id,
  });
  if (parErr) throw new Error(`addPrepItem par seed failed: ${parErr.message}`);

  let openingMirrorId: string | null = null;
  if (tmpl.prep_subtype === "am_prep" && input.createOpeningMirror) {
    openingMirrorId = await createOpeningMirror({
      amPrepItemId: templateItemId,
      itemId,
      locationId: tmpl.location_id,
      section: input.section,
      parValue: input.parValue,
      parUnit,
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
      item_id: itemId,
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

/**
 * Set (or supersede) a per-location, per-day par OVERRIDE for the item linked to
 * a prep line (Item/Inventory Spine 2B). Writes `item_par_levels`, NOT the items
 * row — the global recommendation (`items.default_par`) is edited via
 * updatePrepItemContent. Route enforces AGM+ (≥6); this lib does not re-gate role.
 *
 * Upsert strategy: append-only. Deactivate any existing active row for the
 * (item_id, locationId, dayOfWeek) slot, then INSERT the new row — preserves a
 * forensic trail and respects the partial unique indexes (one active base row per
 * (item,location) where dow IS NULL; one per (item,location,dow) otherwise).
 *
 * IDOR: the line's template is location-bound via loadAuthorizedPrepTemplate, and
 * args.locationId must equal that template's location (the override lives at the
 * template's location). Mismatch → 404 (don't confirm another location exists).
 */
export async function setItemPar(
  actor: AuthContext,
  args: {
    templateId: string;
    lineItemId: string; // checklist_template_items.id
    locationId: string;
    dayOfWeek: number | null;
    parValue: number | null;
    parUnit: string | null;
    parMode: ParMode;
  },
): Promise<void> {
  const tmpl = await loadAuthorizedPrepTemplate(actor, args.templateId);

  // Validate inputs.
  if (args.parValue !== null && (!Number.isFinite(args.parValue) || args.parValue < 0)) {
    throw new AdminTemplateError(400, "invalid_par", "Par must be a non-negative number or empty");
  }
  if (args.parMode !== "inherit" && args.parMode !== "manual" && args.parMode !== "auto") {
    throw new AdminTemplateError(400, "invalid_par_mode", "Par mode must be inherit, manual, or auto");
  }
  if (args.dayOfWeek !== null && (!Number.isInteger(args.dayOfWeek) || args.dayOfWeek < 0 || args.dayOfWeek > 6)) {
    throw new AdminTemplateError(400, "invalid_day_of_week", "Day of week must be 0–6 or null");
  }
  // IDOR: the override is per-location; it must be the template's location.
  if (args.locationId !== tmpl.location_id) {
    throw new AdminTemplateError(404, "location_not_found", "Location not accessible");
  }

  const sb = getServiceRoleClient();

  // Resolve the line → its registry item.
  const { data: line, error: lErr } = await sb
    .from("checklist_template_items")
    .select("item_id")
    .eq("id", args.lineItemId)
    .eq("template_id", args.templateId)
    .eq("active", true)
    .maybeSingle<{ item_id: string | null }>();
  if (lErr) throw new Error(`setItemPar line read failed: ${lErr.message}`);
  if (!line) throw new AdminTemplateError(404, "item_not_found", "Template item not found");
  if (!line.item_id) throw new AdminTemplateError(409, "item_unlinked", "This line has no linked registry item");
  const itemId = line.item_id;

  // Read the current active row for the slot (for audit before-state + supersession).
  let existingQuery = sb
    .from("item_par_levels")
    .select("id, par_value, par_unit, par_mode")
    .eq("item_id", itemId)
    .eq("location_id", args.locationId)
    .eq("active", true);
  existingQuery = args.dayOfWeek === null
    ? existingQuery.is("day_of_week", null)
    : existingQuery.eq("day_of_week", args.dayOfWeek);
  const { data: existing, error: eErr } = await existingQuery.maybeSingle<{
    id: string;
    par_value: number | null;
    par_unit: string | null;
    par_mode: ParMode;
  }>();
  if (eErr) throw new Error(`setItemPar existing read failed: ${eErr.message}`);

  const before = existing
    ? { parValue: existing.par_value, parUnit: existing.par_unit, parMode: existing.par_mode }
    : null;

  // Deactivate the prior active row in the slot (frees the partial unique index).
  if (existing) {
    const { error: dErr } = await sb
      .from("item_par_levels")
      .update({ active: false, updated_by: actor.user.id, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (dErr) throw new Error(`setItemPar deactivate failed: ${dErr.message}`);
  }

  // Insert the new active row.
  const { error: iErr } = await sb.from("item_par_levels").insert({
    item_id: itemId,
    location_id: args.locationId,
    day_of_week: args.dayOfWeek,
    par_value: args.parValue,
    par_unit: args.parUnit?.trim() || null,
    par_mode: args.parMode,
    active: true,
    created_by: actor.user.id,
    updated_by: actor.user.id,
  });
  if (iErr) throw new Error(`setItemPar insert failed: ${iErr.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "item_par.update",
    resourceTable: "item_par_levels",
    resourceId: itemId,
    metadata: {
      item_id: itemId,
      location_id: args.locationId,
      day_of_week: args.dayOfWeek,
      before,
      after: { parValue: args.parValue, parUnit: args.parUnit?.trim() || null, parMode: args.parMode },
    },
    ipAddress: null,
    userAgent: null,
  });
}

/**
 * Resolve a prep LINE → its registry item, then promote that item to a GLOBAL
 * definition (Item/Inventory Spine 2B). Routes only know the line id
 * (checklist_template_items.id); `promoteItemToGlobal` takes the items.id. This
 * thin wrapper binds the line's template to the actor's location (IDOR), resolves
 * the line's item_id, and delegates to `promoteItemToGlobal` (which re-binds the
 * item's own location). Route enforces MoO+ (≥8).
 */
export async function promotePrepLineItemToGlobal(
  actor: AuthContext,
  args: { templateId: string; lineItemId: string },
): Promise<void> {
  await loadAuthorizedPrepTemplate(actor, args.templateId);
  const sb = getServiceRoleClient();

  const { data: line, error: lErr } = await sb
    .from("checklist_template_items")
    .select("item_id")
    .eq("id", args.lineItemId)
    .eq("template_id", args.templateId)
    .eq("active", true)
    .maybeSingle<{ item_id: string | null }>();
  if (lErr) throw new Error(`promotePrepLineItemToGlobal line read failed: ${lErr.message}`);
  if (!line) throw new AdminTemplateError(404, "item_not_found", "Template item not found");
  if (!line.item_id) throw new AdminTemplateError(409, "item_unlinked", "This line has no linked registry item");

  await promoteItemToGlobal(actor, { itemId: line.item_id });
}

/**
 * Promote a location-owned item to a GLOBAL definition (location_id → NULL), so
 * its name + recommended default_par apply company-wide. Existing
 * item_par_levels rows are left as-is — each location keeps its own override.
 * Route enforces MoO+ (≥8); this lib does not re-gate role beyond the IDOR bind.
 *
 * IDOR: the item's current location_id must be in the actor's authorized
 * locations (all-locations grant bypasses). Missing/inactive → 404.
 */
export async function promoteItemToGlobal(
  actor: AuthContext,
  args: { itemId: string },
): Promise<void> {
  const sb = getServiceRoleClient();

  const { data: item, error: rErr } = await sb
    .from("items")
    .select("id, location_id, active")
    .eq("id", args.itemId)
    .maybeSingle<{ id: string; location_id: string | null; active: boolean }>();
  if (rErr) throw new Error(`promoteItemToGlobal read failed: ${rErr.message}`);
  if (!item || !item.active) throw new AdminTemplateError(404, "item_not_found", "Item not found");
  if (item.location_id === null) {
    throw new AdminTemplateError(409, "already_global", "Item is already global");
  }
  // IDOR: actor must be authorized for the item's current location.
  if (!lockLocationContext(actorLocationShape(actor), item.location_id)) {
    throw new AdminTemplateError(404, "item_not_found", "Item not found");
  }

  const { error: uErr } = await sb
    .from("items")
    .update({ location_id: null, updated_by: actor.user.id, updated_at: new Date().toISOString() })
    .eq("id", args.itemId);
  if (uErr) throw new Error(`promoteItemToGlobal update failed: ${uErr.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "item.promote_to_global",
    resourceTable: "items",
    resourceId: args.itemId,
    metadata: {
      before: { location_id: item.location_id },
      after: { location_id: null },
    },
    ipAddress: null,
    userAgent: null,
  });
}
