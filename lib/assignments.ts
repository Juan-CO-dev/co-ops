import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "./audit";
import { enqueueNotification } from "./notifications";
import { loadTakenTasks } from "./assignment-taken";
import { positionVacancies, takenSurvivesDeparture, validStationTime } from "./assignments-lifecycle-shared";
import { selectAllRows } from "./supabase-paginate";
import { dedupeTakenTasks } from "./assignment-taken-shared";
import { lockLocationContext, type LocationActor } from "./locations";
import { etCalendarDate } from "./operational-day";
import { getRoleLevel, isRoleCode, type RoleCode } from "./roles";
import { loadPresenceFacts, loadSignedInAt, whosHereEnabled } from "./whos-here";
import { personPresence } from "./presence-shared";
import { validStationTrims, type StationTrim } from "./station-schedule-shared";
import {
  canManageAssignee, isTaskType, TASK_TYPES, TASK_MIN_LEVEL, type ShiftBoard, type Station,
  validOverrideReason, type OverrideReason, type OverrideReasonCode, type AssignmentChange,
  type StationEvent, type TaskAssignment, type TaskType,
} from "./assignments-shared";

export interface AssignmentActor extends LocationActor { userId: string; level: number }
export class AssignmentError extends Error {
  constructor(public code: string, public status: number = 403) { super(code); }
}
const today = () => etCalendarDate(new Date().toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireLocation(actor: AssignmentActor, locationId: string): void {
  if (!UUID.test(locationId)) throw new AssignmentError("invalid_payload", 400);
  if (!lockLocationContext(actor, locationId)) throw new AssignmentError("location_access_denied");
}
function requireUuid(value: string): void {
  if (!UUID.test(value)) throw new AssignmentError("invalid_payload", 400);
}
/** Releases the system writes (0230 + 0233); their reason is a trail, never an override reason. */
const SYSTEM_RELEASES = ["station_closed", "clocked_out", "on_break", "ended_shift", "shop_closed"];
function dbError(error: { message: string; code?: string }, context?: "position_name"): never {
  if (error.code === "23505" && context === "position_name") throw new AssignmentError("position_name_taken", 409);
  if (error.code === "23505") throw new AssignmentError("assignment_already_active", 409);
  const known = ["station_closed", "clocked_out", "on_break", "override_reason_required", "position_taken", "station_locked", "role_insufficient", "location_access_denied", "assignee_unavailable", "self_assignment", "station_unavailable", "assignment_not_found", "invalid_payload"];
  const code = known.find((candidate) => error.message === candidate);
  if (code) throw new AssignmentError(code, code === "override_reason_required" ? 422 : code === "position_taken" ? 409 : code === "assignment_not_found" ? 404 : code === "invalid_payload" ? 400 : 403);
  throw new Error(`assignments database failure: ${error.code ?? "unknown"}`);
}

interface AssignmentWriteResult {
  id: string; changed: boolean; overridden_assigner_id?: string | null;
  reason_code?: OverrideReasonCode | null; reason_note?: string | null;
}
function reasonParams(args: OverrideReason) {
  if (!validOverrideReason(args.reasonCode, args.reasonNote)) throw new AssignmentError("invalid_payload", 400);
  return { p_reason_code: args.reasonCode ?? null, p_reason_note: args.reasonNote?.trim() || null };
}
function overrideMetadata(result: AssignmentWriteResult) {
  return { reason_code: result.reason_code ?? null, reason_note: result.reason_note ?? null,
    overridden_assigner_id: result.overridden_assigner_id ?? null };
}
/** Best effort like audit: the committed change must not appear to fail on a bell outage. */
async function notifyOverride(service: SupabaseClient, actor: AssignmentActor, locationId: string,
  table: string, result: AssignmentWriteResult): Promise<void> {
  if (!result.changed || !result.overridden_assigner_id) return;
  try {
    await enqueueNotification(service, { type: "assignment_override", priority: "info",
      titleKey: "assignments.notificationTitle", bodyKey: "assignments.notificationBody",
      title: "Your assignment was changed", relatedTable: table, relatedId: result.id,
      locationId, createdBy: actor.userId, extraData: overrideMetadata(result),
      recipients: [{ userId: result.overridden_assigner_id, deliveryMethod: "in_app" }] });
  } catch { console.error("assignment override notification failed"); }
}

/** Callers bind location first. Assignments delegate work; they never remove KH authority. */
export async function hasTaskAccess(service: SupabaseClient, args: {
  userId: string; level: number; locationId: string; date: string; task: TaskType;
}): Promise<boolean> {
  if (!isTaskType(args.task) || args.level < TASK_MIN_LEVEL[args.task]) return false;
  if (args.level >= 4) return true;
  if (args.date !== today()) return false;
  // Stored assignments to inactive or transferred employees confer no access.
  try { if (await targetLevel(service, args.userId, args.locationId) < TASK_MIN_LEVEL[args.task]) return false; }
  catch (error) {
    if (error instanceof AssignmentError && error.code === "assignee_unavailable") return false;
    throw error;
  }
  const { data, error } = await service.from("report_assignments").select("id")
    .eq("assignee_id", args.userId).eq("report_type", args.task)
    .eq("location_id", args.locationId).eq("operational_date", args.date)
    .eq("active", true).limit(1).maybeSingle();
  if (error) dbError(error);
  return !!data;
}

/** Called for mutations only, never history reads. One row identifies every overridden assignment. */
export async function auditTaskOverride(service: SupabaseClient, args: {
  userId: string; role: RoleCode; level: number; locationId: string; date: string;
  task: TaskType; operation: string;
}): Promise<void> {
  if (args.level < 4) return;
  // Audit is fail-open, including its context lookup, just like audit() itself.
  try {
    const { data, error } = await service.from("report_assignments").select("id,assignee_id")
      .eq("report_type", args.task).eq("location_id", args.locationId)
      .eq("operational_date", args.date).eq("active", true).neq("assignee_id", args.userId);
    if (error) throw error;
    if (!data?.length) return;
    await audit({ actorId: args.userId, actorRole: args.role, action: "task.override",
      resourceTable: "report_assignments", resourceId: null,
      metadata: { location_id: args.locationId, operational_date: args.date, task: args.task,
        operation: args.operation, assignments: data }, ipAddress: null, userAgent: null });
  } catch { console.error("task.override audit context lookup failed"); }
}

/** Live target validation, repeated by RPC under its transaction lock. */
async function targetLevel(service: SupabaseClient, userId: string, locationId: string): Promise<number> {
  requireUuid(userId);
  const { data: user, error } = await service.from("users").select("role")
    .eq("id", userId).eq("active", true).maybeSingle<{ role: string }>();
  if (error) dbError(error);
  if (!user || !isRoleCode(user.role)) throw new AssignmentError("assignee_unavailable");
  const level = getRoleLevel(user.role);
  if (level < 9) {
    const { data, error: membershipError } = await service.from("user_locations").select("user_id")
      .eq("user_id", userId).eq("location_id", locationId).eq("active", true).maybeSingle();
    if (membershipError) dbError(membershipError);
    if (!data) throw new AssignmentError("assignee_unavailable");
  }
  return level;
}

export async function writeStationEvent(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; userId: string; stationId: string | null; positionId: string | null; manage?: boolean;
} & OverrideReason): Promise<{ id: string }> {
  requireLocation(args.actor, args.locationId);
  requireUuid(args.userId);
  if (args.stationId !== null) requireUuid(args.stationId);
  if (args.positionId !== null) requireUuid(args.positionId);
  if ((args.manage || args.userId !== args.actor.userId) && args.actor.level < 4) throw new AssignmentError("role_insufficient");
  const reason = reasonParams(args);
  const level = await targetLevel(service, args.userId, args.locationId);
  if ((args.manage || args.userId !== args.actor.userId) && !canManageAssignee(args.actor.level, level)) throw new AssignmentError("role_insufficient");
  // The RPC reads the current head inside the same lock as INSERT. A stale claim
  // cannot erase an assignment made between an app read and this write.
  const { data, error } = await service.rpc("write_station_event", {
    p_actor_id: args.actor.userId, p_user_id: args.userId,
    p_location_id: args.locationId, p_station_id: args.stationId,
    p_position_id: args.positionId,
    p_manage: args.manage ?? false,
    ...reason,
  });
  if (error) dbError(error);
  const result = data as AssignmentWriteResult;
  if (result.changed) await audit({ actorId: args.actor.userId, actorRole: args.actor.role,
    action: "station.event", resourceTable: "station_events", resourceId: result.id,
    metadata: { location_id: args.locationId, user_id: args.userId, station_id: args.stationId, position_id: args.positionId, ...overrideMetadata(result) }, ipAddress: null, userAgent: null });
  await notifyOverride(service, args.actor, args.locationId, "station_events", result);
  return { id: result.id };
}

/** Break is a availability transition, not an assignment override or task edit. */
export async function writeStationBreak(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; userId: string; onBreak: boolean;
}): Promise<{ id: string | null }> {
  requireLocation(args.actor, args.locationId);
  requireUuid(args.userId);
  if (typeof args.onBreak !== "boolean") throw new AssignmentError("invalid_payload", 400);
  if (args.actor.userId !== args.userId && args.actor.level < 4) throw new AssignmentError("role_insufficient");
  const level = await targetLevel(service, args.userId, args.locationId);
  if (args.actor.userId !== args.userId && !canManageAssignee(args.actor.level, level)) throw new AssignmentError("role_insufficient");
  const { data, error } = await service.rpc("write_station_break", {
    p_actor_id: args.actor.userId, p_user_id: args.userId, p_location_id: args.locationId, p_on_break: args.onBreak,
  });
  if (error) dbError(error);
  const result = data as { id: string | null; changed: boolean };
  if (result.changed) await audit({ actorId: args.actor.userId, actorRole: args.actor.role,
    action: "station.break", resourceTable: "station_break_events", resourceId: result.id,
    metadata: { location_id: args.locationId, user_id: args.userId, on_break: args.onBreak }, ipAddress: null, userAgent: null });
  return { id: result.id };
}

/**
 * "End my shift" (self) or a KH+ ends someone else's (0233). Releases the station and unassigns open
 * tasks with the "Left open · X ended shift" trail. Same authority as a break; the 0228 reason rule
 * applies when the target holds work given by a higher level (the RPC decides under its lock).
 */
export async function endShift(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; userId: string;
} & OverrideReason): Promise<{ id: string; changed: boolean }> {
  if (!whosHereEnabled()) throw new AssignmentError("not_enabled", 404);
  requireLocation(args.actor, args.locationId);
  requireUuid(args.userId);
  const self = args.actor.userId === args.userId;
  if (!self && args.actor.level < 4) throw new AssignmentError("role_insufficient");
  const reason = reasonParams(args);
  const level = await targetLevel(service, args.userId, args.locationId);
  if (!self && !canManageAssignee(args.actor.level, level)) throw new AssignmentError("role_insufficient");
  const { data, error } = await service.rpc("end_shift", {
    p_actor_id: args.actor.userId, p_user_id: args.userId, p_location_id: args.locationId, ...reason,
  });
  if (error) dbError(error);
  const result = data as AssignmentWriteResult & { released_station?: boolean; released_tasks?: number };
  if (result.changed) await audit({ actorId: args.actor.userId, actorRole: args.actor.role,
    action: "shift.end", resourceTable: "shift_ends", resourceId: result.id,
    metadata: { location_id: args.locationId, user_id: args.userId, self, released_station: result.released_station ?? false,
      released_tasks: result.released_tasks ?? 0, ...overrideMetadata(result) }, ipAddress: null, userAgent: null });
  await notifyOverride(service, args.actor, args.locationId, "shift_ends", result);
  return { id: result.id, changed: result.changed };
}

/** GM+ daily schedule settings; level 8+ may configure any shop. */
export async function saveStationTiming(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; stationId: string; positionId?: string;
  usuallyClosesAt?: string | null; usuallyTrimsAt?: string | null; trims?: StationTrim[];
}): Promise<{ id: string }> {
  requireUuid(args.locationId);
  requireUuid(args.stationId);
  if (args.actor.level < 7) throw new AssignmentError("role_insufficient");
  if (args.actor.level < 8) requireLocation(args.actor, args.locationId);
  const user = await service.from("users").select("role").eq("id", args.actor.userId).eq("active", true).maybeSingle();
  if (user.error) dbError(user.error);
  if (!user.data || !isRoleCode(user.data.role) || getRoleLevel(user.data.role) < 7)
    throw new AssignmentError("role_insufficient");
  if (getRoleLevel(user.data.role) < 8 && await targetLevel(service, args.actor.userId, args.locationId) < 7)
    throw new AssignmentError("role_insufficient");
  const isPosition = args.positionId !== undefined;
  if (isPosition) requireUuid(args.positionId!);
  const value = isPosition ? args.usuallyTrimsAt : args.usuallyClosesAt;
  if (args.trims !== undefined && (isPosition || !validStationTrims(args.trims))) throw new AssignmentError("invalid_payload", 400);
  if (!validStationTime(value) || (isPosition ? args.usuallyClosesAt !== undefined : args.usuallyTrimsAt !== undefined))
    throw new AssignmentError("invalid_payload", 400);
  let query = isPosition
    ? service.from("station_positions").update({ usually_trims_at: value }).eq("id", args.positionId!).eq("station_id", args.stationId)
    : service.from("stations").update({ usually_closes_at: value, ...(args.trims !== undefined ? { trims: args.trims } : {}) }).eq("id", args.stationId);
  if (isPosition && value !== null) query = query.gt("sort", 1);
  const { data, error } = await query.eq("location_id", args.locationId).select("id").maybeSingle();
  if (error) dbError(error);
  if (!data) throw new AssignmentError("station_unavailable", 404);
  await audit({ actorId: args.actor.userId, actorRole: args.actor.role, action: "station.timing_update",
    resourceTable: isPosition ? "station_positions" : "stations", resourceId: data.id,
    metadata: { location_id: args.locationId, time: value, ...(args.trims !== undefined ? { trims: args.trims } : {}) }, ipAddress: null, userAgent: null });
  return data;
}

export async function assignTask(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; userId: string; task: TaskType; note?: string | null;
} & OverrideReason): Promise<{ id: string }> {
  requireLocation(args.actor, args.locationId);
  if (args.actor.level < 4) throw new AssignmentError("role_insufficient");
  if (args.actor.userId === args.userId) throw new AssignmentError("self_assignment");
  const reason = reasonParams(args);
  if (!isTaskType(args.task) || (args.note != null && (typeof args.note !== "string" || args.note.length > 1000))) throw new AssignmentError("invalid_payload", 400);
  const level = await targetLevel(service, args.userId, args.locationId);
  if (!canManageAssignee(args.actor.level, level) || level < TASK_MIN_LEVEL[args.task]) throw new AssignmentError("role_insufficient");
  const { data, error } = await service.rpc("write_task_assignment", {
    p_actor_id: args.actor.userId, p_location_id: args.locationId,
    p_user_id: args.userId, p_task: args.task, p_note: args.note?.trim() || null, p_assignment_id: null,
    ...reason,
  });
  if (error) dbError(error);
  const result = data as AssignmentWriteResult;
  if (result.changed) await audit({ actorId: args.actor.userId, actorRole: args.actor.role,
    action: "assignment.create", resourceTable: "report_assignments", resourceId: result.id,
    metadata: { location_id: args.locationId, assignee_id: args.userId, report_type: args.task, operational_date: today(), ...overrideMetadata(result) }, ipAddress: null, userAgent: null });
  await notifyOverride(service, args.actor, args.locationId, "report_assignments", result);
  return { id: result.id };
}

export async function retractTask(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; assignmentId: string;
} & OverrideReason): Promise<{ id: string }> {
  requireLocation(args.actor, args.locationId);
  if (args.actor.level < 4) throw new AssignmentError("role_insufficient");
  requireUuid(args.assignmentId);
  const reason = reasonParams(args);
  // Retraction authorizes the actor/shop only; stale or senior assignees cannot lock a task.
  const { data, error } = await service.rpc("write_task_assignment", {
    p_actor_id: args.actor.userId, p_location_id: args.locationId, p_assignment_id: args.assignmentId,
    p_user_id: null, p_task: null, p_note: null,
    ...reason,
  });
  if (error) dbError(error);
  const result = data as AssignmentWriteResult;
  if (result.changed) await audit({ actorId: args.actor.userId, actorRole: args.actor.role,
    action: "assignment.retract", resourceTable: "report_assignments", resourceId: result.id,
    metadata: { location_id: args.locationId, ...overrideMetadata(result) }, ipAddress: null, userAgent: null });
  await notifyOverride(service, args.actor, args.locationId, "report_assignments", result);
  return { id: result.id };
}

export async function saveStationSpanish(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; id: string; nameEs: string;
}): Promise<{ id: string }> {
  if (!UUID.test(args.locationId) || (args.actor.level < 8 && !lockLocationContext(args.actor, args.locationId)))
    throw new AssignmentError("location_access_denied");
  if (args.actor.level < 7) throw new AssignmentError("role_insufficient");
  requireUuid(args.id);
  if (typeof args.nameEs !== "string" || args.nameEs.length > 100) throw new AssignmentError("invalid_payload", 400);
  // Re-read membership/active role before service-role config writes too.
  if (args.actor.level >= 8) {
    const user = await service.from("users").select("role").eq("id", args.actor.userId).eq("active", true).maybeSingle();
    if (user.error) dbError(user.error);
    if (!user.data || !isRoleCode(user.data.role) || getRoleLevel(user.data.role) < 8)
      throw new AssignmentError("role_insufficient");
  } else if (await targetLevel(service, args.actor.userId, args.locationId) < 7)
    throw new AssignmentError("role_insufficient");
  const station = await service.from("stations").select("id,name")
    .eq("id", args.id).eq("location_id", args.locationId).eq("active", true).maybeSingle();
  if (station.error) dbError(station.error);
  if (!station.data) throw new AssignmentError("station_unavailable", 404);
  const closing = await service.from("checklist_templates").select("id,effective_from,created_at")
    .eq("location_id", args.locationId).eq("type", "closing").eq("active", true);
  if (closing.error) dbError(closing.error);
  const latest = (closing.data ?? []).sort((a, b) =>
    (b.effective_from ?? "").localeCompare(a.effective_from ?? "") || b.created_at.localeCompare(a.created_at))[0];
  if (!latest) throw new AssignmentError("station_unavailable", 404);
  const labels = await service.from("checklist_template_items").select("translations")
    .eq("template_id", latest.id).eq("station", station.data.name).eq("active", true);
  if (labels.error) dbError(labels.error);
  if ((labels.data ?? []).some((item) => {
    const translations = item.translations as { es?: { station?: string | null } } | null;
    return !!translations?.es?.station?.trim();
  })) throw new AssignmentError("station_translation_from_template", 409);
  const nameEs = args.nameEs.trim() || null;
  const { data, error } = await service.from("stations").update({ name_es: nameEs })
    .eq("id", args.id).eq("location_id", args.locationId).select("id").maybeSingle<{ id: string }>();
  if (error) dbError(error);
  if (!data) throw new AssignmentError("station_unavailable", 404);
  await audit({ actorId: args.actor.userId, actorRole: args.actor.role,
    action: "station.update", resourceTable: "stations", resourceId: data.id,
    metadata: { location_id: args.locationId, name_es: nameEs }, ipAddress: null, userAgent: null });
  return data;
}

/** GM configuration is location-bound even though the service client bypasses RLS. */
export async function saveStationConfig(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; stationId: string;
  operation: "staffed" | "position_create" | "position_update";
  staffed?: boolean; positionId?: string;
  name?: string; nameEs?: string | null; duty?: string | null; dutyEs?: string | null;
  sort?: number; active?: boolean;
}): Promise<{ id: string }> {
  if (!UUID.test(args.locationId) || (args.actor.level < 8 && !lockLocationContext(args.actor, args.locationId)))
    throw new AssignmentError("location_access_denied");
  requireUuid(args.stationId);
  if (args.actor.level < 7) throw new AssignmentError("role_insufficient");
  if (args.actor.level >= 8) {
    const user = await service.from("users").select("role").eq("id", args.actor.userId).eq("active", true).maybeSingle();
    if (user.error) dbError(user.error);
    if (!user.data || !isRoleCode(user.data.role) || getRoleLevel(user.data.role) < 8)
      throw new AssignmentError("role_insufficient");
  } else if (await targetLevel(service, args.actor.userId, args.locationId) < 7)
    throw new AssignmentError("role_insufficient");
  const station = await service.from("stations").select("id,staffed")
    .eq("id", args.stationId).eq("location_id", args.locationId).eq("active", true).maybeSingle();
  if (station.error) dbError(station.error);
  if (!station.data) throw new AssignmentError("station_unavailable", 404);
  let id: string;
  let action: "station.staffing_update" | "station.position_create" | "station.position_update";
  let changedFields: Record<string, unknown> = {};
  if (args.operation === "staffed") {
    if (typeof args.staffed !== "boolean") throw new AssignmentError("invalid_payload", 400);
    const result = await service.from("stations").update({ staffed: args.staffed })
      .eq("id", args.stationId).eq("location_id", args.locationId).select("id").maybeSingle();
    if (result.error) dbError(result.error);
    if (!result.data) throw new AssignmentError("station_unavailable", 404);
    id = result.data.id; action = "station.staffing_update";
    // Turning a station off keeps current holders through the shift; new claims are refused.
  } else {
    const name = args.name?.trim();
    const nameEs = args.nameEs?.trim() || null;
    const duty = args.duty?.trim() || null;
    const dutyEs = args.dutyEs?.trim() || null;
    if (!name || name.length > 100 || (nameEs?.length ?? 0) > 100 ||
      (duty?.length ?? 0) > 500 || (dutyEs?.length ?? 0) > 500 ||
      !Number.isInteger(args.sort) || args.sort! < 1 || args.sort! > 100 ||
      typeof args.active !== "boolean") throw new AssignmentError("invalid_payload", 400);
    const fields = { name, name_es: nameEs, duty, duty_es: dutyEs, sort: args.sort, active: args.active, ...(args.sort === 1 ? { usually_trims_at: null } : {}) };
    // Deactivating a position keeps its current holder; new claims are refused.
    if (args.operation === "position_update") {
      if (!args.positionId) throw new AssignmentError("invalid_payload", 400);
      requireUuid(args.positionId);
    }
    const result = args.operation === "position_create"
      ? await service.from("station_positions").insert({ ...fields, station_id: args.stationId, location_id: args.locationId }).select("id").single()
      : await service.from("station_positions").update(fields).eq("id", args.positionId!)
        .eq("station_id", args.stationId).eq("location_id", args.locationId).select("id").maybeSingle();
    if (result.error) dbError(result.error, "position_name");
    if (!result.data) throw new AssignmentError("station_unavailable", 404);
    id = result.data.id;
    action = args.operation === "position_create" ? "station.position_create" : "station.position_update";
    changedFields = fields;
  }
  await audit({ actorId: args.actor.userId, actorRole: args.actor.role, action,
    resourceTable: action === "station.staffing_update" ? "stations" : "station_positions", resourceId: id,
    metadata: { location_id: args.locationId, station_id: args.stationId, operation: args.operation,
      staffed: args.operation === "staffed" ? args.staffed : station.data.staffed,
      position_id: id, ...changedFields }, ipAddress: null, userAgent: null });
  return { id };
}

/** A station-widget failure must not erase the actor's independently assigned task tiles. */
export async function loadOwnTaskAssignments(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; date: string;
}): Promise<TaskAssignment[]> {
  requireLocation(args.actor, args.locationId);
  if (args.date !== today()) throw new AssignmentError("invalid_payload", 400);
  let level: number;
  try { level = await targetLevel(service, args.actor.userId, args.locationId); }
  catch (error) {
    if (error instanceof AssignmentError && error.code === "assignee_unavailable") return [];
    throw error;
  }
  const tasks: TaskAssignment[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await service.from("report_assignments")
      .select("id,report_type,assignee_id,assigner_id,note")
      .eq("location_id", args.locationId).eq("operational_date", args.date)
      .eq("assignee_id", args.actor.userId).eq("active", true).order("id")
      .range(offset, offset + 499);
    if (error) dbError(error);
    for (const row of data ?? []) {
      if (isTaskType(row.report_type) && level >= TASK_MIN_LEVEL[row.report_type]) tasks.push({
        id: row.id, task: row.report_type, assigneeId: row.assignee_id, assignerId: row.assigner_id,
        assignerName: null, note: row.note, available: true,
      });
    }
    if ((data ?? []).length < 500) break;
  }
  return tasks;
}

/** Metadata-only team board for every shop member. Write gates remain independent. */
export async function loadShiftBoard(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; date: string;
}): Promise<ShiftBoard> {
  requireLocation(args.actor, args.locationId);
  if (args.date !== today()) throw new AssignmentError("invalid_payload", 400);
  const { data: stationDate, error: dayError } = await service.rpc("station_business_date", { p_location_id: args.locationId });
  if (dayError) dbError(dayError);
  if (typeof stationDate !== "string") throw new Error("Station business date unavailable");
  const stationsResult = await service.from("stations").select("id,name,name_es,sort,active,staffed,usually_closes_at,trims")
    .eq("location_id", args.locationId).order("sort").order("name");
  if (stationsResult.error) dbError(stationsResult.error);
  const positionsResult = await service.from("station_positions").select("id,station_id,name,name_es,duty,duty_es,sort,active,usually_trims_at")
    .eq("location_id", args.locationId).order("sort").order("name");
  if (positionsResult.error) dbError(positionsResult.error);
  const closureResult = await service.rpc("station_closures", { p_location_id: args.locationId, p_day: stationDate });
  if (closureResult.error) dbError(closureResult.error);
  const closures = new Map<string, string>((closureResult.data ?? []).map((row: { station_id: string; closed_at: string }) => [row.station_id, row.closed_at]));
  const breakRows = await selectAllRows<{ user_id: string; on_break: boolean }>((from, to) =>
    service.from("station_break_events").select("user_id,on_break").eq("location_id", args.locationId)
      .eq("business_date", stationDate).order("sequence").range(from, to));
  const breaks = new Map(breakRows.map((row) => [row.user_id, row.on_break]));
  const departureRows = await selectAllRows<{ user_id: string; out_at: string }>((from, to) =>
    service.from("station_departures").select("user_id,out_at").eq("location_id", args.locationId)
      .eq("business_date", args.date).order("out_at").order("user_id").range(from, to));
  const departures = new Map(departureRows.map((row) => [row.user_id, row.out_at]));
  const departureReason = new Map<string, "clocked_out" | "ended_shift">(departureRows.map((row) => [row.user_id, "clocked_out"]));
  // 0233: "End my shift" is a departure too (taken tasks before it stop counting as held).
  const whosHere = whosHereEnabled();
  const presenceFacts = whosHere ? await loadPresenceFacts(service, { locationId: args.locationId, stationDate, date: args.date }) : null;
  for (const [userId, at] of presenceFacts?.endedAt ?? []) {
    const prior = departures.get(userId);
    if (!prior || Date.parse(at) > Date.parse(prior)) { departures.set(userId, at); departureReason.set(userId, "ended_shift"); }
  }
  const stations: Station[] = (stationsResult.data ?? []).map((row) => ({
    id: row.id, name: row.name, nameEs: row.name_es, sort: row.sort, active: row.active, staffed: row.staffed, usuallyClosesAt: row.usually_closes_at, trims: row.trims ?? [], closedAt: closures.get(row.id) ?? null,
    positions: (positionsResult.data ?? []).filter((p) => p.station_id === row.id).map((p) => ({
      id: p.id, stationId: p.station_id, name: p.name, nameEs: p.name_es, duty: p.duty,
      dutyEs: p.duty_es, sort: p.sort, active: p.active, usuallyTrimsAt: p.usually_trims_at,
    })),
  }));
  // Paginate history so the API row limit cannot quietly restore an old head.
  const eventRows: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += 500) {
    const query = service.from("station_events").select("id,sequence::text,location_id,business_date,user_id,station_id,position_id,kind,actor_id,at,source,reason_code,reason_note,overridden_assigner_id,prior_position_id,effective_at")
      .eq("location_id", args.locationId).eq("business_date", stationDate).order("sequence");
    const { data, error } = await query.range(offset, offset + 499);
    if (error) dbError(error);
    eventRows.push(...(data ?? []));
    if ((data ?? []).length < 500) break;
  }
  const taskRows: Array<{ id: string; report_type: string; assignee_id: string; assigner_id: string; note: string | null; created_at: string }> = [];
  for (let offset = 0; ; offset += 500) {
    const taskQuery = service.from("report_assignments").select("id,report_type,assignee_id,assigner_id,note,created_at")
      .eq("location_id", args.locationId).eq("operational_date", args.date).eq("active", true)
      .in("report_type", [...TASK_TYPES]).order("id");
    const { data, error } = await taskQuery.range(offset, offset + 499);
    if (error) dbError(error);
    taskRows.push(...(data ?? []));
    if ((data ?? []).length < 500) break;
  }
  const taskResult = { data: taskRows };
  const changes: Array<{ assignment_id: string; report_type: string; actor_id: string | null; kind: string; created_at: string; subject_user_id: string | null; effective_at: string | null;
    reason_code: OverrideReasonCode | "clocked_out" | "ended_shift" | "shop_closed" | null; reason_note: string | null; overridden_assigner_id: string | null }> = [];
  for (let offset = 0; ; offset += 500) {
    const result = await service.from("assignment_changes")
      .select("assignment_id,report_type,actor_id,kind,created_at,reason_code,reason_note,overridden_assigner_id,subject_user_id,effective_at")
      .eq("location_id", args.locationId).eq("operational_date", args.date).order("created_at").order("id")
      .range(offset, offset + 499);
    if (result.error) dbError(result.error);
    changes.push(...(result.data ?? []));
    if ((result.data ?? []).length < 500) break;
  }
  const takenHistory = await loadTakenTasks(service, { locationId: args.locationId, date: args.date, includeHistory: true });
  // r1 P2-7: the shop's close ends "taken" ownership too (no vacancy: nobody covers a closed shop).
  const shopClosedAt = presenceFacts?.shopClosedAt ?? undefined;
  const taken = dedupeTakenTasks(takenHistory.filter((row) => takenSurvivesDeparture(row.at, departures.get(row.userId))
    && takenSurvivesDeparture(row.at, shopClosedAt)));
  const membershipQuery = service.from("user_locations").select("user_id")
    .eq("location_id", args.locationId).eq("active", true);
  const membership = await membershipQuery;
  if (membership.error) dbError(membership.error);
  const rosterIds = new Set<string>((membership.data ?? []).map((row) => row.user_id));
  rosterIds.add(args.actor.userId);
  // An all-location owner may be assigned here without a user_locations row.
  for (const task of taskRows) rosterIds.add(task.assignee_id);
  for (const task of taken) rosterIds.add(task.userId);
  for (const event of eventRows) rosterIds.add(String(event.user_id));
  for (const row of breakRows) rosterIds.add(row.user_id);
  for (const row of departureRows) rosterIds.add(row.user_id);
  // A linked, clocked-in all-shops account (no membership row) still belongs on today's board.
  for (const userId of presenceFacts?.toast.keys() ?? []) rosterIds.add(userId);
  const namesNeeded = new Set([...rosterIds, ...eventRows.flatMap((row) => row.actor_id ? [String(row.actor_id)] : []),
    ...eventRows.map((row) => String(row.user_id)), ...changes.flatMap((row) => row.actor_id ? [row.actor_id] : []),
    ...(taskResult.data ?? []).map((row) => String(row.assigner_id))]);
  const users: Array<{ id: string; name: string; role: string; active: boolean }> = [];
  const ids = [...namesNeeded];
  for (let i = 0; i < ids.length; i += 100) {
    const result = await service.from("users").select("id,name,role,active").in("id", ids.slice(i, i + 100));
    if (result.error) dbError(result.error);
    users.push(...(result.data ?? []));
  }
  const names = new Map(users.map((user) => [user.id, user.name]));
  const levels = new Map(users.map((user) => [user.id, isRoleCode(user.role) ? getRoleLevel(user.role) : 0]));
  const changeView = (row: { actor_id: string | null; reason_code: string | null; reason_note: string | null;
    overridden_assigner_id: string | null }, at: string): AssignmentChange => ({
    actorName: (row.actor_id ? names.get(row.actor_id) : null) ?? null, at, reasonCode: row.reason_code as OverrideReasonCode | null,
    reasonNote: row.reason_note, overriddenAssignerId: row.overridden_assigner_id,
  });
  const events: StationEvent[] = eventRows.map((row) => ({
    id: String(row.id), sequence: String(row.sequence), locationId: String(row.location_id), businessDate: String(row.business_date),
    userId: String(row.user_id), stationId: row.station_id as string | null, positionId: row.position_id as string | null, kind: row.kind as StationEvent["kind"],
    actorId: row.actor_id ? String(row.actor_id) : null, actorName: names.get(String(row.actor_id)) ?? null, at: String(row.at), source: row.source as StationEvent["source"],
    actorLevel: levels.get(String(row.actor_id)),
    priorPositionId: row.prior_position_id as string | null, effectiveAt: row.effective_at as string | null,
    releaseReason: SYSTEM_RELEASES.includes(String(row.reason_code)) ? row.reason_code as StationEvent["releaseReason"] : undefined,
    change: !SYSTEM_RELEASES.includes(String(row.reason_code)) && (row.reason_code || row.reason_note) ? changeView({ actor_id: String(row.actor_id),
      reason_code: row.reason_code as OverrideReasonCode | null, reason_note: row.reason_note as string | null,
      overridden_assigner_id: row.overridden_assigner_id as string | null }, String(row.at)) : undefined,
  }));
  const heads = new Map<string, StationEvent>();
  for (const event of events) heads.set(event.userId, event);
  const occupiedPositions = [...heads.values()].filter((event) => event.positionId).map((event) => ({
    positionId: event.positionId!, firstName: (names.get(event.userId) ?? "").trim().split(/\s+/)[0] || "?",
  }));
  const members = new Set((membership.data ?? []).map((row) => row.user_id));
  const available = new Set(users.filter((user) => user.active && isRoleCode(user.role)
    && (getRoleLevel(user.role) >= 9 || members.has(user.id))).map((user) => user.id));
  const tasks: TaskAssignment[] = (taskResult.data ?? []).filter((row) => isTaskType(row.report_type)).map((row) => ({
    id: row.id, task: row.report_type as TaskType, assigneeId: row.assignee_id, assignerId: row.assigner_id,
    assignerName: names.get(row.assigner_id) ?? null, note: row.note, available: available.has(row.assignee_id),
    assigneeName: names.get(row.assignee_id) ?? null, assignerLevel: levels.get(row.assigner_id), source: "assigned", at: row.created_at,
    change: (() => { const change = changes.filter((c) => c.assignment_id === row.id && (c.reason_code || c.reason_note)).at(-1);
      return change ? changeView(change, change.created_at) : undefined; })(),
  }));
  for (const row of taken) {
    if (tasks.some((task) => task.task === row.task && task.assigneeId === row.userId)) continue;
    tasks.push({ id: row.id, task: row.task, assigneeId: row.userId, assignerId: row.userId,
      assigneeName: names.get(row.userId) ?? null, assignerName: null, note: null,
      source: "taken", at: row.at, available: available.has(row.userId) });
  }
  const people = users.filter((user) => isRoleCode(user.role) &&
      (available.has(user.id) || tasks.some((task) => task.assigneeId === user.id) || events.some((event) => event.userId === user.id)
        || !!presenceFacts?.toast.has(user.id)))
      .map((user) => ({ id: user.id, name: user.name, available: available.has(user.id), onBreak: breaks.get(user.id) ?? false, level: isRoleCode(user.role) ? getRoleLevel(user.role) : 0,
        hasWork: !!heads.get(user.id)?.stationId || tasks.some((task) => task.assigneeId === user.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  let presentPeople: ShiftBoard["people"] = people;
  if (presenceFacts) {
    const signedIn = await loadSignedInAt(service, { locationId: args.locationId, stationDate, date: args.date, userIds: people.map((p) => p.id) });
    const latest = (values: Array<string | undefined>) => values.filter((v): v is string => !!v).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
    presentPeople = people.map((person) => {
      const head = heads.get(person.id);
      const held = tasks.filter((task) => task.assigneeId === person.id && task.available !== false);
      // Who gave them what they hold: an assigned station's author and every open assigned task's assigner.
      const givers = [head?.stationId && head.source === "assigned" ? head.actorLevel : undefined,
        ...held.filter((task) => task.source !== "taken").map((task) => task.assignerLevel)].filter((v): v is number => typeof v === "number");
      return { ...person,
        heldFromLevel: givers.length ? Math.max(...givers) : undefined,
        presence: personPresence({ entries: presenceFacts.toast.get(person.id) ?? [] }, {
          stationAt: head?.stationId ? head.at : null, taskAt: latest(held.map((task) => task.at)),
          signedInAt: signedIn.get(person.id) ?? null, endedAt: presenceFacts.endedAt.get(person.id) ?? null,
          shopClosedAt: presenceFacts.shopClosedAt,
        }) };
    });
  }
  return { locationId: args.locationId, date: args.date, stationDate, viewerId: args.actor.userId, viewerLevel: args.actor.level,
    ...(whosHere ? { whosHere: true } : {}),
    stations, events, positionVacancies: positionVacancies(events, breaks, names),
    taskVacancies: [...[...new Map(changes.map((row) => [row.report_type, row])).values()]
      // The shop's close is not a vacancy: nobody is expected to cover a closed shop.
      .filter((row) => row.kind === "auto_release" && row.reason_code !== "shop_closed" && isTaskType(row.report_type) && row.subject_user_id && row.effective_at)
      .map((row) => ({ task: row.report_type as TaskType, userId: row.subject_user_id!, name: names.get(row.subject_user_id!) ?? "", at: row.effective_at!,
        reason: row.reason_code === "ended_shift" ? "ended_shift" as const : "clocked_out" as const })),
      ...dedupeTakenTasks(takenHistory.filter((row) => !takenSurvivesDeparture(row.at, departures.get(row.userId))))
        .filter((row) => !changes.some((change) => change.report_type === row.task))
        .map((row) => ({ task: row.task, userId: row.userId, name: names.get(row.userId) ?? "", at: departures.get(row.userId)!,
          reason: departureReason.get(row.userId) ?? "clocked_out" }))],
    taskChanges: changes.filter((row) => row.kind === "retract" && isTaskType(row.report_type))
      .map((row) => ({ task: row.report_type as TaskType, change: changeView(row, row.created_at) })),
    occupiedPositions, tasks, people: presentPeople,
  };
}
