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
  "user.reset_password",
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

  // Role-model renumber (Phase 3 — C.41 collision fix, migration 0058).
  // One-shot 0-10 scale renumber of current_user_role_level() + the
  // users.role CHECK + every role-level RLS threshold. Destructive because it
  // alters the authorization semantics of every gated table at once; the
  // migration-emitted audit row sets destructive=true directly (SQL-side, not
  // via isDestructive()).
  "role_model.renumber",

  // Vendor lifecycle
  "vendor.create",
  "vendor.activate",
  "vendor.deactivate",
  "vendor.full_profile_edit",
  // Vendor sub-resource changes (Vendor Directory v2, Slice A).
  // — vendor.contact_change covers add/update/remove of a vendor_contacts row
  //   (op carried in metadata.op = add|update|remove); vendor.ordering_change
  //   covers the same for vendor_ordering_details. Auto-derive destructive=true
  //   via isDestructive(). Append-only (remove = active=false; last-row removal
  //   blocked at the lib).
  "vendor.contact_change",
  "vendor.ordering_change",

  // SKU catalog lifecycle (Item/Inventory Spine — vendor mini-arc, Slice C1).
  // — vendor_items are the purchasable units. create/update/deactivate/activate
  //   on the catalog (GM+); vendor_id is nullable (manual/vendor-less SKUs) and
  //   update may reassign it (incl. → null). Append-only (deactivate = active=false).
  //   Auto-derive destructive=true via isDestructive().
  "vendor_item.create",
  "vendor_item.update",
  "vendor_item.activate",
  "vendor_item.deactivate",
  "item_component.add",
  "item_component.remove",

  // Recipe stage (Derivation Spine sub-project 1). Two-tier recipe entity
  // (production→items / consumer→menu_items) + polymorphic input/output edges +
  // menu_items leaf. Config mutations analogous to item_component.* / vendor_item.* —
  // auto-derive destructive=true via isDestructive() so the audit record is
  // consistently flagged. Writes are service-role + app-gated in lib/recipes.ts
  // (GM+ create/edit; MoO+ for menu_price). Append-only for recipes/menu_items
  // (deactivate via active=false); recipe_input/output are hard-deleted edges with
  // before-state in the audit row (mirrors item_component.remove).
  "recipe.create",
  "recipe.update",
  "recipe.deactivate",
  "recipe_input.add",
  "recipe_input.remove",
  "recipe_output.add",
  "recipe_output.remove",
  "menu_item.create",

  // Category registry (Vendor Directory v2, Slice A).
  // — category.create adds a category to the shared `categories` registry (MoO+,
  //   global). Same "enumerate categorical free-text via registries" principle
  //   as unit.create. Auto-derive destructive=true via isDestructive().
  "category.create",
  // — order_type.create adds an order type to the shared `order_types` registry
  //   (MoO+, global). Mirrors category.create — the traditional supply view
  //   (Produce / Dry Goods / Paper / …). Auto-derive destructive=true.
  "order_type.create",

  // Checklist template lifecycle
  "checklist_template.create",
  "checklist_template.delete_or_deactivate",
  "checklist_template_item.delete",
  // In-place config edit of a prep template item (C.44 Module 3 slice 1).
  // — destructive because it alters operational config (par targets, who can
  // complete a step). Auto-derives destructive=true on the audit row via
  // isDestructive(). Edits are id-preserving; history stays frozen via C.44
  // snapshots. before_state/after_state carry the changed fields.
  "checklist_template_item.update",
  // In-place create of a prep template item (C.44 Module 3 slice 2).
  // — destructive because it alters operational config. Auto-derives
  // destructive=true via isDestructive(). Append-only INSERT (new active row).
  "checklist_template_item.create",

  // Item / inventory registry (Item/Inventory Spine, sub-project 1).
  // — item lifecycle on the new registry. Auto-derive destructive via isDestructive().
  "item.create",
  "item.update",
  "item.backfill",

  // Par layer (Item/Inventory Spine, sub-project 2B).
  // — item_par.update alters operational par config; item.promote_to_global flips
  //   a location item to global (all-locations blast radius). Auto-derive
  //   destructive=true via isDestructive(); append-only / reversible config writes.
  "item_par.update",
  "item.promote_to_global",
  // — item.set_default toggles default-template membership (MoO+); turning it on
  //   propagates enabled lines to every location. Auto-derive destructive.
  "item.set_default",
  // — item.set_opening_verify toggles whether the item is included in Opening
  //   Phase-2 verification (migration 0089); the toggle propagates Opening mirror
  //   create/deactivate across every location's am_prep template. Auto-derive
  //   destructive=true via isDestructive().
  "item.set_opening_verify",
  // — item.set_sold_directly flags a production item as sold-directly + sets sell portion/unit
  //   (Recipe Stage refinement, migration 0105). GM+ (menu_price MoO+). Auto-derive destructive.
  "item.set_sold_directly",
  // — prep_section.update renames a section's display label (MoO+, all-locations).
  "prep_section.update",
  // — prep_section.create adds a section to the registry (MoO+, all-locations).
  "prep_section.create",
  // — prep_section.disable deactivates a section + cascades its active lines to Misc (MoO+).
  "prep_section.disable",
  // — prep_section.reorder swaps a section's display_order with a neighbor (MoO+).
  "prep_section.reorder",
  // — unit.create adds a unit to the standardized registry (MoO+).
  "unit.create",
  // — section_question.create adds a non-inventory section question (MoO+) +
  //   propagates a line onto every prep list with that section.
  "section_question.create",
  // — section_question.disable deactivates a section question + its propagated lines (MoO+).
  "section_question.disable",
  // — item_question.create adds a non-inventory question to an item (MoO+) +
  //   propagates a line onto every prep list where the item appears.
  "item_question.create",
  // — item_question.disable deactivates an item question + its propagated lines (MoO+).
  "item_question.disable",

  // Checklist completion correction (per SPEC_AMENDMENTS.md C.28)
  // — destructive because they alter operational/accountability record.
  // Auto-derived destructive=true on the audit row via isDestructive().
  "checklist_completion.revoke",
  "checklist_completion.tag_actual_completer",

  // Cross-user mark-not-done by authority (per SPEC_AMENDMENTS.md C.55)
  // — a KH+ actor reopening a false completion on someone else's row,
  // bounded by actor.level >= completer current level (at-or-below,
  // peers included). Distinct action from checklist_completion.revoke
  // (C.28's self-only post-60s revoke) so the audit trail separates
  // self-correction from authority-correction. Auto-derived
  // destructive=true on the audit row via isDestructive().
  "checklist_completion.revoke_by_authority",

  // Opening Phase 2 per-item prep revoke (C.53 §8.4 Lane D).
  // — destructive because it withdraws a saved prep completion from the
  // operational/accountability record. Distinct from closing's
  // "checklist_completion.revoke": Phase 2 owns its own thin revoke lib
  // (revokePhase2Completion) with a hierarchical permission gate and a
  // prep-specific reason vocabulary (quick_reenter / re_enter_count / other,
  // per migration 0057). The SILENT quick-window self-revert writes NO audit
  // row — only the STRUCTURED path emits this action.
  "opening.phase2.revoke",

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
