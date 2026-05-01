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
 * Idempotency: pre-flight checks for an existing "Standard Closing v1" row at
 * each location and skips it cleanly (logs the existing template_id) so
 * re-runs after partial success are safe. To force a re-seed, manually
 * deactivate the existing row first (UPDATE checklist_templates SET active =
 * false ...) or delete the orphan row + items if it was created mid-failure.
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
    label: "Split up Tips",
    minRoleLevel: 5, // AGM+
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

interface SeedResult {
  locationId: string;
  templateId: string;
  itemCount: number;
  created: boolean; // false when skipped because already existed
  auditRowId: string | null;
}

async function seedForLocation(
  sb: SupabaseClient,
  locationId: string,
): Promise<SeedResult> {
  // Pre-flight: existing template at this location with same name? Skip cleanly.
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
    // Count items so we can confirm the prior seed completed before partial-state.
    const { count, error: countErr } = await sb
      .from("checklist_template_items")
      .select("*", { count: "exact", head: true })
      .eq("template_id", existing.id);
    if (countErr) {
      throw new Error(
        `pre-flight checklist_template_items count failed for template ${existing.id}: ${countErr.message}`,
      );
    }
    return {
      locationId,
      templateId: existing.id,
      itemCount: count ?? 0,
      created: false,
      auditRowId: null,
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
        spec_amendments_referenced: ["C.18", "C.19", "C.20"],
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
    created: true,
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

  const summary = (r: SeedResult, label: string) =>
    r.created
      ? `  ${label}: created template ${r.templateId} with ${r.itemCount} items (audit_id=${r.auditRowId})\n`
      : `  ${label}: SKIPPED — template ${r.templateId} already exists with ${r.itemCount} items\n`;

  process.stdout.write(`OK\n${summary(mep, "MEP")}${summary(em, "EM ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
