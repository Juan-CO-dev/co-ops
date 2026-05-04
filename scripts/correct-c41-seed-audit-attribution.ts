/**
 * One-shot corrective script — Phase 3 / Module #1 Build #2 PR 1.
 *
 * Writes a single `audit.metadata_correction` row that corrects the
 * forensic attribution of two stale-metadata audit rows produced by the
 * Build #2 PR 1 seed re-run of scripts/seed-closing-template.ts.
 *
 * The incident:
 *   - Build #2 PR 1 changed the closing template default min_role_level
 *     from 4 → 3 (C.41 reconciliation — KH+ at level >= 3).
 *   - The seed was re-run against production. 100 rows updated cleanly
 *     (50 items × 2 locations: MEP + EM).
 *   - 2 audit rows landed:
 *       * 593b2a38-d0c6-476d-bc49-748fc691da65 (MEP)
 *       * 8611e98f-7aca-467a-ab2a-97bff21a7359 (EM)
 *   - BOTH rows carry stale phase/reason metadata from PR 5c
 *     (`phase: "3_module_1_build_1.5_pr_5c"`,
 *      `reason: "seed sync — convergent re-run propagating spec edits"`)
 *     because the seed script's audit-emission code hardcoded those strings
 *     and they were not updated alongside the default change.
 *   - Detected during Build #2 PR 1 verification spot-check (Supabase MCP
 *     query against audit_log).
 *
 * Resolution:
 *   - Append-only philosophy forbids UPDATE on existing audit_log rows.
 *   - Audit-the-audit pattern: write a single corrective row referencing
 *     the two stale row IDs + capturing the actual C.41 metadata.
 *   - Seed script updated for future runs (marker comment + correct
 *     phase/reason strings).
 *   - Durable lesson captured in AGENTS.md.
 *
 * Idempotency: this script is one-shot. Re-running would write a SECOND
 * corrective row. Don't re-run unless intentional.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/correct-c41-seed-audit-attribution.ts
 */

import { createClient } from "@supabase/supabase-js";

const JUAN_USER_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";

const STALE_MEP_AUDIT_ID = "593b2a38-d0c6-476d-bc49-748fc691da65";
const STALE_EM_AUDIT_ID = "8611e98f-7aca-467a-ab2a-97bff21a7359";

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
    `correct-c41-seed-audit-attribution: writing 1 corrective audit row referencing ` +
      `stale rows ${STALE_MEP_AUDIT_ID} (MEP) and ${STALE_EM_AUDIT_ID} (EM)\n`,
  );

  // The corrective row's resource_id points at the first stale row
  // (MEP, chronologically earlier — occurred_at 2026-05-04 08:27:18.760734+00
  // vs EM at 08:27:21.101327+00). The full pair is captured in
  // metadata.corrected_audit_ids; resource_id is the canonical "what is
  // this audit-row about" field per the audit_log schema convention.
  const { data, error } = await sb
    .from("audit_log")
    .insert({
      actor_id: JUAN_USER_ID,
      actor_role: "cgs",
      action: "audit.metadata_correction",
      resource_table: "audit_log",
      resource_id: STALE_MEP_AUDIT_ID,
      destructive: false,
      metadata: {
        corrected_audit_ids: [STALE_MEP_AUDIT_ID, STALE_EM_AUDIT_ID],
        reason:
          "Stale phase/reason attribution — seed script hardcoded strings " +
          "carried PR 5c context unchanged through Build #2 PR 1 C.41 " +
          "reconciliation seed re-run",
        actual_phase: "3_module_1_build_2_pr_1",
        actual_reason:
          "C.41 reconciliation — closing finalize gate KH+ at level >= 3",
        spec_amendments_referenced: ["C.41", "C.45"],
        detected_during:
          "Build #2 PR 1 verification spot-check after closing template " +
          "min_role_level update from 4 to 3 ran clean against production",
        // Forensic trail — what actually changed in production:
        actual_data_change:
          "100 rows updated across checklist_template_items: " +
          "min_role_level 4 → 3 for all 50 items at MEP closing template " +
          "(764eba7a-975d-4a53-b386-952a15cb2d9e) + 50 items at EM closing " +
          "template (b67c9fda-ee22-48f7-9bf5-01054e6ecf6d)",
        seed_script_path: "scripts/seed-closing-template.ts",
        seed_script_now_fixed: true,
        durable_lesson_captured_in: "AGENTS.md",
        ip_address: null,
        user_agent: null,
      },
    })
    .select("id, occurred_at")
    .maybeSingle<{ id: string; occurred_at: string }>();

  if (error || !data) {
    throw new Error(
      `correct-c41-seed-audit-attribution: insert failed: ${error?.message ?? "no row"}`,
    );
  }

  process.stdout.write(
    `OK\n  corrective audit row id: ${data.id}\n  occurred_at: ${data.occurred_at}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
