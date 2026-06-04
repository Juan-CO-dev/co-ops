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
  "overlay.write.cash":              3,   // any-staff (unchanged)
  "overlay.write.voids_comps_waste": 5,   // 4 -> 5
  "overlay.write.customer":          5,
  "overlay.write.delivery":          5,
  "overlay.write.staffing":          5,
  "overlay.write.context":           5,
  "overlay.write.vendor":            6,   // 5 -> 6
  "overlay.write.people":            6,
  "overlay.write.strategic":         7,   // 6 -> 7
  "overlay.write.executive":         9,   // 7 -> 9
  "overlay.write.forecast":          10,  // 8 -> 10
  "overlay.read":                    5,   // 4 -> 5
  "overlay.correct":                 5,
  // Checklists
  "checklist.complete":              3,   // any-staff (unchanged)
  "checklist.confirm":               4,   // ⚠ Task 1 decision (default KH+ -> 4)
  "checklist.template.write":        7,   // 6 -> 7
  "checklist.template.enable":       8,   // 6.5 -> 8
  // Written reports & announcements
  "written_report.write":            3,   // any-staff (unchanged)
  "announcement.post":               6,   // 5 -> 6
  "announcement.acknowledge":        3,   // any-staff (unchanged)
  // Training
  "training_report.write":           3,   // any-staff (unchanged)
  // Catering
  "catering.pipeline.write":         6,   // 5 -> 6
  "catering.customers.write":        6,
  // Vendors
  "vendor.profile.full_edit":        7,   // 6 -> 7
  "vendor.profile.trivial_edit":     6,   // 5 -> 6
  "vendor.lifecycle":                7,   // 6 -> 7
  "vendor.items.write":              6,   // 5 -> 6
  "par_levels.write":                7,   // 6 -> 7
  // AI / admin
  "ai.insights.run":                 7,   // 6 -> 7
  "admin.locations":                 9,   // 7 -> 9
  "admin.users":                     8,   // 6.5 -> 8
  "view.all_locations":              9,   // 7 -> 9
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
