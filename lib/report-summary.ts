import type { ReportListItem, ReportTypeKey, SignalSummary } from "@/lib/reports-hub";

export type LastCloseState = "done" | "not_finalized" | "missing";
export const LAST_CLOSE_TYPES: ReportTypeKey[] = ["opening", "am_prep", "mid_day", "closing", "cash", "pm"];
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
      const item = candidates.find(reportIsFinalized) ?? candidates[0];
      const state: LastCloseState = !item ? "missing" : reportIsFinalized(item) ? "done" : "not_finalized";
      return { type, state, item };
    }),
  };
}

export function composeReportSummary(items: ReportListItem[]) {
  const signals: SignalSummary = { underPar: 0, overPar: 0, skipped: 0, tempFlags: 0, cashOverShortCents: null };
  let cashOver = 0;
  let cashShort = 0;
  for (const item of items) {
    const s = item.signalSummary;
    if (!s) continue;
    signals.underPar += s.underPar;
    signals.overPar += s.overPar;
    signals.skipped += s.skipped;
    signals.tempFlags += s.tempFlags;
    if ((s.cashOverShortCents ?? 0) > 0) cashOver++;
    if ((s.cashOverShortCents ?? 0) < 0) cashShort++;
  }
  return { total: items.length, finalized: items.filter(reportIsFinalized).length, signals, cashOver, cashShort };
}
