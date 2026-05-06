/**
 * Destructive action registry — Foundation Spec v1.2 Section 7.3.
 *
 * These actions require step-up auth (password re-entry) for level 5+ users
 * before they can be executed. Modules cannot mark their own actions as
 * destructive — additions go through this list and a coordinated review.
 */

export const DESTRUCTIVE_ACTIONS = [
  // User lifecycle
  "user.create",
  "user.activate",
  "user.deactivate",
  "user.promote",
  "user.demote",
  "user.change_locations",
  "user.reset_pin",
  "user.set_pin",
  "user.change_email",

  // Location lifecycle
  "location.create",
  "location.activate",
  "location.deactivate",
  "location.change_type",

  // Configuration
  "pars.update",
  "system.config_update",

  // Vendor lifecycle
  "vendor.create",
  "vendor.activate",
  "vendor.deactivate",
  "vendor.full_profile_edit",

  // Checklist template lifecycle
  "checklist_template.create",
  "checklist_template.delete_or_deactivate",
  "checklist_template_item.delete",

  // Checklist completion correction (per SPEC_AMENDMENTS.md C.28)
  // — destructive because they alter operational/accountability record.
  // Auto-derived destructive=true on the audit row via isDestructive().
  "checklist_completion.revoke",
  "checklist_completion.tag_actual_completer",

  // Report post-submission update (per SPEC_AMENDMENTS.md C.46 A7)
  // — destructive because it's an additive correction to a submitted
  // report. Audit row is emitted from inside submit_am_prep_atomic RPC
  // (atomic with chain write); RPC-side INSERT into audit_log explicitly
  // sets destructive=true rather than relying on JS-side audit() helper's
  // auto-derive. The action name lives here so future generalization to
  // other report types (Cash Report, Opening Report, Mid-day Prep — per
  // C.46 A9) reuses the same destructive registration. isDestructive()
  // returns true for "report.update" via the registry membership check.
  "report.update",

  // Closing auto-finalize without manual confirmation (Build #3 PR 1).
  // — destructive because the operational record transitions to
  // 'auto_finalized' without the closer's PIN-attestation. Three release
  // sources distinguished via metadata.release_source:
  //   'opener'           — opener tapped Release UI (PR 4)
  //   'system_auto'      — pg_cron / lazy-eval picked up an overdue closing
  //   'migration_backfill' — one-shot backfill of pre-PR-1 stranded v1
  //                        instances (migration 0046; CHECK constraint on
  //                        finalized_at_actor_type does NOT include this
  //                        — it lives in audit metadata only).
  "closing.released_unfinalized",

  // Report drop / un-claim (Build #3 PR 1).
  // — destructive because it releases an in-progress instance back to
  // unclaimed; assignment_locked instances cannot be self-dropped. Audit
  // metadata captures prior_assigned_to, prior_assignment_locked, and
  // dropped_reason for forensic chain. Pattern over time: someone
  // dropping reports they self-initiated often = capacity/attention
  // signal (per design doc §4.5).
  "report.drop",

  // Audit forensic recovery (Build #3 PR 2 — added during C.49 seed remediation).
  // Distinct from audit.metadata_correction:
  //   audit.metadata_correction = correcting wrong/incomplete metadata on an
  //                               existing audit row (entries already exist
  //                               but carry stale or incorrect context)
  //   audit.gap_recovery        = backfilling forensic record for changes that
  //                               landed WITHOUT any audit row (mid-run failure,
  //                               race condition, etc.); the supplemental row
  //                               documents the orphaned changes after the fact
  // Schema convention: metadata.recovery_type, metadata.failed_run_error,
  // metadata.orphaned_changes (op-by-op array), metadata.resolving_audit_row_id
  // (forward link to the row that completed the work in the recovery run).
  "audit.gap_recovery",

  // Bulk / sensitive
  "reports.bulk_export",
  "reports.bulk_correct",
  "audit.retention_change",

  // v2 placeholder — scoped permission grants are not in foundation
  "permissions.grant",
  "permissions.revoke",
] as const;

export type DestructiveAction = (typeof DESTRUCTIVE_ACTIONS)[number];

export function isDestructive(action: string): action is DestructiveAction {
  return (DESTRUCTIVE_ACTIONS as readonly string[]).includes(action);
}
