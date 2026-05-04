/**
 * Seed: Standard AM Prep v1 — Module #1 Build #2 PR 1 prep checklist template.
 *
 * Source: Image 1 (CO paper AM Prep List). 38 items across 6 sections:
 *   - Veg (6): Iceberg, Onion, Basil, Radish, Cucumber, Tomato
 *   - Cooks (5): Vodka, Marinara, Compound Butter, Caramelized onion, Jus
 *   - Sides (6): Tuna Salad, Egg Salad, Onion Dip, Chix Salad, Antipasto
 *     Pasta, Cannoli Cream
 *   - Sauces (8): Aioli, HC Aioli, HP Mayo, Mustard Aioli, Horsey Mayo,
 *     Salsa Verde, Dukes, Vin
 *   - Slicing (9): Turkey, Ham, Capicola, Pepperoni, Genoa, Provolone,
 *     Mortadella, Roast Beef, Cheddar
 *   - Misc (4): Meatball mix - ready?, Meatballs - ready to cook?,
 *     Meatballs - for reheat?, Cook Bacon?
 *
 * Architectural references:
 *   - SPEC_AMENDMENTS.md C.18 — section-aware data model + per-item
 *     PAR/ON HAND/BACK UP/TOTAL columns; PrepSection enum
 *   - C.38 — system-key vs display-string discipline; station IS the
 *     section (English source-of-truth); translations.es is render-only
 *   - C.42 — closing's "AM Prep List" report-reference item auto-completes
 *     on submission via report_reference_type='am_prep' (Standard Closing
 *     v2 ships in the next seed)
 *   - C.44 — PAR/section/unit are denormalized into prep completion
 *     snapshots at submission time; admin-edit tooling lands as a
 *     follow-up PR (per Build #2 scope)
 *   - C.41 reconciliation — min_role_level = 3 (KH+) per the locked
 *     finalize-gate semantic
 *
 * Per-item defaults (override only where called out):
 *   - min_role_level = 3 (KH+ post-C.41)
 *   - required = true
 *   - expects_count = false
 *   - expects_photo = false
 *   - report_reference_type = null (these are prep items, not refs)
 *
 * Template metadata:
 *   - type = 'prep' (existing CHECK constraint allows 'opening' | 'prep'
 *     | 'closing'; AM Prep and future Mid-day Prep both use 'prep' —
 *     loadAmPrepState picks most-recent active by created_at; future
 *     mid-day discriminator deferred to Mid-day Prep design time)
 *   - name = 'Standard AM Prep v1'
 *   - single_submission_only = true (AM Prep is single-per-day per spec
 *     §4.3 column comment for prep templates)
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/seed-am-prep-template.ts
 *
 * Convergent semantics (mirrors scripts/seed-closing-template.ts):
 *   - Pre-flight (location_id, type='prep', name='Standard AM Prep v1')
 *     lookup. CREATE on miss; SYNC on hit by display_order.
 *   - CREATE path uses lib/prep.ts seedPrepItem helper which guarantees
 *     the C.38 station ↔ prep_meta.section invariant by construction.
 *   - SYNC path updates station + prep_meta together when either diffs
 *     (atomic per-row UPDATE). Other fields (label, description,
 *     min_role_level, required, translations) diffed independently via
 *     stable JSON comparison.
 *
 * Audit metadata convention (per AGENTS.md "Audit metadata context
 * attribution in seed scripts" durable lesson):
 *   - phase: "3_module_1_build_2_pr_1"
 *   - CREATE-path reason: "Standard AM Prep v1 — initial seed" — the
 *     template's create-time canonical audit string; describes the
 *     template in its current final shape regardless of script-edit
 *     history. Stays stable across spec edits unless the version bumps.
 *   - SYNC-path reason: "Cooks BACK UP column addition for multi-day
 *     batch TOTAL semantic" — Build #2 PR 1 follow-up; SYNC reasons
 *     describe the specific change between states, so they update each
 *     PR re-run that mutates production data.
 *
 * ⚠️ AUDIT METADATA CONTEXT MARKER ⚠️
 * If you re-run this script in a NEW PR context (e.g., a future Build
 * sequence that needs to converge AM Prep changes), update the `phase`
 * and `reason` strings inside seedForLocation() BEFORE running. These
 * strings are NOT auto-derived from git context; failure to update
 * propagates stale attribution into production audit_log and requires
 * an `audit.metadata_correction` row to remediate (see C.41 sub-finding
 * incident handled by scripts/correct-c41-seed-audit-attribution.ts).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { seedPrepItem } from "../lib/prep";
import type {
  ChecklistTemplateItemTranslations,
  PrepColumn,
  PrepMeta,
  PrepSection,
} from "../lib/types";

// Juan's user_id — actor for the audit rows. Stable since Phase 1 seed.
const JUAN_USER_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";

// Location ids supplied by Juan from the provisioning spec (matches
// scripts/phase-2.5-provision-temp-users.ts and seed-closing-template.ts).
const LOCATION_MEP = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a";
const LOCATION_EM = "d2cced11-b167-49fa-bab6-86ec9bf4ff09";

const TEMPLATE_NAME = "Standard AM Prep v1";
const TEMPLATE_DESCRIPTION =
  "End-of-shift AM Prep List. Source: Image 1 (CO paper AM Prep List). " +
  "Per SPEC_AMENDMENTS.md C.18 (section-aware data model) and C.42 " +
  "(auto-completes Standard Closing v2's AM Prep List report-reference " +
  "item on submission). PAR/section/unit are denormalized into prep " +
  "completion snapshots per C.44 — admin-edit tooling lands as a " +
  "follow-up PR.";

// ---------------------------------------------------------------------------
// Spanish translation maps (per SPEC_AMENDMENTS.md C.38).
//
// Keyed by the original (English) string so a label/section/specialInstruction
// change in ITEMS requires the same change in these maps. Idempotent: the
// seed sync re-computes the JSONB translations blob from these lookups every
// run; a map edit re-runs cleanly. Unknown keys fall through to the en
// source-of-truth (resolver returns the original column value, or for
// specialInstruction reaches into prep_meta.specialInstruction).
//
// Operational/practical Spanish per C.31 — restaurant frontline staff
// audience. Unit abbreviations (QT, BTL, BAG, LOGS, "1/3 pan", "min", HC, HP)
// stay English by design (kitchen jargon — system semantic, not translatable
// per C.38 system-key discipline). Juan smoke-tests post-merge.
// ---------------------------------------------------------------------------

const STATION_ES: Record<PrepSection, string> = {
  Veg: "Verduras",
  Cooks: "Cocidos",
  Sides: "Acompañantes",
  Sauces: "Salsas",
  Slicing: "Rebanado",
  Misc: "Misceláneo",
};

const LABEL_ES: Record<string, string> = {
  // Veg
  Iceberg: "Lechuga iceberg",
  Onion: "Cebolla",
  Basil: "Albahaca",
  Radish: "Rábano",
  Cucumber: "Pepino",
  Tomato: "Tomate",

  // Cooks
  Vodka: "Vodka",
  Marinara: "Marinara",
  "Compound Butter": "Mantequilla compuesta",
  "Caramelized onion": "Cebolla caramelizada",
  Jus: "Jus",

  // Sides
  "Tuna Salad": "Ensalada de atún",
  "Egg Salad": "Ensalada de huevo",
  "Onion Dip": "Dip de cebolla",
  "Chix Salad": "Ensalada de pollo",
  "Antipasto Pasta": "Pasta antipasto",
  "Cannoli Cream": "Crema de cannoli",

  // Sauces
  Aioli: "Alioli",
  "HC Aioli": "Alioli HC",
  "HP Mayo": "Mayo HP",
  "Mustard Aioli": "Alioli de mostaza",
  "Horsey Mayo": "Mayo de rábano picante",
  "Salsa Verde": "Salsa verde",
  Dukes: "Dukes",
  Vin: "Vinagreta",

  // Slicing
  Turkey: "Pavo",
  Ham: "Jamón",
  Capicola: "Capicola",
  Pepperoni: "Pepperoni",
  Genoa: "Genoa",
  Provolone: "Provolone",
  Mortadella: "Mortadela",
  "Roast Beef": "Roast beef",
  Cheddar: "Cheddar",

  // Misc
  "Meatball mix - ready?": "Mezcla de albóndigas - ¿lista?",
  "Meatballs - ready to cook?": "Albóndigas - ¿listas para cocinar?",
  "Meatballs - for reheat?": "Albóndigas - ¿para recalentar?",
  "Cook Bacon?": "¿Cocinar tocino?",
};

const SPECIAL_INSTRUCTION_ES: Record<string, string> = {
  "Prep Daily": "Preparar a diario",
};

/**
 * Builds the translations JSONB blob for a SeedAmPrepItem. Returns null
 * when no Spanish translations are available for any of the item's
 * user-facing fields — the column stays NULL and the resolver falls
 * through to the English source-of-truth.
 *
 * Partial coverage is honest: only fields with translations get keys;
 * missing fields fall through to the en column (or for specialInstruction,
 * to prep_meta.specialInstruction) at render time.
 */
function buildTranslations(
  item: SeedAmPrepItem,
): ChecklistTemplateItemTranslations | null {
  const labelEs = LABEL_ES[item.label];
  const stationEs = STATION_ES[item.section];
  const siEs = item.specialInstruction
    ? SPECIAL_INSTRUCTION_ES[item.specialInstruction]
    : undefined;

  const esEntry: NonNullable<ChecklistTemplateItemTranslations["es"]> = {};
  if (labelEs) esEntry.label = labelEs;
  if (stationEs) esEntry.station = stationEs;
  if (siEs) esEntry.specialInstruction = siEs;

  if (Object.keys(esEntry).length === 0) return null;
  return { es: esEntry };
}

// ---------------------------------------------------------------------------
// Item registry. Order matters: section order follows the AmPrepForm's
// canonical render order (Veg → Cooks → Sides → Sauces → Slicing → Misc).
// display_order is the index within ITEMS, so sections render together but
// the underlying ordering is a single monotonic sequence (matches
// seed-closing-template's convention).
// ---------------------------------------------------------------------------

interface SeedAmPrepItem {
  section: PrepSection;
  label: string;
  /** PAR target value; null when item has no numeric PAR (e.g., Tomato "Prep Daily"). */
  parValue: number | null;
  /** Unit-of-measure suffix on PAR; null = no unit suffix. */
  parUnit: string | null;
  /** Free-form qualifier (e.g., "Prep Daily"); rendered alongside or in place of PAR. */
  specialInstruction: string | null;
  /** Operator-editable column shape for this item (excludes "par" which is read-only display). */
  columns: PrepColumn[];
  /** Override per-item; defaults below. */
  minRoleLevel?: number;
  required?: boolean;
}

// Section column conventions per C.18 + lib/types.ts PrepColumn JSDoc.
const VEG_COLUMNS: PrepColumn[] = ["par", "on_hand", "back_up", "total"];
// Cooks: BACK UP column added Build #2 PR 1 follow-up per Juan smoke.
// Original shape was ["par", "on_hand", "total"] (no BACK UP); the
// addition unlocks auto-calc TOTAL = ON HAND + BACK UP per the
// multi-day batch semantic — BACK UP captures "what's left from prior
// batches still service-ready," so the sum represents total
// service-ready quantity across active days. Earlier Q-A1 "Cooks
// stays manual" decision was based on the column-less shape and is
// superseded by this column addition.
const COOKS_COLUMNS: PrepColumn[] = ["par", "on_hand", "back_up", "total"];
const SIDES_COLUMNS: PrepColumn[] = ["par", "portioned", "back_up", "total"];
const SAUCES_COLUMNS: PrepColumn[] = ["par", "line", "back_up", "total"];
const SLICING_COLUMNS: PrepColumn[] = ["par", "line", "back_up", "total"];

const ITEMS: SeedAmPrepItem[] = [
  // Veg
  { section: "Veg", label: "Iceberg", parValue: 7, parUnit: "min", specialInstruction: null, columns: VEG_COLUMNS },
  { section: "Veg", label: "Onion", parValue: 8, parUnit: "QT", specialInstruction: null, columns: VEG_COLUMNS },
  { section: "Veg", label: "Basil", parValue: 3, parUnit: "QT", specialInstruction: null, columns: VEG_COLUMNS },
  { section: "Veg", label: "Radish", parValue: 1, parUnit: "QT", specialInstruction: null, columns: VEG_COLUMNS },
  { section: "Veg", label: "Cucumber", parValue: 3, parUnit: "QT", specialInstruction: null, columns: VEG_COLUMNS },
  { section: "Veg", label: "Tomato", parValue: null, parUnit: null, specialInstruction: "Prep Daily", columns: VEG_COLUMNS },

  // Cooks
  { section: "Cooks", label: "Vodka", parValue: 4, parUnit: "QT", specialInstruction: null, columns: COOKS_COLUMNS },
  { section: "Cooks", label: "Marinara", parValue: 6, parUnit: "QT", specialInstruction: null, columns: COOKS_COLUMNS },
  { section: "Cooks", label: "Compound Butter", parValue: 2, parUnit: "LOGS", specialInstruction: null, columns: COOKS_COLUMNS },
  { section: "Cooks", label: "Caramelized onion", parValue: 2, parUnit: "QT", specialInstruction: null, columns: COOKS_COLUMNS },
  { section: "Cooks", label: "Jus", parValue: 4, parUnit: "QT", specialInstruction: null, columns: COOKS_COLUMNS },

  // Sides
  { section: "Sides", label: "Tuna Salad", parValue: 15, parUnit: null, specialInstruction: null, columns: SIDES_COLUMNS },
  { section: "Sides", label: "Egg Salad", parValue: 12, parUnit: null, specialInstruction: null, columns: SIDES_COLUMNS },
  { section: "Sides", label: "Onion Dip", parValue: 12, parUnit: null, specialInstruction: null, columns: SIDES_COLUMNS },
  { section: "Sides", label: "Chix Salad", parValue: 12, parUnit: null, specialInstruction: null, columns: SIDES_COLUMNS },
  { section: "Sides", label: "Antipasto Pasta", parValue: 12, parUnit: null, specialInstruction: null, columns: SIDES_COLUMNS },
  { section: "Sides", label: "Cannoli Cream", parValue: 0.5, parUnit: "BAG", specialInstruction: null, columns: SIDES_COLUMNS },

  // Sauces
  { section: "Sauces", label: "Aioli", parValue: 15, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "HC Aioli", parValue: 4, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "HP Mayo", parValue: 4, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "Mustard Aioli", parValue: 4, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "Horsey Mayo", parValue: 4, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "Salsa Verde", parValue: 1, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "Dukes", parValue: 3, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "Vin", parValue: 6, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },

  // Slicing
  { section: "Slicing", label: "Turkey", parValue: 5, parUnit: "1/3 pan", specialInstruction: null, columns: SLICING_COLUMNS },
  { section: "Slicing", label: "Ham", parValue: 15, parUnit: null, specialInstruction: null, columns: SLICING_COLUMNS },
  { section: "Slicing", label: "Capicola", parValue: 15, parUnit: null, specialInstruction: null, columns: SLICING_COLUMNS },
  { section: "Slicing", label: "Pepperoni", parValue: 12, parUnit: null, specialInstruction: null, columns: SLICING_COLUMNS },
  { section: "Slicing", label: "Genoa", parValue: 25, parUnit: null, specialInstruction: null, columns: SLICING_COLUMNS },
  { section: "Slicing", label: "Provolone", parValue: 25, parUnit: null, specialInstruction: null, columns: SLICING_COLUMNS },
  { section: "Slicing", label: "Mortadella", parValue: 4, parUnit: null, specialInstruction: null, columns: SLICING_COLUMNS },
  { section: "Slicing", label: "Roast Beef", parValue: 2, parUnit: "1/3 pan", specialInstruction: null, columns: SLICING_COLUMNS },
  { section: "Slicing", label: "Cheddar", parValue: 6, parUnit: null, specialInstruction: null, columns: SLICING_COLUMNS },

  // Misc — yes_no toggles + Cook Bacon also has free-text notes
  { section: "Misc", label: "Meatball mix - ready?", parValue: null, parUnit: null, specialInstruction: null, columns: ["yes_no"] },
  { section: "Misc", label: "Meatballs - ready to cook?", parValue: null, parUnit: null, specialInstruction: null, columns: ["yes_no"] },
  { section: "Misc", label: "Meatballs - for reheat?", parValue: null, parUnit: null, specialInstruction: null, columns: ["yes_no"] },
  { section: "Misc", label: "Cook Bacon?", parValue: null, parUnit: null, specialInstruction: null, columns: ["yes_no", "free_text"] },
];

// ---------------------------------------------------------------------------
// Insert orchestration
// ---------------------------------------------------------------------------

type SeedOutcome = "created" | "synced_with_changes" | "synced_no_changes";

interface ItemChange {
  templateItemId: string;
  displayOrder: number;
  /** field names that were updated */
  changedFields: string[];
}

interface SeedResult {
  locationId: string;
  templateId: string;
  itemCount: number;
  outcome: SeedOutcome;
  changes: ItemChange[];
  auditRowId: string | null;
}

interface ExistingItemRow {
  id: string;
  station: string | null;
  display_order: number;
  label: string;
  description: string | null;
  min_role_level: number;
  required: boolean;
  expects_count: boolean;
  expects_photo: boolean;
  active: boolean;
  translations: ChecklistTemplateItemTranslations | null;
  prep_meta: PrepMeta | null;
}

/**
 * Stable JSON comparison for JSONB blobs (translations, prep_meta).
 * Sorts keys at each level so re-runs don't churn on key-order differences.
 * Matches Postgres JSONB equality semantics (key-order-independent at the
 * storage layer).
 */
function jsonEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Build the desired prep_meta blob for a SeedAmPrepItem. */
function buildPrepMeta(item: SeedAmPrepItem): PrepMeta {
  return {
    section: item.section,
    parValue: item.parValue,
    parUnit: item.parUnit,
    specialInstruction: item.specialInstruction,
    columns: item.columns,
  };
}

async function syncItemsForTemplate(
  sb: SupabaseClient,
  locationId: string,
  templateId: string,
): Promise<{ itemCount: number; changes: ItemChange[] }> {
  const { data: existingRows, error: readErr } = await sb
    .from("checklist_template_items")
    .select(
      "id, station, display_order, label, description, min_role_level, required, expects_count, expects_photo, active, translations, prep_meta",
    )
    .eq("template_id", templateId);
  if (readErr) {
    throw new Error(
      `sync: load existing items failed for template ${templateId} (location ${locationId}): ${readErr.message}`,
    );
  }
  const existingByDisplayOrder = new Map<number, ExistingItemRow>();
  for (const r of (existingRows ?? []) as ExistingItemRow[]) {
    existingByDisplayOrder.set(r.display_order, r);
  }

  const changes: ItemChange[] = [];

  for (let i = 0; i < ITEMS.length; i++) {
    const spec = ITEMS[i];
    if (!spec) continue;
    const existing = existingByDisplayOrder.get(i);

    const desiredLabel = spec.label;
    const desiredStation: string = spec.section; // station IS the section per C.38
    const desiredDescription = null; // AM Prep items don't carry a separate description; specialInstruction lives in prep_meta
    const desiredMinRoleLevel = spec.minRoleLevel ?? 3;
    const desiredRequired = spec.required ?? true;
    const desiredPrepMeta = buildPrepMeta(spec);
    const desiredTranslations = buildTranslations(spec);

    if (!existing) {
      // CREATE: use seedPrepItem helper which guarantees the C.38
      // station ↔ prep_meta.section invariant by construction.
      const { templateItemId } = await seedPrepItem(sb, {
        templateId,
        displayOrder: i,
        section: spec.section,
        label: desiredLabel,
        description: desiredDescription,
        minRoleLevel: desiredMinRoleLevel,
        required: desiredRequired,
        meta: {
          parValue: spec.parValue,
          parUnit: spec.parUnit,
          specialInstruction: spec.specialInstruction,
          columns: spec.columns,
        },
        translations: desiredTranslations ?? undefined,
      });
      changes.push({
        templateItemId,
        displayOrder: i,
        changedFields: ["inserted"],
      });
      continue;
    }

    const fieldsToUpdate: Record<string, unknown> = {};
    if (existing.label !== desiredLabel) fieldsToUpdate.label = desiredLabel;
    // station ↔ prep_meta.section invariant (C.38): if EITHER diffs, set
    // BOTH atomically in the same UPDATE. This mirrors the atomicity that
    // setPrepItemSection() provides for single-field updates.
    const stationDiffers = existing.station !== desiredStation;
    const prepMetaDiffers = !jsonEqual(existing.prep_meta, desiredPrepMeta);
    if (stationDiffers || prepMetaDiffers) {
      fieldsToUpdate.station = desiredStation;
      fieldsToUpdate.prep_meta = desiredPrepMeta;
    }
    if ((existing.description ?? null) !== desiredDescription) {
      fieldsToUpdate.description = desiredDescription;
    }
    if (existing.min_role_level !== desiredMinRoleLevel) {
      fieldsToUpdate.min_role_level = desiredMinRoleLevel;
    }
    if (existing.required !== desiredRequired) fieldsToUpdate.required = desiredRequired;
    if (existing.expects_count !== false) fieldsToUpdate.expects_count = false;
    if (existing.expects_photo !== false) fieldsToUpdate.expects_photo = false;
    if (!existing.active) fieldsToUpdate.active = true;
    if (!jsonEqual(existing.translations, desiredTranslations)) {
      fieldsToUpdate.translations = desiredTranslations;
    }

    if (Object.keys(fieldsToUpdate).length === 0) continue;

    const { error: updateErr } = await sb
      .from("checklist_template_items")
      .update(fieldsToUpdate)
      .eq("id", existing.id);
    if (updateErr) {
      throw new Error(
        `sync: update item ${existing.id} failed: ${updateErr.message}`,
      );
    }
    changes.push({
      templateItemId: existing.id,
      displayOrder: i,
      changedFields: Object.keys(fieldsToUpdate),
    });
  }

  // Item count after sync (existing inserts + spec items; spec is the source).
  const { count, error: countErr } = await sb
    .from("checklist_template_items")
    .select("*", { count: "exact", head: true })
    .eq("template_id", templateId);
  if (countErr) {
    throw new Error(`sync: post-update count failed: ${countErr.message}`);
  }

  return { itemCount: count ?? 0, changes };
}

async function seedForLocation(
  sb: SupabaseClient,
  locationId: string,
): Promise<SeedResult> {
  // Pre-flight: existing template at this location with same name?
  const { data: existing, error: existErr } = await sb
    .from("checklist_templates")
    .select("id, name, active")
    .eq("location_id", locationId)
    .eq("type", "prep")
    .eq("name", TEMPLATE_NAME)
    .maybeSingle<{ id: string; name: string; active: boolean }>();
  if (existErr) {
    throw new Error(
      `pre-flight checklist_templates check failed for location ${locationId}: ${existErr.message}`,
    );
  }
  if (existing) {
    // SYNC PATH — converge existing items toward the spec.
    const { itemCount, changes } = await syncItemsForTemplate(sb, locationId, existing.id);

    if (changes.length === 0) {
      return {
        locationId,
        templateId: existing.id,
        itemCount,
        outcome: "synced_no_changes",
        changes: [],
        auditRowId: null,
      };
    }

    const translationsChangedCount = changes.filter((c) =>
      c.changedFields.includes("translations"),
    ).length;
    const translationsChangedItemIds = changes
      .filter((c) => c.changedFields.includes("translations"))
      .map((c) => ({ template_item_id: c.templateItemId, display_order: c.displayOrder }));
    const prepMetaChangedCount = changes.filter((c) =>
      c.changedFields.includes("prep_meta"),
    ).length;
    // ⚠️ AUDIT METADATA CONTEXT: when re-running this seed in a new PR
    // context, update the `phase` and `reason` strings below to match the
    // current work. These are NOT auto-derived; failure to update carries
    // stale attribution forward into production audit_log (see AGENTS.md
    // "Audit metadata context attribution in seed scripts" durable lesson).
    const { data: auditRow, error: auditErr } = await sb
      .from("audit_log")
      .insert({
        actor_id: JUAN_USER_ID,
        actor_role: "cgs",
        action: "checklist_template.update",
        resource_table: "checklist_templates",
        resource_id: existing.id,
        destructive: false,
        metadata: {
          phase: "3_module_1_build_2_pr_1",
          reason: "Cooks BACK UP column addition for multi-day batch TOTAL semantic",
          sync_method: "seed_script",
          script_path: "scripts/seed-am-prep-template.ts",
          location_id: locationId,
          template_name: TEMPLATE_NAME,
          changed_item_count: changes.length,
          changes: changes.map((c) => ({
            template_item_id: c.templateItemId,
            display_order: c.displayOrder,
            changed_fields: c.changedFields,
          })),
          translations_changed_count: translationsChangedCount,
          translations_changed_items: translationsChangedItemIds,
          prep_meta_changed_count: prepMetaChangedCount,
          languages_populated: ["es"],
          spec_amendments_referenced: ["C.18", "C.38", "C.41", "C.42", "C.44"],
          ip_address: null,
          user_agent: null,
        },
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    if (auditErr || !auditRow) {
      throw new Error(
        `sync audit_log insert failed for template ${existing.id}: ${auditErr?.message ?? "no row"}`,
      );
    }

    return {
      locationId,
      templateId: existing.id,
      itemCount,
      outcome: "synced_with_changes",
      changes,
      auditRowId: auditRow.id,
    };
  }

  // CREATE PATH — insert the template row.
  const { data: tmplRow, error: tmplErr } = await sb
    .from("checklist_templates")
    .insert({
      location_id: locationId,
      type: "prep",
      name: TEMPLATE_NAME,
      description: TEMPLATE_DESCRIPTION,
      active: true,
      // AM Prep is single-per-day per spec §4.3 column comment for prep
      // templates. Mid-day prep (C.43) overrides via its own template's
      // single_submission_only=false; future Mid-day Prep seed lands
      // under its own name suffix.
      single_submission_only: true,
      reminder_time: null,
      created_by: JUAN_USER_ID,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (tmplErr) {
    throw new Error(
      `checklist_templates insert failed for location ${locationId}: ${tmplErr.message}`,
    );
  }
  if (!tmplRow) {
    throw new Error(`checklist_templates insert returned no row for location ${locationId}`);
  }
  const templateId = tmplRow.id;

  // Insert items one-by-one via seedPrepItem to guarantee the C.38
  // station ↔ prep_meta.section invariant by construction.
  for (let i = 0; i < ITEMS.length; i++) {
    const spec = ITEMS[i];
    if (!spec) continue;
    await seedPrepItem(sb, {
      templateId,
      displayOrder: i,
      section: spec.section,
      label: spec.label,
      description: null,
      minRoleLevel: spec.minRoleLevel ?? 3,
      required: spec.required ?? true,
      meta: {
        parValue: spec.parValue,
        parUnit: spec.parUnit,
        specialInstruction: spec.specialInstruction,
        columns: spec.columns,
      },
      translations: buildTranslations(spec) ?? undefined,
    });
  }

  // Verify post-state.
  const { count, error: countErr } = await sb
    .from("checklist_template_items")
    .select("*", { count: "exact", head: true })
    .eq("template_id", templateId);
  if (countErr) {
    throw new Error(
      `post-insert checklist_template_items count failed: ${countErr.message}`,
    );
  }
  if ((count ?? 0) !== ITEMS.length) {
    throw new Error(
      `post-insert verify: expected ${ITEMS.length} items for template ${templateId}, got ${count ?? 0}`,
    );
  }

  // Audit. checklist_template.create is the canonical action
  // (lib/destructive-actions.ts); auto-derives destructive=true.
  // ⚠️ AUDIT METADATA CONTEXT: see marker comment above.
  const { data: auditRow, error: auditErr } = await sb
    .from("audit_log")
    .insert({
      actor_id: JUAN_USER_ID,
      actor_role: "cgs",
      action: "checklist_template.create",
      resource_table: "checklist_templates",
      resource_id: templateId,
      destructive: true,
      metadata: {
        phase: "3_module_1_build_2_pr_1",
        reason: "Standard AM Prep v1 — initial seed",
        creation_method: "seed_script",
        script_path: "scripts/seed-am-prep-template.ts",
        location_id: locationId,
        template_name: TEMPLATE_NAME,
        item_count: ITEMS.length,
        translations_populated_count: ITEMS.filter(
          (it) => buildTranslations(it) !== null,
        ).length,
        languages_populated: ["es"],
        spec_amendments_referenced: ["C.18", "C.38", "C.41", "C.42", "C.44"],
        ip_address: null,
        user_agent: null,
      },
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (auditErr || !auditRow) {
    throw new Error(
      `audit_log insert failed for template ${templateId}: ${auditErr?.message ?? "no row"}`,
    );
  }

  return {
    locationId,
    templateId,
    itemCount: ITEMS.length,
    outcome: "created",
    changes: [],
    auditRowId: auditRow.id,
  };
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set " +
        "(use --env-file=.env.local).",
    );
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  process.stdout.write(
    `seed-am-prep-template: ${ITEMS.length} items per location across MEP + EM\n`,
  );

  const mep = await seedForLocation(sb, LOCATION_MEP);
  const em = await seedForLocation(sb, LOCATION_EM);

  const summary = (r: SeedResult, label: string): string => {
    if (r.outcome === "created") {
      return `  ${label}: CREATED template ${r.templateId} with ${r.itemCount} items (audit_id=${r.auditRowId})\n`;
    }
    if (r.outcome === "synced_no_changes") {
      return `  ${label}: in sync — template ${r.templateId} (${r.itemCount} items, no changes)\n`;
    }
    const changeLines = r.changes
      .map(
        (c) =>
          `      · display_order ${c.displayOrder}: ${c.changedFields.join(", ")} (item ${c.templateItemId})`,
      )
      .join("\n");
    return (
      `  ${label}: SYNCED template ${r.templateId} with ${r.changes.length} item change(s) (audit_id=${r.auditRowId})\n${changeLines}\n`
    );
  };

  process.stdout.write(`OK\n${summary(mep, "MEP")}${summary(em, "EM ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
