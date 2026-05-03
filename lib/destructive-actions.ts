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
