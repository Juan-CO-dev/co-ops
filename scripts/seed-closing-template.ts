/**
 * Seed: Standard Closing v1 — Module #1 Build #1 closing checklist template.
 *
 * Source: Image 6 paper closing checklist (Crunchy Boi / Walk Ins / Shut Down
 * Back Line / Clean front of house / 3rd Party Station / Prep Fridge / Expo
 * Station / Prep Area / Closing Manager) plus three operational additions
 * surfaced by Juan during transcription:
 *   - Walk-in temp log (cooler temperature in F) — health-code prep, walk-in
 *     only for v1; other units defer to Build #2's template v2 if Cristian's
 *     usage flags them or an inspector / incident forces it. See SPEC_
 *     AMENDMENTS.md C.19.
 *   - Trash to dumpster — explicit line item in Prep Area (was an unspoken
 *     assumption on paper).
 *   - Walk-Out Verification station — five items splitting the paper footer
 *     line ("Lights are off, devices are charging, oven is off, doors are
 *     locked") plus a separate back-door item.
 *
 * Template versioning per SPEC_AMENDMENTS.md C.19: name-suffix + active flag
 * (Path A). This seed inserts "Standard Closing v1" with active=true. Build
 * #2 will insert "Standard Closing v2" with active=true and flip v1 to
 * active=false. Old checklist_instances retain their FK to v1; new instances
 * FK to v2. No schema change to checklist_templates (honors §2.10 foundation
 * schema lock).
 *
 * Single shared template across both locations: per the locked Module #1 seed
 * decision (operational reality is consistent across MEP and EM per Juan).
 * The schema is per-location (UNIQUE(location_id, type, name)) so we insert
 * two rows in checklist_templates (one per location) with identical name +
 * description, and clone the items into each.
 *
 * Per-item defaults (override only where called out below):
 *   - min_role_level = 4 (key_holder)
 *   - required = true
 *   - expects_count = false
 *   - expects_photo = false
 *   - vendor_item_id = null
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/seed-closing-template.ts
 *
 * Convergent semantics: re-running the script converges the database to the
 * spec encoded in ITEMS below. On first run for a location, creates the
 * template + items + audit. On re-run with a pre-existing template, syncs
 * each item by display_order — updates label / role / required / count /
 * photo / station / description fields where they differ from the spec.
 * Net-no-change re-runs emit no audit row; net-with-changes re-runs emit a
 * single `checklist_template.update` audit row per location summarizing the
 * changes.
 *
 * The convergent path replaces an earlier idempotency-by-skip approach
 * (which was safe for partial-success recovery but couldn't propagate
 * spec edits). Build #1 hasn't shipped to real users yet — updating
 * existing template_items in place is correct; full template versioning
 * via name suffix + active flag (per SPEC_AMENDMENTS.md C.19, Path A)
 * isn't justified at this stage since there are no historical instances
 * to preserve.
 *
 * Items are matched by `display_order` (stable across renames). If a
 * future spec edit changes the count or order of items, the sync path
 * inserts new ones and leaves removed ones in place — operators must
 * deactivate removed items via the admin tool when it ships, or via a
 * dedicated cleanup script. Build #1's spec edits are field-level only
 * (label/role/description), so this sync handles them cleanly.
 *
 * Per §6.2 audit-doc discipline: every service-role write destructures
 * { error } and throws on error. Audit row written to audit_log under action
 * 'checklist_template.create' (canonical, on DESTRUCTIVE_ACTIONS list per
 * lib/destructive-actions.ts) with metadata explaining the seed origin.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Juan's user_id — actor for the audit rows. Stable since Phase 1 seed.
const JUAN_USER_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";

// Location ids supplied by Juan from the provisioning spec (matches
// scripts/phase-2.5-provision-temp-users.ts).
const LOCATION_MEP = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a";
const LOCATION_EM = "d2cced11-b167-49fa-bab6-86ec9bf4ff09";

const TEMPLATE_NAME = "Standard Closing v1";
const TEMPLATE_DESCRIPTION =
  "End-of-shift closing checklist (Build #1 — cleaning phase only). " +
  "AM Prep List generation lands in Build #2 via Standard Closing v2 " +
  "(template versioning per SPEC_AMENDMENTS.md C.19).";

// ---------------------------------------------------------------------------
// Spanish translation maps (per SPEC_AMENDMENTS.md C.38).
//
// Keyed by the original (English) string so a label/station change in ITEMS
// requires the same change in these maps. Idempotent: the seed sync re-
// computes the JSONB translations blob from these lookups every run; a map
// edit re-runs cleanly. Unknown labels/stations/descriptions fall through
// to the en source-of-truth (resolver returns the original column value).
//
// Operational/practical Spanish per C.31 — tú-form imperatives, restaurant
// frontline staff audience. Juan smoke-tests post-merge.
// ---------------------------------------------------------------------------

const STATION_ES: Record<string, string> = {
  "Crunchy Boi Station": "Estación Crunchy Boi",
  "3rd Party Station": "Estación de terceros",
  "Walk Ins station": "Estación walk-ins",
  "Prep Fridge": "Refri de prep",
  "Shut Down Back Line": "Apagar línea trasera",
  "Expo Station": "Estación Expo",
  "Clean front of house": "Limpiar el frente",
  "Prep Area": "Área de prep",
  "Closing Manager": "Gerente de cierre",
  "Walk-Out Verification": "Verificación de salida",
};

const LABEL_ES: Record<string, string> = {
  Restock: "Reabastecer",
  "Wipe inside & outside": "Limpiar adentro y afuera",
  "Wipe tops of sauce bottles": "Limpiar tapas de salsas",
  "Combine & check dates on sauces": "Combinar y revisar fechas de salsas",
  "Pull out station and sweep": "Sacar estación y barrer",
  "Walk-in temp log": "Registro de temperatura del walk-in",
  "Wipe down burners": "Limpiar quemadores",
  "Wipe down tile walls": "Limpiar paredes de azulejo",
  "Wipe wall under prep tables": "Limpiar pared bajo las mesas de prep",
  "Change & stock cannoli pan": "Cambiar y surtir bandeja de cannoli",
  "Wipe out sides fridge": "Limpiar el lateral del refrigerador",
  "Restock bevs": "Reabastecer bebidas",
  "Cookies & gluten free": "Galletas y gluten free",
  Bathrooms: "Baños",
  "Patio furniture": "Muebles del patio",
  Sweep: "Barrer",
  Mop: "Trapear",
  "Restock bev fridge": "Reabastecer refri de bebidas",
  "Put away / organize cases": "Guardar y organizar cajas",
  "Organize Back Walk In": "Organizar walk-in trasero",
  "Clean Oven Window": "Limpiar vidrio del horno",
  "Organize Smallwares & Utensils": "Organizar utensilios pequeños",
  "Organize Dry Storage": "Organizar almacén seco",
  "Wipe down 3 door fridge": "Limpiar refri de 3 puertas",
  "Wipe out 3 bay sink": "Limpiar fregadero de 3 compartimientos",
  "Drain & turn off dish Machine": "Drenar y apagar el lavaplatos",
  "Trash to dumpster": "Basura al contenedor",
  "Count the drawer": "Contar la caja",
  "Count and secure tips": "Contar y guardar propinas",
  "Fill out AM Prep List": "Llenar lista de prep AM",
  "Lights off": "Luces apagadas",
  "Devices charging": "Dispositivos cargando",
  "Oven off": "Horno apagado",
  "Front doors locked": "Puertas de enfrente cerradas con llave",
  "Back door locked": "Puerta trasera cerrada con llave",
};

const DESCRIPTION_ES: Record<string, string> = {
  "Record cooler temp in Fahrenheit": "Anotar temperatura del walk-in en Fahrenheit",
  "Count tips, place in safe. Weekly distribution handled separately by AGM+.":
    "Contar propinas y guardarlas en la caja fuerte. La distribución semanal la maneja AGM+ aparte.",
  "Placeholder for paper continuation; evolves to Phase 2 trigger in Build #2 via template versioning (Standard Closing v2 omits this item). See SPEC_AMENDMENTS.md C.19.":
    "Marcador de transición del papel; evoluciona en Build #2 vía versión de plantilla (Standard Closing v2 elimina este ítem). Ver SPEC_AMENDMENTS.md C.19.",
};

/**
 * Builds the translations JSONB blob for a SeedItem. Returns null when no
 * Spanish translations are available for any of the item's user-facing
 * fields — the column stays NULL and the resolver falls through to en.
 *
 * Partial coverage is honest: only fields with translations get keys; missing
 * fields fall through to the en column at render time. So a label without a
 * Spanish equivalent + a station with one yields { es: { station: "..." } },
 * which renders Spanish station header + English label. Better than forcing
 * a placeholder English string into the Spanish bucket.
 */
function buildTranslations(item: SeedItem): { es: Record<string, string> } | null {
  const labelEs = LABEL_ES[item.label];
  const stationEs = item.station ? STATION_ES[item.station] : undefined;
  const descEs = item.notes ? DESCRIPTION_ES[item.notes] : undefined;

  const esEntry: Record<string, string> = {};
  if (labelEs) esEntry.label = labelEs;
  if (stationEs) esEntry.station = stationEs;
  if (descEs) esEntry.description = descEs;

  if (Object.keys(esEntry).length === 0) return null;
  return { es: esEntry };
}

// ---------------------------------------------------------------------------
// Item registry. Order matters: physical-flow order through the kitchen.
// Stations render in the order they appear here; items within a station
// render in the order listed here (mapped to display_order at insert time).
// ---------------------------------------------------------------------------

interface SeedItem {
  station: string;
  label: string;
  /** override defaults; omit for defaults (role=4, required=true, no count/photo) */
  minRoleLevel?: number;
  required?: boolean;
  expectsCount?: boolean;
  expectsPhoto?: boolean;
  /** notes column on checklist_template_items.description */
  notes?: string;
}

const ITEMS: SeedItem[] = [
  // Crunchy Boi Station
  { station: "Crunchy Boi Station", label: "Restock" },
  { station: "Crunchy Boi Station", label: "Wipe inside & outside" },
  { station: "Crunchy Boi Station", label: "Wipe tops of sauce bottles" },
  { station: "Crunchy Boi Station", label: "Combine & check dates on sauces" },
  { station: "Crunchy Boi Station", label: "Pull out station and sweep" },

  // 3rd Party Station
  { station: "3rd Party Station", label: "Restock" },
  { station: "3rd Party Station", label: "Wipe inside & outside" },
  { station: "3rd Party Station", label: "Wipe tops of sauce bottles" },
  { station: "3rd Party Station", label: "Combine & check dates on sauces" },
  { station: "3rd Party Station", label: "Pull out station and sweep" },

  // Walk Ins station — includes the temp log addition (option a per
  // operational decision: only walk-in is formally tracked in v1; other
  // units defer to Build #2's template v2 if they surface).
  { station: "Walk Ins station", label: "Restock" },
  { station: "Walk Ins station", label: "Wipe inside & outside" },
  { station: "Walk Ins station", label: "Wipe tops of sauce bottles" },
  { station: "Walk Ins station", label: "Combine & check dates on sauces" },
  { station: "Walk Ins station", label: "Pull out station and sweep" },
  {
    station: "Walk Ins station",
    label: "Walk-in temp log",
    expectsCount: true,
    notes: "Record cooler temp in Fahrenheit",
  },

  // Prep Fridge
  { station: "Prep Fridge", label: "Restock" },
  { station: "Prep Fridge", label: "Wipe inside & outside" },
  { station: "Prep Fridge", label: "Wipe tops of sauce bottles" },
  { station: "Prep Fridge", label: "Combine & check dates on sauces" },
  { station: "Prep Fridge", label: "Pull out station and sweep" },

  // Shut Down Back Line
  { station: "Shut Down Back Line", label: "Wipe down burners" },
  { station: "Shut Down Back Line", label: "Wipe down tile walls" },
  { station: "Shut Down Back Line", label: "Wipe wall under prep tables" },

  // Expo Station
  { station: "Expo Station", label: "Change & stock cannoli pan" },
  { station: "Expo Station", label: "Wipe out sides fridge" },
  { station: "Expo Station", label: "Restock bevs" },
  { station: "Expo Station", label: "Cookies & gluten free" },

  // Clean front of house
  { station: "Clean front of house", label: "Bathrooms" },
  { station: "Clean front of house", label: "Patio furniture" },
  { station: "Clean front of house", label: "Sweep" },
  { station: "Clean front of house", label: "Mop" },
  { station: "Clean front of house", label: "Restock bev fridge" },
  { station: "Clean front of house", label: "Put away / organize cases" },

  // Prep Area — includes "Trash to dumpster" addition.
  { station: "Prep Area", label: "Organize Back Walk In" },
  { station: "Prep Area", label: "Clean Oven Window" },
  { station: "Prep Area", label: "Organize Smallwares & Utensils" },
  { station: "Prep Area", label: "Organize Dry Storage" },
  { station: "Prep Area", label: "Wipe down 3 door fridge" },
  { station: "Prep Area", label: "Wipe out 3 bay sink" },
  { station: "Prep Area", label: "Drain & turn off dish Machine" },
  { station: "Prep Area", label: "Trash to dumpster" },

  // Closing Manager — pre-locked role overrides per Juan's spec.
  { station: "Closing Manager", label: "Count the drawer" },
  {
    station: "Closing Manager",
    label: "Count and secure tips",
    notes:
      "Count tips, place in safe. Weekly distribution handled separately by AGM+.",
    // Pass-1 testing correction (was role 5 / "Split up Tips"): end-of-shift
    // tips action is KH+ — count and secure. Weekly tip distribution is the
    // AGM+ action and happens separately, not during closing.
  },
  {
    station: "Closing Manager",
    label: "Fill out AM Prep List",
    notes:
      "Placeholder for paper continuation; evolves to Phase 2 trigger in " +
      "Build #2 via template versioning (Standard Closing v2 omits this " +
      "item). See SPEC_AMENDMENTS.md C.19.",
  },

  // Walk-Out Verification — new station splitting the paper footer line into
  // discrete attestable items + the back-door addition.
  { station: "Walk-Out Verification", label: "Lights off" },
  { station: "Walk-Out Verification", label: "Devices charging" },
  { station: "Walk-Out Verification", label: "Oven off" },
  { station: "Walk-Out Verification", label: "Front doors locked" },
  { station: "Walk-Out Verification", label: "Back door locked" },
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
  translations: Record<string, unknown> | null;
}

/**
 * Stable JSON comparison for the translations JSONB blob. Sorts keys at
 * each level so re-runs don't churn on key-order differences. Matches the
 * Postgres JSONB equality semantics (which are key-order-independent at the
 * storage layer but the JS `JSON.stringify` is not).
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

async function syncItemsForTemplate(
  sb: SupabaseClient,
  locationId: string,
  templateId: string,
): Promise<{ itemCount: number; changes: ItemChange[] }> {
  const { data: existingRows, error: readErr } = await sb
    .from("checklist_template_items")
    .select(
      "id, station, display_order, label, description, min_role_level, required, expects_count, expects_photo, active, translations",
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
    const desiredStation = spec.station;
    const desiredDescription = spec.notes ?? null;
    const desiredMinRoleLevel = spec.minRoleLevel ?? 4;
    const desiredRequired = spec.required ?? true;
    const desiredExpectsCount = spec.expectsCount ?? false;
    const desiredExpectsPhoto = spec.expectsPhoto ?? false;

    const desiredTranslations = buildTranslations(spec);

    if (!existing) {
      // Insert a new item at this display_order.
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
    // Translations diff via stable JSON comparison (per SPEC_AMENDMENTS.md
    // C.38). null === null is no-op; either-side-null with the other set
    // triggers an update; both-set runs through stableStringify so re-runs
    // don't churn on key-order differences.
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
    .eq("type", "closing")
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

    // Audit the sync. `checklist_template.update` is non-destructive
    // (auto-derives destructive=false) and follows the Phase 2 free-form
    // non-destructive vocabulary pattern. Translations-specific forensic
    // detail per SPEC_AMENDMENTS.md C.38 wet-run requirements.
    const translationsChangedCount = changes.filter((c) =>
      c.changedFields.includes("translations"),
    ).length;
    const translationsChangedItemIds = changes
      .filter((c) => c.changedFields.includes("translations"))
      .map((c) => ({ template_item_id: c.templateItemId, display_order: c.displayOrder }));
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
          phase: "3_module_1_build_1.5_pr_5c",
          reason: "seed sync — convergent re-run propagating spec edits",
          sync_method: "seed_script",
          script_path: "scripts/seed-closing-template.ts",
          location_id: locationId,
          template_name: TEMPLATE_NAME,
          changed_item_count: changes.length,
          changes: changes.map((c) => ({
            template_item_id: c.templateItemId,
            display_order: c.displayOrder,
            changed_fields: c.changedFields,
          })),
          // Translations-specific forensic summary (per C.38).
          translations_changed_count: translationsChangedCount,
          translations_changed_items: translationsChangedItemIds,
          languages_populated: ["es"],
          spec_amendments_referenced: ["C.38"],
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

  // Insert the template row.
  const { data: tmplRow, error: tmplErr } = await sb
    .from("checklist_templates")
    .insert({
      location_id: locationId,
      type: "closing",
      name: TEMPLATE_NAME,
      description: TEMPLATE_DESCRIPTION,
      active: true,
      // closing is NOT single_submission_only (per spec §4.3 + the literal
      // column comment "For 'prep' templates this is true. For 'opening' /
      // 'closing' this is false."). Multi-submission is the closing default.
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

  // Build the items batch. display_order is the index within ITEMS, not
  // within station — keeps physical-flow order intact across stations.
  const itemRows = ITEMS.map((it, idx) => ({
    template_id: templateId,
    station: it.station,
    display_order: idx,
    label: it.label,
    description: it.notes ?? null,
    min_role_level: it.minRoleLevel ?? 4,
    required: it.required ?? true,
    expects_count: it.expectsCount ?? false,
    expects_photo: it.expectsPhoto ?? false,
    vendor_item_id: null,
    active: true,
    translations: buildTranslations(it),
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
  if ((count ?? 0) !== ITEMS.length) {
    throw new Error(
      `post-insert verify: expected ${ITEMS.length} items for template ${templateId}, got ${count ?? 0}`,
    );
  }

  // Audit. checklist_template.create is the canonical action
  // (lib/destructive-actions.ts); auto-derives destructive=true.
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
        phase: "3_module_1_build_1",
        reason: "Module #1 Build #1 closing template seed",
        creation_method: "seed_script",
        script_path: "scripts/seed-closing-template.ts",
        location_id: locationId,
        template_name: TEMPLATE_NAME,
        item_count: ITEMS.length,
        // Translations-specific forensic summary (per C.38). Counts items
        // where buildTranslations() returned non-null at create time.
        translations_populated_count: ITEMS.filter((it) => buildTranslations(it) !== null)
          .length,
        languages_populated: ["es"],
        spec_amendments_referenced: ["C.18", "C.19", "C.20", "C.38"],
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
    `seed-closing-template: ${ITEMS.length} items per location across MEP + EM\n`,
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
