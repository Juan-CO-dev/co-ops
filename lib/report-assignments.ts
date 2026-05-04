/**
 * Generic report assignment-down lifecycle — Phase 3 / Module #1 Build #2 PR 1.
 *
 * Serves all six report types via the shared report_type_enum (per
 * SPEC_AMENDMENTS.md C.42; migration 0039). One CRUD module; one audit
 * namespace; one RLS stack.
 *
 * Strict-greater assigner-vs-assignee level (assigner.level > assignee.level)
 * is enforced HERE in the app layer (per migration 0039 RLS notes — RLS
 * can't easily look up the assignee's role across rows). RLS in 0039
 * already gates "any KH+ at the location can insert"; this module adds the
 * canActOn enforcement on top.
 *
 * Audit vocabulary (locked):
 *   - report_assignment.create
 *   - report_assignment.deactivate
 * Both follow Phase 2 dot-namespaced lifecycle convention. Neither is on
 * DESTRUCTIVE_ACTIONS — assignment changes are routine operations
 * (the row is preserved by append-only philosophy on deactivation).
 *
 * RLS-aware client wiring:
 *   - createAssignment / deactivateAssignment use SERVICE-ROLE because they
 *     pair the write with an audit_log insert (RLS denies direct user writes
 *     to audit_log). Pattern matches lib/checklists.ts confirmInstance.
 *   - listAssignmentsForUser / listAssignmentsForLocation use AUTHED CLIENT —
 *     the read policies on report_assignments correctly gate self-reads
 *     (assignee) and admin-reads (level >= 6 within accessible locations).
 *
 * Note (per locked surface): the assignment-creation UI is deferred to a
 * follow-up PR. This module ships the CRUD + consumption path; the dashboard
 * tile reads assignments via lib/prep.ts loadAssignmentForToday() (uses
 * service-role per C.24 page-level reads pattern).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "./audit";
import { canActOn, getRoleLevel, type RoleCode } from "./roles";
import type { ReportAssignment, ReportType } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Actor — minimal shape needed for assignment authorization.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportAssignmentActor {
  userId: string;
  role: RoleCode;
  level: number;
  /** Locations the actor has explicit access to (empty + level >= 7 means all). */
  locations: string[];
}

/**
 * Per C.42: KH+ has assignment authority. Reconciled in Build #2 PR 1
 * cleanup commit to level >= 3 (key_holder is level 3 in current
 * implementation per lib/roles.ts) — same convention as the closing
 * finalize gate per C.26 + C.41 reconciliation. The broader level-number
 * restructure remains deferred to Module #2.
 *
 * Note on the cleanup: this constant was missed during the initial C.41
 * fix because it was introduced in the lib phase carrying forward the
 * (then-current) AM_PREP_BASE_LEVEL = 4 convention. Caught during a
 * follow-up grep sweep (per AGENTS.md "Role-level gate audits must
 * include UI-side gates" durable lesson).
 */
const ASSIGNMENT_BASE_LEVEL = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class ReportAssignmentError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "ReportAssignmentError";
  }
}

export class ReportAssignmentRoleViolationError extends ReportAssignmentError {
  constructor(
    public readonly assignerLevel: number,
    public readonly assigneeLevel: number,
    public readonly required: string,
  ) {
    super(
      `ReportAssignmentRoleViolationError: assigner_level=${assignerLevel}, ` +
        `assignee_level=${assigneeLevel}, required=${required}`,
      "report_assignment_role_violation",
    );
    this.name = "ReportAssignmentRoleViolationError";
  }
}

export class ReportAssignmentLocationAccessError extends ReportAssignmentError {
  constructor(public readonly locationId: string, public readonly assignerLevel: number) {
    super(
      `ReportAssignmentLocationAccessError: actor_level=${assignerLevel} cannot access location ${locationId}`,
      "report_assignment_location_access",
    );
    this.name = "ReportAssignmentLocationAccessError";
  }
}

export class ReportAssignmentDuplicateError extends ReportAssignmentError {
  constructor(
    public readonly reportType: ReportType,
    public readonly locationId: string,
    public readonly operationalDate: string,
    public readonly assigneeId: string,
  ) {
    super(
      `ReportAssignmentDuplicateError: active assignment already exists for ` +
        `(${reportType}, ${locationId}, ${operationalDate}, assignee=${assigneeId})`,
      "report_assignment_duplicate",
    );
    this.name = "ReportAssignmentDuplicateError";
  }
}

export class ReportAssignmentInactiveAssigneeError extends ReportAssignmentError {
  constructor(public readonly assigneeId: string) {
    super(
      `ReportAssignmentInactiveAssigneeError: assignee ${assigneeId} not active or not found`,
      "report_assignment_inactive_assignee",
    );
    this.name = "ReportAssignmentInactiveAssigneeError";
  }
}

export class ReportAssignmentNotFoundError extends ReportAssignmentError {
  constructor(public readonly assignmentId: string) {
    super(
      `ReportAssignmentNotFoundError: assignment ${assignmentId} not found or already inactive`,
      "report_assignment_not_found",
    );
    this.name = "ReportAssignmentNotFoundError";
  }
}

export class ReportAssignmentNotAssignerError extends ReportAssignmentError {
  constructor(public readonly assignmentId: string, public readonly actorId: string) {
    super(
      `ReportAssignmentNotAssignerError: actor ${actorId} is not the assigner of ${assignmentId}`,
      "report_assignment_not_assigner",
    );
    this.name = "ReportAssignmentNotAssignerError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row mapping
// ─────────────────────────────────────────────────────────────────────────────

interface ReportAssignmentRow {
  id: string;
  report_type: ReportType;
  location_id: string;
  operational_date: string;
  assigner_id: string;
  assignee_id: string;
  note: string | null;
  created_at: string;
  active: boolean;
}

const ASSIGNMENT_COLUMNS =
  "id, report_type, location_id, operational_date, assigner_id, assignee_id, note, created_at, active";

function rowToAssignment(r: ReportAssignmentRow): ReportAssignment {
  return {
    id: r.id,
    reportType: r.report_type,
    locationId: r.location_id,
    operationalDate: r.operational_date,
    assignerId: r.assigner_id,
    assigneeId: r.assignee_id,
    note: r.note,
    createdAt: r.created_at,
    active: r.active,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a new active assignment.
 *
 * Pre-flight validation order:
 *   1. assigner.level >= ASSIGNMENT_BASE_LEVEL (KH+ semantic, SL+ in
 *      implementation per C.41).
 *   2. Location access: level >= 7 OR location in actor.locations.
 *   3. Assignee exists, is active, and assigner.level > assignee.level
 *      (strict-greater per canActOn). Self-assign already blocked at DB
 *      via report_assignments_no_self_assign CHECK.
 *   4. No existing active assignment for (reportType, location, date, assignee).
 *      Partial unique index would also catch this, but pre-flight gives a
 *      cleaner error than a 23505.
 */
export async function createAssignment(
  service: SupabaseClient,
  args: {
    reportType: ReportType;
    locationId: string;
    operationalDate: string;
    assigner: ReportAssignmentActor;
    assigneeId: string;
    note?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<{ assignment: ReportAssignment }> {
  // 1. Assigner role floor.
  if (args.assigner.level < ASSIGNMENT_BASE_LEVEL) {
    throw new ReportAssignmentRoleViolationError(
      args.assigner.level,
      0,
      `level >= ${ASSIGNMENT_BASE_LEVEL}`,
    );
  }

  // 2. Location access. Level 7+ has all-locations access; below that,
  //    explicit assignment list.
  const hasAllLocations = args.assigner.level >= 7;
  if (!hasAllLocations && !args.assigner.locations.includes(args.locationId)) {
    throw new ReportAssignmentLocationAccessError(args.locationId, args.assigner.level);
  }

  // 3. Load assignee — confirm active + role for canActOn check.
  const { data: assignee, error: assigneeErr } = await service
    .from("users")
    .select("id, role, active")
    .eq("id", args.assigneeId)
    .maybeSingle<{ id: string; role: RoleCode; active: boolean }>();
  if (assigneeErr) {
    throw new Error(`createAssignment: load assignee: ${assigneeErr.message}`);
  }
  if (!assignee || !assignee.active) {
    throw new ReportAssignmentInactiveAssigneeError(args.assigneeId);
  }

  // canActOn enforces strict-greater: assigner.level > assignee.level.
  if (!canActOn(args.assigner.role, assignee.role)) {
    throw new ReportAssignmentRoleViolationError(
      args.assigner.level,
      getRoleLevel(assignee.role),
      "assigner.level > assignee.level (strict-greater)",
    );
  }

  // 4. Pre-flight duplicate check (cleaner error than 23505).
  const { data: existing, error: existErr } = await service
    .from("report_assignments")
    .select("id")
    .eq("report_type", args.reportType)
    .eq("location_id", args.locationId)
    .eq("operational_date", args.operationalDate)
    .eq("assignee_id", args.assigneeId)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (existErr) {
    throw new Error(`createAssignment: duplicate pre-flight: ${existErr.message}`);
  }
  if (existing) {
    throw new ReportAssignmentDuplicateError(
      args.reportType,
      args.locationId,
      args.operationalDate,
      args.assigneeId,
    );
  }

  // 5. Insert.
  const { data: inserted, error: insertErr } = await service
    .from("report_assignments")
    .insert({
      report_type: args.reportType,
      location_id: args.locationId,
      operational_date: args.operationalDate,
      assigner_id: args.assigner.userId,
      assignee_id: args.assigneeId,
      note: args.note ?? null,
      active: true,
    })
    .select(ASSIGNMENT_COLUMNS)
    .maybeSingle<ReportAssignmentRow>();
  if (insertErr) {
    throw new Error(`createAssignment: insert: ${insertErr.message}`);
  }
  if (!inserted) {
    throw new Error(`createAssignment: insert returned no row`);
  }

  // 6. Audit.
  void audit({
    actorId: args.assigner.userId,
    actorRole: args.assigner.role,
    action: "report_assignment.create",
    resourceTable: "report_assignments",
    resourceId: inserted.id,
    metadata: {
      report_type: args.reportType,
      location_id: args.locationId,
      operational_date: args.operationalDate,
      assigner_id: args.assigner.userId,
      assignee_id: args.assigneeId,
      assignee_role: assignee.role,
      note: args.note ?? null,
    },
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  });

  return { assignment: rowToAssignment(inserted) };
}

/**
 * Deactivates (retracts) an existing assignment by setting active=false.
 * Append-only philosophy: row is preserved with active=false, never deleted.
 *
 * Pre-flight: only the original assigner can deactivate.
 */
export async function deactivateAssignment(
  service: SupabaseClient,
  args: {
    assignmentId: string;
    actor: ReportAssignmentActor;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<{ assignment: ReportAssignment }> {
  // 1. Load existing.
  const { data: existing, error: readErr } = await service
    .from("report_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("id", args.assignmentId)
    .maybeSingle<ReportAssignmentRow>();
  if (readErr) {
    throw new Error(`deactivateAssignment: load: ${readErr.message}`);
  }
  if (!existing || !existing.active) {
    throw new ReportAssignmentNotFoundError(args.assignmentId);
  }

  // 2. Pre-flight: only assigner can retract.
  if (existing.assigner_id !== args.actor.userId) {
    throw new ReportAssignmentNotAssignerError(args.assignmentId, args.actor.userId);
  }

  // 3. Update.
  const { data: updated, error: updateErr } = await service
    .from("report_assignments")
    .update({ active: false })
    .eq("id", args.assignmentId)
    .select(ASSIGNMENT_COLUMNS)
    .maybeSingle<ReportAssignmentRow>();
  if (updateErr) {
    throw new Error(`deactivateAssignment: update: ${updateErr.message}`);
  }
  if (!updated) {
    throw new Error(`deactivateAssignment: update returned no row`);
  }

  // 4. Audit.
  void audit({
    actorId: args.actor.userId,
    actorRole: args.actor.role,
    action: "report_assignment.deactivate",
    resourceTable: "report_assignments",
    resourceId: args.assignmentId,
    metadata: {
      report_type: existing.report_type,
      location_id: existing.location_id,
      operational_date: existing.operational_date,
      assigner_id: existing.assigner_id,
      assignee_id: existing.assignee_id,
      original_created_at: existing.created_at,
    },
    ipAddress: args.ipAddress ?? null,
    userAgent: args.userAgent ?? null,
  });

  return { assignment: rowToAssignment(updated) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lists active assignments for a user (as assignee) on a given operational
 * date, optionally filtered by report type. Returns an array (may be empty).
 *
 * AUTHED CLIENT — RLS report_assignments_read_self covers the read.
 */
export async function listAssignmentsForUser(
  authed: SupabaseClient,
  args: {
    userId: string;
    operationalDate: string;
    reportType?: ReportType;
  },
): Promise<ReportAssignment[]> {
  let query = authed
    .from("report_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("assignee_id", args.userId)
    .eq("operational_date", args.operationalDate)
    .eq("active", true);
  if (args.reportType) {
    query = query.eq("report_type", args.reportType);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`listAssignmentsForUser: ${error.message}`);
  }
  return ((data ?? []) as ReportAssignmentRow[]).map(rowToAssignment);
}

/**
 * Lists active assignments for a location on a given operational date.
 * Used by admin oversight surfaces.
 *
 * AUTHED CLIENT — RLS report_assignments_read_admin gates this to level >= 6
 * (with location scoping); below-AGM callers see only their own assignments
 * via read_self.
 */
export async function listAssignmentsForLocation(
  authed: SupabaseClient,
  args: {
    locationId: string;
    operationalDate: string;
    reportType?: ReportType;
  },
): Promise<ReportAssignment[]> {
  let query = authed
    .from("report_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("location_id", args.locationId)
    .eq("operational_date", args.operationalDate)
    .eq("active", true);
  if (args.reportType) {
    query = query.eq("report_type", args.reportType);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`listAssignmentsForLocation: ${error.message}`);
  }
  return ((data ?? []) as ReportAssignmentRow[]).map(rowToAssignment);
}
