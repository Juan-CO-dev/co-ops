import type { ReportListItem, ReportTypeKey } from "@/lib/reports-hub";

export type LastCloseState = "done" | "auto_closed" | "not_finalized" | "missing";
export const LAST_CLOSE_TYPES: ReportTypeKey[] = ["opening", "am_prep", "mid_day", "closing", "cash", "pm"];
// phase2_complete is final: opening Phase 3 is unwired (only six confirmed,
// last 2026-05-09); finalizeMidDayPhase2 writes it too. CC ruling 2026-10-07.
export function reportIsFinalized(item: Pick<ReportListItem, "status" | "type">): boolean {
  return item.type === "maintenance" || ["confirmed", "phase2_complete", "submitted", "completed", "incomplete_confirmed", "auto_finalized", "ok", "flags"].includes(item.status);
}

/** Empty shops have no activity, never six claims that work was missed. */
export function composeLastClose(items: ReportListItem[], level: number) {
  return {
    noActivity: items.length === 0,
    ownScope: level < 4,
    submissions: items,
    reports: LAST_CLOSE_TYPES.filter((type) => type !== "cash" || level >= 4).map((type) => {
      const candidates = items.filter((item) => item.type === type);
      const item = candidates.find((candidate) => candidate.status !== "auto_finalized" && reportIsFinalized(candidate))
        ?? candidates.find(reportIsFinalized) ?? candidates[0];
      const state: LastCloseState = !item ? "missing" : item.status === "auto_finalized" ? "auto_closed" : reportIsFinalized(item) ? "done" : "not_finalized";
      return { type, state, item };
    }),
  };
}

/**
 * B8 #4 (r2, Astra P1): out-of-range temperature READINGS in the window, each counted once.
 * A day's maintenance row counts every live reading of that day (`tempReadings`), finalized or
 * not — so it REPLACES the listed opening/closing reports' reading flags for that day (summing
 * both double-counted one hot reading; dropping it lost today's readings, whose reports are not
 * listed until finalized). A day with no maintenance reading count falls back to its reports.
 * The count reads the same fridges the reports do, retired ones included (r3, listMaintenanceReportDates).
 */
export function summaryTempReadings(items: ReportListItem[]): number {
  const fromReports = new Map<string, number>();
  const fromMaintenance = new Map<string, number>();
  for (const item of items) {
    const s = item.signalSummary;
    if (!s) continue;
    if (item.type === "maintenance") {
      if (s.tempReadings !== undefined) fromMaintenance.set(item.date, s.tempReadings);
    } else fromReports.set(item.date, (fromReports.get(item.date) ?? 0) + s.tempFlags);
  }
  let total = 0;
  for (const [date, n] of fromReports) if (!fromMaintenance.has(date)) total += n;
  for (const n of fromMaintenance.values()) total += n;
  return total;
}

export function composeReportSummary(items: ReportListItem[]) {
  const signals = { underPar: 0, overPar: 0, skipped: 0, notStarted: 0, tempFlags: 0, cashOverShortCents: null };
  let cashOver = 0;
  let cashShort = 0;
  for (const item of items) {
    const s = item.signalSummary;
    if (!s) continue;
    signals.underPar += s.underPar;
    signals.overPar += s.overPar;
    signals.skipped += s.skipped;
    signals.notStarted += s.notStarted ?? 0;
    if ((s.cashOverShortCents ?? 0) > 0) cashOver++;
    if ((s.cashOverShortCents ?? 0) < 0) cashShort++;
  }
  signals.tempFlags = summaryTempReadings(items);
  return { total: items.length, finalized: items.filter(reportIsFinalized).length, autoClosed: items.filter((item) => item.status === "auto_finalized").length, signals, cashOver, cashShort };
}
