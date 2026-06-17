import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleCode } from "@/lib/roles";

export const PM_REPORT_BASE_LEVEL = 4; // KH+

export interface PmActor {
  userId: string;
  role: RoleCode;
  level: number;
}

export type Attitude = "great" | "good" | "needs_work";

export interface EmployeeEval {
  id: string;
  employeeId: string;
  employeeName: string | null;
  onTime: boolean;
  attitude: Attitude;
  areaToImprove: string | null;
  note: string | null; // present ONLY in KH+ loaders; null/omitted for employee surface
}

export interface ShiftWrapUpRow {
  userId: string;
  name: string | null;
  itemsCompleted: number;
  reportsSubmitted: number;
}

export interface PmDashboardState {
  isVisibleToActor: boolean;
  status: string | null; // null = not started today
  submittedAt: string | null;
  submittedByName: string | null;
}

/** Tile state — KH+ only; mirrors loadCashDashboardState's slim shape. */
export async function loadPmDashboardState(
  service: SupabaseClient,
  args: { locationId: string; date: string; actor: PmActor },
): Promise<PmDashboardState> {
  if (args.actor.level < PM_REPORT_BASE_LEVEL) {
    return { isVisibleToActor: false, status: null, submittedAt: null, submittedByName: null };
  }
  const { data: row } = await service
    .from("pm_reports")
    .select("status, submitted_at, submitted_by")
    .eq("location_id", args.locationId)
    .eq("report_date", args.date)
    .is("superseded_at", null)
    .maybeSingle<{ status: string; submitted_at: string | null; submitted_by: string | null }>();
  let submittedByName: string | null = null;
  if (row?.submitted_by) {
    const { data: u } = await service.from("users").select("name").eq("id", row.submitted_by).maybeSingle<{ name: string }>();
    submittedByName = u?.name ?? null;
  }
  return {
    isVisibleToActor: true,
    status: row?.status ?? null,
    submittedAt: row?.submitted_at ?? null,
    submittedByName,
  };
}

/** Per-employee activity for the auto wrap-up: items completed today + reports submitted. */
export async function loadShiftWrapUp(
  service: SupabaseClient,
  args: { locationId: string; date: string },
): Promise<ShiftWrapUpRow[]> {
  // Today's instances at this location (scopes completions to today's reports).
  const { data: insts } = await service
    .from("checklist_instances")
    .select("id, confirmed_by")
    .eq("location_id", args.locationId)
    .eq("date", args.date);
  const instIds = new Set((insts ?? []).map((r) => (r as { id: string }).id));
  const submittedByUser = new Map<string, number>();
  for (const r of (insts ?? []) as { confirmed_by: string | null }[]) {
    if (r.confirmed_by) submittedByUser.set(r.confirmed_by, (submittedByUser.get(r.confirmed_by) ?? 0) + 1);
  }

  // Completions on today's instances, counted per completer.
  const { data: comps } = await service
    .from("checklist_completions")
    .select("completed_by, instance_id")
    .is("superseded_at", null)
    .is("revoked_at", null)
    .limit(5000);
  const itemsByUser = new Map<string, number>();
  for (const r of (comps ?? []) as { completed_by: string | null; instance_id: string }[]) {
    if (r.completed_by && instIds.has(r.instance_id)) {
      itemsByUser.set(r.completed_by, (itemsByUser.get(r.completed_by) ?? 0) + 1);
    }
  }

  const userIds = new Set<string>([...itemsByUser.keys(), ...submittedByUser.keys()]);
  if (userIds.size === 0) return [];
  const { data: users } = await service.from("users").select("id, name").in("id", [...userIds]);
  const nameById = new Map<string, string>();
  for (const u of (users ?? []) as { id: string; name: string }[]) nameById.set(u.id, u.name);

  return [...userIds]
    .map((id) => ({
      userId: id,
      name: nameById.get(id) ?? null,
      itemsCompleted: itemsByUser.get(id) ?? 0,
      reportsSubmitted: submittedByUser.get(id) ?? 0,
    }))
    .sort((a, b) => b.itemsCompleted - a.itemsCompleted);
}

export interface PmReportForEdit {
  id: string;
  status: string;
  mvpUserId: string | null;
  mvpNote: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  evals: EmployeeEval[]; // WITH notes — KH+ surface only
  wrapUp: ShiftWrapUpRow[];
}

/** Full report for the KH+ fill/edit surface — includes notes. */
export async function loadPmReportForEdit(
  service: SupabaseClient,
  args: { locationId: string; date: string },
): Promise<PmReportForEdit | null> {
  const { data: report } = await service
    .from("pm_reports")
    .select("id, status, mvp_user_id, mvp_note, submitted_at, submitted_by")
    .eq("location_id", args.locationId)
    .eq("report_date", args.date)
    .is("superseded_at", null)
    .maybeSingle<{ id: string; status: string; mvp_user_id: string | null; mvp_note: string | null; submitted_at: string | null; submitted_by: string | null }>();
  const wrapUp = await loadShiftWrapUp(service, args);
  if (!report) return null;

  let submittedByName: string | null = null;
  if (report.submitted_by) {
    const { data: sb } = await service.from("users").select("name").eq("id", report.submitted_by).maybeSingle<{ name: string }>();
    submittedByName = sb?.name ?? null;
  }

  const { data: evalRows } = await service
    .from("pm_employee_evals")
    .select("id, employee_id, on_time, attitude, area_to_improve, note")
    .eq("pm_report_id", report.id)
    .is("superseded_at", null);
  const rows = (evalRows ?? []) as Array<{ id: string; employee_id: string; on_time: boolean; attitude: Attitude; area_to_improve: string | null; note: string | null }>;
  const ids = [...new Set(rows.map((r) => r.employee_id))];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const { data: users } = await service.from("users").select("id, name").in("id", ids);
    for (const u of (users ?? []) as { id: string; name: string }[]) nameById.set(u.id, u.name);
  }
  const evals: EmployeeEval[] = rows.map((r) => ({
    id: r.id, employeeId: r.employee_id, employeeName: nameById.get(r.employee_id) ?? null,
    onTime: r.on_time, attitude: r.attitude, areaToImprove: r.area_to_improve, note: r.note,
  }));
  return { id: report.id, status: report.status, mvpUserId: report.mvp_user_id, mvpNote: report.mvp_note, submittedAt: report.submitted_at, submittedByName, evals, wrapUp };
}

export interface MyFeedbackItem {
  id: string;
  date: string;
  locationId: string;
  onTime: boolean;
  attitude: Attitude;
  areaToImprove: string | null;
  wasMvp: boolean;
}

/**
 * Employee's own feedback. SECURITY: selects ONLY structured columns — NEVER
 * `note` (KH+ eyes only). Only returns evals from SUBMITTED reports.
 */
export async function loadMyFeedback(
  service: SupabaseClient,
  args: { userId: string },
): Promise<MyFeedbackItem[]> {
  const { data: rows } = await service
    .from("pm_employee_evals")
    .select("id, pm_report_id, location_id, on_time, attitude, area_to_improve") // NOTE: no `note`
    .eq("employee_id", args.userId)
    .is("superseded_at", null);
  const evalRows = (rows ?? []) as Array<{ id: string; pm_report_id: string; location_id: string; on_time: boolean; attitude: Attitude; area_to_improve: string | null }>;
  if (evalRows.length === 0) return [];

  // Only surface evals whose parent report is submitted; pull date + mvp.
  const reportIds = [...new Set(evalRows.map((r) => r.pm_report_id))];
  const { data: reports } = await service
    .from("pm_reports")
    .select("id, report_date, status, mvp_user_id")
    .in("id", reportIds)
    .is("superseded_at", null);
  const repById = new Map<string, { report_date: string; status: string; mvp_user_id: string | null }>();
  for (const r of (reports ?? []) as { id: string; report_date: string; status: string; mvp_user_id: string | null }[]) {
    repById.set(r.id, { report_date: r.report_date, status: r.status, mvp_user_id: r.mvp_user_id });
  }
  return evalRows
    .map((r) => {
      const rep = repById.get(r.pm_report_id);
      if (!rep || rep.status === "open") return null; // hide unsubmitted
      return {
        id: r.id, date: rep.report_date, locationId: r.location_id,
        onTime: r.on_time, attitude: r.attitude, areaToImprove: r.area_to_improve,
        wasMvp: rep.mvp_user_id === args.userId,
      } satisfies MyFeedbackItem;
    })
    .filter((v): v is MyFeedbackItem => v !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

import { audit } from "@/lib/audit";
import { enqueueNotification, NOTIFICATION_TYPES } from "@/lib/notifications";

export async function getOrCreatePmReport(
  service: SupabaseClient,
  args: { locationId: string; date: string; actor: PmActor },
): Promise<{ id: string }> {
  const { data: existing } = await service
    .from("pm_reports")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("report_date", args.date)
    .is("superseded_at", null)
    .maybeSingle<{ id: string }>();
  if (existing) return { id: existing.id };
  const { data, error } = await service
    .from("pm_reports")
    .insert({ location_id: args.locationId, report_date: args.date, status: "open", created_by: args.actor.userId })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`getOrCreatePmReport: ${error.message}`);
  return { id: data.id };
}

export async function saveEmployeeEval(
  service: SupabaseClient,
  args: {
    pmReportId: string; locationId: string; employeeId: string;
    onTime: boolean; attitude: Attitude; areaToImprove: string | null; note: string | null;
    actor: PmActor;
  },
): Promise<{ id: string }> {
  // Supersede any live eval for this (report, employee), then insert the new one.
  await service
    .from("pm_employee_evals")
    .update({ superseded_at: new Date().toISOString() })
    .eq("pm_report_id", args.pmReportId)
    .eq("employee_id", args.employeeId)
    .is("superseded_at", null);
  const { data, error } = await service
    .from("pm_employee_evals")
    .insert({
      pm_report_id: args.pmReportId, location_id: args.locationId, employee_id: args.employeeId,
      on_time: args.onTime, attitude: args.attitude, area_to_improve: args.areaToImprove,
      note: args.note, author_id: args.actor.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`saveEmployeeEval: ${error.message}`);
  return { id: data.id };
}

export async function setMvp(
  service: SupabaseClient,
  args: { pmReportId: string; mvpUserId: string | null; mvpNote: string | null },
): Promise<void> {
  const { error } = await service
    .from("pm_reports")
    .update({ mvp_user_id: args.mvpUserId, mvp_note: args.mvpNote })
    .eq("id", args.pmReportId)
    .is("superseded_at", null);
  if (error) throw new Error(`setMvp: ${error.message}`);
}

export async function submitPmReport(
  service: SupabaseClient,
  args: { pmReportId: string; locationId: string; actor: PmActor },
): Promise<{ notified: number }> {
  const { error } = await service
    .from("pm_reports")
    .update({ status: "submitted", submitted_at: new Date().toISOString(), submitted_by: args.actor.userId })
    .eq("id", args.pmReportId)
    .is("superseded_at", null);
  if (error) throw new Error(`submitPmReport: ${error.message}`);

  // Notify each evaluated employee (one notification, recipients = the evaluated set).
  const { data: evalRows } = await service
    .from("pm_employee_evals")
    .select("employee_id")
    .eq("pm_report_id", args.pmReportId)
    .is("superseded_at", null);
  const employeeIds = [...new Set(((evalRows ?? []) as { employee_id: string }[]).map((r) => r.employee_id))];
  if (employeeIds.length > 0) {
    await enqueueNotification(service, {
      type: NOTIFICATION_TYPES.SHIFT_FEEDBACK,
      priority: "info",
      titleKey: "notif.shift_feedback.title",
      bodyKey: "notif.shift_feedback.body",
      relatedTable: "pm_reports",
      relatedId: args.pmReportId,
      locationId: args.locationId,
      createdBy: args.actor.userId,
      recipients: employeeIds.map((userId) => ({ userId })),
    });
  }

  void audit({
    actorId: args.actor.userId, actorRole: args.actor.role, action: "pm_report.submit",
    resourceTable: "pm_reports", resourceId: args.pmReportId,
    metadata: { notified: employeeIds.length }, ipAddress: null, userAgent: null,
  });
  return { notified: employeeIds.length };
}
