/**
 * Seed: Standard Opening v1 — Phase 2 prep verification additions (Build #3 PR 3).
 *
 * 34 in-place additive INSERTs per location (MEP + EM applied identically).
 * Each Phase 2 item mirrors a numeric AM Prep item per locked Surface A:
 *   - Section: AM Prep section name (Veg / Cooks / Sides / Sauces / Slicing)
 *   - Label: exact mirror of AM Prep label per locked Q2 (system-key discipline
 *     per C.38 — "Basil" stays "Basil")
 *   - references_template_item_id: per-location FK to the matching AM Prep
 *     template item (added in migration 0049). Per locked Q3, the lookup
 *     fails LOUDLY if the AM Prep counterpart is missing — silent NULL FK
 *     ships a 5x-undercount-class bug back to production.
 *   - prep_meta: OpeningPhase2Meta shape per locked Q4 — { openingPhase2:
 *     true, section, parValue (mirrored from AM Prep), parUnit (mirrored) }.
 *     parValue + parUnit are mirrored at seed time as FALLBACK display when
 *     no closer-estimate snapshot resolves; runtime over/under-par signal
 *     uses CloserEstimateSnapshot.parValue (AM Prep snapshot's frozen par
 *     per C.44). Tomato (parValue=null) flows through the same path — form
 *     mechanics handles null-par gracefully.
 *
 * Display order layout (per locked Sub-decision 2 — loose spacing,
 * 11+ slots per section headroom):
 *   - Veg:     100-105 (6 items)
 *   - Cooks:   120-124 (5 items)
 *   - Sides:   140-145 (6 items)
 *   - Sauces:  160-167 (8 items)
 *   - Slicing: 180-188 (9 items)
 *
 * Idempotency (SYNC pattern matching scripts/seed-closing-template-v2-c49-
 * additions.ts precedent):
 *   - lookup-by-(opening_template_id, station, label) → if found, check
 *     par drift; if drift, UPDATE prep_meta (preserving id) + emit forensic
 *     audit; else no-op
 *   - else INSERT with full prep_meta + translations + references_template_item_id
 *
 * Outcomes per item:
 *   - inserted                       — first-run INSERT
 *   - noop_already_present           — re-run, par matches AM Prep
 *   - par_updated                    — re-run, par drift detected, UPDATE landed
 *   - warning_state_diverged         — unexpected mid-state, surfaced for review
 *   - error_amprep_lookup_failed     — fail-loudly per Q3; the seed aborts the
 *                                      run for this location to prevent silent
 *                                      NULL FK; manual reconciliation needed
 *
 * Audit emission convention (per AGENTS.md):
 *   - One audit row per location, fired only when at least one INSERT or
 *     par_updated landed
 *   - actor_id: Juan; actor_role: 'cgs'
 *   - action: 'checklist_template.update' (destructive=false)
 *   - metadata captures: inserts array (item-level), par_updates array
 *     (with previous_par + new_par per locked Q4 forensic refinement),
 *     warnings array, lookup_failures array
 *
 * ⚠️ AUDIT METADATA CONTEXT MARKER ⚠️
 * If you re-run this script in a NEW PR context, update the `phase` and
 * `reason` strings inside applyToLocation() BEFORE running. These strings
 * are NOT auto-derived from git context; failure to update propagates stale
 * attribution into production audit_log and requires an
 * `audit.metadata_correction` row to remediate (see AGENTS.md durable
 * lesson "Audit metadata context attribution in seed scripts").
 *
 * Run:
 *   # Both locations (default):
 *   npx tsx --env-file=.env.local scripts/seed-opening-phase2-additions.ts
 *   # MEP only (smaller blast radius for first-run verification):
 *   npx tsx --env-file=.env.local scripts/seed-opening-phase2-additions.ts --location MEP
 *   # EM only:
 *   npx tsx --env-file=.env.local scripts/seed-opening-phase2-additions.ts --location EM
 */

import { pathToFileURL } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  ChecklistTemplateItemTranslations,
  OpeningPhase2Meta,
  PrepSection,
} from "../lib/types";

// Juan's user_id — actor for audit rows. Stable since Phase 1 seed.
const JUAN_USER_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";

const LOCATION_MEP = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a";
const LOCATION_EM = "d2cced11-b167-49fa-bab6-86ec9bf4ff09";

const OPENING_TEMPLATE_NAME = "Standard Opening v1";
const AM_PREP_TEMPLATE_NAME = "Standard AM Prep v1";

// ---------------------------------------------------------------------------
// Spanish translation maps (lifted from scripts/seed-am-prep-template.ts for
// operational copy consistency at the moment of Phase 2 lock; per locked
// Sub-decision 3, Phase 2 ES copy is locked at this seed and won't auto-update
// if AM Prep ES labels evolve. If divergence becomes problematic, a separate
// Phase 2 seed run can reconcile.
//
// Operational/practical Spanish per C.31. Unit abbreviations (QT, BTL, BAG,
// LOGS, "1/3 pan", "min") stay English by design (kitchen jargon).
// ---------------------------------------------------------------------------

const STATION_ES: Partial<Record<PrepSection, string>> = {
  Veg: "Verduras",
  Cooks: "Cocidos",
  Sides: "Acompañantes",
  Sauces: "Salsas",
  Slicing: "Rebanado",
  // Misc intentionally omitted — Phase 2 scopes-out Misc YES/NO items
  // per Surface A.
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
};

// ---------------------------------------------------------------------------
// Spec type + ITEMS registry
//
// SeedPhase2Item carries ONLY lookup keys (section + amPrepLabel) +
// display_order. parValue and parUnit are read from the live AM Prep template
// at seed runtime via buildAmPrepLookup() — single source of truth for par
// state, no spec-vs-production drift risk.
// ---------------------------------------------------------------------------

interface SeedPhase2Item {
  section: PrepSection;
  /** Exact mirror of AM Prep label per Q2; also the lookup key for the AM Prep counterpart. */
  amPrepLabel: string;
  /** Per Sub-decision 2: section-aligned 100-188 layout with 20-slot gaps. */
  displayOrder: number;
}

const ITEMS: SeedPhase2Item[] = [
  // Veg (100-105)
  { section: "Veg", amPrepLabel: "Iceberg", displayOrder: 100 },
  { section: "Veg", amPrepLabel: "Onion", displayOrder: 101 },
  { section: "Veg", amPrepLabel: "Basil", displayOrder: 102 },
  { section: "Veg", amPrepLabel: "Radish", displayOrder: 103 },
  { section: "Veg", amPrepLabel: "Cucumber", displayOrder: 104 },
  { section: "Veg", amPrepLabel: "Tomato", displayOrder: 105 },

  // Cooks (120-124)
  { section: "Cooks", amPrepLabel: "Vodka", displayOrder: 120 },
  { section: "Cooks", amPrepLabel: "Marinara", displayOrder: 121 },
  { section: "Cooks", amPrepLabel: "Compound Butter", displayOrder: 122 },
  { section: "Cooks", amPrepLabel: "Caramelized onion", displayOrder: 123 },
  { section: "Cooks", amPrepLabel: "Jus", displayOrder: 124 },

  // Sides (140-145)
  { section: "Sides", amPrepLabel: "Tuna Salad", displayOrder: 140 },
  { section: "Sides", amPrepLabel: "Egg Salad", displayOrder: 141 },
  { section: "Sides", amPrepLabel: "Onion Dip", displayOrder: 142 },
  { section: "Sides", amPrepLabel: "Chix Salad", displayOrder: 143 },
  { section: "Sides", amPrepLabel: "Antipasto Pasta", displayOrder: 144 },
  { section: "Sides", amPrepLabel: "Cannoli Cream", displayOrder: 145 },

  // Sauces (160-167)
  { section: "Sauces", amPrepLabel: "Aioli", displayOrder: 160 },
  { section: "Sauces", amPrepLabel: "HC Aioli", displayOrder: 161 },
  { section: "Sauces", amPrepLabel: "HP Mayo", displayOrder: 162 },
  { section: "Sauces", amPrepLabel: "Mustard Aioli", displayOrder: 163 },
  { section: "Sauces", amPrepLabel: "Horsey Mayo", displayOrder: 164 },
  { section: "Sauces", amPrepLabel: "Salsa Verde", displayOrder: 165 },
  { section: "Sauces", amPrepLabel: "Dukes", displayOrder: 166 },
  { section: "Sauces", amPrepLabel: "Vin", displayOrder: 167 },

  // Slicing (180-188)
  { section: "Slicing", amPrepLabel: "Turkey", displayOrder: 180 },
  { section: "Slicing", amPrepLabel: "Ham", displayOrder: 181 },
  { section: "Slicing", amPrepLabel: "Capicola", displayOrder: 182 },
  { section: "Slicing", amPrepLabel: "Pepperoni", displayOrder: 183 },
  { section: "Slicing", amPrepLabel: "Genoa", displayOrder: 184 },
  { section: "Slicing", amPrepLabel: "Provolone", displayOrder: 185 },
  { section: "Slicing", amPrepLabel: "Mortadella", displayOrder: 186 },
  { section: "Slicing", amPrepLabel: "Roast Beef", displayOrder: 187 },
  { section: "Slicing", amPrepLabel: "Cheddar", displayOrder: 188 },
];

// Defensive: every spec at a unique displayOrder.
{
  const seen = new Set<number>();
  for (const it of ITEMS) {
    if (seen.has(it.displayOrder)) {
      throw new Error(
        `seed-opening-phase2-additions: duplicate displayOrder ${it.displayOrder}`,
      );
    }
    seen.add(it.displayOrder);
  }
  if (ITEMS.length !== 34) {
    throw new Error(
      `seed-opening-phase2-additions: expected 34 items, got ${ITEMS.length}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Outcome + result types
// ---------------------------------------------------------------------------

type Outcome =
  | "inserted"
  | "noop_already_present"
  | "par_updated"
  | "warning_state_diverged"
  | "error_amprep_lookup_failed";

interface ItemResult {
  spec: SeedPhase2Item;
  outcome: Outcome;
  templateItemId: string | null;
  amPrepTemplateItemId: string | null;
  /** Set on par_updated outcome; previous parValue from existing prep_meta. */
  previousPar?: number | null;
  /** Set on par_updated outcome; new parValue mirrored from AM Prep. */
  newPar?: number | null;
  warning?: string;
  error?: string;
}

interface LocationResult {
  locationId: string;
  locationCode: string;
  openingTemplateId: string;
  amPrepTemplateId: string;
  items: ItemResult[];
  auditRowId: string | null;
  /** True when fail-loudly aborted the location run mid-way. */
  aborted: boolean;
}

// ---------------------------------------------------------------------------
// Translation builder
// ---------------------------------------------------------------------------

function buildTranslations(spec: SeedPhase2Item): ChecklistTemplateItemTranslations | null {
  const labelEs = LABEL_ES[spec.amPrepLabel];
  const stationEs = STATION_ES[spec.section];
  const esEntry: NonNullable<ChecklistTemplateItemTranslations["es"]> = {};
  if (labelEs) esEntry.label = labelEs;
  if (stationEs) esEntry.station = stationEs;
  if (Object.keys(esEntry).length === 0) return null;
  return { es: esEntry };
}

// ---------------------------------------------------------------------------
// AM Prep lookup builder — keyed by `${section}|${label}` to avoid label
// collisions across sections (defensive; AM Prep doesn't have cross-section
// label collisions today but the compound key is cheap).
// ---------------------------------------------------------------------------

interface AmPrepItemRef {
  id: string;
  parValue: number | null;
  parUnit: string | null;
}

async function buildAmPrepLookup(
  sb: SupabaseClient,
  amPrepTemplateId: string,
): Promise<Map<string, AmPrepItemRef>> {
  const { data, error } = await sb
    .from("checklist_template_items")
    .select("id, station, label, prep_meta")
    .eq("template_id", amPrepTemplateId)
    .eq("active", true);
  if (error) {
    throw new Error(
      `buildAmPrepLookup template ${amPrepTemplateId}: ${error.message}`,
    );
  }
  const lookup = new Map<string, AmPrepItemRef>();
  for (const r of (data ?? []) as Array<{
    id: string;
    station: string | null;
    label: string;
    prep_meta: { parValue?: number | null; parUnit?: string | null } | null;
  }>) {
    if (!r.station) continue;
    const key = `${r.station}|${r.label}`;
    lookup.set(key, {
      id: r.id,
      parValue: r.prep_meta?.parValue ?? null,
      parUnit: r.prep_meta?.parUnit ?? null,
    });
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Per-location application
// ---------------------------------------------------------------------------

async function applyToLocation(
  sb: SupabaseClient,
  locationId: string,
  locationCode: string,
): Promise<LocationResult> {
  // Step 1: resolve opening + AM Prep templates at this location.
  const { data: openingTmpl, error: openErr } = await sb
    .from("checklist_templates")
    .select("id, active")
    .eq("location_id", locationId)
    .eq("type", "opening")
    .eq("name", OPENING_TEMPLATE_NAME)
    .maybeSingle<{ id: string; active: boolean }>();
  if (openErr) {
    throw new Error(`load opening template at ${locationCode}: ${openErr.message}`);
  }
  if (!openingTmpl) {
    throw new Error(
      `${OPENING_TEMPLATE_NAME} not found at ${locationCode} — Phase 1 seed missing`,
    );
  }
  if (!openingTmpl.active) {
    throw new Error(
      `${OPENING_TEMPLATE_NAME} at ${locationCode} is inactive; Phase 2 additions skipped`,
    );
  }

  const { data: amPrepTmpl, error: amErr } = await sb
    .from("checklist_templates")
    .select("id, active")
    .eq("location_id", locationId)
    .eq("type", "prep")
    .eq("name", AM_PREP_TEMPLATE_NAME)
    .maybeSingle<{ id: string; active: boolean }>();
  if (amErr) {
    throw new Error(`load AM Prep template at ${locationCode}: ${amErr.message}`);
  }
  if (!amPrepTmpl) {
    throw new Error(
      `${AM_PREP_TEMPLATE_NAME} not found at ${locationCode} — Phase 2 needs AM Prep template to populate FKs`,
    );
  }
  if (!amPrepTmpl.active) {
    throw new Error(
      `${AM_PREP_TEMPLATE_NAME} at ${locationCode} is inactive; Phase 2 cannot link to inactive AM Prep template`,
    );
  }

  // Step 2: build AM Prep label lookup (one query per location, batched).
  const amPrepLookup = await buildAmPrepLookup(sb, amPrepTmpl.id);

  // Step 3: per-spec apply with fail-loudly mid-location-abort semantic.
  const items: ItemResult[] = [];
  let aborted = false;
  for (const spec of ITEMS) {
    if (aborted) {
      // Skip remaining items once a fail-loudly fired — surface as
      // unprocessed so the operator sees the full impact.
      items.push({
        spec,
        outcome: "error_amprep_lookup_failed",
        templateItemId: null,
        amPrepTemplateItemId: null,
        error: "skipped — earlier fail-loudly aborted the location run",
      });
      continue;
    }
    const result = await applyItem(sb, openingTmpl.id, amPrepLookup, spec);
    items.push(result);
    if (result.outcome === "error_amprep_lookup_failed") {
      aborted = true;
    }
  }

  // Step 4: audit emission if any landed change AND not aborted.
  const insertedCount = items.filter((i) => i.outcome === "inserted").length;
  const updatedCount = items.filter((i) => i.outcome === "par_updated").length;
  if ((insertedCount === 0 && updatedCount === 0) || aborted) {
    return {
      locationId,
      locationCode,
      openingTemplateId: openingTmpl.id,
      amPrepTemplateId: amPrepTmpl.id,
      items,
      auditRowId: null,
      aborted,
    };
  }

  // ⚠️ AUDIT METADATA CONTEXT: when re-running this seed in a new PR
  // context, update the `phase` and `reason` strings below to match the
  // current work. These are NOT auto-derived (see AGENTS.md durable lesson
  // "Audit metadata context attribution in seed scripts").
  const allWarnings = items.filter((i) => i.warning).map((i) => i.warning!);

  const { data: auditRow, error: auditErr } = await sb
    .from("audit_log")
    .insert({
      actor_id: JUAN_USER_ID,
      actor_role: "cgs",
      action: "checklist_template.update",
      resource_table: "checklist_templates",
      resource_id: openingTmpl.id,
      destructive: false,
      metadata: {
        phase: "3_build_3_pr_3_step_3",
        reason:
          "Standard Opening v1 — Phase 2 prep verification additions per C.50 (34 items mirroring AM Prep numerics with references_template_item_id FK + OpeningPhase2Meta prep_meta + EN/ES translations)",
        sync_method: "seed_script",
        script_path: "scripts/seed-opening-phase2-additions.ts",
        location_id: locationId,
        location_code: locationCode,
        opening_template_name: OPENING_TEMPLATE_NAME,
        am_prep_template_id: amPrepTmpl.id,
        am_prep_template_name: AM_PREP_TEMPLATE_NAME,
        inserted_count: insertedCount,
        par_updated_count: updatedCount,
        inserts: items
          .filter((i) => i.outcome === "inserted")
          .map((i) => ({
            section: i.spec.section,
            label: i.spec.amPrepLabel,
            display_order: i.spec.displayOrder,
            opening_template_item_id: i.templateItemId,
            am_prep_template_item_id: i.amPrepTemplateItemId,
          })),
        par_updates: items
          .filter((i) => i.outcome === "par_updated")
          .map((i) => ({
            section: i.spec.section,
            label: i.spec.amPrepLabel,
            opening_template_item_id: i.templateItemId,
            am_prep_template_item_id: i.amPrepTemplateItemId,
            previous_par: i.previousPar ?? null,
            new_par: i.newPar ?? null,
          })),
        warnings: allWarnings,
        languages_populated: ["es"],
        spec_amendments_referenced: ["C.37", "C.38", "C.42", "C.44", "C.46", "C.50"],
        actor_context: "seed_script_apply",
        ip_address: null,
        user_agent: null,
      },
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (auditErr || !auditRow) {
    throw new Error(
      `audit_log insert failed for opening template ${openingTmpl.id}: ${auditErr?.message ?? "no row"}`,
    );
  }

  return {
    locationId,
    locationCode,
    openingTemplateId: openingTmpl.id,
    amPrepTemplateId: amPrepTmpl.id,
    items,
    auditRowId: auditRow.id,
    aborted: false,
  };
}

async function applyItem(
  sb: SupabaseClient,
  openingTemplateId: string,
  amPrepLookup: Map<string, AmPrepItemRef>,
  spec: SeedPhase2Item,
): Promise<ItemResult> {
  // Step a: resolve AM Prep counterpart (fail-loudly per Q3).
  const amPrepKey = `${spec.section}|${spec.amPrepLabel}`;
  const amPrepRef = amPrepLookup.get(amPrepKey);
  if (!amPrepRef) {
    const error =
      `AM Prep item lookup FAILED for "${spec.amPrepLabel}" in section "${spec.section}" — ` +
      `seed aborts THIS LOCATION to prevent silent NULL FK shipping a 5x-undercount-class ` +
      `bug back to production. Reconcile manually: confirm AM Prep template is active and ` +
      `contains the expected item, OR remove this Phase 2 spec entry from ITEMS array.`;
    console.error(`❌ ${error}`);
    return {
      spec,
      outcome: "error_amprep_lookup_failed",
      templateItemId: null,
      amPrepTemplateItemId: null,
      error,
    };
  }

  // Step b: lookup-by-(opening_template_id, station, label) on Phase 2 row.
  const { data: existing, error: readErr } = await sb
    .from("checklist_template_items")
    .select("id, prep_meta")
    .eq("template_id", openingTemplateId)
    .eq("station", spec.section)
    .eq("label", spec.amPrepLabel)
    .maybeSingle<{
      id: string;
      prep_meta: { parValue?: number | null; openingPhase2?: boolean } | null;
    }>();
  if (readErr) {
    throw new Error(
      `applyItem lookup "${spec.amPrepLabel}" at "${spec.section}": ${readErr.message}`,
    );
  }

  if (existing) {
    // Defensive: warn if the existing row's prep_meta isn't an
    // OpeningPhase2Meta (could be a Phase 1 collision or schema drift).
    if (existing.prep_meta?.openingPhase2 !== true) {
      const warning =
        `existing row id=${existing.id} at (station="${spec.section}", label="${spec.amPrepLabel}") ` +
        `has prep_meta without openingPhase2=true marker — possible Phase 1/Phase 2 collision or ` +
        `schema drift. NOT touching the row; manual review needed.`;
      console.warn(`⚠️  ${warning}`);
      return {
        spec,
        outcome: "warning_state_diverged",
        templateItemId: existing.id,
        amPrepTemplateItemId: amPrepRef.id,
        warning,
      };
    }

    // Par drift check (per locked Q4 forensic refinement).
    const existingPar = existing.prep_meta?.parValue ?? null;
    if (existingPar !== amPrepRef.parValue) {
      const newPrepMeta: OpeningPhase2Meta = {
        openingPhase2: true,
        section: spec.section,
        parValue: amPrepRef.parValue,
        parUnit: amPrepRef.parUnit,
      };
      const { error: updateErr } = await sb
        .from("checklist_template_items")
        .update({ prep_meta: newPrepMeta })
        .eq("id", existing.id);
      if (updateErr) {
        throw new Error(`par_updated UPDATE ${existing.id}: ${updateErr.message}`);
      }
      return {
        spec,
        outcome: "par_updated",
        templateItemId: existing.id,
        amPrepTemplateItemId: amPrepRef.id,
        previousPar: existingPar,
        newPar: amPrepRef.parValue,
      };
    }

    return {
      spec,
      outcome: "noop_already_present",
      templateItemId: existing.id,
      amPrepTemplateItemId: amPrepRef.id,
    };
  }

  // Step c: INSERT new Phase 2 row.
  const prepMeta: OpeningPhase2Meta = {
    openingPhase2: true,
    section: spec.section,
    parValue: amPrepRef.parValue,
    parUnit: amPrepRef.parUnit,
  };
  const translations = buildTranslations(spec);

  const { data: inserted, error: insertErr } = await sb
    .from("checklist_template_items")
    .insert({
      template_id: openingTemplateId,
      station: spec.section,
      display_order: spec.displayOrder,
      label: spec.amPrepLabel,
      description: null,
      min_role_level: 3,
      required: true,
      expects_count: false,
      expects_photo: false,
      vendor_item_id: null,
      active: true,
      translations: translations ?? undefined,
      prep_meta: prepMeta,
      report_reference_type: null,
      references_template_item_id: amPrepRef.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (insertErr || !inserted) {
    throw new Error(
      `INSERT "${spec.amPrepLabel}" at "${spec.section}" (open=${openingTemplateId}): ` +
        `${insertErr?.message ?? "no row"}`,
    );
  }

  return {
    spec,
    outcome: "inserted",
    templateItemId: inserted.id,
    amPrepTemplateItemId: amPrepRef.id,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function summary(r: LocationResult): string {
  const inserted = r.items.filter((i) => i.outcome === "inserted").length;
  const noop = r.items.filter((i) => i.outcome === "noop_already_present").length;
  const updated = r.items.filter((i) => i.outcome === "par_updated").length;
  const warnings = r.items.filter((i) => i.outcome === "warning_state_diverged").length;
  const errors = r.items.filter((i) => i.outcome === "error_amprep_lookup_failed").length;
  const tag = r.aborted ? "ABORTED" : "APPLIED";
  let s =
    `  ${r.locationCode}: ${tag} opening=${r.openingTemplateId} amPrep=${r.amPrepTemplateId} — ` +
    `${inserted} inserted, ${noop} noop, ${updated} par_updated, ${warnings} warnings, ${errors} errors ` +
    `(audit_id=${r.auditRowId})\n`;
  if (errors > 0) {
    s += r.items
      .filter((i) => i.outcome === "error_amprep_lookup_failed" && i.error)
      .map((i) => `      ❌ ${i.spec.section}/${i.spec.amPrepLabel}: ${i.error}`)
      .join("\n") + "\n";
  }
  if (warnings > 0) {
    s += r.items
      .filter((i) => i.warning)
      .map((i) => `      ⚠️  ${i.spec.section}/${i.spec.amPrepLabel}: ${i.warning}`)
      .join("\n") + "\n";
  }
  return s;
}

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

  // Parse --location flag (MEP / EM / absent).
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf("--location");
  const locationFilter = flagIdx !== -1 ? args[flagIdx + 1] : null;

  const targets: Array<{ id: string; code: string }> = [];
  if (locationFilter == null || locationFilter === "BOTH") {
    targets.push({ id: LOCATION_MEP, code: "MEP" });
    targets.push({ id: LOCATION_EM, code: "EM " });
  } else if (locationFilter === "MEP") {
    targets.push({ id: LOCATION_MEP, code: "MEP" });
  } else if (locationFilter === "EM") {
    targets.push({ id: LOCATION_EM, code: "EM " });
  } else {
    throw new Error(`Invalid --location value: "${locationFilter}" (expected MEP, EM, or BOTH)`);
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  process.stdout.write(
    `seed-opening-phase2-additions: applying ${ITEMS.length} Phase 2 items per location ` +
      `(targets: ${targets.map((t) => t.code.trim()).join(", ")})\n`,
  );

  const results: LocationResult[] = [];
  for (const t of targets) {
    results.push(await applyToLocation(sb, t.id, t.code));
  }

  process.stdout.write(`OK\n${results.map(summary).join("")}`);

  // Exit non-zero if any location aborted (for CI / scripted invocations).
  if (results.some((r) => r.aborted)) {
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
