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
    // B8 #4: a maintenance row's flag count is a fridge-DAY re-read of the same temp
    // completions its opening/closing report already counted — summing both double-counts
    // one hot reading. The summary counts readings once, as Trends does.
    if (item.type !== "maintenance") signals.tempFlags += s.tempFlags;
    if ((s.cashOverShortCents ?? 0) > 0) cashOver++;
    if ((s.cashOverShortCents ?? 0) < 0) cashShort++;
  }
  return { total: items.length, finalized: items.filter(reportIsFinalized).length, autoClosed: items.filter((item) => item.status === "auto_finalized").length, signals, cashOver, cashShort };
}
