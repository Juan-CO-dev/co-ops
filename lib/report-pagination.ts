import type { ReportTypeKey } from "@/lib/reports-hub";
const TYPES: ReportTypeKey[] = ["opening", "closing", "am_prep", "mid_day", "cash", "pm", "maintenance"];
export interface ReportTuple { date: string; type: ReportTypeKey; id: string; locationId: string }
export function compareReportTuples(a: ReportTuple, b: ReportTuple): number {
  return b.date.localeCompare(a.date) || TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.id.localeCompare(b.id) || a.locationId.localeCompare(b.locationId);
}
export function encodeReportCursor(last: ReportTuple, context: string): string {
  return Buffer.from(JSON.stringify({ last, context })).toString("base64url");
}
export function decodeReportCursor(cursor: string | undefined, context: string): ReportTuple | null {
  if (!cursor || cursor.length > 4096) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
    const t = value.last;
    return value.context === context && t && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && TYPES.includes(t.type) && typeof t.id === "string" && typeof t.locationId === "string" ? t : null;
  } catch { return null; }
}
