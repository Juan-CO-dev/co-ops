import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "./audit";
import { lockLocationContext, type LocationActor } from "./locations";
import { etCalendarDate } from "./operational-day";
import { getRoleLevel, isRoleCode, type RoleCode } from "./roles";
import {
  canManageAssignee, isTaskType, TASK_TYPES, TASK_MIN_LEVEL, type ShiftBoard, type Station,
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
function dbError(error: { message: string; code?: string }): never {
  if (error.code === "23505") throw new AssignmentError("assignment_already_active", 409);
  const known = ["station_locked", "role_insufficient", "location_access_denied", "assignee_unavailable", "self_assignment", "station_unavailable", "assignment_not_found", "invalid_payload"];
  const code = known.find((candidate) => error.message === candidate);
  if (code) throw new AssignmentError(code, code === "assignment_not_found" ? 404 : code === "invalid_payload" ? 400 : 403);
  throw new Error(`assignments database failure: ${error.code ?? "unknown"}`);
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
  actor: AssignmentActor; locationId: string; userId: string; stationId: string | null; manage?: boolean;
}): Promise<{ id: string }> {
  requireLocation(args.actor, args.locationId);
  requireUuid(args.userId);
  if (args.stationId !== null) requireUuid(args.stationId);
  if ((args.manage || args.userId !== args.actor.userId) && args.actor.level < 4) throw new AssignmentError("role_insufficient");
  const level = await targetLevel(service, args.userId, args.locationId);
  if ((args.manage || args.userId !== args.actor.userId) && !canManageAssignee(args.actor.level, level)) throw new AssignmentError("role_insufficient");
  // The RPC reads the current head inside the same lock as INSERT. A stale claim
  // cannot erase an assignment made between an app read and this write.
  const { data, error } = await service.rpc("write_station_event", {
    p_actor_id: args.actor.userId, p_user_id: args.userId,
    p_location_id: args.locationId, p_station_id: args.stationId,
    p_manage: args.manage ?? false,
  });
  if (error) dbError(error);
  const result = data as { id: string; changed: boolean };
  if (result.changed) await audit({ actorId: args.actor.userId, actorRole: args.actor.role,
    action: "station.event", resourceTable: "station_events", resourceId: result.id,
    metadata: { location_id: args.locationId, user_id: args.userId, station_id: args.stationId }, ipAddress: null, userAgent: null });
  return { id: result.id };
}

export async function assignTask(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; userId: string; task: TaskType; note?: string | null;
}): Promise<{ id: string }> {
  requireLocation(args.actor, args.locationId);
  if (args.actor.level < 4) throw new AssignmentError("role_insufficient");
  if (args.actor.userId === args.userId) throw new AssignmentError("self_assignment");
  if (!isTaskType(args.task) || (args.note != null && (typeof args.note !== "string" || args.note.length > 1000))) throw new AssignmentError("invalid_payload", 400);
  const level = await targetLevel(service, args.userId, args.locationId);
  if (!canManageAssignee(args.actor.level, level) || level < TASK_MIN_LEVEL[args.task]) throw new AssignmentError("role_insufficient");
  const { data, error } = await service.rpc("write_task_assignment", {
    p_actor_id: args.actor.userId, p_location_id: args.locationId,
    p_user_id: args.userId, p_task: args.task, p_note: args.note?.trim() || null, p_assignment_id: null,
  });
  if (error) dbError(error);
  const result = data as { id: string; changed: boolean };
  if (result.changed) await audit({ actorId: args.actor.userId, actorRole: args.actor.role,
    action: "assignment.create", resourceTable: "report_assignments", resourceId: result.id,
    metadata: { location_id: args.locationId, assignee_id: args.userId, report_type: args.task, operational_date: today() }, ipAddress: null, userAgent: null });
  return { id: result.id };
}

export async function retractTask(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; assignmentId: string;
}): Promise<{ id: string }> {
  requireLocation(args.actor, args.locationId);
  if (args.actor.level < 4) throw new AssignmentError("role_insufficient");
  requireUuid(args.assignmentId);
  // Retraction authorizes the actor/shop only; stale or senior assignees cannot lock a task.
  const { data, error } = await service.rpc("write_task_assignment", {
    p_actor_id: args.actor.userId, p_location_id: args.locationId, p_assignment_id: args.assignmentId,
    p_user_id: null, p_task: null, p_note: null,
  });
  if (error) dbError(error);
  const result = data as { id: string; changed: boolean };
  if (result.changed) await audit({ actorId: args.actor.userId, actorRole: args.actor.role,
    action: "assignment.retract", resourceTable: "report_assignments", resourceId: result.id,
    metadata: { location_id: args.locationId }, ipAddress: null, userAgent: null });
  return { id: result.id };
}

export async function saveStationSpanish(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; id: string; nameEs: string;
}): Promise<{ id: string }> {
  requireLocation(args.actor, args.locationId);
  if (args.actor.level < 7) throw new AssignmentError("role_insufficient");
  requireUuid(args.id);
  if (typeof args.nameEs !== "string" || args.nameEs.length > 100) throw new AssignmentError("invalid_payload", 400);
  // Re-read membership/active role before service-role config writes too.
  if (await targetLevel(service, args.actor.userId, args.locationId) < 7) throw new AssignmentError("role_insufficient");
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

/** Board visibility is enforced here, not by hiding other people's JSX. */
export async function loadShiftBoard(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; date: string;
}): Promise<ShiftBoard> {
  requireLocation(args.actor, args.locationId);
  if (args.date !== today()) throw new AssignmentError("invalid_payload", 400);
  const manager = args.actor.level >= 4;
  const { data: stationDate, error: dayError } = await service.rpc("station_business_date", { p_location_id: args.locationId });
  if (dayError) dbError(dayError);
  if (typeof stationDate !== "string") throw new Error("Station business date unavailable");
  const stationsResult = await service.from("stations").select("id,name,name_es,sort,active")
    .eq("location_id", args.locationId).order("sort").order("name");
  if (stationsResult.error) dbError(stationsResult.error);
  const stations: Station[] = (stationsResult.data ?? []).map((row) => ({
    id: row.id, name: row.name, nameEs: row.name_es, sort: row.sort, active: row.active,
  }));
  // Paginate history so the API row limit cannot quietly restore an old head.
  const eventRows: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += 500) {
    let query = service.from("station_events").select("id,sequence::text,location_id,business_date,user_id,station_id,kind,actor_id,at,source")
      .eq("location_id", args.locationId).eq("business_date", stationDate).order("sequence");
    if (!manager) query = query.eq("user_id", args.actor.userId);
    const { data, error } = await query.range(offset, offset + 499);
    if (error) dbError(error);
    eventRows.push(...(data ?? []));
    if ((data ?? []).length < 500) break;
  }
  const taskRows: Array<{ id: string; report_type: string; assignee_id: string; assigner_id: string; note: string | null }> = [];
  for (let offset = 0; ; offset += 500) {
    let taskQuery = service.from("report_assignments").select("id,report_type,assignee_id,assigner_id,note")
      .eq("location_id", args.locationId).eq("operational_date", args.date).eq("active", true)
      .in("report_type", [...TASK_TYPES]).order("id");
    if (!manager) taskQuery = taskQuery.eq("assignee_id", args.actor.userId);
    const { data, error } = await taskQuery.range(offset, offset + 499);
    if (error) dbError(error);
    taskRows.push(...(data ?? []));
    if ((data ?? []).length < 500) break;
  }
  const taskResult = { data: taskRows };
  let membershipQuery = service.from("user_locations").select("user_id")
    .eq("location_id", args.locationId).eq("active", true);
  if (!manager) membershipQuery = membershipQuery.eq("user_id", args.actor.userId);
  const membership = await membershipQuery;
  if (membership.error) dbError(membership.error);
  const rosterIds = new Set<string>((membership.data ?? []).map((row) => row.user_id));
  rosterIds.add(args.actor.userId);
  // An all-location owner may be assigned here without a user_locations row.
  for (const task of taskRows) rosterIds.add(task.assignee_id);
  const namesNeeded = new Set([...rosterIds, ...eventRows.map((row) => String(row.actor_id)), ...(taskResult.data ?? []).map((row) => String(row.assigner_id))]);
  const users: Array<{ id: string; name: string; role: string; active: boolean }> = [];
  const ids = [...namesNeeded];
  for (let i = 0; i < ids.length; i += 100) {
    const result = await service.from("users").select("id,name,role,active").in("id", ids.slice(i, i + 100));
    if (result.error) dbError(result.error);
    users.push(...(result.data ?? []));
  }
  const names = new Map(users.map((user) => [user.id, user.name]));
  const events: StationEvent[] = eventRows.map((row) => ({
    id: String(row.id), sequence: String(row.sequence), locationId: String(row.location_id), businessDate: String(row.business_date),
    userId: String(row.user_id), stationId: row.station_id as string | null, kind: row.kind as StationEvent["kind"],
    actorId: String(row.actor_id), actorName: names.get(String(row.actor_id)) ?? null, at: String(row.at), source: row.source as StationEvent["source"],
  }));
  const members = new Set((membership.data ?? []).map((row) => row.user_id));
  const available = new Set(users.filter((user) => user.active && isRoleCode(user.role)
    && (getRoleLevel(user.role) >= 9 || members.has(user.id))).map((user) => user.id));
  const tasks: TaskAssignment[] = (taskResult.data ?? []).filter((row) => isTaskType(row.report_type) && (manager || available.has(row.assignee_id))).map((row) => ({
    id: row.id, task: row.report_type as TaskType, assigneeId: row.assignee_id, assignerId: row.assigner_id,
    assignerName: names.get(row.assigner_id) ?? null, note: row.note, available: available.has(row.assignee_id),
  }));
  return { locationId: args.locationId, date: args.date, viewerId: args.actor.userId, viewerLevel: args.actor.level,
    stations, events, tasks, people: users.filter((user) => isRoleCode(user.role) &&
      (available.has(user.id) || (manager && tasks.some((task) => task.assigneeId === user.id))))
      .map((user) => ({ id: user.id, name: user.name, available: available.has(user.id), level: isRoleCode(user.role) ? getRoleLevel(user.role) : 0,
        hasWork: events.some((event) => event.userId === user.id) || tasks.some((task) => task.assigneeId === user.id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
