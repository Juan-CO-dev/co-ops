/** Authenticated loader scope. A URL selection cannot grant shop authority. */
export interface ReportScopeViewer { userId: string; level: number; locations?: string[] }
export function canReadScopedReport(viewer: ReportScopeViewer, locationId: string): boolean {
  return locationId !== "all" && (viewer.level >= 8 || !!viewer.locations?.includes(locationId));
}
export function requireReportScope(viewer: ReportScopeViewer, locationId: string): void {
  if (viewer.level < 2 || !canReadScopedReport(viewer, locationId)) throw new Error("report_scope_forbidden");
}
export function ownReportScope(viewer: ReportScopeViewer): boolean { return viewer.level < 4; }
