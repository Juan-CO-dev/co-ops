import type { SupabaseClient } from "@supabase/supabase-js";
import { isPrepData } from "@/lib/prep";
import {
  FRIDGE_DEFAULT_SAFE_MAX_F,
  listMaintenanceReportDates,
  loadMaintenanceReportDetail,
  type MaintenanceReportDetail,
} from "@/lib/maintenance";
import { derivePrepHave, parStatusFromHave, isOutOfRangeTemp } from "@/lib/report-signals";
import { loadShiftWrapUp } from "@/lib/pm-report";
import type { ShiftWrapUpRow } from "@/lib/pm-report";
import { loadReportStatuses } from "@/lib/midshift";
import type { ReportKey, ReportProgress } from "@/lib/midshift";
import type { RoleCode } from "@/lib/roles";
import { loadOpeningCloserCountSnapshots } from "@/lib/opening";
import type { OpeningNoPriorDataReason } from "@/lib/types";

export const REPORTS_HUB_CASH_LEVEL = 4; // cash visible KH+
export const REPORTS_HUB_NOTES_LEVEL = 5; // notes visible SL+

export type ReportTypeKey = "opening" | "closing" | "am_prep" | "mid_day" | "cash" | "pm" | "maintenance";

export interface Viewer {
  userId: string;
  level: number;
}

export interface SignalSummary {
  underPar: number;
  overPar: number;
  skipped: number;
  tempFlags: number;
  cashOverShortCents: number | null;
}

export interface ReportListItem {
  type: ReportTypeKey;
  id: string; // checklist_instances.id | cash_reports.id | pm_reports.id
  date: string; // operational date (YYYY-MM-DD)
  locationId: string;
  submitterName: string | null;
  status: string;
  /**
   * Derived signal summary — compute-on-read from already-authorized data.
   * CO report volumes are small (tens per date window); a materialized signal
   * column is the future optimization when volume grows.
   */
  signalSummary?: SignalSummary;
}

export interface SignalFilters {
  underPar?: boolean;
  overPar?: boolean;
  skipped?: boolean;
  tempFlag?: boolean;
  cashOver?: boolean;
  cashShort?: boolean;
}

export interface ListFilters {
  viewer: Viewer;
  locationId: string;
  dateFrom: string; // YYYY-MM-DD inclusive
  dateTo: string; // YYYY-MM-DD inclusive
  types?: ReportTypeKey[]; // optional; default = all the viewer may see
  /**
   * Derived signal filters — applied after base list-visibility gates (cash
   * KH+, PM own-for-employees). All base visibility invariants are untouched.
   */
  signalFilters?: SignalFilters;
}

/**
 * Map a checklist template (type + prep_subtype) to a hub ReportTypeKey.
 * Uses prep_subtype column (schema-enforced: 'am_prep' | 'mid_day_prep') for prep
 * discrimination — NOT name regex, which breaks on template renames.
 */
export function checklistReportType(type: string, prepSubtype: string | null): ReportTypeKey | null {
  if (type === "opening") return "opening";
  if (type === "closing") return "closing";
  if (type === "prep") {
    if (prepSubtype === "am_prep") return "am_prep";
    if (prepSubtype === "mid_day_prep") return "mid_day";
  }
  return null;
}

/** Internal type carries submitterId + submittedAt for sort; both stripped before return. */
type ReportListItemInternal = ReportListItem & { submitterId: string | null; submittedAt: string | null };

export async function listReports(service: SupabaseClient, f: ListFilters): Promise<ReportListItem[]> {
  const want = (t: ReportTypeKey) => !f.types || f.types.includes(t);
  const items: ReportListItemInternal[] = [];

  // ── checklist-based (opening/closing/am_prep/mid_day) — visible to everyone ──
  if (want("opening") || want("closing") || want("am_prep") || want("mid_day")) {
    const { data: insts } = await service
      .from("checklist_instances")
      .select("id, location_id, date, status, confirmed_by, confirmed_at, template_id")
      .eq("location_id", f.locationId)
      .gte("date", f.dateFrom)
      .lte("date", f.dateTo);
    const rows = (insts ?? []) as Array<{
      id: string;
      location_id: string;
      date: string;
      status: string;
      confirmed_by: string | null;
      confirmed_at: string | null;
      template_id: string;
    }>;
    const tmplIds = [...new Set(rows.map((r) => r.template_id))];
    const typeById = new Map<string, ReportTypeKey>();
    if (tmplIds.length) {
      const { data: tmpls } = await service
        .from("checklist_templates")
        .select("id, type, prep_subtype")
        .in("id", tmplIds);
      for (const t of (tmpls ?? []) as Array<{ id: string; type: string; prep_subtype: string | null }>) {
        const rt = checklistReportType(t.type, t.prep_subtype);
        if (rt) typeById.set(t.id, rt);
      }
    }
    for (const r of rows) {
      const rt = typeById.get(r.template_id);
      if (!rt || !want(rt)) continue;
      items.push({
        type: rt,
        id: r.id,
        date: r.date,
        locationId: r.location_id,
        submitterName: null,
        status: r.status,
        submitterId: r.confirmed_by,
        submittedAt: r.confirmed_at,
      });
    }
  }

  // ── cash — KH+ (L4+) only ──
  if (want("cash") && f.viewer.level >= REPORTS_HUB_CASH_LEVEL) {
    const { data: cash } = await service
      .from("cash_reports")
      .select("id, location_id, report_date, signed_by, signed_at")
      .eq("location_id", f.locationId)
      .gte("report_date", f.dateFrom)
      .lte("report_date", f.dateTo)
      .is("superseded_at", null);
    for (const r of (cash ?? []) as Array<{ id: string; location_id: string; report_date: string; signed_by: string; signed_at: string | null }>) {
      items.push({
        type: "cash",
        id: r.id,
        date: r.report_date,
        locationId: r.location_id,
        submitterName: null,
        status: "submitted",
        submitterId: r.signed_by,
        submittedAt: r.signed_at ?? null,
      });
    }
  }

  // ── PM — L4+ see all submitted; <L4 sees only reports where the viewer has an eval ──
  if (want("pm")) {
    const { data: pm } = await service
      .from("pm_reports")
      .select("id, location_id, report_date, status, submitted_by, submitted_at")
      .eq("location_id", f.locationId)
      .gte("report_date", f.dateFrom)
      .lte("report_date", f.dateTo)
      .is("superseded_at", null)
      .in("status", ["submitted", "incomplete_confirmed", "auto_finalized"]);
    let pmRows = (pm ?? []) as Array<{
      id: string;
      location_id: string;
      report_date: string;
      status: string;
      submitted_by: string | null;
      submitted_at: string | null;
    }>;
    if (f.viewer.level < REPORTS_HUB_CASH_LEVEL) {
      // employee: keep only reports that contain an eval about them
      const ids = pmRows.map((r) => r.id);
      const mine = new Set<string>();
      if (ids.length) {
        const { data: evals } = await service
          .from("pm_employee_evals")
          .select("pm_report_id")
          .in("pm_report_id", ids)
          .eq("employee_id", f.viewer.userId)
          .is("superseded_at", null);
        for (const e of (evals ?? []) as Array<{ pm_report_id: string }>) mine.add(e.pm_report_id);
      }
      pmRows = pmRows.filter((r) => mine.has(r.id));
    }
    for (const r of pmRows) {
      items.push({
        type: "pm",
        id: r.id,
        date: r.report_date,
        locationId: r.location_id,
        submitterName: null,
        status: r.status,
        submitterId: r.submitted_by,
        submittedAt: r.submitted_at ?? null,
      });
    }
  }

  // ── resolve submitter names ──
  // Collect all submitter IDs captured during the push loops above.
  const submitterIds = new Set<string>(
    items.map((it) => it.submitterId).filter((id): id is string => id !== null),
  );
  const nameById = new Map<string, string>();
  if (submitterIds.size) {
    const { data: users } = await service
      .from("users")
      .select("id, name")
      .in("id", [...submitterIds]);
    for (const u of (users ?? []) as Array<{ id: string; name: string }>) nameById.set(u.id, u.name);
  }
  // ── Maintenance internal rows (synthesized per-(location,date) digest; L3+
  // for all). Built as internal rows that carry their OWN signalSummary and
  // SKIP computeReportSignals — the synthetic id "maintenance-{date}"
  // doesn't resolve there (its checklist branch would query checklist_instances
  // by that id, find nothing, and clobber tempFlags to 0). The id is colon-free
  // so it round-trips safely through the detail-page URL. ──
  const maintInternal: ReportListItemInternal[] = [];
  if (want("maintenance")) {
    const dates = await listMaintenanceReportDates(service, f.locationId, f.dateFrom, f.dateTo);
    for (const d of dates) {
      maintInternal.push({
        type: "maintenance",
        id: `maintenance-${d.date}`,
        date: d.date,
        locationId: f.locationId,
        submitterName: null,
        submitterId: null,
        submittedAt: null,
        status: d.tempFlags > 0 ? "flags" : "ok",
        signalSummary: { underPar: 0, overPar: 0, skipped: 0, tempFlags: d.tempFlags, cashOverShortCents: null },
      });
    }
  }

  // Compute signals for the non-maintenance items (maintenance carries its own).
  const sf = f.signalFilters;
  const hasSf = sf &&
    (sf.underPar || sf.overPar || sf.skipped || sf.tempFlag || sf.cashOver || sf.cashShort);
  const tempItemIds = await loadLocationTempItemIds(service, f.locationId);
  const itemsWithSignals: ReportListItemInternal[] = await Promise.all(
    items.map(async (item) => {
      const { signals } = await computeReportSignals(service, {
        type: item.type,
        id: item.id,
        tempItemIds,
      });
      return {
        ...item,
        signalSummary: {
          underPar: signals.underPar,
          overPar: signals.overPar,
          skipped: signals.skipped,
          tempFlags: signals.tempFlags,
          cashOverShortCents: signals.cashOverShortCents,
        },
      };
    }),
  );

  // Merge maintenance + non-maintenance, then apply signal filters uniformly.
  // The standard filter already yields the right maintenance behavior: a
  // non-temp filter (underPar/overPar/skipped/cash*) excludes maintenance (its
  // non-temp signals are 0); the tempFlag filter keeps only flagged days.
  let combined: ReportListItemInternal[] = [...itemsWithSignals, ...maintInternal];
  if (hasSf) {
    combined = combined.filter((item) => {
      const s = item.signalSummary!;
      if (sf!.underPar && s.underPar <= 0) return false;
      if (sf!.overPar && s.overPar <= 0) return false;
      if (sf!.skipped && s.skipped <= 0) return false;
      if (sf!.tempFlag && s.tempFlags <= 0) return false;
      if (sf!.cashOver && (s.cashOverShortCents === null || s.cashOverShortCents <= 0)) return false;
      if (sf!.cashShort && (s.cashOverShortCents === null || s.cashOverShortCents >= 0)) return false;
      return true;
    });
  }

  // Sort ONCE with the established comparator: submittedAt desc (nulls last)
  // then date desc. Maintenance rows (submittedAt null) sort among the
  // null-submittedAt tail by date desc — established ordering preserved.
  combined.sort((a, b) => {
    if (a.submittedAt !== null && b.submittedAt !== null) {
      if (a.submittedAt > b.submittedAt) return -1;
      if (a.submittedAt < b.submittedAt) return 1;
    } else if (a.submittedAt !== null) {
      return -1;
    } else if (b.submittedAt !== null) {
      return 1;
    }
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });

  // Strip internal fields; resolve submitterName from submitterId.
  return combined.map(({ submitterId, submittedAt: _sa, ...rest }) => ({
    ...rest,
    submitterName: submitterId ? (nameById.get(submitterId) ?? null) : rest.submitterName ?? null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 3: Checklist detail loader + dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export interface ChecklistDetailItem {
  station: string;
  label: string;
  done: boolean;
  byName: string | null;
  countValue: number | null;
  note: string | null; // null unless viewer.level >= REPORTS_HUB_NOTES_LEVEL
  isTempFlag: boolean; // true when item is in location's tempItemIds AND count_value > FRIDGE_DEFAULT_SAFE_MAX_F
}

/**
 * A yes/no + free-text "check" answer surfaced on the report drill-in (Slice 3).
 * Built from completions whose prep_data.inputs carry yesNo and/or freeText
 * (section/item questions AND existing Misc items). Numeric lines stay in
 * prepValues — a line carrying numeric inputs is NOT a check.
 */
export interface ChecklistCheckRow {
  label: string;
  yesNo: boolean | null; // null when the line has no yes/no (free-text-only)
  freeText: string | null; // the note / text answer, when present
}

export interface ChecklistReportDetail {
  kind: "checklist";
  type: ReportTypeKey;
  date: string;
  status: string;
  items: ChecklistDetailItem[];
  signals: ReportSignals;
  prepValues: PrepValueRow[];
  checks: ChecklistCheckRow[];
}

async function loadChecklistDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; instanceId: string; locationId: string; type: ReportTypeKey },
): Promise<ChecklistReportDetail | null> {
  const { data: inst } = await service
    .from("checklist_instances")
    .select("id, template_id, date, status, location_id")
    .eq("id", args.instanceId)
    .maybeSingle<{ id: string; template_id: string; date: string; status: string; location_id: string }>();
  if (!inst) return null;
  // SECURITY: the record must belong to the caller's authorized location.
  // The page validated args.locationId via lockLocationContext; binding the
  // resource to it prevents a cross-location IDOR (loading another store's
  // report by id while passing a location you DO have access to).
  if (inst.location_id !== args.locationId) return null;

  // AFTER the IDOR guard: load temp-item ids and compute signals (derived from
  // already-authorized data — does not bypass cash gate, IDOR guard, or notes redaction).
  const tempItemIds = await loadLocationTempItemIds(service, inst.location_id);
  const { signals, prepValues, checks } = await computeReportSignals(service, {
    type: args.type,
    id: args.instanceId,
    tempItemIds,
  });

  const showNotes = args.viewer.level >= REPORTS_HUB_NOTES_LEVEL;

  const { data: titems } = await service
    .from("checklist_template_items")
    .select("id, station, label, display_order")
    .eq("template_id", inst.template_id)
    .eq("active", true)
    .order("display_order", { ascending: true });

  const { data: comps } = await service
    .from("checklist_completions")
    .select("template_item_id, completed_by, count_value, notes")
    .eq("instance_id", args.instanceId)
    .is("superseded_at", null)
    .is("revoked_at", null);

  const compByItem = new Map<
    string,
    { completed_by: string | null; count_value: number | null; notes: string | null }
  >();
  for (const c of (comps ?? []) as Array<{
    template_item_id: string;
    completed_by: string | null;
    count_value: number | null;
    notes: string | null;
  }>) {
    compByItem.set(c.template_item_id, c);
  }

  const byIds = [
    ...new Set(
      [...compByItem.values()]
        .map((c) => c.completed_by)
        .filter((v): v is string => !!v),
    ),
  ];
  const nameById = new Map<string, string>();
  if (byIds.length) {
    const { data: users } = await service.from("users").select("id, name").in("id", byIds);
    for (const u of (users ?? []) as Array<{ id: string; name: string }>)
      nameById.set(u.id, u.name);
  }

  const items: ChecklistDetailItem[] = (
    (titems ?? []) as Array<{ id: string; station: string; label: string }>
  ).map((ti) => {
    const c = compByItem.get(ti.id);
    const countValue = c?.count_value ?? null;
    return {
      station: ti.station,
      label: ti.label,
      done: !!c,
      byName: c?.completed_by ? (nameById.get(c.completed_by) ?? null) : null,
      countValue,
      note: showNotes ? c?.notes ?? null : null, // REDACTED below L5
      // isTempFlag: item is in the location's fridge temp registry AND its count exceeds the safe max.
      // tempItemIds already loaded above (after the IDOR guard).
      isTempFlag: tempItemIds.has(ti.id) && countValue !== null && countValue > FRIDGE_DEFAULT_SAFE_MAX_F,
    };
  });

  return { kind: "checklist", type: args.type, date: inst.date, status: inst.status, items, signals, prepValues, checks };
}

// ─────────────────────────────────────────────────────────────────────────────
// Opening detail loader — surfaces the Phase 1 verification / recount truth.
//
// The generic loadChecklistDetail reads only the top-level completion columns
// (count_value, notes), so for an opening report it shows the fridge-temp
// reading but NEVER the spot-check recount — the recount lives in
// prep_data->phase1.opener_recount, with the resolved ground_truth_count +
// prep_need beside it, and the closer-count BASELINE the opener verified
// against lives in opening_closer_count_snapshots (NULL = no prior-day AM-Prep
// submission → the opener established truth by recount).
//
// The old "Option A" (skip verifyExpected when closerCount is null) hid exactly
// the recount-because-no-prior-submission case. This loader renders that case
// instead: the recount value plus a "no prior-day submission" baseline label,
// and an instance-level NULL-sentinel flag for the detail header.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a spot-check item resolved its ground truth, for read-only display.
 *   - "section_verify" → opener verified the closer-count baseline as correct
 *   - "recount"        → opener recounted (closer-count baseline present but
 *                         flagged, OR — the NULL-sentinel case — no baseline at all)
 *   - null             → not a spot-check item (cleanliness tick / temp reading)
 */
export type OpeningResolution = "section_verify" | "recount" | null;

export interface OpeningDetailItem {
  station: string;
  label: string;
  done: boolean;
  byName: string | null;
  /** Fridge temp reading (top-level count_value); null on non-temp items. */
  countValue: number | null;
  note: string | null; // null unless viewer.level >= REPORTS_HUB_NOTES_LEVEL
  isTempFlag: boolean;
  /**
   * Spot-check item only. The closer-count BASELINE this item verified against:
   *   - closerCount: number → captured prior-day closer count
   *   - closerCount: null   → NO prior-day submission (recount established truth)
   * `null` for the whole field means this is not a spot-check item.
   */
  baseline: { closerCount: number | null; par: number | null } | null;
  /** Opener's recount value (prep_data->phase1.opener_recount); null when none. */
  openerRecount: number | null;
  /** Resolved ground truth (prep_data->phase1.ground_truth_count); null when none. */
  groundTruth: number | null;
  /** Derived prep need (prep_data->phase1.prep_need); null when none. */
  prepNeed: number | null;
  /** How this spot-check resolved; null for non-spot-check items. */
  resolution: OpeningResolution;
}

export interface OpeningReportDetail {
  kind: "opening";
  date: string;
  status: string;
  items: OpeningDetailItem[];
  signals: ReportSignals;
  /**
   * Report-level NULL-sentinel indicator. True when the opening was a
   * recount-because-no-prior-day-submission: surfaced when the instance carries
   * `opener_no_prior_data_reason`, OR (defensive) when every spot-check snapshot
   * baseline is NULL. Drives the prominent header banner.
   */
  isRecountNoPriorSubmission: boolean;
  /** The opener's attestation reason when NULL-sentinel engaged; else null. */
  noPriorDataReason: OpeningNoPriorDataReason | null;
}

/** Reads prep_data->phase1 spot-check fields defensively (untyped JSONB boundary). */
function readPhase1SpotCheck(prepData: unknown): {
  openerRecount: number | null;
  groundTruth: number | null;
  prepNeed: number | null;
  spotCheckStatus: string | null;
} | null {
  if (prepData == null || typeof prepData !== "object") return null;
  if (!("phase1" in prepData)) return null;
  const p1 = (prepData as { phase1: unknown }).phase1;
  if (p1 == null || typeof p1 !== "object") return null;
  const rec = (p1 as { opener_recount?: unknown }).opener_recount;
  const gt = (p1 as { ground_truth_count?: unknown }).ground_truth_count;
  const pn = (p1 as { prep_need?: unknown }).prep_need;
  const st = (p1 as { spot_check_status?: unknown }).spot_check_status;
  return {
    openerRecount: typeof rec === "number" ? rec : null,
    groundTruth: typeof gt === "number" ? gt : null,
    prepNeed: typeof pn === "number" ? pn : null,
    spotCheckStatus: typeof st === "string" ? st : null,
  };
}

async function loadOpeningDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; instanceId: string; locationId: string },
): Promise<OpeningReportDetail | null> {
  const { data: inst } = await service
    .from("checklist_instances")
    .select("id, template_id, date, status, location_id, opener_no_prior_data_reason")
    .eq("id", args.instanceId)
    .maybeSingle<{
      id: string;
      template_id: string;
      date: string;
      status: string;
      location_id: string;
      opener_no_prior_data_reason: OpeningNoPriorDataReason | null;
    }>();
  if (!inst) return null;
  // SECURITY: cross-location IDOR guard — the record must belong to the caller's
  // authorized location (page validated args.locationId via lockLocationContext).
  if (inst.location_id !== args.locationId) return null;

  // AFTER the IDOR guard: signals + temp-item ids (derived from already-authorized data).
  const tempItemIds = await loadLocationTempItemIds(service, inst.location_id);
  const { signals } = await computeReportSignals(service, {
    type: "opening",
    id: args.instanceId,
    tempItemIds,
  });

  const showNotes = args.viewer.level >= REPORTS_HUB_NOTES_LEVEL; // SL+ (L5)

  // Reuse the canonical opening read path for the closer-count baselines
  // (the same loader loadOpeningState materializes + reads from).
  const closerSnapshots = await loadOpeningCloserCountSnapshots(service, args.instanceId);

  const { data: titems } = await service
    .from("checklist_template_items")
    .select("id, station, label, display_order")
    .eq("template_id", inst.template_id)
    .eq("active", true)
    .order("display_order", { ascending: true });

  // Read prep_data so the recount / ground_truth / prep_need surface — the
  // generic loader never selects this, which is why the recount was invisible.
  const { data: comps } = await service
    .from("checklist_completions")
    .select("template_item_id, completed_by, count_value, notes, prep_data")
    .eq("instance_id", args.instanceId)
    .is("superseded_at", null)
    .is("revoked_at", null);

  // Spot-check phase1 fields live on the phase1 row; under dual-membership an
  // openingPhase2 item also has a phase2 row — phase1 fields are absent there,
  // so the phase1 row is preferred when both exist for one item.
  const compByItem = new Map<
    string,
    { completed_by: string | null; count_value: number | null; notes: string | null; prep_data: unknown }
  >();
  for (const c of (comps ?? []) as Array<{
    template_item_id: string;
    completed_by: string | null;
    count_value: number | null;
    notes: string | null;
    prep_data: unknown;
  }>) {
    const existing = compByItem.get(c.template_item_id);
    const isPhase1 =
      c.prep_data != null && typeof c.prep_data === "object" && "phase1" in c.prep_data;
    if (!existing || isPhase1) compByItem.set(c.template_item_id, c);
  }

  const byIds = [
    ...new Set(
      [...compByItem.values()].map((c) => c.completed_by).filter((v): v is string => !!v),
    ),
  ];
  const nameById = new Map<string, string>();
  if (byIds.length) {
    const { data: users } = await service.from("users").select("id, name").in("id", byIds);
    for (const u of (users ?? []) as Array<{ id: string; name: string }>) nameById.set(u.id, u.name);
  }

  let spotCheckCount = 0;
  let nullBaselineCount = 0;

  const items: OpeningDetailItem[] = (
    (titems ?? []) as Array<{ id: string; station: string; label: string }>
  ).map((ti) => {
    const c = compByItem.get(ti.id);
    const countValue = c?.count_value ?? null;
    const snap = closerSnapshots.get(ti.id);
    const isSpotCheck = snap !== undefined;
    const p1 = readPhase1SpotCheck(c?.prep_data ?? null);

    if (isSpotCheck) {
      spotCheckCount += 1;
      if (snap.closerCount === null) nullBaselineCount += 1;
    }

    // Resolution: trust the persisted spot_check_status when present; otherwise
    // derive (recount present → recount; baseline present + verified → section).
    let resolution: OpeningResolution = null;
    if (isSpotCheck) {
      if (p1?.spotCheckStatus === "flagged_recount") resolution = "recount";
      else if (p1?.spotCheckStatus === "matched_via_section_verify") resolution = "section_verify";
      else if ((p1?.openerRecount ?? null) !== null) resolution = "recount";
      else resolution = "section_verify";
    }

    return {
      station: ti.station,
      label: ti.label,
      done: !!c,
      byName: c?.completed_by ? (nameById.get(c.completed_by) ?? null) : null,
      countValue,
      note: showNotes ? (c?.notes ?? null) : null, // REDACTED below L5
      isTempFlag:
        tempItemIds.has(ti.id) && countValue !== null && countValue > FRIDGE_DEFAULT_SAFE_MAX_F,
      baseline: isSpotCheck ? { closerCount: snap.closerCount, par: snap.parValue } : null,
      openerRecount: p1?.openerRecount ?? null,
      groundTruth: p1?.groundTruth ?? null,
      prepNeed: p1?.prepNeed ?? null,
      resolution,
    };
  });

  // NULL-sentinel: the instance attestation is the authoritative signal; the
  // all-null-baseline check is a defensive fallback for pre-attestation rows.
  const isRecountNoPriorSubmission =
    inst.opener_no_prior_data_reason !== null ||
    (spotCheckCount > 0 && nullBaselineCount === spotCheckCount);

  return {
    kind: "opening",
    date: inst.date,
    status: inst.status,
    items,
    signals,
    isRecountNoPriorSubmission,
    noPriorDataReason: inst.opener_no_prior_data_reason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 4: Cash detail loader
// ─────────────────────────────────────────────────────────────────────────────

export interface OnShiftEntry {
  userId: string | null;
  name: string;
}

export interface CashReportDetail {
  kind: "cash";
  date: string;
  locationId: string;
  projectedCents: number;
  drawerTotalCents: number;
  floatCents: number;
  depositCents: number;
  overShortCents: number;
  cashTipsCents: number;
  countMethod: "hand" | "denomination";
  onShift: OnShiftEntry[];
  signedByName: string | null;
  signedAt: string;
  /** null unless viewer.level >= REPORTS_HUB_NOTES_LEVEL (5) — REDACTED below L5 */
  overShortNote: string | null;
  signals: ReportSignals;
}

const CASH_ROW =
  "id, location_id, report_date, projected_cents, drawer_total_cents, float_cents, deposit_cents, over_short_cents, cash_tips_cents, count_method, on_shift, over_short_note, signed_by, signed_at";

async function loadCashDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; id: string; locationId: string },
): Promise<CashReportDetail | null> {
  // SECURITY: L4+ only
  if (args.viewer.level < REPORTS_HUB_CASH_LEVEL) return null;

  const { data } = await service
    .from("cash_reports")
    .select(CASH_ROW)
    .eq("id", args.id)
    .is("superseded_at", null)
    .maybeSingle<Record<string, unknown>>();
  if (!data) return null;
  // SECURITY: record must belong to the caller's authorized location (cross-location IDOR guard).
  if ((data.location_id as string) !== args.locationId) return null;

  // AFTER the IDOR guard: compute signals (derived from already-authorized data —
  // does not bypass the L4+ cash gate, which is checked above; does not expose notes).
  // tempItemIds is empty for cash but required by the shared computeReportSignals signature.
  const { signals } = await computeReportSignals(service, {
    type: "cash",
    id: args.id,
    tempItemIds: new Set<string>(),
  });

  // Resolve signer name
  let signedByName: string | null = null;
  const signedBy = data.signed_by as string | null;
  if (signedBy) {
    const { data: u } = await service
      .from("users")
      .select("name")
      .eq("id", signedBy)
      .maybeSingle<{ name: string }>();
    signedByName = u?.name ?? null;
  }

  const showNote = args.viewer.level >= REPORTS_HUB_NOTES_LEVEL;

  return {
    kind: "cash",
    date: data.report_date as string,
    locationId: data.location_id as string,
    projectedCents: data.projected_cents as number,
    drawerTotalCents: data.drawer_total_cents as number,
    floatCents: data.float_cents as number,
    depositCents: data.deposit_cents as number,
    overShortCents: data.over_short_cents as number,
    cashTipsCents: data.cash_tips_cents as number,
    countMethod: data.count_method as "hand" | "denomination",
    onShift: (data.on_shift as OnShiftEntry[]) ?? [],
    signedByName,
    signedAt: data.signed_at as string,
    // SECURITY: overShortNote ONLY if viewer.level >= REPORTS_HUB_NOTES_LEVEL (5)
    overShortNote: showNote ? ((data.over_short_note as string | null) ?? null) : null,
    signals,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 4: PM detail loader
// ─────────────────────────────────────────────────────────────────────────────

export type Gradient = "great" | "good" | "needs_work";

/** Per-dimension gradient tally for a PM report (summed across all visible evals). */
export interface GradientTallyEntry {
  dimension: "arrivedReady" | "attitude" | "production" | "teamPlayer";
  great: number;
  good: number;
  needsWork: number;
}

export interface PmEvalDetail {
  id: string;
  employeeId: string;
  employeeName: string | null;
  arrivedReady: Gradient;
  attitude: Gradient;
  production: Gradient;
  teamPlayer: Gradient;
  areaToImprove: string | null;
  /** null unless viewer.level >= REPORTS_HUB_NOTES_LEVEL (5) — REDACTED below L5 */
  note: string | null;
}

export interface PmReportDetail {
  kind: "pm";
  date: string;
  locationId: string;
  status: string;
  submittedByName: string | null;
  submittedAt: string | null;
  mvpUserId: string | null;
  mvpName: string | null;
  mvpNote: string | null;
  evals: PmEvalDetail[];
  /** Per-dimension gradient tally, computed from evals visible to this viewer (own-eval for employees, all evals for L4+). */
  gradientTally: GradientTallyEntry[];
  /**
   * Shift activity (L4+ only; empty arrays for employees < L4).
   * wrapUp: per-employee items completed + reports submitted on the report's date.
   * reportProgress: per-report-type progress snapshot for that date.
   * overdue is intentionally OMITTED — a live overdue flag is misleading when viewing a historical report.
   */
  wrapUp: ShiftWrapUpRow[];
  reportProgress: { key: ReportKey; progress: ReportProgress; doneAt: string | null }[];
}

async function loadPmDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; id: string; locationId: string },
): Promise<PmReportDetail | null> {
  const { data: report } = await service
    .from("pm_reports")
    .select("id, location_id, report_date, status, mvp_user_id, mvp_note, submitted_at, submitted_by")
    .eq("id", args.id)
    .is("superseded_at", null)
    .maybeSingle<{
      id: string;
      location_id: string;
      report_date: string;
      status: string;
      mvp_user_id: string | null;
      mvp_note: string | null;
      submitted_at: string | null;
      submitted_by: string | null;
    }>();
  if (!report) return null;
  // SECURITY: record must belong to the caller's authorized location (cross-location IDOR guard).
  if (report.location_id !== args.locationId) return null;

  // Tier logic: L4+ see all evals; L3- see only their own eval (or null if none)
  const isManager = args.viewer.level >= REPORTS_HUB_CASH_LEVEL; // L4+
  const showNotes = args.viewer.level >= REPORTS_HUB_NOTES_LEVEL; // L5+

  // Load evals — always select note (service-role bypasses RLS); app-layer
  // redaction below sets note to null for employees and for managers below L5.
  // SECURITY: employee (< L4) sees ONLY their own eval via the .eq() filter.
  const evalCols = "id, employee_id, arrived_ready, attitude, production, team_player, area_to_improve, note";
  let evalQuery = service
    .from("pm_employee_evals")
    .select(evalCols)
    .eq("pm_report_id", report.id)
    .is("superseded_at", null);

  // SECURITY: employee (< L4) sees ONLY their own eval
  if (!isManager) {
    evalQuery = evalQuery.eq("employee_id", args.viewer.userId);
  }

  const { data: evalRows } = await evalQuery;
  type EvalRow = {
    id: string;
    employee_id: string;
    arrived_ready: Gradient;
    attitude: Gradient;
    production: Gradient;
    team_player: Gradient;
    area_to_improve: string | null;
    note: string | null;
  };
  const rows = (evalRows ?? []) as unknown as EvalRow[];

  // SECURITY: employee (< L4) with no eval in this report → return null
  if (!isManager && rows.length === 0) return null;

  // Resolve employee names
  const empIds = [...new Set(rows.map((r) => r.employee_id))];
  const nameById = new Map<string, string>();
  if (empIds.length) {
    const { data: users } = await service.from("users").select("id, name").in("id", empIds);
    for (const u of (users ?? []) as Array<{ id: string; name: string }>) nameById.set(u.id, u.name);
  }

  // Resolve submitted-by name
  let submittedByName: string | null = null;
  if (report.submitted_by) {
    const { data: sb } = await service
      .from("users")
      .select("name")
      .eq("id", report.submitted_by)
      .maybeSingle<{ name: string }>();
    submittedByName = sb?.name ?? null;
  }

  // Resolve MVP name
  let mvpName: string | null = null;
  if (report.mvp_user_id) {
    const { data: mv } = await service
      .from("users")
      .select("name")
      .eq("id", report.mvp_user_id)
      .maybeSingle<{ name: string }>();
    mvpName = mv?.name ?? null;
  }

  const evals: PmEvalDetail[] = rows.map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeName: nameById.get(r.employee_id) ?? null,
    arrivedReady: r.arrived_ready,
    attitude: r.attitude,
    production: r.production,
    teamPlayer: r.team_player,
    areaToImprove: r.area_to_improve ?? null,
    // SECURITY: note is present ONLY if manager (isManager); further redacted below L5
    // Employees never get note (not even selected in the query above)
    note: isManager ? (showNotes ? (r.note ?? null) : null) : null,
  }));

  // Compute gradient tally from the already-loaded (and tier-gated) rows.
  // Employees see only their own eval; managers see all — the tally reflects
  // exactly what this viewer can see. No new data exposure.
  const dimensions: Array<{
    key: "arrivedReady" | "attitude" | "production" | "teamPlayer";
    field: keyof EvalRow;
  }> = [
    { key: "arrivedReady", field: "arrived_ready" },
    { key: "attitude", field: "attitude" },
    { key: "production", field: "production" },
    { key: "teamPlayer", field: "team_player" },
  ];
  const gradientTally: GradientTallyEntry[] = dimensions.map(({ key, field }) => {
    let great = 0;
    let good = 0;
    let needsWork = 0;
    for (const r of rows) {
      const val = r[field] as Gradient;
      if (val === "great") great++;
      else if (val === "good") good++;
      else if (val === "needs_work") needsWork++;
    }
    return { dimension: key, great, good, needsWork };
  });

  // Shift activity — managers only; empty arrays for employees (< L4).
  // overdue intentionally omitted: a live overdue flag is misleading when viewing a historical report.
  let wrapUp: ShiftWrapUpRow[] = [];
  let reportProgress: { key: ReportKey; progress: ReportProgress; doneAt: string | null }[] = [];
  if (isManager) {
    wrapUp = await loadShiftWrapUp(service, { locationId: report.location_id, date: report.report_date });
    const actor = {
      userId: args.viewer.userId,
      role: "key_holder" as RoleCode,
      level: args.viewer.level,
    };
    const { rows: statusRows } = await loadReportStatuses(service, {
      locationId: report.location_id,
      date: report.report_date,
      actor,
    });
    reportProgress = statusRows.map((r) => ({ key: r.key, progress: r.progress, doneAt: r.doneAt }));
  }

  return {
    kind: "pm",
    date: report.report_date,
    locationId: report.location_id,
    status: report.status,
    submittedByName,
    submittedAt: report.submitted_at ?? null,
    mvpUserId: report.mvp_user_id ?? null,
    mvpName,
    mvpNote: isManager ? (report.mvp_note ?? null) : null,
    evals,
    gradientTally,
    wrapUp,
    reportProgress,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ReportDetail union + dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export type ReportDetail =
  | ChecklistReportDetail
  | OpeningReportDetail
  | CashReportDetail
  | PmReportDetail
  | MaintenanceReportDetail;

export async function loadReportDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; type: ReportTypeKey; id: string; locationId: string },
): Promise<ReportDetail | null> {
  if (args.type === "opening") {
    return loadOpeningDetail(service, { viewer: args.viewer, instanceId: args.id, locationId: args.locationId });
  }
  if (
    args.type === "closing" ||
    args.type === "am_prep" ||
    args.type === "mid_day"
  ) {
    return loadChecklistDetail(service, { viewer: args.viewer, instanceId: args.id, locationId: args.locationId, type: args.type });
  }
  if (args.type === "cash") {
    return loadCashDetail(service, { viewer: args.viewer, id: args.id, locationId: args.locationId });
  }
  if (args.type === "pm") {
    return loadPmDetail(service, { viewer: args.viewer, id: args.id, locationId: args.locationId });
  }
  if (args.type === "maintenance") {
    // id shape: "maintenance-{date}". The location is already authorized by the
    // caller (lockLocationContext on the detail page, passed as args.locationId);
    // parse + validate the operational date.
    const prefix = "maintenance-";
    if (!args.id.startsWith(prefix)) return null;
    const date = args.id.slice(prefix.length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    return loadMaintenanceReportDetail(service, args.locationId, date);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 1: computeReportSignals + temp-item id loader
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportSignals {
  done: number;
  total: number; // required template items (checklist); 1 for cash
  skipped: number; // required items with no live completion
  underPar: number; // prep: items with total < par
  overPar: number; // prep: items with total > par
  tempFlags: number; // completions on temp items with count_value > 41
  cashOverShortCents: number | null; // cash only
}

export interface PrepValueRow {
  label: string;
  par: number | null;
  onHand: number | null;
  total: number | null;
  parStatus: "under" | "over" | "at" | "na";
}

/**
 * Temp-item template-item ids for a location, from the maintenance registry.
 * Returns a Set of checklist_template_item UUIDs whose completions represent
 * fridge temperature readings. Used to gate tempFlags counting — only
 * completions on these items are considered, never "any count_value > 41"
 * (prep totals can exceed 41 and would false-positive).
 */
export async function loadLocationTempItemIds(
  service: SupabaseClient,
  locationId: string,
): Promise<Set<string>> {
  const { data } = await service
    .from("maintenance_equipment")
    .select("opening_temp_item_id, closing_temp_item_id")
    .eq("location_id", locationId)
    .eq("kind", "fridge");
  const ids = new Set<string>();
  for (const r of (data ?? []) as Array<{
    opening_temp_item_id: string | null;
    closing_temp_item_id: string | null;
  }>) {
    if (r.opening_temp_item_id) ids.add(r.opening_temp_item_id);
    if (r.closing_temp_item_id) ids.add(r.closing_temp_item_id);
  }
  return ids;
}

/**
 * Per-report derived signals. For checklist instances it loads template items
 * + live completions (incl. prep_data). `tempItemIds` is the location's temp
 * item id set — load once via loadLocationTempItemIds and pass in so callers
 * can reuse across multiple reports. For cash it reads over_short_cents.
 * Returns signals + (prep) the per-item value rows.
 *
 * SECURITY: reads only data already authorised for the caller; no new
 * exposure — the cash KH+ gate and cross-location IDOR guard are upstream.
 * prep_data is always narrowed via isPrepData, never trusted as raw JSONB.
 */
export async function computeReportSignals(
  service: SupabaseClient,
  args: { type: ReportTypeKey; id: string; tempItemIds: Set<string> },
): Promise<{ signals: ReportSignals; prepValues: PrepValueRow[]; checks: ChecklistCheckRow[] }> {
  const empty: ReportSignals = {
    done: 0,
    total: 0,
    skipped: 0,
    underPar: 0,
    overPar: 0,
    tempFlags: 0,
    cashOverShortCents: null,
  };

  if (args.type === "cash") {
    const { data } = await service
      .from("cash_reports")
      .select("over_short_cents")
      .eq("id", args.id)
      .is("superseded_at", null)
      .maybeSingle<{ over_short_cents: number | null }>();
    return {
      signals: {
        ...empty,
        total: 1,
        done: 1,
        cashOverShortCents: data?.over_short_cents ?? null,
      },
      prepValues: [],
      checks: [],
    };
  }

  if (args.type === "pm") {
    // pm uses its own gradient tally in the detail loader (Task 2)
    return { signals: empty, prepValues: [], checks: [] };
  }

  // checklist types: opening / closing / am_prep / mid_day
  const { data: inst } = await service
    .from("checklist_instances")
    .select("template_id")
    .eq("id", args.id)
    .maybeSingle<{ template_id: string }>();
  if (!inst) return { signals: empty, prepValues: [], checks: [] };

  const { data: titems } = await service
    .from("checklist_template_items")
    .select("id, label, required")
    .eq("template_id", inst.template_id)
    .eq("active", true);
  const items = (titems ?? []) as Array<{ id: string; label: string; required: boolean }>;
  const labelById = new Map(items.map((i) => [i.id, i.label]));

  const { data: comps } = await service
    .from("checklist_completions")
    .select("template_item_id, count_value, prep_data")
    .eq("instance_id", args.id)
    .is("superseded_at", null)
    .is("revoked_at", null);
  const rows = (comps ?? []) as Array<{
    template_item_id: string;
    count_value: number | null;
    prep_data: unknown;
  }>;
  const completedIds = new Set(rows.map((r) => r.template_item_id));

  const requiredItems = items.filter((i) => i.required);
  const done = requiredItems.filter((i) => completedIds.has(i.id)).length;
  const total = requiredItems.length;
  const skipped = total - done;

  let tempFlags = 0;
  let underPar = 0;
  let overPar = 0;
  const prepValues: PrepValueRow[] = [];
  const checks: ChecklistCheckRow[] = [];

  for (const r of rows) {
    // Temp-flag: ONLY on completions whose template_item_id is in the registry
    // tempItemIds set AND count_value > 41. Never "any count_value > 41" —
    // prep totals can exceed 41 and would false-positive.
    if (args.tempItemIds.has(r.template_item_id) && isOutOfRangeTemp(r.count_value)) {
      tempFlags++;
    }

    // Prep values: only completions that carry valid prep_data
    if (isPrepData(r.prep_data)) {
      // Slice 3: a completion carrying yes/no or free-text answers is a CHECK,
      // not a numeric prep value. yes_no + note lines produce a single check row
      // carrying both. Numeric lines fall through to the prepValues path below,
      // byte-identical to prior behavior.
      const inputs = r.prep_data.inputs;
      if (inputs.yesNo !== undefined || inputs.freeText !== undefined) {
        checks.push({
          label: labelById.get(r.template_item_id) ?? "—",
          yesNo: inputs.yesNo ?? null,
          freeText: inputs.freeText ?? null,
        });
        continue;
      }
      const par = r.prep_data.snapshot.parValue; // number | null
      const totalVal = r.prep_data.inputs.total ?? null;
      const onHand = r.prep_data.inputs.onHand ?? null;
      const isMidDay = args.type === "mid_day";
      // Shared derivation — mid_day total is a DELTA, am_prep total is FINAL.
      const have = derivePrepHave({ isMidDay, onHand, total: totalVal });
      const displayTotal = isMidDay ? have : totalVal;
      const parStatus = parStatusFromHave(par, have);
      if (parStatus === "under") underPar++;
      else if (parStatus === "over") overPar++;
      prepValues.push({
        label: labelById.get(r.template_item_id) ?? "—",
        par,
        onHand,
        total: displayTotal,
        parStatus,
      });
    }
  }

  return {
    signals: { done, total, skipped, underPar, overPar, tempFlags, cashOverShortCents: null },
    prepValues,
    checks,
  };
}
