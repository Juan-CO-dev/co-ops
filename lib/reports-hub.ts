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
