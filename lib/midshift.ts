import type { SupabaseClient } from "@supabase/supabase-js";

export const MIDSHIFT_BASE_LEVEL = 4; // KH+ (key_holder = 4 in lib/roles.ts)

/** Operational timezone — CO is DC-only; hardcoded per the dashboard's convention. */
const OPERATIONAL_TZ = "America/New_York";

export type ReportKey = "opening" | "am_prep" | "mid_day" | "cash" | "closing";

/** Instance statuses that count as "submitted/done" for pulse purposes. */
const SUBMITTED_STATUSES = new Set([
  "phase2_complete",
  "confirmed",
  "incomplete_confirmed",
  "auto_finalized",
]);
export function isSubmitted(status: string | null | undefined): boolean {
  return status != null && SUBMITTED_STATUSES.has(status);
}

export type ReportProgress = "done" | "in_progress" | "not_started";
export type OverdueState = "ok" | "overdue" | "not_due_yet";

export interface ReportStatusRow {
  key: ReportKey;
  progress: ReportProgress;
  doneAt: string | null; // ISO timestamp when finalized, if done
  doneByName: string | null;
  overdue: OverdueState;
  /** mid_day only: how many instances done today (for "#1 done · #2 none"). */
  count?: number;
}

export interface ActiveStaff {
  userId: string;
  name: string;
  reports: ReportKey[]; // which report types they touched today
}

export interface PulseFridge {
  name: string;
  latestF: number | null;
  outOfRange: boolean; // any reading today > safe max
}

export interface MidShiftPulse {
  locationId: string;
  today: string;
  reports: ReportStatusRow[];
  fridges: PulseFridge[];
  fridgeFlagCount: number; // fridges out of range today
  maintenanceNotesToday: number;
  activeToday: ActiveStaff[];
  /** Derived attention items, highest priority first, for the banner. */
  attention: AttentionItem[];
}

export interface AttentionItem {
  kind: "overdue" | "fridge" | "maintenance_note";
  /** i18n key + params resolved at render; we pass a stable shape. */
  reportKey?: ReportKey; // for overdue
  fridgeName?: string; // for fridge
  count?: number; // for maintenance_note
}

/**
 * Expected-by clock times (minutes-of-day, operational TZ) per Juan:
 *   - opening overdue after 10:30 (store opens 10:30a)
 *   - mid_day due window 14:00–15:30; overdue after 15:30
 *   - closing overdue after 21:00 (store closes 20:00)
 * am_prep + cash are NOT clock-based — they're "expected when closing is done"
 * (computed in computeOverdue against closing's done-ness).
 */
export const EXPECTED_BY = {
  openingOverdueAfter: 10 * 60 + 30, // 630
  midDayDueFrom: 14 * 60, // 840
  midDayOverdueAfter: 15 * 60 + 30, // 930
  closingOverdueAfter: 21 * 60, // 1260
} as const;

/** Operational-TZ "now": the date string + minutes-of-day. Pure, takes a Date. */
export function operationalNow(now: Date): { date: string; minutesOfDay: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  let hour = parseInt(get("hour"), 10);
  if (Number.isNaN(hour) || hour === 24) hour = 0;
  const minute = parseInt(get("minute"), 10) || 0;
  return { date, minutesOfDay: hour * 60 + minute };
}

/** Overdue for one report given its done-ness, the clock, and closing's done-ness. */
export function computeOverdue(args: {
  key: ReportKey;
  done: boolean;
  minutesOfDay: number;
  closingDone: boolean;
  midDayDoneCount: number;
}): OverdueState {
  const { key, done, minutesOfDay, closingDone, midDayDoneCount } = args;
  if (done) return "ok";
  switch (key) {
    case "opening":
      return minutesOfDay > EXPECTED_BY.openingOverdueAfter ? "overdue" : "ok";
    case "mid_day":
      if (midDayDoneCount > 0) return "ok";
      if (minutesOfDay < EXPECTED_BY.midDayDueFrom) return "not_due_yet";
      return minutesOfDay > EXPECTED_BY.midDayOverdueAfter ? "overdue" : "ok";
    case "closing":
      return minutesOfDay > EXPECTED_BY.closingOverdueAfter ? "overdue" : "ok";
    case "am_prep":
    case "cash":
      // Closing-dependent: only overdue once closing is done but this isn't.
      return closingDone ? "overdue" : "ok";
    default:
      return "ok";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 2: report-status composition
// ─────────────────────────────────────────────────────────────────────────────

import { loadAmPrepDashboardState, loadMidDayPrepDashboardState } from "@/lib/prep";
import { loadCashDashboardState } from "@/lib/cash";
import type { RoleCode } from "@/lib/roles";

export interface MidShiftActor {
  userId: string;
  role: RoleCode;
  level: number;
}

/** Inline status for a single-template report type (opening or closing). */
async function loadInstanceStatus(
  service: SupabaseClient,
  args: { locationId: string; date: string; type: "opening" | "closing" },
): Promise<{ status: string | null; confirmedAt: string | null; confirmedByName: string | null }> {
  const { data: tmpl } = await service
    .from("checklist_templates")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("type", args.type)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!tmpl) return { status: null, confirmedAt: null, confirmedByName: null };

  const { data: inst } = await service
    .from("checklist_instances")
    .select("status, confirmed_at, confirmed_by")
    .eq("template_id", tmpl.id)
    .eq("location_id", args.locationId)
    .eq("date", args.date)
    .maybeSingle<{ status: string; confirmed_at: string | null; confirmed_by: string | null }>();
  if (!inst) return { status: null, confirmedAt: null, confirmedByName: null };

  let confirmedByName: string | null = null;
  if (inst.confirmed_by) {
    const { data: u } = await service
      .from("users")
      .select("name")
      .eq("id", inst.confirmed_by)
      .maybeSingle<{ name: string }>();
    confirmedByName = u?.name ?? null;
  }
  return { status: inst.status ?? null, confirmedAt: inst.confirmed_at ?? null, confirmedByName };
}

function progressFor(status: string | null, hasAny: boolean): ReportProgress {
  if (isSubmitted(status)) return "done";
  if (hasAny || (status != null && status !== "")) return "in_progress";
  return "not_started";
}

/** Builds the 5 ReportStatusRows (without overdue — overdue applied by caller). */
export async function loadReportStatuses(
  service: SupabaseClient,
  args: { locationId: string; date: string; actor: MidShiftActor },
): Promise<{ rows: Omit<ReportStatusRow, "overdue">[]; closingDone: boolean; midDayDoneCount: number }> {
  const actor = args.actor;

  const opening = await loadInstanceStatus(service, { locationId: args.locationId, date: args.date, type: "opening" });
  const closing = await loadInstanceStatus(service, { locationId: args.locationId, date: args.date, type: "closing" });
  const amPrep = await loadAmPrepDashboardState(service, { locationId: args.locationId, date: args.date, actor });
  const midDay = await loadMidDayPrepDashboardState(service, { locationId: args.locationId, date: args.date, actor });
  const cash = await loadCashDashboardState(service, { locationId: args.locationId, date: args.date, actor });

  const midDayDoneCount = midDay.instances.filter((i) => isSubmitted(i.status)).length;
  const midDayLatestDone = [...midDay.instances].reverse().find((i) => isSubmitted(i.status)) ?? null;
  const closingDone = isSubmitted(closing.status);

  const rows: Omit<ReportStatusRow, "overdue">[] = [
    {
      key: "opening",
      progress: progressFor(opening.status, false),
      doneAt: opening.confirmedAt,
      doneByName: opening.confirmedByName,
    },
    {
      key: "am_prep",
      progress: progressFor(amPrep.todayInstance?.status ?? null, amPrep.todayInstance != null),
      doneAt: amPrep.todayInstance?.confirmedAt ?? null,
      doneByName: amPrep.confirmedByName,
    },
    {
      key: "mid_day",
      progress: midDayDoneCount > 0 ? "done" : midDay.instances.length > 0 ? "in_progress" : "not_started",
      doneAt: midDayLatestDone?.confirmedAt ?? null,
      doneByName: midDayLatestDone?.confirmedByName ?? null,
      count: midDayDoneCount,
    },
    {
      key: "cash",
      progress: cash.report ? "done" : "not_started",
      doneAt: cash.report?.signedAt ?? null,
      doneByName: cash.report?.signedByName ?? null,
    },
    {
      key: "closing",
      progress: progressFor(closing.status, false),
      doneAt: closing.confirmedAt,
      doneByName: closing.confirmedByName,
    },
  ];

  return { rows, closingDone, midDayDoneCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 3: fridges, active-today, attention, loadMidShiftPulse
// ─────────────────────────────────────────────────────────────────────────────

import { loadMaintenanceOverview } from "@/lib/maintenance";

/** Staff who completed/submitted any report today (proxy for on-shift). */
async function loadActiveToday(
  service: SupabaseClient,
  args: { locationId: string; date: string },
): Promise<ActiveStaff[]> {
  // Report-instance confirmers for today (opening/closing/am/mid-day) + cash signer.
  const { data: insts } = await service
    .from("checklist_instances")
    .select("confirmed_by, template_id")
    .eq("location_id", args.locationId)
    .eq("date", args.date)
    .not("confirmed_by", "is", null);
  const { data: comps } = await service
    .from("checklist_completions")
    .select("completed_by, instance_id")
    .is("superseded_at", null)
    .is("revoked_at", null)
    .limit(2000); // scoped further below via instance date join is overkill; filter in JS by today's instances
  const { data: cash } = await service
    .from("cash_reports")
    .select("signed_by")
    .eq("location_id", args.locationId)
    .eq("report_date", args.date)
    .is("superseded_at", null);

  // Build the set of today's instance ids for this location to scope completions.
  const { data: todayInstances } = await service
    .from("checklist_instances")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("date", args.date);
  const todayInstanceIds = new Set((todayInstances ?? []).map((r) => (r as { id: string }).id));

  const userIds = new Set<string>();
  for (const r of (insts ?? []) as { confirmed_by: string | null }[]) if (r.confirmed_by) userIds.add(r.confirmed_by);
  for (const r of (comps ?? []) as { completed_by: string | null; instance_id: string }[]) {
    if (r.completed_by && todayInstanceIds.has(r.instance_id)) userIds.add(r.completed_by);
  }
  for (const r of (cash ?? []) as { signed_by: string | null }[]) if (r.signed_by) userIds.add(r.signed_by);

  if (userIds.size === 0) return [];
  const { data: users } = await service.from("users").select("id, name").in("id", [...userIds]);
  const nameById = new Map<string, string>();
  for (const u of (users ?? []) as { id: string; name: string }[]) nameById.set(u.id, u.name);

  // v1: list names + a generic "report" tag (per-report attribution is a v1.1 refinement;
  // keep the query cheap — the proxy's value is "who's been active," not exact report breakdown).
  return [...userIds].map((id) => ({ userId: id, name: nameById.get(id) ?? "—", reports: [] as ReportKey[] }));
}

export async function loadMidShiftPulse(
  service: SupabaseClient,
  args: { locationId: string; date: string; now: Date; actor: MidShiftActor },
): Promise<MidShiftPulse> {
  const { minutesOfDay } = operationalNow(args.now);

  const { rows, closingDone, midDayDoneCount } = await loadReportStatuses(service, {
    locationId: args.locationId,
    date: args.date,
    actor: args.actor,
  });

  const reports: ReportStatusRow[] = rows.map((r) => ({
    ...r,
    overdue: computeOverdue({
      key: r.key,
      done: r.progress === "done",
      minutesOfDay,
      closingDone,
      midDayDoneCount,
    }),
  }));

  // Fridges + flags from the maintenance overview (sinceDate = today; we only need today's status).
  const overview = await loadMaintenanceOverview(service, {
    locationId: args.locationId,
    today: args.date,
    sinceDate: args.date,
  });
  const fridges: PulseFridge[] = overview.fridges.map((f) => ({
    name: f.equip.name,
    latestF: f.latest?.valueF ?? null,
    outOfRange: f.status === "out_of_range",
  }));
  const fridgeFlagCount = fridges.filter((f) => f.outOfRange).length;

  // Maintenance notes logged today.
  const { count: notesCount } = await service
    .from("maintenance_notes")
    .select("id", { count: "exact", head: true })
    .eq("location_id", args.locationId)
    .gte("created_at", `${args.date}T00:00:00`)
    .lte("created_at", `${args.date}T23:59:59`);
  const maintenanceNotesToday = notesCount ?? 0;

  const activeToday = await loadActiveToday(service, { locationId: args.locationId, date: args.date });

  // Attention items, priority order: overdue → fridge → maintenance notes.
  const attention: AttentionItem[] = [];
  for (const r of reports) if (r.overdue === "overdue") attention.push({ kind: "overdue", reportKey: r.key });
  for (const f of fridges) if (f.outOfRange) attention.push({ kind: "fridge", fridgeName: f.name });
  if (maintenanceNotesToday > 0) attention.push({ kind: "maintenance_note", count: maintenanceNotesToday });

  return {
    locationId: args.locationId,
    today: args.date,
    reports,
    fridges,
    fridgeFlagCount,
    maintenanceNotesToday,
    activeToday,
    attention,
  };
}
