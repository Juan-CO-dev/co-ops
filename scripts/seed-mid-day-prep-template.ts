/**
 * Seed: Standard Mid-day Prep v1 — C.43 mid-day prep checklist template.
 *
 * Mid-day prep is the after-rush "back to par" top-up (SPEC_AMENDMENTS.md C.43).
 * A mid-day-specific perishable subset, prepped only during mid-day prep. 14
 * items across 2 sections:
 *   - Veg (6): Pickles, Sweet Peppers, Hot Peppers, Basil, Shredded Mozzarella,
 *     Fresh Mozzarella
 *   - Sauces (8): Aioli, HC Aioli, HP Mayo, Mustard Aioli, Horsey Mayo,
 *     Salsa Verde, Dukes, Vin
 *
 * PROVISIONAL (Juan to confirm at the shop): section grouping for the two
 * mozzarellas (placed in Veg for now — QT/on-hand counting fits; re-section if
 * a cheese/dairy grouping is preferred). Cranberry sauce is SEASONAL — deferred,
 * not seeded. Perishable pars from Juan (2026-06-14): pickles 20 QT, sweet
 * peppers 12 QT, hot peppers 12 QT, shredded mozz 5 QT, fresh mozz 12 QT; basil
 * + the 8 sauces reuse their AM-prep pars.
 *
 * Key differences from Standard AM Prep v1 (scripts/seed-am-prep-template.ts):
 *   - prep_subtype = 'mid_day_prep' (migration 0059 discriminator; loadMidDay-
 *     PrepState filters on it). REQUIRED — the CHECK constraint rejects a
 *     type='prep' template with a null prep_subtype.
 *   - single_submission_only = false (mid-day is multi-instance per day, C.43).
 *
 * Architectural references: C.18 (section-aware data model), C.21 (L3+ init),
 * C.38 (system-key vs display discipline), C.43 (multi-instance), C.44
 * (denormalized snapshot).
 *
 * Run: npx tsx --env-file=.env.local scripts/seed-mid-day-prep-template.ts
 *
 * Convergent semantics + audit-metadata-context discipline mirror
 * scripts/seed-am-prep-template.ts (see that file's header for the full
 * rationale). ⚠️ If re-running in a NEW PR context, update the `phase`/`reason`
 * strings in seedForLocation() before running (AGENTS.md "Audit metadata
 * context attribution in seed scripts" lesson).
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

// Location ids (match seed-am-prep-template.ts / phase-2.5 provisioning).
const LOCATION_MEP = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a";
const LOCATION_EM = "d2cced11-b167-49fa-bab6-86ec9bf4ff09";

const TEMPLATE_NAME = "Standard Mid-day Prep v1";
const TEMPLATE_DESCRIPTION =
  "After-rush mid-day prep — brings perishables back to par. Per " +
  "SPEC_AMENDMENTS.md C.43 (multi-instance numbered prep). Two-phase: Phase 1 " +
  "count establishes the back-to-par need; Phase 2 collaborative prep. PAR/" +
  "section/unit denormalized into completion snapshots per C.44.";

// ---------------------------------------------------------------------------
// Spanish translations (C.37 / C.38). Keyed by English source-of-truth.
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
  Pickles: "Pepinillos",
  "Sweet Peppers": "Pimientos dulces",
  "Hot Peppers": "Pimientos picantes",
  Basil: "Albahaca",
  "Shredded Mozzarella": "Mozzarella rallada",
  "Fresh Mozzarella": "Mozzarella fresca",

  // Sauces (reused from AM prep)
  Aioli: "Alioli",
  "HC Aioli": "Alioli HC",
  "HP Mayo": "Mayo HP",
  "Mustard Aioli": "Alioli de mostaza",
  "Horsey Mayo": "Mayo de rábano picante",
  "Salsa Verde": "Salsa verde",
  Dukes: "Dukes",
  Vin: "Vinagreta",
};

function buildTranslations(
  item: SeedMidDayPrepItem,
): ChecklistTemplateItemTranslations | null {
  const labelEs = LABEL_ES[item.label];
  const stationEs = STATION_ES[item.section];

  const esEntry: NonNullable<ChecklistTemplateItemTranslations["es"]> = {};
  if (labelEs) esEntry.label = labelEs;
  if (stationEs) esEntry.station = stationEs;

  if (Object.keys(esEntry).length === 0) return null;
  return { es: esEntry };
}

// ---------------------------------------------------------------------------
// Item registry. display_order is the index within ITEMS (single monotonic
// sequence; sections render together).
// ---------------------------------------------------------------------------

interface SeedMidDayPrepItem {
  section: PrepSection;
  label: string;
  parValue: number | null;
  parUnit: string | null;
  specialInstruction: string | null;
  columns: PrepColumn[];
  minRoleLevel?: number;
  required?: boolean;
}

const VEG_COLUMNS: PrepColumn[] = ["par", "on_hand", "back_up", "total"];
const SAUCES_COLUMNS: PrepColumn[] = ["par", "line", "back_up", "total"];

const ITEMS: SeedMidDayPrepItem[] = [
  // Veg (perishables) — pars from Juan 2026-06-14.
  { section: "Veg", label: "Pickles", parValue: 20, parUnit: "QT", specialInstruction: null, columns: VEG_COLUMNS },
  { section: "Veg", label: "Sweet Peppers", parValue: 12, parUnit: "QT", specialInstruction: null, columns: VEG_COLUMNS },
  { section: "Veg", label: "Hot Peppers", parValue: 12, parUnit: "QT", specialInstruction: null, columns: VEG_COLUMNS },
  { section: "Veg", label: "Basil", parValue: 3, parUnit: "QT", specialInstruction: null, columns: VEG_COLUMNS },
  { section: "Veg", label: "Shredded Mozzarella", parValue: 5, parUnit: "QT", specialInstruction: null, columns: VEG_COLUMNS },
  { section: "Veg", label: "Fresh Mozzarella", parValue: 12, parUnit: "QT", specialInstruction: null, columns: VEG_COLUMNS },

  // Sauces (reuse AM-prep pars).
  { section: "Sauces", label: "Aioli", parValue: 15, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "HC Aioli", parValue: 4, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "HP Mayo", parValue: 4, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "Mustard Aioli", parValue: 4, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "Horsey Mayo", parValue: 4, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "Salsa Verde", parValue: 1, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "Dukes", parValue: 3, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
  { section: "Sauces", label: "Vin", parValue: 6, parUnit: "BTL", specialInstruction: null, columns: SAUCES_COLUMNS },
];

// ---------------------------------------------------------------------------
// Insert orchestration (mirrors seed-am-prep-template.ts).
// ---------------------------------------------------------------------------

type SeedOutcome = "created" | "synced_with_changes" | "synced_no_changes";

interface ItemChange {
  templateItemId: string;
  displayOrder: number;
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

function buildPrepMeta(item: SeedMidDayPrepItem): PrepMeta {
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
    const desiredDescription = null;
    const desiredMinRoleLevel = spec.minRoleLevel ?? 3;
    const desiredRequired = spec.required ?? true;
    const desiredPrepMeta = buildPrepMeta(spec);
    const desiredTranslations = buildTranslations(spec);

    if (!existing) {
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
      changes.push({ templateItemId, displayOrder: i, changedFields: ["inserted"] });
      continue;
    }

    const fieldsToUpdate: Record<string, unknown> = {};
    if (existing.label !== desiredLabel) fieldsToUpdate.label = desiredLabel;
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
      throw new Error(`sync: update item ${existing.id} failed: ${updateErr.message}`);
    }
    changes.push({
      templateItemId: existing.id,
      displayOrder: i,
      changedFields: Object.keys(fieldsToUpdate),
    });
  }

  const { count, error: countErr } = await sb
    .from("checklist_template_items")
    .select("*", { count: "exact", head: true })
    .eq("template_id", templateId);
  if (countErr) throw new Error(`sync: post-update count failed: ${countErr.message}`);

  return { itemCount: count ?? 0, changes };
}

async function seedForLocation(
  sb: SupabaseClient,
  locationId: string,
): Promise<SeedResult> {
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
    // ⚠️ AUDIT METADATA CONTEXT: update phase/reason when re-running in a new PR.
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
          phase: "3_module_1_c43_mid_day_prep",
          reason: "Standard Mid-day Prep v1 — item sync",
          sync_method: "seed_script",
          script_path: "scripts/seed-mid-day-prep-template.ts",
          location_id: locationId,
          template_name: TEMPLATE_NAME,
          changed_item_count: changes.length,
          changes: changes.map((c) => ({
            template_item_id: c.templateItemId,
            display_order: c.displayOrder,
            changed_fields: c.changedFields,
          })),
          languages_populated: ["es"],
          spec_amendments_referenced: ["C.18", "C.21", "C.38", "C.43", "C.44"],
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

  // CREATE PATH.
  const { data: tmplRow, error: tmplErr } = await sb
    .from("checklist_templates")
    .insert({
      location_id: locationId,
      type: "prep",
      prep_subtype: "mid_day_prep", // C.43 discriminator (migration 0059) — REQUIRED by CHECK.
      name: TEMPLATE_NAME,
      description: TEMPLATE_DESCRIPTION,
      active: true,
      single_submission_only: false, // mid-day is multi-instance per day (C.43).
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

  const { count, error: countErr } = await sb
    .from("checklist_template_items")
    .select("*", { count: "exact", head: true })
    .eq("template_id", templateId);
  if (countErr) {
    throw new Error(`post-insert checklist_template_items count failed: ${countErr.message}`);
  }
  if ((count ?? 0) !== ITEMS.length) {
    throw new Error(
      `post-insert verify: expected ${ITEMS.length} items for template ${templateId}, got ${count ?? 0}`,
    );
  }

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
        phase: "3_module_1_c43_mid_day_prep",
        reason: "Standard Mid-day Prep v1 — initial seed (C.43)",
        creation_method: "seed_script",
        script_path: "scripts/seed-mid-day-prep-template.ts",
        location_id: locationId,
        template_name: TEMPLATE_NAME,
        prep_subtype: "mid_day_prep",
        item_count: ITEMS.length,
        translations_populated_count: ITEMS.filter((it) => buildTranslations(it) !== null).length,
        languages_populated: ["es"],
        spec_amendments_referenced: ["C.18", "C.21", "C.38", "C.43", "C.44"],
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
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (use --env-file=.env.local).",
    );
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  process.stdout.write(
    `seed-mid-day-prep-template: ${ITEMS.length} items per location across MEP + EM\n`,
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
    return `  ${label}: SYNCED template ${r.templateId} with ${r.changes.length} item change(s) (audit_id=${r.auditRowId})\n${changeLines}\n`;
  };

  process.stdout.write(`OK\n${summary(mep, "MEP")}${summary(em, "EM ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
