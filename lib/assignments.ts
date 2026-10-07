import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "./audit";
import { lockLocationContext, type LocationActor } from "./locations";
import { etCalendarDate } from "./operational-day";
import { getRoleLevel, isRoleCode } from "./roles";
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
  const known = ["station_locked", "role_insufficient", "location_access_denied", "assignee_unavailable", "self_assignment", "station_unavailable", "assignment_not_found", "invalid_payload"];
  const code = known.find((candidate) => error.message === candidate);
  if (code) throw new AssignmentError(code, code === "assignment_not_found" ? 404 : code === "invalid_payload" ? 400 : 403);
  throw new Error(`assignments database failure: ${error.code ?? "unknown"}`);
}

/** Assignment permissions are narrow: exact task, person, shop and today's date. */
export async function hasTaskAccess(service: SupabaseClient, args: {
  userId: string; level: number; locationId: string; date: string; task: TaskType;
}): Promise<boolean> {
  if (!isTaskType(args.task) || args.level < TASK_MIN_LEVEL[args.task] || args.date !== today()) return false;
  const { data, error } = await service.from("report_assignments").select("id")
    .eq("assignee_id", args.userId).eq("report_type", args.task)
    .eq("location_id", args.locationId).eq("operational_date", args.date)
    .eq("active", true).limit(1).maybeSingle();
  if (error) dbError(error);
  if (data) return true;
  if (args.level < 4) return false;
  // The board's "take it" link opens the task without creating a forbidden
  // self-assignment. Never treat somebody else's assignment as unassigned.
  const { data: assigned, error: assignedError } = await service.from("report_assignments").select("id")
    .eq("report_type", args.task).eq("location_id", args.locationId)
    .eq("operational_date", args.date).eq("active", true).limit(1).maybeSingle();
  if (assignedError) dbError(assignedError);
  return !assigned;
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
  // RPC resolves the assignee from the row and checks live level/membership.
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

export async function saveStation(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; id?: string; name: string; nameEs: string; sort: number; active: boolean;
}): Promise<{ id: string }> {
  requireLocation(args.actor, args.locationId);
  if (args.actor.level < 7) throw new AssignmentError("role_insufficient");
  if (args.id) requireUuid(args.id);
  if (typeof args.name !== "string" || !args.name.trim() || args.name.length > 100 ||
      typeof args.nameEs !== "string" || !args.nameEs.trim() || args.nameEs.length > 100 ||
      !Number.isInteger(args.sort) || args.sort < 0 || args.sort > 10000 || typeof args.active !== "boolean") throw new AssignmentError("invalid_payload", 400);
  // Re-read membership/active role before service-role config writes too.
  if (await targetLevel(service, args.actor.userId, args.locationId) < 7) throw new AssignmentError("role_insufficient");
  const row = { name: args.name.trim(), name_es: args.nameEs.trim(), sort: args.sort, active: args.active };
  const query = args.id
    ? service.from("stations").update(row).eq("id", args.id).eq("location_id", args.locationId)
    : service.from("stations").insert({ ...row, location_id: args.locationId });
  const { data, error } = await query.select("id").maybeSingle<{ id: string }>();
  if (error) dbError(error);
  if (!data) throw new AssignmentError("station_unavailable", 404);
  await audit({ actorId: args.actor.userId, actorRole: args.actor.role,
    action: args.id ? "station.update" : "station.create", resourceTable: "stations", resourceId: data.id,
    metadata: { location_id: args.locationId, ...row }, ipAddress: null, userAgent: null });
  return data;
}

/** Board visibility is enforced here, not by hiding other people's JSX. */
export async function loadShiftBoard(service: SupabaseClient, args: {
  actor: AssignmentActor; locationId: string; date: string;
}): Promise<ShiftBoard> {
  requireLocation(args.actor, args.locationId);
  if (args.date !== today()) throw new AssignmentError("invalid_payload", 400);
  const manager = args.actor.level >= 4;
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
      .eq("location_id", args.locationId).eq("business_date", args.date).order("sequence");
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
  const membership = manager ? await service.from("user_locations").select("user_id")
    .eq("location_id", args.locationId).eq("active", true) : { data: [{ user_id: args.actor.userId }], error: null };
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
  const tasks: TaskAssignment[] = (taskResult.data ?? []).filter((row) => isTaskType(row.report_type)).map((row) => ({
    id: row.id, task: row.report_type as TaskType, assigneeId: row.assignee_id, assignerId: row.assigner_id,
    assignerName: names.get(row.assigner_id) ?? null, note: row.note,
  }));
  return { locationId: args.locationId, date: args.date, viewerId: args.actor.userId, viewerLevel: args.actor.level,
    stations, events, tasks, people: users.filter((user) => user.active && rosterIds.has(user.id) && isRoleCode(user.role))
      .map((user) => ({ id: user.id, name: user.name, level: isRoleCode(user.role) ? getRoleLevel(user.role) : 0,
        hasWork: events.some((event) => event.userId === user.id) || tasks.some((task) => task.assigneeId === user.id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
