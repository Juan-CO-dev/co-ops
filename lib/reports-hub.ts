import type { SupabaseClient } from "@supabase/supabase-js";

export const REPORTS_HUB_CASH_LEVEL = 4; // cash visible KH+
export const REPORTS_HUB_NOTES_LEVEL = 5; // notes visible SL+

export type ReportTypeKey = "opening" | "closing" | "am_prep" | "mid_day" | "cash" | "pm";

export interface Viewer {
  userId: string;
  level: number;
}

export interface ReportListItem {
  type: ReportTypeKey;
  id: string; // checklist_instances.id | cash_reports.id | pm_reports.id
  date: string; // operational date (YYYY-MM-DD)
  locationId: string;
  submitterName: string | null;
  status: string;
}

export interface ListFilters {
  viewer: Viewer;
  locationId: string;
  dateFrom: string; // YYYY-MM-DD inclusive
  dateTo: string; // YYYY-MM-DD inclusive
  types?: ReportTypeKey[]; // optional; default = all the viewer may see
}

/**
 * Map a checklist template (type + prep_subtype) to a hub ReportTypeKey.
 * Uses prep_subtype column (schema-enforced: 'am_prep' | 'mid_day_prep') for prep
 * discrimination — NOT name regex, which breaks on template renames.
 */
function checklistReportType(type: string, prepSubtype: string | null): ReportTypeKey | null {
  if (type === "opening") return "opening";
  if (type === "closing") return "closing";
  if (type === "prep") {
    if (prepSubtype === "am_prep") return "am_prep";
    if (prepSubtype === "mid_day_prep") return "mid_day";
  }
  return null;
}

/** Internal type carries submitterId for the name-resolution pass; stripped before return. */
type ReportListItemInternal = ReportListItem & { submitterId: string | null };

export async function listReports(service: SupabaseClient, f: ListFilters): Promise<ReportListItem[]> {
  const want = (t: ReportTypeKey) => !f.types || f.types.includes(t);
  const items: ReportListItemInternal[] = [];

  // ── checklist-based (opening/closing/am_prep/mid_day) — visible to everyone ──
  if (want("opening") || want("closing") || want("am_prep") || want("mid_day")) {
    const { data: insts } = await service
      .from("checklist_instances")
      .select("id, location_id, date, status, confirmed_by, template_id")
      .eq("location_id", f.locationId)
      .gte("date", f.dateFrom)
      .lte("date", f.dateTo);
    const rows = (insts ?? []) as Array<{
      id: string;
      location_id: string;
      date: string;
      status: string;
      confirmed_by: string | null;
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
      });
    }
  }

  // ── cash — KH+ (L4+) only ──
  if (want("cash") && f.viewer.level >= REPORTS_HUB_CASH_LEVEL) {
    const { data: cash } = await service
      .from("cash_reports")
      .select("id, location_id, report_date, signed_by")
      .eq("location_id", f.locationId)
      .gte("report_date", f.dateFrom)
      .lte("report_date", f.dateTo)
      .is("superseded_at", null);
    for (const r of (cash ?? []) as Array<{ id: string; location_id: string; report_date: string; signed_by: string }>) {
      items.push({
        type: "cash",
        id: r.id,
        date: r.report_date,
        locationId: r.location_id,
        submitterName: null,
        status: "submitted",
        submitterId: r.signed_by,
      });
    }
  }

  // ── PM — L4+ see all submitted; <L4 sees only reports where the viewer has an eval ──
  if (want("pm")) {
    const { data: pm } = await service
      .from("pm_reports")
      .select("id, location_id, report_date, status, submitted_by")
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
  // Set submitterName from the captured submitterId; strip submitterId before returning.
  const result: ReportListItem[] = items.map(({ submitterId, ...rest }) => ({
    ...rest,
    submitterName: submitterId ? (nameById.get(submitterId) ?? null) : null,
  }));

  // newest first
  return result.sort((a, b) => (a.date < b.date ? 1 : -1));
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
}

export interface ChecklistReportDetail {
  kind: "checklist";
  type: ReportTypeKey;
  date: string;
  status: string;
  items: ChecklistDetailItem[];
}

async function loadChecklistDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; instanceId: string; type: ReportTypeKey },
): Promise<ChecklistReportDetail | null> {
  const { data: inst } = await service
    .from("checklist_instances")
    .select("id, template_id, date, status")
    .eq("id", args.instanceId)
    .maybeSingle<{ id: string; template_id: string; date: string; status: string }>();
  if (!inst) return null;

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
    return {
      station: ti.station,
      label: ti.label,
      done: !!c,
      byName: c?.completed_by ? (nameById.get(c.completed_by) ?? null) : null,
      countValue: c?.count_value ?? null,
      note: showNotes ? c?.notes ?? null : null, // REDACTED below L5
    };
  });

  return { kind: "checklist", type: args.type, date: inst.date, status: inst.status, items };
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
}

const CASH_ROW =
  "id, location_id, report_date, projected_cents, drawer_total_cents, float_cents, deposit_cents, over_short_cents, cash_tips_cents, count_method, on_shift, over_short_note, signed_by, signed_at";

async function loadCashDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; id: string },
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
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 4: PM detail loader
// ─────────────────────────────────────────────────────────────────────────────

export type Gradient = "great" | "good" | "needs_work";

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
}

async function loadPmDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; id: string },
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
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ReportDetail union + dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export type ReportDetail = ChecklistReportDetail | CashReportDetail | PmReportDetail;

export async function loadReportDetail(
  service: SupabaseClient,
  args: { viewer: Viewer; type: ReportTypeKey; id: string },
): Promise<ReportDetail | null> {
  if (
    args.type === "opening" ||
    args.type === "closing" ||
    args.type === "am_prep" ||
    args.type === "mid_day"
  ) {
    return loadChecklistDetail(service, { viewer: args.viewer, instanceId: args.id, type: args.type });
  }
  if (args.type === "cash") {
    return loadCashDetail(service, { viewer: args.viewer, id: args.id });
  }
  if (args.type === "pm") {
    return loadPmDetail(service, { viewer: args.viewer, id: args.id });
  }
  return null;
}
