/**
 * Permission table — Foundation Spec v1.2 Section 7.2.
 *
 * Permissions are role-based only. No scoped per-user grants.
 * RLS at the database is the security boundary; this lookup is for UI gating
 * and API route authorization.
 */

import { type RoleCode, getRoleLevel } from "./roles";

export type PermissionKey =
  // Shift overlay
  | "overlay.write.cash"
  | "overlay.write.voids_comps_waste"
  | "overlay.write.customer"
  | "overlay.write.delivery"
  | "overlay.write.staffing"
  | "overlay.write.context"
  | "overlay.write.vendor"
  | "overlay.write.people"
  | "overlay.write.strategic"
  | "overlay.write.executive"
  | "overlay.write.forecast"
  | "overlay.read"
  | "overlay.correct"
  // Checklists
  | "checklist.complete"
  | "checklist.confirm"
  | "checklist.template.write"
  | "checklist.template.enable"
  // Written reports & announcements
  | "written_report.write"
  | "announcement.post"
  | "announcement.acknowledge"
  // Training
  | "training_report.write"
  // Catering
  | "catering.pipeline.write"
  | "catering.customers.write"
  // Vendors
  | "vendor.profile.full_edit"
  | "vendor.profile.trivial_edit"
  | "vendor.lifecycle"
  | "vendor.items.write"
  | "par_levels.write"
  // AI / admin
  | "ai.insights.run"
  | "admin.locations"
  | "admin.users"
  | "view.all_locations";

const PERMISSION_MIN_LEVEL: Record<PermissionKey, number> = {
  // Shift overlay
  "overlay.write.cash":              3,
  "overlay.write.voids_comps_waste": 4,
  "overlay.write.customer":          4,
  "overlay.write.delivery":          4,
  "overlay.write.staffing":          4,
  "overlay.write.context":           4,
  "overlay.write.vendor":            5,
  "overlay.write.people":            5,
  "overlay.write.strategic":         6,
  "overlay.write.executive":         7,
  "overlay.write.forecast":          8,
  "overlay.read":                    4,
  "overlay.correct":                 4,
  // Checklists
  "checklist.complete":              3,
  "checklist.confirm":               3,
  "checklist.template.write":        6,
  "checklist.template.enable":       6.5,
  // Written reports & announcements
  "written_report.write":            3,
  "announcement.post":               5,
  "announcement.acknowledge":        3,
  // Training
  "training_report.write":           3,
  // Catering
  "catering.pipeline.write":         5,
  "catering.customers.write":        5,
  // Vendors
  "vendor.profile.full_edit":        6,
  "vendor.profile.trivial_edit":     5,
  "vendor.lifecycle":                6,
  "vendor.items.write":              5,
  "par_levels.write":                6,
  // AI / admin
  "ai.insights.run":                 6,
  "admin.locations":                 7,
  "admin.users":                     6.5,
  "view.all_locations":              7,
};

export function hasPermission(role: RoleCode, key: PermissionKey): boolean {
  return getRoleLevel(role) >= PERMISSION_MIN_LEVEL[key];
}

export function permissionsForRole(role: RoleCode): PermissionKey[] {
  return (Object.keys(PERMISSION_MIN_LEVEL) as PermissionKey[]).filter((k) =>
    hasPermission(role, k),
  );
}

export function minLevelFor(key: PermissionKey): number {
  return PERMISSION_MIN_LEVEL[key];
}
