/**
 * Mid-Shift Pulse — the SERVER data layer. Composes the shipped dashboard-state
 * loaders + maintenance + activity into one read-only MidShiftPulse. The pure
 * core (types, overdue model, operational clock) lives in lib/midshift-shared
 * (vitest-covered) and is re-exported here so consumers keep one import path.
 *
 * Perf shape (council 2026-07-31): every independent load runs in Promise.all —
 * the 5 report loaders, the top-level maintenance/notes/activity block, and the
 * batched confirmer-name lookup. A phone at 6pm gets ~3 parallel groups, not
 * ~15 serial round-trips.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { operationalDayUtcRange } from "@/lib/operational-day";
import { loadAmPrepDashboardState, loadMidDayPrepDashboardState } from "@/lib/prep";
import { loadCashDashboardState } from "@/lib/cash";
import { loadMaintenanceOverview } from "@/lib/maintenance";
import type { RoleCode } from "@/lib/roles";

import {
  computeOverdue,
  EXPECTED_BY,
  isSubmitted,
  operationalNow,
  timeWindowMinutes,
  type ActiveStaff,
  type AttentionItem,
  type CateringDueItem,
  type MidShiftPulse,
  type PulseFridge,
  type ReportKey,
  type ReportProgress,
  type ReportStatusRow,
} from "@/lib/midshift-shared";

export {
  computeOverdue,
  EXPECTED_BY,
  isSubmitted,
  MIDSHIFT_BASE_LEVEL,
  operationalNow,
  pulseScore,
} from "@/lib/midshift-shared";
export type {
  ActiveStaff,
  AttentionItem,
  CateringDueItem,
  MidShiftPulse,
  OverdueState,
  PulseFridge,
  PulseScore,
  ReportKey,
  ReportProgress,
  ReportStatusRow,
} from "@/lib/midshift-shared";

export interface MidShiftActor {
  userId: string;
  role: RoleCode;
  level: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Report-status composition
// ─────────────────────────────────────────────────────────────────────────────

/** Inline status for a single-template report type (opening or closing).
 *  Returns the confirmer's user id — name resolution is BATCHED by the caller
 *  (one users query for both types, not one per instance). */
async function loadInstanceStatus(
  service: SupabaseClient,
  args: { locationId: string; date: string; type: "opening" | "closing" },
): Promise<{ status: string | null; confirmedAt: string | null; confirmedBy: string | null }> {
  // PLURAL template lookup (PR-3 adversarial review H1): under template
  // versioning a lineage can hold current + pending active rows — a
  // created_at-DESC single resolver would grab the PENDING version and report
  // today's completed list as "not started" (the stranding class). Match the
  // instance across ALL active rows of the type instead (the am-prep page
  // pattern) — version-immune for today AND for the historical dates the
  // reports hub passes.
  const { data: tmpls } = await service
    .from("checklist_templates")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("type", args.type)
    .eq("active", true)
    .returns<Array<{ id: string }>>();
  const tmplIds = (tmpls ?? []).map((t) => t.id);
  if (tmplIds.length === 0) return { status: null, confirmedAt: null, confirmedBy: null };

  const { data: inst } = await service
    .from("checklist_instances")
    .select("status, confirmed_at, confirmed_by")
    .in("template_id", tmplIds)
    .eq("location_id", args.locationId)
    .eq("date", args.date)
    // Newest wins if a duplicate day-instance ever exists (designed-against but
    // maybeSingle would THROW on 2 rows — degrade deterministically instead).
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ status: string; confirmed_at: string | null; confirmed_by: string | null }>();
  if (!inst) return { status: null, confirmedAt: null, confirmedBy: null };
  return { status: inst.status ?? null, confirmedAt: inst.confirmed_at ?? null, confirmedBy: inst.confirmed_by ?? null };
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

  // All five loaders are independent — run them together (council perf pass).
  const [opening, closing, amPrep, midDay, cash] = await Promise.all([
    loadInstanceStatus(service, { locationId: args.locationId, date: args.date, type: "opening" }),
    loadInstanceStatus(service, { locationId: args.locationId, date: args.date, type: "closing" }),
    loadAmPrepDashboardState(service, { locationId: args.locationId, date: args.date, actor }),
    loadMidDayPrepDashboardState(service, { locationId: args.locationId, date: args.date, actor }),
    loadCashDashboardState(service, { locationId: args.locationId, date: args.date, actor }),
  ]);

  // Batched confirmer-name resolution for the two inline statuses (was one
  // users query PER instance inside loadInstanceStatus).
  const confirmerIds = [...new Set([opening.confirmedBy, closing.confirmedBy].filter((v): v is string => v != null))];
  const nameById = new Map<string, string>();
  if (confirmerIds.length > 0) {
    const { data: users } = await service
      .from("users")
      .select("id, name")
      .in("id", confirmerIds)
      .returns<Array<{ id: string; name: string }>>();
    for (const u of users ?? []) nameById.set(u.id, u.name);
  }

  const midDayDoneCount = midDay.instances.filter((i) => isSubmitted(i.status)).length;
  const midDayLatestDone = [...midDay.instances].reverse().find((i) => isSubmitted(i.status)) ?? null;
  const closingDone = isSubmitted(closing.status);

  const rows: Omit<ReportStatusRow, "overdue">[] = [
    {
      key: "opening",
      progress: progressFor(opening.status, false),
      doneAt: opening.confirmedAt,
      doneByName: opening.confirmedBy ? nameById.get(opening.confirmedBy) ?? null : null,
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
      doneByName: closing.confirmedBy ? nameById.get(closing.confirmedBy) ?? null : null,
    },
  ];

  return { rows, closingDone, midDayDoneCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Active-today (with per-report attribution) + the pulse composer
// ─────────────────────────────────────────────────────────────────────────────

/** template type + prep_subtype → the pulse's ReportKey. */
function reportKeyForTemplate(type: string, prepSubtype: string | null): ReportKey | null {
  if (type === "opening") return "opening";
  if (type === "closing") return "closing";
  if (type === "prep") return prepSubtype === "mid_day_prep" ? "mid_day" : "am_prep";
  return null; // deep_cleaning etc. — not a pulse report row
}

/** Staff who completed/submitted any report today (proxy for on-shift), WITH
 *  which report types they touched (council 2026-07-31 — the `reports` field
 *  shipped empty for a month; the attribution was always in the fetched rows). */
async function loadActiveToday(
  service: SupabaseClient,
  args: { locationId: string; date: string },
): Promise<ActiveStaff[]> {
  // Today's instances (id + template + confirmer, one query) ∥ cash signers.
  const [{ data: insts }, { data: cash }] = await Promise.all([
    service
      .from("checklist_instances")
      .select("id, template_id, confirmed_by")
      .eq("location_id", args.locationId)
      .eq("date", args.date)
      .returns<Array<{ id: string; template_id: string; confirmed_by: string | null }>>(),
    service
      .from("cash_reports")
      .select("signed_by")
      .eq("location_id", args.locationId)
      .eq("report_date", args.date)
      .is("superseded_at", null)
      .returns<Array<{ signed_by: string | null }>>(),
  ]);

  const instRows = insts ?? [];
  const instanceIds = instRows.map((r) => r.id);
  const templateIds = [...new Set(instRows.map((r) => r.template_id))];

  // Completions on today's instances ∥ the template-type map for attribution.
  const [comps, tmplRows] = await Promise.all([
    instanceIds.length > 0
      ? service
          .from("checklist_completions")
          .select("completed_by, instance_id")
          .in("instance_id", instanceIds)
          .is("superseded_at", null)
          .is("revoked_at", null)
          .returns<Array<{ completed_by: string | null; instance_id: string }>>()
          .then((r) => r.data ?? [])
      : Promise.resolve([] as Array<{ completed_by: string | null; instance_id: string }>),
    templateIds.length > 0
      ? service
          .from("checklist_templates")
          .select("id, type, prep_subtype")
          .in("id", templateIds)
          .returns<Array<{ id: string; type: string; prep_subtype: string | null }>>()
          .then((r) => r.data ?? [])
      : Promise.resolve([] as Array<{ id: string; type: string; prep_subtype: string | null }>),
  ]);

  const keyByTemplate = new Map<string, ReportKey | null>(
    tmplRows.map((t) => [t.id, reportKeyForTemplate(t.type, t.prep_subtype)]),
  );
  const keyByInstance = new Map<string, ReportKey | null>(
    instRows.map((r) => [r.id, keyByTemplate.get(r.template_id) ?? null]),
  );

  // userId → the report types they touched today.
  const touched = new Map<string, Set<ReportKey>>();
  const touch = (userId: string | null, key: ReportKey | null) => {
    if (!userId) return;
    const set = touched.get(userId) ?? new Set<ReportKey>();
    if (key) set.add(key);
    touched.set(userId, set);
  };
  for (const r of instRows) touch(r.confirmed_by, keyByTemplate.get(r.template_id) ?? null);
  for (const c of comps) touch(c.completed_by, keyByInstance.get(c.instance_id) ?? null);
  for (const r of cash ?? []) touch(r.signed_by, "cash");

  if (touched.size === 0) return [];
  const { data: users } = await service
    .from("users")
    .select("id, name")
    .in("id", [...touched.keys()])
    .returns<Array<{ id: string; name: string }>>();
  const nameById = new Map((users ?? []).map((u) => [u.id, u.name]));

  // Stable render order: report keys in the pulse's canonical row order.
  const KEY_ORDER: ReportKey[] = ["opening", "am_prep", "mid_day", "cash", "closing"];
  return [...touched.entries()].map(([userId, keys]) => ({
    userId,
    name: nameById.get(userId) ?? "—",
    reports: KEY_ORDER.filter((k) => keys.has(k)),
  }));
}

/** Confirmed catering events due out today (stage confirmed/out), soonest
 *  window first — the mid-shift "what's coming" strip (council 2026-07-31,
 *  Fable I1 + Juan). Names only, no revenue: this renders at the pulse's KH+
 *  floor, below the catering hub's commercial surfaces. */
async function loadCateringDueToday(
  service: SupabaseClient,
  args: { locationId: string; date: string },
): Promise<CateringDueItem[]> {
  const { data } = await service
    .from("catering_pipeline")
    .select("id, event_name, company, contact_name, headcount, time_window, delivery_address")
    .eq("location_id", args.locationId)
    .eq("event_date", args.date)
    .in("stage", ["confirmed", "out"])
    .returns<
      Array<{
        id: string;
        event_name: string | null;
        company: string | null;
        contact_name: string;
        headcount: number | null;
        time_window: string | null;
        delivery_address: string | null;
      }>
    >();
  return (data ?? [])
    .map((r) => ({
      id: r.id,
      timeWindow: r.time_window,
      name: r.event_name ?? r.company ?? r.contact_name,
      headcount: r.headcount,
      isDelivery: r.delivery_address != null && r.delivery_address !== "",
    }))
    // Chronological, not lexicographic — "1:00 PM" must not beat "10:00 AM".
    // Unparseable/null windows sort last; equal keys tiebreak on the raw text.
    .sort(
      (a, b) =>
        timeWindowMinutes(a.timeWindow) - timeWindowMinutes(b.timeWindow) ||
        (a.timeWindow ?? "").localeCompare(b.timeWindow ?? ""),
    );
}

export async function loadMidShiftPulse(
  service: SupabaseClient,
  args: { locationId: string; date: string; now: Date; actor: MidShiftActor },
): Promise<MidShiftPulse> {
  const { minutesOfDay } = operationalNow(args.now);

  // Maintenance notes logged today. created_at is a UTC timestamptz; args.date
  // is the ET operational day — bare `${date}T…` bounds were read as UTC and
  // bucketed late-evening ET notes to the wrong day (hardening 2026-07-31,
  // council P1). Convert to the day's real UTC instant range.
  const { startIso, endExclusiveIso } = operationalDayUtcRange(args.date);

  // The five top-level loads are independent — one parallel group.
  const [statuses, overview, notesRes, activeToday, cateringToday] = await Promise.all([
    loadReportStatuses(service, { locationId: args.locationId, date: args.date, actor: args.actor }),
    loadMaintenanceOverview(service, { locationId: args.locationId, today: args.date, sinceDate: args.date }),
    service
      .from("maintenance_notes")
      .select("id", { count: "exact", head: true })
      .eq("location_id", args.locationId)
      .gte("created_at", startIso)
      .lt("created_at", endExclusiveIso),
    loadActiveToday(service, { locationId: args.locationId, date: args.date }),
    loadCateringDueToday(service, { locationId: args.locationId, date: args.date }),
  ]);
  const { rows, closingDone, midDayDoneCount } = statuses;

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

  const fridges: PulseFridge[] = overview.fridges.map((f) => ({
    equipId: f.equip.id,
    name: f.equip.name,
    latestF: f.latest?.valueF ?? null,
    outOfRange: f.status === "out_of_range",
  }));
  const fridgeFlagCount = fridges.filter((f) => f.outOfRange).length;

  const maintenanceNotesToday = notesRes.count ?? 0;

  // Fridges with NO reading yet today (council 2026-07-31 F4): "nobody has
  // temped the fridges" is itself attention-worthy — but only once the store
  // is meaningfully open (after the opening-overdue hour), else the 9am view
  // is all noise.
  const uncheckedFridges = overview.fridges.filter((f) => f.status === "no_reading_today").length;
  const fridgeUncheckedAlert = uncheckedFridges > 0 && minutesOfDay > EXPECTED_BY.openingOverdueAfter;

  // Attention items, priority order: overdue → temp excursion → unchecked
  // fridges → maintenance notes (the first two are the RED class in
  // pulseScore; the rest are YELLOW).
  const attention: AttentionItem[] = [];
  for (const r of reports) if (r.overdue === "overdue") attention.push({ kind: "overdue", reportKey: r.key });
  for (const f of fridges) if (f.outOfRange) attention.push({ kind: "fridge", fridgeName: f.name, equipId: f.equipId });
  if (fridgeUncheckedAlert) attention.push({ kind: "fridge_unchecked", count: uncheckedFridges });
  if (maintenanceNotesToday > 0) attention.push({ kind: "maintenance_note", count: maintenanceNotesToday });

  return {
    locationId: args.locationId,
    today: args.date,
    reports,
    fridges,
    fridgeFlagCount,
    maintenanceNotesToday,
    activeToday,
    cateringToday,
    attention,
  };
}
