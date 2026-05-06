/**
 * Seed: Standard Opening v1 — Build #3 PR 2 Phase 1 verification template.
 *
 * 44 items across 10 stations mirroring closing's structure for visual /
 * cognitive parity per BUILD_3_OPENING_REPORT_DESIGN.md §2.1. Three flavors
 * of opening items:
 *   - F1: safety/security verification of closing tasks
 *   - F2: counts/state verification (8 fridge temps with expects_count=true)
 *   - F3: opening-specific tasks with no closing pair
 *
 * All required, all KH+ (min_role_level=3), single_submission_only=true
 * (atomic whole-form submission via submit_opening_atomic — implementation
 * lands in PR 3). Phase 1 → Phase 2 transition is local-form-state-only;
 * no partial DB submission. Mirrors AM Prep's pattern.
 *
 * Convergent semantics (mirrors scripts/seed-standard-closing-v2.ts CREATE+SYNC):
 *   - Pre-flight (location_id, type='opening', name='Standard Opening v1')
 *     lookup. CREATE on miss; SYNC on hit.
 *   - Items matched by display_order during sync (stable across renames).
 *   - PR 3 will additively add Phase 2 prep entry items via this same
 *     script — re-run after appending to OPENING_ITEMS, items 44+ get
 *     INSERTed into existing template.
 *
 * Cross-template auto-completion target: closing v2's "Opening verified"
 * item (added in C.49 via scripts/seed-closing-template-v2-c49-additions.ts)
 * has report_reference_type='opening' — it auto-completes via the existing
 * C.42 lib mechanic when this template's instance submits (in reverse
 * temporal direction: opening(N+1) submission auto-completes closing(N)'s
 * "Opening verified" item). NO new auto-completion code; reuses the
 * existing AM Prep precedent end-to-end.
 *
 * Audit metadata convention (per AGENTS.md):
 *   - CREATE-path: action='checklist_template.create' (destructive=true via registry)
 *   - SYNC-path: action='checklist_template.update' (destructive=false)
 *   - actor_id: Juan; actor_role: 'cgs'
 *
 * ⚠️ AUDIT METADATA CONTEXT MARKER ⚠️
 * If you re-run this script in a NEW PR context, update the `phase` and
 * `reason` strings inside seedForLocation() BEFORE running. These strings
 * are NOT auto-derived (see AGENTS.md durable lesson "Audit metadata
 * context attribution in seed scripts").
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/seed-opening-template-v1.ts
 */

import { pathToFileURL } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ChecklistTemplateItemTranslations } from "../lib/types";

// Juan's user_id — actor for audit rows. Stable since Phase 1 seed.
const JUAN_USER_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";

const LOCATION_MEP = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a";
const LOCATION_EM = "d2cced11-b167-49fa-bab6-86ec9bf4ff09";

const TEMPLATE_NAME = "Standard Opening v1";
const TEMPLATE_DESCRIPTION =
  "Phase 1 Verification Checklist — opener verifies that prior closing's " +
  "claimed state matches reality (per BUILD_3_OPENING_REPORT_DESIGN.md §2). " +
  "Per-station tick UX with optional per-item photo/comment for discrepancies. " +
  "Discrepancies don't block opening; they're captured as data. PR 2 ships " +
  "Phase 1 only; Phase 2 prep entry items added in PR 3.";

// ---------------------------------------------------------------------------
// Station name constants — opening operational frame.
//
// Most differ from closing's station names to reflect the opening context
// (Back Line Open vs closing's Shut Down Back Line, etc.). EXCEPTION:
// Walk-Out Verification matches closing's exact string per the C.49 lock —
// the name describes what's being verified, not literal walk-in/walk-out
// direction; identical naming enables cross-template Synthesis querying.
//
// Walk Ins Station uses canonical capital S (matches closing v2 post-C.49
// standardization). C.38 system-key discipline: typo = duplicate station
// header.
// ---------------------------------------------------------------------------

const STATION_CRUNCHY_BOI = "Crunchy Boi Station";
const STATION_3RD_PARTY = "3rd Party Station";
const STATION_WALK_INS_OPEN = "Walk Ins Station"; // canonical capital S
const STATION_PREP_FRIDGE = "Prep Fridge";
const STATION_PREP_AREA = "Prep Area";
const STATION_BACK_LINE_OPEN = "Back Line Open"; // vs closing's "Shut Down Back Line"
const STATION_EXPO = "Expo Station";
const STATION_FOH_OPEN = "Front of House Open"; // vs closing's "Clean front of house"
const STATION_MANAGER_OPEN = "Manager Open"; // vs closing's "Closing Manager"
const STATION_WALK_OUT = "Walk-Out Verification"; // SAME as closing per C.49 lock

// ---------------------------------------------------------------------------
// Spanish station translations (operational/practical, restaurant register).
// Pattern matches closing v1's STATION_ES (refri / loanwords for tablets, POS).
// ---------------------------------------------------------------------------

const STATION_ES: Record<string, string> = {
  [STATION_CRUNCHY_BOI]: "Estación Crunchy Boi",
  [STATION_3RD_PARTY]: "Estación de terceros",
  [STATION_WALK_INS_OPEN]: "Estación walk-ins",
  [STATION_PREP_FRIDGE]: "Refri de prep",
  [STATION_PREP_AREA]: "Área de prep",
  [STATION_BACK_LINE_OPEN]: "Apertura de línea trasera",
  [STATION_EXPO]: "Estación Expo",
  [STATION_FOH_OPEN]: "Apertura del frente",
  [STATION_MANAGER_OPEN]: "Apertura de gerente",
  [STATION_WALK_OUT]: "Verificación de salida", // matches closing v1's existing ES
};

// ---------------------------------------------------------------------------
// OPENING_ITEMS — 44 items, ordered for display_order assignment by index.
// ---------------------------------------------------------------------------

interface OpeningSeedItem {
  station: string;
  label: string;
  labelEs: string;
  expectsCount: boolean;
}

const OPENING_ITEMS: OpeningSeedItem[] = [
  // Station 1: Crunchy Boi Station (display_order 0-3)
  {
    station: STATION_CRUNCHY_BOI,
    label: "Station appears clean as reported",
    labelEs: "Estación limpia como se reportó",
    expectsCount: false,
  },
  {
    station: STATION_CRUNCHY_BOI,
    label: "Station fridge holding temp (≤41°F)",
    labelEs: "Refri de la estación a temperatura (≤41°F)",
    expectsCount: true,
  },
  {
    station: STATION_CRUNCHY_BOI,
    label: "Sauces topped off & dated correctly",
    labelEs: "Salsas rellenas y fechadas correctamente",
    expectsCount: false,
  },
  {
    station: STATION_CRUNCHY_BOI,
    label: "Station ready for service (containers placed, prep ready)",
    labelEs: "Estación lista para servicio (contenedores en su lugar, prep listo)",
    expectsCount: false,
  },

  // Station 2: 3rd Party Station (4-7)
  {
    station: STATION_3RD_PARTY,
    label: "Station appears clean as reported",
    labelEs: "Estación limpia como se reportó",
    expectsCount: false,
  },
  {
    station: STATION_3RD_PARTY,
    label: "Station fridge holding temp (≤41°F)",
    labelEs: "Refri de la estación a temperatura (≤41°F)",
    expectsCount: true,
  },
  {
    station: STATION_3RD_PARTY,
    label: "Sauces topped off & dated correctly",
    labelEs: "Salsas rellenas y fechadas correctamente",
    expectsCount: false,
  },
  {
    station: STATION_3RD_PARTY,
    label: "3rd party tablets on, charged, signed in",
    labelEs: "Tablets de terceros encendidas, cargadas, con sesión",
    expectsCount: false,
  },

  // Station 3: Walk Ins Station (8-11)
  {
    station: STATION_WALK_INS_OPEN,
    label: "Station appears clean as reported",
    labelEs: "Estación limpia como se reportó",
    expectsCount: false,
  },
  {
    station: STATION_WALK_INS_OPEN,
    label: "Station fridge holding temp (≤41°F)",
    labelEs: "Refri de la estación a temperatura (≤41°F)",
    expectsCount: true,
  },
  {
    station: STATION_WALK_INS_OPEN,
    label: "Sauces topped off & dated correctly",
    labelEs: "Salsas rellenas y fechadas correctamente",
    expectsCount: false,
  },
  {
    station: STATION_WALK_INS_OPEN,
    label: "Station ready for service (containers placed, prep ready)",
    labelEs: "Estación lista para servicio (contenedores en su lugar, prep listo)",
    expectsCount: false,
  },

  // Station 4: Prep Fridge (12-15)
  {
    station: STATION_PREP_FRIDGE,
    label: "Station appears clean as reported",
    labelEs: "Estación limpia como se reportó",
    expectsCount: false,
  },
  {
    station: STATION_PREP_FRIDGE,
    label: "Sauce fridge holding temp (≤41°F)",
    labelEs: "Refri de salsas a temperatura (≤41°F)",
    expectsCount: true,
  },
  {
    station: STATION_PREP_FRIDGE,
    label: "Sauces topped off & dated correctly",
    labelEs: "Salsas rellenas y fechadas correctamente",
    expectsCount: false,
  },
  {
    station: STATION_PREP_FRIDGE,
    label: "Station ready for service",
    labelEs: "Estación lista para servicio",
    expectsCount: false,
  },

  // Station 5: Prep Area (16-21)
  {
    station: STATION_PREP_AREA,
    label: "3-door fridge holding temp (≤41°F)",
    labelEs: "Refri de 3 puertas a temperatura (≤41°F)",
    expectsCount: true,
  },
  {
    station: STATION_PREP_AREA,
    label: "Back walk-in organized as reported",
    labelEs: "Walk-in trasero organizado como se reportó",
    expectsCount: false,
  },
  {
    station: STATION_PREP_AREA,
    label: "Smallwares & utensils put away as reported",
    labelEs: "Utensilios y herramientas guardados como se reportó",
    expectsCount: false,
  },
  {
    station: STATION_PREP_AREA,
    label: "3-bay sink clean & dry as reported",
    labelEs: "Lavabo de 3 compartimentos limpio y seco como se reportó",
    expectsCount: false,
  },
  {
    station: STATION_PREP_AREA,
    label: "Dish machine ready to start",
    labelEs: "Lavavajillas listo para empezar",
    expectsCount: false,
  },
  {
    station: STATION_PREP_AREA,
    label: "No trash bags lingering (dumpster trip done)",
    labelEs: "Sin bolsas de basura pendientes (basurero ya vaciado)",
    expectsCount: false,
  },

  // Station 6: Back Line Open (22-26)
  {
    station: STATION_BACK_LINE_OPEN,
    label: "Burners clean as reported",
    labelEs: "Quemadores limpios como se reportó",
    expectsCount: false,
  },
  {
    station: STATION_BACK_LINE_OPEN,
    label: "Tile walls clean as reported",
    labelEs: "Paredes de azulejo limpias como se reportó",
    expectsCount: false,
  },
  {
    station: STATION_BACK_LINE_OPEN,
    label: "Burners ignite, oven heating to temp",
    labelEs: "Quemadores encienden, horno calentando a temperatura",
    expectsCount: false,
  },
  {
    station: STATION_BACK_LINE_OPEN,
    label: "Fryer up to temp",
    labelEs: "Freidora a temperatura",
    expectsCount: false,
  },
  {
    station: STATION_BACK_LINE_OPEN,
    label: "Back-line drinks fridge holding temp (≤41°F)",
    labelEs: "Refri de bebidas de la línea trasera a temperatura (≤41°F)",
    expectsCount: true,
  },

  // Station 7: Expo Station (27-30)
  {
    station: STATION_EXPO,
    label: "Cannoli pan stocked & dated correctly",
    labelEs: "Bandeja de cannoli surtida y fechada correctamente",
    expectsCount: false,
  },
  {
    station: STATION_EXPO,
    label: "Deli display fridge holding temp (≤41°F)",
    labelEs: "Refri de exhibición de fiambres a temperatura (≤41°F)",
    expectsCount: true,
  },
  {
    station: STATION_EXPO,
    label: "Cookies & gluten-free items in place",
    labelEs: "Galletas y artículos sin gluten en su lugar",
    expectsCount: false,
  },
  {
    station: STATION_EXPO,
    label: "Expo lights on, ticket printer ready (paper loaded)",
    labelEs: "Luces de expo encendidas, impresora de tickets lista (con papel)",
    expectsCount: false,
  },

  // Station 8: Front of House Open (31-35)
  {
    station: STATION_FOH_OPEN,
    label: "Bathrooms clean & stocked",
    labelEs: "Baños limpios y abastecidos",
    expectsCount: false,
  },
  {
    station: STATION_FOH_OPEN,
    label: "Front of house clean as reported (no debris from prior service)",
    labelEs: "Frente limpio como se reportó (sin restos del servicio anterior)",
    expectsCount: false,
  },
  {
    station: STATION_FOH_OPEN,
    label: "FOH drinks fridge holding temp (≤41°F)",
    labelEs: "Refri de bebidas del frente a temperatura (≤41°F)",
    expectsCount: true,
  },
  {
    station: STATION_FOH_OPEN,
    label: "Music on, dining lights on, A/C set to service temp",
    labelEs:
      "Música encendida, luces del comedor encendidas, A/C en temperatura de servicio",
    expectsCount: false,
  },
  {
    station: STATION_FOH_OPEN,
    label: "Front doors unlocked",
    labelEs: "Puertas de entrada destrabadas",
    expectsCount: false,
  },

  // Station 9: Manager Open (36-38)
  {
    station: STATION_MANAGER_OPEN,
    label: "AM Prep List from last night exists and is reviewable",
    labelEs: "La Lista de Prep AM de anoche existe y se puede revisar",
    expectsCount: false,
  },
  {
    station: STATION_MANAGER_OPEN,
    label: "Cash drawer counted in",
    labelEs: "Caja registradora contada al inicio",
    expectsCount: false,
  },
  {
    station: STATION_MANAGER_OPEN,
    label: "POS opened for service",
    labelEs: "POS abierto para servicio",
    expectsCount: false,
  },

  // Station 10: Walk-Out Verification (39-43) — same station name as closing
  {
    station: STATION_WALK_OUT,
    label: "Alarm was armed on arrival (no overnight callout, system shows armed)",
    labelEs:
      "Alarma estaba activada al llegar (sin aviso nocturno, sistema muestra activado)",
    expectsCount: false,
  },
  {
    station: STATION_WALK_OUT,
    label: "Back door was locked on arrival",
    labelEs: "Puerta trasera estaba con seguro al llegar",
    expectsCount: false,
  },
  {
    station: STATION_WALK_OUT,
    label: "Front doors were locked on arrival",
    labelEs: "Puertas de entrada estaban con seguro al llegar",
    expectsCount: false,
  },
  {
    station: STATION_WALK_OUT,
    label: "Oven was off on arrival",
    labelEs: "Horno estaba apagado al llegar",
    expectsCount: false,
  },
  {
    station: STATION_WALK_OUT,
    label: "Devices were charging on arrival",
    labelEs: "Dispositivos estaban cargando al llegar",
    expectsCount: false,
  },
];

// ---------------------------------------------------------------------------
// Defensive assertions
// ---------------------------------------------------------------------------

if (OPENING_ITEMS.length !== 44) {
  throw new Error(
    `seed-opening-template-v1: expected 44 items, got ${OPENING_ITEMS.length}`,
  );
}

const tempCount = OPENING_ITEMS.filter((it) => it.expectsCount).length;
if (tempCount !== 8) {
  throw new Error(
    `seed-opening-template-v1: expected 8 fridge temp items (expects_count=true), got ${tempCount}`,
  );
}

// Q6 (Build #3 PR 2 review): catch PR 3 Phase 2 items adding expects_count
// items that overlap an existing temp station. The 8 fridge temp items must
// come from 8 DISTINCT stations (one per fridge, one per station). Overlap
// = a fridge has two temp items, OR a station has multiple fridges (not the
// operational reality per CO's 8-fridge inventory).
const stationsWithTemps = new Set(
  OPENING_ITEMS.filter((it) => it.expectsCount).map((it) => it.station),
);
if (stationsWithTemps.size !== 8) {
  throw new Error(
    `seed-opening-template-v1: expected 8 distinct stations with temp items, got ${stationsWithTemps.size} ` +
      `(stations with temps: ${[...stationsWithTemps].join(", ")})`,
  );
}

// ---------------------------------------------------------------------------
// Translation builder
// ---------------------------------------------------------------------------

function buildOpeningTranslations(
  item: OpeningSeedItem,
): ChecklistTemplateItemTranslations {
  return {
    es: {
      label: item.labelEs,
      station: STATION_ES[item.station] ?? item.station,
    },
  };
}

// ---------------------------------------------------------------------------
// Sync helpers
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
  report_reference_type: string | null;
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

  for (let i = 0; i < OPENING_ITEMS.length; i++) {
    const spec = OPENING_ITEMS[i];
    if (!spec) continue;
    const existing = existingByDisplayOrder.get(i);

    const desiredLabel = spec.label;
    const desiredStation = spec.station;
    const desiredDescription: string | null = null;
    const desiredMinRoleLevel = 3;
    const desiredRequired = true;
    const desiredExpectsCount = spec.expectsCount;
    const desiredExpectsPhoto = false;
    const desiredReportRefType: string | null = null;
    const desiredTranslations = buildOpeningTranslations(spec);

    if (!existing) {
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
    .eq("type", "opening")
    .eq("name", TEMPLATE_NAME)
    .maybeSingle<{ id: string; name: string; active: boolean }>();
  if (existErr) {
    throw new Error(
      `pre-flight checklist_templates check failed for location ${locationId}: ${existErr.message}`,
    );
  }

  // SYNC PATH — template exists (re-run or PR 3 additive items).
  if (existing) {
    const { itemCount, changes } = await syncItemsForTemplate(
      sb,
      locationId,
      existing.id,
    );

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

    // ⚠️ AUDIT METADATA CONTEXT: when re-running this seed in a new PR
    // context, update the `phase` and `reason` strings below.
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
          phase: "3_build_3_pr_2",
          reason:
            "Standard Opening v1 — Phase 1 verification template sync (re-run or PR 3 Phase 2 items)",
          sync_method: "seed_script",
          script_path: "scripts/seed-opening-template-v1.ts",
          location_id: locationId,
          template_name: TEMPLATE_NAME,
          template_type: "opening",
          changed_item_count: changes.length,
          changes: changes.map((c) => ({
            template_item_id: c.templateItemId,
            display_order: c.displayOrder,
            changed_fields: c.changedFields,
          })),
          languages_populated: ["es"],
          spec_amendments_referenced: ["C.37", "C.38", "C.42", "C.49"],
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

  // CREATE PATH — fresh seed; template doesn't exist yet.
  const { data: tmplRow, error: tmplErr } = await sb
    .from("checklist_templates")
    .insert({
      location_id: locationId,
      type: "opening",
      name: TEMPLATE_NAME,
      description: TEMPLATE_DESCRIPTION,
      active: true,
      single_submission_only: true, // mirrors AM Prep; locks on submit
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
    throw new Error(
      `checklist_templates insert returned no row for location ${locationId}`,
    );
  }
  const templateId = tmplRow.id;

  const itemRows = OPENING_ITEMS.map((it, idx) => ({
    template_id: templateId,
    station: it.station,
    display_order: idx,
    label: it.label,
    description: null,
    min_role_level: 3,
    required: true,
    expects_count: it.expectsCount,
    expects_photo: false,
    vendor_item_id: null,
    active: true,
    translations: buildOpeningTranslations(it),
    prep_meta: null,
    report_reference_type: null,
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
  if ((count ?? 0) !== OPENING_ITEMS.length) {
    throw new Error(
      `post-insert verify: expected ${OPENING_ITEMS.length} items for template ${templateId}, got ${count ?? 0}`,
    );
  }

  // CREATE-path audit. checklist_template.create is in DESTRUCTIVE_ACTIONS;
  // destructive=true set explicitly (SQL-side INSERT can't rely on JS-side
  // audit() helper auto-derive).
  // ⚠️ AUDIT METADATA CONTEXT: see marker comment in header.
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
        phase: "3_build_3_pr_2",
        reason:
          "Standard Opening v1 — Phase 1 Verification Checklist seed (44 items, 10 stations, 8 fridge temp checks); cross-template auto-completion target via closing v2's 'Opening verified' item (C.49 + C.42)",
        creation_method: "seed_script",
        script_path: "scripts/seed-opening-template-v1.ts",
        location_id: locationId,
        template_name: TEMPLATE_NAME,
        template_type: "opening",
        item_count: OPENING_ITEMS.length,
        fridge_temp_count: tempCount,
        cross_reference_target:
          "closing v2's 'Opening verified' item (C.49 addition; report_reference_type='opening' triggers C.42 auto-completion mechanic when this template's instance submits)",
        single_submission_only: true,
        languages_populated: ["es"],
        spec_amendments_referenced: ["C.37", "C.38", "C.42", "C.49"],
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
    itemCount: OPENING_ITEMS.length,
    outcome: "created",
    changes: [],
    auditRowId: auditRow.id,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
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
    `seed-opening-template-v1: ${OPENING_ITEMS.length} items per location across MEP + EM ` +
      `(${tempCount} fridge temp checks, ${stationsWithTemps.size} distinct temp-bearing stations)\n`,
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

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
