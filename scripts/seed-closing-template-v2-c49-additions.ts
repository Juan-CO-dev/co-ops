/**
 * Seed: Standard Closing v2 — C.49 in-place additive changes (Build #3 PR 2).
 *
 * 11 changes per location (MEP + EM applied identically):
 *   - 1 station-value standardization (UPDATE; touches 6 rows on Walk Ins station)
 *   - 2 in-place label renames (UPDATE preserving id; FK chain to
 *     checklist_completions intact for historical instances)
 *   - 7 fridge temp log INSERTs (expects_count=true; one per fridge missing
 *     temp coverage)
 *   - 1 "Opening verified" cross-reference INSERT (report_reference_type='opening'
 *     for the C.42 auto-completion mechanic)
 *
 * Operation order MATTERS: station-value standardization runs FIRST so the
 * label rename for "Walk-in temp log" can look up by the post-standardization
 * station value ("Walk Ins Station" capital S). Reversing the order would
 * create an idempotency hazard on re-runs (the label-rename's lookup-by-new
 * couldn't find the new label at the now-lowercase station).
 *
 * Idempotency:
 *   - Station rename: lookup canonical (newStation) → if any rows present,
 *     no-op; else lookup historical (oldStation) → if found, UPDATE all rows;
 *     else log warning. Mixed-state (rows at both) logs warning AND proceeds
 *     to rename remaining historical rows.
 *   - Label rename: lookup-by-NEW → if found, no-op; else lookup-by-OLD → if
 *     found, UPDATE in place; else log warning (state diverged).
 *   - INSERTs: lookup-by-(station, label) → if found, no-op; else INSERT
 *     with the fixed display_order (50-57).
 *
 * In-place additive vs Path A v3 precedent: per SPEC_AMENDMENTS.md C.49
 * v1.4 action #5 — additive INSERTs + label-only UPDATEs preserving id +
 * C.44 snapshot universe locking = in-place is the correct precision.
 *
 * Audit emission convention (per AGENTS.md):
 *   - One audit row per location, fired only when at least one change landed
 *   - actor_id: Juan; actor_role: 'cgs'
 *   - action: 'checklist_template.update' (destructive=false; not a creation)
 *   - metadata captures station_renames + renames + inserts arrays
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
 *   npx tsx --env-file=.env.local scripts/seed-closing-template-v2-c49-additions.ts
 */

import { pathToFileURL } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ChecklistTemplateItemTranslations } from "../lib/types";

// Juan's user_id — actor for audit rows. Stable since Phase 1 seed.
const JUAN_USER_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";

const LOCATION_MEP = "54ce1029-400e-4a92-9c2b-0ccb3b031f0a";
const LOCATION_EM = "d2cced11-b167-49fa-bab6-86ec9bf4ff09";

const TEMPLATE_NAME = "Standard Closing v2";

// ---------------------------------------------------------------------------
// Station name constants — exact strings; typo = duplicate station header
// per C.38 system-key discipline. Verified against production via
// information_schema query on 2026-05-06.
//
// Note: STATION_WALK_INS_HISTORICAL is the lowercase 's' variant carried
// forward from Build #1 seed drift; STATION_WALK_INS_CANONICAL is the
// post-standardization (capital S) value matching the canonical
// convention and Standard Opening v1.
// ---------------------------------------------------------------------------

const STATION_CRUNCHY_BOI = "Crunchy Boi Station";
const STATION_3RD_PARTY = "3rd Party Station";
const STATION_WALK_INS_HISTORICAL = "Walk Ins station"; // lowercase 's' — Build #1 drift
const STATION_WALK_INS_CANONICAL = "Walk Ins Station"; // capital S — canonical
const STATION_PREP_FRIDGE = "Prep Fridge";
const STATION_BACK_LINE = "Shut Down Back Line";
const STATION_EXPO = "Expo Station";
const STATION_CLEAN_FOH = "Clean front of house"; // lowercase except first
const STATION_PREP_AREA = "Prep Area";
const STATION_CLOSING_MGR = "Closing Manager";

// ---------------------------------------------------------------------------
// Specs — station rename (1), label renames (2), inserts (8)
// ---------------------------------------------------------------------------

interface StationRenameSpec {
  oldStation: string;
  newStation: string;
}

const STATION_RENAMES: StationRenameSpec[] = [
  {
    oldStation: STATION_WALK_INS_HISTORICAL,
    newStation: STATION_WALK_INS_CANONICAL,
  },
];

interface RenameSpec {
  station: string;
  oldLabel: string;
  newLabel: string;
  newLabelEs: string;
}

const RENAMES: RenameSpec[] = [
  {
    station: STATION_WALK_INS_CANONICAL, // post-standardization value
    oldLabel: "Walk-in temp log",
    newLabel: "Walk Ins station fridge temp log",
    newLabelEs: "Registro de temperatura del refri de la estación walk-ins",
  },
  {
    station: STATION_EXPO,
    oldLabel: "Wipe out sides fridge",
    newLabel: "Wipe out deli display fridge",
    newLabelEs: "Limpiar por dentro el refri de exhibición de fiambres",
  },
];

interface NewItemSpec {
  station: string;
  displayOrder: number;
  label: string;
  labelEs: string;
  expectsCount: boolean;
  reportReferenceType: "opening_report" | null;
}

const NEW_ITEMS: NewItemSpec[] = [
  {
    station: STATION_CRUNCHY_BOI,
    displayOrder: 50,
    label: "Crunchy Boi station fridge temp log",
    labelEs: "Registro de temperatura del refri de la estación Crunchy Boi",
    expectsCount: true,
    reportReferenceType: null,
  },
  {
    station: STATION_3RD_PARTY,
    displayOrder: 51,
    label: "3rd Party station fridge temp log",
    labelEs: "Registro de temperatura del refri de la estación de terceros",
    expectsCount: true,
    reportReferenceType: null,
  },
  {
    station: STATION_PREP_FRIDGE,
    displayOrder: 52,
    label: "Sauce fridge temp log",
    labelEs: "Registro de temperatura del refri de salsas",
    expectsCount: true,
    reportReferenceType: null,
  },
  {
    station: STATION_BACK_LINE,
    displayOrder: 53,
    label: "Back-line drinks fridge temp log",
    labelEs: "Registro de temperatura del refri de bebidas de la línea trasera",
    expectsCount: true,
    reportReferenceType: null,
  },
  {
    station: STATION_EXPO,
    displayOrder: 54,
    label: "Deli display fridge temp log",
    labelEs: "Registro de temperatura del refri de exhibición de fiambres",
    expectsCount: true,
    reportReferenceType: null,
  },
  {
    station: STATION_CLEAN_FOH,
    displayOrder: 55,
    label: "FOH drinks fridge temp log",
    labelEs: "Registro de temperatura del refri de bebidas del frente",
    expectsCount: true,
    reportReferenceType: null,
  },
  {
    station: STATION_PREP_AREA,
    displayOrder: 56,
    label: "3-door fridge temp log",
    labelEs: "Registro de temperatura del refri de 3 puertas",
    expectsCount: true,
    reportReferenceType: null,
  },
  {
    station: STATION_CLOSING_MGR,
    displayOrder: 57,
    label: "Opening verified",
    labelEs: "Apertura verificada",
    expectsCount: false,
    reportReferenceType: "opening_report",
  },
];

// Defensive: every NEW_ITEMS spec at a unique display_order.
const orderSet = new Set(NEW_ITEMS.map((s) => s.displayOrder));
if (orderSet.size !== NEW_ITEMS.length) {
  throw new Error(
    `seed-closing-template-v2-c49-additions: duplicate display_order in NEW_ITEMS`,
  );
}

// ---------------------------------------------------------------------------
// Outcome types
// ---------------------------------------------------------------------------

type StationRenameOutcome =
  | "noop_already_standardized"
  | "renamed"
  | "warning_state_diverged";
type RenameOutcome = "noop_already_renamed" | "renamed" | "warning_state_diverged";
type InsertOutcome = "noop_already_present" | "inserted";

interface StationRenameResult {
  spec: StationRenameSpec;
  outcome: StationRenameOutcome;
  rowsUpdated: number;
  warning?: string;
}

interface RenameResult {
  spec: RenameSpec;
  outcome: RenameOutcome;
  templateItemId: string | null;
  warning?: string;
}

interface InsertResult {
  spec: NewItemSpec;
  outcome: InsertOutcome;
  templateItemId: string | null;
}

interface LocationResult {
  locationId: string;
  templateId: string;
  stationRenames: StationRenameResult[];
  renames: RenameResult[];
  inserts: InsertResult[];
  auditRowId: string | null;
}

// ---------------------------------------------------------------------------
// Per-location application
// ---------------------------------------------------------------------------

async function applyToLocation(
  sb: SupabaseClient,
  locationId: string,
): Promise<LocationResult> {
  // Pre-flight: locate Standard Closing v2 template at this location.
  const { data: tmpl, error: tmplErr } = await sb
    .from("checklist_templates")
    .select("id, active")
    .eq("location_id", locationId)
    .eq("type", "closing")
    .eq("name", TEMPLATE_NAME)
    .maybeSingle<{ id: string; active: boolean }>();
  if (tmplErr) {
    throw new Error(`load template at ${locationId}: ${tmplErr.message}`);
  }
  if (!tmpl) {
    throw new Error(
      `${TEMPLATE_NAME} not found at location ${locationId} — seed missing`,
    );
  }
  if (!tmpl.active) {
    // C.49 only applies to active v2 templates. If v2 has been superseded
    // by v3 (Path A future), abort with a clear message.
    throw new Error(
      `${TEMPLATE_NAME} at ${locationId} is inactive; C.49 additions skipped`,
    );
  }
  const templateId = tmpl.id;

  // Order matters: station renames FIRST, then label renames, then inserts.
  const stationRenames: StationRenameResult[] = [];
  for (const spec of STATION_RENAMES) {
    stationRenames.push(await applyStationRename(sb, templateId, spec));
  }

  const renames: RenameResult[] = [];
  for (const spec of RENAMES) {
    renames.push(await applyRename(sb, templateId, spec));
  }

  const inserts: InsertResult[] = [];
  for (const spec of NEW_ITEMS) {
    inserts.push(await applyInsert(sb, templateId, spec));
  }

  const stationRenamedCount = stationRenames.filter(
    (r) => r.outcome === "renamed",
  ).length;
  const renamedCount = renames.filter((r) => r.outcome === "renamed").length;
  const insertedCount = inserts.filter((i) => i.outcome === "inserted").length;

  // No audit row when nothing changed (matches seed-standard-closing-v2's
  // synced_no_changes behavior).
  if (stationRenamedCount === 0 && renamedCount === 0 && insertedCount === 0) {
    return {
      locationId,
      templateId,
      stationRenames,
      renames,
      inserts,
      auditRowId: null,
    };
  }

  // ⚠️ AUDIT METADATA CONTEXT: when re-running this seed in a new PR
  // context, update the `phase` and `reason` strings below to match the
  // current work. These are NOT auto-derived (see AGENTS.md durable lesson
  // "Audit metadata context attribution in seed scripts").
  const allWarnings = [
    ...stationRenames.filter((r) => r.warning).map((r) => r.warning!),
    ...renames.filter((r) => r.warning).map((r) => r.warning!),
  ];

  const { data: auditRow, error: auditErr } = await sb
    .from("audit_log")
    .insert({
      actor_id: JUAN_USER_ID,
      actor_role: "cgs",
      action: "checklist_template.update",
      resource_table: "checklist_templates",
      resource_id: templateId,
      destructive: false,
      metadata: {
        phase: "3_build_3_pr_2",
        reason:
          "Standard Closing v2 — C.49 additions (1 station-value standardization touching 6 rows + 8 new items + 2 in-place label renames)",
        sync_method: "seed_script",
        script_path: "scripts/seed-closing-template-v2-c49-additions.ts",
        location_id: locationId,
        template_name: TEMPLATE_NAME,
        station_renamed_count: stationRenamedCount,
        renamed_count: renamedCount,
        inserted_count: insertedCount,
        station_renames: stationRenames
          .filter((r) => r.outcome === "renamed")
          .map((r) => ({
            old_station: r.spec.oldStation,
            new_station: r.spec.newStation,
            rows_updated: r.rowsUpdated,
          })),
        renames: renames
          .filter((r) => r.outcome === "renamed")
          .map((r) => ({
            station: r.spec.station,
            old_label: r.spec.oldLabel,
            new_label: r.spec.newLabel,
            template_item_id: r.templateItemId,
          })),
        inserts: inserts
          .filter((i) => i.outcome === "inserted")
          .map((i) => ({
            station: i.spec.station,
            label: i.spec.label,
            display_order: i.spec.displayOrder,
            expects_count: i.spec.expectsCount,
            report_reference_type: i.spec.reportReferenceType,
            template_item_id: i.templateItemId,
          })),
        warnings: allWarnings,
        languages_populated: ["es"],
        spec_amendments_referenced: ["C.37", "C.38", "C.42", "C.44", "C.49"],
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
    stationRenames,
    renames,
    inserts,
    auditRowId: auditRow.id,
  };
}

async function applyStationRename(
  sb: SupabaseClient,
  templateId: string,
  spec: StationRenameSpec,
): Promise<StationRenameResult> {
  const { count: canonicalCount, error: canonicalErr } = await sb
    .from("checklist_template_items")
    .select("*", { count: "exact", head: true })
    .eq("template_id", templateId)
    .eq("station", spec.newStation);
  if (canonicalErr) {
    throw new Error(`station rename canonical lookup: ${canonicalErr.message}`);
  }

  const { count: historicalCount, error: historicalErr } = await sb
    .from("checklist_template_items")
    .select("*", { count: "exact", head: true })
    .eq("template_id", templateId)
    .eq("station", spec.oldStation);
  if (historicalErr) {
    throw new Error(`station rename historical lookup: ${historicalErr.message}`);
  }

  // Already standardized: rows at canonical, none at historical.
  if ((canonicalCount ?? 0) > 0 && (historicalCount ?? 0) === 0) {
    return { spec, outcome: "noop_already_standardized", rowsUpdated: 0 };
  }

  // State diverged: no rows at either value. Abort with a warning so a
  // human can investigate; don't blindly do nothing.
  if ((canonicalCount ?? 0) === 0 && (historicalCount ?? 0) === 0) {
    const warning = `station rename: no rows at "${spec.oldStation}" OR "${spec.newStation}" for template ${templateId} — state diverged from expectation`;
    console.warn(`⚠️  ${warning}`);
    return {
      spec,
      outcome: "warning_state_diverged",
      rowsUpdated: 0,
      warning,
    };
  }

  // Mixed state: rows at BOTH values. Surface as warning AND proceed to
  // rename remaining historical rows for completion.
  let mixedWarning: string | undefined;
  if ((canonicalCount ?? 0) > 0 && (historicalCount ?? 0) > 0) {
    mixedWarning = `station rename mixed state: ${canonicalCount} at "${spec.newStation}" + ${historicalCount} at "${spec.oldStation}" for template ${templateId} — proceeding to rename remaining historical rows`;
    console.warn(`⚠️  ${mixedWarning}`);
  }

  const { error: updateErr } = await sb
    .from("checklist_template_items")
    .update({ station: spec.newStation })
    .eq("template_id", templateId)
    .eq("station", spec.oldStation);
  if (updateErr) {
    throw new Error(`station rename UPDATE: ${updateErr.message}`);
  }

  return {
    spec,
    outcome: "renamed",
    rowsUpdated: historicalCount ?? 0,
    warning: mixedWarning,
  };
}

async function applyRename(
  sb: SupabaseClient,
  templateId: string,
  spec: RenameSpec,
): Promise<RenameResult> {
  // Step 1: lookup by NEW label — if found, already renamed, no-op.
  const { data: alreadyRenamed, error: newErr } = await sb
    .from("checklist_template_items")
    .select("id")
    .eq("template_id", templateId)
    .eq("station", spec.station)
    .eq("label", spec.newLabel)
    .maybeSingle<{ id: string }>();
  if (newErr) {
    throw new Error(`rename lookup-new "${spec.newLabel}": ${newErr.message}`);
  }
  if (alreadyRenamed) {
    return {
      spec,
      outcome: "noop_already_renamed",
      templateItemId: alreadyRenamed.id,
    };
  }

  // Step 2: lookup by OLD label — if found, UPDATE in place (preserves id).
  const { data: existing, error: oldErr } = await sb
    .from("checklist_template_items")
    .select("id, translations")
    .eq("template_id", templateId)
    .eq("station", spec.station)
    .eq("label", spec.oldLabel)
    .maybeSingle<{
      id: string;
      translations: ChecklistTemplateItemTranslations | null;
    }>();
  if (oldErr) {
    throw new Error(`rename lookup-old "${spec.oldLabel}": ${oldErr.message}`);
  }
  if (!existing) {
    const warning = `rename: neither "${spec.oldLabel}" nor "${spec.newLabel}" found at station "${spec.station}" for template ${templateId} — state diverged; manual review needed`;
    console.warn(`⚠️  ${warning}`);
    return {
      spec,
      outcome: "warning_state_diverged",
      templateItemId: null,
      warning,
    };
  }

  // Merge ES translations: preserve any existing non-label keys (description,
  // station). Only the label translation is being updated by C.49.
  const mergedTranslations: ChecklistTemplateItemTranslations = {
    ...(existing.translations ?? {}),
    es: {
      ...(existing.translations?.es ?? {}),
      label: spec.newLabelEs,
    },
  };

  const { error: updateErr } = await sb
    .from("checklist_template_items")
    .update({ label: spec.newLabel, translations: mergedTranslations })
    .eq("id", existing.id);
  if (updateErr) {
    throw new Error(`rename UPDATE ${existing.id}: ${updateErr.message}`);
  }

  return { spec, outcome: "renamed", templateItemId: existing.id };
}

async function applyInsert(
  sb: SupabaseClient,
  templateId: string,
  spec: NewItemSpec,
): Promise<InsertResult> {
  const { data: existing, error: readErr } = await sb
    .from("checklist_template_items")
    .select("id")
    .eq("template_id", templateId)
    .eq("station", spec.station)
    .eq("label", spec.label)
    .maybeSingle<{ id: string }>();
  if (readErr) {
    throw new Error(`insert lookup "${spec.label}": ${readErr.message}`);
  }
  if (existing) {
    return {
      spec,
      outcome: "noop_already_present",
      templateItemId: existing.id,
    };
  }

  const { data: inserted, error: insertErr } = await sb
    .from("checklist_template_items")
    .insert({
      template_id: templateId,
      station: spec.station,
      display_order: spec.displayOrder,
      label: spec.label,
      description: null,
      min_role_level: 3,
      required: true,
      expects_count: spec.expectsCount,
      expects_photo: false,
      vendor_item_id: null,
      active: true,
      translations: { es: { label: spec.labelEs } },
      prep_meta: null,
      report_reference_type: spec.reportReferenceType,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (insertErr || !inserted) {
    throw new Error(
      `insert "${spec.label}" at station "${spec.station}": ${insertErr?.message ?? "no row"}`,
    );
  }

  return { spec, outcome: "inserted", templateItemId: inserted.id };
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
    `seed-closing-template-v2-c49-additions: applying ` +
      `${STATION_RENAMES.length} station rename(s) + ${RENAMES.length} label rename(s) + ${NEW_ITEMS.length} insert(s) ` +
      `to MEP + EM\n`,
  );

  const mep = await applyToLocation(sb, LOCATION_MEP);
  const em = await applyToLocation(sb, LOCATION_EM);

  const summary = (r: LocationResult, label: string): string => {
    const sr = r.stationRenames.filter((x) => x.outcome === "renamed").length;
    const lr = r.renames.filter((x) => x.outcome === "renamed").length;
    const ic = r.inserts.filter((x) => x.outcome === "inserted").length;
    const srWarnings = r.stationRenames.filter((x) => x.warning).length;
    const lrWarnings = r.renames.filter((x) => x.warning).length;
    const totalWarnings = srWarnings + lrWarnings;
    if (sr === 0 && lr === 0 && ic === 0) {
      return `  ${label}: in sync — template ${r.templateId} (no changes)\n`;
    }
    const stationDetail = r.stationRenames
      .filter((x) => x.outcome === "renamed")
      .map(
        (x) =>
          `      · station rename: "${x.spec.oldStation}" → "${x.spec.newStation}" (${x.rowsUpdated} rows)`,
      )
      .join("\n");
    const renameDetail = r.renames
      .filter((x) => x.outcome === "renamed")
      .map(
        (x) =>
          `      · label rename: "${x.spec.oldLabel}" → "${x.spec.newLabel}" (item ${x.templateItemId})`,
      )
      .join("\n");
    const insertDetail = r.inserts
      .filter((x) => x.outcome === "inserted")
      .map(
        (x) =>
          `      · insert: "${x.spec.label}" at "${x.spec.station}" order=${x.spec.displayOrder} (item ${x.templateItemId})`,
      )
      .join("\n");
    const detailParts = [stationDetail, renameDetail, insertDetail].filter(
      (s) => s.length > 0,
    );
    const warningSuffix = totalWarnings > 0 ? ` (${totalWarnings} warnings)` : "";
    return (
      `  ${label}: APPLIED template ${r.templateId} — ${sr} station-renames, ${lr} renames, ${ic} inserts (audit_id=${r.auditRowId})${warningSuffix}\n${detailParts.join("\n")}\n`
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
