/**
 * Seed: Standard Closing v2 — Module #1 Build #2 PR 1 closing template
 * with AM Prep List report-reference auto-completion swap.
 *
 * Path A versioning per SPEC_AMENDMENTS.md C.19: v1 stays untouched (active
 * preserved); v2 is a parallel template (active=true at creation). Both can
 * be active simultaneously — the closing-page resolver picks most-recent
 * active by `created_at DESC`, so v2 wins for new instances after this seed
 * runs. v1's flip to `active: false` is deferred to a follow-up cleanup PR
 * once v2 has exercised in production for at least one full day.
 *
 * Item swap (the only structural difference from v1):
 *   - v1 display_order 44, "Closing Manager" / "Fill out AM Prep List":
 *     a paper-continuation cleaning placeholder
 *   - v2 same display_order + station: "AM Prep List" report-reference item
 *     with `report_reference_type='am_prep'` — auto-completes when the AM
 *     Prep List is submitted for today's operational date (per C.42 reports
 *     architecture).
 *
 * All 49 other v1 items copy unchanged into v2 (same labels, stations,
 * min_role_level, required, expects_count, expects_photo, notes,
 * translations). v1 ITEMS array is the single source of truth — imported
 * via the `export const ITEMS` added to scripts/seed-closing-template.ts.
 *
 * Architectural references:
 *   - C.19 — Path A versioning (name suffix + active flag); closing as
 *     anchor with report-reference items
 *   - C.42 — operational reports architecture; auto-complete mechanic;
 *     inline attribution ("AM Prep List ✓ — submitted by Cristian at 9:47 PM")
 *   - C.41 reconciliation — min_role_level = 3 (KH+) per the locked
 *     finalize-gate semantic
 *   - C.38 — system-key vs display-string discipline; station IS the system
 *     key for grouping (closing-client groupByStation matches against the
 *     English `station` column, not the resolved display)
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/seed-standard-closing-v2.ts
 *
 * Convergent semantics (mirrors scripts/seed-closing-template.ts):
 *   - Pre-flight (location_id, type='closing', name='Standard Closing v2')
 *     lookup. CREATE on miss; SYNC on hit by display_order.
 *   - Items matched by display_order (stable across renames).
 *   - SYNC path additionally diffs `report_reference_type` (the v2-specific
 *     field). Toggling between cleaning ↔ report-reference works through
 *     convergent sync without a schema change.
 *   - The AM Prep report-reference item has `prep_meta = null` (it's a
 *     report-reference, not a prep item).
 *
 * Audit metadata convention (per AGENTS.md "Audit metadata context
 * attribution in seed scripts" durable lesson):
 *   - phase: "3_module_1_build_2_pr_1"
 *   - reason: "Standard Closing v2 — AM Prep report-reference swap per C.42"
 *
 * ⚠️ AUDIT METADATA CONTEXT MARKER ⚠️
 * If you re-run this script in a NEW PR context, update the `phase` and
 * `reason` strings inside seedForLocation() BEFORE running. These strings
 * are NOT auto-derived from git context; failure to update propagates
 * stale attribution into production audit_log and requires an
 * `audit.metadata_correction` row to remediate.
 */

import { pathToFileURL } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  ITEMS as V1_ITEMS,
  buildTranslations as buildV1Translations,
  type SeedItem as V1SeedItem,
} from "./seed-closing-template";
import type {
  ChecklistTemplateItemTranslations,
  ReportType,
} from "../lib/types";

// Juan's user_id — actor for the audit rows. Stable since Phase 1 seed.
const JUAN_USER_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";

const LOCATION_MEP = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a";
const LOCATION_EM = "d2cced11-b167-49fa-bab6-86ec9bf4ff09";

const TEMPLATE_NAME = "Standard Closing v2";
const TEMPLATE_DESCRIPTION =
  "End-of-shift closing checklist (Build #2 — adds AM Prep List " +
  "report-reference auto-completion per SPEC_AMENDMENTS.md C.42). " +
  "Replaces v1's 'Fill out AM Prep List' cleaning placeholder with a " +
  "report_reference_type='am_prep' item that auto-completes on AM Prep " +
  "submission. Per Path A versioning (C.19), v1 stays active for old " +
  "instances; v2 active for new instances.";

// ---------------------------------------------------------------------------
// SeedItemV2 — extends v1's SeedItem with optional reportReferenceType.
// Cleaning items (the 49 v1 carryovers) leave reportReferenceType undefined;
// the swap target sets it to 'am_prep'.
// ---------------------------------------------------------------------------

interface SeedItemV2 extends V1SeedItem {
  reportReferenceType?: ReportType;
}

// ---------------------------------------------------------------------------
// The AM Prep report-reference item — explicit translations rather than
// going through buildV1Translations because the label, description, AND
// Spanish strings are all v2-specific. Station translation ("Closing
// Manager" → "Gerente de cierre") matches the v1 STATION_ES map for
// consistency with the rest of v2's Closing Manager rows.
// ---------------------------------------------------------------------------

const AM_PREP_REF_LABEL_EN = "AM Prep List";
const AM_PREP_REF_LABEL_ES = "Lista de Prep AM";
const AM_PREP_REF_DESCRIPTION_EN =
  "Auto-completes when AM Prep List is submitted for today. If pending, " +
  "tap to navigate to the AM Prep page.";
const AM_PREP_REF_DESCRIPTION_ES =
  "Se completa automáticamente cuando se envía la Lista de Prep AM de " +
  "hoy. Si está pendiente, toca para ir a la página de prep AM.";
const AM_PREP_REF_STATION = "Closing Manager";
// Mirrors STATION_ES['Closing Manager'] from scripts/seed-closing-template.ts.
// Hardcoded rather than imported — v1 doesn't export STATION_ES today, and
// importing it just to read one key adds a wider export surface than
// warranted. Keep in sync if v1's STATION_ES['Closing Manager'] ever changes.
const AM_PREP_REF_STATION_ES = "Gerente de cierre";

const AM_PREP_REF_ITEM: SeedItemV2 = {
  station: AM_PREP_REF_STATION,
  label: AM_PREP_REF_LABEL_EN,
  reportReferenceType: "am_prep",
  // Note ends up on the description column. Translation populated below
  // via buildV2Translations.
  notes: AM_PREP_REF_DESCRIPTION_EN,
  // min_role_level inherits the seed default 3 (KH+) per C.41
  // reconciliation. required defaults to true. expects_count + expects_photo
  // default to false.
};

/**
 * Builds translations for v2 items. The AM Prep report-reference item uses
 * v2-specific Spanish strings; carryover items delegate to v1's
 * buildTranslations (same maps, same coverage).
 */
function buildV2Translations(
  item: SeedItemV2,
): ChecklistTemplateItemTranslations | null {
  if (item.reportReferenceType === "am_prep") {
    return {
      es: {
        label: AM_PREP_REF_LABEL_ES,
        station: AM_PREP_REF_STATION_ES,
        description: AM_PREP_REF_DESCRIPTION_ES,
      },
    };
  }
  // Carryover — v1 maps cover all v1 items; types align because SeedItemV2
  // structurally extends V1SeedItem.
  const v1Result = buildV1Translations(item);
  if (v1Result === null) return null;
  // v1's buildTranslations returns a `Record<string, string>` shape; cast
  // to the shared ChecklistTemplateItemTranslations type. Field set is
  // {label?, station?, description?} for both.
  return v1Result as ChecklistTemplateItemTranslations;
}

// ---------------------------------------------------------------------------
// Build the v2 ITEMS array by mapping over v1 ITEMS, swapping the
// "Fill out AM Prep List" target with the AM Prep report-reference item
// at the same display_order. Position is resolved dynamically from v1's
// array — robust to any future v1 reorder; the swap target is identified
// by label match, not by hardcoded index.
// ---------------------------------------------------------------------------

const SWAP_TARGET_LABEL = "Fill out AM Prep List";

const ITEMS_V2: SeedItemV2[] = V1_ITEMS.map((it) =>
  it.label === SWAP_TARGET_LABEL ? AM_PREP_REF_ITEM : it,
);

// Defensive: assert exactly one swap landed.
const swapCount = ITEMS_V2.filter((it) => it.reportReferenceType === "am_prep").length;
if (swapCount !== 1) {
  throw new Error(
    `seed-standard-closing-v2: expected exactly 1 AM Prep report-reference ` +
      `item after swap; got ${swapCount}. v1 ITEMS may have changed.`,
  );
}

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
  report_reference_type: ReportType | null;
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

async function syncItemsForTemplate(
  sb: SupabaseClient,
  locationId: string,
  templateId: string,
): Promise<{ itemCount: number; changes: ItemChange[] }> {
  const { data: existingRows, error: readErr } = await sb
    .from("checklist_template_items")
    .select(
      "id, station, display_order, label, description, min_role_level, required, expects_count, expects_photo, active, translations, report_reference_type",
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

  for (let i = 0; i < ITEMS_V2.length; i++) {
    const spec = ITEMS_V2[i];
    if (!spec) continue;
    const existing = existingByDisplayOrder.get(i);

    const desiredLabel = spec.label;
    const desiredStation = spec.station;
    const desiredDescription = spec.notes ?? null;
    const desiredMinRoleLevel = spec.minRoleLevel ?? 3;
    const desiredRequired = spec.required ?? true;
    const desiredExpectsCount = spec.expectsCount ?? false;
    const desiredExpectsPhoto = spec.expectsPhoto ?? false;
    const desiredReportRefType = spec.reportReferenceType ?? null;
    const desiredTranslations = buildV2Translations(spec);

    if (!existing) {
      // INSERT — checklist_template_items insert with all v2 fields.
      const { data: inserted, error: insertErr } = await sb
        .from("checklist_template_items")
        .insert({
          template_id: templateId,
          station: desiredStation,
          display_order: i,
          label: desiredLabel,
          description: desiredDescription,
          min_role_level: desiredMinRoleLevel,
          required: desiredRequired,
          expects_count: desiredExpectsCount,
          expects_photo: desiredExpectsPhoto,
          vendor_item_id: null,
          active: true,
          translations: desiredTranslations,
          // prep_meta = null: v2 has no prep items (the AM Prep row is a
          // report-reference, not a prep item).
          prep_meta: null,
          report_reference_type: desiredReportRefType,
        })
        .select("id")
        .maybeSingle<{ id: string }>();
      if (insertErr || !inserted) {
        throw new Error(
          `sync: insert at display_order ${i} failed for template ${templateId}: ${insertErr?.message ?? "no row"}`,
        );
      }
      changes.push({
        templateItemId: inserted.id,
        displayOrder: i,
        changedFields: ["inserted"],
      });
      continue;
    }

    const fieldsToUpdate: Record<string, unknown> = {};
    if (existing.label !== desiredLabel) fieldsToUpdate.label = desiredLabel;
    if (existing.station !== desiredStation) fieldsToUpdate.station = desiredStation;
    if ((existing.description ?? null) !== desiredDescription) {
      fieldsToUpdate.description = desiredDescription;
    }
    if (existing.min_role_level !== desiredMinRoleLevel) {
      fieldsToUpdate.min_role_level = desiredMinRoleLevel;
    }
    if (existing.required !== desiredRequired) fieldsToUpdate.required = desiredRequired;
    if (existing.expects_count !== desiredExpectsCount) {
      fieldsToUpdate.expects_count = desiredExpectsCount;
    }
    if (existing.expects_photo !== desiredExpectsPhoto) {
      fieldsToUpdate.expects_photo = desiredExpectsPhoto;
    }
    if (!existing.active) fieldsToUpdate.active = true;
    if (existing.report_reference_type !== desiredReportRefType) {
      fieldsToUpdate.report_reference_type = desiredReportRefType;
    }
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
  const { data: existing, error: existErr } = await sb
    .from("checklist_templates")
    .select("id, name, active")
    .eq("location_id", locationId)
    .eq("type", "closing")
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

    const translationsChangedCount = changes.filter((c) =>
      c.changedFields.includes("translations"),
    ).length;
    const translationsChangedItemIds = changes
      .filter((c) => c.changedFields.includes("translations"))
      .map((c) => ({ template_item_id: c.templateItemId, display_order: c.displayOrder }));
    // ⚠️ AUDIT METADATA CONTEXT: when re-running this seed in a new PR
    // context, update the `phase` and `reason` strings below to match the
    // current work. These are NOT auto-derived (see AGENTS.md durable
    // lesson "Audit metadata context attribution in seed scripts").
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
          reason: "Standard Closing v2 — AM Prep report-reference swap per C.42",
          sync_method: "seed_script",
          script_path: "scripts/seed-standard-closing-v2.ts",
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
          languages_populated: ["es"],
          spec_amendments_referenced: ["C.19", "C.38", "C.41", "C.42"],
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

  // CREATE PATH — insert a fresh v2 template row alongside the existing v1.
  const { data: tmplRow, error: tmplErr } = await sb
    .from("checklist_templates")
    .insert({
      location_id: locationId,
      type: "closing",
      name: TEMPLATE_NAME,
      description: TEMPLATE_DESCRIPTION,
      active: true,
      single_submission_only: false,
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

  const itemRows = ITEMS_V2.map((it, idx) => ({
    template_id: templateId,
    station: it.station,
    display_order: idx,
    label: it.label,
    description: it.notes ?? null,
    min_role_level: it.minRoleLevel ?? 3,
    required: it.required ?? true,
    expects_count: it.expectsCount ?? false,
    expects_photo: it.expectsPhoto ?? false,
    vendor_item_id: null,
    active: true,
    translations: buildV2Translations(it),
    prep_meta: null,
    report_reference_type: it.reportReferenceType ?? null,
  }));

  const { error: itemsErr } = await sb
    .from("checklist_template_items")
    .insert(itemRows);
  if (itemsErr) {
    throw new Error(
      `checklist_template_items insert failed for template ${templateId} (location ${locationId}): ${itemsErr.message}`,
    );
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
  if ((count ?? 0) !== ITEMS_V2.length) {
    throw new Error(
      `post-insert verify: expected ${ITEMS_V2.length} items for template ${templateId}, got ${count ?? 0}`,
    );
  }

  // Audit. checklist_template.create is canonical (lib/destructive-actions.ts);
  // auto-derives destructive=true.
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
        reason: "Standard Closing v2 — AM Prep report-reference swap per C.42",
        creation_method: "seed_script",
        script_path: "scripts/seed-standard-closing-v2.ts",
        location_id: locationId,
        template_name: TEMPLATE_NAME,
        item_count: ITEMS_V2.length,
        report_reference_swap: {
          target_label: SWAP_TARGET_LABEL,
          new_label: AM_PREP_REF_LABEL_EN,
          report_type: "am_prep",
          display_order: ITEMS_V2.findIndex(
            (it) => it.reportReferenceType === "am_prep",
          ),
        },
        translations_populated_count: ITEMS_V2.filter(
          (it) => buildV2Translations(it) !== null,
        ).length,
        languages_populated: ["es"],
        spec_amendments_referenced: ["C.19", "C.38", "C.41", "C.42"],
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
    itemCount: ITEMS_V2.length,
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
    `seed-standard-closing-v2: ${ITEMS_V2.length} items per location across MEP + EM ` +
      `(swap: "${SWAP_TARGET_LABEL}" → "${AM_PREP_REF_LABEL_EN}" report_reference_type='am_prep')\n`,
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

// Only run main() when this script is invoked directly via tsx/node. v2
// has no current downstream importer, but applying the same gate idiom
// for consistency with v1 (and to avoid a future seed accidentally
// triggering v2's full convergent path on import).
if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
