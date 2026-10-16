/**
 * THE MIRROR WRITE SPEC (r1 P2-4) — the ONE place a 7shifts resource's write shape is decided. Pure.
 *
 * Scheduling Phase 1, Task 4 Step 3b. Per resource: its table, its normalizer, the exact column set
 * the normalizer emits, and either the upsert conflict key or the per-user reconcile identity.
 * The sync (Task 7) writes ONLY through this table; tests/sevenshifts-normalize.test.ts pins that
 * every normalizer emits exactly these columns, and Task 5 Step 6b proves each statement against
 * the real 0268 schema in PGlite.
 *
 * Upsert mirrors are keyed by the 7shifts id (`(id)`; labor settings by `(company_id)`) and never
 * deleted (7shifts' own `deleted` flag is kept). Assignments and wages are SNAPSHOT-RECONCILED per
 * user by `reconcile_sevenshifts_user_snapshot` (0268), their only writer.
 */
import { assignmentEdgeKey } from "@/lib/sevenshifts/normalize-shared";
import type { SevenShiftsResource } from "@/lib/sevenshifts/endpoints-shared";

export { assignmentEdgeKey };

export type MirroredResource = Exclude<SevenShiftsResource, "whoami">;
export const MIRRORED_RESOURCES: readonly MirroredResource[] = [
  "locations", "departments", "roles", "users", "assignments", "wages",
  "availabilities", "time_off", "shifts", "time_punches", "labor_settings",
];

/** Named, not referenced: a string survives bundling, and the test maps each name to its function. */
export type NormalizerName =
  | "normalizeLocations" | "normalizeDepartments" | "normalizeRoles" | "normalizeUsers" | "normalizeAvailabilities"
  | "normalizeTimeOff" | "normalizeShifts" | "normalizeTimePunches" | "normalizeLaborSettings" | "normalizeAssignments" | "normalizeWages";

export type MirrorWriteSpec =
  | { mode: "upsert"; table: string; normalizer: NormalizerName; columns: readonly string[]; onConflict: readonly string[] }
  | { mode: "reconcile"; table: string; normalizer: NormalizerName; columns: readonly string[]; reconcileKind: "assignments" | "wages"; identity: readonly string[] };

export const MIRROR_WRITE_SPEC: Record<MirroredResource, MirrorWriteSpec> = {
  locations: {
    mode: "upsert", table: "sevenshifts_locations", normalizer: "normalizeLocations", onConflict: ["id"],
    columns: ["id", "company_id", "name", "timezone", "active"],
  },
  departments: {
    mode: "upsert", table: "sevenshifts_departments", normalizer: "normalizeDepartments", onConflict: ["id"],
    columns: ["id", "location_id", "name"],
  },
  roles: {
    mode: "upsert", table: "sevenshifts_roles", normalizer: "normalizeRoles", onConflict: ["id"],
    columns: ["id", "location_id", "department_id", "name", "active"],
  },
  users: {
    mode: "upsert", table: "sevenshifts_users", normalizer: "normalizeUsers", onConflict: ["id"],
    columns: ["id", "company_id", "first_name", "last_name", "preferred_first_name", "employee_id", "user_type",
      "active", "hire_date", "skill_level", "source_modified_at"],
  },
  availabilities: {
    mode: "upsert", table: "sevenshifts_availabilities", normalizer: "normalizeAvailabilities", onConflict: ["id"],
    columns: ["id", "user_id", "week", "week_to", "repeating", "status", "days", "source_modified_at"],
  },
  time_off: {
    mode: "upsert", table: "sevenshifts_time_off", normalizer: "normalizeTimeOff", onConflict: ["id"],
    columns: ["id", "user_id", "from_date", "to_date", "partial", "from_time", "to_time", "status", "hours", "source_modified_at"],
  },
  shifts: {
    mode: "upsert", table: "sevenshifts_shifts", normalizer: "normalizeShifts", onConflict: ["id"],
    columns: ["id", "user_id", "location_id", "department_id", "role_id", "station_id", "start_at", "end_at",
      "draft", "open", "deleted", "source_modified_at"],
  },
  time_punches: {
    mode: "upsert", table: "sevenshifts_time_punches", normalizer: "normalizeTimePunches", onConflict: ["id"],
    columns: ["id", "user_id", "location_id", "department_id", "role_id", "shift_id", "clocked_in", "clocked_out",
      "break_minutes", "approved", "auto_clocked_out", "deleted", "source_modified_at"],
  },
  labor_settings: {
    mode: "upsert", table: "sevenshifts_labor_settings", normalizer: "normalizeLaborSettings", onConflict: ["company_id"],
    columns: ["company_id", "daily_ot_threshold", "weekly_ot_threshold", "premium_ot_threshold", "consecutive_days_threshold",
      "overtime_enabled", "overtime_by_location_enabled", "multipliers"],
  },
  assignments: {
    mode: "reconcile", table: "sevenshifts_user_assignments", normalizer: "normalizeAssignments", reconcileKind: "assignments",
    identity: ["edge_key"],
    columns: ["edge_key", "user_id", "location_id", "department_id", "role_id", "is_primary"],
  },
  wages: {
    mode: "reconcile", table: "sevenshifts_wages", normalizer: "normalizeWages", reconcileKind: "wages",
    identity: ["user_id", "wage_id", "upcoming"],
    columns: ["user_id", "wage_id", "upcoming", "effective_date", "wage_type", "wage_cents", "role_id"],
  },
};
