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
import { ROLES } from "@/lib/roles";
import {
  TEMPLATE_ITEM_COLUMNS,
  type TemplateItemRow,
  rowToTemplateItem,
} from "@/lib/template-items";
import { setPrepItemMeta, setPrepItemSection, narrowPrepTemplateItem, isPrepMeta, seedPrepItem } from "@/lib/prep";
import { columnsForSection, isPrepSectionName } from "@/lib/prep-sections";
import { loadPrepSections } from "@/lib/prep-sections.server";
import { loadUnits } from "@/lib/units.server";
import type { AuthContext } from "@/lib/session";
import type {
  ChecklistTemplateItem,
  ChecklistTemplateItemTranslations,
  ParMode,
  PrepMeta,
  PrepSection,
  PrepSectionDefn,
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
  /** The item's name (the global definition) — display this, NOT the stale line label. */
  itemName: string | null;
  itemNameEs: string | null;
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
  const nameById = new Map<string, { name: string; nameEs: string | null }>();
  const overridesByItem = new Map<
    string,
    Array<{ dayOfWeek: number | null; parValue: number | null; parUnit: string | null; parMode: ParMode }>
  >();

  if (itemIds.length > 0) {
    const { data: itemRows, error: iErr } = await sb
      .from("items")
      .select("id, location_id, name, name_es, default_par, default_par_unit")
      .in("id", itemIds)
      .returns<Array<{ id: string; location_id: string | null; name: string; name_es: string | null; default_par: number | null; default_par_unit: string | null }>>();
    if (iErr) throw new Error(`getPrepTemplateDetail items lookup failed: ${iErr.message}`);
    for (const r of itemRows ?? []) {
      itemGlobalById.set(r.id, r.location_id === null);
      recommendationById.set(r.id, { par: r.default_par, parUnit: r.default_par_unit });
      nameById.set(r.id, { name: r.name, nameEs: r.name_es });
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
    const nm = itemId ? nameById.get(itemId) ?? null : null;
    parContext[it.id] = itemId
      ? {
          itemId,
          itemGlobal: itemGlobalById.get(itemId) ?? false,
          itemName: nm?.name ?? null,
          itemNameEs: nm?.nameEs ?? null,
          recommendedPar: rec?.par ?? null,
          recommendedParUnit: rec?.parUnit ?? null,
          overrides: overridesByItem.get(itemId) ?? [],
        }
      : { itemId: null, itemGlobal: false, itemName: null, itemNameEs: null, recommendedPar: null, recommendedParUnit: null, overrides: [] };
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

/**
 * Resolve the active prep template id (am_prep | mid_day_prep) at a location
 * (most-recent-active). General form; the am-prep specialization wraps it.
 */
async function resolveActivePrepTemplateId(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
  subtype: PrepSubtype,
): Promise<string | null> {
  const { data, error } = await sb
    .from("checklist_templates")
    .select("id")
    .eq("location_id", locationId)
    .eq("type", "prep")
    .eq("prep_subtype", subtype)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`resolveActivePrepTemplateId failed: ${error.message}`);
  return data?.id ?? null;
}

/** Resolve the active am_prep template id at a location (most-recent-active). */
async function resolveActiveAmPrepTemplateId(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<string | null> {
  return resolveActivePrepTemplateId(sb, locationId, "am_prep");
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

/**
 * The canonical full-definition fields an item edit can change, in the subset
 * actually present (undefined = unchanged). Drives propagation to every active
 * line of the item (all locations + opening mirrors).
 */
export interface ItemDefinitionChanges {
  specialInstruction?: string | null; // en — prep_meta.specialInstruction (prep lines only)
  specialInstructionEs?: string | null; // translations.es.specialInstruction
  required?: boolean; // line.required
  minRoleLevel?: number; // line.min_role_level
  section?: PrepSection; // station + prep_meta.section (+ re-derived columns on prep lines)
}

/**
 * Propagate an item's canonical full-definition edit to every ACTIVE line that
 * links the item — across all locations AND the opening Phase-2 mirror (the
 * mirror shares the same item_id). Applies only the PRESENT (defined) changes.
 *
 * Per-line handling by prep_meta shape:
 *   - `required`     → line `required` column (every line).
 *   - `minRoleLevel` → line `min_role_level` column (every line).
 *   - `specialInstruction` → prep lines (isPrepMeta): prep_meta.specialInstruction
 *       via setPrepItemMeta (preserves the station/section invariant). Opening
 *       mirror lines (OpeningPhase2Meta) carry NO specialInstruction field, so
 *       SI is SKIPPED for them (CONFIRMED: lib/types.ts OpeningPhase2Meta has no
 *       such field).
 *   - `specialInstructionEs` → translations.es.specialInstruction (every line,
 *       via mergeEsTranslation — shape-agnostic).
 *   - `section` → station + prep_meta.section on every line; prep lines also
 *       re-derive prep_meta.columns from the section convention (loadPrepSections,
 *       fallback columnsForSection, preserving the Misc free_text column). The
 *       mirror line updates station + prep_meta.section only (no column re-derive
 *       — OpeningPhase2Meta has no columns).
 *
 * Returns the count of lines updated. Operator render + the completion gating in
 * lib/checklists.ts keep reading LINE values — those are the columns we write.
 */
async function propagateItemDefinitionToLines(
  sb: ReturnType<typeof getServiceRoleClient>,
  itemId: string,
  changes: ItemDefinitionChanges,
): Promise<number> {
  // Nothing to propagate.
  const hasSi = changes.specialInstruction !== undefined;
  const hasSiEs = changes.specialInstructionEs !== undefined;
  const hasRequired = changes.required !== undefined;
  const hasMinRole = changes.minRoleLevel !== undefined;
  const hasSection = changes.section !== undefined;
  if (!hasSi && !hasSiEs && !hasRequired && !hasMinRole && !hasSection) return 0;

  // Load ALL active lines linking the item (any template — all locations +
  // opening mirror). Section column-derive needs the per-section convention.
  const { data: lines, error: lErr } = await sb
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .eq("item_id", itemId)
    .eq("active", true)
    .returns<TemplateItemRow[]>();
  if (lErr) throw new Error(`propagateItemDefinitionToLines lines read failed: ${lErr.message}`);
  const rows = lines ?? [];
  if (rows.length === 0) return 0;

  // Section convention source (only needed when re-deriving columns).
  const sectionMap = hasSection ? await loadPrepSections(sb) : null;

  let updated = 0;
  for (const raw of rows) {
    const item = rowToTemplateItem(raw);
    const isPrepLine = isPrepMeta(item.prepMeta);

    // ── Top-level columns (required / min_role_level / station) ─────────────
    const colUpdate: Record<string, unknown> = {};
    if (hasRequired) colUpdate.required = changes.required;
    if (hasMinRole) colUpdate.min_role_level = changes.minRoleLevel;
    if (hasSection) colUpdate.station = changes.section;

    // ── es translation (shape-agnostic merge) ───────────────────────────────
    if (hasSiEs) {
      colUpdate.translations = mergeEsTranslation(item.translations, {
        specialInstruction: changes.specialInstructionEs,
      });
    }

    // ── prep_meta (section / specialInstruction) ────────────────────────────
    // Both fields live in prep_meta and differ by shape, so merge once.
    if (hasSection || hasSi) {
      if (isPrepLine) {
        // PrepMeta line: setPrepItemMeta asserts meta.section === station, so we
        // must update station + prep_meta together. When the section changes we
        // re-derive columns; otherwise keep the existing columns.
        const base = item.prepMeta as PrepMeta;
        const nextSection = hasSection ? (changes.section as PrepSection) : base.section;
        let nextColumns = base.columns;
        if (hasSection) {
          const keepNote = nextSection === "Misc" && base.columns.includes("free_text");
          const fromDefn = sectionMap?.get(nextSection)?.columns;
          nextColumns = fromDefn ?? columnsForSection(nextSection, keepNote);
        }
        const nextMeta: PrepMeta = {
          section: nextSection,
          parValue: base.parValue,
          parUnit: base.parUnit,
          specialInstruction: hasSi ? (changes.specialInstruction ?? null) : base.specialInstruction,
          columns: nextColumns,
        };
        // station must already be the new section for setPrepItemMeta's assert.
        if (hasSection) {
          await setPrepItemSection(sb, { templateItemId: item.id, section: nextSection });
        }
        await setPrepItemMeta(sb, { templateItemId: item.id, meta: nextMeta });
        // setPrepItemSection/setPrepItemMeta wrote station+prep_meta already;
        // drop station from colUpdate to avoid a redundant write.
        delete colUpdate.station;
      } else {
        // Opening mirror (OpeningPhase2Meta) or other non-prep shape: update
        // prep_meta.section only (no columns; no specialInstruction field).
        // SI is skipped here by design.
        if (hasSection) {
          const existingMeta = (raw.prep_meta ?? {}) as Record<string, unknown>;
          colUpdate.prep_meta = { ...existingMeta, section: changes.section };
          // station already queued in colUpdate above.
        }
      }
    }

    if (Object.keys(colUpdate).length > 0) {
      const { error: uErr } = await sb
        .from("checklist_template_items")
        .update(colUpdate)
        .eq("id", item.id);
      if (uErr) throw new Error(`propagateItemDefinitionToLines update ${item.id} failed: ${uErr.message}`);
    }
    updated += 1;
  }

  return updated;
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
      // Seed the item canonical from the same inputs the line was created with,
      // so a later Global-tab edit propagates from a correct baseline (0083).
      special_instruction: input.specialInstruction?.trim() || null,
      special_instruction_es: esSi,
      min_role_level: input.minRoleLevel,
      required: input.required,
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
    // Unit is item-global now (Units Registry slice): the per-location unit on
    // item_par_levels is deprecated. We keep the `parUnit` arg in the signature
    // (the /par route still passes it) but IGNORE it and write null. The unit
    // lives on the item (items.default_par_unit) and is resolved from there.
    par_unit: null,
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
      // parUnit is no longer persisted on item_par_levels (item-global now) —
      // record null to match what was actually written.
      after: { parValue: args.parValue, parUnit: null, parMode: args.parMode },
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

// ─────────────────────────────────────────────────────────────────────────────
// Registry default-set + per-location enablement (Item/Inventory Spine 2B′)
// ─────────────────────────────────────────────────────────────────────────────

/** The registry-item fields propagation needs to build a location line. */
interface DefaultItemFields {
  itemId: string;
  section: PrepSection;
  name: string;
  nameEs: string | null;
  defaultPar: number | null;
  defaultParUnit: string | null;
  // Canonical full definition (migration 0083) — new lines inherit these.
  // minRoleLevel null → fall back to resolveDefaultMinRole.
  specialInstruction: string | null;
  specialInstructionEs: string | null;
  minRoleLevel: number | null;
  required: boolean;
}

/**
 * A sane min_role_level for a newly-created prep line linking an existing item:
 * the min_role_level of an existing active prep line on the same template
 * (most-recent), else 0. Routes set the operational gate; this is only the
 * default for registry-driven line creation.
 */
async function resolveDefaultMinRole(
  sb: ReturnType<typeof getServiceRoleClient>,
  templateId: string,
): Promise<number> {
  const { data, error } = await sb
    .from("checklist_template_items")
    .select("min_role_level")
    .eq("template_id", templateId)
    .eq("active", true)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ min_role_level: number }>();
  if (error) throw new Error(`resolveDefaultMinRole failed: ${error.message}`);
  // Fallback 3 (KH) = the prep norm + schema default, never 0 ("anyone").
  // Only fires for a template with zero active lines (shouldn't happen for an
  // active am-prep template, which always has lines).
  return data?.min_role_level ?? 3;
}

/** Build the translations blob from an item's name_es (label only), or null. */
function translationsFromItem(nameEs: string | null): ChecklistTemplateItemTranslations | null {
  return nameEs ? { es: { label: nameEs } } : null;
}

/**
 * Ensure an active line on `templateId` links `item`. Idempotent: if an active
 * line already links the item, returns it without inserting. Otherwise inserts a
 * line linking the EXISTING item (no new item row), seeds an all-days inherit
 * par at the location if absent, and — for am_prep — creates the opening mirror.
 * Returns the (existing or new) line id + opening mirror id (am_prep only).
 */
async function ensureItemLineOnTemplate(
  sb: ReturnType<typeof getServiceRoleClient>,
  args: {
    templateId: string;
    subtype: PrepSubtype;
    locationId: string;
    item: DefaultItemFields;
    actorId: string;
  },
): Promise<{ lineId: string; openingMirrorId: string | null; created: boolean }> {
  const { templateId, subtype, locationId, item, actorId } = args;

  // Idempotency: an active line already linking this item.
  const { data: existing, error: exErr } = await sb
    .from("checklist_template_items")
    .select("id")
    .eq("template_id", templateId)
    .eq("item_id", item.itemId)
    .eq("active", true)
    .order("display_order", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (exErr) throw new Error(`ensureItemLineOnTemplate idempotency read failed: ${exErr.message}`);
  if (existing) {
    let mirrorId: string | null = null;
    if (subtype === "am_prep") {
      const { data: mirror, error: mErr } = await sb
        .from("checklist_template_items")
        .select("id")
        .eq("references_template_item_id", existing.id)
        .eq("active", true)
        .order("display_order", { ascending: true })
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (mErr) throw new Error(`ensureItemLineOnTemplate mirror read failed: ${mErr.message}`);
      mirrorId = mirror?.id ?? null;
    }
    return { lineId: existing.id, openingMirrorId: mirrorId, created: false };
  }

  // Next display order on the template.
  const { data: maxRow, error: mxErr } = await sb
    .from("checklist_template_items")
    .select("display_order")
    .eq("template_id", templateId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mxErr) throw new Error(`ensureItemLineOnTemplate max order failed: ${mxErr.message}`);
  const displayOrder = (maxRow?.display_order ?? 0) + 1;

  // Inherit min_role_level from the item canonical; fall back to the template
  // default (resolveDefaultMinRole) only when the item carries no value.
  const minRoleLevel = item.minRoleLevel ?? (await resolveDefaultMinRole(sb, templateId));
  // Translations carry the item's name_es (label) + the canonical es special
  // instruction (mergeEsTranslation onto the label-only base, dropping empties).
  const baseTranslations = translationsFromItem(item.nameEs);
  const translations =
    item.specialInstructionEs !== null
      ? mergeEsTranslation(baseTranslations, { specialInstruction: item.specialInstructionEs })
      : baseTranslations;

  // Insert the line linking the EXISTING item (no new item row).
  const { data: inserted, error: insErr } = await sb
    .from("checklist_template_items")
    .insert({
      template_id: templateId,
      station: item.section,
      display_order: displayOrder,
      label: item.name,
      description: null,
      min_role_level: minRoleLevel,
      required: item.required,
      expects_count: false,
      expects_photo: false,
      vendor_item_id: null,
      active: true,
      translations,
      prep_meta: {
        section: item.section,
        parValue: item.defaultPar,
        parUnit: item.defaultParUnit,
        specialInstruction: item.specialInstruction,
        columns: columnsForSection(item.section, false),
      },
      report_reference_type: null,
      references_template_item_id: null,
      item_id: item.itemId,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (insErr) throw new Error(`ensureItemLineOnTemplate insert failed: ${insErr.message}`);
  if (!inserted) throw new Error(`ensureItemLineOnTemplate insert returned no row`);
  const lineId = inserted.id;

  // Seed an all-days inherit par at the location if absent (forensic floor for
  // the resolver; manual overrides supersede via setItemPar later).
  const { data: parExisting, error: pErr } = await sb
    .from("item_par_levels")
    .select("id")
    .eq("item_id", item.itemId)
    .eq("location_id", locationId)
    .is("day_of_week", null)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (pErr) throw new Error(`ensureItemLineOnTemplate par read failed: ${pErr.message}`);
  if (!parExisting) {
    const { error: parInsErr } = await sb.from("item_par_levels").insert({
      item_id: item.itemId,
      location_id: locationId,
      day_of_week: null,
      par_value: null,
      par_unit: null,
      par_mode: "inherit",
      active: true,
      created_by: actorId,
      updated_by: actorId,
    });
    if (parInsErr) throw new Error(`ensureItemLineOnTemplate par seed failed: ${parInsErr.message}`);
  }

  let openingMirrorId: string | null = null;
  if (subtype === "am_prep") {
    openingMirrorId = await createOpeningMirror({
      amPrepItemId: lineId,
      itemId: item.itemId,
      locationId,
      section: item.section,
      parValue: item.defaultPar,
      parUnit: item.defaultParUnit,
      label: item.name,
      translations,
      minRoleLevel,
      required: item.required,
    });
  }

  return { lineId, openingMirrorId, created: true };
}

/**
 * Propagate a default registry item to every ACTIVE location: ensure an active
 * am_prep line links the item at each (skipping locations with no active am_prep
 * template). Idempotent per location. Returns the location ids where a line was
 * NEWLY created. Shared by setItemDefault(true) and addRegistryItem(isDefault).
 */
async function propagateDefaultItem(
  sb: ReturnType<typeof getServiceRoleClient>,
  item: DefaultItemFields,
  actorId: string,
): Promise<string[]> {
  const { data: locations, error: locErr } = await sb
    .from("locations")
    .select("id")
    .eq("active", true)
    .returns<Array<{ id: string }>>();
  if (locErr) throw new Error(`propagateDefaultItem locations read failed: ${locErr.message}`);

  const propagatedLocationIds: string[] = [];
  for (const loc of locations ?? []) {
    const templateId = await resolveActiveAmPrepTemplateId(sb, loc.id);
    if (!templateId) continue; // no active am_prep template at this location — skip
    const { created } = await ensureItemLineOnTemplate(sb, {
      templateId,
      subtype: "am_prep",
      locationId: loc.id,
      item,
      actorId,
    });
    if (created) propagatedLocationIds.push(loc.id);
  }
  return propagatedLocationIds;
}

/**
 * Set (or clear) a global registry item's default-set membership. When set true,
 * propagates the item to every active location's am_prep template (idempotent).
 * When set false, only flips the flag — existing location lines are NOT removed
 * (append-only; disable a location line via removePrepItem). Route enforces role.
 *
 * The item must be a GLOBAL registry item (location_id IS NULL). Missing/inactive
 * → 404; location-owned → 409 not_global.
 */
export async function setItemDefault(
  actor: AuthContext,
  args: { itemId: string; isDefault: boolean },
): Promise<{ propagatedLocationIds: string[] }> {
  const sb = getServiceRoleClient();

  const { data: item, error: rErr } = await sb
    .from("items")
    .select(
      "id, location_id, active, is_default, section, name, name_es, default_par, default_par_unit, special_instruction, special_instruction_es, min_role_level, required",
    )
    .eq("id", args.itemId)
    .maybeSingle<{
      id: string;
      location_id: string | null;
      active: boolean;
      is_default: boolean;
      section: string | null;
      name: string;
      name_es: string | null;
      default_par: number | null;
      default_par_unit: string | null;
      special_instruction: string | null;
      special_instruction_es: string | null;
      min_role_level: number | null;
      required: boolean;
    }>();
  if (rErr) throw new Error(`setItemDefault read failed: ${rErr.message}`);
  if (!item || !item.active) throw new AdminTemplateError(404, "item_not_found", "Item not found");
  if (item.location_id !== null) throw new AdminTemplateError(409, "not_global", "Item is not global");

  const beforeIsDefault = item.is_default;

  const { error: uErr } = await sb
    .from("items")
    .update({ is_default: args.isDefault, updated_by: actor.user.id, updated_at: new Date().toISOString() })
    .eq("id", args.itemId);
  if (uErr) throw new Error(`setItemDefault update failed: ${uErr.message}`);

  let propagatedLocationIds: string[] = [];
  if (args.isDefault) {
    if (!isPrepSectionName(item.section)) {
      throw new AdminTemplateError(409, "invalid_section", "Item section is not a prep section; cannot propagate");
    }
    propagatedLocationIds = await propagateDefaultItem(
      sb,
      {
        itemId: item.id,
        section: item.section,
        name: item.name,
        nameEs: item.name_es,
        defaultPar: item.default_par,
        defaultParUnit: item.default_par_unit,
        specialInstruction: item.special_instruction,
        specialInstructionEs: item.special_instruction_es,
        minRoleLevel: item.min_role_level,
        required: item.required,
      },
      actor.user.id,
    );
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "item.set_default",
    resourceTable: "items",
    resourceId: args.itemId,
    metadata: {
      itemId: args.itemId,
      before: { is_default: beforeIsDefault },
      after: { is_default: args.isDefault },
      propagated_location_ids: propagatedLocationIds,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { propagatedLocationIds };
}

export interface AddRegistryItemInput {
  name: string;
  nameEs: string | null;
  section: PrepSection;
  recommendedPar: number | null;
  recommendedParUnit: string | null;
  isDefault: boolean;
  // Canonical full-definition fields (migration 0083) — set on the new item;
  // new lines inherit these (see ensureItemLineOnTemplate / addPrepItem).
  specialInstruction?: string | null;
  specialInstructionEs?: string | null;
  required?: boolean;
  minRoleLevel?: number;
}

/**
 * Create a GLOBAL registry item (location_id NULL, kind 'manual'). When
 * isDefault, propagates it to every active location's am_prep template (same
 * path as setItemDefault(true)). Route enforces role.
 */
export async function addRegistryItem(
  actor: AuthContext,
  args: AddRegistryItemInput,
): Promise<{ itemId: string; propagatedLocationIds: string[] }> {
  const name = args.name.trim();
  if (!name) throw new AdminTemplateError(400, "invalid_label", "Name is required");
  if (!isPrepSectionName(args.section)) throw new AdminTemplateError(400, "invalid_section", "Unknown section");
  if (args.recommendedPar !== null && (!Number.isFinite(args.recommendedPar) || args.recommendedPar < 0)) {
    throw new AdminTemplateError(400, "invalid_par", "Par must be a non-negative number or empty");
  }
  if (
    args.minRoleLevel !== undefined &&
    (!Number.isInteger(args.minRoleLevel) || args.minRoleLevel < 0 || args.minRoleLevel > 10)
  ) {
    throw new AdminTemplateError(400, "invalid_min_role", "Min role level must be between 0 and 10");
  }

  const sb = getServiceRoleClient();
  const nameEs = args.nameEs?.trim() || null;
  const parUnit = args.recommendedParUnit?.trim() || null;

  const { data: itemRow, error: iErr } = await sb
    .from("items")
    .insert({
      location_id: null,
      kind: "manual",
      name,
      name_es: nameEs,
      section: args.section,
      default_par: args.recommendedPar,
      default_par_unit: parUnit,
      is_default: args.isDefault,
      // Canonical full definition (migration 0083) — new lines inherit these.
      special_instruction: args.specialInstruction?.trim() || null,
      special_instruction_es: args.specialInstructionEs?.trim() || null,
      ...(args.minRoleLevel !== undefined ? { min_role_level: args.minRoleLevel } : {}),
      required: args.required ?? false,
      active: true,
      created_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) throw new Error(`addRegistryItem insert failed: ${iErr.message}`);
  if (!itemRow) throw new Error(`addRegistryItem insert returned no row`);
  const itemId = itemRow.id;

  let propagatedLocationIds: string[] = [];
  if (args.isDefault) {
    propagatedLocationIds = await propagateDefaultItem(
      sb,
      {
        itemId,
        section: args.section,
        name,
        nameEs,
        defaultPar: args.recommendedPar,
        defaultParUnit: parUnit,
        specialInstruction: args.specialInstruction?.trim() || null,
        specialInstructionEs: args.specialInstructionEs?.trim() || null,
        minRoleLevel: args.minRoleLevel ?? null,
        required: args.required ?? false,
      },
      actor.user.id,
    );
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "item.create",
    resourceTable: "items",
    resourceId: itemId,
    metadata: {
      scope: "global",
      is_default: args.isDefault,
      item_id: itemId,
      propagated_location_ids: propagatedLocationIds,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { itemId, propagatedLocationIds };
}

/**
 * Enable a GLOBAL registry item at one location's prep template (am_prep |
 * mid_day_prep) by linking an active line to the EXISTING item. Idempotent: if a
 * line already links the item, returns it. For am_prep also creates the opening
 * mirror. Route enforces role; this binds the location for IDOR.
 *
 * IDOR: locationId must be in the actor's authorized locations (404 otherwise).
 * The item must be a global registry item (location_id NULL, active) → else 409
 * not_global. No active template for the subtype → 404 template_not_found.
 */
export async function enableRegistryItemAtLocation(
  actor: AuthContext,
  args: { locationId: string; subtype: PrepSubtype; itemId: string },
): Promise<{ lineId: string; openingMirrorId: string | null }> {
  if (!lockLocationContext(actorLocationShape(actor), args.locationId)) {
    throw new AdminTemplateError(404, "location_not_found", "Location not accessible");
  }
  const sb = getServiceRoleClient();

  const { data: item, error: rErr } = await sb
    .from("items")
    .select(
      "id, location_id, active, section, name, name_es, default_par, default_par_unit, special_instruction, special_instruction_es, min_role_level, required",
    )
    .eq("id", args.itemId)
    .maybeSingle<{
      id: string;
      location_id: string | null;
      active: boolean;
      section: string | null;
      name: string;
      name_es: string | null;
      default_par: number | null;
      default_par_unit: string | null;
      special_instruction: string | null;
      special_instruction_es: string | null;
      min_role_level: number | null;
      required: boolean;
    }>();
  if (rErr) throw new Error(`enableRegistryItemAtLocation read failed: ${rErr.message}`);
  if (!item || !item.active) throw new AdminTemplateError(404, "item_not_found", "Item not found");
  if (item.location_id !== null) throw new AdminTemplateError(409, "not_global", "Item is not global");
  if (!isPrepSectionName(item.section)) {
    throw new AdminTemplateError(409, "invalid_section", "Item section is not a prep section");
  }

  const templateId = await resolveActivePrepTemplateId(sb, args.locationId, args.subtype);
  if (!templateId) throw new AdminTemplateError(404, "template_not_found", "Template not found");

  const { lineId, openingMirrorId } = await ensureItemLineOnTemplate(sb, {
    templateId,
    subtype: args.subtype,
    locationId: args.locationId,
    item: {
      itemId: item.id,
      section: item.section,
      name: item.name,
      nameEs: item.name_es,
      defaultPar: item.default_par,
      defaultParUnit: item.default_par_unit,
      specialInstruction: item.special_instruction,
      specialInstructionEs: item.special_instruction_es,
      minRoleLevel: item.min_role_level,
      required: item.required,
    },
    actorId: actor.user.id,
  });

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "checklist_template_item.create",
    resourceTable: "checklist_template_items",
    resourceId: lineId,
    metadata: {
      enabled_from_registry: true,
      item_id: item.id,
      location_id: args.locationId,
      subtype: args.subtype,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { lineId, openingMirrorId };
}

// ── 3-Tab admin aggregate view (Item/Inventory Spine 2B′) ──────────────────

export interface ChecklistRegistryItem {
  itemId: string;
  name: string;
  nameEs: string | null;
  section: string | null;
  recommendedPar: number | null;
  recommendedParUnit: string | null;
  isDefault: boolean;
  specialInstruction: string | null;
  specialInstructionEs: string | null;
  required: boolean;
  minRoleLevel: number | null;
}

export interface ChecklistLocationView {
  locationId: string;
  name: string;
  code: string;
  templateId: string | null;
  items: ChecklistTemplateItem[];
  parContext: Record<string, PrepLineParContext>;
  /** Item ids this location currently runs (active lines). */
  enabledItemIds: string[];
}

export interface ChecklistAdminView {
  subtype: PrepSubtype;
  actorLevel: number;
  registry: ChecklistRegistryItem[];
  locations: ChecklistLocationView[];
  /** First-class prep sections (active, by displayOrder) — editable labels. */
  sections: PrepSectionDefn[];
  /** Canonical par units (active, by displayOrder) — the unit-dropdown pool. */
  units: Array<{ label: string }>;
}

/**
 * Aggregate view for the 3-tab checklist admin: the global registry (the pool
 * the Global tab shows, with default-set membership) + each accessible
 * location's checklist for `subtype` (items + par context + which items it
 * runs). Reuses getPrepTemplateDetail per location (which IDOR-binds).
 */
export async function loadChecklistAdminView(
  actor: AuthContext,
  subtype: PrepSubtype,
): Promise<ChecklistAdminView> {
  const sb = getServiceRoleClient();

  // Registry = active global items (location_id NULL), grouped/sorted by section.
  const { data: regRows, error: rErr } = await sb
    .from("items")
    .select("id, name, name_es, section, default_par, default_par_unit, is_default, special_instruction, special_instruction_es, required, min_role_level")
    .is("location_id", null)
    .eq("active", true)
    .order("section", { ascending: true })
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; name_es: string | null; section: string | null; default_par: number | null; default_par_unit: string | null; is_default: boolean; special_instruction: string | null; special_instruction_es: string | null; required: boolean; min_role_level: number | null }>>();
  if (rErr) throw new Error(`loadChecklistAdminView registry failed: ${rErr.message}`);
  const registry: ChecklistRegistryItem[] = (regRows ?? []).map((r) => ({
    itemId: r.id,
    name: r.name,
    nameEs: r.name_es,
    section: r.section,
    recommendedPar: r.default_par,
    recommendedParUnit: r.default_par_unit,
    isDefault: r.is_default,
    specialInstruction: r.special_instruction,
    specialInstructionEs: r.special_instruction_es,
    required: r.required,
    minRoleLevel: r.min_role_level,
  }));

  // Accessible locations (respect all-locations override + assignment list).
  const { data: locRows, error: lErr } = await sb
    .from("locations")
    .select("id, name, code")
    .eq("active", true)
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; code: string }>>();
  if (lErr) throw new Error(`loadChecklistAdminView locations failed: ${lErr.message}`);
  const actorAll = isAllLocationsAccess({ role: actor.user.role, locations: actor.locations });
  const accessible = (locRows ?? []).filter((l) => actorAll || actor.locations.includes(l.id));

  const locations: ChecklistLocationView[] = [];
  for (const loc of accessible) {
    const templateId = await resolveActivePrepTemplateId(sb, loc.id, subtype);
    if (!templateId) {
      locations.push({ locationId: loc.id, name: loc.name, code: loc.code, templateId: null, items: [], parContext: {}, enabledItemIds: [] });
      continue;
    }
    const detail = await getPrepTemplateDetail(actor, templateId);
    const enabledItemIds = detail.items
      .map((it) => it.itemId)
      .filter((v): v is string => typeof v === "string");
    locations.push({
      locationId: loc.id,
      name: loc.name,
      code: loc.code,
      templateId,
      items: detail.items,
      parContext: detail.parContext,
      enabledItemIds,
    });
  }

  // First-class sections (active, by displayOrder) — editable display labels.
  const sectionMap = await loadPrepSections(sb);
  const sections = Array.from(sectionMap.values()).sort((a, b) => a.displayOrder - b.displayOrder);

  // Canonical par units (active, by displayOrder) — the unit-dropdown pool.
  const units = await loadUnits(sb);

  return { subtype, actorLevel: ROLES[actor.user.role].level, registry, locations, sections, units };
}

/**
 * Edit a registry item's GLOBAL definition (name / name_es / recommended par)
 * directly by item id — used by the Global tab (no template/line context).
 * Route enforces MoO+. Section is fixed at creation (structural; not edited here).
 */
export async function updateRegistryItemDefinition(
  actor: AuthContext,
  args: {
    itemId: string;
    name?: string;
    nameEs?: string | null;
    recommendedPar?: number | null;
    recommendedParUnit?: string | null;
    // Canonical full-definition fields (migration 0083) — edited once on the
    // Global tab, propagated to every active line of the item.
    specialInstruction?: string | null;
    specialInstructionEs?: string | null;
    required?: boolean;
    minRoleLevel?: number;
    section?: PrepSection;
  },
): Promise<void> {
  // Validate the full-definition fields up-front (before any read).
  if (args.section !== undefined && !isPrepSectionName(args.section)) {
    throw new AdminTemplateError(400, "invalid_section", "Unknown section");
  }
  if (
    args.minRoleLevel !== undefined &&
    (!Number.isInteger(args.minRoleLevel) || args.minRoleLevel < 0 || args.minRoleLevel > 10)
  ) {
    throw new AdminTemplateError(400, "invalid_min_role", "Min role level must be between 0 and 10");
  }

  const sb = getServiceRoleClient();
  const { data: item, error: rErr } = await sb
    .from("items")
    .select(
      "id, active, name, name_es, section, default_par, default_par_unit, special_instruction, special_instruction_es, min_role_level, required",
    )
    .eq("id", args.itemId)
    .maybeSingle<{
      id: string;
      active: boolean;
      name: string;
      name_es: string | null;
      section: string | null;
      default_par: number | null;
      default_par_unit: string | null;
      special_instruction: string | null;
      special_instruction_es: string | null;
      min_role_level: number | null;
      required: boolean;
    }>();
  if (rErr) throw new Error(`updateRegistryItemDefinition read failed: ${rErr.message}`);
  if (!item || !item.active) throw new AdminTemplateError(404, "item_not_found", "Item not found");

  const update: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  // The subset of full-definition fields that actually changed → propagated.
  const changes: ItemDefinitionChanges = {};

  if (args.name !== undefined) {
    const v = args.name.trim();
    if (!v) throw new AdminTemplateError(400, "invalid_label", "Name cannot be empty");
    if (v !== item.name) { update.name = v; before.name = item.name; after.name = v; }
  }
  if (args.nameEs !== undefined) {
    const v = args.nameEs?.trim() || null;
    if (v !== item.name_es) { update.name_es = v; before.name_es = item.name_es; after.name_es = v; }
  }
  if (args.recommendedPar !== undefined) {
    if (args.recommendedPar !== null && (!Number.isFinite(args.recommendedPar) || args.recommendedPar < 0)) {
      throw new AdminTemplateError(400, "invalid_par", "Par must be a non-negative number or empty");
    }
    if (args.recommendedPar !== item.default_par) { update.default_par = args.recommendedPar; before.default_par = item.default_par; after.default_par = args.recommendedPar; }
  }
  if (args.recommendedParUnit !== undefined) {
    const v = args.recommendedParUnit?.trim() || null;
    if (v !== item.default_par_unit) { update.default_par_unit = v; before.default_par_unit = item.default_par_unit; after.default_par_unit = v; }
  }

  // ── Canonical full-definition fields (item columns + propagate to lines) ──
  if (args.specialInstruction !== undefined) {
    const v = args.specialInstruction?.trim() || null;
    if (v !== item.special_instruction) {
      update.special_instruction = v; before.special_instruction = item.special_instruction; after.special_instruction = v;
      changes.specialInstruction = v;
    }
  }
  if (args.specialInstructionEs !== undefined) {
    const v = args.specialInstructionEs?.trim() || null;
    if (v !== item.special_instruction_es) {
      update.special_instruction_es = v; before.special_instruction_es = item.special_instruction_es; after.special_instruction_es = v;
      changes.specialInstructionEs = v;
    }
  }
  if (args.required !== undefined) {
    if (args.required !== item.required) {
      update.required = args.required; before.required = item.required; after.required = args.required;
      changes.required = args.required;
    }
  }
  if (args.minRoleLevel !== undefined) {
    if (args.minRoleLevel !== item.min_role_level) {
      update.min_role_level = args.minRoleLevel; before.min_role_level = item.min_role_level; after.min_role_level = args.minRoleLevel;
      changes.minRoleLevel = args.minRoleLevel;
    }
  }
  if (args.section !== undefined) {
    if (args.section !== item.section) {
      update.section = args.section; before.section = item.section; after.section = args.section;
      changes.section = args.section;
    }
  }

  if (Object.keys(update).length === 0) return; // nothing changed
  update.updated_by = actor.user.id;
  update.updated_at = new Date().toISOString();
  const { error: uErr } = await sb.from("items").update(update).eq("id", args.itemId);
  if (uErr) throw new Error(`updateRegistryItemDefinition update failed: ${uErr.message}`);

  // Propagate the changed full-definition subset to every active line.
  const propagatedLineCount = await propagateItemDefinitionToLines(sb, args.itemId, changes);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "item.update",
    resourceTable: "items",
    resourceId: args.itemId,
    metadata: {
      item_id: args.itemId,
      before,
      after,
      changed_fields: Object.keys(after),
      propagated_line_count: propagatedLineCount,
    },
    ipAddress: null,
    userAgent: null,
  });
}

/**
 * Add a canonical par unit to the registry (Units Registry slice). Validates the
 * label is non-empty and not a case-insensitive duplicate of an existing
 * `units.label`. Inserts with display_order = (max active +1). Units are GLOBAL
 * (no location IDOR) — the route gates MoO+. Audits unit.create.
 */
export async function addUnit(
  actor: AuthContext,
  args: { label: string },
): Promise<void> {
  const label = args.label.trim();
  if (!label) throw new AdminTemplateError(400, "invalid_label", "Label cannot be empty");

  const sb = getServiceRoleClient();

  // Duplicate check (case-insensitive) against existing units.
  const { data: existing, error: eErr } = await sb
    .from("units")
    .select("id, label")
    .ilike("label", label)
    .maybeSingle<{ id: string; label: string }>();
  if (eErr) throw new Error(`addUnit duplicate check failed: ${eErr.message}`);
  if (existing) throw new AdminTemplateError(409, "unit_exists", "A unit with that label already exists");

  // display_order = max active +1 (append to the end of the dropdown).
  const { data: maxRow, error: mErr } = await sb
    .from("units")
    .select("display_order")
    .eq("active", true)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  if (mErr) throw new Error(`addUnit max order failed: ${mErr.message}`);
  const displayOrder = (maxRow?.display_order ?? 0) + 1;

  const { data: inserted, error: iErr } = await sb
    .from("units")
    .insert({
      label,
      active: true,
      display_order: displayOrder,
      created_by: actor.user.id,
      updated_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) throw new Error(`addUnit insert failed: ${iErr.message}`);
  if (!inserted) throw new Error("addUnit insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "unit.create",
    resourceTable: "units",
    resourceId: inserted.id,
    metadata: { label },
    ipAddress: null,
    userAgent: null,
  });
}

/**
 * Rename a prep section's display label (+ optional reorder) — Item/Inventory
 * Spine sub-slice A. Writes `prep_sections.label_en/label_es/display_order`;
 * the `slug` (system key stamped into lines) is NEVER touched. Sections are
 * GLOBAL (no location IDOR) — the route gates MoO+. Audits prep_section.update
 * with before/after labels + displayOrder.
 */
export async function setSectionLabel(
  actor: AuthContext,
  args: { slug: string; labelEn: string; labelEs: string | null; displayOrder?: number },
): Promise<void> {
  const labelEn = args.labelEn.trim();
  if (!labelEn) throw new AdminTemplateError(400, "invalid_label", "Label cannot be empty");
  if (
    args.displayOrder !== undefined &&
    (!Number.isInteger(args.displayOrder) || args.displayOrder < 0)
  ) {
    throw new AdminTemplateError(400, "invalid_display_order", "Display order must be a non-negative integer");
  }

  const sb = getServiceRoleClient();
  const { data: section, error: rErr } = await sb
    .from("prep_sections")
    .select("id, slug, label_en, label_es, display_order")
    .eq("slug", args.slug)
    .maybeSingle<{ id: string; slug: string; label_en: string; label_es: string | null; display_order: number }>();
  if (rErr) throw new Error(`setSectionLabel read failed: ${rErr.message}`);
  if (!section) throw new AdminTemplateError(404, "section_not_found", "Section not found");

  const labelEs = args.labelEs?.trim() || null;
  const update: Record<string, unknown> = {
    label_en: labelEn,
    label_es: labelEs,
    updated_by: actor.user.id,
    updated_at: new Date().toISOString(),
  };
  if (args.displayOrder !== undefined) update.display_order = args.displayOrder;

  const { error: uErr } = await sb.from("prep_sections").update(update).eq("id", section.id);
  if (uErr) throw new Error(`setSectionLabel update failed: ${uErr.message}`);

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "prep_section.update",
    resourceTable: "prep_sections",
    resourceId: section.id,
    metadata: {
      slug: section.slug,
      before: { labelEn: section.label_en, labelEs: section.label_es, displayOrder: section.display_order },
      after: { labelEn, labelEs, displayOrder: args.displayOrder ?? section.display_order },
    },
    ipAddress: null,
    userAgent: null,
  });
}
