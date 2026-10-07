import type { SupabaseClient } from "@supabase/supabase-js";
import { listReportSkeleton, type ReportListItem, type ReportTypeKey, type Viewer } from "@/lib/reports-hub";
import { shiftReportDate } from "@/lib/report-range";

export interface RelatedReport extends Pick<ReportListItem, "type" | "id" | "date"> { href: string; submittedAt?: string | null }
export interface ReportRelations { sameDay: RelatedReport[]; previous: RelatedReport[]; next: RelatedReport[]; baselineHrefs: Record<string, string> }

export function relatedReportHref(report: Pick<ReportListItem, "type" | "id">, locationId: string, context: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(context)) if (value) params.set(key, value);
  params.set("location", locationId);
  return `/reports/${report.type}/${encodeURIComponent(report.id)}?${params}`;
}

/** The list's authorization is the single source of truth for related links. */
export async function loadReportRelations(service: SupabaseClient, args: {
  viewer: Viewer; locationId: string; date: string; type: ReportTypeKey; id: string;
  context: Record<string, string | undefined>; baselineIds?: string[];
}): Promise<ReportRelations> {
  const previousDate = shiftReportDate(args.date, -1);
  const nextDate = shiftReportDate(args.date, 1);
  const rows = await listReportSkeleton(service, { viewer: args.viewer, locationId: args.locationId, dateFrom: previousDate, dateTo: nextDate });
  const link = (row: ReportListItem & { submittedAt?: string | null }): RelatedReport => ({ type: row.type, id: row.id, date: row.date, submittedAt: row.submittedAt, href: relatedReportHref(row, args.locationId, args.context) });
  const baselineHrefs: Record<string, string> = {};
  const sourceDates = new Map<string, ReportListItem[]>();
  for (const id of new Set(args.baselineIds ?? [])) {
    // Frozen baselines can outlive the three-day strip. Check the exact source
    // through the list's type/location/participation gate rather than guessing a date.
    let readable = rows.some(row => row.type === "am_prep" && row.id === id);
    if (!readable) {
      const { data: source, error } = await service.from("checklist_instances").select("date")
        .eq("id", id).eq("location_id", args.locationId).maybeSingle<{ date: string }>();
      if (error) throw new Error(error.message);
      if (source) {
        let candidates = sourceDates.get(source.date);
        if (!candidates) {
          candidates = await listReportSkeleton(service, { viewer: args.viewer, locationId: args.locationId,
            dateFrom: source.date, dateTo: source.date, types: ["am_prep"] });
          sourceDates.set(source.date, candidates);
        }
        readable = candidates.some(row => row.id === id && row.type === "am_prep");
      }
    }
    if (readable) baselineHrefs[id] = relatedReportHref({ type: "am_prep", id }, args.locationId, args.context);
  }
  return {
    sameDay: rows.filter(row => row.date === args.date && !(row.type === args.type && row.id === args.id)).map(link),
    previous: rows.filter(row => row.date === previousDate && row.type === args.type).map(link),
    next: rows.filter(row => row.date === nextDate && row.type === args.type).map(link),
    baselineHrefs,
  };
}
